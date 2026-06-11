import type { QuakeEntity } from "../types/quake";
import { QUAKE_DOOR_GOLD_KEY, QUAKE_DOOR_SILVER_KEY } from "./constants";
import { quakeEntitySpawnflags } from "./entities";
import type { QuakePlayerInventory } from "./hud";

export type QuakeDoorKey = "silver" | "gold";

export function quakeDoorKeyRequirement(entity: QuakeEntity): QuakeDoorKey | null {
  const spawnflags = quakeEntitySpawnflags(entity);
  if (spawnflags & QUAKE_DOOR_GOLD_KEY) return "gold";
  if (spawnflags & QUAKE_DOOR_SILVER_KEY) return "silver";
  return null;
}

export function quakeDoorGroupKeyRequirement(entities: QuakeEntity[]): QuakeDoorKey | null {
  for (const entity of entities) {
    const required = quakeDoorKeyRequirement(entity);
    if (required) return required;
  }
  return null;
}

export function quakePlayerHasDoorKey(inventory: QuakePlayerInventory, key: QuakeDoorKey | null): boolean {
  return !key || inventory.keys.has(key);
}

