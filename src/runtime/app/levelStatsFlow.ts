import type { QuakeIntermissionStats } from "./intermissionFlow";
import type { QuakeEntity } from "../../types/quake";
import { shouldSpawnQuakeEntityForCurrentGame } from "../entities";

export interface QuakeLevelStatsTotals {
  monsters: number;
  secrets: number;
}

export interface QuakeLevelStatsFlowOptions {
  now?: () => number;
}

export interface QuakeLevelStatsFlow {
  freeze(): QuakeIntermissionStats;
  markMonsterKilled(entityIndex: number): void;
  markSecret(entityIndex: number): void;
  reset(mapName: string, totals: QuakeLevelStatsTotals): void;
  snapshot(): QuakeIntermissionStats;
}

export function createQuakeLevelStatsFlow(
  options: QuakeLevelStatsFlowOptions = {},
): QuakeLevelStatsFlow {
  const now = options.now ?? (() => performance.now());
  let mapName = "";
  let startedAt = now();
  let totalSecrets = 0;
  let totalMonsters = 0;
  let frozen: QuakeIntermissionStats | null = null;
  const secretEntityIndexes = new Set<number>();
  const killedMonsterEntityIndexes = new Set<number>();

  function reset(nextMapName: string, totals: QuakeLevelStatsTotals): void {
    mapName = nextMapName;
    startedAt = now();
    totalSecrets = nonNegativeInteger(totals.secrets);
    totalMonsters = nonNegativeInteger(totals.monsters);
    frozen = null;
    secretEntityIndexes.clear();
    killedMonsterEntityIndexes.clear();
  }

  function markSecret(entityIndex: number): void {
    if (frozen) return;
    if (Number.isInteger(entityIndex)) secretEntityIndexes.add(entityIndex);
  }

  function markMonsterKilled(entityIndex: number): void {
    if (frozen) return;
    if (Number.isInteger(entityIndex)) killedMonsterEntityIndexes.add(entityIndex);
  }

  function snapshot(): QuakeIntermissionStats {
    return frozen ?? buildStats(now());
  }

  function freeze(): QuakeIntermissionStats {
    if (!frozen) frozen = buildStats(now());
    return frozen;
  }

  function buildStats(finishedAt: number): QuakeIntermissionStats {
    return {
      elapsedSeconds: Math.max(0, Math.floor((finishedAt - startedAt) / 1000)),
      mapName,
      monstersKilled: Math.min(killedMonsterEntityIndexes.size, totalMonsters),
      secretsFound: Math.min(secretEntityIndexes.size, totalSecrets),
      totalMonsters,
      totalSecrets,
    };
  }

  return {
    freeze,
    markMonsterKilled,
    markSecret,
    reset,
    snapshot,
  };
}

export function quakeLevelStatsTotalsForEntities(entities: readonly QuakeEntity[]): QuakeLevelStatsTotals {
  let monsters = 0;
  let secrets = 0;
  for (const entity of entities) {
    if (!shouldSpawnQuakeEntityForCurrentGame(entity)) continue;
    if (entity.classname.startsWith("monster_")) monsters++;
    if (entity.classname === "trigger_secret") secrets++;
  }
  return { monsters, secrets };
}

function nonNegativeInteger(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}
