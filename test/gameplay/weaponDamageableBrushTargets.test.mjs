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

function createWeaponsController({ damageableBrushTargets, entities }) {
  const entityByIndex = new Map(entities.map((entity) => [entity.index, entity]));
  return weapons.createQuakeWeaponsController({
    scene: { camera: { state: { rotX: 90, rotY: 180 } } },
    controls: { getOrigin: () => [0, 0, 0] },
    canUseGameplayInput: () => true,
    consumeAmmo: () => undefined,
    damageBrushEntity: () => false,
    damagePlayer: () => false,
    damageShootable: () => false,
    getActiveWeapon: () => "nailgun",
    getAmmo: () => 100,
    getCollisionWorld: () => ({
      traceUse: () => ({
        classname: "worldspawn",
        end: [0.1, 0, 0],
        fraction: 0.01,
        planeNormal: [-1, 0, 0],
      }),
    }),
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

function damageableBrushTarget({ classname, health, index }) {
  return {
    dead: false,
    entity: quakeEntity({ classname, health, index }),
    origin: [0, 0, 0],
    bounds: {
      min: [-100, -100, -100],
      max: [100, 100, 100],
    },
  };
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
