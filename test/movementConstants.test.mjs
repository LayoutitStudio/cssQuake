import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "./importTsModule.mjs";

const {
  GROUND_SNAP,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  QUAKE_BUTTON_USE_RANGE,
  QUAKE_COLLISION_UNIT_SCALE,
  QUAKE_PLAYER_MINS_Z,
  QUAKE_PLAYER_VIEW_Z,
  STEP_HEIGHT,
} = await importTsModule("src/runtime/constants.ts");

test("source-backed Quake movement constants stay scaled from original units", () => {
  assert.equal(PLAYER_RADIUS, 16 * QUAKE_COLLISION_UNIT_SCALE);
  assert.equal(PLAYER_HEIGHT, 56 * QUAKE_COLLISION_UNIT_SCALE);
  assert.equal(STEP_HEIGHT, 18 * QUAKE_COLLISION_UNIT_SCALE);
  assert.equal(GROUND_SNAP, 6 * QUAKE_COLLISION_UNIT_SCALE);
  assert.equal(QUAKE_PLAYER_MINS_Z, -24 * QUAKE_COLLISION_UNIT_SCALE);
  assert.equal(QUAKE_PLAYER_VIEW_Z, 22 * QUAKE_COLLISION_UNIT_SCALE);
  assert.equal(QUAKE_BUTTON_USE_RANGE, 96 * QUAKE_COLLISION_UNIT_SCALE);
});
