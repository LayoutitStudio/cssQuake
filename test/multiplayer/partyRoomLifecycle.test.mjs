import assert from "node:assert/strict";
import test from "node:test";

import {
  authority,
  fireEnvelope,
  facts,
  helloEnvelope,
  inputBatchEnvelope,
  inputEnvelope,
  partyRoomModule,
  presenceEnvelope,
  createFakePartyRoom,
  latestConnectionMessage,
  roomEvents,
  connectDuelRoom,
  cleanupDuelRoom,
  cleanupPartyRoomConnections,
} from "./partyRoomHarness.mjs";

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

test("party room falls back to hello gameplay facts when implicit trusted asset lookup misses", async () => {
  const { room, createConnection } = createFakePartyRoom("trusted-asset-miss");
  const RoomClass = partyRoomModule.default;
  const assetRequests = [];
  room.context.assets = {
    fetch: async (assetPath) => {
      assetRequests.push(assetPath);
      return new Response("missing", { status: 404 });
    },
  };
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: [{
      spawnId: "asset-miss-spawn",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: 90,
      rotY: 0,
    }],
    pickupDefinitions: [],
  });
  const partyRoom = new RoomClass(room);
  const connection = createConnection("asset-miss-connection");

  partyRoom.onConnect(connection);
  const result = partyRoom.onMessage(JSON.stringify(helloEnvelope({
    deathmatchSpawns: gameplayDefinitions.deathmatchSpawns,
    gameplayFacts: gameplayDefinitions.gameplayFacts,
    messageId: "asset-miss-hello",
    pickupDefinitions: gameplayDefinitions.pickupDefinitions,
    sequence: 1,
    sentAt: Date.now(),
  })), connection);
  await Promise.resolve(result);

  assert.deepEqual(assetRequests, ["/q/e1m1.json"]);
  assert.equal(connection.messages.some((message) => message.type === "room.reject"), false);
  assert.equal(connection.state.playerId, "party:client-a");
  const snapshot = latestConnectionMessage(connection, "room.snapshot");
  assert.equal(snapshot.payload.players.length, 1);
});

test("party room rejects hello when explicit trusted gameplay fetcher misses", async () => {
  const { room, createConnection } = createFakePartyRoom("required-trusted-fetcher-miss");
  const RoomClass = partyRoomModule.default;
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: [{
      spawnId: "required-fetcher-spawn",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: 90,
      rotY: 0,
    }],
    pickupDefinitions: [],
  });
  const partyRoom = new RoomClass(room, {
    trustedGameplayDefinitionsFetcher: async () => null,
  });
  const connection = createConnection("required-fetcher-connection");

  partyRoom.onConnect(connection);
  const result = partyRoom.onMessage(JSON.stringify(helloEnvelope({
    deathmatchSpawns: gameplayDefinitions.deathmatchSpawns,
    gameplayFacts: gameplayDefinitions.gameplayFacts,
    messageId: "required-fetcher-hello",
    pickupDefinitions: gameplayDefinitions.pickupDefinitions,
    sequence: 1,
    sentAt: Date.now(),
  })), connection);
  await Promise.resolve(result);

  const reject = latestConnectionMessage(connection, "room.reject");
  assert.equal(reject.payload.code, "wrong-map");
  assert.equal(connection.state?.playerId, undefined);
});
