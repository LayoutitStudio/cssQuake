import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import { importTsModule } from "../importTsModule.mjs";

const {
  QUAKE_MOBILE_CONTROLS_QUERY,
  createQuakeMobileControls,
} = await importTsModule("src/runtime/mobileControls.ts");

test("mobile controls availability includes portrait mobile viewports", () => {
  assert.equal(QUAKE_MOBILE_CONTROLS_QUERY, "(any-pointer: coarse), (max-width: 960px)");
});

test("mobile move stick handles pointer input and updates the visible nub", () => {
  const harness = createMobileControlsHarness();
  try {
    assert.equal(harness.controls.isTarget(harness.front), true);
    assertMoveVisualGeometry(harness);

    harness.moveZone.dispatchEvent(pointer(harness.window, "pointerdown", harness.centerX, harness.centerY, 11, 1));
    assert.deepEqual(harness.analogSamples.at(-1), [0, 0]);
    assert.equal(harness.stick.style.opacity, "1");

    harness.moveZone.dispatchEvent(pointer(harness.window, "pointermove", harness.centerX, harness.centerY - 72, 11, 1));
    assert.deepEqual(harness.analogSamples.at(-1), [0, 1]);
    assert.equal(harness.front.style.transform, "translate(0px, -27px)");
    assert.equal(harness.moveIntentCount(), 1);

    harness.moveZone.dispatchEvent(pointer(harness.window, "pointerup", harness.centerX, harness.centerY - 72, 11, 0));
    assertMoveReleased(harness);
  } finally {
    harness.restore();
  }
});

test("mobile move stick uses the touch-down point as the neutral anchor", () => {
  const harness = createMobileControlsHarness();
  try {
    const startX = harness.centerX - 30;
    const startY = harness.centerY + 20;
    harness.moveZone.dispatchEvent(pointer(harness.window, "pointerdown", startX, startY, 12, 1));
    assert.deepEqual(harness.analogSamples.at(-1), [0, 0]);
    assert.equal(harness.stick.style.left, `${startX - 18}px`);
    assert.equal(harness.stick.style.top, `${startY - 100}px`);
    assert.equal(harness.front.style.transform, "translate(0px, 0px)");

    harness.moveZone.dispatchEvent(pointer(harness.window, "pointermove", startX, startY - 72, 12, 1));
    assert.deepEqual(harness.analogSamples.at(-1), [0, 1]);
    assert.equal(harness.front.style.transform, "translate(0px, -27px)");

    harness.moveZone.dispatchEvent(pointer(harness.window, "pointerup", startX, startY - 72, 12, 0));
    assertMoveReleased(harness);
    assert.equal(harness.stick.style.left, "72px");
    assert.equal(harness.stick.style.top, "72px");

    const secondStartX = harness.centerX + 24;
    const secondStartY = harness.centerY - 18;
    harness.moveZone.dispatchEvent(pointer(harness.window, "pointerdown", secondStartX, secondStartY, 13, 1));
    assert.deepEqual(harness.analogSamples.at(-1), [0, 0]);
    assert.equal(harness.stick.style.left, `${secondStartX - 18}px`);
    assert.equal(harness.stick.style.top, `${secondStartY - 100}px`);
    harness.moveZone.dispatchEvent(pointer(harness.window, "pointerup", secondStartX, secondStartY, 13, 0));
    assertMoveReleased(harness);
  } finally {
    harness.restore();
  }
});

test("mobile move stick clears on cancellation, lost capture, and explicit app cleanup", () => {
  const harness = createMobileControlsHarness();
  try {
    dragMove(harness, 21);
    assert.deepEqual(harness.analogSamples.at(-1), [0, 1]);
    harness.moveZone.dispatchEvent(pointer(harness.window, "pointercancel", harness.centerX, harness.centerY - 72, 21, 0));
    assertMoveReleased(harness);

    dragMove(harness, 22);
    assert.deepEqual(harness.analogSamples.at(-1), [0, 1]);
    harness.moveZone.dispatchEvent(pointer(harness.window, "lostpointercapture", harness.centerX, harness.centerY - 72, 22, 0));
    assertMoveReleased(harness);

    dragMove(harness, 23);
    assert.deepEqual(harness.analogSamples.at(-1), [0, 1]);
    harness.controls.clearMoveInput();
    assertMoveReleased(harness);
  } finally {
    harness.restore();
  }
});

test("mobile move stick rejects and clears when gameplay input is unavailable", () => {
  let canUseInput = false;
  const harness = createMobileControlsHarness({ canUseInput: () => canUseInput });
  try {
    harness.moveZone.dispatchEvent(pointer(harness.window, "pointerdown", harness.centerX, harness.centerY, 31, 1));
    harness.moveZone.dispatchEvent(pointer(harness.window, "pointermove", harness.centerX, harness.centerY - 72, 31, 1));
    assert.equal(harness.analogSamples.length, 0);
    assertVisualReleased(harness);
    assert.equal(harness.moveIntentCount(), 0);

    canUseInput = true;
    dragMove(harness, 32);
    assert.deepEqual(harness.analogSamples.at(-1), [0, 1]);

    canUseInput = false;
    harness.moveZone.dispatchEvent(pointer(harness.window, "pointermove", harness.centerX, harness.centerY - 36, 32, 1));
    assertMoveReleased(harness);
  } finally {
    harness.restore();
  }
});

function createMobileControlsHarness({ canUseInput = () => true } = {}) {
  const previousDocument = globalThis.document;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousNode = globalThis.Node;
  const previousPerformance = globalThis.performance;
  const previousWindow = globalThis.window;
  const window = new Window();

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: window.document,
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: window.HTMLElement,
  });
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    value: window.Node,
  });
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: window.performance,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: window,
  });

  window.matchMedia = () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });

  const root = document.createElement("div");
  document.body.append(root);
  const analogSamples = [];
  let moveIntentCount = 0;
  const controls = createQuakeMobileControls({
    root,
    moveDeadzone: 0.08,
    moveDtClamp: 0.035,
    canUseInput,
    isAttackDown: () => false,
    isDisposed: () => false,
    useMoveFrame: () => false,
    onAvailabilityChange: () => undefined,
    onMoveIntent: () => { moveIntentCount += 1; },
    onAnalogMove: (x, y) => { analogSamples.push([round(x), round(y)]); },
    onMoveFrame: () => undefined,
    onLookStart: () => true,
    onLookDelta: () => undefined,
    onFireDown: () => true,
    onFireEnd: () => undefined,
  });

  controls.attach();

  const moveZone = document.querySelector("#quake-mobile-move-zone");
  const back = document.querySelector("#quake-mobile-move-zone .back");
  const front = document.querySelector("#quake-mobile-move-zone .front");
  const stick = document.querySelector("#quake-mobile-move-zone .joystick");
  assert.ok(moveZone instanceof window.HTMLElement);
  assert.ok(back instanceof window.HTMLElement);
  assert.ok(front instanceof window.HTMLElement);
  assert.ok(stick instanceof window.HTMLElement);

  moveZone.getBoundingClientRect = () => ({
    left: 18,
    top: 100,
    right: 162,
    bottom: 244,
    width: 144,
    height: 144,
    x: 18,
    y: 100,
    toJSON: () => undefined,
  });

  return {
    analogSamples,
    back,
    centerX: 90,
    centerY: 172,
    controls,
    front,
    moveIntentCount: () => moveIntentCount,
    moveZone,
    restore: () => {
      controls.dispose();
      restoreGlobal("document", previousDocument);
      restoreGlobal("HTMLElement", previousHTMLElement);
      restoreGlobal("Node", previousNode);
      restoreGlobal("performance", previousPerformance);
      restoreGlobal("window", previousWindow);
    },
    stick,
    window,
  };
}

function dragMove(harness, pointerId) {
  harness.moveZone.dispatchEvent(pointer(harness.window, "pointerdown", harness.centerX, harness.centerY, pointerId, 1));
  harness.moveZone.dispatchEvent(pointer(
    harness.window,
    "pointermove",
    harness.centerX,
    harness.centerY - 72,
    pointerId,
    1,
  ));
}

function assertMoveReleased(harness) {
  assert.deepEqual(harness.analogSamples.at(-1), [0, 0]);
  assertVisualReleased(harness);
}

function assertVisualReleased(harness) {
  assert.equal(harness.front.style.transform, "translate(0px, 0px)");
  assert.equal(harness.stick.style.opacity, "0.58");
}

function assertMoveVisualGeometry(harness) {
  assert.equal(harness.stick.style.left, "72px");
  assert.equal(harness.stick.style.top, "72px");
  assert.equal(harness.stick.style.width, "108px");
  assert.equal(harness.stick.style.height, "108px");
  assert.equal(harness.stick.style.marginLeft, "-54px");
  assert.equal(harness.stick.style.marginTop, "-54px");
  assert.equal(harness.stick.style.pointerEvents, "none");
  assert.equal(harness.back.style.left, "0px");
  assert.equal(harness.back.style.top, "0px");
  assert.equal(harness.back.style.width, "108px");
  assert.equal(harness.back.style.height, "108px");
  assert.equal(harness.back.style.marginLeft, "0px");
  assert.equal(harness.back.style.marginTop, "0px");
  assert.equal(harness.back.style.pointerEvents, "none");
  assert.equal(harness.front.style.left, "50%");
  assert.equal(harness.front.style.top, "50%");
  assert.equal(harness.front.style.width, "54px");
  assert.equal(harness.front.style.height, "54px");
  assert.equal(harness.front.style.marginLeft, "-27px");
  assert.equal(harness.front.style.marginTop, "-27px");
  assert.equal(harness.front.style.pointerEvents, "none");
}

function pointer(window, type, clientX, clientY, pointerId, buttons) {
  return new window.PointerEvent(type, {
    bubbles: true,
    button: 0,
    buttons,
    cancelable: true,
    clientX,
    clientY,
    isPrimary: true,
    pointerId,
    pointerType: "touch",
  });
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

function round(value) {
  return Math.round(value * 1000) / 1000;
}
