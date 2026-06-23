import assert from "node:assert/strict";
import test from "node:test";

import {
  createLoopbackHarness,
  createPlayer,
  fireEnvelope,
  helloEnvelope,
  inputBatchEnvelope,
  inputEnvelope,
  latestMessage,
  matchEnvelope,
  pickupEnvelope,
  presenceEnvelope,
  waitForMessage,
  worldEnvelope,
  facts,
  items,
  DUEL_FORWARD_DIRECTION,
  QUAD_ITEM_FLAG,
  INVULNERABILITY_ITEM_FLAG,
  weaponPickupDefinition,
  quadPickupDefinition,
  invulnerabilityPickupDefinition,
} from "./partyRoomHarness.mjs";

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
