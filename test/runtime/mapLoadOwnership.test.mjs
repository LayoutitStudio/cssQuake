import assert from "node:assert/strict";
import test from "node:test";
import { importTsModule } from "../importTsModule.mjs";

const define = { "import.meta.env": '{"DEV":false}' , __POLYCSS_VERSION__: '"0.2.6"', __CSSQUAKE_VERSION__: '"test"' };
const { createQuakeAppMapLoader } = await importTsModule("src/runtime/app/session.ts", { define });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
function harness(overrides = {}) {
  const pending = new Map();
  const events = [];
  const options = {
    completeSceneReadiness: async (_weapon, _progress, isCurrent) => { if (isCurrent?.() ?? true) events.push("ready"); },
    createProgressTracker: () => ({ setStatus() {}, startTask: () => () => events.push("progress") }),
    fetchScene: (_url, name) => { const request = deferred(); pending.set(name, request); return request.promise; },
    isDisposed: () => false, mapLoadView: () => null,
    mountScene: scene => events.push(`mount:${scene.name}`), onCurrentMapChange: name => events.push(`map:${name}`),
    preloadMapAssets: async () => {}, preloadSceneAssets: async () => {}, preloadWeapon: async () => ({}),
    resumeGameplayAfterMapLoad: () => events.push("resume"), sceneUrl: name => `/q/${name}.json`,
    setGameplayStarted: () => events.push("gameplay"), setLoading: value => events.push(`loading:${value}`),
    syncUrlView() {}, updateUrl: name => events.push(`url:${name}`), ...overrides,
  };
  return { loader: createQuakeAppMapLoader(options), pending, events };
}

test("only the latest map load may mount, publish its route, or resume gameplay", async () => {
  const { loader, pending, events } = harness();
  const first = loader.loadMap("e1m1", { resumeGameplay: true });
  const second = loader.loadMap("e1m2", { resumeGameplay: true });
  pending.get("e1m2").resolve({ name: "e1m2" });
  assert.equal(await second, true);
  const afterSecond = [...events];
  pending.get("e1m1").resolve({ name: "e1m1" });
  assert.equal(await first, false);
  assert.deepEqual(events, afterSecond);
  assert.ok(events.includes("mount:e1m2"));
  assert.ok(events.includes("resume"));
});

test("a failed superseded request cannot release the new loading screen", async () => {
  const { loader, pending, events } = harness();
  const first = loader.loadMap("e1m1");
  const second = loader.loadMap("e1m2");
  pending.get("e1m1").reject(new Error("old request failed"));
  assert.equal(await first, false);
  assert.equal(events.includes("loading:false"), false);
  pending.get("e1m2").resolve({ name: "e1m2" });
  await second;
});

test("readiness and progress lose ownership when another map starts", async () => {
  const ready = deferred();
  const entered = deferred();
  let isFirstCurrent, completeFirstTask;
  const { loader, pending, events } = harness({
    completeSceneReadiness: async (_weapon, progress, isCurrent) => {
      if (isFirstCurrent) return;
      isFirstCurrent = isCurrent;
      completeFirstTask = progress.startTask("first");
      entered.resolve();
      await ready.promise;
    },
  });
  const first = loader.loadMap("e1m1");
  pending.get("e1m1").resolve({ name: "e1m1" });
  await entered.promise;
  const second = loader.loadMap("e1m2");
  assert.equal(isFirstCurrent(), false);
  completeFirstTask();
  assert.equal(events.includes("progress"), false);
  ready.resolve();
  assert.equal(await first, false);
  assert.equal(events.includes("gameplay"), false);
  pending.get("e1m2").resolve({ name: "e1m2" });
  await second;
});

test("weapon rejection is observed while the scene request is still pending", async () => {
  let lateProgress;
  const { loader, pending, events } = harness({ preloadWeapon: async progress => { lateProgress = progress.startTask("Weapon"); throw new Error("weapon unavailable"); } });
  const load = loader.loadMap("e1m1");
  await assert.rejects(load, /weapon unavailable/);
  assert.ok(events.includes("loading:false"));
  lateProgress();
  assert.equal(events.includes("progress"), false);
  pending.get("e1m1").resolve({ name: "e1m1" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.some(event => event.startsWith("mount:")), false);
});

test("disposal during preparation prevents any scene publication", async () => {
  let disposed = false;
  const { loader, pending, events } = harness({ isDisposed: () => disposed });
  const load = loader.loadMap("e1m1");
  disposed = true;
  pending.get("e1m1").resolve({ name: "e1m1" });
  assert.equal(await load, false);
  assert.deepEqual(events, ["loading:true"]);
});
