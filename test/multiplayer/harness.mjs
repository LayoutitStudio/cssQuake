import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { importTsModule } from "../importTsModule.mjs";

export const authority = await importTsModule("src/runtime/multiplayer/authority.ts");
export const loopback = await importTsModule("src/runtime/multiplayer/loopback.ts");
export const partyRoomModule = await importTsModule("src/runtime/multiplayer/partyRoom.ts");
export const presenceRoomModule = await importTsModule("src/runtime/multiplayer/presenceRoom.ts");
export const protocol = await importTsModule("src/runtime/multiplayer/protocol.ts");
export const reconciliation = await importTsModule("src/runtime/multiplayer/reconciliation.ts");
export const simulation = await importTsModule("src/runtime/multiplayer/simulation.ts");
export const validation = await importTsModule("src/runtime/multiplayer/validation.ts");

export const ROOM_KEY = {
  mapName: "E1M1",
  assetManifestVersion: 1,
  assetRoot: "/q",
  sceneUrl: "/q/e1m1.json",
  preparedSceneVersion: 2,
  gameLogicVersion: 3,
};

export const NORMALIZED_ROOM_KEY = {
  ...ROOM_KEY,
  mapName: "e1m1",
};

export function clientEnvelope(type, payload, options = {}) {
  return protocol.createQuakeMultiplayerEnvelope({
    direction: "client",
    type,
    roomKey: options.roomKey ?? NORMALIZED_ROOM_KEY,
    messageId: options.messageId,
    sequence: options.sequence ?? 0,
    sentAt: options.sentAt ?? 100,
    payload,
  });
}

export function helloEnvelope(options = {}) {
  const clientId = options.clientId ?? "client-a";
  return clientEnvelope("client.hello", {
    clientId,
    displayName: options.displayName ?? "Alice",
    ...(options.color ? { color: options.color } : {}),
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    ...(options.matchSettings ? { matchSettings: options.matchSettings } : {}),
    ...(options.deathmatchSpawns ? { deathmatchSpawns: options.deathmatchSpawns } : {}),
    ...(options.pickupDefinitions ? { pickupDefinitions: options.pickupDefinitions } : {}),
    ...(options.gameplayFacts ? { gameplayFacts: options.gameplayFacts } : {}),
  }, options);
}

export function presenceEnvelope(status, options = {}) {
  return clientEnvelope("client.presence", {
    clientId: options.clientId ?? "client-a",
    status,
  }, options);
}

export function inputEnvelope(options = {}) {
  const clientId = options.clientId ?? "client-a";
  return clientEnvelope("client.input", {
    clientId,
    input: createInput(options.inputSequence ?? 1, {
      sampledAt: options.sampledAt ?? options.sentAt ?? 100,
      ...(options.input ?? {}),
    }),
  }, options);
}

export function fireEnvelope(options = {}) {
  return clientEnvelope("client.fire", {
    clientId: options.clientId ?? "client-a",
    fire: {
      fireSequence: options.fireSequence ?? 1,
      firedAt: options.sentAt ?? 100,
      weapon: "shotgun",
      fireKind: "hitscan",
      origin: [0, 0, 0],
      direction: [1, 0, 0],
      range: 1024,
      ...(options.fire ?? {}),
    },
  }, { ...options, messageId: options.messageId ?? "paused-fire" });
}

export function pickupEnvelope(options = {}) {
  return clientEnvelope("client.pickup", {
    clientId: options.clientId ?? "client-a",
    pickup: {
      pickupSequence: options.pickupSequence ?? 1,
      requestedAt: options.sentAt ?? 100,
      entityIndex: 20,
      ...(options.pickup ?? {}),
    },
  }, { ...options, messageId: options.messageId ?? "paused-pickup" });
}

export function worldEnvelope(options = {}) {
  return clientEnvelope("client.world", {
    clientId: options.clientId ?? "client-a",
    intent: {
      intentType: "touch",
      worldSequence: options.worldSequence ?? 1,
      requestedAt: options.sentAt ?? 100,
      entityIndex: 178,
      origin: [0, 0, 0],
      ...(options.intent ?? {}),
    },
  }, { ...options, messageId: options.messageId ?? "paused-world" });
}

export function matchEnvelope(options = {}) {
  return clientEnvelope("client.match", {
    clientId: options.clientId ?? "client-a",
    match: {
      matchSequence: options.matchSequence ?? 1,
      requestedAt: options.sentAt ?? 100,
      action: "restart",
      ...(options.match ?? {}),
    },
  }, { ...options, messageId: options.messageId ?? "paused-match" });
}

export function createInput(inputSequence, overrides = {}) {
  return {
    inputSequence,
    sampledAt: overrides.sampledAt ?? inputSequence * 10,
    dt: overrides.dt ?? 0.05,
    move: { forward: 320, side: 0, up: 0, ...(overrides.move ?? {}) },
    buttons: { attack: false, jump: false, use: false, ...(overrides.buttons ?? {}) },
    rotX: 0,
    rotY: 0,
    ...overrides,
  };
}

export function createPlayer(overrides = {}) {
  return {
    playerId: "player-1",
    clientId: "client-1",
    displayName: "Player",
    mapName: "e1m1",
    origin: [0, 0, 0],
    velocity: [0, 0, 0],
    rotX: 0,
    rotY: 0,
    health: 100,
    armor: 0,
    activeWeapon: "shotgun",
    inventory: {
      health: 100,
      armor: 0,
      armorType: 0,
      activeWeapon: "shotgun",
      itemFlags: 0,
      weapons: ["axe", "shotgun"],
      shells: 25,
      nails: 0,
      rockets: 0,
      cells: 0,
      keys: [],
      powerups: [],
    },
    alive: true,
    frags: 0,
    deaths: 0,
    lastInputSequence: 0,
    updatedAt: 0,
    ...overrides,
  };
}

export function correctionOptions(overrides = {}) {
  return {
    hardSnapDistance: 32,
    softCorrectionDistance: 8,
    blendFraction: 0.35,
    maxBlendDistance: 64,
    ...overrides,
  };
}

export async function createLoopbackHarness(options = {}) {
  let now = options.now ?? 1000;
  const messages = [];
  const session = loopback.createQuakeLoopbackMultiplayerSession({
    now: options.nowProvider ?? (() => now),
    asyncDispatch: false,
    heartbeatIntervalMs: false,
    simulationTickMs: false,
    snapshotIntervalMs: false,
    ...(options.sessionOptions ?? {}),
  });
  const unsubscribe = session.subscribe((message) => messages.push(message));
  const status = await session.connect({
    roomKey: options.roomKey ?? NORMALIZED_ROOM_KEY,
    clientId: options.clientId ?? "client-a",
    displayName: options.displayName ?? "Alice",
    ...(options.color ? { color: options.color } : {}),
  });

  return {
    messages,
    session,
    status,
    now: () => now,
    setNow: (value) => {
      now = value;
      return now;
    },
    advanceNow: (ms) => {
      now += ms;
      return now;
    },
    disconnect: (reason = "test-complete") => {
      unsubscribe();
      session.disconnect(reason);
    },
  };
}

export function latestMessage(messages, type) {
  const message = messages.findLast((candidate) => candidate.type === type);
  assert.ok(message, `expected ${type} message`);
  return message;
}

export function latestSnapshotPlayer(messages, playerId = "loopback:client-a") {
  const snapshot = latestMessage(messages, "room.snapshot");
  const player = snapshot.payload.players.find((candidate) => candidate.playerId === playerId);
  assert.ok(player, `expected snapshot player ${playerId}`);
  return player;
}

export async function waitForMessage(messages, predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? 250;
  const intervalMs = options.intervalMs ?? 5;
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const message = messages.findLast(predicate);
    if (message) return message;
    await delay(intervalMs);
  }
  assert.fail(options.message ?? "timed out waiting for multiplayer message");
}
