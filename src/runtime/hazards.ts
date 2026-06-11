import type { Vec3 } from "@layoutit/polycss";

import type { QuakeGameLogicFacts } from "../prepare/gameLogicFacts";
import type { QuakeEntity } from "../types/quake";
import { PLAYER_HEIGHT, QUAKE_COLLISION_UNIT_SCALE } from "./constants";
import { quakeTriggerHurtDamageAmount } from "./triggerEffects";

export type QuakeHazardKind = "trigger" | "slime" | "lava" | "fireball";

export interface QuakeHazardDamage {
  amount: number;
  kind: QuakeHazardKind;
}

export const QUAKE_CONTENTS_WATER = -3;
export const QUAKE_CONTENTS_SLIME = -4;
export const QUAKE_CONTENTS_LAVA = -5;

export type QuakeContentsAt = (point: Vec3) => number | null | undefined;

export function quakeTriggerHurtDamage(
  entity: QuakeEntity,
  gameLogic?: QuakeGameLogicFacts | null,
): QuakeHazardDamage | null {
  const amount = quakeTriggerHurtDamageAmount(entity, gameLogic);
  return amount > 0 ? { amount, kind: "trigger" } : null;
}

export function quakeContentsDamage(contents: number | null | undefined): QuakeHazardDamage | null {
  if (contents === QUAKE_CONTENTS_LAVA) return { amount: 10, kind: "lava" };
  if (contents === QUAKE_CONTENTS_SLIME) return { amount: 4, kind: "slime" };
  if (contents === QUAKE_CONTENTS_WATER) return null;
  return null;
}

export function quakeContentsIsLiquid(contents: number | null | undefined): boolean {
  return (
    contents === QUAKE_CONTENTS_WATER ||
    contents === QUAKE_CONTENTS_SLIME ||
    contents === QUAKE_CONTENTS_LAVA
  );
}

export function quakePlayerWaterLevel(
  contentsAt: QuakeContentsAt | null | undefined,
  origin: Vec3,
  eyeHeight: number,
): number {
  if (!contentsAt) return 0;
  const footZ = origin[2] - Math.max(0, eyeHeight);
  const sampleZ = [
    footZ + QUAKE_COLLISION_UNIT_SCALE,
    footZ + PLAYER_HEIGHT * 0.5,
    footZ + PLAYER_HEIGHT,
  ];
  let waterLevel = 0;
  for (const z of sampleZ) {
    if (!quakeContentsIsLiquid(contentsAt([origin[0], origin[1], z]))) break;
    waterLevel += 1;
  }
  return waterLevel;
}

export function quakeRadsuitProtectedContentsDamage(
  hazard: QuakeHazardDamage | null,
  radsuitActive: boolean,
): QuakeHazardDamage | null {
  if (radsuitActive && hazard?.kind === "slime") return null;
  return hazard;
}
