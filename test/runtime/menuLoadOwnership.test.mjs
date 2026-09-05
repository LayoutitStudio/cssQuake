import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { importTsModule } from "../importTsModule.mjs";

const { createQuakeMenuController, createQuakeAppMapLoader } = await importTsModule("test/runtime/mapLoadModules.ts", {
  define: { "import.meta.env": '{"DEV":false}', __POLYCSS_VERSION__: '"0.2.6"' },
});
const window = new Window();
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "HTMLButtonElement"]) {
  globalThis[key] = key === "window" ? window : key === "document" ? window.document : window[key];
}
test.after(async () => { await window.happyDOM.abort(); });

test("a load superseded between resolution and the menu continuation cannot lock controls", async () => {
  let loading = false, locksWhileLoading = 0, nextLoad;
  const pending = new Map();
  let currentMap = "e1m1";
  const loader = createQuakeAppMapLoader({
    createProgressTracker: () => ({ setStatus() {}, startTask: () => () => {} }),
    fetchScene: (_url, name) => new Promise(resolve => pending.set(name, resolve)),
    preloadWeapon: async () => ({}), preloadSceneAssets: async () => {}, preloadMapAssets: async () => {},
    completeSceneReadiness: async () => { loading = false; },
    isDisposed: () => false, mapLoadView: () => null, prepareScene: () => () => {},
    onCurrentMapChange: name => { currentMap = name; },
    resumeGameplayAfterMapLoad() {}, sceneUrl: name => `/q/${name}.json`,
    setLoading: value => { loading = value; }, syncUrlView() {}, updateUrl() {},
    setGameplayStarted: () => {
      if (currentMap === "e1m1") queueMicrotask(() => { nextLoad = loader.loadMap("e1m2"); });
    },
  });
  document.body.innerHTML = '<div id="host"></div><div id="menu"></div><section id="level"><button class="quake-level-button" value="e1m1"></button></section>';
  const menu = createQuakeMenuController({
    enabled: true, host: document.querySelector("#host"), mainMenu: document.querySelector("#menu"),
    levelPanel: document.querySelector("#level"),
    controls: { update() {}, lock: () => { if (loading) locksWhileLoading++; }, addEventListener() {}, removeEventListener() {} },
    // Match the async App wrapper between the menu and the loader.
    onSelectLevel: async name => loader.loadMap(name), clearCrosshairTarget() {}, syncCrosshairTarget() {},
  });
  try {
    document.querySelector("button").click();
    pending.get("e1m1")({});
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(nextLoad, "the newer load must be active before checking the old menu continuation");
    assert.equal(locksWhileLoading, 0);
  } finally {
    pending.get("e1m2")?.({});
    await nextLoad;
    menu.dispose();
  }
});

for (const action of ["new-game", "load", "level"]) {
  for (const completed of [false, true]) {
    test(`${action} ${completed ? "completion" : "supersession"} ${completed ? "locks" : "does not steal"} controls`, async () => {
      let finish, locks = 0, calls = 0;
      const load = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
      document.body.innerHTML = `<div id="host" tabindex="0"></div><div id="menu"></div>
        <section id="single"><button class="quake-single-player-button" data-quake-single-player-action="${action}"></button></section>
        <section id="level"><button class="quake-level-button" value="e1m1"></button></section>`;
      const menu = createQuakeMenuController({
        enabled: true, host: document.querySelector("#host"), mainMenu: document.querySelector("#menu"),
        singlePlayerPanel: document.querySelector("#single"), levelPanel: document.querySelector("#level"),
        controls: { update() {}, lock: () => locks++, addEventListener() {}, removeEventListener() {} },
        onSelectNewGame: load, onLoadGame: load, onSelectLevel: load, canLoadGame: () => true,
        clearCrosshairTarget() {}, syncCrosshairTarget() {},
      });
      try {
        document.querySelector(action === "level" ? "#level button" : "#single button").click();
        assert.equal(calls, 1);
        finish(completed ? { isCurrent: () => true } : false);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(locks, completed ? 1 : 0);
      } finally { menu.dispose(); }
    });
  }
}

for (const action of ["new-game", "load", "level"]) {
  for (const supersede of [false, true]) {
    test(`${action}: a settled failure ${supersede ? "cannot reopen a menu over a newer load" : "still opens its recovery menu"}`, async () => {
      let nextLoad;
      const pending = new Map();
      const loader = createQuakeAppMapLoader({
        createProgressTracker: () => ({ setStatus() {}, startTask: () => () => {} }),
        fetchScene: (_url, name) => new Promise((resolve, reject) => pending.set(name, { resolve, reject })),
        preloadWeapon: async () => ({}), preloadSceneAssets: async () => {}, preloadMapAssets: async () => {},
        completeSceneReadiness: async () => {}, isDisposed: () => false, mapLoadView: () => null,
        prepareScene: () => () => {}, onCurrentMapChange() {}, resumeGameplayAfterMapLoad() {},
        sceneUrl: name => `/q/${name}.json`, syncUrlView() {}, updateUrl() {}, setGameplayStarted() {},
        setLoading: active => {
          if (!active && supersede) queueMicrotask(() => { nextLoad = loader.loadMap("e1m2"); });
        },
      });
      document.body.innerHTML = `<div id="host"></div><div id="menu"></div>
        <section id="single"><button class="quake-single-player-button" data-quake-single-player-action="${action}"></button></section>
        <section id="level"><button class="quake-level-button" value="e1m1"></button></section>`;
      const load = async () => loader.loadMap("e1m1");
      const menu = createQuakeMenuController({
        enabled: true, host: document.querySelector("#host"), mainMenu: document.querySelector("#menu"),
        singlePlayerPanel: document.querySelector("#single"), levelPanel: document.querySelector("#level"),
        controls: { update() {}, lock() { assert.fail("failed loads must not lock"); }, addEventListener() {}, removeEventListener() {} },
        onSelectNewGame: load, onLoadGame: load, onSelectLevel: load, canLoadGame: () => true,
        clearCrosshairTarget() {}, syncCrosshairTarget() {},
      });
      const originalError = console.error;
      const errors = [];
      console.error = error => errors.push(error);
      try {
        document.querySelector(action === "level" ? "#level button" : "#single button").click();
        pending.get("e1m1").reject(new Error("map unavailable"));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(Boolean(nextLoad), supersede);
        assert.equal(document.querySelector(action === "level" ? "#level" : "#single").hidden, supersede);
        assert.equal(errors.length, supersede ? 0 : 1);
      } finally {
        console.error = originalError;
        pending.get("e1m2")?.resolve({});
        await nextLoad;
        menu.dispose();
      }
    });
  }
}
