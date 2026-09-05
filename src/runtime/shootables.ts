import type { PolyMeshHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeGameLogicFacts } from "../prepare/gameLogicFacts";
import type { QuakeEntity, QuakePreparedModel, QuakeVertex } from "../types/quake";
import {
  type QuakeMonsterDeathGibOutput,
  type QuakeMonsterScriptedLifecycle,
  type QuakeMonsterSpawnProfile,
  type QuakeShootableRadiusDamageFact,
} from "../generated/quakeMonsterLogic";
import {
  COLLISION_EPSILON,
  GROUND_SNAP,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  QUAKE_COLLISION_UNIT_SCALE,
  QUAKE_PLAYER_MINS_Z,
  QUAKE_PLAYER_VIEW_Z,
  STEP_HEIGHT,
} from "./constants";
import { quakeAliasModelRenderYaw, normalizeQuakeRenderYaw } from "./aliasModelOrientation";
import type { QuakeCollisionResult, QuakeUseTrace } from "./collision";
import {
  createQuakeShootablesVisibilityChurnStats,
  recordQuakeShootablesVisibilitySync,
  shootableVisibilitySelectionKey,
  type QuakeShootablesVisibilitySnapshot,
} from "./debug/churnStats";
import { isQuakeDebugDomMetadataEnabled, markQuakeTrace } from "./debug/traceMarks";
import { quakeEntityNumber } from "./entities";
import { dotVec3, distanceSq3, normalizeVec3 } from "./math";
import {
  type QuakePickupModel,
  type QuakePickupModelLibrary,
  type QuakeProgramMetadata,
} from "./pickups";
import type { QuakePlayerDamageContext } from "./player";
import {
  stripPolyMeshMetadata,
  type QuakeRenderBundleFrameSetMotionMaterialOptions,
  type QuakeRenderBundleFrameSetMountOptions,
} from "./renderBundleMesh";
import type { QuakeMonsterStateRunner, QuakeMonsterStateStep } from "./quakeMonsterStateRunner";
import { quakeTriggerMonsterJumpActivationFromRule } from "./triggerEffects";
import type { QuakeWeaponShootableTarget } from "./weapons";
import {
  aabbsOverlap,
  inflateBounds,
  quakeMonsterSpawnProfileForEntity,
  quakeMonsterStartKind,
  quakeMonsterUsesEnemyRuntime,
  segmentAabbIntersectionDistance,
  shootableCollisionBounds,
  shootableLocalBounds,
  type QuakeBounds,
  type QuakeShootableBounds,
} from "./shootables/bounds";
import { createQuakeCombatBudgetRuntime, QUAKE_COMBAT_BUDGET_LIMITS } from "./shootables/combatBudget";
import {
  createQuakeEnemyAcquisitionVisibilityCache,
  quakeEnemyFindTarget,
  type QuakeEnemyAcquisitionDecision,
  type QuakeEnemyAcquisitionSightEntity,
  type QuakeEnemyAcquisitionTarget,
} from "./shootables/enemyAcquisition";
import {
  quakeBossHealthForSkill,
  quakeBossPainBranchForHealth,
  quakeBossRuntimeChainName,
  quakeBossScriptedLifecycle,
  quakeBossSkillKey,
} from "./shootables/boss";
import {
  QUAKE_MONSTER_HUNT_TARGET_ATTACK_DELAY_MS,
  quakecMonsterHasRunMovement,
  quakeMonsterCanAcquirePlayer,
  quakeMonsterCombatProfile,
  quakeMonsterSightSoundPath,
  type QuakeMonsterCombatProfile,
} from "./shootables/combatFacts";
import {
  boundedAnimationRange,
  enemyAnimationFrameDuration,
  enemyAnimationModeLoops,
  enemyAnimationRange,
  enemyOptionalAnimationRange,
  quakecAnimationChainForMode,
  selectEnemyPainReactionChain,
} from "./shootables/enemyAnimationPolicy";
import {
  quakecAttackCooldownStartsOnSelection,
  createQuakeEnemyCombatRuntime,
  quakeEnemyCooldownMs,
  quakeEnemyWakeDelayMs,
  quakeShootableAttackHasBranchSightCheck,
  quakeShootableAttackChain,
  quakeShootableUsesQuakecAttackEvents,
  selectQuakeEnemyAttackChain,
} from "./shootables/enemyCombat";
import {
  quakeShootablesDebugStats,
  type QuakeShootablesDebugCullingSnapshot,
  type QuakeShootablesDebugStats,
  type QuakeShootablesDebugVisibilitySyncSnapshot,
} from "./shootables/debugStats";
import {
  quakecCanDamageAnyTracePointClear,
  quakecCanDamageFromTracePoints,
  quakecCanDamageTracePointsForRuntimeOrigin,
  type QuakeCanDamageResult,
  type QuakeCanDamageTracePoint,
  quakeDamageRetargetDecision,
  quakeRadiusDamageAmount,
  quakeShootableDeathRadiusDamage,
  shootableHealth,
} from "./shootables/damage";
import {
  createQuakeShootableDeathStateRuntime,
  QUAKE_ZOMBIE_DOWN_HOLD_MS,
  type QuakeMonsterBackpackDropRuntime,
} from "./shootables/deathState";
import {
  clearQuakecMovementBudget,
  createQuakeEnemyMovementRuntime,
  quakeYawToOrigin,
  syncEnemyQuakecMovementBudget,
} from "./shootables/enemyMovement";
import { createQuakeEnemyLoop } from "./shootables/enemyLoop";
import {
  createQuakeEnemyProjectileRuntime,
  quakeEnemyProjectileAttackOrigin,
  quakeEnemyProjectileOffsetPoint,
  type QuakeEnemyProjectileDebugCapture,
} from "./shootables/enemyProjectiles";
import {
  createQuakeRandomStream,
  createEnemyState,
  nextEnemyRandom,
  QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS,
  QUAKE_MONSTER_USE_ATTACK_DELAY_MS,
  QUAKE_MONSTER_USE_FOUND_TARGET_DELAY_MS,
  quakeEnemyRandomSaltValue,
  type QuakeRandomStream,
  quakeMonsterChainDurationMs as quakeMonsterChainDurationMsBase,
  quakeMonsterStateOffsetMs,
} from "./shootables/enemyStateFactory";
import {
  buildQuakeMonsterPathCornerIndex,
  createQuakeMonsterJumpTriggers,
  groundedQuakeMonsterOrigin,
  quakeMonsterDropFloorAt,
  quakeInitialMonsterMovetarget,
} from "./shootables/enemySpawn";
import {
  canUseShootableFallback,
  isRequiredShootableModel,
  missingRequiredShootableModelError,
  quakeMonsterAnimationProfile,
  quakeShootableModelPath,
} from "./shootables/monsterMetadata";
import type { QuakeShootablesProgressSnapshot } from "./shootables/progress";
import { createQuakeShootablesProgressRuntime } from "./shootables/progressRuntime";
import { createQuakeShootablePrewarmQueues } from "./shootables/prewarm";
import { createQuakeShootablePresentation } from "./shootables/presentation";
import {
  createQuakeShootableStateMap,
  type QuakeDamageActorReference,
  type QuakeEnemyAnimationContext,
  type QuakeEnemyAttackTarget,
  type QuakeEnemyState,
  type QuakeEnemyTargetReference,
  type QuakeMonsterAnimationMode,
  type QuakeMonsterAnimationProfile,
  type QuakeMonsterAnimationRange,
  type QuakeMonsterDeathOutputVisualHandle,
  type QuakeMonsterJumpTrigger,
  type QuakeMonsterPathCorner,
  type QuakeShootableDamageContext,
  type QuakeShootableState,
} from "./shootables/state";

export { quakeShootableFallbackPolygons } from "./shootables/bounds";
export { quakeMonsterCanAcquirePlayer, quakeMonsterRunSpeedUnitsPerSecond } from "./shootables/combatFacts";
export { quakeShootableModelPath } from "./shootables/monsterMetadata";
export type { QuakeShootableBounds } from "./shootables/bounds";
export type {
  QuakeShootableDebugCullingEntry,
  QuakeShootablesDebugCullingSnapshot,
  QuakeShootablesDebugStats,
} from "./shootables/debugStats";
export type { QuakeMonsterBackpackDropRuntime } from "./shootables/deathState";
export type { QuakeEnemyProjectileDebugCapture } from "./shootables/enemyProjectiles";
export type { QuakeShootableProgressEntry, QuakeShootablesProgressSnapshot } from "./shootables/progress";

export interface QuakeShootablesController {
  clear(): void;
  canDamageTargetOrigin(start: Vec3, targetOrigin: Vec3): boolean;
  debugEnemyAcquisition(
    entityIndex: number,
    playerSourceOrigin: { x: number; y: number; z: number },
    options?: QuakeShootableEnemyAcquisitionDebugOptions,
  ): QuakeShootableEnemyAcquisitionDebugResult | null;
  debugCullingSnapshot(origin: [number, number, number]): QuakeShootablesDebugCullingSnapshot;
  debugStats(): QuakeShootablesDebugStats;
  debugCanDamageTrace(start: Vec3, tracePoints: readonly QuakeCanDamageTracePoint[]): QuakeCanDamageResult;
  debugDamageWeaponTarget(entityIndex: number, amount: number): boolean;
  debugClearEnemyProjectileCapture(): void;
  debugEnemyProjectileCapture(): QuakeEnemyProjectileDebugCapture;
  debugForceEnemyAttack(entityIndex: number, targetOrigin?: Vec3): boolean;
  debugForceEnemyAttackChain(entityIndex: number, chain: string, targetOrigin?: Vec3): boolean;
  debugMountEntity(entityIndex: number): boolean;
  debugStepEnemyProjectiles(dtMs?: number): QuakeEnemyProjectileDebugCapture;
  debugSetEnemyTickFilter(entityIndexes: readonly number[] | null): void;
  debugSetEnemyProjectileCaptureEnabled(enabled: boolean): void;
  debugSetOrigin(entityIndex: number, origin: Vec3): boolean;
  debugSetYaw(entityIndex: number, yaw: number): boolean;
  setExpandedLogicalCombatEnabled(enabled: boolean): void;
  setMountedEnemyAcquisitionEnabled(enabled: boolean): void;
  nextPlayerQuakecRandom(details: QuakePlayerQuakecRandomDetails): number;
  setUnmountedAiEnabled(enabled: boolean): void;
  spawn(
    entities: QuakeEntity[],
    modelLibrary: QuakePickupModelLibrary | null,
    programMetadata?: QuakeProgramMetadata | null,
  ): void;
  setupMonsterJumpTriggers(
    entities: QuakeEntity[],
    models: QuakePreparedModel[],
    pivot: QuakeVertex,
    gameLogic?: QuakeGameLogicFacts | null,
  ): void;
  has(entityIndex: number): boolean;
  activate(entityIndex: number, options?: QuakeShootableActivationOptions): boolean;
  triggerBossLightning(options?: QuakeShootableActivationOptions): boolean;
  damage(entityIndex: number, amount: number, context?: QuakeShootableDamageContext): boolean;
  destroy(entityIndex: number): boolean;
  firstMonsterOverlappingBounds(bounds: QuakeShootableBounds): number | null;
  pushMonsterBlockers(bounds: QuakeShootableBounds, delta: Vec3): number | null;
  restoreProgress(snapshot: QuakeShootablesProgressSnapshot): void;
  snapshotProgress(): QuakeShootablesProgressSnapshot;
  syncAnimationPresentation(): void;
  syncMonsterRuntime(): void;
  resolvePlayerCollision(
    result: QuakeCollisionResult,
    previous: [number, number, number],
    eyeHeight: number,
    validateOrigin?: QuakeShootableCollisionOriginValidator,
  ): QuakeCollisionResult;
  syncVisibility(origin: [number, number, number], force?: boolean): void;
  weaponTargets(): Iterable<QuakeWeaponShootableTarget>;
}

export interface QuakeShootableEnemyAcquisitionDebugOptions {
  monsterYaw?: number;
  nowSeconds?: number;
}

export interface QuakeShootableEnemyAcquisitionDebugResult {
  decision: QuakeEnemyAcquisitionDecision;
  lineOfSightCalls: number;
  monster: {
    classname: string;
    entityIndex: number;
    origin: Vec3;
    viewOffset: Vec3;
    yaw: number;
  };
  player: {
    origin: Vec3;
    viewOffset: Vec3;
  };
}

type QuakeShootableCollisionOriginValidator = (origin: [number, number, number]) => boolean;

export interface QuakeShootablesControllerOptions {
  addMesh(
    entity: QuakeEntity,
    model?: QuakePickupModel,
    frameIndex?: number,
    options?: QuakeShootableMeshMountOptions,
  ): PolyMeshHandle | null;
  ambientMonsterPathingEnabled?: () => boolean;
  bossLightningElectrodesReady?: (
    targetName: string,
    alignment: QuakeMonsterScriptedLifecycle["lightning"]["alignment"],
  ) => boolean;
  bossLightningDischarge?: (
    targetName: string,
    lightning: QuakeMonsterScriptedLifecycle["lightning"],
  ) => void;
  createMonsterStateRunner?: (classname: string) => QuakeMonsterStateRunner | null;
  damagePlayer(amount: number, context?: QuakePlayerDamageContext): boolean;
  contentsAt?(point: Vec3): number | null;
  dropBackpack?: (drop: QuakeMonsterBackpackDropRuntime) => boolean | void;
  onDestroyed?: (entity: QuakeEntity) => void;
  onExplosion?(event: QuakeShootableExplosionEvent): void;
  enemyAnimationsEnabled?: () => boolean;
  enemiesFrozen?: () => boolean;
  enemyAttacksEnabled?: () => boolean;
  enemyMotionMaterial?: QuakeRenderBundleFrameSetMotionMaterialOptions | null;
  enemyRandomSalt?: number | (() => number);
  floorAt(x: number, y: number, maxZ?: number, minZ?: number): number | null;
  getPlayerForward(): Vec3;
  getPlayerEyeHeight(): number;
  getPlayerOrigin(): [number, number, number];
  hasLineOfSight(start: Vec3, end: Vec3): boolean;
  traceLine?(start: Vec3, end: Vec3): QuakeUseTrace | null;
  isPlayerInvisible?: () => boolean;
  isGameplayPaused?: () => boolean;
  isInPlayerView(origin: Vec3): boolean;
  leafIndexAt(origin: Vec3): number | undefined;
  monsterRuntimeEnabled(): boolean;
  pointToPoly(point: { x: number; y: number; z: number }): Vec3;
  shouldSpawn(entity: QuakeEntity): boolean;
  pixelate(handle: PolyMeshHandle): void;
  playerClearance?: QuakeShootablesPlayerClearanceOptions | null;
  schedulePresentationResync(handle: PolyMeshHandle): void;
  visibleLeavesAt(origin: [number, number, number]): Set<number> | null;
  prewarmLeavesAt?(origin: [number, number, number]): Set<number> | null;
  fireTarget(targetname: string, sourceEntityIndex?: number): void;
  playSound?(soundPath: string, options?: QuakeShootableSoundOptions): boolean;
}

export interface QuakeShootableExplosionEvent {
  classname?: string;
  entityIndex?: number;
  flavor: "explobox" | "grenade" | "lava" | "rocket";
  origin: Vec3;
  radiusUnits?: number;
}

export interface QuakeShootablesPlayerClearanceOptions {
  enemyClassnames?: readonly string[];
  extraRadius: number;
  useBossAwakeBounds?: boolean;
}

export interface QuakePlayerQuakecRandomDetails {
  damage?: number;
  functionName: string;
  projectile?: string;
  reason: string;
  sourceEntityIndex?: number;
}

export interface QuakeShootableActivationOptions {
  skill?: number;
}

export interface QuakeShootableMeshMountOptions {
  frameSetMountOptions?: QuakeRenderBundleFrameSetMountOptions;
}

interface QuakeShootableSoundOptions {
  volume?: number;
}

const QUAKE_SHOOTABLE_DEATH_DELAY_MS = 180;
const QUAKE_SHOOTABLE_COLLISION_EPSILON = 0.5 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_SHOOTABLE_MOUNT_DISTANCE = 1152 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_SHOOTABLE_UNMOUNT_DISTANCE = 1536 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_SHOOTABLE_PREWARM_DISTANCE = 1792 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_SHOOTABLE_MOUNT_DISTANCE_SQ = QUAKE_SHOOTABLE_MOUNT_DISTANCE * QUAKE_SHOOTABLE_MOUNT_DISTANCE;
const QUAKE_SHOOTABLE_UNMOUNT_DISTANCE_SQ = QUAKE_SHOOTABLE_UNMOUNT_DISTANCE * QUAKE_SHOOTABLE_UNMOUNT_DISTANCE;
const QUAKE_SHOOTABLE_PREWARM_DISTANCE_SQ = QUAKE_SHOOTABLE_PREWARM_DISTANCE * QUAKE_SHOOTABLE_PREWARM_DISTANCE;
const QUAKE_SHOOTABLE_MAX_MOUNTED = 5;
const QUAKE_SHOOTABLE_MAX_MOUNTED_CORPSES = 4;
const QUAKE_SHOOTABLE_MAX_PREWARMED = 3;
const QUAKE_SHOOTABLE_MIN_VIEW_DEPTH = PLAYER_RADIUS;
const QUAKE_SHOOTABLE_FRAME_SWAP_SAFE_VERTICAL_FACTOR = 2.2;
const QUAKE_SHOOTABLE_FRAME_SWAP_SAFE_RADIUS_FACTOR = 0.5;
const QUAKE_SHOOTABLE_OVERSIZED_RENDER_RADIUS = 2.5;
const QUAKE_SHOOTABLE_OVERSIZED_RENDER_HEIGHT = 3;
const QUAKE_SHOOTABLE_PREWARM_TIMEOUT_MS = 250;
const QUAKE_SHOOTABLE_VISIBILITY_GRACE_MS = 300;
const QUAKE_SHOOTABLE_ENEMY_PREWARM_VIEW_DOT_MIN = -0.35;
const QUAKE_EXPLOBOX_BECOME_EXPLOSION_Z_OFFSET = 32 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_ENEMY_TICK_MS = 1000 / 60;
const QUAKE_ENEMY_DT_CLAMP = 0.05;
const QUAKE_WALKMONSTER_VIEW_Z = 25 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_SIGHT_ENTITY_WINDOW_SECONDS = 0.1;
const QUAKE_MONSTER_AMBUSH_OR_ZOMBIE_CRUCIFIED_FLAGS = 3;
const QUAKE_MONSTER_JUMP_GRAVITY = 800 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_DEATH_OUTPUT_CLASS = "quake-monster-death-output";
const QUAKE_MONSTER_DEATH_OUTPUT_ARC_MAX_ACTIVE = 24;
const QUAKE_MONSTER_DEATH_OUTPUT_ARC_MAX_MS = 900;
const QUAKE_MONSTER_DEATH_OUTPUT_ARC_DT_CLAMP = 0.05;
const QUAKE_MONSTER_DEATH_OUTPUT_ARC_GRAVITY = 800 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PATH_CORNER_HALF_EXTENT = 8 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PATH_TOUCH_RADIUS = 24 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_CONTENTS_SOLID = -2;
const QUAKE_SHOOTABLE_TRANSFORM_EPSILON = COLLISION_EPSILON;
const QUAKE_SHOOTABLE_MOTION_MATERIAL_ORIGIN_EPSILON_SQ = 0.000001;
const QUAKE_SHOOTABLE_MOTION_MATERIAL_FORWARD_EPSILON_SQ = 0.000001;
const QUAKE_MOVE_GOAL_DEBUG_DECISION_LIMIT = 8;
type QuakeShootableLineOfSightResult = "clear" | "blocked" | "deferred";
type QuakeShootableTraceDetails = Record<string, boolean | number | string | null | undefined>;
interface QuakeShootableVisibilityCandidate {
  distanceSq: number;
  index: number;
}


function recordMoveGoalDecisionTrace(
  kind: string,
  shootable: QuakeShootableState,
  details: QuakeShootableTraceDetails,
): void {
  const enemy = shootable.enemy;
  if (!enemy) return;
  const decisions = enemy.debugMoveGoalDecisions ?? [];
  decisions.push({
    atMs: performance.now(),
    details: sanitizedMoveGoalDecisionDetails(details),
    kind,
  });
  if (decisions.length > QUAKE_MOVE_GOAL_DEBUG_DECISION_LIMIT) {
    decisions.splice(0, decisions.length - QUAKE_MOVE_GOAL_DEBUG_DECISION_LIMIT);
  }
  enemy.debugMoveGoalDecisions = decisions;
}

function sanitizedMoveGoalDecisionDetails(
  details: QuakeShootableTraceDetails,
): Record<string, boolean | number | string | null> {
  const out: Record<string, boolean | number | string | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    out[key] = value;
  }
  return out;
}

function quakeMonsterInitialIdealYaw(
  entity: QuakeEntity,
  origin: Vec3,
  movetarget: QuakeMonsterPathCorner | null,
): number {
  const startYaw = entity.angle ?? quakeEntityNumber(entity, "angle", 0);
  const startKind = quakeMonsterStartKind(entity);
  return (startKind === "walk" || startKind === "swim") && movetarget
    ? quakeYawToOrigin(origin, movetarget.origin)
    : startYaw;
}

export function createQuakeShootablesController({
  addMesh,
  ambientMonsterPathingEnabled: sourceAmbientMonsterPathingEnabled,
  bossLightningDischarge,
  bossLightningElectrodesReady,
  createMonsterStateRunner,
  damagePlayer,
  contentsAt,
  dropBackpack,
  onDestroyed,
  onExplosion,
  enemyAnimationsEnabled,
  enemiesFrozen,
  enemyAttacksEnabled,
  enemyMotionMaterial = null,
  enemyRandomSalt = 0,
  floorAt,
  getPlayerForward,
  getPlayerEyeHeight,
  getPlayerOrigin,
  hasLineOfSight: sourceHasLineOfSight,
  traceLine: sourceTraceLine,
  isPlayerInvisible,
  isGameplayPaused,
  isInPlayerView,
  leafIndexAt,
  monsterRuntimeEnabled,
  pointToPoly,
  shouldSpawn,
  pixelate,
  playerClearance = null,
  schedulePresentationResync,
  visibleLeavesAt,
  prewarmLeavesAt = visibleLeavesAt,
  fireTarget,
  playSound,
}: QuakeShootablesControllerOptions): QuakeShootablesController {
  let shootables = createQuakeShootableStateMap();
  let deathTimers: number[] = [];
  let deathOutputHandles: QuakeMonsterDeathOutputVisualHandle[] = [];
  let deathOutputAnimationFrame: number | null = null;
  const activeDeathOutputAnimations = new Set<QuakeMonsterDeathOutputVisualHandle>();
  let destroyedEntityIndexes = new Set<number>();
  let currentModelLibrary: QuakePickupModelLibrary | null = null;
  let monsterPathCornersByTargetname = new Map<string, QuakeMonsterPathCorner>();
  let monsterJumpTriggers: QuakeMonsterJumpTrigger[] = [];
  let visibilityChurn = createQuakeShootablesVisibilityChurnStats();
  let debugEnemyTickFilter: Set<number> | null = null;
  let debugEnemyProjectileStepNow = 0;
  const combatBudget = createQuakeCombatBudgetRuntime();
  const mountedEnemyAcquisitionVisibilityCache = createQuakeEnemyAcquisitionVisibilityCache();
  let mountedEnemySightEntity: { entityIndex: number; seenAtSeconds: number } | null = null;
  let lastVisibilitySelectionKey = "";
  let lastVisibilitySync: QuakeShootablesDebugVisibilitySyncSnapshot | null = null;
  let lastMotionMaterialForward: Vec3 | null = null;
  let lastMotionMaterialOrigin: Vec3 | null = null;
  function markShootableTrace(
    kind: string,
    shootable: QuakeShootableState,
    details: QuakeShootableTraceDetails = {},
  ): void {
    if (kind.startsWith("enemy-move") && isQuakeDebugDomMetadataEnabled()) {
      recordMoveGoalDecisionTrace(kind, shootable, details);
    }
    markQuakeTrace(kind, {
      entity: shootable.entity.index,
      class: shootable.entity.classname,
      leaf: shootable.leafIndex ?? null,
      frame: shootable.enemy?.animationFrameIndex ?? null,
      mode: shootable.enemy?.animationMode ?? null,
      visible: presentation.isVisible(shootable),
      ...details,
    });
  }

  const presentation = createQuakeShootablePresentation({
    addMesh, pointToPoly, pixelate, schedulePresentationResync, enemyMotionMaterial,
    lifecycle: shootableLifecycleClassState,
    nextFrameIndex: nextShootableAnimationFrameIndex,
    markTrace: markShootableTrace,
    onHandlesChanged(changes) {
      for (const key of Object.keys(changes) as Array<keyof typeof changes>) {
        visibilityChurn[key] += changes[key] ?? 0;
      }
    },
  });
  const countShootableHandles = presentation.handleCount;
  const removeShootableHandles = presentation.remove;
  const syncShootableEnemyDatasets = presentation.syncDatasets;
  const canUseShootableAnimationFrameSet = presentation.supportsFrameSet;
  const ensureShootableAnimationFrameHandle = presentation.ensureFrame;
  const trimShootableAnimationFrameHandles = presentation.trimFrames;
  const prewarmQueues = createQuakeShootablePrewarmQueues<QuakeShootableState>({
    canPoolAnimationFrame: canPoolShootableAnimationFrames,
    canPrewarmShootable: canPrewarmShootableHandle,
    ensureAnimationFrame: (shootable, frameIndex) => {
      ensureShootableAnimationFrameHandle(shootable, frameIndex);
    },
    getShootable: (entityIndex) => shootables.get(entityIndex),
    hasHandle: presentation.hasHandle,
    isVisible: presentation.isVisible,
    hasFrame: presentation.hasFrame,
    mountShootable: mountShootableHandle,
    setShootableVisible,
    timeoutMs: QUAKE_SHOOTABLE_PREWARM_TIMEOUT_MS,
    trimAnimationFrameHandles: trimShootableAnimationFrameHandles,
  });

  function budgetedLineOfSight(start: Vec3, end: Vec3): QuakeShootableLineOfSightResult {
    if (!combatBudget.tryRecordLineOfSightCheck()) return "deferred";
    return sourceHasLineOfSight(start, end) ? "clear" : "blocked";
  }

  function unbudgetedLineOfSight(start: Vec3, end: Vec3): QuakeShootableLineOfSightResult {
    return sourceHasLineOfSight(start, end) ? "clear" : "blocked";
  }

  function hasLineOfSight(start: Vec3, end: Vec3): boolean {
    return budgetedLineOfSight(start, end) === "clear";
  }

  function traceProjectileLine(start: Vec3, end: Vec3): QuakeUseTrace | null {
    if (!combatBudget.tryRecordLineOfSightCheck()) return null;
    return sourceTraceLine?.(start, end) ?? null;
  }

  let quakecRandomStream: QuakeRandomStream = createQuakeRandomStream(0);

  function resetQuakecRandomStream(seed: number): void {
    quakecRandomStream = createQuakeRandomStream(seed);
  }

  function nextQuakecRandom(_enemy: QuakeEnemyState): number {
    return quakecRandomStream.next();
  }

  function quakecRandomRange(_enemy: QuakeEnemyState, min: number, max: number): number {
    return quakecRandomStream.range(min, max);
  }

  function nextPlayerQuakecRandom(details: QuakePlayerQuakecRandomDetails): number {
    const roll = quakecRandomStream.next();
    markQuakeTrace("player-quakec-random", {
      damage: details.damage ?? null,
      function: details.functionName,
      projectile: details.projectile ?? null,
      reason: details.reason,
      source: details.sourceEntityIndex ?? null,
      value: roll,
    });
    return roll;
  }

  function consumePlayerPainRandom(details: {
    damage: number;
    projectile: string;
    reason: string;
    sourceEntityIndex?: number;
  }): number {
    return nextPlayerQuakecRandom({
      damage: details.damage,
      functionName: "PainSound",
      projectile: details.projectile,
      reason: details.reason,
      sourceEntityIndex: details.sourceEntityIndex,
    });
  }

  const enemyProjectiles = createQuakeEnemyProjectileRuntime({
    addMesh,
    boundsCenter: quakecBoundsCenter,
    consumePlayerPainRandom,
    currentModelLibrary: () => currentModelLibrary,
    damagePlayer,
    floorAt,
    hasLineOfSight,
    markTrace: markQuakeTrace,
    offsetPoint: quakeEnemyProjectileOffsetPoint,
    pixelate,
    playerDamageBounds: quakecPlayerDamageBounds,
    playerDamageOrigin: (origin) => [...origin],
    playSound,
    randomRange: quakecRandomRange,
    schedulePresentationResync,
    traceLine: sourceTraceLine ? traceProjectileLine : undefined,
    onExplosion: (event) => {
      onExplosion?.({
        flavor: event.flavor,
        origin: event.origin,
        radiusUnits: event.radiusUnits,
      });
    },
  });
  const enemyMovement = createQuakeEnemyMovementRuntime({
    collisionEpsilon: QUAKE_SHOOTABLE_COLLISION_EPSILON,
    contentsAt,
    contentsSolid: QUAKE_CONTENTS_SOLID,
    enemyTickMs: QUAKE_ENEMY_TICK_MS,
    floorAt,
    hasLineOfSight,
    leafIndexAt,
    markTrace: markShootableTrace,
    nextRandom: nextEnemyRandom,
    playerMovementBounds: quakecPlayerDamageBounds,
    shootableCollisionWorldBounds,
    shootableEyeOrigin,
    syncShootableTransform,
  });
  const enemyLoop = createQuakeEnemyLoop({
    dtClampSeconds: QUAKE_ENEMY_DT_CLAMP,
    enemies: enemyStates,
    getPlayerOrigin,
    hasLiveEnemies,
    hasProjectiles: () => enemyProjectiles.activeCount() > 0,
    enemiesFrozen: () => enemiesFrozen?.() === true,
    isPaused: isGameplayPaused,
    projectiles: enemyProjectiles.projectiles,
    runtimeEnabled: monsterRuntimeEnabled,
    tickMs: QUAKE_ENEMY_TICK_MS,
    updateEnemies: updateEnemiesForLoop,
    updateProjectiles: enemyProjectiles.update,
  });

  function enemyAnimationPresentationEnabled(): boolean {
    return enemyAnimationsEnabled?.() !== false;
  }

  function ambientMonsterPathingEnabled(): boolean {
    return sourceAmbientMonsterPathingEnabled?.() === true ||
      combatBudget.expandedLogicalCombatEnabled();
  }

  function enemyAttackRuntimeEnabled(): boolean {
    return enemyAttacksEnabled?.() !== false;
  }

  const enemyCombat = createQuakeEnemyCombatRuntime({
    damagePlayer,
    getPlayerOrigin,
    hasLineOfSight,
    isGameplayPaused,
    isVisible: presentation.isVisible,
    markTrace: markShootableTrace,
    nextRandom: nextQuakecRandom,
    playerDamageBounds: quakecPlayerDamageBounds,
    playSound,
    randomRange: quakecRandomRange,
    shootableBoundsForDamage: shootableCollisionWorldBounds,
    shootableEyeOrigin,
    spawnProjectile: enemyProjectiles.spawn,
    syncEnemyDatasets: syncShootableEnemyDatasets,
  });
  const deathState = createQuakeShootableDeathStateRuntime({
    activateAnimationFrame: activateShootableAnimationFrame,
    animationProfile: quakeMonsterAnimationProfile,
    boundedAnimationRange,
    chainDurationMs: quakeMonsterChainDurationMs,
    clearAttackState: clearEnemyAttackState,
    countHandles: countShootableHandles,
    hasHandle: presentation.hasHandle,
    destroyZombieGib: (shootable, context) => destroy(shootable.entity.index, context),
    dropBackpack,
    flashShootable: presentation.flash,
    isScriptedBoss: (classname) => Boolean(quakeBossScriptedLifecycle(classname)),
    markTrace: markShootableTrace,
    nextRandom: nextQuakecRandom,
    playPainAnimation: playEnemyPainAnimation,
    playQuakecSound: enemyCombat.playQuakecSound,
    spawnDeathOutputVisuals: spawnMonsterDeathOutputVisuals,
    startQuakecNamedChain: startEnemyQuakecNamedChain,
    startQuakecOneShotDeath: (shootable, now) => startEnemyQuakecOneShotAnimation(shootable, "death", now),
    stateOffsetMs: quakeMonsterStateOffsetMs,
    syncLifecycleClasses: syncShootableLifecycleClassesForShootable,
  });
  const progressRuntime = createQuakeShootablesProgressRuntime({
    clearAttackState: clearEnemyAttackState,
    clearDeathOutputHandles,
    clearDeathTimers,
    clearEnemyRuntime,
    destroyedEntityIndexes: () => destroyedEntityIndexes,
    leafIndexAt,
    markVisibilitySelectionDirty: () => {
      lastVisibilitySelectionKey = "";
    },
    removeHandles: removeShootableHandles,
    resetEnemyRuntime: resetShootableEnemyRuntime,
    resetPrewarm: () => prewarmQueues.reset(),
    replaceDestroyedEntityIndexes: (indexes) => {
      destroyedEntityIndexes = indexes;
    },
    shootables: () => shootables.values(),
    stopEnemyLoop,
    syncEnemyDatasets: syncShootableEnemyDatasets,
    syncLifecycleClasses: syncShootableLifecycleClassesForShootable,
    syncMonsterRuntime,
    syncTransform: syncShootableTransform,
  });

  function clear(): void {
    stopEnemyLoop();
    prewarmQueues.reset();
    clearDeathTimers();
    enemyCombat.clear();
    clearDeathOutputHandles();
    for (const shootable of shootables.values()) removeShootableHandles(shootable);
    shootables = createQuakeShootableStateMap();
    destroyedEntityIndexes = new Set();
    enemyProjectiles.clear();
    combatBudget.reset();
    debugEnemyTickFilter = null;
    mountedEnemyAcquisitionVisibilityCache.clear();
    mountedEnemySightEntity = null;
    currentModelLibrary = null;
    monsterPathCornersByTargetname = new Map();
    monsterJumpTriggers = [];
    enemyLoop.resetPause();
    visibilityChurn = createQuakeShootablesVisibilityChurnStats();
    lastVisibilitySelectionKey = "";
    lastMotionMaterialForward = null;
    lastMotionMaterialOrigin = null;
  }

  function clearDeathTimers(): void {
    for (const timer of deathTimers) window.clearTimeout(timer);
    deathTimers = [];
  }

  function clearDeathOutputHandles(): void {
    if (deathOutputAnimationFrame !== null) {
      window.cancelAnimationFrame(deathOutputAnimationFrame);
      deathOutputAnimationFrame = null;
    }
    activeDeathOutputAnimations.clear();
    for (const output of deathOutputHandles) {
      output.handle.remove();
    }
    visibilityChurn.totalMeshHandlesRemoved += deathOutputHandles.length;
    deathOutputHandles = [];
  }

  function spawn(
    entities: QuakeEntity[],
    modelLibrary: QuakePickupModelLibrary | null,
    programMetadata: QuakeProgramMetadata | null = null,
  ): void {
    clear();
    currentModelLibrary = modelLibrary;
    destroyedEntityIndexes = new Set();
    monsterPathCornersByTargetname = buildQuakeMonsterPathCornerIndex(entities, pointToPoly);
    const enemySeedSalt = quakeEnemyRandomSaltValue(enemyRandomSalt);
    resetQuakecRandomStream(enemySeedSalt);
    for (const entity of entities) {
      if (!entity.origin || !shouldSpawn(entity)) continue;
      const modelPath = quakeShootableModelPath(entity, programMetadata);
      if (!modelPath) continue;
      const model = modelLibrary?.models[modelPath];
      if (!model && isRequiredShootableModel(entity, modelPath)) {
        throw missingRequiredShootableModelError(entity, modelPath);
      }
      if (!model && !canUseShootableFallback(entity)) continue;
      const bounds = shootableLocalBounds(entity, model);
      const spawnProfile = quakeMonsterSpawnProfileForEntity(entity);
      const collisionBounds = shootableCollisionBounds(entity, bounds, spawnProfile);
      const origin = groundedQuakeMonsterOrigin({
        bounds: collisionBounds,
        entity,
        floorAt,
        mode: "spawn",
        origin: pointToPoly(entity.origin),
        spawnProfile,
      });
      const yaw = entity.angle ?? quakeEntityNumber(entity, "angle", 0);
      const movetarget = quakeInitialMonsterMovetarget(entity, monsterPathCornersByTargetname);
      shootables.set(entity.index, {
        entity,
        origin,
        leafIndex: leafIndexAt(origin),
        model,
        collisionBounds,
        bounds,
        lastMountCandidateAt: Number.NEGATIVE_INFINITY,
        yaw,
        health: shootableHealth(entity),
        dead: false,
        ...(quakeMonsterUsesEnemyRuntime(entity)
          ? {
            enemy: createEnemyState(
              entity.index,
              createMonsterStateRunner?.(entity.classname) ?? null,
              movetarget,
              enemySeedSalt,
              quakeMonsterInitialIdealYaw(entity, origin, movetarget),
            ),
          }
          : {}),
      });
    }
    if (monsterRuntimeEnabled() && hasLiveEnemies()) startEnemyLoop();
  }

  function setupMonsterJumpTriggers(
    entities: QuakeEntity[],
    models: QuakePreparedModel[],
    pivot: QuakeVertex,
    gameLogic: QuakeGameLogicFacts | null = null,
  ): void {
    monsterJumpTriggers = createQuakeMonsterJumpTriggers(entities, models, pivot, gameLogic);
  }

  function syncMonsterRuntime(): void {
    if (!monsterRuntimeEnabled()) {
      clearEnemyRuntime();
      stopEnemyLoop();
      return;
    }
    if (!enemyAttackRuntimeEnabled()) clearEnemyAttackRuntime();
    if (hasLiveEnemies() || enemyProjectiles.activeCount() > 0) startEnemyLoop();
  }

  function clearEnemyRuntime(): void {
    clearEnemyAttackRuntime();
  }

  function clearEnemyAttackRuntime(): void {
    for (const shootable of shootables.values()) clearEnemyAttackState(shootable);
    enemyProjectiles.clear();
    enemyCombat.clear();
  }

  function has(entityIndex: number): boolean {
    const shootable = shootables.get(entityIndex);
    return Boolean(shootable && !shootable.dead && !isZombieNonSolid(shootable));
  }

  function activate(entityIndex: number, options: QuakeShootableActivationOptions = {}): boolean {
    const shootable = shootables.get(entityIndex);
    if (!shootable || shootable.dead) return false;
    const lifecycle = quakeBossScriptedLifecycle(shootable.entity.classname);
    if (lifecycle) return activateBoss(shootable, lifecycle, options);
    return activateMonsterUse(shootable);
  }

  function activateMonsterUse(shootable: QuakeShootableState): boolean {
    const enemy = shootable.enemy;
    if (!enemy || !shootable.entity.classname.startsWith("monster_")) return false;
    if (shootable.health <= 0) return false;
    if (isPlayerInvisible?.()) {
      markShootableTrace("enemy-use-blocked", shootable, { reason: "invisibility" });
      return false;
    }
    if (enemy.awake) return true;

    const now = performance.now();
    enemy.awake = true;
    enemy.currentTarget = playerEnemyTargetReference();
    recordShootableCombatInterest(shootable, now);
    enemy.quakecIdealYaw = quakeYawToOrigin(shootable.origin, getPlayerOrigin());
    enemy.animationMode = "idle";
    enemy.animationLockUntil = Math.max(enemy.animationLockUntil, now + QUAKE_MONSTER_USE_FOUND_TARGET_DELAY_MS);
    enemy.nextAttackAt = Math.max(enemy.nextAttackAt, now + QUAKE_MONSTER_USE_ATTACK_DELAY_MS);
    playEnemySightSound(shootable, "use", now);
    syncShootableEnemyDatasets(shootable);
    markShootableTrace("enemy-use", shootable, {
      nextAttackMs: enemy.nextAttackAt - now,
      nextThinkMs: QUAKE_MONSTER_USE_FOUND_TARGET_DELAY_MS,
    });
    if (monsterRuntimeEnabled()) startEnemyLoop();
    return true;
  }

  function activateBoss(
    shootable: QuakeShootableState,
    lifecycle: QuakeMonsterScriptedLifecycle,
    options: QuakeShootableActivationOptions,
  ): boolean {
    if (lifecycle.kind !== "boss") return false;
    shootable.health = quakeBossHealthForSkill(lifecycle, options.skill);
    const enemy = shootable.enemy;
    if (enemy) {
      enemy.awake = true;
      enemy.currentTarget = playerEnemyTargetReference();
      enemy.quakecPainChain = null;
      startEnemyQuakecNamedChain(shootable, "rise", "idle", performance.now());
    }
    markShootableTrace("boss-awake", shootable, {
      health: shootable.health,
      skill: quakeBossSkillKey(options.skill),
    });
    return true;
  }

  function triggerBossLightning(options: QuakeShootableActivationOptions = {}): boolean {
    const boss = quakeLiveScriptedBoss();
    if (!boss) return false;
    const lifecycle = quakeBossScriptedLifecycle(boss.entity.classname);
    if (!lifecycle) return false;
    const enemy = boss.enemy;
    if (!enemy?.awake) return false;
    if (!bossLightningElectrodesReady?.(lifecycle.lightning.electrodeTargetName, lifecycle.lightning.alignment)) {
      markShootableTrace("boss-lightning-not-aligned", boss, {
        target: lifecycle.lightning.electrodeTargetName,
      });
      return false;
    }

    bossLightningDischarge?.(lifecycle.lightning.electrodeTargetName, lifecycle.lightning);
    if (lifecycle.lightning.soundPath) {
      playSound?.(lifecycle.lightning.soundPath, { volume: 1 });
    }
    if (boss.health > 0 && lifecycle.lightning.painSoundPath) {
      playSound?.(lifecycle.lightning.painSoundPath, { volume: 1 });
    }
    boss.health -= Math.max(0, lifecycle.lightning.damagePerUse);
    const branch = quakeBossPainBranchForHealth(lifecycle, boss.health);
    if (branch) {
      const chain = quakeBossRuntimeChainName(boss, branch.chain);
      enemy.quakecPainChain = chain;
      startEnemyQuakecNamedChain(boss, chain, "pain", performance.now());
    }
    markShootableTrace("boss-lightning", boss, {
      health: boss.health,
      skill: quakeBossSkillKey(options.skill),
      chain: branch?.chain ?? null,
      killed: boss.health <= 0,
    });
    if (boss.health <= 0) {
      return destroy(boss.entity.index);
    }
    return true;
  }

  function quakeLiveScriptedBoss(): QuakeShootableState | null {
    for (const shootable of shootables.values()) {
      if (shootable.dead) continue;
      if (quakeBossScriptedLifecycle(shootable.entity.classname)) return shootable;
    }
    return null;
  }

  function damage(entityIndex: number, amount: number, context: QuakeShootableDamageContext = {}): boolean {
    const shootable = shootables.get(entityIndex);
    if (!shootable || shootable.dead) return false;
    const now = performance.now();
    const damageAmount = Math.max(0, amount);
    const damageContext = normalizeShootableDamageContext(context);
    recordShootableCombatInterest(shootable, now);
    if (quakeBossScriptedLifecycle(shootable.entity.classname)) {
      markShootableTrace("boss-damage-ignored", shootable, {
        amount: damageAmount,
        attacker: damageActorTraceLabel(damageContext.attacker),
      });
      return false;
    }
    if (shootable.entity.classname === "monster_zombie" && shootable.enemy) {
      applyShootableDamageRetarget(shootable, damageContext, now);
      return deathState.damageZombie(shootable, damageAmount, now);
    }
    shootable.health -= damageAmount;
    markShootableTrace("shootable-damage", shootable, {
      amount: damageAmount,
      attacker: damageActorTraceLabel(damageContext.attacker),
      health: shootable.health,
      inflictor: damageActorTraceLabel(damageContext.inflictor),
      killed: shootable.health <= 0,
    });
    if (shootable.health > 0) {
      applyShootableDamageRetarget(shootable, damageContext, now);
      playEnemyPainAnimation(shootable, now, damageAmount);
      presentation.flash(shootable);
      return true;
    }
    applyShootableKilledTarget(shootable, damageContext);
    return destroy(entityIndex, damageContext);
  }

  function normalizeShootableDamageContext(context: QuakeShootableDamageContext): Required<Pick<
    QuakeShootableDamageContext,
    "attacker" | "inflictor"
  >> & QuakeShootableDamageContext {
    const attacker = context.attacker ?? playerDamageActor();
    return {
      ...context,
      attacker,
      inflictor: context.inflictor ?? attacker,
    };
  }

  function applyShootableDamageRetarget(
    shootable: QuakeShootableState,
    context: Required<Pick<QuakeShootableDamageContext, "attacker" | "inflictor">> & QuakeShootableDamageContext,
    now: number,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy) return;
    const decision = quakeDamageRetargetDecision({
      attacker: context.attacker,
      currentEnemy: enemy.currentTarget,
      target: {
        classname: shootable.entity.classname,
        entityIndex: shootable.entity.index,
        monster: shootable.entity.classname.startsWith("monster_"),
      },
    });
    markShootableTrace("enemy-damage-retarget-check", shootable, {
      attacker: damageActorTraceLabel(context.attacker),
      currentTarget: enemyTargetTraceLabel(enemy.currentTarget),
      reason: decision.reason,
      retarget: decision.retarget,
    });
    if (!decision.retarget || !decision.target) return;
    if (decision.preserveOldEnemy && enemy.currentTarget) {
      enemy.oldTarget = enemy.currentTarget;
    }
    enemy.currentTarget = decision.target;
    applyFoundTargetLikeDamageWake(shootable, decision.target, now);
  }

  function applyShootableKilledTarget(
    shootable: QuakeShootableState,
    context: Required<Pick<QuakeShootableDamageContext, "attacker" | "inflictor">> & QuakeShootableDamageContext,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy) return;
    enemy.currentTarget = damageActorTargetReference(context.attacker);
    markShootableTrace("enemy-damage-killed-target", shootable, {
      attacker: damageActorTraceLabel(context.attacker),
      target: enemyTargetTraceLabel(enemy.currentTarget),
    });
  }

  function applyFoundTargetLikeDamageWake(
    shootable: QuakeShootableState,
    target: QuakeEnemyTargetReference,
    now: number,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy) return;
    const targetOrigin = enemyTargetOrigin(target) ?? getPlayerOrigin();
    enemy.awake = true;
    enemy.quakecIdealYaw = quakeYawToOrigin(shootable.origin, targetOrigin);
    playEnemySightSound(shootable, "damage-retarget", now);
    const profile = enemyCombatProfile(shootable);
    const wakeDelayMs = profile
      ? quakeEnemyWakeDelayMs(enemyCombat, profile, enemy)
      : QUAKE_MONSTER_HUNT_TARGET_ATTACK_DELAY_MS;
    enemy.nextAttackAt = Math.max(enemy.nextAttackAt, now + wakeDelayMs);
    clearQuakecMovementBudget(enemy);
    recordShootableCombatInterest(shootable, now);
    syncShootableEnemyDatasets(shootable);
    if (monsterRuntimeEnabled()) startEnemyLoop();
    markShootableTrace("enemy-damage-retarget", shootable, {
      nextAttackMs: enemy.nextAttackAt - now,
      target: enemyTargetTraceLabel(target),
    });
  }

  function playerDamageActor(): QuakeDamageActorReference {
    return { classname: "player", id: "player", kind: "player" };
  }

  function shootableDamageActor(shootable: QuakeShootableState): QuakeDamageActorReference {
    return {
      classname: shootable.entity.classname,
      entityIndex: shootable.entity.index,
      id: shootable.entity.index,
      kind: "shootable",
      origin: shootable.origin,
    };
  }

  function damageActorTargetReference(actor: QuakeDamageActorReference): QuakeEnemyTargetReference | null {
    if (actor.kind === "player") return playerEnemyTargetReference();
    if (actor.kind === "shootable") {
      return {
        classname: actor.classname,
        entityIndex: actor.entityIndex,
        id: actor.entityIndex,
        kind: "shootable",
      };
    }
    return null;
  }

  function playerEnemyTargetReference(): QuakeEnemyTargetReference {
    return { classname: "player", id: "player", kind: "player" };
  }

  function enemyTargetOrigin(target: QuakeEnemyTargetReference): Vec3 | null {
    if (target.kind === "player") return getPlayerOrigin();
    const shootable = target.entityIndex === undefined ? null : shootables.get(target.entityIndex);
    if (!shootable || shootable.dead || shootable.health <= 0) return null;
    return shootable.origin;
  }

  function playEnemySightSound(
    shootable: QuakeShootableState,
    reason: string,
    now: number,
  ): boolean {
    const soundPath = quakeMonsterSightSoundPath(shootable.entity.classname);
    if (!soundPath) return false;
    const played = playSound?.(soundPath, { volume: 1 }) ?? false;
    markShootableTrace("enemy-sight-sound", shootable, {
      played,
      reason,
      sound: soundPath,
      time: now,
    });
    return played;
  }

  function damageActorTraceLabel(actor: QuakeDamageActorReference): string {
    return actor.kind === "shootable" ? `${actor.classname}:${actor.entityIndex}` : actor.kind;
  }

  function enemyTargetTraceLabel(target: QuakeEnemyTargetReference | null): string | null {
    if (!target) return null;
    return target.kind === "shootable" ? `${target.classname}:${target.entityIndex}` : target.kind;
  }

  function destroy(entityIndex: number, context: QuakeShootableDamageContext = {}): boolean {
    const shootable = shootables.get(entityIndex);
    if (!shootable || shootable.dead) return false;
    shootable.dead = true;
    destroyedEntityIndexes.add(entityIndex);
    onDestroyed?.(shootable.entity);
    emitShootableDeathExplosion(shootable);
    applyShootableDeathRadiusDamage(shootable, context);
    clearEnemyAttackState(shootable);
    const deathAnimationMs = deathState.playDeathAnimation(shootable, performance.now());
    markShootableTrace("shootable-destroy", shootable);
    syncShootableLifecycleClassesForShootable(shootable);
    if (deathState.isPersistentCorpse(shootable)) {
      if (deathAnimationMs === null) {
        deathState.finalizeCorpse(shootable);
      } else {
        const timer = window.setTimeout(() => {
          deathState.finalizeCorpse(shootable);
          deathTimers = deathTimers.filter((item) => item !== timer);
        }, deathAnimationMs);
        deathTimers.push(timer);
      }
      if (shootable.entity.properties.target) fireTarget(shootable.entity.properties.target, shootable.entity.index);
      return true;
    }
    if (deathState.isGibbed(shootable)) {
      removeShootableHandles(shootable);
      shootables.delete(entityIndex);
      if (shootable.entity.properties.target) fireTarget(shootable.entity.properties.target, shootable.entity.index);
      return true;
    }
    if (!presentation.hasHandle(shootable)) {
      shootables.delete(entityIndex);
      if (shootable.entity.properties.target) fireTarget(shootable.entity.properties.target, shootable.entity.index);
      return true;
    }
    const timer = window.setTimeout(() => {
      removeShootableHandles(shootable);
      shootables.delete(entityIndex);
      deathTimers = deathTimers.filter((item) => item !== timer);
    }, deathAnimationMs ?? QUAKE_SHOOTABLE_DEATH_DELAY_MS);
    deathTimers.push(timer);
    if (shootable.entity.properties.target) fireTarget(shootable.entity.properties.target, shootable.entity.index);
    return true;
  }

  function firstMonsterOverlappingBounds(bounds: QuakeShootableBounds): number | null {
    const queryBounds = inflateBounds(bounds, QUAKE_SHOOTABLE_COLLISION_EPSILON);
    for (const shootable of shootables.values()) {
      if (!isLiveMonsterBlocker(shootable)) continue;
      if (aabbsOverlap(queryBounds, shootableCollisionWorldBounds(shootable))) return shootable.entity.index;
    }
    return null;
  }

  function pushMonsterBlockers(bounds: QuakeShootableBounds, delta: Vec3): number | null {
    const queryBounds = inflateBounds(bounds, QUAKE_SHOOTABLE_COLLISION_EPSILON);
    const pushed: Array<{ leafIndex: number | undefined; origin: Vec3; shootable: QuakeShootableState }> = [];
    for (const shootable of shootables.values()) {
      if (!isLiveMonsterBlocker(shootable)) continue;
      if (!aabbsOverlap(queryBounds, shootableCollisionWorldBounds(shootable))) continue;
      const previousOrigin = [...shootable.origin] as Vec3;
      const previousLeafIndex = shootable.leafIndex;
      if (!tryPushMonsterBlocker(shootable, queryBounds, delta)) {
        rollbackPushedMonsterBlockers(pushed);
        return shootable.entity.index;
      }
      pushed.push({ leafIndex: previousLeafIndex, origin: previousOrigin, shootable });
    }
    return null;
  }

  function tryPushMonsterBlocker(shootable: QuakeShootableState, queryBounds: QuakeBounds, delta: Vec3): boolean {
    if (distanceSq3(delta, [0, 0, 0]) <= COLLISION_EPSILON) return false;
    const nextOrigin: Vec3 = [
      shootable.origin[0] + delta[0],
      shootable.origin[1] + delta[1],
      shootable.origin[2] + delta[2],
    ];
    if (aabbsOverlap(queryBounds, shootableCollisionWorldBoundsAt(shootable, nextOrigin))) return false;
    const from = shootableEyeOrigin(shootable);
    const to: Vec3 = [from[0] + delta[0], from[1] + delta[1], from[2] + delta[2]];
    if (!hasLineOfSight(from, to)) return false;
    if (!monsterPushDestinationClear(shootable, nextOrigin)) return false;
    shootable.origin = nextOrigin;
    shootable.leafIndex = leafIndexAt(nextOrigin);
    syncShootableTransform(shootable);
    markShootableTrace("monster-pushed-by-mover", shootable, {
      dx: delta[0],
      dy: delta[1],
      dz: delta[2],
    });
    return true;
  }

  function monsterPushDestinationClear(shootable: QuakeShootableState, origin: Vec3): boolean {
    if (!contentsAt) return true;
    const bounds = shootableCollisionWorldBoundsAt(shootable, origin);
    const mid: Vec3 = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];
    const samples: Vec3[] = [
      mid,
      [bounds.min[0], bounds.min[1], mid[2]],
      [bounds.min[0], bounds.max[1], mid[2]],
      [bounds.max[0], bounds.min[1], mid[2]],
      [bounds.max[0], bounds.max[1], mid[2]],
      [mid[0], mid[1], bounds.min[2] + QUAKE_SHOOTABLE_COLLISION_EPSILON],
      [mid[0], mid[1], bounds.max[2] - QUAKE_SHOOTABLE_COLLISION_EPSILON],
    ];
    return samples.every((point) => contentsAt(point) !== QUAKE_CONTENTS_SOLID);
  }

  function rollbackPushedMonsterBlockers(
    pushed: Array<{ leafIndex: number | undefined; origin: Vec3; shootable: QuakeShootableState }>,
  ): void {
    for (let index = pushed.length - 1; index >= 0; index--) {
      const item = pushed[index];
      item.shootable.origin = item.origin;
      item.shootable.leafIndex = item.leafIndex;
      syncShootableTransform(item.shootable);
    }
  }

  function emitShootableDeathExplosion(shootable: QuakeShootableState): void {
    const radiusDamage = quakeShootableDeathRadiusDamage(shootable.entity.classname);
    if (!radiusDamage) return;
    onExplosion?.({
      classname: shootable.entity.classname,
      entityIndex: shootable.entity.index,
      flavor: "explobox",
      origin: shootableDeathExplosionOrigin(shootable),
      radiusUnits: radiusDamage.radiusUnits,
    });
  }

  function shootableDeathExplosionOrigin(shootable: QuakeShootableState): Vec3 {
    if (shootable.entity.classname === "misc_explobox" || shootable.entity.classname === "misc_explobox2") {
      // QuakeC barrel_explode raises self.origin_z by 32 before BecomeExplosion.
      return [
        shootable.origin[0],
        shootable.origin[1],
        shootable.origin[2] + QUAKE_EXPLOBOX_BECOME_EXPLOSION_Z_OFFSET,
      ];
    }
    return shootableFloorOrigin(shootable);
  }

  function shootableFloorOrigin(shootable: QuakeShootableState): Vec3 {
    return [
      shootable.origin[0],
      shootable.origin[1],
      shootable.origin[2] + shootable.bounds.min[2],
    ];
  }

  function applyShootableDeathRadiusDamage(
    source: QuakeShootableState,
    context: QuakeShootableDamageContext,
  ): void {
    const radiusDamage = quakeShootableDeathRadiusDamage(source.entity.classname);
    if (!radiusDamage) return;
    const visited = context.radiusVisited ?? new Set<number>();
    if (visited.has(source.entity.index)) return;
    visited.add(source.entity.index);
    const sourceActor = shootableDamageActor(source);
    const radius = quakecScaleUnits(radiusDamage.radiusUnits);
    const origin = source.origin;

    applyShootableRadiusDamageToPlayer(source, radiusDamage, origin, radius);
    for (const target of [...shootables.values()]) {
      if (target.dead || target.entity.index === source.entity.index) continue;
      if (visited.has(target.entity.index)) continue;
      const damageAmount = quakeShootableRadiusDamageAmount(radiusDamage, origin, target);
      if (damageAmount <= 0) continue;
      markShootableTrace("shootable-radius-damage", target, {
        amount: damageAmount,
        radiusSource: source.entity.index,
      });
      damage(target.entity.index, damageAmount, {
        attacker: sourceActor,
        inflictor: sourceActor,
        radiusVisited: visited,
      });
    }
  }

  function applyShootableRadiusDamageToPlayer(
    source: QuakeShootableState,
    radiusDamage: QuakeShootableRadiusDamageFact,
    origin: Vec3,
    radius: number,
  ): boolean {
    const playerOrigin = getPlayerOrigin();
    const playerBounds = quakecPlayerDamageBounds(playerOrigin);
    const playerCenter = quakecBoundsCenter(playerBounds);
    const distanceSq = distanceSq3(origin, playerCenter);
    if (distanceSq > radius * radius) return false;
    if (radiusDamage.requiresCanDamage && !quakecCanDamageTargetOrigin(origin, quakecPlayerEntityOrigin(playerOrigin))) {
      return false;
    }
    const damageAmount = quakeRadiusDamageAmount(radiusDamage, distanceSq, 1);
    if (damageAmount <= 0) return false;
    const damaged = damagePlayer(damageAmount, { inflictorOrigin: origin });
    markShootableTrace("shootable-radius-player-damage", source, {
      amount: damageAmount,
      hit: damaged,
    });
    return damaged;
  }

  function quakeShootableRadiusDamageAmount(
    radiusDamage: QuakeShootableRadiusDamageFact,
    origin: Vec3,
    target: QuakeShootableState,
  ): number {
    const targetBounds = shootableCollisionWorldBounds(target);
    const targetCenter = quakecBoundsCenter(targetBounds);
    const radius = quakecScaleUnits(radiusDamage.radiusUnits);
    const distanceSq = distanceSq3(origin, targetCenter);
    if (distanceSq > radius * radius) return 0;
    if (radiusDamage.requiresCanDamage && !quakecCanDamageTargetOrigin(origin, target.origin)) return 0;
    const classnameScale = target.entity.classname === "monster_shambler" ? radiusDamage.shamblerScale : 1;
    return quakeRadiusDamageAmount(radiusDamage, distanceSq, classnameScale);
  }

  function quakecCanDamageTargetOrigin(start: Vec3, targetOrigin: Vec3): boolean {
    return quakecCanDamageAnyTracePointClear(
      start,
      quakecCanDamageTracePointsForRuntimeOrigin(targetOrigin),
      hasLineOfSight,
    );
  }

  function quakecPlayerEntityOrigin(playerOrigin: [number, number, number] | Vec3): Vec3 {
    const eyeHeight = Math.max(getPlayerEyeHeight(), PLAYER_HEIGHT);
    return [
      playerOrigin[0],
      playerOrigin[1],
      playerOrigin[2] - eyeHeight - QUAKE_PLAYER_MINS_Z,
    ];
  }

  function resolvePlayerCollision(
    result: QuakeCollisionResult,
    previous: [number, number, number],
    eyeHeight: number,
    validateOrigin?: QuakeShootableCollisionOriginValidator,
  ): QuakeCollisionResult {
    let origin = result.origin;
    for (const shootable of shootables.values()) {
      if (shootable.dead) continue;
      if (isZombieNonSolid(shootable)) continue;
      if (!playerOverlapsShootable(origin, eyeHeight, shootable)) continue;
      const pushed = pushPlayerOutOfShootable(origin, previous, shootable, validateOrigin);
      if (distanceSq3(pushed, origin) <= COLLISION_EPSILON) continue;
      origin = pushed;
    }
    return origin === result.origin
      ? result
      : { ...result, origin };
  }

  function* weaponTargets(): Iterable<QuakeWeaponShootableTarget> {
    combatBudget.recordWeaponTargetQuery();
    const expandedLogicalCombat = combatBudget.expandedLogicalCombatEnabled();
    const playerOrigin = expandedLogicalCombat ? getPlayerOrigin() : null;
    let logicalWeaponTargetsYielded = 0;
    for (const shootable of shootables.values()) {
      combatBudget.recordWeaponTargetCandidate();
      if (!shouldYieldWeaponTarget(shootable, playerOrigin, logicalWeaponTargetsYielded)) continue;
      if (!presentation.hasHandle(shootable) || !presentation.isVisible(shootable)) logicalWeaponTargetsYielded++;
      combatBudget.recordWeaponTargetYield();
      yield {
        entity: shootable.entity,
        dead: shootable.dead || isZombieNonSolid(shootable),
        origin: shootable.origin,
        bounds: shootableCollisionWorldBounds(shootable),
      };
    }
  }

  function shouldYieldWeaponTarget(
    shootable: QuakeShootableState,
    playerOrigin: [number, number, number] | null,
    logicalWeaponTargetsYielded: number,
  ): boolean {
    if (presentation.hasHandle(shootable) && presentation.isVisible(shootable)) return true;
    if (!playerOrigin || !isLiveLogicalWeaponTarget(shootable)) return false;
    if (logicalWeaponTargetsYielded >= QUAKE_COMBAT_BUDGET_LIMITS.combatInterestSet) return false;
    if (!isEventBoundLogicalWeaponTarget(shootable, playerOrigin)) return false;
    combatBudget.recordCombatInterest(shootable.entity.index);
    return true;
  }

  function isEventBoundLogicalWeaponTarget(
    shootable: QuakeShootableState,
    playerOrigin: [number, number, number],
  ): boolean {
    if (distanceSq3(playerOrigin, shootable.origin) > QUAKE_SHOOTABLE_MOUNT_DISTANCE_SQ) return false;
    return isShootableInFrontOfCameraNearPlane(shootable, playerOrigin);
  }

  function isLiveLogicalWeaponTarget(shootable: QuakeShootableState): boolean {
    return Boolean(shootable.enemy) &&
      !shootable.dead &&
      shootable.health > 0 &&
      !isZombieNonSolid(shootable);
  }

  function snapshotProgress(): QuakeShootablesProgressSnapshot {
    return progressRuntime.snapshot();
  }

  function restoreProgress(snapshot: QuakeShootablesProgressSnapshot): void {
    progressRuntime.restore(snapshot);
  }

  function debugStats(): QuakeShootablesDebugStats {
    return quakeShootablesDebugStats({
      animationFramePrewarmQueue: prewarmQueues.animationFrameQueueLength(),
      combatBudget: combatBudget.debugStats(),
      desiredPrewarm: prewarmQueues.desiredCount(),
      prewarmQueue: prewarmQueues.prewarmQueueLength(),
      shootables: shootables.values(),
      visibilityChurn,
      visibilitySnapshot: shootableVisibilitySnapshot(),
    });
  }

  function debugCanDamageTrace(start: Vec3, tracePoints: readonly QuakeCanDamageTracePoint[]): QuakeCanDamageResult {
    combatBudget.beginFrame(performance.now());
    return quakecCanDamageFromTracePoints(start, tracePoints, hasLineOfSight);
  }

  function debugEnemyAcquisition(
    entityIndex: number,
    playerSourceOrigin: { x: number; y: number; z: number },
    options: QuakeShootableEnemyAcquisitionDebugOptions = {},
  ): QuakeShootableEnemyAcquisitionDebugResult | null {
    const shootable = shootables.get(entityIndex);
    if (!shootable?.enemy || shootable.dead || shootable.health <= 0) return null;
    const playerOrigin = pointToPoly(playerSourceOrigin);
    const playerViewOffset: Vec3 = [0, 0, QUAKE_PLAYER_VIEW_Z];
    const monsterViewOffset: Vec3 = [0, 0, QUAKE_WALKMONSTER_VIEW_Z];
    const now = performance.now();
    let lineOfSightCalls = 0;
    combatBudget.beginFrame(now);
    const decision = quakeEnemyFindTarget({
      checkClient: {
        classname: "player",
        health: 100,
        id: "player",
        inPvs: true,
        origin: playerOrigin,
        viewOffset: playerViewOffset,
      },
      hasLineOfSight: (start, end) => {
        lineOfSightCalls++;
        return sourceHasLineOfSight(start, end);
      },
      monster: {
        classname: shootable.entity.classname,
        id: shootable.entity.index,
        origin: shootable.origin,
        spawnflags: quakeEntityNumber(shootable.entity, "spawnflags", 0),
        viewOffset: monsterViewOffset,
        yaw: options.monsterYaw ?? shootable.yaw,
      },
      nowSeconds: options.nowSeconds ?? now / 1000,
      sourceUnitScale: QUAKE_COLLISION_UNIT_SCALE,
      trySpendLineOfSightCheck: () => combatBudget.tryRecordLineOfSightCheck(performance.now()),
    });
    return {
      decision,
      lineOfSightCalls,
      monster: {
        classname: shootable.entity.classname,
        entityIndex: shootable.entity.index,
        origin: [...shootable.origin] as Vec3,
        viewOffset: monsterViewOffset,
        yaw: options.monsterYaw ?? shootable.yaw,
      },
      player: {
        origin: playerOrigin,
        viewOffset: playerViewOffset,
      },
    };
  }

  function mountedEnemyAcquisitionDecision(
    shootable: QuakeShootableState,
    playerEyeOrigin: [number, number, number],
    now: number,
  ): QuakeEnemyAcquisitionDecision {
    const playerOrigin = mountedEnemyAcquisitionPlayerOrigin(playerEyeOrigin);
    const playerViewOffset: Vec3 = [0, 0, QUAKE_PLAYER_VIEW_Z];
    const monsterViewOffset: Vec3 = [0, 0, QUAKE_WALKMONSTER_VIEW_Z];
    return quakeEnemyFindTarget({
      checkClient: {
        classname: "player",
        health: 100,
        id: "player",
        inPvs: true,
        invisible: isPlayerInvisible?.() === true,
        origin: playerOrigin,
        viewOffset: playerViewOffset,
      },
      hasLineOfSight: (start, end) => sourceHasLineOfSight(start, end),
      monster: {
        classname: shootable.entity.classname,
        id: shootable.entity.index,
        origin: shootable.origin,
        spawnflags: quakeEntityNumber(shootable.entity, "spawnflags", 0),
        viewOffset: monsterViewOffset,
        yaw: shootable.yaw,
      },
      nowSeconds: now / 1000,
      sightEntity: currentMountedEnemySightEntity(playerEyeOrigin, now / 1000),
      sourceUnitScale: QUAKE_COLLISION_UNIT_SCALE,
      trySpendLineOfSightCheck: () => combatBudget.tryRecordLineOfSightCheck(now),
      visibilityCache: mountedEnemyAcquisitionVisibilityCache,
    });
  }

  function currentMountedEnemySightEntity(
    playerEyeOrigin: [number, number, number],
    nowSeconds: number,
  ): QuakeEnemyAcquisitionSightEntity | null {
    const source = mountedEnemySightEntity;
    if (!source) return null;
    if (source.seenAtSeconds < nowSeconds - QUAKE_MONSTER_SIGHT_ENTITY_WINDOW_SECONDS) {
      mountedEnemySightEntity = null;
      return null;
    }
    const shootable = shootables.get(source.entityIndex);
    if (!shootable?.enemy || shootable.dead || shootable.health <= 0) {
      mountedEnemySightEntity = null;
      return null;
    }
    return {
      entity: mountedEnemySightEntityTarget(shootable, playerEyeOrigin),
      seenAtSeconds: source.seenAtSeconds,
    };
  }

  function mountedEnemySightEntityTarget(
    shootable: QuakeShootableState,
    playerEyeOrigin: [number, number, number],
  ): QuakeEnemyAcquisitionTarget {
    return {
      classname: shootable.entity.classname,
      enemy: mountedEnemyPlayerAcquisitionTarget(playerEyeOrigin),
      health: shootable.health,
      id: shootable.entity.index,
      origin: shootable.origin,
      viewOffset: [0, 0, QUAKE_WALKMONSTER_VIEW_Z],
    };
  }

  function mountedEnemyPlayerAcquisitionTarget(
    playerEyeOrigin: [number, number, number],
  ): QuakeEnemyAcquisitionTarget {
    return {
      classname: "player",
      health: 100,
      id: "player",
      inPvs: true,
      invisible: isPlayerInvisible?.() === true,
      origin: mountedEnemyAcquisitionPlayerOrigin(playerEyeOrigin),
      viewOffset: [0, 0, QUAKE_PLAYER_VIEW_Z],
    };
  }

  function mountedEnemyAcquisitionPlayerOrigin(playerEyeOrigin: [number, number, number]): Vec3 {
    return [
      playerEyeOrigin[0],
      playerEyeOrigin[1],
      playerEyeOrigin[2] - QUAKE_PLAYER_VIEW_Z,
    ];
  }

  function debugDamageWeaponTarget(entityIndex: number, amount: number): boolean {
    for (const target of weaponTargets()) {
      if (target.dead || target.entity.index !== entityIndex) continue;
      return damage(entityIndex, amount);
    }
    return false;
  }

  function debugCullingSnapshot(origin: [number, number, number]): QuakeShootablesDebugCullingSnapshot {
    const visibleLeaves = visibleLeavesAt(origin);
    const currentSnapshot = shootableVisibilitySnapshot();
    const candidates: Array<{ index: number; distanceSq: number }> = [];
    const corpseCandidates: Array<{ index: number; distanceSq: number }> = [];
    const prewarmCandidates: Array<{ index: number; distanceSq: number }> = [];
    const inputs = new Map<number, {
      canMount: boolean;
      canPrewarm: boolean;
      distance: number;
      distanceSq: number;
      inFrontOfCamera: boolean | null;
      inPvs: boolean | null;
      inPrewarmPvs: boolean | null;
      lineOfSightTargetCount: number | null;
      mountCandidate: boolean;
      oversizedRenderVolume: boolean;
      prewarmCandidate: boolean;
      strictMountCandidate: boolean;
      visibleTargetCount: number | null;
      visibilityGrace: boolean;
      visibilityGraceRemainingMs: number;
      withinMountDistance: boolean;
      withinPrewarmDistance: boolean;
      withinUnmountDistance: boolean;
    }>();
    const now = performance.now();
    const prewarmLeaves = prewarmLeavesAt(origin);
    const prewarmExtraLeaves = prewarmExtraLeafIndexes(visibleLeaves, prewarmLeaves);

    for (const shootable of shootables.values()) {
      const oversizedRenderVolume = isOversizedShootableRenderVolume(shootable);
      const pvsVisible = !visibleLeaves ||
        shootable.leafIndex === undefined ||
        visibleLeaves.has(shootable.leafIndex) ||
        oversizedRenderVolume;
      const prewarmLeaf = !prewarmLeaves ||
        shootable.leafIndex === undefined ||
        prewarmLeaves.has(shootable.leafIndex) ||
        oversizedRenderVolume;
      const inPvs = visibleLeaves ? pvsVisible : null;
      const inPrewarmPvs = prewarmLeaves ? prewarmLeaf : null;
      const distanceSq = distanceSq3(origin, shootable.origin);
      const distance = Math.sqrt(distanceSq);
      const usingUnmountDistance = presentation.isVisible(shootable);
      const maxDistanceSq = usingUnmountDistance ? QUAKE_SHOOTABLE_UNMOUNT_DISTANCE_SQ : QUAKE_SHOOTABLE_MOUNT_DISTANCE_SQ;
      const mountDecision = debugShootableMountDecision(shootable, origin, oversizedRenderVolume);
      const canPrewarm = canPrewarmShootableHandle(shootable);
      const isPersistentCorpse = isPersistentShootableCorpse(shootable);
      const selectionEligible = !shootable.dead || isPersistentCorpse;
      const strictMountCandidate = selectionEligible && pvsVisible && distanceSq <= maxDistanceSq && mountDecision.canMount;
      const visibilityGrace = !strictMountCandidate &&
        selectionEligible &&
        canKeepShootableMountedByVisibilityGrace(shootable, distanceSq, now);
      const mountCandidate = strictMountCandidate || visibilityGrace;
      const prewarmCandidate = !isPersistentCorpse &&
        !shootable.dead &&
        distanceSq <= QUAKE_SHOOTABLE_PREWARM_DISTANCE_SQ &&
        canPrewarmShootableForSelection(shootable, prewarmLeaf, origin);
      inputs.set(shootable.entity.index, {
        canMount: mountDecision.canMount,
        canPrewarm,
        distance,
        distanceSq,
        inFrontOfCamera: mountDecision.inFrontOfCamera,
        inPvs,
        inPrewarmPvs,
        lineOfSightTargetCount: mountDecision.lineOfSightTargetCount,
        mountCandidate,
        oversizedRenderVolume,
        prewarmCandidate,
        strictMountCandidate,
        visibleTargetCount: mountDecision.visibleTargetCount,
        visibilityGrace,
        visibilityGraceRemainingMs: visibilityGrace ? visibilityGraceRemainingMs(shootable, now) : 0,
        withinMountDistance: distanceSq <= QUAKE_SHOOTABLE_MOUNT_DISTANCE_SQ,
        withinPrewarmDistance: distanceSq <= QUAKE_SHOOTABLE_PREWARM_DISTANCE_SQ,
        withinUnmountDistance: distanceSq <= QUAKE_SHOOTABLE_UNMOUNT_DISTANCE_SQ,
      });
      if (isPersistentCorpse) {
        if (mountCandidate) corpseCandidates.push({ index: shootable.entity.index, distanceSq });
        continue;
      }
      if (shootable.dead) continue;
      if (mountCandidate) candidates.push({ index: shootable.entity.index, distanceSq });
      if (prewarmCandidate) prewarmCandidates.push({ index: shootable.entity.index, distanceSq });
    }

    candidates.sort((a, b) => a.distanceSq - b.distanceSq);
    corpseCandidates.sort((a, b) => a.distanceSq - b.distanceSq);
    prewarmCandidates.sort((a, b) => a.distanceSq - b.distanceSq);
    const desiredMountedIndexes = new Set(candidates.slice(0, QUAKE_SHOOTABLE_MAX_MOUNTED).map((candidate) => candidate.index));
    for (const candidate of corpseCandidates.slice(0, QUAKE_SHOOTABLE_MAX_MOUNTED_CORPSES)) {
      desiredMountedIndexes.add(candidate.index);
    }
    const desiredPrewarmIndexes = new Set<number>();
    for (const candidate of prewarmCandidates) {
      if (desiredMountedIndexes.has(candidate.index)) continue;
      desiredPrewarmIndexes.add(candidate.index);
      if (desiredPrewarmIndexes.size >= QUAKE_SHOOTABLE_MAX_PREWARMED) break;
    }

    return {
      visibleLeafCount: visibleLeaves?.size ?? null,
      prewarmLeafCount: prewarmLeaves?.size ?? null,
      prewarmExtraLeafCount: prewarmExtraLeaves?.size ?? null,
      visibleLeafIndexes: sortedOptionalLeafIndexes(visibleLeaves),
      prewarmLeafIndexes: sortedOptionalLeafIndexes(prewarmLeaves),
      prewarmExtraLeafIndexes: sortedOptionalLeafIndexes(prewarmExtraLeaves),
      limits: {
        mountDistance: QUAKE_SHOOTABLE_MOUNT_DISTANCE,
        unmountDistance: QUAKE_SHOOTABLE_UNMOUNT_DISTANCE,
        prewarmDistance: QUAKE_SHOOTABLE_PREWARM_DISTANCE,
        visibilityGraceMs: QUAKE_SHOOTABLE_VISIBILITY_GRACE_MS,
        maxMounted: QUAKE_SHOOTABLE_MAX_MOUNTED,
        maxMountedCorpses: QUAKE_SHOOTABLE_MAX_MOUNTED_CORPSES,
        maxPrewarmed: QUAKE_SHOOTABLE_MAX_PREWARMED,
      },
      mountedIndexes: sortedDebugIndexes(currentSnapshot.mountedIndexes),
      visibleIndexes: sortedDebugIndexes(currentSnapshot.visibleIndexes),
      prewarmedIndexes: sortedDebugIndexes(currentSnapshot.prewarmedIndexes),
      desiredMountedIndexes: sortedDebugIndexes(desiredMountedIndexes),
      desiredPrewarmIndexes: sortedDebugIndexes(desiredPrewarmIndexes),
      candidateIndexes: candidates.concat(corpseCandidates).map((candidate) => candidate.index),
      prewarmCandidateIndexes: prewarmCandidates.map((candidate) => candidate.index),
      lastVisibilitySync,
      entries: [...shootables.values()].map((shootable) => {
        const input = inputs.get(shootable.entity.index);
        const handleCount = countShootableHandles(shootable);
        const desiredMounted = desiredMountedIndexes.has(shootable.entity.index);
        const desiredPrewarmed = desiredPrewarmIndexes.has(shootable.entity.index);
        const usingUnmountDistance = presentation.isVisible(shootable);
        const blockReasons = input
          ? debugShootableBlockReasons(shootable, input, desiredMounted, desiredPrewarmed)
          : [];
        const enemy = shootable.enemy;
        const quakecState = enemy?.quakecLastState ?? null;
        const pendingAttack = enemy?.pendingAttack ?? null;
        const movetarget = enemy?.movetarget ?? null;
        return {
          entityIndex: shootable.entity.index,
          classname: shootable.entity.classname,
          modelSource: shootable.model?.source ?? null,
          origin: [shootable.origin[0], shootable.origin[1], shootable.origin[2]],
          leafIndex: shootable.leafIndex ?? null,
          enemy: Boolean(shootable.enemy),
          dead: shootable.dead,
          health: shootable.health,
          visible: presentation.isVisible(shootable),
          mounted: handleCount > 0,
          prewarmed: handleCount > 0 && !presentation.isVisible(shootable),
          inPvs: input?.inPvs ?? null,
          inPrewarmPvs: input?.inPrewarmPvs ?? null,
          pvsSource: debugShootablePvsSource(
            shootable,
            visibleLeaves,
            prewarmLeaves,
            input?.oversizedRenderVolume ?? false,
          ),
          oversizedRenderVolume: input?.oversizedRenderVolume ?? false,
          distance: input?.distance ?? 0,
          distanceSq: input?.distanceSq ?? 0,
          usingUnmountDistance,
          withinMountDistance: input?.withinMountDistance ?? false,
          withinUnmountDistance: input?.withinUnmountDistance ?? false,
          withinPrewarmDistance: input?.withinPrewarmDistance ?? false,
          inFrontOfCamera: input?.inFrontOfCamera ?? null,
          visibleTargetCount: input?.visibleTargetCount ?? null,
          lineOfSightTargetCount: input?.lineOfSightTargetCount ?? null,
          canMount: input?.canMount ?? false,
          canPrewarm: input?.canPrewarm ?? false,
          strictMountCandidate: input?.strictMountCandidate ?? false,
          visibilityGrace: input?.visibilityGrace ?? false,
          visibilityGraceRemainingMs: input?.visibilityGraceRemainingMs ?? 0,
          mountCandidate: input?.mountCandidate ?? false,
          prewarmCandidate: input?.prewarmCandidate ?? false,
          desiredMounted,
          desiredPrewarmed,
          budgetBlocked: Boolean(input?.mountCandidate && !desiredMounted),
          blockReasons,
          handleCount,
          frameHandles: presentation.frameHandleCount(shootable),
          yaw: shootable.yaw,
          animationFrame: enemy?.animationFrameIndex ?? null,
          animationMode: enemy?.animationMode ?? null,
          quakecChain: enemy?.quakecAnimationChain ?? null,
          quakecIdealYaw: enemy?.quakecIdealYaw ?? null,
          quakecMovementCall: enemy?.quakecMovementCall ?? null,
          quakecMovementHandledStep: enemy?.quakecMovementHandledStep ?? null,
          quakecMovementStateName: enemy?.quakecMovementStateName ?? null,
          quakecMovementUnitsRemaining: enemy?.quakecMovementUnitsRemaining ?? null,
          quakecPartialGround: enemy?.quakecPartialGround ?? null,
          quakecStateCalls: quakecState ? [...quakecState.calls] : [],
          quakecStateChain: quakecState?.chain ?? null,
          quakecStateChainCycleEnd: quakecState?.chainCycleEnd ?? null,
          quakecStateFrame: quakecState?.frame ?? null,
          quakecStateFrameIndex: quakecState?.frameIndex ?? null,
          quakecStateName: quakecState?.stateName ?? null,
          quakecStateNext: quakecState?.next ?? null,
          attackVisual: enemy?.attackVisual ?? null,
          awake: enemy?.awake ?? null,
          currentTarget: enemyTargetTraceLabel(enemy?.currentTarget ?? null),
          oldTarget: enemyTargetTraceLabel(enemy?.oldTarget ?? null),
          pendingAttack: Boolean(pendingAttack),
          pendingAttackFireInMs: pendingAttack && Number.isFinite(pendingAttack.fireAt)
            ? Math.max(0, pendingAttack.fireAt - now)
            : null,
          pendingAttackQuakecChain: pendingAttack?.quakecChain ?? null,
          pendingAttackTarget: pendingAttack ? [
            pendingAttack.target[0],
            pendingAttack.target[1],
            pendingAttack.target[2],
          ] : null,
          movetargetEntityIndex: movetarget?.entity.index ?? null,
          movetargetOrigin: movetarget ? [
            movetarget.origin[0],
            movetarget.origin[1],
            movetarget.origin[2],
          ] : null,
          movetargetTarget: movetarget?.target ?? null,
          movetargetTargetname: movetarget?.targetname ?? null,
          monsterJumpTouchedTriggerEntityIndex: enemy?.monsterJumpTouchedTriggerEntityIndex ?? null,
          moveGoalDecisions: enemy?.debugMoveGoalDecisions?.map((decision) => ({
            atMs: decision.atMs,
            details: { ...decision.details },
            kind: decision.kind,
          })) ?? [],
        };
      }).sort((a, b) => a.entityIndex - b.entityIndex),
    };
  }

  function debugShootableMountDecision(
    shootable: QuakeShootableState,
    playerOrigin: Vec3,
    oversizedRenderVolume: boolean,
  ): {
    canMount: boolean;
    inFrontOfCamera: boolean | null;
    lineOfSightTargetCount: number | null;
    visibleTargetCount: number | null;
  } {
    if (!shootable.enemy) {
      return {
        canMount: true,
        inFrontOfCamera: null,
        lineOfSightTargetCount: null,
        visibleTargetCount: null,
      };
    }
    const inFrontOfCamera = isShootableInFrontOfCameraNearPlane(shootable, playerOrigin);
    if (!inFrontOfCamera) {
      return {
        canMount: false,
        inFrontOfCamera,
        lineOfSightTargetCount: null,
        visibleTargetCount: null,
      };
    }
    const visibleTargets = shootableMountVisibilityTargets(shootable).filter((target) => isInPlayerView(target));
    if (!visibleTargets.length) {
      return {
        canMount: false,
        inFrontOfCamera,
        lineOfSightTargetCount: null,
        visibleTargetCount: 0,
      };
    }
    if (oversizedRenderVolume) {
      return {
        canMount: true,
        inFrontOfCamera,
        lineOfSightTargetCount: null,
        visibleTargetCount: visibleTargets.length,
      };
    }
    const lineOfSightTargetCount = visibleTargets.filter(
      (target) => unbudgetedLineOfSight(playerOrigin, target) === "clear",
    ).length;
    return {
      canMount: lineOfSightTargetCount > 0,
      inFrontOfCamera,
      lineOfSightTargetCount,
      visibleTargetCount: visibleTargets.length,
    };
  }

  function debugShootableBlockReasons(
    shootable: QuakeShootableState,
    input: {
      canMount: boolean;
      canPrewarm: boolean;
      inFrontOfCamera: boolean | null;
      inPvs: boolean | null;
      lineOfSightTargetCount: number | null;
      mountCandidate: boolean;
      oversizedRenderVolume: boolean;
      prewarmCandidate: boolean;
      visibleTargetCount: number | null;
      visibilityGrace: boolean;
      withinMountDistance: boolean;
      withinPrewarmDistance: boolean;
      withinUnmountDistance: boolean;
    },
    desiredMounted: boolean,
    desiredPrewarmed: boolean,
  ): string[] {
    const reasons: string[] = [];
    if (shootable.dead && !isPersistentShootableCorpse(shootable)) reasons.push("dead");
    if (input.visibilityGrace) reasons.push("visibility-grace");
    if (input.inPvs === false) reasons.push("not-in-pvs");
    if (!input.withinMountDistance && !presentation.isVisible(shootable)) reasons.push("beyond-mount-distance");
    if (!input.withinUnmountDistance && presentation.isVisible(shootable)) reasons.push("beyond-unmount-distance");
    if (input.inFrontOfCamera === false) reasons.push("behind-camera");
    if (input.visibleTargetCount === 0) reasons.push("out-of-view");
    if (input.lineOfSightTargetCount === 0 && !input.oversizedRenderVolume) reasons.push("no-line-of-sight");
    if (input.mountCandidate && !desiredMounted) reasons.push("mount-budget");
    if (input.prewarmCandidate && !desiredMounted && !desiredPrewarmed && input.canPrewarm) reasons.push("prewarm-budget");
    if (!input.withinPrewarmDistance && !desiredMounted && !presentation.isVisible(shootable)) reasons.push("beyond-prewarm-distance");
    return reasons;
  }

  function sortedDebugIndexes(indexes: Set<number>): number[] {
    return [...indexes].sort((a, b) => a - b);
  }

  function sortedOptionalLeafIndexes(indexes: Set<number> | null): number[] | null {
    return indexes ? sortedDebugIndexes(indexes) : null;
  }

  function prewarmExtraLeafIndexes(
    visibleLeaves: Set<number> | null,
    prewarmLeaves: Set<number> | null,
  ): Set<number> | null {
    if (!prewarmLeaves) return null;
    if (!visibleLeaves) return new Set(prewarmLeaves);
    const extra = new Set<number>();
    for (const leafIndex of prewarmLeaves) {
      if (!visibleLeaves.has(leafIndex)) extra.add(leafIndex);
    }
    return extra;
  }

  function debugShootablePvsSource(
    shootable: QuakeShootableState,
    visibleLeaves: Set<number> | null,
    prewarmLeaves: Set<number> | null,
    oversizedRenderVolume: boolean,
  ): "current" | "prewarm-extra" | "oversized" | "none" | "unknown" {
    if (oversizedRenderVolume) return "oversized";
    if (shootable.leafIndex === undefined) return "unknown";
    if (!visibleLeaves) return "unknown";
    if (visibleLeaves.has(shootable.leafIndex)) return "current";
    if (prewarmLeaves?.has(shootable.leafIndex)) return "prewarm-extra";
    return "none";
  }

  function debugSetOrigin(entityIndex: number, origin: Vec3): boolean {
    const shootable = shootables.get(entityIndex);
    if (!shootable) return false;
    shootable.origin = [...origin] as Vec3;
    shootable.leafIndex = leafIndexAt(shootable.origin);
    mountedEnemyAcquisitionVisibilityCache.clear();
    syncShootableTransform(shootable);
    markShootableTrace("shootable-debug-origin", shootable, {
      x: origin[0],
      y: origin[1],
      z: origin[2],
    });
    return true;
  }

  function debugSetYaw(entityIndex: number, yaw: number): boolean {
    const shootable = shootables.get(entityIndex);
    if (!shootable || !Number.isFinite(yaw)) return false;
    const normalizedYaw = ((yaw % 360) + 360) % 360;
    syncShootableTransform(shootable, normalizedYaw);
    markShootableTrace("shootable-debug-yaw", shootable, { yaw: normalizedYaw });
    return true;
  }

  function resetShootableEnemyRuntime(shootable: QuakeShootableState): void {
    if (!quakeMonsterUsesEnemyRuntime(shootable.entity)) return;
    const movetarget = quakeInitialMonsterMovetarget(shootable.entity, monsterPathCornersByTargetname);
    shootable.enemy = createEnemyState(
      shootable.entity.index,
      createMonsterStateRunner?.(shootable.entity.classname) ?? null,
      movetarget,
      quakeEnemyRandomSaltValue(enemyRandomSalt),
      quakeMonsterInitialIdealYaw(shootable.entity, shootable.origin, movetarget),
    );
  }

  function debugMountEntity(entityIndex: number): boolean {
    const shootable = shootables.get(entityIndex);
    if (!shootable || shootable.dead) return false;
    if (!presentation.hasHandle(shootable)) mountShootableHandle(shootable);
    if (!presentation.hasHandle(shootable)) return false;
    setShootableVisible(shootable, true);
    syncShootableTransform(shootable);
    return presentation.isVisible(shootable);
  }

  function debugForceEnemyAttack(entityIndex: number, targetOrigin?: Vec3): boolean {
    const shootable = shootables.get(entityIndex);
    const enemy = shootable?.enemy;
    if (!shootable || !enemy || shootable.dead || shootable.health <= 0) return false;
    if (!debugMountEntity(entityIndex)) return false;
    const profile = enemyCombatProfile(shootable);
    if (!profile) return false;
    const now = performance.now();
    const target = [...(targetOrigin ?? getPlayerOrigin())] as [number, number, number];
    clearEnemyAttackState(shootable);
    enemy.awake = true;
    enemy.currentTarget = targetOrigin ? { kind: "player" } : playerEnemyTargetReference();
    enemy.oldTarget = null;
    enemy.nextAttackAt = now;
    enemy.quakecIdealYaw = quakeYawToOrigin(shootable.origin, target);
    syncShootableEnemyDatasets(shootable);
    const started = tryStartEnemyAttack(
      shootable,
      enemy,
      shootableEyeOrigin(shootable),
      target,
      profile,
      now,
      playerAttackTarget(target),
    );
    if (started) startEnemyLoop();
    return started;
  }

  function debugForceEnemyAttackChain(entityIndex: number, chain: string, targetOrigin?: Vec3): boolean {
    const shootable = shootables.get(entityIndex);
    const enemy = shootable?.enemy;
    if (!shootable || !enemy || shootable.dead || shootable.health <= 0 || !chain) return false;
    if (!debugMountEntity(entityIndex)) return false;
    const profile = enemyCombatProfile(shootable);
    if (!profile) return false;
    const now = performance.now();
    const target = [...(targetOrigin ?? getPlayerOrigin())] as [number, number, number];
    clearEnemyAttackState(shootable);
    enemy.awake = true;
    enemy.currentTarget = playerEnemyTargetReference();
    enemy.oldTarget = null;
    enemy.nextAttackAt = now;
    enemy.pendingAttack = {
      fireAt: Infinity,
      forceAttackEvents: true,
      quakecChain: chain,
      target: [...target] as Vec3,
    };
    enemy.quakecFiredEvents.clear();
    enemy.quakecIdealYaw = quakeYawToOrigin(shootable.origin, target);
    syncShootableEnemyDatasets(shootable);
    const context: QuakeEnemyAnimationContext = {
      enemyEye: shootableEyeOrigin(shootable),
      forceAttackEvents: true,
      playerOrigin: target,
      profile,
      target: playerAttackTarget(target),
    };
    if (!runDebugEnemyAttackChain(shootable, chain, now, context)) {
      clearEnemyAttackState(shootable);
      return false;
    }
    startEnemyLoop();
    return true;
  }

  function runDebugEnemyAttackChain(
    shootable: QuakeShootableState,
    chain: string,
    now: number,
    context: QuakeEnemyAnimationContext,
  ): boolean {
    const enemy = shootable.enemy;
    const runner = enemy?.quakecRunner;
    if (!enemy || !runner || !runner.hasChain(chain)) return false;
    let step = runner.enterChain(chain);
    if (!step) return false;
    enemy.quakecAnimationChain = chain;
    enemy.animationMode = "attack";
    for (let index = 0; index < Math.max(1, runner.chainLength(chain)); index++) {
      applyEnemyQuakecAnimationStep(shootable, step, "attack", now + index * QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS, context);
      if (step.chainCycleEnd) break;
      step = runner.advance();
      if (step.chain !== chain) break;
    }
    return true;
  }

  function debugSetEnemyTickFilter(entityIndexes: readonly number[] | null): void {
    debugEnemyTickFilter = entityIndexes
      ? new Set(entityIndexes.filter((entityIndex) => Number.isInteger(entityIndex) && entityIndex > 0))
      : null;
  }

  function debugClearEnemyProjectileCapture(): void {
    debugEnemyProjectileStepNow = 0;
    enemyProjectiles.debugClearProjectileCapture();
  }

  function debugStepEnemyProjectiles(dtMs = QUAKE_ENEMY_TICK_MS): QuakeEnemyProjectileDebugCapture {
    const boundedDtMs = Math.max(1, Math.min(250, Number.isFinite(dtMs) ? dtMs : QUAKE_ENEMY_TICK_MS));
    const now = Math.max(performance.now(), debugEnemyProjectileStepNow + boundedDtMs);
    debugEnemyProjectileStepNow = now;
    enemyProjectiles.update(getPlayerOrigin(), boundedDtMs / 1000, now);
    return enemyProjectiles.debugProjectileCapture();
  }

  function shootableVisibilitySnapshot(): QuakeShootablesVisibilitySnapshot {
    const mountedIndexes = new Set<number>();
    const visibleIndexes = new Set<number>();
    const prewarmedIndexes = new Set<number>();
    let meshHandles = 0;
    let frameHandles = 0;
    let enemyFrameHandles = 0;
    let mountedEnemies = 0;
    let visibleEnemies = 0;
    let prewarmedEnemies = 0;
    for (const shootable of shootables.values()) {
      const handleCount = countShootableHandles(shootable);
      const hasHandle = handleCount > 0;
      const isEnemy = Boolean(shootable.enemy);
      meshHandles += handleCount;
      frameHandles += presentation.frameHandleCount(shootable);
      if (isEnemy) enemyFrameHandles += presentation.frameHandleCount(shootable);
      if (hasHandle) {
        mountedIndexes.add(shootable.entity.index);
        if (isEnemy) mountedEnemies++;
      }
      if (presentation.hasHandle(shootable) && presentation.isVisible(shootable)) {
        visibleIndexes.add(shootable.entity.index);
        if (isEnemy) visibleEnemies++;
      }
      if (hasHandle && !presentation.isVisible(shootable)) {
        prewarmedIndexes.add(shootable.entity.index);
        if (isEnemy) prewarmedEnemies++;
      }
    }
    return {
      mountedIndexes,
      visibleIndexes,
      prewarmedIndexes,
      meshHandles,
      frameHandles,
      enemyFrameHandles,
      mountedEnemies,
      visibleEnemies,
      prewarmedEnemies,
    };
  }

  function syncVisibility(origin: [number, number, number], force = false): void {
    const startedAt = performance.now();
    combatBudget.beginFrame(startedAt);
    const before = shootableVisibilitySnapshot();
    const meshHandlesCreatedBefore = visibilityChurn.totalMeshHandlesCreated;
    const meshHandlesRemovedBefore = visibilityChurn.totalMeshHandlesRemoved;
    const frameHandlesCreatedBefore = visibilityChurn.totalFrameHandlesCreated;
    const frameHandlesRemovedBefore = visibilityChurn.totalFrameHandlesRemoved;
    const visibleLeaves = visibleLeavesAt(origin);
    const prewarmLeaves = prewarmLeavesAt(origin);
    const prewarmExtraLeaves = prewarmExtraLeafIndexes(visibleLeaves, prewarmLeaves);
    const coarseCandidates: QuakeShootableVisibilityCandidate[] = [];
    const candidates: QuakeShootableVisibilityCandidate[] = [];
    const corpseCandidates: QuakeShootableVisibilityCandidate[] = [];
    const prewarmCandidates: QuakeShootableVisibilityCandidate[] = [];
    const now = startedAt;
    for (const shootable of shootables.values()) {
      const visibleLeaf = !visibleLeaves ||
        shootable.leafIndex === undefined ||
        visibleLeaves.has(shootable.leafIndex) ||
        isOversizedShootableRenderVolume(shootable);
      const prewarmLeaf = !prewarmLeaves ||
        shootable.leafIndex === undefined ||
        prewarmLeaves.has(shootable.leafIndex) ||
        isOversizedShootableRenderVolume(shootable);
      const distanceSq = distanceSq3(origin, shootable.origin);
      const maxDistanceSq = presentation.isVisible(shootable) ? QUAKE_SHOOTABLE_UNMOUNT_DISTANCE_SQ : QUAKE_SHOOTABLE_MOUNT_DISTANCE_SQ;
      if (isPersistentShootableCorpse(shootable)) {
        if (visibleLeaf && distanceSq <= maxDistanceSq) {
          corpseCandidates.push({ index: shootable.entity.index, distanceSq });
        }
        continue;
      }
      if (shootable.dead) continue;
      const coarseMountCandidate = visibleLeaf &&
        distanceSq <= maxDistanceSq &&
        canCoarselyMountShootableHandle(shootable, origin);
      if (coarseMountCandidate) {
        coarseCandidates.push({ index: shootable.entity.index, distanceSq });
      } else if (canKeepShootableMountedByVisibilityGrace(shootable, distanceSq, now)) {
        candidates.push({ index: shootable.entity.index, distanceSq });
      }
      if (
        distanceSq <= QUAKE_SHOOTABLE_PREWARM_DISTANCE_SQ &&
        canPrewarmShootableForSelection(shootable, prewarmLeaf, origin)
      ) {
        prewarmCandidates.push({ index: shootable.entity.index, distanceSq });
      }
    }

    coarseCandidates.sort(compareShootableVisibilityCandidates);
    for (const candidate of coarseCandidates) {
      const shootable = shootables.get(candidate.index);
      if (!shootable || shootable.dead) continue;
      const strictMountCandidate = canMountShootableHandle(shootable, origin);
      if (strictMountCandidate) {
        recordShootableCombatInterest(shootable, now);
        shootable.lastMountCandidateAt = now;
        candidates.push(candidate);
      } else if (canKeepShootableMountedByVisibilityGrace(shootable, candidate.distanceSq, now)) {
        candidates.push(candidate);
      }
    }

    candidates.sort(compareShootableVisibilityCandidates);
    const mountedIndexes = new Set(candidates.slice(0, QUAKE_SHOOTABLE_MAX_MOUNTED).map((candidate) => candidate.index));
    corpseCandidates.sort(compareShootableVisibilityCandidates);
    for (const candidate of corpseCandidates.slice(0, QUAKE_SHOOTABLE_MAX_MOUNTED_CORPSES)) {
      mountedIndexes.add(candidate.index);
    }
    prewarmCandidates.sort(compareShootableVisibilityCandidates);
    const prewarmedIndexes = new Set<number>();
    for (const candidate of prewarmCandidates) {
      if (mountedIndexes.has(candidate.index)) continue;
      prewarmedIndexes.add(candidate.index);
      if (prewarmedIndexes.size >= QUAKE_SHOOTABLE_MAX_PREWARMED) break;
    }
    prewarmQueues.setDesiredPrewarmIndexes(prewarmedIndexes);
    const selectionKey = shootableVisibilitySelectionKey(mountedIndexes, prewarmedIndexes);
    const selectionChanged = selectionKey !== lastVisibilitySelectionKey;
    lastVisibilitySelectionKey = selectionKey;
    const selectionNeedsApply = selectionChanged ||
      shootableVisibilitySelectionNeedsApply(mountedIndexes, prewarmedIndexes);
    if (selectionNeedsApply) {
      for (const shootable of shootables.values()) {
        setShootableMounted(
          shootable,
          mountedIndexes.has(shootable.entity.index),
          prewarmedIndexes.has(shootable.entity.index),
        );
      }
    }
    const after = selectionNeedsApply ? shootableVisibilitySnapshot() : before;
    const meshHandlesCreated = visibilityChurn.totalMeshHandlesCreated - meshHandlesCreatedBefore;
    const meshHandlesRemoved = visibilityChurn.totalMeshHandlesRemoved - meshHandlesRemovedBefore;
    const frameHandlesCreated = visibilityChurn.totalFrameHandlesCreated - frameHandlesCreatedBefore;
    const frameHandlesRemoved = visibilityChurn.totalFrameHandlesRemoved - frameHandlesRemovedBefore;
    lastVisibilitySync = {
      atMs: startedAt,
      force,
      origin: [origin[0], origin[1], origin[2]],
      visibleLeafCount: visibleLeaves?.size ?? null,
      prewarmLeafCount: prewarmLeaves?.size ?? null,
      prewarmExtraLeafCount: prewarmExtraLeaves?.size ?? null,
      visibleLeafIndexes: sortedOptionalLeafIndexes(visibleLeaves),
      prewarmLeafIndexes: sortedOptionalLeafIndexes(prewarmLeaves),
      prewarmExtraLeafIndexes: sortedOptionalLeafIndexes(prewarmExtraLeaves),
      candidateIndexes: [...candidates, ...corpseCandidates].map((candidate) => candidate.index),
      corpseCandidateIndexes: corpseCandidates.map((candidate) => candidate.index),
      prewarmCandidateIndexes: prewarmCandidates.map((candidate) => candidate.index),
      desiredMountedIndexes: sortedDebugIndexes(mountedIndexes),
      desiredPrewarmIndexes: sortedDebugIndexes(prewarmedIndexes),
      beforeMountedIndexes: sortedDebugIndexes(before.mountedIndexes),
      beforeVisibleIndexes: sortedDebugIndexes(before.visibleIndexes),
      beforePrewarmedIndexes: sortedDebugIndexes(before.prewarmedIndexes),
      afterMountedIndexes: sortedDebugIndexes(after.mountedIndexes),
      afterVisibleIndexes: sortedDebugIndexes(after.visibleIndexes),
      afterPrewarmedIndexes: sortedDebugIndexes(after.prewarmedIndexes),
      selectionChanged,
      selectionApplied: selectionNeedsApply,
      meshHandlesCreated,
      meshHandlesRemoved,
      frameHandlesCreated,
      frameHandlesRemoved,
    };
    recordQuakeShootablesVisibilitySync(visibilityChurn, startedAt, {
      force,
      selectionChanged,
      before,
      after,
      candidates: candidates.length + corpseCandidates.length,
      prewarmCandidates: prewarmCandidates.length,
      desiredMounted: mountedIndexes.size,
      desiredPrewarm: prewarmedIndexes.size,
      meshHandlesCreated,
      meshHandlesRemoved,
      frameHandlesCreated,
      frameHandlesRemoved,
    });
    if (force || selectionChanged || meshHandlesCreated || meshHandlesRemoved || frameHandlesCreated || frameHandlesRemoved) {
      markQuakeTrace("shootables-visibility", {
        force,
        selectionChanged,
        candidates: candidates.length,
        corpseCandidates: corpseCandidates.length,
        visibleLeafCount: visibleLeaves?.size ?? -1,
        prewarmLeafCount: prewarmLeaves?.size ?? -1,
        prewarmExtraLeafCount: prewarmExtraLeaves?.size ?? -1,
        desiredMountedKey: sortedDebugIndexes(mountedIndexes).join(","),
        desiredPrewarmKey: sortedDebugIndexes(prewarmedIndexes).join(","),
        afterVisibleKey: sortedDebugIndexes(after.visibleIndexes).join(","),
        desiredMounted: mountedIndexes.size,
        desiredPrewarm: prewarmedIndexes.size,
        visibleEnemies: after.visibleEnemies,
        mountedEnemies: after.mountedEnemies,
        meshCreated: meshHandlesCreated,
        meshRemoved: meshHandlesRemoved,
        frameCreated: frameHandlesCreated,
        frameRemoved: frameHandlesRemoved,
      });
    }
    syncEnemyMotionMaterialsForView(origin, force ? "view-force" : "view");
  }

  function shootableVisibilitySelectionNeedsApply(
    mountedIndexes: Set<number>,
    prewarmedIndexes: Set<number>,
  ): boolean {
    for (const index of mountedIndexes) {
      const shootable = shootables.get(index);
      if (!shootable || !presentation.hasHandle(shootable) || !presentation.isVisible(shootable)) return true;
    }
    for (const index of prewarmedIndexes) {
      const shootable = shootables.get(index);
      if (!shootable || !canPrewarmShootableHandle(shootable)) continue;
      if (!presentation.hasHandle(shootable) && !prewarmQueues.hasQueuedPrewarm(index)) return true;
      if (presentation.hasHandle(shootable) && presentation.isVisible(shootable)) return true;
    }
    for (const shootable of shootables.values()) {
      const index = shootable.entity.index;
      if (!presentation.hasHandle(shootable) || mountedIndexes.has(index) || prewarmedIndexes.has(index)) continue;
      if (isShootableDeathAnimating(shootable)) continue;
      return true;
    }
    return false;
  }

  function setShootableMounted(shootable: QuakeShootableState, mounted: boolean, prewarmed: boolean): void {
    const canPrewarmHandle = canPrewarmShootableHandle(shootable);
    const deathAnimating = isShootableDeathAnimating(shootable);
    const shouldKeepHandle = mounted || (prewarmed && canPrewarmHandle) ||
      deathAnimating;
    if (presentation.hasHandle(shootable) && !shouldKeepHandle) {
      clearEnemyAttackState(shootable);
      removeShootableHandles(shootable);
    }
    if (!shouldKeepHandle) return;
    if (shootable.dead && !isPersistentShootableCorpse(shootable) && !deathAnimating) return;
    if (!presentation.hasHandle(shootable)) {
      if (!mounted) {
        if (!canPrewarmHandle) return;
        if (!shouldMountShootablePrewarmImmediately(shootable)) {
          prewarmQueues.scheduleShootable(shootable);
          return;
        }
        mountShootableHandle(shootable);
      } else {
        mountShootableHandle(shootable);
      }
    }
    setShootableVisible(shootable, mounted || deathAnimating);
  }

  function shouldMountShootablePrewarmImmediately(shootable: QuakeShootableState): boolean {
    return shootable.enemy !== undefined && !shootable.dead;
  }

  function mountShootableHandle(shootable: QuakeShootableState): void {
    initializeEnemyAnimation(shootable, performance.now());
    if (presentation.mount(shootable, canPoolShootableAnimationFrames(shootable)) === "pool") {
      scheduleNextShootableAnimationFramePrewarm(shootable);
    }
  }

  function scheduleNextShootableAnimationFramePrewarm(shootable: QuakeShootableState): void {
    if (!presentation.isVisible(shootable) || !canPoolShootableAnimationFrames(shootable)) return;
    const frameIndex = nextShootableAnimationFrameIndex(shootable);
    if (frameIndex === undefined || presentation.hasFrame(shootable, frameIndex)) return;
    prewarmQueues.scheduleAnimationFrame(shootable, frameIndex);
  }

  function canPrewarmShootableHandle(shootable: QuakeShootableState): boolean {
    return !shootable.enemy || canUseShootableAnimationFrameSet(shootable);
  }

  function canPrewarmShootableForSelection(
    shootable: QuakeShootableState,
    visibleLeaf: boolean,
    playerOrigin: Vec3,
  ): boolean {
    if (!canPrewarmShootableHandle(shootable)) return false;
    if (!shootable.enemy) return true;
    if (canKeepEngagedEnemyPrewarmed(shootable, playerOrigin)) return true;
    if (presentation.isVisible(shootable) || shootable.dead || !visibleLeaf) return false;
    return true;
  }

  function canKeepEngagedEnemyPrewarmed(shootable: QuakeShootableState, playerOrigin: Vec3): boolean {
    const enemy = shootable.enemy;
    if (!enemy || shootable.dead || shootable.health <= 0) return false;
    if (!enemy.awake && !enemy.currentTarget && !enemy.pendingAttack) return false;
    return distanceSq3(playerOrigin, shootable.origin) <= QUAKE_SHOOTABLE_PREWARM_DISTANCE_SQ;
  }

  function compareShootableVisibilityCandidates(
    a: QuakeShootableVisibilityCandidate,
    b: QuakeShootableVisibilityCandidate,
  ): number {
    return a.distanceSq - b.distanceSq || a.index - b.index;
  }

  function canMountShootableHandle(shootable: QuakeShootableState, playerOrigin: Vec3): boolean {
    if (!shootable.enemy) return true;
    if (!canCoarselyMountShootableHandle(shootable, playerOrigin)) return false;
    const visibleTargets = shootableMountVisibilityTargets(shootable).filter((target) => isInPlayerView(target));
    if (isOversizedShootableRenderVolume(shootable)) return true;
    const lineOfSight = presentation.hasHandle(shootable) && !presentation.isVisible(shootable)
      ? unbudgetedLineOfSight
      : budgetedLineOfSight;
    let lineOfSightDeferred = false;
    for (const target of visibleTargets) {
      const result = lineOfSight(playerOrigin, target);
      if (result === "clear") return true;
      if (result === "deferred") lineOfSightDeferred = true;
    }
    return lineOfSightDeferred && presentation.isVisible(shootable);
  }

  function canCoarselyMountShootableHandle(shootable: QuakeShootableState, playerOrigin: Vec3): boolean {
    if (!shootable.enemy) return true;
    if (!isShootableInFrontOfCameraNearPlane(shootable, playerOrigin)) return false;
    return shootableMountVisibilityTargets(shootable).some((target) => isInPlayerView(target));
  }

  function canKeepShootableMountedByVisibilityGrace(
    shootable: QuakeShootableState,
    distanceSq: number,
    now: number,
  ): boolean {
    if (!shootable.enemy || !presentation.isVisible(shootable) || shootable.dead) return false;
    if (distanceSq > QUAKE_SHOOTABLE_UNMOUNT_DISTANCE_SQ) return false;
    return visibilityGraceRemainingMs(shootable, now) > 0;
  }

  function visibilityGraceRemainingMs(shootable: QuakeShootableState, now: number): number {
    const elapsed = now - shootable.lastMountCandidateAt;
    if (!Number.isFinite(elapsed)) return 0;
    return Math.max(0, QUAKE_SHOOTABLE_VISIBILITY_GRACE_MS - elapsed);
  }

  function isShootableInFrontOfCameraNearPlane(shootable: QuakeShootableState, playerOrigin: Vec3): boolean {
    const forward = getPlayerForward();
    const forwardHorizontal = normalizeVec3([forward[0], forward[1], 0]);
    if (Math.abs(forwardHorizontal[0]) <= COLLISION_EPSILON &&
      Math.abs(forwardHorizontal[1]) <= COLLISION_EPSILON) {
      return true;
    }
    const bounds = shootableBounds(shootable);
    const toShootable: Vec3 = [
      (bounds.min[0] + bounds.max[0]) * 0.5 - playerOrigin[0],
      (bounds.min[1] + bounds.max[1]) * 0.5 - playerOrigin[1],
      0,
    ];
    const depth = dotVec3(toShootable, forwardHorizontal);
    return depth - shootableHorizontalRadius(shootable) > QUAKE_SHOOTABLE_MIN_VIEW_DEPTH;
  }

  function shootableHorizontalRadius(shootable: QuakeShootableState): number {
    return Math.max(
      Math.abs(shootable.bounds.min[0]),
      Math.abs(shootable.bounds.max[0]),
      Math.abs(shootable.bounds.min[1]),
      Math.abs(shootable.bounds.max[1]),
    );
  }

  function isOversizedShootableRenderVolume(shootable: QuakeShootableState): boolean {
    const verticalSpan = Math.max(0, shootable.bounds.max[2] - shootable.bounds.min[2]);
    return shootableHorizontalRadius(shootable) >= QUAKE_SHOOTABLE_OVERSIZED_RENDER_RADIUS ||
      verticalSpan >= QUAKE_SHOOTABLE_OVERSIZED_RENDER_HEIGHT;
  }

  function setShootableVisible(shootable: QuakeShootableState, visible: boolean): void {
    if (!presentation.hasHandle(shootable)) {
      presentation.setVisible(shootable, false);
      return;
    }
    const wasVisible = presentation.isVisible(shootable);
    if (visible === wasVisible) return;
    // Losing render eligibility cancels attacks in the existing gameplay rules.
    if (!visible && wasVisible) clearEnemyAttackState(shootable);
    presentation.setVisible(shootable, visible);
    syncShootableEnemyDatasets(shootable);
    markShootableTrace("shootable-visible", shootable, {
      active: visible,
      handles: countShootableHandles(shootable),
    });
    if (visible) {
      presentation.markMotionMaterial(shootable, "visible");
      scheduleNextShootableAnimationFramePrewarm(shootable);
    }
  }

  function canPoolShootableAnimationFrames(shootable: QuakeShootableState): boolean {
    return false;
  }













  function startEnemyLoop(): void {
    enemyLoop.start();
  }

  function stopEnemyLoop(): void {
    enemyLoop.stop();
  }

  function updateEnemiesForLoop(
    playerOrigin: [number, number, number],
    dt: number,
    now: number,
  ): void {
    combatBudget.beginEnemyFrame(now);
    let movedEnemies = 0;
    for (const shootable of shootables.values()) {
      const previousOrigin = shootable.enemy ? [...shootable.origin] as Vec3 : null;
      const previousLeafIndex = shootable.leafIndex;
      updateEnemy(shootable, playerOrigin, dt, now);
      if (!previousOrigin || !shootable.enemy) continue;
      if (
        previousLeafIndex !== shootable.leafIndex ||
        distanceSq3(previousOrigin, shootable.origin) > QUAKE_SHOOTABLE_TRANSFORM_EPSILON * QUAKE_SHOOTABLE_TRANSFORM_EPSILON
      ) {
        movedEnemies++;
      }
    }
    if (movedEnemies > 0) {
      markQuakeTrace("shootables-enemy-motion-visibility-resync", { movedEnemies });
      syncVisibility(playerOrigin);
    }
  }

  function* enemyStates(): Iterable<QuakeEnemyState> {
    for (const shootable of shootables.values()) {
      const enemy = shootable.enemy;
      if (!enemy) continue;
      yield enemy;
    }
  }

  function hasLiveEnemies(now = performance.now()): boolean {
    for (const shootable of shootables.values()) {
      if (shootable.enemy && (!shootable.dead || isShootableDeathAnimating(shootable, now))) return true;
    }
    return false;
  }

  function updateEnemy(
    shootable: QuakeShootableState,
    playerOrigin: [number, number, number],
    dt: number,
    now: number,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy) return;
    if (debugEnemyTickFilter && !debugEnemyTickFilter.has(shootable.entity.index)) return;
    if (!presentation.hasHandle(shootable) || !presentation.isVisible(shootable)) {
      combatBudget.recordEnemyUpdate("skipped-unmounted");
      updateUnmountedEnemy(shootable, playerOrigin, dt, now);
      return;
    }
    combatBudget.recordEnemyUpdate("mounted-visible");
    if (shootable.dead) {
      if (isShootableDeathAnimating(shootable, now)) updateEnemyAnimation(shootable, "death", now);
      return;
    }
    if (isZombieRecovering(shootable, now)) {
      updateEnemyAnimation(shootable, "pain", now);
      return;
    }
    if (updateEnemyMonsterJumpFlight(shootable, dt, now)) {
      updateEnemyAnimation(shootable, "walk", now);
      return;
    }
    const profile = enemyCombatProfile(shootable);
    if (!profile) {
      updateEnemyAnimation(shootable, "idle", now);
      return;
    }
    let attackTarget = enemyAttackTarget(shootable, playerOrigin);
    let attackTargetOrigin = attackTarget.origin as [number, number, number];
    let enemyEye = shootableEyeOrigin(shootable);
    let acquisitionDecision: QuakeEnemyAcquisitionDecision | null = null;
    let canSeePlayer: boolean;
    if (!enemy.awake && combatBudget.mountedEnemyAcquisitionEnabled()) {
      acquisitionDecision = mountedEnemyAcquisitionDecision(shootable, playerOrigin, now);
      canSeePlayer = acquisitionDecision.acquired;
    } else {
      canSeePlayer = hasLineOfSight(enemyEye, attackTargetOrigin);
    }
    let acquiredByVisiblePressure = false;
    if (
      !enemy.awake &&
      !canSeePlayer &&
      canAcquireDormantEnemyFromVisiblePressure(shootable, playerOrigin, enemyEye, attackTargetOrigin, acquisitionDecision)
    ) {
      canSeePlayer = true;
      acquiredByVisiblePressure = true;
    }
    if (!enemy.awake) {
      if (!canSeePlayer) {
        if (acquisitionDecision) {
          markShootableTrace("enemy-acquire-blocked", shootable, {
            inFront: acquisitionDecision.inFront,
            lineOfSight: acquisitionDecision.lineOfSight,
            range: acquisitionDecision.range,
            reason: acquisitionDecision.reason,
            visible: acquisitionDecision.visible,
          });
        }
        updateDormantEnemyWithoutTarget(shootable, profile, dt, now);
        return;
      }
      if (!quakeMonsterCanAcquirePlayer(isPlayerInvisible?.() === true)) {
        markShootableTrace("enemy-acquire-blocked", shootable, { reason: "invisibility" });
        updateDormantEnemyWithoutTarget(shootable, profile, dt, now);
        return;
      }
      enemy.awake = true;
      enemy.currentTarget = playerEnemyTargetReference();
      mountedEnemySightEntity = {
        entityIndex: shootable.entity.index,
        seenAtSeconds: now / 1000,
      };
      attackTarget = enemyAttackTarget(shootable, playerOrigin);
      attackTargetOrigin = attackTarget.origin as [number, number, number];
      enemy.quakecIdealYaw = quakeYawToOrigin(shootable.origin, attackTargetOrigin);
      enemy.nextAttackAt = now + quakeEnemyWakeDelayMs(enemyCombat, profile, enemy);
      playEnemySightSound(shootable, "wake", now);
      syncShootableEnemyDatasets(shootable);
      markShootableTrace("enemy-wake", shootable, {
        acquisitionLineOfSight: acquisitionDecision?.lineOfSight ?? null,
        acquisitionRange: acquisitionDecision?.range ?? null,
        acquisitionReason: acquisitionDecision?.reason ?? null,
        acquisitionUsedSightEntity: acquisitionDecision?.usedSightEntity ?? false,
        acquisitionVisiblePressure: acquiredByVisiblePressure,
        nextAttackMs: enemy.nextAttackAt - now,
      });
    }

    const movementTarget = attackTargetOrigin;
    const attacksEnabled = enemyAttackRuntimeEnabled();
    if (!attacksEnabled) clearEnemyAttackState(shootable);
    if (attacksEnabled && enemy.pendingAttack) {
      enemyMovement.faceShootableAtOrigin(shootable, attackTargetOrigin);
      updateEnemyAnimation(shootable, "attack", now, {
        enemyEye,
        forceAttackEvents: enemy.pendingAttack.forceAttackEvents,
        playerOrigin: attackTargetOrigin,
        profile,
        target: attackTarget,
      });
      enemyCombat.runActiveTouchDamage(shootable, attackTargetOrigin, profile, now, attackTarget);
      if (quakeShootableUsesQuakecAttackEvents(shootable)) return;
      if (now < enemy.pendingAttack.fireAt) return;
      performEnemyAttack(shootable, enemy, enemyEye, attackTargetOrigin, profile, now, attackTarget);
      return;
    }
    if (enemyAnimationLocked(enemy, now)) {
      updateEnemyAnimation(shootable, enemy.animationMode, now, {
        enemyEye,
        playerOrigin: attackTargetOrigin,
        profile,
        target: attackTarget,
      });
      if (attacksEnabled && enemy.animationMode === "attack" && enemy.burstShotsRemaining > 0 && now >= enemy.nextAttackAt) {
        if (distanceSq3(enemyEye, attackTargetOrigin) > profile.range * profile.range) {
          clearEnemyAttackState(shootable);
          return;
        }
        enemyMovement.faceShootableAtOrigin(shootable, attackTargetOrigin);
        performEnemyAttack(shootable, enemy, enemyEye, attackTargetOrigin, profile, now, attackTarget);
      }
      return;
    }
    const attackBeforeMove = shouldCheckQuakecAttackBeforeMove(shootable);
    if (attacksEnabled && shouldAttemptEnemyAttack(canSeePlayer, shootable, enemy, now) && attackBeforeMove &&
      tryStartEnemyAttack(shootable, enemy, enemyEye, attackTargetOrigin, profile, now, attackTarget)
    ) return;
    const shouldWalk = enemyMovement.shouldAnimateChasingEnemy(shootable, movementTarget, profile, canSeePlayer);
    if (shouldWalk) updateEnemyAnimation(shootable, "walk", now);
    const moved = enemyMovement.moveChasingEnemy(shootable, movementTarget, profile, dt, now, canSeePlayer);
    const handledMovementStep = enemy.quakecMovementHandledStep;
    if (moved) applyEnemyMonsterJumpTriggers(shootable);
    if (!shouldWalk || (shouldWalk && !moved && !handledMovementStep)) {
      updateEnemyAnimation(shootable, moved ? "walk" : "idle", now);
    }
    enemyEye = shootableEyeOrigin(shootable);
    if (attacksEnabled && !attackBeforeMove && shouldAttemptEnemyAttack(canSeePlayer, shootable, enemy, now)) {
      if (tryStartEnemyAttack(shootable, enemy, enemyEye, attackTargetOrigin, profile, now, attackTarget)) return;
    }
    if (handledMovementStep || (enemy.quakecRunner && moved)) {
      syncShootableTransform(shootable);
    } else {
      enemyMovement.faceShootableAtOrigin(shootable, movementTarget);
    }
  }

  function updateUnmountedEnemy(
    shootable: QuakeShootableState,
    playerOrigin: [number, number, number],
    dt: number,
    now: number,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy || shootable.dead || shootable.health <= 0) return;
    if (!enemy.awake) {
      if (ambientMonsterPathingEnabled()) {
        updateUnmountedEnemyPathWalking(shootable, dt, now);
      } else {
        clearQuakecMovementBudget(enemy);
      }
      return;
    }
    const tick = combatBudget.tryStartUnmountedAiTick(shootable.entity.index, now);
    if (!tick.accepted) {
      if (tick.reason === "capacity") {
        markShootableTrace("enemy-unmounted-ai-deferred", shootable, { reason: tick.reason });
      }
      return;
    }
    try {
      updateUnmountedEnemyAttack(shootable, enemy, playerOrigin, now);
    } finally {
      combatBudget.completeUnmountedAiTick(shootable.entity.index);
    }
  }

  function updateUnmountedEnemyPathWalking(
    shootable: QuakeShootableState,
    dt: number,
    now: number,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy?.movetarget) return;
    const profile = enemyCombatProfile(shootable);
    if (!profile) return;
    const tick = combatBudget.tryStartAmbientPathTick(shootable.entity.index, now);
    if (!tick.accepted) return;
    updateEnemyPathWalking(shootable, profile, dt, now);
  }

  function updateUnmountedEnemyAttack(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    playerOrigin: [number, number, number],
    now: number,
  ): void {
    if (!enemyAttackRuntimeEnabled()) {
      clearEnemyAttackState(shootable);
      return;
    }
    const profile = enemyCombatProfile(shootable);
    if (!profile) return;
    const enemyEye = shootableEyeOrigin(shootable);
    const attackTarget = enemyAttackTarget(shootable, playerOrigin);
    const attackTargetOrigin = attackTarget.origin as [number, number, number];
    const canSeePlayer = hasLineOfSight(enemyEye, attackTargetOrigin);
    if (!canSeePlayer) return;
    if (enemy.pendingAttack) {
      enemyCombat.runActiveTouchDamage(shootable, attackTargetOrigin, profile, now, attackTarget);
      if (quakeShootableUsesQuakecAttackEvents(shootable)) {
        updateEnemyAnimation(shootable, "attack", now, {
          enemyEye,
          forceAttackEvents: enemy.pendingAttack.forceAttackEvents,
          playerOrigin: attackTargetOrigin,
          profile,
          target: attackTarget,
        });
        return;
      }
      if (now < enemy.pendingAttack.fireAt) return;
      performEnemyAttack(shootable, enemy, enemyEye, attackTargetOrigin, profile, now, attackTarget);
      return;
    }
    if (enemyAnimationLocked(enemy, now)) {
      updateEnemyAnimation(shootable, enemy.animationMode, now, {
        enemyEye,
        playerOrigin: attackTargetOrigin,
        profile,
        target: attackTarget,
      });
      return;
    }
    tryStartEnemyAttack(shootable, enemy, enemyEye, attackTargetOrigin, profile, now, attackTarget);
  }

  function recordShootableCombatInterest(shootable: QuakeShootableState, now = performance.now()): void {
    if (!combatBudget.expandedLogicalCombatEnabled()) return;
    if (!isLiveLogicalWeaponTarget(shootable)) return;
    combatBudget.recordCombatInterest(shootable.entity.index, now);
  }

  function setExpandedLogicalCombatEnabled(enabled: boolean): void {
    combatBudget.setExpandedLogicalCombatEnabled(enabled);
  }

  function setMountedEnemyAcquisitionEnabled(enabled: boolean): void {
    combatBudget.setMountedEnemyAcquisitionEnabled(enabled);
    mountedEnemyAcquisitionVisibilityCache.clear();
    mountedEnemySightEntity = null;
  }

  function setUnmountedAiEnabled(enabled: boolean): void {
    combatBudget.setUnmountedAiEnabled(enabled);
  }

  function enemyCombatProfile(shootable: QuakeShootableState): QuakeMonsterCombatProfile | undefined {
    if (!shootable.enemy?.quakecRunner) return undefined;
    return quakeMonsterCombatProfile(shootable.entity.classname);
  }

  function enemyAttackTarget(
    shootable: QuakeShootableState,
    playerOrigin: [number, number, number],
  ): QuakeEnemyAttackTarget {
    const enemy = shootable.enemy;
    const currentTarget = enemy?.currentTarget ?? playerEnemyTargetReference();
    const resolved = resolveEnemyAttackTarget(currentTarget, playerOrigin);
    if (resolved) return resolved;
    if (enemy?.oldTarget) {
      const oldTarget = resolveEnemyAttackTarget(enemy.oldTarget, playerOrigin);
      if (oldTarget) {
        enemy.currentTarget = enemy.oldTarget;
        enemy.oldTarget = null;
        return oldTarget;
      }
    }
    if (enemy) {
      enemy.currentTarget = playerEnemyTargetReference();
      enemy.oldTarget = null;
    }
    return playerAttackTarget(playerOrigin);
  }

  function resolveEnemyAttackTarget(
    target: QuakeEnemyTargetReference,
    playerOrigin: [number, number, number],
  ): QuakeEnemyAttackTarget | null {
    if (target.kind === "player") return playerAttackTarget(playerOrigin);
    if (target.entityIndex === undefined) return null;
    const shootable = shootables.get(target.entityIndex);
    if (!shootable || shootable.dead || shootable.health <= 0 || isZombieNonSolid(shootable)) return null;
    return {
      bounds: shootableCollisionWorldBounds(shootable),
      classname: shootable.entity.classname,
      damage: (amount, context) => damage(shootable.entity.index, amount, context),
      entityIndex: shootable.entity.index,
      id: shootable.entity.index,
      kind: "shootable",
      origin: shootable.origin,
    };
  }

  function playerAttackTarget(playerOrigin: [number, number, number]): QuakeEnemyAttackTarget {
    return {
      bounds: quakecPlayerDamageBounds(playerOrigin),
      classname: "player",
      damage: (amount, context) => damagePlayer(amount, quakePlayerDamageContextFromShootableDamage(context)),
      id: "player",
      kind: "player",
      origin: playerOrigin,
    };
  }

  function updateDormantEnemyWithoutTarget(
    shootable: QuakeShootableState,
    profile: QuakeMonsterCombatProfile,
    dt: number,
    now: number,
  ): void {
    if (ambientMonsterPathingEnabled()) {
      updateEnemyPathWalking(shootable, profile, dt, now);
      return;
    }
    clearQuakecMovementBudget(shootable.enemy);
    updateEnemyAnimation(shootable, "idle", now);
  }

  function canAcquireDormantEnemyFromVisiblePressure(
    shootable: QuakeShootableState,
    playerOrigin: [number, number, number],
    enemyEye: Vec3,
    attackTargetOrigin: [number, number, number],
    acquisitionDecision: QuakeEnemyAcquisitionDecision | null,
  ): boolean {
    if (ambientMonsterPathingEnabled()) return false;
    if (!presentation.isVisible(shootable) || shootable.dead || shootable.health <= 0) return false;
    if (isPlayerInvisible?.() === true) return false;
    if (
      acquisitionDecision?.reason !== "behind-mid" &&
      acquisitionDecision?.reason !== "behind-near"
    ) {
      return false;
    }
    if ((quakeEntityNumber(shootable.entity, "spawnflags", 0) & QUAKE_MONSTER_AMBUSH_OR_ZOMBIE_CRUCIFIED_FLAGS) !== 0) {
      return false;
    }
    if (!shootableHasPlayerViewTargetAtDot(shootable, playerOrigin, QUAKE_SHOOTABLE_ENEMY_PREWARM_VIEW_DOT_MIN)) {
      return false;
    }
    return budgetedLineOfSight(enemyEye, attackTargetOrigin) === "clear";
  }

  function updateEnemyPathWalking(
    shootable: QuakeShootableState,
    profile: QuakeMonsterCombatProfile,
    dt: number,
    now: number,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy?.movetarget) {
      clearQuakecMovementBudget(enemy);
      updateEnemyAnimation(shootable, "idle", now);
      return;
    }
    advanceMonsterMovetargetIfReached(shootable, enemy);
    const target = enemy.movetarget;
    if (!target) {
      clearQuakecMovementBudget(enemy);
      updateEnemyAnimation(shootable, "idle", now);
      return;
    }

    updateEnemyAnimation(shootable, "path", now);
    const moved = enemyMovement.moveEnemyTowardOrigin(shootable, target.origin, profile, dt, now, {
      allowWallFollow: true,
      movementCall: "ai_walk",
      stopDistance: 0,
    });
    const handledMovementStep = enemy.quakecMovementHandledStep;
    if (moved) applyEnemyMonsterJumpTriggers(shootable);
    if (handledMovementStep || (enemy.quakecRunner && moved)) {
      syncShootableTransform(shootable);
    } else {
      enemyMovement.faceShootableAtOrigin(shootable, target.origin);
    }
    if (moved || handledMovementStep) {
      updateEnemyAnimation(shootable, "path", now);
    } else {
      updateEnemyAnimation(shootable, "idle", now);
    }
    advanceMonsterMovetargetIfReached(shootable, enemy);
  }

  function updateEnemyMonsterJumpFlight(
    shootable: QuakeShootableState,
    dt: number,
    now: number,
  ): boolean {
    const enemy = shootable.enemy;
    if (!enemy || !enemyMonsterJumpVelocityActive(enemy) || dt <= 0) return false;
    const previousOrigin = shootable.origin;
    const previousEye = shootableEyeOrigin(shootable);
    const velocity = enemy.monsterJumpVelocity;
    let nextOrigin: Vec3 = [
      previousOrigin[0] + velocity[0] * dt,
      previousOrigin[1] + velocity[1] * dt,
      previousOrigin[2] + velocity[2] * dt - (QUAKE_MONSTER_JUMP_GRAVITY * dt * dt * 0.5),
    ];
    const nextVelocity: Vec3 = [
      velocity[0],
      velocity[1],
      velocity[2] - QUAKE_MONSTER_JUMP_GRAVITY * dt,
    ];
    const nextEye: Vec3 = [
      previousEye[0] + (nextOrigin[0] - previousOrigin[0]),
      previousEye[1] + (nextOrigin[1] - previousOrigin[1]),
      previousEye[2] + (nextOrigin[2] - previousOrigin[2]),
    ];
    if (!hasLineOfSight(previousEye, nextEye)) {
      nextOrigin = [...previousOrigin] as Vec3;
      nextVelocity[0] = 0;
      nextVelocity[1] = 0;
    }

    const landed = nextVelocity[2] <= 0 ? monsterJumpLandingOrigin(shootable, nextOrigin, nextVelocity) : null;
    if (landed) {
      shootable.origin = landed;
      enemy.monsterJumpVelocity = [0, 0, 0];
    } else {
      shootable.origin = nextOrigin;
      enemy.monsterJumpVelocity = nextVelocity;
    }
    shootable.leafIndex = leafIndexAt(shootable.origin);
    if (!enemyMonsterJumpVelocityActive(enemy) && !enemyOverlapsMonsterJumpTrigger(shootable, enemy.monsterJumpTouchedTriggerEntityIndex)) {
      enemy.monsterJumpTouchedTriggerEntityIndex = null;
    }
    syncShootableTransform(shootable);
    syncShootableEnemyDatasets(shootable);
    markShootableTrace("enemy-monsterjump-flight", shootable, {
      landed: Boolean(landed),
      time: now,
      vx: enemy.monsterJumpVelocity[0],
      vy: enemy.monsterJumpVelocity[1],
      vz: enemy.monsterJumpVelocity[2],
    });
    return true;
  }

  function monsterJumpLandingOrigin(
    shootable: QuakeShootableState,
    nextOrigin: Vec3,
    nextVelocity: Vec3,
  ): Vec3 | null {
    const footZ = nextOrigin[2] + shootable.collisionBounds.min[2];
    const traceDistance = Math.max(
      STEP_HEIGHT + GROUND_SNAP,
      Math.abs(nextVelocity[2]) * QUAKE_ENEMY_DT_CLAMP + GROUND_SNAP,
    );
    const floorZ = quakeMonsterDropFloorAt(
      nextOrigin,
      shootable.collisionBounds,
      footZ + GROUND_SNAP,
      footZ - traceDistance,
      floorAt,
    );
    if (floorZ === null || footZ > floorZ + GROUND_SNAP) return null;
    return [
      nextOrigin[0],
      nextOrigin[1],
      nextOrigin[2] + floorZ - footZ,
    ];
  }

  function applyEnemyMonsterJumpTriggers(shootable: QuakeShootableState): boolean {
    const enemy = shootable.enemy;
    if (!enemy || monsterJumpTriggers.length === 0 || enemyMonsterJumpVelocityActive(enemy)) return false;
    const bounds = shootableCollisionWorldBounds(shootable);
    const trigger = monsterJumpTriggers.find((candidate) => aabbsOverlap(bounds, candidate.bounds));
    if (!trigger) {
      enemy.monsterJumpTouchedTriggerEntityIndex = null;
      return false;
    }
    if (enemy.monsterJumpTouchedTriggerEntityIndex === trigger.entityIndex) return false;
    const startKind = quakeMonsterStartKind(shootable.entity);
    const activation = quakeTriggerMonsterJumpActivationFromRule(trigger.rule, {
      isFlying: startKind === "fly",
      isMonster: shootable.entity.classname.startsWith("monster_"),
      isSwimming: startKind === "swim",
      onGround: enemyOnGround(shootable),
    });
    if (!activation) return false;
    const velocity: Vec3 = [
      activation.velocity[0] * QUAKE_COLLISION_UNIT_SCALE,
      activation.velocity[1] * QUAKE_COLLISION_UNIT_SCALE,
      activation.velocity[2] * QUAKE_COLLISION_UNIT_SCALE,
    ];
    enemy.monsterJumpTouchedTriggerEntityIndex = trigger.entityIndex;
    enemy.monsterJumpVelocity = velocity;
    clearQuakecMovementBudget(enemy);
    markShootableTrace("enemy-monsterjump-touch", shootable, {
      trigger: trigger.entityIndex,
      verticalApplied: activation.verticalApplied,
      vx: velocity[0],
      vy: velocity[1],
      vz: velocity[2],
    });
    return true;
  }

  function enemyOverlapsMonsterJumpTrigger(
    shootable: QuakeShootableState,
    triggerEntityIndex: number | null,
  ): boolean {
    if (triggerEntityIndex === null) return false;
    const trigger = monsterJumpTriggers.find((candidate) => candidate.entityIndex === triggerEntityIndex);
    return Boolean(trigger && aabbsOverlap(shootableCollisionWorldBounds(shootable), trigger.bounds));
  }

  function enemyMonsterJumpVelocityActive(enemy: QuakeEnemyState): boolean {
    const velocity = enemy.monsterJumpVelocity;
    return Math.abs(velocity[0]) > QUAKE_SHOOTABLE_COLLISION_EPSILON ||
      Math.abs(velocity[1]) > QUAKE_SHOOTABLE_COLLISION_EPSILON ||
      Math.abs(velocity[2]) > QUAKE_SHOOTABLE_COLLISION_EPSILON;
  }

  function enemyOnGround(shootable: QuakeShootableState): boolean {
    const footZ = shootable.origin[2] + shootable.collisionBounds.min[2];
    const floorZ = quakeMonsterDropFloorAt(
      shootable.origin,
      shootable.collisionBounds,
      footZ + GROUND_SNAP,
      footZ - GROUND_SNAP,
      floorAt,
    );
    return floorZ !== null && Math.abs(footZ - floorZ) <= GROUND_SNAP;
  }

  function advanceMonsterMovetargetIfReached(shootable: QuakeShootableState, enemy: QuakeEnemyState): boolean {
    const target = enemy.movetarget;
    if (!target || !monsterTouchesPathCorner(shootable, target)) {
      return false;
    }
    enemy.movetarget = target.target ? monsterPathCornersByTargetname.get(target.target) ?? null : null;
    clearQuakecMovementBudget(enemy);
    if (enemy.movetarget) enemy.quakecIdealYaw = quakeYawToOrigin(shootable.origin, enemy.movetarget.origin);
    markShootableTrace("enemy-path-corner", shootable, {
      next: enemy.movetarget?.targetname ?? null,
      targetname: target.targetname,
    });
    return true;
  }

  function monsterTouchesPathCorner(
    shootable: QuakeShootableState,
    target: QuakeMonsterPathCorner,
  ): boolean {
    const halfExtent = QUAKE_MONSTER_PATH_CORNER_HALF_EXTENT;
    return aabbsOverlap(shootableCollisionWorldBounds(shootable), {
      min: [
        target.origin[0] - halfExtent,
        target.origin[1] - halfExtent,
        target.origin[2] - halfExtent,
      ],
      max: [
        target.origin[0] + halfExtent,
        target.origin[1] + halfExtent,
        target.origin[2] + halfExtent,
      ],
    });
  }

  function shouldCheckQuakecAttackBeforeMove(shootable: QuakeShootableState): boolean {
    return Boolean(shootable.enemy?.quakecRunner && quakecMonsterHasRunMovement(shootable.entity.classname));
  }

  function shouldAttemptEnemyAttack(
    canSeeTarget: boolean,
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    now: number,
  ): boolean {
    if (canSeeTarget) return true;
    return now >= enemy.nextAttackAt && quakeShootableAttackHasBranchSightCheck(shootable);
  }

  function tryStartEnemyAttack(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    enemyEye: Vec3,
    targetOrigin: [number, number, number],
    profile: QuakeMonsterCombatProfile,
    now: number,
    target: QuakeEnemyAttackTarget,
  ): boolean {
    const attackDistance = enemyAttackDecisionDistance(shootable, enemyEye, targetOrigin);
    if (attackDistance > profile.range) {
      clearEnemyAttackState(shootable);
      return false;
    }
    if (now < enemy.nextAttackAt) return false;
    combatBudget.recordAttackChainCheck(now);
    const quakecAttackChain = selectEnemyAttackChain(shootable, enemy, attackDistance, targetOrigin, now, target);
    if (quakecAttackChain === null) return false;
    enemyMovement.faceShootableAtOrigin(shootable, targetOrigin);
    clearQuakecMovementBudget(enemy);
    if (enemy.burstShotsRemaining > 0) {
      playEnemyAttackAnimation(shootable, now);
      performEnemyAttack(shootable, enemy, enemyEye, targetOrigin, profile, now, target);
      return true;
    }
    startEnemyAttackWindup(shootable, enemy, targetOrigin, profile, now, target, quakecAttackChain);
    return true;
  }

  function enemyAttackDecisionDistance(
    shootable: QuakeShootableState,
    enemyEye: Vec3,
    targetOrigin: [number, number, number],
  ): number {
    if (shootable.entity.classname === "monster_dog" || shootable.entity.classname === "monster_demon1") {
      return Math.hypot(targetOrigin[0] - shootable.origin[0], targetOrigin[1] - shootable.origin[1]);
    }
    return Math.sqrt(distanceSq3(enemyEye, targetOrigin));
  }

  function selectEnemyAttackChain(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    distance: number,
    playerOrigin: [number, number, number],
    now: number,
    target: QuakeEnemyAttackTarget,
  ): string | null | undefined {
    return selectQuakeEnemyAttackChain(enemyCombat, shootable, enemy, distance, playerOrigin, now, target);
  }

  function quakecScaleUnits(value: number): number {
    return value * QUAKE_COLLISION_UNIT_SCALE;
  }

  function startEnemyAttackWindup(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    targetOrigin: [number, number, number],
    profile: QuakeMonsterCombatProfile,
    now: number,
    target: QuakeEnemyAttackTarget,
    quakecAttackChain?: string,
  ): void {
    const quakecAttackEvents = quakeShootableUsesQuakecAttackEvents(shootable);
    enemy.burstShotsRemaining = quakecAttackEvents ? 0 : Math.max(0, Math.round(profile.burstCount ?? 1) - 1);
    const windupMs = Math.max(0, profile.windupMs ?? 0);
    enemy.pendingAttack = {
      fireAt: quakecAttackEvents ? Infinity : now + windupMs,
      ...(quakecAttackChain ? { quakecChain: quakecAttackChain } : {}),
      target: [...targetOrigin] as Vec3,
    };
    enemy.attackVisual = "windup";
    if (quakecAttackEvents) {
      enemy.quakecAnimationChain = null;
      enemy.quakecFiredEvents.clear();
      updateEnemyAnimation(shootable, "attack", now, {
        enemyEye: shootableEyeOrigin(shootable),
        forceAttackEvents: enemy.pendingAttack.forceAttackEvents,
        playerOrigin: targetOrigin,
        profile,
        target,
      });
    } else {
      playEnemyAttackAnimation(shootable, now);
    }
    syncShootableEnemyDatasets(shootable);
    markShootableTrace("enemy-attack-windup", shootable, {
      kind: profile.kind ?? "hitscan",
      damage: profile.damage,
      windupMs,
      burstRemaining: enemy.burstShotsRemaining,
    });
    if (!quakecAttackEvents && windupMs <= 0) {
      performEnemyAttack(shootable, enemy, shootableEyeOrigin(shootable), targetOrigin, profile, now, target);
    }
  }

  function performEnemyAttack(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    enemyEye: Vec3,
    targetOrigin: [number, number, number],
    profile: QuakeMonsterCombatProfile,
    now: number,
    targetRef: QuakeEnemyAttackTarget,
  ): void {
    const target = enemy.pendingAttack?.target ?? targetOrigin;
    enemy.pendingAttack = null;
    enemy.attackVisual = "cooldown";
    syncShootableEnemyDatasets(shootable);
    markShootableTrace("enemy-attack", shootable, {
      kind: profile.kind ?? "hitscan",
      damage: profile.damage,
      burstRemaining: enemy.burstShotsRemaining,
    });
    if (profile.kind === "projectile") {
      enemyProjectiles.spawn(
        shootable,
        enemy,
        quakeEnemyProjectileAttackOrigin(shootable, enemyEye, targetOrigin, profile),
        target,
        profile,
        now,
      );
    } else {
      targetRef.damage?.(profile.damage, {
        attacker: shootableDamageActor(shootable),
        inflictor: shootableDamageActor(shootable),
      });
    }
    if (enemy.burstShotsRemaining > 0) {
      enemy.burstShotsRemaining -= 1;
      enemy.nextAttackAt = now + Math.max(40, profile.burstIntervalMs ?? 140);
      return;
    }
    if (!quakecAttackCooldownStartsOnSelection(shootable)) {
      enemy.nextAttackAt = now + quakeEnemyCooldownMs(enemyCombat, profile, enemy);
    }
  }

  function clearEnemyAttackState(shootable: QuakeShootableState): void {
    const enemy = shootable.enemy;
    if (!enemy) return;
    if (!enemy.pendingAttack &&
      !enemy.quakecActiveTouchDamage &&
      enemy.burstShotsRemaining === 0 &&
      enemy.attackVisual === null
    ) return;
    enemy.pendingAttack = null;
    enemy.burstShotsRemaining = 0;
    enemy.quakecActiveTouchDamage = null;
    enemy.attackVisual = null;
    syncShootableEnemyDatasets(shootable);
  }

  function initializeEnemyAnimation(shootable: QuakeShootableState, now: number): void {
    const enemy = shootable.enemy;
    const profile = quakeMonsterAnimationProfile(shootable);
    if (!enemy || !profile || !shootable.model?.animationFrames?.length) return;
    if (shootable.dead) {
      deathState.syncCorpseAnimationFrame(shootable);
      return;
    }
    enemy.animationMode = "idle";
    enemy.animationFrameIndex = boundedAnimationRange(profile.idle, shootable.model).start;
    enemy.nextAnimationFrameAt = now + enemyAnimationFrameDuration(profile, "idle");
  }

  function updateEnemyAnimation(
    shootable: QuakeShootableState,
    mode: QuakeMonsterAnimationMode,
    now: number,
    context?: QuakeEnemyAnimationContext,
  ): void {
    if (updateEnemyQuakecAnimation(shootable, mode, now, context)) return;
    const enemy = shootable.enemy;
    const profile = quakeMonsterAnimationProfile(shootable);
    const model = shootable.model;
    if (!enemy || !profile || !model?.animationFrames?.length || !presentation.hasHandle(shootable) || !presentation.isVisible(shootable)) return;
    const range = boundedAnimationRange(enemyAnimationRange(profile, mode), model);
    if (enemy.animationMode !== mode ||
      enemy.animationFrameIndex < range.start ||
      enemy.animationFrameIndex > range.end
    ) {
      const previousFrameIndex = enemy.animationFrameIndex;
      enemy.animationMode = mode;
      enemy.animationFrameIndex = range.start;
      enemy.nextAnimationFrameAt = now + enemyAnimationFrameDuration(profile, mode);
      if (enemy.animationFrameIndex !== previousFrameIndex) {
        activateShootableAnimationFrame(shootable, enemy.animationFrameIndex);
      } else {
        syncShootableEnemyDatasets(shootable);
      }
      return;
    }
    if (now < enemy.nextAnimationFrameAt) return;
    if (enemy.animationFrameIndex >= range.end && !enemyAnimationModeLoops(mode)) {
      enemy.nextAnimationFrameAt = Infinity;
      return;
    }
    const nextFrameIndex = enemy.animationFrameIndex >= range.end ? range.start : enemy.animationFrameIndex + 1;
    enemy.nextAnimationFrameAt = now + enemyAnimationFrameDuration(profile, mode);
    if (nextFrameIndex === enemy.animationFrameIndex) return;
    enemy.animationFrameIndex = nextFrameIndex;
    activateShootableAnimationFrame(shootable, enemy.animationFrameIndex);
  }

  function updateEnemyQuakecAnimation(
    shootable: QuakeShootableState,
    mode: QuakeMonsterAnimationMode,
    now: number,
    context?: QuakeEnemyAnimationContext,
  ): boolean {
    const enemy = shootable.enemy;
    const runner = enemy?.quakecRunner;
    const model = shootable.model;
    if (!enemy || !runner) return false;
    if (!model?.animationFrames?.length) return true;
    const chain = quakecAnimationChainForMode(shootable, mode);
    if (!chain) return false;
    if (enemy.quakecAnimationChain !== chain || enemy.animationMode !== mode) {
      const step = runner.enterChain(chain);
      if (!step) return false;
      enemy.quakecAnimationChain = chain;
      if (mode === "attack") enemy.quakecFiredEvents.clear();
      applyEnemyQuakecAnimationStep(shootable, step, mode, now, context);
      return true;
    }
    if (now < enemy.nextAnimationFrameAt) return true;
    applyEnemyQuakecAnimationStep(shootable, runner.advance(), mode, now, context);
    return true;
  }

  function applyEnemyQuakecAnimationStep(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    mode: QuakeMonsterAnimationMode,
    now: number,
    context?: QuakeEnemyAnimationContext,
  ): void {
    const enemy = shootable.enemy;
    const model = shootable.model;
    if (!enemy || !model?.animationFrames?.length) return;
    const previousFrameIndex = enemy.animationFrameIndex;
    const frameIndex = Math.max(0, Math.min(model.animationFrames.length - 1, step.frameIndex));
    enemy.animationMode = mode;
    enemy.animationFrameIndex = frameIndex;
    enemy.quakecLastState = step;
    enemy.nextAnimationFrameAt = now + QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;
    deathState.syncZombiePainDownStep(shootable, step, enemy);
    if (frameIndex !== previousFrameIndex) {
      activateShootableAnimationFrame(shootable, frameIndex);
    } else {
      syncShootableEnemyDatasets(shootable);
    }
    markShootableTrace("enemy-quakec-state", shootable, {
      calls: step.calls.join(","),
      chain: step.chain,
      chainCycleEnd: step.chainCycleEnd,
      frame: step.frame,
      frameIndex,
      next: step.next,
      state: step.stateName,
    });
    const runAttackEvents = mode !== "attack" || enemyAttackRuntimeEnabled() || context?.forceAttackEvents === true;
    if (runAttackEvents) {
      enemyCombat.runFrameSounds(shootable, step, mode, now);
      enemyCombat.runFrameEvents(shootable, step, mode, now, context);
      applyQuakecTouchDamageMovement(shootable, step);
    }
    deathState.runFrameDeathOutputEvents(shootable, step, mode, now);
    syncEnemyQuakecMovementBudget(enemy, shootable.entity.classname, step, mode);
    const attackChain = enemy.pendingAttack?.quakecChain ?? quakeShootableAttackChain(shootable) ?? "attack";
    if (mode === "attack" && runAttackEvents && (step.chain !== attackChain || (step.chainCycleEnd && !enemy.quakecActiveTouchDamage))) {
      enemyCombat.finishAttack(shootable, context?.profile, now);
    }
    if ((mode === "death" || mode === "pain") && step.chainCycleEnd) {
      enemy.nextAnimationFrameAt = Infinity;
    }
  }

  function applyQuakecTouchDamageMovement(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy) return;
    const touch = step.events.find((event) => event.type === "touch_damage");
    if (!touch) return;
    if (touch.call !== "Dog_JumpTouch") return;
    if (enemy.monsterJumpVelocity.some((value) => Math.abs(value) > COLLISION_EPSILON)) return;
    const yawRadians = ((shootable.yaw ?? 0) * Math.PI) / 180;
    const forwardSpeed = touch.minVelocityUnits * QUAKE_COLLISION_UNIT_SCALE;
    enemy.monsterJumpVelocity = [
      Math.cos(yawRadians) * forwardSpeed,
      Math.sin(yawRadians) * forwardSpeed,
      200 * QUAKE_COLLISION_UNIT_SCALE,
    ];
    shootable.origin = [
      shootable.origin[0],
      shootable.origin[1],
      shootable.origin[2] + QUAKE_COLLISION_UNIT_SCALE,
    ];
    shootable.leafIndex = leafIndexAt(shootable.origin);
    clearQuakecMovementBudget(enemy);
    markShootableTrace("enemy-quakec-touch-flight", shootable, {
      call: touch.call,
      forwardSpeedUnits: touch.minVelocityUnits,
      upSpeedUnits: 200,
    });
    syncShootableTransform(shootable);
    syncShootableEnemyDatasets(shootable);
  }

  function syncAnimationPresentation(): void {
    if (!enemyAnimationPresentationEnabled()) return;
    for (const shootable of shootables.values()) {
      if (!shootable.enemy || !presentation.hasHandle(shootable) || !presentation.isVisible(shootable)) continue;
      activateShootableAnimationFrame(shootable, enemyAnimationFrameIndex(shootable));
    }
  }

  function quakecPlayerDamageBounds(origin: [number, number, number] | Vec3): QuakeBounds {
    const eyeHeight = Math.max(getPlayerEyeHeight(), PLAYER_HEIGHT);
    const minZ = origin[2] - eyeHeight;
    const maxZ = Math.max(origin[2] + PLAYER_RADIUS * 0.25, minZ + PLAYER_HEIGHT);
    return {
      min: [origin[0] - PLAYER_RADIUS, origin[1] - PLAYER_RADIUS, minZ],
      max: [origin[0] + PLAYER_RADIUS, origin[1] + PLAYER_RADIUS, maxZ],
    };
  }

  function quakecBoundsCenter(bounds: QuakeBounds): Vec3 {
    return [
      (bounds.min[0] + bounds.max[0]) * 0.5,
      (bounds.min[1] + bounds.max[1]) * 0.5,
      (bounds.min[2] + bounds.max[2]) * 0.5,
    ];
  }

  function activateShootableAnimationFrame(shootable: QuakeShootableState, frameIndex: number): void {
    if (!enemyAnimationPresentationEnabled()) return;
    if (shouldThrottleShootableAnimationFrame(shootable)) {
      syncShootableEnemyDatasets(shootable);
      markShootableTrace("enemy-animation-frame-throttled", shootable, {
        requestedFrame: frameIndex,
        handles: countShootableHandles(shootable),
      });
      return;
    }
    if (!presentation.hasHandle(shootable) || !presentation.isVisible(shootable)) {
      markShootableTrace("enemy-animation-frame-logical", shootable, {
        requestedFrame: frameIndex,
        handles: countShootableHandles(shootable),
      });
      return;
    }
    if (presentation.activateFrame(shootable, frameIndex, canPoolShootableAnimationFrames(shootable)) === "pool") {
      scheduleNextShootableAnimationFramePrewarm(shootable);
    }
  }

  function shouldThrottleShootableAnimationFrame(shootable: QuakeShootableState): boolean {
    if (!shootable.enemy || !presentation.hasHandle(shootable) || !presentation.isVisible(shootable)) return false;
    if (shootable.dead || shootable.enemy.animationMode === "death") return false;
    const depth = shootableCameraDepth(shootable, getPlayerOrigin());
    return depth > 0 && depth < shootableFrameSwapSafeDepth(shootable);
  }

  function shootableFrameSwapSafeDepth(shootable: QuakeShootableState): number {
    const verticalSpan = Math.max(0, shootable.bounds.max[2] - shootable.bounds.min[2]);
    return verticalSpan * QUAKE_SHOOTABLE_FRAME_SWAP_SAFE_VERTICAL_FACTOR +
      shootableHorizontalRadius(shootable) * QUAKE_SHOOTABLE_FRAME_SWAP_SAFE_RADIUS_FACTOR;
  }

  function shootableCameraDepth(shootable: QuakeShootableState, playerOrigin: Vec3): number {
    const forward = getPlayerForward();
    const forwardHorizontal = normalizeVec3([forward[0], forward[1], 0]);
    if (Math.abs(forwardHorizontal[0]) <= COLLISION_EPSILON &&
      Math.abs(forwardHorizontal[1]) <= COLLISION_EPSILON) {
      return Infinity;
    }
    const toShootable: Vec3 = [
      shootable.origin[0] - playerOrigin[0],
      shootable.origin[1] - playerOrigin[1],
      0,
    ];
    return dotVec3(toShootable, forwardHorizontal);
  }







  function enemyAnimationFrameIndex(shootable: QuakeShootableState): number {
    return shootable.enemy?.animationFrameIndex ?? 0;
  }

  function nextShootableAnimationFrameIndex(shootable: QuakeShootableState): number | undefined {
    const enemy = shootable.enemy;
    const profile = quakeMonsterAnimationProfile(shootable);
    const model = shootable.model;
    if (!enemy || !profile || !model?.animationFrames?.length) return undefined;
    const range = boundedAnimationRange(enemyAnimationRange(profile, enemy.animationMode), model);
    if (!enemyAnimationModeLoops(enemy.animationMode) && enemy.animationFrameIndex >= range.end) return range.end;
    return enemy.animationFrameIndex >= range.end ? range.start : enemy.animationFrameIndex + 1;
  }

  function playEnemyAttackAnimation(shootable: QuakeShootableState, now: number): void {
    startEnemyOneShotAnimation(shootable, "attack", now);
  }

  function playEnemyPainAnimation(shootable: QuakeShootableState, now: number, damageAmount: number): boolean {
    const enemy = shootable.enemy;
    if (!enemy) return false;
    if (enemy.animationMode === "attack" && enemyAnimationLocked(enemy, now)) return false;
    const chain = shootable.entity.classname === "monster_zombie"
      ? enemy.quakecPainChain ?? "pain_a"
      : selectEnemyPainReactionChain(shootable, enemy, now, damageAmount, nextQuakecRandom);
    if (!chain) return false;
    enemy.quakecPainChain = chain;
    return startEnemyQuakecNamedChain(shootable, chain, "pain", now) !== null;
  }

  function startEnemyQuakecOneShotAnimation(
    shootable: QuakeShootableState,
    mode: "death" | "pain",
    now: number,
  ): number | null {
    return startEnemyQuakecNamedChain(shootable, quakecAnimationChainForMode(shootable, mode), mode, now);
  }

  function startEnemyQuakecNamedChain(
    shootable: QuakeShootableState,
    chain: string,
    mode: QuakeMonsterAnimationMode,
    now: number,
    context?: QuakeEnemyAnimationContext,
  ): number | null {
    const enemy = shootable.enemy;
    const runner = enemy?.quakecRunner;
    const model = shootable.model;
    if (!enemy || !runner || !model?.animationFrames?.length || !presentation.hasHandle(shootable) || !presentation.isVisible(shootable)) {
      return null;
    }
    if (!runner.hasChain(chain)) return null;
    const step = runner.enterChain(chain);
    if (!step) return null;
    const duration = quakeMonsterChainDurationMs(shootable.entity.classname, chain, runner);
    enemy.quakecAnimationChain = chain;
    enemy.animationLockUntil = now + duration;
    enemy.nextAnimationFrameAt = now + QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;
    applyEnemyQuakecAnimationStep(shootable, step, mode, now, context);
    return duration;
  }

  function startEnemyOneShotAnimation(
    shootable: QuakeShootableState,
    mode: "attack" | "death" | "pain",
    now: number,
  ): number | null {
    const enemy = shootable.enemy;
    const profile = quakeMonsterAnimationProfile(shootable);
    const model = shootable.model;
    const range = profile ? enemyOptionalAnimationRange(profile, mode) : undefined;
    if (!enemy || !profile || !range || !model?.animationFrames?.length || !presentation.hasHandle(shootable) || !presentation.isVisible(shootable)) {
      return null;
    }
    const boundedRange = boundedAnimationRange(range, model);
    const frameDuration = enemyAnimationFrameDuration(profile, mode);
    const duration = Math.max(frameDuration, (boundedRange.end - boundedRange.start + 1) * frameDuration);
    enemy.animationMode = mode;
    enemy.animationFrameIndex = boundedRange.start;
    enemy.animationLockUntil = now + duration;
    enemy.nextAnimationFrameAt = now + frameDuration;
    activateShootableAnimationFrame(shootable, enemy.animationFrameIndex);
    return duration;
  }

  function enemyAnimationLocked(enemy: QuakeEnemyState, now: number): boolean {
    return !enemyAnimationModeLoops(enemy.animationMode) && enemy.animationLockUntil > now;
  }

  function spawnMonsterDeathOutputVisuals(
    shootable: QuakeShootableState,
    gib: QuakeMonsterDeathGibOutput,
  ): void {
    if (!presentation.isVisible(shootable) || !presentation.hasHandle(shootable) || !currentModelLibrary) return;
    const pieces = gib.pieces?.length
      ? gib.pieces.map((piece) => ({
          kind: piece.call === "ThrowHead" ? "head" : "gib",
          path: piece.modelPath,
        }))
      : [
          ...(gib.headModelPath ? [{ kind: "head", path: gib.headModelPath }] : []),
          ...gib.gibModelPaths.map((path) => ({ kind: "gib", path })),
        ];
    const count = Math.max(1, pieces.length);
    const floorZ = shootable.origin[2] + shootable.collisionBounds.min[2];
    for (const [index, item] of pieces.entries()) {
      const model = currentModelLibrary.models[item.path];
      if (!model) continue;
      const angle = (shootable.yaw * Math.PI) / 180 + (index / count) * Math.PI * 2;
      const radius = item.kind === "head" ? 0.08 : 0.18 + (index % 3) * 0.04;
      const origin: Vec3 = [
        shootable.origin[0] + Math.cos(angle) * radius,
        shootable.origin[1] + Math.sin(angle) * radius,
        floorZ - model.bounds.min[2],
      ];
      const yaw = shootable.yaw + index * 37;
      const handle = addMonsterDeathOutputMesh(shootable, model, origin, yaw, item.kind);
      if (!handle) continue;
      const output: QuakeMonsterDeathOutputVisualHandle = { handle };
      const animation = monsterDeathOutputArcAnimation(model, origin, angle, index, item.kind, yaw);
      if (animation && activeDeathOutputAnimations.size < QUAKE_MONSTER_DEATH_OUTPUT_ARC_MAX_ACTIVE) {
        output.animation = animation;
        activeDeathOutputAnimations.add(output);
      }
      deathOutputHandles.push(output);
    }
    scheduleDeathOutputAnimationFrame();
  }

  function addMonsterDeathOutputMesh(
    shootable: QuakeShootableState,
    model: QuakePickupModel,
    origin: Vec3,
    yaw: number,
    kind: string,
  ): PolyMeshHandle | null {
    const entity: QuakeEntity = {
      index: -200000 - shootable.entity.index * 10 - deathOutputHandles.length,
      classname: "monster_death_output",
      origin: shootable.entity.origin,
      properties: {},
    };
    const handle = addMesh(entity, model, 0);
    if (!handle) return null;
    visibilityChurn.totalMeshHandlesCreated++;
    handle.element.classList.add(QUAKE_MONSTER_DEATH_OUTPUT_CLASS, `${QUAKE_MONSTER_DEATH_OUTPUT_CLASS}-${kind}`);
    stripPolyMeshMetadata(handle.element);
    handle.setTransform({
      position: origin,
      rotation: [0, 0, normalizeShootableYaw(yaw, true)],
      scale: model.renderScale ? 1 / model.renderScale : 1,
    });
    return handle;
  }

  function monsterDeathOutputArcAnimation(
    model: QuakePickupModel,
    origin: Vec3,
    angle: number,
    index: number,
    kind: string,
    yaw: number,
  ): NonNullable<QuakeMonsterDeathOutputVisualHandle["animation"]> | null {
    if (typeof window.requestAnimationFrame !== "function") return null;
    const horizontalSpeed = (kind === "head" ? 70 : 95 + (index % 3) * 18) * QUAKE_COLLISION_UNIT_SCALE;
    const verticalSpeed = (kind === "head" ? 190 : 150 + (index % 2) * 35) * QUAKE_COLLISION_UNIT_SCALE;
    return {
      elapsedMs: 0,
      lastAt: 0,
      landingZ: origin[2],
      position: [...origin] as Vec3,
      renderYaw: normalizeShootableYaw(yaw, true),
      scale: model.renderScale ? 1 / model.renderScale : 1,
      velocity: [
        Math.cos(angle) * horizontalSpeed,
        Math.sin(angle) * horizontalSpeed,
        verticalSpeed,
      ],
    };
  }

  function scheduleDeathOutputAnimationFrame(): void {
    if (deathOutputAnimationFrame !== null || activeDeathOutputAnimations.size === 0) return;
    deathOutputAnimationFrame = window.requestAnimationFrame(tickDeathOutputAnimations);
  }

  function tickDeathOutputAnimations(frameNow: number): void {
    deathOutputAnimationFrame = null;
    const now = Number.isFinite(frameNow) ? frameNow : performance.now();
    for (const output of [...activeDeathOutputAnimations]) {
      const animation = output.animation;
      if (!animation) {
        activeDeathOutputAnimations.delete(output);
        continue;
      }
      const dt = Math.min(
        QUAKE_MONSTER_DEATH_OUTPUT_ARC_DT_CLAMP,
        animation.lastAt ? Math.max(0, (now - animation.lastAt) / 1000) : 0.0167,
      );
      animation.lastAt = now;
      animation.elapsedMs += dt * 1000;
      animation.velocity[2] -= QUAKE_MONSTER_DEATH_OUTPUT_ARC_GRAVITY * dt;
      animation.position = [
        animation.position[0] + animation.velocity[0] * dt,
        animation.position[1] + animation.velocity[1] * dt,
        animation.position[2] + animation.velocity[2] * dt,
      ];
      if (animation.position[2] <= animation.landingZ || animation.elapsedMs >= QUAKE_MONSTER_DEATH_OUTPUT_ARC_MAX_MS) {
        animation.position = [animation.position[0], animation.position[1], animation.landingZ];
        activeDeathOutputAnimations.delete(output);
        delete output.animation;
      }
      output.handle.setTransform({
        position: animation.position,
        rotation: [0, 0, animation.renderYaw],
        scale: animation.scale,
      });
    }
    scheduleDeathOutputAnimationFrame();
  }

  function isPersistentShootableCorpse(shootable: QuakeShootableState): boolean {
    if (quakeBossScriptedLifecycle(shootable.entity.classname)) return false;
    return deathState.isPersistentCorpse(shootable);
  }

  function isShootableDeathAnimating(shootable: QuakeShootableState, now = performance.now()): boolean {
    return deathState.isDeathAnimating(shootable, now);
  }

  function isZombieRecovering(shootable: QuakeShootableState, now = performance.now()): boolean {
    return deathState.isZombieRecovering(shootable, now);
  }

  function isZombieNonSolid(shootable: QuakeShootableState, now = performance.now()): boolean {
    return deathState.isZombieNonSolid(shootable, now);
  }

  function syncShootableLifecycleClassesForShootable(shootable: QuakeShootableState): void {
    presentation.syncLifecycle(shootable);
  }

  function shootableLifecycleClassState(shootable: QuakeShootableState): {
    deathAnimating: boolean;
    persistentCorpse: boolean;
  } {
    return {
      deathAnimating: isShootableDeathAnimating(shootable),
      persistentCorpse: isPersistentShootableCorpse(shootable),
    };
  }

  function syncShootableTransform(shootable: QuakeShootableState, yaw = shootable.yaw): void {
    shootable.yaw = yaw;
    presentation.syncTransform(shootable, yaw);
  }


  function syncEnemyMotionMaterialsForView(origin: [number, number, number], reason: string): void {
    if (!enemyMotionMaterial) return;
    const forward = getPlayerForward();
    const originChanged = !lastMotionMaterialOrigin ||
      distanceSq3(origin, lastMotionMaterialOrigin) > QUAKE_SHOOTABLE_MOTION_MATERIAL_ORIGIN_EPSILON_SQ;
    const forwardChanged = !lastMotionMaterialForward ||
      distanceSq3(forward, lastMotionMaterialForward) > QUAKE_SHOOTABLE_MOTION_MATERIAL_FORWARD_EPSILON_SQ;
    lastMotionMaterialOrigin = [...origin] as Vec3;
    lastMotionMaterialForward = [...forward] as Vec3;
    if (!originChanged && !forwardChanged) return;
    for (const shootable of shootables.values()) {
      presentation.markMotionMaterial(shootable, reason);
    }
  }


  function normalizeShootableYaw(yaw: number, hasAliasModel = false): number {
    return hasAliasModel ? quakeAliasModelRenderYaw(yaw) : normalizeQuakeRenderYaw(yaw);
  }

  function shootableEyeOrigin(shootable: QuakeShootableState): Vec3 {
    const bounds = shootableBounds(shootable);
    return [
      (bounds.min[0] + bounds.max[0]) * 0.5,
      (bounds.min[1] + bounds.max[1]) * 0.5,
      bounds.min[2] + (bounds.max[2] - bounds.min[2]) * 0.75,
    ];
  }

  function shootableMountVisibilityTargets(shootable: QuakeShootableState): Vec3[] {
    const bounds = shootableBounds(shootable);
    const centerX = (bounds.min[0] + bounds.max[0]) * 0.5;
    const centerY = (bounds.min[1] + bounds.max[1]) * 0.5;
    const centerZ = (bounds.min[2] + bounds.max[2]) * 0.5;
    const upperZ = bounds.min[2] + (bounds.max[2] - bounds.min[2]) * 0.75;
    return [
      [centerX, centerY, upperZ],
      [centerX, centerY, centerZ],
      [bounds.min[0], centerY, centerZ],
      [bounds.max[0], centerY, centerZ],
      [centerX, bounds.min[1], centerZ],
      [centerX, bounds.max[1], centerZ],
    ];
  }

  function shootableHasPlayerViewTargetAtDot(
    shootable: QuakeShootableState,
    playerOrigin: Vec3,
    minDot: number,
  ): boolean {
    return shootableMountVisibilityTargets(shootable).some(
      (target) => playerViewDotFromOrigin(playerOrigin, target) >= minDot,
    );
  }

  function playerViewDotFromOrigin(playerOrigin: Vec3, point: Vec3): number {
    const toPoint: Vec3 = [point[0] - playerOrigin[0], point[1] - playerOrigin[1], 0];
    const toPointLength = Math.hypot(toPoint[0], toPoint[1]);
    if (toPointLength <= COLLISION_EPSILON) return 1;
    const forward = getPlayerForward();
    const forwardHorizontal: Vec3 = [forward[0], forward[1], 0];
    const forwardLength = Math.hypot(forwardHorizontal[0], forwardHorizontal[1]);
    if (forwardLength <= COLLISION_EPSILON) return 1;
    return (
      (toPoint[0] / toPointLength) * (forwardHorizontal[0] / forwardLength) +
      (toPoint[1] / toPointLength) * (forwardHorizontal[1] / forwardLength)
    );
  }

  function playerOverlapsShootable(
    origin: [number, number, number],
    eyeHeight: number,
    shootable: QuakeShootableState,
  ): boolean {
    const envelope = shootablePlayerCollisionEnvelope(shootable);
    const bounds = envelope.bounds;
    const playerMinZ = origin[2] - eyeHeight;
    const playerMaxZ = playerMinZ + PLAYER_HEIGHT;
    if (playerMaxZ <= bounds.min[2] || playerMinZ >= bounds.max[2]) return false;
    return origin[0] >= bounds.min[0] - envelope.playerRadius &&
      origin[0] <= bounds.max[0] + envelope.playerRadius &&
      origin[1] >= bounds.min[1] - envelope.playerRadius &&
      origin[1] <= bounds.max[1] + envelope.playerRadius;
  }

  function pushPlayerOutOfShootable(
    origin: [number, number, number],
    previous: [number, number, number],
    shootable: QuakeShootableState,
    validateOrigin?: QuakeShootableCollisionOriginValidator,
  ): [number, number, number] {
    const envelope = shootablePlayerCollisionEnvelope(shootable);
    const bounds = envelope.bounds;
    const minX = bounds.min[0] - envelope.playerRadius - QUAKE_SHOOTABLE_COLLISION_EPSILON;
    const maxX = bounds.max[0] + envelope.playerRadius + QUAKE_SHOOTABLE_COLLISION_EPSILON;
    const minY = bounds.min[1] - envelope.playerRadius - QUAKE_SHOOTABLE_COLLISION_EPSILON;
    const maxY = bounds.max[1] + envelope.playerRadius + QUAKE_SHOOTABLE_COLLISION_EPSILON;
    const candidates: [number, number, number][] = [];
    const addCandidate = (candidate: [number, number, number]): void => {
      if (candidates.some((existing) => distanceSq3(existing, candidate) <= COLLISION_EPSILON)) return;
      candidates.push(candidate);
    };

    if (previous[0] <= minX) addCandidate([minX, origin[1], origin[2]]);
    if (previous[0] >= maxX) addCandidate([maxX, origin[1], origin[2]]);
    if (previous[1] <= minY) addCandidate([origin[0], minY, origin[2]]);
    if (previous[1] >= maxY) addCandidate([origin[0], maxY, origin[2]]);

    const distances = [
      { value: Math.abs(origin[0] - minX), origin: [minX, origin[1], origin[2]] as [number, number, number] },
      { value: Math.abs(maxX - origin[0]), origin: [maxX, origin[1], origin[2]] as [number, number, number] },
      { value: Math.abs(origin[1] - minY), origin: [origin[0], minY, origin[2]] as [number, number, number] },
      { value: Math.abs(maxY - origin[1]), origin: [origin[0], maxY, origin[2]] as [number, number, number] },
    ];
    distances.sort((a, b) => a.value - b.value);
    for (const distance of distances) addCandidate(distance.origin);
    if (!validateOrigin) return candidates[0] ?? origin;
    const validated = candidates.find(validateOrigin);
    if (validated) {
      if (envelope.debugActive) {
        markShootableTrace("player-clearance-push", shootable, {
          candidateCount: candidates.length,
          extraRadius: envelope.extraRadius,
          playerRadius: envelope.playerRadius,
          sourceBossBounds: envelope.sourceBossBounds,
          x: validated[0],
          y: validated[1],
          z: validated[2],
        });
      }
      return validated;
    }
    if (envelope.debugActive) {
      markShootableTrace("player-clearance-blocked", shootable, {
        candidateCount: candidates.length,
        extraRadius: envelope.extraRadius,
        playerRadius: envelope.playerRadius,
        sourceBossBounds: envelope.sourceBossBounds,
        x: origin[0],
        y: origin[1],
        z: origin[2],
      });
    }
    return envelope.debugActive ? origin : candidates[0] ?? origin;
  }

  function shootablePlayerCollisionEnvelope(shootable: QuakeShootableState): {
    bounds: QuakeBounds;
    debugActive: boolean;
    extraRadius: number;
    playerRadius: number;
    sourceBossBounds: boolean;
  } {
    const clearanceActive = playerClearanceMatchesEntity(shootable.entity);
    const extraRadius = clearanceActive ? Math.max(0, playerClearance?.extraRadius ?? 0) : 0;
    const sourceBossBounds = clearanceActive &&
      playerClearance?.useBossAwakeBounds !== false &&
      quakeBossScriptedLifecycle(shootable.entity.classname) !== null;
    const bounds = sourceBossBounds
      ? shootableBossAwakeCollisionWorldBounds(shootable) ?? shootableCollisionWorldBounds(shootable)
      : shootableCollisionWorldBounds(shootable);
    return {
      bounds,
      debugActive: clearanceActive,
      extraRadius,
      playerRadius: PLAYER_RADIUS + extraRadius,
      sourceBossBounds,
    };
  }

  function playerClearanceMatchesEntity(entity: QuakeEntity): boolean {
    if (!playerClearance) return false;
    const classnames = playerClearance.enemyClassnames;
    return !classnames?.length || classnames.includes(entity.classname);
  }

  function shootableBossAwakeCollisionWorldBounds(shootable: QuakeShootableState): QuakeBounds | null {
    const bounds = quakeBossScriptedLifecycle(shootable.entity.classname)?.awake.bounds;
    if (!bounds) return null;
    return {
      min: [
        shootable.origin[0] + bounds.min[0] * QUAKE_COLLISION_UNIT_SCALE,
        shootable.origin[1] + bounds.min[1] * QUAKE_COLLISION_UNIT_SCALE,
        shootable.origin[2] + bounds.min[2] * QUAKE_COLLISION_UNIT_SCALE,
      ],
      max: [
        shootable.origin[0] + bounds.max[0] * QUAKE_COLLISION_UNIT_SCALE,
        shootable.origin[1] + bounds.max[1] * QUAKE_COLLISION_UNIT_SCALE,
        shootable.origin[2] + bounds.max[2] * QUAKE_COLLISION_UNIT_SCALE,
      ],
    };
  }

  function shootableBounds(shootable: QuakeShootableState): { min: Vec3; max: Vec3 } {
    return {
      min: [
        shootable.origin[0] + shootable.bounds.min[0],
        shootable.origin[1] + shootable.bounds.min[1],
        shootable.origin[2] + shootable.bounds.min[2],
      ],
      max: [
        shootable.origin[0] + shootable.bounds.max[0],
        shootable.origin[1] + shootable.bounds.max[1],
        shootable.origin[2] + shootable.bounds.max[2],
      ],
    };
  }

  function shootableCollisionWorldBounds(shootable: QuakeShootableState): { min: Vec3; max: Vec3 } {
    return shootableCollisionWorldBoundsAt(shootable, shootable.origin);
  }

  function shootableCollisionWorldBoundsAt(shootable: QuakeShootableState, origin: Vec3): { min: Vec3; max: Vec3 } {
    return {
      min: [
        origin[0] + shootable.collisionBounds.min[0],
        origin[1] + shootable.collisionBounds.min[1],
        origin[2] + shootable.collisionBounds.min[2],
      ],
      max: [
        origin[0] + shootable.collisionBounds.max[0],
        origin[1] + shootable.collisionBounds.max[1],
        origin[2] + shootable.collisionBounds.max[2],
      ],
    };
  }

  function isLiveMonsterBlocker(shootable: QuakeShootableState): boolean {
    return shootable.entity.classname.startsWith("monster_") &&
      !shootable.dead &&
      shootable.health > 0 &&
      !isZombieNonSolid(shootable);
  }

  function quakePlayerDamageContextFromShootableDamage(
    context?: QuakeShootableDamageContext,
  ): QuakePlayerDamageContext | undefined {
    const inflictorOrigin = context?.inflictor?.origin ?? context?.attacker?.origin ?? null;
    return inflictorOrigin ? { inflictorOrigin } : undefined;
  }

  return {
    canDamageTargetOrigin: quakecCanDamageTargetOrigin,
    clear,
    debugCullingSnapshot,
    debugStats,
    debugCanDamageTrace,
    debugEnemyAcquisition,
    debugClearEnemyProjectileCapture,
    debugDamageWeaponTarget,
    debugEnemyProjectileCapture: enemyProjectiles.debugProjectileCapture,
    debugForceEnemyAttackChain,
    debugForceEnemyAttack,
    debugMountEntity,
    debugSetEnemyTickFilter,
    debugSetEnemyProjectileCaptureEnabled: enemyProjectiles.debugSetProjectileCaptureEnabled,
    debugStepEnemyProjectiles,
    debugSetOrigin,
    debugSetYaw,
    setExpandedLogicalCombatEnabled,
    setMountedEnemyAcquisitionEnabled,
    nextPlayerQuakecRandom,
    setUnmountedAiEnabled,
    spawn,
    setupMonsterJumpTriggers,
    has,
    activate,
    triggerBossLightning,
    damage,
    destroy,
    firstMonsterOverlappingBounds,
    pushMonsterBlockers,
    restoreProgress,
    snapshotProgress,
    syncAnimationPresentation,
    syncMonsterRuntime,
    resolvePlayerCollision,
    syncVisibility,
    weaponTargets,
  };
}

function quakeMonsterChainDurationMs(
  classname: string,
  chain: string,
  runner: QuakeMonsterStateRunner,
): number {
  return quakeMonsterChainDurationMsBase(classname, chain, runner, quakeMonsterChainHoldMs);
}

function quakeMonsterChainHoldMs(classname: string, chain: string): number {
  if (classname === "monster_zombie" && chain === "pain_down") return QUAKE_ZOMBIE_DOWN_HOLD_MS;
  return 0;
}
