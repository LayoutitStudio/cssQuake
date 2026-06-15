import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "./importTsModule.mjs";

const {
  createQuakeShootablePrewarmQueues,
} = await importTsModule("src/runtime/shootables/prewarm.ts");

test("timed-out shootable prewarm drain mounts the selected small batch", () => {
  const previousWindow = globalThis.window;
  const idleCallbacks = [];
  globalThis.window = {
    requestIdleCallback(callback) {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    },
    cancelIdleCallback() {},
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };

  try {
    const states = new Map([
      [1, shootableState(1)],
      [2, shootableState(2)],
      [3, shootableState(3)],
    ]);
    const mounted = [];
    const queues = createQuakeShootablePrewarmQueues({
      canPoolAnimationFrame: () => false,
      canPrewarmShootable: () => true,
      ensureAnimationFrame: () => undefined,
      getShootable: (entityIndex) => states.get(entityIndex),
      mountShootable: (shootable) => {
        shootable.handle = {};
        mounted.push(shootable.entity.index);
      },
      setShootableVisible: (shootable, visible) => {
        shootable.visible = visible;
      },
      timeoutMs: 250,
      trimAnimationFrameHandles: () => undefined,
    });

    queues.setDesiredPrewarmIndexes(new Set([1, 2, 3]));
    for (const shootable of states.values()) queues.scheduleShootable(shootable);

    assert.equal(idleCallbacks.length, 1);
    idleCallbacks[0]({ didTimeout: true, timeRemaining: () => 0 });

    assert.deepEqual(mounted, [1, 2, 3]);
    assert.equal(queues.prewarmQueueLength(), 0);
    for (const shootable of states.values()) {
      assert.equal(shootable.handle !== null, true);
      assert.equal(shootable.visible, false);
    }
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test("prewarm drain keeps one-mesh minimum when idle time is exhausted", () => {
  const previousWindow = globalThis.window;
  const idleCallbacks = [];
  globalThis.window = {
    requestIdleCallback(callback) {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    },
    cancelIdleCallback() {},
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };

  try {
    const states = new Map([
      [1, shootableState(1)],
      [2, shootableState(2)],
    ]);
    const mounted = [];
    const queues = createQuakeShootablePrewarmQueues({
      canPoolAnimationFrame: () => false,
      canPrewarmShootable: () => true,
      ensureAnimationFrame: () => undefined,
      getShootable: (entityIndex) => states.get(entityIndex),
      mountShootable: (shootable) => {
        shootable.handle = {};
        mounted.push(shootable.entity.index);
      },
      setShootableVisible: (shootable, visible) => {
        shootable.visible = visible;
      },
      timeoutMs: 250,
      trimAnimationFrameHandles: () => undefined,
    });

    queues.setDesiredPrewarmIndexes(new Set([1, 2]));
    for (const shootable of states.values()) queues.scheduleShootable(shootable);

    idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 0 });

    assert.deepEqual(mounted, [1]);
    assert.equal(queues.prewarmQueueLength(), 1);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

function shootableState(entityIndex) {
  return {
    dead: false,
    entity: { index: entityIndex },
    frameHandles: new Map(),
    handle: null,
    visible: false,
  };
}
