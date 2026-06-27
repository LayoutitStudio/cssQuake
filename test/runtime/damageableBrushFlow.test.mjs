import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const damageableBrushFlow = await importTsModule("src/runtime/app/damageableBrushFlow.ts");

test("damageable brush damage reduces health until lethal", (t) => {
  installWindowTimerStub(t);
  const calls = [];
  const { flow } = createFlow({
    entities: [
      quakeEntity({
        classname: "func_button",
        health: 10,
        index: 42,
        target: "t1",
      }),
    ],
    onActivateEntity: (entityIndex) => {
      calls.push(["activateEntity", entityIndex]);
      return false;
    },
    onUseTargets: (entity) => {
      calls.push(["useTargets", entity.index]);
      return true;
    },
  });

  assert.equal(flow.damage(42, 4), true);
  assert.deepEqual(flow.snapshot(), {
    brushes: [{ entityIndex: 42, health: 6 }],
  });
  assert.deepEqual(calls, []);
});

test("lethal damage to targeted func_button falls back to target chain when no mover activates", (t) => {
  const timers = installWindowTimerStub(t);
  const calls = [];
  const { flow } = createFlow({
    entities: [
      quakeEntity({
        classname: "func_button",
        health: 5,
        index: 42,
        target: "t1",
      }),
    ],
    onActivateEntity: (entityIndex) => {
      calls.push(["activateEntity", entityIndex]);
      return false;
    },
    onUseTargets: (entity) => {
      calls.push(["useTargets", entity.index]);
      return true;
    },
  });

  assert.equal(flow.damage(42, 5), true);
  assert.deepEqual(calls, [
    ["activateEntity", 42],
    ["useTargets", 42],
  ]);
  assert.equal(timers.pending().length, 1);
});

test("lethal damage to mover-backed func_button does not double-fire targets", (t) => {
  installWindowTimerStub(t);
  const calls = [];
  const { flow } = createFlow({
    entities: [
      quakeEntity({
        classname: "func_button",
        health: 5,
        index: 42,
        target: "t1",
      }),
    ],
    onActivateEntity: (entityIndex) => {
      calls.push(["activateEntity", entityIndex]);
      return true;
    },
    onUseTargets: (entity) => {
      calls.push(["useTargets", entity.index]);
      return true;
    },
  });

  assert.equal(flow.damage(42, 5), true);
  assert.deepEqual(calls, [["activateEntity", 42]]);
});

function createFlow({
  entities,
  onActivateEntity = () => false,
  onUseTargets = () => false,
}) {
  const entityByIndex = new Map(entities.map((entity) => [entity.index, entity]));
  const disabled = new Set();
  const flow = damageableBrushFlow.createQuakeDamageableBrushFlow({
    activateEntity: onActivateEntity,
    activateSecretTrigger: () => undefined,
    disableEntity: (entityIndex) => disabled.add(entityIndex),
    getEntity: (entityIndex) => entityByIndex.get(entityIndex),
    isEntityDisabled: (entityIndex) => disabled.has(entityIndex),
    isPaused: () => false,
    pausedTimerPollMs: 100,
    triggerOneShot: () => true,
    useTargets: onUseTargets,
  });
  flow.setup(entities.map((entity) => entity.index));
  return { disabled, flow };
}

function quakeEntity({ classname, health, index, target, wait }) {
  return {
    classname,
    index,
    origin: { x: 0, y: 0, z: 0 },
    properties: {
      classname,
      health,
      ...(target ? { target } : {}),
      ...(wait === undefined ? {} : { wait }),
    },
  };
}

function installWindowTimerStub(t) {
  const previousWindow = globalThis.window;
  let nextTimerId = 1;
  const timers = new Map();
  globalThis.window = {
    setTimeout: (callback, delay) => {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  t.after(() => {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  });
  return {
    pending: () => [...timers.values()],
  };
}
