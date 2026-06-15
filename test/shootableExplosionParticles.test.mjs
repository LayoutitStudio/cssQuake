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

function createFakeMeshHandle(entity, model, handles) {
  const handle = {
    element: {
      classList: {
        add() {},
        remove() {},
      },
      dataset: {},
      querySelectorAll: () => [],
      removeAttribute() {},
      setAttribute() {},
      style: {},
    },
    entity,
    model,
    removed: false,
    transforms: [],
    remove() {
      this.removed = true;
    },
    setTransform(transform) {
      this.transforms.push(transform);
    },
  };
  handles.push(handle);
  return handle;
}

function createModel(source, bounds) {
  return {
    animationFrames: [],
    bounds,
    source,
  };
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

test("gibbed monster death output uses the source foot plane without floor queries", () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setTimeout: globalThis.setTimeout.bind(globalThis),
  };

  const handles = [];
  let floorCalls = 0;
  const shootables = createQuakeShootablesController({
    addMesh: (entity, model) => createFakeMeshHandle(entity, model, handles),
    damagePlayer: () => false,
    fireTarget: () => undefined,
    floorAt: (_x, _y, maxZ = 0, minZ = -Infinity) => {
      floorCalls += 1;
      return minZ <= 0 && 0 <= maxZ ? 0 : null;
    },
    getPlayerEyeHeight: () => 1,
    getPlayerForward: () => [1, 0, 0],
    getPlayerOrigin: () => [0, 0, 0],
    hasLineOfSight: () => true,
    isInPlayerView: () => true,
    leafIndexAt: () => 0,
    monsterRuntimeEnabled: () => false,
    pixelate: () => undefined,
    pointToPoly: (point) => [point.x, point.y, point.z],
    schedulePresentationResync: () => undefined,
    shouldSpawn: () => true,
    visibleLeavesAt: () => new Set([0]),
  });

  try {
    shootables.spawn([createEntity(3, "monster_dog")], {
      models: {
        "progs/dog.mdl": createModel("progs/dog.mdl", {
          min: [-0.5, -0.5, 0],
          max: [0.5, 0.5, 1],
        }),
        "progs/gib3.mdl": createModel("progs/gib3.mdl", {
          min: [-0.12, -0.12, -0.12],
          max: [0.12, 0.12, 0.12],
        }),
        "progs/h_dog.mdl": createModel("progs/h_dog.mdl", {
          min: [-0.2, -0.2, -0.18],
          max: [0.2, 0.2, 0.18],
        }),
      },
    });

    assert.equal(shootables.debugMountEntity(3), true);
    assert.equal(shootables.debugSetOrigin(3, [0, 0, 4]), true);
    const floorCallsBeforeDamage = floorCalls;
    assert.equal(shootables.damage(3, 100), true);
    assert.equal(floorCalls, floorCallsBeforeDamage);

    const deathOutputs = handles.filter((handle) => handle.entity.classname === "monster_death_output");
    assert.equal(deathOutputs.length, 4);
    for (const output of deathOutputs) {
      const finalTransform = output.transforms.at(-1);
      assert.ok(finalTransform, "death output should receive a transform");
      assert.ok(Math.abs(finalTransform.position[2] + output.model.bounds.min[2] - 4) < 1e-9);
    }
  } finally {
    shootables.clear();
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});
