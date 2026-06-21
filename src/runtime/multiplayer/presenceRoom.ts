import type * as Party from "partykit/server";

export const CSSQUAKE_PRESENCE_ROOM_ID = "global";
export const CSSQUAKE_PRESENCE_STALE_ROOM_MS = 90_000;
const CSSQUAKE_PRESENCE_STORAGE_KEY = "cssquake-presence-rooms";
const CSSQUAKE_PRESENCE_CLEANUP_INTERVAL_MS = 30_000;
const CSSQUAKE_PRESENCE_MAX_ROOMS = 2_000;
const CSSQUAKE_PRESENCE_MAX_COUNT = 10_000;

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

interface CssQuakePresenceStorage {
  rooms: Record<string, CssQuakePresenceRoomEntry>;
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
    const pruned = pruneStaleRooms(storage.rooms, Date.now());
    if (pruned) await this.writeStorage(storage);
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

    const storage = await this.readStorage();
    pruneStaleRooms(storage.rooms, Date.now());
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
        lastSeenAt: Date.now(),
      };
      trimPresenceRooms(storage.rooms);
    }

    await this.writeStorage(storage);
    await this.scheduleCleanup();
    return jsonResponse(await this.snapshot(storage));
  }

  private async snapshot(storage?: CssQuakePresenceStorage): Promise<{
    generatedAt: number;
    staleRoomMs: number;
    totals: CssQuakePresenceTotals;
    rooms: CssQuakePresenceRoomEntry[];
  }> {
    const activeStorage = storage ?? await this.readStorage();
    const now = Date.now();
    const pruned = pruneStaleRooms(activeStorage.rooms, now);
    if (pruned) await this.writeStorage(activeStorage);
    const rooms = Object.values(activeStorage.rooms).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    const totals = rooms.reduce<CssQuakePresenceTotals>((sum, entry) => ({
      rooms: sum.rooms + 1,
      activePlayers: sum.activePlayers + entry.activePlayers,
      roomPlayers: sum.roomPlayers + entry.roomPlayers,
      spectators: sum.spectators + entry.spectators,
      connections: sum.connections + entry.connections,
    }), {
      rooms: 0,
      activePlayers: 0,
      roomPlayers: 0,
      spectators: 0,
      connections: 0,
    });
    return {
      generatedAt: now,
      staleRoomMs: CSSQUAKE_PRESENCE_STALE_ROOM_MS,
      totals,
      rooms,
    };
  }

  private async readStorage(): Promise<CssQuakePresenceStorage> {
    const stored = await this.room.storage.get<CssQuakePresenceStorage>(CSSQUAKE_PRESENCE_STORAGE_KEY);
    if (!stored || !isRecord(stored.rooms)) return { rooms: {} };
    return {
      rooms: Object.fromEntries(
        Object.entries(stored.rooms).filter(([, entry]) => isPresenceRoomEntry(entry)),
      ),
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
