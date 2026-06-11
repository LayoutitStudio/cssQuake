import {
  QUAKE_SHOOTABLE_LOGIC,
  type QuakeShootableRadiusDamageFact,
} from "../../generated/quakeMonsterLogic";
import type { QuakeEntity } from "../../types/quake";
import { QUAKE_COLLISION_UNIT_SCALE } from "../constants";
import { quakeEntityNumber } from "../entities";
import { quakeMonsterSpawnProfileForEntity } from "./bounds";

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
