import type { QuakeGameLogicFacts } from "../prepare/gameLogicFacts";
import type { QuakeEntity } from "../prepare/scene";
import { quakeTriggerHurtDamageAmount } from "./triggerEffects";

export type QuakeHazardKind = "trigger" | "slime" | "lava" | "fireball";

export interface QuakeHazardDamage {
  amount: number;
  kind: QuakeHazardKind;
}

const QUAKE_CONTENTS_WATER = -3;
const QUAKE_CONTENTS_SLIME = -4;
const QUAKE_CONTENTS_LAVA = -5;

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

export function quakeRadsuitProtectedContentsDamage(
  hazard: QuakeHazardDamage | null,
  radsuitActive: boolean,
): QuakeHazardDamage | null {
  if (radsuitActive && hazard?.kind === "slime") return null;
  return hazard;
}
