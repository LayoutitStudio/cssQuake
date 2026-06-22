import assert from "node:assert/strict";
import test from "node:test";

import { createPlayer } from "./harness.mjs";
import { importTsModule } from "../importTsModule.mjs";

const presentation = await importTsModule("src/runtime/multiplayer/presentation.ts");

function createRemotePresenterHarness() {
  let now = 1_000;
  const callbacks = new Map();
  const damageEvents = [];
  const killEvents = [];
  const visualStates = [];
  const removed = [];
  const presenter = presentation.createQuakeMultiplayerRemotePlayerPresenter({
    localClientId: "local-client",
    createVisual: (player) => ({
      setState: (state) => visualStates.push({ playerId: player.playerId, state }),
      remove: () => removed.push(player.playerId),
    }),
    onPlayerDamaged: (event, player) => damageEvents.push({ event, player }),
    onPlayerKilled: (event, player) => killEvents.push({ event, player }),
    now: () => now,
    renderDelayMs: 0,
    requestFrame: (callback) => {
      const handle = callbacks.size + 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      callbacks.delete(handle);
    },
  });

  return {
    damageEvents,
    killEvents,
    presenter,
    removed,
    visualStates,
    flushFrame() {
      const next = callbacks.entries().next().value;
      assert.ok(next, "expected a scheduled frame");
      const [handle, callback] = next;
      callbacks.delete(handle);
      callback(now);
    },
    setNow(value) {
      now = value;
    },
  };
}

function roomSnapshot(players) {
  return {
    type: "room.snapshot",
    payload: { players },
  };
}

function roomEvent(event) {
  return {
    type: "room.event",
    payload: { event },
  };
}

test("remote presenter marks remote player pain and reports damage to visual layer", () => {
  const harness = createRemotePresenterHarness();
  const remotePlayer = createPlayer({
    playerId: "remote-player",
    clientId: "remote-client",
    updatedAt: 1_000,
    origin: [10, 20, 30],
  });

  harness.presenter.handleRoomMessage(roomSnapshot([remotePlayer]));
  harness.flushFrame();

  harness.setNow(1_100);
  harness.presenter.handleRoomMessage(roomEvent({
    eventType: "player.damaged",
    eventId: "damage-1",
    roomTime: 1_100,
    victimPlayerId: "remote-player",
    attackerPlayerId: "local-player",
    damage: 12,
    health: 88,
    armor: 0,
    damageSource: "shotgun",
  }));
  harness.flushFrame();

  assert.equal(harness.damageEvents.length, 1);
  assert.equal(harness.damageEvents[0].event.damage, 12);
  assert.equal(harness.damageEvents[0].player.playerId, "remote-player");
  assert.equal(harness.visualStates.at(-1).state.lastPainAt, 1_100);
});

test("remote presenter ignores local player damage for remote visuals", () => {
  const harness = createRemotePresenterHarness();
  const localPlayer = createPlayer({
    playerId: "local-player",
    clientId: "local-client",
    updatedAt: 1_000,
  });

  harness.presenter.handleRoomMessage(roomSnapshot([localPlayer]));
  assert.equal(harness.visualStates.length, 0);

  harness.presenter.handleRoomMessage(roomEvent({
    eventType: "player.damaged",
    eventId: "damage-local",
    roomTime: 1_100,
    victimPlayerId: "local-player",
    damage: 10,
    health: 90,
    armor: 0,
  }));

  assert.equal(harness.damageEvents.length, 0);
});

test("remote presenter reports remote player kills before death state is applied", () => {
  const harness = createRemotePresenterHarness();
  const remotePlayer = createPlayer({
    playerId: "remote-player",
    clientId: "remote-client",
    updatedAt: 1_000,
    origin: [10, 20, 30],
  });

  harness.presenter.handleRoomMessage(roomSnapshot([remotePlayer]));
  harness.flushFrame();

  harness.setNow(1_200);
  harness.presenter.handleRoomMessage(roomEvent({
    eventType: "player.killed",
    eventId: "kill-1",
    roomTime: 1_200,
    victimPlayerId: "remote-player",
    attackerPlayerId: "local-player",
    damageSource: "shotgun",
  }));
  harness.flushFrame();

  assert.equal(harness.killEvents.length, 1);
  assert.equal(harness.killEvents[0].event.damageSource, "shotgun");
  assert.equal(harness.killEvents[0].player.playerId, "remote-player");
  assert.equal(harness.killEvents[0].player.alive, true);
  assert.equal(harness.visualStates.at(-1).state.alive, false);
  assert.equal(harness.visualStates.at(-1).state.deathAt, 1_200);
});
