import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const constants = await importTsModule("src/runtime/constants.ts");
const hazards = await importTsModule("src/runtime/hazards.ts");
const physics = await importTsModule("src/runtime/playerPhysics.ts");

const SCALE = constants.QUAKE_COLLISION_UNIT_SCALE;
const MOVE_COMMAND_IDLE = {
  forwardMove: 0,
  jump: false,
  sideMove: 0,
  yawDegrees: 270,
};

test("waterlevel two jump uses Quake swim-up velocity instead of normal jump velocity", () => {
  const velocity = [0, 0, -40 * SCALE];
  const grounded = physics.updateQuakePlayerPhysics(
    velocity,
    { ...MOVE_COMMAND_IDLE, jump: true },
    false,
    0,
    800 * SCALE,
    270 * SCALE,
    1,
    { contents: hazards.QUAKE_CONTENTS_WATER, waterLevel: 2 },
  );

  assert.equal(grounded, false);
  assertApproxEqual(velocity[2], 100 * SCALE);
});

test("swim-up velocity follows liquid contents", () => {
  assert.equal(
    physics.quakePlayerSwimVelocityForContents(hazards.QUAKE_CONTENTS_WATER),
    100 * SCALE,
  );
  assert.equal(
    physics.quakePlayerSwimVelocityForContents(hazards.QUAKE_CONTENTS_SLIME),
    80 * SCALE,
  );
  assert.equal(
    physics.quakePlayerSwimVelocityForContents(hazards.QUAKE_CONTENTS_LAVA),
    50 * SCALE,
  );
});

test("swimming skips normal falling gravity while submerged", () => {
  const velocity = [0, 0, 0];
  physics.updateQuakePlayerPhysics(
    velocity,
    MOVE_COMMAND_IDLE,
    false,
    0.1,
    800 * SCALE,
    270 * SCALE,
    1,
    { contents: hazards.QUAKE_CONTENTS_WATER, waterLevel: 3 },
  );

  assert.equal(velocity[2], 0);
});

test("liquid movement damping scales all velocity axes by waterlevel", () => {
  const velocity = [10 * SCALE, -20 * SCALE, 30 * SCALE];
  physics.updateQuakePlayerPhysics(
    velocity,
    MOVE_COMMAND_IDLE,
    false,
    0.25,
    800 * SCALE,
    270 * SCALE,
    1,
    { contents: hazards.QUAKE_CONTENTS_WATER, waterLevel: 2 },
  );

  assertApproxEqual(velocity[0], 6 * SCALE);
  assertApproxEqual(velocity[1], -12 * SCALE);
  assertApproxEqual(velocity[2], 18 * SCALE);
});

test("feet-only water still applies normal gravity before liquid damping", () => {
  const velocity = [0, 0, 0];
  physics.updateQuakePlayerPhysics(
    velocity,
    MOVE_COMMAND_IDLE,
    false,
    0.25,
    800 * SCALE,
    270 * SCALE,
    1,
    { contents: hazards.QUAKE_CONTENTS_WATER, waterLevel: 1 },
  );

  assertApproxEqual(velocity[2], -160 * SCALE);
});

function assertApproxEqual(actual, expected) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${actual} to approximately equal ${expected}`,
  );
}
