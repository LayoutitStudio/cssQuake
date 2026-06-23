import type { QuakeEntity } from "../types/quake";
import {
  QUAKE_SINGLE_PLAYER_SKILL,
  QUAKE_SPAWNFLAG_NOT_DEATHMATCH,
  QUAKE_SPAWNFLAG_NOT_EASY,
  QUAKE_SPAWNFLAG_NOT_HARD,
  QUAKE_SPAWNFLAG_NOT_MEDIUM,
} from "./constants";

export function quakeEntityNumber(entity: QuakeEntity, key: string, fallback: number): number {
  const value = Number.parseFloat(entity.properties[key] ?? "");
  return Number.isFinite(value) ? value : fallback;
}

export function quakeEntitySpawnflags(entity: QuakeEntity): number {
  return Math.trunc(quakeEntityNumber(entity, "spawnflags", 0));
}

export interface QuakeEntitySpawnMode {
  deathmatch?: boolean;
  skill?: number;
}

export function shouldSpawnQuakeEntityForCurrentGame(entity: QuakeEntity): boolean {
  return shouldSpawnQuakeEntityForGameMode(entity, { skill: QUAKE_SINGLE_PLAYER_SKILL });
}

export function shouldSpawnQuakeEntityForGameMode(
  entity: QuakeEntity,
  mode: QuakeEntitySpawnMode = {},
): boolean {
  const spawnflags = quakeEntitySpawnflags(entity);
  if (mode.deathmatch === true) {
    return (spawnflags & QUAKE_SPAWNFLAG_NOT_DEATHMATCH) === 0;
  }
  const skill = typeof mode.skill === "number" && Number.isFinite(mode.skill)
    ? mode.skill
    : QUAKE_SINGLE_PLAYER_SKILL;
  if (skill <= 0 && (spawnflags & QUAKE_SPAWNFLAG_NOT_EASY)) return false;
  if (skill === 1 && (spawnflags & QUAKE_SPAWNFLAG_NOT_MEDIUM)) return false;
  if (skill >= 2 && (spawnflags & QUAKE_SPAWNFLAG_NOT_HARD)) return false;
  return true;
}
