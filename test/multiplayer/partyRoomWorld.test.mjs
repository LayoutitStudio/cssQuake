import assert from "node:assert/strict";
import test from "node:test";

import {
  worldEnvelope,
  connectDuelRoom,
} from "./partyRoomHarness.mjs";

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
