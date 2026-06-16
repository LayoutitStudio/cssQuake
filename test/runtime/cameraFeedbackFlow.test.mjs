import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const {
  createQuakeCameraFeedbackFlow,
} = await importTsModule("src/runtime/app/cameraFeedbackFlow.ts");

test("weapon view punch clears to the player look base after look input during recoil", () => {
  const previousPerformance = globalThis.performance;
  const previousWindow = globalThis.window;
  let nextFrameId = 1;
  const frames = new Map();

  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => 1000 },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      cancelAnimationFrame: (frameId) => { frames.delete(frameId); },
      requestAnimationFrame: (callback) => {
        const frameId = nextFrameId++;
        frames.set(frameId, callback);
        return frameId;
      },
    },
  });

  try {
    const scene = {
      camera: {
        perspectiveStyle: "900px",
        state: {
          rotX: 88,
          rotY: 270,
        },
        update: ({ rotX, rotY }) => {
          scene.camera.state.rotX = rotX;
          scene.camera.state.rotY = rotY;
        },
      },
      applyCamera: () => undefined,
    };
    let fireAnimations = 0;
    const flow = createQuakeCameraFeedbackFlow({
      canUseGameplayInput: () => true,
      cameraPerspectiveStyle: () => "900px",
      controls: {
        getOrigin: () => [0, 0, 1.72],
      },
      hasCurrentScene: () => true,
      isDisposed: () => false,
      queueCrosshairTargetSync: () => undefined,
      scene,
      viewmodel: {
        playFireAnimation: () => { fireAnimations++; },
        syncTransform: () => undefined,
      },
    });

    flow.playWeaponFireFeedback();
    assert.equal(fireAnimations, 1);
    assert.equal(scene.camera.state.rotX, 90);

    scene.camera.state.rotX = 91;
    flow.clearWeaponViewPunch();

    assert.equal(scene.camera.state.rotX, 89);
    assert.equal(frames.size, 0);
  } finally {
    if (previousPerformance === undefined) {
      delete globalThis.performance;
    } else {
      Object.defineProperty(globalThis, "performance", {
        configurable: true,
        value: previousPerformance,
      });
    }
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});

test("weapon view punch does not reapply render origin policy to an already adjusted origin", () => {
  const previousPerformance = globalThis.performance;
  const previousWindow = globalThis.window;
  let nextFrameId = 1;
  const frames = new Map();

  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => 1000 },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      cancelAnimationFrame: (frameId) => { frames.delete(frameId); },
      requestAnimationFrame: (callback) => {
        const frameId = nextFrameId++;
        frames.set(frameId, callback);
        return frameId;
      },
    },
  });

  try {
    const scene = {
      camera: {
        perspectiveStyle: "900px",
        state: {
          rotX: 88,
          rotY: 270,
        },
        update: ({ rotX, rotY, target }) => {
          scene.camera.state.rotX = rotX;
          scene.camera.state.rotY = rotY;
          scene.camera.state.target = target;
        },
      },
      applyCamera: () => undefined,
    };
    const flow = createQuakeCameraFeedbackFlow({
      canUseGameplayInput: () => true,
      cameraPerspectiveStyle: () => "900px",
      controls: {
        getOrigin: () => [1, 2, 1.72],
      },
      hasCurrentScene: () => true,
      isDisposed: () => false,
      queueCrosshairTargetSync: () => undefined,
      renderOriginPolicy: (origin) => [origin[0] + 10, origin[1], origin[2]],
      scene,
      viewmodel: {
        playFireAnimation: () => undefined,
        syncTransform: () => undefined,
      },
    });

    flow.resetStepSmoothing([1, 2, 1.72]);
    flow.applyAt([1, 2, 1.72], 88, 270);
    assert.deepEqual(flow.currentRenderOrigin(), [11, 2, 1.72]);

    flow.playWeaponFireFeedback();

    assert.deepEqual(flow.currentRenderOrigin(), [11, 2, 1.72]);
  } finally {
    if (previousPerformance === undefined) {
      delete globalThis.performance;
    } else {
      Object.defineProperty(globalThis, "performance", {
        configurable: true,
        value: previousPerformance,
      });
    }
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});
