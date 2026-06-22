import assert from "node:assert/strict";
import test from "node:test";

import { createPlayer } from "./harness.mjs";
import { importTsModule } from "../importTsModule.mjs";

const items = await importTsModule("src/runtime/multiplayer/items.ts");

function pickupDefinition(overrides = {}) {
  return {
    pickupId: "item-shells",
    entityIndex: 20,
    classname: "item_shells",
    origin: [2, 0, 1],
    effect: { shells: 20 },
    ...overrides,
  };
}

test("pickup reach accepts the authoritative player position", () => {
  assert.equal(
    items.quakeMultiplayerPlayerCanReachPickup(
      createPlayer({ origin: [2.2, 0, 1] }),
      pickupDefinition(),
    ),
    true,
  );
});

test("pickup reach accepts a bounded local origin hint during vertical server prediction drift", () => {
  assert.equal(
    items.quakeMultiplayerPlayerCanReachPickup(
      createPlayer({ origin: [2.2, 0, 6] }),
      pickupDefinition(),
      undefined,
      [2.2, 0, 1],
    ),
    true,
  );
});

test("pickup reach rejects a forged origin hint far from the authoritative player", () => {
  assert.equal(
    items.quakeMultiplayerPlayerCanReachPickup(
      createPlayer({ origin: [0, 0, 1] }),
      pickupDefinition({ origin: [20, 0, 1] }),
      undefined,
      [20, 0, 1],
    ),
    false,
  );
});
