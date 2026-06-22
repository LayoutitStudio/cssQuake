import assert from "node:assert/strict";
import test from "node:test";

import {
  NORMALIZED_ROOM_KEY,
  ROOM_KEY,
  authority,
  clientEnvelope,
  createLoopbackHarness,
  fireEnvelope,
  helloEnvelope,
  inputEnvelope,
  latestMessage,
  matchEnvelope,
  partyRoomModule,
  pickupEnvelope,
  presenceEnvelope,
  protocol,
  validation,
  worldEnvelope,
} from "./harness.mjs";
import { importTsModule } from "../importTsModule.mjs";

const facts = await importTsModule("src/runtime/multiplayer/facts.ts");

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

function connectDuelRoom({ id, pickupDefinitions = [], spawnDistance = 4 }) {
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
      origin: [spawnDistance, 0, 0],
      rotX: -78,
      rotY: 180,
    },
  ];
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns,
    pickupDefinitions,
  });
  const { room, createConnection } = createFakePartyRoom(id);
  const RoomClass = partyRoomModule.default;
  const partyRoom = new RoomClass(room, { trustedGameplayDefinitions: gameplayDefinitions });
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
    matchSettings: { fragLimit: 1 },
  })), alice);
  partyRoom.onMessage(JSON.stringify(helloEnvelope({
    clientId: "client-b",
    displayName: "Bob",
    messageId: `hello-b-${id}`,
    sequence: 1,
    sentAt: Date.now(),
    matchSettings: { fragLimit: 1 },
  })), bob);
  return { alice, bob, partyRoom };
}

function cleanupDuelRoom(partyRoom, alice, bob) {
  partyRoom.onClose(alice);
  partyRoom.onClose(bob);
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
  const partyRoom = new RoomClass(room, { trustedGameplayDefinitions: gameplayDefinitions });
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
  assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
  assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
});

test("party room applies authoritative weapon damage after weapon pickups", () => {
  const cases = [
    { weapon: "axe", damage: 20, pickup: true, spawnDistance: 1.2, eventType: "player.damaged", health: 80 },
    { weapon: "shotgun", damage: 24, pickup: false, spawnDistance: 4, eventType: "player.damaged", health: 76 },
    { weapon: "supershotgun", damage: 56, pickup: true, spawnDistance: 4, eventType: "player.damaged", health: 44 },
    { weapon: "nailgun", damage: 9, pickup: true, spawnDistance: 4, eventType: "player.damaged", health: 91 },
    { weapon: "supernailgun", damage: 18, pickup: true, spawnDistance: 4, eventType: "player.damaged", health: 82 },
    { weapon: "lightning", damage: 30, pickup: true, spawnDistance: 4, eventType: "player.damaged", health: 70 },
    { weapon: "grenadelauncher", pickup: true, spawnDistance: 4, eventType: "player.killed" },
    { weapon: "rocketlauncher", pickup: true, spawnDistance: 4, eventType: "player.killed" },
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
        partyRoom.onMessage(JSON.stringify(inputEnvelope({
          clientId: "client-a",
          messageId: `select-${spec.weapon}`,
          sequence: 2,
          inputSequence: 1,
          sentAt: Date.now(),
          input: { activeWeapon: spec.weapon },
        })), alice);
      }

      partyRoom.onMessage(JSON.stringify(fireEnvelope({
        clientId: "client-a",
        messageId: `fire-${spec.weapon}`,
        sequence: 3,
        fireSequence: 1,
        sentAt: Date.now(),
        fire: { weapon: spec.weapon },
      })), alice);

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
        assert.equal(victim.health, 0, `${spec.weapon} should leave victim at zero health`);
      }
      assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0, `${spec.weapon} alice rejects`);
      assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0, `${spec.weapon} bob rejects`);
    } finally {
      cleanupDuelRoom(partyRoom, alice, bob);
    }
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
