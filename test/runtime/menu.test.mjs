import assert from "node:assert/strict";
import test, { after } from "node:test";

import { Window } from "happy-dom";

import { importTsModule } from "../importTsModule.mjs";

const moduleGlobals = installWindowGlobals(new Window());
const {
  createQuakeMenuController,
} = await importTsModule("src/runtime/menu.ts");

after(() => {
  moduleGlobals.restore();
});

test("main menu background clicks keep the menu open", () => {
  const harness = createMenuHarness();
  try {
    harness.menu.showMainMenu();

    harness.click(harness.mainMenu, 500, 500);

    assert.equal(harness.menu.isMainMenuOpen(), true);
    assert.equal(harness.mainMenu.hidden, false);
    assert.equal(document.body.classList.contains("quake-menu-open"), true);
  } finally {
    harness.restore();
  }
});

test("main menu item clicks still activate the selected row", () => {
  const harness = createMenuHarness();
  try {
    harness.menu.showMainMenu();

    harness.click(harness.mainMenu, 40, 74);

    assert.equal(harness.menu.isMainMenuOpen(), false);
    assert.equal(harness.menu.isMenuPanelOpen(), true);
    assert.equal(harness.aboutPanel.hidden, false);
    assert.equal(document.body.classList.contains("quake-menu-open"), true);
  } finally {
    harness.restore();
  }
});

function createMenuHarness() {
  document.body.replaceChildren();
  document.body.className = "";

  const controls = createControls();
  const host = document.createElement("div");
  host.tabIndex = 0;

  const mainMenu = document.createElement("div");
  mainMenu.id = "quake-main-menu";
  mainMenu.tabIndex = -1;
  mainMenu.hidden = true;

  const mainMenuArt = document.createElement("div");
  mainMenu.append(mainMenuArt);

  mainMenuArt.append(
    mainMenuItem("single-player", rect(20, 20, 180, 44)),
    mainMenuItem("help", rect(20, 60, 180, 84)),
  );

  const singlePlayerPanel = panel("quake-single-player-panel");
  const multiplayerPanel = panel("quake-multiplayer-panel");
  const levelPanel = panel("quake-level-panel");
  const aboutPanel = panel("quake-about-panel");
  const optionsPanel = panel("quake-options-panel");

  document.body.append(
    host,
    mainMenu,
    singlePlayerPanel,
    multiplayerPanel,
    levelPanel,
    aboutPanel,
    optionsPanel,
  );

  const menu = createQuakeMenuController({
    enabled: true,
    host,
    controls,
    mainMenu,
    mainMenuArt,
    singlePlayerPanel,
    multiplayerPanel,
    levelPanel,
    aboutPanel,
    optionsPanel,
    isMultiplayerEnabled: () => true,
    isQuitEnabled: () => false,
    clearCrosshairTarget: () => undefined,
    syncCrosshairTarget: () => undefined,
  });

  return {
    aboutPanel,
    click: (target, clientX, clientY) => {
      target.dispatchEvent(new window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
      }));
    },
    mainMenu,
    menu,
    restore: () => {
      menu.dispose();
      document.body.replaceChildren();
      document.body.className = "";
    },
  };
}

function mainMenuItem(action, bounds) {
  const item = document.createElement("div");
  item.className = "quake-main-menu-item quake-main-menu-item-selectable";
  item.setAttribute("data-quake-main-menu-action", action);
  item.getBoundingClientRect = () => bounds;
  return item;
}

function panel(id) {
  const element = document.createElement("section");
  element.id = id;
  element.tabIndex = -1;
  element.hidden = true;
  return element;
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

function createControls() {
  const listeners = new Map([
    ["start", new Set()],
    ["end", new Set()],
  ]);

  return {
    update: () => undefined,
    lock: () => undefined,
    addEventListener: (type, listener) => {
      listeners.get(type)?.add(listener);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
  };
}

function installWindowGlobals(window) {
  const previous = new Map();
  for (const [name, value] of [
    ["CustomEvent", window.CustomEvent],
    ["document", window.document],
    ["Element", window.Element],
    ["getComputedStyle", window.getComputedStyle.bind(window)],
    ["HTMLAnchorElement", window.HTMLAnchorElement],
    ["HTMLButtonElement", window.HTMLButtonElement],
    ["HTMLElement", window.HTMLElement],
    ["MouseEvent", window.MouseEvent],
    ["Node", window.Node],
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
