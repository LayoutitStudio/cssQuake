import assert from "node:assert/strict";
import test from "node:test";

import {
  NORMALIZED_ROOM_KEY,
  ROOM_KEY,
  authority,
  clientEnvelope,
  createLoopbackHarness,
  createPlayer,
  fireEnvelope,
  helloEnvelope,
  inputBatchEnvelope,
  inputEnvelope,
  latestMessage,
  matchEnvelope,
  partyRoomModule,
  pickupEnvelope,
  presenceEnvelope,
  protocol,
  projectileAuthority,
  validation,
  waitForMessage,
  worldEnvelope,
} from "./harness.mjs";
import { importTsModule } from "../importTsModule.mjs";

const facts = await importTsModule("src/runtime/multiplayer/facts.ts");
const items = await importTsModule("src/runtime/multiplayer/items.ts");

const DUEL_FORWARD_DIRECTION = [0.9781476007338057, 0, -0.20791169081775934];

class FakePartyConnection {
  constructor(id) {
    this.id = id;
    this.messages = [];
    this.closed = [];
    this.state = null;
  }

  send(message) {
    this.messages.push(JSON.parse(message));
  }

  setState(state) {
    this.state = state;
  }

  close(code, reason) {
    this.closed.push({ code, reason });
  }
}

function createFakePartyRoom(id = "test-room") {
  const connections = [];
  return {
    room: {
      id,
      context: {},
      broadcast(message, without = []) {
        const payload = JSON.parse(message);
        for (const connection of connections) {
          if (without.includes(connection.id)) continue;
          connection.messages.push(payload);
        }
      },
      getConnections() {
        return connections;
      },
    },
    createConnection(connectionId) {
      const connection = new FakePartyConnection(connectionId);
      connections.push(connection);
      return connection;
    },
  };
}

function latestConnectionMessage(connection, type) {
  const message = connection.messages.findLast((candidate) => candidate.type === type);
  assert.ok(message, `expected ${type} message on ${connection.id}`);
  return message;
}

function roomEvents(connection, eventType) {
  return connection.messages
    .filter((message) => message.type === "room.event" && message.payload.event.eventType === eventType)
    .map((message) => message.payload.event);
}

function latestSnapshotPlayerForClient(connection, clientId) {
  const snapshot = latestConnectionMessage(connection, "room.snapshot");
  const player = snapshot.payload.players.find((candidate) => candidate.clientId === clientId);
  assert.ok(player, `expected snapshot player for ${clientId}`);
  return player;
}

const weaponPickupFlags = {
  axe: 4096,
  supershotgun: 2,
  nailgun: 4,
  supernailgun: 8,
  grenadelauncher: 16,
  rocketlauncher: 32,
  lightning: 64,
};

const weaponPickupAmmo = {
  axe: { shells: 0 },
  supershotgun: { shells: 10 },
  nailgun: { nails: 25 },
  supernailgun: { nails: 25 },
  grenadelauncher: { rockets: 5 },
  rocketlauncher: { rockets: 5 },
  lightning: { cells: 25 },
};

const QUAD_ITEM_FLAG = 4_194_304;
const INVULNERABILITY_ITEM_FLAG = 1_048_576;

function weaponPickupDefinition(weapon) {
  return {
    pickupId: `weapon-${weapon}`,
    entityIndex: 1000 + Object.keys(weaponPickupFlags).indexOf(weapon),
    classname: `weapon_${weapon}`,
    origin: [0, 0, 0],
    effect: {
      ...(weaponPickupAmmo[weapon] ?? {}),
      weapon: {
        id: weapon,
        itemFlag: weaponPickupFlags[weapon] ?? 0,
        select: true,
      },
    },
  };
}

function quadPickupDefinition({ entityIndex = 1999, durationMs = 30_000, origin = [0, 0, 0] } = {}) {
  return {
    pickupId: `powerup-quad-${entityIndex}`,
    entityIndex,
    classname: "item_artifact_super_damage",
    origin,
    effect: {
      powerup: {
        activationField: "super_damage_time",
        durationMs,
        finishedField: "super_damage_finished",
        itemFlag: QUAD_ITEM_FLAG,
        itemFlagExpression: "IT_QUAD",
      },
    },
  };
}

function invulnerabilityPickupDefinition({ entityIndex = 2999, durationMs = 30_000, origin = [0, 0, 0] } = {}) {
  return {
    pickupId: `powerup-invulnerability-${entityIndex}`,
    entityIndex,
    classname: "item_artifact_invulnerability",
    origin,
    effect: {
      powerup: {
        activationField: "invincible_time",
        durationMs,
        finishedField: "invincible_finished",
        itemFlag: INVULNERABILITY_ITEM_FLAG,
      },
    },
  };
}

function connectDuelRoom({
  id,
  deathmatchSpawns,
  matchSettings = { fragLimit: 1 },
  pickupDefinitions = [],
  roomOptions = {},
  spawnDistance = 4,
}) {
  const spawns = deathmatchSpawns ?? [
    {
      spawnId: "spawn-a",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 0,
    },
    {
      spawnId: "spawn-b",
      classname: "info_player_deathmatch",
      origin: [spawnDistance, 0, 0],
      rotX: -78,
      rotY: 180,
    },
  ];
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: spawns,
    pickupDefinitions,
  });
  const { room, createConnection } = createFakePartyRoom(id);
  const RoomClass = partyRoomModule.default;
  const partyRoom = new RoomClass(room, {
    random: () => 0.999999,
    trustedGameplayDefinitions: gameplayDefinitions,
    ...roomOptions,
  });
  const alice = createConnection("alice");
  const bob = createConnection("bob");
  partyRoom.onConnect(alice);
  partyRoom.onConnect(bob);
  partyRoom.onMessage(JSON.stringify(helloEnvelope({
    clientId: "client-a",
    displayName: "Alice",
    messageId: `hello-a-${id}`,
    sequence: 1,
    sentAt: Date.now(),
    matchSettings,
  })), alice);
  partyRoom.onMessage(JSON.stringify(helloEnvelope({
    clientId: "client-b",
    displayName: "Bob",
    messageId: `hello-b-${id}`,
    sequence: 1,
    sentAt: Date.now(),
    matchSettings,
  })), bob);
  return { alice, bob, partyRoom };
}

function connectTripleRoom({ id, roomOptions = {}, spawns }) {
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: spawns,
    pickupDefinitions: [],
  });
  const { room, createConnection } = createFakePartyRoom(id);
  const RoomClass = partyRoomModule.default;
  const partyRoom = new RoomClass(room, {
    random: () => 0.999999,
    trustedGameplayDefinitions: gameplayDefinitions,
    ...roomOptions,
  });
  const alice = createConnection("alice");
  const bob = createConnection("bob");
  const cara = createConnection("cara");
  partyRoom.onConnect(alice);
  partyRoom.onConnect(bob);
  partyRoom.onConnect(cara);
  const clients = [
    { clientId: "client-a", connection: alice, displayName: "Alice" },
    { clientId: "client-b", connection: bob, displayName: "Bob" },
    { clientId: "client-c", connection: cara, displayName: "Cara" },
  ];
  for (const [index, client] of clients.entries()) {
    partyRoom.onMessage(JSON.stringify(helloEnvelope({
      clientId: client.clientId,
      displayName: client.displayName,
      messageId: `hello-${client.clientId}-${id}`,
      sequence: 1,
      sentAt: Date.now(),
      matchSettings: { fragLimit: 99, maxPlayers: 4 },
    })), client.connection);
  }
  return { alice, bob, cara, partyRoom };
}

function cleanupDuelRoom(partyRoom, alice, bob) {
  cleanupPartyRoomConnections(partyRoom, alice, bob);
}

function cleanupPartyRoomConnections(partyRoom, ...connections) {
  for (const connection of connections) partyRoom.onClose(connection);
}

function setPartyRoomPlayerWeapon(partyRoom, clientId, weapon) {
  const playerId = `party:${clientId}`;
  const player = partyRoom.players.get(playerId);
  assert.ok(player, `expected player ${playerId}`);
  const inventory = items.quakeMultiplayerPlayerInventory(player);
  inventory.weapons = [...new Set([...inventory.weapons, weapon])];
  inventory.activeWeapon = weapon;
  inventory.shells = Math.max(inventory.shells, 50);
  inventory.nails = Math.max(inventory.nails, 50);
  inventory.rockets = Math.max(inventory.rockets, 50);
  inventory.cells = Math.max(inventory.cells, 50);
  partyRoom.players.set(playerId, items.quakeMultiplayerPlayerWithInventory(player, inventory));
}

function setPartyRoomPlayerQuad(partyRoom, clientId, finishedAt) {
  const playerId = `party:${clientId}`;
  const player = partyRoom.players.get(playerId);
  assert.ok(player, `expected player ${playerId}`);
  const inventory = items.quakeMultiplayerPlayerInventory(player);
  inventory.itemFlags |= QUAD_ITEM_FLAG;
  inventory.powerups = [
    ...inventory.powerups.filter((powerup) => powerup.finishedField !== "super_damage_finished"),
    {
      active: true,
      activationField: "super_damage_time",
      finishedAt,
      finishedField: "super_damage_finished",
      itemFlag: QUAD_ITEM_FLAG,
      itemFlagExpression: "IT_QUAD",
    },
  ];
  partyRoom.players.set(playerId, items.quakeMultiplayerPlayerWithInventory(player, inventory));
}

function setPartyRoomPlayerInvulnerable(partyRoom, clientId, finishedAt) {
  const playerId = `party:${clientId}`;
  const player = partyRoom.players.get(playerId);
  assert.ok(player, `expected player ${playerId}`);
  const inventory = items.quakeMultiplayerPlayerInventory(player);
  inventory.itemFlags |= INVULNERABILITY_ITEM_FLAG;
  inventory.powerups = [
    ...inventory.powerups.filter((powerup) => powerup.finishedField !== "invincible_finished"),
    {
      active: true,
      activationField: "invincible_time",
      finishedAt,
      finishedField: "invincible_finished",
      itemFlag: INVULNERABILITY_ITEM_FLAG,
    },
  ];
  partyRoom.players.set(playerId, items.quakeMultiplayerPlayerWithInventory(player, inventory));
}

function pickupWeapon(partyRoom, connection, { clientId, sequence, weapon }) {
  const definition = weaponPickupDefinition(weapon);
  partyRoom.onMessage(JSON.stringify(pickupEnvelope({
    clientId,
    messageId: `pickup-${weapon}-${clientId}`,
    sequence,
    pickupSequence: 1,
    sentAt: Date.now(),
    pickup: {
      entityIndex: definition.entityIndex,
      origin: [0, 0, 0],
    },
  })), connection);
  const event = roomEvents(connection, "pickup.taken")
    .find((candidate) => candidate.entityIndex === definition.entityIndex);
  assert.ok(event, `expected ${clientId} to pick up ${weapon}`);
  return event;
}

test("multiplayer room compatibility keys normalize map names and compare full asset identity", () => {
  const normalized = protocol.createQuakeMultiplayerRoomCompatibilityKey(ROOM_KEY);
  assert.deepEqual(normalized, NORMALIZED_ROOM_KEY);
  assert.equal(protocol.sameQuakeMultiplayerRoomCompatibilityKey(ROOM_KEY, NORMALIZED_ROOM_KEY), true);
  assert.equal(
    protocol.sameQuakeMultiplayerRoomCompatibilityKey(ROOM_KEY, {
      ...NORMALIZED_ROOM_KEY,
      sceneUrl: "/q/e1m2.json",
    }),
    false,
  );
});

test("client hello validates and establishes authority state before other client messages", () => {
  const hello = helloEnvelope({
    color: "#00ffaa",
    capabilities: ["input", "snapshots"],
    matchSettings: { fragLimit: 5, maxPlayers: 4 },
    sequence: 1,
    sentAt: 100,
  });

  const validationResult = validation.validateQuakeMultiplayerClientEnvelope(hello, {
    roomKey: NORMALIZED_ROOM_KEY,
    now: 100,
  });
  assert.equal(validationResult.ok, true);

  const authorityResult = authority.validateQuakeMultiplayerClientAuthority(hello, null, { now: 100 });
  assert.equal(authorityResult.ok, true);
  assert.equal(authorityResult.state.clientId, "client-a");
  assert.equal(authorityResult.state.lastEnvelopeSequence, 1);
});

test("client input batches validate only when bounded and strictly ordered", () => {
  const batch = inputBatchEnvelope({
    sequence: 2,
    inputSequences: [1, 2, 3, 4],
    sentAt: 120,
  });
  const valid = validation.validateQuakeMultiplayerClientEnvelope(batch, {
    roomKey: NORMALIZED_ROOM_KEY,
    now: 120,
  });
  assert.equal(valid.ok, true);

  for (const [name, inputs] of [
    ["empty", []],
    ["oversized", [1, 2, 3, 4, 5].map((inputSequence) => ({ ...batch.payload.inputs[0], inputSequence }))],
    ["unordered", [1, 3, 2].map((inputSequence) => ({ ...batch.payload.inputs[0], inputSequence }))],
  ]) {
    const invalid = validation.validateQuakeMultiplayerClientEnvelope({
      ...batch,
      messageId: `invalid-batch-${name}`,
      payload: {
        ...batch.payload,
        inputs,
      },
    }, {
      roomKey: NORMALIZED_ROOM_KEY,
      now: 120,
    });
    assert.equal(invalid.ok, false, name);
    assert.equal(invalid.code, "malformed", name);
  }
});

test("multiplayer match settings clamp max players to launch cap", () => {
  assert.equal(protocol.QUAKE_MULTIPLAYER_MAX_PLAYERS_CAP, 4);
  assert.deepEqual(
    protocol.clampQuakeMultiplayerMatchSettings({ fragLimit: 20, maxPlayers: 8 }),
    { fragLimit: 20, maxPlayers: 4 },
  );
  assert.deepEqual(
    protocol.clampQuakeMultiplayerMatchSettings({ fragLimit: 20, maxPlayers: 3 }),
    { fragLimit: 20, maxPlayers: 3 },
  );
});

test("party room accepts a fifth capped player as a spectator", () => {
  const { room, createConnection } = createFakePartyRoom();
  const RoomClass = partyRoomModule.default;
  const partyRoom = new RoomClass(room);
  assert.equal(partyRoomModule.CSSQUAKE_PARTY_MAX_SPECTATORS_PER_ROOM, 8);

  for (let index = 1; index <= 4; index += 1) {
    const connection = createConnection(`connection-${index}`);
    partyRoom.onConnect(connection);
    partyRoom.onMessage(JSON.stringify(helloEnvelope({
      clientId: `client-${index}`,
      displayName: `Player ${index}`,
      messageId: `hello-${index}`,
      sequence: 1,
      sentAt: Date.now(),
      matchSettings: { maxPlayers: 8 },
    })), connection);
    const snapshot = latestConnectionMessage(connection, "room.snapshot");
    assert.equal(snapshot.payload.match.maxPlayers, 4);
  }

  const spectator = createConnection("connection-5");
  partyRoom.onConnect(spectator);
  partyRoom.onMessage(JSON.stringify(helloEnvelope({
    clientId: "client-5",
    displayName: "Player 5",
    messageId: "hello-5",
    sequence: 1,
    sentAt: Date.now(),
    matchSettings: { maxPlayers: 8 },
  })), spectator);

  const snapshot = latestConnectionMessage(spectator, "room.snapshot");
  assert.equal(snapshot.payload.players.length, 4);
  assert.deepEqual(snapshot.payload.spectators, [{
    clientId: "client-5",
    displayName: "Player 5",
  }]);
  assert.equal(spectator.state.role, "spectator");
  assert.equal(spectator.state.playerId, undefined);
  assert.equal(spectator.messages.filter((message) => message.type === "room.reject").length, 0);
  assert.equal(spectator.closed.length, 0);

  for (let index = 6; index < 6 + partyRoomModule.CSSQUAKE_PARTY_MAX_SPECTATORS_PER_ROOM - 1; index += 1) {
    const extraSpectator = createConnection(`connection-${index}`);
    partyRoom.onConnect(extraSpectator);
    partyRoom.onMessage(JSON.stringify(helloEnvelope({
      clientId: `client-${index}`,
      displayName: `Player ${index}`,
      messageId: `hello-${index}`,
      sequence: 1,
      sentAt: Date.now(),
      matchSettings: { maxPlayers: 8 },
    })), extraSpectator);
    assert.equal(extraSpectator.state.role, "spectator");
    assert.equal(extraSpectator.closed.length, 0);
  }

  const overflow = createConnection("connection-overflow");
  partyRoom.onConnect(overflow);
  partyRoom.onMessage(JSON.stringify(helloEnvelope({
    clientId: "client-overflow",
    displayName: "Overflow",
    messageId: "hello-overflow",
    sequence: 1,
    sentAt: Date.now(),
    matchSettings: { maxPlayers: 8 },
  })), overflow);
  const reject = latestConnectionMessage(overflow, "room.reject");
  assert.equal(reject.payload.code, "room-full");
  assert.equal(reject.payload.recoverable, false);
  assert.deepEqual(overflow.closed.at(-1), { code: 1008, reason: "reject:room-full" });
});

test("party room queues ordered input batches into the player simulation state", () => {
  const { room, createConnection } = createFakePartyRoom("input-batch-room");
  const RoomClass = partyRoomModule.default;
  const partyRoom = new RoomClass(room);
  const connection = createConnection("connection-a");
  try {
    partyRoom.onConnect(connection);
    partyRoom.onMessage(JSON.stringify(helloEnvelope({
      messageId: "batch-hello",
      sequence: 1,
      sentAt: Date.now(),
    })), connection);

    partyRoom.onMessage(JSON.stringify(inputBatchEnvelope({
      messageId: "batch-inputs",
      sequence: 2,
      inputSequences: [1, 2, 3],
      sentAt: Date.now(),
    })), connection);

    assert.equal(connection.state.authority.lastIntentSequences.input, 3);
    const simulationState = partyRoom.playerSimulationStates.get("party:client-a");
    assert.ok(simulationState);
    assert.deepEqual(simulationState.pendingInputs.map((input) => input.inputSequence), [1, 2, 3]);
    assert.deepEqual(simulationState.acceptedInputHistory.map((input) => input.inputSequence), [1, 2, 3]);
  } finally {
    cleanupPartyRoomConnections(partyRoom, connection);
  }
});

test("party room accepts fire timestamps near accepted input history", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({ id: "fire-input-history-accept" });
  try {
    const base = Date.now();
    partyRoom.onMessage(JSON.stringify(inputBatchEnvelope({
      clientId: "client-a",
      messageId: "fire-history-inputs",
      sequence: 2,
      sentAt: base,
      inputSequences: [1, 2],
      inputs: [
        { sampledAt: base, rotX: -78, rotY: 0 },
        { sampledAt: base + 50, rotX: -78, rotY: 0 },
      ],
    })), alice);
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-history-valid",
      sequence: 3,
      sentAt: base + 60,
      fireSequence: 1,
      fire: {
        firedAt: base + 55,
      },
    })), alice);

    const damage = roomEvents(alice, "player.damaged")
      .find((event) => event.attackerPlayerId === "party:client-a" && event.victimPlayerId === "party:client-b");
    assert.ok(damage, "expected accepted fire timestamp to damage the remote player");
    assert.equal(damage.damage, 24);
    assert.equal(alice.messages.some((message) => message.type === "room.reject"), false);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room rejects fire timestamps outside accepted input history", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({ id: "fire-input-history-reject" });
  try {
    const base = Date.now();
    partyRoom.onMessage(JSON.stringify(inputBatchEnvelope({
      clientId: "client-a",
      messageId: "fire-history-reject-inputs",
      sequence: 2,
      sentAt: base,
      inputSequences: [1, 2],
      inputs: [
        { sampledAt: base, rotX: -78, rotY: 0 },
        { sampledAt: base + 50, rotX: -78, rotY: 0 },
      ],
    })), alice);
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-history-too-late",
      sequence: 3,
      sentAt: base + 60,
      fireSequence: 1,
      fire: {
        firedAt: base + 1_000,
      },
    })), alice);

    const reject = latestConnectionMessage(alice, "room.reject");
    assert.equal(reject.payload.code, "stale");
    assert.equal(reject.payload.recoverable, true);
    assert.equal(reject.payload.rejectedMessageId, "fire-history-too-late");
    assert.match(reject.payload.message, /fire-after-input-history/);
    assert.equal(
      roomEvents(alice, "player.damaged")
        .some((event) => event.attackerPlayerId === "party:client-a" && event.victimPlayerId === "party:client-b"),
      false,
    );
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room closes a connection after repeated recoverable rejects", () => {
  const { room, createConnection } = createFakePartyRoom();
  const RoomClass = partyRoomModule.default;
  const partyRoom = new RoomClass(room);
  const connection = createConnection("noisy-connection");

  partyRoom.onConnect(connection);
  partyRoom.onMessage(JSON.stringify(helloEnvelope({
    messageId: "hello-noisy",
    sequence: 1,
    sentAt: Date.now(),
  })), connection);

  for (let index = 0; index < partyRoomModule.CSSQUAKE_PARTY_MAX_REJECTS_PER_CONNECTION; index += 1) {
    partyRoom.onMessage(JSON.stringify(inputEnvelope({
      messageId: `stale-input-${index}`,
      sequence: 1,
      inputSequence: 1,
      sentAt: Date.now(),
    })), connection);
  }

  const rejects = connection.messages.filter((message) => message.type === "room.reject");
  assert.equal(rejects.length, partyRoomModule.CSSQUAKE_PARTY_MAX_REJECTS_PER_CONNECTION);
  assert.equal(rejects.at(-1).payload.code, "stale");
  assert.equal(rejects.at(-1).payload.recoverable, true);
  assert.deepEqual(connection.closed.at(-1), { code: 1008, reason: "too-many-rejects" });
});

test("party room applies authoritative fire damage in both player directions", () => {
  const deathmatchSpawns = [
    {
      spawnId: "spawn-a",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 0,
    },
    {
      spawnId: "spawn-b",
      classname: "info_player_deathmatch",
      origin: [4, 0, 0],
      rotX: -78,
      rotY: 180,
    },
  ];
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns,
    pickupDefinitions: [],
  });
  const { room, createConnection } = createFakePartyRoom("fire-damage-room");
  const RoomClass = partyRoomModule.default;
  const partyRoom = new RoomClass(room, {
    random: () => 0.999999,
    trustedGameplayDefinitions: gameplayDefinitions,
  });
  const alice = createConnection("alice");
  const bob = createConnection("bob");
  partyRoom.onConnect(alice);
  partyRoom.onConnect(bob);

  partyRoom.onMessage(JSON.stringify(helloEnvelope({
    clientId: "client-a",
    displayName: "Alice",
    messageId: "hello-a",
    sequence: 1,
    sentAt: Date.now(),
  })), alice);
  partyRoom.onMessage(JSON.stringify(helloEnvelope({
    clientId: "client-b",
    displayName: "Bob",
    messageId: "hello-b",
    sequence: 1,
    sentAt: Date.now(),
  })), bob);

  partyRoom.onMessage(JSON.stringify(fireEnvelope({
    clientId: "client-a",
    messageId: "fire-a",
    sequence: 2,
    fireSequence: 1,
    sentAt: Date.now(),
  })), alice);
  const damageAtoB = roomEvents(alice, "player.damaged")
    .find((event) => event.attackerPlayerId === "party:client-a" && event.victimPlayerId === "party:client-b");
  assert.ok(damageAtoB, "expected client-a to damage client-b");
  assert.equal(damageAtoB.damage, 24);
  assert.equal(damageAtoB.health, 76);
  assert.equal(damageAtoB.damageSource, "shotgun");
  const firedAtoB = roomEvents(alice, "player.fired").find((event) => event.eventId === "fire-fire-a");
  assert.equal(firedAtoB?.decision?.outcome, "hit-player");
  assert.equal(firedAtoB?.decision?.reason, "player-direct");
  assert.equal(firedAtoB?.decision?.targetPlayerId, "party:client-b");
  assert.equal(firedAtoB?.decision?.candidateCount, 1);
  assert.equal(firedAtoB?.decision?.blockedCandidateCount, 0);
  assert.equal(firedAtoB?.decision?.playerDamageCount, 1);

  partyRoom.onMessage(JSON.stringify(fireEnvelope({
    clientId: "client-b",
    messageId: "fire-b",
    sequence: 2,
    fireSequence: 1,
    sentAt: Date.now(),
  })), bob);
  const damageBtoA = roomEvents(alice, "player.damaged")
    .find((event) => event.attackerPlayerId === "party:client-b" && event.victimPlayerId === "party:client-a");
  assert.ok(damageBtoA, "expected client-b to damage client-a");
  assert.equal(damageBtoA.damage, 24);
  assert.equal(damageBtoA.health, 76);
  assert.equal(damageBtoA.damageSource, "shotgun");
  const firedBtoA = roomEvents(alice, "player.fired").find((event) => event.eventId === "fire-fire-b");
  assert.equal(firedBtoA?.decision?.outcome, "hit-player");
  assert.equal(firedBtoA?.decision?.reason, "player-direct");
  assert.equal(firedBtoA?.decision?.targetPlayerId, "party:client-a");
  assert.equal(firedBtoA?.decision?.candidateCount, 1);
  assert.equal(firedBtoA?.decision?.blockedCandidateCount, 0);
  assert.equal(firedBtoA?.decision?.playerDamageCount, 1);
  assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
  assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
});

test("party room applies source-order armor save but suppresses health damage while the victim is invulnerable", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({ id: "invulnerable-victim" });
  try {
    const bobPlayer = partyRoom.players.get("party:client-b");
    assert.ok(bobPlayer, "expected bob player");
    const inventory = items.quakeMultiplayerPlayerInventory(bobPlayer);
    inventory.health = 100;
    inventory.armor = 50;
    inventory.armorType = 0.8;
    inventory.powerups = [{
      active: true,
      activationField: "invincible_time",
      finishedAt: Date.now() + 10_000,
      finishedField: "invincible_finished",
      itemFlag: INVULNERABILITY_ITEM_FLAG,
    }];
    partyRoom.players.set("party:client-b", items.quakeMultiplayerPlayerWithInventory(bobPlayer, inventory));

    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-invulnerable-victim",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
    })), alice);

    assert.equal(
      roomEvents(alice, "player.damaged").some((event) => event.victimPlayerId === "party:client-b"),
      false,
    );
    assert.equal(
      roomEvents(alice, "player.killed").some((event) => event.victimPlayerId === "party:client-b"),
      false,
    );
    const victim = latestSnapshotPlayerForClient(alice, "client-b");
    assert.equal(victim.health, 100);
    assert.equal(victim.armor, 30);
    assert.equal(victim.alive, true);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room double-invulnerable telefrag clears protection and kills both players like Quake teledeath3", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({ id: "double-invulnerable-telefrag" });
  try {
    const now = Date.now();
    const victim = partyRoom.players.get("party:client-b");
    assert.ok(victim, "expected victim");
    setPartyRoomPlayerInvulnerable(partyRoom, "client-a", now + 10_000);
    setPartyRoomPlayerInvulnerable(partyRoom, "client-b", now + 10_000);

    partyRoom.applyTeleportDeath("party:client-a", victim.origin, "double-invulnerable-telefrag");

    const kills = roomEvents(alice, "player.killed")
      .filter((event) => event.damageSource === "teledeath3");
    assert.equal(kills.length, 2);
    assert.equal(kills.some((event) => event.victimPlayerId === "party:client-a"), true);
    assert.equal(kills.some((event) => event.victimPlayerId === "party:client-b"), true);

    const aliceSnapshot = latestSnapshotPlayerForClient(alice, "client-a");
    const bobSnapshot = latestSnapshotPlayerForClient(alice, "client-b");
    assert.equal(aliceSnapshot.alive, false);
    assert.equal(bobSnapshot.alive, false);
    assert.equal(aliceSnapshot.frags, -1);
    assert.equal(bobSnapshot.frags, -1);
    assert.equal(aliceSnapshot.deaths, 1);
    assert.equal(bobSnapshot.deaths, 1);
    assert.equal(
      aliceSnapshot.inventory.powerups.some((powerup) => powerup.finishedField === "invincible_finished"),
      false,
    );
    assert.equal(
      bobSnapshot.inventory.powerups.some((powerup) => powerup.finishedField === "invincible_finished"),
      false,
    );
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room subtracts a victim frag for world/environment kills", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({ id: "world-kill-frag-penalty" });
  try {
    partyRoom.applyPlayerDamage({
      victimPlayerId: "party:client-b",
      damage: 150,
      source: "trigger_hurt",
      eventId: "world-kill-frag-penalty",
      now: Date.now(),
    });

    const kill = roomEvents(alice, "player.killed")
      .find((event) => event.victimPlayerId === "party:client-b");
    assert.ok(kill, "expected environment kill event");
    assert.equal(kill.attackerPlayerId, undefined);
    assert.equal(kill.damageSource, "trigger_hurt");
    const victim = latestSnapshotPlayerForClient(alice, "client-b");
    assert.equal(victim.alive, false);
    assert.equal(victim.frags, -1);
    assert.equal(victim.deaths, 1);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room clears active artifact powerups immediately on player death", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "death-clears-powerups",
    matchSettings: { fragLimit: 99 },
  });
  try {
    const now = Date.now();
    setPartyRoomPlayerQuad(partyRoom, "client-b", now + 10_000);
    const bobPlayer = partyRoom.players.get("party:client-b");
    assert.ok(bobPlayer, "expected bob player");
    const inventory = items.quakeMultiplayerPlayerInventory(bobPlayer);
    inventory.health = 10;
    partyRoom.players.set("party:client-b", items.quakeMultiplayerPlayerWithInventory(bobPlayer, inventory));

    partyRoom.applyPlayerDamage({
      attackerPlayerId: "party:client-a",
      victimPlayerId: "party:client-b",
      damage: 24,
      source: "shotgun",
      eventId: "death-clears-powerups",
      now,
    });

    const victim = latestSnapshotPlayerForClient(alice, "client-b");
    assert.equal(victim.alive, false);
    assert.equal(victim.inventory.itemFlags & QUAD_ITEM_FLAG, 0);
    assert.equal(
      victim.inventory.powerups.some((powerup) => powerup.finishedField === "super_damage_finished"),
      false,
    );
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room respawns at a clear deathmatch spawn instead of the occupied cursor spawn", () => {
  const deathmatchSpawns = [
    { spawnId: "spawn-a", classname: "info_player_deathmatch", origin: [0, 0, 0], rotX: -78, rotY: 0 },
    { spawnId: "spawn-b", classname: "info_player_deathmatch", origin: [8, 0, 0], rotX: -78, rotY: 180 },
    { spawnId: "spawn-c-occupied", classname: "info_player_deathmatch", origin: [0.5, 0, 0], rotX: -78, rotY: 90 },
    { spawnId: "spawn-d-clear", classname: "info_player_deathmatch", origin: [16, 0, 0], rotX: -78, rotY: 270 },
  ];
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "respawn-clear-spawn",
    deathmatchSpawns,
    matchSettings: { fragLimit: 99 },
  });
  try {
    partyRoom.applyPlayerDamage({
      attackerPlayerId: "party:client-a",
      victimPlayerId: "party:client-b",
      damage: 150,
      source: "shotgun",
      eventId: "respawn-clear-spawn-kill",
      now: Date.now(),
    });
    partyRoom.respawnPlayer("party:client-b");

    const respawn = roomEvents(alice, "player.respawned")
      .find((event) => event.player?.playerId === "party:client-b");
    assert.ok(respawn, "expected respawn event");
    assert.equal(respawn.player.spawnId, "spawn-d-clear");
    assert.deepEqual(respawn.player.origin, [16, 0, 0]);
    const bobSnapshot = latestSnapshotPlayerForClient(alice, "client-b");
    assert.equal(bobSnapshot.spawnId, "spawn-d-clear");
    assert.deepEqual(bobSnapshot.origin, [16, 0, 0]);
    assert.equal(bobSnapshot.alive, true);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room applies authoritative weapon damage after weapon pickups", () => {
  const cases = [
    { weapon: "axe", damage: 20, pickup: false, spawnDistance: 1.2, eventType: "player.damaged", health: 80 },
    { weapon: "shotgun", damage: 24, pickup: false, spawnDistance: 4, eventType: "player.damaged", health: 76 },
    { weapon: "supershotgun", damage: 56, pickup: true, spawnDistance: 4, eventType: "player.damaged", health: 44 },
    { weapon: "nailgun", damage: 9, pickup: true, spawnDistance: 4, eventType: "player.damaged", health: 91 },
    { weapon: "supernailgun", damage: 18, pickup: true, spawnDistance: 4, eventType: "player.damaged", health: 82 },
    { weapon: "lightning", damage: 30, pickup: true, spawnDistance: 4, eventType: "player.damaged", health: 70 },
    { weapon: "grenadelauncher", damage: 87, pickup: true, spawnDistance: 4, eventType: "player.damaged", health: 13 },
    { weapon: "rocketlauncher", pickup: true, spawnDistance: 4, eventType: "player.killed", health: -5 },
  ];

  for (const spec of cases) {
    const pickupDefinitions = spec.pickup ? [weaponPickupDefinition(spec.weapon)] : [];
    const { alice, bob, partyRoom } = connectDuelRoom({
      id: `weapon-${spec.weapon}`,
      pickupDefinitions,
      spawnDistance: spec.spawnDistance,
    });
    try {
      if (spec.pickup) {
        pickupWeapon(partyRoom, alice, {
          clientId: "client-a",
          sequence: 2,
          weapon: spec.weapon,
        });
        const player = latestSnapshotPlayerForClient(alice, "client-a");
        assert.equal(player.inventory.activeWeapon, spec.weapon, `${spec.weapon} should become active after pickup`);
        assert.ok(player.inventory.weapons.includes(spec.weapon), `${spec.weapon} should be in authoritative inventory`);
      } else {
        setPartyRoomPlayerWeapon(partyRoom, "client-a", spec.weapon);
      }

      partyRoom.onMessage(JSON.stringify(fireEnvelope({
        clientId: "client-a",
        messageId: `fire-${spec.weapon}`,
        sequence: 3,
        fireSequence: 1,
        sentAt: Date.now(),
        fire: { weapon: spec.weapon },
      })), alice);

      const serverProjectile = projectileAuthority.quakeMultiplayerServerProjectileWeaponSupported(spec.weapon);
      if (serverProjectile) {
        const fired = roomEvents(alice, "player.fired")
          .find((candidate) => candidate.eventId === `fire-fire-${spec.weapon}`);
        assert.equal(fired?.decision?.outcome, "projectile-spawned", `${spec.weapon} should spawn a server projectile`);
        const spawned = roomEvents(alice, "projectile.spawned")
          .find((candidate) => candidate.projectile.weapon === spec.weapon);
        assert.ok(spawned, `expected projectile.spawned for ${spec.weapon}`);
        assert.equal(
          roomEvents(alice, spec.eventType)
            .some((candidate) =>
              candidate.attackerPlayerId === "party:client-a" &&
              candidate.victimPlayerId === "party:client-b" &&
              candidate.damageSource === spec.weapon
            ),
          false,
          `${spec.weapon} should not apply damage in the same tick as fire`,
        );
        partyRoom.advanceRoomSimulation(Date.now() + 400);
        const impact = roomEvents(alice, "projectile.impacted")
          .find((candidate) => candidate.weapon === spec.weapon);
        assert.ok(impact, `expected projectile.impacted for ${spec.weapon}`);
        assert.equal(impact.impactKind, "player", `${spec.weapon} should impact the player`);
        assert.equal(impact.targetPlayerId, "party:client-b", `${spec.weapon} impact target`);
      }

      const event = roomEvents(alice, spec.eventType)
        .find((candidate) =>
          candidate.attackerPlayerId === "party:client-a" &&
          candidate.victimPlayerId === "party:client-b" &&
          candidate.damageSource === spec.weapon
        );
      assert.ok(event, `expected ${spec.eventType} for ${spec.weapon}`);
      if (spec.eventType === "player.damaged") {
        assert.equal(event.damage, spec.damage, `${spec.weapon} damage`);
        assert.equal(event.health, spec.health, `${spec.weapon} victim health`);
      }
      if (spec.eventType === "player.killed") {
        const victim = latestSnapshotPlayerForClient(alice, "client-b");
        assert.equal(victim.alive, false, `${spec.weapon} should kill the victim`);
        assert.equal(victim.health, spec.health, `${spec.weapon} death health`);
      }
      assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0, `${spec.weapon} alice rejects`);
      assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0, `${spec.weapon} bob rejects`);
    } finally {
      cleanupDuelRoom(partyRoom, alice, bob);
    }
  }
});

test("party room weapon pickup keeps a better current weapon by Quake deathmatch rank", () => {
  const nailgunPickup = weaponPickupDefinition("nailgun");
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "weapon-pickup-rank-switch",
    pickupDefinitions: [nailgunPickup],
  });
  try {
    const player = partyRoom.players.get("party:client-a");
    assert.ok(player, "expected player");
    const inventory = items.quakeMultiplayerPlayerInventory(player);
    inventory.activeWeapon = "rocketlauncher";
    inventory.weapons = ["axe", "shotgun", "rocketlauncher"];
    inventory.rockets = 5;
    inventory.nails = 0;
    partyRoom.players.set("party:client-a", items.quakeMultiplayerPlayerWithInventory(player, inventory));

    partyRoom.onMessage(JSON.stringify(pickupEnvelope({
      clientId: "client-a",
      messageId: "pickup-nailgun-rank-switch",
      sequence: 2,
      pickupSequence: 1,
      sentAt: Date.now(),
      pickup: {
        entityIndex: nailgunPickup.entityIndex,
        origin: [0, 0, 0],
      },
    })), alice);

    const pickup = roomEvents(alice, "pickup.taken")
      .find((event) => event.entityIndex === nailgunPickup.entityIndex);
    assert.ok(pickup, "expected nailgun pickup");
    const snapshot = latestSnapshotPlayerForClient(alice, "client-a");
    assert.equal(snapshot.inventory.weapons.includes("nailgun"), true);
    assert.equal(snapshot.inventory.nails, 25);
    assert.equal(snapshot.inventory.activeWeapon, "rocketlauncher");
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room accepts already-owned respawning weapon pickup at full ammo like Quake deathmatch", () => {
  const nailgunPickup = {
    ...weaponPickupDefinition("nailgun"),
    lifecycle: { action: "respawn", condition: "deathmatch", delayMs: 30_000 },
  };
  const originalNow = Date.now;
  let now = 4_500_000;
  Date.now = () => now;
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "weapon-pickup-full-ammo-respawn",
    pickupDefinitions: [nailgunPickup],
  });
  try {
    const player = partyRoom.players.get("party:client-a");
    assert.ok(player, "expected player");
    const inventory = items.quakeMultiplayerPlayerInventory(player);
    inventory.activeWeapon = "rocketlauncher";
    inventory.weapons = ["axe", "shotgun", "nailgun", "rocketlauncher"];
    inventory.nails = 200;
    inventory.rockets = 5;
    partyRoom.players.set("party:client-a", items.quakeMultiplayerPlayerWithInventory(player, inventory));

    partyRoom.onMessage(JSON.stringify(pickupEnvelope({
      clientId: "client-a",
      messageId: "pickup-owned-full-nailgun",
      sequence: 2,
      pickupSequence: 1,
      sentAt: now,
      pickup: {
        entityIndex: nailgunPickup.entityIndex,
        origin: [0, 0, 0],
      },
    })), alice);

    const pickup = roomEvents(alice, "pickup.taken")
      .find((event) => event.entityIndex === nailgunPickup.entityIndex);
    assert.ok(pickup, "expected already-owned full-ammo weapon pickup to be taken");
    assert.equal(pickup.leaveInPlace, false);
    const snapshot = latestConnectionMessage(alice, "room.snapshot");
    const pickupState = snapshot.payload.pickups.find((candidate) =>
      candidate.entityIndex === nailgunPickup.entityIndex
    );
    assert.equal(pickupState?.available, false);
    assert.equal(pickupState?.respawnAt, now + 30_000);
    const playerSnapshot = latestSnapshotPlayerForClient(alice, "client-a");
    assert.equal(playerSnapshot.inventory.nails, 200);
    assert.equal(playerSnapshot.inventory.activeWeapon, "rocketlauncher");
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
    Date.now = originalNow;
  }
});

test("party room ammo pickup selects a newly usable best weapon when the active weapon was best", () => {
  const nailsPickup = {
    pickupId: "item-spikes-auto-best",
    entityIndex: 4010,
    classname: "item_spikes",
    origin: [0, 0, 0],
    effect: { nails: 25 },
  };
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "ammo-pickup-auto-best-weapon",
    pickupDefinitions: [nailsPickup],
  });
  try {
    const attacker = partyRoom.players.get("party:client-a");
    assert.ok(attacker, "expected attacker");
    const inventory = items.quakeMultiplayerPlayerInventory(attacker);
    inventory.activeWeapon = "shotgun";
    inventory.weapons = ["axe", "shotgun", "supernailgun"];
    inventory.shells = 25;
    inventory.nails = 0;
    partyRoom.players.set("party:client-a", items.quakeMultiplayerPlayerWithInventory(attacker, inventory));

    partyRoom.onMessage(JSON.stringify(pickupEnvelope({
      clientId: "client-a",
      messageId: "pickup-nails-auto-best",
      sequence: 2,
      pickupSequence: 1,
      sentAt: Date.now(),
      pickup: {
        entityIndex: nailsPickup.entityIndex,
        origin: [0, 0, 0],
      },
    })), alice);

    const pickup = roomEvents(alice, "pickup.taken")
      .find((event) => event.entityIndex === nailsPickup.entityIndex);
    assert.ok(pickup, "expected nails pickup");
    const player = latestSnapshotPlayerForClient(alice, "client-a");
    assert.equal(player.inventory.nails, 25);
    assert.equal(player.inventory.activeWeapon, "supernailgun");
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room auto-selects the source best weapon when the active weapon has no ammo before fire", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "auto-best-weapon-before-fire",
    spawnDistance: 4,
  });
  try {
    const attacker = partyRoom.players.get("party:client-a");
    assert.ok(attacker, "expected attacker");
    const inventory = items.quakeMultiplayerPlayerInventory(attacker);
    inventory.activeWeapon = "nailgun";
    inventory.weapons = ["axe", "shotgun", "nailgun"];
    inventory.shells = 25;
    inventory.nails = 0;
    partyRoom.players.set("party:client-a", items.quakeMultiplayerPlayerWithInventory(attacker, inventory));

    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-auto-best-before",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
      fire: { weapon: "nailgun" },
    })), alice);

    const fired = roomEvents(alice, "player.fired")
      .find((event) => event.eventId === "fire-fire-auto-best-before");
    assert.equal(fired?.weapon, "shotgun");
    assert.equal(fired?.decision?.outcome, "hit-player");
    const damage = roomEvents(alice, "player.damaged")
      .find((event) => event.victimPlayerId === "party:client-b");
    assert.ok(damage, "expected auto-selected shotgun to damage Bob");
    assert.equal(damage.damage, 24);
    assert.equal(damage.health, 76);
    const attackerSnapshot = latestSnapshotPlayerForClient(alice, "client-a");
    assert.equal(attackerSnapshot.inventory.activeWeapon, "shotgun");
    assert.equal(attackerSnapshot.inventory.nails, 0);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room switches to axe after consuming the last shell instead of getting stuck on an empty shotgun", () => {
  const originalNow = Date.now;
  let now = 3_000_000;
  Date.now = () => now;
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "auto-best-weapon-after-last-shell",
    spawnDistance: 1.2,
  });
  try {
    const attacker = partyRoom.players.get("party:client-a");
    assert.ok(attacker, "expected attacker");
    const inventory = items.quakeMultiplayerPlayerInventory(attacker);
    inventory.activeWeapon = "shotgun";
    inventory.weapons = ["axe", "shotgun"];
    inventory.shells = 1;
    partyRoom.players.set("party:client-a", items.quakeMultiplayerPlayerWithInventory(attacker, inventory));

    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-last-shell",
      sequence: 2,
      fireSequence: 1,
      sentAt: now,
    })), alice);

    const firstFired = roomEvents(alice, "player.fired")
      .find((event) => event.eventId === "fire-fire-last-shell");
    assert.equal(firstFired?.weapon, "shotgun");
    const afterLastShell = latestSnapshotPlayerForClient(alice, "client-a");
    assert.equal(afterLastShell.inventory.shells, 0);
    assert.equal(afterLastShell.inventory.activeWeapon, "axe");

    now += 500;
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-after-last-shell",
      sequence: 3,
      fireSequence: 2,
      sentAt: now,
    })), alice);

    const secondFired = roomEvents(alice, "player.fired")
      .find((event) => event.eventId === "fire-fire-after-last-shell");
    assert.equal(secondFired?.weapon, "axe");
    const axeDamage = roomEvents(alice, "player.damaged")
      .find((event) =>
        event.eventId === "damage-fire-after-last-shell" &&
        event.damageSource === "axe"
      );
    assert.ok(axeDamage, "expected axe fire after empty shotgun");
    assert.equal(axeDamage.damage, 20);
    assert.equal(axeDamage.health, 56);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
    Date.now = originalNow;
  }
});

test("party room drops and removes a source-style backpack on player death", () => {
  const originalNow = Date.now;
  let now = 4_000_000;
  Date.now = () => now;
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "player-death-dropped-backpack",
    matchSettings: { fragLimit: 99 },
    spawnDistance: 4,
  });
  try {
    const victim = partyRoom.players.get("party:client-b");
    assert.ok(victim, "expected victim");
    const victimInventory = items.quakeMultiplayerPlayerInventory(victim);
    victimInventory.activeWeapon = "rocketlauncher";
    victimInventory.weapons = ["axe", "shotgun", "rocketlauncher"];
    victimInventory.shells = 4;
    victimInventory.rockets = 7;
    partyRoom.players.set("party:client-b", items.quakeMultiplayerPlayerWithInventory(victim, victimInventory));

    partyRoom.applyPlayerDamage({
      attackerPlayerId: "party:client-a",
      victimPlayerId: "party:client-b",
      damage: 150,
      source: "rocketlauncher",
      eventId: "death-backpack",
      now,
    });

    const dropped = roomEvents(alice, "pickup.dropped").find((event) =>
      event.sourcePlayerId === "party:client-b"
    );
    assert.ok(dropped, "expected dropped backpack event");
    assert.equal(dropped.definition.classname, "item_backpack");
    assert.equal(dropped.definition.runtime, true);
    assert.equal(dropped.definition.effect.shells, 4);
    assert.equal(dropped.definition.effect.rockets, 7);
    assert.equal(dropped.definition.effect.weapon.id, "rocketlauncher");
    assert.equal(dropped.pickup.available, true);

    const dropSnapshot = latestConnectionMessage(alice, "room.snapshot");
    assert.equal(
      dropSnapshot.payload.dynamicPickups.some((definition) =>
        definition.entityIndex === dropped.definition.entityIndex
      ),
      true,
    );
    assert.equal(
      dropSnapshot.payload.pickups.some((pickup) =>
        pickup.entityIndex === dropped.definition.entityIndex && pickup.available
      ),
      true,
    );

    const taker = partyRoom.players.get("party:client-a");
    assert.ok(taker, "expected taker");
    const takerInventory = items.quakeMultiplayerPlayerInventory(taker);
    takerInventory.shells = 0;
    takerInventory.rockets = 0;
    takerInventory.weapons = ["axe", "shotgun"];
    partyRoom.players.set("party:client-a", items.quakeMultiplayerPlayerWithInventory({
      ...taker,
      origin: dropped.definition.origin,
    }, takerInventory));

    now += 100;
    partyRoom.onMessage(JSON.stringify(pickupEnvelope({
      clientId: "client-a",
      messageId: "pickup-dropped-backpack",
      sequence: 2,
      pickupSequence: 1,
      sentAt: now,
      pickup: {
        entityIndex: dropped.definition.entityIndex,
        origin: dropped.definition.origin,
      },
    })), alice);

    const taken = roomEvents(alice, "pickup.taken").find((event) =>
      event.entityIndex === dropped.definition.entityIndex
    );
    assert.ok(taken, "expected dynamic backpack pickup event");
    assert.equal(taken.leaveInPlace, false);
    const afterPickup = latestSnapshotPlayerForClient(alice, "client-a");
    assert.equal(afterPickup.inventory.shells, 4);
    assert.equal(afterPickup.inventory.rockets, 7);
    assert.equal(afterPickup.inventory.weapons.includes("rocketlauncher"), true);
    assert.equal(afterPickup.inventory.activeWeapon, "rocketlauncher");

    const pickupSnapshot = latestConnectionMessage(alice, "room.snapshot");
    assert.equal(
      pickupSnapshot.payload.dynamicPickups.some((definition) =>
        definition.entityIndex === dropped.definition.entityIndex
      ),
      false,
    );
    assert.equal(
      pickupSnapshot.payload.pickups.some((pickup) =>
        pickup.entityIndex === dropped.definition.entityIndex
      ),
      false,
    );
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
    Date.now = originalNow;
  }
});

test("party room accepts grenade refire at the source 600ms cooldown", () => {
  const originalNow = Date.now;
  let now = 2_000_000;
  Date.now = () => now;
  const { alice, bob, partyRoom } = connectDuelRoom({ id: "grenade-source-cooldown" });
  try {
    setPartyRoomPlayerWeapon(partyRoom, "client-a", "grenadelauncher");
    for (let index = 0; index < 2; index += 1) {
      partyRoom.onMessage(JSON.stringify(fireEnvelope({
        clientId: "client-a",
        messageId: `fire-grenade-cooldown-${index}`,
        sequence: 2 + index,
        fireSequence: 1 + index,
        sentAt: now,
        fire: { direction: [-1, 0, 0] },
      })), alice);
      now += 600;
    }

    const fired = roomEvents(alice, "player.fired")
      .filter((event) =>
        event.playerId === "party:client-a" &&
        event.weapon === "grenadelauncher"
      );
    assert.equal(fired.length, 2);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
    Date.now = originalNow;
  }
});

test("party room applies repeated authoritative damage until death across sustained-fire weapons", () => {
  const cases = [
    { weapon: "axe", spawnDistance: 1.2, stepMs: 500, damagedHealths: [80, 60, 40, 20], killHealth: 0 },
    { weapon: "shotgun", spawnDistance: 4, stepMs: 500, damagedHealths: [76, 52, 28, 4], killHealth: -20 },
    { weapon: "supershotgun", spawnDistance: 4, stepMs: 700, damagedHealths: [44], killHealth: -12 },
    { weapon: "nailgun", spawnDistance: 4, stepMs: 200, damagedHealths: [91, 82, 73, 64, 55, 46, 37, 28, 19, 10, 1], killHealth: -8 },
    { weapon: "supernailgun", spawnDistance: 4, stepMs: 200, damagedHealths: [82, 64, 46, 28, 10], killHealth: -8 },
    { weapon: "lightning", spawnDistance: 4, stepMs: 200, damagedHealths: [70, 40, 10], killHealth: -20 },
  ];
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    for (const spec of cases) {
      const { alice, bob, partyRoom } = connectDuelRoom({
        id: `repeated-${spec.weapon}`,
        spawnDistance: spec.spawnDistance,
      });
      try {
        setPartyRoomPlayerWeapon(partyRoom, "client-a", spec.weapon);
        for (let index = 0; index <= spec.damagedHealths.length; index += 1) {
          now += spec.stepMs;
          partyRoom.onMessage(JSON.stringify(fireEnvelope({
            clientId: "client-a",
            messageId: `fire-repeated-${spec.weapon}-${index}`,
            sequence: 2 + index,
            fireSequence: 1 + index,
            sentAt: now,
            fire: { weapon: spec.weapon },
          })), alice);
          if (projectileAuthority.quakeMultiplayerServerProjectileWeaponSupported(spec.weapon)) {
            now += 400;
            partyRoom.advanceRoomSimulation(now);
          }
          const expectedHealth = spec.damagedHealths[index];
          if (expectedHealth !== undefined) {
            const event = roomEvents(alice, "player.damaged")
              .find((candidate) =>
                candidate.victimPlayerId === "party:client-b" &&
                candidate.damageSource === spec.weapon &&
                candidate.health === expectedHealth
              );
            assert.ok(event, `expected repeated ${spec.weapon} damage ${index + 1}`);
            assert.equal(event.health, expectedHealth, `${spec.weapon} health after shot ${index + 1}`);
            assert.equal(latestSnapshotPlayerForClient(alice, "client-b").health, expectedHealth);
          } else {
            const event = roomEvents(alice, "player.killed")
              .find((candidate) =>
                candidate.victimPlayerId === "party:client-b" &&
                candidate.damageSource === spec.weapon
              );
            assert.ok(event, `expected repeated ${spec.weapon} kill`);
            const victim = latestSnapshotPlayerForClient(alice, "client-b");
            assert.equal(victim.alive, false, `${spec.weapon} victim alive after kill`);
            assert.equal(victim.health, spec.killHealth, `${spec.weapon} victim health after kill`);
          }
        }
        assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0, `${spec.weapon} alice rejects`);
        assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0, `${spec.weapon} bob rejects`);
      } finally {
        cleanupDuelRoom(partyRoom, alice, bob);
        now += 10_000;
      }
    }
  } finally {
    Date.now = originalNow;
  }
});

test("party room applies damage when LOS trace only clips the target skin", () => {
  const collisionWorld = {
    traceUse: () => ({
      fraction: 0.9856583826296409,
      end: [3.92, 0, -0.82],
      planeNormal: [0, 0, 1],
      entityIndex: 84,
      modelIndex: 3,
      classname: "func_wall",
    }),
  };
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "late-target-skin-los",
    roomOptions: {
      trustedSceneMovement: {
        collisionWorld,
        playerEyeHeight: 1.0,
      },
    },
    spawnDistance: 4,
  });
  try {
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-late-target-skin-los",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
    })), alice);

    const event = roomEvents(alice, "player.damaged")
      .find((candidate) =>
        candidate.attackerPlayerId === "party:client-a" &&
        candidate.victimPlayerId === "party:client-b" &&
        candidate.damageSource === "shotgun"
      );
    assert.ok(event, "expected late target-skin LOS trace to allow damage");
    assert.equal(event.damage, 24);
    assert.equal(event.health, 76);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room uses fire payload aim when the authoritative pose is one input behind", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "fresh-fire-aim-stale-pose",
    spawnDistance: 4,
  });
  try {
    const attacker = partyRoom.players.get("party:client-a");
    assert.ok(attacker, "expected attacker");
    partyRoom.players.set("party:client-a", {
      ...attacker,
      rotX: -78,
      rotY: 180,
    });

    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-fresh-aim-stale-pose",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
      fire: { direction: DUEL_FORWARD_DIRECTION },
    })), alice);

    const event = roomEvents(alice, "player.damaged")
      .find((candidate) =>
        candidate.attackerPlayerId === "party:client-a" &&
        candidate.victimPlayerId === "party:client-b"
      );
    assert.ok(event, "expected fresh fire aim to damage despite stale authoritative yaw");
    assert.equal(event.damage, 24);
    assert.equal(event.health, 76);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room uses a bounded fire origin hint when the authoritative origin is one input behind", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "fresh-fire-origin-stale-pose",
    spawnDistance: 4,
  });
  try {
    const victim = partyRoom.players.get("party:client-b");
    assert.ok(victim, "expected victim");
    partyRoom.players.set("party:client-b", {
      ...victim,
      origin: [victim.origin[0], 0.9, victim.origin[2]],
    });

    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-fresh-origin-stale-pose",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
      fire: { origin: [0, 0.4, 0] },
    })), alice);

    const event = roomEvents(alice, "player.damaged")
      .find((candidate) =>
        candidate.attackerPlayerId === "party:client-a" &&
        candidate.victimPlayerId === "party:client-b"
      );
    assert.ok(event, "expected bounded fire origin hint to damage despite stale authoritative origin");
    assert.equal(event.damage, 24);
    assert.equal(event.health, 76);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room rewinds hit tests from authoritative snapshot history instead of current velocity", () => {
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "historical-hit-stopped-target",
    spawnDistance: 4,
  });
  try {
    const attacker = partyRoom.players.get("party:client-a");
    const target = partyRoom.players.get("party:client-b");
    assert.ok(attacker, "expected attacker");
    assert.ok(target, "expected target");
    partyRoom.players.set("party:client-a", {
      ...attacker,
      origin: [0, 0, 0],
      velocity: [0, 0, 0],
      updatedAt: now,
    });
    partyRoom.players.set("party:client-b", {
      ...target,
      origin: [4, 0, 0],
      velocity: [0, 0, 0],
      updatedAt: now,
    });
    partyRoom.broadcastSnapshot();

    now += 100;
    partyRoom.players.set("party:client-b", {
      ...partyRoom.players.get("party:client-b"),
      origin: [4, 1.4, 0],
      velocity: [0, 0, 0],
      updatedAt: now,
    });
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-historical-stopped-target",
      sequence: 2,
      fireSequence: 1,
      sentAt: now,
      fire: {
        origin: [0, 0, -0.36],
        direction: [1, 0, 0],
      },
    })), alice);

    const event = roomEvents(alice, "player.damaged")
      .find((candidate) =>
        candidate.attackerPlayerId === "party:client-a" &&
        candidate.victimPlayerId === "party:client-b" &&
        candidate.damageSource === "shotgun"
      );
    assert.ok(event, "expected historical target sample to receive damage");
    assert.equal(event.damage, 24);
    assert.equal(event.health, 76);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-b").health, 76);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
    Date.now = originalNow;
  }
});

test("party room still blocks damage when LOS trace hits a real wall", () => {
  const collisionWorld = {
    traceUse: () => ({
      fraction: 0.5,
      end: [2, 0, -0.5],
      planeNormal: [1, 0, 0],
      entityIndex: 900,
      modelIndex: 9,
      classname: "func_wall",
    }),
  };
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "mid-wall-los",
    roomOptions: {
      trustedSceneMovement: {
        collisionWorld,
        playerEyeHeight: 1.0,
      },
    },
    spawnDistance: 4,
  });
  try {
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-mid-wall-los",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
    })), alice);

    const event = roomEvents(alice, "player.damaged")
      .find((candidate) =>
        candidate.attackerPlayerId === "party:client-a" &&
        candidate.victimPlayerId === "party:client-b"
      );
    assert.equal(event, undefined);
    const bobPlayer = latestSnapshotPlayerForClient(alice, "client-b");
    assert.equal(bobPlayer.health, 100);
    const fired = roomEvents(alice, "player.fired").find((candidate) =>
      candidate.eventId === "fire-fire-mid-wall-los"
    );
    assert.equal(fired?.decision?.outcome, "miss");
    assert.equal(fired?.decision?.reason, "line-of-sight-blocked");
    assert.equal(fired?.decision?.candidateCount, 1);
    assert.equal(fired?.decision?.blockedCandidateCount, 1);
    assert.equal(fired?.decision?.playerDamageCount, 0);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room damages a farther visible player when a nearer candidate is blocked", () => {
  const collisionWorld = {
    traceUse: (_origin, impact) => impact[0] < 3
      ? {
          fraction: 0.5,
          end: [1, 0, -0.5],
          planeNormal: [1, 0, 0],
          entityIndex: 44,
          modelIndex: 2,
          classname: "func_wall",
        }
      : null,
  };
  const { alice, bob, cara, partyRoom } = connectTripleRoom({
    id: "blocked-nearer-visible-farther",
    roomOptions: {
      trustedSceneMovement: {
        collisionWorld,
        playerEyeHeight: 1.0,
      },
    },
    spawns: [
      { spawnId: "spawn-a", classname: "info_player_deathmatch", origin: [0, 0, 0], rotX: -78, rotY: 0 },
      { spawnId: "spawn-b", classname: "info_player_deathmatch", origin: [2, 0, 0], rotX: -78, rotY: 180 },
      { spawnId: "spawn-c", classname: "info_player_deathmatch", origin: [4, 0, 0], rotX: -78, rotY: 180 },
    ],
  });
  try {
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-blocked-near-visible-far",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
    })), alice);

    const damagedEvents = roomEvents(alice, "player.damaged");
    assert.equal(damagedEvents.some((event) => event.victimPlayerId === "party:client-b"), false);
    const farEvent = damagedEvents.find((event) => event.victimPlayerId === "party:client-c");
    assert.ok(farEvent, "expected farther visible player to take damage");
    assert.equal(farEvent.damage, 24);
    assert.equal(farEvent.health, 76);
    const fired = roomEvents(alice, "player.fired").find((candidate) =>
      candidate.eventId === "fire-fire-blocked-near-visible-far"
    );
    assert.equal(fired?.decision?.outcome, "hit-player");
    assert.equal(fired?.decision?.reason, "player-direct");
    assert.equal(fired?.decision?.targetPlayerId, "party:client-c");
    assert.equal(fired?.decision?.candidateCount, 2);
    assert.equal(fired?.decision?.blockedCandidateCount, 1);
    assert.equal(fired?.decision?.playerDamageCount, 1);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-b").health, 100);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-c").health, 76);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupPartyRoomConnections(partyRoom, alice, bob, cara);
  }
});

test("party room blocks indirect projectile splash through walls", () => {
  const collisionWorld = {
    traceUse: (_origin, point) => point[1] > 1
      ? {
          fraction: 0.4,
          end: [point[0], 1, point[2]],
          planeNormal: [0, -1, 0],
          entityIndex: 45,
          modelIndex: 3,
          classname: "func_wall",
        }
      : null,
  };
  const { alice, bob, cara, partyRoom } = connectTripleRoom({
    id: "projectile-splash-wall",
    roomOptions: {
      trustedSceneMovement: {
        collisionWorld,
        playerEyeHeight: 1.0,
      },
    },
    spawns: [
      { spawnId: "spawn-a", classname: "info_player_deathmatch", origin: [0, 0, 0], rotX: -78, rotY: 0 },
      { spawnId: "spawn-b", classname: "info_player_deathmatch", origin: [3, 0, 0], rotX: -78, rotY: 180 },
      { spawnId: "spawn-c", classname: "info_player_deathmatch", origin: [3, 2, 0], rotX: -78, rotY: 180 },
    ],
  });
  try {
    setPartyRoomPlayerWeapon(partyRoom, "client-a", "rocketlauncher");
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-splash-wall",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
    })), alice);
    partyRoom.advanceRoomSimulation(Date.now() + 400);

    const damagedEvents = roomEvents(alice, "player.damaged");
    const killedEvents = roomEvents(alice, "player.killed");
    assert.ok(killedEvents.some((event) => event.victimPlayerId === "party:client-b"));
    assert.equal(damagedEvents.some((event) => event.victimPlayerId === "party:client-c"), false);
    assert.equal(killedEvents.some((event) => event.victimPlayerId === "party:client-c"), false);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-c").health, 100);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-c").alive, true);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupPartyRoomConnections(partyRoom, alice, bob, cara);
  }
});

test("party room applies projectile wall-impact splash without a direct player hit", () => {
  const collisionWorld = {
    traceUse: (origin, point) => origin[0] === 0 && point[0] > 10
      ? {
          fraction: 3 / 64,
          end: [3, 0, 0],
          planeNormal: [-1, 0, 0],
          entityIndex: 44,
          modelIndex: 3,
          classname: "func_wall",
        }
      : null,
  };
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "projectile-wall-splash",
    roomOptions: {
      trustedSceneMovement: {
        collisionWorld,
        playerEyeHeight: 1.0,
      },
    },
  });
  try {
    setPartyRoomPlayerWeapon(partyRoom, "client-a", "rocketlauncher");
    const bobPlayer = partyRoom.players.get("party:client-b");
    assert.ok(bobPlayer, "expected bob player");
    partyRoom.players.set("party:client-b", {
      ...bobPlayer,
      origin: [3, 2, 0],
      updatedAt: Date.now(),
    });

    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-wall-splash",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
      fire: {
        direction: [1, 0, 0],
      },
    })), alice);
    partyRoom.advanceRoomSimulation(Date.now() + 2_000);

    const damagedEvents = roomEvents(alice, "player.damaged");
    const bobDamage = damagedEvents.find((event) => event.victimPlayerId === "party:client-b");
    const aliceDamage = damagedEvents.find((event) => event.victimPlayerId === "party:client-a");
    assert.ok(bobDamage, "expected wall splash to damage nearby non-direct target");
    assert.equal(bobDamage.damage, 69);
    assert.equal(bobDamage.health, 31);
    assert.ok(aliceDamage, "expected wall splash to apply half self damage");
    assert.equal(aliceDamage.damage, 22);
    assert.equal(aliceDamage.health, 78);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-b").health, 31);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-a").health, 78);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room applies projectile quad damage from impact-time attacker state", () => {
  const originalNow = Date.now;
  let now = 3_000_000;
  Date.now = () => now;
  const cases = [
    {
      id: "quad-expired-before-impact",
      setup: (partyRoom) => setPartyRoomPlayerQuad(partyRoom, "client-a", now + 50),
      expectedDamage: 9,
      expectedHealth: 91,
    },
    {
      id: "quad-picked-up-before-impact",
      setup: () => {},
      beforeImpact: (partyRoom) => setPartyRoomPlayerQuad(partyRoom, "client-a", now + 10_000),
      expectedDamage: 36,
      expectedHealth: 64,
    },
  ];

  try {
    for (const spec of cases) {
      const { alice, bob, partyRoom } = connectDuelRoom({
        id: spec.id,
        spawnDistance: 4,
      });
      try {
        setPartyRoomPlayerWeapon(partyRoom, "client-a", "nailgun");
        spec.setup(partyRoom);
        partyRoom.onMessage(JSON.stringify(fireEnvelope({
          clientId: "client-a",
          messageId: `fire-${spec.id}`,
          sequence: 2,
          fireSequence: 1,
          sentAt: now,
        })), alice);

        assert.equal(
          roomEvents(alice, "player.damaged")
            .some((candidate) => candidate.damageSource === "nailgun"),
          false,
          "nail projectile should not damage on the fire tick",
        );
        spec.beforeImpact?.(partyRoom);
        now += 400;
        partyRoom.advanceRoomSimulation(now);

        const event = roomEvents(alice, "player.damaged")
          .find((candidate) =>
            candidate.attackerPlayerId === "party:client-a" &&
            candidate.victimPlayerId === "party:client-b" &&
            candidate.damageSource === "nailgun"
          );
        assert.ok(event, `expected nailgun damage for ${spec.id}`);
        assert.equal(event.damage, spec.expectedDamage, spec.id);
        assert.equal(event.health, spec.expectedHealth, spec.id);
        assert.equal(event.roomTime, 400, spec.id);
        const impact = roomEvents(alice, "projectile.impacted")
          .find((candidate) => candidate.weapon === "nailgun");
        assert.equal(impact?.roomTime, 400, spec.id);
        assert.equal(latestSnapshotPlayerForClient(alice, "client-b").health, spec.expectedHealth);
        assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
        assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
      } finally {
        cleanupDuelRoom(partyRoom, alice, bob);
      }
      now += 1_000;
    }
  } finally {
    Date.now = originalNow;
  }
});

test("party room applies delayed projectile victim powerups at simulation impact time", () => {
  const originalNow = Date.now;
  const fireNow = 3_100_000;
  Date.now = () => fireNow;
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "projectile-victim-powerup-impact-time",
    spawnDistance: 4,
  });
  try {
    setPartyRoomPlayerWeapon(partyRoom, "client-a", "nailgun");
    setPartyRoomPlayerInvulnerable(partyRoom, "client-b", fireNow + 50);
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-projectile-victim-powerup-impact-time",
      sequence: 2,
      fireSequence: 1,
      sentAt: fireNow,
      fire: {
        weapon: "nailgun",
        fireKind: "projectile",
      },
    })), alice);

    partyRoom.advanceRoomSimulation(fireNow + 400);

    const event = roomEvents(alice, "player.damaged")
      .find((candidate) =>
        candidate.attackerPlayerId === "party:client-a" &&
        candidate.victimPlayerId === "party:client-b" &&
        candidate.damageSource === "nailgun"
      );
    assert.ok(event, "expected expired victim invulnerability not to block delayed projectile damage");
    assert.equal(event.damage, 9);
    assert.equal(event.health, 91);
    assert.equal(event.roomTime, 400);
    const impact = roomEvents(alice, "projectile.impacted")
      .find((candidate) => candidate.weapon === "nailgun");
    assert.equal(impact?.roomTime, 400);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-b").health, 91);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
    Date.now = originalNow;
  }
});

test("server grenade projectile advances through delayed arc impact damage", () => {
  const projectile = projectileAuthority.createQuakeMultiplayerServerProjectile({
    fire: {
      fireSequence: 1,
      firedAt: 100,
      fireKind: "projectile",
      weapon: "grenadelauncher",
      origin: [0, 0, 0],
      direction: DUEL_FORWARD_DIRECTION,
      range: 1024,
    },
    now: 100,
    ownerPlayerId: "party:client-a",
    projectileId: "grenade-arc-1",
  });
  assert.ok(projectile, "expected grenade launcher to create a server projectile");
  assert.equal(projectile.weapon, "grenadelauncher");
  assert.equal(projectileAuthority.quakeMultiplayerServerProjectileWeaponSupported("grenadelauncher"), true);
  assert.ok(projectile.gravity > 0, "expected grenade projectile to carry gravity");
  assert.ok(projectile.velocity[2] > projectile.direction[2] * projectile.speed, "expected grenade launch kick");

  const target = createPlayer({
    playerId: "party:client-b",
    clientId: "client-b",
    displayName: "Bob",
    origin: [4, 0, 0],
    rotX: -78,
    rotY: 180,
    updatedAt: 100,
  });
  const immediate = projectileAuthority.advanceQuakeMultiplayerServerProjectile(projectile, {
    collisionWorld: null,
    now: 100,
    players: [target],
  });
  assert.equal(immediate.type, "active", "grenade should not damage on the fire tick");

  const delayed = projectileAuthority.advanceQuakeMultiplayerServerProjectile(projectile, {
    collisionWorld: null,
    now: 500,
    players: [target],
  });
  assert.equal(delayed.type, "impact");
  assert.equal(delayed.impact.kind, "player");
  assert.equal(delayed.impact.targetPlayerId, "party:client-b");
  const hit = delayed.impact.damageHits.find((candidate) => candidate.target.playerId === "party:client-b");
  assert.ok(hit, "expected delayed grenade impact to damage target");
  assert.equal(hit.damage, 87);
  assert.equal(hit.direct, false);
});

test("server grenade projectile bounces on world impact and explodes on fuse expiry", () => {
  const projectile = projectileAuthority.createQuakeMultiplayerServerProjectile({
    fire: {
      fireSequence: 1,
      firedAt: 100,
      fireKind: "projectile",
      weapon: "grenadelauncher",
      origin: [0, 0, 1],
      direction: [1, 0, 0],
      range: 1024,
    },
    now: 100,
    ownerPlayerId: "party:client-a",
    projectileId: "grenade-bounce-1",
  });
  assert.ok(projectile, "expected grenade launcher to create a server projectile");
  const fallingProjectile = {
    ...projectile,
    direction: [0.24253562503633297, 0, -0.9701425001453319],
    gravity: 0,
    speed: Math.hypot(2, 0, -8),
    velocity: [2, 0, -8],
  };
  const collisionWorld = {
    traceUse: (origin, end) => {
      if (origin[2] <= 0 || end[2] > 0) return null;
      const fraction = origin[2] / (origin[2] - end[2]);
      return {
        fraction,
        end: [
          origin[0] + (end[0] - origin[0]) * fraction,
          origin[1] + (end[1] - origin[1]) * fraction,
          0,
        ],
        planeNormal: [0, 0, 1],
        entityIndex: 44,
        modelIndex: 3,
        classname: "func_floor",
      };
    },
  };

  const bounced = projectileAuthority.advanceQuakeMultiplayerServerProjectile(fallingProjectile, {
    collisionWorld,
    now: 300,
    players: [],
  });
  assert.equal(bounced.type, "active");
  assert.ok(bounced.projectile.origin[2] > 0, "expected bounced grenade to be offset off the impact plane");
  assert.ok(bounced.projectile.velocity[2] > 0, "expected bounced grenade to reflect upward");

  const target = createPlayer({
    playerId: "party:client-b",
    clientId: "client-b",
    displayName: "Bob",
    origin: [bounced.projectile.origin[0], bounced.projectile.origin[1], 0],
    updatedAt: 300,
  });
  const expired = projectileAuthority.advanceQuakeMultiplayerServerProjectile(bounced.projectile, {
    collisionWorld: null,
    now: bounced.projectile.expiresAt + 1,
    players: [target],
  });
  assert.equal(expired.type, "impact");
  assert.equal(expired.impact.kind, "world");
  const hit = expired.impact.damageHits.find((candidate) => candidate.target.playerId === "party:client-b");
  assert.ok(hit, "expected grenade fuse explosion to apply splash damage");
  assert.equal(hit.direct, false);
  assert.ok(hit.damage > 0);
});

test("party room snapshots active server projectile positions", () => {
  const originalNow = Date.now;
  let now = 2_500_000;
  Date.now = () => now;
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "projectile-snapshot-position",
    spawnDistance: 20,
  });
  try {
    setPartyRoomPlayerWeapon(partyRoom, "client-a", "rocketlauncher");
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-projectile-snapshot-position",
      sequence: 2,
      fireSequence: 1,
      sentAt: now,
      fire: {
        weapon: "rocketlauncher",
      },
    })), alice);

    const spawned = roomEvents(alice, "projectile.spawned")
      .find((candidate) => candidate.projectile.weapon === "rocketlauncher");
    assert.ok(spawned, "expected projectile.spawned event");
    const initialSnapshot = latestConnectionMessage(alice, "room.snapshot");
    const initialProjectile = initialSnapshot.payload.projectiles
      ?.find((candidate) => candidate.projectileId === spawned.projectile.projectileId);
    assert.ok(initialProjectile, "expected initial snapshot to carry active projectile");
    assert.deepEqual(initialProjectile.origin, spawned.projectile.origin);

    now += 100;
    partyRoom.advanceRoomSimulation(now);
    partyRoom.broadcastSnapshot();
    const movedSnapshot = latestConnectionMessage(alice, "room.snapshot");
    const movedProjectile = movedSnapshot.payload.projectiles
      ?.find((candidate) => candidate.projectileId === spawned.projectile.projectileId);
    assert.ok(movedProjectile, "expected later snapshot to keep active projectile");
    assert.equal(movedProjectile.updatedAt, now);
    assert.ok(
      movedProjectile.origin[0] > initialProjectile.origin[0],
      "expected active projectile snapshot origin to advance",
    );
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    Date.now = originalNow;
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("client authority rejects non-hello first messages and client id swaps", () => {
  const input = inputEnvelope({ sequence: 1, inputSequence: 1, sentAt: 100 });
  const firstResult = authority.validateQuakeMultiplayerClientAuthority(input, null, { now: 100 });
  assert.equal(firstResult.ok, false);
  assert.equal(firstResult.reject.code, "not-authorized");
  assert.equal(firstResult.reject.recoverable, false);

  const helloResult = authority.validateQuakeMultiplayerClientAuthority(
    helloEnvelope({ sequence: 1, sentAt: 100 }),
    null,
    { now: 100 },
  );
  assert.equal(helloResult.ok, true);

  const swappedClient = inputEnvelope({
    clientId: "client-b",
    sequence: 2,
    inputSequence: 1,
    sentAt: 130,
  });
  const swappedResult = authority.validateQuakeMultiplayerClientAuthority(swappedClient, helloResult.state, {
    now: 130,
  });
  assert.equal(swappedResult.ok, false);
  assert.equal(swappedResult.reject.code, "not-authorized");
  assert.equal(swappedResult.reject.recoverable, false);
});

test("client authority rejects replayed envelope and intent sequences independently", () => {
  const helloResult = authority.validateQuakeMultiplayerClientAuthority(
    helloEnvelope({ sequence: 1, sentAt: 100 }),
    null,
    { now: 100 },
  );
  assert.equal(helloResult.ok, true);

  const inputOne = inputEnvelope({ sequence: 2, inputSequence: 1, sentAt: 120 });
  const inputOneResult = authority.validateQuakeMultiplayerClientAuthority(inputOne, helloResult.state, { now: 120 });
  assert.equal(inputOneResult.ok, true);

  const replayedEnvelope = inputEnvelope({ sequence: 2, inputSequence: 2, sentAt: 140 });
  const replayedEnvelopeResult = authority.validateQuakeMultiplayerClientAuthority(
    replayedEnvelope,
    inputOneResult.state,
    { now: 140 },
  );
  assert.equal(replayedEnvelopeResult.ok, false);
  assert.equal(replayedEnvelopeResult.reject.code, "stale");

  const replayedIntent = inputEnvelope({ sequence: 3, inputSequence: 1, sentAt: 150 });
  const replayedIntentResult = authority.validateQuakeMultiplayerClientAuthority(
    replayedIntent,
    inputOneResult.state,
    { now: 150 },
  );
  assert.equal(replayedIntentResult.ok, false);
  assert.equal(replayedIntentResult.reject.code, "stale");
  assert.match(replayedIntentResult.reject.message, /input sequence/);
});

test("client authority accepts rapid ordered input samples without rate-window rejects", () => {
  const helloResult = authority.validateQuakeMultiplayerClientAuthority(
    helloEnvelope({ sequence: 1, sentAt: 100 }),
    null,
    { now: 100 },
  );
  assert.equal(helloResult.ok, true);

  const firstInputResult = authority.validateQuakeMultiplayerClientAuthority(
    inputEnvelope({ sequence: 2, inputSequence: 1, sentAt: 120 }),
    helloResult.state,
    { now: 120 },
  );
  assert.equal(firstInputResult.ok, true);

  const bunchedInputResult = authority.validateQuakeMultiplayerClientAuthority(
    inputEnvelope({ sequence: 3, inputSequence: 2, sentAt: 124 }),
    firstInputResult.state,
    { now: 124 },
  );
  assert.equal(bunchedInputResult.ok, true);
  assert.equal(bunchedInputResult.state.lastIntentSequences.input, 2);
});

test("client authority advances input intent sequence from ordered batches", () => {
  const helloResult = authority.validateQuakeMultiplayerClientAuthority(
    helloEnvelope({ sequence: 1, sentAt: 100 }),
    null,
    { now: 100 },
  );
  assert.equal(helloResult.ok, true);

  const batchResult = authority.validateQuakeMultiplayerClientAuthority(
    inputBatchEnvelope({ sequence: 2, inputSequences: [1, 2, 3], sentAt: 120 }),
    helloResult.state,
    { now: 120 },
  );
  assert.equal(batchResult.ok, true);
  assert.equal(batchResult.state.lastIntentSequences.input, 3);

  const replayedIntent = authority.validateQuakeMultiplayerClientAuthority(
    inputBatchEnvelope({ sequence: 3, inputSequences: [2, 3], sentAt: 140 }),
    batchResult.state,
    { now: 140 },
  );
  assert.equal(replayedIntent.ok, false);
  assert.equal(replayedIntent.reject.code, "stale");
  assert.match(replayedIntent.reject.message, /input sequence/);
});

test("client authority accepts immediate presence transitions", () => {
  const helloResult = authority.validateQuakeMultiplayerClientAuthority(
    helloEnvelope({ sequence: 1, sentAt: 100 }),
    null,
    { now: 100 },
  );
  assert.equal(helloResult.ok, true);

  const pausedResult = authority.validateQuakeMultiplayerClientAuthority(
    presenceEnvelope("input-paused", { sequence: 2, messageId: "presence-paused", sentAt: 120 }),
    helloResult.state,
    { now: 120 },
  );
  assert.equal(pausedResult.ok, true);

  const activeResult = authority.validateQuakeMultiplayerClientAuthority(
    presenceEnvelope("active", { sequence: 3, messageId: "presence-active", sentAt: 121 }),
    pausedResult.state,
    { now: 121 },
  );
  assert.equal(activeResult.ok, true);
});

test("party room keeps hello authority while trusted gameplay definitions are pending", async () => {
  const { room, createConnection } = createFakePartyRoom();
  const RoomClass = partyRoomModule.default;
  let resolveTrustedDefinitions;
  const trustedDefinitions = new Promise((resolve) => {
    resolveTrustedDefinitions = resolve;
  });
  const partyRoom = new RoomClass(room, {
    trustedGameplayDefinitionsFetcher: () => trustedDefinitions,
  });
  const connection = createConnection("pending-hello-connection");

  partyRoom.onConnect(connection);
  const helloResult = partyRoom.onMessage(JSON.stringify(helloEnvelope({
    messageId: "pending-hello",
    sequence: 1,
    sentAt: Date.now(),
  })), connection);
  partyRoom.onMessage(JSON.stringify(presenceEnvelope("active", {
    messageId: "presence-while-hello-pending",
    sequence: 2,
    sentAt: Date.now(),
  })), connection);

  assert.equal(connection.closed.length, 0);
  assert.equal(connection.messages.some((message) =>
    message.type === "room.reject" &&
    message.payload.code === "not-authorized"
  ), false);
  assert.equal(connection.state.authority.lastEnvelopeSequence, 2);

  resolveTrustedDefinitions({
    gameplayFacts: {
      factsVersion: 1,
      factsHash: "0000000000000000",
      deathmatchSpawnCount: 0,
      pickupCount: 0,
    },
    deathmatchSpawns: [],
    pickupDefinitions: [],
  });
  await Promise.resolve(helloResult);

  assert.equal(connection.state.playerId, "party:client-a");
  assert.equal(connection.state.authority.lastEnvelopeSequence, 2);
});

test("room wrong-map rejects validate even when their room key differs", () => {
  const reject = protocol.createQuakeMultiplayerEnvelope({
    direction: "room",
    type: "room.reject",
    roomKey: {
      ...NORMALIZED_ROOM_KEY,
      mapName: "e1m2",
      sceneUrl: "/q/e1m2.json",
    },
    sequence: 1,
    sentAt: 100,
    payload: {
      code: "wrong-map",
      message: "Room is running a different map.",
      recoverable: false,
      rejectedMessageId: "client-hello-1",
    },
  });

  const result = validation.validateQuakeMultiplayerRoomEnvelope(reject, {
    roomKey: NORMALIZED_ROOM_KEY,
    now: 100,
  });
  assert.equal(result.ok, true);
});

test("room player fired events validate optional fire decisions", () => {
  const event = protocol.createQuakeMultiplayerEnvelope({
    direction: "room",
    type: "room.event",
    roomKey: NORMALIZED_ROOM_KEY,
    sequence: 1,
    sentAt: 100,
    payload: {
      roomId: "room-fired-decision",
      tick: 1,
      sequence: 1,
      event: {
        eventType: "player.fired",
        eventId: "fire-with-decision",
        roomTime: 100,
        playerId: "party:client-a",
        weapon: "shotgun",
        fireKind: "hitscan",
        origin: [0, 0, 0],
        direction: [1, 0, 0],
        decision: {
          blockedCandidateCount: 1,
          candidateCount: 1,
          outcome: "miss",
          playerDamageCount: 0,
          reason: "line-of-sight-blocked",
          targetRewindMs: 100,
        },
      },
    },
  });
  const result = validation.validateQuakeMultiplayerRoomEnvelope(event, {
    roomKey: NORMALIZED_ROOM_KEY,
    now: 100,
  });
  assert.equal(result.ok, true);

  const invalid = validation.validateQuakeMultiplayerRoomEnvelope({
    ...event,
    payload: {
      ...event.payload,
      event: {
        ...event.payload.event,
        decision: {
          ...event.payload.event.decision,
          reason: "not-a-real-reason",
        },
      },
    },
  }, {
    roomKey: NORMALIZED_ROOM_KEY,
    now: 100,
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "malformed");
});

test("room projectile lifecycle events validate authoritative projectile state", () => {
  const spawned = protocol.createQuakeMultiplayerEnvelope({
    direction: "room",
    type: "room.event",
    roomKey: NORMALIZED_ROOM_KEY,
    sequence: 1,
    sentAt: 100,
    payload: {
      roomId: "room-projectile-events",
      tick: 1,
      sequence: 1,
      event: {
        eventType: "projectile.spawned",
        eventId: "projectile-spawned-1",
        roomTime: 100,
        projectile: {
          projectileId: "projectile-1",
          ownerPlayerId: "party:client-a",
          weapon: "rocketlauncher",
          origin: [0, 0, 0],
          direction: [1, 0, 0],
          speed: 15.625,
          spawnedAt: 100,
          updatedAt: 100,
          expiresAt: 5100,
        },
      },
    },
  });
  assert.equal(validation.validateQuakeMultiplayerRoomEnvelope(spawned, {
    roomKey: NORMALIZED_ROOM_KEY,
    now: 100,
  }).ok, true);

  const snapshot = protocol.createQuakeMultiplayerEnvelope({
    direction: "room",
    type: "room.snapshot",
    roomKey: NORMALIZED_ROOM_KEY,
    sequence: 2,
    sentAt: 150,
    payload: {
      roomId: "room-projectile-events",
      tick: 2,
      roomTime: 150,
      match: {
        status: "active",
        clockMs: 150,
      },
      players: [],
      spectators: [],
      pickups: [],
      projectiles: [spawned.payload.event.projectile],
      lastWorldEventSequence: 0,
    },
  });
  assert.equal(validation.validateQuakeMultiplayerRoomEnvelope(snapshot, {
    roomKey: NORMALIZED_ROOM_KEY,
    now: 150,
  }).ok, true);

  const invalidSnapshot = validation.validateQuakeMultiplayerRoomEnvelope({
    ...snapshot,
    payload: {
      ...snapshot.payload,
      projectiles: [{
        ...snapshot.payload.projectiles[0],
        speed: -1,
      }],
    },
  }, {
    roomKey: NORMALIZED_ROOM_KEY,
    now: 150,
  });
  assert.equal(invalidSnapshot.ok, false);
  assert.equal(invalidSnapshot.code, "malformed");

  const impacted = protocol.createQuakeMultiplayerEnvelope({
    direction: "room",
    type: "room.event",
    roomKey: NORMALIZED_ROOM_KEY,
    sequence: 2,
    sentAt: 200,
    payload: {
      roomId: "room-projectile-events",
      tick: 2,
      sequence: 2,
      event: {
        eventType: "projectile.impacted",
        eventId: "projectile-impacted-1",
        roomTime: 200,
        projectileId: "projectile-1",
        ownerPlayerId: "party:client-a",
        weapon: "rocketlauncher",
        origin: [4, 0, 0],
        impactKind: "player",
        playerDamageCount: 1,
        targetPlayerId: "party:client-b",
      },
    },
  });
  assert.equal(validation.validateQuakeMultiplayerRoomEnvelope(impacted, {
    roomKey: NORMALIZED_ROOM_KEY,
    now: 200,
  }).ok, true);

  const invalid = validation.validateQuakeMultiplayerRoomEnvelope({
    ...impacted,
    payload: {
      ...impacted.payload,
      event: {
        ...impacted.payload.event,
        impactKind: "ceiling",
      },
    },
  }, {
    roomKey: NORMALIZED_ROOM_KEY,
    now: 200,
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "malformed");
});

test("loopback session emits hello snapshot, presence event, and suppresses paused input", async () => {
  const harness = await createLoopbackHarness({ color: "#00ffaa" });
  const { messages, session, status } = harness;
  try {
    assert.equal(status.state, "connected");
    assert.equal(status.mode, "loopback");
    assert.equal(messages.length, 0);

    session.send(helloEnvelope({
      color: "#00ffaa",
      messageId: "hello-1",
      sequence: 1,
      sentAt: harness.now(),
    }));

    const helloSnapshot = latestMessage(messages, "room.snapshot");
    assert.equal(helloSnapshot.payload.players.length, 1);
    assert.equal(helloSnapshot.payload.players[0].playerId, "loopback:client-a");
    assert.equal(helloSnapshot.payload.players[0].displayName, "Alice");
    assert.equal(helloSnapshot.payload.players[0].lastInputSequence, 0);

    harness.advanceNow(120);
    session.send(presenceEnvelope("input-paused", {
      messageId: "presence-1",
      sequence: 2,
      sentAt: harness.now(),
    }));

    const presenceEvent = latestMessage(messages, "room.event");
    assert.equal(presenceEvent.payload.event.eventType, "player.presence");
    assert.equal(presenceEvent.payload.event.playerId, "loopback:client-a");
    assert.equal(presenceEvent.payload.event.status, "input-paused");

    const pausedSnapshot = latestMessage(messages, "room.snapshot");
    assert.equal(pausedSnapshot.payload.players[0].lastInputSequence, 0);
    const messageCountBeforePausedInput = messages.length;

    harness.advanceNow(20);
    session.send(inputEnvelope({ sequence: 3, inputSequence: 1, sentAt: harness.now() }));
    assert.equal(messages.length, messageCountBeforePausedInput);

    harness.advanceNow(120);
    session.send(presenceEnvelope("active", {
      messageId: "presence-2",
      sequence: 4,
      sentAt: harness.now(),
    }));

    const activeEvent = latestMessage(messages, "room.event");
    assert.equal(activeEvent.payload.event.status, "active");
  } finally {
    harness.disconnect();
  }
});

test("loopback session rejects paused mutation intents", async () => {
  const harness = await createLoopbackHarness({ now: 2000 });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({ messageId: "hello-paused", sequence: 1, sentAt: harness.now() }));

    harness.advanceNow(120);
    session.send(presenceEnvelope("backgrounded", {
      messageId: "presence-backgrounded",
      sequence: 2,
      sentAt: harness.now(),
    }));
    assert.equal(latestMessage(messages, "room.event").payload.event.status, "backgrounded");

    const mutationCases = [
      {
        messageId: "paused-fire",
        envelope: () => fireEnvelope({ sequence: 3, fireSequence: 1, sentAt: harness.now() }),
        advanceMs: 30,
      },
      {
        messageId: "paused-pickup",
        envelope: () => pickupEnvelope({ sequence: 4, pickupSequence: 1, sentAt: harness.now() }),
        advanceMs: 160,
      },
      {
        messageId: "paused-world",
        envelope: () => worldEnvelope({ sequence: 5, worldSequence: 1, sentAt: harness.now() }),
        advanceMs: 1,
      },
      {
        messageId: "paused-match",
        envelope: () => matchEnvelope({ sequence: 6, matchSequence: 1, sentAt: harness.now() }),
        advanceMs: 250,
      },
    ];

    const firstMutationMessageCount = messages.length;
    for (const testCase of mutationCases) {
      harness.advanceNow(testCase.advanceMs);
      session.send(testCase.envelope());
      const reject = latestMessage(messages, "room.reject");
      assert.equal(reject.payload.rejectedMessageId, testCase.messageId);
      assert.equal(reject.payload.code, "unsupported");
      assert.equal(reject.payload.recoverable, true);
      assert.match(reject.payload.message, /input is paused/);
    }
    assert.equal(messages.filter((message) => message.type === "room.reject").length, mutationCases.length);
    assert.equal(
      messages.slice(firstMutationMessageCount).filter((message) => message.type === "room.event").length,
      0,
    );
  } finally {
    harness.disconnect();
  }
});

test("loopback session rejects fire timestamps outside accepted input history", async () => {
  const harness = await createLoopbackHarness({ now: 3000 });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({ messageId: "hello-loopback-fire-history", sequence: 1, sentAt: harness.now() }));
    session.send(inputBatchEnvelope({
      messageId: "loopback-fire-history-inputs",
      sequence: 2,
      sentAt: harness.now(),
      inputSequences: [1, 2],
      inputs: [
        { sampledAt: harness.now(), rotX: -78, rotY: 0 },
        { sampledAt: harness.now() + 50, rotX: -78, rotY: 0 },
      ],
    }));
    harness.advanceNow(80);
    session.send(fireEnvelope({
      messageId: "loopback-fire-history-too-late",
      sequence: 3,
      sentAt: harness.now(),
      fireSequence: 1,
      fire: {
        firedAt: harness.now() + 1_000,
      },
    }));

    const reject = latestMessage(messages, "room.reject");
    assert.equal(reject.payload.code, "stale");
    assert.equal(reject.payload.recoverable, true);
    assert.equal(reject.payload.rejectedMessageId, "loopback-fire-history-too-late");
    assert.match(reject.payload.message, /fire-after-input-history/);
  } finally {
    harness.disconnect();
  }
});

test("loopback session uses fire payload aim when the authoritative pose is one input behind", async () => {
  const remotePlayer = createPlayer({
    playerId: "remote-player",
    clientId: "remote-client",
    displayName: "Remote",
    origin: [4, 0, 0],
    rotX: -78,
    rotY: 180,
    updatedAt: 5000,
  });
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: [{
      spawnId: "spawn-local",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 180,
    }],
    pickupDefinitions: [],
  });
  const harness = await createLoopbackHarness({
    now: 5000,
    sessionOptions: {
      trustedGameplayDefinitions: gameplayDefinitions,
      simulatedPlayers: () => [remotePlayer],
    },
  });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({ messageId: "hello-loopback-fresh-aim", sequence: 1, sentAt: harness.now() }));
    harness.advanceNow(120);
    session.send(fireEnvelope({
      messageId: "fire-loopback-fresh-aim",
      sequence: 2,
      fireSequence: 1,
      sentAt: harness.now(),
      fire: { direction: DUEL_FORWARD_DIRECTION },
    }));

    const event = latestMessage(messages, "room.event").payload.event;
    assert.equal(event.eventType, "player.damaged");
    assert.equal(event.victimPlayerId, "remote-player");
    assert.equal(event.damage, 24);
    assert.equal(event.health, 76);
    assert.equal(messages.some((message) => message.type === "room.reject"), false);
  } finally {
    harness.disconnect();
  }
});

test("loopback session uses a bounded fire origin hint when the authoritative origin is one input behind", async () => {
  const remotePlayer = createPlayer({
    playerId: "remote-player",
    clientId: "remote-client",
    displayName: "Remote",
    origin: [4, 0.9, 0],
    rotX: -78,
    rotY: 180,
    updatedAt: 5050,
  });
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: [{
      spawnId: "spawn-local",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 0,
    }],
    pickupDefinitions: [],
  });
  const harness = await createLoopbackHarness({
    now: 5050,
    sessionOptions: {
      trustedGameplayDefinitions: gameplayDefinitions,
      simulatedPlayers: () => [remotePlayer],
    },
  });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({ messageId: "hello-loopback-fresh-origin", sequence: 1, sentAt: harness.now() }));
    harness.advanceNow(120);
    session.send(fireEnvelope({
      messageId: "fire-loopback-fresh-origin",
      sequence: 2,
      fireSequence: 1,
      sentAt: harness.now(),
      fire: { origin: [0, 0.4, 0] },
    }));

    const event = latestMessage(messages, "room.event").payload.event;
    assert.equal(event.eventType, "player.damaged");
    assert.equal(event.victimPlayerId, "remote-player");
    assert.equal(event.damage, 24);
    assert.equal(event.health, 76);
    assert.equal(messages.some((message) => message.type === "room.reject"), false);
  } finally {
    harness.disconnect();
  }
});

test("loopback session applies damage when LOS trace only clips the target skin", async () => {
  const remotePlayer = createPlayer({
    playerId: "remote-player",
    clientId: "remote-client",
    displayName: "Remote",
    origin: [4, 0, 0],
    rotX: -78,
    rotY: 180,
    updatedAt: 5000,
  });
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: [{
      spawnId: "spawn-local",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 0,
    }],
    pickupDefinitions: [],
  });
  const harness = await createLoopbackHarness({
    now: 5000,
    sessionOptions: {
      trustedGameplayDefinitions: gameplayDefinitions,
      trustedSceneMovement: {
        collisionWorld: {
          traceUse: () => ({
            fraction: 0.985,
            end: [3.92, 0, -0.82],
            planeNormal: [0, 0, 1],
            entityIndex: 84,
            modelIndex: 3,
            classname: "func_wall",
          }),
        },
        playerEyeHeight: 1.0,
      },
      simulatedPlayers: () => [remotePlayer],
    },
  });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({ messageId: "hello-loopback-late-los", sequence: 1, sentAt: harness.now() }));
    harness.advanceNow(120);
    session.send(fireEnvelope({
      messageId: "fire-loopback-late-los",
      sequence: 2,
      fireSequence: 1,
      sentAt: harness.now(),
    }));

    const event = latestMessage(messages, "room.event").payload.event;
    assert.equal(event.eventType, "player.damaged");
    assert.equal(event.victimPlayerId, "remote-player");
    assert.equal(event.damage, 24);
    assert.equal(event.health, 76);
    assert.equal(messages.some((message) => message.type === "room.reject"), false);
  } finally {
    harness.disconnect();
  }
});

test("loopback session applies source-order armor save but suppresses health damage while simulated victim is invulnerable", async () => {
  const remoteInventory = {
    ...items.createQuakeMultiplayerInitialInventory(),
    health: 100,
    armor: 50,
    armorType: 0.8,
    powerups: [{
      active: true,
      activationField: "invincible_time",
      finishedAt: 15_000,
      finishedField: "invincible_finished",
      itemFlag: INVULNERABILITY_ITEM_FLAG,
    }],
  };
  const remotePlayer = items.quakeMultiplayerPlayerWithInventory(
    createPlayer({
      playerId: "remote-player",
      clientId: "remote-client",
      displayName: "Remote",
      origin: [4, 0, 0],
      rotX: -78,
      rotY: 180,
      updatedAt: 5_200,
    }),
    remoteInventory,
  );
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: [{
      spawnId: "spawn-local",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 0,
    }],
    pickupDefinitions: [],
  });
  const harness = await createLoopbackHarness({
    now: 5_200,
    sessionOptions: {
      trustedGameplayDefinitions: gameplayDefinitions,
      simulatedPlayers: () => [remotePlayer],
    },
  });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({ messageId: "hello-loopback-invulnerable", sequence: 1, sentAt: harness.now() }));
    harness.advanceNow(120);
    session.send(fireEnvelope({
      messageId: "fire-loopback-invulnerable",
      sequence: 2,
      fireSequence: 1,
      sentAt: harness.now(),
    }));

    const events = messages
      .filter((message) => message.type === "room.event")
      .map((message) => message.payload.event);
    assert.equal(events.some((event) =>
      event.eventType === "player.damaged" && event.victimPlayerId === "remote-player"
    ), false);
    assert.equal(events.some((event) =>
      event.eventType === "player.killed" && event.victimPlayerId === "remote-player"
    ), false);
    const snapshot = latestMessage(messages, "room.snapshot");
    const remoteSnapshot = snapshot.payload.players.find((player) => player.playerId === "remote-player");
    assert.equal(remoteSnapshot?.health, 100);
    assert.equal(remoteSnapshot?.armor, 30);
    assert.equal(remoteSnapshot?.alive, true);
    assert.ok(
      (remoteSnapshot?.velocity?.some((value) => Math.abs(value) > 0) ?? false),
      "expected invulnerable target to still receive source-style damage momentum",
    );
    assert.equal(messages.some((message) => message.type === "room.reject"), false);
  } finally {
    harness.disconnect();
  }
});

test("loopback session double-invulnerable telefrag clears protection and kills both players like Quake teledeath3", async () => {
  const invulnerabilityPickup = invulnerabilityPickupDefinition();
  const remoteInventory = {
    ...items.createQuakeMultiplayerInitialInventory(),
    itemFlags: INVULNERABILITY_ITEM_FLAG,
    powerups: [{
      active: true,
      activationField: "invincible_time",
      finishedAt: 15_000,
      finishedField: "invincible_finished",
      itemFlag: INVULNERABILITY_ITEM_FLAG,
    }],
  };
  const remotePlayer = items.quakeMultiplayerPlayerWithInventory(
    createPlayer({
      playerId: "remote-player",
      clientId: "remote-client",
      displayName: "Remote",
      origin: [4, 0, 0],
      rotX: -78,
      rotY: 180,
      updatedAt: 5_200,
    }),
    remoteInventory,
  );
  const teleportDefinition = {
    kind: "teleport",
    entityIndex: 700,
    classname: "trigger_teleport",
    destinationEntityIndex: 701,
    destinationOrigin: [4, 0, 0],
    destinationRotX: -78,
    destinationRotY: 180,
  };
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: [{
      spawnId: "spawn-local",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 0,
    }],
    pickupDefinitions: [invulnerabilityPickup],
  });
  const harness = await createLoopbackHarness({
    now: 5_200,
    sessionOptions: {
      trustedGameplayDefinitions: gameplayDefinitions,
      trustedWorldDefinitions: [teleportDefinition],
      simulatedPlayers: () => [remotePlayer],
    },
  });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({ messageId: "hello-loopback-double-telefrag", sequence: 1, sentAt: harness.now() }));
    harness.advanceNow(120);
    session.send(pickupEnvelope({
      messageId: "pickup-loopback-invulnerability",
      sequence: 2,
      pickupSequence: 1,
      sentAt: harness.now(),
      pickup: {
        entityIndex: invulnerabilityPickup.entityIndex,
        origin: [0, 0, 0],
      },
    }));
    assert.equal(
      messages.some((message) =>
        message.type === "room.event" &&
        message.payload.event.eventType === "pickup.taken" &&
        message.payload.event.entityIndex === invulnerabilityPickup.entityIndex
      ),
      true,
    );

    harness.advanceNow(120);
    session.send(worldEnvelope({
      messageId: "world-loopback-double-telefrag",
      sequence: 3,
      worldSequence: 1,
      sentAt: harness.now(),
      intent: {
        intentType: "teleport",
        entityIndex: teleportDefinition.entityIndex,
        destinationEntityIndex: teleportDefinition.destinationEntityIndex,
        origin: [0, 0, 0],
        velocity: [0, 0, 0],
      },
    }));

    const kills = messages
      .filter((message) => message.type === "room.event")
      .map((message) => message.payload.event)
      .filter((event) => event.eventType === "player.killed" && event.damageSource === "teledeath3");
    assert.equal(kills.length, 2);
    assert.equal(kills.some((event) => event.victimPlayerId === "loopback:client-a"), true);
    assert.equal(kills.some((event) => event.victimPlayerId === "remote-player"), true);

    const snapshot = latestMessage(messages, "room.snapshot");
    const localSnapshot = snapshot.payload.players.find((player) => player.playerId === "loopback:client-a");
    const remoteSnapshot = snapshot.payload.players.find((player) => player.playerId === "remote-player");
    assert.equal(localSnapshot?.alive, false);
    assert.equal(remoteSnapshot?.alive, false);
    assert.equal(localSnapshot?.frags, -1);
    assert.equal(remoteSnapshot?.frags, -1);
    assert.equal(localSnapshot?.deaths, 1);
    assert.equal(remoteSnapshot?.deaths, 1);
    assert.equal(
      localSnapshot?.inventory.powerups.some((powerup) => powerup.finishedField === "invincible_finished"),
      false,
    );
    assert.equal(
      remoteSnapshot?.inventory.powerups.some((powerup) => powerup.finishedField === "invincible_finished"),
      false,
    );
    assert.equal(messages.some((message) => message.type === "room.reject"), false);
  } finally {
    harness.disconnect();
  }
});

test("loopback session clears local active artifact powerups immediately on death", async () => {
  const quadPickup = quadPickupDefinition({ durationMs: 30_000 });
  const hurtDefinition = {
    kind: "hurt",
    entityIndex: 6_001,
    classname: "trigger_hurt",
    damage: 150,
  };
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: [{
      spawnId: "spawn-loopback-local-death",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 0,
    }],
    pickupDefinitions: [quadPickup],
  });
  const harness = await createLoopbackHarness({
    now: 5_400,
    sessionOptions: {
      trustedGameplayDefinitions: gameplayDefinitions,
      trustedWorldDefinitions: [hurtDefinition],
    },
  });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({ messageId: "hello-loopback-local-death-powerups", sequence: 1, sentAt: harness.now() }));
    harness.advanceNow(120);
    session.send(pickupEnvelope({
      messageId: "pickup-loopback-local-death-quad",
      sequence: 2,
      pickupSequence: 1,
      sentAt: harness.now(),
      pickup: { entityIndex: quadPickup.entityIndex, origin: [0, 0, 0] },
    }));
    assert.equal(
      messages.some((message) =>
        message.type === "room.event" &&
          message.payload.event.eventType === "pickup.taken" &&
          message.payload.event.entityIndex === quadPickup.entityIndex
      ),
      true,
    );

    harness.advanceNow(120);
    session.send(worldEnvelope({
      messageId: "world-loopback-local-death-powerups",
      sequence: 3,
      worldSequence: 1,
      sentAt: harness.now(),
      intent: {
        entityIndex: hurtDefinition.entityIndex,
        origin: [0, 0, 0],
      },
    }));

    const kill = messages
      .filter((message) => message.type === "room.event")
      .map((message) => message.payload.event)
      .find((event) =>
        event.eventType === "player.killed" &&
          event.victimPlayerId === "loopback:client-a" &&
          event.damageSource === "trigger_hurt"
      );
    assert.ok(kill, "expected local trigger_hurt death");
    const snapshot = latestMessage(messages, "room.snapshot");
    const localSnapshot = snapshot.payload.players.find((player) => player.playerId === "loopback:client-a");
    assert.equal(localSnapshot?.alive, false);
    assert.equal(localSnapshot?.inventory.itemFlags & QUAD_ITEM_FLAG, 0);
    assert.equal(
      localSnapshot?.inventory.powerups.some((powerup) => powerup.finishedField === "super_damage_finished"),
      false,
    );
    assert.equal(messages.some((message) => message.type === "room.reject"), false);
  } finally {
    harness.disconnect();
  }
});

test("loopback session rewinds hit tests from authoritative snapshot history instead of current velocity", async () => {
  let remotePlayer = createPlayer({
    playerId: "remote-player",
    clientId: "remote-client",
    displayName: "Remote",
    origin: [4, 0, 0],
    velocity: [0, 0, 0],
    rotX: -78,
    rotY: 180,
    updatedAt: 7_000,
  });
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: [{
      spawnId: "spawn-local",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 0,
    }],
    pickupDefinitions: [],
  });
  const harness = await createLoopbackHarness({
    now: 7_000,
    sessionOptions: {
      trustedGameplayDefinitions: gameplayDefinitions,
      simulatedPlayers: () => [remotePlayer],
    },
  });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({ messageId: "hello-loopback-history-hit", sequence: 1, sentAt: harness.now() }));
    remotePlayer = {
      ...remotePlayer,
      origin: [4, 1.4, 0],
      velocity: [0, 0, 0],
      updatedAt: 7_100,
    };
    harness.advanceNow(100);
    session.send(fireEnvelope({
      messageId: "fire-loopback-history-hit",
      sequence: 2,
      fireSequence: 1,
      sentAt: harness.now(),
      fire: {
        origin: [0, 0, -0.36],
        direction: [1, 0, 0],
      },
    }));

    const event = messages
      .filter((message) => message.type === "room.event")
      .map((message) => message.payload.event)
      .find((candidate) =>
        candidate.eventType === "player.damaged" &&
        candidate.victimPlayerId === "remote-player"
      );
    assert.ok(event, "expected historical loopback target sample to receive damage");
    assert.equal(event.damage, 24);
    assert.equal(event.health, 76);
    assert.equal(messages.some((message) => message.type === "room.reject"), false);
  } finally {
    harness.disconnect();
  }
});

test("loopback session blocks damage when LOS trace hits a real wall", async () => {
  const remotePlayer = createPlayer({
    playerId: "remote-player",
    clientId: "remote-client",
    displayName: "Remote",
    origin: [4, 0, 0],
    rotX: -78,
    rotY: 180,
    updatedAt: 5500,
  });
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: [{
      spawnId: "spawn-local",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 0,
    }],
    pickupDefinitions: [],
  });
  const harness = await createLoopbackHarness({
    now: 5500,
    sessionOptions: {
      trustedGameplayDefinitions: gameplayDefinitions,
      trustedSceneMovement: {
        collisionWorld: {
          traceUse: () => ({
            fraction: 0.5,
            end: [2, 0, -0.5],
            planeNormal: [1, 0, 0],
            entityIndex: 900,
            modelIndex: 9,
            classname: "func_wall",
          }),
        },
        playerEyeHeight: 1.0,
      },
      simulatedPlayers: () => [remotePlayer],
    },
  });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({ messageId: "hello-loopback-wall-los", sequence: 1, sentAt: harness.now() }));
    harness.advanceNow(120);
    const beforeCount = messages.length;
    session.send(fireEnvelope({
      messageId: "fire-loopback-wall-los",
      sequence: 2,
      fireSequence: 1,
      sentAt: harness.now(),
    }));

    const newEvents = messages
      .slice(beforeCount)
      .filter((message) => message.type === "room.event")
      .map((message) => message.payload.event);
    assert.equal(newEvents.some((event) => event.eventType === "player.damaged"), false);
    const snapshot = latestMessage(messages, "room.snapshot");
    const remoteSnapshot = snapshot.payload.players.find((player) => player.playerId === "remote-player");
    assert.equal(remoteSnapshot?.health, 100);
    assert.equal(messages.some((message) => message.type === "room.reject"), false);
  } finally {
    harness.disconnect();
  }
});

test("loopback session damages a farther visible simulated player when a nearer candidate is blocked", async () => {
  const nearPlayer = createPlayer({
    playerId: "near-player",
    clientId: "near-client",
    displayName: "Near",
    origin: [2, 0, 0],
    rotX: -78,
    rotY: 180,
    updatedAt: 6000,
  });
  const farPlayer = createPlayer({
    playerId: "far-player",
    clientId: "far-client",
    displayName: "Far",
    origin: [4, 0, 0],
    rotX: -78,
    rotY: 180,
    updatedAt: 6000,
  });
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: [{
      spawnId: "spawn-local",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 0,
    }],
    pickupDefinitions: [],
  });
  const harness = await createLoopbackHarness({
    now: 6000,
    sessionOptions: {
      trustedGameplayDefinitions: gameplayDefinitions,
      trustedSceneMovement: {
        collisionWorld: {
          traceUse: (_origin, impact) => impact[0] < 3
            ? {
                fraction: 0.5,
                end: [1, 0, -0.5],
                planeNormal: [1, 0, 0],
                entityIndex: 44,
                modelIndex: 2,
                classname: "func_wall",
              }
            : null,
        },
        playerEyeHeight: 1.0,
      },
      simulatedPlayers: () => [nearPlayer, farPlayer],
    },
  });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({ messageId: "hello-loopback-visible-far", sequence: 1, sentAt: harness.now() }));
    harness.advanceNow(120);
    session.send(fireEnvelope({
      messageId: "fire-loopback-visible-far",
      sequence: 2,
      fireSequence: 1,
      sentAt: harness.now(),
    }));

    const events = messages
      .filter((message) => message.type === "room.event")
      .map((message) => message.payload.event);
    assert.equal(events.some((event) =>
      event.eventType === "player.damaged" && event.victimPlayerId === "near-player"
    ), false);
    const farEvent = events.find((event) =>
      event.eventType === "player.damaged" && event.victimPlayerId === "far-player"
    );
    assert.ok(farEvent, "expected farther visible simulated player to take damage");
    assert.equal(farEvent.damage, 24);
    assert.equal(farEvent.health, 76);
    const snapshot = latestMessage(messages, "room.snapshot");
    const nearSnapshot = snapshot.payload.players.find((player) => player.playerId === "near-player");
    const farSnapshot = snapshot.payload.players.find((player) => player.playerId === "far-player");
    assert.equal(nearSnapshot?.health, 100);
    assert.equal(farSnapshot?.health, 76);
    assert.equal(messages.some((message) => message.type === "room.reject"), false);
  } finally {
    harness.disconnect();
  }
});

test("loopback session blocks indirect projectile splash through walls", async () => {
  const rocketPickup = weaponPickupDefinition("rocketlauncher");
  const directPlayer = createPlayer({
    playerId: "direct-player",
    clientId: "direct-client",
    displayName: "Direct",
    origin: [3, 0, 0],
    rotX: -78,
    rotY: 180,
    updatedAt: 6500,
  });
  const blockedPlayer = createPlayer({
    playerId: "blocked-player",
    clientId: "blocked-client",
    displayName: "Blocked",
    origin: [3, 2, 0],
    rotX: -78,
    rotY: 180,
    updatedAt: 6500,
  });
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: [{
      spawnId: "spawn-local",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 0,
    }],
    pickupDefinitions: [rocketPickup],
  });
  const harness = await createLoopbackHarness({
    now: 6500,
    sessionOptions: {
      trustedGameplayDefinitions: gameplayDefinitions,
      trustedSceneMovement: {
        collisionWorld: {
          traceUse: (_origin, point) => point[1] > 1
            ? {
                fraction: 0.4,
                end: [point[0], 1, point[2]],
                planeNormal: [0, -1, 0],
                entityIndex: 45,
                modelIndex: 3,
                classname: "func_wall",
              }
            : null,
        },
        playerEyeHeight: 1.0,
      },
      simulationTickMs: 1,
      simulatedPlayers: () => [directPlayer, blockedPlayer],
    },
  });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({ messageId: "hello-loopback-splash-wall", sequence: 1, sentAt: harness.now() }));
    harness.advanceNow(120);
    session.send(pickupEnvelope({
      messageId: "pickup-loopback-rocket",
      sequence: 2,
      pickupSequence: 1,
      sentAt: harness.now(),
      pickup: { entityIndex: rocketPickup.entityIndex, origin: [0, 0, 0] },
    }));
    harness.advanceNow(200);
    session.send(fireEnvelope({
      messageId: "fire-loopback-splash-wall",
      sequence: 3,
      fireSequence: 1,
      sentAt: harness.now(),
    }));
    harness.advanceNow(400);
    await waitForMessage(messages, (message) =>
      message.type === "room.event" &&
        message.payload.event.eventType === "projectile.impacted"
    );

    const events = messages
      .filter((message) => message.type === "room.event")
      .map((message) => message.payload.event);
    assert.ok(events.some((event) =>
      event.eventType === "player.killed" && event.victimPlayerId === "direct-player"
    ));
    assert.equal(events.some((event) =>
      (event.eventType === "player.damaged" || event.eventType === "player.killed") &&
        event.victimPlayerId === "blocked-player"
    ), false);
    const snapshot = latestMessage(messages, "room.snapshot");
    const blockedSnapshot = snapshot.payload.players.find((player) => player.playerId === "blocked-player");
    assert.equal(blockedSnapshot?.health, 100);
    assert.equal(blockedSnapshot?.alive, true);
    assert.equal(messages.some((message) => message.type === "room.reject"), false);
  } finally {
    harness.disconnect();
  }
});

test("loopback session applies projectile wall-impact splash without a direct player hit", async () => {
  const rocketPickup = weaponPickupDefinition("rocketlauncher");
  const nearMissPlayer = createPlayer({
    playerId: "near-miss-player",
    clientId: "near-miss-client",
    displayName: "Near Miss",
    origin: [3, 2, 0],
    rotX: -78,
    rotY: 180,
    updatedAt: 6900,
  });
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: [{
      spawnId: "spawn-local",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 0,
    }],
    pickupDefinitions: [rocketPickup],
  });
  const harness = await createLoopbackHarness({
    now: 6900,
    sessionOptions: {
      trustedGameplayDefinitions: gameplayDefinitions,
      trustedSceneMovement: {
        collisionWorld: {
          traceUse: (origin, point) => origin[0] === 0 && point[0] > 10
            ? {
                fraction: 3 / 64,
                end: [3, 0, 0],
                planeNormal: [-1, 0, 0],
                entityIndex: 44,
                modelIndex: 3,
                classname: "func_wall",
              }
            : null,
        },
        playerEyeHeight: 1.0,
      },
      simulationTickMs: 1,
      simulatedPlayers: () => [nearMissPlayer],
    },
  });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({ messageId: "hello-loopback-wall-splash", sequence: 1, sentAt: harness.now() }));
    harness.advanceNow(120);
    session.send(pickupEnvelope({
      messageId: "pickup-loopback-wall-splash-rocket",
      sequence: 2,
      pickupSequence: 1,
      sentAt: harness.now(),
      pickup: { entityIndex: rocketPickup.entityIndex, origin: [0, 0, 0] },
    }));
    harness.advanceNow(200);
    session.send(fireEnvelope({
      messageId: "fire-loopback-wall-splash",
      sequence: 3,
      fireSequence: 1,
      sentAt: harness.now(),
      fire: {
        direction: [1, 0, 0],
      },
    }));
    harness.advanceNow(2_000);
    await waitForMessage(messages, (message) =>
      message.type === "room.event" &&
        message.payload.event.eventType === "projectile.impacted"
    );

    const events = messages
      .filter((message) => message.type === "room.event")
      .map((message) => message.payload.event);
    const targetDamage = events.find((event) =>
      event.eventType === "player.damaged" && event.victimPlayerId === "near-miss-player"
    );
    const selfDamage = events.find((event) =>
      event.eventType === "player.damaged" && event.victimPlayerId === "loopback:client-a"
    );
    assert.ok(targetDamage, "expected wall splash to damage nearby simulated target");
    assert.equal(targetDamage.damage, 69);
    assert.equal(targetDamage.health, 31);
    assert.ok(selfDamage, "expected wall splash to apply half self damage");
    assert.equal(selfDamage.damage, 22);
    assert.equal(selfDamage.health, 78);
    const snapshot = latestMessage(messages, "room.snapshot");
    const targetSnapshot = snapshot.payload.players.find((player) => player.playerId === "near-miss-player");
    const selfSnapshot = snapshot.payload.players.find((player) => player.playerId === "loopback:client-a");
    assert.equal(targetSnapshot?.health, 31);
    assert.equal(selfSnapshot?.health, 78);
    assert.equal(messages.some((message) => message.type === "room.reject"), false);
  } finally {
    harness.disconnect();
  }
});

test("loopback session applies projectile quad damage from impact-time attacker state", async () => {
  const cases = [
    {
      id: "loopback-quad-expired-before-impact",
      quadDurationMs: 250,
      pickupQuadBeforeFire: true,
      expectedDamage: 9,
      expectedHealth: 91,
    },
    {
      id: "loopback-quad-picked-up-before-impact",
      quadDurationMs: 30_000,
      pickupQuadBeforeFire: false,
      expectedDamage: 36,
      expectedHealth: 64,
    },
  ];

  for (const spec of cases) {
    const nailgunPickup = weaponPickupDefinition("nailgun");
    const quadPickup = quadPickupDefinition({ durationMs: spec.quadDurationMs });
    const remotePlayer = createPlayer({
      playerId: `remote-${spec.id}`,
      clientId: `remote-client-${spec.id}`,
      displayName: "Remote",
      origin: [8, 0, 0],
      rotX: -78,
      rotY: 180,
      updatedAt: 8_000,
    });
    const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
      deathmatchSpawns: [{
        spawnId: `spawn-${spec.id}`,
        classname: "info_player_deathmatch",
        origin: [0, 0, 0],
        rotX: -78,
        rotY: 0,
      }],
      pickupDefinitions: [nailgunPickup, quadPickup],
    });
    const harness = await createLoopbackHarness({
      now: 8_000,
      sessionOptions: {
        trustedGameplayDefinitions: gameplayDefinitions,
        simulationTickMs: 1,
        simulatedPlayers: () => [remotePlayer],
      },
    });
    const { messages, session } = harness;
    try {
      session.send(helloEnvelope({
        messageId: `hello-${spec.id}`,
        sequence: 1,
        sentAt: harness.now(),
      }));
      harness.advanceNow(120);
      session.send(pickupEnvelope({
        messageId: `pickup-nailgun-${spec.id}`,
        sequence: 2,
        pickupSequence: 1,
        sentAt: harness.now(),
        pickup: { entityIndex: nailgunPickup.entityIndex, origin: [0, 0, 0] },
      }));
      harness.advanceNow(160);
      if (spec.pickupQuadBeforeFire) {
        session.send(pickupEnvelope({
          messageId: `pickup-quad-before-fire-${spec.id}`,
          sequence: 3,
          pickupSequence: 2,
          sentAt: harness.now(),
          pickup: { entityIndex: quadPickup.entityIndex, origin: [0, 0, 0] },
        }));
        harness.advanceNow(160);
      }
      session.send(fireEnvelope({
        messageId: `fire-${spec.id}`,
        sequence: 4,
        fireSequence: 1,
        sentAt: harness.now(),
        fire: {
          weapon: "nailgun",
          fireKind: "projectile",
          direction: [1, 0, 0],
        },
      }));
      if (!spec.pickupQuadBeforeFire) {
        harness.advanceNow(160);
        session.send(pickupEnvelope({
          messageId: `pickup-quad-before-impact-${spec.id}`,
          sequence: 5,
          pickupSequence: 2,
          sentAt: harness.now(),
          pickup: { entityIndex: quadPickup.entityIndex, origin: [0, 0, 0] },
        }));
      }
      assert.ok(
        messages.some((message) =>
          message.type === "room.event" &&
            message.payload.event.eventType === "pickup.taken" &&
            message.payload.event.entityIndex === quadPickup.entityIndex
        ),
        `expected loopback quad pickup to be accepted for ${spec.id}`,
      );
      const preImpactSnapshot = latestMessage(messages, "room.snapshot");
      const preImpactLocalPlayer = preImpactSnapshot.payload.players
        .find((player) => player.playerId === "loopback:client-a");
      assert.equal(
        items.quakeMultiplayerDamageMultiplierForInventory(preImpactLocalPlayer?.inventory, harness.now()),
        4,
        `expected loopback local quad to be active before impact for ${spec.id}`,
      );
      harness.advanceNow(700);
      await waitForMessage(messages, (message) =>
        message.type === "room.event" &&
          message.payload.event.eventType === "projectile.impacted" &&
          message.payload.event.weapon === "nailgun"
      );

      const events = messages
        .filter((message) => message.type === "room.event")
        .map((message) => message.payload.event);
      const damage = events.find((event) =>
        event.eventType === "player.damaged" &&
          event.victimPlayerId === remotePlayer.playerId &&
          event.damageSource === "nailgun"
      );
      assert.ok(damage, `expected loopback nailgun damage for ${spec.id}`);
      assert.equal(damage.damage, spec.expectedDamage, spec.id);
      assert.equal(damage.health, spec.expectedHealth, spec.id);
      const snapshot = latestMessage(messages, "room.snapshot");
      const remoteSnapshot = snapshot.payload.players.find((player) => player.playerId === remotePlayer.playerId);
      assert.equal(remoteSnapshot?.health, spec.expectedHealth, spec.id);
      assert.deepEqual(messages.filter((message) => message.type === "room.reject"), [], spec.id);
    } finally {
      harness.disconnect();
    }
  }
});

test("loopback session publishes a dynamic backpack when a simulated player dies", async () => {
  const remotePlayer = createPlayer({
    playerId: "remote-drop-backpack",
    clientId: "remote-client-drop-backpack",
    displayName: "Remote",
    origin: [4, 0, 0],
    rotX: -78,
    rotY: 180,
    health: 10,
    inventory: {
      ...items.createQuakeMultiplayerInitialInventory(),
      health: 10,
      itemFlags: items.createQuakeMultiplayerInitialInventory().itemFlags | QUAD_ITEM_FLAG,
      activeWeapon: "rocketlauncher",
      weapons: ["axe", "shotgun", "rocketlauncher"],
      shells: 2,
      rockets: 5,
      powerups: [{
        active: true,
        activationField: "super_damage_time",
        finishedAt: 15_000,
        finishedField: "super_damage_finished",
        itemFlag: QUAD_ITEM_FLAG,
        itemFlagExpression: "IT_QUAD",
      }],
    },
    updatedAt: 5_000,
  });
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: [{
      spawnId: "spawn-loopback-drop-backpack",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 0,
    }],
    pickupDefinitions: [],
  });
  const harness = await createLoopbackHarness({
    now: 5_000,
    sessionOptions: {
      trustedGameplayDefinitions: gameplayDefinitions,
      simulatedPlayers: () => [remotePlayer],
    },
  });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({ messageId: "hello-loopback-drop-backpack", sequence: 1, sentAt: harness.now() }));
    harness.advanceNow(120);
    session.send(fireEnvelope({
      messageId: "fire-loopback-drop-backpack",
      sequence: 2,
      fireSequence: 1,
      sentAt: harness.now(),
    }));

    const dropped = messages
      .filter((message) => message.type === "room.event")
      .map((message) => message.payload.event)
      .find((event) => event.eventType === "pickup.dropped");
    assert.ok(dropped, "expected loopback pickup.dropped event");
    assert.equal(dropped.definition.classname, "item_backpack");
    assert.equal(dropped.definition.runtime, true);
    assert.equal(dropped.definition.effect.shells, 2);
    assert.equal(dropped.definition.effect.rockets, 5);
    assert.equal(dropped.definition.effect.weapon.id, "rocketlauncher");

    const snapshot = latestMessage(messages, "room.snapshot");
    assert.equal(
      snapshot.payload.dynamicPickups.some((definition) =>
        definition.entityIndex === dropped.definition.entityIndex
      ),
      true,
    );
    const remoteSnapshot = snapshot.payload.players.find((player) => player.playerId === "remote-drop-backpack");
    assert.equal(remoteSnapshot?.alive, false);
    assert.equal(remoteSnapshot?.inventory.itemFlags & QUAD_ITEM_FLAG, 0);
    assert.equal(
      remoteSnapshot?.inventory.powerups.some((powerup) => powerup.finishedField === "super_damage_finished"),
      false,
    );
  } finally {
    harness.disconnect();
  }
});

test("loopback pickup intent accepts bounded local origin hints during vertical drift", async () => {
  const pickupDefinition = {
    pickupId: "item-shells",
    entityIndex: 20,
    classname: "item_shells",
    origin: [2, 0, 1],
    effect: { shells: 20 },
  };
  const deathmatchSpawns = [{
    spawnId: "spawn-high",
    classname: "info_player_deathmatch",
    origin: [2.2, 0, 6],
    rotX: 0,
    rotY: 0,
  }];
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns,
    pickupDefinitions: [pickupDefinition],
  });
  const harness = await createLoopbackHarness({
    now: 3000,
    sessionOptions: {
      trustedGameplayDefinitions: gameplayDefinitions,
    },
  });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({
      messageId: "hello-pickup-drift",
      sequence: 1,
      sentAt: harness.now(),
    }));

    harness.advanceNow(120);
    session.send(pickupEnvelope({
      messageId: "pickup-drift",
      sequence: 2,
      pickupSequence: 1,
      sentAt: harness.now(),
      pickup: {
        entityIndex: pickupDefinition.entityIndex,
        origin: [2.2, 0, 1],
      },
    }));

    const event = latestMessage(messages, "room.event").payload.event;
    assert.equal(event.eventType, "pickup.taken");
    assert.equal(event.entityIndex, pickupDefinition.entityIndex);
    assert.equal(messages.some((message) => message.type === "room.reject"), false);
  } finally {
    harness.disconnect();
  }
});

test("loopback ignores unknown pickup intents without broadcast noise", async () => {
  const harness = await createLoopbackHarness({ now: 3500 });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({
      messageId: "hello-unknown-pickup",
      sequence: 1,
      sentAt: harness.now(),
    }));

    harness.advanceNow(120);
    const beforeCount = messages.length;
    session.send(pickupEnvelope({
      messageId: "pickup-unknown",
      sequence: 2,
      pickupSequence: 1,
      sentAt: harness.now(),
      pickup: {
        entityIndex: 999,
        origin: [0, 0, 1],
      },
    }));

    assert.equal(messages.length, beforeCount);
    assert.equal(messages.some((message) => message.type === "room.reject"), false);
    assert.equal(
      messages.some((message) =>
        message.type === "room.event" && message.payload.event.eventType === "pickup.rejected"
      ),
      false,
    );
  } finally {
    harness.disconnect();
  }
});

test("loopback ignores touch prediction misses without room rejects", async () => {
  const moverDefinition = {
    kind: "mover",
    entityIndex: 88,
    classname: "func_button",
    bounds: {
      mins: [9.8, -0.5, 0],
      maxs: [10.2, 0.5, 1.2],
    },
    touchActivates: true,
    useActivates: false,
    shootActivates: false,
    speed: 40,
    moveMs: 150,
    delayMs: 0,
    fromOrigin: [0, 0, 0],
    toOrigin: [0, 0, -0.12],
    targetEntityIndexes: [],
  };
  const deathmatchSpawns = [{
    spawnId: "spawn-far",
    classname: "info_player_deathmatch",
    origin: [0, 0, 1],
    rotX: 0,
    rotY: 0,
  }];
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns,
    pickupDefinitions: [],
  });
  const harness = await createLoopbackHarness({
    now: 4000,
    sessionOptions: {
      trustedGameplayDefinitions: gameplayDefinitions,
      trustedWorldDefinitions: [moverDefinition],
    },
  });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({
      messageId: "hello-world-touch-miss",
      sequence: 1,
      sentAt: harness.now(),
    }));

    harness.advanceNow(120);
    const beforeCount = messages.length;
    session.send(worldEnvelope({
      messageId: "world-touch-miss",
      sequence: 2,
      worldSequence: 1,
      sentAt: harness.now(),
      intent: {
        entityIndex: moverDefinition.entityIndex,
        origin: [10, 0, 1],
      },
    }));

    assert.equal(messages.length, beforeCount);
    assert.equal(messages.some((message) => message.type === "room.reject"), false);
    assert.equal(
      messages.some((message) =>
        message.type === "room.event" && message.payload.event.eventType === "world.mover"
      ),
      false,
    );
  } finally {
    harness.disconnect();
  }
});

test("loopback target dispatch activates non-button movers", async () => {
  const triggerDefinition = {
    kind: "trigger",
    entityIndex: 190,
    classname: "trigger_multiple",
    bounds: {
      mins: [-1, -1, 0],
      maxs: [1, 1, 2],
    },
    touchActivates: true,
    useActivates: false,
    shootActivates: false,
    oneShot: false,
    delayMs: 0,
    waitMs: 0,
    targetEntityIndexes: [189],
  };
  const moverDefinition = {
    kind: "mover",
    entityIndex: 189,
    classname: "func_door_secret",
    bounds: {
      mins: [2, -1, 0],
      maxs: [3, 1, 2],
    },
    touchActivates: false,
    useActivates: true,
    shootActivates: false,
    speed: 50,
    moveMs: 200,
    delayMs: 0,
    fromOrigin: [0, 0, 0],
    toOrigin: [1, 0, 0],
    targetEntityIndexes: [],
  };
  const deathmatchSpawns = [{
    spawnId: "spawn-trigger",
    classname: "info_player_deathmatch",
    origin: [0, 0, 1],
    rotX: 0,
    rotY: 0,
  }];
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns,
    pickupDefinitions: [],
  });
  const harness = await createLoopbackHarness({
    now: 4100,
    sessionOptions: {
      trustedGameplayDefinitions: gameplayDefinitions,
      trustedWorldDefinitions: [triggerDefinition, moverDefinition],
    },
  });
  const { messages, session } = harness;
  try {
    session.send(helloEnvelope({
      messageId: "hello-world-non-button-mover",
      sequence: 1,
      sentAt: harness.now(),
    }));

    harness.advanceNow(120);
    session.send(worldEnvelope({
      messageId: "world-non-button-mover",
      sequence: 2,
      worldSequence: 1,
      sentAt: harness.now(),
      intent: {
        entityIndex: triggerDefinition.entityIndex,
        origin: [0, 0, 1],
      },
    }));

    const events = messages
      .filter((message) => message.type === "room.event")
      .map((message) => message.payload.event);
    const trigger = events.find((event) =>
      event.eventType === "world.trigger" &&
      event.entityIndex === triggerDefinition.entityIndex
    );
    const targets = events.find((event) =>
      event.eventType === "world.targets" &&
      event.sourceEntityIndex === triggerDefinition.entityIndex
    );
    const mover = events.find((event) =>
      event.eventType === "world.mover" &&
      event.entityIndex === moverDefinition.entityIndex
    );

    assert.ok(trigger, "expected trigger event");
    assert.ok(targets, "expected target dispatch event");
    assert.ok(mover, "expected target mover event");
    assert.equal(mover.classname, "func_door_secret");
    assert.equal(mover.activation, "target");
    assert.equal(mover.state, "moving-up");
    assert.equal(messages.some((message) => message.type === "room.reject"), false);
  } finally {
    harness.disconnect();
  }
});

test("party room target dispatch activates relay chains and target teleporters", () => {
  const triggerDefinition = {
    kind: "trigger",
    entityIndex: 100,
    classname: "trigger_multiple",
    bounds: {
      mins: [-1, -1, 0],
      maxs: [1, 1, 2],
    },
    touchActivates: true,
    useActivates: false,
    shootActivates: false,
    oneShot: false,
    delayMs: 0,
    waitMs: 0,
    targetEntityIndexes: [101, 102],
  };
  const relayDefinition = {
    kind: "trigger",
    entityIndex: 101,
    classname: "trigger_relay",
    touchActivates: false,
    useActivates: true,
    shootActivates: false,
    oneShot: false,
    delayMs: 0,
    waitMs: 0,
    targetEntityIndexes: [103],
  };
  const teleportDefinition = {
    kind: "teleport",
    entityIndex: 102,
    classname: "trigger_teleport",
    touchRequiresActivation: true,
    activationWindowMs: 200,
    destinationEntityIndex: 900,
    destinationOrigin: [8, 0, 1],
    destinationRotX: 90,
    destinationRotY: 180,
  };
  const moverDefinition = {
    kind: "mover",
    entityIndex: 103,
    classname: "func_plat",
    bounds: {
      mins: [2, -1, 0],
      maxs: [3, 1, 2],
    },
    touchActivates: false,
    useActivates: true,
    shootActivates: false,
    speed: 50,
    moveMs: 200,
    delayMs: 0,
    fromOrigin: [0, 0, 0],
    toOrigin: [0, 0, 1],
    targetEntityIndexes: [],
  };
  const { alice, partyRoom } = connectDuelRoom({
    id: "party-target-relay-teleport",
    deathmatchSpawns: [
      {
        spawnId: "spawn-target-a",
        classname: "info_player_deathmatch",
        origin: [0, 0, 1],
        rotX: 90,
        rotY: 0,
      },
      {
        spawnId: "spawn-target-b",
        classname: "info_player_deathmatch",
        origin: [4, 0, 1],
        rotX: 90,
        rotY: 180,
      },
    ],
    roomOptions: {
      trustedWorldDefinitions: [
        triggerDefinition,
        relayDefinition,
        teleportDefinition,
        moverDefinition,
      ],
    },
  });

  partyRoom.onMessage(JSON.stringify(worldEnvelope({
    clientId: "client-a",
    messageId: "world-party-target-relay-teleport",
    sequence: 2,
    worldSequence: 1,
    sentAt: Date.now(),
    intent: {
      entityIndex: triggerDefinition.entityIndex,
      origin: [0, 0, 1],
    },
  })), alice);

  const events = alice.messages
    .filter((message) => message.type === "room.event")
    .map((message) => message.payload.event);
  const sourceTrigger = events.find((event) =>
    event.eventType === "world.trigger" &&
    event.entityIndex === triggerDefinition.entityIndex &&
    event.activation === "touch"
  );
  const sourceTargets = events.find((event) =>
    event.eventType === "world.targets" &&
    event.sourceEntityIndex === triggerDefinition.entityIndex
  );
  const relayTrigger = events.find((event) =>
    event.eventType === "world.trigger" &&
    event.entityIndex === relayDefinition.entityIndex &&
    event.activation === "target"
  );
  const relayTargets = events.find((event) =>
    event.eventType === "world.targets" &&
    event.sourceEntityIndex === relayDefinition.entityIndex
  );
  const teleportUse = events.find((event) =>
    event.eventType === "world.use" &&
    event.entityIndex === teleportDefinition.entityIndex
  );
  const mover = events.find((event) =>
    event.eventType === "world.mover" &&
    event.entityIndex === moverDefinition.entityIndex
  );

  assert.ok(sourceTrigger, "expected source trigger event");
  assert.ok(sourceTargets, "expected source target dispatch event");
  assert.deepEqual(sourceTargets.targetEntityIndexes, [101, 102]);
  assert.ok(relayTrigger, "expected relay trigger event");
  assert.ok(relayTargets, "expected relay target dispatch event");
  assert.deepEqual(relayTargets.targetEntityIndexes, [103]);
  assert.ok(teleportUse, "expected target teleporter activation event");
  assert.ok(mover, "expected chained target mover event");
  assert.equal(mover.classname, "func_plat");
  assert.equal(mover.activation, "target");
  assert.equal(mover.state, "moving-up");
  assert.equal(alice.messages.some((message) => message.type === "room.reject"), false);
});
