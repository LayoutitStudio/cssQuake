import type { QuakeEntity } from "../prepare/scene";
import {
  QUAKE_SINGLE_PLAYER_SKILL,
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

export function shouldSpawnQuakeEntityForCurrentGame(entity: QuakeEntity): boolean {
  const spawnflags = quakeEntitySpawnflags(entity);
  if (QUAKE_SINGLE_PLAYER_SKILL <= 0 && (spawnflags & QUAKE_SPAWNFLAG_NOT_EASY)) return false;
  if (QUAKE_SINGLE_PLAYER_SKILL === 1 && (spawnflags & QUAKE_SPAWNFLAG_NOT_MEDIUM)) return false;
  if (QUAKE_SINGLE_PLAYER_SKILL >= 2 && (spawnflags & QUAKE_SPAWNFLAG_NOT_HARD)) return false;
  return true;
}

