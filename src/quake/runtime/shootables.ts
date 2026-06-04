import type { ParseResult, Polygon, PolyMeshHandle, PolySceneHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeEntity } from "../prepare/preparedScene";
import {
  COLLISION_EPSILON,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  QUAKE_COLLISION_UNIT_SCALE,
} from "./constants";
import type { QuakeCollisionResult } from "./collision";
import { quakeEntityNumber } from "./entities";
import { distanceSq3 } from "./math";
import {
  quakePickupModelPolygons,
  type QuakePickupModel,
  type QuakePickupModelLibrary,
} from "./pickups";
import type { QuakeWeaponShootableTarget } from "./weapons";

export interface QuakeShootablesController {
  clear(): void;
  spawn(entities: QuakeEntity[], modelLibrary: QuakePickupModelLibrary | null): void;
  has(entityIndex: number): boolean;
  destroy(entityIndex: number): boolean;
  resolvePlayerCollision(
    result: QuakeCollisionResult,
    previous: [number, number, number],
    eyeHeight: number,
  ): QuakeCollisionResult;
  weaponTargets(): Iterable<QuakeWeaponShootableTarget>;
}

export interface QuakeShootablesControllerOptions {
  scene: PolySceneHandle;
  pointToPoly(point: { x: number; y: number; z: number }): Vec3;
  shouldSpawn(entity: QuakeEntity): boolean;
  pixelate(handle: PolyMeshHandle): void;
  schedulePresentationResync(handle: PolyMeshHandle): void;
  fireTarget(targetname: string, sourceEntityIndex?: number): void;
}

interface QuakeShootableState {
  entity: QuakeEntity;
  origin: Vec3;
  model: QuakePickupModel;
  handle: PolyMeshHandle | null;
  dead: boolean;
}

const QUAKE_SHOOTABLE_DEATH_DELAY_MS = 180;
const QUAKE_SHOOTABLE_COLLISION_EPSILON = 0.5 * QUAKE_COLLISION_UNIT_SCALE;

export function createQuakeShootablesController({
  scene,
  pointToPoly,
  shouldSpawn,
  pixelate,
  schedulePresentationResync,
  fireTarget,
}: QuakeShootablesControllerOptions): QuakeShootablesController {
  let shootables = new Map<number, QuakeShootableState>();
  let deathTimers: number[] = [];

  function clear(): void {
    for (const timer of deathTimers) window.clearTimeout(timer);
    deathTimers = [];
    for (const shootable of shootables.values()) shootable.handle?.remove();
    shootables = new Map();
  }

  function spawn(entities: QuakeEntity[], modelLibrary: QuakePickupModelLibrary | null): void {
    clear();
    for (const entity of entities) {
      if (!entity.origin || !shouldSpawn(entity)) continue;
      const modelPath = shootableModelPath(entity);
      if (!modelPath) continue;
      const model = modelLibrary?.models[modelPath];
      if (!model) continue;
      const handle = addShootableMesh(entity, model);
      shootables.set(entity.index, {
        entity,
        origin: pointToPoly(entity.origin),
        model,
        handle,
        dead: false,
      });
    }
  }

  function has(entityIndex: number): boolean {
    return shootables.has(entityIndex);
  }

  function destroy(entityIndex: number): boolean {
    const shootable = shootables.get(entityIndex);
    if (!shootable || shootable.dead) return false;
    shootable.dead = true;
    if (shootable.handle) {
      shootable.handle.element.dataset.quakeShootableDead = "true";
    }
    const timer = window.setTimeout(() => {
      shootable.handle?.remove();
      shootable.handle = null;
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
      yield {
        entity: shootable.entity,
        dead: shootable.dead,
        bounds: shootableBounds(shootable),
      };
    }
  }

  function addShootableMesh(entity: QuakeEntity, model: QuakePickupModel): PolyMeshHandle | null {
    if (!entity.origin) return null;
    const polygons = quakePickupModelPolygons(entity, model);
    if (!polygons.length) return null;
    const handle = scene.add(makeParseResult(polygons), {
      id: `quake-shootable-${entity.index}`,
      merge: false,
      meshResolution: "lossless",
      excludeFromAutoCenter: true,
    });
    handle.setTransform({
      position: pointToPoly(entity.origin),
      rotation: [0, 0, entity.angle ?? quakeEntityNumber(entity, "angle", 0)],
      scale: 1,
    });
    pixelate(handle);
    schedulePresentationResync(handle);
    return handle;
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
        shootable.origin[0] + shootable.model.bounds.min[0],
        shootable.origin[1] + shootable.model.bounds.min[1],
        shootable.origin[2] + shootable.model.bounds.min[2],
      ],
      max: [
        shootable.origin[0] + shootable.model.bounds.max[0],
        shootable.origin[1] + shootable.model.bounds.max[1],
        shootable.origin[2] + shootable.model.bounds.max[2],
      ],
    };
  }

  return {
    clear,
    spawn,
    has,
    destroy,
    resolvePlayerCollision,
    weaponTargets,
  };
}

function shootableModelPath(entity: QuakeEntity): string | null {
  if (entity.classname === "misc_explobox") return "maps/b_explob.bsp";
  if (entity.classname === "misc_explobox2") return "maps/b_exbox2.bsp";
  return null;
}

function makeParseResult(polygons: Polygon[]): ParseResult {
  return { polygons, objectUrls: [], warnings: [], dispose: () => undefined };
}
