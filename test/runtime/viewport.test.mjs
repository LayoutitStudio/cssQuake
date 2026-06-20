import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import { importTsModule } from "../importTsModule.mjs";

const {
  quakeRuntimeViewportCenterCss,
  quakeRuntimeViewportSize,
} = await importTsModule("src/runtime/viewport.ts");

test("runtime viewport prefers visual viewport dimensions and offsets", () => {
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

    const viewport = quakeRuntimeViewportSize({ width: 1280, height: 720 });

    assert.deepEqual(viewport, {
      height: 620,
      offsetLeft: 12,
      offsetTop: 48,
      width: 1000,
    });
    assert.equal(quakeRuntimeViewportCenterCss(viewport, "x"), "512px");
    assert.equal(quakeRuntimeViewportCenterCss(viewport, "y"), "358px");
  } finally {
    globals.restore();
  }
});

test("runtime viewport falls back to layout viewport without visual viewport", () => {
  const window = new Window();
  const globals = installWindowGlobals(window);
  try {
    setViewportWindowValues(window, {
      innerHeight: 720,
      innerWidth: 1280,
    });

    const viewport = quakeRuntimeViewportSize();

    assert.deepEqual(viewport, {
      height: 720,
      offsetLeft: 0,
      offsetTop: 0,
      width: 1280,
    });
  } finally {
    globals.restore();
  }
});

function setViewportWindowValues(window, {
  innerHeight,
  innerWidth,
  visualHeight,
  visualOffsetLeft = 0,
  visualOffsetTop = 0,
  visualWidth,
}) {
  Object.defineProperties(window, {
    innerHeight: { configurable: true, value: innerHeight },
    innerWidth: { configurable: true, value: innerWidth },
    visualViewport: {
      configurable: true,
      value: visualWidth && visualHeight
        ? {
          height: visualHeight,
          offsetLeft: visualOffsetLeft,
          offsetTop: visualOffsetTop,
          width: visualWidth,
        }
        : undefined,
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
