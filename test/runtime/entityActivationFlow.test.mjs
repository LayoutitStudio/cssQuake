import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const {
  createQuakeEntityActivationFlow,
} = await importTsModule("src/runtime/app/entityActivationFlow.ts");

test("solid touch activates source touch-enabled buttons", () => {
  const activated = [];
  const flow = createFlow({
    entities: [entity({ classname: "func_button", index: 7, modelIndex: 1 })],
    movers: {
      get: () => ({
        kind: "button",
        prebakedButton: { callbacks: { touch: "button_touch" } },
      }),
      activateEntity: (entityIndex) => {
        activated.push(entityIndex);
        return true;
      },
    },
  });

  flow.activateSolidTouch({
    classname: "func_button",
    contact: "solid",
    entityIndex: 7,
    modelIndex: 1,
  });

  assert.deepEqual(activated, [7]);
});

test("solid touch does not activate damageable buttons without a touch callback", () => {
  const activated = [];
  const flow = createFlow({
    entities: [entity({ classname: "func_button", index: 8, modelIndex: 2, properties: { health: "40" } })],
    movers: {
      get: () => ({
        kind: "button",
        prebakedButton: { callbacks: { th_die: "button_killed" }, damageable: true },
      }),
      activateEntity: (entityIndex) => {
        activated.push(entityIndex);
        return true;
      },
    },
  });

  flow.activateSolidTouch({
    classname: "func_button",
    contact: "solid",
    entityIndex: 8,
    modelIndex: 2,
  });

  assert.deepEqual(activated, []);
});

test("solid touch keeps targeted doors target-only", () => {
  const activated = [];
  const flow = createFlow({
    entities: [entity({ classname: "func_door", index: 9, modelIndex: 3, properties: { targetname: "relay_a" } })],
    movers: {
      get: () => ({
        kind: "door",
        prebakedDoor: {
          callbacks: { touch: "door_touch", use: "door_use" },
          spawnDoorTrigger: false,
        },
      }),
      activateEntity: (entityIndex) => {
        activated.push(entityIndex);
        return true;
      },
    },
  });

  flow.activateSolidTouch({
    classname: "func_door",
    contact: "solid",
    entityIndex: 9,
    modelIndex: 3,
  });

  assert.deepEqual(activated, []);
});

test("solid touch still activates untargeted door trigger movers", () => {
  const activated = [];
  const flow = createFlow({
    entities: [entity({ classname: "func_door", index: 10, modelIndex: 4 })],
    movers: {
      get: () => ({
        kind: "door",
        prebakedDoor: {
          callbacks: { touch: "door_touch" },
          spawnDoorTrigger: true,
        },
      }),
      activateEntity: (entityIndex) => {
        activated.push(entityIndex);
        return true;
      },
    },
  });

  flow.activateSolidTouch({
    classname: "func_door",
    contact: "door-trigger",
    entityIndex: 10,
    modelIndex: 4,
  });

  assert.deepEqual(activated, [10]);
});

function createFlow(overrides = {}) {
  const entityByIndex = new Map((overrides.entities ?? []).map((item) => [item.index, item]));
  const moverOverrides = overrides.movers ?? {};
  return createQuakeEntityActivationFlow({
    addBodyClasses: () => undefined,
    audio: { playEvent: () => undefined, playSound: () => undefined },
    clearAttackInput: () => undefined,
    currentCollisionWorld: () => null,
    currentGameLogic: () => null,
    entities: () => entityByIndex,
    getOrigin: () => [0, 0, 0],
    intermission: {
      show: () => undefined,
      syncCamera: () => undefined,
    },
    loadMap: async () => undefined,
    mapExists: () => false,
    movers: {
      activateEntity: () => false,
      forceDoorsDownAfter: () => 0,
      get: () => undefined,
      ...moverOverrides,
    },
    onSecretActivated: () => undefined,
    pickups: {
      syncCollision: () => undefined,
      syncVisibility: () => undefined,
    },
    player: () => ({
      clearLevelState: () => undefined,
      currentOrigin: () => [0, 0, 0],
      damage: () => false,
      eyeHeight: () => 32,
      push: () => undefined,
      teleportTo: () => false,
    }),
    pointToPoly: (point) => [point.x, point.y, point.z],
    publishWorldChanged: () => undefined,
    shootables: {
      activate: () => false,
      destroy: () => false,
      has: () => false,
      triggerBossLightning: () => false,
    },
    syncCrosshairTarget: () => undefined,
    syncSceneCamera: () => undefined,
    syncTouchedTriggers: () => [],
    targets: {
      disableEntity: () => undefined,
      entityIndexesFor: () => [],
      fire: () => undefined,
      isDisabled: () => false,
      useTargets: () => false,
    },
    text: {
      centerPrint: () => undefined,
      clearCenterPrint: () => undefined,
      hasUseTargetsMessageText: () => false,
      setCenterPrint: () => undefined,
      showDirectCenterPrintMessageText: () => false,
    },
    transitionSerialIncrement: () => undefined,
    triggers: {
      activateCounterEntity: () => undefined,
      activateTeleporterEntity: () => false,
      setActive: () => undefined,
    },
    viewmodel: {
      clearFireAnimation: () => undefined,
      syncTransform: () => undefined,
    },
    world: { syncVisibility: () => undefined },
  });
}

function entity({ classname, index, modelIndex, properties = {} }) {
  return {
    classname,
    index,
    model: `*${modelIndex}`,
    modelIndex,
    properties: {
      classname,
      model: `*${modelIndex}`,
      ...properties,
    },
  };
}
