import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const constants = await importTsModule("src/runtime/constants.ts");
const hazards = await importTsModule("src/runtime/hazards.ts");
const physics = await importTsModule("src/runtime/playerPhysics.ts");
const simulation = await importTsModule("src/runtime/multiplayer/simulation.ts");

const SCALE = constants.QUAKE_COLLISION_UNIT_SCALE;
const EYE_HEIGHT = (constants.QUAKE_PLAYER_VIEW_Z - constants.QUAKE_PLAYER_MINS_Z);

test("fall damage follows Quake PlayerPostThink velocity thresholds", () => {
  assert.equal(physics.quakePlayerFallDamageFromVelocityZ(-299 * SCALE), 0);
  assert.equal(physics.quakePlayerFallDamageFromVelocityZ(-300 * SCALE), 0);
  assert.equal(physics.quakePlayerFallDamageFromVelocityZ(-301 * SCALE), 0);
  assert.equal(physics.quakePlayerFallDamageFromVelocityZ(-650 * SCALE), 0);
  assert.equal(physics.quakePlayerFallDamageFromVelocityZ(-651 * SCALE), 5);
});

test("authoritative multiplayer simulation emits fall damage when landing fast", () => {
  const player = createPlayer({
    origin: [0, 0, EYE_HEIGHT + 0.01],
    velocity: [0, 0, -651 * SCALE],
  });
  const state = simulation.createQuakeMultiplayerRoomPlayerSimulationState({
    playerId: player.playerId,
    now: 0,
    grounded: false,
    floorZ: 0,
  });

  const result = simulation.advanceQuakeMultiplayerRoomPlayerSimulation(player, state, {
    now: 50,
    tickMs: 50,
    collisionWorld: createFlatCollisionWorld(),
    playerEyeHeight: EYE_HEIGHT,
  });

  assert.deepEqual(result.hazardDamages.map(({ damage, kind, waterLevel }) => ({ damage, kind, waterLevel })), [
    { damage: 5, kind: "fall", waterLevel: 0 },
  ]);
  assert.equal(result.state.grounded, true);
  assert.equal(result.state.fallVelocityZ, undefined);
});

test("authoritative multiplayer fall damage is blocked by water", () => {
  const player = createPlayer({
    origin: [0, 0, EYE_HEIGHT + 0.01],
    velocity: [0, 0, -651 * SCALE],
  });
  const state = simulation.createQuakeMultiplayerRoomPlayerSimulationState({
    playerId: player.playerId,
    now: 0,
    grounded: false,
    floorZ: 0,
  });

  const result = simulation.advanceQuakeMultiplayerRoomPlayerSimulation(player, state, {
    now: 50,
    tickMs: 50,
    collisionWorld: createFlatCollisionWorld({ contents: hazards.QUAKE_CONTENTS_WATER }),
    playerEyeHeight: EYE_HEIGHT,
  });

  assert.deepEqual(result.hazardDamages, []);
  assert.equal(result.state.grounded, true);
  assert.equal(result.state.fallVelocityZ, undefined);
});

test("authoritative multiplayer grounded descent does not emit fall damage", () => {
  const player = createPlayer({
    origin: [0, 0, EYE_HEIGHT],
    velocity: [320 * SCALE, 0, -900 * SCALE],
  });
  const state = simulation.createQuakeMultiplayerRoomPlayerSimulationState({
    playerId: player.playerId,
    now: 0,
    grounded: true,
    floorZ: 0,
  });

  const result = simulation.advanceQuakeMultiplayerRoomPlayerSimulation(player, state, {
    now: 50,
    tickMs: 50,
    collisionWorld: createFlatCollisionWorld(),
    playerEyeHeight: EYE_HEIGHT,
  });

  assert.deepEqual(result.hazardDamages, []);
  assert.equal(result.state.grounded, true);
  assert.equal(result.state.fallVelocityZ, undefined);
});

function createPlayer(overrides = {}) {
  return {
    playerId: "player-1",
    clientId: "client-1",
    displayName: "Player",
    mapName: "e1m1",
    origin: [0, 0, EYE_HEIGHT],
    velocity: [0, 0, 0],
    rotX: 0,
    rotY: 0,
    health: 100,
    armor: 0,
    activeWeapon: "shotgun",
    alive: true,
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
    lastInputSequence: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function createFlatCollisionWorld(options = {}) {
  return {
    contentsAt: () => options.contents ?? null,
    floorAt: () => 0,
    resolve: (target) => {
      if (target[2] <= EYE_HEIGHT) {
        return {
          origin: [target[0], target[1], EYE_HEIGHT],
          groundZ: 0,
          grounded: true,
        };
      }
      return {
        origin: target,
        groundZ: 0,
        grounded: false,
      };
    },
  };
}
