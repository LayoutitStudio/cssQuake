import type { Polygon, PolyMeshHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeEntity } from "../prepare/prepared-scene";
import type { QuakeInventoryDelta } from "./hud";
import { QUAKE_COLLISION_UNIT_SCALE } from "./constants";
import { quakeEntityNumber, quakeEntitySpawnflags } from "./entities";

const QUAKE_PICKUP_RADIUS = 34 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_PICKUP_HEIGHT = 64 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_PICKUP_ALIAS_ANIMATION_FPS = 10;
const QUAKE_PICKUP_ALIAS_MOTION_FPS = 30;
const QUAKE_PICKUP_ALIAS_SPIN_DEGREES_PER_SECOND = 90;
const QUAKE_PICKUP_ALIAS_BOB_AMPLITUDE = 4 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_PICKUP_ALIAS_BOB_RADIANS_PER_SECOND = Math.PI * 2 * 0.65;

export interface QuakePickupModel {
  source: string;
  texture?: string;
  polygons: Polygon[];
  animationFrames?: QuakePickupModelAnimationFrame[];
  bounds: {
    min: Vec3;
    max: Vec3;
  };
}

export interface QuakePickupModelAnimationFrame {
  name: string;
  polygons: Polygon[];
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
  addMesh: (entity: QuakeEntity, model?: QuakePickupModel) => PolyMeshHandle | null;
  applyEffect: (effect: QuakePickupEffect) => void;
  leafIndexAt: (origin: Vec3) => number | undefined;
  pixelate: (handle: PolyMeshHandle) => void;
  pointToPoly: (point: { x: number; y: number; z: number }) => Vec3;
  programMetadata: () => QuakeProgramMetadata | null;
  schedulePresentationResync: (handle?: PolyMeshHandle | null) => void;
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
      if (handle) handles.push(handle);
      const animation = quakePickupAnimationStateForModel(entity, model);
      pickups.push({
        entity,
        origin,
        leafIndex: options.leafIndexAt(origin),
        radius: QUAKE_PICKUP_RADIUS,
        height: QUAKE_PICKUP_HEIGHT,
        handle,
        effect: effect ?? {},
        picked: false,
        visible: true,
        ...(animation ? { animation } : {}),
      });
    }
    if (visibilityOrigin) syncVisibility(visibilityOrigin);
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
      const visible = !visibleLeaves || pickup.leafIndex === undefined || visibleLeaves.has(pickup.leafIndex);
      setPickupVisible(pickup, visible);
    }
  };

  const setPickupVisible = (pickup: QuakePickupState, visible: boolean): void => {
    if (pickup.visible === visible) return;
    pickup.visible = visible;
    if (pickup.handle) pickup.handle.element.hidden = !visible;
  };

  const startAnimationLoop = (): void => {
    if (animationTimer !== null) return;
    if (!pickups.some((pickup) => pickup.animation)) return;
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
        pickup.handle.setPolygons(
          quakePickupModelPolygons(pickup.entity, animation.model, animation.frameIndex),
          { merge: false, stableDom: true, recomputeAutoCenter: false },
        );
        options.pixelate(pickup.handle);
        options.schedulePresentationResync(pickup.handle);
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
    if (!active && pickups.every((pickup) => pickup.picked || !pickup.animation)) {
      stopAnimationLoop();
    }
  };

  const pickUp = (pickup: QuakePickupState): void => {
    pickup.picked = true;
    pickup.visible = false;
    pickup.handle?.remove();
    handles = handles.filter((handle) => handle !== pickup.handle);
    options.applyEffect(pickup.effect);
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
  modelLibrary: QuakePickupModelLibrary | null,
  programMetadata: QuakeProgramMetadata | null = null,
): Polygon[] {
  const resolvedModel = quakePickupModelForEntity(entity, modelLibrary, programMetadata);
  if (resolvedModel) {
    return quakePickupModelPolygons(entity, resolvedModel);
  }
  if (entity.classname === "item_health") return createHealthPickupPolygons(entity.index);
  if (quakePickupEffectForEntity(entity)) return createGenericPickupPolygons(entity.index, entity.classname);
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

export function quakePickupModelPolygons(
  entity: QuakeEntity,
  model: QuakePickupModel,
  frameIndex = 0,
): Polygon[] {
  const frame = model.animationFrames?.[frameIndex];
  const polygons = frame?.polygons ?? model.polygons;
  return polygons.map((polygon) => ({
    ...polygon,
    ...(model.texture ? { texture: model.texture, textureAlphaMode: "opaque" as const } : {}),
    data: {
      ...polygon.data,
      "quake-pickup-entity": entity.index,
      "quake-pickup-classname": entity.classname,
    },
  }));
}

export function quakePickupModelPath(
  entity: QuakeEntity,
  programMetadata: QuakeProgramMetadata | null = null,
): string | undefined {
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

function createHealthPickupPolygons(entityIndex: number): Polygon[] {
  return [
    ...createCuboidPolygons([-0.22, -0.22, 0], [0.22, 0.22, 0.42], "#8b1510", entityIndex, "health"),
    createBillboardQuad([-0.135, -0.225, 0.16], [0.135, -0.225, 0.16], [0.135, -0.225, 0.26], [-0.135, -0.225, 0.26], "#f0e6d0", entityIndex, "health-cross"),
    createBillboardQuad([-0.055, -0.226, 0.07], [0.055, -0.226, 0.07], [0.055, -0.226, 0.35], [-0.055, -0.226, 0.35], "#f0e6d0", entityIndex, "health-cross"),
  ];
}

function createGenericPickupPolygons(entityIndex: number, classname: string): Polygon[] {
  const color = classname.includes("key")
    ? "#d2b34a"
    : classname.includes("armor")
      ? "#4c9b55"
      : classname.includes("rocket")
        ? "#8a3f24"
        : "#7f6040";
  return createCuboidPolygons([-0.18, -0.18, 0], [0.18, 0.18, 0.32], color, entityIndex, classname);
}

function createCuboidPolygons(min: Vec3, max: Vec3, color: string, entityIndex: number, kind: string): Polygon[] {
  const [minX, minY, minZ] = min;
  const [maxX, maxY, maxZ] = max;
  return [
    createPickupSolidPolygon([[minX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ], [maxX, minY, minZ]], color, entityIndex, kind),
    createPickupSolidPolygon([[minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ]], color, entityIndex, kind),
    createPickupSolidPolygon([[minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ]], color, entityIndex, kind),
    createPickupSolidPolygon([[maxX, minY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ], [maxX, minY, maxZ]], color, entityIndex, kind),
    createPickupSolidPolygon([[maxX, maxY, minZ], [minX, maxY, minZ], [minX, maxY, maxZ], [maxX, maxY, maxZ]], color, entityIndex, kind),
    createPickupSolidPolygon([[minX, maxY, minZ], [minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, maxZ]], color, entityIndex, kind),
  ];
}

function createBillboardQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: string, entityIndex: number, kind: string): Polygon {
  return createPickupSolidPolygon([a, b, c, d], color, entityIndex, kind);
}

function createPickupSolidPolygon(vertices: Vec3[], color: string, entityIndex: number, kind: string): Polygon {
  return {
    vertices,
    color,
    data: {
      quake: true,
      "quake-pickup-entity": entityIndex,
      "quake-pickup-fallback": kind,
    },
  };
}
