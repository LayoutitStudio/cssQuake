import assert from "node:assert/strict";
import test from "node:test";

import { createPlayer } from "./harness.mjs";
import { importTsModule } from "../importTsModule.mjs";

const world = await importTsModule("src/runtime/multiplayer/world.ts");

function triggerDefinition(overrides = {}) {
  return {
    kind: "trigger",
    entityIndex: 42,
    classname: "trigger_once",
    bounds: {
      mins: [2, -1, 0],
      maxs: [3, 1, 1],
    },
    touchActivates: true,
    useActivates: true,
    oneShot: true,
    delayMs: 0,
    waitMs: -1,
    targetEntityIndexes: [],
    ...overrides,
  };
}

function touchIntent(overrides = {}) {
  return {
    intentType: "touch",
    worldSequence: 1,
    requestedAt: 100,
    entityIndex: 42,
    origin: [0, 0, 1],
    ...overrides,
  };
}

test("world touch accepts a bounded local origin hint when the authoritative pose is one tick behind", () => {
  const resolution = world.resolveQuakeMultiplayerWorldIntent(
    createPlayer({ origin: [0, 0, 1] }),
    touchIntent({ origin: [1.2, 0, 1] }),
    [triggerDefinition()],
    100,
  );

  assert.equal(resolution.ok, true);
  assert.equal(resolution.kind, "trigger");
});

test("world touch accepts a local origin hint during vertical server prediction drift", () => {
  const resolution = world.resolveQuakeMultiplayerWorldIntent(
    createPlayer({ origin: [1.2, 0, 6] }),
    touchIntent({ origin: [1.2, 0, 1] }),
    [triggerDefinition()],
    100,
  );

  assert.equal(resolution.ok, true);
  assert.equal(resolution.kind, "trigger");
});

test("world touch rejects a forged origin hint far from the authoritative player", () => {
  const resolution = world.resolveQuakeMultiplayerWorldIntent(
    createPlayer({ origin: [0, 0, 1] }),
    touchIntent({ origin: [20, 0, 1] }),
    [triggerDefinition({
      bounds: {
        mins: [20, -1, 0],
        maxs: [21, 1, 1],
      },
    })],
    100,
  );

  assert.equal(resolution.ok, false);
  assert.equal(resolution.reason, "too-far");
});
