import type { Polygon, PolyMeshHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeEntity, QuakePreparedRenderBundle } from "../prepare/scene";
import type { QuakeInventoryDelta } from "./hud";
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

export interface QuakeProgramEntityFunctionMetadata {
  classname: string;
  file: string;
  models: QuakeProgramEntityFunctionModelReference[];
}

export interface QuakeProgramMetadata {
  version: number;
  crc: number;
  entityFunctions: QuakeProgramEntityFunctionMetadata[];
  modelsByClassname: Record<string, string[]>;
}

export type QuakePickupEffect = QuakeInventoryDelta;

interface QuakePickupState {
  entity: QuakeEntity;
  origin: Vec3;
  leafIndex?: number;
  radius: number;
  height: number;
  handle: PolyMeshHandle | null;
  renderRadius: number;
  effect: QuakePickupEffect;
  picked: boolean;
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
  applyEffect: (effect: QuakePickupEffect, entity: QuakeEntity) => void;
  leafIndexAt: (origin: Vec3) => number | undefined;
  playerForward: () => Vec3;
  playerViewDot: (origin: Vec3) => number;
  pointToPoly: (point: { x: number; y: number; z: number }) => Vec3;
  programMetadata: () => QuakeProgramMetadata | null;
  shouldSpawn: (entity: QuakeEntity) => boolean;
  visibleLeavesAt: (origin: [number, number, number]) => Set<number> | null;
}

export interface QuakePickupController {
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
  let animationTimer: number | null = null;

  const clear = (): void => {
    stopAnimationLoop();
    for (const handle of handles) handle.remove();
    handles = [];
    pickups = [];
  };

  const spawn = (
    entities: QuakeEntity[],
    modelLibrary: QuakePickupModelLibrary | null,
    visibilityOrigin?: [number, number, number],
  ): void => {
    clear();
    const programMetadata = options.programMetadata();

    for (const entity of entities) {
      if (!entity.origin) continue;
      if (!options.shouldSpawn(entity)) continue;
      const effect = quakePickupEffectForEntity(entity);
      const modelPath = quakePickupModelPath(entity, programMetadata);
      if (!effect && !modelPath) continue;

      const origin = options.pointToPoly(entity.origin);
      const model = quakePickupModelForEntity(entity, modelLibrary, programMetadata);
      const handle = options.addMesh(entity, model);
      if (handle) {
        handle.element.hidden = true;
        handles.push(handle);
      }
      const animation = quakePickupAnimationStateForModel(entity, model);
      pickups.push({
        entity,
        origin,
        leafIndex: options.leafIndexAt(origin),
        radius: QUAKE_PICKUP_RADIUS,
        height: QUAKE_PICKUP_HEIGHT,
        handle,
        renderRadius: quakePickupHorizontalRadius(model),
        effect: effect ?? {},
        picked: false,
        visible: false,
        ...(animation ? { animation } : {}),
      });
    }
    syncVisibility(visibilityOrigin);
    startAnimationLoop();
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
    const seconds = now / 1000;
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
      }
    }
    if (!active) {
      stopAnimationLoop();
    }
  };

  const pickUp = (pickup: QuakePickupState): void => {
    pickup.picked = true;
    pickup.visible = false;
    pickup.handle?.remove();
    handles = handles.filter((handle) => handle !== pickup.handle);
    options.applyEffect(pickup.effect, pickup.entity);
  };

  return {
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
  key_silver: "progs/w_s_key.mdl",
  key_gold: "progs/w_g_key.mdl",
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
): QuakePickupModel | undefined {
  const modelPath = quakePickupModelPath(entity, programMetadata);
  const fallbackModelPath = QUAKE_PICKUP_MODEL_PATHS[entity.classname];
  const model = modelPath ? modelLibrary?.models[modelPath] : undefined;
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
): string | undefined {
  if (!isQuakePickupClassname(entity.classname)) return undefined;
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

export function quakePickupEffectForEntity(entity: QuakeEntity): QuakePickupEffect | null {
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
  if (classname === "weapon_nailgun" || classname === "weapon_supernailgun") return { nails: 30 };
  if (classname === "weapon_supershotgun") return { shells: 5 };
  if (classname === "weapon_grenadelauncher" || classname === "weapon_rocketlauncher") return { rockets: 5 };
  if (classname === "item_key1" || classname === "key_silver") return { key: "silver" };
  if (classname === "item_key2" || classname === "key_gold") return { key: "gold" };
  if (classname.startsWith("item_artifact_")) return {};
  if (classname.startsWith("weapon_") || classname.startsWith("item_") || classname.startsWith("ammo_") || classname.startsWith("key_")) return {};
  return null;
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
