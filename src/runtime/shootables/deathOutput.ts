import {
  QUAKE_MONSTER_LOGIC,
  type QuakeMonsterDeathBackpackDrop,
  type QuakeMonsterDeathGibOutput,
  type QuakeMonsterDeathReactionProfile,
} from "../../generated/quakeMonsterLogic";
import type { QuakePickupEffect } from "../pickups";
import type { QuakeShootableState } from "./state";

const quakeMonsterLogicByClassname = QUAKE_MONSTER_LOGIC as Readonly<Record<string, {
  deathOutput?: { gib?: QuakeMonsterDeathGibOutput };
  reactionProfile?: { death?: QuakeMonsterDeathReactionProfile };
}>>;

export function quakeMonsterDeathReactionPolicy(classname: string): QuakeMonsterDeathReactionProfile | undefined {
  return quakeMonsterLogicByClassname[classname]?.reactionProfile?.death;
}

export function shootableDeathGibOutput(shootable: QuakeShootableState): QuakeMonsterDeathGibOutput | undefined {
  const gib = quakeMonsterLogicByClassname[shootable.entity.classname]?.deathOutput?.gib;
  if (!gib) return undefined;
  if (shootable.entity.classname === "monster_zombie") {
    return shootable.enemy?.zombieGibbed ? gib : undefined;
  }
  return typeof gib.healthBelow === "number" && shootable.health < gib.healthBelow ? gib : undefined;
}

export function quakeMonsterBackpackAmmoEffect(drop: QuakeMonsterDeathBackpackDrop): QuakePickupEffect {
  const ammo: QuakePickupEffect = {};
  for (const field of ["shells", "nails", "rockets", "cells"] as const) {
    const amount = drop.ammo?.[field];
    if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
      ammo[field] = amount;
    }
  }
  return ammo;
}

export function quakeMonsterBackpackMessage(ammo: QuakePickupEffect): string {
  const entries = ([
    ["shells", "shell"],
    ["nails", "nail"],
    ["rockets", "rocket"],
    ["cells", "cell"],
  ] as const)
    .map(([field, singular]) => {
      const amount = ammo[field];
      if (typeof amount !== "number" || amount <= 0) return null;
      return `${amount} ${singular}${amount === 1 ? "" : "s"}`;
    })
    .filter((entry): entry is string => Boolean(entry));
  return entries.length ? `You get ${entries.join(", ")}` : "You get ammo";
}
