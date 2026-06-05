import type { Polygon, PolyMeshHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeEntity } from "../prepare/scene";
import {
  COLLISION_EPSILON,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  QUAKE_COLLISION_UNIT_SCALE,
} from "./constants";
import type { QuakeCollisionResult } from "./collision";
import {
  createQuakeShootablesVisibilityChurnStats,
  recordQuakeShootablesVisibilitySync,
  shootableVisibilitySelectionKey,
  type QuakeShootablesVisibilityChurnStats,
  type QuakeShootablesVisibilitySnapshot,
} from "./debug/churnStats";
import { quakeEntityNumber } from "./entities";
import { distanceSq3, normalizeVec3, subtractVec3 } from "./math";
import {
  type QuakePickupModel,
  type QuakePickupModelLibrary,
  type QuakeProgramMetadata,
} from "./pickups";
import {
  setQuakeRenderBundleFrameSetHandleFrame,
  stripPolyMeshMetadata,
} from "./renderBundleMesh";
import type { QuakeWeaponShootableTarget } from "./weapons";

export interface QuakeShootablesController {
  clear(): void;
  debugStats(): QuakeShootablesDebugStats;
  spawn(
    entities: QuakeEntity[],
    modelLibrary: QuakePickupModelLibrary | null,
    programMetadata?: QuakeProgramMetadata | null,
  ): void;
  has(entityIndex: number): boolean;
  damage(entityIndex: number, amount: number): boolean;
  destroy(entityIndex: number): boolean;
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
  damagePlayer(amount: number): boolean;
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
}

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

interface QuakeEnemyState {
  animationFrameIndex: number;
  animationMode: QuakeMonsterAnimationMode;
  nextAnimationFrameAt: number;
  attackVisual: "cooldown" | "windup" | null;
  awake: boolean;
  burstShotsRemaining: number;
  nextAttackAt: number;
  pendingAttack: QuakeEnemyPendingAttack | null;
  seed: number;
}

interface QuakeEnemyPendingAttack {
  fireAt: number;
  target: Vec3;
}

interface QuakeMonsterAttackProfile {
  burstCount?: number;
  burstIntervalMs?: number;
  chaseSpeed?: number;
  cooldownJitterMs?: number;
  damage: number;
  cooldownMs: number;
  kind?: "hitscan" | "projectile" | "touch";
  projectileAimError?: number;
  projectileOriginOffset?: QuakeMonsterProjectileOffset;
  projectileClassname?: string;
  projectileModelPath?: string;
  projectileRadius?: number;
  projectileScale?: number;
  projectileSpeed?: number;
  projectileVerticalAimError?: number;
  range: number;
  wakeDelayJitterMs?: number;
  wakeDelayMs?: number;
  windupMs?: number;
}

interface QuakeMonsterProjectileOffset {
  forward?: number;
  right?: number;
  up?: number;
}

type QuakeMonsterAnimationMode = "idle" | "walk";

interface QuakeMonsterAnimationProfile {
  fps?: number;
  idle: QuakeMonsterAnimationRange;
  idleFps?: number;
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
  profile: QuakeMonsterAttackProfile;
  radiusSq: number;
  sourceEntityIndex: number;
  velocity: Vec3;
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
const QUAKE_SHOOTABLE_MAX_PREWARMED = 3;
const QUAKE_SHOOTABLE_PREWARM_TIMEOUT_MS = 250;
const QUAKE_SHOOTABLE_ANIMATION_FRAME_POOL_SIZE = 3;
const QUAKE_ENEMY_DT_CLAMP = 0.05;
const QUAKE_MONSTER_ATTACK_DELAY_MS = 600;
const QUAKE_MONSTER_PROJECTILE_LIFETIME_MS = 3200;
const QUAKE_MONSTER_PROJECTILE_AIM_DROP = 18 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_AIM_ERROR = 24 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_VERTICAL_AIM_ERROR = 8 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MONSTER_PROJECTILE_RADIUS = 28 * QUAKE_COLLISION_UNIT_SCALE;

export function createQuakeShootablesController({
  addMesh,
  damagePlayer,
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
}: QuakeShootablesControllerOptions): QuakeShootablesController {
  let shootables = new Map<number, QuakeShootableState>();
  let deathTimers: number[] = [];
  let enemyFrame: number | null = null;
  let enemyProjectiles: QuakeEnemyProjectile[] = [];
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
      const origin = pointToPoly(entity.origin);
      const yaw = entity.angle ?? quakeEntityNumber(entity, "angle", 0);
      shootables.set(entity.index, {
        entity,
        origin,
        leafIndex: leafIndexAt(origin),
        model,
        bounds: shootableLocalBounds(entity, model),
        handle: null,
        frameHandles: new Map(),
        visible: false,
        yaw,
        health: shootableHealth(entity),
        dead: false,
        ...(entity.classname.startsWith("monster_") ? { enemy: createEnemyState(entity.index) } : {}),
      });
    }
    if (monsterRuntimeEnabled() && hasLiveEnemies()) startEnemyLoop();
  }

  function has(entityIndex: number): boolean {
    return shootables.has(entityIndex);
  }

  function damage(entityIndex: number, amount: number): boolean {
    const shootable = shootables.get(entityIndex);
    if (!shootable || shootable.dead) return false;
    shootable.health -= Math.max(0, amount);
    if (shootable.health > 0) {
      flashShootable(shootable);
      return true;
    }
    return destroy(entityIndex);
  }

  function destroy(entityIndex: number): boolean {
    const shootable = shootables.get(entityIndex);
    if (!shootable || shootable.dead) return false;
    shootable.dead = true;
    forEachShootableHandle(shootable, (handle) => {
      handle.element.dataset.dead = "true";
      handle.element.removeAttribute("data-hurt");
    });
    if (!shootable.handle) {
      shootables.delete(entityIndex);
      if (shootable.entity.properties.target) fireTarget(shootable.entity.properties.target, shootable.entity.index);
      return true;
    }
    const timer = window.setTimeout(() => {
      removeShootableHandles(shootable);
      shootables.delete(entityIndex);
      deathTimers = deathTimers.filter((item) => item !== timer);
    }, QUAKE_SHOOTABLE_DEATH_DELAY_MS);
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
        bounds: shootableBounds(shootable),
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
    const prewarmCandidates: Array<{ index: number; distanceSq: number }> = [];
    for (const shootable of shootables.values()) {
      if (shootable.dead) continue;
      const visibleLeaf = !visibleLeaves || shootable.leafIndex === undefined || visibleLeaves.has(shootable.leafIndex);
      const distanceSq = distanceSq3(origin, shootable.origin);
      const maxDistanceSq = shootable.visible ? QUAKE_SHOOTABLE_UNMOUNT_DISTANCE_SQ : QUAKE_SHOOTABLE_MOUNT_DISTANCE_SQ;
      if (visibleLeaf && distanceSq <= maxDistanceSq && canMountShootableHandle(shootable, origin)) {
        candidates.push({ index: shootable.entity.index, distanceSq });
      }
      if (distanceSq <= QUAKE_SHOOTABLE_PREWARM_DISTANCE_SQ) {
        prewarmCandidates.push({ index: shootable.entity.index, distanceSq });
      }
    }

    candidates.sort((a, b) => a.distanceSq - b.distanceSq);
    const mountedIndexes = new Set(candidates.slice(0, QUAKE_SHOOTABLE_MAX_MOUNTED).map((candidate) => candidate.index));
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
    recordQuakeShootablesVisibilitySync(visibilityChurn, startedAt, {
      force,
      selectionChanged,
      before,
      after: shootableVisibilitySnapshot(),
      candidates: candidates.length,
      prewarmCandidates: prewarmCandidates.length,
      desiredMounted: mountedIndexes.size,
      desiredPrewarm: prewarmedIndexes.size,
      meshHandlesCreated: visibilityChurn.totalMeshHandlesCreated - meshHandlesCreatedBefore,
      meshHandlesRemoved: visibilityChurn.totalMeshHandlesRemoved - meshHandlesRemovedBefore,
      frameHandlesCreated: visibilityChurn.totalFrameHandlesCreated - frameHandlesCreatedBefore,
      frameHandlesRemoved: visibilityChurn.totalFrameHandlesRemoved - frameHandlesRemovedBefore,
    });
  }

  function setShootableMounted(shootable: QuakeShootableState, mounted: boolean, prewarmed: boolean): void {
    const canPrewarmHandle = canPrewarmShootableHandle(shootable);
    const shouldKeepHandle = mounted || (prewarmed && canPrewarmHandle);
    if (shootable.handle && !shouldKeepHandle) {
      clearEnemyAttackState(shootable);
      removeShootableHandles(shootable);
    }
    if (!shouldKeepHandle || shootable.dead) return;
    if (!shootable.handle) {
      if (!mounted) {
        if (!canPrewarmHandle) return;
        scheduleShootablePrewarm(shootable);
        return;
      }
      mountShootableHandle(shootable);
    }
    setShootableVisible(shootable, mounted);
  }

  function mountShootableHandle(shootable: QuakeShootableState): void {
    initializeEnemyAnimation(shootable, performance.now());
    if (canUseShootableAnimationFrameSet(shootable)) {
      shootable.handle = addShootableMesh(shootable.entity, shootable.model, enemyAnimationFrameIndex(shootable));
      syncShootableHandleVisibility(shootable);
      syncShootableEnemyDatasets(shootable);
      return;
    }
    if (canPoolShootableAnimationFrames(shootable)) {
      const frameIndex = enemyAnimationFrameIndex(shootable);
      const handle = ensureShootableAnimationFrameHandle(shootable, frameIndex);
      if (!handle) return;
      setActiveShootableAnimationFrameHandle(shootable, frameIndex, handle);
      scheduleNextShootableAnimationFramePrewarm(shootable);
      return;
    }
    shootable.handle = addShootableMesh(shootable.entity, shootable.model, enemyAnimationFrameIndex(shootable));
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
    if (!shootable.enemy || !shootable.model?.animationFrames?.length) return true;
    const target = shootableEyeOrigin(shootable);
    return isInPlayerView(target) && hasLineOfSight(playerOrigin, target);
  }

  function setShootableVisible(shootable: QuakeShootableState, visible: boolean): void {
    if (!shootable.handle) {
      shootable.visible = false;
      return;
    }
    const wasVisible = shootable.visible;
    shootable.visible = visible;
    if (!visible && wasVisible) clearEnemyAttackState(shootable);
    syncShootableHandleVisibility(shootable);
    syncShootableEnemyDatasets(shootable);
    if (visible) scheduleNextShootableAnimationFramePrewarm(shootable);
  }

  function canPoolShootableAnimationFrames(shootable: QuakeShootableState): boolean {
    return Boolean(shootable.enemy && shootable.model?.animationFrames?.length && !shootable.model.animationFrameSet);
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
      const active = handle === shootable.handle;
      if (!shootable.visible) {
        handle.element.dataset.prewarmed = "true";
        handle.element.setAttribute("aria-hidden", "true");
        return;
      }
      handle.element.removeAttribute("data-prewarmed");
      if (active) {
        handle.element.removeAttribute("data-frame-hidden");
        handle.element.removeAttribute("aria-hidden");
      } else {
        handle.element.dataset.frameHidden = "true";
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

  function tickEnemies(now: number): void {
    if (!monsterRuntimeEnabled() || (!hasLiveEnemies() && enemyProjectiles.length === 0)) {
      stopEnemyLoop();
      return;
    }

    const dt = Math.min(QUAKE_ENEMY_DT_CLAMP, enemyTime ? (now - enemyTime) / 1000 : 0.0167);
    enemyTime = now;
    const playerOrigin = getPlayerOrigin();
    updateEnemyProjectiles(playerOrigin, dt, now);
    for (const shootable of shootables.values()) {
      updateEnemy(shootable, playerOrigin, dt, now);
    }
    enemyFrame = window.requestAnimationFrame(tickEnemies);
  }

  function hasLiveEnemies(): boolean {
    for (const shootable of shootables.values()) {
      if (shootable.enemy && !shootable.dead) return true;
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
    if (!enemy || shootable.dead || !shootable.handle || !shootable.visible) return;
    const profile = QUAKE_MONSTER_ATTACKS[shootable.entity.classname];
    if (!profile) return;
    let enemyEye = shootableEyeOrigin(shootable);
    const canSeePlayer = hasLineOfSight(enemyEye, playerOrigin);
    if (!enemy.awake) {
      updateEnemyAnimation(shootable, "idle", now);
      if (!canSeePlayer) return;
      enemy.awake = true;
      enemy.nextAttackAt = now + enemyWakeDelayMs(profile, enemy);
      syncShootableEnemyDatasets(shootable);
    }

    if (!canSeePlayer) {
      clearEnemyAttackState(shootable);
      updateEnemyAnimation(shootable, "idle", now);
      return;
    }
    const moved = moveChasingEnemy(shootable, playerOrigin, profile, dt);
    updateEnemyAnimation(shootable, moved ? "walk" : "idle", now);
    enemyEye = shootableEyeOrigin(shootable);
    faceShootableAtPlayer(shootable, playerOrigin);
    if (distanceSq3(enemyEye, playerOrigin) > profile.range * profile.range) {
      clearEnemyAttackState(shootable);
      return;
    }
    if (enemy.pendingAttack) {
      if (now < enemy.pendingAttack.fireAt) return;
      performEnemyAttack(shootable, enemy, enemyEye, playerOrigin, profile, now);
      return;
    }
    if (now < enemy.nextAttackAt) return;
    if (enemy.burstShotsRemaining > 0) {
      performEnemyAttack(shootable, enemy, enemyEye, playerOrigin, profile, now);
      return;
    }
    startEnemyAttackWindup(shootable, enemy, playerOrigin, profile, now);
  }

  function startEnemyAttackWindup(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    playerOrigin: [number, number, number],
    profile: QuakeMonsterAttackProfile,
    now: number,
  ): void {
    enemy.burstShotsRemaining = Math.max(0, Math.round(profile.burstCount ?? 1) - 1);
    const windupMs = Math.max(0, profile.windupMs ?? 0);
    enemy.pendingAttack = {
      fireAt: now + windupMs,
      target: [...playerOrigin] as Vec3,
    };
    enemy.attackVisual = "windup";
    syncShootableEnemyDatasets(shootable);
    if (windupMs <= 0) {
      performEnemyAttack(shootable, enemy, shootableEyeOrigin(shootable), playerOrigin, profile, now);
    }
  }

  function performEnemyAttack(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    enemyEye: Vec3,
    playerOrigin: [number, number, number],
    profile: QuakeMonsterAttackProfile,
    now: number,
  ): void {
    const target = enemy.pendingAttack?.target ?? playerOrigin;
    enemy.pendingAttack = null;
    enemy.attackVisual = "cooldown";
    syncShootableEnemyDatasets(shootable);
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
    enemy.pendingAttack = null;
    enemy.burstShotsRemaining = 0;
    enemy.attackVisual = null;
    syncShootableEnemyDatasets(shootable);
  }

  function initializeEnemyAnimation(shootable: QuakeShootableState, now: number): void {
    const enemy = shootable.enemy;
    const profile = quakeMonsterAnimationProfile(shootable);
    if (!enemy || !profile || !shootable.model?.animationFrames?.length) return;
    enemy.animationMode = "idle";
    enemy.animationFrameIndex = boundedAnimationRange(profile.idle, shootable.model).start;
    enemy.nextAnimationFrameAt = now + enemyAnimationFrameDuration(profile, "idle");
  }

  function updateEnemyAnimation(
    shootable: QuakeShootableState,
    mode: QuakeMonsterAnimationMode,
    now: number,
  ): void {
    const enemy = shootable.enemy;
    const profile = quakeMonsterAnimationProfile(shootable);
    const model = shootable.model;
    if (!enemy || !profile || !model?.animationFrames?.length || !shootable.handle || !shootable.visible) return;
    const range = boundedAnimationRange(mode === "walk" ? profile.walk ?? profile.idle : profile.idle, model);
    if (enemy.animationMode !== mode ||
      enemy.animationFrameIndex < range.start ||
      enemy.animationFrameIndex > range.end
    ) {
      enemy.animationMode = mode;
      enemy.animationFrameIndex = range.start;
      enemy.nextAnimationFrameAt = now + enemyAnimationFrameDuration(profile, mode);
      activateShootableAnimationFrame(shootable, enemy.animationFrameIndex);
      return;
    }
    if (now < enemy.nextAnimationFrameAt) return;
    enemy.animationFrameIndex = enemy.animationFrameIndex >= range.end
      ? range.start
      : enemy.animationFrameIndex + 1;
    enemy.nextAnimationFrameAt = now + enemyAnimationFrameDuration(profile, mode);
    activateShootableAnimationFrame(shootable, enemy.animationFrameIndex);
  }

  function activateShootableAnimationFrame(shootable: QuakeShootableState, frameIndex: number): void {
    if (setQuakeRenderBundleFrameSetHandleFrame(shootable.handle, frameIndex)) {
      syncShootableEnemyDatasets(shootable);
      return;
    }
    if (!canPoolShootableAnimationFrames(shootable)) {
      replaceShootableAnimationFrame(shootable, frameIndex);
      return;
    }
    const handle = ensureShootableAnimationFrameHandle(shootable, frameIndex);
    if (!handle) return;
    setActiveShootableAnimationFrameHandle(shootable, frameIndex, handle);
    scheduleNextShootableAnimationFramePrewarm(shootable);
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
    const enemy = shootable.enemy;
    if (!enemy) return;
    if (enemy.awake) {
      handle.element.dataset.awake = "true";
    } else {
      handle.element.removeAttribute("data-awake");
    }
    if (enemy.attackVisual) {
      handle.element.dataset.attack = enemy.attackVisual;
    } else {
      handle.element.removeAttribute("data-attack");
    }
    handle.element.dataset.animationMode = enemy.animationMode;
    handle.element.dataset.animationFrame = String(frameIndex);
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
    const fps = mode === "walk" ? profile.walkFps ?? profile.fps : profile.idleFps ?? profile.fps;
    return 1000 / Math.max(1, fps ?? 8);
  }

  function nextShootableAnimationFrameIndex(shootable: QuakeShootableState): number | undefined {
    const enemy = shootable.enemy;
    const profile = quakeMonsterAnimationProfile(shootable);
    const model = shootable.model;
    if (!enemy || !profile || !model?.animationFrames?.length) return undefined;
    const range = boundedAnimationRange(
      enemy.animationMode === "walk" ? profile.walk ?? profile.idle : profile.idle,
      model,
    );
    return enemy.animationFrameIndex >= range.end ? range.start : enemy.animationFrameIndex + 1;
  }

  function enemyWakeDelayMs(profile: QuakeMonsterAttackProfile, enemy: QuakeEnemyState): number {
    return Math.max(0, (profile.wakeDelayMs ?? QUAKE_MONSTER_ATTACK_DELAY_MS) +
      enemyRandomRange(enemy, 0, profile.wakeDelayJitterMs ?? 0));
  }

  function enemyCooldownMs(profile: QuakeMonsterAttackProfile, enemy: QuakeEnemyState): number {
    const jitter = Math.max(0, profile.cooldownJitterMs ?? 0);
    return Math.max(80, profile.cooldownMs + enemyRandomRange(enemy, -jitter, jitter));
  }

  function enemyAttackOrigin(
    shootable: QuakeShootableState,
    eyeOrigin: Vec3,
    playerOrigin: [number, number, number],
    profile: QuakeMonsterAttackProfile,
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

  function moveChasingEnemy(
    shootable: QuakeShootableState,
    playerOrigin: [number, number, number],
    profile: QuakeMonsterAttackProfile,
    dt: number,
  ): boolean {
    const chaseSpeed = profile.chaseSpeed ?? 0;
    if (chaseSpeed <= 0 || dt <= 0) return false;
    const dx = playerOrigin[0] - shootable.origin[0];
    const dy = playerOrigin[1] - shootable.origin[1];
    const distance = Math.hypot(dx, dy);
    const stopDistance = Math.max(profile.range * 0.72, PLAYER_RADIUS * 1.45);
    if (!Number.isFinite(distance) || distance <= stopDistance) return false;
    const step = Math.min(chaseSpeed * dt, distance - stopDistance);
    const nextOrigin: Vec3 = [
      shootable.origin[0] + (dx / distance) * step,
      shootable.origin[1] + (dy / distance) * step,
      shootable.origin[2],
    ];
    const from: Vec3 = [shootable.origin[0], shootable.origin[1], shootableEyeOrigin(shootable)[2]];
    const to: Vec3 = [nextOrigin[0], nextOrigin[1], from[2]];
    if (!hasLineOfSight(from, to)) return false;
    shootable.origin = nextOrigin;
    shootable.leafIndex = leafIndexAt(nextOrigin);
    return true;
  }

  function spawnEnemyProjectile(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    start: Vec3,
    target: Vec3,
    profile: QuakeMonsterAttackProfile,
    now: number,
  ): void {
    const speed = profile.projectileSpeed ?? 420 * QUAKE_COLLISION_UNIT_SCALE;
    const radius = profile.projectileRadius ?? QUAKE_MONSTER_PROJECTILE_RADIUS;
    const direction = normalizeVec3(subtractVec3(enemyProjectileAimTarget(start, target, profile, enemy), start));
    const projectile: QuakeEnemyProjectile = {
      damage: profile.damage,
      expiresAt: now + QUAKE_MONSTER_PROJECTILE_LIFETIME_MS,
      handle: null,
      origin: [...start] as Vec3,
      profile,
      radiusSq: radius * radius,
      sourceEntityIndex: shootable.entity.index,
      velocity: [
        direction[0] * speed,
        direction[1] * speed,
        direction[2] * speed,
      ],
    };
    projectile.handle = addEnemyProjectileMesh(projectile);
    enemyProjectiles.push(projectile);
  }

  function enemyProjectileAimTarget(
    start: Vec3,
    target: Vec3,
    profile: QuakeMonsterAttackProfile,
    enemy: QuakeEnemyState,
  ): Vec3 {
    const dx = target[0] - start[0];
    const dy = target[1] - start[1];
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
      target[0] + right[0] * horizontalOffset,
      target[1] + right[1] * horizontalOffset,
      target[2] - QUAKE_MONSTER_PROJECTILE_AIM_DROP + verticalOffset,
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
        removeEnemyProjectile(projectile);
        continue;
      }
      const nextOrigin: Vec3 = [
        projectile.origin[0] + projectile.velocity[0] * dt,
        projectile.origin[1] + projectile.velocity[1] * dt,
        projectile.origin[2] + projectile.velocity[2] * dt,
      ];
      if (!hasLineOfSight(projectile.origin, nextOrigin)) {
        removeEnemyProjectile(projectile);
        continue;
      }
      projectile.origin = nextOrigin;
      syncEnemyProjectileMesh(projectile);
      if (distanceSq3(projectile.origin, playerOrigin) <= projectile.radiusSq) {
        damagePlayer(projectile.damage);
        removeEnemyProjectile(projectile);
        continue;
      }
      active.push(projectile);
    }
    enemyProjectiles = active;
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
    handle.element.dataset.projectile = classname;
    if (model && projectile.profile.projectileModelPath) {
      handle.element.dataset.projectileModel = projectile.profile.projectileModelPath;
    }
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
    handle.setTransform({
      position: shootable.origin,
      rotation: [0, 0, yaw],
      scale: shootable.model?.renderScale ? 1 / shootable.model.renderScale : 1,
    });
  }

  function shootableEyeOrigin(shootable: QuakeShootableState): Vec3 {
    const bounds = shootableBounds(shootable);
    return [
      shootable.origin[0],
      shootable.origin[1],
      bounds.min[2] + (bounds.max[2] - bounds.min[2]) * 0.75,
    ];
  }

  function flashShootable(shootable: QuakeShootableState): void {
    const element = shootable.handle?.element;
    if (!element) return;
    delete element.dataset.hurt;
    void element.offsetWidth;
    element.dataset.hurt = "true";
    window.setTimeout(() => {
      if (element.isConnected) element.removeAttribute("data-hurt");
    }, 120);
  }

  function playerOverlapsShootable(
    origin: [number, number, number],
    eyeHeight: number,
    shootable: QuakeShootableState,
  ): boolean {
    const bounds = shootableBounds(shootable);
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
    const bounds = shootableBounds(shootable);
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

  return {
    clear,
    debugStats,
    spawn,
    has,
    damage,
    destroy,
    resolvePlayerCollision,
    syncVisibility,
    weaponTargets,
  };
}

function createEnemyState(entityIndex: number): QuakeEnemyState {
  return {
    animationFrameIndex: 0,
    animationMode: "idle",
    attackVisual: null,
    nextAnimationFrameAt: 0,
    awake: false,
    burstShotsRemaining: 0,
    nextAttackAt: 0,
    pendingAttack: null,
    seed: quakeEnemySeed(entityIndex),
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
    !["bolt.mdl", "grenade.mdl", "k_spike.mdl", "lavaball.mdl", "laser.mdl", "s_light.mdl", "v_spike.mdl", "w_spike.mdl"].includes(filename);
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
    fps: 8,
    idle: { start: 0, end: 7 },
    walk: { start: 73, end: 80 },
  },
  monster_dog: {
    idle: { start: 69, end: 77 },
    idleFps: 8,
    walk: { start: 48, end: 59 },
    walkFps: 10,
  },
  monster_knight: {
    idle: { start: 0, end: 8 },
    idleFps: 7,
    walk: { start: 53, end: 66 },
    walkFps: 10,
  },
  monster_ogre: {
    idle: { start: 0, end: 8 },
    idleFps: 7,
    walk: { start: 9, end: 24 },
    walkFps: 9,
  },
};

const QUAKE_MONSTER_ATTACKS: Record<string, QuakeMonsterAttackProfile> = {
  monster_army: {
    burstCount: 2,
    burstIntervalMs: 135,
    cooldownJitterMs: 220,
    damage: 4,
    cooldownMs: 1250,
    kind: "hitscan",
    range: 640 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayJitterMs: 220,
    wakeDelayMs: 420,
    windupMs: 120,
  },
  monster_dog: {
    chaseSpeed: 320 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownJitterMs: 120,
    damage: 10,
    cooldownMs: 950,
    kind: "touch",
    range: 80 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayJitterMs: 160,
    wakeDelayMs: 250,
    windupMs: 70,
  },
  monster_demon1: {
    chaseSpeed: 260 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownJitterMs: 180,
    damage: 25,
    cooldownMs: 1320,
    kind: "touch",
    range: 100 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayJitterMs: 220,
    wakeDelayMs: 420,
    windupMs: 180,
  },
  monster_enforcer: {
    burstCount: 3,
    burstIntervalMs: 110,
    cooldownJitterMs: 260,
    damage: 6,
    cooldownMs: 1450,
    kind: "hitscan",
    range: 700 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayJitterMs: 240,
    wakeDelayMs: 480,
    windupMs: 150,
  },
  monster_hell_knight: {
    cooldownJitterMs: 240,
    damage: 15,
    cooldownMs: 1320,
    kind: "projectile",
    projectileAimError: 28 * QUAKE_COLLISION_UNIT_SCALE,
    projectileClassname: "enemy_projectile_spike",
    projectileModelPath: "progs/k_spike.mdl",
    projectileOriginOffset: {
      forward: 14 * QUAKE_COLLISION_UNIT_SCALE,
      up: 4 * QUAKE_COLLISION_UNIT_SCALE,
    },
    projectileRadius: 30 * QUAKE_COLLISION_UNIT_SCALE,
    projectileSpeed: 390 * QUAKE_COLLISION_UNIT_SCALE,
    projectileVerticalAimError: 9 * QUAKE_COLLISION_UNIT_SCALE,
    range: 640 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayJitterMs: 240,
    wakeDelayMs: 520,
    windupMs: 300,
  },
  monster_knight: {
    chaseSpeed: 180 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownJitterMs: 140,
    damage: 10,
    cooldownMs: 1080,
    kind: "touch",
    range: 90 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayJitterMs: 180,
    wakeDelayMs: 380,
    windupMs: 120,
  },
  monster_ogre: {
    cooldownJitterMs: 360,
    damage: 12,
    cooldownMs: 1780,
    kind: "projectile",
    projectileAimError: 48 * QUAKE_COLLISION_UNIT_SCALE,
    projectileClassname: "enemy_projectile_grenade",
    projectileModelPath: "progs/grenade.mdl",
    projectileOriginOffset: {
      forward: 18 * QUAKE_COLLISION_UNIT_SCALE,
      right: 8 * QUAKE_COLLISION_UNIT_SCALE,
      up: -4 * QUAKE_COLLISION_UNIT_SCALE,
    },
    projectileRadius: 36 * QUAKE_COLLISION_UNIT_SCALE,
    projectileSpeed: 320 * QUAKE_COLLISION_UNIT_SCALE,
    projectileVerticalAimError: 14 * QUAKE_COLLISION_UNIT_SCALE,
    range: 700 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayJitterMs: 260,
    wakeDelayMs: 620,
    windupMs: 430,
  },
  monster_shalrath: {
    cooldownJitterMs: 260,
    damage: 15,
    cooldownMs: 1500,
    kind: "projectile",
    projectileAimError: 36 * QUAKE_COLLISION_UNIT_SCALE,
    projectileClassname: "enemy_projectile_magic",
    projectileModelPath: "progs/v_spike.mdl",
    projectileOriginOffset: {
      forward: 12 * QUAKE_COLLISION_UNIT_SCALE,
      up: 8 * QUAKE_COLLISION_UNIT_SCALE,
    },
    projectileRadius: 32 * QUAKE_COLLISION_UNIT_SCALE,
    projectileSpeed: 380 * QUAKE_COLLISION_UNIT_SCALE,
    projectileVerticalAimError: 12 * QUAKE_COLLISION_UNIT_SCALE,
    range: 700 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayJitterMs: 220,
    wakeDelayMs: 540,
    windupMs: 360,
  },
  monster_shambler: {
    cooldownJitterMs: 320,
    damage: 20,
    cooldownMs: 2200,
    kind: "hitscan",
    range: 700 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayJitterMs: 260,
    wakeDelayMs: 720,
    windupMs: 650,
  },
  monster_tarbaby: {
    chaseSpeed: 280 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownJitterMs: 110,
    damage: 20,
    cooldownMs: 980,
    kind: "touch",
    range: 90 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayJitterMs: 160,
    wakeDelayMs: 260,
    windupMs: 90,
  },
  monster_wizard: {
    cooldownJitterMs: 260,
    damage: 10,
    cooldownMs: 1120,
    kind: "projectile",
    projectileAimError: 32 * QUAKE_COLLISION_UNIT_SCALE,
    projectileClassname: "enemy_projectile_spike",
    projectileModelPath: "progs/w_spike.mdl",
    projectileOriginOffset: {
      forward: 12 * QUAKE_COLLISION_UNIT_SCALE,
      up: 8 * QUAKE_COLLISION_UNIT_SCALE,
    },
    projectileRadius: 28 * QUAKE_COLLISION_UNIT_SCALE,
    projectileSpeed: 450 * QUAKE_COLLISION_UNIT_SCALE,
    projectileVerticalAimError: 10 * QUAKE_COLLISION_UNIT_SCALE,
    range: 700 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayJitterMs: 180,
    wakeDelayMs: 380,
    windupMs: 190,
  },
  monster_zombie: {
    chaseSpeed: 120 * QUAKE_COLLISION_UNIT_SCALE,
    cooldownJitterMs: 180,
    damage: 10,
    cooldownMs: 1500,
    kind: "touch",
    range: 100 * QUAKE_COLLISION_UNIT_SCALE,
    wakeDelayJitterMs: 260,
    wakeDelayMs: 520,
    windupMs: 260,
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
