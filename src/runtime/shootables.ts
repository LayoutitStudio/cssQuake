import type { Polygon, PolyMeshHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeGameLogicFacts } from "../prepare/gameLogicFacts";
import type { QuakeEntity, QuakePreparedModel, QuakeVertex } from "../prepare/scene";
import {
  QUAKE_MONSTER_COMBAT_POLICIES,
  QUAKE_MONSTER_LOGIC,
  QUAKE_SHOOTABLE_LOGIC,
  type QuakeMonsterAttackBranchPolicy,
  type QuakeMonsterAttackPolicy,
  type QuakeMonsterCombatPolicy,
  type QuakeMonsterDeathBackpackDrop,
  type QuakeMonsterDeathBackpackProfile,
  type QuakeMonsterDeathGibOutput,
  type QuakeMonsterDeathReactionProfile,
  type QuakeMonsterFrameState,
  type QuakeMonsterFireBulletsFrameEvent,
  type QuakeMonsterFrameEvent,
  type QuakeMonsterLogicDefinition,
  type QuakeMonsterLightningDamageFrameEvent,
  type QuakeMonsterMeleeDamageFrameEvent,
  type QuakeMonsterPainReactionProfile,
  type QuakeMonsterProjectileFrameEvent,
  type QuakeMonsterProjectileOffsetUnits,
  type QuakeMonsterRandomBranch,
  type QuakeMonsterScriptedLifecycle,
  type QuakeMonsterSpawnProfile,
  type QuakeMonsterTouchDamageFrameEvent,
  type QuakeShootableRadiusDamageFact,
} from "../generated/quakeMonsterLogic";
import {
  COLLISION_EPSILON,
  GROUND_SNAP,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  QUAKE_COLLISION_UNIT_SCALE,
  STEP_HEIGHT,
} from "./constants";
import type { QuakeCollisionResult } from "./collision";
import {
  createQuakeShootablesVisibilityChurnStats,
  recordQuakeShootablesVisibilitySync,
  shootableVisibilitySelectionKey,
  type QuakeShootablesVisibilityChurnStats,
  type QuakeShootablesVisibilitySnapshot,
} from "./debug/churnStats";
import { isQuakeDebugDomMetadataEnabled, markQuakeTrace } from "./debug/traceMarks";
import { quakeEntityNumber } from "./entities";
import { dotVec3, distanceSq3, normalizeVec3, subtractVec3 } from "./math";
import {
  type QuakePickupModel,
  type QuakePickupModelLibrary,
  type QuakePickupEffect,
  type QuakeProgramMetadata,
} from "./pickups";
import {
  isQuakeRenderBundleFrameSetHandle,
  setQuakeRenderBundleFrameSetHandleFrame,
  stripPolyMeshMetadata,
} from "./renderBundleMesh";
import type { QuakeMonsterStateRunner, QuakeMonsterStateStep } from "./quakeMonsterStateRunner";
import { quakeTriggerMonsterJumpActivation } from "./triggerEffects";
import type { QuakeWeaponShootableTarget } from "./weapons";

export interface QuakeShootablesController {
  clear(): void;
  debugStats(): QuakeShootablesDebugStats;
  debugMountEntity(entityIndex: number): boolean;
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
  damage(entityIndex: number, amount: number): boolean;
  destroy(entityIndex: number): boolean;
  firstMonsterOverlappingBounds(bounds: QuakeShootableBounds): number | null;
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

type QuakeShootableCollisionOriginValidator = (origin: [number, number, number]) => boolean;

export interface QuakeShootablesControllerOptions {
  addMesh(entity: QuakeEntity, model?: QuakePickupModel, frameIndex?: number): PolyMeshHandle | null;
  bossLightningElectrodesReady?: (
    targetName: string,
    alignment: QuakeMonsterScriptedLifecycle["lightning"]["alignment"],
  ) => boolean;
  bossLightningDischarge?: (
    targetName: string,
    lightning: QuakeMonsterScriptedLifecycle["lightning"],
  ) => void;
  createMonsterStateRunner?: (classname: string) => QuakeMonsterStateRunner | null;
  damagePlayer(amount: number): boolean;
  contentsAt?(point: Vec3): number | null;
  dropBackpack?: (drop: QuakeMonsterBackpackDropRuntime) => boolean | void;
  floorAt(x: number, y: number, maxZ?: number, minZ?: number): number | null;
  getPlayerForward(): Vec3;
  getPlayerEyeHeight(): number;
  getPlayerOrigin(): [number, number, number];
  hasLineOfSight(start: Vec3, end: Vec3): boolean;
  isPlayerInvisible?: () => boolean;
  isGameplayPaused?: () => boolean;
  isInPlayerView(origin: Vec3): boolean;
  leafIndexAt(origin: Vec3): number | undefined;
  monsterRuntimeEnabled(): boolean;
  pointToPoly(point: { x: number; y: number; z: number }): Vec3;
  shouldSpawn(entity: QuakeEntity): boolean;
  pixelate(handle: PolyMeshHandle): void;
  schedulePresentationResync(handle: PolyMeshHandle): void;
  visibleLeavesAt(origin: [number, number, number]): Set<number> | null;
  fireTarget(targetname: string, sourceEntityIndex?: number): void;
  playSound?(soundPath: string, options?: QuakeShootableSoundOptions): boolean;
}

export interface QuakeShootableActivationOptions {
  skill?: number;
}

interface QuakeShootableSoundOptions {
  volume?: number;
}

export interface QuakeMonsterBackpackDropRuntime {
  ammo: QuakePickupEffect;
  message?: string;
  modelPath?: string;
  origin: Vec3;
  removeAfterSeconds?: number;
  soundPath?: string;
  sourceEntity: QuakeEntity;
}

interface QuakeShootableDamageContext {
  radiusVisited?: Set<number>;
}

const QUAKE_SHOOTABLE_PREWARMED_CLASS = "quake-shootable-prewarmed";
const QUAKE_SHOOTABLE_FRAME_HIDDEN_CLASS = "quake-frame-hidden";
const QUAKE_SHOOTABLE_DYING_CLASS = "quake-shootable-dying";
const QUAKE_SHOOTABLE_CORPSE_CLASS = "quake-shootable-corpse";
const QUAKE_SHOOTABLE_DEAD_CLASS = "quake-shootable-dead";
const QUAKE_SHOOTABLE_HURT_CLASS = "quake-shootable-hurt";

export interface QuakeShootablesDebugStats {
  totalShootables: number;
  liveShootables: number;
  deadShootables: number;
  enemyShootables: number;
  liveEnemyShootables: number;
  visibleShootables: number;
  visibleEnemyShootables: number;
  mountedShootables: number;
  mountedEnemyShootables: number;
  prewarmedShootables: number;
  prewarmedEnemyShootables: number;
  meshHandles: number;
  frameHandles: number;
  enemyFrameHandles: number;
  desiredPrewarm: number;
  prewarmQueue: number;
  animationFramePrewarmQueue: number;
  visibilityChurn: QuakeShootablesVisibilityChurnStats;
}

interface QuakeShootableState {
  entity: QuakeEntity;
  origin: Vec3;
  leafIndex: number | undefined;
  model: QuakePickupModel | undefined;
  collisionBounds: {
    min: Vec3;
    max: Vec3;
  };
  bounds: {
    min: Vec3;
    max: Vec3;
  };
  handle: PolyMeshHandle | null;
  frameHandles: Map<number, PolyMeshHandle>;
  visible: boolean;
  yaw: number;
  health: number;
  dead: boolean;
  enemy?: QuakeEnemyState;
}

interface QuakeShootableTransformSnapshot {
  scale: number;
  x: number;
  y: number;
  yaw: number;
  z: number;
}

interface QuakeEnemyState {
  animationFrameIndex: number;
  animationLockUntil: number;
  animationMode: QuakeMonsterAnimationMode;
  deathAnimationUntil: number;
  nextAnimationFrameAt: number;
  quakecAnimationChain: string | null;
  quakecDeathChain: string | null;
  quakecFiredEvents: Set<string>;
  quakecGibbed: boolean;
  quakecActiveTouchDamage: QuakeEnemyActiveTouchDamage | null;
  quakecIdealYaw: number | null;
  quakecLastState: QuakeMonsterStateStep | null;
  quakecMovementCall: "ai_run" | "ai_walk" | null;
  quakecMovementStateName: string | null;
  quakecMovementUnitsRemaining: number;
  quakecPainChain: string | null;
  quakecPainFinishedUntil: number;
  quakecRunner: QuakeMonsterStateRunner | null;
  attackVisual: "cooldown" | "windup" | null;
  awake: boolean;
  burstShotsRemaining: number;
  nextAttackAt: number;
  pendingAttack: QuakeEnemyPendingAttack | null;
  movetarget: QuakeMonsterPathCorner | null;
  monsterJumpVelocity: Vec3;
  monsterJumpTouchedTriggerEntityIndex: number | null;
  seed: number;
  zombieGibbed: boolean;
  zombieNonSolidAt: number;
  zombiePainRepeatUntil: number;
  zombieRecoverUntil: number;
  zombieSolidAt: number;
}

interface QuakeMonsterPathCorner {
  entity: QuakeEntity;
  origin: Vec3;
  target?: string;
  targetname: string;
}

interface QuakeMonsterJumpTrigger {
  bounds: QuakeBounds;
  entityIndex: number;
  velocity: Vec3;
}

export interface QuakeShootableBounds {
  min: Vec3;
  max: Vec3;
}

interface QuakeMoveGoalCandidate {
  dx: number;
  dy: number;
  type: "direct" | "ideal" | "sweep" | "turnaround";
  yaw: number;
}

interface QuakeMoveGoalOptions {
  allowWallFollow: boolean;
  goalBounds?: QuakeBounds;
  movementCall: "ai_run" | "ai_walk";
  stopDistance: number;
}

interface QuakeEnemyPendingAttack {
  fireAt: number;
  quakecChain?: string;
  target: Vec3;
}

interface QuakeEnemyActiveTouchDamage {
  event: QuakeMonsterTouchDamageFrameEvent;
  expiresAt: number;
  frame: string;
  frameIndex: number;
  stateName: string;
}

interface QuakeMonsterCombatProfile {
  burstCount?: number;
  burstIntervalMs?: number;
  cooldownRandomAddMs?: number;
  chaseStopDistance?: number;
  chaseSpeed?: number;
  cooldownJitterMs?: number;
  damage: number;
  cooldownMs: number;
  kind?: "hitscan" | "projectile" | "touch";
  projectileAimError?: number;
  projectileGravity?: number;
  projectileOriginOffset?: QuakeMonsterProjectileOffset;
  projectileClassname?: string;
  projectileLifetimeMs?: number;
  projectileModelPath?: string;
  projectileRadius?: number;
  projectileScale?: number;
  projectileSpeed?: number;
  projectileSplashDamage?: number;
  projectileSplashOnExpire?: boolean;
  projectileSplashRadius?: number;
  projectileTargetOffset?: QuakeMonsterProjectileOffset;
  projectileVerticalAimError?: number;
  projectileVerticalVelocity?: number;
  range: number;
  wakeDelayJitterMs?: number;
  wakeDelayMs?: number;
  windupMs?: number;
  projectileAimDrop?: number;
}

interface QuakeMonsterProjectileOffset {
  forward?: number;
  right?: number;
  up?: number;
}

interface QuakeEnemyAnimationContext {
  enemyEye: Vec3;
  playerOrigin: [number, number, number];
  profile: QuakeMonsterCombatProfile;
}

type QuakeMonsterAnimationMode = "attack" | "death" | "idle" | "pain" | "path" | "walk";

interface QuakeMonsterAnimationProfile {
  attack?: QuakeMonsterAnimationRange;
  attackFps?: number;
  death?: QuakeMonsterAnimationRange;
  deathFps?: number;
  fps?: number;
  idle: QuakeMonsterAnimationRange;
  idleFps?: number;
  pain?: QuakeMonsterAnimationRange;
  painFps?: number;
  walk?: QuakeMonsterAnimationRange;
  walkFps?: number;
}

interface QuakeMonsterAnimationRange {
  end: number;
  start: number;
}

interface QuakeEnemyProjectile {
  damage: number;
  expiresAt: number;
  handle?: PolyMeshHandle | null;
  origin: Vec3;
  profile: QuakeMonsterCombatProfile;
  radius: number;
  radiusSq: number;
  sourceEntityIndex: number;
  velocity: Vec3;
}

interface QuakeMonsterDeathOutputVisualHandle {
  handle: PolyMeshHandle;
  timer: number;
}

interface QuakeBounds {
  min: Vec3;
  max: Vec3;
}

interface QuakeDamageTraceResult {
  distance: number;
  hit: boolean;
  hitPoint: Vec3;
  reason: "blocked" | "hit" | "miss" | "range";
}

interface QuakeIdleDeadline {
  didTimeout: boolean;
  timeRemaining(): number;
}

type QuakeWindowWithIdle = Window & {
  requestIdleCallback?: (callback: (deadline: QuakeIdleDeadline) => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

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
const QUAKE_SHOOTABLE_ANIMATION_FRAME_POOL_SIZE = 3;
const QUAKE_ENEMY_TICK_MS = 1000 / 60;
const QUAKE_ENEMY_DT_CLAMP = 0.05;
const QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS = 100;
const QUAKE_MONSTER_USE_FOUND_TARGET_DELAY_MS = QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;
const QUAKE_MONSTER_QUAKEC_AI_FRAME_RATE = 1000 / QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;
const QUAKEC_SOLDIER_AI_RUN_SPEED = 108.75 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_ATTACK_DELAY_MS = 600;
const QUAKE_MONSTER_PROJECTILE_LIFETIME_MS = 3200;
const QUAKE_MONSTER_PROJECTILE_AIM_DROP = 18 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_AIM_ERROR = 24 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_GRAVITY = 800 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_JUMP_GRAVITY = 800 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_VERTICAL_AIM_ERROR = 8 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_RADIUS = 28 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_DEATH_OUTPUT_CLASS = "quake-monster-death-output";
const QUAKE_MONSTER_DEATH_OUTPUT_LIFETIME_MS = 4000;
const QUAKE_MONSTER_DROP_TO_FLOOR_DISTANCE = 256 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PATH_TOUCH_RADIUS = 16 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_CONTENTS_SOLID = -2;
const QUAKE_PAUSED_TIMER_POLL_MS = 100;
const QUAKE_ZOMBIE_GIB_DAMAGE = 60;
const QUAKE_ZOMBIE_IGNORE_DAMAGE = 9;
const QUAKE_ZOMBIE_DROP_DAMAGE = 25;
const QUAKE_ZOMBIE_SPAWN_CRUCIFIED = 1;
const QUAKE_ZOMBIE_DOWN_HOLD_MS = 5000;
const QUAKE_ZOMBIE_PAIN_REPEAT_WINDOW_MS = 3000;
const QUAKE_ZOMBIE_LIGHT_PAIN_CHAINS = ["pain_light_a", "pain_light_b", "pain_light_c", "pain_light_d"];
const QUAKE_SHOOTABLE_TRANSFORM_EPSILON = COLLISION_EPSILON;
const quakeShootableTransformSnapshots = new WeakMap<PolyMeshHandle, QuakeShootableTransformSnapshot>();
const quakeMonsterCombatPolicies = QUAKE_MONSTER_COMBAT_POLICIES as Readonly<Record<string, QuakeMonsterCombatPolicy>>;
const quakeMonsterLogicByClassname = QUAKE_MONSTER_LOGIC as Readonly<Record<string, QuakeMonsterLogicDefinition>>;
type QuakeShootableTraceDetails = Record<string, boolean | number | string | null | undefined>;

function markShootableTrace(
  kind: string,
  shootable: QuakeShootableState,
  details: QuakeShootableTraceDetails = {},
): void {
  markQuakeTrace(kind, {
    entity: shootable.entity.index,
    class: shootable.entity.classname,
    leaf: shootable.leafIndex ?? null,
    frame: shootable.enemy?.animationFrameIndex ?? null,
    mode: shootable.enemy?.animationMode ?? null,
    visible: shootable.visible,
    ...details,
  });
}

export function createQuakeShootablesController({
  addMesh,
  bossLightningDischarge,
  bossLightningElectrodesReady,
  createMonsterStateRunner,
  damagePlayer,
  contentsAt,
  dropBackpack,
  floorAt,
  getPlayerForward,
  getPlayerEyeHeight,
  getPlayerOrigin,
  hasLineOfSight,
  isPlayerInvisible,
  isGameplayPaused,
  isInPlayerView,
  leafIndexAt,
  monsterRuntimeEnabled,
  pointToPoly,
  shouldSpawn,
  pixelate,
  schedulePresentationResync,
  visibleLeavesAt,
  fireTarget,
  playSound,
}: QuakeShootablesControllerOptions): QuakeShootablesController {
  let shootables = new Map<number, QuakeShootableState>();
  let deathTimers: number[] = [];
  let enemyFrame: number | null = null;
  let enemyProjectiles: QuakeEnemyProjectile[] = [];
  let enemyProjectileTimers: number[] = [];
  let deathOutputHandles: QuakeMonsterDeathOutputVisualHandle[] = [];
  let currentModelLibrary: QuakePickupModelLibrary | null = null;
  let monsterPathCornersByTargetname = new Map<string, QuakeMonsterPathCorner>();
  let monsterJumpTriggers: QuakeMonsterJumpTrigger[] = [];
  let enemyTime = 0;
  let enemyPausedAt = 0;
  let desiredPrewarmIndexes = new Set<number>();
  let prewarmQueue: number[] = [];
  let queuedPrewarmIndexes = new Set<number>();
  let prewarmIdleHandle: number | null = null;
  let animationFramePrewarmQueue: Array<{ entityIndex: number; frameIndex: number }> = [];
  let queuedAnimationFramePrewarms = new Set<string>();
  let animationFramePrewarmIdleHandle: number | null = null;
  let visibilityChurn = createQuakeShootablesVisibilityChurnStats();
  let lastVisibilitySelectionKey = "";

  function clear(): void {
    stopEnemyLoop();
    cancelShootablePrewarmDrain();
    cancelAnimationFramePrewarmDrain();
    desiredPrewarmIndexes = new Set();
    prewarmQueue = [];
    queuedPrewarmIndexes = new Set();
    animationFramePrewarmQueue = [];
    queuedAnimationFramePrewarms = new Set();
    for (const timer of deathTimers) window.clearTimeout(timer);
    deathTimers = [];
    for (const timer of enemyProjectileTimers) window.clearTimeout(timer);
    enemyProjectileTimers = [];
    for (const output of deathOutputHandles) {
      window.clearTimeout(output.timer);
      output.handle.remove();
    }
    visibilityChurn.totalMeshHandlesRemoved += deathOutputHandles.length;
    deathOutputHandles = [];
    for (const shootable of shootables.values()) removeShootableHandles(shootable);
    shootables = new Map();
    for (const projectile of enemyProjectiles) projectile.handle?.remove();
    enemyProjectiles = [];
    currentModelLibrary = null;
    monsterPathCornersByTargetname = new Map();
    monsterJumpTriggers = [];
    enemyPausedAt = 0;
    visibilityChurn = createQuakeShootablesVisibilityChurnStats();
    lastVisibilitySelectionKey = "";
  }

  function spawn(
    entities: QuakeEntity[],
    modelLibrary: QuakePickupModelLibrary | null,
    programMetadata: QuakeProgramMetadata | null = null,
  ): void {
    clear();
    currentModelLibrary = modelLibrary;
    monsterPathCornersByTargetname = buildMonsterPathCornerIndex(entities);
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
      const origin = groundedShootableOrigin(entity, pointToPoly(entity.origin), collisionBounds, "spawn", spawnProfile);
      const yaw = entity.angle ?? quakeEntityNumber(entity, "angle", 0);
      shootables.set(entity.index, {
        entity,
        origin,
        leafIndex: leafIndexAt(origin),
        model,
        collisionBounds,
        bounds,
        handle: null,
        frameHandles: new Map(),
        visible: false,
        yaw,
        health: shootableHealth(entity),
        dead: false,
        ...(quakeMonsterUsesEnemyRuntime(entity)
          ? {
            enemy: createEnemyState(
              entity.index,
              createMonsterStateRunner?.(entity.classname) ?? null,
              initialMonsterMovetarget(entity),
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
    const modelsByIndex = new Map(models.map((model) => [model.index, model]));
    const triggers: QuakeMonsterJumpTrigger[] = [];
    for (const entity of entities) {
      if (entity.classname !== "trigger_monsterjump" || entity.modelIndex === undefined) continue;
      const model = modelsByIndex.get(entity.modelIndex);
      const activation = quakeTriggerMonsterJumpActivation(entity, gameLogic);
      if (!model || !activation) continue;
      triggers.push({
        bounds: quakeBrushModelBounds(model, pivot),
        entityIndex: entity.index,
        velocity: [
          activation.velocity[0] * QUAKE_COLLISION_UNIT_SCALE,
          activation.velocity[1] * QUAKE_COLLISION_UNIT_SCALE,
          activation.velocity[2] * QUAKE_COLLISION_UNIT_SCALE,
        ],
      });
    }
    monsterJumpTriggers = triggers;
  }

  function buildMonsterPathCornerIndex(entities: QuakeEntity[]): Map<string, QuakeMonsterPathCorner> {
    const out = new Map<string, QuakeMonsterPathCorner>();
    for (const entity of entities) {
      if (entity.classname !== "path_corner" || !entity.origin || !entity.properties.targetname) continue;
      out.set(entity.properties.targetname, {
        entity,
        origin: pointToPoly(entity.origin),
        ...(entity.properties.target ? { target: entity.properties.target } : {}),
        targetname: entity.properties.targetname,
      });
    }
    return out;
  }

  function initialMonsterMovetarget(entity: QuakeEntity): QuakeMonsterPathCorner | null {
    const target = entity.properties.target;
    return target ? monsterPathCornersByTargetname.get(target) ?? null : null;
  }

  function syncMonsterRuntime(): void {
    if (!monsterRuntimeEnabled()) {
      clearEnemyRuntime();
      stopEnemyLoop();
      return;
    }
    if (hasLiveEnemies() || enemyProjectiles.length > 0) startEnemyLoop();
  }

  function clearEnemyRuntime(): void {
    for (const shootable of shootables.values()) clearEnemyAttackState(shootable);
    for (const projectile of enemyProjectiles) removeEnemyProjectile(projectile);
    enemyProjectiles = [];
    for (const timer of enemyProjectileTimers) window.clearTimeout(timer);
    enemyProjectileTimers = [];
  }

  function groundedShootableOrigin(
    entity: QuakeEntity,
    origin: Vec3,
    bounds: { min: Vec3; max: Vec3 },
    mode: "move" | "spawn",
    spawnProfile = quakeMonsterSpawnProfileForEntity(entity),
  ): Vec3 {
    if (!entity.classname.startsWith("monster_")) return origin;
    if (spawnProfile && !spawnProfile.dropToFloor) return origin;
    const footZ = origin[2] + bounds.min[2];
    const lowerZ = mode === "spawn"
      ? footZ - QUAKE_MONSTER_DROP_TO_FLOOR_DISTANCE
      : footZ - STEP_HEIGHT - GROUND_SNAP;
    const floorZ = quakeMonsterDropFloorAt(origin, bounds, footZ + STEP_HEIGHT + GROUND_SNAP, lowerZ);
    if (floorZ === null) {
      if (mode === "spawn") {
        markQuakeTrace("enemy-drop-to-floor", {
          class: entity.classname,
          entity: entity.index,
          floor: "none",
          footZ,
          minZ: bounds.min[2],
          startKind: spawnProfile?.startKind ?? "fallback",
        });
      }
      return origin;
    }
    const grounded: Vec3 = [origin[0], origin[1], origin[2] + floorZ - footZ];
    if (mode === "spawn") {
      markQuakeTrace("enemy-drop-to-floor", {
        class: entity.classname,
        distance: origin[2] - grounded[2],
        entity: entity.index,
        floor: "exact",
        floorZ,
        minZ: bounds.min[2],
        startKind: spawnProfile?.startKind ?? "fallback",
      });
    }
    return grounded;
  }

  function quakeMonsterDropFloorAt(
    origin: Vec3,
    bounds: { min: Vec3; max: Vec3 },
    maxZ: number,
    minZ: number,
  ): number | null {
    let bestFloor: number | null = null;
    for (const [x, y] of quakeMonsterFootprintSamples(origin, bounds)) {
      const sampleFloor = floorAt(x, y, maxZ, minZ);
      if (sampleFloor === null) continue;
      if (bestFloor === null || sampleFloor > bestFloor) bestFloor = sampleFloor;
    }
    return bestFloor;
  }

  function quakeMonsterFootprintSamples(origin: Vec3, bounds: { min: Vec3; max: Vec3 }): Array<[number, number]> {
    const mins: Vec3 = [
      origin[0] + bounds.min[0],
      origin[1] + bounds.min[1],
      origin[2] + bounds.min[2],
    ];
    const maxs: Vec3 = [
      origin[0] + bounds.max[0],
      origin[1] + bounds.max[1],
      origin[2] + bounds.max[2],
    ];
    return [
      [(mins[0] + maxs[0]) * 0.5, (mins[1] + maxs[1]) * 0.5],
      [mins[0], mins[1]],
      [mins[0], maxs[1]],
      [maxs[0], mins[1]],
      [maxs[0], maxs[1]],
    ];
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
    enemy.quakecIdealYaw = quakeYawToOrigin(shootable.origin, getPlayerOrigin());
    enemy.animationMode = "idle";
    enemy.animationLockUntil = Math.max(enemy.animationLockUntil, now + QUAKE_MONSTER_USE_FOUND_TARGET_DELAY_MS);
    enemy.nextAttackAt = Math.max(enemy.nextAttackAt, now + QUAKE_MONSTER_USE_FOUND_TARGET_DELAY_MS);
    syncShootableEnemyDatasets(shootable);
    markShootableTrace("enemy-use", shootable, {
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
    if (quakeBossScriptedLifecycle(shootable.entity.classname)) {
      markShootableTrace("boss-damage-ignored", shootable, { amount: damageAmount });
      return false;
    }
    if (shootable.entity.classname === "monster_zombie" && shootable.enemy) {
      return damageZombie(shootable, damageAmount, now);
    }
    shootable.health -= damageAmount;
    markShootableTrace("shootable-damage", shootable, {
      amount: damageAmount,
      health: shootable.health,
      killed: shootable.health <= 0,
    });
    if (shootable.health > 0) {
      playEnemyPainAnimation(shootable, now, damageAmount);
      flashShootable(shootable);
      return true;
    }
    return destroy(entityIndex, context);
  }

  function damageZombie(shootable: QuakeShootableState, amount: number, now: number): boolean {
    const enemy = shootable.enemy;
    if (!enemy) return false;
    const baseHealth = QUAKE_SHOOTABLE_HEALTH.monster_zombie ?? 60;
    if (amount >= QUAKE_ZOMBIE_GIB_DAMAGE) {
      shootable.health = 0;
      enemy.zombieGibbed = true;
      enemy.quakecGibbed = true;
      clearZombieDownedState(enemy);
      markShootableTrace("shootable-damage", shootable, {
        amount,
        health: shootable.health,
        killed: true,
        zombiePolicy: "gib",
      });
      return destroy(shootable.entity.index, { radiusVisited: new Set([shootable.entity.index]) });
    }

    shootable.health = baseHealth;
    if (isZombieRecovering(shootable, now)) {
      markShootableTrace("shootable-damage", shootable, {
        amount,
        health: shootable.health,
        killed: false,
        zombiePolicy: "downed-ignored",
      });
      return true;
    }
    const ignored = amount < QUAKE_ZOMBIE_IGNORE_DAMAGE;
    markShootableTrace("shootable-damage", shootable, {
      amount,
      health: shootable.health,
      killed: false,
      zombiePolicy: ignored ? "ignored" : "pain",
    });
    if (ignored) return true;

    const repeatedPain = enemy.zombiePainRepeatUntil > now;
    const drop = amount >= QUAKE_ZOMBIE_DROP_DAMAGE || repeatedPain;
    enemy.zombiePainRepeatUntil = now + QUAKE_ZOMBIE_PAIN_REPEAT_WINDOW_MS;
    enemy.quakecPainChain = selectZombiePainChain(enemy, drop);
    if (enemy.quakecPainChain === "pain_down") startZombieDownedState(shootable, enemy, now);
    playEnemyPainAnimation(shootable, now, amount);
    flashShootable(shootable);
    return true;
  }

  function destroy(entityIndex: number, context: QuakeShootableDamageContext = {}): boolean {
    const shootable = shootables.get(entityIndex);
    if (!shootable || shootable.dead) return false;
    shootable.dead = true;
    applyShootableDeathRadiusDamage(shootable, context);
    clearEnemyAttackState(shootable);
    const deathAnimationMs = playEnemyDeathAnimation(shootable, performance.now());
    markShootableTrace("shootable-destroy", shootable);
    syncShootableLifecycleClassesForShootable(shootable);
    if (isPersistentShootableCorpse(shootable)) {
      if (deathAnimationMs === null) {
        finalizeShootableCorpse(shootable);
      } else {
        const timer = window.setTimeout(() => {
          finalizeShootableCorpse(shootable);
          deathTimers = deathTimers.filter((item) => item !== timer);
        }, deathAnimationMs);
        deathTimers.push(timer);
      }
      if (shootable.entity.properties.target) fireTarget(shootable.entity.properties.target, shootable.entity.index);
      return true;
    }
    if (isShootableGibbed(shootable)) {
      removeShootableHandles(shootable);
      shootables.delete(entityIndex);
      if (shootable.entity.properties.target) fireTarget(shootable.entity.properties.target, shootable.entity.index);
      return true;
    }
    if (!shootable.handle) {
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

  function applyShootableDeathRadiusDamage(
    source: QuakeShootableState,
    context: QuakeShootableDamageContext,
  ): void {
    const radiusDamage = quakeShootableDeathRadiusDamage(source.entity.classname);
    if (!radiusDamage) return;
    const visited = context.radiusVisited ?? new Set<number>();
    if (visited.has(source.entity.index)) return;
    visited.add(source.entity.index);
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
      damage(target.entity.index, damageAmount, { radiusVisited: visited });
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
    if (radiusDamage.requiresCanDamage && !hasLineOfSight(origin, playerCenter)) return false;
    const damageAmount = quakeRadiusDamageAmount(radiusDamage, distanceSq, 1);
    if (damageAmount <= 0) return false;
    const damaged = damagePlayer(damageAmount);
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
    const targetBounds = shootableBoundsForDamage(target);
    const targetCenter = quakecBoundsCenter(targetBounds);
    const radius = quakecScaleUnits(radiusDamage.radiusUnits);
    const distanceSq = distanceSq3(origin, targetCenter);
    if (distanceSq > radius * radius) return 0;
    if (radiusDamage.requiresCanDamage && !hasLineOfSight(origin, targetCenter)) return 0;
    const classnameScale = target.entity.classname === "monster_shambler" ? radiusDamage.shamblerScale : 1;
    return quakeRadiusDamageAmount(radiusDamage, distanceSq, classnameScale);
  }

  function quakeRadiusDamageAmount(
    radiusDamage: QuakeShootableRadiusDamageFact,
    distanceSq: number,
    scale: number,
  ): number {
    const distanceUnits = Math.sqrt(distanceSq) / QUAKE_COLLISION_UNIT_SCALE;
    const damageAmount = (radiusDamage.damageUnits - distanceUnits * radiusDamage.distanceScale) * scale;
    return damageAmount > 0 ? damageAmount : 0;
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
    for (const shootable of shootables.values()) {
      if (!shootable.handle || !shootable.visible) continue;
      yield {
        entity: shootable.entity,
        dead: shootable.dead || isZombieNonSolid(shootable),
        bounds: shootableCollisionWorldBounds(shootable),
      };
    }
  }

  function debugStats(): QuakeShootablesDebugStats {
    const snapshot = shootableVisibilitySnapshot();
    let deadShootables = 0;
    let enemyShootables = 0;
    let liveEnemyShootables = 0;
    for (const shootable of shootables.values()) {
      if (shootable.dead) deadShootables++;
      if (shootable.enemy) {
        enemyShootables++;
        if (!shootable.dead) liveEnemyShootables++;
      }
    }
    const totalShootables = shootables.size;
    return {
      totalShootables,
      liveShootables: totalShootables - deadShootables,
      deadShootables,
      enemyShootables,
      liveEnemyShootables,
      visibleShootables: snapshot.visibleIndexes.size,
      visibleEnemyShootables: snapshot.visibleEnemies,
      mountedShootables: snapshot.mountedIndexes.size,
      mountedEnemyShootables: snapshot.mountedEnemies,
      prewarmedShootables: snapshot.prewarmedIndexes.size,
      prewarmedEnemyShootables: snapshot.prewarmedEnemies,
      meshHandles: snapshot.meshHandles,
      frameHandles: snapshot.frameHandles,
      enemyFrameHandles: snapshot.enemyFrameHandles,
      desiredPrewarm: desiredPrewarmIndexes.size,
      prewarmQueue: prewarmQueue.length,
      animationFramePrewarmQueue: animationFramePrewarmQueue.length,
      visibilityChurn: { ...visibilityChurn },
    };
  }

  function debugMountEntity(entityIndex: number): boolean {
    const shootable = shootables.get(entityIndex);
    if (!shootable || shootable.dead) return false;
    if (!shootable.handle) mountShootableHandle(shootable);
    if (!shootable.handle) return false;
    setShootableVisible(shootable, true);
    syncShootableTransform(shootable);
    return shootable.visible;
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
      frameHandles += shootable.frameHandles.size;
      if (isEnemy) enemyFrameHandles += shootable.frameHandles.size;
      if (hasHandle) {
        mountedIndexes.add(shootable.entity.index);
        if (isEnemy) mountedEnemies++;
      }
      if (shootable.handle && shootable.visible) {
        visibleIndexes.add(shootable.entity.index);
        if (isEnemy) visibleEnemies++;
      }
      if (hasHandle && !shootable.visible) {
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
    const before = shootableVisibilitySnapshot();
    const meshHandlesCreatedBefore = visibilityChurn.totalMeshHandlesCreated;
    const meshHandlesRemovedBefore = visibilityChurn.totalMeshHandlesRemoved;
    const frameHandlesCreatedBefore = visibilityChurn.totalFrameHandlesCreated;
    const frameHandlesRemovedBefore = visibilityChurn.totalFrameHandlesRemoved;
    const visibleLeaves = visibleLeavesAt(origin);
    const candidates: Array<{ index: number; distanceSq: number }> = [];
    const corpseCandidates: Array<{ index: number; distanceSq: number }> = [];
    const prewarmCandidates: Array<{ index: number; distanceSq: number }> = [];
    for (const shootable of shootables.values()) {
      const visibleLeaf = !visibleLeaves ||
        shootable.leafIndex === undefined ||
        visibleLeaves.has(shootable.leafIndex) ||
        isOversizedShootableRenderVolume(shootable);
      const distanceSq = distanceSq3(origin, shootable.origin);
      const maxDistanceSq = shootable.visible ? QUAKE_SHOOTABLE_UNMOUNT_DISTANCE_SQ : QUAKE_SHOOTABLE_MOUNT_DISTANCE_SQ;
      if (isPersistentShootableCorpse(shootable)) {
        if (visibleLeaf && distanceSq <= maxDistanceSq) {
          corpseCandidates.push({ index: shootable.entity.index, distanceSq });
        }
        continue;
      }
      if (shootable.dead) continue;
      if (visibleLeaf && distanceSq <= maxDistanceSq && canMountShootableHandle(shootable, origin)) {
        candidates.push({ index: shootable.entity.index, distanceSq });
      }
      if (distanceSq <= QUAKE_SHOOTABLE_PREWARM_DISTANCE_SQ) {
        prewarmCandidates.push({ index: shootable.entity.index, distanceSq });
      }
    }

    candidates.sort((a, b) => a.distanceSq - b.distanceSq);
    const mountedIndexes = new Set(candidates.slice(0, QUAKE_SHOOTABLE_MAX_MOUNTED).map((candidate) => candidate.index));
    corpseCandidates.sort((a, b) => a.distanceSq - b.distanceSq);
    for (const candidate of corpseCandidates.slice(0, QUAKE_SHOOTABLE_MAX_MOUNTED_CORPSES)) {
      mountedIndexes.add(candidate.index);
    }
    prewarmCandidates.sort((a, b) => a.distanceSq - b.distanceSq);
    const prewarmedIndexes = new Set<number>();
    for (const candidate of prewarmCandidates) {
      if (mountedIndexes.has(candidate.index)) continue;
      prewarmedIndexes.add(candidate.index);
      if (prewarmedIndexes.size >= QUAKE_SHOOTABLE_MAX_PREWARMED) break;
    }
    desiredPrewarmIndexes = prewarmedIndexes;
    const selectionKey = shootableVisibilitySelectionKey(mountedIndexes, prewarmedIndexes);
    const selectionChanged = selectionKey !== lastVisibilitySelectionKey;
    lastVisibilitySelectionKey = selectionKey;
    for (const shootable of shootables.values()) {
      setShootableMounted(
        shootable,
        mountedIndexes.has(shootable.entity.index),
        prewarmedIndexes.has(shootable.entity.index),
      );
    }
    const after = shootableVisibilitySnapshot();
    const meshHandlesCreated = visibilityChurn.totalMeshHandlesCreated - meshHandlesCreatedBefore;
    const meshHandlesRemoved = visibilityChurn.totalMeshHandlesRemoved - meshHandlesRemovedBefore;
    const frameHandlesCreated = visibilityChurn.totalFrameHandlesCreated - frameHandlesCreatedBefore;
    const frameHandlesRemoved = visibilityChurn.totalFrameHandlesRemoved - frameHandlesRemovedBefore;
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
  }

  function setShootableMounted(shootable: QuakeShootableState, mounted: boolean, prewarmed: boolean): void {
    const canPrewarmHandle = canPrewarmShootableHandle(shootable);
    const deathAnimating = isShootableDeathAnimating(shootable);
    const shouldKeepHandle = mounted || (prewarmed && canPrewarmHandle) ||
      deathAnimating;
    if (shootable.handle && !shouldKeepHandle) {
      clearEnemyAttackState(shootable);
      removeShootableHandles(shootable);
    }
    if (!shouldKeepHandle) return;
    if (shootable.dead && !isPersistentShootableCorpse(shootable) && !deathAnimating) return;
    if (!shootable.handle) {
      if (!mounted) {
        if (!canPrewarmHandle) return;
        scheduleShootablePrewarm(shootable);
        return;
      }
      mountShootableHandle(shootable);
    }
    setShootableVisible(shootable, mounted || deathAnimating);
  }

  function mountShootableHandle(shootable: QuakeShootableState): void {
    initializeEnemyAnimation(shootable, performance.now());
    if (canUseShootableAnimationFrameSet(shootable)) {
      shootable.handle = addShootableMesh(shootable.entity, shootable.model, enemyAnimationFrameIndex(shootable));
      markShootableTrace("shootable-mount", shootable, {
        backend: "frameset",
        handles: countShootableHandles(shootable),
      });
      syncShootableTransform(shootable);
      syncShootableHandleVisibility(shootable);
      syncShootableEnemyDatasets(shootable);
      return;
    }
    if (canPoolShootableAnimationFrames(shootable)) {
      const frameIndex = enemyAnimationFrameIndex(shootable);
      const handle = ensureShootableAnimationFrameHandle(shootable, frameIndex);
      if (!handle) return;
      setActiveShootableAnimationFrameHandle(shootable, frameIndex, handle);
      markShootableTrace("shootable-mount", shootable, {
        backend: "pool",
        handles: countShootableHandles(shootable),
      });
      scheduleNextShootableAnimationFramePrewarm(shootable);
      return;
    }
    shootable.handle = addShootableMesh(shootable.entity, shootable.model, enemyAnimationFrameIndex(shootable));
    markShootableTrace("shootable-mount", shootable, {
      backend: "replace",
      handles: countShootableHandles(shootable),
    });
    syncShootableTransform(shootable);
    syncShootableHandleVisibility(shootable);
    syncShootableEnemyDatasets(shootable);
  }

  function scheduleShootablePrewarm(shootable: QuakeShootableState): void {
    if (queuedPrewarmIndexes.has(shootable.entity.index)) return;
    queuedPrewarmIndexes.add(shootable.entity.index);
    prewarmQueue.push(shootable.entity.index);
    scheduleShootablePrewarmDrain();
  }

  function scheduleShootablePrewarmDrain(): void {
    if (prewarmIdleHandle !== null) return;
    const idleWindow = window as QuakeWindowWithIdle;
    if (idleWindow.requestIdleCallback) {
      prewarmIdleHandle = idleWindow.requestIdleCallback(drainShootablePrewarmQueue, {
        timeout: QUAKE_SHOOTABLE_PREWARM_TIMEOUT_MS,
      });
      return;
    }
    prewarmIdleHandle = window.setTimeout(() => {
      drainShootablePrewarmQueue({ didTimeout: true, timeRemaining: () => 0 });
    }, QUAKE_SHOOTABLE_PREWARM_TIMEOUT_MS);
  }

  function cancelShootablePrewarmDrain(): void {
    if (prewarmIdleHandle === null) return;
    const idleWindow = window as QuakeWindowWithIdle;
    if (idleWindow.cancelIdleCallback) {
      idleWindow.cancelIdleCallback(prewarmIdleHandle);
    } else {
      window.clearTimeout(prewarmIdleHandle);
    }
    prewarmIdleHandle = null;
  }

  function drainShootablePrewarmQueue(deadline: QuakeIdleDeadline): void {
    prewarmIdleHandle = null;
    while (prewarmQueue.length > 0) {
      const entityIndex = prewarmQueue.shift() as number;
      queuedPrewarmIndexes.delete(entityIndex);
      if (!desiredPrewarmIndexes.has(entityIndex)) continue;
      const shootable = shootables.get(entityIndex);
      if (!shootable || shootable.dead || shootable.handle) continue;
      if (!canPrewarmShootableHandle(shootable)) continue;
      mountShootableHandle(shootable);
      setShootableVisible(shootable, false);
      break;
    }
    if (prewarmQueue.length > 0) scheduleShootablePrewarmDrain();
  }

  function scheduleNextShootableAnimationFramePrewarm(shootable: QuakeShootableState): void {
    if (!shootable.visible || !canPoolShootableAnimationFrames(shootable)) return;
    const frameIndex = nextShootableAnimationFrameIndex(shootable);
    if (frameIndex === undefined || shootable.frameHandles.has(frameIndex)) return;
    const key = animationFramePrewarmKey(shootable.entity.index, frameIndex);
    if (queuedAnimationFramePrewarms.has(key)) return;
    queuedAnimationFramePrewarms.add(key);
    animationFramePrewarmQueue.push({ entityIndex: shootable.entity.index, frameIndex });
    scheduleAnimationFramePrewarmDrain();
  }

  function scheduleAnimationFramePrewarmDrain(): void {
    if (animationFramePrewarmIdleHandle !== null) return;
    const idleWindow = window as QuakeWindowWithIdle;
    if (idleWindow.requestIdleCallback) {
      animationFramePrewarmIdleHandle = idleWindow.requestIdleCallback(drainAnimationFramePrewarmQueue, {
        timeout: QUAKE_SHOOTABLE_PREWARM_TIMEOUT_MS,
      });
      return;
    }
    animationFramePrewarmIdleHandle = window.setTimeout(() => {
      drainAnimationFramePrewarmQueue({ didTimeout: true, timeRemaining: () => 0 });
    }, QUAKE_SHOOTABLE_PREWARM_TIMEOUT_MS);
  }

  function cancelAnimationFramePrewarmDrain(): void {
    if (animationFramePrewarmIdleHandle === null) return;
    const idleWindow = window as QuakeWindowWithIdle;
    if (idleWindow.cancelIdleCallback) {
      idleWindow.cancelIdleCallback(animationFramePrewarmIdleHandle);
    } else {
      window.clearTimeout(animationFramePrewarmIdleHandle);
    }
    animationFramePrewarmIdleHandle = null;
  }

  function drainAnimationFramePrewarmQueue(_deadline: QuakeIdleDeadline): void {
    animationFramePrewarmIdleHandle = null;
    while (animationFramePrewarmQueue.length > 0) {
      const item = animationFramePrewarmQueue.shift();
      if (!item) break;
      queuedAnimationFramePrewarms.delete(animationFramePrewarmKey(item.entityIndex, item.frameIndex));
      const shootable = shootables.get(item.entityIndex);
      if (!shootable || shootable.dead || !shootable.visible || !canPoolShootableAnimationFrames(shootable)) continue;
      if (shootable.frameHandles.has(item.frameIndex)) continue;
      ensureShootableAnimationFrameHandle(shootable, item.frameIndex);
      trimShootableAnimationFrameHandles(shootable);
      break;
    }
    if (animationFramePrewarmQueue.length > 0) scheduleAnimationFramePrewarmDrain();
  }

  function animationFramePrewarmKey(entityIndex: number, frameIndex: number): string {
    return `${entityIndex}:${frameIndex}`;
  }

  function canPrewarmShootableHandle(shootable: QuakeShootableState): boolean {
    return !shootable.enemy;
  }

  function canMountShootableHandle(shootable: QuakeShootableState, playerOrigin: Vec3): boolean {
    if (!shootable.enemy) return true;
    if (!isShootableInFrontOfCameraNearPlane(shootable, playerOrigin)) return false;
    const visibleTargets = shootableMountVisibilityTargets(shootable).filter((target) => isInPlayerView(target));
    if (!visibleTargets.length) return false;
    if (isOversizedShootableRenderVolume(shootable)) return true;
    return visibleTargets.some((target) => hasLineOfSight(playerOrigin, target));
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
    if (!shootable.handle) {
      shootable.visible = false;
      return;
    }
    const wasVisible = shootable.visible;
    if (visible === wasVisible) return;
    shootable.visible = visible;
    if (!visible && wasVisible) {
      clearEnemyAttackState(shootable);
    }
    syncShootableHandleVisibility(shootable);
    syncShootableEnemyDatasets(shootable);
    markShootableTrace("shootable-visible", shootable, {
      active: visible,
      handles: countShootableHandles(shootable),
    });
    if (visible) scheduleNextShootableAnimationFramePrewarm(shootable);
  }

  function canPoolShootableAnimationFrames(shootable: QuakeShootableState): boolean {
    return false;
  }

  function canUseShootableAnimationFrameSet(shootable: QuakeShootableState): boolean {
    return Boolean(shootable.enemy && shootable.model?.animationFrames?.length && shootable.model.animationFrameSet);
  }

  function ensureShootableAnimationFrameHandle(
    shootable: QuakeShootableState,
    frameIndex: number,
  ): PolyMeshHandle | null {
    const existing = shootable.frameHandles.get(frameIndex);
    if (existing) return existing;
    const handle = addShootableMesh(shootable.entity, shootable.model, frameIndex);
    if (!handle) return null;
    shootable.frameHandles.set(frameIndex, handle);
    visibilityChurn.totalFrameHandlesCreated++;
    markShootableTrace("shootable-frame-handle-create", shootable, {
      requestedFrame: frameIndex,
      handles: countShootableHandles(shootable),
    });
    syncShootableTransformForHandle(shootable, handle);
    syncShootableHandleVisibility(shootable);
    syncShootableEnemyDataset(shootable, handle, frameIndex);
    return handle;
  }

  function setActiveShootableAnimationFrameHandle(
    shootable: QuakeShootableState,
    frameIndex: number,
    handle: PolyMeshHandle,
  ): void {
    shootable.frameHandles.delete(frameIndex);
    shootable.frameHandles.set(frameIndex, handle);
    shootable.handle = handle;
    syncShootableTransform(shootable);
    syncShootableHandleVisibility(shootable);
    syncShootableEnemyDatasets(shootable);
    trimShootableAnimationFrameHandles(shootable);
  }

  function syncShootableHandleVisibility(shootable: QuakeShootableState): void {
    forEachShootableHandle(shootable, (handle) => {
      syncShootableLifecycleClasses(shootable, handle);
      const active = handle === shootable.handle;
      if (!shootable.visible) {
        handle.element.classList.add(QUAKE_SHOOTABLE_PREWARMED_CLASS);
        if (active) handle.element.classList.remove(QUAKE_SHOOTABLE_FRAME_HIDDEN_CLASS);
        handle.element.setAttribute("aria-hidden", "true");
        return;
      }
      handle.element.classList.remove(QUAKE_SHOOTABLE_PREWARMED_CLASS);
      if (active) {
        handle.element.classList.remove(QUAKE_SHOOTABLE_FRAME_HIDDEN_CLASS);
        handle.element.removeAttribute("aria-hidden");
      } else {
        handle.element.classList.add(QUAKE_SHOOTABLE_FRAME_HIDDEN_CLASS);
        handle.element.setAttribute("aria-hidden", "true");
      }
    });
  }

  function trimShootableAnimationFrameHandles(shootable: QuakeShootableState): void {
    if (shootable.frameHandles.size <= QUAKE_SHOOTABLE_ANIMATION_FRAME_POOL_SIZE) return;
    const keepFrameIndex = enemyAnimationFrameIndex(shootable);
    const nextFrameIndex = nextShootableAnimationFrameIndex(shootable);
    for (const [frameIndex, handle] of shootable.frameHandles) {
      if (shootable.frameHandles.size <= QUAKE_SHOOTABLE_ANIMATION_FRAME_POOL_SIZE) return;
      if (handle === shootable.handle || frameIndex === keepFrameIndex || frameIndex === nextFrameIndex) continue;
      handle.remove();
      visibilityChurn.totalMeshHandlesRemoved++;
      visibilityChurn.totalFrameHandlesRemoved++;
      shootable.frameHandles.delete(frameIndex);
    }
  }

  function forEachShootableHandle(shootable: QuakeShootableState, callback: (handle: PolyMeshHandle) => void): void {
    const handles = new Set(shootable.frameHandles.values());
    if (shootable.handle) handles.add(shootable.handle);
    for (const handle of handles) callback(handle);
  }

  function countShootableHandles(shootable: QuakeShootableState): number {
    const handles = new Set(shootable.frameHandles.values());
    if (shootable.handle) handles.add(shootable.handle);
    return handles.size;
  }

  function removeShootableHandles(shootable: QuakeShootableState): void {
    const removedHandles = countShootableHandles(shootable);
    const removedFrameHandles = shootable.frameHandles.size;
    forEachShootableHandle(shootable, (handle) => handle.remove());
    visibilityChurn.totalMeshHandlesRemoved += removedHandles;
    visibilityChurn.totalFrameHandlesRemoved += removedFrameHandles;
    shootable.handle = null;
    shootable.frameHandles.clear();
    shootable.visible = false;
  }

  function addShootableMesh(entity: QuakeEntity, model?: QuakePickupModel, frameIndex = 0): PolyMeshHandle | null {
    if (!entity.origin) return null;
    const handle = addMesh(entity, model, frameIndex);
    if (!handle) return null;
    visibilityChurn.totalMeshHandlesCreated++;
    const usesEnemyRuntime = quakeMonsterUsesEnemyRuntime(entity);
    handle.element.classList.add("shootable");
    if (usesEnemyRuntime) handle.element.classList.add("enemy");
    stripPolyMeshMetadata(handle.element);
    if (isQuakeDebugDomMetadataEnabled()) {
      handle.element.dataset.entityIndex = String(entity.index);
      handle.element.dataset.classname = entity.classname;
    }
    markQuakeTrace("shootable-mesh-create", {
      entity: entity.index,
      class: entity.classname,
      enemy: usesEnemyRuntime,
      frame: frameIndex,
      leaves: handle.element.querySelectorAll("b,i,s,u").length,
      model: Boolean(model),
    });
    handle.setTransform({
      position: pointToPoly(entity.origin),
      rotation: [
        0,
        0,
        shootableEntityRenderYaw(entity, entity.angle ?? quakeEntityNumber(entity, "angle", 0)),
      ],
      scale: model?.renderScale ? 1 / model.renderScale : 1,
    });
    if (!model) {
      pixelate(handle);
      schedulePresentationResync(handle);
    }
    return handle;
  }

  function startEnemyLoop(): void {
    if (enemyFrame !== null) return;
    enemyTime = 0;
    enemyFrame = window.requestAnimationFrame(tickEnemies);
  }

  function stopEnemyLoop(): void {
    if (enemyFrame === null) return;
    window.cancelAnimationFrame(enemyFrame);
    enemyFrame = null;
    enemyTime = 0;
  }

  function tickEnemies(_now: number): void {
    const now = performance.now();
    if (isGameplayPaused?.()) {
      enemyPausedAt ||= now;
      enemyTime = 0;
      enemyFrame = window.requestAnimationFrame(tickEnemies);
      return;
    }
    if (enemyPausedAt) {
      shiftEnemyRuntimeDeadlines(now - enemyPausedAt);
      enemyPausedAt = 0;
      enemyTime = now;
    }
    if (!monsterRuntimeEnabled() || (!hasLiveEnemies(now) && enemyProjectiles.length === 0)) {
      stopEnemyLoop();
      return;
    }

    if (enemyTime && now - enemyTime < QUAKE_ENEMY_TICK_MS) {
      enemyFrame = window.requestAnimationFrame(tickEnemies);
      return;
    }

    const dt = Math.min(QUAKE_ENEMY_DT_CLAMP, enemyTime ? (now - enemyTime) / 1000 : QUAKE_ENEMY_TICK_MS / 1000);
    enemyTime = now;
    const playerOrigin = getPlayerOrigin();
    updateEnemyProjectiles(playerOrigin, dt, now);
    for (const shootable of shootables.values()) {
      updateEnemy(shootable, playerOrigin, dt, now);
    }
    enemyFrame = window.requestAnimationFrame(tickEnemies);
  }

  function shiftEnemyRuntimeDeadlines(durationMs: number): void {
    if (durationMs <= 0) return;
    for (const shootable of shootables.values()) {
      const enemy = shootable.enemy;
      if (!enemy) continue;
      enemy.animationLockUntil = shiftEnemyTimestamp(enemy.animationLockUntil, durationMs);
      enemy.deathAnimationUntil = shiftEnemyTimestamp(enemy.deathAnimationUntil, durationMs);
      enemy.nextAnimationFrameAt = shiftEnemyTimestamp(enemy.nextAnimationFrameAt, durationMs);
      enemy.quakecPainFinishedUntil = shiftEnemyTimestamp(enemy.quakecPainFinishedUntil, durationMs);
      enemy.nextAttackAt = shiftEnemyTimestamp(enemy.nextAttackAt, durationMs);
      enemy.zombieNonSolidAt = shiftEnemyTimestamp(enemy.zombieNonSolidAt, durationMs);
      enemy.zombiePainRepeatUntil = shiftEnemyTimestamp(enemy.zombiePainRepeatUntil, durationMs);
      enemy.zombieRecoverUntil = shiftEnemyTimestamp(enemy.zombieRecoverUntil, durationMs);
      enemy.zombieSolidAt = shiftEnemyTimestamp(enemy.zombieSolidAt, durationMs);
      if (enemy.pendingAttack) enemy.pendingAttack.fireAt += durationMs;
      if (enemy.quakecActiveTouchDamage) enemy.quakecActiveTouchDamage.expiresAt += durationMs;
    }
    for (const projectile of enemyProjectiles) projectile.expiresAt += durationMs;
  }

  function shiftEnemyTimestamp(value: number, durationMs: number): number {
    return Number.isFinite(value) && value > 0 ? value + durationMs : value;
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
    if (!enemy || !shootable.handle || !shootable.visible) return;
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
    let enemyEye = shootableEyeOrigin(shootable);
    const canSeePlayer = hasLineOfSight(enemyEye, playerOrigin);
    if (!enemy.awake) {
      if (!canSeePlayer) {
        updateEnemyPathWalking(shootable, profile, dt, now);
        return;
      }
      if (!quakeMonsterCanAcquirePlayer(isPlayerInvisible?.() === true)) {
        markShootableTrace("enemy-acquire-blocked", shootable, { reason: "invisibility" });
        updateEnemyPathWalking(shootable, profile, dt, now);
        return;
      }
      enemy.awake = true;
      enemy.quakecIdealYaw = quakeYawToOrigin(shootable.origin, playerOrigin);
      enemy.nextAttackAt = now + enemyWakeDelayMs(profile, enemy);
      syncShootableEnemyDatasets(shootable);
      markShootableTrace("enemy-wake", shootable, {
        nextAttackMs: enemy.nextAttackAt - now,
      });
    }

    const movementTarget = playerOrigin;
    if (enemy.pendingAttack) {
      faceShootableAtOrigin(shootable, playerOrigin);
      updateEnemyAnimation(shootable, "attack", now, { enemyEye, playerOrigin, profile });
      runEnemyQuakecActiveTouchDamage(shootable, playerOrigin, profile, now);
      if (shootableUsesQuakecAttackEvents(shootable)) return;
      if (now < enemy.pendingAttack.fireAt) return;
      performEnemyAttack(shootable, enemy, enemyEye, playerOrigin, profile, now);
      return;
    }
    if (enemyAnimationLocked(enemy, now)) {
      updateEnemyAnimation(shootable, enemy.animationMode, now);
      if (enemy.animationMode === "attack" && enemy.burstShotsRemaining > 0 && now >= enemy.nextAttackAt) {
        if (distanceSq3(enemyEye, playerOrigin) > profile.range * profile.range) {
          clearEnemyAttackState(shootable);
          return;
        }
        faceShootableAtOrigin(shootable, playerOrigin);
        performEnemyAttack(shootable, enemy, enemyEye, playerOrigin, profile, now);
      }
      return;
    }
    const attackBeforeMove = shouldCheckQuakecAttackBeforeMove(shootable);
    if (canSeePlayer && attackBeforeMove && tryStartEnemyAttack(shootable, enemy, enemyEye, playerOrigin, profile, now)) return;
    const shouldWalk = shouldAnimateChasingEnemy(shootable, movementTarget, profile, canSeePlayer);
    if (shouldWalk) updateEnemyAnimation(shootable, "walk", now);
    const moved = moveChasingEnemy(shootable, movementTarget, profile, dt, now, canSeePlayer);
    if (moved) applyEnemyMonsterJumpTriggers(shootable);
    if (!shouldWalk) updateEnemyAnimation(shootable, moved ? "walk" : "idle", now);
    enemyEye = shootableEyeOrigin(shootable);
    if (canSeePlayer && !attackBeforeMove) {
      tryStartEnemyAttack(shootable, enemy, enemyEye, playerOrigin, profile, now);
    } else {
      faceShootableAtOrigin(shootable, movementTarget);
    }
  }

  function enemyCombatProfile(shootable: QuakeShootableState): QuakeMonsterCombatProfile | undefined {
    if (!shootable.enemy?.quakecRunner) return undefined;
    return QUAKEC_MONSTER_COMBAT_PROFILES[shootable.entity.classname];
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
    const moved = moveEnemyTowardOrigin(shootable, target.origin, profile, dt, now, {
      allowWallFollow: true,
      movementCall: "ai_walk",
      stopDistance: 0,
    });
    if (moved) applyEnemyMonsterJumpTriggers(shootable);
    faceShootableAtOrigin(shootable, target.origin);
    if (moved || shouldAnimateMovingEnemy(shootable, target.origin, QUAKE_MONSTER_PATH_TOUCH_RADIUS, COLLISION_EPSILON)) {
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
    enemy.monsterJumpTouchedTriggerEntityIndex = trigger.entityIndex;
    enemy.monsterJumpVelocity = [...trigger.velocity] as Vec3;
    clearQuakecMovementBudget(enemy);
    markShootableTrace("enemy-monsterjump-touch", shootable, {
      trigger: trigger.entityIndex,
      vx: trigger.velocity[0],
      vy: trigger.velocity[1],
      vz: trigger.velocity[2],
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

  function advanceMonsterMovetargetIfReached(shootable: QuakeShootableState, enemy: QuakeEnemyState): boolean {
    const target = enemy.movetarget;
    if (!target || distanceSq3(shootable.origin, target.origin) > QUAKE_MONSTER_PATH_TOUCH_RADIUS * QUAKE_MONSTER_PATH_TOUCH_RADIUS) {
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

  function shouldCheckQuakecAttackBeforeMove(shootable: QuakeShootableState): boolean {
    return Boolean(shootable.enemy?.quakecRunner && quakecMonsterHasRunMovement(shootable.entity.classname));
  }

  function tryStartEnemyAttack(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    enemyEye: Vec3,
    playerOrigin: [number, number, number],
    profile: QuakeMonsterCombatProfile,
    now: number,
  ): boolean {
    faceShootableAtOrigin(shootable, playerOrigin);
    const attackDistanceSq = distanceSq3(enemyEye, playerOrigin);
    if (attackDistanceSq > profile.range * profile.range) {
      clearEnemyAttackState(shootable);
      return false;
    }
    if (now < enemy.nextAttackAt) return false;
    const quakecAttackChain = selectEnemyAttackChain(shootable, enemy, Math.sqrt(attackDistanceSq), playerOrigin, now);
    if (quakecAttackChain === null) return false;
    clearQuakecMovementBudget(enemy);
    if (enemy.burstShotsRemaining > 0) {
      playEnemyAttackAnimation(shootable, now);
      performEnemyAttack(shootable, enemy, enemyEye, playerOrigin, profile, now);
      return true;
    }
    startEnemyAttackWindup(shootable, enemy, playerOrigin, profile, now, quakecAttackChain);
    return true;
  }

  function selectEnemyAttackChain(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    distance: number,
    playerOrigin: [number, number, number],
    now: number,
  ): string | null | undefined {
    const attackPolicy = quakecAttackPolicy(shootable);
    if (!attackPolicy?.usesFrameEvents) return undefined;
    const branchChain = selectQuakecAttackBranch(shootable, enemy, attackPolicy, distance, playerOrigin);
    if (attackPolicy.branches?.length) {
      if (branchChain) return branchChain;
      enemy.nextAttackAt = now + QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;
      return null;
    }
    const chance = quakecAttackPolicyChance(attackPolicy, distance);
    if (chance <= 0 || (chance < 1 && nextEnemyRandom(enemy) >= chance)) {
      enemy.nextAttackAt = now + QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;
      return null;
    }
    if (quakecAttackCooldownStartsOnSelection(shootable)) {
      enemy.nextAttackAt = now + quakecAttackPolicyCooldownMs(attackPolicy, enemy);
      consumeQuakecAttackSideEffectRandomChecks(attackPolicy, enemy);
    }
    return attackPolicy.chain;
  }

  function selectQuakecAttackBranch(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    policy: QuakeMonsterAttackPolicy,
    distance: number,
    playerOrigin: [number, number, number],
  ): string | null {
    for (const branch of policy.branches ?? []) {
      if (!quakecAttackBranchRangeMatches(branch, distance)) continue;
      if (!quakecAttackBranchSightMatches(shootable, branch, playerOrigin)) continue;
      const chance = quakecAttackBranchChance(branch, policy, distance);
      if (chance <= 0 || (chance < 1 && nextEnemyRandom(enemy) >= chance)) continue;
      return branch.chain;
    }
    return null;
  }

  function quakecAttackBranchRangeMatches(
    branch: QuakeMonsterAttackBranchPolicy,
    distance: number,
  ): boolean {
    if (branch.minRangeUnits !== undefined && distance < quakecScaleUnits(branch.minRangeUnits)) return false;
    if (branch.maxRangeUnits !== undefined && distance >= quakecScaleUnits(branch.maxRangeUnits)) return false;
    if (branch.maxDistanceUnits !== undefined && distance > quakecScaleUnits(branch.maxDistanceUnits)) return false;
    return true;
  }

  function quakecAttackBranchSightMatches(
    shootable: QuakeShootableState,
    branch: QuakeMonsterAttackBranchPolicy,
    playerOrigin: [number, number, number],
  ): boolean {
    if (branch.requiresVerticalOverlap && !quakecAttackBranchVerticalMatches(shootable, playerOrigin)) return false;
    if (!branch.requiresCanDamage && !branch.requiresClearShot) return true;
    return hasLineOfSight(shootableEyeOrigin(shootable), playerOrigin);
  }

  function quakecAttackBranchVerticalMatches(
    shootable: QuakeShootableState,
    playerOrigin: [number, number, number],
  ): boolean {
    const shootableMinZ = shootable.origin[2] + shootable.collisionBounds.min[2];
    const shootableMaxZ = shootable.origin[2] + shootable.collisionBounds.max[2];
    const playerBounds = quakecPlayerDamageBounds(playerOrigin);
    const playerMinZ = playerBounds.min[2];
    const playerMaxZ = playerBounds.max[2];
    return shootableMaxZ >= playerMinZ && shootableMinZ <= playerMaxZ;
  }

  function quakecAttackBranchChance(
    branch: QuakeMonsterAttackBranchPolicy,
    policy: QuakeMonsterAttackPolicy,
    distance: number,
  ): number {
    if (branch.chanceBeyondMaxRange !== undefined &&
      branch.chanceRangeUnits !== undefined &&
      distance > quakecScaleUnits(branch.chanceRangeUnits)
    ) {
      return branch.chanceBeyondMaxRange;
    }
    if (branch.rangeChances) {
      return quakecAttackPolicyChance({
        ...policy,
        rangeChances: branch.rangeChances,
      }, distance);
    }
    return 1;
  }

  function quakecAttackPolicy(shootable: QuakeShootableState): QuakeMonsterAttackPolicy | undefined {
    if (!shootable.enemy?.quakecRunner) return undefined;
    if (!QUAKEC_MONSTER_COMBAT_PROFILES[shootable.entity.classname]) return undefined;
    return quakecAttackPolicyForClassname(shootable.entity.classname);
  }

  function quakecAttackPolicyForClassname(classname: string): QuakeMonsterAttackPolicy | undefined {
    return quakeMonsterCombatPolicies[classname]?.attack;
  }

  function quakecAttackPolicyChance(policy: QuakeMonsterAttackPolicy, distance: number): number {
    if (distance < quakecScaleUnits(policy.rangeUnits.melee)) return policy.rangeChances.melee;
    if (distance < quakecScaleUnits(policy.rangeUnits.near)) return policy.rangeChances.near;
    if (distance < quakecScaleUnits(policy.rangeUnits.mid)) return policy.rangeChances.mid;
    return policy.rangeChances.far;
  }

  function quakecAttackCooldownStartsOnSelection(shootable: QuakeShootableState): boolean {
    return shootable.entity.classname === "monster_army";
  }

  function quakecAttackPolicyCooldownMs(policy: QuakeMonsterAttackPolicy, enemy: QuakeEnemyState): number {
    const cooldownMs = Math.max(0, policy.cooldownMs);
    const randomAddMs = Math.max(0, policy.cooldownRandomAddMs ?? 0);
    return cooldownMs + (randomAddMs > 0 ? enemyRandomRange(enemy, 0, randomAddMs) : 0);
  }

  function consumeQuakecAttackSideEffectRandomChecks(policy: QuakeMonsterAttackPolicy, enemy: QuakeEnemyState): void {
    for (const check of policy.sideEffectRandomChecks ?? []) {
      if (nextEnemyRandom(enemy) < check.chance) {
        // The source-side state, such as monster_army.lefty, has no rendered
        // effect yet, but the live RNG draw is part of the rule flow.
      }
    }
  }

  function quakecScaleUnits(value: number): number {
    return value * QUAKE_COLLISION_UNIT_SCALE;
  }

  function startEnemyAttackWindup(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    playerOrigin: [number, number, number],
    profile: QuakeMonsterCombatProfile,
    now: number,
    quakecAttackChain?: string,
  ): void {
    const quakecAttackEvents = shootableUsesQuakecAttackEvents(shootable);
    enemy.burstShotsRemaining = quakecAttackEvents ? 0 : Math.max(0, Math.round(profile.burstCount ?? 1) - 1);
    const windupMs = Math.max(0, profile.windupMs ?? 0);
    enemy.pendingAttack = {
      fireAt: quakecAttackEvents ? Infinity : now + windupMs,
      ...(quakecAttackChain ? { quakecChain: quakecAttackChain } : {}),
      target: [...playerOrigin] as Vec3,
    };
    enemy.attackVisual = "windup";
    if (quakecAttackEvents) {
      enemy.quakecAnimationChain = null;
      enemy.quakecFiredEvents.clear();
      updateEnemyAnimation(shootable, "attack", now, {
        enemyEye: shootableEyeOrigin(shootable),
        playerOrigin,
        profile,
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
      performEnemyAttack(shootable, enemy, shootableEyeOrigin(shootable), playerOrigin, profile, now);
    }
  }

  function performEnemyAttack(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    enemyEye: Vec3,
    playerOrigin: [number, number, number],
    profile: QuakeMonsterCombatProfile,
    now: number,
  ): void {
    const target = enemy.pendingAttack?.target ?? playerOrigin;
    enemy.pendingAttack = null;
    enemy.attackVisual = "cooldown";
    syncShootableEnemyDatasets(shootable);
    markShootableTrace("enemy-attack", shootable, {
      kind: profile.kind ?? "hitscan",
      damage: profile.damage,
      burstRemaining: enemy.burstShotsRemaining,
    });
    if (profile.kind === "projectile") {
      spawnEnemyProjectile(shootable, enemy, enemyAttackOrigin(shootable, enemyEye, playerOrigin, profile), target, profile, now);
    } else {
      damagePlayer(profile.damage);
    }
    if (enemy.burstShotsRemaining > 0) {
      enemy.burstShotsRemaining -= 1;
      enemy.nextAttackAt = now + Math.max(40, profile.burstIntervalMs ?? 140);
      return;
    }
    if (!quakecAttackCooldownStartsOnSelection(shootable)) {
      enemy.nextAttackAt = now + enemyCooldownMs(profile, enemy);
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
      syncEnemyCorpseAnimationFrame(shootable);
      return;
    }
    enemy.animationMode = "idle";
    enemy.animationFrameIndex = boundedAnimationRange(profile.idle, shootable.model).start;
    enemy.nextAnimationFrameAt = now + enemyAnimationFrameDuration(profile, "idle");
  }

  function finalizeShootableCorpse(shootable: QuakeShootableState): void {
    syncEnemyCorpseAnimationFrame(shootable);
    syncShootableLifecycleClassesForShootable(shootable);
    markShootableTrace("shootable-corpse", shootable, {
      handles: countShootableHandles(shootable),
    });
  }

  function syncEnemyCorpseAnimationFrame(shootable: QuakeShootableState): void {
    const enemy = shootable.enemy;
    if (!enemy) return;
    const corpseFrameIndex = enemyCorpseFrameIndex(shootable);
    enemy.animationMode = "death";
    enemy.animationLockUntil = 0;
    enemy.deathAnimationUntil = 0;
    enemy.nextAnimationFrameAt = Infinity;
    if (corpseFrameIndex === undefined) return;
    enemy.animationFrameIndex = corpseFrameIndex;
    if (shootable.handle) activateShootableAnimationFrame(shootable, corpseFrameIndex);
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
    if (!enemy || !profile || !model?.animationFrames?.length || !shootable.handle || !shootable.visible) return;
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
    if (!model?.animationFrames?.length || !shootable.handle || !shootable.visible) return true;
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
    syncZombiePainDownStep(shootable, step, enemy);
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
    runEnemyQuakecFrameSounds(shootable, step, mode, now);
    runEnemyQuakecFrameEvents(shootable, step, mode, now, context);
    runEnemyQuakecDeathOutputEvents(shootable, step, mode, now);
    syncEnemyQuakecMovementBudget(shootable, step, mode, enemy);
    const attackChain = enemy.pendingAttack?.quakecChain ?? quakecAttackPolicy(shootable)?.chain ?? "attack";
    if (mode === "attack" && (step.chain !== attackChain || (step.chainCycleEnd && !enemy.quakecActiveTouchDamage))) {
      finishEnemyQuakecAttack(shootable, context?.profile, now);
    }
    if ((mode === "death" || mode === "pain") && step.chainCycleEnd) {
      enemy.nextAnimationFrameAt = Infinity;
    }
  }

  function runEnemyQuakecFrameSounds(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    mode: QuakeMonsterAnimationMode,
    now: number,
  ): void {
    for (const soundPath of step.sounds) {
      playQuakecSound(soundPath, shootable, mode, now);
    }
  }

  function playQuakecSound(
    soundPath: string,
    shootable: QuakeShootableState,
    mode: QuakeMonsterAnimationMode,
    now: number,
  ): boolean {
    const played = playSound?.(soundPath, { volume: quakecSoundVolumeForMode(mode) }) ?? false;
    markShootableTrace("enemy-quakec-sound", shootable, {
      mode,
      played,
      sound: soundPath,
      time: now,
    });
    return played;
  }

  function quakecSoundVolumeForMode(mode: QuakeMonsterAnimationMode): number {
    if (mode === "attack") return 0.62;
    if (mode === "death") return 0.72;
    if (mode === "pain") return 0.66;
    return 0.46;
  }

  function selectZombiePainChain(enemy: QuakeEnemyState, drop: boolean): string {
    const runner = enemy.quakecRunner;
    if (drop && runner?.hasChain("pain_down")) return "pain_down";
    const lightChains = QUAKE_ZOMBIE_LIGHT_PAIN_CHAINS.filter((chain) => runner?.hasChain(chain));
    if (lightChains.length > 0) {
      return lightChains[Math.floor(nextEnemyRandom(enemy) * lightChains.length)] ?? lightChains[0];
    }
    return runner?.hasChain("pain_a") ? "pain_a" : "pain";
  }

  function startZombieDownedState(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    now: number,
  ): void {
    const chain = "pain_down";
    const runner = enemy.quakecRunner;
    const nonSolidOffset = quakeMonsterStateOffsetMs(shootable.entity.classname, chain, "zombie_paine10");
    const solidOffset = quakeMonsterStateOffsetMs(shootable.entity.classname, chain, "zombie_paine12");
    const duration = runner ? quakeMonsterChainDurationMs(shootable.entity.classname, chain, runner) : 0;
    enemy.zombieNonSolidAt = now + Math.max(0, nonSolidOffset);
    enemy.zombieSolidAt = now + Math.max(enemy.zombieNonSolidAt - now, solidOffset + QUAKE_ZOMBIE_DOWN_HOLD_MS);
    enemy.zombieRecoverUntil = now + Math.max(enemy.zombieSolidAt - now, duration);
    clearEnemyAttackState(shootable);
    markShootableTrace("zombie-downed", shootable, {
      nonSolidInMs: enemy.zombieNonSolidAt - now,
      solidInMs: enemy.zombieSolidAt - now,
      recoverInMs: enemy.zombieRecoverUntil - now,
    });
  }

  function syncZombiePainDownStep(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    enemy: QuakeEnemyState,
  ): void {
    if (shootable.entity.classname !== "monster_zombie" || step.chain !== "pain_down") return;
    const baseHealth = QUAKE_SHOOTABLE_HEALTH.monster_zombie ?? 60;
    if (step.stateName === "zombie_paine1" || step.stateName === "zombie_paine11" || step.stateName === "zombie_paine12") {
      shootable.health = baseHealth;
    }
    if (step.stateName === "zombie_paine11") {
      enemy.nextAnimationFrameAt += QUAKE_ZOMBIE_DOWN_HOLD_MS;
    }
    if (step.stateName === "zombie_paine30") clearZombieDownedState(enemy);
  }

  function clearZombieDownedState(enemy: QuakeEnemyState): void {
    enemy.zombieNonSolidAt = 0;
    enemy.zombieSolidAt = 0;
    enemy.zombieRecoverUntil = 0;
  }

  function runEnemyQuakecFrameEvents(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    mode: QuakeMonsterAnimationMode,
    now: number,
    context?: QuakeEnemyAnimationContext,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy || mode !== "attack" || !context) return;
    step.events.forEach((event, index) => {
      const eventKey = `${step.stateName}:${index}:${event.call}:${event.type}`;
      if (enemy.quakecFiredEvents.has(eventKey)) return;
      enemy.quakecFiredEvents.add(eventKey);
      runEnemyQuakecFrameEvent(shootable, step, event, now, context);
    });
  }

  function runEnemyQuakecFrameEvent(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    event: QuakeMonsterFrameEvent,
    now: number,
    context: QuakeEnemyAnimationContext,
  ): void {
    if (event.type === "fire_bullets") {
      runEnemyQuakecFireBulletsEvent(shootable, step, event, now, context);
      return;
    }
    if (event.type === "lightning_damage") {
      runEnemyQuakecLightningDamageEvent(shootable, step, event, now, context);
      return;
    }
    if (event.type === "melee_damage") {
      runEnemyQuakecMeleeDamageEvent(shootable, step, event, now, context);
      return;
    }
    if (event.type === "projectile") {
      runEnemyQuakecProjectileEvent(shootable, step, event, now, context);
      return;
    }
    if (event.type === "touch_damage") {
      armEnemyQuakecTouchDamageEvent(shootable, step, event, now);
    }
  }

  function runEnemyQuakecDeathOutputEvents(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    mode: QuakeMonsterAnimationMode,
    now: number,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy || mode !== "death" || isShootableGibbed(shootable)) return;
    const deathOutput = quakeMonsterLogicByClassname[shootable.entity.classname]?.deathOutput;
    const drop = deathOutput?.backpackDrops?.find((candidate) =>
      candidate.chain === step.chain && candidate.stateName === step.stateName
    );
    if (!drop) return;
    const eventKey = `death-output:${step.chain}:${step.stateName}:DropBackpack`;
    if (enemy.quakecFiredEvents.has(eventKey)) return;
    const ammo = quakeMonsterBackpackAmmoEffect(drop);
    if (Object.keys(ammo).length === 0) return;
    enemy.quakecFiredEvents.add(eventKey);
    const backpack = deathOutput?.backpack;
    const emitted = dropBackpack?.({
      ammo,
      ...(backpack?.modelPath ? { modelPath: backpack.modelPath } : {}),
      origin: quakeMonsterBackpackDropOrigin(shootable, backpack),
      ...(typeof backpack?.removeAfterSeconds === "number" ? { removeAfterSeconds: backpack.removeAfterSeconds } : {}),
      ...(backpack?.pickupSoundPath ? { soundPath: backpack.pickupSoundPath } : {}),
      message: quakeMonsterBackpackMessage(ammo),
      sourceEntity: shootable.entity,
    }) ?? false;
    markShootableTrace("monster-backpack-drop", shootable, {
      chain: step.chain,
      emitted: emitted !== false,
      state: step.stateName,
    });
  }

  function quakecSpreadTraceTarget(
    start: Vec3,
    playerOrigin: Vec3,
    range: number,
    spread: readonly [number, number, number],
    enemy: QuakeEnemyState,
  ): Vec3 {
    const baseDirection = normalizeVec3(subtractVec3(playerOrigin, start));
    const right = quakecHorizontalRight(baseDirection);
    const up: Vec3 = [0, 0, 1];
    const spreadX = enemyRandomRange(enemy, -1, 1) * spread[0];
    const spreadY = enemyRandomRange(enemy, -1, 1) * spread[1];
    const direction = normalizeVec3([
      baseDirection[0] + right[0] * spreadX + up[0] * spreadY,
      baseDirection[1] + right[1] * spreadX + up[1] * spreadY,
      baseDirection[2] + right[2] * spreadX + up[2] * spreadY,
    ]);
    return [
      start[0] + direction[0] * range,
      start[1] + direction[1] * range,
      start[2] + direction[2] * range,
    ];
  }

  function quakecHorizontalRight(direction: Vec3): Vec3 {
    const horizontal = Math.hypot(direction[0], direction[1]);
    if (horizontal <= COLLISION_EPSILON) return [1, 0, 0];
    return [-direction[1] / horizontal, direction[0] / horizontal, 0];
  }

  function quakecTraceHitsPlayer(
    start: Vec3,
    target: Vec3,
    range: number,
    playerOrigin: [number, number, number] | Vec3,
  ): QuakeDamageTraceResult {
    const delta = subtractVec3(target, start);
    const targetDistance = Math.hypot(delta[0], delta[1], delta[2]);
    if (targetDistance <= COLLISION_EPSILON) {
      return { distance: 0, hit: false, hitPoint: [...start] as Vec3, reason: "miss" };
    }
    const traceDistance = Math.min(range, targetDistance);
    const direction: Vec3 = [delta[0] / targetDistance, delta[1] / targetDistance, delta[2] / targetDistance];
    const end: Vec3 = [
      start[0] + direction[0] * traceDistance,
      start[1] + direction[1] * traceDistance,
      start[2] + direction[2] * traceDistance,
    ];
    const hitDistance = segmentAabbIntersectionDistance(start, end, quakecPlayerDamageBounds(playerOrigin));
    if (hitDistance === null) {
      const reason = targetDistance > range ? "range" : "miss";
      return { distance: traceDistance, hit: false, hitPoint: end, reason };
    }
    const hitPoint: Vec3 = [
      start[0] + direction[0] * hitDistance,
      start[1] + direction[1] * hitDistance,
      start[2] + direction[2] * hitDistance,
    ];
    if (!hasLineOfSight(start, hitPoint)) {
      return { distance: hitDistance, hit: false, hitPoint, reason: "blocked" };
    }
    return { distance: hitDistance, hit: true, hitPoint, reason: "hit" };
  }

  function quakecCanDamagePlayer(start: Vec3, playerOrigin: [number, number, number] | Vec3): boolean {
    const bounds = quakecPlayerDamageBounds(playerOrigin);
    return hasLineOfSight(start, quakecBoundsCenter(bounds)) || hasLineOfSight(start, playerOrigin);
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

  function quakecPlayerMovementBounds(origin: [number, number, number] | Vec3): QuakeBounds {
    return quakecPlayerDamageBounds(origin);
  }

  function quakecPointToPlayerBoundsDistanceSq(point: Vec3, playerOrigin: [number, number, number] | Vec3): number {
    return pointToAabbDistanceSq(point, quakecPlayerDamageBounds(playerOrigin));
  }

  function quakecBoundsCenter(bounds: QuakeBounds): Vec3 {
    return [
      (bounds.min[0] + bounds.max[0]) * 0.5,
      (bounds.min[1] + bounds.max[1]) * 0.5,
      (bounds.min[2] + bounds.max[2]) * 0.5,
    ];
  }

  function runEnemyQuakecFireBulletsEvent(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    event: QuakeMonsterFireBulletsFrameEvent,
    now: number,
    context: QuakeEnemyAnimationContext,
  ): void {
    const traceRange = quakecScaleUnits(event.traceRangeUnits);
    const enemy = shootable.enemy;
    if (!enemy) return;
    let hitPellets = 0;
    let blockedPellets = 0;
    let missedPellets = 0;
    let rangedOutPellets = 0;
    for (let pellet = 0; pellet < event.pellets; pellet += 1) {
      const target = quakecSpreadTraceTarget(
        context.enemyEye,
        context.playerOrigin,
        traceRange,
        event.spread,
        enemy,
      );
      const trace = quakecTraceHitsPlayer(context.enemyEye, target, traceRange, context.playerOrigin);
      if (trace.hit) {
        hitPellets += 1;
      } else if (trace.reason === "blocked") {
        blockedPellets += 1;
      } else if (trace.reason === "range") {
        rangedOutPellets += 1;
      } else {
        missedPellets += 1;
      }
    }
    const damage = hitPellets * event.pelletDamage;
    const hit = hitPellets > 0;
    markShootableTrace("enemy-quakec-event", shootable, {
      blockedPellets,
      damage,
      event: event.call,
      frame: step.frame,
      frameIndex: step.frameIndex,
      hit,
      hitPellets,
      missedPellets,
      pelletDamage: event.pelletDamage,
      pellets: event.pellets,
      rangedOutPellets,
      spread: event.spread.join(" "),
      state: step.stateName,
      time: now,
      type: event.type,
    });
    if (damage > 0) damagePlayer(damage);
  }

  function runEnemyQuakecLightningDamageEvent(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    event: QuakeMonsterLightningDamageFrameEvent,
    now: number,
    context: QuakeEnemyAnimationContext,
  ): void {
    const origin = quakecOffsetPoint(
      shootable.origin,
      shootable.origin,
      context.playerOrigin,
      event.originOffsetUnits,
    );
    const target = quakecOffsetPoint(
      context.playerOrigin,
      shootable.origin,
      context.playerOrigin,
      event.targetOffsetUnits,
    );
    const range = quakecScaleUnits(event.rangeUnits);
    const trace = quakecTraceHitsPlayer(origin, target, range, context.playerOrigin);
    markShootableTrace("enemy-quakec-event", shootable, {
      call: event.call,
      damage: event.damage,
      frame: step.frame,
      frameIndex: step.frameIndex,
      hit: trace.hit,
      rangeUnits: event.rangeUnits,
      reason: trace.reason,
      state: step.stateName,
      target: event.target,
      time: now,
      type: event.type,
    });
    if (trace.hit) damagePlayer(event.damage);
  }

  function runEnemyQuakecMeleeDamageEvent(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    event: QuakeMonsterMeleeDamageFrameEvent,
    now: number,
    context: QuakeEnemyAnimationContext,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy) return;
    const range = quakecScaleUnits(event.rangeUnits ?? context.profile.range / QUAKE_COLLISION_UNIT_SCALE);
    const distanceSq = quakecPointToPlayerBoundsDistanceSq(shootable.origin, context.playerOrigin);
    const inRange = distanceSq <= range * range;
    const canDamage = !event.requiresCanDamage || quakecCanDamagePlayer(shootableEyeOrigin(shootable), context.playerOrigin);
    const damage = quakecRandomDamage(event.damageBase, event.damageRandomTerms, enemy);
    const hit = inRange && canDamage;
    markShootableTrace("enemy-quakec-event", shootable, {
      call: event.call,
      damage,
      damageBase: event.damageBase,
      damageRandomTerms: event.damageRandomTerms.join(" "),
      frame: step.frame,
      frameIndex: step.frameIndex,
      hit,
      rangeUnits: event.rangeUnits,
      reason: !inRange ? "range" : canDamage ? "hit" : "blocked",
      requiresCanDamage: event.requiresCanDamage ? "true" : undefined,
      state: step.stateName,
      target: event.target,
      time: now,
      type: event.type,
    });
    if (hit) damagePlayer(damage);
  }

  function runEnemyQuakecProjectileEvent(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    event: QuakeMonsterProjectileFrameEvent,
    now: number,
    context: QuakeEnemyAnimationContext,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy) return;
    const profile = quakecProjectileCombatProfile(event, context.profile);
    const start = quakecOffsetPoint(
      shootable.origin,
      shootable.origin,
      context.playerOrigin,
      event.originOffsetUnits,
    );
    const fireProjectile = (fireNow: number, target: Vec3): void => {
      if (shootable.dead || !shootable.enemy || !shootable.visible) return;
      spawnEnemyProjectile(shootable, enemy, start, target, profile, fireNow);
      markShootableTrace("enemy-quakec-event", shootable, {
        call: event.call,
        damage: event.damage,
        delayMs: event.delayMs,
        frame: step.frame,
        frameIndex: step.frameIndex,
        modelPath: event.modelPath,
        speedUnits: event.speedUnits,
        state: step.stateName,
        target: event.target,
        time: fireNow,
        type: event.type,
      });
    };
    const delayMs = Math.max(0, event.delayMs ?? 0);
    if (delayMs <= 0) {
      fireProjectile(now, context.playerOrigin);
      return;
    }
    let timer = 0;
    const fireDelayedProjectile = (): void => {
      enemyProjectileTimers = enemyProjectileTimers.filter((entry) => entry !== timer);
      if (isGameplayPaused?.()) {
        timer = window.setTimeout(fireDelayedProjectile, QUAKE_PAUSED_TIMER_POLL_MS);
        enemyProjectileTimers.push(timer);
        return;
      }
      fireProjectile(performance.now(), getPlayerOrigin());
    };
    timer = window.setTimeout(fireDelayedProjectile, delayMs);
    enemyProjectileTimers.push(timer);
    markShootableTrace("enemy-quakec-projectile-schedule", shootable, {
      call: event.call,
      delayMs,
      frame: step.frame,
      frameIndex: step.frameIndex,
      state: step.stateName,
      type: event.type,
    });
  }

  function quakecProjectileCombatProfile(
    event: QuakeMonsterProjectileFrameEvent,
    baseProfile: QuakeMonsterCombatProfile,
  ): QuakeMonsterCombatProfile {
    const splash = quakecProjectileSplashProfile(event);
    return {
      cooldownMs: baseProfile.cooldownMs,
      cooldownRandomAddMs: baseProfile.cooldownRandomAddMs,
      damage: event.damage,
      kind: "projectile",
      projectileAimError: 0,
      projectileAimDrop: 0,
      projectileClassname: event.classname,
      ...(quakecProjectileUsesGravity(event) ? { projectileGravity: QUAKE_MONSTER_PROJECTILE_GRAVITY } : {}),
      projectileLifetimeMs: event.lifetimeMs,
      projectileModelPath: event.modelPath,
      projectileRadius: quakecScaleUnits(event.radiusUnits),
      projectileSpeed: quakecScaleUnits(event.speedUnits),
      ...(splash ? {
        projectileSplashDamage: splash.damage,
        projectileSplashOnExpire: splash.onExpire,
        projectileSplashRadius: quakecScaleUnits(splash.radiusUnits),
      } : {}),
      projectileTargetOffset: quakecScaleOffset(event.targetOffsetUnits),
      projectileVerticalAimError: 0,
      ...(event.verticalVelocityUnits !== undefined
        ? { projectileVerticalVelocity: quakecScaleUnits(event.verticalVelocityUnits) }
        : {}),
      range: baseProfile.range,
      wakeDelayMs: baseProfile.wakeDelayMs,
      windupMs: baseProfile.windupMs,
    };
  }

  function quakecProjectileSplashProfile(
    event: QuakeMonsterProjectileFrameEvent,
  ): { damage: number; onExpire: boolean; radiusUnits: number } | null {
    if (event.classname === "enemy_projectile_grenade") return { damage: 40, onExpire: true, radiusUnits: 80 };
    if (event.classname === "enemy_projectile_lavaball") return { damage: 120, onExpire: false, radiusUnits: 160 };
    return null;
  }

  function quakecProjectileUsesGravity(event: QuakeMonsterProjectileFrameEvent): boolean {
    return event.classname === "enemy_projectile_grenade" ||
      event.classname === "enemy_projectile_zombie_grenade";
  }

  function armEnemyQuakecTouchDamageEvent(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    event: QuakeMonsterTouchDamageFrameEvent,
    now: number,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy) return;
    enemy.quakecActiveTouchDamage = {
      event,
      expiresAt: now + event.durationMs,
      frame: step.frame,
      frameIndex: step.frameIndex,
      stateName: step.stateName,
    };
    markShootableTrace("enemy-quakec-touch-arm", shootable, {
      durationMs: event.durationMs,
      event: event.call,
      frame: step.frame,
      frameIndex: step.frameIndex,
      minVelocityUnits: event.minVelocityUnits,
      rangeUnits: event.rangeUnits,
      state: step.stateName,
      type: event.type,
    });
  }

  function runEnemyQuakecActiveTouchDamage(
    shootable: QuakeShootableState,
    playerOrigin: [number, number, number],
    profile: QuakeMonsterCombatProfile,
    now: number,
  ): void {
    const enemy = shootable.enemy;
    const active = enemy?.quakecActiveTouchDamage;
    if (!enemy || !active) return;
    if (now > active.expiresAt) {
      enemy.quakecActiveTouchDamage = null;
      markShootableTrace("enemy-quakec-touch-expire", shootable, {
        event: active.event.call,
        state: active.stateName,
        type: active.event.type,
      });
      finishEnemyQuakecAttack(shootable, profile, now);
      return;
    }
    const hit = quakecTouchDamageHits(shootable, playerOrigin, active.event);
    if (!hit) return;
    const damage = quakecRandomDamage(active.event.damageBase, active.event.damageRandomTerms, enemy);
    markShootableTrace("enemy-quakec-event", shootable, {
      call: active.event.call,
      damage,
      damageBase: active.event.damageBase,
      damageRandomTerms: active.event.damageRandomTerms.join(" "),
      frame: active.frame,
      frameIndex: active.frameIndex,
      hit,
      minVelocityUnits: active.event.minVelocityUnits,
      rangeUnits: active.event.rangeUnits,
      reason: "hit",
      state: active.stateName,
      target: active.event.target,
      time: now,
      type: active.event.type,
    });
    damagePlayer(damage);
    enemy.quakecActiveTouchDamage = null;
    finishEnemyQuakecAttack(shootable, profile, now);
  }

  function quakecTouchDamageHits(
    shootable: QuakeShootableState,
    playerOrigin: [number, number, number],
    event: QuakeMonsterTouchDamageFrameEvent,
  ): boolean {
    const range = quakecScaleUnits(event.rangeUnits);
    const playerBounds = quakecPlayerDamageBounds(playerOrigin);
    const shootableBounds = inflateBounds(shootableBoundsForDamage(shootable), QUAKE_SHOOTABLE_COLLISION_EPSILON);
    return aabbsOverlap(playerBounds, shootableBounds) ||
      aabbDistanceSq(playerBounds, shootableBounds) <= range * range;
  }

  function quakecRandomDamage(
    base: number,
    randomTerms: readonly number[],
    enemy: QuakeEnemyState,
  ): number {
    return randomTerms.reduce((total, scale) => total + nextEnemyRandom(enemy) * scale, base);
  }

  function finishEnemyQuakecAttack(
    shootable: QuakeShootableState,
    profile: QuakeMonsterCombatProfile | undefined,
    now: number,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy || !enemy.pendingAttack || !profile) return;
    enemy.pendingAttack = null;
    enemy.attackVisual = "cooldown";
    enemy.burstShotsRemaining = 0;
    enemy.quakecActiveTouchDamage = null;
    if (!quakecAttackCooldownStartsOnSelection(shootable)) {
      enemy.nextAttackAt = now + enemyCooldownMs(profile, enemy);
    }
    enemy.quakecAnimationChain = null;
    enemy.quakecFiredEvents.clear();
    syncShootableEnemyDatasets(shootable);
    markShootableTrace("enemy-quakec-attack-complete", shootable, {
      cooldownMs: enemy.nextAttackAt - now,
    });
  }

  function activateShootableAnimationFrame(shootable: QuakeShootableState, frameIndex: number): void {
    if (shouldThrottleShootableAnimationFrame(shootable)) {
      syncShootableEnemyDatasets(shootable);
      markShootableTrace("enemy-animation-frame-throttled", shootable, {
        requestedFrame: frameIndex,
        handles: countShootableHandles(shootable),
      });
      return;
    }
    if (isQuakeRenderBundleFrameSetHandle(shootable.handle)) {
      if (setQuakeRenderBundleFrameSetHandleFrame(shootable.handle, frameIndex)) {
        syncShootableEnemyDatasets(shootable);
        markShootableTrace("enemy-animation-frame", shootable, {
          backend: "frameset",
          requestedFrame: frameIndex,
          handles: countShootableHandles(shootable),
        });
      }
      return;
    }
    if (!canPoolShootableAnimationFrames(shootable)) {
      replaceShootableAnimationFrame(shootable, frameIndex);
      markShootableTrace("enemy-animation-frame", shootable, {
        backend: "replace",
        requestedFrame: frameIndex,
        handles: countShootableHandles(shootable),
      });
      return;
    }
    const handle = ensureShootableAnimationFrameHandle(shootable, frameIndex);
    if (!handle) return;
    setActiveShootableAnimationFrameHandle(shootable, frameIndex, handle);
    markShootableTrace("enemy-animation-frame", shootable, {
      backend: "pool",
      requestedFrame: frameIndex,
      handles: countShootableHandles(shootable),
    });
    scheduleNextShootableAnimationFramePrewarm(shootable);
  }

  function shouldThrottleShootableAnimationFrame(shootable: QuakeShootableState): boolean {
    if (!shootable.enemy || !shootable.handle || !shootable.visible) return false;
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

  function replaceShootableAnimationFrame(shootable: QuakeShootableState, frameIndex: number): void {
    const previousHandle = shootable.handle;
    if (!previousHandle) return;
    const nextHandle = addShootableMesh(shootable.entity, shootable.model, frameIndex);
    if (!nextHandle) return;
    previousHandle.remove();
    visibilityChurn.totalMeshHandlesRemoved++;
    shootable.handle = nextHandle;
    syncShootableTransform(shootable);
    syncShootableHandleVisibility(shootable);
    syncShootableEnemyDatasets(shootable);
  }

  function syncShootableEnemyDatasets(shootable: QuakeShootableState): void {
    if (!isQuakeDebugDomMetadataEnabled()) return;
    for (const [frameIndex, handle] of shootable.frameHandles) {
      syncShootableEnemyDataset(shootable, handle, frameIndex);
    }
    if (shootable.handle && ![...shootable.frameHandles.values()].includes(shootable.handle)) {
      syncShootableEnemyDataset(shootable, shootable.handle, enemyAnimationFrameIndex(shootable));
    }
  }

  function syncShootableEnemyDataset(
    shootable: QuakeShootableState,
    handle: PolyMeshHandle,
    frameIndex: number,
  ): void {
    if (!isQuakeDebugDomMetadataEnabled()) return;
    const enemy = shootable.enemy;
    if (!enemy) return;
    if (enemy.awake) {
      setElementDatasetValue(handle.element, "awake", "true");
    } else {
      removeElementDatasetValue(handle.element, "awake");
    }
    if (enemy.attackVisual) {
      setElementDatasetValue(handle.element, "attack", enemy.attackVisual);
    } else {
      removeElementDatasetValue(handle.element, "attack");
    }
    setElementDatasetValue(handle.element, "originX", shootable.origin[0].toFixed(4));
    setElementDatasetValue(handle.element, "originY", shootable.origin[1].toFixed(4));
    setElementDatasetValue(handle.element, "originZ", shootable.origin[2].toFixed(4));
    setElementDatasetValue(handle.element, "yaw", shootable.yaw.toFixed(3));
    setElementDatasetValue(handle.element, "animationMode", enemy.animationMode);
    setElementDatasetValue(handle.element, "animationFrame", String(frameIndex));
    if (enemy.quakecLastState) {
      setElementDatasetValue(handle.element, "quakecChain", enemy.quakecLastState.chain);
      setElementDatasetValue(handle.element, "quakecState", enemy.quakecLastState.stateName);
      setElementDatasetValue(handle.element, "quakecFrame", enemy.quakecLastState.frame);
      setElementDatasetValue(handle.element, "quakecCalls", enemy.quakecLastState.calls.join(","));
    } else {
      removeElementDatasetValue(handle.element, "quakecChain");
      removeElementDatasetValue(handle.element, "quakecState");
      removeElementDatasetValue(handle.element, "quakecFrame");
      removeElementDatasetValue(handle.element, "quakecCalls");
    }
  }

  function setElementDatasetValue(element: HTMLElement, key: string, value: string): void {
    if (element.dataset[key] === value) return;
    element.dataset[key] = value;
  }

  function removeElementDatasetValue(element: HTMLElement, key: string): void {
    if (element.dataset[key] === undefined) return;
    delete element.dataset[key];
  }

  function enemyAnimationFrameIndex(shootable: QuakeShootableState): number {
    return shootable.enemy?.animationFrameIndex ?? 0;
  }

  function quakeMonsterAnimationProfile(shootable: QuakeShootableState): QuakeMonsterAnimationProfile | undefined {
    return QUAKE_MONSTER_ANIMATION_PROFILES[shootable.entity.classname];
  }

  function boundedAnimationRange(
    range: QuakeMonsterAnimationRange,
    model: QuakePickupModel,
  ): QuakeMonsterAnimationRange {
    const maxFrameIndex = Math.max(0, (model.animationFrames?.length ?? 1) - 1);
    const start = Math.max(0, Math.min(maxFrameIndex, range.start));
    const end = Math.max(start, Math.min(maxFrameIndex, range.end));
    return { start, end };
  }

  function enemyAnimationFrameDuration(
    profile: QuakeMonsterAnimationProfile,
    mode: QuakeMonsterAnimationMode,
  ): number {
    const fps = enemyAnimationFps(profile, mode);
    return 1000 / Math.max(1, fps ?? 8);
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
      : selectEnemyPainReactionChain(shootable, enemy, now, damageAmount);
    if (!chain) return false;
    enemy.quakecPainChain = chain;
    return startEnemyQuakecNamedChain(shootable, chain, "pain", now) !== null;
  }

  function playEnemyDeathAnimation(shootable: QuakeShootableState, now: number): number | null {
    const enemy = shootable.enemy;
    const gib = shootableDeathGibOutput(shootable);
    if (gib) {
      if (enemy) {
        enemy.quakecDeathChain = null;
        enemy.quakecGibbed = true;
      }
      playQuakecSound(gib.soundPath ?? "player/udeath.wav", shootable, "death", now);
      spawnMonsterDeathOutputVisuals(shootable, gib);
      markShootableTrace("monster-death-output", shootable, {
        gibModels: gib.gibModelPaths.length,
        health: shootable.health,
      });
      return null;
    }
    if (enemy?.zombieGibbed) return null;
    if (enemy) {
      enemy.quakecDeathChain = selectEnemyDeathReactionChain(shootable, enemy);
      enemy.quakecFiredEvents.clear();
    }
    const quakecDuration = startEnemyQuakecOneShotAnimation(shootable, "death", now);
    if (quakecDuration !== null) {
      if (enemy) enemy.deathAnimationUntil = now + quakecDuration;
      return Math.max(QUAKE_SHOOTABLE_DEATH_DELAY_MS, quakecDuration);
    }
    return null;
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
  ): number | null {
    const enemy = shootable.enemy;
    const runner = enemy?.quakecRunner;
    const model = shootable.model;
    if (!enemy || !runner || !model?.animationFrames?.length || !shootable.handle || !shootable.visible) {
      return null;
    }
    if (!runner.hasChain(chain)) return null;
    const step = runner.enterChain(chain);
    if (!step) return null;
    const duration = quakeMonsterChainDurationMs(shootable.entity.classname, chain, runner);
    enemy.quakecAnimationChain = chain;
    enemy.animationLockUntil = now + duration;
    enemy.nextAnimationFrameAt = now + QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;
    applyEnemyQuakecAnimationStep(shootable, step, mode, now);
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
    if (!enemy || !profile || !range || !model?.animationFrames?.length || !shootable.handle || !shootable.visible) {
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

  function enemyAnimationModeLoops(mode: QuakeMonsterAnimationMode): boolean {
    return mode === "idle" || mode === "path" || mode === "walk";
  }

  function enemyOptionalAnimationRange(
    profile: QuakeMonsterAnimationProfile,
    mode: QuakeMonsterAnimationMode,
  ): QuakeMonsterAnimationRange | undefined {
    if (mode === "attack") return profile.attack;
    if (mode === "death") return profile.death;
    if (mode === "pain") return profile.pain;
    if (mode === "path") return profile.walk ?? profile.idle;
    if (mode === "walk") return profile.walk ?? profile.idle;
    return profile.idle;
  }

  function enemyAnimationRange(
    profile: QuakeMonsterAnimationProfile,
    mode: QuakeMonsterAnimationMode,
  ): QuakeMonsterAnimationRange {
    return enemyOptionalAnimationRange(profile, mode) ?? profile.idle;
  }

  function enemyAnimationFps(
    profile: QuakeMonsterAnimationProfile,
    mode: QuakeMonsterAnimationMode,
  ): number | undefined {
    if (mode === "attack") return profile.attackFps ?? profile.fps;
    if (mode === "death") return profile.deathFps ?? profile.fps;
    if (mode === "pain") return profile.painFps ?? profile.fps;
    if (mode === "path") return profile.walkFps ?? profile.fps;
    if (mode === "walk") return profile.walkFps ?? profile.fps;
    return profile.idleFps ?? profile.fps;
  }

  function quakecAnimationChainForMode(shootable: QuakeShootableState, mode: QuakeMonsterAnimationMode): string {
    if (mode === "attack") {
      return shootable.enemy?.pendingAttack?.quakecChain ?? quakecAttackPolicy(shootable)?.chain ?? "attack";
    }
    if (mode === "death") return shootable.enemy?.quakecDeathChain ?? "death_a";
    if (mode === "pain") return shootable.enemy?.quakecPainChain ?? "pain_a";
    if (mode === "path") return "walk";
    if (mode === "walk") return "run";
    return "stand";
  }

  function selectEnemyPainReactionChain(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    now: number,
    damageAmount: number,
  ): string | null {
    const policy = quakeMonsterPainReactionPolicy(shootable.entity.classname);
    if (!policy) return quakeMonsterChainOrFallback(shootable.entity.classname, "pain_a", "pain_a");
    if (enemy.quakecPainFinishedUntil > now) return null;
    const flinchScale = policy.flinchDamageRandomScale;
    if (typeof flinchScale === "number" && nextEnemyRandom(enemy) * flinchScale > damageAmount) {
      if (policy.cooldownOnFailedFlinch && policy.cooldownMs) {
        enemy.quakecPainFinishedUntil = now + policy.cooldownMs;
      }
      return null;
    }
    const branch = selectQuakeMonsterReactionBranch(policy.branches, enemy);
    const chain = branch?.chain ?? "pain_a";
    const cooldownMs = branch?.cooldownMs ?? policy.cooldownMs ?? 0;
    if (cooldownMs > 0) enemy.quakecPainFinishedUntil = now + cooldownMs;
    return quakeMonsterChainOrFallback(shootable.entity.classname, chain, "pain_a");
  }

  function selectEnemyDeathReactionChain(shootable: QuakeShootableState, enemy: QuakeEnemyState): string {
    const policy = quakeMonsterDeathReactionPolicy(shootable.entity.classname);
    const branch = selectQuakeMonsterReactionBranch(policy?.regularBranches ?? [], enemy);
    return quakeMonsterChainOrFallback(shootable.entity.classname, branch?.chain ?? "death_a", "death_a");
  }

  function selectQuakeMonsterReactionBranch(
    branches: readonly QuakeMonsterRandomBranch[],
    enemy: QuakeEnemyState,
  ): QuakeMonsterRandomBranch | undefined {
    if (branches.length <= 1) return branches[0];
    const roll = nextEnemyRandom(enemy);
    return branches.find((branch) => quakeMonsterReactionBranchMatches(branch, roll)) ?? branches[branches.length - 1];
  }

  function quakeMonsterReactionBranchMatches(branch: QuakeMonsterRandomBranch, roll: number): boolean {
    if (branch.otherwise) return true;
    if (typeof branch.randomLessThan === "number" && roll < branch.randomLessThan) return true;
    if (typeof branch.randomGreaterThan === "number" && roll > branch.randomGreaterThan) return true;
    return branch.randomLessThan === undefined && branch.randomGreaterThan === undefined;
  }

  function quakeMonsterPainReactionPolicy(classname: string): QuakeMonsterPainReactionProfile | undefined {
    return quakeMonsterLogicByClassname[classname]?.reactionProfile?.pain;
  }

  function quakeMonsterDeathReactionPolicy(classname: string): QuakeMonsterDeathReactionProfile | undefined {
    return quakeMonsterLogicByClassname[classname]?.reactionProfile?.death;
  }

  function shootableDeathGibOutput(shootable: QuakeShootableState): QuakeMonsterDeathGibOutput | undefined {
    const gib = quakeMonsterLogicByClassname[shootable.entity.classname]?.deathOutput?.gib;
    if (!gib) return undefined;
    if (shootable.entity.classname === "monster_zombie") {
      return shootable.enemy?.zombieGibbed ? gib : undefined;
    }
    return typeof gib.healthBelow === "number" && shootable.health < gib.healthBelow ? gib : undefined;
  }

  function isShootableGibbed(shootable: QuakeShootableState): boolean {
    return Boolean(shootable.enemy?.quakecGibbed || shootable.enemy?.zombieGibbed);
  }

  function quakeMonsterBackpackAmmoEffect(drop: QuakeMonsterDeathBackpackDrop): QuakePickupEffect {
    const ammo: QuakePickupEffect = {};
    for (const field of ["shells", "nails", "rockets", "cells"] as const) {
      const amount = drop.ammo?.[field];
      if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
        ammo[field] = amount;
      }
    }
    return ammo;
  }

  function quakeMonsterBackpackDropOrigin(
    shootable: QuakeShootableState,
    backpack: QuakeMonsterDeathBackpackProfile | undefined,
  ): Vec3 {
    const offset = backpack?.originOffsetUnits ?? [0, 0, -24];
    return [
      shootable.origin[0] + quakecScaleUnits(offset[0]),
      shootable.origin[1] + quakecScaleUnits(offset[1]),
      shootable.origin[2] + quakecScaleUnits(offset[2]),
    ];
  }

  function quakeMonsterBackpackMessage(ammo: QuakePickupEffect): string {
    const entries = ([
      ["shells", "shell"],
      ["nails", "nail"],
      ["rockets", "rocket"],
      ["cells", "cell"],
    ] as const)
      .map(([field, singular]) => {
        const amount = ammo[field];
        if (typeof amount !== "number" || amount <= 0) return null;
        return `${amount} ${singular}${amount === 1 ? "" : "s"}`;
      })
      .filter((entry): entry is string => Boolean(entry));
    return entries.length ? `You get ${entries.join(", ")}` : "You get ammo";
  }

  function spawnMonsterDeathOutputVisuals(
    shootable: QuakeShootableState,
    gib: QuakeMonsterDeathGibOutput,
  ): void {
    if (!shootable.visible || !shootable.handle || !currentModelLibrary) return;
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
    for (const [index, item] of pieces.entries()) {
      const model = currentModelLibrary.models[item.path];
      if (!model) continue;
      const angle = (shootable.yaw * Math.PI) / 180 + (index / count) * Math.PI * 2;
      const radius = item.kind === "head" ? 0.08 : 0.18 + (index % 3) * 0.04;
      const origin: Vec3 = [
        shootable.origin[0] + Math.cos(angle) * radius,
        shootable.origin[1] + Math.sin(angle) * radius,
        shootable.origin[2] + (item.kind === "head" ? 0.65 : 0.28 + (index % 2) * 0.08),
      ];
      const handle = addMonsterDeathOutputMesh(shootable, model, origin, shootable.yaw + index * 37, item.kind);
      if (!handle) continue;
      const output: QuakeMonsterDeathOutputVisualHandle = {
        handle,
        timer: 0,
      };
      const timer = window.setTimeout(() => {
        output.handle.remove();
        visibilityChurn.totalMeshHandlesRemoved++;
        deathOutputHandles = deathOutputHandles.filter((entry) => entry !== output);
      }, QUAKE_MONSTER_DEATH_OUTPUT_LIFETIME_MS);
      output.timer = timer;
      deathOutputHandles.push(output);
    }
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
      rotation: [0, 0, monsterDeathOutputRenderYaw(kind, yaw)],
      scale: model.renderScale ? 1 / model.renderScale : 1,
    });
    return handle;
  }

  function quakeMonsterChainOrFallback(classname: string, chain: string, fallback: string): string {
    const chains = quakeMonsterLogicByClassname[classname]?.chains;
    if (chains?.[chain]?.states.length) return chain;
    if (chains?.[fallback]?.states.length) return fallback;
    return chain;
  }

  function shootableUsesQuakecAttackEvents(shootable: QuakeShootableState): boolean {
    return Boolean(quakecAttackPolicy(shootable)?.usesFrameEvents);
  }

  function enemyCorpseFrameIndex(shootable: QuakeShootableState): number | undefined {
    const enemy = shootable.enemy;
    const quakecDeathFrame = enemy?.quakecLastState &&
      (enemy.quakecLastState.chain === enemy.quakecDeathChain || enemy.quakecLastState.chain.startsWith("death"))
      ? enemy.quakecLastState.frameIndex
      : undefined;
    if (quakecDeathFrame !== undefined) return quakecDeathFrame;
    const profile = quakeMonsterAnimationProfile(shootable);
    const model = shootable.model;
    if (!profile?.death || !model?.animationFrames?.length) return undefined;
    return boundedAnimationRange(profile.death, model).end;
  }

  function isPersistentShootableCorpse(shootable: QuakeShootableState): boolean {
    if (quakeBossScriptedLifecycle(shootable.entity.classname)) return false;
    return shootable.dead && Boolean(shootable.enemy) && !isShootableGibbed(shootable);
  }

  function isShootableDeathAnimating(shootable: QuakeShootableState, now = performance.now()): boolean {
    return shootable.dead && Boolean(shootable.enemy?.deathAnimationUntil && shootable.enemy.deathAnimationUntil > now);
  }

  function isZombieRecovering(shootable: QuakeShootableState, now = performance.now()): boolean {
    return shootable.entity.classname === "monster_zombie" &&
      Boolean(shootable.enemy?.zombieRecoverUntil && shootable.enemy.zombieRecoverUntil > now);
  }

  function isZombieNonSolid(shootable: QuakeShootableState, now = performance.now()): boolean {
    const enemy = shootable.enemy;
    return shootable.entity.classname === "monster_zombie" &&
      Boolean(
        enemy?.zombieNonSolidAt &&
        enemy.zombieSolidAt &&
        now >= enemy.zombieNonSolidAt &&
        now < enemy.zombieSolidAt,
      );
  }

  function syncShootableLifecycleClassesForShootable(shootable: QuakeShootableState): void {
    forEachShootableHandle(shootable, (handle) => syncShootableLifecycleClasses(shootable, handle));
  }

  function syncShootableLifecycleClasses(shootable: QuakeShootableState, handle: PolyMeshHandle): void {
    if (!shootable.dead) {
      handle.element.classList.remove(
        QUAKE_SHOOTABLE_CORPSE_CLASS,
        QUAKE_SHOOTABLE_DEAD_CLASS,
        QUAKE_SHOOTABLE_DYING_CLASS,
      );
      return;
    }
    handle.element.classList.remove(QUAKE_SHOOTABLE_HURT_CLASS);
    if (isShootableDeathAnimating(shootable)) {
      handle.element.classList.add(QUAKE_SHOOTABLE_DYING_CLASS);
      handle.element.classList.remove(QUAKE_SHOOTABLE_CORPSE_CLASS, QUAKE_SHOOTABLE_DEAD_CLASS);
      return;
    }
    handle.element.classList.remove(QUAKE_SHOOTABLE_DYING_CLASS);
    if (isPersistentShootableCorpse(shootable)) {
      handle.element.classList.add(QUAKE_SHOOTABLE_CORPSE_CLASS);
      handle.element.classList.remove(QUAKE_SHOOTABLE_DEAD_CLASS);
      return;
    }
    handle.element.classList.add(QUAKE_SHOOTABLE_DEAD_CLASS);
    handle.element.classList.remove(QUAKE_SHOOTABLE_CORPSE_CLASS);
  }

  function enemyWakeDelayMs(profile: QuakeMonsterCombatProfile, enemy: QuakeEnemyState): number {
    return Math.max(0, (profile.wakeDelayMs ?? QUAKE_MONSTER_ATTACK_DELAY_MS) +
      enemyRandomRange(enemy, 0, profile.wakeDelayJitterMs ?? 0));
  }

  function enemyCooldownMs(profile: QuakeMonsterCombatProfile, enemy: QuakeEnemyState): number {
    const jitter = Math.max(0, profile.cooldownJitterMs ?? 0);
    const randomAdd = Math.max(0, profile.cooldownRandomAddMs ?? 0);
    const variance = randomAdd > 0
      ? enemyRandomRange(enemy, 0, randomAdd)
      : enemyRandomRange(enemy, -jitter, jitter);
    return Math.max(80, profile.cooldownMs + variance);
  }

  function enemyAttackOrigin(
    shootable: QuakeShootableState,
    eyeOrigin: Vec3,
    playerOrigin: [number, number, number],
    profile: QuakeMonsterCombatProfile,
  ): Vec3 {
    const offset = profile.projectileOriginOffset;
    if (!offset) return eyeOrigin;
    const dx = playerOrigin[0] - shootable.origin[0];
    const dy = playerOrigin[1] - shootable.origin[1];
    const length = Math.hypot(dx, dy) || 1;
    const forward: Vec3 = [dx / length, dy / length, 0];
    const right: Vec3 = [-forward[1], forward[0], 0];
    return [
      eyeOrigin[0] + forward[0] * (offset.forward ?? 0) + right[0] * (offset.right ?? 0),
      eyeOrigin[1] + forward[1] * (offset.forward ?? 0) + right[1] * (offset.right ?? 0),
      eyeOrigin[2] + (offset.up ?? 0),
    ];
  }

  function quakecOffsetPoint(
    origin: Vec3,
    basisOrigin: Vec3,
    basisTarget: Vec3,
    offset: QuakeMonsterProjectileOffsetUnits | QuakeMonsterProjectileOffset | undefined,
  ): Vec3 {
    if (!offset) return [...origin] as Vec3;
    const scaledOffset = isQuakecOffsetUnits(offset) ? quakecScaleOffset(offset) : offset;
    if (!scaledOffset) return [...origin] as Vec3;
    const dx = basisTarget[0] - basisOrigin[0];
    const dy = basisTarget[1] - basisOrigin[1];
    const length = Math.hypot(dx, dy) || 1;
    const forward: Vec3 = [dx / length, dy / length, 0];
    const right: Vec3 = [-forward[1], forward[0], 0];
    return [
      origin[0] + forward[0] * (scaledOffset.forward ?? 0) + right[0] * (scaledOffset.right ?? 0),
      origin[1] + forward[1] * (scaledOffset.forward ?? 0) + right[1] * (scaledOffset.right ?? 0),
      origin[2] + (scaledOffset.up ?? 0),
    ];
  }

  function quakecScaleOffset(
    offset: QuakeMonsterProjectileOffsetUnits | undefined,
  ): QuakeMonsterProjectileOffset | undefined {
    if (!offset) return undefined;
    return {
      ...(offset.forward !== undefined ? { forward: quakecScaleUnits(offset.forward) } : {}),
      ...(offset.right !== undefined ? { right: quakecScaleUnits(offset.right) } : {}),
      ...(offset.up !== undefined ? { up: quakecScaleUnits(offset.up) } : {}),
    };
  }

  function isQuakecOffsetUnits(
    offset: QuakeMonsterProjectileOffsetUnits | QuakeMonsterProjectileOffset,
  ): offset is QuakeMonsterProjectileOffsetUnits {
    const maxAbs = Math.max(
      Math.abs(offset.forward ?? 0),
      Math.abs(offset.right ?? 0),
      Math.abs(offset.up ?? 0),
    );
    return maxAbs > 1;
  }

  function moveChasingEnemy(
    shootable: QuakeShootableState,
    playerOrigin: Vec3,
    profile: QuakeMonsterCombatProfile,
    dt: number,
    now: number,
    canSeePlayer: boolean,
  ): boolean {
    const stopDistance = canSeePlayer
      ? Math.max(profile.chaseStopDistance ?? profile.range * 0.72, PLAYER_RADIUS * 1.45)
      : 0;
    return moveEnemyTowardOrigin(shootable, playerOrigin, profile, dt, now, {
      allowWallFollow: true,
      goalBounds: quakecPlayerMovementBounds(playerOrigin),
      movementCall: "ai_run",
      stopDistance,
    });
  }

  function moveEnemyTowardOrigin(
    shootable: QuakeShootableState,
    targetOrigin: Vec3,
    profile: QuakeMonsterCombatProfile,
    dt: number,
    now: number,
    options: QuakeMoveGoalOptions,
  ): boolean {
    const chaseSpeed = profile.chaseSpeed ?? 0;
    if (chaseSpeed <= 0 || dt <= 0) return false;
    const sourceMovementBudget = quakecMovementBudget(shootable, options.movementCall);
    const stepBudget = quakecMovementStepBudget(shootable.enemy, sourceMovementBudget, chaseSpeed, dt, now);
    const usesQuakecMovementBudget = sourceMovementBudget !== null;
    const movementEpsilon = usesQuakecMovementBudget ? COLLISION_EPSILON : QUAKE_SHOOTABLE_COLLISION_EPSILON;
    if (stepBudget <= movementEpsilon) return false;
    if (usesQuakecMovementBudget && options.goalBounds && quakeMoveGoalBoundsCloseEnough(
      shootableCollisionWorldBounds(shootable),
      options.goalBounds,
      stepBudget,
    )) {
      clearQuakecMovementBudget(shootable.enemy);
      markShootableTrace("enemy-move-close-enough", shootable, { step: stepBudget });
      return false;
    }
    const dx = targetOrigin[0] - shootable.origin[0];
    const dy = targetOrigin[1] - shootable.origin[1];
    const distance = Math.hypot(dx, dy);
    const remainingDistance = distance - options.stopDistance;
    if (!Number.isFinite(distance) || remainingDistance <= QUAKE_SHOOTABLE_COLLISION_EPSILON) {
      if (sourceMovementBudget !== null) clearQuakecMovementBudget(shootable.enemy);
      return false;
    }
    const step = Math.min(stepBudget, remainingDistance);
    if (step <= movementEpsilon) return false;
    const directYaw = quakeYawFromDirection(dx / distance, dy / distance);
    const candidates = usesQuakecMovementBudget
      ? quakeMoveGoalCandidates(shootable.enemy, shootable.origin, targetOrigin, options.allowWallFollow, directYaw)
      : [quakeMoveGoalCandidate(directYaw, "direct")];
    for (const candidate of candidates) {
      if (tryMoveChasingEnemy(shootable, candidate, step, usesQuakecMovementBudget, movementEpsilon)) return true;
    }
    if (usesQuakecMovementBudget && shootable.enemy) {
      shootable.enemy.quakecIdealYaw = quakeMoveGoalOlddir(shootable.enemy.quakecIdealYaw ?? directYaw);
    }
    if (sourceMovementBudget !== null) clearQuakecMovementBudget(shootable.enemy);
    return false;
  }

  function tryMoveChasingEnemy(
    shootable: QuakeShootableState,
    candidate: QuakeMoveGoalCandidate,
    step: number,
    usesQuakecMovementBudget: boolean,
    movementEpsilon: number,
  ): boolean {
    const horizontalNextOrigin: Vec3 = [
      shootable.origin[0] + candidate.dx * step,
      shootable.origin[1] + candidate.dy * step,
      shootable.origin[2],
    ];
    const nextOrigin = groundedShootableOrigin(shootable.entity, horizontalNextOrigin, shootable.collisionBounds, "move");
    if (distanceSq3(nextOrigin, shootable.origin) <= movementEpsilon * movementEpsilon) {
      return false;
    }
    const from = shootableEyeOrigin(shootable);
    const to: Vec3 = [nextOrigin[0], nextOrigin[1], from[2]];
    if (!hasLineOfSight(from, to)) return false;
    if (usesQuakecMovementBudget && !quakeMonsterMoveBottomSupported(shootable, nextOrigin)) return false;
    shootable.origin = nextOrigin;
    shootable.leafIndex = leafIndexAt(nextOrigin);
    if (usesQuakecMovementBudget) {
      consumeQuakecMovementBudget(shootable.enemy, step);
      if (shootable.enemy) shootable.enemy.quakecIdealYaw = candidate.yaw;
    }
    markShootableTrace("enemy-move", shootable, {
      sourceStep: usesQuakecMovementBudget,
      step,
      x: nextOrigin[0],
      y: nextOrigin[1],
      z: nextOrigin[2],
      groundDz: nextOrigin[2] - horizontalNextOrigin[2],
      moveType: candidate.type,
      yaw: candidate.yaw,
    });
    return true;
  }

  function quakeMonsterMoveBottomSupported(shootable: QuakeShootableState, origin: Vec3): boolean {
    const spawnProfile = quakeMonsterSpawnProfileForEntity(shootable.entity);
    if (!shootable.entity.classname.startsWith("monster_") || !spawnProfile?.dropToFloor) return true;
    const bounds = shootable.collisionBounds;
    const mins: Vec3 = [
      origin[0] + bounds.min[0],
      origin[1] + bounds.min[1],
      origin[2] + bounds.min[2],
    ];
    const maxs: Vec3 = [
      origin[0] + bounds.max[0],
      origin[1] + bounds.max[1],
      origin[2] + bounds.max[2],
    ];
    const footZ = mins[2];
    const traceMaxZ = footZ + GROUND_SNAP;
    const traceMinZ = footZ - STEP_HEIGHT * 2 - GROUND_SNAP;
    if (quakeMonsterBottomCornersSolid(mins, maxs)) return true;
    const centerX = (mins[0] + maxs[0]) * 0.5;
    const centerY = (mins[1] + maxs[1]) * 0.5;
    const midFloor = floorAt(centerX, centerY, traceMaxZ, traceMinZ);
    if (midFloor === null) {
      markShootableTrace("enemy-move-check-bottom", shootable, { reason: "midpoint-unsupported" });
      return false;
    }
    const corners: Array<[number, number]> = [
      [mins[0], mins[1]],
      [mins[0], maxs[1]],
      [maxs[0], mins[1]],
      [maxs[0], maxs[1]],
    ];
    for (const [x, y] of corners) {
      const cornerFloor = floorAt(x, y, traceMaxZ, traceMinZ);
      if (cornerFloor === null || midFloor - cornerFloor > STEP_HEIGHT + QUAKE_SHOOTABLE_COLLISION_EPSILON) {
        markShootableTrace("enemy-move-check-bottom", shootable, {
          cornerFloor,
          midFloor,
          reason: cornerFloor === null ? "unsupported" : "step",
          x,
          y,
        });
        return false;
      }
    }
    return true;
  }

  function quakeMonsterBottomCornersSolid(mins: Vec3, maxs: Vec3): boolean {
    if (!contentsAt) return false;
    const z = mins[2] - QUAKE_COLLISION_UNIT_SCALE;
    const corners: Array<[number, number]> = [
      [mins[0], mins[1]],
      [mins[0], maxs[1]],
      [maxs[0], mins[1]],
      [maxs[0], maxs[1]],
    ];
    return corners.every(([x, y]) => contentsAt([x, y, z]) === QUAKE_CONTENTS_SOLID);
  }

  function quakeMoveGoalCandidates(
    enemy: QuakeEnemyState | undefined,
    origin: Vec3,
    targetOrigin: Vec3,
    allowWallFollow: boolean,
    directYaw: number,
  ): QuakeMoveGoalCandidate[] {
    if (!allowWallFollow) return [quakeMoveGoalCandidate(directYaw, "direct")];

    const idealYaw = enemy?.quakecIdealYaw ?? directYaw;
    const olddir = quakeMoveGoalOlddir(idealYaw);
    const turnaround = angleMod(olddir - 180);
    const out: QuakeMoveGoalCandidate[] = [];
    if (!enemy || nextEnemyRandom(enemy) >= 0.25) {
      out.push(quakeMoveGoalCandidate(idealYaw, "ideal"));
    }

    const deltaX = targetOrigin[0] - origin[0];
    const deltaY = targetOrigin[1] - origin[1];
    const xDir = deltaX > 10 * QUAKE_COLLISION_UNIT_SCALE
      ? 0
      : deltaX < -10 * QUAKE_COLLISION_UNIT_SCALE
        ? 180
        : null;
    const yDir = deltaY < -10 * QUAKE_COLLISION_UNIT_SCALE
      ? 270
      : deltaY > 10 * QUAKE_COLLISION_UNIT_SCALE
        ? 90
        : null;

    if (xDir !== null && yDir !== null) {
      const diagonal = xDir === 0 ? (yDir === 90 ? 45 : 315) : (yDir === 90 ? 135 : 215);
      if (diagonal !== turnaround) out.push(quakeMoveGoalCandidate(diagonal, "direct"));
    }

    let firstDir = xDir;
    let secondDir = yDir;
    if ((enemy && nextEnemyRandom(enemy) < 0.5) || Math.abs(deltaY) > Math.abs(deltaX)) {
      firstDir = yDir;
      secondDir = xDir;
    }
    if (firstDir !== null && firstDir !== turnaround) out.push(quakeMoveGoalCandidate(firstDir, "direct"));
    if (secondDir !== null && secondDir !== turnaround) out.push(quakeMoveGoalCandidate(secondDir, "direct"));
    out.push(quakeMoveGoalCandidate(olddir, "ideal"));

    const sweepAscending = !enemy || nextEnemyRandom(enemy) < 0.5;
    const sweep = sweepAscending
      ? [0, 45, 90, 135, 180, 225, 270, 315]
      : [315, 270, 225, 180, 135, 90, 45, 0];
    for (const yaw of sweep) {
      if (yaw !== turnaround) out.push(quakeMoveGoalCandidate(yaw, "sweep"));
    }
    out.push(quakeMoveGoalCandidate(turnaround, "turnaround"));
    return uniqueMoveGoalCandidates(out);
  }

  function quakeMoveGoalBoundsCloseEnough(actorBounds: QuakeBounds, goalBounds: QuakeBounds, dist: number): boolean {
    for (let axis = 0; axis < 3; axis += 1) {
      if ((goalBounds.min[axis] ?? 0) > (actorBounds.max[axis] ?? 0) + dist) return false;
      if ((goalBounds.max[axis] ?? 0) < (actorBounds.min[axis] ?? 0) - dist) return false;
    }
    return true;
  }

  function uniqueMoveGoalCandidates(candidates: QuakeMoveGoalCandidate[]): QuakeMoveGoalCandidate[] {
    const seen = new Set<number>();
    const out: QuakeMoveGoalCandidate[] = [];
    for (const candidate of candidates) {
      const yawKey = Math.round(angleMod(candidate.yaw) * 1000);
      if (seen.has(yawKey)) continue;
      seen.add(yawKey);
      out.push(candidate);
    }
    return out;
  }

  function quakeMoveGoalCandidate(yaw: number, type: QuakeMoveGoalCandidate["type"]): QuakeMoveGoalCandidate {
    const radians = (angleMod(yaw) * Math.PI) / 180;
    return {
      dx: Math.cos(radians),
      dy: Math.sin(radians),
      type,
      yaw: angleMod(yaw),
    };
  }

  function quakeMoveGoalOlddir(idealYaw: number): number {
    return angleMod(Math.trunc(angleMod(idealYaw) / 45) * 45);
  }

  function quakeYawToOrigin(origin: Vec3, targetOrigin: Vec3): number {
    return quakeYawFromDirection(targetOrigin[0] - origin[0], targetOrigin[1] - origin[1]);
  }

  function quakeYawFromDirection(dx: number, dy: number): number {
    if (Math.abs(dx) <= Number.EPSILON && Math.abs(dy) <= Number.EPSILON) return 0;
    return angleMod((Math.atan2(dy, dx) * 180) / Math.PI);
  }

  function angleMod(yaw: number): number {
    return ((yaw % 360) + 360) % 360;
  }

  function shouldAnimateChasingEnemy(
    shootable: QuakeShootableState,
    playerOrigin: Vec3,
    profile: QuakeMonsterCombatProfile,
    canSeePlayer: boolean,
  ): boolean {
    const stopDistance = canSeePlayer
      ? Math.max(profile.chaseStopDistance ?? profile.range * 0.72, PLAYER_RADIUS * 1.45)
      : 0;
    return shouldAnimateMovingEnemy(shootable, playerOrigin, stopDistance);
  }

  function shouldAnimateMovingEnemy(
    shootable: QuakeShootableState,
    targetOrigin: Vec3,
    stopDistance: number,
    epsilon = QUAKE_SHOOTABLE_COLLISION_EPSILON,
  ): boolean {
    const enemy = shootable.enemy;
    if (!enemy?.quakecRunner) return false;
    const dx = targetOrigin[0] - shootable.origin[0];
    const dy = targetOrigin[1] - shootable.origin[1];
    const distance = Math.hypot(dx, dy);
    return Number.isFinite(distance) && distance - stopDistance > epsilon;
  }

  function quakecMovementBudget(
    shootable: QuakeShootableState,
    movementCall: "ai_run" | "ai_walk",
  ): number | null {
    const enemy = shootable.enemy;
    if (!enemy || !enemy.quakecRunner || !quakecMonsterHasMovement(shootable.entity.classname, movementCall)) return null;
    if (enemy.quakecMovementCall !== movementCall) return 0;
    return enemy.quakecMovementStateName && enemy.quakecMovementUnitsRemaining > 0
      ? enemy.quakecMovementUnitsRemaining
      : 0;
  }

  function quakecMovementStepBudget(
    enemy: QuakeEnemyState | undefined,
    sourceMovementBudget: number | null,
    fallbackSpeed: number,
    dt: number,
    now: number,
  ): number {
    if (sourceMovementBudget === null) return fallbackSpeed * dt;
    const sourceFrameRemainingMs = Math.max(QUAKE_ENEMY_TICK_MS, (enemy?.nextAnimationFrameAt ?? 0) - now);
    const sourceSpeed = sourceMovementBudget / (sourceFrameRemainingMs / 1000);
    return Math.min(sourceSpeed * dt, sourceMovementBudget);
  }

  function syncEnemyQuakecMovementBudget(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    mode: QuakeMonsterAnimationMode,
    enemy: QuakeEnemyState,
  ): void {
    const movementCall = mode === "walk" ? "ai_run" : mode === "path" ? "ai_walk" : null;
    if (!movementCall || !quakecMonsterHasMovement(shootable.entity.classname, movementCall)) {
      clearQuakecMovementBudget(enemy);
      return;
    }
    const distanceUnits = quakecStepMovementDistanceUnits(step, movementCall);
    if (distanceUnits === null) {
      clearQuakecMovementBudget(enemy);
      return;
    }
    enemy.quakecMovementCall = movementCall;
    enemy.quakecMovementStateName = step.stateName;
    enemy.quakecMovementUnitsRemaining = quakecScaleUnits(distanceUnits);
  }

  function quakecStepMovementDistanceUnits(
    step: QuakeMonsterStateStep,
    callName: string,
  ): number | null {
    for (const movement of step.movement) {
      if (movement.call === callName && typeof movement.distanceUnits === "number") {
        return movement.distanceUnits;
      }
    }
    return null;
  }

  function quakecMonsterHasRunMovement(classname: string): boolean {
    return quakecMonsterRunMovementDistances(classname).length > 0;
  }

  function consumeQuakecMovementBudget(enemy: QuakeEnemyState | undefined, amount: number): void {
    if (!enemy) return;
    enemy.quakecMovementUnitsRemaining = Math.max(0, enemy.quakecMovementUnitsRemaining - amount);
    if (enemy.quakecMovementUnitsRemaining <= COLLISION_EPSILON) {
      clearQuakecMovementBudget(enemy);
    }
  }

  function clearQuakecMovementBudget(enemy: QuakeEnemyState | undefined): void {
    if (!enemy) return;
    enemy.quakecMovementCall = null;
    enemy.quakecMovementStateName = null;
    enemy.quakecMovementUnitsRemaining = 0;
  }

  function spawnEnemyProjectile(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    start: Vec3,
    target: Vec3,
    profile: QuakeMonsterCombatProfile,
    now: number,
  ): void {
    const speed = profile.projectileSpeed ?? 420 * QUAKE_COLLISION_UNIT_SCALE;
    const radius = profile.projectileRadius ?? QUAKE_MONSTER_PROJECTILE_RADIUS;
    const direction = normalizeVec3(subtractVec3(enemyProjectileAimTarget(start, target, profile, enemy), start));
    const velocity: Vec3 = [
      direction[0] * speed,
      direction[1] * speed,
      direction[2] * speed,
    ];
    if (profile.projectileVerticalVelocity !== undefined) velocity[2] = profile.projectileVerticalVelocity;
    const projectile: QuakeEnemyProjectile = {
      damage: profile.damage,
      expiresAt: now + (profile.projectileLifetimeMs ?? QUAKE_MONSTER_PROJECTILE_LIFETIME_MS),
      handle: null,
      origin: [...start] as Vec3,
      profile,
      radius,
      radiusSq: radius * radius,
      sourceEntityIndex: shootable.entity.index,
      velocity,
    };
    projectile.handle = addEnemyProjectileMesh(projectile);
    enemyProjectiles.push(projectile);
  }

  function enemyProjectileAimTarget(
    start: Vec3,
    target: Vec3,
    profile: QuakeMonsterCombatProfile,
    enemy: QuakeEnemyState,
  ): Vec3 {
    const offsetTarget = quakecOffsetPoint(target, start, target, profile.projectileTargetOffset);
    const dx = offsetTarget[0] - start[0];
    const dy = offsetTarget[1] - start[1];
    const horizontalLength = Math.hypot(dx, dy);
    const right: Vec3 = horizontalLength > COLLISION_EPSILON
      ? [-dy / horizontalLength, dx / horizontalLength, 0]
      : [1, 0, 0];
    const aimError = Math.max(0, profile.projectileAimError ?? QUAKE_MONSTER_PROJECTILE_AIM_ERROR);
    const verticalAimError = Math.max(
      0,
      profile.projectileVerticalAimError ?? QUAKE_MONSTER_PROJECTILE_VERTICAL_AIM_ERROR,
    );
    const horizontalOffset = enemyRandomRange(enemy, -aimError, aimError);
    const verticalOffset = enemyRandomRange(enemy, -verticalAimError, verticalAimError);
    return [
      offsetTarget[0] + right[0] * horizontalOffset,
      offsetTarget[1] + right[1] * horizontalOffset,
      offsetTarget[2] - (profile.projectileAimDrop ?? QUAKE_MONSTER_PROJECTILE_AIM_DROP) + verticalOffset,
    ];
  }

  function updateEnemyProjectiles(
    playerOrigin: [number, number, number],
    dt: number,
    now: number,
  ): void {
    if (!enemyProjectiles.length) return;
    const active: QuakeEnemyProjectile[] = [];
    for (const projectile of enemyProjectiles) {
      if (projectile.expiresAt <= now) {
        if (projectile.profile.projectileSplashOnExpire) {
          applyEnemyProjectileSplashDamage(projectile, projectile.origin, playerOrigin, now, "expire");
        }
        removeEnemyProjectile(projectile);
        continue;
      }
      const gravity = Math.max(0, projectile.profile.projectileGravity ?? 0);
      const nextVelocity: Vec3 = gravity > 0
        ? [
          projectile.velocity[0],
          projectile.velocity[1],
          projectile.velocity[2] - gravity * dt,
        ]
        : projectile.velocity;
      const nextOrigin: Vec3 = [
        projectile.origin[0] + projectile.velocity[0] * dt,
        projectile.origin[1] + projectile.velocity[1] * dt,
        projectile.origin[2] + (projectile.velocity[2] - gravity * dt * 0.5) * dt,
      ];
      if (!hasLineOfSight(projectile.origin, nextOrigin)) {
        applyEnemyProjectileSplashDamage(projectile, nextOrigin, playerOrigin, now, "blocked");
        markQuakeTrace("enemy-projectile-blocked", {
          damage: projectile.damage,
          projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
          source: projectile.sourceEntityIndex,
          splash: projectile.profile.projectileSplashDamage ?? null,
        });
        removeEnemyProjectile(projectile);
        continue;
      }
      const hit = quakecProjectileHitsPlayer(projectile, nextOrigin, playerOrigin);
      projectile.origin = nextOrigin;
      projectile.velocity = nextVelocity;
      syncEnemyProjectileMesh(projectile);
      if (hit.hit) {
        damagePlayer(projectile.damage);
        markQuakeTrace("enemy-projectile-hit", {
          damage: projectile.damage,
          distance: hit.distance,
          projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
          source: projectile.sourceEntityIndex,
        });
        removeEnemyProjectile(projectile);
        continue;
      }
      active.push(projectile);
    }
    enemyProjectiles = active;
  }

  function quakecProjectileHitsPlayer(
    projectile: QuakeEnemyProjectile,
    nextOrigin: Vec3,
    playerOrigin: [number, number, number],
  ): QuakeDamageTraceResult {
    const playerBounds = inflateBounds(quakecPlayerDamageBounds(playerOrigin), projectile.radius);
    const distance = segmentAabbIntersectionDistance(projectile.origin, nextOrigin, playerBounds);
    if (distance === null) {
      return { distance: 0, hit: false, hitPoint: nextOrigin, reason: "miss" };
    }
    const travel = Math.hypot(
      nextOrigin[0] - projectile.origin[0],
      nextOrigin[1] - projectile.origin[1],
      nextOrigin[2] - projectile.origin[2],
    ) || 1;
    const t = Math.max(0, Math.min(1, distance / travel));
    const hitPoint: Vec3 = [
      projectile.origin[0] + (nextOrigin[0] - projectile.origin[0]) * t,
      projectile.origin[1] + (nextOrigin[1] - projectile.origin[1]) * t,
      projectile.origin[2] + (nextOrigin[2] - projectile.origin[2]) * t,
    ];
    return { distance, hit: true, hitPoint, reason: "hit" };
  }

  function applyEnemyProjectileSplashDamage(
    projectile: QuakeEnemyProjectile,
    origin: Vec3,
    playerOrigin: [number, number, number],
    now: number,
    reason: string,
  ): boolean {
    const splashDamage = projectile.profile.projectileSplashDamage;
    const splashRadius = projectile.profile.projectileSplashRadius;
    if (!splashDamage || !splashRadius) return false;
    const distanceSq = quakecPointToPlayerBoundsDistanceSq(origin, playerOrigin);
    if (distanceSq > splashRadius * splashRadius) {
      markQuakeTrace("enemy-projectile-splash", {
        damage: 0,
        hit: false,
        projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
        reason: "range",
        source: projectile.sourceEntityIndex,
        trigger: reason,
      });
      return false;
    }
    const playerBounds = quakecPlayerDamageBounds(playerOrigin);
    const playerCenter = quakecBoundsCenter(playerBounds);
    if (!hasLineOfSight(origin, playerCenter)) {
      markQuakeTrace("enemy-projectile-splash", {
        damage: 0,
        hit: false,
        projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
        reason: "blocked",
        source: projectile.sourceEntityIndex,
        trigger: reason,
      });
      return false;
    }
    const distanceUnits = Math.sqrt(distanceSq) / QUAKE_COLLISION_UNIT_SCALE;
    const damage = Math.max(1, splashDamage - distanceUnits * 0.5);
    damagePlayer(damage);
    markQuakeTrace("enemy-projectile-splash", {
      damage,
      hit: true,
      projectile: projectile.profile.projectileClassname ?? "enemy_projectile_magic",
      reason: "hit",
      source: projectile.sourceEntityIndex,
      time: now,
      trigger: reason,
    });
    return true;
  }

  function addEnemyProjectileMesh(projectile: QuakeEnemyProjectile): PolyMeshHandle | null {
    const classname = projectile.profile.projectileClassname ?? "enemy_projectile_magic";
    const model = projectile.profile.projectileModelPath
      ? currentModelLibrary?.models[projectile.profile.projectileModelPath]
      : undefined;
    const entity: QuakeEntity = {
      index: -100000 - enemyProjectiles.length,
      classname,
      properties: {},
      origin: { x: 0, y: 0, z: 0 },
    };
    const handle = addMesh(entity, model);
    if (!handle) return null;
    handle.element.classList.add("enemy-projectile");
    syncEnemyProjectileMesh(projectile, handle);
    if (!model) {
      pixelate(handle);
      schedulePresentationResync(handle);
    }
    return handle;
  }

  function syncEnemyProjectileMesh(
    projectile: QuakeEnemyProjectile,
    handle = projectile.handle,
  ): void {
    if (!handle) return;
    const yaw = (Math.atan2(projectile.velocity[1], projectile.velocity[0]) * 180) / Math.PI;
    const model = projectile.profile.projectileModelPath
      ? currentModelLibrary?.models[projectile.profile.projectileModelPath]
      : undefined;
    handle.setTransform({
      position: projectile.origin,
      rotation: [0, 0, enemyProjectileRenderYaw(projectile, model, yaw)],
      scale: projectile.profile.projectileScale ?? (model?.renderScale ? 1 / model.renderScale : 1),
    });
  }

  function removeEnemyProjectile(projectile: QuakeEnemyProjectile): void {
    projectile.handle?.remove();
    projectile.handle = null;
  }

  function faceShootableAtOrigin(
    shootable: QuakeShootableState,
    playerOrigin: Vec3,
  ): void {
    const dx = playerOrigin[0] - shootable.origin[0];
    const dy = playerOrigin[1] - shootable.origin[1];
    const yaw = (Math.atan2(dy, dx) * 180) / Math.PI;
    syncShootableTransform(shootable, yaw);
  }

  function syncShootableTransform(
    shootable: QuakeShootableState,
    yaw = shootable.yaw,
  ): void {
    shootable.yaw = yaw;
    forEachShootableHandle(shootable, (handle) => syncShootableTransformForHandle(shootable, handle, yaw));
  }

  function syncShootableTransformForHandle(
    shootable: QuakeShootableState,
    handle: PolyMeshHandle,
    yaw = shootable.yaw,
  ): void {
    const renderPosition = shootable.origin;
    const scale = shootable.model?.renderScale ? 1 / shootable.model.renderScale : 1;
    const renderYaw = shootableRenderYaw(shootable, yaw);
    if (!setShootableHandleTransformIfChanged(handle, renderPosition, renderYaw, scale)) return;
    if (shootable.enemy && shootable.visible && handle === shootable.handle) {
      markShootableTrace("enemy-transform", shootable, {
        renderYaw,
        yaw,
        x: renderPosition[0],
        y: renderPosition[1],
        z: renderPosition[2],
      });
    }
  }

  function setShootableHandleTransformIfChanged(
    handle: PolyMeshHandle,
    renderPosition: Vec3,
    yaw: number,
    scale: number,
  ): boolean {
    const next = {
      x: renderPosition[0],
      y: renderPosition[1],
      z: renderPosition[2],
      yaw,
      scale,
    };
    const previous = quakeShootableTransformSnapshots.get(handle);
    if (previous && quakeShootableTransformSnapshotEquals(previous, next)) return false;
    quakeShootableTransformSnapshots.set(handle, next);
    handle.setTransform({
      position: renderPosition,
      rotation: [0, 0, yaw],
      scale,
    });
    return true;
  }

  function shootableRenderYaw(shootable: QuakeShootableState, yaw: number): number {
    return aliasModelRenderYaw(yaw);
  }

  function shootableEntityRenderYaw(entity: QuakeEntity, yaw: number): number {
    return aliasModelRenderYaw(yaw);
  }

  function enemyProjectileRenderYaw(
    projectile: QuakeEnemyProjectile,
    model: QuakePickupModel | undefined,
    yaw: number,
  ): number {
    return aliasModelRenderYaw(yaw);
  }

  function monsterDeathOutputRenderYaw(kind: string, yaw: number): number {
    return aliasModelRenderYaw(yaw);
  }

  function aliasModelRenderYaw(yaw: number): number {
    return normalizeShootableYaw(yaw + 180);
  }

  function normalizeShootableYaw(yaw: number): number {
    return ((yaw % 360) + 360) % 360;
  }

  function quakeShootableTransformSnapshotEquals(
    previous: QuakeShootableTransformSnapshot,
    next: QuakeShootableTransformSnapshot,
  ): boolean {
    return quakeTransformNumberEquals(previous.x, next.x) &&
      quakeTransformNumberEquals(previous.y, next.y) &&
      quakeTransformNumberEquals(previous.z, next.z) &&
      quakeTransformNumberEquals(previous.yaw, next.yaw) &&
      quakeTransformNumberEquals(previous.scale, next.scale);
  }

  function quakeTransformNumberEquals(previous: number, next: number): boolean {
    return Math.abs(previous - next) <= QUAKE_SHOOTABLE_TRANSFORM_EPSILON;
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

  function flashShootable(shootable: QuakeShootableState): void {
    const element = shootable.handle?.element;
    if (!element) return;
    element.classList.remove(QUAKE_SHOOTABLE_HURT_CLASS);
    void element.offsetWidth;
    element.classList.add(QUAKE_SHOOTABLE_HURT_CLASS);
    window.setTimeout(() => {
      if (element.isConnected) element.classList.remove(QUAKE_SHOOTABLE_HURT_CLASS);
    }, 120);
  }

  function playerOverlapsShootable(
    origin: [number, number, number],
    eyeHeight: number,
    shootable: QuakeShootableState,
  ): boolean {
    const bounds = shootableCollisionWorldBounds(shootable);
    const playerMinZ = origin[2] - eyeHeight;
    const playerMaxZ = playerMinZ + PLAYER_HEIGHT;
    if (playerMaxZ <= bounds.min[2] || playerMinZ >= bounds.max[2]) return false;
    return origin[0] >= bounds.min[0] - PLAYER_RADIUS &&
      origin[0] <= bounds.max[0] + PLAYER_RADIUS &&
      origin[1] >= bounds.min[1] - PLAYER_RADIUS &&
      origin[1] <= bounds.max[1] + PLAYER_RADIUS;
  }

  function pushPlayerOutOfShootable(
    origin: [number, number, number],
    previous: [number, number, number],
    shootable: QuakeShootableState,
    validateOrigin?: QuakeShootableCollisionOriginValidator,
  ): [number, number, number] {
    const bounds = shootableCollisionWorldBounds(shootable);
    const minX = bounds.min[0] - PLAYER_RADIUS - QUAKE_SHOOTABLE_COLLISION_EPSILON;
    const maxX = bounds.max[0] + PLAYER_RADIUS + QUAKE_SHOOTABLE_COLLISION_EPSILON;
    const minY = bounds.min[1] - PLAYER_RADIUS - QUAKE_SHOOTABLE_COLLISION_EPSILON;
    const maxY = bounds.max[1] + PLAYER_RADIUS + QUAKE_SHOOTABLE_COLLISION_EPSILON;
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
    return candidates.find(validateOrigin) ?? candidates[0] ?? origin;
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
    return {
      min: [
        shootable.origin[0] + shootable.collisionBounds.min[0],
        shootable.origin[1] + shootable.collisionBounds.min[1],
        shootable.origin[2] + shootable.collisionBounds.min[2],
      ],
      max: [
        shootable.origin[0] + shootable.collisionBounds.max[0],
        shootable.origin[1] + shootable.collisionBounds.max[1],
        shootable.origin[2] + shootable.collisionBounds.max[2],
      ],
    };
  }

  function shootableBoundsForDamage(shootable: QuakeShootableState): QuakeBounds {
    return shootableCollisionWorldBounds(shootable);
  }

  function isLiveMonsterBlocker(shootable: QuakeShootableState): boolean {
    return shootable.entity.classname.startsWith("monster_") &&
      !shootable.dead &&
      shootable.health > 0 &&
      !isZombieNonSolid(shootable);
  }

  function quakeBrushModelBounds(model: QuakePreparedModel, pivot: QuakeVertex): QuakeBounds {
    return {
      min: [
        (model.mins.x - pivot.x) * QUAKE_COLLISION_UNIT_SCALE,
        (model.mins.y - pivot.y) * QUAKE_COLLISION_UNIT_SCALE,
        (model.mins.z - pivot.z) * QUAKE_COLLISION_UNIT_SCALE,
      ],
      max: [
        (model.maxs.x - pivot.x) * QUAKE_COLLISION_UNIT_SCALE,
        (model.maxs.y - pivot.y) * QUAKE_COLLISION_UNIT_SCALE,
        (model.maxs.z - pivot.z) * QUAKE_COLLISION_UNIT_SCALE,
      ],
    };
  }

  function inflateBounds(bounds: QuakeBounds, amount: number): QuakeBounds {
    return {
      min: [bounds.min[0] - amount, bounds.min[1] - amount, bounds.min[2] - amount],
      max: [bounds.max[0] + amount, bounds.max[1] + amount, bounds.max[2] + amount],
    };
  }

  function aabbsOverlap(a: QuakeBounds, b: QuakeBounds): boolean {
    return a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
      a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
      a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
  }

  function aabbDistanceSq(a: QuakeBounds, b: QuakeBounds): number {
    const dx = a.max[0] < b.min[0] ? b.min[0] - a.max[0] : b.max[0] < a.min[0] ? a.min[0] - b.max[0] : 0;
    const dy = a.max[1] < b.min[1] ? b.min[1] - a.max[1] : b.max[1] < a.min[1] ? a.min[1] - b.max[1] : 0;
    const dz = a.max[2] < b.min[2] ? b.min[2] - a.max[2] : b.max[2] < a.min[2] ? a.min[2] - b.max[2] : 0;
    return dx * dx + dy * dy + dz * dz;
  }

  function pointToAabbDistanceSq(point: Vec3, bounds: QuakeBounds): number {
    const dx = point[0] < bounds.min[0] ? bounds.min[0] - point[0] : point[0] > bounds.max[0] ? point[0] - bounds.max[0] : 0;
    const dy = point[1] < bounds.min[1] ? bounds.min[1] - point[1] : point[1] > bounds.max[1] ? point[1] - bounds.max[1] : 0;
    const dz = point[2] < bounds.min[2] ? bounds.min[2] - point[2] : point[2] > bounds.max[2] ? point[2] - bounds.max[2] : 0;
    return dx * dx + dy * dy + dz * dz;
  }

  function segmentAabbIntersectionDistance(start: Vec3, end: Vec3, bounds: QuakeBounds): number | null {
    let tMin = 0;
    let tMax = 1;
    for (let axis = 0; axis < 3; axis += 1) {
      const startValue = start[axis] ?? 0;
      const delta = (end[axis] ?? 0) - startValue;
      const minValue = bounds.min[axis] ?? 0;
      const maxValue = bounds.max[axis] ?? 0;
      if (Math.abs(delta) <= COLLISION_EPSILON) {
        if (startValue < minValue || startValue > maxValue) return null;
        continue;
      }
      const invDelta = 1 / delta;
      let axisMin = (minValue - startValue) * invDelta;
      let axisMax = (maxValue - startValue) * invDelta;
      if (axisMin > axisMax) {
        const swap = axisMin;
        axisMin = axisMax;
        axisMax = swap;
      }
      tMin = Math.max(tMin, axisMin);
      tMax = Math.min(tMax, axisMax);
      if (tMin > tMax) return null;
    }
    const distance = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    return distance * Math.max(0, tMin);
  }

  return {
    clear,
    debugStats,
    debugMountEntity,
    spawn,
    setupMonsterJumpTriggers,
    has,
    activate,
    triggerBossLightning,
    damage,
    destroy,
    firstMonsterOverlappingBounds,
    syncMonsterRuntime,
    resolvePlayerCollision,
    syncVisibility,
    weaponTargets,
  };
}

function createEnemyState(
  entityIndex: number,
  quakecRunner: QuakeMonsterStateRunner | null,
  movetarget: QuakeMonsterPathCorner | null,
): QuakeEnemyState {
  return {
    animationFrameIndex: 0,
    animationLockUntil: 0,
    animationMode: "idle",
    attackVisual: null,
    deathAnimationUntil: 0,
    nextAnimationFrameAt: 0,
    quakecAnimationChain: null,
    quakecActiveTouchDamage: null,
    quakecDeathChain: null,
    quakecFiredEvents: new Set(),
    quakecGibbed: false,
    quakecIdealYaw: null,
    quakecLastState: null,
    quakecMovementCall: null,
    quakecMovementStateName: null,
    quakecMovementUnitsRemaining: 0,
    quakecPainChain: null,
    quakecPainFinishedUntil: 0,
    quakecRunner,
    awake: false,
    burstShotsRemaining: 0,
    monsterJumpTouchedTriggerEntityIndex: null,
    monsterJumpVelocity: [0, 0, 0],
    movetarget,
    nextAttackAt: 0,
    pendingAttack: null,
    seed: quakeEnemySeed(entityIndex),
    zombieGibbed: false,
    zombieNonSolidAt: 0,
    zombiePainRepeatUntil: 0,
    zombieRecoverUntil: 0,
    zombieSolidAt: 0,
  };
}

function quakeMonsterChainDurationMs(
  classname: string,
  chain: string,
  runner: QuakeMonsterStateRunner,
): number {
  return Math.max(1, runner.chainLength(chain)) * QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS +
    quakeMonsterChainHoldMs(classname, chain);
}

function quakeMonsterStateOffsetMs(classname: string, chain: string, stateName: string): number {
  const states = quakeMonsterLogicByClassname[classname]?.chains?.[chain]?.states ?? [];
  const index = states.findIndex((state) => state.name === stateName);
  return Math.max(0, index) * QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;
}

function quakeMonsterChainHoldMs(classname: string, chain: string): number {
  if (classname === "monster_zombie" && chain === "pain_down") return QUAKE_ZOMBIE_DOWN_HOLD_MS;
  return 0;
}

function enemyRandomRange(enemy: QuakeEnemyState, min: number, max: number): number {
  if (max <= min) return min;
  return min + nextEnemyRandom(enemy) * (max - min);
}

function nextEnemyRandom(enemy: QuakeEnemyState): number {
  enemy.seed = (Math.imul(enemy.seed, 1664525) + 1013904223) >>> 0;
  return enemy.seed / 0x100000000;
}

function quakeEnemySeed(entityIndex: number): number {
  return (Math.imul(entityIndex + 0x9e3779b9, 0x85ebca6b) ^ 0xc2b2ae35) >>> 0;
}

export function quakeShootableModelPath(
  entity: QuakeEntity,
  programMetadata: QuakeProgramMetadata | null = null,
): string | null {
  if (entity.classname === "misc_explobox") return "maps/b_explob.bsp";
  if (entity.classname === "misc_explobox2") return "maps/b_exbox2.bsp";
  if (entity.classname.startsWith("monster_")) {
    return preferredMonsterModelPath(entity, programMetadata);
  }
  return null;
}

function isRequiredShootableModel(entity: QuakeEntity, modelPath: string): boolean {
  return entity.classname.startsWith("monster_") && modelPath.startsWith("progs/") && modelPath.endsWith(".mdl");
}

function missingRequiredShootableModelError(entity: QuakeEntity, modelPath: string): Error {
  return new Error(
    `Missing prepared Quake model ${modelPath} for ${entity.classname} #${entity.index}. ` +
      "This is a preload or asset bug, not a procedural fallback.",
  );
}

function canUseShootableFallback(entity: QuakeEntity): boolean {
  return entity.classname === "misc_explobox" ||
    entity.classname === "misc_explobox2";
}

function shootableLocalBounds(entity: QuakeEntity, model: QuakePickupModel | undefined): { min: Vec3; max: Vec3 } {
  if (model) return model.bounds;
  if (entity.classname === "misc_explobox" || entity.classname === "misc_explobox2") {
    return { min: [-0.42, -0.42, 0], max: [0.42, 0.42, 0.72] };
  }
  return { min: [-0.34, -0.34, 0], max: [0.34, 0.34, 1.18] };
}

function shootableCollisionBounds(
  entity: QuakeEntity,
  fallback: { min: Vec3; max: Vec3 },
  spawnProfile = quakeMonsterSpawnProfileForEntity(entity),
): { min: Vec3; max: Vec3 } {
  if (!entity.classname.startsWith("monster_")) return fallback;
  return quakeMonsterScaledBounds(spawnProfile) ?? fallback;
}

function quakeMonsterSpawnProfileForEntity(entity: QuakeEntity): QuakeMonsterSpawnProfile | undefined {
  const spawnProfile = quakeMonsterSpawnProfile(entity.classname);
  if (!spawnProfile || !isQuakeCrucifiedZombie(entity)) return spawnProfile;
  return {
    ...spawnProfile,
    dropToFloor: false,
  };
}

function quakeMonsterSpawnProfile(classname: string): QuakeMonsterSpawnProfile | undefined {
  const logicByClassname = QUAKE_MONSTER_LOGIC as Readonly<Record<string, { spawnProfile?: QuakeMonsterSpawnProfile }>>;
  return logicByClassname[classname]?.spawnProfile;
}

function quakeMonsterUsesEnemyRuntime(entity: QuakeEntity): boolean {
  return entity.classname.startsWith("monster_") && !isQuakeCrucifiedZombie(entity);
}

function isQuakeCrucifiedZombie(entity: QuakeEntity): boolean {
  return entity.classname === "monster_zombie" &&
    (quakeEntityNumber(entity, "spawnflags", 0) & QUAKE_ZOMBIE_SPAWN_CRUCIFIED) !== 0;
}

function quakeMonsterScaledBounds(spawnProfile: QuakeMonsterSpawnProfile | undefined): { min: Vec3; max: Vec3 } | null {
  const bounds = spawnProfile?.bounds;
  if (!bounds) return null;
  return {
    min: quakeMonsterScaleVector(bounds.min),
    max: quakeMonsterScaleVector(bounds.max),
  };
}

function quakeMonsterScaleVector(vector: readonly [number, number, number]): Vec3 {
  return [
    vector[0] * QUAKE_COLLISION_UNIT_SCALE,
    vector[1] * QUAKE_COLLISION_UNIT_SCALE,
    vector[2] * QUAKE_COLLISION_UNIT_SCALE,
  ];
}

function preferredMonsterModelPath(entity: QuakeEntity, programMetadata: QuakeProgramMetadata | null): string | null {
  const programModels = programMetadata?.modelsByClassname[entity.classname] ?? [];
  const expected = QUAKE_MONSTER_MODEL_PATHS[entity.classname];
  if (expected && (programModels.length === 0 || programModels.includes(expected))) return expected;
  return programModels.find(isQuakeMonsterBodyModel) ??
    programModels.find((model) => model.startsWith("progs/") && model.endsWith(".mdl")) ??
    expected ??
    null;
}

function isQuakeMonsterBodyModel(modelPath: string): boolean {
  const filename = modelPath.split("/").pop()?.toLowerCase() ?? "";
  return modelPath.startsWith("progs/") &&
    modelPath.endsWith(".mdl") &&
    !filename.startsWith("h_") &&
    !filename.includes("gib") &&
    !["bolt.mdl", "grenade.mdl", "k_spike.mdl", "lavaball.mdl", "laser.mdl", "s_light.mdl", "v_spike.mdl", "w_spike.mdl", "zom_gib.mdl"].includes(filename);
}

function shootableHealth(entity: QuakeEntity): number {
  const spawnHealth = quakeMonsterSpawnProfile(entity.classname)?.health;
  return Math.max(1, quakeEntityNumber(entity, "health", spawnHealth ?? QUAKE_SHOOTABLE_HEALTH[entity.classname] ?? 20));
}

function quakeShootableDeathRadiusDamage(classname: string): QuakeShootableRadiusDamageFact | undefined {
  const logicByClassname = QUAKE_SHOOTABLE_LOGIC as Readonly<Record<string, {
    death?: { radiusDamage?: QuakeShootableRadiusDamageFact };
  }>>;
  return logicByClassname[classname]?.death?.radiusDamage;
}

type QuakeBossLifecycleSkillKey = keyof QuakeMonsterScriptedLifecycle["awake"]["healthBySkill"];

function quakeBossScriptedLifecycle(classname: string): QuakeMonsterScriptedLifecycle | null {
  const lifecycle = QUAKE_MONSTER_LOGIC[classname]?.scriptedLifecycle;
  return lifecycle?.kind === "boss" ? lifecycle : null;
}

function quakeBossHealthForSkill(lifecycle: QuakeMonsterScriptedLifecycle, skill: number | undefined): number {
  return lifecycle.awake.healthBySkill[quakeBossSkillKey(skill)];
}

function quakeBossSkillKey(skill: number | undefined): QuakeBossLifecycleSkillKey {
  const numericSkill = typeof skill === "number" && Number.isFinite(skill) ? skill : 1;
  const normalized = Math.max(0, Math.round(numericSkill));
  if (normalized <= 0) return "easy";
  if (normalized >= 2) return "hard";
  return "normal";
}

function quakeBossPainBranchForHealth(
  lifecycle: QuakeMonsterScriptedLifecycle,
  health: number,
): QuakeMonsterScriptedLifecycle["lightning"]["painBranches"][number] | undefined {
  return lifecycle.lightning.painBranches.find((branch) =>
    (branch.afterHealth !== undefined && health === branch.afterHealth) ||
    (branch.afterHealthMin !== undefined && health >= branch.afterHealthMin)
  );
}

function quakeBossRuntimeChainName(shootable: QuakeShootableState, chainName: string): string {
  const runner = shootable.enemy?.quakecRunner;
  if (!runner || runner.hasChain(chainName)) return chainName;
  if (chainName === "pain" && runner.hasChain("pain_a")) return "pain_a";
  return chainName;
}

const QUAKE_SHOOTABLE_HEALTH: Record<string, number> = {
  misc_explobox: 20,
  misc_explobox2: 20,
  monster_army: 30,
  monster_dog: 25,
  monster_enforcer: 80,
  monster_fish: 25,
  monster_knight: 75,
  monster_ogre: 200,
  monster_wizard: 80,
  monster_zombie: 60,
  monster_demon1: 300,
  monster_hell_knight: 250,
  monster_shalrath: 400,
  monster_shambler: 600,
  monster_tarbaby: 80,
  monster_boss: 500,
  monster_oldone: 400,
};

const QUAKE_MONSTER_ANIMATION_PROFILES: Record<string, QuakeMonsterAnimationProfile> = {
  monster_army: {
    attack: { start: 81, end: 89 },
    attackFps: 10,
    death: { start: 8, end: 17 },
    deathFps: 10,
    fps: 8,
    idle: { start: 0, end: 7 },
    pain: { start: 40, end: 45 },
    painFps: 10,
    walk: { start: 73, end: 80 },
  },
  monster_dog: {
    attack: { start: 0, end: 7 },
    attackFps: 12,
    death: { start: 8, end: 16 },
    deathFps: 10,
    idle: { start: 69, end: 77 },
    idleFps: 8,
    pain: { start: 26, end: 31 },
    painFps: 10,
    walk: { start: 48, end: 59 },
    walkFps: 10,
  },
  monster_demon1: {
    attack: { start: 54, end: 68 },
    attackFps: 10,
    death: { start: 45, end: 53 },
    deathFps: 10,
    idle: { start: 0, end: 12 },
    idleFps: 7,
    pain: { start: 39, end: 44 },
    painFps: 10,
    walk: { start: 21, end: 26 },
    walkFps: 10,
  },
  monster_knight: {
    attack: { start: 42, end: 52 },
    attackFps: 10,
    death: { start: 76, end: 85 },
    deathFps: 10,
    idle: { start: 0, end: 8 },
    idleFps: 7,
    pain: { start: 28, end: 30 },
    painFps: 10,
    walk: { start: 53, end: 66 },
    walkFps: 10,
  },
  monster_ogre: {
    attack: { start: 61, end: 66 },
    attackFps: 10,
    death: { start: 112, end: 125 },
    deathFps: 10,
    idle: { start: 0, end: 8 },
    idleFps: 7,
    pain: { start: 67, end: 71 },
    painFps: 10,
    walk: { start: 9, end: 24 },
    walkFps: 9,
  },
  monster_shambler: {
    attack: { start: 65, end: 76 },
    attackFps: 10,
    death: { start: 83, end: 93 },
    deathFps: 10,
    idle: { start: 0, end: 16 },
    idleFps: 7,
    pain: { start: 77, end: 82 },
    painFps: 10,
    walk: { start: 17, end: 28 },
    walkFps: 9,
  },
  monster_wizard: {
    attack: { start: 29, end: 41 },
    attackFps: 10,
    death: { start: 46, end: 53 },
    deathFps: 10,
    idle: { start: 0, end: 14 },
    idleFps: 8,
    pain: { start: 42, end: 45 },
    painFps: 10,
    walk: { start: 15, end: 28 },
    walkFps: 10,
  },
  monster_zombie: {
    attack: { start: 52, end: 64 },
    attackFps: 10,
    death: { start: 162, end: 191 },
    deathFps: 10,
    idle: { start: 0, end: 14 },
    idleFps: 7,
    pain: { start: 91, end: 102 },
    painFps: 10,
    walk: { start: 15, end: 33 },
    walkFps: 8,
  },
  monster_boss: {
    attack: { start: 57, end: 79 },
    attackFps: 10,
    death: { start: 48, end: 56 },
    deathFps: 10,
    idle: { start: 17, end: 47 },
    idleFps: 7,
    walk: { start: 17, end: 47 },
    walkFps: 7,
  },
};

const QUAKEC_SOLDIER_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_army?.attack;
const QUAKEC_DOG_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_dog?.attack;
const QUAKEC_DEMON_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_demon1?.attack;
const QUAKEC_KNIGHT_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_knight?.attack;
const QUAKEC_OGRE_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_ogre?.attack;
const QUAKEC_SHAMBLER_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_shambler?.attack;
const QUAKEC_WIZARD_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_wizard?.attack;
const QUAKEC_ZOMBIE_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_zombie?.attack;
const QUAKEC_BOSS_ATTACK_POLICY = quakeMonsterCombatPolicies.monster_boss?.attack;

const QUAKEC_MONSTER_COMBAT_PROFILES: Record<string, QuakeMonsterCombatProfile> = {
  monster_army: {
    chaseSpeed: quakecMonsterRunSpeed("monster_army", QUAKEC_SOLDIER_AI_RUN_SPEED),
    chaseStopDistance: 160 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_SOLDIER_ATTACK_POLICY?.cooldownMs ?? 1000,
    cooldownRandomAddMs: QUAKEC_SOLDIER_ATTACK_POLICY?.cooldownRandomAddMs ?? 1000,
    damage: QUAKEC_SOLDIER_ATTACK_POLICY?.damage ?? 16,
    kind: "hitscan",
    range: (QUAKEC_SOLDIER_ATTACK_POLICY?.rangeUnits.mid ?? 1000) * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 4 * QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS,
  },
  monster_dog: {
    chaseSpeed: quakecMonsterRunSpeed("monster_dog", 320 * QUAKE_COLLISION_UNIT_SCALE),
    chaseStopDistance: 80 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_DOG_ATTACK_POLICY?.cooldownMs ?? 0,
    cooldownRandomAddMs: QUAKEC_DOG_ATTACK_POLICY?.cooldownRandomAddMs ?? 0,
    damage: QUAKEC_DOG_ATTACK_POLICY?.damage ?? 24,
    kind: "touch",
    range: 150 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
  monster_demon1: {
    chaseSpeed: quakecMonsterRunSpeed("monster_demon1", 260 * QUAKE_COLLISION_UNIT_SCALE),
    chaseStopDistance: 120 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_DEMON_ATTACK_POLICY?.cooldownMs ?? 0,
    cooldownRandomAddMs: QUAKEC_DEMON_ATTACK_POLICY?.cooldownRandomAddMs ?? 0,
    damage: QUAKEC_DEMON_ATTACK_POLICY?.damage ?? 50,
    kind: "touch",
    range: 200 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
  monster_knight: {
    chaseSpeed: quakecMonsterRunSpeed("monster_knight", 180 * QUAKE_COLLISION_UNIT_SCALE),
    chaseStopDistance: 140 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_KNIGHT_ATTACK_POLICY?.cooldownMs ?? 0,
    cooldownRandomAddMs: QUAKEC_KNIGHT_ATTACK_POLICY?.cooldownRandomAddMs ?? 0,
    damage: QUAKEC_KNIGHT_ATTACK_POLICY?.damage ?? 9,
    kind: "touch",
    range: (QUAKEC_KNIGHT_ATTACK_POLICY?.rangeUnits.melee ?? 120) * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
  monster_ogre: {
    chaseSpeed: quakecMonsterRunSpeed("monster_ogre", 180 * QUAKE_COLLISION_UNIT_SCALE),
    chaseStopDistance: 180 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_OGRE_ATTACK_POLICY?.cooldownMs ?? 1000,
    cooldownRandomAddMs: QUAKEC_OGRE_ATTACK_POLICY?.cooldownRandomAddMs ?? 2000,
    damage: QUAKEC_OGRE_ATTACK_POLICY?.damage ?? 40,
    kind: "projectile",
    range: (QUAKEC_OGRE_ATTACK_POLICY?.rangeUnits.mid ?? 1000) * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
  monster_shambler: {
    chaseSpeed: quakecMonsterRunSpeed("monster_shambler", 160 * QUAKE_COLLISION_UNIT_SCALE),
    chaseStopDistance: 220 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_SHAMBLER_ATTACK_POLICY?.cooldownMs ?? 2000,
    cooldownRandomAddMs: QUAKEC_SHAMBLER_ATTACK_POLICY?.cooldownRandomAddMs ?? 2000,
    damage: QUAKEC_SHAMBLER_ATTACK_POLICY?.damage ?? 120,
    kind: "hitscan",
    range: 600 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
  monster_wizard: {
    chaseSpeed: quakecMonsterRunSpeed("monster_wizard", 160 * QUAKE_COLLISION_UNIT_SCALE),
    chaseStopDistance: 220 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_WIZARD_ATTACK_POLICY?.cooldownMs ?? 2000,
    cooldownRandomAddMs: QUAKEC_WIZARD_ATTACK_POLICY?.cooldownRandomAddMs ?? 0,
    damage: QUAKEC_WIZARD_ATTACK_POLICY?.damage ?? 9,
    kind: "projectile",
    range: (QUAKEC_WIZARD_ATTACK_POLICY?.rangeUnits.mid ?? 1000) * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
  monster_zombie: {
    chaseSpeed: quakecMonsterRunSpeed("monster_zombie", 120 * QUAKE_COLLISION_UNIT_SCALE),
    chaseStopDistance: 180 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownMs: QUAKEC_ZOMBIE_ATTACK_POLICY?.cooldownMs ?? 0,
    cooldownRandomAddMs: QUAKEC_ZOMBIE_ATTACK_POLICY?.cooldownRandomAddMs ?? 2000,
    damage: QUAKEC_ZOMBIE_ATTACK_POLICY?.damage ?? 10,
    kind: "projectile",
    range: (QUAKEC_ZOMBIE_ATTACK_POLICY?.rangeUnits.mid ?? 1000) * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
  monster_boss: {
    cooldownMs: QUAKEC_BOSS_ATTACK_POLICY?.cooldownMs ?? 0,
    cooldownRandomAddMs: QUAKEC_BOSS_ATTACK_POLICY?.cooldownRandomAddMs ?? 2000,
    damage: QUAKEC_BOSS_ATTACK_POLICY?.damage ?? 120,
    kind: "projectile",
    range: (QUAKEC_BOSS_ATTACK_POLICY?.rangeUnits.mid ?? 1000) * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
};

const QUAKE_MONSTER_MODEL_PATHS: Record<string, string> = {
  monster_army: "progs/soldier.mdl",
  monster_dog: "progs/dog.mdl",
  monster_enforcer: "progs/enforcer.mdl",
  monster_fish: "progs/fish.mdl",
  monster_knight: "progs/knight.mdl",
  monster_ogre: "progs/ogre.mdl",
  monster_wizard: "progs/wizard.mdl",
  monster_zombie: "progs/zombie.mdl",
  monster_demon1: "progs/demon.mdl",
  monster_hell_knight: "progs/hknight.mdl",
  monster_shalrath: "progs/shalrath.mdl",
  monster_shambler: "progs/shambler.mdl",
  monster_tarbaby: "progs/tarbaby.mdl",
  monster_boss: "progs/boss.mdl",
  monster_oldone: "progs/oldone.mdl",
};

export function quakeMonsterRunSpeedUnitsPerSecond(classname: string): number | null {
  const distances = quakecMonsterRunMovementDistances(classname);
  if (!distances.length) return null;
  const total = distances.reduce((sum, distance) => sum + distance, 0);
  return (total / distances.length) * QUAKE_MONSTER_QUAKEC_AI_FRAME_RATE;
}

function quakecMonsterRunSpeed(classname: string, fallback: number): number {
  const sourceUnitsPerSecond = quakeMonsterRunSpeedUnitsPerSecond(classname);
  return typeof sourceUnitsPerSecond === "number"
    ? sourceUnitsPerSecond * QUAKE_COLLISION_UNIT_SCALE
    : fallback;
}

function quakecMonsterRunMovementDistances(classname: string): number[] {
  return quakecMonsterMovementDistances(classname, "run", "ai_run");
}

function quakecMonsterHasMovement(classname: string, callName: "ai_run" | "ai_walk"): boolean {
  const chain = callName === "ai_run" ? "run" : "walk";
  return quakecMonsterMovementDistances(classname, chain, callName).length > 0;
}

function quakecMonsterMovementDistances(
  classname: string,
  chain: string,
  callName: "ai_run" | "ai_walk",
): number[] {
  const states = quakeMonsterLogicByClassname[classname]?.chains[chain]?.states ?? [];
  return states.flatMap((state) => quakeMonsterAiMovementDistances(state, callName));
}

function quakeMonsterAiMovementDistances(
  state: QuakeMonsterFrameState,
  callName: "ai_run" | "ai_walk",
): number[] {
  return (state.movement ?? [])
    .filter((movement) => movement.call === callName && typeof movement.distanceUnits === "number")
    .map((movement) => movement.distanceUnits as number);
}

export function quakeMonsterCanAcquirePlayer(playerInvisible: boolean): boolean {
  return !playerInvisible;
}

export function quakeShootableFallbackPolygons(entity: QuakeEntity): Polygon[] {
  if (entity.classname === "misc_explobox" || entity.classname === "misc_explobox2") {
    return createCuboidPolygons([-0.38, -0.38, 0], [0.38, 0.38, 0.68], "#8a3a1e");
  }
  if (entity.classname === "enemy_projectile_grenade") {
    return createCuboidPolygons([-0.12, -0.12, -0.12], [0.12, 0.12, 0.12], "#3d2618");
  }
  if (entity.classname === "enemy_projectile_zombie_grenade") {
    return createCuboidPolygons([-0.12, -0.12, -0.12], [0.12, 0.12, 0.12], "#6f7a48");
  }
  if (entity.classname === "enemy_projectile_lavaball") {
    return createCuboidPolygons([-0.14, -0.14, -0.14], [0.14, 0.14, 0.14], "#d45a28");
  }
  if (entity.classname === "enemy_projectile_spike") {
    return [
      ...createCuboidPolygons([-0.24, -0.035, -0.035], [0.18, 0.035, 0.035], "#d6c29a"),
      ...createCuboidPolygons([0.18, -0.055, -0.055], [0.28, 0.055, 0.055], "#fff1bd"),
    ];
  }
  if (entity.classname === "enemy_projectile_magic") {
    return [
      ...createCuboidPolygons([-0.16, -0.055, -0.055], [0.16, 0.055, 0.055], "#7f5cff"),
      ...createCuboidPolygons([-0.05, -0.13, -0.05], [0.05, 0.13, 0.05], "#b18cff"),
    ];
  }
  if (!entity.classname.startsWith("monster_")) return [];
  const color = quakeMonsterFallbackColor(entity.classname);
  return [
    ...createCuboidPolygons([-0.24, -0.2, 0], [0.24, 0.2, 0.72], color.body),
    ...createCuboidPolygons([-0.17, -0.17, 0.72], [0.17, 0.17, 1.08], color.head),
    createSolidPolygon([[-0.34, -0.21, 0.08], [-0.24, -0.21, 0.08], [-0.24, -0.21, 0.64], [-0.34, -0.21, 0.64]], color.limb),
    createSolidPolygon([[0.24, -0.21, 0.08], [0.34, -0.21, 0.08], [0.34, -0.21, 0.64], [0.24, -0.21, 0.64]], color.limb),
  ];
}

function quakeMonsterFallbackColor(classname: string): { body: string; head: string; limb: string } {
  if (classname.includes("dog") || classname.includes("demon")) return { body: "#6f3f24", head: "#8a5733", limb: "#4c2c1b" };
  if (classname.includes("ogre") || classname.includes("knight")) return { body: "#5d6151", head: "#777b6a", limb: "#3a3d32" };
  if (classname.includes("wizard") || classname.includes("shalrath")) return { body: "#5c466f", head: "#7a5d94", limb: "#3a2d45" };
  if (classname.includes("zombie")) return { body: "#5f6b42", head: "#87915e", limb: "#3f482d" };
  if (classname.includes("shambler")) return { body: "#d8d0bd", head: "#f0e5cd", limb: "#9f9788" };
  return { body: "#4b5f45", head: "#697d5f", limb: "#2f3c2c" };
}

function createCuboidPolygons(min: Vec3, max: Vec3, color: string): Polygon[] {
  const [minX, minY, minZ] = min;
  const [maxX, maxY, maxZ] = max;
  return [
    createSolidPolygon([[minX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ], [maxX, minY, minZ]], color),
    createSolidPolygon([[minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ]], color),
    createSolidPolygon([[minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ]], color),
    createSolidPolygon([[maxX, minY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ], [maxX, minY, maxZ]], color),
    createSolidPolygon([[maxX, maxY, minZ], [minX, maxY, minZ], [minX, maxY, maxZ], [maxX, maxY, maxZ]], color),
    createSolidPolygon([[minX, maxY, minZ], [minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, maxZ]], color),
  ];
}

function createSolidPolygon(vertices: Vec3[], color: string): Polygon {
  return { vertices, color };
}
