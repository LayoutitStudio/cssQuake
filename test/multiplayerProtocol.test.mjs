import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "./importTsModule.mjs";

const protocol = await importTsModule("src/runtime/multiplayer/protocol.ts");
const validation = await importTsModule("src/runtime/multiplayer/validation.ts");
const authority = await importTsModule("src/runtime/multiplayer/authority.ts");
const facts = await importTsModule("src/runtime/multiplayer/facts.ts");
const sceneFacts = await importTsModule("src/runtime/multiplayer/sceneFacts.ts");
const loopback = await importTsModule("src/runtime/multiplayer/loopback.ts");
const partySocket = await importTsModule("src/runtime/multiplayer/partysocket.ts");
const movement = await importTsModule("src/runtime/multiplayer/movement.ts");
const simulation = await importTsModule("src/runtime/multiplayer/simulation.ts");
const deathmatch = await importTsModule("src/runtime/multiplayer/deathmatch.ts");
const items = await importTsModule("src/runtime/multiplayer/items.ts");
const reconciliation = await importTsModule("src/runtime/multiplayer/reconciliation.ts");
const cadence = await importTsModule("src/runtime/multiplayer/cadence.ts");
const heartbeat = await importTsModule("src/runtime/multiplayer/heartbeat.ts");
const world = await importTsModule("src/runtime/multiplayer/world.ts");
const constants = await importTsModule("src/runtime/constants.ts");
const partyRoom = await importTsModule("party/quake.ts");

const {
  QUAKE_MULTIPLAYER_PROTOCOL_VERSION,
  createQuakeMultiplayerEnvelope,
  createQuakeMultiplayerRoomCompatibilityKey,
  sameQuakeMultiplayerRoomCompatibilityKey,
} = protocol;
const {
  validateQuakeMultiplayerAnyEnvelope,
  validateQuakeMultiplayerClientEnvelope,
  validateQuakeMultiplayerRoomEnvelope,
} = validation;
const {
  validateQuakeMultiplayerClientAuthority,
} = authority;
const {
  createQuakeMultiplayerGameplayDefinitions,
  createQuakeMultiplayerGameplayFacts,
  checkQuakeMultiplayerGameplayFactsClaim,
} = facts;
const {
  quakeMultiplayerGameplayDefinitionsFromScene,
} = sceneFacts;
const {
  QUAKE_MULTIPLAYER_ROOM_SNAPSHOT_INTERVAL_MS,
  shouldEmitQuakeMultiplayerRoomSnapshot,
} = cadence;
const {
  isQuakeMultiplayerClientStale,
  quakeMultiplayerPingMsFromPong,
  shouldSendQuakeMultiplayerRoomPing,
} = heartbeat;
const {
  QUAKE_COLLISION_UNIT_SCALE,
  QUAKE_PLAYER_MINS_Z,
} = constants;
const {
  createQuakeLoopbackMultiplayerSession,
} = loopback;
const {
  normalizeQuakePartySocketHost,
} = partySocket;
const {
  quakeMultiplayerAdvancePlayerWithInput,
} = movement;
const {
  QUAKE_MULTIPLAYER_ROOM_SIMULATION_TICK_MS,
  QUAKE_MULTIPLAYER_TELEPORT_BACKPEDAL_LOCK_MS,
  QUAKE_MULTIPLAYER_DROWN_AIR_MS,
  QUAKE_MULTIPLAYER_DROWN_DAMAGE_INTERVAL_MS,
  QUAKE_MULTIPLAYER_DROWN_INITIAL_DAMAGE,
  QUAKE_MULTIPLAYER_LAVA_DAMAGE_INTERVAL_MS,
  QUAKE_MULTIPLAYER_LIQUID_RADSUIT_DAMAGE_INTERVAL_MS,
  QUAKE_MULTIPLAYER_SLIME_DAMAGE_INTERVAL_MS,
  QUAKE_MULTIPLAYER_WATER_VELOCITY_DAMPING,
  advanceQuakeMultiplayerRoomPlayerSimulation,
  createQuakeMultiplayerRoomPlayerSimulationState,
  quakeMultiplayerInputAfterTeleportBackpedalLock,
  queueQuakeMultiplayerRoomInput,
} = simulation;
const {
  quakeMultiplayerDeathmatchHitHasLineOfSight,
  quakeMultiplayerDeathmatchLightningDischarge,
  quakeMultiplayerDeathmatchPlayerWithDamageMomentum,
} = deathmatch;
const {
  quakeMultiplayerApplyDamageToInventory,
} = items;
const {
  decideQuakeMultiplayerLocalCorrection,
} = reconciliation;
const {
  QUAKE_MULTIPLAYER_TELEFRAG_DAMAGE,
  QUAKE_MULTIPLAYER_TELEPORT_EXIT_SPEED,
  QUAKE_MULTIPLAYER_TELEPORT_TARGET_ACTIVATION_WINDOW_MS,
  QUAKE_MULTIPLAYER_TRIGGER_HURT_COOLDOWN_MS,
  quakeMultiplayerMoverOffsetAtTime,
  quakeMultiplayerMoverOffsetForState,
  quakeMultiplayerPlayerFacesTrigger,
  quakeMultiplayerPlayerIntersectsTelefragVolume,
  quakeMultiplayerTeleportExitVelocity,
  quakeMultiplayerWorldDefinitionsFromScene,
} = world;
const {
  default: CssQuakeMultiplayerRoom,
} = partyRoom;

const roomKey = createQuakeMultiplayerRoomCompatibilityKey({
  mapName: "E1M1",
  assetManifestVersion: 1,
  assetRoot: " /q ",
  sceneUrl: " /q/e1m1.json ",
  preparedSceneVersion: 2,
  gameLogicVersion: 1,
});
const alternateRoomKey = createQuakeMultiplayerRoomCompatibilityKey({
  mapName: "E1M2",
  assetManifestVersion: 1,
  assetRoot: "/q",
  sceneUrl: "/q/e1m2.json",
  preparedSceneVersion: 2,
  gameLogicVersion: 1,
});
const testDeathmatchSpawns = [{
  spawnId: "dm-1",
  classname: "info_player_deathmatch",
  origin: [1, 2, 3],
  rotX: 0,
  rotY: 90,
  sourceEntityIndex: 42,
}];
const testPickupDefinitions = [{
  pickupId: "pickup-1",
  entityIndex: 12,
  classname: "item_shells",
  origin: [4, 5, 6],
  effect: { shells: 20 },
  lifecycle: { action: "respawn", condition: "deathmatch", delayMs: 30000 },
  feedback: { message: "shells", soundPath: "weapons/pkup.wav" },
}];
const testLeavePickupDefinitions = [{
  pickupId: "leave-shells",
  entityIndex: 88,
  classname: "item_shells",
  origin: testDeathmatchSpawns[0].origin,
  effect: { shells: 20 },
  lifecycle: { action: "leave", condition: "deathmatch" },
  feedback: { message: "shells", soundPath: "weapons/pkup.wav" },
}];
const testWorldDefinitions = [{
  kind: "teleport",
  entityIndex: 77,
  classname: "trigger_teleport",
  bounds: { mins: [-1, -1, -1], maxs: [3, 3, 3] },
  destinationEntityIndex: 78,
  destinationOrigin: [10, 20, 30],
  destinationRotX: 90,
  destinationRotY: 180,
}, {
  kind: "changelevel",
  entityIndex: 79,
  classname: "trigger_changelevel",
  bounds: { mins: [-1, -1, -1], maxs: [3, 3, 3] },
  targetMap: "e1m2",
}, {
  kind: "hurt",
  entityIndex: 80,
  classname: "trigger_hurt",
  bounds: { mins: [-1, -1, -1], maxs: [3, 3, 3] },
  damage: 25,
}, {
  kind: "push",
  entityIndex: 81,
  classname: "trigger_push",
  bounds: { mins: [-1, -1, -1], maxs: [3, 3, 3] },
  direction: [0, 0, 1],
  speed: 20,
  velocity: [0, 0, 200 * QUAKE_COLLISION_UNIT_SCALE],
  oneShot: true,
}, {
  kind: "trigger",
  entityIndex: 82,
  classname: "trigger_multiple",
  bounds: { mins: [-1, -1, -1], maxs: [3, 3, 3] },
  touchActivates: true,
  useActivates: true,
  oneShot: false,
  delayMs: 0,
  waitMs: 200,
  targetEntityIndexes: [201, 202, 206, 208],
  killtargetEntityIndexes: [203],
  message: "triggered",
  soundPath: "misc/trigger1.wav",
}, {
  kind: "trigger",
  entityIndex: 201,
  classname: "trigger_relay",
  touchActivates: false,
  useActivates: true,
  oneShot: false,
  delayMs: 0,
  waitMs: 0,
  targetEntityIndexes: [204],
}, {
  kind: "trigger",
  entityIndex: 202,
  classname: "trigger_counter",
  touchActivates: false,
  useActivates: true,
  oneShot: true,
  delayMs: 0,
  waitMs: 0,
  count: 2,
  counterMessages: [{
    minRemaining: 4,
    message: "There are more to go...",
  }, {
    remaining: 3,
    message: "Only 3 more to go...",
  }, {
    remaining: 2,
    message: "Only 2 more to go...",
  }, {
    remaining: 1,
    message: "Only 1 more to go...",
  }, {
    remaining: 0,
    message: "Sequence completed!",
  }],
  targetEntityIndexes: [205],
}, {
  kind: "trigger",
  entityIndex: 206,
  classname: "trigger_once",
  touchActivates: false,
  useActivates: true,
  oneShot: true,
  delayMs: 0,
  waitMs: 0,
  targetEntityIndexes: [207],
  message: "one-shot target",
}, {
  kind: "mover",
  entityIndex: 208,
  classname: "func_button",
  useActivates: true,
  touchActivates: false,
  shootActivates: false,
  speed: 40,
  moveMs: 0,
  delayMs: 0,
  fromOrigin: [0, 0, 0],
  toOrigin: [1, 0, 0],
  targetEntityIndexes: [209],
  soundPath: "buttons/switch02.wav",
}, {
  kind: "mover",
  entityIndex: 210,
  classname: "func_button",
  bounds: { mins: [-1, -1, -1], maxs: [3, 3, 3] },
  useActivates: true,
  touchActivates: true,
  shootActivates: false,
  speed: 40,
  moveMs: 0,
  delayMs: 0,
  fromOrigin: [0, 0, 0],
  toOrigin: [2, 0, 0],
  targetEntityIndexes: [211],
  soundPath: "buttons/switch04.wav",
}, {
  kind: "mover",
  entityIndex: 212,
  classname: "func_button",
  bounds: { mins: [-1, -1, -12], maxs: [2, 3, -8] },
  useActivates: true,
  touchActivates: false,
  shootActivates: true,
  shootHealth: 40,
  speed: 40,
  moveMs: 0,
  delayMs: 0,
  fromOrigin: [0, 0, -12],
  toOrigin: [0, 0, -10],
  targetEntityIndexes: [213],
  soundPath: "buttons/switch21.wav",
}, {
  kind: "mover",
  entityIndex: 214,
  classname: "func_button",
  bounds: { mins: [-1, -1, -1], maxs: [3, 3, 3] },
  useActivates: true,
  touchActivates: true,
  shootActivates: false,
  speed: 40,
  moveMs: 1,
  returnDelayMs: 1,
  delayMs: 0,
  fromOrigin: [0, 0, 0],
  toOrigin: [0, 0, 2],
  targetEntityIndexes: [215],
  soundPath: "buttons/switch02.wav",
}];
const testTargetnamedTeleportWorldDefinitions = [{
  kind: "teleport",
  entityIndex: 177,
  classname: "trigger_teleport",
  bounds: { mins: [-1, -1, -1], maxs: [3, 3, 3] },
  destinationEntityIndex: 178,
  destinationOrigin: [30, 40, 50],
  destinationRotX: 90,
  destinationRotY: 180,
  touchRequiresActivation: true,
  activationWindowMs: QUAKE_MULTIPLAYER_TELEPORT_TARGET_ACTIVATION_WINDOW_MS,
}, {
  kind: "trigger",
  entityIndex: 179,
  classname: "trigger_multiple",
  bounds: { mins: [-1, -1, -1], maxs: [3, 3, 3] },
  touchActivates: true,
  useActivates: true,
  oneShot: false,
  delayMs: 0,
  waitMs: 0,
  targetEntityIndexes: [177],
}];
const testFacingTriggerWorldDefinitions = [{
  kind: "trigger",
  entityIndex: 188,
  classname: "trigger_multiple",
  bounds: { mins: [-1, -1, -1], maxs: [3, 3, 3] },
  touchActivates: true,
  useActivates: true,
  oneShot: false,
  delayMs: 0,
  waitMs: 200,
  targetEntityIndexes: [],
  facingDirection: [1, 0, 0],
}];
const testShootableTriggerWorldDefinitions = [{
  kind: "trigger",
  entityIndex: 218,
  classname: "trigger_multiple",
  bounds: { mins: [-1, -1, -12], maxs: [3, 3, -8] },
  touchActivates: false,
  useActivates: true,
  shootActivates: true,
  shootHealth: 40,
  oneShot: false,
  delayMs: 0,
  waitMs: 200,
  targetEntityIndexes: [219],
  message: "shot trigger",
  soundPath: "misc/trigger1.wav",
}];
const testGameplayFacts = createQuakeMultiplayerGameplayFacts({
  deathmatchSpawns: testDeathmatchSpawns,
  pickupDefinitions: testPickupDefinitions,
});

test("room compatibility keys canonicalize and compare stable map identity", () => {
  assert.deepEqual(roomKey, {
    mapName: "e1m1",
    assetManifestVersion: 1,
    assetRoot: "/q",
    sceneUrl: "/q/e1m1.json",
    preparedSceneVersion: 2,
    gameLogicVersion: 1,
  });
  assert.equal(sameQuakeMultiplayerRoomCompatibilityKey(roomKey, {
    mapName: " e1m1 ",
    assetManifestVersion: 1,
    assetRoot: "/q",
    sceneUrl: "/q/e1m1.json",
    preparedSceneVersion: 2,
    gameLogicVersion: 1,
  }), true);
});

test("PartySocket host overrides normalize to bare hosts", () => {
  assert.equal(normalizeQuakePartySocketHost(" 127.0.0.1:1999 "), "127.0.0.1:1999");
  assert.equal(normalizeQuakePartySocketHost("https://cssquake.example.com/"), "cssquake.example.com");
  assert.equal(normalizeQuakePartySocketHost("wss://cssquake.example.com"), "cssquake.example.com");
  assert.equal(normalizeQuakePartySocketHost("https://cssquake.example.com/rooms/abc"), null);
  assert.equal(normalizeQuakePartySocketHost("https://user:pass@cssquake.example.com/"), null);
  assert.equal(normalizeQuakePartySocketHost("ftp://cssquake.example.com"), null);
  assert.equal(normalizeQuakePartySocketHost("cssquake.example.com?room=abc"), null);
});

test("valid client hello envelopes pass protocol validation", () => {
  const envelope = createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "hello-1",
    sequence: 7,
    sentAt: 1000,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      color: "#d8893f",
      capabilities: ["loopback"],
      matchSettings: { maxPlayers: 8, fragLimit: 20 },
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  });

  const result = validateQuakeMultiplayerClientEnvelope(envelope, { roomKey, now: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.envelope.payload.clientId, "client-a");
});

test("gameplay facts fingerprints are stable for spawn and pickup definitions", () => {
  const sameFacts = createQuakeMultiplayerGameplayFacts({
    pickupDefinitions: [...testPickupDefinitions].reverse(),
    deathmatchSpawns: [...testDeathmatchSpawns].reverse(),
  });
  assert.deepEqual(sameFacts, testGameplayFacts);

  const changedFacts = createQuakeMultiplayerGameplayFacts({
    deathmatchSpawns: testDeathmatchSpawns,
    pickupDefinitions: [{
      ...testPickupDefinitions[0],
      effect: { shells: 40 },
    }],
  });
  assert.notEqual(changedFacts.factsHash, testGameplayFacts.factsHash);
});

test("gameplay facts claims reject inconsistent supplied definitions", () => {
  const changedFacts = createQuakeMultiplayerGameplayFacts({
    deathmatchSpawns: testDeathmatchSpawns,
    pickupDefinitions: [{
      ...testPickupDefinitions[0],
      effect: { shells: 40 },
    }],
  });
  const result = checkQuakeMultiplayerGameplayFactsClaim(changedFacts, {
    deathmatchSpawns: testDeathmatchSpawns,
    pickupDefinitions: testPickupDefinitions,
  });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.computed?.factsHash, testGameplayFacts.factsHash);

  const missingDefinitions = checkQuakeMultiplayerGameplayFactsClaim(testGameplayFacts, {}, {
    requireDefinitionsForNonEmptyFacts: true,
  });
  assert.equal(missingDefinitions.ok, false);
});

test("scene gameplay definitions derive deathmatch spawns and pickup facts from prepared game logic", () => {
  const definitions = quakeMultiplayerGameplayDefinitionsFromScene({
    entities: [{
      index: 10,
      classname: "info_player_deathmatch",
      properties: { angle: "90" },
      origin: { x: 100, y: 200, z: 300 },
      angle: 90,
    }, {
      index: 20,
      classname: "weapon_rocketlauncher",
      properties: {
        target: "rocketTarget",
        killtarget: "rocketKill",
        delay: "0.25",
        message: "The rocket launcher opened a route",
      },
      origin: { x: 400, y: 500, z: 600 },
    }],
    entityManifest: {
      runtime: {
        pickupEntityIndexes: [20],
        targetEntities: {
          rocketTarget: [30],
          rocketKill: [31],
        },
      },
    },
    gameLogic: {
      entities: [{
        entityIndex: 20,
        origin: { x: 400, y: 500, z: 600 },
        resolvedPickup: {
          kind: "weapon_rocketlauncher",
          inventoryDelta: { rockets: 5 },
          behavior: {
            weapon: {
              itemFlag: 32,
              itemFlagExpression: "IT_ROCKET_LAUNCHER",
              ammoGrant: { inventoryField: "rockets", amount: 5 },
            },
          },
          lifecycle: {
            respawn: {
              rules: [{
                action: "respawn",
                condition: "deathmatch == 1",
                delaySeconds: 30,
              }],
            },
          },
          feedback: { message: "You got the Rocket Launcher" },
        },
      }],
    },
    spawn: {
      origin: [0, 0, 0],
      rotX: 90,
      rotY: 270,
    },
  }, {
    pointToRoom: ({ x, y, z }) => [x / 100, y / 100, z / 100],
    playerMinsZ: -0.25,
    playerEyeHeight: 0.75,
  });

  assert.deepEqual(definitions.deathmatchSpawns, [{
    spawnId: "entity:10",
    classname: "info_player_deathmatch",
    origin: [1, 2, 3.5],
    rotX: 90,
    rotY: 270,
    sourceEntityIndex: 10,
  }]);
  assert.deepEqual(definitions.pickupDefinitions, [{
    pickupId: "entity:20",
    entityIndex: 20,
    classname: "weapon_rocketlauncher",
    origin: [4, 5, 6],
    effect: {
      rockets: 5,
      weapon: { id: "rocketlauncher", itemFlag: 32, select: true },
    },
    lifecycle: { action: "respawn", condition: "deathmatch == 1", delayMs: 30000 },
    feedback: { message: "You got the Rocket Launcher" },
    targetEntityIndexes: [30],
    killtargetEntityIndexes: [31],
    delayMs: 250,
    message: "The rocket launcher opened a route",
  }]);
  assert.equal(definitions.gameplayFacts.deathmatchSpawnCount, 1);
  assert.equal(definitions.gameplayFacts.pickupCount, 1);
});

test("scene gameplay definitions infer prepared scene pivot and player eye height", () => {
  const definitions = quakeMultiplayerGameplayDefinitionsFromScene({
    entities: [{
      index: 10,
      classname: "info_player_deathmatch",
      properties: { angle: "90" },
      origin: { x: 110, y: 180, z: 330 },
      angle: 90,
    }, {
      index: 20,
      classname: "item_shells",
      properties: {},
      origin: { x: 140, y: 190, z: 360 },
    }],
    entityManifest: {
      runtime: {
        pickupEntityIndexes: [20],
      },
    },
    collision: {
      pivot: { x: 100, y: 200, z: 300 },
    },
    gameLogic: {
      entities: [{
        entityIndex: 20,
        origin: { x: 140, y: 190, z: 360 },
        resolvedPickup: {
          kind: "item_shells",
          inventoryDelta: { shells: 20 },
          behavior: {
            ammo: { inventoryField: "shells", amount: 20 },
          },
          lifecycle: {
            respawn: {
              rules: [{
                action: "respawn",
                condition: "deathmatch",
                delaySeconds: 30,
              }],
            },
          },
        },
      }],
    },
    spawn: {
      origin: [0, 0, 0],
      eyeHeight: 0.92,
      rotX: 90,
      rotY: 270,
    },
  }, {});

  assert.deepEqual(definitions.deathmatchSpawns[0].origin, [
    10 * QUAKE_COLLISION_UNIT_SCALE,
    -20 * QUAKE_COLLISION_UNIT_SCALE,
    30 * QUAKE_COLLISION_UNIT_SCALE + QUAKE_PLAYER_MINS_Z + 0.92,
  ]);
  assert.deepEqual(definitions.pickupDefinitions[0].origin, [
    40 * QUAKE_COLLISION_UNIT_SCALE,
    -10 * QUAKE_COLLISION_UNIT_SCALE,
    60 * QUAKE_COLLISION_UNIT_SCALE,
  ]);
});

test("scene world definitions derive teleport, changelevel, hurt, push, and touch triggers", () => {
  const definitions = quakeMultiplayerWorldDefinitionsFromScene({
    entities: [{
      index: 30,
      classname: "trigger_teleport",
      properties: { target: "tele1", targetname: "tele_gate", model: "*1" },
      model: "*1",
      modelIndex: 1,
    }, {
      index: 31,
      classname: "info_teleport_destination",
      properties: { targetname: "tele1", angle: "90" },
      origin: { x: 200, y: 210, z: 320 },
      angle: 90,
    }, {
      index: 40,
      classname: "trigger_changelevel",
      properties: { map: "E1M2", model: "*2" },
      model: "*2",
      modelIndex: 2,
    }, {
      index: 50,
      classname: "trigger_hurt",
      properties: { model: "*3" },
      model: "*3",
      modelIndex: 3,
    }, {
      index: 60,
      classname: "trigger_push",
      properties: { model: "*4" },
      model: "*4",
      modelIndex: 4,
    }, {
      index: 70,
      classname: "trigger_multiple",
      properties: { angle: "360", model: "*5" },
      angle: 360,
      model: "*5",
      modelIndex: 5,
    }, {
      index: 80,
      classname: "trigger_relay",
      properties: {},
    }, {
      index: 81,
      classname: "trigger_counter",
      properties: {},
    }, {
      index: 90,
      classname: "func_button",
      properties: { target: "buttonTarget", killtarget: "buttonKill", delay: "0.25", model: "*6" },
      model: "*6",
      modelIndex: 6,
    }, {
      index: 93,
      classname: "func_button",
      properties: { target: "shootButtonTarget", health: "40", model: "*7" },
      model: "*7",
      modelIndex: 7,
    }, {
      index: 95,
      classname: "func_button",
      properties: { model: "*8" },
      model: "*8",
      modelIndex: 8,
    }, {
      index: 100,
      classname: "trigger_multiple",
      properties: { target: "shootTriggerTarget", health: "20", model: "*9" },
      model: "*9",
      modelIndex: 9,
    }],
    entityManifest: {
      runtime: {
        targetEntities: {
          tele1: [31],
          buttonTarget: [91],
          buttonKill: [92],
          shootButtonTarget: [94],
          shootTriggerTarget: [101],
        },
      },
    },
    collision: {
      pivot: { x: 100, y: 200, z: 300 },
    },
    spawn: {
      eyeHeight: 0.92,
    },
    gameLogic: {
      entities: [{
        entityIndex: 30,
        classname: "trigger_teleport",
        brushModel: {
          mins: { x: 90, y: 190, z: 290 },
          maxs: { x: 110, y: 210, z: 310 },
        },
        resolvedTrigger: {
          kind: "trigger_teleport",
          destinationEntityIndexes: [31],
        },
      }, {
        entityIndex: 40,
        classname: "trigger_changelevel",
        brushModel: {
          mins: { x: 120, y: 220, z: 320 },
          maxs: { x: 130, y: 230, z: 330 },
        },
        resolvedTrigger: {
          kind: "trigger_changelevel",
          changelevelMap: "E1M2",
        },
      }, {
        entityIndex: 50,
        classname: "trigger_hurt",
        brushModel: {
          mins: { x: 140, y: 240, z: 340 },
          maxs: { x: 150, y: 250, z: 350 },
        },
        resolvedTrigger: {
          kind: "trigger_hurt",
          dmg: 13,
        },
      }, {
        entityIndex: 60,
        classname: "trigger_push",
        brushModel: {
          mins: { x: 160, y: 260, z: 360 },
          maxs: { x: 170, y: 270, z: 370 },
        },
        resolvedTrigger: {
          kind: "trigger_push",
          moveDirection: { x: 0, y: 0, z: 1 },
          speed: 20,
          pushVelocityMultiplier: 10,
          oneShot: true,
        },
      }, {
        entityIndex: 70,
        classname: "trigger_multiple",
        brushModel: {
          mins: { x: 180, y: 280, z: 380 },
          maxs: { x: 190, y: 290, z: 390 },
        },
        resolvedTrigger: {
          kind: "trigger_multiple",
          targetUse: {
            delay: 0.1,
            targetEntityIndexes: [71],
            killtargetEntityIndexes: [72],
          },
          wait: 0.2,
          touchActivates: true,
          useActivates: true,
          oneShot: false,
          message: "go",
          activationSound: "misc/trigger1.wav",
        },
      }, {
        entityIndex: 80,
        classname: "trigger_relay",
        resolvedTrigger: {
          kind: "trigger_relay",
          targetUse: {
            delay: 0,
            targetEntityIndexes: [82],
          },
          touchActivates: false,
          useActivates: true,
          oneShot: false,
        },
      }, {
        entityIndex: 81,
        classname: "trigger_counter",
        resolvedTrigger: {
          kind: "trigger_counter",
          targetUse: {
            delay: 0,
            targetEntityIndexes: [83],
          },
          count: 2,
          wait: -1,
          touchActivates: false,
          useActivates: true,
          oneShot: true,
          generatedText: [{
            lane: "centerprint",
            reason: "counter-remaining",
            text: "Only 1 more to go...",
            condition: { remaining: 1 },
          }, {
            lane: "centerprint",
            reason: "counter-complete",
            text: "Sequence completed!",
            condition: { remaining: 0 },
          }],
        },
      }, {
        entityIndex: 90,
        classname: "func_button",
        brushModel: {
          mins: { x: 200, y: 220, z: 330 },
          maxs: { x: 240, y: 260, z: 350 },
        },
        resolvedMover: {
          kind: "func_button",
          speed: 20,
          wait: 1,
          pos1Origin: { x: 200, y: 220, z: 330 },
          pos2Origin: { x: 240, y: 220, z: 330 },
          travelDistance: 40,
          activationSound: "buttons/switch02.wav",
          callbacks: {
            use: "button_use",
          },
        },
      }, {
        entityIndex: 93,
        classname: "func_button",
        brushModel: {
          mins: { x: 260, y: 220, z: 330 },
          maxs: { x: 280, y: 240, z: 350 },
        },
        resolvedMover: {
          kind: "func_button",
          speed: 40,
          wait: 1,
          health: 40,
          pos1Origin: { x: 260, y: 220, z: 330 },
          pos2Origin: { x: 280, y: 220, z: 330 },
          travelDistance: 20,
          activationSound: "buttons/switch21.wav",
          callbacks: {
            use: "button_use",
            th_die: "button_killed",
          },
        },
      }, {
        entityIndex: 95,
        classname: "func_button",
        brushModel: {
          mins: { x: 300, y: 220, z: 330 },
          maxs: { x: 320, y: 240, z: 350 },
        },
        resolvedMover: {
          kind: "func_button",
          speed: 40,
          wait: 1,
          pos1Origin: { x: 300, y: 220, z: 330 },
          pos2Origin: { x: 301, y: 220, z: 330 },
          travelDistance: 1,
          callbacks: {
            use: "button_use",
          },
        },
      }, {
        entityIndex: 100,
        classname: "trigger_multiple",
        brushModel: {
          mins: { x: 330, y: 220, z: 330 },
          maxs: { x: 350, y: 240, z: 350 },
        },
        resolvedTrigger: {
          kind: "trigger_multiple",
          targetUse: {
            delay: 0,
            targetEntityIndexes: [101],
          },
          health: 20,
          damageable: true,
          wait: 0.2,
          touchActivates: false,
          useActivates: true,
          oneShot: false,
          message: "shoot me",
          activationSound: "misc/trigger1.wav",
        },
      }],
    },
  }, {});

  const teleport = definitions.find((definition) => definition.kind === "teleport");
  const changelevel = definitions.find((definition) => definition.kind === "changelevel");
  const hurt = definitions.find((definition) => definition.kind === "hurt");
  const push = definitions.find((definition) => definition.kind === "push");
  const trigger = definitions.find((definition) => definition.kind === "trigger");
  const relay = definitions.find((definition) => definition.kind === "trigger" && definition.classname === "trigger_relay");
  const counter = definitions.find((definition) => definition.kind === "trigger" && definition.classname === "trigger_counter");
  const button = definitions.find((definition) => definition.kind === "mover" && definition.classname === "func_button");
  const shootButton = definitions.find((definition) => definition.kind === "mover" && definition.entityIndex === 93);
  const shortButton = definitions.find((definition) => definition.kind === "mover" && definition.entityIndex === 95);
  const shootTrigger = definitions.find((definition) => definition.kind === "trigger" && definition.entityIndex === 100);
  assert.deepEqual(teleport?.bounds, {
    mins: [-10 * QUAKE_COLLISION_UNIT_SCALE, -10 * QUAKE_COLLISION_UNIT_SCALE, -10 * QUAKE_COLLISION_UNIT_SCALE],
    maxs: [10 * QUAKE_COLLISION_UNIT_SCALE, 10 * QUAKE_COLLISION_UNIT_SCALE, 10 * QUAKE_COLLISION_UNIT_SCALE],
  });
  assert.deepEqual(teleport?.destinationOrigin, [
    100 * QUAKE_COLLISION_UNIT_SCALE,
    10 * QUAKE_COLLISION_UNIT_SCALE,
    20 * QUAKE_COLLISION_UNIT_SCALE + QUAKE_PLAYER_MINS_Z + 0.92,
  ]);
  assert.equal(teleport?.destinationEntityIndex, 31);
  assert.equal(teleport?.destinationRotY, 270);
  assert.equal(teleport?.touchRequiresActivation, true);
  assert.equal(teleport?.activationWindowMs, QUAKE_MULTIPLAYER_TELEPORT_TARGET_ACTIVATION_WINDOW_MS);
  assert.equal(changelevel?.targetMap, "e1m2");
  assert.equal(hurt?.damage, 13);
  assert.deepEqual(hurt?.bounds, {
    mins: [40 * QUAKE_COLLISION_UNIT_SCALE, 40 * QUAKE_COLLISION_UNIT_SCALE, 40 * QUAKE_COLLISION_UNIT_SCALE],
    maxs: [50 * QUAKE_COLLISION_UNIT_SCALE, 50 * QUAKE_COLLISION_UNIT_SCALE, 50 * QUAKE_COLLISION_UNIT_SCALE],
  });
  assert.deepEqual(push?.velocity, [0, 0, 200 * QUAKE_COLLISION_UNIT_SCALE]);
  assert.equal(push?.oneShot, true);
  assert.equal(trigger?.classname, "trigger_multiple");
  assert.deepEqual(trigger?.targetEntityIndexes, [71]);
  assert.deepEqual(trigger?.killtargetEntityIndexes, [72]);
  assert.equal(trigger?.delayMs, 100);
  assert.equal(trigger?.waitMs, 200);
  assert.deepEqual(trigger?.facingDirection, [1, 0, 0]);
  assert.equal(trigger?.message, "go");
  assert.equal(trigger?.soundPath, "misc/trigger1.wav");
  assert.equal(shootTrigger?.touchActivates, false);
  assert.equal(shootTrigger?.useActivates, true);
  assert.equal(shootTrigger?.shootActivates, true);
  assert.equal(shootTrigger?.shootHealth, 20);
  assert.deepEqual(shootTrigger?.targetEntityIndexes, [101]);
  assert.equal(shootTrigger?.message, "shoot me");
  assert.deepEqual(relay?.targetEntityIndexes, [82]);
  assert.equal(relay?.touchActivates, false);
  assert.equal(relay?.useActivates, true);
  assert.deepEqual(counter?.targetEntityIndexes, [83]);
  assert.equal(counter?.count, 2);
  assert.equal(counter?.oneShot, true);
  assert.deepEqual(counter?.counterMessages, [{
    remaining: 1,
    message: "Only 1 more to go...",
  }, {
    remaining: 0,
    message: "Sequence completed!",
  }]);
  assert.equal(button?.useActivates, true);
  assert.equal(button?.touchActivates, false);
  assert.equal(button?.shootActivates, false);
  assert.deepEqual(button?.bounds, {
    mins: [100 * QUAKE_COLLISION_UNIT_SCALE, 20 * QUAKE_COLLISION_UNIT_SCALE, 30 * QUAKE_COLLISION_UNIT_SCALE],
    maxs: [140 * QUAKE_COLLISION_UNIT_SCALE, 60 * QUAKE_COLLISION_UNIT_SCALE, 50 * QUAKE_COLLISION_UNIT_SCALE],
  });
  assert.deepEqual(button?.fromOrigin, [
    100 * QUAKE_COLLISION_UNIT_SCALE,
    20 * QUAKE_COLLISION_UNIT_SCALE,
    30 * QUAKE_COLLISION_UNIT_SCALE,
  ]);
  assert.deepEqual(button?.toOrigin, [
    140 * QUAKE_COLLISION_UNIT_SCALE,
    20 * QUAKE_COLLISION_UNIT_SCALE,
    30 * QUAKE_COLLISION_UNIT_SCALE,
  ]);
  assert.equal(button?.speed, 20);
  assert.equal(button?.moveMs, 2000);
  assert.equal(button?.returnDelayMs, 1000);
  assert.equal(button?.delayMs, 250);
  assert.deepEqual(button?.targetEntityIndexes, [91]);
  assert.deepEqual(button?.killtargetEntityIndexes, [92]);
  assert.equal(button?.soundPath, "buttons/switch02.wav");
  assert.equal(shootButton?.useActivates, true);
  assert.equal(shootButton?.touchActivates, false);
  assert.equal(shootButton?.shootActivates, true);
  assert.equal(shootButton?.shootHealth, 40);
  assert.deepEqual(shootButton?.targetEntityIndexes, [94]);
  assert.equal(shortButton?.moveMs, 100);
});

test("mover collision offsets follow timed button movement phases", () => {
  const definition = {
    kind: "mover",
    entityIndex: 900,
    classname: "func_button",
    useActivates: true,
    touchActivates: true,
    shootActivates: false,
    speed: 40,
    moveMs: 40,
    returnDelayMs: 40,
    delayMs: 0,
    fromOrigin: [0, 0, -1],
    toOrigin: [0, 0, 3],
    targetEntityIndexes: [],
  };

  assert.deepEqual(quakeMultiplayerMoverOffsetForState(definition, "bottom"), [0, 0, 0]);
  assert.deepEqual(quakeMultiplayerMoverOffsetForState(definition, "top"), [0, 0, 4]);
  assert.deepEqual(quakeMultiplayerMoverOffsetAtTime(definition, "moving-up", 1000, 1020, 40), [0, 0, 2]);
  assert.deepEqual(quakeMultiplayerMoverOffsetAtTime(definition, "moving-down", 1000, 1020, 40), [0, 0, 2]);
  assert.deepEqual(quakeMultiplayerMoverOffsetAtTime(definition, "moving-up", 1000, 1100, 40), [0, 0, 4]);
  assert.deepEqual(quakeMultiplayerMoverOffsetAtTime(definition, "moving-down", 1000, 1100, 40), [0, 0, 0]);
});

test("teleport exit velocity follows Quake destination yaw", () => {
  assert.deepEqual(
    quakeMultiplayerTeleportExitVelocity(180),
    [QUAKE_MULTIPLAYER_TELEPORT_EXIT_SPEED, 0, 0],
  );
  assert.deepEqual(
    quakeMultiplayerTeleportExitVelocity(270),
    [0, QUAKE_MULTIPLAYER_TELEPORT_EXIT_SPEED, 0],
  );
  assert.deepEqual(
    quakeMultiplayerTeleportExitVelocity(90),
    [0, -QUAKE_MULTIPLAYER_TELEPORT_EXIT_SPEED, 0],
  );
});

test("telefrag volume matches the expanded Quake player hull", () => {
  const destination = [10, 20, 30];
  assert.equal(
    quakeMultiplayerPlayerIntersectsTelefragVolume(
      createTestPlayer({ origin: [10 + 0.65, 20, 30] }),
      destination,
    ),
    true,
  );
  assert.equal(
    quakeMultiplayerPlayerIntersectsTelefragVolume(
      createTestPlayer({ origin: [10 + 0.67, 20, 30] }),
      destination,
    ),
    false,
  );
  assert.equal(
    quakeMultiplayerPlayerIntersectsTelefragVolume(
      createTestPlayer({ origin: destination, alive: false }),
      destination,
    ),
    false,
  );
  assert.equal(QUAKE_MULTIPLAYER_TELEFRAG_DAMAGE, 50000);
});

test("trigger facing checks match Quake multi_touch yaw gating", () => {
  const definition = testFacingTriggerWorldDefinitions[0];
  assert.equal(quakeMultiplayerPlayerFacesTrigger(createTestPlayer({ rotY: 180 }), definition), true);
  assert.equal(quakeMultiplayerPlayerFacesTrigger(createTestPlayer({ rotY: 0 }), definition), false);
  assert.equal(quakeMultiplayerPlayerFacesTrigger(createTestPlayer({ rotY: 90 }), definition), true);
});

test("room snapshot cadence requires an active room and elapsed interval", () => {
  const state = { lastSnapshotAt: 1000 };
  assert.equal(shouldEmitQuakeMultiplayerRoomSnapshot(1100, state, {
    connected: true,
    playerCount: 1,
  }), QUAKE_MULTIPLAYER_ROOM_SNAPSHOT_INTERVAL_MS <= 100);
  assert.equal(shouldEmitQuakeMultiplayerRoomSnapshot(1050, state, {
    connected: true,
    playerCount: 1,
    intervalMs: 100,
  }), false);
  assert.equal(shouldEmitQuakeMultiplayerRoomSnapshot(1100, state, {
    connected: true,
    playerCount: 1,
    intervalMs: 100,
  }), true);
  assert.equal(shouldEmitQuakeMultiplayerRoomSnapshot(1200, state, {
    connected: false,
    playerCount: 1,
    intervalMs: 100,
  }), false);
  assert.equal(shouldEmitQuakeMultiplayerRoomSnapshot(1200, state, {
    connected: true,
    playerCount: 0,
    intervalMs: 100,
  }), false);
});

test("room heartbeat helpers compute ping and stale client windows", () => {
  assert.equal(quakeMultiplayerPingMsFromPong(1250, 1000), 250);
  assert.equal(quakeMultiplayerPingMsFromPong(900, 1000), 0);
  assert.equal(shouldSendQuakeMultiplayerRoomPing(1000, undefined, 500), true);
  assert.equal(shouldSendQuakeMultiplayerRoomPing(1200, 1000, 500), false);
  assert.equal(shouldSendQuakeMultiplayerRoomPing(1500, 1000, 500), true);
  assert.equal(isQuakeMultiplayerClientStale(3000, 1000, 2000), false);
  assert.equal(isQuakeMultiplayerClientStale(3001, 1000, 2000), true);
});

test("validation rejects stale, wrong-map, wrong-protocol, and malformed messages", () => {
  const envelope = createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.presence",
    messageId: "presence-1",
    sequence: 3,
    sentAt: 1000,
    roomKey,
    payload: {
      clientId: "client-a",
      status: "active",
    },
  });

  assert.equal(validateQuakeMultiplayerClientEnvelope(
    { ...envelope, sequence: 2 },
    { roomKey, now: 1000, minimumSequence: 3 },
  ).code, "stale");
  assert.equal(validateQuakeMultiplayerClientEnvelope(
    { ...envelope, roomKey: { ...roomKey, mapName: "e1m2" } },
    { roomKey, now: 1000 },
  ).code, "wrong-map");
  assert.equal(validateQuakeMultiplayerClientEnvelope(
    { ...envelope, protocolVersion: QUAKE_MULTIPLAYER_PROTOCOL_VERSION + 1 },
    { roomKey, now: 1000 },
  ).code, "wrong-protocol");
  assert.equal(validateQuakeMultiplayerClientEnvelope(
    { ...envelope, payload: { clientId: "client-a", status: "sleeping" } },
    { roomKey, now: 1000 },
  ).code, "malformed");
  assert.equal(validateQuakeMultiplayerClientEnvelope(
    createQuakeMultiplayerEnvelope({
      direction: "client",
      type: "client.hello",
      messageId: "bad-gameplay-facts",
      sequence: 4,
      sentAt: 1000,
      roomKey,
      payload: {
        clientId: "client-a",
        displayName: "Player",
        gameplayFacts: {
          ...testGameplayFacts,
          factsHash: "not-a-hash",
        },
      },
    }),
    { roomKey, now: 1000 },
  ).code, "malformed");
});

test("validation accepts wrong-map room rejects with the established room key", () => {
  const reject = createQuakeMultiplayerEnvelope({
    direction: "room",
    type: "room.reject",
    messageId: "reject-wrong-map",
    sequence: 1,
    sentAt: 1000,
    roomKey,
    payload: {
      code: "wrong-map",
      message: "Room map does not match this client.",
      recoverable: false,
      rejectedMessageId: "hello-wrong-map",
      details: { expectedMapName: "e1m1", receivedMapName: "e1m2" },
    },
  });
  const validation = validateQuakeMultiplayerRoomEnvelope(reject, {
    roomKey: alternateRoomKey,
    now: 1000,
  });
  assert.equal(validation.ok, true);

  const snapshot = createQuakeMultiplayerEnvelope({
    direction: "room",
    type: "room.snapshot",
    messageId: "snapshot-wrong-map",
    sequence: 2,
    sentAt: 1000,
    roomKey,
    payload: {
      roomId: "room-a",
      tick: 1,
      roomTime: 1000,
      match: { status: "active", clockMs: 1000, fragLimit: 20, maxPlayers: 8 },
      players: [],
      pickups: [],
      lastWorldEventSequence: 0,
    },
  });
  assert.equal(validateQuakeMultiplayerRoomEnvelope(snapshot, {
    roomKey: alternateRoomKey,
    now: 1000,
  }).code, "wrong-map");
});

test("validation accepts explicit client world intents and rejects malformed ones", () => {
  const useIntent = createWorldIntentEnvelope({
    messageId: "world-use",
    sequence: 10,
    sentAt: 2000,
    intent: {
      intentType: "use",
      worldSequence: 1,
      requestedAt: 2000,
      origin: [1, 2, 3],
      direction: [0, 1, 0],
      range: 4,
      targetEntityIndex: 12,
    },
  });
  assert.equal(validateQuakeMultiplayerClientEnvelope(useIntent, { roomKey, now: 2000 }).ok, true);

  const touchIntent = createWorldIntentEnvelope({
    messageId: "world-touch",
    sequence: 11,
    sentAt: 2000,
    intent: {
      intentType: "touch",
      worldSequence: 2,
      requestedAt: 2000,
      entityIndex: 13,
      origin: [1, 2, 3],
    },
  });
  assert.equal(validateQuakeMultiplayerClientEnvelope(touchIntent, { roomKey, now: 2000 }).ok, true);

  const teleportIntent = createWorldIntentEnvelope({
    messageId: "world-teleport",
    sequence: 12,
    sentAt: 2000,
    intent: {
      intentType: "teleport",
      worldSequence: 3,
      requestedAt: 2000,
      entityIndex: 14,
      origin: [1, 2, 3],
      velocity: [0, 0, 0],
      destinationEntityIndex: 15,
    },
  });
  assert.equal(validateQuakeMultiplayerClientEnvelope(teleportIntent, { roomKey, now: 2000 }).ok, true);

  const levelTransitionIntent = createWorldIntentEnvelope({
    messageId: "world-level",
    sequence: 13,
    sentAt: 2000,
    intent: {
      intentType: "level-transition",
      worldSequence: 4,
      requestedAt: 2000,
      entityIndex: 16,
      origin: [1, 2, 3],
      targetMap: "e1m2",
    },
  });
  assert.equal(validateQuakeMultiplayerClientEnvelope(levelTransitionIntent, { roomKey, now: 2000 }).ok, true);

  const malformedIntent = createWorldIntentEnvelope({
    messageId: "world-malformed",
    sequence: 14,
    sentAt: 2000,
    intent: {
      intentType: "use",
      worldSequence: 5,
      requestedAt: 2000,
      origin: [1, 2, 3],
      direction: [0, 1, 0],
      range: -1,
      targetEntityIndex: 12,
    },
  });
  assert.equal(validateQuakeMultiplayerClientEnvelope(malformedIntent, { roomKey, now: 2000 }).code, "malformed");

  const ambiguousPayload = {
    ...useIntent,
    payload: {
      ...useIntent.payload,
      event: createWorldEnvelope({
        messageId: "world-legacy",
        sequence: 15,
        sentAt: 2000,
        change: "entity.activate",
        entityIndex: 12,
      }).payload.event,
    },
  };
  assert.equal(validateQuakeMultiplayerClientEnvelope(ambiguousPayload, { roomKey, now: 2000 }).code, "malformed");
});

test("validation accepts manual match restart intents and rejects malformed ones", () => {
  const restart = createMatchEnvelope({
    messageId: "match-restart",
    sequence: 20,
    sentAt: 2100,
    matchSequence: 1,
  });
  assert.equal(validateQuakeMultiplayerClientEnvelope(restart, { roomKey, now: 2100 }).ok, true);

  const malformedAction = createMatchEnvelope({
    messageId: "match-bad-action",
    sequence: 21,
    sentAt: 2100,
    matchSequence: 2,
    action: "map-rotate",
  });
  assert.equal(validateQuakeMultiplayerClientEnvelope(malformedAction, { roomKey, now: 2100 }).code, "malformed");

  const malformedSequence = createMatchEnvelope({
    messageId: "match-bad-sequence",
    sequence: 22,
    sentAt: 2100,
    matchSequence: -1,
  });
  assert.equal(validateQuakeMultiplayerClientEnvelope(malformedSequence, { roomKey, now: 2100 }).code, "malformed");
});

test("any-envelope validation rejects missing direction before payload checks", () => {
  const result = validateQuakeMultiplayerAnyEnvelope({
    type: "client.ping",
    payload: { pingId: "p1", sentAt: 1000 },
  }, { roomKey, now: 1000 });
  assert.deepEqual(result, {
    ok: false,
    code: "malformed",
    reason: "Multiplayer envelope direction is missing or invalid.",
  });
});

test("client authority requires hello and rejects wrong-client or replayed intents", () => {
  const presenceBeforeHello = createPresenceEnvelope({
    clientId: "client-a",
    sequence: 1,
    sentAt: 1000,
  });
  const beforeHello = validateQuakeMultiplayerClientAuthority(presenceBeforeHello, null, { now: 1000 });
  assert.equal(beforeHello.ok, false);
  assert.equal(!beforeHello.ok && beforeHello.reject.code, "not-authorized");

  const hello = createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "hello-authority",
    sequence: 2,
    sentAt: 1100,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  });
  const helloResult = validateQuakeMultiplayerClientAuthority(hello, null, { now: 1100 });
  assert.equal(helloResult.ok, true);
  let state = helloResult.ok && helloResult.state;

  const validPresence = validateQuakeMultiplayerClientAuthority(createPresenceEnvelope({
    clientId: "client-a",
    sequence: 3,
    sentAt: 1200,
  }), state, { now: 1200 });
  assert.equal(validPresence.ok, true);
  state = validPresence.ok && validPresence.state;

  const wrongClient = validateQuakeMultiplayerClientAuthority(createPresenceEnvelope({
    clientId: "client-b",
    messageId: "presence-wrong-client",
    sequence: 4,
    sentAt: 1300,
  }), state, { now: 1300 });
  assert.equal(wrongClient.ok, false);
  assert.equal(!wrongClient.ok && wrongClient.reject.code, "not-authorized");

  const replayedEnvelope = validateQuakeMultiplayerClientAuthority(createPresenceEnvelope({
    clientId: "client-a",
    messageId: "presence-replay",
    sequence: 3,
    sentAt: 1400,
  }), state, { now: 1400 });
  assert.equal(replayedEnvelope.ok, false);
  assert.equal(!replayedEnvelope.ok && replayedEnvelope.reject.code, "stale");

  const input = createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.input",
    messageId: "input-1",
    sequence: 5,
    sentAt: 1500,
    roomKey,
    payload: {
      clientId: "client-a",
      input: {
        inputSequence: 1,
        sampledAt: 1500,
        dt: 16,
        move: { forward: 0, side: 0, up: 0 },
        buttons: { attack: false, jump: false, use: false },
        rotX: 90,
        rotY: 270,
      },
    },
  });
  const inputResult = validateQuakeMultiplayerClientAuthority(input, state, { now: 1500 });
  assert.equal(inputResult.ok, true);
  state = inputResult.ok && inputResult.state;

  const duplicateInputIntent = validateQuakeMultiplayerClientAuthority({
    ...input,
    messageId: "input-duplicate-intent",
    sequence: 6,
    sentAt: 1600,
  }, state, { now: 1600 });
  assert.equal(duplicateInputIntent.ok, false);
  assert.equal(!duplicateInputIntent.ok && duplicateInputIntent.reject.code, "stale");

  const matchIntent = createMatchEnvelope({
    messageId: "match-authority",
    sequence: 7,
    sentAt: 1700,
    matchSequence: 1,
  });
  const matchResult = validateQuakeMultiplayerClientAuthority(matchIntent, state, { now: 1700 });
  assert.equal(matchResult.ok, true);
  state = matchResult.ok && matchResult.state;

  const duplicateMatchIntent = validateQuakeMultiplayerClientAuthority({
    ...matchIntent,
    messageId: "match-duplicate-intent",
    sequence: 8,
    sentAt: 1800,
  }, state, { now: 1800 });
  assert.equal(duplicateMatchIntent.ok, false);
  assert.equal(!duplicateMatchIntent.ok && duplicateMatchIntent.reject.code, "stale");

  const worldIntent = createWorldIntentEnvelope({
    messageId: "world-authority",
    sequence: 9,
    sentAt: 1900,
    intent: {
      intentType: "use",
      worldSequence: 1,
      requestedAt: 1900,
      origin: [0, 0, 0],
      direction: [0, 1, 0],
      range: 3,
    },
  });
  const worldResult = validateQuakeMultiplayerClientAuthority(worldIntent, state, { now: 1900 });
  assert.equal(worldResult.ok, true);
  state = worldResult.ok && worldResult.state;

  const duplicateWorldIntent = validateQuakeMultiplayerClientAuthority({
    ...worldIntent,
    messageId: "world-duplicate-intent",
    sequence: 10,
    sentAt: 2000,
  }, state, { now: 2000 });
  assert.equal(duplicateWorldIntent.ok, false);
  assert.equal(!duplicateWorldIntent.ok && duplicateWorldIntent.reject.code, "stale");
});

test("client authority applies lightweight rate limits to high-frequency messages", () => {
  const hello = createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "hello-rate",
    sequence: 1,
    sentAt: 1000,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  });
  const helloResult = validateQuakeMultiplayerClientAuthority(hello, null, { now: 1000 });
  assert.equal(helloResult.ok, true);

  const pose = createPoseEnvelope({ sequence: 2, poseSequence: 1, sentAt: 1100 });
  const poseResult = validateQuakeMultiplayerClientAuthority(
    pose,
    helloResult.ok && helloResult.state,
    { now: 1100 },
  );
  assert.equal(poseResult.ok, true);

  const tooFast = validateQuakeMultiplayerClientAuthority(
    createPoseEnvelope({ messageId: "pose-too-fast", sequence: 3, poseSequence: 2, sentAt: 1110 }),
    poseResult.ok && poseResult.state,
    { now: 1110 },
  );
  assert.equal(tooFast.ok, false);
  assert.equal(!tooFast.ok && tooFast.reject.code, "stale");
  assert.equal(!tooFast.ok && tooFast.reject.retryAfterMs, 10);
});

test("room simulation advances queued input only on fixed ticks", () => {
  const player = createTestPlayer({
    origin: [0, 0, 7],
    velocity: [0, 0, 0],
    lastInputSequence: 0,
    updatedAt: 1000,
  });
  let state = createQuakeMultiplayerRoomPlayerSimulationState({
    playerId: player.playerId,
    now: 1000,
  });
  state = queueQuakeMultiplayerRoomInput(state, {
    inputSequence: 1,
    sampledAt: 1010,
    dt: 0.016,
    move: { forward: 200, side: 0, up: 0 },
    buttons: { attack: false, jump: false, use: false },
    rotX: 90,
    rotY: 270,
  }).state;

  const beforeTick = advanceQuakeMultiplayerRoomPlayerSimulation(player, state, {
    now: 1049,
    tickMs: 50,
  });
  assert.equal(beforeTick.advancedTicks, 0);
  assert.deepEqual(beforeTick.player.origin, player.origin);

  const afterTick = advanceQuakeMultiplayerRoomPlayerSimulation(player, state, {
    now: 1050,
    tickMs: 50,
  });
  assert.equal(afterTick.advancedTicks, 1);
  assert.deepEqual(afterTick.consumedInputSequences, [1]);
  assert.equal(afterTick.state.lastAcceptedInputSequence, 1);
  assert.notDeepEqual(afterTick.player.origin, player.origin);
  assert.equal(afterTick.player.origin[2], 7);
});

test("room simulation suppresses backward movement during the teleport backpedal lock", () => {
  const player = createTestPlayer({
    origin: [0, 0, 7],
    velocity: [0, 0, 0],
    lastInputSequence: 0,
    rotX: 90,
    rotY: 270,
    updatedAt: 1000,
  });
  const backInput = {
    inputSequence: 1,
    sampledAt: 1010,
    dt: 0.016,
    move: { forward: -200, side: 0, up: 0 },
    buttons: { attack: false, jump: false, use: false },
    rotX: 90,
    rotY: 270,
  };
  let lockedState = createQuakeMultiplayerRoomPlayerSimulationState({
    playerId: player.playerId,
    now: 1000,
    teleportBackpedalLockUntil: 1000 + QUAKE_MULTIPLAYER_TELEPORT_BACKPEDAL_LOCK_MS,
  });
  assert.equal(
    quakeMultiplayerInputAfterTeleportBackpedalLock(backInput, lockedState, 1050).move.forward,
    0,
  );
  lockedState = queueQuakeMultiplayerRoomInput(lockedState, backInput).state;
  const locked = advanceQuakeMultiplayerRoomPlayerSimulation(player, lockedState, {
    now: 1050,
    tickMs: 50,
  });
  assert.deepEqual(locked.consumedInputSequences, [1]);
  assert.deepEqual(locked.player.origin, player.origin);

  let expiredState = createQuakeMultiplayerRoomPlayerSimulationState({
    playerId: player.playerId,
    now: 1700,
    teleportBackpedalLockUntil: 1700,
  });
  const expiredInput = {
    ...backInput,
    inputSequence: 2,
    sampledAt: 1700,
  };
  assert.equal(
    quakeMultiplayerInputAfterTeleportBackpedalLock(expiredInput, expiredState, 1700).move.forward,
    -200,
  );
  expiredState = queueQuakeMultiplayerRoomInput(expiredState, expiredInput).state;
  const expired = advanceQuakeMultiplayerRoomPlayerSimulation(player, expiredState, {
    now: 1750,
    tickMs: 50,
  });
  assert.deepEqual(expired.consumedInputSequences, [2]);
  assert.notDeepEqual(expired.player.origin, player.origin);
});

test("room simulation can advance jump and gravity through a collision world", () => {
  const eyeHeight = 0.92;
  let resolveCalls = 0;
  const collisionWorld = {
    floorAt() {
      return 0;
    },
    resolve(origin) {
      resolveCalls++;
      if (origin[2] - eyeHeight <= 0) {
        return {
          origin: [origin[0], origin[1], eyeHeight],
          groundZ: 0,
          grounded: true,
        };
      }
      return {
        origin,
        groundZ: 0,
        grounded: false,
      };
    },
  };
  const player = createTestPlayer({
    origin: [0, 0, eyeHeight],
    velocity: [0, 0, 0],
  });
  let state = createQuakeMultiplayerRoomPlayerSimulationState({
    playerId: player.playerId,
    now: 1000,
    grounded: true,
    floorZ: 0,
  });
  state = queueQuakeMultiplayerRoomInput(state, {
    inputSequence: 1,
    sampledAt: 1000,
    dt: 0.05,
    move: { forward: 0, side: 0, up: 0 },
    buttons: { attack: false, jump: true, use: false },
    rotX: 90,
    rotY: 270,
  }).state;

  const jumped = advanceQuakeMultiplayerRoomPlayerSimulation(player, state, {
    now: 1050,
    tickMs: 50,
    collisionWorld,
    playerEyeHeight: eyeHeight,
  });

  assert.equal(jumped.advancedTicks, 1);
  assert.deepEqual(jumped.consumedInputSequences, [1]);
  assert.equal(jumped.state.grounded, false);
  assert.equal(jumped.state.floorZ, 0);
  assert.ok(jumped.player.origin[2] > eyeHeight);
  assert.ok(jumped.player.velocity[2] > 0);
  assert.equal(resolveCalls, 1);
});

test("deathmatch line of sight rejects hits occluded by scene collision", () => {
  const fire = {
    fireSequence: 1,
    firedAt: 1000,
    weapon: "shotgun",
    fireKind: "hitscan",
    origin: [0, 0, 1],
    direction: [1, 0, 0],
    range: 64,
  };
  const hit = {
    target: createTestPlayer({ playerId: "target", origin: [4, 0, 1] }),
    damage: 24,
    distance: 4,
    impact: [4, 0, 1],
    lateralMiss: 0,
  };

  assert.equal(quakeMultiplayerDeathmatchHitHasLineOfSight(fire, hit, null), true);
  assert.equal(quakeMultiplayerDeathmatchHitHasLineOfSight(fire, hit, {
    traceUse() {
      return null;
    },
  }), true);
  assert.equal(quakeMultiplayerDeathmatchHitHasLineOfSight(fire, hit, {
    traceUse(start, end) {
      assert.deepEqual(start, fire.origin);
      assert.deepEqual(end, hit.impact);
      return {
        fraction: 0.5,
        end: [2, 0, 1],
        planeNormal: [1, 0, 0],
      };
    },
  }), false);
});

test("deathmatch lightning discharges underwater with Quake radius damage", () => {
  const lightningInventory = {
    ...createTestPlayer().inventory,
    activeWeapon: "lightning",
    weapons: ["axe", "shotgun", "lightning"],
    cells: 4,
  };
  const attacker = createTestPlayer({
    playerId: "attacker",
    origin: [0, 0, 32],
    activeWeapon: "lightning",
    inventory: lightningInventory,
  });
  const victim = createTestPlayer({
    playerId: "victim",
    origin: [0, 0, 32.85],
  });
  const discharge = quakeMultiplayerDeathmatchLightningDischarge({
    attacker,
    players: [attacker, victim],
    collisionWorld: {
      contentsAt: () => -3,
    },
    playerEyeHeight: 22,
  });

  assert.equal(discharge?.cells, 4);
  assert.equal(discharge?.damage, 140);
  assert.equal(discharge?.waterLevel, 3);
  const selfHit = discharge?.hits.find((hit) => hit.target.playerId === "attacker");
  const victimHit = discharge?.hits.find((hit) => hit.target.playerId === "victim");
  const selfCenterDistance = 0.85 / QUAKE_COLLISION_UNIT_SCALE;
  assert.equal(victimHit?.damage, 140);
  assert.ok(Math.abs((selfHit?.damage ?? 0) - (140 - 0.5 * selfCenterDistance) * 0.5) < 1e-9);
  assert.equal(selfHit?.selfDamage, true);
  assert.equal(victimHit?.selfDamage, false);

  assert.equal(quakeMultiplayerDeathmatchLightningDischarge({
    attacker,
    players: [attacker, victim],
    collisionWorld: {
      contentsAt: () => 0,
    },
    playerEyeHeight: 22,
  }), null);
});

test("multiplayer damage applies QuakeC armor absorption before health", () => {
  const protectedInventory = {
    ...createTestPlayer().inventory,
    health: 100,
    armor: 50,
    armorType: 0.6,
    itemFlags: 4097 | 16384,
  };
  const protectedAfterDamage = quakeMultiplayerApplyDamageToInventory(protectedInventory, 24);
  assert.equal(protectedAfterDamage.armor, 35);
  assert.equal(protectedAfterDamage.armorType, 0.6);
  assert.equal(protectedAfterDamage.health, 91);
  assert.equal(protectedInventory.armor, 50);
  assert.equal(protectedInventory.health, 100);

  const brokenInventory = {
    ...createTestPlayer().inventory,
    health: 100,
    armor: 5,
    armorType: 0.8,
    itemFlags: 4097 | 8192 | 16384 | 32768,
  };
  const brokenAfterDamage = quakeMultiplayerApplyDamageToInventory(brokenInventory, 20);
  assert.equal(brokenAfterDamage.armor, 0);
  assert.equal(brokenAfterDamage.armorType, 0);
  assert.equal(brokenAfterDamage.health, 85);
  assert.equal(brokenAfterDamage.itemFlags & (8192 | 16384 | 32768), 0);

  const invulnerableAfterDamage = quakeMultiplayerApplyDamageToInventory(protectedInventory, 24, {
    applyHealth: false,
  });
  assert.equal(invulnerableAfterDamage.armor, 35);
  assert.equal(invulnerableAfterDamage.armorType, 0.6);
  assert.equal(invulnerableAfterDamage.health, 100);
});

test("deathmatch damage momentum follows QuakeC T_Damage impulse", () => {
  const player = createTestPlayer({
    origin: [0, 4, 0],
    velocity: [1, 2, 3],
  });
  const moved = quakeMultiplayerDeathmatchPlayerWithDamageMomentum({
    player,
    damage: 24,
    inflictorOrigin: [0, 0, 0],
  });
  assert.deepEqual(moved.velocity, [
    1,
    2 + 24 * 8 * QUAKE_COLLISION_UNIT_SCALE,
    3,
  ]);
  assert.deepEqual(quakeMultiplayerDeathmatchPlayerWithDamageMomentum({
    player,
    damage: 24,
    inflictorOrigin: null,
  }).velocity, player.velocity);
});

test("PartyKit room keeps authoritative player state across reconnect grace", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const firstConnection = createFakePartyConnection("conn-1");
  fakeRoom.addConnection(firstConnection);
  server.onConnect(firstConnection);

  const baseTime = Date.now();
  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-hello-1",
    sequence: 1,
    sentAt: baseTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      color: "#d8893f",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), firstConnection);
  const initialPlayer = localPlayerFromSnapshot(fakeRoom.broadcasts.at(-1));

  server.onMessage(JSON.stringify(createInputEnvelope({
    messageId: "party-input-1",
    sequence: 2,
    inputSequence: 1,
    sentAt: baseTime + 50,
    move: { forward: 200, side: 0, up: 0 },
  })), firstConnection);
  server.advanceRoomSimulation(baseTime + 100);

  server.onClose(firstConnection);
  fakeRoom.removeConnection(firstConnection);
  const disconnectEvent = partyRoomEvents(fakeRoom, "player.presence").at(-1);
  assert.equal(disconnectEvent?.status, "disconnecting");
  assert.equal(partyRoomEvents(fakeRoom, "player.left").length, 0);

  const secondConnection = createFakePartyConnection("conn-2");
  fakeRoom.addConnection(secondConnection);
  server.onConnect(secondConnection);
  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-hello-reconnect",
    sequence: 1,
    sentAt: baseTime + 200,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      color: "#d8893f",
      gameplayFacts: testGameplayFacts,
    },
  })), secondConnection);

  const reconnectEvent = partyRoomEvents(fakeRoom, "player.presence").at(-1);
  assert.equal(reconnectEvent?.status, "active");
  const reconnectedPlayer = localPlayerFromSnapshot(fakeRoom.broadcasts.at(-1));
  assert.equal(reconnectedPlayer.playerId, initialPlayer.playerId);
  assert.equal(reconnectedPlayer.lastInputSequence, 1);
  assert.notDeepEqual(reconnectedPlayer.origin, initialPlayer.origin);
  assert.equal(firstConnection.state, null);
  assert.equal(secondConnection.state.playerId, "party:client-a");
  assert.equal(partyRoomEvents(fakeRoom, "player.left").length, 0);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room pauses player input and mutation when presence is not active", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const connection = createFakePartyConnection("conn-presence-pause");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-presence-pause-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);
  const initialPlayer = localPlayerFromSnapshot(fakeRoom.broadcasts.at(-1));

  server.onMessage(JSON.stringify(createInputEnvelope({
    messageId: "party-presence-pause-input-1",
    sequence: 2,
    inputSequence: 1,
    sentAt: timestamp + 100,
    move: { forward: 200, side: 0, up: 0 },
  })), connection);
  server.advanceRoomSimulation(timestamp + 150);
  server.broadcastSnapshot();
  const movedPlayer = localPlayerFromSnapshot(fakeRoom.broadcasts.at(-1));
  assert.notDeepEqual(movedPlayer.origin, initialPlayer.origin);
  assert.equal(movedPlayer.lastInputSequence, 1);

  server.onMessage(JSON.stringify(createPresenceEnvelope({
    messageId: "party-presence-pause",
    sequence: 3,
    sentAt: timestamp + 250,
    status: "input-paused",
  })), connection);
  const presenceEvent = partyRoomEvents(fakeRoom, "player.presence").at(-1);
  assert.equal(presenceEvent?.status, "input-paused");
  const pausedPlayer = localPlayerFromSnapshot(fakeRoom.broadcasts.findLast((message) => message.type === "room.snapshot"));

  server.onMessage(JSON.stringify(createInputEnvelope({
    messageId: "party-presence-pause-input-2",
    sequence: 4,
    inputSequence: 2,
    sentAt: timestamp + 350,
    move: { forward: 200, side: 0, up: 0 },
  })), connection);
  server.advanceRoomSimulation(timestamp + 500);
  server.broadcastSnapshot();
  const afterPausedInput = localPlayerFromSnapshot(fakeRoom.broadcasts.at(-1));
  assert.deepEqual(afterPausedInput.origin, pausedPlayer.origin);
  assert.equal(afterPausedInput.lastInputSequence, 1);

  server.onMessage(JSON.stringify(createFireEnvelope({
    messageId: "party-presence-pause-fire",
    sequence: 5,
    fireSequence: 1,
    sentAt: timestamp + 600,
  })), connection);
  assert.equal(connection.sent.at(-1)?.type, "room.reject");
  assert.equal(connection.sent.at(-1)?.payload.code, "unsupported");
  assert.equal(connection.sent.at(-1)?.payload.message, "Multiplayer player input is paused.");
  assert.equal(connection.sent.at(-1)?.payload.rejectedMessageId, "party-presence-pause-fire");

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room resets compatibility state after the final player leaves", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const firstConnection = createFakePartyConnection("conn-reset-1");
  fakeRoom.addConnection(firstConnection);
  server.onConnect(firstConnection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-reset-hello-1",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), firstConnection);
  assert.equal(fakeRoom.broadcasts.at(-1)?.type, "room.snapshot");

  server.onClose(firstConnection);
  fakeRoom.removeConnection(firstConnection);
  server.finalizeDisconnectedPlayer("party:client-a", "test-finalize");

  const secondConnection = createFakePartyConnection("conn-reset-2");
  fakeRoom.addConnection(secondConnection);
  server.onConnect(secondConnection);
  const emptyGameplayFacts = createQuakeMultiplayerGameplayFacts({});
  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-reset-hello-2",
    sequence: 1,
    sentAt: timestamp + 100,
    roomKey: alternateRoomKey,
    payload: {
      clientId: "client-b",
      displayName: "Player 2",
      gameplayFacts: emptyGameplayFacts,
    },
  })), secondConnection);

  const snapshot = fakeRoom.broadcasts.at(-1);
  assert.equal(snapshot?.type, "room.snapshot");
  assert.equal(snapshot?.roomKey.mapName, "e1m2");
  assert.equal(snapshot?.payload.players[0]?.clientId, "client-b");
  assert.equal(secondConnection.sent.some((message) => message.type === "room.reject"), false);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room rejects generic client-originated world changes", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const connection = createFakePartyConnection("conn-world");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-world-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);
  server.onMessage(JSON.stringify(createWorldEnvelope({
    messageId: "party-world-change",
    sequence: 2,
    sentAt: timestamp + 10,
    change: "entity.activate",
    entityIndex: 12,
  })), connection);

  assert.equal(connection.sent.at(-1)?.type, "room.reject");
  assert.equal(connection.sent.at(-1)?.payload.code, "unsupported");
  assert.equal(connection.sent.at(-1)?.payload.rejectedMessageId, "party-world-change");
  assert.equal(partyRoomEvents(fakeRoom, "world.changed").length, 0);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room rejects explicit client world intents until room-side validation exists", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const connection = createFakePartyConnection("conn-world-intent");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-world-intent-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);
  server.onMessage(JSON.stringify(createWorldIntentEnvelope({
    messageId: "party-world-use",
    sequence: 2,
    sentAt: timestamp + 10,
    intent: {
      intentType: "use",
      worldSequence: 1,
      requestedAt: timestamp + 10,
      origin: [1, 2, 3],
      direction: [0, 1, 0],
      range: 4,
      targetEntityIndex: 12,
    },
  })), connection);

  const reject = connection.sent.at(-1);
  assert.equal(reject?.type, "room.reject");
  assert.equal(reject?.payload.code, "unsupported");
  assert.equal(reject?.payload.rejectedMessageId, "party-world-use");
  assert.equal(reject?.payload.details.reason, "unsupported");
  assert.equal(partyRoomEvents(fakeRoom, "world.use").length, 0);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room teleports players from trusted world touch definitions", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedWorldDefinitions: testWorldDefinitions,
  });
  const connection = createFakePartyConnection("conn-world-teleport");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-world-teleport-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);
  server.onMessage(JSON.stringify(createWorldIntentEnvelope({
    messageId: "party-world-teleport",
    sequence: 2,
    sentAt: timestamp + 10,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: timestamp + 10,
      entityIndex: 77,
      origin: [0, 0, 0],
    },
  })), connection);

  const event = partyRoomEvents(fakeRoom, "world.teleport").at(-1);
  const snapshot = fakeRoom.broadcasts.findLast((message) => message.type === "room.snapshot");
  const player = snapshot?.payload.players.find((candidate) => candidate.playerId === "party:client-a");
  const simulationState = server.playerSimulationStates.get("party:client-a");
  assert.equal(event?.playerId, "party:client-a");
  assert.equal(event?.entityIndex, 77);
  assert.deepEqual(event?.origin, [10, 20, 30]);
  assert.deepEqual(event?.velocity, [QUAKE_MULTIPLAYER_TELEPORT_EXIT_SPEED, 0, 0]);
  assert.deepEqual(player?.origin, [10, 20, 30]);
  assert.deepEqual(player?.velocity, [QUAKE_MULTIPLAYER_TELEPORT_EXIT_SPEED, 0, 0]);
  assert.equal(player?.rotY, 180);
  assert.equal(typeof simulationState?.teleportBackpedalLockUntil, "number");

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room arms targetnamed teleporters from target dispatch", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedWorldDefinitions: testTargetnamedTeleportWorldDefinitions,
  });
  const connection = createFakePartyConnection("conn-target-teleport");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-target-teleport-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);
  server.onMessage(JSON.stringify(createWorldIntentEnvelope({
    messageId: "party-target-teleport-unarmed",
    sequence: 2,
    sentAt: timestamp + 10,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: timestamp + 10,
      entityIndex: 177,
      origin: [0, 0, 0],
    },
  })), connection);
  server.onMessage(JSON.stringify(createWorldIntentEnvelope({
    messageId: "party-target-teleport-arm",
    sequence: 3,
    sentAt: timestamp + 20,
    intent: {
      intentType: "touch",
      worldSequence: 2,
      requestedAt: timestamp + 20,
      entityIndex: 179,
      origin: [0, 0, 0],
    },
  })), connection);
  server.onMessage(JSON.stringify(createWorldIntentEnvelope({
    messageId: "party-target-teleport-armed",
    sequence: 4,
    sentAt: timestamp + 30,
    intent: {
      intentType: "touch",
      worldSequence: 3,
      requestedAt: timestamp + 30,
      entityIndex: 177,
      origin: [0, 0, 0],
    },
  })), connection);

  const reject = connection.sent.find((message) =>
    message.type === "room.reject" &&
    message.payload.rejectedMessageId === "party-target-teleport-unarmed"
  );
  const useEvent = partyRoomEvents(fakeRoom, "world.use").find((event) => event.entityIndex === 177);
  const teleportEvent = partyRoomEvents(fakeRoom, "world.teleport").at(-1);
  assert.equal(reject?.payload.details.reason, "teleport-inactive");
  assert.equal(useEvent?.playerId, "party:client-a");
  assert.equal(teleportEvent?.entityIndex, 177);
  assert.deepEqual(teleportEvent?.origin, [30, 40, 50]);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room telefrags destination occupants during trusted teleports", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedWorldDefinitions: testWorldDefinitions,
  });
  const attackerConnection = createFakePartyConnection("conn-world-telefrag-a");
  const victimConnection = createFakePartyConnection("conn-world-telefrag-b");
  fakeRoom.addConnection(attackerConnection);
  fakeRoom.addConnection(victimConnection);
  server.onConnect(attackerConnection);
  server.onConnect(victimConnection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-world-telefrag-hello-a",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player A",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), attackerConnection);
  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-world-telefrag-hello-b",
    sequence: 1,
    sentAt: timestamp + 10,
    roomKey,
    payload: {
      clientId: "client-b",
      displayName: "Player B",
      gameplayFacts: testGameplayFacts,
    },
  })), victimConnection);
  server.players.set("party:client-b", {
    ...server.players.get("party:client-b"),
    origin: [10, 20, 30],
  });

  server.onMessage(JSON.stringify(createWorldIntentEnvelope({
    messageId: "party-world-telefrag",
    sequence: 2,
    sentAt: timestamp + 100,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: timestamp + 100,
      entityIndex: 77,
      origin: [0, 0, 0],
    },
  })), attackerConnection);

  const killed = partyRoomEvents(fakeRoom, "player.killed").at(-1);
  const snapshot = fakeRoom.broadcasts.findLast((message) => message.type === "room.snapshot");
  const attacker = snapshot.payload.players.find((player) => player.playerId === "party:client-a");
  const victim = snapshot.payload.players.find((player) => player.playerId === "party:client-b");
  assert.equal(killed?.victimPlayerId, "party:client-b");
  assert.equal(killed?.attackerPlayerId, "party:client-a");
  assert.equal(killed?.damageSource, "teledeath");
  assert.equal(attacker.frags, 1);
  assert.deepEqual(attacker.origin, [10, 20, 30]);
  assert.equal(victim.alive, false);
  assert.equal(victim.health, 0);
  assert.equal(victim.deaths, 1);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room deflects telefrag from invulnerable destination occupants", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedWorldDefinitions: testWorldDefinitions,
  });
  const attackerConnection = createFakePartyConnection("conn-world-telefrag-deflect-a");
  const victimConnection = createFakePartyConnection("conn-world-telefrag-deflect-b");
  fakeRoom.addConnection(attackerConnection);
  fakeRoom.addConnection(victimConnection);
  server.onConnect(attackerConnection);
  server.onConnect(victimConnection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-world-telefrag-deflect-hello-a",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player A",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), attackerConnection);
  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-world-telefrag-deflect-hello-b",
    sequence: 1,
    sentAt: timestamp + 10,
    roomKey,
    payload: {
      clientId: "client-b",
      displayName: "Player B",
      gameplayFacts: testGameplayFacts,
    },
  })), victimConnection);
  const invulnerableInventory = {
    ...createTestPlayer().inventory,
    powerups: [{
      active: true,
      activationField: "invincible_finished",
      finishedAt: timestamp + 30000,
      finishedField: "invincible_finished",
      itemFlag: 8192,
      itemFlagExpression: "IT_INVULNERABILITY",
    }],
  };
  server.players.set("party:client-b", {
    ...server.players.get("party:client-b"),
    origin: [10, 20, 30],
    inventory: invulnerableInventory,
  });

  server.onMessage(JSON.stringify(createWorldIntentEnvelope({
    messageId: "party-world-telefrag-deflect",
    sequence: 2,
    sentAt: timestamp + 100,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: timestamp + 100,
      entityIndex: 77,
      origin: [0, 0, 0],
    },
  })), attackerConnection);

  const killed = partyRoomEvents(fakeRoom, "player.killed").at(-1);
  const snapshot = fakeRoom.broadcasts.findLast((message) => message.type === "room.snapshot");
  const attacker = snapshot.payload.players.find((player) => player.playerId === "party:client-a");
  const victim = snapshot.payload.players.find((player) => player.playerId === "party:client-b");
  assert.equal(killed?.victimPlayerId, "party:client-a");
  assert.equal(killed?.attackerPlayerId, "party:client-a");
  assert.equal(killed?.damageSource, "teledeath2");
  assert.equal(attacker.alive, false);
  assert.equal(attacker.frags, -1);
  assert.equal(attacker.deaths, 1);
  assert.deepEqual(attacker.origin, [10, 20, 30]);
  assert.equal(victim.alive, true);
  assert.equal(victim.health, 100);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room applies trusted trigger_hurt touch damage", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedWorldDefinitions: testWorldDefinitions,
  });
  const connection = createFakePartyConnection("conn-world-hurt");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const originalDateNow = Date.now;
  const timestamp = originalDateNow();
  let currentTime = timestamp;

  Date.now = () => currentTime;
  try {
    server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
      direction: "client",
      type: "client.hello",
      messageId: "party-world-hurt-hello",
      sequence: 1,
      sentAt: currentTime,
      roomKey,
      payload: {
        clientId: "client-a",
        displayName: "Player",
        gameplayFacts: testGameplayFacts,
        deathmatchSpawns: testDeathmatchSpawns,
        pickupDefinitions: testPickupDefinitions,
      },
    })), connection);
    currentTime = timestamp + 10;
    server.onMessage(JSON.stringify(createWorldIntentEnvelope({
      messageId: "party-world-hurt",
      sequence: 2,
      sentAt: currentTime,
      intent: {
        intentType: "touch",
        worldSequence: 1,
        requestedAt: currentTime,
        entityIndex: 80,
        origin: [0, 0, 0],
      },
    })), connection);
    currentTime = timestamp + 20;
    server.onMessage(JSON.stringify(createWorldIntentEnvelope({
      messageId: "party-world-hurt-repeat",
      sequence: 3,
      sentAt: currentTime,
      intent: {
        intentType: "touch",
        worldSequence: 2,
        requestedAt: currentTime,
        entityIndex: 80,
        origin: [0, 0, 0],
      },
    })), connection);
    currentTime = timestamp + 10 + QUAKE_MULTIPLAYER_TRIGGER_HURT_COOLDOWN_MS - 1;
    server.onMessage(JSON.stringify(createWorldIntentEnvelope({
      messageId: "party-world-hurt-before-reactivate",
      sequence: 4,
      sentAt: currentTime,
      intent: {
        intentType: "touch",
        worldSequence: 3,
        requestedAt: currentTime,
        entityIndex: 80,
        origin: [0, 0, 0],
      },
    })), connection);
    currentTime = timestamp + 10 + QUAKE_MULTIPLAYER_TRIGGER_HURT_COOLDOWN_MS;
    server.onMessage(JSON.stringify(createWorldIntentEnvelope({
      messageId: "party-world-hurt-after-reactivate",
      sequence: 5,
      sentAt: currentTime,
      intent: {
        intentType: "touch",
        worldSequence: 4,
        requestedAt: currentTime,
        entityIndex: 80,
        origin: [0, 0, 0],
      },
    })), connection);
  } finally {
    Date.now = originalDateNow;
  }

  const event = partyRoomEvents(fakeRoom, "player.damaged").at(-1);
  const damageEvents = partyRoomEvents(fakeRoom, "player.damaged")
    .filter((candidate) => candidate.damageSource === "trigger_hurt");
  const snapshot = fakeRoom.broadcasts.findLast((message) => message.type === "room.snapshot");
  const player = snapshot?.payload.players.find((candidate) => candidate.playerId === "party:client-a");
  assert.equal(event?.victimPlayerId, "party:client-a");
  assert.equal(event?.attackerPlayerId, undefined);
  assert.equal(event?.damage, 25);
  assert.equal(event?.damageSource, "trigger_hurt");
  assert.deepEqual(damageEvents.map((candidate) => candidate.eventId), [
    "damage-world-party-world-hurt",
    "damage-world-party-world-hurt-after-reactivate",
  ]);
  assert.equal(player?.health, 50);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room applies room-owned lava contents damage on simulation tick", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedSceneMovement: {
      collisionWorld: createFakeCollisionWorld([], {
        contentsAt: () => -5,
      }),
      playerEyeHeight: 22,
    },
  });
  const connection = createFakePartyConnection("conn-lava-hazard");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-lava-hazard-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);
  const lavaSimulationState = server.playerSimulationStates.get("party:client-a");
  assert.ok(lavaSimulationState);
  server.playerSimulationStates.set("party:client-a", {
    ...lavaSimulationState,
    lastSimulatedAt: timestamp,
  });

  server.advanceRoomSimulation(timestamp + QUAKE_MULTIPLAYER_ROOM_SIMULATION_TICK_MS);

  const event = partyRoomEvents(fakeRoom, "player.damaged")
    .find((candidate) => candidate.damageSource === "lava");
  const snapshot = fakeRoom.broadcasts.findLast((message) => message.type === "room.snapshot");
  const player = snapshot?.payload.players.find((candidate) => candidate.playerId === "party:client-a");
  assert.equal(event?.victimPlayerId, "party:client-a");
  assert.equal(event?.attackerPlayerId, undefined);
  assert.equal(event?.damage, 30);
  assert.equal(event?.health, 70);
  assert.equal(player?.health, 70);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room applies room-owned drowning damage on simulation tick", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedSceneMovement: {
      collisionWorld: createFakeCollisionWorld([], {
        contentsAt: () => -3,
      }),
      playerEyeHeight: 22,
    },
  });
  const connection = createFakePartyConnection("conn-drown-hazard");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-drown-hazard-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);
  const simulationState = server.playerSimulationStates.get("party:client-a");
  assert.ok(simulationState);
  server.playerSimulationStates.set("party:client-a", {
    ...simulationState,
    airFinishedAt: timestamp,
    lastSimulatedAt: timestamp,
  });

  server.advanceRoomSimulation(timestamp + QUAKE_MULTIPLAYER_ROOM_SIMULATION_TICK_MS);

  const event = partyRoomEvents(fakeRoom, "player.damaged")
    .find((candidate) => candidate.damageSource === "drown");
  const snapshot = fakeRoom.broadcasts.findLast((message) => message.type === "room.snapshot");
  const player = snapshot?.payload.players.find((candidate) => candidate.playerId === "party:client-a");
  assert.equal(event?.victimPlayerId, "party:client-a");
  assert.equal(event?.attackerPlayerId, undefined);
  assert.equal(event?.damage, 4);
  assert.equal(event?.health, 96);
  assert.equal(player?.health, 96);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room applies trusted trigger_push touch velocity", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedWorldDefinitions: testWorldDefinitions,
  });
  const connection = createFakePartyConnection("conn-world-push");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-world-push-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);
  server.onMessage(JSON.stringify(createWorldIntentEnvelope({
    messageId: "party-world-push",
    sequence: 2,
    sentAt: timestamp + 10,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: timestamp + 10,
      entityIndex: 81,
      origin: [0, 0, 0],
    },
  })), connection);

  const event = partyRoomEvents(fakeRoom, "world.push").at(-1);
  const snapshot = fakeRoom.broadcasts.findLast((message) => message.type === "room.snapshot");
  const player = snapshot?.payload.players.find((candidate) => candidate.playerId === "party:client-a");
  assert.equal(event?.playerId, "party:client-a");
  assert.equal(event?.entityIndex, 81);
  assert.deepEqual(event?.velocity, [0, 0, 200 * QUAKE_COLLISION_UNIT_SCALE]);
  assert.equal(event?.oneShot, true);
  assert.deepEqual(player?.velocity, [0, 0, 200 * QUAKE_COLLISION_UNIT_SCALE]);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room emits trusted func_button touch activation once while up", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedWorldDefinitions: testWorldDefinitions,
  });
  const connection = createFakePartyConnection("conn-world-button");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-world-button-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);
  server.onMessage(JSON.stringify(createWorldIntentEnvelope({
    messageId: "party-world-button",
    sequence: 2,
    sentAt: timestamp + 10,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: timestamp + 10,
      entityIndex: 210,
      origin: [0, 0, 0],
    },
  })), connection);
  server.onMessage(JSON.stringify(createWorldIntentEnvelope({
    messageId: "party-world-button-repeat",
    sequence: 3,
    sentAt: timestamp + 20,
    intent: {
      intentType: "touch",
      worldSequence: 2,
      requestedAt: timestamp + 20,
      entityIndex: 210,
      origin: [0, 0, 0],
    },
  })), connection);

  const moverEvents = partyRoomEvents(fakeRoom, "world.mover");
  const buttonEvent = moverEvents.at(-1);
  assert.equal(moverEvents.length, 1);
  assert.equal(buttonEvent?.playerId, "party:client-a");
  assert.equal(buttonEvent?.entityIndex, 210);
  assert.equal(buttonEvent?.classname, "func_button");
  assert.equal(buttonEvent?.activation, "touch");
  assert.equal(buttonEvent?.state, "moving-up");
  assert.deepEqual(buttonEvent?.fromOrigin, [0, 0, 0]);
  assert.deepEqual(buttonEvent?.toOrigin, [2, 0, 0]);
  assert.equal(buttonEvent?.speed, 40);
  assert.equal(buttonEvent?.moveMs, 0);
  assert.deepEqual(buttonEvent?.targetEntityIndexes, [211]);
  assert.equal(buttonEvent?.soundPath, "buttons/switch04.wav");
  const targetEvents = partyRoomEvents(fakeRoom, "world.targets")
    .filter((candidate) => candidate.sourceEntityIndex === 210);
  assert.equal(targetEvents.length, 1);
  assert.equal(targetEvents[0]?.sourceEventId, buttonEvent?.eventId);
  assert.deepEqual(targetEvents[0]?.targetEntityIndexes, [211]);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room advances trusted func_button collision during room simulation", () => {
  const collisionOffsets = [];
  const movingButtonDefinitions = testWorldDefinitions.map((definition) =>
    definition.kind === "mover" && definition.entityIndex === 214
      ? { ...definition, moveMs: 40, returnDelayMs: 40 }
      : definition
  );
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedWorldDefinitions: movingButtonDefinitions,
    trustedSceneMovement: {
      collisionWorld: createFakeCollisionWorld(collisionOffsets),
      playerEyeHeight: 0.92,
    },
  });
  const connection = createFakePartyConnection("conn-world-button-motion");
  const originalDateNow = Date.now;
  const timestamp = originalDateNow();
  fakeRoom.addConnection(connection);
  server.onConnect(connection);

  Date.now = () => timestamp;
  try {
    server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
      direction: "client",
      type: "client.hello",
      messageId: "party-world-button-motion-hello",
      sequence: 1,
      sentAt: timestamp,
      roomKey,
      payload: {
        clientId: "client-a",
        displayName: "Player",
        gameplayFacts: testGameplayFacts,
        deathmatchSpawns: testDeathmatchSpawns,
        pickupDefinitions: testPickupDefinitions,
      },
    })), connection);
    server.onMessage(JSON.stringify(createWorldIntentEnvelope({
      messageId: "party-world-button-motion",
      sequence: 2,
      sentAt: timestamp,
      intent: {
        intentType: "touch",
        worldSequence: 1,
        requestedAt: timestamp,
        entityIndex: 214,
        origin: [0, 0, 0],
      },
    })), connection);

    assert.deepEqual(collisionOffsets
      .filter((entry) => entry.entityIndex === 214)
      .map((entry) => entry.offset), [
        [0, 0, 0],
        [0, 0, 0],
      ]);

    server.advanceRoomSimulation(timestamp + 20);
    assert.deepEqual(collisionOffsets.at(-1), { entityIndex: 214, offset: [0, 0, 1] });

    server.advanceRoomSimulation(timestamp + 20);
    assert.deepEqual(collisionOffsets.at(-1), { entityIndex: 214, offset: [0, 0, 1] });

    server.advanceRoomSimulation(timestamp + 40);
    assert.deepEqual(collisionOffsets.at(-1), { entityIndex: 214, offset: [0, 0, 2] });
  } finally {
    Date.now = originalDateNow;
    server.resetIdleRoomState();
    server.stopSimulationTicker();
    server.stopSnapshotTicker();
    server.stopHeartbeatTicker();
  }
});

test("PartyKit room emits func_button mover state transitions on room timers", async () => {
  const collisionOffsets = [];
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedWorldDefinitions: testWorldDefinitions,
    trustedSceneMovement: {
      collisionWorld: createFakeCollisionWorld(collisionOffsets),
      playerEyeHeight: 0.92,
    },
  });
  const connection = createFakePartyConnection("conn-world-button-states");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-world-button-states-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);
  server.onMessage(JSON.stringify(createWorldIntentEnvelope({
    messageId: "party-world-button-states",
    sequence: 2,
    sentAt: timestamp + 10,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: timestamp + 10,
      entityIndex: 214,
      origin: [0, 0, 0],
    },
  })), connection);
  await waitMs(8);

  const moverEvents = partyRoomEvents(fakeRoom, "world.mover")
    .filter((candidate) => candidate.entityIndex === 214);
  assert.deepEqual(moverEvents.map((event) => event.state), ["moving-up", "top", "moving-down", "bottom"]);
  assert.deepEqual(moverEvents[0]?.fromOrigin, [0, 0, 0]);
  assert.deepEqual(moverEvents[0]?.toOrigin, [0, 0, 2]);
  assert.deepEqual(moverEvents[1]?.fromOrigin, [0, 0, 2]);
  assert.deepEqual(moverEvents[1]?.toOrigin, [0, 0, 2]);
  assert.deepEqual(moverEvents[2]?.fromOrigin, [0, 0, 2]);
  assert.deepEqual(moverEvents[2]?.toOrigin, [0, 0, 0]);
  assert.deepEqual(moverEvents[3]?.fromOrigin, [0, 0, 0]);
  assert.deepEqual(moverEvents[3]?.toOrigin, [0, 0, 0]);
  assert.ok(moverEvents.every((event) => event.activation === "touch"));
  assert.ok(moverEvents.every((event) => event.targetEntityIndexes.length === 1));
  assert.deepEqual(collisionOffsets
    .filter((entry) => entry.entityIndex === 214)
    .map((entry) => entry.offset), [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 2],
      [0, 0, 0],
    ]);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room activates trusted shootable func_button from room-owned fire", () => {
  const oneShotButtonDefinitions = testWorldDefinitions.map((definition) =>
    definition.kind === "mover" && definition.entityIndex === 212
      ? { ...definition, shootHealth: 20 }
      : definition
  );
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedWorldDefinitions: oneShotButtonDefinitions,
  });
  const connection = createFakePartyConnection("conn-world-button-shoot");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-world-button-shoot-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);
  server.onMessage(JSON.stringify(createFireEnvelope({
    messageId: "party-world-button-shoot",
    sequence: 2,
    fireSequence: 1,
    sentAt: timestamp + 500,
  })), connection);

  const moverEvents = partyRoomEvents(fakeRoom, "world.mover")
    .filter((candidate) => candidate.entityIndex === 212);
  const buttonEvent = moverEvents.at(-1);
  assert.equal(moverEvents.length, 1);
  assert.equal(buttonEvent?.playerId, "party:client-a");
  assert.equal(buttonEvent?.classname, "func_button");
  assert.equal(buttonEvent?.activation, "shoot");
  assert.equal(buttonEvent?.state, "moving-up");
  assert.deepEqual(buttonEvent?.fromOrigin, [0, 0, -12]);
  assert.deepEqual(buttonEvent?.toOrigin, [0, 0, -10]);
  assert.deepEqual(buttonEvent?.targetEntityIndexes, [213]);
  assert.equal(buttonEvent?.soundPath, "buttons/switch21.wav");
  const targetEvents = partyRoomEvents(fakeRoom, "world.targets")
    .filter((candidate) => candidate.sourceEntityIndex === 212);
  assert.equal(targetEvents.length, 1);
  assert.equal(targetEvents[0]?.sourceEventId, buttonEvent?.eventId);
  assert.deepEqual(targetEvents[0]?.targetEntityIndexes, [213]);
  assert.equal(localPlayerFromSnapshot(fakeRoom.broadcasts.at(-1)).inventory.shells, 24);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room activates trusted shootable multi triggers from room-owned fire", () => {
  const oneShotTriggerDefinitions = testShootableTriggerWorldDefinitions.map((definition) => ({
    ...definition,
    shootHealth: 20,
  }));
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedWorldDefinitions: oneShotTriggerDefinitions,
  });
  const connection = createFakePartyConnection("conn-world-trigger-shoot");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-world-trigger-shoot-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);
  server.onMessage(JSON.stringify(createFireEnvelope({
    messageId: "party-world-trigger-shoot",
    sequence: 2,
    fireSequence: 1,
    sentAt: timestamp + 500,
  })), connection);

  const triggerEvents = partyRoomEvents(fakeRoom, "world.trigger")
    .filter((candidate) => candidate.entityIndex === 218);
  const triggerEvent = triggerEvents.at(-1);
  assert.equal(triggerEvents.length, 1);
  assert.equal(triggerEvent?.playerId, "party:client-a");
  assert.equal(triggerEvent?.classname, "trigger_multiple");
  assert.equal(triggerEvent?.activation, "shoot");
  assert.equal(triggerEvent?.message, "shot trigger");
  assert.deepEqual(triggerEvent?.targetEntityIndexes, [219]);
  const targetEvents = partyRoomEvents(fakeRoom, "world.targets")
    .filter((candidate) => candidate.sourceEntityIndex === 218);
  assert.equal(targetEvents.length, 1);
  assert.equal(targetEvents[0]?.sourceEventId, triggerEvent?.eventId);
  assert.deepEqual(targetEvents[0]?.targetEntityIndexes, [219]);
  assert.equal(localPlayerFromSnapshot(fakeRoom.broadcasts.at(-1)).inventory.shells, 24);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room emits trusted touch trigger activations once per wait window", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedWorldDefinitions: testWorldDefinitions,
  });
  const connection = createFakePartyConnection("conn-world-trigger");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-world-trigger-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);
  server.onMessage(JSON.stringify(createWorldIntentEnvelope({
    messageId: "party-world-trigger",
    sequence: 2,
    sentAt: timestamp + 10,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: timestamp + 10,
      entityIndex: 82,
      origin: [0, 0, 0],
    },
  })), connection);
  server.onMessage(JSON.stringify(createWorldIntentEnvelope({
    messageId: "party-world-trigger-repeat",
    sequence: 3,
    sentAt: timestamp + 20,
    intent: {
      intentType: "touch",
      worldSequence: 2,
      requestedAt: timestamp + 20,
      entityIndex: 82,
      origin: [0, 0, 0],
    },
  })), connection);

  const triggerEvents = partyRoomEvents(fakeRoom, "world.trigger");
  const touchEvents = triggerEvents.filter((candidate) => candidate.activation === "touch");
  const targetTriggerEvents = triggerEvents.filter((candidate) => candidate.activation === "target");
  const event = touchEvents.at(-1);
  assert.equal(touchEvents.length, 1);
  assert.equal(event?.playerId, "party:client-a");
  assert.equal(event?.entityIndex, 82);
  assert.equal(event?.classname, "trigger_multiple");
  assert.equal(event?.activation, "touch");
  assert.deepEqual(event?.targetEntityIndexes, [201, 202, 206, 208]);
  assert.deepEqual(event?.killtargetEntityIndexes, [203]);
  assert.equal(event?.delayMs, 0);
  assert.equal(event?.waitMs, 200);
  assert.equal(event?.oneShot, false);
  assert.equal(event?.message, "triggered");
  assert.equal(event?.soundPath, "misc/trigger1.wav");
  assert.equal(targetTriggerEvents.length, 3);
  const relayEvent = targetTriggerEvents.find((candidate) => candidate.classname === "trigger_relay");
  const counterEvent = targetTriggerEvents.find((candidate) => candidate.classname === "trigger_counter");
  const onceEvent = targetTriggerEvents.find((candidate) => candidate.entityIndex === 206);
  assert.deepEqual(relayEvent?.targetEntityIndexes, [204]);
  assert.equal(relayEvent?.complete, true);
  assert.deepEqual(counterEvent?.targetEntityIndexes, [205]);
  assert.equal(counterEvent?.remaining, 1);
  assert.equal(counterEvent?.complete, false);
  assert.equal(counterEvent?.message, "Only 1 more to go...");
  assert.equal(onceEvent?.classname, "trigger_once");
  assert.deepEqual(onceEvent?.targetEntityIndexes, [207]);
  assert.equal(onceEvent?.complete, true);
  assert.equal(onceEvent?.message, "one-shot target");
  const moverEvents = partyRoomEvents(fakeRoom, "world.mover");
  const buttonEvent = moverEvents.find((candidate) => candidate.entityIndex === 208);
  assert.equal(moverEvents.length, 1);
  assert.equal(buttonEvent?.playerId, "party:client-a");
  assert.equal(buttonEvent?.classname, "func_button");
  assert.equal(buttonEvent?.activation, "target");
  assert.equal(buttonEvent?.state, "moving-up");
  assert.deepEqual(buttonEvent?.fromOrigin, [0, 0, 0]);
  assert.deepEqual(buttonEvent?.toOrigin, [1, 0, 0]);
  assert.equal(buttonEvent?.speed, 40);
  assert.equal(buttonEvent?.moveMs, 0);
  assert.deepEqual(buttonEvent?.targetEntityIndexes, [209]);
  assert.equal(buttonEvent?.soundPath, "buttons/switch02.wav");
  const targetEvents = partyRoomEvents(fakeRoom, "world.targets");
  const targetEvent = targetEvents.find((candidate) => candidate.sourceEntityIndex === 82);
  const relayTargetEvent = targetEvents.find((candidate) => candidate.sourceEntityIndex === 201);
  const onceTargetEvent = targetEvents.find((candidate) => candidate.sourceEntityIndex === 206);
  const buttonTargetEvent = targetEvents.find((candidate) => candidate.sourceEntityIndex === 208);
  assert.equal(targetEvents.length, 4);
  assert.equal(targetEvent?.sourceEventId, event?.eventId);
  assert.equal(targetEvent?.sourceEntityIndex, 82);
  assert.equal(targetEvent?.playerId, "party:client-a");
  assert.deepEqual(targetEvent?.targetEntityIndexes, [201, 202, 206, 208]);
  assert.deepEqual(targetEvent?.killtargetEntityIndexes, [203]);
  assert.equal(targetEvent?.delayMs, 0);
  assert.equal(targetEvent?.message, "triggered");
  assert.equal(targetEvent?.soundPath, "misc/trigger1.wav");
  assert.equal(relayTargetEvent?.sourceEventId, relayEvent?.eventId);
  assert.deepEqual(relayTargetEvent?.targetEntityIndexes, [204]);
  assert.equal(onceTargetEvent?.sourceEventId, onceEvent?.eventId);
  assert.deepEqual(onceTargetEvent?.targetEntityIndexes, [207]);
  assert.equal(buttonTargetEvent?.sourceEventId, buttonEvent?.eventId);
  assert.deepEqual(buttonTargetEvent?.targetEntityIndexes, [209]);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room rejects gameplay facts that do not match supplied definitions", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const connection = createFakePartyConnection("conn-facts");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();
  const changedFacts = createQuakeMultiplayerGameplayFacts({
    deathmatchSpawns: testDeathmatchSpawns,
    pickupDefinitions: [{
      ...testPickupDefinitions[0],
      effect: { shells: 40 },
    }],
  });

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-facts-inconsistent",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: changedFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);

  assert.equal(connection.sent.at(-1)?.type, "room.reject");
  assert.equal(connection.sent.at(-1)?.payload.code, "wrong-map");
  assert.equal(connection.sent.at(-1)?.payload.rejectedMessageId, "party-facts-inconsistent");
  assert.equal(connection.sent.at(-1)?.payload.details.claimedFactsHash, changedFacts.factsHash);
  assert.equal(connection.sent.at(-1)?.payload.details.computedFactsHash, testGameplayFacts.factsHash);
  assert.equal(fakeRoom.broadcasts.some((message) => message.type === "room.snapshot"), false);
});

test("PartyKit room can use trusted gameplay definitions instead of first-client definitions", () => {
  const trustedDefinitions = createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: [{
      spawnId: "trusted-spawn",
      classname: "info_player_deathmatch",
      origin: [9, 8, 7],
      rotX: 88,
      rotY: 123,
      sourceEntityIndex: 7,
    }],
    pickupDefinitions: [{
      pickupId: "trusted-shells",
      entityIndex: 70,
      classname: "item_shells",
      origin: [9, 8, 7],
      effect: { shells: 20 },
      lifecycle: { action: "respawn", condition: "deathmatch == 1", delayMs: 30000 },
    }],
  });
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedGameplayDefinitions: trustedDefinitions,
  });
  const badConnection = createFakePartyConnection("conn-trusted-bad");
  fakeRoom.addConnection(badConnection);
  server.onConnect(badConnection);
  const timestamp = Date.now();
  const changedDefinitions = createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: trustedDefinitions.deathmatchSpawns,
    pickupDefinitions: [{
      ...trustedDefinitions.pickupDefinitions[0],
      effect: { shells: 40 },
    }],
  });

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-trusted-bad-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-bad",
      displayName: "Bad Player",
      gameplayFacts: changedDefinitions.gameplayFacts,
      deathmatchSpawns: changedDefinitions.deathmatchSpawns,
      pickupDefinitions: changedDefinitions.pickupDefinitions,
    },
  })), badConnection);

  assert.equal(badConnection.sent.at(-1)?.type, "room.reject");
  assert.equal(badConnection.sent.at(-1)?.payload.code, "wrong-map");
  assert.equal(badConnection.sent.at(-1)?.payload.details.expectedFactsHash, trustedDefinitions.gameplayFacts.factsHash);
  assert.equal(fakeRoom.broadcasts.some((message) => message.type === "room.snapshot"), false);

  const goodConnection = createFakePartyConnection("conn-trusted-good");
  fakeRoom.addConnection(goodConnection);
  server.onConnect(goodConnection);
  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-trusted-good-hello",
    sequence: 1,
    sentAt: timestamp + 100,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  })), goodConnection);

  const snapshot = fakeRoom.broadcasts.at(-1);
  const player = localPlayerFromSnapshot(snapshot);
  assert.deepEqual(player.origin, [9, 8, 7]);
  assert.equal(player.spawnId, "trusted-spawn");
  assert.deepEqual(pickupFromSnapshot(snapshot, 70), {
    pickupId: "trusted-shells",
    entityIndex: 70,
    available: true,
    updatedAt: snapshot.payload.pickups[0].updatedAt,
  });
  assert.equal(goodConnection.sent.some((message) => message.type === "room.reject"), false);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room derives trusted gameplay definitions from static scene assets", async () => {
  const scene = {
    entities: [{
      index: 10,
      classname: "info_player_deathmatch",
      properties: { angle: "45" },
      origin: { x: 110, y: 180, z: 330 },
      angle: 45,
    }, {
      index: 20,
      classname: "item_shells",
      properties: {},
      origin: { x: 140, y: 190, z: 360 },
    }],
    entityManifest: {
      runtime: {
        pickupEntityIndexes: [20],
      },
    },
    collision: {
      pivot: { x: 100, y: 200, z: 300 },
    },
    gameLogic: {
      entities: [{
        entityIndex: 20,
        origin: { x: 140, y: 190, z: 360 },
        resolvedPickup: {
          kind: "item_shells",
          inventoryDelta: { shells: 20 },
          behavior: {
            ammo: { inventoryField: "shells", amount: 20 },
          },
          lifecycle: {
            respawn: {
              rules: [{
                action: "respawn",
                condition: "deathmatch",
                delaySeconds: 30,
              }],
            },
          },
        },
      }],
    },
    spawn: {
      origin: [0, 0, 0],
      eyeHeight: 0.92,
      rotX: 90,
      rotY: 270,
    },
  };
  const trustedDefinitions = quakeMultiplayerGameplayDefinitionsFromScene(scene, {});
  const changedDefinitions = createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: trustedDefinitions.deathmatchSpawns,
    pickupDefinitions: [{
      ...trustedDefinitions.pickupDefinitions[0],
      effect: { shells: 40 },
    }],
  });
  const fetchedPaths = [];
  const staticRoomKey = createQuakeMultiplayerRoomCompatibilityKey({
    ...roomKey,
    sceneUrl: "https://cssquake.example/q/e1m1.json",
  });
  const fakeRoom = createFakePartyRoom("party-static-scene", {
    assets: {
      async fetch(path) {
        fetchedPaths.push(path);
        if (path !== "/q/e1m1.json") return null;
        return new Response(JSON.stringify(scene), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  });
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const badConnection = createFakePartyConnection("conn-static-bad");
  fakeRoom.addConnection(badConnection);
  server.onConnect(badConnection);
  const timestamp = Date.now();

  await server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-static-bad-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey: staticRoomKey,
    payload: {
      clientId: "client-bad",
      displayName: "Bad Player",
      gameplayFacts: changedDefinitions.gameplayFacts,
      deathmatchSpawns: changedDefinitions.deathmatchSpawns,
      pickupDefinitions: changedDefinitions.pickupDefinitions,
    },
  })), badConnection);

  assert.deepEqual(fetchedPaths, ["/q/e1m1.json"]);
  assert.equal(badConnection.sent.at(-1)?.type, "room.reject");
  assert.equal(badConnection.sent.at(-1)?.payload.code, "wrong-map");
  assert.equal(badConnection.sent.at(-1)?.payload.details.expectedFactsHash, trustedDefinitions.gameplayFacts.factsHash);
  assert.equal(fakeRoom.broadcasts.some((message) => message.type === "room.snapshot"), false);

  const goodConnection = createFakePartyConnection("conn-static-good");
  fakeRoom.addConnection(goodConnection);
  server.onConnect(goodConnection);
  await server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-static-good-hello",
    sequence: 1,
    sentAt: timestamp + 100,
    roomKey: staticRoomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  })), goodConnection);

  const snapshot = fakeRoom.broadcasts.at(-1);
  const player = localPlayerFromSnapshot(snapshot);
  assert.deepEqual(player.origin, trustedDefinitions.deathmatchSpawns[0].origin);
  assert.equal(player.spawnId, trustedDefinitions.deathmatchSpawns[0].spawnId);
  assert.deepEqual(pickupFromSnapshot(snapshot, 20), {
    pickupId: trustedDefinitions.pickupDefinitions[0].pickupId,
    entityIndex: 20,
    available: true,
    updatedAt: snapshot.payload.pickups[0].updatedAt,
  });
  assert.equal(goodConnection.sent.some((message) => message.type === "room.reject"), false);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room derives fired weapon and kind from authoritative inventory", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const connection = createFakePartyConnection("conn-fire");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-fire-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);
  server.onMessage(JSON.stringify(createFireEnvelope({
    messageId: "party-fire-spoof-weapon",
    sequence: 2,
    fireSequence: 1,
    sentAt: timestamp + 500,
    weapon: "rocketlauncher",
    fireKind: "projectile",
  })), connection);

  const fireEvent = partyRoomEvents(fakeRoom, "player.fired").at(-1);
  assert.equal(fireEvent?.weapon, "shotgun");
  assert.equal(fireEvent?.fireKind, "hitscan");
  assert.equal(localPlayerFromSnapshot(fakeRoom.broadcasts.at(-1)).inventory.shells, 24);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room applies QuakeC armor absorption before invulnerability blocks health damage", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const attackerConnection = createFakePartyConnection("conn-armor-a");
  const victimConnection = createFakePartyConnection("conn-armor-b");
  fakeRoom.addConnection(attackerConnection);
  fakeRoom.addConnection(victimConnection);
  server.onConnect(attackerConnection);
  server.onConnect(victimConnection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-armor-hello-a",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player A",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), attackerConnection);
  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-armor-hello-b",
    sequence: 1,
    sentAt: timestamp + 10,
    roomKey,
    payload: {
      clientId: "client-b",
      displayName: "Player B",
      gameplayFacts: testGameplayFacts,
    },
  })), victimConnection);

  server.players.set("party:client-a", {
    ...server.players.get("party:client-a"),
    origin: [0, 0, 0],
    rotX: 0,
    rotY: 0,
  });
  const victimInventory = {
    ...createTestPlayer().inventory,
    health: 100,
    armor: 50,
    armorType: 0.6,
    itemFlags: 4097 | 16384,
    powerups: [{
      active: true,
      activationField: "invincible_finished",
      finishedAt: timestamp + 30000,
      finishedField: "invincible_finished",
      itemFlag: 8192,
      itemFlagExpression: "IT_INVULNERABILITY",
    }],
  };
  server.players.set("party:client-b", {
    ...server.players.get("party:client-b"),
    origin: [0, 0, -3.15],
    health: 100,
    armor: 50,
    inventory: victimInventory,
  });

  server.onMessage(JSON.stringify(createFireEnvelope({
    messageId: "party-armor-fire",
    sequence: 2,
    fireSequence: 1,
    sentAt: timestamp + 500,
  })), attackerConnection);

  const damage = partyRoomEvents(fakeRoom, "player.damaged").at(-1);
  const snapshot = fakeRoom.broadcasts.at(-1);
  const victim = snapshot.payload.players.find((player) => player.playerId === "party:client-b");
  assert.equal(damage?.victimPlayerId, "party:client-b");
  assert.equal(damage?.damage, 24);
  assert.equal(damage?.health, 100);
  assert.equal(damage?.armor, 35);
  assert.equal(victim.health, 100);
  assert.equal(victim.armor, 35);
  assert.equal(victim.inventory.armor, 35);
  assert.equal(victim.inventory.armorType, 0.6);
  assert.deepEqual(victim.velocity, [0, 0, -24 * 8 * QUAKE_COLLISION_UNIT_SCALE]);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room applies projectile splash damage to the attacker", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const attackerConnection = createFakePartyConnection("conn-splash-a");
  const victimConnection = createFakePartyConnection("conn-splash-b");
  fakeRoom.addConnection(attackerConnection);
  fakeRoom.addConnection(victimConnection);
  server.onConnect(attackerConnection);
  server.onConnect(victimConnection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-splash-hello-a",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player A",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), attackerConnection);
  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-splash-hello-b",
    sequence: 1,
    sentAt: timestamp + 10,
    roomKey,
    payload: {
      clientId: "client-b",
      displayName: "Player B",
      gameplayFacts: testGameplayFacts,
    },
  })), victimConnection);

  const rocketInventory = {
    ...createTestPlayer().inventory,
    activeWeapon: "rocketlauncher",
    weapons: ["axe", "shotgun", "rocketlauncher"],
    rockets: 5,
  };
  server.players.set("party:client-a", {
    ...server.players.get("party:client-a"),
    origin: [0, 0, 0],
    rotX: 0,
    rotY: 0,
    activeWeapon: "rocketlauncher",
    inventory: rocketInventory,
  });
  server.players.set("party:client-b", {
    ...server.players.get("party:client-b"),
    origin: [0, 0, -3.15],
    rotX: 0,
    rotY: 0,
  });

  server.onMessage(JSON.stringify(createFireEnvelope({
    messageId: "party-splash-fire",
    sequence: 2,
    fireSequence: 1,
    sentAt: timestamp + 500,
  })), attackerConnection);

  const killed = partyRoomEvents(fakeRoom, "player.killed").at(-1);
  const selfDamage = partyRoomEvents(fakeRoom, "player.damaged")
    .find((event) => event.victimPlayerId === "party:client-a");
  const snapshot = fakeRoom.broadcasts.at(-1);
  const attacker = snapshot.payload.players.find((player) => player.playerId === "party:client-a");
  assert.equal(killed?.victimPlayerId, "party:client-b");
  assert.equal(killed?.attackerPlayerId, "party:client-a");
  assert.equal(selfDamage?.damage, 30);
  assert.equal(selfDamage?.health, 70);
  assert.equal(attacker.health, 70);
  assert.equal(attacker.frags, 1);
  assert.equal(attacker.inventory.rockets, 4);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room applies source-backed underwater lightning discharge", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedSceneMovement: {
      collisionWorld: createFakeCollisionWorld([], {
        contentsAt: () => -3,
      }),
      playerEyeHeight: 22,
    },
  });
  const attackerConnection = createFakePartyConnection("conn-lightning-a");
  const victimConnection = createFakePartyConnection("conn-lightning-b");
  fakeRoom.addConnection(attackerConnection);
  fakeRoom.addConnection(victimConnection);
  server.onConnect(attackerConnection);
  server.onConnect(victimConnection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-lightning-hello-a",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player A",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), attackerConnection);
  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-lightning-hello-b",
    sequence: 1,
    sentAt: timestamp + 10,
    roomKey,
    payload: {
      clientId: "client-b",
      displayName: "Player B",
      gameplayFacts: testGameplayFacts,
    },
  })), victimConnection);

  const lightningInventory = {
    ...createTestPlayer().inventory,
    activeWeapon: "lightning",
    weapons: ["axe", "shotgun", "lightning"],
    cells: 4,
  };
  server.players.set("party:client-a", {
    ...server.players.get("party:client-a"),
    origin: [0, 0, 0],
    activeWeapon: "lightning",
    inventory: lightningInventory,
  });
  server.players.set("party:client-b", {
    ...server.players.get("party:client-b"),
    origin: [0, 0, 0.85],
  });

  server.onMessage(JSON.stringify(createFireEnvelope({
    messageId: "party-lightning-fire",
    sequence: 2,
    fireSequence: 1,
    sentAt: timestamp + 500,
    weapon: "shotgun",
    fireKind: "hitscan",
  })), attackerConnection);

  const expectedSelfDamage = (140 - 0.5 * (0.85 / QUAKE_COLLISION_UNIT_SCALE)) * 0.5;
  const expectedSelfHealth = 100 - Math.ceil(expectedSelfDamage);
  const selfDamage = partyRoomEvents(fakeRoom, "player.damaged")
    .find((event) => event.victimPlayerId === "party:client-a");
  const killed = partyRoomEvents(fakeRoom, "player.killed")
    .find((event) => event.victimPlayerId === "party:client-b");
  const snapshot = fakeRoom.broadcasts.at(-1);
  const attacker = snapshot.payload.players.find((player) => player.playerId === "party:client-a");
  const victim = snapshot.payload.players.find((player) => player.playerId === "party:client-b");
  assert.ok(Math.abs((selfDamage?.damage ?? 0) - expectedSelfDamage) < 1e-9);
  assert.equal(selfDamage?.health, expectedSelfHealth);
  assert.equal(selfDamage?.damageSource, "lightning-discharge");
  assert.equal(killed?.attackerPlayerId, "party:client-a");
  assert.equal(killed?.damageSource, "lightning-discharge");
  assert.equal(attacker.inventory.cells, 0);
  assert.equal(attacker.health, expectedSelfHealth);
  assert.equal(attacker.frags, 1);
  assert.equal(victim.alive, false);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room subtracts a frag for room-owned self kills", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const connection = createFakePartyConnection("conn-self-kill");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-self-kill-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);

  server.applyPlayerDamage({
    attackerPlayerId: "party:client-a",
    victimPlayerId: "party:client-a",
    damage: 200,
    source: "test",
    eventId: "party-self-kill",
  });

  const killEvent = partyRoomEvents(fakeRoom, "player.killed").at(-1);
  const snapshot = fakeRoom.broadcasts.at(-1);
  const player = snapshot.payload.players.find((candidate) => candidate.playerId === "party:client-a");
  assert.equal(killEvent?.victimPlayerId, "party:client-a");
  assert.equal(killEvent?.attackerPlayerId, "party:client-a");
  assert.equal(player?.frags, -1);
  assert.equal(player?.deaths, 1);
  assert.equal(player?.alive, false);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room enters intermission when frag limit is reached", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const attackerConnection = createFakePartyConnection("conn-frag-limit-a");
  const victimConnection = createFakePartyConnection("conn-frag-limit-b");
  fakeRoom.addConnection(attackerConnection);
  fakeRoom.addConnection(victimConnection);
  server.onConnect(attackerConnection);
  server.onConnect(victimConnection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-frag-limit-hello-a",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player A",
      matchSettings: { fragLimit: 1 },
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), attackerConnection);
  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-frag-limit-hello-b",
    sequence: 1,
    sentAt: timestamp + 10,
    roomKey,
    payload: {
      clientId: "client-b",
      displayName: "Player B",
      gameplayFacts: testGameplayFacts,
    },
  })), victimConnection);

  server.applyPlayerDamage({
    attackerPlayerId: "party:client-a",
    victimPlayerId: "party:client-b",
    damage: 200,
    source: "test",
    eventId: "party-frag-limit",
  });

  const killEvent = partyRoomEvents(fakeRoom, "player.killed").at(-1);
  const matchNotice = partyRoomEvents(fakeRoom, "match.notice").at(-1);
  const snapshot = fakeRoom.broadcasts.at(-1);
  assert.equal(killEvent?.attackerPlayerId, "party:client-a");
  assert.equal(matchNotice?.code, "frag-limit");
  assert.equal(snapshot?.type, "room.snapshot");
  assert.equal(snapshot?.payload.match.status, "intermission");
  assert.equal(snapshot?.payload.players.find((player) => player.playerId === "party:client-a")?.frags, 1);
  assert.equal(snapshot?.payload.players.find((player) => player.playerId === "party:client-b")?.alive, false);

  server.onMessage(JSON.stringify(createFireEnvelope({
    clientId: "client-a",
    messageId: "party-frag-limit-late-fire",
    sequence: 2,
    fireSequence: 1,
    sentAt: timestamp + 500,
  })), attackerConnection);
  assert.equal(attackerConnection.sent.at(-1)?.type, "room.reject");
  assert.equal(attackerConnection.sent.at(-1)?.payload.code, "unsupported");
  assert.equal(attackerConnection.sent.at(-1)?.payload.rejectedMessageId, "party-frag-limit-late-fire");

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room enters intermission when time limit is reached", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const connection = createFakePartyConnection("conn-time-limit");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-time-limit-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      matchSettings: { timeLimitMs: 100 },
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), connection);

  server.startedAt = Date.now() - 150;
  server.onMessage(JSON.stringify(createFireEnvelope({
    messageId: "party-time-limit-fire",
    sequence: 2,
    fireSequence: 1,
    sentAt: timestamp + 150,
  })), connection);

  const matchNotice = partyRoomEvents(fakeRoom, "match.notice").at(-1);
  const snapshot = fakeRoom.broadcasts.findLast((message) => message.type === "room.snapshot");
  assert.equal(matchNotice?.code, "time-limit");
  assert.equal(snapshot?.payload.match.status, "intermission");
  assert.equal(connection.sent.at(-1)?.type, "room.reject");
  assert.equal(connection.sent.at(-1)?.payload.code, "unsupported");
  assert.equal(connection.sent.at(-1)?.payload.rejectedMessageId, "party-time-limit-fire");

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room can restart a match after intermission", async () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const attackerConnection = createFakePartyConnection("conn-restart-a");
  const victimConnection = createFakePartyConnection("conn-restart-b");
  fakeRoom.addConnection(attackerConnection);
  fakeRoom.addConnection(victimConnection);
  server.onConnect(attackerConnection);
  server.onConnect(victimConnection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-restart-hello-a",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player A",
      matchSettings: { fragLimit: 1, restartDelayMs: 1 },
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), attackerConnection);
  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-restart-hello-b",
    sequence: 1,
    sentAt: timestamp + 10,
    roomKey,
    payload: {
      clientId: "client-b",
      displayName: "Player B",
      gameplayFacts: testGameplayFacts,
    },
  })), victimConnection);

  server.applyPlayerDamage({
    attackerPlayerId: "party:client-a",
    victimPlayerId: "party:client-b",
    damage: 200,
    source: "test",
    eventId: "party-restart",
  });
  assert.equal(fakeRoom.broadcasts.at(-1)?.payload.match.status, "intermission");

  await waitMs(10);

  const restartNotice = partyRoomEvents(fakeRoom, "match.notice")
    .filter((event) => event.code === "restart")
    .at(-1);
  const snapshot = fakeRoom.broadcasts.findLast((message) => message.type === "room.snapshot");
  const attacker = snapshot?.payload.players.find((player) => player.playerId === "party:client-a");
  const victim = snapshot?.payload.players.find((player) => player.playerId === "party:client-b");
  assert.equal(restartNotice?.message, "Match restarted.");
  assert.equal(snapshot?.payload.match.status, "active");
  assert.equal(attacker?.frags, 0);
  assert.equal(attacker?.deaths, 0);
  assert.equal(attacker?.alive, true);
  assert.equal(victim?.frags, 0);
  assert.equal(victim?.deaths, 0);
  assert.equal(victim?.alive, true);
  assert.equal(snapshot?.payload.pickups[0]?.available, true);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room can manually restart a match during intermission", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const attackerConnection = createFakePartyConnection("conn-manual-restart-a");
  const victimConnection = createFakePartyConnection("conn-manual-restart-b");
  fakeRoom.addConnection(attackerConnection);
  fakeRoom.addConnection(victimConnection);
  server.onConnect(attackerConnection);
  server.onConnect(victimConnection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-manual-restart-hello-a",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player A",
      matchSettings: { fragLimit: 1 },
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  })), attackerConnection);
  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-manual-restart-hello-b",
    sequence: 1,
    sentAt: timestamp + 10,
    roomKey,
    payload: {
      clientId: "client-b",
      displayName: "Player B",
      gameplayFacts: testGameplayFacts,
    },
  })), victimConnection);

  server.applyPlayerDamage({
    attackerPlayerId: "party:client-a",
    victimPlayerId: "party:client-b",
    damage: 200,
    source: "test",
    eventId: "party-manual-restart",
  });
  assert.equal(fakeRoom.broadcasts.at(-1)?.payload.match.status, "intermission");

  server.onMessage(JSON.stringify(createMatchEnvelope({
    messageId: "party-manual-restart",
    sequence: 2,
    sentAt: timestamp + 30,
    matchSequence: 1,
  })), attackerConnection);

  const restartNotice = partyRoomEvents(fakeRoom, "match.notice")
    .filter((event) => event.code === "restart")
    .at(-1);
  const snapshot = fakeRoom.broadcasts.findLast((message) => message.type === "room.snapshot");
  const attacker = snapshot?.payload.players.find((player) => player.playerId === "party:client-a");
  const victim = snapshot?.payload.players.find((player) => player.playerId === "party:client-b");
  assert.equal(restartNotice?.message, "Match restarted.");
  assert.equal(snapshot?.payload.match.status, "active");
  assert.equal(attacker?.frags, 0);
  assert.equal(victim?.alive, true);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room clears leave-in-place pickup ownership when a player dies", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const connection = createFakePartyConnection("conn-pickup-death");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();
  const gameplayFacts = createQuakeMultiplayerGameplayFacts({
    deathmatchSpawns: testDeathmatchSpawns,
    pickupDefinitions: testLeavePickupDefinitions,
  });

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-pickup-death-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testLeavePickupDefinitions,
    },
  })), connection);
  server.onMessage(JSON.stringify(createPickupEnvelope({
    entityIndex: 88,
    messageId: "party-leave-pickup",
    pickupSequence: 1,
    sequence: 2,
    sentAt: timestamp + 10,
  })), connection);

  const pickedState = pickupFromSnapshot(fakeRoom.broadcasts.at(-1), 88);
  assert.deepEqual(pickedState.ownerPlayerIds, ["party:client-a"]);

  server.applyPlayerDamage({
    attackerPlayerId: "party:client-a",
    victimPlayerId: "party:client-a",
    damage: 200,
    source: "test",
    eventId: "party-leave-pickup-death",
  });

  const clearedState = pickupFromSnapshot(fakeRoom.broadcasts.at(-1), 88);
  assert.equal(clearedState.available, true);
  assert.deepEqual(clearedState.ownerPlayerIds, []);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room respawns shared pickups as available room state", async () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const connection = createFakePartyConnection("conn-pickup-respawn");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();
  const pickupDefinitions = [{
    pickupId: "respawn-shells",
    entityIndex: 92,
    classname: "item_shells",
    origin: testDeathmatchSpawns[0].origin,
    effect: { shells: 20 },
    lifecycle: { action: "respawn", condition: "deathmatch", delayMs: 0 },
  }];
  const gameplayFacts = createQuakeMultiplayerGameplayFacts({
    deathmatchSpawns: testDeathmatchSpawns,
    pickupDefinitions,
  });

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-pickup-respawn-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions,
    },
  })), connection);
  server.onMessage(JSON.stringify(createPickupEnvelope({
    entityIndex: 92,
    messageId: "party-pickup-respawn-take",
    pickupSequence: 1,
    sequence: 2,
    sentAt: timestamp + 10,
  })), connection);

  const takenState = pickupFromSnapshot(fakeRoom.broadcasts.at(-1), 92);
  assert.equal(takenState.available, false);
  assert.equal(Number.isFinite(takenState.respawnAt), true);

  await new Promise((resolve) => setTimeout(resolve, 5));

  const respawnEvent = partyRoomEvents(fakeRoom, "pickup.respawned").at(-1);
  const respawnedState = pickupFromSnapshot(fakeRoom.broadcasts.at(-1), 92);
  assert.equal(respawnEvent?.pickup.available, true);
  assert.equal(respawnedState.available, true);
  assert.equal(respawnedState.respawnAt, undefined);
  assert.deepEqual(respawnedState.ownerPlayerIds, []);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room dispatches pickup targets and removes killtargets", () => {
  const fakeRoom = createFakePartyRoom();
  const pickupDefinitions = [{
    pickupId: "target-shells",
    entityIndex: 95,
    classname: "item_shells",
    origin: testDeathmatchSpawns[0].origin,
    effect: { shells: 20 },
    lifecycle: { action: "remove", condition: "deathmatch" },
    targetEntityIndexes: [82],
    killtargetEntityIndexes: [77, 96],
    message: "A pickup opened the route",
  }, {
    pickupId: "killed-shells",
    entityIndex: 96,
    classname: "item_shells",
    origin: testDeathmatchSpawns[0].origin,
    effect: { shells: 20 },
    lifecycle: { action: "respawn", condition: "deathmatch", delayMs: 30000 },
  }];
  const server = new CssQuakeMultiplayerRoom(fakeRoom, {
    trustedWorldDefinitions: testWorldDefinitions,
  });
  const connection = createFakePartyConnection("conn-pickup-targets");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-pickup-targets-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: createQuakeMultiplayerGameplayFacts({
        deathmatchSpawns: testDeathmatchSpawns,
        pickupDefinitions,
      }),
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions,
    },
  })), connection);
  server.onMessage(JSON.stringify(createPickupEnvelope({
    entityIndex: 95,
    messageId: "party-pickup-targets-take",
    pickupSequence: 1,
    sequence: 2,
    sentAt: timestamp + 10,
  })), connection);

  const targetEvent = partyRoomEvents(fakeRoom, "world.targets")
    .find((event) => event.sourceEventId === "pickup-party-pickup-targets-take");
  assert.deepEqual(targetEvent?.targetEntityIndexes, [82]);
  assert.deepEqual(targetEvent?.killtargetEntityIndexes, [77, 96]);
  assert.equal(targetEvent?.sourceEntityIndex, 95);
  assert.equal(targetEvent?.message, "A pickup opened the route");

  const triggered = partyRoomEvents(fakeRoom, "world.trigger")
    .find((event) => event.entityIndex === 82 && event.activation === "target");
  assert.equal(triggered?.playerId, "party:client-a");

  const snapshot = fakeRoom.broadcasts.findLast((message) => message.type === "room.snapshot");
  assert.equal(snapshot?.payload.pickups.some((pickup) => pickup.entityIndex === 96), false);

  server.onMessage(JSON.stringify(createWorldIntentEnvelope({
    messageId: "party-pickup-killed-teleport",
    sequence: 3,
    sentAt: timestamp + 20,
    intent: {
      intentType: "teleport",
      worldSequence: 1,
      requestedAt: timestamp + 20,
      entityIndex: 77,
      origin: testDeathmatchSpawns[0].origin,
      velocity: [0, 0, 0],
      destinationEntityIndex: 78,
    },
  })), connection);
  const reject = connection.sent.findLast((message) => message.type === "room.reject");
  assert.equal(reject?.payload.rejectedMessageId, "party-pickup-killed-teleport");
  assert.equal(reject?.payload.details.reason, "unknown-entity");

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("PartyKit room rejects client-originated damage intents", () => {
  const fakeRoom = createFakePartyRoom();
  const server = new CssQuakeMultiplayerRoom(fakeRoom);
  const connection = createFakePartyConnection("conn-client-damage");
  fakeRoom.addConnection(connection);
  server.onConnect(connection);
  const timestamp = Date.now();

  server.onMessage(JSON.stringify(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "party-damage-hello",
    sequence: 1,
    sentAt: timestamp,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  })), connection);
  server.onMessage(JSON.stringify(createDamageEnvelope({
    messageId: "party-client-damage",
    sequence: 2,
    damageSequence: 1,
    sentAt: timestamp + 10,
    amount: 200,
  })), connection);

  assert.equal(connection.sent.at(-1)?.type, "room.reject");
  assert.equal(connection.sent.at(-1)?.payload.code, "unsupported");
  assert.equal(connection.sent.at(-1)?.payload.rejectedMessageId, "party-client-damage");
  assert.equal(partyRoomEvents(fakeRoom, "player.damaged").length, 0);
  assert.equal(partyRoomEvents(fakeRoom, "player.killed").length, 0);

  server.stopSimulationTicker();
  server.stopSnapshotTicker();
  server.stopHeartbeatTicker();
});

test("loopback adapter enforces hello, client binding, and replay checks", async () => {
  let currentTime = 1000;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
    color: "#d8893f",
  });

  session.send(createPresenceEnvelope({
    clientId: "client-a",
    messageId: "loopback-before-hello",
    sequence: 1,
    sentAt: currentTime,
  }));
  assert.equal(messages.at(-1)?.type, "room.reject");
  assert.equal(messages.at(-1)?.payload.code, "not-authorized");

  currentTime += 100;
  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-hello",
    sequence: 2,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      color: "#d8893f",
    },
  }));
  assert.equal(messages.at(-1)?.type, "room.snapshot");

  currentTime += 100;
  session.send(createPresenceEnvelope({
    clientId: "client-b",
    messageId: "loopback-wrong-client",
    sequence: 3,
    sentAt: currentTime,
  }));
  assert.equal(messages.at(-1)?.type, "room.reject");
  assert.equal(messages.at(-1)?.payload.code, "not-authorized");

  currentTime += 100;
  session.send(createPresenceEnvelope({
    clientId: "client-a",
    messageId: "loopback-replay",
    sequence: 2,
    sentAt: currentTime,
  }));
  assert.equal(messages.at(-1)?.type, "room.reject");
  assert.equal(messages.at(-1)?.payload.code, "stale");
});

test("loopback adapter rejects pickup intents that are too far from the player", async () => {
  let currentTime = 2000;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "pickup-distance-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: createQuakeMultiplayerGameplayFacts({
        pickupDefinitions: [{
          pickupId: "far-shells",
          entityIndex: 77,
          classname: "item_shells",
          origin: [100, 0, 0],
          effect: { shells: 20 },
          lifecycle: { action: "respawn", condition: "deathmatch", delayMs: 30000 },
        }],
      }),
      pickupDefinitions: [{
        pickupId: "far-shells",
        entityIndex: 77,
        classname: "item_shells",
        origin: [100, 0, 0],
        effect: { shells: 20 },
        lifecycle: { action: "respawn", condition: "deathmatch", delayMs: 30000 },
      }],
    },
  }));
  assert.equal(messages.at(-1)?.type, "room.snapshot");

  currentTime += 200;
  session.send(createPickupEnvelope({
    entityIndex: 77,
    messageId: "pickup-too-far",
    pickupSequence: 1,
    sequence: 2,
    sentAt: currentTime,
  }));

  const event = messages.at(-1);
  assert.equal(event?.type, "room.event");
  assert.equal(event?.payload.event.eventType, "pickup.rejected");
  assert.equal(event?.payload.event.reason, "too-far");
});

test("loopback adapter respawns shared pickups as available room state", async () => {
  let currentTime = 2400;
  const messages = [];
  const pickupDefinitions = [{
    pickupId: "loopback-respawn-shells",
    entityIndex: 93,
    classname: "item_shells",
    origin: [0, 0, 0],
    effect: { shells: 20 },
    lifecycle: { action: "respawn", condition: "deathmatch", delayMs: 0 },
  }];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-pickup-respawn-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: createQuakeMultiplayerGameplayFacts({ pickupDefinitions }),
      pickupDefinitions,
    },
  }));

  currentTime += 10;
  session.send(createPickupEnvelope({
    entityIndex: 93,
    messageId: "loopback-pickup-respawn-take",
    pickupSequence: 1,
    sequence: 2,
    sentAt: currentTime,
  }));

  const takenState = pickupFromSnapshot(messages.at(-1), 93);
  assert.equal(takenState.available, false);
  assert.equal(Number.isFinite(takenState.respawnAt), true);

  await new Promise((resolve) => setTimeout(resolve, 5));

  const respawnEvent = messages.findLast((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "pickup.respawned"
  );
  const respawnedState = pickupFromSnapshot(messages.at(-1), 93);
  assert.equal(respawnEvent?.payload.event.pickup.available, true);
  assert.equal(respawnedState.available, true);
  assert.equal(respawnedState.respawnAt, undefined);
  assert.deepEqual(respawnedState.ownerPlayerIds, []);
});

test("loopback adapter dispatches pickup targets and removes killtargets", async () => {
  let currentTime = 2450;
  const messages = [];
  const pickupDefinitions = [{
    pickupId: "loopback-target-shells",
    entityIndex: 95,
    classname: "item_shells",
    origin: [0, 0, 0],
    effect: { shells: 20 },
    lifecycle: { action: "remove", condition: "deathmatch" },
    targetEntityIndexes: [82],
    killtargetEntityIndexes: [77, 96],
    message: "A pickup opened the route",
  }, {
    pickupId: "loopback-killed-shells",
    entityIndex: 96,
    classname: "item_shells",
    origin: [0, 0, 0],
    effect: { shells: 20 },
    lifecycle: { action: "respawn", condition: "deathmatch", delayMs: 30000 },
  }];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    trustedWorldDefinitions: testWorldDefinitions,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-pickup-targets-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: createQuakeMultiplayerGameplayFacts({
        deathmatchSpawns: testDeathmatchSpawns,
        pickupDefinitions,
      }),
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions,
    },
  }));

  currentTime += 10;
  session.send(createPickupEnvelope({
    entityIndex: 95,
    messageId: "loopback-pickup-targets-take",
    pickupSequence: 1,
    sequence: 2,
    sentAt: currentTime,
  }));

  const targetEvent = messages
    .filter((message) => message.type === "room.event" && message.payload.event.eventType === "world.targets")
    .map((message) => message.payload.event)
    .find((event) => event.sourceEventId === "pickup-loopback-pickup-targets-take");
  assert.deepEqual(targetEvent?.targetEntityIndexes, [82]);
  assert.deepEqual(targetEvent?.killtargetEntityIndexes, [77, 96]);
  assert.equal(targetEvent?.sourceEntityIndex, 95);
  assert.equal(targetEvent?.message, "A pickup opened the route");

  const triggered = messages
    .filter((message) => message.type === "room.event" && message.payload.event.eventType === "world.trigger")
    .map((message) => message.payload.event)
    .find((event) => event.entityIndex === 82 && event.activation === "target");
  assert.equal(triggered?.playerId, "loopback:client-a");

  const snapshot = messages.findLast((message) => message.type === "room.snapshot");
  assert.equal(snapshot?.payload.pickups.some((pickup) => pickup.entityIndex === 96), false);

  currentTime += 10;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-pickup-killed-teleport",
    sequence: 3,
    sentAt: currentTime,
    intent: {
      intentType: "teleport",
      worldSequence: 1,
      requestedAt: currentTime,
      entityIndex: 77,
      origin: testDeathmatchSpawns[0].origin,
      velocity: [0, 0, 0],
      destinationEntityIndex: 78,
    },
  }));
  const reject = messages.findLast((message) => message.type === "room.reject");
  assert.equal(reject?.payload.rejectedMessageId, "loopback-pickup-killed-teleport");
  assert.equal(reject?.payload.details.reason, "unknown-entity");
});

test("loopback adapter rejects hello messages with mismatched gameplay facts", async () => {
  let currentTime = 2500;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "facts-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: testGameplayFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  }));
  assert.equal(messages.at(-1)?.type, "room.snapshot");

  currentTime += 300;
  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "facts-mismatch",
    sequence: 2,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: {
        ...testGameplayFacts,
        factsHash: "ffffffffffffffff",
      },
    },
  }));

  const reject = messages.at(-1);
  assert.equal(reject?.type, "room.reject");
  assert.equal(reject?.payload.code, "wrong-map");
  assert.equal(reject?.payload.details.expectedFactsHash, testGameplayFacts.factsHash);
  assert.equal(reject?.payload.details.receivedFactsHash, "ffffffffffffffff");
});

test("loopback adapter rejects gameplay facts that do not match supplied definitions", async () => {
  let currentTime = 2700;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  const changedFacts = createQuakeMultiplayerGameplayFacts({
    deathmatchSpawns: testDeathmatchSpawns,
    pickupDefinitions: [{
      ...testPickupDefinitions[0],
      effect: { shells: 40 },
    }],
  });
  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-facts-inconsistent",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: changedFacts,
      deathmatchSpawns: testDeathmatchSpawns,
      pickupDefinitions: testPickupDefinitions,
    },
  }));

  const reject = messages.at(-1);
  assert.equal(reject?.type, "room.reject");
  assert.equal(reject?.payload.code, "wrong-map");
  assert.equal(reject?.payload.rejectedMessageId, "loopback-facts-inconsistent");
  assert.equal(reject?.payload.details.claimedFactsHash, changedFacts.factsHash);
  assert.equal(reject?.payload.details.computedFactsHash, testGameplayFacts.factsHash);
  assert.equal(messages.some((message) => message.type === "room.snapshot"), false);
});

test("loopback adapter rejects generic client-originated world changes", async () => {
  let currentTime = 2750;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-world-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 100;
  session.send(createWorldEnvelope({
    messageId: "loopback-world-change",
    sequence: 2,
    sentAt: currentTime,
    change: "level.complete",
    entityIndex: 99,
  }));

  assert.equal(messages.at(-1)?.type, "room.reject");
  assert.equal(messages.at(-1)?.payload.code, "unsupported");
  assert.equal(messages.at(-1)?.payload.rejectedMessageId, "loopback-world-change");
  assert.equal(messages.some((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.changed"
  ), false);
});

test("loopback adapter rejects explicit client world intents until room-side validation exists", async () => {
  let currentTime = 2850;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-world-intent-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 100;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-world-use",
    sequence: 2,
    sentAt: currentTime,
    intent: {
      intentType: "use",
      worldSequence: 1,
      requestedAt: currentTime,
      origin: [1, 2, 3],
      direction: [0, 1, 0],
      range: 4,
      targetEntityIndex: 12,
    },
  }));

  const reject = messages.at(-1);
  assert.equal(reject?.type, "room.reject");
  assert.equal(reject?.payload.code, "unsupported");
  assert.equal(reject?.payload.rejectedMessageId, "loopback-world-use");
  assert.equal(reject?.payload.details.reason, "unsupported");
  assert.equal(messages.some((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.use"
  ), false);
});

test("loopback adapter teleports players from trusted world touch definitions", async () => {
  let currentTime = 2860;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    trustedWorldDefinitions: testWorldDefinitions,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-teleport-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 100;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-teleport",
    sequence: 2,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: currentTime,
      entityIndex: 77,
      origin: [0, 0, 0],
    },
  }));

  const event = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.teleport"
  )?.payload.event;
  const snapshot = messages.findLast((message) => message.type === "room.snapshot");
  assert.equal(event?.playerId, "loopback:client-a");
  assert.equal(event?.entityIndex, 77);
  assert.deepEqual(event?.origin, [10, 20, 30]);
  assert.deepEqual(event?.velocity, [QUAKE_MULTIPLAYER_TELEPORT_EXIT_SPEED, 0, 0]);
  assert.deepEqual(snapshot?.payload.players[0]?.origin, [10, 20, 30]);
  assert.deepEqual(snapshot?.payload.players[0]?.velocity, [QUAKE_MULTIPLAYER_TELEPORT_EXIT_SPEED, 0, 0]);
  assert.equal(snapshot?.payload.players[0]?.rotY, 180);
});

test("loopback adapter expires targetnamed teleporter activation windows", async () => {
  let currentTime = 2860;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    trustedWorldDefinitions: testTargetnamedTeleportWorldDefinitions,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-target-teleport-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 10;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-target-teleport-unarmed",
    sequence: 2,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: currentTime,
      entityIndex: 177,
      origin: [0, 0, 0],
    },
  }));

  currentTime += 10;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-target-teleport-arm-expiring",
    sequence: 3,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 2,
      requestedAt: currentTime,
      entityIndex: 179,
      origin: [0, 0, 0],
    },
  }));

  currentTime += QUAKE_MULTIPLAYER_TELEPORT_TARGET_ACTIVATION_WINDOW_MS + 1;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-target-teleport-expired",
    sequence: 4,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 3,
      requestedAt: currentTime,
      entityIndex: 177,
      origin: [0, 0, 0],
    },
  }));

  currentTime += 10;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-target-teleport-arm",
    sequence: 5,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 4,
      requestedAt: currentTime,
      entityIndex: 179,
      origin: [0, 0, 0],
    },
  }));
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-target-teleport-armed",
    sequence: 6,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 5,
      requestedAt: currentTime,
      entityIndex: 177,
      origin: [0, 0, 0],
    },
  }));

  const rejects = messages.filter((message) => message.type === "room.reject");
  const useEvents = messages.filter((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.use" &&
    message.payload.event.entityIndex === 177
  );
  const teleportEvent = messages.findLast((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.teleport"
  )?.payload.event;
  assert.deepEqual(rejects.map((message) => message.payload.rejectedMessageId), [
    "loopback-target-teleport-unarmed",
    "loopback-target-teleport-expired",
  ]);
  assert.equal(rejects.every((message) => message.payload.details.reason === "teleport-inactive"), true);
  assert.equal(useEvents.length, 2);
  assert.equal(teleportEvent?.entityIndex, 177);
  assert.deepEqual(teleportEvent?.origin, [30, 40, 50]);
});

test("loopback adapter telefrags simulated destination occupants during trusted teleports", async () => {
  let currentTime = 2865;
  const messages = [];
  const simulatedPlayer = createTestPlayer({
    playerId: "loopback:remote",
    clientId: "remote",
    displayName: "Remote",
    origin: [10, 20, 30],
    updatedAt: currentTime,
  });
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    trustedWorldDefinitions: testWorldDefinitions,
    simulatedPlayers: () => [simulatedPlayer],
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-telefrag-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 100;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-telefrag",
    sequence: 2,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: currentTime,
      entityIndex: 77,
      origin: [0, 0, 0],
    },
  }));

  const killed = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "player.killed"
  )?.payload.event;
  const snapshot = messages.findLast((message) => message.type === "room.snapshot");
  const attacker = snapshot?.payload.players.find((player) => player.playerId === "loopback:client-a");
  const victim = snapshot?.payload.players.find((player) => player.playerId === "loopback:remote");
  assert.equal(killed?.victimPlayerId, "loopback:remote");
  assert.equal(killed?.attackerPlayerId, "loopback:client-a");
  assert.equal(killed?.damageSource, "teledeath");
  assert.equal(attacker?.frags, 1);
  assert.deepEqual(attacker?.origin, [10, 20, 30]);
  assert.equal(victim?.alive, false);
  assert.equal(victim?.health, 0);
  assert.equal(victim?.deaths, 1);
});

test("loopback adapter enters intermission from trusted changelevel touch definitions", async () => {
  let currentTime = 2875;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    trustedWorldDefinitions: testWorldDefinitions,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-changelevel-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 100;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-changelevel",
    sequence: 2,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: currentTime,
      entityIndex: 79,
      origin: [0, 0, 0],
    },
  }));

  const transition = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "level.transition"
  );
  const notice = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "match.notice" &&
    message.payload.event.code === "level-transition"
  );
  const snapshot = messages.findLast((message) => message.type === "room.snapshot");
  assert.equal(transition?.payload.event.targetMap, "e1m2");
  assert.equal(notice?.payload.event.message, "Level transition requested: e1m2.");
  assert.equal(snapshot?.payload.match.status, "intermission");
});

test("loopback adapter applies trusted trigger_hurt touch damage", async () => {
  let currentTime = 2885;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    trustedWorldDefinitions: testWorldDefinitions,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-hurt-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 100;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-hurt",
    sequence: 2,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: currentTime,
      entityIndex: 80,
      origin: [0, 0, 0],
    },
  }));
  currentTime += 10;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-hurt-repeat",
    sequence: 3,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 2,
      requestedAt: currentTime,
      entityIndex: 80,
      origin: [0, 0, 0],
    },
  }));
  currentTime += QUAKE_MULTIPLAYER_TRIGGER_HURT_COOLDOWN_MS - 11;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-hurt-before-reactivate",
    sequence: 4,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 3,
      requestedAt: currentTime,
      entityIndex: 80,
      origin: [0, 0, 0],
    },
  }));
  currentTime += 1;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-hurt-after-reactivate",
    sequence: 5,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 4,
      requestedAt: currentTime,
      entityIndex: 80,
      origin: [0, 0, 0],
    },
  }));

  const hurtEvents = messages.filter((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "player.damaged" &&
    message.payload.event.damageSource === "trigger_hurt"
  );
  const event = hurtEvents[0]?.payload.event;
  const snapshot = messages.findLast((message) => message.type === "room.snapshot");
  assert.equal(event?.victimPlayerId, "loopback:client-a");
  assert.equal(event?.attackerPlayerId, undefined);
  assert.equal(event?.damage, 25);
  assert.equal(event?.damageSource, "trigger_hurt");
  assert.deepEqual(hurtEvents.map((message) => message.payload.event.eventId), [
    "damage-world-loopback-hurt",
    "damage-world-loopback-hurt-after-reactivate",
  ]);
  assert.equal(hurtEvents.length, 2);
  assert.equal(snapshot?.payload.players[0]?.health, 50);
});

test("loopback adapter applies room-owned lava contents damage on simulation tick", async () => {
  let currentTime = 8200;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    simulationTickMs: 5,
    trustedSceneMovement: {
      collisionWorld: createFakeCollisionWorld([], {
        contentsAt: () => -5,
      }),
      playerEyeHeight: 22,
    },
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-lava-hazard-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 50;
  await waitMs(15);
  session.disconnect("test-done");

  const lavaEvent = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "player.damaged" &&
    message.payload.event.damageSource === "lava"
  );
  const snapshot = messages.findLast((message) => message.type === "room.snapshot");
  assert.equal(lavaEvent?.payload.event.victimPlayerId, "loopback:client-a");
  assert.equal(lavaEvent?.payload.event.attackerPlayerId, undefined);
  assert.equal(lavaEvent?.payload.event.damage, 30);
  assert.equal(lavaEvent?.payload.event.health, 70);
  assert.equal(localPlayerFromSnapshot(snapshot).health, 70);
});

test("loopback adapter applies room-owned drowning damage on simulation tick", async () => {
  let currentTime = 8400;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    simulationTickMs: QUAKE_MULTIPLAYER_DROWN_AIR_MS + 50,
    trustedSceneMovement: {
      collisionWorld: createFakeCollisionWorld([], {
        contentsAt: () => -3,
      }),
      playerEyeHeight: 22,
    },
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-drown-hazard-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += QUAKE_MULTIPLAYER_DROWN_AIR_MS + 50;
  session.send(createFireEnvelope({
    messageId: "loopback-drown-hazard-fire",
    sequence: 2,
    fireSequence: 1,
    sentAt: currentTime,
  }));
  session.disconnect("test-done");

  const drownEvent = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "player.damaged" &&
    message.payload.event.damageSource === "drown"
  );
  const snapshot = messages.findLast((message) => message.type === "room.snapshot");
  assert.equal(drownEvent?.payload.event.victimPlayerId, "loopback:client-a");
  assert.equal(drownEvent?.payload.event.attackerPlayerId, undefined);
  assert.equal(drownEvent?.payload.event.damage, 4);
  assert.equal(drownEvent?.payload.event.health, 96);
  assert.equal(localPlayerFromSnapshot(snapshot).health, 96);
});

test("loopback adapter applies trusted trigger_push touch velocity", async () => {
  let currentTime = 2890;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    trustedWorldDefinitions: testWorldDefinitions,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-push-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 100;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-push",
    sequence: 2,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: currentTime,
      entityIndex: 81,
      origin: [0, 0, 0],
    },
  }));

  const event = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.push"
  )?.payload.event;
  const snapshot = messages.findLast((message) => message.type === "room.snapshot");
  assert.equal(event?.playerId, "loopback:client-a");
  assert.equal(event?.entityIndex, 81);
  assert.deepEqual(event?.velocity, [0, 0, 200 * QUAKE_COLLISION_UNIT_SCALE]);
  assert.equal(event?.oneShot, true);
  assert.deepEqual(snapshot?.payload.players[0]?.velocity, [0, 0, 200 * QUAKE_COLLISION_UNIT_SCALE]);
});

test("loopback adapter emits trusted func_button touch activation once while up", async () => {
  let currentTime = 2892;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    trustedWorldDefinitions: testWorldDefinitions,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-button-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 100;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-button",
    sequence: 2,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: currentTime,
      entityIndex: 210,
      origin: [0, 0, 0],
    },
  }));
  currentTime += 10;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-button-repeat",
    sequence: 3,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 2,
      requestedAt: currentTime,
      entityIndex: 210,
      origin: [0, 0, 0],
    },
  }));

  const moverEvents = messages.filter((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.mover"
  ).map((message) => message.payload.event);
  assert.equal(moverEvents.length, 1);
  assert.equal(moverEvents[0]?.playerId, "loopback:client-a");
  assert.equal(moverEvents[0]?.entityIndex, 210);
  assert.equal(moverEvents[0]?.classname, "func_button");
  assert.equal(moverEvents[0]?.activation, "touch");
  assert.equal(moverEvents[0]?.state, "moving-up");
  assert.deepEqual(moverEvents[0]?.fromOrigin, [0, 0, 0]);
  assert.deepEqual(moverEvents[0]?.toOrigin, [2, 0, 0]);
  assert.equal(moverEvents[0]?.speed, 40);
  assert.equal(moverEvents[0]?.moveMs, 0);
  assert.deepEqual(moverEvents[0]?.targetEntityIndexes, [211]);
  assert.equal(moverEvents[0]?.soundPath, "buttons/switch04.wav");
  const targetEvents = messages.filter((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.targets"
  ).map((message) => message.payload.event)
    .filter((event) => event.sourceEntityIndex === 210);
  assert.equal(targetEvents.length, 1);
  assert.equal(targetEvents[0]?.sourceEventId, moverEvents[0]?.eventId);
  assert.deepEqual(targetEvents[0]?.targetEntityIndexes, [211]);
});

test("loopback adapter emits func_button mover state transitions on room timers", async () => {
  let currentTime = 2892;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    trustedWorldDefinitions: testWorldDefinitions,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-button-states-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 100;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-button-states",
    sequence: 2,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: currentTime,
      entityIndex: 214,
      origin: [0, 0, 0],
    },
  }));
  await waitMs(8);

  const moverEvents = messages.filter((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.mover" &&
    message.payload.event.entityIndex === 214
  ).map((message) => message.payload.event);
  assert.deepEqual(moverEvents.map((event) => event.state), ["moving-up", "top", "moving-down", "bottom"]);
  assert.deepEqual(moverEvents[0]?.fromOrigin, [0, 0, 0]);
  assert.deepEqual(moverEvents[0]?.toOrigin, [0, 0, 2]);
  assert.deepEqual(moverEvents[1]?.fromOrigin, [0, 0, 2]);
  assert.deepEqual(moverEvents[1]?.toOrigin, [0, 0, 2]);
  assert.deepEqual(moverEvents[2]?.fromOrigin, [0, 0, 2]);
  assert.deepEqual(moverEvents[2]?.toOrigin, [0, 0, 0]);
  assert.deepEqual(moverEvents[3]?.fromOrigin, [0, 0, 0]);
  assert.deepEqual(moverEvents[3]?.toOrigin, [0, 0, 0]);
  assert.ok(moverEvents.every((event) => event.activation === "touch"));
  assert.ok(moverEvents.every((event) => event.targetEntityIndexes.length === 1));
});

test("loopback adapter accumulates room-owned fire damage before shootable func_button activation", async () => {
  let currentTime = 2893;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    trustedWorldDefinitions: testWorldDefinitions,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-button-shoot-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 500;
  session.send(createFireEnvelope({
    messageId: "loopback-button-shoot-1",
    sequence: 2,
    fireSequence: 1,
    sentAt: currentTime,
  }));
  let moverEvents = messages.filter((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.mover" &&
    message.payload.event.entityIndex === 212
  ).map((message) => message.payload.event);
  assert.equal(moverEvents.length, 0);

  currentTime += 500;
  session.send(createFireEnvelope({
    messageId: "loopback-button-shoot-2",
    sequence: 3,
    fireSequence: 2,
    sentAt: currentTime,
  }));

  currentTime += 500;
  session.send(createFireEnvelope({
    messageId: "loopback-button-shoot-3",
    sequence: 4,
    fireSequence: 3,
    sentAt: currentTime,
  }));

  moverEvents = messages.filter((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.mover" &&
    message.payload.event.entityIndex === 212
  ).map((message) => message.payload.event);
  assert.equal(moverEvents.length, 1);
  assert.equal(moverEvents[0]?.playerId, "loopback:client-a");
  assert.equal(moverEvents[0]?.classname, "func_button");
  assert.equal(moverEvents[0]?.activation, "shoot");
  assert.equal(moverEvents[0]?.state, "moving-up");
  assert.deepEqual(moverEvents[0]?.fromOrigin, [0, 0, -12]);
  assert.deepEqual(moverEvents[0]?.toOrigin, [0, 0, -10]);
  assert.deepEqual(moverEvents[0]?.targetEntityIndexes, [213]);
  assert.equal(moverEvents[0]?.soundPath, "buttons/switch21.wav");
  const targetEvents = messages.filter((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.targets"
  ).map((message) => message.payload.event)
    .filter((event) => event.sourceEntityIndex === 212);
  assert.equal(targetEvents.length, 1);
  assert.equal(targetEvents[0]?.sourceEventId, moverEvents[0]?.eventId);
  assert.deepEqual(targetEvents[0]?.targetEntityIndexes, [213]);
  assert.equal(localPlayerFromSnapshot(messages.at(-1)).inventory.shells, 22);
});

test("loopback adapter accumulates room-owned fire damage before shootable trigger activation", async () => {
  let currentTime = 2897;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    trustedWorldDefinitions: testShootableTriggerWorldDefinitions,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-trigger-shoot-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 500;
  session.send(createFireEnvelope({
    messageId: "loopback-trigger-shoot-1",
    sequence: 2,
    fireSequence: 1,
    sentAt: currentTime,
  }));
  let triggerEvents = messages.filter((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.trigger" &&
    message.payload.event.entityIndex === 218
  ).map((message) => message.payload.event);
  assert.equal(triggerEvents.length, 0);

  currentTime += 500;
  session.send(createFireEnvelope({
    messageId: "loopback-trigger-shoot-2",
    sequence: 3,
    fireSequence: 2,
    sentAt: currentTime,
  }));

  currentTime += 500;
  session.send(createFireEnvelope({
    messageId: "loopback-trigger-shoot-3",
    sequence: 4,
    fireSequence: 3,
    sentAt: currentTime,
  }));

  triggerEvents = messages.filter((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.trigger" &&
    message.payload.event.entityIndex === 218
  ).map((message) => message.payload.event);
  const triggerTargetEvents = messages.filter((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.targets" &&
    message.payload.event.sourceEntityIndex === 218
  ).map((message) => message.payload.event);
  assert.equal(triggerEvents.length, 1);
  assert.equal(triggerEvents[0]?.playerId, "loopback:client-a");
  assert.equal(triggerEvents[0]?.classname, "trigger_multiple");
  assert.equal(triggerEvents[0]?.activation, "shoot");
  assert.equal(triggerEvents[0]?.message, "shot trigger");
  assert.deepEqual(triggerEvents[0]?.targetEntityIndexes, [219]);
  assert.equal(triggerTargetEvents.length, 1);
  assert.equal(triggerTargetEvents[0]?.sourceEventId, triggerEvents[0]?.eventId);
  assert.deepEqual(triggerTargetEvents[0]?.targetEntityIndexes, [219]);
  assert.equal(localPlayerFromSnapshot(messages.at(-1)).inventory.shells, 22);
});

test("loopback adapter emits trusted touch trigger activations after wait windows", async () => {
  let currentTime = 2895;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    trustedWorldDefinitions: testWorldDefinitions,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-trigger-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 100;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-trigger",
    sequence: 2,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: currentTime,
      entityIndex: 82,
      origin: [0, 0, 0],
    },
  }));
  currentTime += 50;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-trigger-repeat",
    sequence: 3,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 2,
      requestedAt: currentTime,
      entityIndex: 82,
      origin: [0, 0, 0],
    },
  }));
  currentTime += 200;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-trigger-after-wait",
    sequence: 4,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 3,
      requestedAt: currentTime,
      entityIndex: 82,
      origin: [0, 0, 0],
    },
  }));

  const triggerEvents = messages.filter((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.trigger"
  ).map((message) => message.payload.event);
  const touchEvents = triggerEvents.filter((event) => event.activation === "touch");
  const targetTriggerEvents = triggerEvents.filter((event) => event.activation === "target");
  assert.equal(touchEvents.length, 2);
  assert.equal(touchEvents[0]?.playerId, "loopback:client-a");
  assert.equal(touchEvents[0]?.entityIndex, 82);
  assert.equal(touchEvents[0]?.classname, "trigger_multiple");
  assert.deepEqual(touchEvents[0]?.targetEntityIndexes, [201, 202, 206, 208]);
  assert.deepEqual(touchEvents[0]?.killtargetEntityIndexes, [203]);
  assert.equal(touchEvents[0]?.delayMs, 0);
  assert.equal(touchEvents[0]?.waitMs, 200);
  assert.equal(touchEvents[0]?.message, "triggered");
  assert.equal(touchEvents[0]?.soundPath, "misc/trigger1.wav");
  assert.equal(targetTriggerEvents.filter((event) => event.classname === "trigger_relay").length, 2);
  const onceEvents = targetTriggerEvents.filter((event) => event.entityIndex === 206);
  assert.equal(onceEvents.length, 1);
  assert.equal(onceEvents[0]?.classname, "trigger_once");
  assert.deepEqual(onceEvents[0]?.targetEntityIndexes, [207]);
  assert.equal(onceEvents[0]?.complete, true);
  assert.equal(onceEvents[0]?.message, "one-shot target");
  const counterEvents = targetTriggerEvents.filter((event) => event.classname === "trigger_counter");
  assert.equal(counterEvents.length, 2);
  assert.equal(counterEvents[0]?.remaining, 1);
  assert.equal(counterEvents[0]?.complete, false);
  assert.equal(counterEvents[0]?.message, "Only 1 more to go...");
  assert.equal(counterEvents[1]?.remaining, 0);
  assert.equal(counterEvents[1]?.complete, true);
  assert.equal(counterEvents[1]?.message, "Sequence completed!");
  const moverEvents = messages.filter((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.mover"
  ).map((message) => message.payload.event);
  assert.equal(moverEvents.length, 1);
  assert.equal(moverEvents[0]?.playerId, "loopback:client-a");
  assert.equal(moverEvents[0]?.entityIndex, 208);
  assert.equal(moverEvents[0]?.classname, "func_button");
  assert.equal(moverEvents[0]?.activation, "target");
  assert.equal(moverEvents[0]?.state, "moving-up");
  assert.deepEqual(moverEvents[0]?.fromOrigin, [0, 0, 0]);
  assert.deepEqual(moverEvents[0]?.toOrigin, [1, 0, 0]);
  assert.equal(moverEvents[0]?.speed, 40);
  assert.equal(moverEvents[0]?.moveMs, 0);
  assert.deepEqual(moverEvents[0]?.targetEntityIndexes, [209]);
  assert.equal(moverEvents[0]?.soundPath, "buttons/switch02.wav");
  const targetEvents = messages.filter((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.targets"
  ).map((message) => message.payload.event);
  assert.equal(targetEvents.length, 7);
  const sourceTargetEvents = targetEvents.filter((event) => event.sourceEntityIndex === 82);
  const relayTargetEvents = targetEvents.filter((event) => event.sourceEntityIndex === 201);
  const counterTargetEvents = targetEvents.filter((event) => event.sourceEntityIndex === 202);
  const onceTargetEvents = targetEvents.filter((event) => event.sourceEntityIndex === 206);
  const buttonTargetEvents = targetEvents.filter((event) => event.sourceEntityIndex === 208);
  assert.equal(sourceTargetEvents[0]?.sourceEventId, touchEvents[0]?.eventId);
  assert.equal(sourceTargetEvents[0]?.playerId, "loopback:client-a");
  assert.deepEqual(sourceTargetEvents[0]?.targetEntityIndexes, [201, 202, 206, 208]);
  assert.deepEqual(sourceTargetEvents[0]?.killtargetEntityIndexes, [203]);
  assert.equal(sourceTargetEvents[0]?.delayMs, 0);
  assert.equal(sourceTargetEvents[0]?.message, "triggered");
  assert.equal(sourceTargetEvents[0]?.soundPath, "misc/trigger1.wav");
  assert.deepEqual(relayTargetEvents[0]?.targetEntityIndexes, [204]);
  assert.deepEqual(counterTargetEvents[0]?.targetEntityIndexes, [205]);
  assert.equal(onceTargetEvents.length, 1);
  assert.deepEqual(onceTargetEvents[0]?.targetEntityIndexes, [207]);
  assert.equal(buttonTargetEvents.length, 1);
  assert.equal(buttonTargetEvents[0]?.sourceEventId, moverEvents[0]?.eventId);
  assert.deepEqual(buttonTargetEvents[0]?.targetEntityIndexes, [209]);
});

test("loopback adapter rejects touch triggers when the player faces the wrong way", async () => {
  let currentTime = 6040;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    trustedWorldDefinitions: testFacingTriggerWorldDefinitions,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-facing-trigger-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 10;
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-facing-trigger-wrong",
    sequence: 2,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 1,
      requestedAt: currentTime,
      entityIndex: 188,
      origin: [0, 0, 0],
    },
  }));

  currentTime += 100;
  session.send(createPoseEnvelope({
    messageId: "loopback-facing-trigger-pose",
    sequence: 3,
    poseSequence: 1,
    sentAt: currentTime,
    origin: [0, 0, 0],
    rotY: 180,
  }));
  session.send(createWorldIntentEnvelope({
    messageId: "loopback-facing-trigger-right",
    sequence: 4,
    sentAt: currentTime,
    intent: {
      intentType: "touch",
      worldSequence: 2,
      requestedAt: currentTime,
      entityIndex: 188,
      origin: [0, 0, 0],
    },
  }));

  const reject = messages.find((message) =>
    message.type === "room.reject" &&
    message.payload.rejectedMessageId === "loopback-facing-trigger-wrong"
  );
  const triggerEvent = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "world.trigger" &&
    message.payload.event.entityIndex === 188
  )?.payload.event;
  assert.equal(reject?.payload.details.reason, "wrong-facing");
  assert.equal(triggerEvent?.playerId, "loopback:client-a");
  assert.equal(triggerEvent?.activation, "touch");
});

test("loopback adapter derives fired weapon and kind from authoritative inventory", async () => {
  let currentTime = 2900;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-fire-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 500;
  session.send(createFireEnvelope({
    messageId: "loopback-fire-spoof-weapon",
    sequence: 2,
    fireSequence: 1,
    sentAt: currentTime,
    weapon: "rocketlauncher",
    fireKind: "projectile",
  }));

  const fireEvent = messages.findLast((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "player.fired"
  );
  assert.equal(fireEvent?.payload.event.weapon, "shotgun");
  assert.equal(fireEvent?.payload.event.fireKind, "hitscan");
  assert.equal(localPlayerFromSnapshot(messages.at(-1)).inventory.shells, 24);
});

test("loopback adapter applies QuakeC armor absorption before invulnerability blocks health damage", async () => {
  let currentTime = 2925;
  const invulnerableInventory = {
    ...createTestPlayer().inventory,
    health: 100,
    armor: 50,
    armorType: 0.6,
    itemFlags: 4097 | 8192 | 16384,
    powerups: [{
      active: true,
      activationField: "invincible_finished",
      finishedAt: currentTime + 30000,
      finishedField: "invincible_finished",
      itemFlag: 8192,
      itemFlagExpression: "IT_INVULNERABILITY",
    }],
  };
  const target = createTestPlayer({
    playerId: "loopback:target",
    clientId: "target",
    displayName: "Target",
    origin: [0, 0, -3.15],
    health: 100,
    armor: 50,
    inventory: invulnerableInventory,
  });
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    simulatedPlayers: () => [target],
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-armor-invuln-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 500;
  session.send(createFireEnvelope({
    messageId: "loopback-armor-invuln-fire",
    sequence: 2,
    fireSequence: 1,
    sentAt: currentTime,
  }));

  const damage = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "player.damaged" &&
    message.payload.event.victimPlayerId === "loopback:target"
  )?.payload.event;
  const snapshot = messages.findLast((message) => message.type === "room.snapshot");
  const snapshotTarget = snapshot?.payload.players
    .find((player) => player.playerId === "loopback:target");
  assert.equal(damage?.damage, 24);
  assert.equal(damage?.health, 100);
  assert.equal(damage?.armor, 35);
  assert.equal(snapshotTarget?.health, 100);
  assert.equal(snapshotTarget?.armor, 35);
  assert.equal(snapshotTarget?.inventory.armor, 35);
  assert.equal(snapshotTarget?.inventory.armorType, 0.6);
  assert.deepEqual(snapshotTarget?.velocity, [0, 0, -24 * 8 * QUAKE_COLLISION_UNIT_SCALE]);
});

test("loopback adapter rejects client-originated damage intents", async () => {
  let currentTime = 2950;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-damage-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 10;
  session.send(createDamageEnvelope({
    messageId: "loopback-client-damage",
    sequence: 2,
    damageSequence: 1,
    sentAt: currentTime,
    amount: 200,
  }));

  assert.equal(messages.at(-1)?.type, "room.reject");
  assert.equal(messages.at(-1)?.payload.code, "unsupported");
  assert.equal(messages.at(-1)?.payload.rejectedMessageId, "loopback-client-damage");
  assert.equal(messages.some((message) =>
    message.type === "room.event" &&
    (message.payload.event.eventType === "player.damaged" ||
      message.payload.event.eventType === "player.killed")
  ), false);
});

test("loopback adapter advances authoritative player pose from accepted input", async () => {
  let currentTime = 3000;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    simulationTickMs: 5,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "input-authority-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));
  const initialPlayer = localPlayerFromSnapshot(messages.at(-1));

  currentTime += 50;
  session.send(createInputEnvelope({
    messageId: "input-authority-1",
    sequence: 2,
    inputSequence: 1,
    sentAt: currentTime,
    move: { forward: 200, side: 0, up: 0 },
    rotY: 270,
  }));

  assert.equal(localPlayerFromSnapshot(messages.at(-1)).lastInputSequence, 0);
  await new Promise((resolve) => setTimeout(resolve, 15));
  const inputPlayer = localPlayerFromSnapshot(messages.at(-1));
  assert.notDeepEqual(inputPlayer.origin, initialPlayer.origin);
  assert.equal(inputPlayer.lastInputSequence, 1);

  currentTime += 50;
  session.send(createPoseEnvelope({
    messageId: "input-authority-pose",
    sequence: 3,
    poseSequence: 1,
    sentAt: currentTime,
    origin: [99, 98, 97],
  }));

  const posePlayer = localPlayerFromSnapshot(messages.at(-1));
  assert.deepEqual(posePlayer.origin, inputPlayer.origin);
});

test("loopback adapter pauses player input and mutation when presence is not active", async () => {
  let currentTime = 3100;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    simulationTickMs: 5,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-presence-pause-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));
  const initialPlayer = localPlayerFromSnapshot(messages.at(-1));

  currentTime += 50;
  session.send(createInputEnvelope({
    messageId: "loopback-presence-pause-input-1",
    sequence: 2,
    inputSequence: 1,
    sentAt: currentTime,
    move: { forward: 200, side: 0, up: 0 },
  }));
  await new Promise((resolve) => setTimeout(resolve, 15));
  const movedPlayer = localPlayerFromSnapshot(messages.at(-1));
  assert.notDeepEqual(movedPlayer.origin, initialPlayer.origin);
  assert.equal(movedPlayer.lastInputSequence, 1);

  currentTime += 100;
  session.send(createPresenceEnvelope({
    messageId: "loopback-presence-pause",
    sequence: 3,
    sentAt: currentTime,
    status: "input-paused",
  }));
  const presenceEvent = messages.findLast((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "player.presence"
  );
  assert.equal(presenceEvent?.payload.event.status, "input-paused");
  const pausedPlayer = localPlayerFromSnapshot(messages.findLast((message) => message.type === "room.snapshot"));

  currentTime += 50;
  session.send(createInputEnvelope({
    messageId: "loopback-presence-pause-input-2",
    sequence: 4,
    inputSequence: 2,
    sentAt: currentTime,
    move: { forward: 200, side: 0, up: 0 },
  }));
  await new Promise((resolve) => setTimeout(resolve, 15));
  const afterPausedInput = localPlayerFromSnapshot(messages.findLast((message) => message.type === "room.snapshot"));
  assert.deepEqual(afterPausedInput.origin, pausedPlayer.origin);
  assert.equal(afterPausedInput.lastInputSequence, 1);

  currentTime += 500;
  session.send(createFireEnvelope({
    messageId: "loopback-presence-pause-fire",
    sequence: 5,
    fireSequence: 1,
    sentAt: currentTime,
  }));
  assert.equal(messages.at(-1)?.type, "room.reject");
  assert.equal(messages.at(-1)?.payload.code, "unsupported");
  assert.equal(messages.at(-1)?.payload.message, "Multiplayer player input is paused.");
  assert.equal(messages.at(-1)?.payload.rejectedMessageId, "loopback-presence-pause-fire");
  session.disconnect("test-done");
});

test("loopback adapter emits movement snapshots on the room cadence", async () => {
  let currentTime = 5000;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: 5,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "cadence-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));
  const afterHelloCount = messages.length;

  currentTime += 100;
  session.send(createInputEnvelope({
    messageId: "cadence-input",
    sequence: 2,
    inputSequence: 1,
    sentAt: currentTime,
    move: { forward: 200, side: 0, up: 0 },
  }));
  assert.equal(messages.length, afterHelloCount);

  currentTime += 5;
  await new Promise((resolve) => setTimeout(resolve, 15));
  session.disconnect("test-done");

  assert.equal(messages.at(-1)?.type, "room.snapshot");
  assert.equal(localPlayerFromSnapshot(messages.at(-1)).lastInputSequence, 1);
});

test("loopback adapter records ping from room ping and client pong", async () => {
  let currentTime = 7000;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    heartbeatIntervalMs: 5,
    snapshotIntervalMs: false,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "heartbeat-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 5;
  await new Promise((resolve) => setTimeout(resolve, 15));
  const ping = messages.at(-1);
  assert.equal(ping?.type, "room.ping");

  currentTime += 42;
  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.pong",
    messageId: "heartbeat-pong",
    sequence: 2,
    sentAt: currentTime,
    roomKey,
    payload: {
      pingId: ping.payload.pingId,
      sentAt: currentTime,
      echoedSentAt: ping.payload.sentAt,
      responderTime: currentTime,
    },
  }));
  session.disconnect("test-done");

  const snapshot = messages.at(-1);
  assert.equal(snapshot?.type, "room.snapshot");
  assert.equal(localPlayerFromSnapshot(snapshot).pingMs, 42);
});

test("input advancement is horizontal and ignores unowned active weapon changes", () => {
  const player = {
    playerId: "loopback:client-a",
    clientId: "client-a",
    displayName: "Player",
    mapName: roomKey.mapName,
    origin: [0, 0, 7],
    velocity: [0, 0, 12],
    rotX: 90,
    rotY: 0,
    health: 100,
    armor: 0,
    activeWeapon: "shotgun",
    inventory: {
      health: 100,
      armor: 0,
      armorType: 0,
      activeWeapon: "shotgun",
      itemFlags: 4097,
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
    updatedAt: 1000,
  };
  const next = quakeMultiplayerAdvancePlayerWithInput(player, {
    inputSequence: 1,
    sampledAt: 1050,
    dt: 0.05,
    move: { forward: 200, side: 0, up: 0 },
    buttons: { attack: false, jump: true, use: false },
    rotX: 88,
    rotY: 270,
    activeWeapon: "rocketlauncher",
  }, { now: 1050 });
  assert.equal(next.origin[2], 7);
  assert.equal(next.velocity[2], 0);
  assert.equal(next.activeWeapon, "shotgun");
  assert.equal(next.lastInputSequence, 1);

  const rocketPlayer = {
    ...player,
    inventory: {
      ...player.inventory,
      weapons: [...player.inventory.weapons, "rocketlauncher"],
      rockets: 1,
    },
  };
  const selected = quakeMultiplayerAdvancePlayerWithInput(rocketPlayer, {
    inputSequence: 2,
    sampledAt: 1100,
    dt: 0.05,
    move: { forward: 0, side: 0, up: 0 },
    buttons: { attack: false, jump: false, use: false },
    rotX: 88,
    rotY: 270,
    activeWeapon: "RocketLauncher",
  }, { now: 1100 });
  assert.equal(selected.activeWeapon, "rocketlauncher");
  assert.equal(selected.inventory.activeWeapon, "rocketlauncher");

  const noAmmoPlayer = {
    ...rocketPlayer,
    inventory: {
      ...rocketPlayer.inventory,
      rockets: 0,
    },
  };
  const noAmmo = quakeMultiplayerAdvancePlayerWithInput(noAmmoPlayer, {
    inputSequence: 3,
    sampledAt: 1150,
    dt: 0.05,
    move: { forward: 0, side: 0, up: 0 },
    buttons: { attack: false, jump: false, use: false },
    rotX: 88,
    rotY: 270,
    activeWeapon: "rocketlauncher",
  }, { now: 1150 });
  assert.equal(noAmmo.activeWeapon, "shotgun");
  assert.equal(noAmmo.inventory.activeWeapon, "shotgun");
});

test("room simulation applies QuakeC liquid hazard cadence", () => {
  const player = createTestPlayer({
    origin: [0, 0, 32],
  });
  const lavaWorld = createFakeCollisionWorld([], {
    contentsAt: () => -5,
  });
  const slimeWorld = createFakeCollisionWorld([], {
    contentsAt: () => -4,
  });

  const lava = advanceQuakeMultiplayerRoomPlayerSimulation(
    player,
    createQuakeMultiplayerRoomPlayerSimulationState({
      playerId: player.playerId,
      now: 1000,
    }),
    {
      now: 1050,
      tickMs: 50,
      collisionWorld: lavaWorld,
      playerEyeHeight: 22,
    },
  );
  assert.equal(lava.hazardDamages.length, 1);
  assert.deepEqual(lava.hazardDamages[0], {
    damagedAt: 1050,
    damage: 30,
    kind: "lava",
    waterLevel: 3,
  });
  assert.equal(
    lava.state.nextLiquidDamageAt,
    1050 + QUAKE_MULTIPLAYER_LAVA_DAMAGE_INTERVAL_MS,
  );

  const beforeLavaReactivation = advanceQuakeMultiplayerRoomPlayerSimulation(
    lava.player,
    lava.state,
    {
      now: lava.state.nextLiquidDamageAt,
      tickMs: 50,
      collisionWorld: lavaWorld,
      playerEyeHeight: 22,
    },
  );
  assert.equal(beforeLavaReactivation.hazardDamages.length, 0);

  const afterLavaReactivation = advanceQuakeMultiplayerRoomPlayerSimulation(
    beforeLavaReactivation.player,
    beforeLavaReactivation.state,
    {
      now: lava.state.nextLiquidDamageAt + 50,
      tickMs: 50,
      collisionWorld: lavaWorld,
      playerEyeHeight: 22,
    },
  );
  assert.equal(afterLavaReactivation.hazardDamages.length, 1);
  assert.equal(afterLavaReactivation.hazardDamages[0].damage, 30);

  const radsuitLava = advanceQuakeMultiplayerRoomPlayerSimulation(
    player,
    createQuakeMultiplayerRoomPlayerSimulationState({
      playerId: player.playerId,
      now: 2000,
    }),
    {
      now: 2050,
      tickMs: 50,
      collisionWorld: lavaWorld,
      playerEyeHeight: 22,
      radsuitActive: true,
    },
  );
  assert.equal(radsuitLava.hazardDamages[0].damage, 30);
  assert.equal(
    radsuitLava.state.nextLiquidDamageAt,
    2050 + QUAKE_MULTIPLAYER_LIQUID_RADSUIT_DAMAGE_INTERVAL_MS,
  );

  const radsuitSlime = advanceQuakeMultiplayerRoomPlayerSimulation(
    player,
    createQuakeMultiplayerRoomPlayerSimulationState({
      playerId: player.playerId,
      now: 3000,
    }),
    {
      now: 3050,
      tickMs: 50,
      collisionWorld: slimeWorld,
      playerEyeHeight: 22,
      radsuitActive: true,
    },
  );
  assert.equal(radsuitSlime.hazardDamages.length, 0);
  assert.equal(radsuitSlime.state.nextLiquidDamageAt, undefined);

  const slime = advanceQuakeMultiplayerRoomPlayerSimulation(
    player,
    createQuakeMultiplayerRoomPlayerSimulationState({
      playerId: player.playerId,
      now: 4000,
    }),
    {
      now: 4050,
      tickMs: 50,
      collisionWorld: slimeWorld,
      playerEyeHeight: 22,
    },
  );
  assert.deepEqual(slime.hazardDamages[0], {
    damagedAt: 4050,
    damage: 12,
    kind: "slime",
    waterLevel: 3,
  });
  assert.equal(
    slime.state.nextLiquidDamageAt,
    4050 + QUAKE_MULTIPLAYER_SLIME_DAMAGE_INTERVAL_MS,
  );
});

test("room simulation applies QuakeC drowning cadence", () => {
  const player = createTestPlayer({
    origin: [0, 0, 32],
  });
  const waterWorld = createFakeCollisionWorld([], {
    contentsAt: () => -3,
  });
  const dryWorld = createFakeCollisionWorld([], {
    contentsAt: () => 0,
  });
  const initialState = createQuakeMultiplayerRoomPlayerSimulationState({
    playerId: player.playerId,
    now: 1000,
  });
  assert.equal(initialState.airFinishedAt, 1000 + QUAKE_MULTIPLAYER_DROWN_AIR_MS);
  assert.equal(initialState.drownDamage, QUAKE_MULTIPLAYER_DROWN_INITIAL_DAMAGE);

  const drown = advanceQuakeMultiplayerRoomPlayerSimulation(
    player,
    {
      ...initialState,
      airFinishedAt: 1000,
    },
    {
      now: 1050,
      tickMs: 50,
      collisionWorld: waterWorld,
      playerEyeHeight: 22,
    },
  );
  assert.deepEqual(drown.hazardDamages, [{
    damagedAt: 1050,
    damage: 4,
    kind: "drown",
    waterLevel: 3,
  }]);
  assert.equal(drown.state.drownDamage, 4);
  assert.equal(
    drown.state.drownPainFinishedAt,
    1050 + QUAKE_MULTIPLAYER_DROWN_DAMAGE_INTERVAL_MS,
  );

  const beforePainReactivation = advanceQuakeMultiplayerRoomPlayerSimulation(
    drown.player,
    drown.state,
    {
      now: drown.state.drownPainFinishedAt,
      tickMs: QUAKE_MULTIPLAYER_DROWN_DAMAGE_INTERVAL_MS,
      collisionWorld: waterWorld,
      playerEyeHeight: 22,
    },
  );
  assert.equal(beforePainReactivation.hazardDamages.length, 0);

  const afterPainReactivation = advanceQuakeMultiplayerRoomPlayerSimulation(
    beforePainReactivation.player,
    beforePainReactivation.state,
    {
      now: beforePainReactivation.state.drownPainFinishedAt + 1000,
      tickMs: QUAKE_MULTIPLAYER_DROWN_DAMAGE_INTERVAL_MS,
      collisionWorld: waterWorld,
      playerEyeHeight: 22,
    },
  );
  assert.deepEqual(afterPainReactivation.hazardDamages, [{
    damagedAt: beforePainReactivation.state.drownPainFinishedAt + 1000,
    damage: 6,
    kind: "drown",
    waterLevel: 3,
  }]);
  assert.equal(afterPainReactivation.state.drownDamage, 6);

  const reset = advanceQuakeMultiplayerRoomPlayerSimulation(
    afterPainReactivation.player,
    {
      ...afterPainReactivation.state,
      nextLiquidDamageAt: 99999,
    },
    {
      now: afterPainReactivation.state.lastSimulatedAt + 50,
      tickMs: 50,
      collisionWorld: dryWorld,
      playerEyeHeight: 22,
    },
  );
  assert.equal(reset.hazardDamages.length, 0);
  assert.equal(reset.state.drownDamage, QUAKE_MULTIPLAYER_DROWN_INITIAL_DAMAGE);
  assert.equal(reset.state.airFinishedAt, reset.state.lastSimulatedAt + QUAKE_MULTIPLAYER_DROWN_AIR_MS);
  assert.equal(reset.state.nextLiquidDamageAt, undefined);
});

test("room simulation applies QuakeC WaterMove velocity damping", () => {
  const player = createTestPlayer({
    origin: [0, 0, 32],
    velocity: [10, -5, 2],
  });
  const waterWorld = createFakeCollisionWorld([], {
    contentsAt: () => -3,
  });
  const dryWorld = createFakeCollisionWorld([], {
    contentsAt: () => 0,
  });
  const damped = advanceQuakeMultiplayerRoomPlayerSimulation(
    player,
    createQuakeMultiplayerRoomPlayerSimulationState({
      playerId: player.playerId,
      now: 1000,
    }),
    {
      now: 1050,
      tickMs: 50,
      collisionWorld: waterWorld,
      playerEyeHeight: 22,
    },
  );
  const scale = 1 - QUAKE_MULTIPLAYER_WATER_VELOCITY_DAMPING * 3 * 0.05;
  assert.deepEqual(damped.player.velocity, [
    player.velocity[0] * scale,
    player.velocity[1] * scale,
    player.velocity[2] * scale,
  ]);
  assert.equal(damped.player.updatedAt, 1050);

  const dry = advanceQuakeMultiplayerRoomPlayerSimulation(
    player,
    createQuakeMultiplayerRoomPlayerSimulationState({
      playerId: player.playerId,
      now: 2000,
    }),
    {
      now: 2050,
      tickMs: 50,
      collisionWorld: dryWorld,
      playerEyeHeight: 22,
    },
  );
  assert.deepEqual(dry.player.velocity, player.velocity);

  const noContents = advanceQuakeMultiplayerRoomPlayerSimulation(
    player,
    createQuakeMultiplayerRoomPlayerSimulationState({
      playerId: player.playerId,
      now: 3000,
    }),
    {
      now: 3050,
      tickMs: 50,
      collisionWorld: null,
      playerEyeHeight: 22,
    },
  );
  assert.deepEqual(noContents.player.velocity, player.velocity);
});

test("local reconciliation snaps or blends newer authoritative input beyond thresholds", () => {
  const authoritative = createTestPlayer({
    origin: [10, 0, 0],
    lastInputSequence: 7,
  });
  assert.deepEqual(decideQuakeMultiplayerLocalCorrection(
    [0, 0, 0],
    { ...authoritative, lastInputSequence: 0 },
    0,
    { hardSnapDistance: 4 },
  ), {
    action: "none",
    reason: "no-authoritative-input",
    drift: 10,
    inputSequence: 0,
  });
  assert.deepEqual(decideQuakeMultiplayerLocalCorrection(
    [0, 0, 0],
    authoritative,
    7,
    { hardSnapDistance: 4 },
  ), {
    action: "none",
    reason: "already-handled",
    drift: 10,
    inputSequence: 7,
  });
  assert.deepEqual(decideQuakeMultiplayerLocalCorrection(
    [9, 0, 0],
    authoritative,
    6,
    { hardSnapDistance: 4 },
  ), {
    action: "none",
    reason: "within-threshold",
    drift: 1,
    inputSequence: 7,
  });
  assert.deepEqual(decideQuakeMultiplayerLocalCorrection(
    [0, 0, 0],
    authoritative,
    6,
    { hardSnapDistance: 4 },
  ), {
    action: "snap",
    reason: "drift",
    drift: 10,
    inputSequence: 7,
    origin: [10, 0, 0],
  });
  assert.deepEqual(decideQuakeMultiplayerLocalCorrection(
    [2, 0, 0],
    authoritative,
    6,
    {
      hardSnapDistance: 10,
      softCorrectionDistance: 1,
      blendFraction: 0.25,
      maxBlendDistance: 2,
    },
  ), {
    action: "blend",
    reason: "drift",
    drift: 8,
    inputSequence: 7,
    origin: [4, 0, 0],
    authoritativeOrigin: [10, 0, 0],
  });
});

test("loopback adapter derives fire origin and direction from authoritative player pose", async () => {
  let currentTime = 4000;
  const target = createTestPlayer({
    playerId: "loopback:target",
    clientId: "target",
    displayName: "Target",
    origin: [5, 0, 0],
  });
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    simulatedPlayers: () => [target],
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "fire-authority-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
    },
  }));

  currentTime += 500;
  const beforeFireCount = messages.length;
  session.send(createFireEnvelope({
    messageId: "fire-authority-spoof",
    sequence: 2,
    fireSequence: 1,
    sentAt: currentTime,
    origin: [5, 0, -0.85],
    direction: [1, 0, 0],
  }));
  const fireMessages = messages.slice(beforeFireCount);
  const fireEvent = fireMessages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "player.fired"
  );
  assert.ok(fireEvent);
  assert.deepEqual(fireEvent.payload.event.origin, [0, 0, 0]);
  assert.ok(Math.abs(fireEvent.payload.event.direction[0]) < 1e-12);
  assert.ok(Math.abs(fireEvent.payload.event.direction[1]) < 1e-12);
  assert.ok(Math.abs(fireEvent.payload.event.direction[2] + 1) < 1e-12);
  assert.equal(fireMessages.some((message) =>
    message.type === "room.event" &&
    (message.payload.event.eventType === "player.damaged" ||
      message.payload.event.eventType === "player.killed")
  ), false);
});

test("loopback adapter applies projectile splash damage to the attacker", async () => {
  let currentTime = 4300;
  const rocketPickupDefinitions = [{
    pickupId: "rocketlauncher",
    entityIndex: 91,
    classname: "weapon_rocketlauncher",
    origin: [0, 0, 0],
    effect: {
      weapon: { id: "rocketlauncher", select: true },
      rockets: 5,
    },
    lifecycle: { action: "leave", condition: "deathmatch" },
  }];
  const target = createTestPlayer({
    playerId: "loopback:target",
    clientId: "target",
    displayName: "Target",
    origin: [0, 0, -3.15],
  });
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    simulatedPlayers: () => [target],
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-splash-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: createQuakeMultiplayerGameplayFacts({
        pickupDefinitions: rocketPickupDefinitions,
      }),
      pickupDefinitions: rocketPickupDefinitions,
    },
  }));

  currentTime += 50;
  session.send(createPickupEnvelope({
    entityIndex: 91,
    messageId: "loopback-rocket-pickup",
    pickupSequence: 1,
    sequence: 2,
    sentAt: currentTime,
  }));
  assert.equal(localPlayerFromSnapshot(messages.at(-1)).activeWeapon, "rocketlauncher");

  currentTime += 500;
  session.send(createFireEnvelope({
    messageId: "loopback-splash-fire",
    sequence: 3,
    fireSequence: 1,
    sentAt: currentTime,
  }));

  const killed = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "player.killed" &&
    message.payload.event.victimPlayerId === "loopback:target"
  );
  const selfDamage = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "player.damaged" &&
    message.payload.event.victimPlayerId === "loopback:client-a"
  );
  const snapshot = messages.at(-1);
  const localPlayer = localPlayerFromSnapshot(snapshot);
  assert.equal(killed?.payload.event.attackerPlayerId, "loopback:client-a");
  assert.equal(selfDamage?.payload.event.damage, 30);
  assert.equal(selfDamage?.payload.event.health, 70);
  assert.equal(localPlayer.health, 70);
  assert.equal(localPlayer.frags, 1);
  assert.equal(localPlayer.inventory.rockets, 4);
  assert.equal(snapshot.payload.players.find((player) => player.playerId === "loopback:target")?.alive, false);
});

test("loopback adapter applies source-backed underwater lightning discharge", async () => {
  let currentTime = 4350;
  const lightningPickupDefinitions = [{
    pickupId: "lightning",
    entityIndex: 92,
    classname: "weapon_lightning",
    origin: [0, 0, 0],
    effect: {
      weapon: { id: "lightning", select: true },
      cells: 4,
    },
    lifecycle: { action: "leave", condition: "deathmatch" },
  }];
  const target = createTestPlayer({
    playerId: "loopback:target",
    clientId: "target",
    displayName: "Target",
    origin: [0, 0, 0.85],
  });
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    simulatedPlayers: () => [target],
    trustedSceneMovement: {
      collisionWorld: createFakeCollisionWorld([], {
        contentsAt: () => -3,
      }),
      playerEyeHeight: 22,
    },
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-lightning-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: createQuakeMultiplayerGameplayFacts({
        pickupDefinitions: lightningPickupDefinitions,
      }),
      pickupDefinitions: lightningPickupDefinitions,
    },
  }));

  currentTime += 50;
  session.send(createPickupEnvelope({
    entityIndex: 92,
    messageId: "loopback-lightning-pickup",
    pickupSequence: 1,
    sequence: 2,
    sentAt: currentTime,
  }));
  assert.equal(localPlayerFromSnapshot(messages.at(-1)).activeWeapon, "lightning");

  currentTime += 500;
  session.send(createFireEnvelope({
    messageId: "loopback-lightning-fire",
    sequence: 3,
    fireSequence: 1,
    sentAt: currentTime,
    weapon: "shotgun",
    fireKind: "hitscan",
  }));

  const expectedSelfDamage = (140 - 0.5 * (0.85 / QUAKE_COLLISION_UNIT_SCALE)) * 0.5;
  const expectedSelfHealth = 100 - Math.ceil(expectedSelfDamage);
  const killed = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "player.killed" &&
    message.payload.event.victimPlayerId === "loopback:target"
  );
  const selfDamage = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "player.damaged" &&
    message.payload.event.victimPlayerId === "loopback:client-a"
  );
  const snapshot = messages.at(-1);
  const localPlayer = localPlayerFromSnapshot(snapshot);
  assert.equal(killed?.payload.event.attackerPlayerId, "loopback:client-a");
  assert.equal(killed?.payload.event.damageSource, "lightning-discharge");
  assert.ok(Math.abs((selfDamage?.payload.event.damage ?? 0) - expectedSelfDamage) < 1e-9);
  assert.equal(selfDamage?.payload.event.damageSource, "lightning-discharge");
  assert.equal(localPlayer.health, expectedSelfHealth);
  assert.equal(localPlayer.frags, 1);
  assert.equal(localPlayer.inventory.cells, 0);
  assert.equal(snapshot.payload.players.find((player) => player.playerId === "loopback:target")?.alive, false);
});

test("loopback adapter subtracts a frag for room-owned self kills", async () => {
  let currentTime = 4400;
  const rocketPickupDefinitions = [{
    pickupId: "rocketlauncher-self",
    entityIndex: 94,
    classname: "weapon_rocketlauncher",
    origin: [0, 0, 0],
    effect: {
      weapon: { id: "rocketlauncher", select: true },
      rockets: 5,
    },
    lifecycle: { action: "leave", condition: "deathmatch" },
  }];
  const durableInventory = {
    ...createTestPlayer().inventory,
    health: 200,
  };
  const target = createTestPlayer({
    playerId: "loopback:target",
    clientId: "target",
    displayName: "Target",
    origin: [0, 0, 0],
    health: 200,
    inventory: durableInventory,
  });
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    simulatedPlayers: () => [target],
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-self-kill-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      gameplayFacts: createQuakeMultiplayerGameplayFacts({
        pickupDefinitions: rocketPickupDefinitions,
      }),
      pickupDefinitions: rocketPickupDefinitions,
    },
  }));

  currentTime += 50;
  session.send(createPickupEnvelope({
    entityIndex: 94,
    messageId: "loopback-self-kill-pickup",
    pickupSequence: 1,
    sequence: 2,
    sentAt: currentTime,
  }));

  currentTime += 500;
  session.send(createFireEnvelope({
    messageId: "loopback-self-kill-fire",
    sequence: 3,
    fireSequence: 1,
    sentAt: currentTime,
  }));

  const killEvent = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "player.killed" &&
    message.payload.event.victimPlayerId === "loopback:client-a"
  );
  const damageEvent = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "player.damaged" &&
    message.payload.event.victimPlayerId === "loopback:target"
  );
  const snapshot = messages.at(-1);
  const localPlayer = localPlayerFromSnapshot(snapshot);
  assert.equal(killEvent?.payload.event.attackerPlayerId, "loopback:client-a");
  assert.equal(damageEvent?.payload.event.health, 80);
  assert.equal(localPlayer.frags, -1);
  assert.equal(localPlayer.deaths, 1);
  assert.equal(localPlayer.alive, false);
  assert.equal(snapshot.payload.players.find((player) => player.playerId === "loopback:target")?.alive, true);
});

test("loopback adapter enters intermission when frag limit is reached", async () => {
  let currentTime = 4500;
  const lowHealthInventory = {
    ...createTestPlayer().inventory,
    health: 20,
  };
  const target = createTestPlayer({
    playerId: "loopback:target",
    clientId: "target",
    displayName: "Target",
    origin: [0, 0, -3.15],
    health: 20,
    inventory: lowHealthInventory,
  });
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    simulatedPlayers: () => [target],
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-frag-limit-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      matchSettings: { fragLimit: 1 },
    },
  }));

  currentTime += 500;
  session.send(createFireEnvelope({
    messageId: "loopback-frag-limit-fire",
    sequence: 2,
    fireSequence: 1,
    sentAt: currentTime,
  }));

  const killEvent = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "player.killed"
  );
  const matchNotice = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "match.notice"
  );
  const snapshot = messages.at(-1);
  assert.equal(killEvent?.payload.event.attackerPlayerId, "loopback:client-a");
  assert.equal(matchNotice?.payload.event.code, "frag-limit");
  assert.equal(snapshot?.type, "room.snapshot");
  assert.equal(snapshot?.payload.match.status, "intermission");
  assert.equal(localPlayerFromSnapshot(snapshot).frags, 1);
  assert.equal(snapshot.payload.players.find((player) => player.playerId === "loopback:target")?.alive, false);

  currentTime += 500;
  session.send(createFireEnvelope({
    messageId: "loopback-frag-limit-late-fire",
    sequence: 3,
    fireSequence: 2,
    sentAt: currentTime,
  }));
  assert.equal(messages.at(-1)?.type, "room.reject");
  assert.equal(messages.at(-1)?.payload.code, "unsupported");
  assert.equal(messages.at(-1)?.payload.rejectedMessageId, "loopback-frag-limit-late-fire");
});

test("loopback adapter enters intermission when time limit is reached", async () => {
  let currentTime = 6000;
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-time-limit-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      matchSettings: { timeLimitMs: 100 },
    },
  }));

  currentTime += 150;
  session.send(createFireEnvelope({
    messageId: "loopback-time-limit-fire",
    sequence: 2,
    fireSequence: 1,
    sentAt: currentTime,
  }));

  const matchNotice = messages.find((message) =>
    message.type === "room.event" &&
    message.payload.event.eventType === "match.notice"
  );
  const snapshot = messages.findLast((message) => message.type === "room.snapshot");
  assert.equal(matchNotice?.payload.event.code, "time-limit");
  assert.equal(snapshot?.payload.match.status, "intermission");
  assert.equal(messages.at(-1)?.type, "room.reject");
  assert.equal(messages.at(-1)?.payload.code, "unsupported");
  assert.equal(messages.at(-1)?.payload.rejectedMessageId, "loopback-time-limit-fire");
});

test("loopback adapter can restart a match after intermission", async () => {
  let currentTime = 7000;
  const lowHealthInventory = {
    ...createTestPlayer().inventory,
    health: 20,
  };
  const target = createTestPlayer({
    playerId: "loopback:target",
    clientId: "target",
    displayName: "Target",
    origin: [0, 0, -3.15],
    health: 20,
    inventory: lowHealthInventory,
  });
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    simulatedPlayers: () => [target],
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-restart-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      matchSettings: { fragLimit: 1, restartDelayMs: 1 },
    },
  }));

  currentTime += 500;
  session.send(createFireEnvelope({
    messageId: "loopback-restart-fire",
    sequence: 2,
    fireSequence: 1,
    sentAt: currentTime,
  }));
  assert.equal(messages.at(-1)?.payload.match.status, "intermission");

  currentTime += 10;
  await waitMs(10);

  const restartNotice = messages
    .filter((message) =>
      message.type === "room.event" &&
      message.payload.event.eventType === "match.notice" &&
      message.payload.event.code === "restart"
    )
    .at(-1);
  const snapshot = messages.findLast((message) => message.type === "room.snapshot");
  const localPlayer = localPlayerFromSnapshot(snapshot);
  const restartedTarget = snapshot?.payload.players.find((player) => player.playerId === "loopback:target");
  assert.equal(restartNotice?.payload.event.message, "Match restarted.");
  assert.equal(snapshot?.payload.match.status, "active");
  assert.equal(localPlayer.frags, 0);
  assert.equal(localPlayer.deaths, 0);
  assert.equal(localPlayer.alive, true);
  assert.equal(restartedTarget?.frags, 0);
  assert.equal(restartedTarget?.deaths, 0);
  assert.equal(restartedTarget?.alive, true);
});

test("loopback adapter can manually restart a match during intermission", async () => {
  let currentTime = 8000;
  const lowHealthInventory = {
    ...createTestPlayer().inventory,
    health: 20,
  };
  const target = createTestPlayer({
    playerId: "loopback:target",
    clientId: "target",
    displayName: "Target",
    origin: [0, 0, -3.15],
    health: 20,
    inventory: lowHealthInventory,
  });
  const messages = [];
  const session = createQuakeLoopbackMultiplayerSession({
    asyncDispatch: false,
    now: () => currentTime,
    snapshotIntervalMs: false,
    simulatedPlayers: () => [target],
  });
  session.subscribe((message) => messages.push(message));

  await session.connect({
    roomKey,
    clientId: "client-a",
    displayName: "Player",
  });

  session.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    messageId: "loopback-manual-restart-hello",
    sequence: 1,
    sentAt: currentTime,
    roomKey,
    payload: {
      clientId: "client-a",
      displayName: "Player",
      matchSettings: { fragLimit: 1 },
    },
  }));

  currentTime += 100;
  session.send(createMatchEnvelope({
    messageId: "loopback-manual-restart-active",
    sequence: 2,
    sentAt: currentTime,
    matchSequence: 1,
  }));
  assert.equal(messages.at(-1)?.type, "room.reject");
  assert.equal(messages.at(-1)?.payload.rejectedMessageId, "loopback-manual-restart-active");

  currentTime += 400;
  session.send(createFireEnvelope({
    messageId: "loopback-manual-restart-fire",
    sequence: 3,
    fireSequence: 1,
    sentAt: currentTime,
  }));
  assert.equal(messages.at(-1)?.payload.match.status, "intermission");

  currentTime += 100;
  session.send(createMatchEnvelope({
    messageId: "loopback-manual-restart",
    sequence: 4,
    sentAt: currentTime,
    matchSequence: 2,
  }));

  const restartNotice = messages
    .filter((message) =>
      message.type === "room.event" &&
      message.payload.event.eventType === "match.notice" &&
      message.payload.event.code === "restart"
    )
    .at(-1);
  const snapshot = messages.findLast((message) => message.type === "room.snapshot");
  const localPlayer = localPlayerFromSnapshot(snapshot);
  const restartedTarget = snapshot?.payload.players.find((player) => player.playerId === "loopback:target");
  assert.equal(restartNotice?.payload.event.message, "Match restarted.");
  assert.equal(snapshot?.payload.match.status, "active");
  assert.equal(localPlayer.frags, 0);
  assert.equal(localPlayer.alive, true);
  assert.equal(restartedTarget?.alive, true);
});

function createPresenceEnvelope({
  clientId = "client-a",
  messageId = "presence",
  sequence,
  sentAt,
  status = "active",
}) {
  return createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.presence",
    messageId,
    sequence,
    sentAt,
    roomKey,
    payload: {
      clientId,
      status,
    },
  });
}

function createPoseEnvelope({
  clientId = "client-a",
  messageId = "pose",
  sequence,
  poseSequence,
  sentAt,
  origin = [1, 2, 3],
  rotX = 90,
  rotY = 270,
}) {
  return createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.pose",
    messageId,
    sequence,
    sentAt,
    roomKey,
    payload: {
      clientId,
      prototypeOnly: true,
      pose: {
        poseSequence,
        sampledAt: sentAt,
        origin,
        velocity: [0, 0, 0],
        rotX,
        rotY,
        grounded: true,
        alive: true,
      },
    },
  });
}

function createInputEnvelope({
  clientId = "client-a",
  messageId = "input",
  sequence,
  inputSequence,
  sentAt,
  move = { forward: 0, side: 0, up: 0 },
  rotX = 90,
  rotY = 270,
  activeWeapon,
}) {
  return createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.input",
    messageId,
    sequence,
    sentAt,
    roomKey,
    payload: {
      clientId,
      input: {
        inputSequence,
        sampledAt: sentAt,
        dt: 0.05,
        move,
        buttons: { attack: false, jump: false, use: false },
        rotX,
        rotY,
        ...(activeWeapon ? { activeWeapon } : {}),
      },
    },
  });
}

function createPickupEnvelope({
  clientId = "client-a",
  entityIndex,
  messageId = "pickup",
  pickupSequence,
  sequence,
  sentAt,
}) {
  return createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.pickup",
    messageId,
    sequence,
    sentAt,
    roomKey,
    payload: {
      clientId,
      pickup: {
        pickupSequence,
        requestedAt: sentAt,
        entityIndex,
      },
    },
  });
}

function createMatchEnvelope({
  clientId = "client-a",
  messageId = "match",
  sequence,
  matchSequence,
  sentAt,
  action = "restart",
}) {
  return createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.match",
    messageId,
    sequence,
    sentAt,
    roomKey,
    payload: {
      clientId,
      match: {
        matchSequence,
        requestedAt: sentAt,
        action,
      },
    },
  });
}

function createDamageEnvelope({
  clientId = "client-a",
  messageId = "damage",
  sequence,
  damageSequence,
  sentAt,
  amount,
  source = "test",
}) {
  return createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.damage",
    messageId,
    sequence,
    sentAt,
    roomKey,
    payload: {
      clientId,
      damage: {
        damageSequence,
        damagedAt: sentAt,
        amount,
        source,
      },
    },
  });
}

function createFireEnvelope({
  clientId = "client-a",
  messageId = "fire",
  sequence,
  fireSequence,
  sentAt,
  weapon = "shotgun",
  fireKind = "hitscan",
  origin = [0, 0, 0],
  direction = [1, 0, 0],
  range = 64,
}) {
  return createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.fire",
    messageId,
    sequence,
    sentAt,
    roomKey,
    payload: {
      clientId,
      fire: {
        fireSequence,
        firedAt: sentAt,
        weapon,
        fireKind,
        origin,
        direction,
        range,
      },
    },
  });
}

function createWorldEnvelope({
  clientId = "client-a",
  messageId = "world",
  sequence,
  sentAt,
  change,
  entityIndex,
  data = {},
}) {
  return createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.world",
    messageId,
    sequence,
    sentAt,
    roomKey,
    payload: {
      clientId,
      event: {
        eventType: "world.changed",
        eventId: `world-${messageId}`,
        roomTime: 0,
        entityIndex,
        change,
        data,
      },
    },
  });
}

function createWorldIntentEnvelope({
  clientId = "client-a",
  messageId = "world-intent",
  sequence,
  sentAt,
  intent,
}) {
  return createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.world",
    messageId,
    sequence,
    sentAt,
    roomKey,
    payload: {
      clientId,
      intent,
    },
  });
}

function localPlayerFromSnapshot(message) {
  assert.equal(message?.type, "room.snapshot");
  const player = message.payload.players.find((candidate) => candidate.clientId === "client-a");
  assert.ok(player);
  return player;
}

function pickupFromSnapshot(message, entityIndex) {
  assert.equal(message?.type, "room.snapshot");
  const pickup = message.payload.pickups.find((candidate) => candidate.entityIndex === entityIndex);
  assert.ok(pickup);
  return pickup;
}

function partyRoomEvents(fakeRoom, eventType) {
  return fakeRoom.broadcasts
    .filter((message) => message.type === "room.event" && message.payload.event.eventType === eventType)
    .map((message) => message.payload.event);
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFakeCollisionWorld(offsetWrites = [], options = {}) {
  return {
    floorAt() {
      return 0;
    },
    ...(options.contentsAt ? { contentsAt: options.contentsAt } : {}),
    staticFloorAt() {
      return 0;
    },
    resolve(origin) {
      return {
        origin,
        groundZ: 0,
        grounded: true,
      };
    },
    setBrushOffset(entityIndex, offset) {
      offsetWrites.push({ entityIndex, offset: [...offset] });
    },
  };
}

function createFakePartyRoom(id = "party-test", options = {}) {
  const connections = new Map();
  return {
    id,
    ...(options.assets ? { context: { assets: options.assets } } : {}),
    broadcasts: [],
    addConnection(connection) {
      connections.set(connection.id, connection);
    },
    removeConnection(connection) {
      connections.delete(connection.id);
    },
    getConnections() {
      return [...connections.values()];
    },
    getConnection(connectionId) {
      return connections.get(connectionId);
    },
    broadcast(message, without = []) {
      const envelope = JSON.parse(message);
      this.broadcasts.push(envelope);
      const omitted = new Set(without);
      for (const connection of connections.values()) {
        if (!omitted.has(connection.id)) connection.send(message);
      }
    },
  };
}

function createFakePartyConnection(id) {
  return {
    id,
    state: null,
    sent: [],
    closed: null,
    send(message) {
      this.sent.push(JSON.parse(message));
    },
    setState(nextState) {
      this.state = nextState;
    },
    close(code, reason) {
      this.closed = { code, reason };
    },
  };
}

function createTestPlayer(overrides = {}) {
  return {
    playerId: "loopback:test",
    clientId: "test",
    displayName: "Test",
    mapName: roomKey.mapName,
    origin: [0, 0, 0],
    velocity: [0, 0, 0],
    rotX: 90,
    rotY: 270,
    health: 100,
    armor: 0,
    activeWeapon: "shotgun",
    inventory: {
      health: 100,
      armor: 0,
      armorType: 0,
      activeWeapon: "shotgun",
      itemFlags: 4097,
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
    updatedAt: 1000,
    ...overrides,
  };
}
