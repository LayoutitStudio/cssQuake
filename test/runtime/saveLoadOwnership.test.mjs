import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { importTsModule } from "../importTsModule.mjs";

const { createQuakeAppMapLoader, createCssQuakeSaveSession, createQuakePlayerLifecycleFlow } = await importTsModule("test/runtime/mapLoadModules.ts", {
  define: { "import.meta.env": '{"DEV":false}', __POLYCSS_VERSION__: '"0.2.6"' },
});
const window = new Window({ url: "http://localhost" });
globalThis.window = window;
test.after(async () => { await window.happyDOM.abort(); });
const noop = () => {};
const completion = () => ({ isCurrent: () => true });
const slot = {
  version: 1, savedAt: 123, mapName: "e1m1", view: { origin: [1, 2, 3], rotX: 88, rotY: 270 },
  player: { health: 25 }, pickups: {}, shootables: {}, movers: {}, targets: {},
};
const saveNoops = Object.fromEntries([
  "clearAttackInput", "clearMoveInput", "clearMobileMoveInput", "clearLevelComplete", "clearPlayerDeath",
  "clearCrouchInput", "clearWeaponViewPunch", "clearCrosshairHit", "clearCrosshairTarget", "clearBonusOverlay",
  "clearMegahealthRot", "clearPowerupTimers", "resetActiveTriggers", "resetWeapons", "reschedulePowerupTimers",
  "syncHud", "syncViewmodel", "syncWorldVisibility", "syncShootablesVisibility", "syncCrosshairTarget",
  "setGameplayStarted", "trace", "notify",
].map(name => [name, noop]));
function saveSession(overrides = {}) {
  window.localStorage.setItem("cssquake.save.v1", JSON.stringify(slot));
  const restored = [];
  const options = {
    ...saveNoops, currentLoad: () => false, mapExists: () => true, hasCurrentScene: () => true,
    currentOrigin: () => slot.view.origin,
    ...Object.fromEntries(["Targets", "DamageableBrushes", "Movers", "Pickups", "Shootables", "Player"].map(name =>
      [`restore${name}`, value => restored.push({ name, value })])),
    syncSceneCameraAt: (...value) => restored.push({ name: "Camera", value }),
    ...overrides,
  };
  return { session: createCssQuakeSaveSession(options), restored };
}

for (const ready of [false, true]) {
  test(`save restoration ${ready ? "reuses a ready scene" : "loads an unready scene even when its map matches"}`, async () => {
    const loaded = completion();
    let loads = 0;
    const { session, restored } = saveSession({
      currentLoad: () => ready ? loaded : false,
      loadMap: async () => { loads++; return loaded; },
    });
    assert.equal(await session.load(), loaded);
    assert.equal(loads, ready ? 0 : 1);
    assert.deepEqual(restored.map(value => value.name), ["Targets", "DamageableBrushes", "Movers", "Pickups", "Shootables", "Player", "Camera"]);
    assert.deepEqual(restored.find(value => value.name === "Player").value, slot.player);
    assert.deepEqual(restored.at(-1).value, [slot.view.origin, 88, 270]);
  });
}

test("a newer same-map load between completion and save restoration prevents applying old progress", async () => {
  const pending = [];
  let nextLoad, started = 0;
  const loader = createQuakeAppMapLoader({
    createProgressTracker: () => ({ setStatus() {}, startTask: () => noop }),
    fetchScene: () => new Promise(resolve => pending.push(resolve)),
    preloadWeapon: async () => ({}), preloadSceneAssets: async () => {}, preloadMapAssets: async () => {},
    completeSceneReadiness: async () => {}, isDisposed: () => false, mapLoadView: () => null,
    prepareScene: () => noop, onCurrentMapChange: noop, resumeGameplayAfterMapLoad: noop,
    sceneUrl: name => `/q/${name}.json`, setLoading: noop, syncUrlView: noop, updateUrl: noop,
    setGameplayStarted: () => {
      if (++started === 1) queueMicrotask(() => { nextLoad = loader.loadMap("e1m1"); });
    },
  });
  const { session, restored } = saveSession({ currentLoad: loader.currentLoad, loadMap: async name => loader.loadMap(name) });
  const saved = session.load();
  pending[0]({});
  assert.equal(await saved, false);
  assert.deepEqual(restored, []);
  pending[1]({});
  await nextLoad;
});

for (const ready of [false, true]) {
  test(`New Game ${ready ? "respawns the ready scene and carries ownership to its caller" : "reloads an unready scene instead of leaving the menu stuck"}`, async () => {
    const loaded = completion();
    let respawns = 0, loads = 0;
    const lifecycle = createQuakePlayerLifecycleFlow({
      currentResult: () => ({}), currentMapName: () => "e1m1", currentLoad: () => ready ? loaded : false,
      loadMap: async () => { loads++; return loaded; },
      player: () => ({ respawn: () => respawns++ }), controls: { update: noop },
      ...Object.fromEntries(["clearMegahealthRot", "clearPowerups", "clearMoveInput", "clearAttackInput",
        "clearMobileMoveInput", "clearDebugFlyInput", "clearWeaponViewPunch", "removeBodyClasses",
        "clearTextCenterPrint", "setGameplayStarted"].map(name => [name, noop])),
    });
    assert.equal(await lifecycle.startNewGame(), loaded);
    assert.equal(loads, ready ? 0 : 1);
    assert.equal(respawns, ready ? 1 : 0);
  });
}
