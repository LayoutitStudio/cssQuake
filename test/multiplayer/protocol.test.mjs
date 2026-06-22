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
