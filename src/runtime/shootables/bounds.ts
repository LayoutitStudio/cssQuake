import type { Polygon, Vec3 } from "@layoutit/polycss";

import {
  QUAKE_MONSTER_LOGIC,
  type QuakeMonsterSpawnProfile,
} from "../../generated/quakeMonsterLogic";
import type { QuakeEntity, QuakePreparedModel, QuakeVertex } from "../../types/quake";
import { COLLISION_EPSILON, QUAKE_COLLISION_UNIT_SCALE } from "../constants";
import { quakeEntityNumber } from "../entities";
import type { QuakePickupModel } from "../pickups";

const QUAKE_ZOMBIE_SPAWN_CRUCIFIED = 1;

export interface QuakeBounds {
  min: Vec3;
  max: Vec3;
}

export interface QuakeShootableBounds {
  min: Vec3;
  max: Vec3;
}

export function shootableLocalBounds(entity: QuakeEntity, model: QuakePickupModel | undefined): QuakeBounds {
  if (model) return model.bounds;
  if (entity.classname === "misc_explobox" || entity.classname === "misc_explobox2") {
    return { min: [-0.42, -0.42, 0], max: [0.42, 0.42, 0.72] };
  }
  return { min: [-0.34, -0.34, 0], max: [0.34, 0.34, 1.18] };
}

export function shootableCollisionBounds(
  entity: QuakeEntity,
  fallback: QuakeBounds,
  spawnProfile = quakeMonsterSpawnProfileForEntity(entity),
): QuakeBounds {
  if (!entity.classname.startsWith("monster_")) return fallback;
  return quakeMonsterScaledBounds(spawnProfile) ?? fallback;
}

export function quakeMonsterSpawnProfileForEntity(entity: QuakeEntity): QuakeMonsterSpawnProfile | undefined {
  const spawnProfile = quakeMonsterSpawnProfile(entity.classname);
  if (!spawnProfile || !isQuakeCrucifiedZombie(entity)) return spawnProfile;
  return {
    ...spawnProfile,
    dropToFloor: false,
  };
}

export function quakeMonsterStartKind(entity: QuakeEntity): QuakeMonsterSpawnProfile["startKind"] | "unknown" {
  return quakeMonsterSpawnProfileForEntity(entity)?.startKind ?? "unknown";
}

export function quakeMonsterUsesEnemyRuntime(entity: QuakeEntity): boolean {
  return entity.classname.startsWith("monster_") && !isQuakeCrucifiedZombie(entity);
}

export function quakeBrushModelBounds(model: QuakePreparedModel, pivot: QuakeVertex): QuakeBounds {
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

export function inflateBounds(bounds: QuakeBounds, amount: number): QuakeBounds {
  return {
    min: [bounds.min[0] - amount, bounds.min[1] - amount, bounds.min[2] - amount],
    max: [bounds.max[0] + amount, bounds.max[1] + amount, bounds.max[2] + amount],
  };
}

export function aabbsOverlap(a: QuakeBounds, b: QuakeBounds): boolean {
  return a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
    a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
    a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
}

export function aabbDistanceSq(a: QuakeBounds, b: QuakeBounds): number {
  const dx = a.max[0] < b.min[0] ? b.min[0] - a.max[0] : b.max[0] < a.min[0] ? a.min[0] - b.max[0] : 0;
  const dy = a.max[1] < b.min[1] ? b.min[1] - a.max[1] : b.max[1] < a.min[1] ? a.min[1] - b.max[1] : 0;
  const dz = a.max[2] < b.min[2] ? b.min[2] - a.max[2] : b.max[2] < a.min[2] ? a.min[2] - b.max[2] : 0;
  return dx * dx + dy * dy + dz * dz;
}

export function pointToAabbDistanceSq(point: Vec3, bounds: QuakeBounds): number {
  const dx = point[0] < bounds.min[0] ? bounds.min[0] - point[0] : point[0] > bounds.max[0] ? point[0] - bounds.max[0] : 0;
  const dy = point[1] < bounds.min[1] ? bounds.min[1] - point[1] : point[1] > bounds.max[1] ? point[1] - bounds.max[1] : 0;
  const dz = point[2] < bounds.min[2] ? bounds.min[2] - point[2] : point[2] > bounds.max[2] ? point[2] - bounds.max[2] : 0;
  return dx * dx + dy * dy + dz * dz;
}

export function segmentAabbIntersectionDistance(start: Vec3, end: Vec3, bounds: QuakeBounds): number | null {
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

function quakeMonsterSpawnProfile(classname: string): QuakeMonsterSpawnProfile | undefined {
  const logicByClassname = QUAKE_MONSTER_LOGIC as Readonly<Record<string, { spawnProfile?: QuakeMonsterSpawnProfile }>>;
  return logicByClassname[classname]?.spawnProfile;
}

function isQuakeCrucifiedZombie(entity: QuakeEntity): boolean {
  return entity.classname === "monster_zombie" &&
    (quakeEntityNumber(entity, "spawnflags", 0) & QUAKE_ZOMBIE_SPAWN_CRUCIFIED) !== 0;
}

function quakeMonsterScaledBounds(spawnProfile: QuakeMonsterSpawnProfile | undefined): QuakeBounds | null {
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
