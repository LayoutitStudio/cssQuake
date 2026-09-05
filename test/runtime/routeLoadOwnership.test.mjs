import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { importTsModule } from "../importTsModule.mjs";

const define = { "import.meta.env": '{"DEV":false}', __POLYCSS_VERSION__: '"0.2.6"' };
const { createQuakeRouteFlow } = await importTsModule("src/runtime/app/routeFlow.ts", { define });
const window = new Window({ url: "http://localhost/?map=e1m3" });
globalThis.window = window;
test.after(async () => { await window.happyDOM.abort(); });
const tick = () => new Promise(resolve => setImmediate(resolve));

test("history navigation while loading keeps the latest map and suppresses stale presentation", async () => {
  const calls = [], presentations = [], errors = [];
  let loading = false, currentMap = "e1m3";
  const routes = createQuakeRouteFlow({
    applyView: () => presentations.push("view"), canLoadMap: () => true,
    clearStartupState: () => presentations.push("present"), currentMapName: () => currentMap,
    currentView: () => null, hasCurrentScene: () => true, hideMainMenu() {},
    isDisposed: () => false, isLoading: () => loading,
    loadMap: (map, options) => {
      loading = true;
      return new Promise((resolve, reject) => calls.push({ map, options, resolve, reject }));
    },
    mapExists: () => true, menuEnabled: true, setAssetsRegenerating: error => errors.push(error),
    setGameplayStarted() {}, setLoadingError: error => errors.push(error), showMainMenu() {},
    startMap: () => "e1m1", viewFromUrlView: view => view, viewToUrlView: view => view,
  });
  window.history.replaceState({}, "", "/?map=e1m2");
  routes.handlePopState();
  window.history.replaceState({}, "", "/?map=e1m1");
  routes.handlePopState();
  assert.deepEqual(calls.map(call => call.map), ["e1m2", "e1m1"]);
  assert.equal(calls[1].options.urlMode, "none");
  calls[0].reject(new Error("superseded request"));
  await tick();
  assert.deepEqual(errors, []);
  assert.deepEqual(presentations, []);
  loading = false;
  currentMap = "e1m1";
  calls[1].resolve({ isCurrent: () => true });
  await tick();
  assert.deepEqual(presentations, ["present"]);
});

test("popstate before manifest and model bootstrap does not start an incomplete map", () => {
  const routes = createQuakeRouteFlow({ isDisposed: () => false, canLoadMap: () => false });
  assert.doesNotThrow(() => routes.handlePopState());
});

test("a same-map view request during loading must replace the pending load", async () => {
  let applied = false, loaded = false;
  const routes = createQuakeRouteFlow({
    canLoadMap: () => true, isDisposed: () => false, isLoading: () => true,
    currentMapName: () => "e1m1", hasCurrentScene: () => true, mapExists: () => true,
    startMap: () => "e1m1", applyView: () => { applied = true; },
    loadMap: async () => { loaded = true; return false; },
  });
  window.history.replaceState({}, "", "/?map=e1m1&view=0,0,0,0,0,0");
  routes.handlePopState();
  await tick();
  assert.equal(loaded, true);
  assert.equal(applied, false);
});
