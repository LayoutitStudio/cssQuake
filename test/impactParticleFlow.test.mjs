import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import { importTsModule } from "./importTsModule.mjs";

const {
  createQuakeImpactParticleFlow,
} = await importTsModule("src/runtime/app/impactParticleFlow.ts");

test("impact particles use a fixed b-quad pool and do not allocate during spawn", () => {
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const previousDocument = globalThis.document;
  const previousRandom = Math.random;
  const previousPerformance = globalThis.performance;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousWindow = globalThis.window;
  const window = new Window();
  let now = 1000;
  let nextFrameId = 1;
  let createElementCalls = 0;
  const frames = new Map();

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: window.document,
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
  Math.random = () => 0;

  try {
    const layer = document.createElement("div");
    createElementCalls = 0;
    const flow = createQuakeImpactParticleFlow({
      canShow: () => true,
      isGameplayPaused: () => false,
      layer,
      now: () => now,
    });

    assert.equal(createElementCalls, 24);
    assert.equal(layer.children.length, 24);
    assert.deepEqual([...layer.children].map((element) => element.tagName), new Array(24).fill("B"));

    createElementCalls = 0;
    flow.spawnBlood({ count: 10 });

    assert.equal(createElementCalls, 0);
    assert.equal([...layer.children].filter((element) => element.style.opacity === "1").length, 5);
    assert.equal(frames.size, 1);

    flow.setEnabled(false);

    assert.equal(frames.size, 0);
    assert.equal([...layer.children].every((element) => element.style.opacity === "0"), true);

    createElementCalls = 0;
    flow.spawnBlood();
    assert.equal(createElementCalls, 0);
    assert.equal(frames.size, 0);

    flow.setEnabled(true);
    createElementCalls = 0;
    flow.spawnWallImpact({ count: 10 });
    assert.equal(createElementCalls, 0);
    assert.equal([...layer.children].filter((element) => element.style.opacity === "1").length, 4);
    assert.equal([...layer.children].some((element) => element.className.includes("quake-impact-particle-dust-")), true);
    flow.clear();

    flow.dispose();
    assert.equal(layer.children.length, 0);

    const damageLayer = document.createElement("div");
    createElementCalls = 0;
    const damageFlow = createQuakeImpactParticleFlow({
      canShow: () => true,
      isGameplayPaused: () => false,
      layer: damageLayer,
      maxParticles: 5,
      now: () => now,
    });
    assert.equal(createElementCalls, 5);

    createElementCalls = 0;
    Math.random = () => 0.99;
    damageFlow.spawnBlood({ damage: 4 });
    assert.equal(activeParticleCount(damageLayer), 1);
    assert.equal(createElementCalls, 0);
    damageFlow.clear();
    damageFlow.spawnBlood({ damage: 9 });
    assert.equal(activeParticleCount(damageLayer), 2);
    damageFlow.clear();

    Math.random = () => 0;
    damageFlow.spawnBlood({ damage: 9 });
    assert.equal(activeParticleCount(damageLayer), 3);
    damageFlow.clear();
    damageFlow.spawnBlood({ damage: 18 });
    assert.equal(activeParticleCount(damageLayer), 4);
    damageFlow.clear();
    damageFlow.spawnBlood({ damage: 100 });
    assert.equal(activeParticleCount(damageLayer), 5);
    assert.equal(createElementCalls, 0);
    damageFlow.dispose();

    const directionLayer = document.createElement("div");
    const directionFlow = createQuakeImpactParticleFlow({
      canShow: () => true,
      isGameplayPaused: () => false,
      layer: directionLayer,
      maxParticles: 1,
      now: () => now,
      viewRotation: () => ({ rotX: 90, rotY: 270 }),
    });

    Math.random = () => 0.5;
    directionFlow.spawnBlood({ count: 1, directionHint: [1, 0, 0] });
    const directionOffset = particleOffset(directionLayer.children[0].style.transform);
    assert.equal(directionOffset.x > 0, true);
    assert.equal(Math.abs(directionOffset.y) < 0.001, true);
    directionFlow.dispose();

    const distanceLayer = document.createElement("div");
    const distanceFlow = createQuakeImpactParticleFlow({
      canShow: () => true,
      isGameplayPaused: () => false,
      layer: distanceLayer,
      maxParticles: 1,
      now: () => now,
      viewOrigin: () => [0, 0, 0],
    });

    Math.random = () => 0;
    distanceFlow.spawnBlood({ count: 1, origin: [0, 0, 0] });
    const nearScale = particleScale(distanceLayer.children[0].style.transform);
    distanceFlow.clear();
    distanceFlow.spawnBlood({ count: 1, origin: [100, 0, 0] });
    const farScale = particleScale(distanceLayer.children[0].style.transform);

    assert.equal(nearScale, 2);
    assert.equal(farScale, 0.58);
    assert.equal(nearScale > farScale, true);
    distanceFlow.dispose();
  } finally {
    Math.random = previousRandom;
    if (previousCancelAnimationFrame === undefined) {
      delete globalThis.cancelAnimationFrame;
    } else {
      Object.defineProperty(globalThis, "cancelAnimationFrame", {
        configurable: true,
        value: previousCancelAnimationFrame,
      });
    }
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
    if (previousPerformance === undefined) {
      delete globalThis.performance;
    } else {
      Object.defineProperty(globalThis, "performance", {
        configurable: true,
        value: previousPerformance,
      });
    }
    if (previousRequestAnimationFrame === undefined) {
      delete globalThis.requestAnimationFrame;
    } else {
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: previousRequestAnimationFrame,
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

function particleScale(transform) {
  const match = /scale\(([^,\s)]+)/.exec(transform);
  return match ? Number(match[1]) : 0;
}

function particleOffset(transform) {
  const match = /translate3d\(([^p]+)px, ([^p]+)px, 0\)/.exec(transform);
  return {
    x: match ? Number(match[1]) : 0,
    y: match ? Number(match[2]) : 0,
  };
}

function activeParticleCount(layer) {
  return [...layer.children].filter((element) => element.style.opacity === "1").length;
}
