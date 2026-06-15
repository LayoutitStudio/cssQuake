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
  pickupEnvelope,
  presenceEnvelope,
  protocol,
  validation,
  worldEnvelope,
} from "./harness.mjs";

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
