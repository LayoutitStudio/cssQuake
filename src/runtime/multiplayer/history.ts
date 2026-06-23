import { QUAKE_COLLISION_UNIT_SCALE } from "../constants";
import type {
  QuakeMultiplayerAuthoritativePlayerState,
  QuakeMultiplayerVec3,
} from "./protocol";

export const QUAKE_MULTIPLAYER_SNAPSHOT_HISTORY_RETENTION_MS = 1_000;
export const QUAKE_MULTIPLAYER_SNAPSHOT_HISTORY_MAX_ENTRIES = 32;
export const QUAKE_MULTIPLAYER_SNAPSHOT_HISTORY_MAX_INTERPOLATION_GAP_MS = 300;
export const QUAKE_MULTIPLAYER_SNAPSHOT_HISTORY_TELEPORT_DISTANCE =
  128 * QUAKE_COLLISION_UNIT_SCALE;

export interface QuakeMultiplayerPlayerHistorySample {
  playerId: string;
  sampledAt: number;
  origin: QuakeMultiplayerVec3;
  velocity: QuakeMultiplayerVec3;
  rotX: number;
  rotY: number;
  alive: boolean;
  lastInputSequence: number;
  spawnId?: string;
  respawnAt?: number;
}

export interface QuakeMultiplayerSnapshotHistoryEntry {
  sampledAt: number;
  roomTime: number;
  tick: number;
  players: readonly QuakeMultiplayerPlayerHistorySample[];
}

export type QuakeMultiplayerSnapshotHistory = readonly QuakeMultiplayerSnapshotHistoryEntry[];

export interface QuakeMultiplayerSnapshotHistoryRecordOptions {
  maxEntries?: number;
  retentionMs?: number;
}

export interface QuakeMultiplayerHistoricalPlayerLookupOptions {
  maxDiscontinuityDistance?: number;
  maxInterpolationGapMs?: number;
}

export interface QuakeMultiplayerHistoricalCombatPlayersOptions
  extends QuakeMultiplayerHistoricalPlayerLookupOptions {
  attackerPlayerId: string;
  fallbackToCurrent?: boolean;
  targetTime: number;
}

export function recordQuakeMultiplayerSnapshotHistory(
  history: QuakeMultiplayerSnapshotHistory,
  input: {
    players: Iterable<QuakeMultiplayerAuthoritativePlayerState>;
    roomTime: number;
    sampledAt: number;
    tick: number;
  },
  options: QuakeMultiplayerSnapshotHistoryRecordOptions = {},
): QuakeMultiplayerSnapshotHistoryEntry[] {
  const retentionMs = normalizePositiveNumber(
    options.retentionMs,
    QUAKE_MULTIPLAYER_SNAPSHOT_HISTORY_RETENTION_MS,
  );
  const maxEntries = Math.max(
    1,
    Math.floor(normalizePositiveNumber(
      options.maxEntries,
      QUAKE_MULTIPLAYER_SNAPSHOT_HISTORY_MAX_ENTRIES,
    )),
  );
  const entry: QuakeMultiplayerSnapshotHistoryEntry = {
    sampledAt: input.sampledAt,
    roomTime: input.roomTime,
    tick: input.tick,
    players: [...input.players].map(quakeMultiplayerPlayerHistorySample),
  };
  const oldestAllowed = input.sampledAt - retentionMs;
  return [...history, entry]
    .filter((candidate) => candidate.sampledAt >= oldestAllowed)
    .slice(-maxEntries);
}

export function quakeMultiplayerHistoricalCombatPlayers(
  history: QuakeMultiplayerSnapshotHistory,
  currentPlayers: Iterable<QuakeMultiplayerAuthoritativePlayerState>,
  options: QuakeMultiplayerHistoricalCombatPlayersOptions,
): QuakeMultiplayerAuthoritativePlayerState[] {
  const fallbackToCurrent = options.fallbackToCurrent ?? true;
  const players = [...currentPlayers];
  return players.flatMap((player) => {
    if (player.playerId === options.attackerPlayerId) return [player];
    const historical = quakeMultiplayerHistoricalPlayerAt(
      history,
      player,
      options.targetTime,
      options,
    );
    if (historical) return [historical];
    return fallbackToCurrent ? [player] : [];
  });
}

export function quakeMultiplayerHistoricalPlayerAt(
  history: QuakeMultiplayerSnapshotHistory,
  currentPlayer: QuakeMultiplayerAuthoritativePlayerState,
  targetTime: number,
  options: QuakeMultiplayerHistoricalPlayerLookupOptions = {},
): QuakeMultiplayerAuthoritativePlayerState | null {
  if (!Number.isFinite(targetTime)) return null;
  const samples = samplesForPlayer(history, currentPlayer.playerId);
  if (!samples.length) return null;
  let previous: QuakeMultiplayerPlayerHistorySample | null = null;
  let next: QuakeMultiplayerPlayerHistorySample | null = null;
  for (const sample of samples) {
    if (sample.sampledAt <= targetTime) previous = sample;
    if (sample.sampledAt >= targetTime) {
      next = sample;
      break;
    }
  }
  if (!previous || !next) return null;
  if (!samplesCanInterpolate(previous, next, options)) return null;
  const span = next.sampledAt - previous.sampledAt;
  const t = span > 0 ? clamp01((targetTime - previous.sampledAt) / span) : 0;
  return {
    ...currentPlayer,
    origin: lerpVec3(previous.origin, next.origin, t),
    velocity: lerpVec3(previous.velocity, next.velocity, t),
    rotX: lerp(previous.rotX, next.rotX, t),
    rotY: lerp(previous.rotY, next.rotY, t),
    alive: previous.alive && next.alive,
    lastInputSequence: Math.max(previous.lastInputSequence, next.lastInputSequence),
    updatedAt: targetTime,
    ...(next.spawnId !== undefined ? { spawnId: next.spawnId } : {}),
    ...(next.respawnAt !== undefined ? { respawnAt: next.respawnAt } : {}),
  };
}

export function quakeMultiplayerPlayerHistorySample(
  player: QuakeMultiplayerAuthoritativePlayerState,
): QuakeMultiplayerPlayerHistorySample {
  return {
    playerId: player.playerId,
    sampledAt: player.updatedAt,
    origin: cloneVec3(player.origin),
    velocity: cloneVec3(player.velocity),
    rotX: player.rotX,
    rotY: player.rotY,
    alive: player.alive,
    lastInputSequence: player.lastInputSequence,
    ...(player.spawnId !== undefined ? { spawnId: player.spawnId } : {}),
    ...(player.respawnAt !== undefined ? { respawnAt: player.respawnAt } : {}),
  };
}

function samplesForPlayer(
  history: QuakeMultiplayerSnapshotHistory,
  playerId: string,
): QuakeMultiplayerPlayerHistorySample[] {
  const samples: QuakeMultiplayerPlayerHistorySample[] = [];
  for (const entry of history) {
    const sample = entry.players.find((player) => player.playerId === playerId);
    if (sample) samples.push({ ...sample, sampledAt: entry.sampledAt });
  }
  samples.sort((left, right) => left.sampledAt - right.sampledAt);
  return samples;
}

function samplesCanInterpolate(
  previous: QuakeMultiplayerPlayerHistorySample,
  next: QuakeMultiplayerPlayerHistorySample,
  options: QuakeMultiplayerHistoricalPlayerLookupOptions,
): boolean {
  if (!previous.alive || !next.alive) return false;
  if (previous.spawnId !== next.spawnId) return false;
  const maxGap = normalizePositiveNumber(
    options.maxInterpolationGapMs,
    QUAKE_MULTIPLAYER_SNAPSHOT_HISTORY_MAX_INTERPOLATION_GAP_MS,
  );
  if (next.sampledAt - previous.sampledAt > maxGap) return false;
  const maxDiscontinuityDistance = normalizePositiveNumber(
    options.maxDiscontinuityDistance,
    QUAKE_MULTIPLAYER_SNAPSHOT_HISTORY_TELEPORT_DISTANCE,
  );
  return distance3(previous.origin, next.origin) <= maxDiscontinuityDistance;
}

function cloneVec3(vector: QuakeMultiplayerVec3): QuakeMultiplayerVec3 {
  return [vector[0], vector[1], vector[2]];
}

function lerpVec3(a: QuakeMultiplayerVec3, b: QuakeMultiplayerVec3, t: number): QuakeMultiplayerVec3 {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function distance3(a: QuakeMultiplayerVec3, b: QuakeMultiplayerVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback;
}
