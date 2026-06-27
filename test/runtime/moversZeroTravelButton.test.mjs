import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const { createQuakeMoversController } = await importTsModule("src/runtime/movers.ts");

test("zero-travel func_button remains activatable and fires its target once", (t) => {
  const clock = installManualRuntimeClock(t);
  const firedTargets = [];
  const controller = createQuakeMoversController({
    applyState: () => undefined,
    fireTarget: (targetname, sourceEntityIndex) => {
      firedTargets.push({ sourceEntityIndex, targetname });
    },
    groupUnlocked: () => true,
    playerBlocks: () => false,
  });
  const button = {
    classname: "func_button",
    index: 202,
    model: "*40",
    modelIndex: 40,
    properties: {
      angle: "-2",
      classname: "func_button",
      model: "*40",
      target: "t81",
      wait: "-1",
    },
  };
  const model = {
    faceCount: 0,
    firstFace: 0,
    headNodes: [0, 0, 0, 0],
    hulls: [],
    index: 40,
    mins: { x: -253, y: -1023, z: 49 },
    maxs: { x: -191, y: -961, z: 53 },
    origin: { x: 0, y: 0, z: 0 },
  };

  controller.setup([button], [model], { x: 0, y: 0, z: 0 }, null);

  assert.equal(controller.debugStats().movers.length, 1);
  assert.equal(controller.activateEntity(button.index), true);
  assert.deepEqual(firedTargets, [{ sourceEntityIndex: 202, targetname: "t81" }]);
  assert.equal(controller.debugStats().movers[0].mode, "opening");

  clock.advanceFrames(1, 100);

  assert.equal(controller.debugStats().movers[0].mode, "open");
  assert.equal(controller.debugStats().activeMoverCount, 0);
});

test("zero-travel func_button with finite wait can close and be reused", (t) => {
  const clock = installManualRuntimeClock(t);
  const firedTargets = [];
  const controller = createQuakeMoversController({
    applyState: () => undefined,
    fireTarget: (targetname, sourceEntityIndex) => {
      firedTargets.push({ sourceEntityIndex, targetname });
    },
    groupUnlocked: () => true,
    playerBlocks: () => false,
  });
  const button = {
    classname: "func_button",
    index: 7,
    model: "*7",
    modelIndex: 7,
    properties: {
      classname: "func_button",
      model: "*7",
      target: "again",
      wait: "0.1",
    },
  };
  const model = {
    faceCount: 0,
    firstFace: 0,
    headNodes: [0, 0, 0, 0],
    hulls: [],
    index: 7,
    mins: { x: 0, y: 0, z: 0 },
    maxs: { x: 16, y: 16, z: 16 },
    origin: { x: 0, y: 0, z: 0 },
  };

  controller.setup([button], [model], { x: 0, y: 0, z: 0 }, {
    entities: [{
      entityIndex: button.index,
      resolvedMover: zeroTravelButtonFact({ wait: 0.1 }),
    }],
  });

  assert.equal(controller.activateEntity(button.index), true);
  clock.advanceFrames(1, 16);
  assert.equal(controller.debugStats().movers[0].mode, "open");
  clock.advanceFrames(1, 120);
  assert.equal(controller.debugStats().movers[0].mode, "closing");
  clock.advanceFrames(1, 16);
  assert.equal(controller.debugStats().movers[0].mode, "closed");
  assert.equal(controller.activateEntity(button.index), true);
  assert.deepEqual(firedTargets, [
    { sourceEntityIndex: 7, targetname: "again" },
    { sourceEntityIndex: 7, targetname: "again" },
  ]);
});

function installManualRuntimeClock(t) {
  const previousPerformance = globalThis.performance;
  const previousWindow = globalThis.window;
  let now = 0;
  let nextRafId = 1;
  const callbacks = new Map();
  const nativePerformance = globalThis.performance ?? {};
  globalThis.performance = {
    ...nativePerformance,
    now: () => now,
  };
  globalThis.window = {
    cancelAnimationFrame: (id) => {
      callbacks.delete(id);
    },
    requestAnimationFrame: (callback) => {
      const id = nextRafId++;
      callbacks.set(id, callback);
      return id;
    },
  };
  t.after(() => {
    if (previousPerformance === undefined) {
      delete globalThis.performance;
    } else {
      globalThis.performance = previousPerformance;
    }
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  });
  return {
    advanceFrames(count, stepMs) {
      for (let frame = 0; frame < count; frame += 1) {
        const pending = [...callbacks.entries()];
        callbacks.clear();
        if (!pending.length) return;
        now += stepMs;
        for (const [, callback] of pending) callback(now);
      }
    },
  };
}

function zeroTravelButtonFact({ wait }) {
  return {
    kind: "func_button",
    source: { spawnFunction: "func_button" },
    speed: 40,
    wait,
    lip: 4,
    sounds: 0,
    damageable: false,
    initialState: "bottom",
    pos1Origin: { x: 0, y: 0, z: 0 },
    pos2Origin: { x: 0, y: 0, z: 0 },
    initialOrigin: { x: 0, y: 0, z: 0 },
    moveDirection: { x: 1, y: 0, z: 0 },
    travelDistance: 0,
    travelOffset: { x: 0, y: 0, z: 0 },
    callbacks: { touch: "button_touch" },
  };
}
