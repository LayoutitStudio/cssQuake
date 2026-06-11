export const QUAKE_MULTIPLAYER_ROOM_SNAPSHOT_INTERVAL_MS = 100;

export interface QuakeMultiplayerRoomSnapshotCadenceState {
  lastSnapshotAt: number;
}

export interface QuakeMultiplayerRoomSnapshotCadenceOptions {
  connected: boolean;
  playerCount: number;
  intervalMs?: number;
}

export function shouldEmitQuakeMultiplayerRoomSnapshot(
  now: number,
  state: QuakeMultiplayerRoomSnapshotCadenceState,
  options: QuakeMultiplayerRoomSnapshotCadenceOptions,
): boolean {
  if (!options.connected || options.playerCount <= 0) return false;
  const intervalMs = Math.max(1, options.intervalMs ?? QUAKE_MULTIPLAYER_ROOM_SNAPSHOT_INTERVAL_MS);
  return now - state.lastSnapshotAt >= intervalMs;
}
