import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import { importTsModule } from "../importTsModule.mjs";

const gameplayInputFlow = await importTsModule("src/runtime/app/gameplayInputFlow.ts");

test("weapon digit key codes map to Quake weapon impulses", () => {
  assert.equal(gameplayInputFlow.quakeWeaponImpulseForGameplayKeyCode("Digit1"), 1);
  assert.equal(gameplayInputFlow.quakeWeaponImpulseForGameplayKeyCode("Digit8"), 8);
  assert.equal(gameplayInputFlow.quakeWeaponImpulseForGameplayKeyCode("Digit9"), null);
  assert.equal(gameplayInputFlow.quakeWeaponImpulseForGameplayKeyCode("Key1"), null);
});

test("weapon digit keydown dispatches an event-bound impulse", (t) => {
  const window = installDomGlobals(t);
  const impulses = [];
  const flow = createInputFlow({
    changeWeaponByImpulse: (impulse) => {
      impulses.push(impulse);
      return true;
    },
  });

  assert.equal(flow.handleWeaponKey({
    code: "Digit7",
    repeat: false,
    target: window.document.body,
  }), true);
  assert.deepEqual(impulses, [7]);
});

test("weapon key handling ignores repeats, editable targets, and debug fly mode", (t) => {
  const window = installDomGlobals(t);
  const input = window.document.createElement("input");
  const impulses = [];
  const flow = createInputFlow({
    changeWeaponByImpulse: (impulse) => {
      impulses.push(impulse);
      return true;
    },
    debugFlyEnabled: () => false,
  });
  const debugFlyFlow = createInputFlow({
    changeWeaponByImpulse: (impulse) => {
      impulses.push(impulse);
      return true;
    },
    debugFlyEnabled: () => true,
  });

  assert.equal(flow.handleWeaponKey({ code: "Digit3", repeat: true, target: window.document.body }), false);
  assert.equal(flow.handleWeaponKey({ code: "Digit3", repeat: false, target: input }), false);
  assert.equal(debugFlyFlow.handleWeaponKey({ code: "Digit3", repeat: false, target: window.document.body }), false);
  assert.deepEqual(impulses, []);
});

test("weapon digit keys prevent browser defaults outside editable controls", (t) => {
  const window = installDomGlobals(t);
  const input = window.document.createElement("input");
  const flow = createInputFlow();

  assert.equal(flow.shouldPreventGameplayKeyDefault({ code: "Digit4", target: window.document.body }), true);
  assert.equal(flow.shouldPreventGameplayKeyDefault({ code: "Digit4", target: input }), false);
});

function createInputFlow(overrides = {}) {
  return gameplayInputFlow.createQuakeGameplayInputFlow({
    canUseGameplayInput: () => true,
    changeWeaponByImpulse: () => true,
    clearMobileLookInput: () => undefined,
    clearMobileMoveInput: () => undefined,
    debugFlyEnabled: () => false,
    player: () => null,
    ...overrides,
  });
}

function installDomGlobals(t) {
  const previousDocument = globalThis.document;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousWindow = globalThis.window;
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.window = window;
  t.after(() => {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
    if (previousHTMLElement === undefined) {
      delete globalThis.HTMLElement;
    } else {
      globalThis.HTMLElement = previousHTMLElement;
    }
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  });
  return window;
}
