import type {
  QuakeMultiplayerClientEnvelope,
  QuakeMultiplayerRoomCompatibilityKey,
  QuakeMultiplayerRoomEnvelope,
} from "./protocol";

export type QuakeMultiplayerSessionMode = "disabled" | "loopback" | "network";

export type QuakeMultiplayerSessionState =
  | "disabled"
  | "connecting"
  | "connected"
  | "rejected"
  | "closed"
  | "error";

export interface QuakeMultiplayerSessionStatus {
  state: QuakeMultiplayerSessionState;
  mode: QuakeMultiplayerSessionMode;
  connectedAt?: number;
  disconnectedAt?: number;
  reason?: string;
  roomKey?: QuakeMultiplayerRoomCompatibilityKey;
}

export interface QuakeMultiplayerSessionConnectOptions {
  roomKey: QuakeMultiplayerRoomCompatibilityKey;
  clientId: string;
  displayName: string;
  color?: string;
}

export type QuakeMultiplayerRoomMessageListener = (message: QuakeMultiplayerRoomEnvelope) => void;

export interface QuakeMultiplayerSessionAdapter {
  readonly mode: QuakeMultiplayerSessionMode;
  status(): QuakeMultiplayerSessionStatus;
  connect(options: QuakeMultiplayerSessionConnectOptions): Promise<QuakeMultiplayerSessionStatus>;
  disconnect(reason?: string): void;
  send(message: QuakeMultiplayerClientEnvelope): void;
  subscribe(listener: QuakeMultiplayerRoomMessageListener): () => void;
}

export function createQuakeNoopMultiplayerSession(): QuakeMultiplayerSessionAdapter {
  const status: QuakeMultiplayerSessionStatus = {
    state: "disabled",
    mode: "disabled",
  };
  return {
    mode: "disabled",
    status: () => status,
    connect: async () => status,
    disconnect: () => undefined,
    send: () => undefined,
    subscribe: () => () => undefined,
  };
}
