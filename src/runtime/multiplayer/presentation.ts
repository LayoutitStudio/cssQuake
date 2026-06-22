import {
  interpolateQuakeMultiplayerRemoteState,
} from "./interpolation";
import type {
  QuakeMultiplayerAuthoritativePlayerState,
  QuakeMultiplayerRemoteInterpolationSample,
  QuakeMultiplayerRemoteInterpolationState,
  QuakeMultiplayerRoomEnvelope,
  QuakeMultiplayerSharedWorldEvent,
} from "./protocol";

const QUAKE_MULTIPLAYER_REMOTE_RENDER_DELAY_MS = 100;
const QUAKE_MULTIPLAYER_REMOTE_STALE_MS = 1_000;
const QUAKE_MULTIPLAYER_REMOTE_SAMPLE_LIMIT = 12;

type QuakeMultiplayerPlayerDamagedEvent = Extract<
  QuakeMultiplayerSharedWorldEvent,
  { eventType: "player.damaged" }
>;

export interface QuakeMultiplayerRemoteVisualHandle {
  element?: HTMLElement;
  setState(state: QuakeMultiplayerRemoteInterpolationState): void;
  remove(): void;
}

export interface QuakeMultiplayerRemotePlayerPresenterOptions {
  localClientId: string;
  createVisual(player: QuakeMultiplayerAuthoritativePlayerState): QuakeMultiplayerRemoteVisualHandle | null;
  shouldRenderPlayer?: (player: QuakeMultiplayerAuthoritativePlayerState) => boolean;
  onPlayerDamaged?: (
    event: QuakeMultiplayerPlayerDamagedEvent,
    player: QuakeMultiplayerAuthoritativePlayerState,
  ) => void;
  now?: () => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  renderDelayMs?: number;
  staleAfterMs?: number;
}

interface QuakeMultiplayerRemotePlayerEntry {
  player: QuakeMultiplayerAuthoritativePlayerState;
  samples: QuakeMultiplayerRemoteInterpolationSample[];
  visual: QuakeMultiplayerRemoteVisualHandle | null;
  lastPainAt?: number;
  deathAt?: number;
}

export interface QuakeMultiplayerRemotePlayerPresenter {
  handleRoomMessage(message: QuakeMultiplayerRoomEnvelope): void;
  clear(): void;
  dispose(): void;
  count(): number;
}

export function createQuakeMultiplayerRemotePlayerPresenter(
  options: QuakeMultiplayerRemotePlayerPresenterOptions,
): QuakeMultiplayerRemotePlayerPresenter {
  const now = options.now ?? (() => performance.now());
  const requestFrame = options.requestFrame ?? ((callback) => window.requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle));
  const renderDelayMs = options.renderDelayMs ?? QUAKE_MULTIPLAYER_REMOTE_RENDER_DELAY_MS;
  const staleAfterMs = options.staleAfterMs ?? QUAKE_MULTIPLAYER_REMOTE_STALE_MS;
  const players = new Map<string, QuakeMultiplayerRemotePlayerEntry>();
  let frame = 0;
  let disposed = false;

  const presenter: QuakeMultiplayerRemotePlayerPresenter = {
    handleRoomMessage(message: QuakeMultiplayerRoomEnvelope): void {
      if (disposed) return;
      if (message.type === "room.snapshot") {
        syncSnapshot(message.payload.players);
      } else if (message.type === "room.event") {
        handleRoomEvent(message.payload.event);
      }
    },
    clear(): void {
      clearRemotePlayers();
    },
    dispose(): void {
      disposed = true;
      if (frame) {
        cancelFrame(frame);
        frame = 0;
      }
      clearRemotePlayers();
    },
    count(): number {
      return players.size;
    },
  };

  function syncSnapshot(snapshotPlayers: readonly QuakeMultiplayerAuthoritativePlayerState[]): void {
    const seen = new Set<string>();
    for (const player of snapshotPlayers) {
      if (player.clientId === options.localClientId) continue;
      if (options.shouldRenderPlayer && !options.shouldRenderPlayer(player)) {
        removeRemotePlayer(player.playerId);
        continue;
      }
      seen.add(player.playerId);
      syncRemotePlayer(player);
    }
    for (const playerId of [...players.keys()]) {
      if (!seen.has(playerId)) removeRemotePlayer(playerId);
    }
    scheduleFrame();
  }

  function syncRemotePlayer(player: QuakeMultiplayerAuthoritativePlayerState): void {
    let entry = players.get(player.playerId);
    const wasAlive = entry?.player.alive ?? player.alive;
    if (!entry) {
      entry = {
        player,
        samples: [],
        visual: options.createVisual(player),
      };
      players.set(player.playerId, entry);
    }
    entry.player = player;
    entry.samples.push({
      playerId: player.playerId,
      sampledAt: player.updatedAt,
      origin: player.origin,
      velocity: player.velocity,
      rotX: player.rotX,
      rotY: player.rotY,
      alive: player.alive,
    });
    if (player.alive) {
      if (!wasAlive || entry.deathAt !== undefined) {
        entry.lastPainAt = undefined;
        entry.deathAt = undefined;
      }
    } else if (wasAlive || entry.deathAt === undefined) {
      entry.lastPainAt = undefined;
      entry.deathAt = now();
    }
    entry.samples.sort((a, b) => a.sampledAt - b.sampledAt);
    while (entry.samples.length > QUAKE_MULTIPLAYER_REMOTE_SAMPLE_LIMIT) entry.samples.shift();
  }

  function handleRoomEvent(event: QuakeMultiplayerSharedWorldEvent): void {
    if (event.eventType === "player.left") {
      removeRemotePlayer(event.playerId);
    } else if (event.eventType === "player.damaged") {
      markRemotePlayerPain(event);
    } else if (event.eventType === "player.killed") {
      markRemotePlayerDeath(event.victimPlayerId);
    } else if (event.eventType === "player.respawned") {
      if (event.player.clientId === options.localClientId) return;
      syncRemotePlayer(event.player);
    }
  }

  function markRemotePlayerPain(event: QuakeMultiplayerPlayerDamagedEvent): void {
    const entry = players.get(event.victimPlayerId);
    if (!entry || entry.player.clientId === options.localClientId || !entry.player.alive) return;
    entry.lastPainAt = now();
    options.onPlayerDamaged?.(event, entry.player);
    scheduleFrame();
  }

  function markRemotePlayerDeath(playerId: string): void {
    const entry = players.get(playerId);
    if (!entry || entry.player.clientId === options.localClientId) return;
    entry.lastPainAt = undefined;
    entry.deathAt = now();
    entry.player = {
      ...entry.player,
      alive: false,
    };
    scheduleFrame();
  }

  function scheduleFrame(): void {
    if (disposed || frame || !players.size) return;
    frame = requestFrame(renderFrame);
  }

  function renderFrame(): void {
    frame = 0;
    if (disposed) return;
    const renderAt = now() - renderDelayMs;
    for (const [playerId, entry] of players) {
      if (!entry.visual) {
        entry.visual = options.createVisual(entry.player);
        if (!entry.visual) continue;
      }
      const state = interpolateQuakeMultiplayerRemoteState(playerId, entry.samples, renderAt, staleAfterMs);
      if (!state) continue;
      entry.visual.setState(quakeMultiplayerRemoteStateWithEvents(entry, state));
    }
    if (players.size) scheduleFrame();
  }

  function quakeMultiplayerRemoteStateWithEvents(
    entry: QuakeMultiplayerRemotePlayerEntry,
    state: QuakeMultiplayerRemoteInterpolationState,
  ): QuakeMultiplayerRemoteInterpolationState {
    if (entry.deathAt !== undefined) {
      return {
        ...state,
        alive: false,
        deathAt: entry.deathAt,
      };
    }
    if (entry.lastPainAt !== undefined) {
      return {
        ...state,
        lastPainAt: entry.lastPainAt,
      };
    }
    return state;
  }

  function removeRemotePlayer(playerId: string): void {
    const entry = players.get(playerId);
    if (!entry) return;
    entry.visual?.remove();
    players.delete(playerId);
    if (!players.size && frame) {
      cancelFrame(frame);
      frame = 0;
    }
  }

  function clearRemotePlayers(): void {
    for (const playerId of [...players.keys()]) removeRemotePlayer(playerId);
  }

  return presenter;
}
