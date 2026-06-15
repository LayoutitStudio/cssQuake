import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "./importTsModule.mjs";

const {
  createQuakeShootablesController,
} = await importTsModule("src/runtime/shootables.ts");

function createEntity(index, classname) {
  return {
    angle: 0,
    classname,
    index,
    origin: { x: 0, y: 0, z: 0 },
    properties: {
      classname,
      origin: "0 0 0",
    },
  };
}

function createShootablesHarness() {
  const explosions = [];
  const destroyed = [];
  const shootables = createQuakeShootablesController({
    addMesh: () => null,
    damagePlayer: () => false,
    fireTarget: () => undefined,
    floorAt: (_x, _y, maxZ = 0) => maxZ,
    getPlayerEyeHeight: () => 1,
    getPlayerForward: () => [1, 0, 0],
    getPlayerOrigin: () => [100, 100, 100],
    hasLineOfSight: () => true,
    isInPlayerView: () => true,
    leafIndexAt: () => 0,
    monsterRuntimeEnabled: () => false,
    onDestroyed: (entity) => { destroyed.push(entity); },
    onExplosion: (event) => { explosions.push(event); },
    pixelate: () => undefined,
    pointToPoly: (point) => [point.x, point.y, point.z],
    schedulePresentationResync: () => undefined,
    shouldSpawn: () => true,
    visibleLeavesAt: () => new Set([0]),
  });
  return { destroyed, explosions, shootables };
}

test("destroying explobox emits one explosion presentation event", () => {
  const { destroyed, explosions, shootables } = createShootablesHarness();
  shootables.spawn([createEntity(1, "misc_explobox")], {
    models: {
      "maps/b_explob.bsp": {
        animationFrames: [],
        bounds: { min: [-0.42, -0.42, -0.25], max: [0.42, 0.42, 0.72] },
      },
    },
  });

  assert.equal(shootables.damage(1, 20), true);

  assert.deepEqual(destroyed.map((entity) => entity.index), [1]);
  assert.equal(explosions.length, 1);
  assert.equal(explosions[0].classname, "misc_explobox");
  assert.equal(explosions[0].entityIndex, 1);
  assert.equal(explosions[0].flavor, "explobox");
  assert.deepEqual(explosions[0].origin, [0, 0, -0.25]);
  assert.equal(explosions[0].radiusUnits, 200);
});

test("destroying non-exploding shootable does not emit explosion presentation event", () => {
  const { explosions, shootables } = createShootablesHarness();
  shootables.spawn([createEntity(2, "monster_dog")], {
    models: {
      "progs/dog.mdl": {
        animationFrames: [],
        bounds: { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 1] },
      },
    },
  });

  assert.equal(shootables.damage(2, 25), true);

  assert.deepEqual(explosions, []);
});
