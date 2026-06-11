import type {
  QuakeMultiplayerGameplayDefinitions,
  QuakeMultiplayerMapGameplayFacts,
  QuakeMultiplayerPickupDefinition,
  QuakeMultiplayerSpawnPoint,
} from "./protocol";

export const QUAKE_MULTIPLAYER_GAMEPLAY_FACTS_VERSION = 1 as const;

export interface QuakeMultiplayerGameplayFactsInput {
  deathmatchSpawns?: readonly QuakeMultiplayerSpawnPoint[];
  pickupDefinitions?: readonly QuakeMultiplayerPickupDefinition[];
}

export interface QuakeMultiplayerGameplayDefinitionsInput {
  deathmatchSpawns?: readonly QuakeMultiplayerSpawnPoint[];
  pickupDefinitions?: readonly QuakeMultiplayerPickupDefinition[];
}

export type QuakeMultiplayerGameplayFactsClaimCheck =
  | {
      ok: true;
      computed?: QuakeMultiplayerMapGameplayFacts;
    }
  | {
      ok: false;
      reason: string;
      computed?: QuakeMultiplayerMapGameplayFacts;
    };

export function createQuakeMultiplayerGameplayFacts(
  input: QuakeMultiplayerGameplayFactsInput,
): QuakeMultiplayerMapGameplayFacts {
  const deathmatchSpawns = [...(input.deathmatchSpawns ?? [])]
    .map(canonicalSpawn)
    .sort(compareStableJson);
  const pickupDefinitions = [...(input.pickupDefinitions ?? [])]
    .map(canonicalPickup)
    .sort(compareStableJson);
  const payload = stableJson({
    factsVersion: QUAKE_MULTIPLAYER_GAMEPLAY_FACTS_VERSION,
    deathmatchSpawns,
    pickupDefinitions,
  });
  return {
    factsVersion: QUAKE_MULTIPLAYER_GAMEPLAY_FACTS_VERSION,
    factsHash: fnv1a64(payload),
    deathmatchSpawnCount: deathmatchSpawns.length,
    pickupCount: pickupDefinitions.length,
  };
}

export function createQuakeMultiplayerGameplayDefinitions(
  input: QuakeMultiplayerGameplayDefinitionsInput,
): QuakeMultiplayerGameplayDefinitions {
  const deathmatchSpawns = [...(input.deathmatchSpawns ?? [])];
  const pickupDefinitions = [...(input.pickupDefinitions ?? [])];
  return {
    gameplayFacts: createQuakeMultiplayerGameplayFacts({
      deathmatchSpawns,
      pickupDefinitions,
    }),
    deathmatchSpawns,
    pickupDefinitions,
  };
}

export function checkQuakeMultiplayerGameplayFactsClaim(
  facts: QuakeMultiplayerMapGameplayFacts,
  input: QuakeMultiplayerGameplayFactsInput,
  options: { requireDefinitionsForNonEmptyFacts?: boolean } = {},
): QuakeMultiplayerGameplayFactsClaimCheck {
  const deathmatchSpawns = input.deathmatchSpawns ?? [];
  const pickupDefinitions = input.pickupDefinitions ?? [];
  const suppliedAnyDefinitions = deathmatchSpawns.length > 0 || pickupDefinitions.length > 0;
  if (
    options.requireDefinitionsForNonEmptyFacts &&
    !suppliedAnyDefinitions &&
    (facts.deathmatchSpawnCount > 0 || facts.pickupCount > 0)
  ) {
    return {
      ok: false,
      reason: "Multiplayer gameplay definitions are required for non-empty gameplay facts.",
    };
  }
  if (!suppliedAnyDefinitions) return { ok: true };
  const computed = createQuakeMultiplayerGameplayFacts({
    deathmatchSpawns,
    pickupDefinitions,
  });
  if (sameQuakeMultiplayerGameplayFacts(computed, facts)) {
    return { ok: true, computed };
  }
  return {
    ok: false,
    reason: "Multiplayer gameplay facts do not match the supplied gameplay definitions.",
    computed,
  };
}

export function sameQuakeMultiplayerGameplayFacts(
  a: QuakeMultiplayerMapGameplayFacts | null | undefined,
  b: QuakeMultiplayerMapGameplayFacts | null | undefined,
): boolean {
  return Boolean(
    a &&
      b &&
      a.factsVersion === b.factsVersion &&
      a.factsHash === b.factsHash &&
      a.deathmatchSpawnCount === b.deathmatchSpawnCount &&
      a.pickupCount === b.pickupCount,
  );
}

function canonicalSpawn(spawn: QuakeMultiplayerSpawnPoint): Record<string, unknown> {
  return {
    spawnId: spawn.spawnId,
    classname: spawn.classname,
    origin: canonicalVec3(spawn.origin),
    rotX: canonicalNumber(spawn.rotX),
    rotY: canonicalNumber(spawn.rotY),
    sourceEntityIndex: spawn.sourceEntityIndex ?? null,
  };
}

function canonicalPickup(pickup: QuakeMultiplayerPickupDefinition): Record<string, unknown> {
  return {
    pickupId: pickup.pickupId,
    entityIndex: pickup.entityIndex,
    classname: pickup.classname,
    origin: canonicalVec3(pickup.origin),
    effect: canonicalRecord(pickup.effect),
    lifecycle: pickup.lifecycle ? canonicalRecord(pickup.lifecycle) : null,
    feedback: pickup.feedback ? canonicalRecord(pickup.feedback) : null,
    targetEntityIndexes: pickup.targetEntityIndexes ? [...pickup.targetEntityIndexes] : null,
    killtargetEntityIndexes: pickup.killtargetEntityIndexes ? [...pickup.killtargetEntityIndexes] : null,
    delayMs: pickup.delayMs ?? null,
    message: pickup.message ?? null,
  };
}

function canonicalVec3(vec: readonly [number, number, number]): [number, number, number] {
  return [
    canonicalNumber(vec[0]),
    canonicalNumber(vec[1]),
    canonicalNumber(vec[2]),
  ];
}

function canonicalRecord(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (entry === undefined) continue;
    if (typeof entry === "number") {
      result[key] = canonicalNumber(entry);
    } else if (Array.isArray(entry)) {
      result[key] = entry.map(canonicalValue);
    } else if (entry && typeof entry === "object") {
      result[key] = canonicalRecord(entry as Record<string, unknown>);
    } else {
      result[key] = entry;
    }
  }
  return result;
}

function canonicalValue(value: unknown): unknown {
  if (typeof value === "number") return canonicalNumber(value);
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return canonicalRecord(value as Record<string, unknown>);
  return value;
}

function canonicalNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(6));
}

function compareStableJson(a: unknown, b: unknown): number {
  return stableJson(a).localeCompare(stableJson(b));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  ).join(",")}}`;
}

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}
