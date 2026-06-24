import type * as Party from "partykit/server";

export const CSSQUAKE_PRESENCE_ROOM_ID = "global";
export const CSSQUAKE_PRESENCE_STALE_ROOM_MS = 90_000;
export const CSSQUAKE_PRESENCE_HISTORY_BUCKET_MS = 60_000;
export const CSSQUAKE_PRESENCE_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;
const CSSQUAKE_PRESENCE_STORAGE_KEY = "cssquake-presence-rooms";
const CSSQUAKE_PRESENCE_CLEANUP_INTERVAL_MS = 30_000;
const CSSQUAKE_PRESENCE_MAX_ROOMS = 2_000;
const CSSQUAKE_PRESENCE_MAX_COUNT = 10_000;
const CSSQUAKE_PRESENCE_HISTORY_MAX_BUCKETS = Math.ceil(
  CSSQUAKE_PRESENCE_HISTORY_RETENTION_MS / CSSQUAKE_PRESENCE_HISTORY_BUCKET_MS,
);

export interface CssQuakePresenceRoomUpdate {
  type: "cssquake.room-presence";
  roomId: string;
  mapName: string | null;
  gameplayFactsHash: string | null;
  activePlayers: number;
  roomPlayers: number;
  spectators: number;
  connections: number;
}

export interface CssQuakePresenceRoomEntry extends CssQuakePresenceRoomUpdate {
  lastSeenAt: number;
}

export interface CssQuakePresenceTotals {
  rooms: number;
  activePlayers: number;
  roomPlayers: number;
  spectators: number;
  connections: number;
}

export interface CssQuakePresenceHistoryBucket {
  startedAt: number;
  endedAt: number;
  lastSeenAt: number;
  samples: number;
  peaks: CssQuakePresenceTotals;
  latest: CssQuakePresenceTotals;
}

export interface CssQuakePresenceHistorySnapshot {
  bucketMs: number;
  retentionMs: number;
  peaks: CssQuakePresenceTotals;
  buckets: CssQuakePresenceHistoryBucket[];
}

interface CssQuakePresenceStorage {
  rooms: Record<string, CssQuakePresenceRoomEntry>;
  history: CssQuakePresenceHistoryBucket[];
}

export default class CssQuakePresenceRoom implements Party.Server {
  constructor(readonly room: Party.Room) {}

  async onStart(): Promise<void> {
    await this.scheduleCleanup();
  }

  async onRequest(request: Party.Request): Promise<Response> {
    if (request.method === "OPTIONS") return emptyResponse({ status: 204 });
    if (request.method === "POST") return this.handleUpdate(request);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonResponse({ error: "method-not-allowed" }, { status: 405 });
    }

    const snapshot = await this.snapshot();
    return jsonResponse(snapshot);
  }

  async onAlarm(): Promise<void> {
    const storage = await this.readStorage();
    const now = Date.now();
    const pruned = pruneStaleRooms(storage.rooms, now);
    let storageChanged = pruned;
    if (Object.keys(storage.rooms).length > 0 || pruned) {
      recordPresenceHistory(storage, now, presenceTotalsForRooms(Object.values(storage.rooms)));
      storageChanged = true;
    } else {
      storageChanged = prunePresenceHistory(storage.history, now) || storageChanged;
    }
    if (storageChanged) await this.writeStorage(storage);
    await this.scheduleCleanup();
  }

  private async handleUpdate(request: Party.Request): Promise<Response> {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonResponse({ error: "invalid-json" }, { status: 400 });
    }

    const update = normalizePresenceUpdate(raw);
    if (!update) return jsonResponse({ error: "invalid-presence-update" }, { status: 400 });

    const now = Date.now();
    const storage = await this.readStorage();
    pruneStaleRooms(storage.rooms, now);
    if (
      update.activePlayers <= 0 &&
      update.roomPlayers <= 0 &&
      update.spectators <= 0 &&
      update.connections <= 0
    ) {
      delete storage.rooms[update.roomId];
    } else {
      storage.rooms[update.roomId] = {
        ...update,
        lastSeenAt: now,
      };
      trimPresenceRooms(storage.rooms);
    }
    recordPresenceHistory(storage, now, presenceTotalsForRooms(Object.values(storage.rooms)));

    await this.writeStorage(storage);
    await this.scheduleCleanup();
    return jsonResponse(await this.snapshot(storage, now));
  }

  private async snapshot(storage?: CssQuakePresenceStorage, snapshotAt = Date.now()): Promise<{
    generatedAt: number;
    staleRoomMs: number;
    totals: CssQuakePresenceTotals;
    rooms: CssQuakePresenceRoomEntry[];
    history: CssQuakePresenceHistorySnapshot;
  }> {
    const activeStorage = storage ?? await this.readStorage();
    const pruned = pruneStaleRooms(activeStorage.rooms, snapshotAt);
    const historyPruned = prunePresenceHistory(activeStorage.history, snapshotAt);
    if (pruned || historyPruned) await this.writeStorage(activeStorage);
    const rooms = Object.values(activeStorage.rooms).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    const totals = presenceTotalsForRooms(rooms);
    return {
      generatedAt: snapshotAt,
      staleRoomMs: CSSQUAKE_PRESENCE_STALE_ROOM_MS,
      totals,
      rooms,
      history: presenceHistorySnapshot(activeStorage.history),
    };
  }

  private async readStorage(): Promise<CssQuakePresenceStorage> {
    const stored = await this.room.storage.get<CssQuakePresenceStorage>(CSSQUAKE_PRESENCE_STORAGE_KEY);
    if (!isRecord(stored) || !isRecord(stored.rooms)) return { rooms: {}, history: [] };
    return {
      rooms: Object.fromEntries(
        Object.entries(stored.rooms).filter(([, entry]) => isPresenceRoomEntry(entry)),
      ),
      history: Array.isArray(stored.history)
        ? stored.history.filter((bucket) => isPresenceHistoryBucket(bucket)).sort((a, b) => a.startedAt - b.startedAt)
        : [],
    };
  }

  private async writeStorage(storage: CssQuakePresenceStorage): Promise<void> {
    await this.room.storage.put(CSSQUAKE_PRESENCE_STORAGE_KEY, storage);
  }

  private async scheduleCleanup(): Promise<void> {
    await this.room.storage.setAlarm(Date.now() + CSSQUAKE_PRESENCE_CLEANUP_INTERVAL_MS);
  }
}

export function createCssQuakePresenceUpdatePayload(options: {
  roomId: string;
  mapName: string | null;
  gameplayFactsHash: string | null;
  activePlayers: number;
  roomPlayers: number;
  spectators: number;
  connections: number;
}): CssQuakePresenceRoomUpdate {
  return {
    type: "cssquake.room-presence",
    roomId: sanitizePresenceText(options.roomId, 128) ?? "unknown-room",
    mapName: sanitizePresenceText(options.mapName, 32),
    gameplayFactsHash: sanitizePresenceText(options.gameplayFactsHash, 96),
    activePlayers: clampPresenceCount(options.activePlayers),
    roomPlayers: clampPresenceCount(options.roomPlayers),
    spectators: clampPresenceCount(options.spectators),
    connections: clampPresenceCount(options.connections),
  };
}

function normalizePresenceUpdate(value: unknown): CssQuakePresenceRoomUpdate | null {
  if (!isRecord(value) || value.type !== "cssquake.room-presence") return null;
  const roomId = sanitizePresenceText(value.roomId, 128);
  if (!roomId) return null;
  return createCssQuakePresenceUpdatePayload({
    roomId,
    mapName: sanitizePresenceText(value.mapName, 32),
    gameplayFactsHash: sanitizePresenceText(value.gameplayFactsHash, 96),
    activePlayers: numberValue(value.activePlayers),
    roomPlayers: numberValue(value.roomPlayers),
    spectators: numberValue(value.spectators),
    connections: numberValue(value.connections),
  });
}

function isPresenceRoomEntry(value: unknown): value is CssQuakePresenceRoomEntry {
  return isRecord(value) &&
    normalizePresenceUpdate(value) !== null &&
    Number.isFinite(value.lastSeenAt);
}

function isPresenceHistoryBucket(value: unknown): value is CssQuakePresenceHistoryBucket {
  return isRecord(value) &&
    Number.isFinite(value.startedAt) &&
    Number.isFinite(value.endedAt) &&
    Number.isFinite(value.lastSeenAt) &&
    Number.isFinite(value.samples) &&
    isPresenceTotals(value.peaks) &&
    isPresenceTotals(value.latest);
}

function isPresenceTotals(value: unknown): value is CssQuakePresenceTotals {
  return isRecord(value) &&
    Number.isFinite(value.rooms) &&
    Number.isFinite(value.activePlayers) &&
    Number.isFinite(value.roomPlayers) &&
    Number.isFinite(value.spectators) &&
    Number.isFinite(value.connections);
}

function pruneStaleRooms(rooms: Record<string, CssQuakePresenceRoomEntry>, now: number): boolean {
  let pruned = false;
  for (const [roomId, entry] of Object.entries(rooms)) {
    if (now - entry.lastSeenAt <= CSSQUAKE_PRESENCE_STALE_ROOM_MS) continue;
    delete rooms[roomId];
    pruned = true;
  }
  return pruned;
}

function trimPresenceRooms(rooms: Record<string, CssQuakePresenceRoomEntry>): void {
  const entries = Object.entries(rooms);
  if (entries.length <= CSSQUAKE_PRESENCE_MAX_ROOMS) return;
  entries
    .sort(([, a], [, b]) => b.lastSeenAt - a.lastSeenAt)
    .slice(CSSQUAKE_PRESENCE_MAX_ROOMS)
    .forEach(([roomId]) => {
      delete rooms[roomId];
  });
}

function recordPresenceHistory(storage: CssQuakePresenceStorage, now: number, totals: CssQuakePresenceTotals): void {
  const startedAt = presenceHistoryBucketStart(now);
  const latest = clonePresenceTotals(totals);
  const existing = storage.history.find((bucket) => bucket.startedAt === startedAt);
  if (existing) {
    existing.lastSeenAt = now;
    existing.samples += 1;
    existing.latest = latest;
    existing.peaks = maxPresenceTotals(existing.peaks, totals);
  } else {
    storage.history.push({
      startedAt,
      endedAt: startedAt + CSSQUAKE_PRESENCE_HISTORY_BUCKET_MS,
      lastSeenAt: now,
      samples: 1,
      peaks: clonePresenceTotals(totals),
      latest,
    });
  }
  prunePresenceHistory(storage.history, now);
}

function presenceHistorySnapshot(history: CssQuakePresenceHistoryBucket[]): CssQuakePresenceHistorySnapshot {
  const buckets = history
    .slice()
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(clonePresenceHistoryBucket);
  return {
    bucketMs: CSSQUAKE_PRESENCE_HISTORY_BUCKET_MS,
    retentionMs: CSSQUAKE_PRESENCE_HISTORY_RETENTION_MS,
    peaks: buckets.reduce<CssQuakePresenceTotals>(
      (peaks, bucket) => maxPresenceTotals(peaks, bucket.peaks),
      emptyPresenceTotals(),
    ),
    buckets,
  };
}

function prunePresenceHistory(history: CssQuakePresenceHistoryBucket[], now: number): boolean {
  let pruned = false;
  const oldestStartedAt = presenceHistoryBucketStart(now - CSSQUAKE_PRESENCE_HISTORY_RETENTION_MS);
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].startedAt >= oldestStartedAt) continue;
    history.splice(index, 1);
    pruned = true;
  }
  history.sort((a, b) => a.startedAt - b.startedAt);
  if (history.length > CSSQUAKE_PRESENCE_HISTORY_MAX_BUCKETS) {
    history.splice(0, history.length - CSSQUAKE_PRESENCE_HISTORY_MAX_BUCKETS);
    pruned = true;
  }
  return pruned;
}

function presenceHistoryBucketStart(now: number): number {
  return Math.floor(now / CSSQUAKE_PRESENCE_HISTORY_BUCKET_MS) * CSSQUAKE_PRESENCE_HISTORY_BUCKET_MS;
}

function presenceTotalsForRooms(rooms: CssQuakePresenceRoomEntry[]): CssQuakePresenceTotals {
  return rooms.reduce<CssQuakePresenceTotals>((sum, entry) => ({
    rooms: sum.rooms + 1,
    activePlayers: sum.activePlayers + entry.activePlayers,
    roomPlayers: sum.roomPlayers + entry.roomPlayers,
    spectators: sum.spectators + entry.spectators,
    connections: sum.connections + entry.connections,
  }), emptyPresenceTotals());
}

function emptyPresenceTotals(): CssQuakePresenceTotals {
  return {
    rooms: 0,
    activePlayers: 0,
    roomPlayers: 0,
    spectators: 0,
    connections: 0,
  };
}

function maxPresenceTotals(left: CssQuakePresenceTotals, right: CssQuakePresenceTotals): CssQuakePresenceTotals {
  return {
    rooms: Math.max(left.rooms, right.rooms),
    activePlayers: Math.max(left.activePlayers, right.activePlayers),
    roomPlayers: Math.max(left.roomPlayers, right.roomPlayers),
    spectators: Math.max(left.spectators, right.spectators),
    connections: Math.max(left.connections, right.connections),
  };
}

function clonePresenceHistoryBucket(bucket: CssQuakePresenceHistoryBucket): CssQuakePresenceHistoryBucket {
  return {
    startedAt: bucket.startedAt,
    endedAt: bucket.endedAt,
    lastSeenAt: bucket.lastSeenAt,
    samples: bucket.samples,
    peaks: clonePresenceTotals(bucket.peaks),
    latest: clonePresenceTotals(bucket.latest),
  };
}

function clonePresenceTotals(totals: CssQuakePresenceTotals): CssQuakePresenceTotals {
  return {
    rooms: totals.rooms,
    activePlayers: totals.activePlayers,
    roomPlayers: totals.roomPlayers,
    spectators: totals.spectators,
    connections: totals.connections,
  };
}

function sanitizePresenceText(value: unknown, maxLength: number): string | null {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text ? text.slice(0, maxLength) : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clampPresenceCount(value: number): number {
  return Math.max(0, Math.min(CSSQUAKE_PRESENCE_MAX_COUNT, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,HEAD,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  return Response.json(value, { ...init, headers });
}

function emptyResponse(init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,HEAD,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  return new Response(null, { ...init, headers });
}
