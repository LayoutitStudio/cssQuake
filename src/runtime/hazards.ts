import type { QuakeEntity } from "../prepare/prepared-scene";
import { quakeEntityNumber } from "./entities";

export type QuakeHazardKind = "trigger" | "slime" | "lava";

export interface QuakeHazardDamage {
  amount: number;
  kind: QuakeHazardKind;
}

const QUAKE_CONTENTS_WATER = -3;
const QUAKE_CONTENTS_SLIME = -4;
const QUAKE_CONTENTS_LAVA = -5;

export function quakeTriggerHurtDamage(entity: QuakeEntity): QuakeHazardDamage | null {
  if (entity.classname !== "trigger_hurt") return null;
  const amount = Math.max(0, quakeEntityNumber(entity, "dmg", 5));
  return amount > 0 ? { amount, kind: "trigger" } : null;
}

export function quakeContentsDamage(contents: number | null | undefined): QuakeHazardDamage | null {
  if (contents === QUAKE_CONTENTS_LAVA) return { amount: 10, kind: "lava" };
  if (contents === QUAKE_CONTENTS_SLIME) return { amount: 4, kind: "slime" };
  if (contents === QUAKE_CONTENTS_WATER) return null;
  return null;
}

