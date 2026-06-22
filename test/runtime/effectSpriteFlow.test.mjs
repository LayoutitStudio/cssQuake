import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import { importTsModule } from "../importTsModule.mjs";

const {
  createQuakeEffectSpriteFlow,
} = await importTsModule("src/runtime/app/effectSpriteFlow.ts");

const EFFECTS_MANIFEST = {
  explosionSprite: "progs/s_explod.spr",
  sprites: {
    "progs/s_explod.spr": {
      sourcePath: "progs/s_explod.spr",
      frameCount: 6,
      frameDurationMs: 100,
      header: {
        maxWidth: 56,
        maxHeight: 56,
      },
      texture: {
        url: "/q/e/s_explod-test.png",
        width: 336,
        height: 56,
      },
      frames: [0, 1, 2, 3, 4, 5].map((index) => ({
        index,
        x: index * 56,
        y: 0,
        width: 56,
        height: 56,
      })),
    },
  },
};

test("effect sprite flow skips optional preload when no manifest URL is configured", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const window = new Window();
  let fetchCalls = 0;

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: window.document,
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => {
      fetchCalls += 1;
      throw new Error("Effect sprite preload should not fetch without a manifest URL.");
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: window,
  });

  try {
    const layer = document.createElement("div");
    const flow = createQuakeEffectSpriteFlow({
      cameraPerspectiveStyle: () => "400px",
      canShow: () => true,
      effectSpritesUrl: () => undefined,
      isGameplayPaused: () => false,
      layer,
      now: () => 1000,
      viewOrigin: () => [0, 0, 0],
      viewRotation: () => ({ rotX: 90, rotY: 270 }),
    });

    assert.equal(await flow.preload(), false);
    assert.equal(fetchCalls, 0);
    flow.dispose();
  } finally {
    restoreGlobal("document", previousDocument);
    restoreGlobal("fetch", previousFetch);
    restoreGlobal("window", previousWindow);
  }
});

test("effect sprite flow preloads and animates the prepared s_explod sheet", async () => {
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousPerformance = globalThis.performance;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousWindow = globalThis.window;
  const window = new Window();
  let now = 1000;
  let nextFrameId = 1;
  let createElementCalls = 0;
  const decoded = [];
  const frames = new Map();

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: window.document,
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url) => ({
      ok: url === "/q/effects.json",
      json: async () => EFFECTS_MANIFEST,
    }),
  });
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => now },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: window,
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback) => {
      const frameId = nextFrameId++;
      frames.set(frameId, callback);
      return frameId;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: (frameId) => { frames.delete(frameId); },
  });

  const originalCreateElement = document.createElement.bind(document);
  document.createElement = (tagName, options) => {
    createElementCalls += 1;
    return originalCreateElement(tagName, options);
  };

  try {
    const layer = document.createElement("div");
    Object.defineProperty(layer, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(layer, "clientHeight", { configurable: true, value: 600 });
    createElementCalls = 0;

    const flow = createQuakeEffectSpriteFlow({
      cameraPerspectiveStyle: () => "400px",
      canShow: () => true,
      decodeImage: async (url) => { decoded.push(url); },
      effectSpritesUrl: () => "/q/effects.json",
      isGameplayPaused: () => false,
      layer,
      maxSprites: 2,
      now: () => now,
      viewOrigin: () => [0, 0, 0],
      viewRotation: () => ({ rotX: 90, rotY: 270 }),
    });

    assert.equal(createElementCalls, 2);
    assert.equal(layer.children.length, 2);
    assert.deepEqual([...layer.children].map((element) => element.tagName), ["I", "I"]);

    assert.equal(await flow.preload(), true);
    assert.deepEqual(decoded, ["/q/e/s_explod-test.png"]);

    createElementCalls = 0;
    flow.spawnExplosion({ origin: [0, 4, 0], radiusUnits: 200 });

    const sprite = layer.children[0];
    assert.equal(createElementCalls, 0);
    assert.equal(sprite.style.opacity, "1");
    assert.equal(sprite.getAttribute("data-quake-effect-sprite-active"), "true");
    assert.equal(sprite.getAttribute("data-quake-effect-sprite-frame"), "0");
    assert.equal(sprite.getAttribute("data-quake-effect-sprite-source"), "progs/s_explod.spr");
    assert.equal(sprite.style.width, "56px");
    assert.equal(sprite.style.height, "56px");
    assert.equal(sprite.style.backgroundImage, 'url("/q/e/s_explod-test.png")');
    assert.equal(sprite.style.backgroundSize, "336px 56px");
    assert.equal(sprite.style.backgroundPosition, "0px 0px");
    assert.equal(sprite.style.left, "400px");
    assert.equal(sprite.style.top, "300px");
    assert.match(sprite.style.transform, /scale\(2\)/);
    assert.equal(frames.size, 1);

    flow.spawnExplosion({ origin: [0, 4, 0], radiusUnits: 160 });
    const alternateRadiusSprite = layer.children[1];
    assert.equal(alternateRadiusSprite.style.width, "56px");
    assert.equal(alternateRadiusSprite.style.height, "56px");
    assert.equal(alternateRadiusSprite.style.transform, sprite.style.transform);

    now += 100;
    [...frames.values()][0](now);
    assert.equal(sprite.style.backgroundPosition, "-56px 0px");
    assert.equal(sprite.getAttribute("data-quake-effect-sprite-frame"), "1");

    now += 400;
    [...frames.values()][0](now);
    assert.equal(sprite.style.backgroundPosition, "-280px 0px");

    now += 100;
    [...frames.values()][0](now);
    assert.equal(sprite.style.opacity, "0");
    assert.equal(sprite.getAttribute("data-quake-effect-sprite-active"), "false");

    flow.spawnExplosion({ origin: [0, -4, 0], radiusUnits: 200 });
    assert.equal(sprite.getAttribute("data-quake-effect-sprite-active"), "true");
    assert.equal(sprite.style.opacity, "0");
    assert.match(sprite.style.transform, /scale\(0\)/);

    flow.dispose();
    assert.equal(layer.children.length, 0);
  } finally {
    restoreGlobal("cancelAnimationFrame", previousCancelAnimationFrame);
    restoreGlobal("document", previousDocument);
    restoreGlobal("fetch", previousFetch);
    restoreGlobal("performance", previousPerformance);
    restoreGlobal("requestAnimationFrame", previousRequestAnimationFrame);
    restoreGlobal("window", previousWindow);
  }
});

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
