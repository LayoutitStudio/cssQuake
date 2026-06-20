import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import { importTsModule } from "../importTsModule.mjs";

const {
  createQuakeCameraViewFlow,
} = await importTsModule("src/runtime/app/cameraViewFlow.ts");

test("camera viewport projection uses visual viewport center", () => {
  const window = new Window();
  const globals = installWindowGlobals(window);
  try {
    setViewportWindowValues(window, {
      innerHeight: 720,
      innerWidth: 1280,
      visualHeight: 620,
      visualOffsetLeft: 12,
      visualOffsetTop: 48,
      visualWidth: 1000,
    });

    const host = document.createElement("div");
    const cameraEl = document.createElement("div");
    const sceneElement = document.createElement("div");
    const flow = createQuakeCameraViewFlow({
      cameraFeedback: () => cameraFeedback(),
      getPlayerOrigin: () => [0, 0, 0],
      host,
      modelPivot: () => ({ x: 0, y: 0, z: 0 }),
      playerEyeHeight: () => 0,
      playerSpawn: () => undefined,
      renderSupersample: 1,
      scene: {
        camera: {
          perspectiveStyle: "1px",
        },
        cameraEl,
      },
      sceneElement,
      setCameraLookEnabledBodyClass: () => undefined,
      syncCrosshairTarget: () => undefined,
      syncShootablesVisibility: () => undefined,
      syncViewmodelTransform: () => undefined,
      syncWorldVisibility: () => undefined,
    });

    flow.syncViewportProjection();

    assert.equal(cameraEl.style.perspectiveOrigin, "512px 358px");
    assert.equal(sceneElement.style.left, "512px");
    assert.equal(sceneElement.style.top, "358px");
  } finally {
    globals.restore();
  }
});

function cameraFeedback() {
  return {
    applyAt: () => undefined,
    clearWeaponViewPunch: () => undefined,
    currentRenderOrigin: () => [0, 0, 0],
    playDamageViewFeedback: () => undefined,
    resetStepSmoothing: () => undefined,
    syncOrigin: () => undefined,
  };
}

function setViewportWindowValues(window, {
  innerHeight,
  innerWidth,
  visualHeight,
  visualOffsetLeft,
  visualOffsetTop,
  visualWidth,
}) {
  Object.defineProperties(window, {
    innerHeight: { configurable: true, value: innerHeight },
    innerWidth: { configurable: true, value: innerWidth },
    visualViewport: {
      configurable: true,
      value: {
        height: visualHeight,
        offsetLeft: visualOffsetLeft,
        offsetTop: visualOffsetTop,
        width: visualWidth,
      },
    },
  });
}

function installWindowGlobals(window) {
  const previous = new Map();
  for (const [name, value] of [
    ["document", window.document],
    ["window", window],
  ]) {
    previous.set(name, globalThis[name]);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value,
    });
  }
  return {
    restore: () => {
      window.happyDOM?.abort?.();
      window.close?.();
      for (const [name, value] of previous) restoreGlobal(name, value);
    },
  };
}

function restoreGlobal(name, value) {
  if (value === undefined) {
    delete globalThis[name];
    return;
  }
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
  });
}
