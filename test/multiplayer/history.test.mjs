import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const history = await importTsModule("src/runtime/multiplayer/history.ts");

function playerFixture(overrides = {}) {
  return {
    playerId: "player",
    clientId: "client",
    displayName: "Player",
    mapName: "e1m7",
    spawnId: "spawn-a",
    origin: [0, 0, 0],
    velocity: [0, 0, 0],
    rotX: 90,
    rotY: 270,
    health: 100,
    armor: 0,
    activeWeapon: "shotgun",
    alive: true,
    frags: 0,
    deaths: 0,
    lastInputSequence: 0,
    updatedAt: 0,
    ...overrides,
  };
}

test("snapshot history interpolates player state at an authoritative room time", () => {
  let roomHistory = [];
  roomHistory = history.recordQuakeMultiplayerSnapshotHistory(roomHistory, {
    sampledAt: 1_000,
    roomTime: 0,
    tick: 1,
    players: [playerFixture({ origin: [0, 0, 0], velocity: [10, 0, 0], updatedAt: 1_000 })],
  });
  roomHistory = history.recordQuakeMultiplayerSnapshotHistory(roomHistory, {
    sampledAt: 1_100,
    roomTime: 100,
    tick: 2,
    players: [playerFixture({ origin: [1, 0, 0], velocity: [20, 0, 0], lastInputSequence: 4, updatedAt: 1_100 })],
  });

  const resolved = history.quakeMultiplayerHistoricalPlayerAt(
    roomHistory,
    playerFixture({ health: 76, armor: 25, updatedAt: 2_000 }),
    1_050,
  );

  assert.deepEqual(resolved?.origin, [0.5, 0, 0]);
  assert.deepEqual(resolved?.velocity, [15, 0, 0]);
  assert.equal(resolved?.health, 76);
  assert.equal(resolved?.armor, 25);
  assert.equal(resolved?.lastInputSequence, 4);
  assert.equal(resolved?.updatedAt, 1_050);
});

test("snapshot history refuses to interpolate across death or respawn boundaries", () => {
  let roomHistory = [];
  roomHistory = history.recordQuakeMultiplayerSnapshotHistory(roomHistory, {
    sampledAt: 1_000,
    roomTime: 0,
    tick: 1,
    players: [playerFixture({ alive: true, origin: [0, 0, 0], updatedAt: 1_000 })],
  });
  roomHistory = history.recordQuakeMultiplayerSnapshotHistory(roomHistory, {
    sampledAt: 1_100,
    roomTime: 100,
    tick: 2,
    players: [playerFixture({ alive: false, origin: [10, 0, 0], updatedAt: 1_100 })],
  });

  assert.equal(
    history.quakeMultiplayerHistoricalPlayerAt(roomHistory, playerFixture(), 1_050),
    null,
  );

  let respawnHistory = [];
  respawnHistory = history.recordQuakeMultiplayerSnapshotHistory(respawnHistory, {
    sampledAt: 2_000,
    roomTime: 0,
    tick: 1,
    players: [playerFixture({ spawnId: "spawn-a", origin: [0, 0, 0], updatedAt: 2_000 })],
  });
  respawnHistory = history.recordQuakeMultiplayerSnapshotHistory(respawnHistory, {
    sampledAt: 2_100,
    roomTime: 100,
    tick: 2,
    players: [playerFixture({ spawnId: "spawn-b", origin: [1, 0, 0], updatedAt: 2_100 })],
  });

  assert.equal(
    history.quakeMultiplayerHistoricalPlayerAt(respawnHistory, playerFixture({ spawnId: "spawn-b" }), 2_050),
    null,
  );
});

test("snapshot history refuses large discontinuity interpolation", () => {
  let roomHistory = [];
  roomHistory = history.recordQuakeMultiplayerSnapshotHistory(roomHistory, {
    sampledAt: 1_000,
    roomTime: 0,
    tick: 1,
    players: [playerFixture({ origin: [0, 0, 0], updatedAt: 1_000 })],
  });
  roomHistory = history.recordQuakeMultiplayerSnapshotHistory(roomHistory, {
    sampledAt: 1_100,
    roomTime: 100,
    tick: 2,
    players: [playerFixture({ origin: [200, 0, 0], updatedAt: 1_100 })],
  });

  assert.equal(
    history.quakeMultiplayerHistoricalPlayerAt(roomHistory, playerFixture(), 1_050, {
      maxDiscontinuityDistance: 10,
    }),
    null,
  );
});

test("historical combat candidates rewind targets but not the attacker", () => {
  let roomHistory = [];
  roomHistory = history.recordQuakeMultiplayerSnapshotHistory(roomHistory, {
    sampledAt: 1_000,
    roomTime: 0,
    tick: 1,
    players: [
      playerFixture({ playerId: "attacker", clientId: "attacker-client", origin: [0, 0, 0], updatedAt: 1_000 }),
      playerFixture({ playerId: "target", clientId: "target-client", origin: [4, 0, 0], updatedAt: 1_000 }),
    ],
  });
  roomHistory = history.recordQuakeMultiplayerSnapshotHistory(roomHistory, {
    sampledAt: 1_100,
    roomTime: 100,
    tick: 2,
    players: [
      playerFixture({ playerId: "attacker", clientId: "attacker-client", origin: [1, 0, 0], updatedAt: 1_100 }),
      playerFixture({ playerId: "target", clientId: "target-client", origin: [4, 2, 0], updatedAt: 1_100 }),
    ],
  });

  const currentAttacker = playerFixture({
    playerId: "attacker",
    clientId: "attacker-client",
    origin: [99, 0, 0],
    updatedAt: 2_000,
  });
  const currentTarget = playerFixture({
    playerId: "target",
    clientId: "target-client",
    origin: [4, 99, 0],
    updatedAt: 2_000,
  });
  const players = history.quakeMultiplayerHistoricalCombatPlayers(
    roomHistory,
    [currentAttacker, currentTarget],
    {
      attackerPlayerId: "attacker",
      targetTime: 1_050,
    },
  );

  assert.deepEqual(players.find((player) => player.playerId === "attacker")?.origin, [99, 0, 0]);
  assert.deepEqual(players.find((player) => player.playerId === "target")?.origin, [4, 1, 0]);
});

test("snapshot history prunes old samples by retention and entry cap", () => {
  let roomHistory = [];
  for (let index = 0; index < 5; index += 1) {
    roomHistory = history.recordQuakeMultiplayerSnapshotHistory(roomHistory, {
      sampledAt: 1_000 + index * 100,
      roomTime: index * 100,
      tick: index + 1,
      players: [playerFixture({ origin: [index, 0, 0], updatedAt: 1_000 + index * 100 })],
    }, {
      maxEntries: 3,
      retentionMs: 250,
    });
  }

  assert.deepEqual(roomHistory.map((entry) => entry.tick), [3, 4, 5]);
  assert.equal(
    history.quakeMultiplayerHistoricalPlayerAt(roomHistory, playerFixture(), 1_050),
    null,
  );
});
