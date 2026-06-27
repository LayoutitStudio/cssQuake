import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { importTsModule } from "./importTsModule.mjs";

const mapNames = ["start", "e1m1", "e1m2", "e1m3", "e1m4", "e1m5", "e1m6", "e1m7", "e1m8"];
const e1m4Path = path.resolve("build/generated/public/q/e1m4.json");
const fallbackSampleLimit = 16;
const shortMoveDeltas = [
  [0.1, 0, 0],
  [-0.1, 0, 0],
  [0, 0.1, 0],
  [0, -0.1, 0],
];

test("E1M4 low-ceiling floor stays grounded from copied view URL pose", {
  skip: existsSync(e1m4Path) ? false : `Missing ${e1m4Path}; run pnpm prepare:quake:map e1m4 first.`,
}, async () => {
  const { buildQuakeClipCollisionWorld } = await importTsModule("src/runtime/collision.ts");
  const {
    GROUND_SNAP,
    QUAKE_COLLISION_UNIT_SCALE,
    QUAKE_PLAYER_MINS_Z,
    STEP_HEIGHT,
  } = await importTsModule("src/runtime/constants.ts");
  const scene = JSON.parse(readFileSync(e1m4Path, "utf8"));
  const collisionWorld = buildQuakeClipCollisionWorld(scene.collision);
  assert.ok(collisionWorld);

  const viewOrigin = { x: 151.557, y: 1320.062, z: 912.035 };
  const pivot = scene.collision.pivot;
  const playerOrigin = [
    (viewOrigin.x - pivot.x) * QUAKE_COLLISION_UNIT_SCALE,
    (viewOrigin.y - pivot.y) * QUAKE_COLLISION_UNIT_SCALE,
    (viewOrigin.z - pivot.z) * QUAKE_COLLISION_UNIT_SCALE,
  ];
  const eyeHeight = scene.spawn.eyeHeight;
  const eyeOrigin = [
    playerOrigin[0],
    playerOrigin[1],
    playerOrigin[2] + QUAKE_PLAYER_MINS_Z + eyeHeight,
  ];
  const footZ = eyeOrigin[2] - eyeHeight;

  const floorZ = collisionWorld.floorAt(
    eyeOrigin[0],
    eyeOrigin[1],
    footZ + STEP_HEIGHT + GROUND_SNAP,
    footZ - STEP_HEIGHT - GROUND_SNAP,
  );
  assert.notEqual(floorZ, null);

  const target = [eyeOrigin[0], eyeOrigin[1] + 0.1, eyeOrigin[2]];
  const resolved = collisionWorld.resolve(target, eyeOrigin, eyeHeight, footZ, false);
  assert.equal(resolved.grounded, true);
  assert.equal(resolved.groundZ, floorZ);
  assert.deepEqual(resolved.origin, [target[0], target[1], floorZ + eyeHeight]);
});

test("prepared maps keep fallback floor samples grounded on short moves", {
  skip: mapNames.every((mapName) => existsSync(path.resolve(`build/generated/public/q/${mapName}.json`)))
    ? false
    : "Missing generated map JSON; run pnpm prepare:quake first.",
}, async () => {
  const { buildQuakeClipCollisionWorld } = await importTsModule("src/runtime/collision.ts");
  const {
    GROUND_SNAP,
    STEP_HEIGHT,
  } = await importTsModule("src/runtime/constants.ts");

  for (const mapName of mapNames) {
    const scene = JSON.parse(readFileSync(path.resolve(`build/generated/public/q/${mapName}.json`), "utf8"));
    const collisionWorld = buildQuakeClipCollisionWorld(scene.collision);
    assert.ok(collisionWorld);
    const samples = fallbackFloorSamples(scene, collisionWorld, STEP_HEIGHT, GROUND_SNAP);
    assert.ok(samples.length > 0, `${mapName} should exercise prepared floor fallback samples`);

    for (const sample of samples) {
      for (const delta of shortMoveDeltas) {
        const target = [
          sample.eyeOrigin[0] + delta[0],
          sample.eyeOrigin[1] + delta[1],
          sample.eyeOrigin[2],
        ];
        const targetFloor = collisionWorld.floorContactAt?.(
          target[0],
          target[1],
          sample.groundZ + STEP_HEIGHT + GROUND_SNAP,
          sample.groundZ - STEP_HEIGHT - GROUND_SNAP,
        ) ?? null;
        if (!targetFloor) continue;

        const resolved = collisionWorld.resolve(target, sample.eyeOrigin, sample.eyeHeight, sample.groundZ, false);
        assert.equal(resolved.grounded, true, `${mapName} fallback floor lost grounding at ${sample.x},${sample.y}`);
      }
    }
  }
});

function fallbackFloorSamples(scene, collisionWorld, stepHeight, groundSnap) {
  const grid = scene.collision.runtime.groundGrid;
  const samples = decodeGroundGridSamples(grid);
  const out = [];
  for (let row = 0; row < grid.height && out.length < fallbackSampleLimit; row++) {
    for (let col = 0; col < grid.width && out.length < fallbackSampleLimit; col++) {
      const raw = samples[row * grid.width + col];
      if (raw === grid.nullSample) continue;
      const z = raw * grid.zScale;
      const x = grid.origin[0] + col * grid.cellSize;
      const y = grid.origin[1] + row * grid.cellSize;
      const contact = collisionWorld.floorContactAt?.(x, y, z + stepHeight + groundSnap, z - stepHeight - groundSnap) ?? null;
      if (!contact || contact.entityIndex !== undefined || contact.modelIndex !== undefined || contact.classname !== undefined) {
        continue;
      }
      const eyeHeight = scene.spawn.eyeHeight;
      const eyeOrigin = [x, y, contact.z + eyeHeight];
      const resolved = collisionWorld.resolve(eyeOrigin, eyeOrigin, eyeHeight, contact.z, false);
      if (!resolved.grounded || !nearVec3(resolved.origin, eyeOrigin)) continue;
      out.push({ eyeHeight, eyeOrigin, groundZ: contact.z, x, y });
    }
  }
  return out;
}

function decodeGroundGridSamples(grid) {
  const bytes = Buffer.from(grid.samples, "base64");
  return new Int16Array(bytes.buffer, bytes.byteOffset, grid.width * grid.height);
}

function nearVec3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= 0.025;
}
