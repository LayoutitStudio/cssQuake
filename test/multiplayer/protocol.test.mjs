import assert from "node:assert/strict";
import test from "node:test";

import {
  NORMALIZED_ROOM_KEY,
  ROOM_KEY,
  authority,
  helloEnvelope,
  inputBatchEnvelope,
  inputEnvelope,
  presenceEnvelope,
  protocol,
  validation,
} from "./partyRoomHarness.mjs";

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
