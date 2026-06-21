import type {
  QuakeMultiplayerClientEnvelope,
  QuakeMultiplayerClientMessageType,
  QuakeMultiplayerRoomRejectPayload,
} from "./protocol";

export type QuakeMultiplayerClientIntentSequenceKey =
  | "input"
  | "pose"
  | "fire"
  | "damage"
  | "pickup"
  | "match"
  | "world";

export interface QuakeMultiplayerClientAuthorityState {
  clientId?: string;
  lastEnvelopeSequence?: number;
  lastIntentSequences?: Partial<Record<QuakeMultiplayerClientIntentSequenceKey, number>>;
  lastMessageAtByType?: Partial<Record<QuakeMultiplayerClientMessageType, number>>;
}

export interface QuakeMultiplayerClientAuthorityOptions {
  now: number;
  minMessageIntervalMs?: Partial<Record<QuakeMultiplayerClientMessageType, number>>;
}

export type QuakeMultiplayerClientAuthorityResult =
  | { ok: true; state: QuakeMultiplayerClientAuthorityState }
  | { ok: false; reject: QuakeMultiplayerRoomRejectPayload };

export const QUAKE_MULTIPLAYER_DEFAULT_CLIENT_MESSAGE_INTERVAL_MS = {
  "client.hello": 250,
  "client.presence": 0,
  "client.input": 10,
  "client.fire": 25,
  "client.damage": 100,
  "client.pickup": 150,
  "client.match": 250,
  "client.world": 0,
  "client.pose": 20,
  "client.ping": 250,
  "client.pong": 0,
} as const satisfies Partial<Record<QuakeMultiplayerClientMessageType, number>>;

export function validateQuakeMultiplayerClientAuthority(
  message: QuakeMultiplayerClientEnvelope,
  state: QuakeMultiplayerClientAuthorityState | null | undefined,
  options: QuakeMultiplayerClientAuthorityOptions,
): QuakeMultiplayerClientAuthorityResult {
  const current = state ?? {};
  const messageClientId = quakeMultiplayerClientIdForEnvelope(message);
  if (!current.clientId && message.type !== "client.hello") {
    return {
      ok: false,
      reject: {
        code: "not-authorized",
        message: "First multiplayer message on a connection must be client.hello.",
        recoverable: false,
        rejectedMessageId: message.messageId,
      },
    };
  }
  if (current.clientId && messageClientId !== undefined && messageClientId !== current.clientId) {
    return {
      ok: false,
      reject: {
        code: "not-authorized",
        message: "Multiplayer message client id does not match this connection.",
        recoverable: false,
        rejectedMessageId: message.messageId,
      },
    };
  }
  if (
    current.lastEnvelopeSequence !== undefined &&
    message.sequence <= current.lastEnvelopeSequence
  ) {
    return staleReject(message, "Multiplayer message sequence has already been handled.");
  }

  const intentSequence = quakeMultiplayerClientIntentSequence(message);
  if (intentSequence) {
    const lastIntentSequence = current.lastIntentSequences?.[intentSequence.key];
    if (lastIntentSequence !== undefined && intentSequence.sequence <= lastIntentSequence) {
      return staleReject(message, `Multiplayer ${intentSequence.key} sequence has already been handled.`);
    }
  }

  const minimumInterval = options.minMessageIntervalMs?.[message.type] ??
    QUAKE_MULTIPLAYER_DEFAULT_CLIENT_MESSAGE_INTERVAL_MS[message.type] ??
    0;
  const lastMessageAt = current.lastMessageAtByType?.[message.type];
  if (minimumInterval > 0 && lastMessageAt !== undefined) {
    const elapsed = options.now - lastMessageAt;
    if (elapsed < minimumInterval) {
      return staleReject(
        message,
        "Multiplayer message arrived before the accepted rate window elapsed.",
        Math.max(0, minimumInterval - elapsed),
      );
    }
  }

  return {
    ok: true,
    state: {
      ...current,
      clientId: current.clientId ?? messageClientId,
      lastEnvelopeSequence: message.sequence,
      lastIntentSequences: {
        ...(current.lastIntentSequences ?? {}),
        ...(intentSequence ? { [intentSequence.key]: intentSequence.sequence } : {}),
      },
      lastMessageAtByType: {
        ...(current.lastMessageAtByType ?? {}),
        [message.type]: options.now,
      },
    },
  };
}

export function quakeMultiplayerClientIdForEnvelope(
  message: QuakeMultiplayerClientEnvelope,
): string | undefined {
  switch (message.type) {
    case "client.hello":
    case "client.presence":
    case "client.input":
    case "client.fire":
    case "client.damage":
    case "client.pickup":
    case "client.match":
    case "client.world":
    case "client.pose":
      return message.payload.clientId;
    case "client.ping":
    case "client.pong":
      return undefined;
  }
}

function quakeMultiplayerClientIntentSequence(
  message: QuakeMultiplayerClientEnvelope,
): { key: QuakeMultiplayerClientIntentSequenceKey; sequence: number } | null {
  switch (message.type) {
    case "client.input":
      return { key: "input", sequence: message.payload.input.inputSequence };
    case "client.pose":
      return { key: "pose", sequence: message.payload.pose.poseSequence };
    case "client.fire":
      return { key: "fire", sequence: message.payload.fire.fireSequence };
    case "client.damage":
      return { key: "damage", sequence: message.payload.damage.damageSequence };
    case "client.pickup":
      return { key: "pickup", sequence: message.payload.pickup.pickupSequence };
    case "client.match":
      return { key: "match", sequence: message.payload.match.matchSequence };
    case "client.world":
      return message.payload.intent
        ? { key: "world", sequence: message.payload.intent.worldSequence }
        : null;
    default:
      return null;
  }
}

function staleReject(
  message: QuakeMultiplayerClientEnvelope,
  reason: string,
  retryAfterMs?: number,
): QuakeMultiplayerClientAuthorityResult {
  return {
    ok: false,
    reject: {
      code: "stale",
      message: reason,
      recoverable: true,
      rejectedMessageId: message.messageId,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    },
  };
}
