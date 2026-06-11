export const QUAKE_MULTIPLAYER_ROOM_HEARTBEAT_INTERVAL_MS = 2_000;
export const QUAKE_MULTIPLAYER_STALE_CLIENT_MS = 15_000;

export function quakeMultiplayerPingMsFromPong(now: number, echoedSentAt: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(echoedSentAt)) return 0;
  return Math.max(0, now - echoedSentAt);
}

export function shouldSendQuakeMultiplayerRoomPing(
  now: number,
  lastPingAt: number | undefined,
  intervalMs = QUAKE_MULTIPLAYER_ROOM_HEARTBEAT_INTERVAL_MS,
): boolean {
  if (!Number.isFinite(now)) return false;
  if (lastPingAt === undefined) return true;
  return now - lastPingAt >= Math.max(1, intervalMs);
}

export function isQuakeMultiplayerClientStale(
  now: number,
  lastSeenAt: number,
  staleMs = QUAKE_MULTIPLAYER_STALE_CLIENT_MS,
): boolean {
  if (!Number.isFinite(now) || !Number.isFinite(lastSeenAt)) return true;
  return now - lastSeenAt > Math.max(1, staleMs);
}
