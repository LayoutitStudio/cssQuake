import type { Polygon, PolyMeshHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeEntity } from "../prepare/scene";
import {
  QUAKE_MONSTER_COMBAT_POLICIES,
  QUAKE_MONSTER_LOGIC,
  type QuakeMonsterAttackBranchPolicy,
  type QuakeMonsterAttackPolicy,
  type QuakeMonsterCombatPolicy,
  type QuakeMonsterFireBulletsFrameEvent,
  type QuakeMonsterFrameEvent,
  type QuakeMonsterLightningDamageFrameEvent,
  type QuakeMonsterMeleeDamageFrameEvent,
  type QuakeMonsterProjectileFrameEvent,
  type QuakeMonsterProjectileOffsetUnits,
  type QuakeMonsterSpawnProfile,
  type QuakeMonsterTouchDamageFrameEvent,
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
  type QuakeProgramMetadata,
} from "./pickups";
import {
  isQuakeRenderBundleFrameSetHandle,
  setQuakeRenderBundleFrameSetHandleFrame,
  stripPolyMeshMetadata,
} from "./renderBundleMesh";
import type { QuakeMonsterStateRunner, QuakeMonsterStateStep } from "./quakeMonsterStateRunner";
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
  has(entityIndex: number): boolean;
  damage(entityIndex: number, amount: number): boolean;
  destroy(entityIndex: number): boolean;
  syncMonsterRuntime(): void;
  resolvePlayerCollision(
    result: QuakeCollisionResult,
    previous: [number, number, number],
    eyeHeight: number,
  ): QuakeCollisionResult;
  syncVisibility(origin: [number, number, number], force?: boolean): void;
  weaponTargets(): Iterable<QuakeWeaponShootableTarget>;
}

export interface QuakeShootablesControllerOptions {
  addMesh(entity: QuakeEntity, model?: QuakePickupModel, frameIndex?: number): PolyMeshHandle | null;
  createMonsterStateRunner?: (classname: string) => QuakeMonsterStateRunner | null;
  damagePlayer(amount: number): boolean;
  floorAt(x: number, y: number, maxZ?: number, minZ?: number): number | null;
  getPlayerForward(): Vec3;
  getPlayerEyeHeight(): number;
  getPlayerOrigin(): [number, number, number];
  hasLineOfSight(start: Vec3, end: Vec3): boolean;
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

interface QuakeShootableSoundOptions {
  volume?: number;
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
  quakecFiredEvents: Set<string>;
  quakecActiveTouchDamage: QuakeEnemyActiveTouchDamage | null;
  quakecLastState: QuakeMonsterStateStep | null;
  quakecPainChain: string | null;
  quakecRunner: QuakeMonsterStateRunner | null;
  attackVisual: "cooldown" | "windup" | null;
  awake: boolean;
  burstShotsRemaining: number;
  nextAttackAt: number;
  pendingAttack: QuakeEnemyPendingAttack | null;
  seed: number;
  zombieGibbed: boolean;
  zombiePainRepeatUntil: number;
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

type QuakeMonsterAnimationMode = "attack" | "death" | "idle" | "pain" | "walk";

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
const QUAKEC_SOLDIER_AI_RUN_SPEED = 108.75 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_ATTACK_DELAY_MS = 600;
const QUAKE_MONSTER_PROJECTILE_LIFETIME_MS = 3200;
const QUAKE_MONSTER_PROJECTILE_AIM_DROP = 18 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_AIM_ERROR = 24 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_GRAVITY = 800 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_VERTICAL_AIM_ERROR = 8 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_RADIUS = 28 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_DROP_TO_FLOOR_DISTANCE = 256 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_ZOMBIE_GIB_DAMAGE = 60;
const QUAKE_ZOMBIE_IGNORE_DAMAGE = 9;
const QUAKE_ZOMBIE_DROP_DAMAGE = 25;
const QUAKE_ZOMBIE_PAIN_REPEAT_WINDOW_MS = 3000;
const QUAKE_ZOMBIE_LIGHT_PAIN_CHAINS = ["pain_light_a", "pain_light_b", "pain_light_c", "pain_light_d"];
const QUAKE_SHOOTABLE_TRANSFORM_EPSILON = COLLISION_EPSILON;
const quakeShootableTransformSnapshots = new WeakMap<PolyMeshHandle, QuakeShootableTransformSnapshot>();
const quakeMonsterCombatPolicies = QUAKE_MONSTER_COMBAT_POLICIES as Readonly<Record<string, QuakeMonsterCombatPolicy>>;
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
  createMonsterStateRunner,
  damagePlayer,
  floorAt,
  getPlayerForward,
  getPlayerEyeHeight,
  getPlayerOrigin,
  hasLineOfSight,
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
  let currentModelLibrary: QuakePickupModelLibrary | null = null;
  let enemyTime = 0;
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
    for (const shootable of shootables.values()) removeShootableHandles(shootable);
    shootables = new Map();
    for (const projectile of enemyProjectiles) projectile.handle?.remove();
    enemyProjectiles = [];
    currentModelLibrary = null;
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
    for (const entity of entities) {
      if (!entity.origin || !shouldSpawn(entity)) continue;
      const modelPath = shootableModelPath(entity, programMetadata);
      if (!modelPath) continue;
      const model = modelLibrary?.models[modelPath];
      if (!model && !canUseShootableFallback(entity)) continue;
      const bounds = shootableLocalBounds(entity, model);
      const spawnProfile = quakeMonsterSpawnProfile(entity.classname);
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
        ...(entity.classname.startsWith("monster_")
          ? { enemy: createEnemyState(entity.index, createMonsterStateRunner?.(entity.classname) ?? null) }
          : {}),
      });
    }
    if (monsterRuntimeEnabled() && hasLiveEnemies()) startEnemyLoop();
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
    spawnProfile = quakeMonsterSpawnProfile(entity.classname),
  ): Vec3 {
    if (!entity.classname.startsWith("monster_")) return origin;
    if (spawnProfile && !spawnProfile.dropToFloor) return origin;
    const footZ = origin[2] + bounds.min[2];
    const lowerZ = mode === "spawn"
      ? footZ - QUAKE_MONSTER_DROP_TO_FLOOR_DISTANCE
      : footZ - STEP_HEIGHT - GROUND_SNAP;
    const floorZ = floorAt(
      origin[0],
      origin[1],
      footZ + STEP_HEIGHT + GROUND_SNAP,
      lowerZ,
    );
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

  function has(entityIndex: number): boolean {
    const shootable = shootables.get(entityIndex);
    return Boolean(shootable && !shootable.dead);
  }

  function damage(entityIndex: number, amount: number): boolean {
    const shootable = shootables.get(entityIndex);
    if (!shootable || shootable.dead) return false;
    const now = performance.now();
    const damageAmount = Math.max(0, amount);
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
      playEnemyPainAnimation(shootable, now);
      flashShootable(shootable);
      return true;
    }
    return destroy(entityIndex);
  }

  function damageZombie(shootable: QuakeShootableState, amount: number, now: number): boolean {
    const enemy = shootable.enemy;
    if (!enemy) return false;
    const baseHealth = QUAKE_SHOOTABLE_HEALTH.monster_zombie ?? 60;
    if (amount >= QUAKE_ZOMBIE_GIB_DAMAGE) {
      shootable.health = 0;
      enemy.zombieGibbed = true;
      playQuakecSound("zombie/z_gib.wav", shootable, "death", now);
      markShootableTrace("shootable-damage", shootable, {
        amount,
        health: shootable.health,
        killed: true,
        zombiePolicy: "gib",
      });
      return destroy(shootable.entity.index);
    }

    shootable.health = baseHealth;
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
    playEnemyPainAnimation(shootable, now);
    flashShootable(shootable);
    return true;
  }

  function destroy(entityIndex: number): boolean {
    const shootable = shootables.get(entityIndex);
    if (!shootable || shootable.dead) return false;
    shootable.dead = true;
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

  function resolvePlayerCollision(
    result: QuakeCollisionResult,
    previous: [number, number, number],
    eyeHeight: number,
  ): QuakeCollisionResult {
    let origin = result.origin;
    for (const shootable of shootables.values()) {
      if (shootable.dead) continue;
      if (!playerOverlapsShootable(origin, eyeHeight, shootable)) continue;
      const pushed = pushPlayerOutOfShootable(origin, previous, shootable);
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
        dead: shootable.dead,
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
    handle.element.classList.add("shootable");
    if (entity.classname.startsWith("monster_")) handle.element.classList.add("enemy");
    stripPolyMeshMetadata(handle.element);
    if (isQuakeDebugDomMetadataEnabled()) {
      handle.element.dataset.entityIndex = String(entity.index);
      handle.element.dataset.classname = entity.classname;
    }
    markQuakeTrace("shootable-mesh-create", {
      entity: entity.index,
      class: entity.classname,
      enemy: entity.classname.startsWith("monster_"),
      frame: frameIndex,
      leaves: handle.element.querySelectorAll("b,i,s,u").length,
      model: Boolean(model),
    });
    handle.setTransform({
      position: pointToPoly(entity.origin),
      rotation: [0, 0, entity.angle ?? quakeEntityNumber(entity, "angle", 0)],
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
    const profile = enemyCombatProfile(shootable);
    if (!profile) {
      updateEnemyAnimation(shootable, "idle", now);
      return;
    }
    let enemyEye = shootableEyeOrigin(shootable);
    const canSeePlayer = hasLineOfSight(enemyEye, playerOrigin);
    if (!enemy.awake) {
      updateEnemyAnimation(shootable, "idle", now);
      if (!canSeePlayer) return;
      enemy.awake = true;
      enemy.nextAttackAt = now + enemyWakeDelayMs(profile, enemy);
      syncShootableEnemyDatasets(shootable);
      markShootableTrace("enemy-wake", shootable, {
        nextAttackMs: enemy.nextAttackAt - now,
      });
    }

    if (!canSeePlayer) {
      clearEnemyAttackState(shootable);
      updateEnemyAnimation(shootable, "idle", now);
      return;
    }
    if (enemy.pendingAttack) {
      faceShootableAtPlayer(shootable, playerOrigin);
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
        faceShootableAtPlayer(shootable, playerOrigin);
        performEnemyAttack(shootable, enemy, enemyEye, playerOrigin, profile, now);
      }
      return;
    }
    const moved = moveChasingEnemy(shootable, playerOrigin, profile, dt);
    updateEnemyAnimation(shootable, moved ? "walk" : "idle", now);
    enemyEye = shootableEyeOrigin(shootable);
    faceShootableAtPlayer(shootable, playerOrigin);
    const attackDistanceSq = distanceSq3(enemyEye, playerOrigin);
    if (attackDistanceSq > profile.range * profile.range) {
      clearEnemyAttackState(shootable);
      return;
    }
    if (now < enemy.nextAttackAt) return;
    const quakecAttackChain = selectEnemyAttackChain(shootable, enemy, Math.sqrt(attackDistanceSq), playerOrigin, now);
    if (quakecAttackChain === null) return;
    if (enemy.burstShotsRemaining > 0) {
      playEnemyAttackAnimation(shootable, now);
      performEnemyAttack(shootable, enemy, enemyEye, playerOrigin, profile, now);
      return;
    }
    startEnemyAttackWindup(shootable, enemy, playerOrigin, profile, now, quakecAttackChain);
  }

  function enemyCombatProfile(shootable: QuakeShootableState): QuakeMonsterCombatProfile | undefined {
    if (!shootable.enemy?.quakecRunner) return undefined;
    return QUAKEC_MONSTER_COMBAT_PROFILES[shootable.entity.classname];
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
    enemy.nextAttackAt = now + enemyCooldownMs(profile, enemy);
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
    const timer = window.setTimeout(() => {
      enemyProjectileTimers = enemyProjectileTimers.filter((entry) => entry !== timer);
      fireProjectile(performance.now(), getPlayerOrigin());
    }, delayMs);
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
    enemy.nextAttackAt = now + enemyCooldownMs(profile, enemy);
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

  function playEnemyPainAnimation(shootable: QuakeShootableState, now: number): void {
    const enemy = shootable.enemy;
    if (enemy?.animationMode === "attack" && enemyAnimationLocked(enemy, now)) return;
    startEnemyQuakecOneShotAnimation(shootable, "pain", now);
  }

  function playEnemyDeathAnimation(shootable: QuakeShootableState, now: number): number | null {
    if (shootable.enemy?.zombieGibbed) return null;
    const quakecDuration = startEnemyQuakecOneShotAnimation(shootable, "death", now);
    if (quakecDuration !== null) {
      const enemy = shootable.enemy;
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
    const enemy = shootable.enemy;
    const runner = enemy?.quakecRunner;
    const model = shootable.model;
    if (!enemy || !runner || !model?.animationFrames?.length || !shootable.handle || !shootable.visible) {
      return null;
    }
    const chain = quakecAnimationChainForMode(shootable, mode);
    if (!runner.hasChain(chain)) return null;
    const step = runner.enterChain(chain);
    if (!step) return null;
    const duration = Math.max(1, runner.chainLength(chain)) * QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;
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
    return mode === "idle" || mode === "walk";
  }

  function enemyOptionalAnimationRange(
    profile: QuakeMonsterAnimationProfile,
    mode: QuakeMonsterAnimationMode,
  ): QuakeMonsterAnimationRange | undefined {
    if (mode === "attack") return profile.attack;
    if (mode === "death") return profile.death;
    if (mode === "pain") return profile.pain;
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
    if (mode === "walk") return profile.walkFps ?? profile.fps;
    return profile.idleFps ?? profile.fps;
  }

  function quakecAnimationChainForMode(shootable: QuakeShootableState, mode: QuakeMonsterAnimationMode): string {
    if (mode === "attack") {
      return shootable.enemy?.pendingAttack?.quakecChain ?? quakecAttackPolicy(shootable)?.chain ?? "attack";
    }
    if (mode === "death") return "death_a";
    if (mode === "pain") return shootable.enemy?.quakecPainChain ?? "pain_a";
    if (mode === "walk") return "run";
    return "stand";
  }

  function shootableUsesQuakecAttackEvents(shootable: QuakeShootableState): boolean {
    return Boolean(quakecAttackPolicy(shootable)?.usesFrameEvents);
  }

  function enemyCorpseFrameIndex(shootable: QuakeShootableState): number | undefined {
    const quakecDeathFrame = shootable.enemy?.quakecLastState?.chain === "death_a"
      ? shootable.enemy.quakecLastState.frameIndex
      : undefined;
    if (quakecDeathFrame !== undefined) return quakecDeathFrame;
    const profile = quakeMonsterAnimationProfile(shootable);
    const model = shootable.model;
    if (!profile?.death || !model?.animationFrames?.length) return undefined;
    return boundedAnimationRange(profile.death, model).end;
  }

  function isPersistentShootableCorpse(shootable: QuakeShootableState): boolean {
    return shootable.dead && Boolean(shootable.enemy) && !shootable.enemy?.zombieGibbed;
  }

  function isShootableDeathAnimating(shootable: QuakeShootableState, now = performance.now()): boolean {
    return shootable.dead && Boolean(shootable.enemy?.deathAnimationUntil && shootable.enemy.deathAnimationUntil > now);
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
    playerOrigin: [number, number, number],
    profile: QuakeMonsterCombatProfile,
    dt: number,
  ): boolean {
    const chaseSpeed = profile.chaseSpeed ?? 0;
    if (chaseSpeed <= 0 || dt <= 0) return false;
    const dx = playerOrigin[0] - shootable.origin[0];
    const dy = playerOrigin[1] - shootable.origin[1];
    const distance = Math.hypot(dx, dy);
    const stopDistance = Math.max(profile.chaseStopDistance ?? profile.range * 0.72, PLAYER_RADIUS * 1.45);
    const remainingDistance = distance - stopDistance;
    if (!Number.isFinite(distance) || remainingDistance <= QUAKE_SHOOTABLE_COLLISION_EPSILON) return false;
    const step = Math.min(chaseSpeed * dt, remainingDistance);
    if (step <= QUAKE_SHOOTABLE_COLLISION_EPSILON) return false;
    const horizontalNextOrigin: Vec3 = [
      shootable.origin[0] + (dx / distance) * step,
      shootable.origin[1] + (dy / distance) * step,
      shootable.origin[2],
    ];
    const nextOrigin = groundedShootableOrigin(shootable.entity, horizontalNextOrigin, shootable.collisionBounds, "move");
    if (distanceSq3(nextOrigin, shootable.origin) <= QUAKE_SHOOTABLE_COLLISION_EPSILON * QUAKE_SHOOTABLE_COLLISION_EPSILON) {
      return false;
    }
    const from = shootableEyeOrigin(shootable);
    const to: Vec3 = [nextOrigin[0], nextOrigin[1], from[2]];
    if (!hasLineOfSight(from, to)) return false;
    shootable.origin = nextOrigin;
    shootable.leafIndex = leafIndexAt(nextOrigin);
    markShootableTrace("enemy-move", shootable, {
      step,
      x: nextOrigin[0],
      y: nextOrigin[1],
      z: nextOrigin[2],
      groundDz: nextOrigin[2] - horizontalNextOrigin[2],
    });
    return true;
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
      rotation: [0, 0, yaw],
      scale: projectile.profile.projectileScale ?? (model?.renderScale ? 1 / model.renderScale : 1),
    });
  }

  function removeEnemyProjectile(projectile: QuakeEnemyProjectile): void {
    projectile.handle?.remove();
    projectile.handle = null;
  }

  function faceShootableAtPlayer(
    shootable: QuakeShootableState,
    playerOrigin: [number, number, number],
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
    if (!setShootableHandleTransformIfChanged(handle, renderPosition, yaw, scale)) return;
    if (shootable.enemy && shootable.visible && handle === shootable.handle) {
      markShootableTrace("enemy-transform", shootable, {
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
  ): [number, number, number] {
    const bounds = shootableCollisionWorldBounds(shootable);
    const minX = bounds.min[0] - PLAYER_RADIUS - QUAKE_SHOOTABLE_COLLISION_EPSILON;
    const maxX = bounds.max[0] + PLAYER_RADIUS + QUAKE_SHOOTABLE_COLLISION_EPSILON;
    const minY = bounds.min[1] - PLAYER_RADIUS - QUAKE_SHOOTABLE_COLLISION_EPSILON;
    const maxY = bounds.max[1] + PLAYER_RADIUS + QUAKE_SHOOTABLE_COLLISION_EPSILON;
    if (previous[0] <= minX) return [minX, origin[1], origin[2]];
    if (previous[0] >= maxX) return [maxX, origin[1], origin[2]];
    if (previous[1] <= minY) return [origin[0], minY, origin[2]];
    if (previous[1] >= maxY) return [origin[0], maxY, origin[2]];

    const distances = [
      { value: Math.abs(origin[0] - minX), origin: [minX, origin[1], origin[2]] as [number, number, number] },
      { value: Math.abs(maxX - origin[0]), origin: [maxX, origin[1], origin[2]] as [number, number, number] },
      { value: Math.abs(origin[1] - minY), origin: [origin[0], minY, origin[2]] as [number, number, number] },
      { value: Math.abs(maxY - origin[1]), origin: [origin[0], maxY, origin[2]] as [number, number, number] },
    ];
    distances.sort((a, b) => a.value - b.value);
    return distances[0]?.origin ?? origin;
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
    has,
    damage,
    destroy,
    syncMonsterRuntime,
    resolvePlayerCollision,
    syncVisibility,
    weaponTargets,
  };
}

function createEnemyState(entityIndex: number, quakecRunner: QuakeMonsterStateRunner | null): QuakeEnemyState {
  return {
    animationFrameIndex: 0,
    animationLockUntil: 0,
    animationMode: "idle",
    attackVisual: null,
    deathAnimationUntil: 0,
    nextAnimationFrameAt: 0,
    quakecAnimationChain: null,
    quakecActiveTouchDamage: null,
    quakecFiredEvents: new Set(),
    quakecLastState: null,
    quakecPainChain: null,
    quakecRunner,
    awake: false,
    burstShotsRemaining: 0,
    nextAttackAt: 0,
    pendingAttack: null,
    seed: quakeEnemySeed(entityIndex),
    zombieGibbed: false,
    zombiePainRepeatUntil: 0,
  };
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

function shootableModelPath(entity: QuakeEntity, programMetadata: QuakeProgramMetadata | null = null): string | null {
  if (entity.classname === "misc_explobox") return "maps/b_explob.bsp";
  if (entity.classname === "misc_explobox2") return "maps/b_exbox2.bsp";
  if (entity.classname.startsWith("monster_")) {
    return preferredMonsterModelPath(entity, programMetadata);
  }
  return null;
}

function canUseShootableFallback(entity: QuakeEntity): boolean {
  return entity.classname.startsWith("monster_") ||
    entity.classname === "misc_explobox" ||
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
  spawnProfile = quakeMonsterSpawnProfile(entity.classname),
): { min: Vec3; max: Vec3 } {
  if (!entity.classname.startsWith("monster_")) return fallback;
  return quakeMonsterScaledBounds(spawnProfile) ?? fallback;
}

function quakeMonsterSpawnProfile(classname: string): QuakeMonsterSpawnProfile | undefined {
  const logicByClassname = QUAKE_MONSTER_LOGIC as Readonly<Record<string, { spawnProfile?: QuakeMonsterSpawnProfile }>>;
  return logicByClassname[classname]?.spawnProfile;
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
  return Math.max(1, quakeEntityNumber(entity, "health", QUAKE_SHOOTABLE_HEALTH[entity.classname] ?? 20));
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
    chaseSpeed: QUAKEC_SOLDIER_AI_RUN_SPEED,
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
    chaseSpeed: 320 * QUAKE_COLLISION_UNIT_SCALE,
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
    chaseSpeed: 260 * QUAKE_COLLISION_UNIT_SCALE,
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
    chaseSpeed: 180 * QUAKE_COLLISION_UNIT_SCALE,
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
    chaseSpeed: 180 * QUAKE_COLLISION_UNIT_SCALE,
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
    chaseSpeed: 160 * QUAKE_COLLISION_UNIT_SCALE,
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
    cooldownMs: QUAKEC_WIZARD_ATTACK_POLICY?.cooldownMs ?? 2000,
    cooldownRandomAddMs: QUAKEC_WIZARD_ATTACK_POLICY?.cooldownRandomAddMs ?? 0,
    damage: QUAKEC_WIZARD_ATTACK_POLICY?.damage ?? 9,
    kind: "projectile",
    range: (QUAKEC_WIZARD_ATTACK_POLICY?.rangeUnits.mid ?? 1000) * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayMs: 0,
    windupMs: 0,
  },
  monster_zombie: {
    chaseSpeed: 120 * QUAKE_COLLISION_UNIT_SCALE,
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
