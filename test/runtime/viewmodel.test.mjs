import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import { importTsModule } from "../importTsModule.mjs";

const {
  createQuakeViewmodelController,
} = await importTsModule("src/runtime/viewmodel.ts");

test("viewmodel layer uses visual viewport placement when browser UI changes viewport height", () => {
  const window = new Window();
  const globals = installWindowGlobals(window);
  try {
    setViewportWindowValues(window, {
      innerHeight: 720,
      innerWidth: 1280,
      visualHeight: 600,
      visualOffsetLeft: 10,
      visualOffsetTop: 50,
      visualWidth: 1000,
    });

    const host = document.createElement("div");
    host.getBoundingClientRect = () => rect(0, 0, 1280, 720);
    const layer = document.createElement("div");
    const sceneElement = document.createElement("div");
    document.body.append(host, layer, sceneElement);

    const viewmodel = createQuakeViewmodelController({
      controls: {
        getOrigin: () => [0, 0, 0],
      },
      host,
      layer,
      scene: {
        camera: {
          state: {
            distance: 0,
            rotX: 88,
            rotY: 270,
            zoom: 1,
          },
        },
        sceneElement,
      },
    });

    viewmodel.mount({
      source: "progs/v_shot.mdl",
      renderBundle: emptyRenderBundle(),
    });

    assert.equal(layer.style.left, "-130.833px");
    assert.equal(layer.style.top, "-59.583px");
    assert.equal(viewmodel.debugSnapshot().viewport.layerScale, 0.8333);

    viewmodel.playFireAnimation({ frameIntervalMs: 45, frames: [1] });

    const fired = viewmodel.debugSnapshot();
    assert.equal(layer.style.left, "-130.833px");
    assert.equal(layer.style.top, "-59.583px");
    assert.equal(fired.viewport.layerScale, 0.8333);
    assert.equal(fired.bob.fireForwardKick, -0.52);
    assert.equal(fired.bob.fireUpKick, -0.1);
  } finally {
    globals.restore();
  }
});

function emptyRenderBundle() {
  return {
    assetUrls: [],
    assetUrlsComplete: true,
    atlasLeafCount: 0,
    kind: "polycss-mesh",
    leafCount: 0,
    leafMetadata: [],
    meshHtml: "<div class=\"polycss-mesh\"></div>",
    polygonCount: 0,
    polycssVersion: "test",
    textureLighting: "baked",
    textureQuality: 1,
    version: 1,
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

function rect(left, top, right, bottom) {
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    toJSON: () => undefined,
    top,
    width: right - left,
    x: left,
    y: top,
  };
}

function installWindowGlobals(window) {
  const previous = new Map();
  for (const [name, value] of [
    ["document", window.document],
    ["getComputedStyle", window.getComputedStyle.bind(window)],
    ["HTMLElement", window.HTMLElement],
    ["Node", window.Node],
    ["performance", window.performance],
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
