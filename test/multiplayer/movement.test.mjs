import assert from "node:assert/strict";
import test from "node:test";

import {
  createInput,
  createPlayer,
  simulation,
} from "./harness.mjs";

test("room simulation consumes queued inputs in sequence order across fixed ticks", () => {
  const player = createPlayer();
  let state = simulation.createQuakeMultiplayerRoomPlayerSimulationState({
    playerId: player.playerId,
    now: 0,
  });
  for (const inputSequence of [1, 2, 3]) {
    const result = simulation.queueQuakeMultiplayerRoomInput(state, createInput(inputSequence));
    assert.equal(result.accepted, true);
    state = result.state;
  }

  const first = simulation.advanceQuakeMultiplayerRoomPlayerSimulation(player, state, {
    now: 50,
    tickMs: 50,
    maxCatchupTicks: 1,
  });
  assert.deepEqual(first.consumedInputSequences, [1]);
  assert.equal(first.state.lastAcceptedInputSequence, 1);
  assert.deepEqual(first.state.pendingInputs.map((input) => input.inputSequence), [2, 3]);

  const second = simulation.advanceQuakeMultiplayerRoomPlayerSimulation(first.player, first.state, {
    now: 100,
    tickMs: 50,
    maxCatchupTicks: 1,
  });
  assert.deepEqual(second.consumedInputSequences, [2]);
  assert.equal(second.state.lastAcceptedInputSequence, 2);
  assert.deepEqual(second.state.pendingInputs.map((input) => input.inputSequence), [3]);

  const third = simulation.advanceQuakeMultiplayerRoomPlayerSimulation(second.player, second.state, {
    now: 150,
    tickMs: 50,
    maxCatchupTicks: 1,
  });
  assert.deepEqual(third.consumedInputSequences, [3]);
  assert.equal(third.state.lastAcceptedInputSequence, 3);
  assert.deepEqual(third.state.pendingInputs, []);
});

test("room simulation still holds the last accepted input after the queue drains", () => {
  const player = createPlayer();
  let state = simulation.createQuakeMultiplayerRoomPlayerSimulationState({
    playerId: player.playerId,
    now: 0,
  });
  state = simulation.queueQuakeMultiplayerRoomInput(state, createInput(1, { sampledAt: 0 })).state;

  const first = simulation.advanceQuakeMultiplayerRoomPlayerSimulation(player, state, {
    now: 50,
    tickMs: 50,
    maxCatchupTicks: 1,
  });
  const held = simulation.advanceQuakeMultiplayerRoomPlayerSimulation(first.player, first.state, {
    now: 100,
    tickMs: 50,
    maxCatchupTicks: 1,
    maxInputHoldMs: 250,
  });

  assert.deepEqual(held.consumedInputSequences, []);
  assert.equal(held.state.lastAcceptedInputSequence, 1);
  assert.equal(held.state.lastAcceptedInput?.inputSequence, 1);
  assert.equal(held.player.lastInputSequence, 1);
  assert.ok(horizontalDistance(held.player.origin) > horizontalDistance(first.player.origin));
});

function horizontalDistance(origin) {
  return Math.hypot(origin[0], origin[1]);
}
