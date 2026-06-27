import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const weapons = await importTsModule("src/runtime/weapons.ts");

test("health func_button brush targets can win over earlier world trace", () => {
  const controller = createWeaponsController({
    damageableBrushTargets: [
      damageableBrushTarget({
        classname: "func_button",
        health: 1,
        index: 42,
      }),
    ],
    entities: [
      quakeEntity({
        classname: "func_button",
        health: 1,
        index: 42,
      }),
    ],
  });

  const trace = controller.weaponTraceAtCrosshair();

  assert.equal(trace?.classname, "func_button");
  assert.equal(trace?.entityIndex, 42);
});

test("health trigger brush targets can win over earlier world trace", () => {
  const controller = createWeaponsController({
    damageableBrushTargets: [
      damageableBrushTarget({
        classname: "trigger_multiple",
        health: 1,
        index: 138,
      }),
    ],
    entities: [
      quakeEntity({
        classname: "trigger_multiple",
        health: 1,
        index: 138,
      }),
    ],
  });

  const trace = controller.weaponTraceAtCrosshair();

  assert.equal(trace?.classname, "trigger_multiple");
  assert.equal(trace?.entityIndex, 138);
});

test("projectiles can damage health trigger brush targets over earlier world trace", () => {
  const damagedBrushes = [];
  withAnimationFrameWindow((flushFrames) => {
    const controller = createWeaponsController({
      damageBrushEntity: (entityIndex, amount) => {
        damagedBrushes.push({ amount, entityIndex });
        return true;
      },
      damageableBrushTargets: [
        damageableBrushTarget({
          classname: "trigger_multiple",
          health: 1,
          index: 138,
        }),
      ],
      entities: [
        quakeEntity({
          classname: "trigger_multiple",
          health: 1,
          index: 138,
        }),
      ],
    });

    assert.equal(controller.debugFireProjectile({ directDamage: 1, now: 0 }), true);
    flushFrames();
  });

  assert.deepEqual(damagedBrushes, [{ amount: 1, entityIndex: 138 }]);
});

test("health trigger brush targets can use weapon source aim correction", () => {
  const controller = createWeaponsController({
    damageableBrushTargets: [
      damageableBrushTarget({
        bounds: {
          min: [1, -0.1, -0.02],
          max: [2, 0.1, 0.02],
        },
        classname: "trigger_multiple",
        health: 1,
        index: 270,
      }),
    ],
    entities: [
      quakeEntity({
        classname: "trigger_multiple",
        health: 1,
        index: 270,
      }),
    ],
    traceUse: () => null,
  });

  const trace = controller.weaponTraceAtCrosshair();

  assert.equal(trace?.classname, "trigger_multiple");
  assert.equal(trace?.entityIndex, 270);
});

test("non-button damageable brush targets do not bypass world trace", () => {
  const controller = createWeaponsController({
    damageableBrushTargets: [
      damageableBrushTarget({
        classname: "func_door",
        health: 1,
        index: 43,
      }),
    ],
    entities: [
      quakeEntity({
        classname: "func_door",
        health: 1,
        index: 43,
      }),
    ],
  });

  const trace = controller.weaponTraceAtCrosshair();

  assert.equal(trace?.classname, "worldspawn");
  assert.equal(trace?.entityIndex, undefined);
});

function createWeaponsController({
  damageBrushEntity = () => false,
  damageableBrushTargets,
  entities,
  traceUse = () => ({
    classname: "worldspawn",
    end: [0.1, 0, 0],
    fraction: 0.01,
    planeNormal: [-1, 0, 0],
  }),
}) {
  const entityByIndex = new Map(entities.map((entity) => [entity.index, entity]));
  return weapons.createQuakeWeaponsController({
    scene: { camera: { state: { rotX: 90, rotY: 180 } } },
    controls: { getOrigin: () => [0, 0, 0] },
    canUseGameplayInput: () => true,
    consumeAmmo: () => undefined,
    damageBrushEntity,
    damagePlayer: () => false,
    damageShootable: () => false,
    getActiveWeapon: () => "nailgun",
    getAmmo: () => 100,
    getCollisionWorld: () => ({ traceUse }),
    getDamageableBrushTargets: () => damageableBrushTargets,
    getEntities: () => entityByIndex,
    getPlayerEyeHeight: () => 0.92,
    getPlayerWaterLevel: () => 0,
    getShootables: () => [],
    hasViewmodel: () => true,
    onHit: () => undefined,
    playFireAnimation: () => undefined,
    playFireSound: () => undefined,
    selectBestWeapon: () => "nailgun",
    syncCrosshairTarget: () => undefined,
    syncHud: () => undefined,
  });
}

function damageableBrushTarget({ bounds, classname, health, index }) {
  return {
    dead: false,
    entity: quakeEntity({ classname, health, index }),
    origin: [0, 0, 0],
    bounds: bounds ?? {
      min: [-100, -100, -100],
      max: [100, 100, 100],
    },
  };
}

function withAnimationFrameWindow(callback) {
  const previousWindow = globalThis.window;
  const frames = [];
  globalThis.window = {
    requestAnimationFrame(frameCallback) {
      frames.push(frameCallback);
      return frames.length;
    },
    cancelAnimationFrame() {},
  };
  try {
    callback(() => {
      while (frames.length) frames.shift()(16);
    });
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
}

function quakeEntity({ classname, health, index }) {
  return {
    classname,
    index,
    properties: {
      classname,
      health,
    },
  };
}
