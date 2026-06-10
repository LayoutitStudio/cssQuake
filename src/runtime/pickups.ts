import type { Polygon, PolyMeshHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeGameLogicFacts } from "../prepare/gameLogicFacts";
import { quakeGameLogicResolvedPickupFact } from "../prepare/gameLogicFacts";
import type { QuakeEntity, QuakePreparedRenderBundle } from "../prepare/scene";
import {
  QUAKE_WEAPON_ITEM_FLAG_EXPRESSIONS,
  QUAKE_WEAPON_ITEM_FLAGS,
  quakeInventoryOwnsWeapon,
  type QuakeInventoryDelta,
  type QuakeInventoryPowerupBehavior,
  type QuakePlayerInventory,
  type QuakeWeaponId,
} from "./hud";
import { COLLISION_EPSILON, PLAYER_RADIUS, QUAKE_COLLISION_UNIT_SCALE } from "./constants";
import { distanceSq3, dotVec3, normalizeVec3 } from "./math";
import { quakeEntityNumber, quakeEntitySpawnflags } from "./entities";
import {
  isQuakeRenderBundleFrameSetHandle,
  setQuakeRenderBundleFrameSetHandleFrame,
  type QuakeRenderBundleFrameSet,
} from "./renderBundleMesh";

const QUAKE_PICKUP_RADIUS = 34 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_PICKUP_HEIGHT = 64 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_PICKUP_ALIAS_ANIMATION_FPS = 10;
const QUAKE_PICKUP_ALIAS_MOTION_FPS = 30;
const QUAKE_PICKUP_ALIAS_SPIN_DEGREES_PER_SECOND = 90;
const QUAKE_PICKUP_ALIAS_BOB_AMPLITUDE = 4 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_PICKUP_ALIAS_BOB_RADIANS_PER_SECOND = Math.PI * 2 * 0.65;
const QUAKE_PICKUP_MOUNT_DISTANCE = 896 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_PICKUP_UNMOUNT_DISTANCE = 1152 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_PICKUP_MOUNT_DISTANCE_SQ = QUAKE_PICKUP_MOUNT_DISTANCE * QUAKE_PICKUP_MOUNT_DISTANCE;
const QUAKE_PICKUP_UNMOUNT_DISTANCE_SQ = QUAKE_PICKUP_UNMOUNT_DISTANCE * QUAKE_PICKUP_UNMOUNT_DISTANCE;
const QUAKE_PICKUP_MOUNT_VIEW_DOT_MIN = 0.3;
const QUAKE_PICKUP_UNMOUNT_VIEW_DOT_MIN = 0.15;
const QUAKE_PICKUP_MIN_VIEW_DEPTH = PLAYER_RADIUS;
const QUAKE_PICKUP_PAUSED_TIMER_POLL_MS = 100;

export interface QuakePickupModel {
  source: string;
  renderBundle?: QuakePreparedRenderBundle;
  animationFrames?: QuakePickupModelAnimationFrame[];
  animationFrameSet?: QuakePickupModelAnimationFrameSet;
  renderScale?: number;
  bounds: {
    min: Vec3;
    max: Vec3;
  };
}

export interface QuakePickupModelAnimationFrame {
  name: string;
  renderBundle: QuakePreparedRenderBundle;
}

export interface QuakePickupModelAnimationFrameSet {
  leafCount: number;
  droppedLeafCount?: number;
  renderBundle: QuakePreparedRenderBundle;
}

export interface QuakePickupModelLibrary {
  models: Record<string, QuakePickupModel>;
}

export interface QuakeProgramEntityFunctionModelReference {
  path: string;
  statement: number;
}

export interface QuakeProgramEntityFunctionSoundReference {
  path: string;
  statement: number;
}

export interface QuakeProgramEntityFunctionMetadata {
  classname: string;
  file: string;
  models: QuakeProgramEntityFunctionModelReference[];
  sounds?: QuakeProgramEntityFunctionSoundReference[];
  dependencies?: {
    models: QuakeProgramEntityFunctionModelReference[];
    sounds: QuakeProgramEntityFunctionSoundReference[];
  };
}

export interface QuakeProgramSourceFactEntityCheck {
  classname: string;
  sourceModels: string[];
  sourceSounds: string[];
  matchedModels: number;
  matchedSounds: number;
  missingModels: string[];
  missingSounds: string[];
  status: "matched" | "mismatch";
}

export interface QuakeProgramSourceFactChecks {
  version: number;
  sourceRevision: string;
  status: "matched" | "mismatch";
  checkedClassnames: string[];
  matchedModels: number;
  matchedSounds: number;
  checks: QuakeProgramSourceFactEntityCheck[];
  mismatches: QuakeProgramSourceFactEntityCheck[];
}

export interface QuakeProgramMetadata {
  version: number;
  crc: number;
  entityFunctions: QuakeProgramEntityFunctionMetadata[];
  modelsByClassname: Record<string, string[]>;
  soundsByClassname?: Record<string, string[]>;
  sourceFactChecks?: QuakeProgramSourceFactChecks;
}

export type QuakePickupEffect = QuakeInventoryDelta;

interface QuakePickupState {
  entity: QuakeEntity;
  origin: Vec3;
  leafIndex?: number;
  radius: number;
  height: number;
  model?: QuakePickupModel;
  handle: PolyMeshHandle | null;
  renderRadius: number;
  effect: QuakePickupEffect;
  feedback?: QuakeRuntimePickupFeedback;
  picked: boolean;
  removeTimer?: ReturnType<typeof globalThis.setTimeout>;
  runtime: boolean;
  visible: boolean;
  animation?: QuakePickupAnimationState;
}

interface QuakePickupAnimationState {
  model: QuakePickupModel;
  frameIndex: number;
  frameCount: number;
  nextFrameAt: number;
  baseAngle: number;
  phase: number;
  spin: boolean;
}

export interface QuakePickupControllerOptions {
  addMesh: (entity: QuakeEntity, model?: QuakePickupModel, frameIndex?: number) => PolyMeshHandle | null;
  applyEffect: (effect: QuakePickupEffect, entity: QuakeEntity, feedback?: QuakeRuntimePickupFeedback) => void;
  canPickup?: (effect: QuakePickupEffect, entity: QuakeEntity) => boolean;
  gameMode?: () => QuakePickupGameMode;
  isGameplayPaused?: () => boolean;
  leafIndexAt: (origin: Vec3) => number | undefined;
  onRespawnScheduled?: (entity: QuakeEntity, delaySeconds: number) => void;
  playerForward: () => Vec3;
  playerViewDot: (origin: Vec3) => number;
  pointToPoly: (point: { x: number; y: number; z: number }) => Vec3;
  gameLogic: () => QuakeGameLogicFacts | null;
  programMetadata: () => QuakeProgramMetadata | null;
  shouldSpawn: (entity: QuakeEntity) => boolean;
  startMegahealthRot?: (entity: QuakeEntity, delaySeconds: number) => void;
  startPowerup?: (entity: QuakeEntity, powerup: QuakeInventoryPowerupBehavior) => void;
  useTargets?: (entity: QuakeEntity) => boolean | void;
  visibleLeavesAt: (origin: [number, number, number]) => Set<number> | null;
}

export interface QuakeRuntimePickupFeedback {
  message?: string;
  soundPath?: string;
}

export interface QuakeRuntimePickupInput {
  effect: QuakePickupEffect;
  entity: QuakeEntity;
  feedback?: QuakeRuntimePickupFeedback;
  modelPath?: string;
  origin: Vec3;
  removeAfterSeconds?: number;
  visibilityOrigin?: [number, number, number];
}

export interface QuakePickupGameMode {
  coop?: boolean;
  deathmatch?: number;
  singleplayer?: boolean;
}

export interface QuakePickupLifecycleAction {
  action: "leave" | "remove" | "respawn";
  condition: string;
  delaySeconds?: number;
  think?: "SUB_regen";
}

export interface QuakePickupController {
  addRuntimePickup: (input: QuakeRuntimePickupInput) => boolean;
  clear: () => void;
  spawn: (
    entities: QuakeEntity[],
    modelLibrary: QuakePickupModelLibrary | null,
    origin?: [number, number, number],
  ) => void;
  syncCollision: (origin: [number, number, number], eyeHeight: number, stepHeight: number) => void;
  syncVisibility: (origin: [number, number, number]) => void;
}

export function createQuakePickupController(options: QuakePickupControllerOptions): QuakePickupController {
  let handles: PolyMeshHandle[] = [];
  let pickups: QuakePickupState[] = [];
  let currentModelLibrary: QuakePickupModelLibrary | null = null;
  let animationTimer: number | null = null;
  let animationPausedAt = 0;
  let animationClockOffsetMs = 0;
  let respawnTimers: ReturnType<typeof globalThis.setTimeout>[] = [];
  let removalTimers: ReturnType<typeof globalThis.setTimeout>[] = [];

  const clear = (): void => {
    stopAnimationLoop();
    for (const timer of respawnTimers) globalThis.clearTimeout(timer);
    respawnTimers = [];
    for (const timer of removalTimers) globalThis.clearTimeout(timer);
    removalTimers = [];
    for (const handle of handles) handle.remove();
    handles = [];
    pickups = [];
    currentModelLibrary = null;
    animationPausedAt = 0;
    animationClockOffsetMs = 0;
  };

  const spawn = (
    entities: QuakeEntity[],
    modelLibrary: QuakePickupModelLibrary | null,
    visibilityOrigin?: [number, number, number],
  ): void => {
    clear();
    currentModelLibrary = modelLibrary;
    const gameLogic = options.gameLogic();
    const programMetadata = options.programMetadata();

    for (const entity of entities) {
      if (!entity.origin) continue;
      if (!options.shouldSpawn(entity)) continue;
      const effect = quakePickupEffectForEntity(entity, gameLogic);
      const modelPath = quakePickupModelPath(entity, programMetadata, gameLogic);
      if (!effect && !modelPath) continue;

      const origin = options.pointToPoly(entity.origin);
      const model = quakePickupModelForEntity(entity, modelLibrary, programMetadata, gameLogic);
      addPickupState({
        entity,
        effect: effect ?? {},
        model,
        origin,
        runtime: false,
      });
    }
    syncVisibility(visibilityOrigin);
    startAnimationLoop();
  };

  const addRuntimePickup = (input: QuakeRuntimePickupInput): boolean => {
    const model = input.modelPath ? currentModelLibrary?.models[input.modelPath] : undefined;
    const pickup = addPickupState({
      entity: input.entity,
      effect: input.effect,
      ...(input.feedback ? { feedback: input.feedback } : {}),
      model,
      origin: input.origin,
      runtime: true,
    });
    if (!pickup) return false;
    scheduleRuntimePickupRemoval(pickup, input.removeAfterSeconds);
    syncVisibility(input.visibilityOrigin);
    startAnimationLoop();
    return true;
  };

  const addPickupState = (input: {
    effect: QuakePickupEffect;
    entity: QuakeEntity;
    feedback?: QuakeRuntimePickupFeedback;
    model?: QuakePickupModel;
    origin: Vec3;
    runtime: boolean;
  }): QuakePickupState | null => {
    const handle = options.addMesh(input.entity, input.model);
    if (handle) {
      handle.element.hidden = true;
      handles.push(handle);
    }
    const animation = quakePickupAnimationStateForModel(input.entity, input.model);
    const pickup: QuakePickupState = {
      entity: input.entity,
      origin: input.origin,
      leafIndex: options.leafIndexAt(input.origin),
      radius: QUAKE_PICKUP_RADIUS,
      height: QUAKE_PICKUP_HEIGHT,
      ...(input.model ? { model: input.model } : {}),
      handle,
      renderRadius: quakePickupHorizontalRadius(input.model),
      effect: input.effect,
      ...(input.feedback ? { feedback: input.feedback } : {}),
      picked: false,
      runtime: input.runtime,
      visible: false,
      ...(animation ? { animation } : {}),
    };
    if (input.runtime) syncPickupBaseTransform(pickup);
    pickups.push(pickup);
    return pickup;
  };

  const syncCollision = (
    origin: [number, number, number],
    eyeHeight: number,
    stepHeight: number,
  ): void => {
    if (!pickups.length) return;
    const playerMinZ = origin[2] - eyeHeight - stepHeight;
    const playerMaxZ = origin[2] + stepHeight;
    for (const pickup of pickups) {
      if (pickup.picked) continue;
      const dx = origin[0] - pickup.origin[0];
      const dy = origin[1] - pickup.origin[1];
      if (dx * dx + dy * dy > pickup.radius * pickup.radius) continue;
      const pickupMinZ = pickup.origin[2] - pickup.height * 0.5;
      const pickupMaxZ = pickup.origin[2] + pickup.height;
      if (playerMaxZ < pickupMinZ || playerMinZ > pickupMaxZ) continue;
      pickUp(pickup);
    }
  };

  const syncVisibility = (origin?: [number, number, number]): void => {
    if (!pickups.length) return;
    const visibleLeaves = origin ? options.visibleLeavesAt(origin) : null;
    for (const pickup of pickups) {
      if (pickup.picked || !pickup.handle) continue;
      const visible = isPickupRenderVisible(pickup, origin, visibleLeaves);
      setPickupVisible(pickup, visible);
    }
  };

  const isPickupRenderVisible = (
    pickup: QuakePickupState,
    origin: [number, number, number] | undefined,
    visibleLeaves: Set<number> | null,
  ): boolean => {
    if (visibleLeaves && pickup.leafIndex !== undefined && !visibleLeaves.has(pickup.leafIndex)) return false;
    if (!origin) return true;
    const maxDistanceSq = pickup.visible ? QUAKE_PICKUP_UNMOUNT_DISTANCE_SQ : QUAKE_PICKUP_MOUNT_DISTANCE_SQ;
    if (distanceSq3(origin, pickup.origin) > maxDistanceSq) return false;
    if (!isPickupInFrontOfCameraNearPlane(pickup, origin)) return false;
    const minViewDot = pickup.visible ? QUAKE_PICKUP_UNMOUNT_VIEW_DOT_MIN : QUAKE_PICKUP_MOUNT_VIEW_DOT_MIN;
    return options.playerViewDot(pickup.origin) >= minViewDot;
  };

  const isPickupInFrontOfCameraNearPlane = (
    pickup: QuakePickupState,
    playerOrigin: [number, number, number],
  ): boolean => {
    const forward = options.playerForward();
    const forwardHorizontal = normalizeVec3([forward[0], forward[1], 0]);
    if (Math.abs(forwardHorizontal[0]) <= COLLISION_EPSILON &&
      Math.abs(forwardHorizontal[1]) <= COLLISION_EPSILON) {
      return true;
    }
    const toPickup: Vec3 = [
      pickup.origin[0] - playerOrigin[0],
      pickup.origin[1] - playerOrigin[1],
      0,
    ];
    const depth = dotVec3(toPickup, forwardHorizontal);
    return depth - pickup.renderRadius > QUAKE_PICKUP_MIN_VIEW_DEPTH;
  };

  const setPickupVisible = (pickup: QuakePickupState, visible: boolean): void => {
    if (pickup.visible === visible) return;
    pickup.visible = visible;
    if (pickup.handle) pickup.handle.element.hidden = !visible;
    if (visible && pickup.animation) startAnimationLoop();
  };

  const syncPickupBaseTransform = (pickup: QuakePickupState): void => {
    if (!pickup.handle) return;
    const animation = pickup.animation;
    const angle = animation?.baseAngle ?? pickup.entity.angle ?? quakeEntityNumber(pickup.entity, "angle", 0);
    pickup.handle.setTransform({
      position: pickup.origin,
      rotation: [0, 0, angle],
      scale: 1,
    });
  };

  const hasActivePickupAnimation = (): boolean =>
    pickups.some((pickup) => Boolean(pickup.animation && !pickup.picked && pickup.visible && pickup.handle));

  const startAnimationLoop = (): void => {
    if (animationTimer !== null) return;
    if (!hasActivePickupAnimation()) return;
    animationTimer = window.setInterval(stepAnimations, 1000 / QUAKE_PICKUP_ALIAS_MOTION_FPS);
  };

  const stopAnimationLoop = (): void => {
    if (animationTimer === null) return;
    window.clearInterval(animationTimer);
    animationTimer = null;
  };

  const stepAnimations = (): void => {
    let active = false;
    const now = performance.now();
    if (options.isGameplayPaused?.()) {
      animationPausedAt ||= now;
      return;
    }
    if (animationPausedAt) {
      const durationMs = now - animationPausedAt;
      animationClockOffsetMs += durationMs;
      for (const pickup of pickups) {
        if (pickup.animation) pickup.animation.nextFrameAt += durationMs;
      }
      animationPausedAt = 0;
    }
    const seconds = (now - animationClockOffsetMs) / 1000;
    for (const pickup of pickups) {
      const animation = pickup.animation;
      if (!animation || pickup.picked || !pickup.visible || !pickup.handle) continue;
      active = true;
      if (animation.frameCount > 1 && now >= animation.nextFrameAt) {
        animation.frameIndex = (animation.frameIndex + 1) % animation.frameCount;
        animation.nextFrameAt = now + 1000 / QUAKE_PICKUP_ALIAS_ANIMATION_FPS;
        if (isQuakeRenderBundleFrameSetHandle(pickup.handle)) {
          setQuakeRenderBundleFrameSetHandleFrame(pickup.handle, animation.frameIndex);
        } else {
          const previousHandle = pickup.handle;
          const nextHandle = options.addMesh(pickup.entity, animation.model, animation.frameIndex);
          if (nextHandle) {
            previousHandle.remove();
            handles = handles.filter((handle) => handle !== previousHandle);
            handles.push(nextHandle);
            pickup.handle = nextHandle;
          }
        }
      }
      if (animation.spin) {
        syncPickupAnimationTransform(pickup, seconds);
      }
    }
    if (!active) {
      stopAnimationLoop();
    }
  };

  const syncPickupAnimationTransform = (pickup: QuakePickupState, seconds: number): void => {
    const animation = pickup.animation;
    if (!animation || !pickup.handle) return;
    pickup.handle.setTransform({
      position: [
        pickup.origin[0],
        pickup.origin[1],
        pickup.origin[2] +
          Math.sin(seconds * QUAKE_PICKUP_ALIAS_BOB_RADIANS_PER_SECOND + animation.phase) *
            QUAKE_PICKUP_ALIAS_BOB_AMPLITUDE,
      ],
      rotation: [
        0,
        0,
        (animation.baseAngle + seconds * QUAKE_PICKUP_ALIAS_SPIN_DEGREES_PER_SECOND) % 360,
      ],
      scale: 1,
    });
  };

  const pickUp = (pickup: QuakePickupState): void => {
    const gameLogic = options.gameLogic();
    if (options.canPickup && !options.canPickup(pickup.effect, pickup.entity)) return;
    const lifecycleAction = quakePickupLifecycleActionForEntity(
      pickup.entity,
      gameLogic,
      options.gameMode?.() ?? { singleplayer: true },
    );
    // Leave-in-place pickups need per-player ownership; keep them facts-only until multiplayer exists.
    if (lifecycleAction?.action === "leave") return;
    pickup.picked = true;
    pickup.visible = false;
    pickup.handle?.remove();
    handles = handles.filter((handle) => handle !== pickup.handle);
    pickup.handle = null;
    options.applyEffect(pickup.effect, pickup.entity, pickup.feedback);
    const powerup = quakePickupPowerupBehaviorForEntity(pickup.entity, gameLogic);
    if (powerup) {
      options.startPowerup?.(pickup.entity, powerup);
    }
    const megahealthRotDelay = quakePickupMegahealthRotDelayForEntity(pickup.entity, gameLogic);
    if (megahealthRotDelay !== undefined) {
      options.startMegahealthRot?.(pickup.entity, megahealthRotDelay);
    }
    if (quakePickupFiresTargetsForEntity(pickup.entity, gameLogic)) {
      options.useTargets?.(pickup.entity);
    }
    if (lifecycleAction?.action === "respawn" && lifecycleAction.delaySeconds !== undefined) {
      schedulePickupRespawn(pickup, lifecycleAction.delaySeconds);
    }
    if (pickup.runtime) removeRuntimePickup(pickup);
  };

  const removeRuntimePickup = (pickup: QuakePickupState): void => {
    if (!pickup.runtime) return;
    if (pickup.removeTimer) {
      globalThis.clearTimeout(pickup.removeTimer);
      removalTimers = removalTimers.filter((timer) => timer !== pickup.removeTimer);
      pickup.removeTimer = undefined;
    }
    if (pickup.handle) {
      pickup.handle.remove();
      handles = handles.filter((handle) => handle !== pickup.handle);
      pickup.handle = null;
    }
    pickups = pickups.filter((entry) => entry !== pickup);
  };

  const scheduleRuntimePickupRemoval = (
    pickup: QuakePickupState,
    delaySeconds: number | undefined,
  ): void => {
    if (!pickup.runtime || delaySeconds === undefined) return;
    if (!Number.isFinite(delaySeconds) || delaySeconds <= 0) return;
    let timer: ReturnType<typeof globalThis.setTimeout>;
    const removeAfterDelay = (): void => {
      removalTimers = removalTimers.filter((entry) => entry !== timer);
      if (options.isGameplayPaused?.()) {
        timer = globalThis.setTimeout(removeAfterDelay, QUAKE_PICKUP_PAUSED_TIMER_POLL_MS);
        pickup.removeTimer = timer;
        removalTimers.push(timer);
        return;
      }
      pickup.removeTimer = undefined;
      removeRuntimePickup(pickup);
    };
    timer = globalThis.setTimeout(removeAfterDelay, delaySeconds * 1000);
    pickup.removeTimer = timer;
    removalTimers.push(timer);
  };

  const schedulePickupRespawn = (pickup: QuakePickupState, delaySeconds: number): void => {
    if (!Number.isFinite(delaySeconds) || delaySeconds < 0) return;
    options.onRespawnScheduled?.(pickup.entity, delaySeconds);
    let timer: ReturnType<typeof globalThis.setTimeout>;
    const respawnAfterDelay = (): void => {
      respawnTimers = respawnTimers.filter((entry) => entry !== timer);
      if (options.isGameplayPaused?.()) {
        timer = globalThis.setTimeout(respawnAfterDelay, QUAKE_PICKUP_PAUSED_TIMER_POLL_MS);
        respawnTimers.push(timer);
        return;
      }
      respawnPickup(pickup);
    };
    timer = globalThis.setTimeout(respawnAfterDelay, delaySeconds * 1000);
    respawnTimers.push(timer);
  };

  const respawnPickup = (pickup: QuakePickupState): void => {
    if (!pickups.includes(pickup)) return;
    if (!pickup.picked) return;
    pickup.picked = false;
    pickup.visible = false;
    const handle = options.addMesh(pickup.entity, pickup.model);
    pickup.handle = handle;
    if (handle) {
      handle.element.hidden = true;
      handles.push(handle);
    }
    const animation = quakePickupAnimationStateForModel(pickup.entity, pickup.model);
    if (animation) pickup.animation = animation;
  };

  return {
    addRuntimePickup,
    clear,
    spawn,
    syncCollision,
    syncVisibility: (origin: [number, number, number]) => syncVisibility(origin),
  };
}

function quakePickupAnimationStateForModel(
  entity: QuakeEntity,
  model: QuakePickupModel | undefined,
): QuakePickupState["animation"] {
  if (!model?.source.startsWith("progs/")) return undefined;
  const frameCount = model.animationFrames?.length ?? 1;
  return {
    model,
    frameIndex: 0,
    frameCount,
    nextFrameAt: performance.now() + 1000 / QUAKE_PICKUP_ALIAS_ANIMATION_FPS,
    baseAngle: entity.angle ?? quakeEntityNumber(entity, "angle", 0),
    phase: (entity.index % 97) * 0.37,
    spin: true,
  };
}

function quakePickupHorizontalRadius(model: QuakePickupModel | undefined): number {
  if (!model) return QUAKE_PICKUP_RADIUS;
  return Math.max(
    Math.abs(model.bounds.min[0]),
    Math.abs(model.bounds.max[0]),
    Math.abs(model.bounds.min[1]),
    Math.abs(model.bounds.max[1]),
  );
}

const QUAKE_PICKUP_MODEL_PATHS: Record<string, string> = {
  item_armor1: "progs/armor.mdl",
  item_armor2: "progs/armor.mdl",
  item_key1: "progs/w_s_key.mdl",
  item_key2: "progs/w_g_key.mdl",
  item_artifact_super_damage: "progs/quaddama.mdl",
  item_artifact_invulnerability: "progs/invulner.mdl",
  item_artifact_envirosuit: "progs/suit.mdl",
  item_artifact_invisibility: "progs/invisibl.mdl",
  weapon_nailgun: "progs/g_nail.mdl",
  weapon_supernailgun: "progs/g_nail2.mdl",
  weapon_supershotgun: "progs/g_shot.mdl",
  weapon_grenadelauncher: "progs/g_rock.mdl",
  weapon_rocketlauncher: "progs/g_rock2.mdl",
  weapon_lightning: "progs/g_light.mdl",
  key_silver: "progs/w_s_key.mdl",
  key_gold: "progs/w_g_key.mdl",
};

const QUAKE_PICKUP_WEAPON_IDS: Record<string, QuakeWeaponId> = {
  weapon_supershotgun: "supershotgun",
  weapon_nailgun: "nailgun",
  weapon_supernailgun: "supernailgun",
  weapon_grenadelauncher: "grenadelauncher",
  weapon_rocketlauncher: "rocketlauncher",
  weapon_lightning: "lightning",
};

export function quakePickupPolygons(
  entity: QuakeEntity,
): Polygon[] {
  if (entity.classname === "item_health") return createHealthPickupPolygons();
  if (quakePickupEffectForEntity(entity)) return createGenericPickupPolygons(entity.classname);
  return [];
}

export function quakePickupModelForEntity(
  entity: QuakeEntity,
  modelLibrary: QuakePickupModelLibrary | null,
  programMetadata: QuakeProgramMetadata | null = null,
  gameLogic: QuakeGameLogicFacts | null = null,
): QuakePickupModel | undefined {
  const resolvedFact = quakeGameLogicResolvedPickupFact(gameLogic, entity.index);
  const modelPath = resolvedFact?.modelPath ?? quakePickupModelPath(entity, programMetadata, gameLogic);
  const model = modelPath ? modelLibrary?.models[modelPath] : undefined;
  if (resolvedFact?.modelPath) {
    if (model) return model;
    if (modelLibrary) {
      throw new Error(
        `Prepared Quake pickup model ${resolvedFact.modelPath} is missing for ` +
          `${entity.classname} entity ${entity.index}. ` +
          "This is a preload or asset bug, not a hardcoded pickup fallback.",
      );
    }
    return undefined;
  }
  const fallbackModelPath = QUAKE_PICKUP_MODEL_PATHS[entity.classname];
  const fallbackModel = fallbackModelPath && fallbackModelPath !== modelPath
    ? modelLibrary?.models[fallbackModelPath]
    : undefined;
  return model ?? fallbackModel;
}

export function quakePickupModelRenderBundle(
  model: QuakePickupModel,
  frameIndex = 0,
): QuakePreparedRenderBundle {
  const renderBundle = model.animationFrames?.[frameIndex]?.renderBundle ?? model.renderBundle;
  if (!renderBundle) {
    throw new Error(`Prepared Quake model ${model.source} is missing its render bundle.`);
  }
  return renderBundle;
}

export function quakePickupModelRenderBundleFrameSet(
  model: QuakePickupModel,
): QuakeRenderBundleFrameSet | undefined {
  if (!model.animationFrameSet || !model.animationFrames?.length) return undefined;
  return {
    leafCount: model.animationFrameSet.leafCount,
    renderBundle: model.animationFrameSet.renderBundle,
    frames: model.animationFrames,
  };
}

export function quakePickupModelPath(
  entity: QuakeEntity,
  programMetadata: QuakeProgramMetadata | null = null,
  gameLogic: QuakeGameLogicFacts | null = null,
): string | undefined {
  if (!isQuakePickupClassname(entity.classname)) return undefined;
  const factModelPath = quakeGameLogicResolvedPickupFact(gameLogic, entity.index)?.modelPath;
  if (factModelPath) return factModelPath;
  const programModels = quakeProgramModelPathsForEntity(entity, programMetadata);
  const large = Boolean(quakeEntitySpawnflags(entity) & 1);
  if (entity.classname === "item_health") {
    const spawnflags = quakeEntitySpawnflags(entity);
    if (spawnflags & 2) return quakeProgramModelPathMatching(programModels, "maps/b_bh100.bsp") ?? "maps/b_bh100.bsp";
    return spawnflags & 1
      ? quakeProgramModelPathMatching(programModels, "maps/b_bh10.bsp") ?? "maps/b_bh10.bsp"
      : quakeProgramModelPathMatching(programModels, "maps/b_bh25.bsp") ?? "maps/b_bh25.bsp";
  }
  if (entity.classname === "item_shells" || entity.classname === "ammo_shells") {
    return large
      ? quakeProgramModelPathMatching(programModels, "maps/b_shell1.bsp") ?? "maps/b_shell1.bsp"
      : quakeProgramModelPathMatching(programModels, "maps/b_shell0.bsp") ?? "maps/b_shell0.bsp";
  }
  if (entity.classname === "item_spikes" || entity.classname === "ammo_nails") {
    return large
      ? quakeProgramModelPathMatching(programModels, "maps/b_nail1.bsp") ?? "maps/b_nail1.bsp"
      : quakeProgramModelPathMatching(programModels, "maps/b_nail0.bsp") ?? "maps/b_nail0.bsp";
  }
  if (entity.classname === "item_rockets" || entity.classname === "ammo_rockets") {
    return large
      ? quakeProgramModelPathMatching(programModels, "maps/b_rock1.bsp") ?? "maps/b_rock1.bsp"
      : quakeProgramModelPathMatching(programModels, "maps/b_rock0.bsp") ?? "maps/b_rock0.bsp";
  }
  if (entity.classname === "item_cells" || entity.classname === "ammo_cells") {
    return large
      ? quakeProgramModelPathMatching(programModels, "maps/b_batt1.bsp") ?? "maps/b_batt1.bsp"
      : quakeProgramModelPathMatching(programModels, "maps/b_batt0.bsp") ?? "maps/b_batt0.bsp";
  }
  return quakePreferredProgramPickupModelPath(programModels) ?? QUAKE_PICKUP_MODEL_PATHS[entity.classname];
}

function isQuakePickupClassname(classname: string): boolean {
  return classname.startsWith("item_") ||
    classname.startsWith("weapon_") ||
    classname.startsWith("ammo_") ||
    classname.startsWith("key_");
}

function quakeProgramModelPathsForEntity(
  entity: QuakeEntity,
  programMetadata: QuakeProgramMetadata | null,
): string[] {
  if (!programMetadata) return [];
  return programMetadata.modelsByClassname[entity.classname] ??
    programMetadata.modelsByClassname[quakeProgramClassnameAlias(entity.classname)] ??
    [];
}

function quakeProgramClassnameAlias(classname: string): string {
  if (classname === "ammo_shells") return "item_shells";
  if (classname === "ammo_nails") return "item_spikes";
  if (classname === "ammo_rockets") return "item_rockets";
  if (classname === "ammo_cells") return "item_cells";
  if (classname === "key_silver") return "item_key1";
  if (classname === "key_gold") return "item_key2";
  return classname;
}

function quakeProgramModelPathMatching(models: string[], expected: string): string | undefined {
  const normalized = expected.toLowerCase();
  return models.find((model) => model.toLowerCase() === normalized);
}

function quakePreferredProgramPickupModelPath(models: string[]): string | undefined {
  return models.find((model) => model.startsWith("progs/") && model.endsWith(".mdl")) ??
    models.find((model) => model.startsWith("maps/") && model.endsWith(".bsp"));
}

export function quakePickupEffectForEntity(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null = null,
): QuakePickupEffect | null {
  const fact = quakeGameLogicResolvedPickupFact(gameLogic, entity.index);
  if (fact) {
    const ammoEffect = quakeAmmoInventoryEffect(fact.behavior?.ammo);
    if (ammoEffect) return ammoEffect;
    const weaponEffect = quakeWeaponInventoryEffect(fact.kind, fact.behavior?.weapon);
    if (weaponEffect) return weaponEffect;
    const key = fact.behavior?.key;
    if (key) return { key: key.key };
    const effect: QuakePickupEffect = { ...fact.inventoryDelta };
    const armor = fact.behavior?.armor;
    if (armor && effect.armor !== undefined) effect.armorType = armor.armorType;
    return effect;
  }
  const classname = entity.classname;
  const spawnflags = quakeEntitySpawnflags(entity);
  if (classname === "item_health") {
    if (spawnflags & 2) return { health: 100, healthMax: 250 };
    return { health: spawnflags & 1 ? 5 : 25, healthMax: 100 };
  }
  if (classname === "item_armor1") return { armor: 100 };
  if (classname === "item_armor2") return { armor: 150 };
  if (classname === "item_armorInv") return { armor: 200 };
  if (classname === "item_shells" || classname === "ammo_shells") return { shells: spawnflags & 1 ? 40 : 20 };
  if (classname === "item_spikes" || classname === "ammo_nails") return { nails: spawnflags & 1 ? 50 : 25 };
  if (classname === "item_rockets" || classname === "ammo_rockets") return { rockets: spawnflags & 1 ? 10 : 5 };
  if (classname === "item_cells" || classname === "ammo_cells") return { cells: spawnflags & 1 ? 12 : 6 };
  if (classname === "weapon_nailgun" || classname === "weapon_supernailgun") {
    return quakeFallbackWeaponInventoryEffect(classname, { nails: 30 });
  }
  if (classname === "weapon_supershotgun") return quakeFallbackWeaponInventoryEffect(classname, { shells: 5 });
  if (classname === "weapon_grenadelauncher" || classname === "weapon_rocketlauncher") {
    return quakeFallbackWeaponInventoryEffect(classname, { rockets: 5 });
  }
  if (classname === "weapon_lightning") return quakeFallbackWeaponInventoryEffect(classname, { cells: 15 });
  if (classname === "item_key1" || classname === "key_silver") return { key: "silver" };
  if (classname === "item_key2" || classname === "key_gold") return { key: "gold" };
  if (classname.startsWith("item_artifact_")) return {};
  if (classname.startsWith("weapon_") || classname.startsWith("item_") || classname.startsWith("ammo_") || classname.startsWith("key_")) return {};
  return null;
}

function quakeAmmoInventoryEffect(
  ammoGrant: { inventoryField: "shells" | "nails" | "rockets" | "cells"; amount: number } | undefined,
): QuakePickupEffect | null {
  if (!ammoGrant) return null;
  if (ammoGrant.inventoryField === "shells") return { shells: ammoGrant.amount };
  if (ammoGrant.inventoryField === "nails") return { nails: ammoGrant.amount };
  if (ammoGrant.inventoryField === "rockets") return { rockets: ammoGrant.amount };
  return { cells: ammoGrant.amount };
}

function quakeWeaponInventoryEffect(
  classname: string,
  weapon: {
    itemFlag: number;
    itemFlagExpression: string;
    ammoGrant: { inventoryField: "shells" | "nails" | "rockets" | "cells"; amount: number };
  } | undefined,
): QuakePickupEffect | null {
  if (!weapon) return null;
  const id = quakeWeaponIdForPickupClassname(classname);
  if (!id) return quakeAmmoInventoryEffect(weapon.ammoGrant);
  return {
    ...(quakeAmmoInventoryEffect(weapon.ammoGrant) ?? {}),
    weapon: {
      id,
      itemFlag: weapon.itemFlag,
      itemFlagExpression: weapon.itemFlagExpression,
      select: true,
    },
  };
}

function quakeFallbackWeaponInventoryEffect(classname: string, ammo: QuakePickupEffect): QuakePickupEffect {
  const id = quakeWeaponIdForPickupClassname(classname);
  if (!id) return ammo;
  return {
    ...ammo,
    weapon: {
      id,
      itemFlag: QUAKE_WEAPON_ITEM_FLAGS[id],
      itemFlagExpression: QUAKE_WEAPON_ITEM_FLAG_EXPRESSIONS[id],
      select: true,
    },
  };
}

function quakeWeaponIdForPickupClassname(classname: string): QuakeWeaponId | undefined {
  return QUAKE_PICKUP_WEAPON_IDS[classname];
}

export function quakePickupMessageForEntity(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null = null,
): string | undefined {
  return quakeGameLogicResolvedPickupFact(gameLogic, entity.index)?.feedback?.message;
}

export function quakePickupFiresTargetsForEntity(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null = null,
): boolean {
  return quakeGameLogicResolvedPickupFact(gameLogic, entity.index)?.lifecycle?.pickup.firesTargets === true;
}

export function quakeCanPickupForInventory(
  entity: QuakeEntity,
  inventory: Pick<QuakePlayerInventory, "armor" | "armorType" | "health" | "itemFlags" | "shells" | "nails" | "rockets" | "cells"> &
    Partial<Pick<QuakePlayerInventory, "keys">>,
  gameLogic: QuakeGameLogicFacts | null = null,
  effect: QuakePickupEffect = quakePickupEffectForEntity(entity, gameLogic) ?? {},
): boolean {
  const ammo = quakePickupAmmoBehaviorForEntity(entity, gameLogic);
  if (ammo && typeof effect[ammo.inventoryField] === "number") {
    if (inventory.health <= 0) return false;
    return inventory[ammo.inventoryField] < ammo.rejectAtOrAboveAmount;
  }
  const healthAcceptance = quakePickupHealthAcceptanceForEntity(entity, gameLogic);
  if (healthAcceptance && typeof effect.health === "number") {
    if (inventory.health <= 0) return false;
    return inventory.health < healthAcceptance.rejectAtOrAboveHealth;
  }
  const armor = quakePickupArmorBehaviorForEntity(entity, gameLogic);
  if (armor && typeof effect.armor === "number") {
    if (inventory.health <= 0) return false;
    const replacementScore = armor.replacesWhenCurrentScoreBelow ?? armor.armorType * armor.armorValue;
    return inventory.armorType * inventory.armor < replacementScore;
  }
  if (quakePickupPowerupBehaviorForEntity(entity, gameLogic)) {
    return inventory.health > 0;
  }
  const key = quakePickupKeyBehaviorForEntity(entity, gameLogic);
  if (key && effect.key === key.key) {
    if (inventory.health <= 0) return false;
    return inventory.keys ? !inventory.keys.has(key.key) : true;
  }
  const weapon = quakePickupWeaponBehaviorForEntity(entity, gameLogic);
  if (effect.weapon) {
    if (inventory.health <= 0) return false;
    if (
      weapon &&
      quakeInventoryOwnsWeapon(inventory, effect.weapon) &&
      quakePickupLifecycleConditionMatches(weapon.ownedWeaponReject.condition, { singleplayer: true })
    ) {
      return false;
    }
    return true;
  }
  return true;
}

export function quakePickupLifecycleActionForEntity(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null = null,
  mode: QuakePickupGameMode = { singleplayer: true },
): QuakePickupLifecycleAction | undefined {
  const rules = quakeGameLogicResolvedPickupFact(gameLogic, entity.index)?.lifecycle?.respawn.rules ?? [];
  for (const rule of rules) {
    if (rule.action === "rot") continue;
    if (!quakePickupLifecycleConditionMatches(rule.condition, mode)) continue;
    if (rule.action === "respawn") {
      if (typeof rule.delaySeconds !== "number" || !Number.isFinite(rule.delaySeconds)) return undefined;
      return {
        action: "respawn",
        condition: rule.condition,
        delaySeconds: rule.delaySeconds,
        ...(rule.think === "SUB_regen" ? { think: rule.think } : {}),
      };
    }
    return {
      action: rule.action,
      condition: rule.condition,
    };
  }
  return undefined;
}

export function quakePickupLifecycleConditionMatches(condition: string, mode: QuakePickupGameMode): boolean {
  const deathmatch = Math.max(0, Math.round(mode.deathmatch ?? 0));
  const coop = mode.coop === true;
  const singleplayer = mode.singleplayer ?? (deathmatch === 0 && !coop);
  switch (condition) {
    case "pickup":
      return true;
    case "singleplayer":
      return singleplayer;
    case "coop":
      return coop;
    case "!coop":
      return !coop;
    case "deathmatch":
      return deathmatch !== 0;
    case "!deathmatch":
      return deathmatch === 0;
    case "deathmatch == 1":
      return deathmatch === 1;
    case "deathmatch == 2":
      return deathmatch === 2;
    case "deathmatch != 1":
      return deathmatch !== 1;
    case "deathmatch != 2":
      return deathmatch !== 2;
    case "deathmatch && deathmatch != 2":
      return deathmatch !== 0 && deathmatch !== 2;
    case "deathmatch == 2 || coop":
      return deathmatch === 2 || coop;
    case "singleplayer || deathmatch != 1":
      return singleplayer || deathmatch !== 1;
    case "singleplayer || deathmatch == 2":
      return singleplayer || deathmatch === 2;
    case "!(deathmatch == 2 || coop)":
      return deathmatch !== 2 && !coop;
    default:
      return false;
  }
}

export function quakePickupArmorBehaviorForEntity(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null = null,
): {
  armorType: number;
  armorValue: number;
  replacementScore?: number;
  replacesWhenCurrentScoreBelow?: number;
  itemFlag: number;
  itemFlagExpression: string;
  clearsItemFlagExpression: "IT_ARMOR1 | IT_ARMOR2 | IT_ARMOR3";
} | undefined {
  return quakeGameLogicResolvedPickupFact(gameLogic, entity.index)?.behavior?.armor;
}

export function quakePickupAmmoBehaviorForEntity(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null = null,
): { inventoryField: "shells" | "nails" | "rockets" | "cells"; rejectAtOrAboveAmount: number } | undefined {
  return quakeGameLogicResolvedPickupFact(gameLogic, entity.index)?.behavior?.ammo;
}

export function quakePickupHealthAcceptanceForEntity(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null = null,
): {
  healAmount: number;
  healFunction: "T_Heal";
  healType: 0 | 1 | 2;
  healthMax: number;
  ignoreMaxHealth: boolean;
  rejectAtOrAboveHealth: number;
  megahealth?: {
    itemFlagExpression: "IT_SUPERHEALTH";
    rotDelaySeconds: number;
    rotThink: "item_megahealth_rot";
  };
} | undefined {
  return quakeGameLogicResolvedPickupFact(gameLogic, entity.index)?.behavior?.health;
}

export function quakePickupKeyBehaviorForEntity(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null = null,
): {
  key: "silver" | "gold";
  itemFlag: number;
  itemFlagExpression: string;
  itemFlagMutation: {
    expression: "other.items | self.items";
    sourceField: "self.items";
    targetField: "other.items";
  };
  ownedKeyReject: {
    expression: "other.items & self.items";
    playerField: "items";
    sourceField: "self.items";
  };
} | undefined {
  return quakeGameLogicResolvedPickupFact(gameLogic, entity.index)?.behavior?.key;
}

export function quakePickupPowerupBehaviorForEntity(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null = null,
): QuakeInventoryPowerupBehavior | undefined {
  return quakeGameLogicResolvedPickupFact(gameLogic, entity.index)?.behavior?.powerup;
}

export function quakePickupWeaponBehaviorForEntity(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null = null,
): {
  itemFlag: number;
  itemFlagExpression: string;
  ownedWeaponReject: {
    condition: "deathmatch == 2 || coop";
    itemFlagExpression: string;
  };
} | undefined {
  return quakeGameLogicResolvedPickupFact(gameLogic, entity.index)?.behavior?.weapon;
}

export function quakePickupMegahealthRotDelayForEntity(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null = null,
): number | undefined {
  const rule = quakeGameLogicResolvedPickupFact(gameLogic, entity.index)?.lifecycle?.respawn.rules.find((candidate) =>
    candidate.action === "rot" &&
    candidate.think === "item_megahealth_rot" &&
    typeof candidate.delaySeconds === "number"
  );
  if (!rule || !Number.isFinite(rule.delaySeconds) || rule.delaySeconds < 0) return undefined;
  return rule.delaySeconds;
}

function createHealthPickupPolygons(): Polygon[] {
  return [
    ...createCuboidPolygons([-0.22, -0.22, 0], [0.22, 0.22, 0.42], "#8b1510"),
    createBillboardQuad([-0.135, -0.225, 0.16], [0.135, -0.225, 0.16], [0.135, -0.225, 0.26], [-0.135, -0.225, 0.26], "#f0e6d0"),
    createBillboardQuad([-0.055, -0.226, 0.07], [0.055, -0.226, 0.07], [0.055, -0.226, 0.35], [-0.055, -0.226, 0.35], "#f0e6d0"),
  ];
}

function createGenericPickupPolygons(classname: string): Polygon[] {
  const color = classname.includes("key")
    ? "#d2b34a"
    : classname.includes("armor")
      ? "#4c9b55"
      : classname.includes("rocket")
        ? "#8a3f24"
        : "#7f6040";
  return createCuboidPolygons([-0.18, -0.18, 0], [0.18, 0.18, 0.32], color);
}

function createCuboidPolygons(min: Vec3, max: Vec3, color: string): Polygon[] {
  const [minX, minY, minZ] = min;
  const [maxX, maxY, maxZ] = max;
  return [
    createPickupSolidPolygon([[minX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ], [maxX, minY, minZ]], color),
    createPickupSolidPolygon([[minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ]], color),
    createPickupSolidPolygon([[minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ]], color),
    createPickupSolidPolygon([[maxX, minY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ], [maxX, minY, maxZ]], color),
    createPickupSolidPolygon([[maxX, maxY, minZ], [minX, maxY, minZ], [minX, maxY, maxZ], [maxX, maxY, maxZ]], color),
    createPickupSolidPolygon([[minX, maxY, minZ], [minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, maxZ]], color),
  ];
}

function createBillboardQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: string): Polygon {
  return createPickupSolidPolygon([a, b, c, d], color);
}

function createPickupSolidPolygon(vertices: Vec3[], color: string): Polygon {
  return {
    vertices,
    color,
  };
}
