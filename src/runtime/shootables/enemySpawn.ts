import type { Vec3 } from "@layoutit/polycss";

import type { QuakeMonsterSpawnProfile } from "../../generated/quakeMonsterLogic";
import type { QuakeGameLogicFacts } from "../../prepare/gameLogicFacts";
import type { QuakeEntity, QuakePreparedModel, QuakeVertex } from "../../types/quake";
import { GROUND_SNAP, QUAKE_COLLISION_UNIT_SCALE, STEP_HEIGHT } from "../constants";
import { markQuakeTrace } from "../debug/traceMarks";
import { quakeTriggerMonsterJumpRule } from "../triggerEffects";
import { quakeBrushModelBounds, quakeMonsterSpawnProfileForEntity } from "./bounds";
import type { QuakeMonsterJumpTrigger, QuakeMonsterPathCorner } from "./state";

const QUAKE_MONSTER_DROP_TO_FLOOR_DISTANCE = 256 * QUAKE_COLLISION_UNIT_SCALE;

export function buildQuakeMonsterPathCornerIndex(
  entities: QuakeEntity[],
  pointToPoly: (point: { x: number; y: number; z: number }) => Vec3,
): Map<string, QuakeMonsterPathCorner> {
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

export function quakeInitialMonsterMovetarget(
  entity: QuakeEntity,
  pathCornersByTargetname: ReadonlyMap<string, QuakeMonsterPathCorner>,
): QuakeMonsterPathCorner | null {
  const target = entity.properties.target;
  return target ? pathCornersByTargetname.get(target) ?? null : null;
}

export function createQuakeMonsterJumpTriggers(
  entities: QuakeEntity[],
  models: QuakePreparedModel[],
  pivot: QuakeVertex,
  gameLogic: QuakeGameLogicFacts | null = null,
): QuakeMonsterJumpTrigger[] {
  const modelsByIndex = new Map(models.map((model) => [model.index, model]));
  const triggers: QuakeMonsterJumpTrigger[] = [];
  for (const entity of entities) {
    if (entity.classname !== "trigger_monsterjump" || entity.modelIndex === undefined) continue;
    const model = modelsByIndex.get(entity.modelIndex);
    const rule = quakeTriggerMonsterJumpRule(entity, gameLogic);
    if (!model || !rule) continue;
    triggers.push({
      bounds: quakeBrushModelBounds(model, pivot),
      entityIndex: entity.index,
      rule,
    });
  }
  return triggers;
}

export function groundedQuakeMonsterOrigin(options: {
  bounds: { min: Vec3; max: Vec3 };
  entity: QuakeEntity;
  floorAt(x: number, y: number, maxZ: number, minZ: number): number | null;
  mode: "move" | "spawn";
  origin: Vec3;
  spawnProfile?: QuakeMonsterSpawnProfile | null;
}): Vec3 {
  const spawnProfile = options.spawnProfile ?? quakeMonsterSpawnProfileForEntity(options.entity);
  if (!options.entity.classname.startsWith("monster_")) return options.origin;
  if (spawnProfile && !spawnProfile.dropToFloor) return options.origin;
  const footZ = options.origin[2] + options.bounds.min[2];
  const lowerZ = options.mode === "spawn"
    ? footZ - QUAKE_MONSTER_DROP_TO_FLOOR_DISTANCE
    : footZ - STEP_HEIGHT - GROUND_SNAP;
  const floorZ = quakeMonsterDropFloorAt(
    options.origin,
    options.bounds,
    footZ + STEP_HEIGHT + GROUND_SNAP,
    lowerZ,
    options.floorAt,
  );
  if (floorZ === null) {
    if (options.mode === "spawn") {
      markQuakeTrace("enemy-drop-to-floor", {
        class: options.entity.classname,
        entity: options.entity.index,
        floor: "none",
        footZ,
        minZ: options.bounds.min[2],
        startKind: spawnProfile?.startKind ?? "fallback",
      });
    }
    return options.origin;
  }
  const grounded: Vec3 = [options.origin[0], options.origin[1], options.origin[2] + floorZ - footZ];
  if (options.mode === "spawn") {
    markQuakeTrace("enemy-drop-to-floor", {
      class: options.entity.classname,
      distance: options.origin[2] - grounded[2],
      entity: options.entity.index,
      floor: "exact",
      floorZ,
      minZ: options.bounds.min[2],
      startKind: spawnProfile?.startKind ?? "fallback",
    });
  }
  return grounded;
}

export function quakeMonsterDropFloorAt(
  origin: Vec3,
  bounds: { min: Vec3; max: Vec3 },
  maxZ: number,
  minZ: number,
  floorAt: (x: number, y: number, maxZ: number, minZ: number) => number | null,
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
