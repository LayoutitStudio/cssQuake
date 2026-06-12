import type { Vec3 } from "@layoutit/polycss";

import {
  QUAKE_SHOOTABLE_LOGIC,
  type QuakeShootableRadiusDamageFact,
} from "../../generated/quakeMonsterLogic";
import type { QuakeEntity } from "../../types/quake";
import { QUAKE_COLLISION_UNIT_SCALE } from "../constants";
import { quakeEntityNumber } from "../entities";
import { quakeMonsterSpawnProfileForEntity } from "./bounds";
import type { QuakeDamageActorReference, QuakeEnemyTargetReference } from "./state";

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

export interface QuakeCanDamageTraceOffset {
  label: string;
  offset: readonly [number, number, number];
}

export interface QuakeCanDamageTracePoint {
  label: string;
  offset: readonly [number, number, number];
  end: Vec3;
}

export interface QuakeCanDamageTraceResult extends QuakeCanDamageTracePoint {
  clear: boolean;
}

export interface QuakeCanDamageResult {
  result: boolean;
  traces: QuakeCanDamageTraceResult[];
}

export type QuakeDamageRetargetReason =
  | "attacker-is-current-enemy"
  | "attacker-is-self"
  | "attacker-not-targetable"
  | "not-monster"
  | "retarget"
  | "same-class"
  | "world";

export interface QuakeDamageRetargetDecision {
  preserveOldEnemy: boolean;
  reason: QuakeDamageRetargetReason;
  retarget: boolean;
  target: QuakeEnemyTargetReference | null;
}

export interface QuakeDamageRetargetInput {
  attacker: QuakeDamageActorReference;
  currentEnemy?: QuakeEnemyTargetReference | null;
  target: {
    classname: string;
    entityIndex: number;
    monster: boolean;
  };
}

export const QUAKE_CANDAMAGE_TRACE_OFFSETS: readonly QuakeCanDamageTraceOffset[] = Object.freeze([
  { label: "origin", offset: [0, 0, 0] },
  { label: "plus15-plus15", offset: [15, 15, 0] },
  { label: "minus15-minus15", offset: [-15, -15, 0] },
  { label: "minus15-plus15", offset: [-15, 15, 0] },
  { label: "plus15-minus15", offset: [15, -15, 0] },
]);

export function shootableHealth(entity: QuakeEntity): number {
  const spawnHealth = quakeMonsterSpawnProfileForEntity(entity)?.health;
  return Math.max(1, quakeEntityNumber(entity, "health", spawnHealth ?? QUAKE_SHOOTABLE_HEALTH[entity.classname] ?? 20));
}

export function quakeShootableDefaultHealth(classname: string): number | undefined {
  return QUAKE_SHOOTABLE_HEALTH[classname];
}

export function quakeShootableDeathRadiusDamage(classname: string): QuakeShootableRadiusDamageFact | undefined {
  const logicByClassname = QUAKE_SHOOTABLE_LOGIC as Readonly<Record<string, {
    death?: { radiusDamage?: QuakeShootableRadiusDamageFact };
  }>>;
  return logicByClassname[classname]?.death?.radiusDamage;
}

export function quakeRadiusDamageAmount(
  radiusDamage: QuakeShootableRadiusDamageFact,
  distanceSq: number,
  scale: number,
): number {
  const distanceUnits = Math.sqrt(distanceSq) / QUAKE_COLLISION_UNIT_SCALE;
  const damageAmount = (radiusDamage.damageUnits - distanceUnits * radiusDamage.distanceScale) * scale;
  return damageAmount > 0 ? damageAmount : 0;
}

export function quakecRandomDamage(
  base: number,
  randomTerms: readonly number[],
  nextRandom: () => number,
): number {
  return randomTerms.reduce((total, scale) => total + nextRandom() * scale, base);
}

export function quakeDamageRetargetDecision(
  input: QuakeDamageRetargetInput,
): QuakeDamageRetargetDecision {
  if (!input.target.monster) return quakeDamageNoRetarget("not-monster");
  if (input.attacker.kind === "world") return quakeDamageNoRetarget("world");
  const attackerTarget = quakeDamageAttackerTarget(input.attacker);
  if (!attackerTarget) return quakeDamageNoRetarget("attacker-not-targetable");
  if (attackerTarget.kind === "shootable" && attackerTarget.entityIndex === input.target.entityIndex) {
    return quakeDamageNoRetarget("attacker-is-self");
  }
  if (input.currentEnemy && quakeDamageTargetsMatch(attackerTarget, input.currentEnemy)) {
    return quakeDamageNoRetarget("attacker-is-current-enemy");
  }
  if (
    input.target.classname === input.attacker.classname &&
    input.target.classname !== "monster_army"
  ) {
    return quakeDamageNoRetarget("same-class");
  }
  return {
    preserveOldEnemy: input.currentEnemy?.kind === "player",
    reason: "retarget",
    retarget: true,
    target: attackerTarget,
  };
}

export function quakecCanDamageTracePointsForTargetOrigin(
  targetOrigin: { x: number; y: number; z: number },
  pointToPoly: (point: { x: number; y: number; z: number }) => Vec3,
): QuakeCanDamageTracePoint[] {
  return QUAKE_CANDAMAGE_TRACE_OFFSETS.map(({ label, offset }) => ({
    label,
    offset,
    end: pointToPoly({
      x: targetOrigin.x + offset[0],
      y: targetOrigin.y + offset[1],
      z: targetOrigin.z + offset[2],
    }),
  }));
}

export function quakecCanDamageTracePointsForRuntimeOrigin(targetOrigin: Vec3): QuakeCanDamageTracePoint[] {
  return QUAKE_CANDAMAGE_TRACE_OFFSETS.map(({ label, offset }) => ({
    label,
    offset,
    end: [
      targetOrigin[0] + offset[0] * QUAKE_COLLISION_UNIT_SCALE,
      targetOrigin[1] + offset[1] * QUAKE_COLLISION_UNIT_SCALE,
      targetOrigin[2] + offset[2] * QUAKE_COLLISION_UNIT_SCALE,
    ],
  }));
}

export function quakecCanDamageAnyTracePointClear(
  start: Vec3,
  tracePoints: readonly QuakeCanDamageTracePoint[],
  hasLineOfSight: (start: Vec3, end: Vec3) => boolean,
): boolean {
  for (const point of tracePoints) {
    if (hasLineOfSight(start, point.end)) return true;
  }
  return false;
}

export function quakecCanDamageFromTracePoints(
  start: Vec3,
  tracePoints: readonly QuakeCanDamageTracePoint[],
  hasLineOfSight: (start: Vec3, end: Vec3) => boolean,
): QuakeCanDamageResult {
  const traces = tracePoints.map((point) => ({
    ...point,
    clear: hasLineOfSight(start, point.end),
  }));
  return {
    result: traces.some((trace) => trace.clear),
    traces,
  };
}

function quakeDamageAttackerTarget(
  attacker: QuakeDamageActorReference,
): QuakeEnemyTargetReference | null {
  if (attacker.kind === "player") {
    return { classname: "player", id: "player", kind: "player" };
  }
  if (attacker.kind === "shootable") {
    return {
      classname: attacker.classname,
      entityIndex: attacker.entityIndex,
      id: attacker.entityIndex,
      kind: "shootable",
    };
  }
  return null;
}

function quakeDamageTargetsMatch(
  a: QuakeEnemyTargetReference,
  b: QuakeEnemyTargetReference,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "player") return true;
  return a.entityIndex === b.entityIndex;
}

function quakeDamageNoRetarget(reason: Exclude<QuakeDamageRetargetReason, "retarget">): QuakeDamageRetargetDecision {
  return {
    preserveOldEnemy: false,
    reason,
    retarget: false,
    target: null,
  };
}
