import type {
  PartySocket,
  PartySocketOptions,
} from "partysocket";

import type {
  QuakeMultiplayerClientEnvelope,
  QuakeMultiplayerRoomCompatibilityKey,
  QuakeMultiplayerRoomEnvelope,
} from "./protocol";
import type {
  QuakeMultiplayerRoomMessageListener,
  QuakeMultiplayerSessionAdapter,
  QuakeMultiplayerSessionConnectOptions,
  QuakeMultiplayerSessionStatus,
} from "./session";
import { validateQuakeMultiplayerRoomEnvelope } from "./validation";

export interface QuakePartySocketSessionOptions {
  host: string;
  roomId: string | ((options: QuakeMultiplayerSessionConnectOptions) => string);
  party?: string;
  now?: () => number;
  query?: PartySocketOptions["query"];
  maxMessageAgeMs?: number;
  maxFutureSkewMs?: number;
  maxRetries?: number;
}

export function normalizeQuakePartySocketHost(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  let url: URL;
  try {
    url = new URL(hasProtocol ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  const host = url.host.trim();
  if (!host || host.length > 253) return null;
  if (/[\s/\\?#@]/.test(host)) return null;
  return host;
}

export function createQuakePartySocketMultiplayerSession(
  options: QuakePartySocketSessionOptions,
): QuakeMultiplayerSessionAdapter {
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<QuakeMultiplayerRoomMessageListener>();
  let socket: PartySocket | null = null;
  let roomKey: QuakeMultiplayerRoomCompatibilityKey | null = null;
  let currentStatus: QuakeMultiplayerSessionStatus = {
    state: "closed",
    mode: "network",
  };

  const adapter: QuakeMultiplayerSessionAdapter = {
    mode: "network",
    status: () => currentStatus,
    async connect(connectOptions: QuakeMultiplayerSessionConnectOptions): Promise<QuakeMultiplayerSessionStatus> {
      adapter.disconnect("reconnect");
      roomKey = connectOptions.roomKey;
      const host = normalizeQuakePartySocketHost(options.host);
      if (!host) {
        currentStatus = {
          state: "error",
          mode: "network",
          reason: "PartySocket host is invalid.",
          roomKey,
        };
        return currentStatus;
      }
      currentStatus = {
        state: "connecting",
        mode: "network",
        roomKey,
      };
      const { default: PartySocketConstructor } = await import("partysocket");
      socket = new PartySocketConstructor({
        host,
        room: partySocketRoomId(options.roomId, connectOptions),
        id: connectOptions.clientId,
        party: options.party,
        query: options.query,
        maxRetries: options.maxRetries ?? 8,
      });
      return new Promise((resolve) => {
        const activeSocket = socket;
        if (!activeSocket) {
          currentStatus = {
            state: "error",
            mode: "network",
            reason: "PartySocket was not created.",
            roomKey: connectOptions.roomKey,
          };
          resolve(currentStatus);
          return;
        }
        const onOpen = (): void => {
          activeSocket.removeEventListener("open", onOpen);
          activeSocket.removeEventListener("error", onError);
          currentStatus = {
            state: "connected",
            mode: "network",
            connectedAt: now(),
            roomKey: connectOptions.roomKey,
          };
          resolve(currentStatus);
        };
        const onError = (): void => {
          activeSocket.removeEventListener("open", onOpen);
          activeSocket.removeEventListener("error", onError);
          currentStatus = {
            state: "error",
            mode: "network",
            reason: "PartySocket connection failed.",
            roomKey: connectOptions.roomKey,
          };
          resolve(currentStatus);
        };
        activeSocket.addEventListener("open", onOpen);
        activeSocket.addEventListener("error", onError);
        activeSocket.addEventListener("message", handleMessage);
        activeSocket.addEventListener("close", handleClose);
      });
    },
    disconnect(reason?: string): void {
      const previousRoomKey = roomKey;
      if (socket) {
        socket.removeEventListener("message", handleMessage);
        socket.removeEventListener("close", handleClose);
        socket.close(1000, reason);
        socket = null;
      }
      roomKey = null;
      currentStatus = {
        state: "closed",
        mode: "network",
        disconnectedAt: now(),
        ...(reason ? { reason } : {}),
        ...(previousRoomKey ? { roomKey: previousRoomKey } : {}),
      };
    },
    send(message: QuakeMultiplayerClientEnvelope): void {
      if (!socket) return;
      socket.send(JSON.stringify(message));
    },
    subscribe(listener: QuakeMultiplayerRoomMessageListener): (() => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  function handleMessage(event: MessageEvent): void {
    if (!roomKey) return;
    const raw = parsePartySocketMessage(event.data);
    const validation = validateQuakeMultiplayerRoomEnvelope(raw, {
      roomKey,
      now: now(),
      maxMessageAgeMs: options.maxMessageAgeMs ?? 60_000,
      maxFutureSkewMs: options.maxFutureSkewMs,
    });
    if (!validation.ok) return;
    for (const listener of listeners) listener(validation.envelope);
  }

  function handleClose(): void {
    const previousRoomKey = roomKey;
    socket = null;
    roomKey = null;
    currentStatus = {
      state: "closed",
      mode: "network",
      disconnectedAt: now(),
      ...(previousRoomKey ? { roomKey: previousRoomKey } : {}),
    };
  }

  return adapter;
}

function partySocketRoomId(
  roomId: QuakePartySocketSessionOptions["roomId"],
  options: QuakeMultiplayerSessionConnectOptions,
): string {
  return (typeof roomId === "function" ? roomId(options) : roomId).trim();
}

function parsePartySocketMessage(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
