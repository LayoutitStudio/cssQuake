import type { Vec3 } from "@layoutit/polycss";

export interface QuakeShootableProgressEntry {
  dead: boolean;
  entityIndex: number;
  health: number;
  origin: Vec3;
  yaw: number;
}

export interface QuakeShootablesProgressSnapshot {
  destroyedEntityIndexes?: number[];
  shootables: QuakeShootableProgressEntry[];
}

export function quakeShootableProgressEntries(
  snapshot: QuakeShootablesProgressSnapshot,
): Map<number, QuakeShootableProgressEntry> {
  const entries = new Map<number, QuakeShootableProgressEntry>();
  for (const entry of Array.isArray(snapshot.shootables) ? snapshot.shootables : []) {
    if (Number.isInteger(entry.entityIndex)) entries.set(entry.entityIndex, entry);
  }
  return entries;
}

export function quakeShootableDestroyedEntityIndexes(snapshot: QuakeShootablesProgressSnapshot): Set<number> {
  return new Set(
    Array.isArray(snapshot.destroyedEntityIndexes)
      ? snapshot.destroyedEntityIndexes.filter(Number.isInteger)
      : [],
  );
}

export function quakeShootableProgressVec3(value: Vec3, fallback: Vec3): Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? [value[0], value[1], value[2]]
    : [...fallback] as Vec3;
}
