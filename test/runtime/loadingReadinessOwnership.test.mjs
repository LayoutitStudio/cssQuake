import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { importTsModule } from "../importTsModule.mjs";

const window = new Window({ url: "http://localhost/" });
globalThis.window = window;
globalThis.document = window.document;
test.after(async () => { await window.happyDOM.abort(); });
const { createQuakeLoadingFlow } = await importTsModule("src/runtime/app/loadingFlow.ts", {
  define: { __POLYCSS_VERSION__: '"0.2.6"' },
});
const { createQuakeViewmodelAssetFlow } = await importTsModule("src/runtime/app/viewmodelAssetFlow.ts");
const noop = () => {};
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
function flow(onLoadingChange) {
  return createQuakeLoadingFlow({
    dom: {}, initialLoading: true, previewEnabled: false, currentMapName: () => "e1m1",
    hasCurrentResult: () => true, isDisposed: () => false, isGameplayStarted: () => false,
    isLevelTransitionActive: () => false, isMainMenuOpen: () => false, isMenuPanelOpen: () => false,
    clearAttackInput: noop, clearBonusOverlay: noop, clearCrosshairTarget: noop, clearCrouchInput: noop,
    clearDebugFlyInput: noop, clearMobileMoveInput: noop, clearMoveInput: noop, clearWeaponViewPunch: noop,
    hideStatsOverlay: noop, onLoadingChange, renderBitmapText: noop, setControlsLoading: noop,
    syncCrosshairTarget: noop, syncDebugFlyMode: noop, syncStatsOverlayAvailability: noop, trace: noop,
  });
}

test("a pending old weapon cannot mount or release loading after its scene loses ownership", async () => {
  const weapon = deferred();
  let current = true, mounts = 0;
  const changes = [];
  const models = createQuakeViewmodelAssetFlow({
    activeWeapon: () => null, isDisposed: () => false,
    viewmodel: { mount: () => mounts++ },
  });
  const loading = flow(value => changes.push(value));
  const readiness = loading.completeSceneReadiness(weapon.promise, models.mount, undefined, () => current);
  current = false;
  weapon.resolve({ source: "progs/v_shot.mdl" });
  await readiness;
  assert.equal(mounts, 0);
  assert.deepEqual(changes, []);
  assert.equal(loading.isLoading(), true);
});

test("losing ownership during presented-frame readiness keeps the new overlay active", async () => {
  let current = true;
  const changes = [];
  const loading = flow(value => changes.push(value));
  const originalRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = callback => setImmediate(() => { current = false; callback(performance.now()); });
  try {
    await loading.completeSceneReadiness(Promise.resolve({}), async () => {}, undefined, () => current);
    assert.equal(loading.isLoading(), true);
    assert.deepEqual(changes, []);
  } finally { window.requestAnimationFrame = originalRaf; }
});

test("startup reads the latest route after delayed shared metadata", async () => {
  const metadata = deferred();
  const calls = [];
  let map = "e1m1", ready = false;
  const loading = flow(noop);
  const startup = loading.loadStartup({
    fetchManifest: async () => ({ maps: [] }), setAssetManifest: noop,
    loadProgramMetadata: () => metadata.promise, loadPickupModels: async () => {}, preloadWeapon: async () => ({}),
    onReady: () => { ready = true; }, routeFromLocation: () => ({ mapName: map }),
    routeIsDirect: () => true, routeShouldNormalize: () => false, sceneUrl: () => "/q/map.json",
    setCurrentMapName: noop, setMenuCurrentLevel: noop, syncRoutePresentation: noop,
    loadMap: async name => { assert.equal(ready, true); calls.push(name); return { isCurrent: () => true }; },
  });
  map = "e1m2";
  metadata.resolve();
  await startup;
  assert.deepEqual(calls, ["e1m2"]);
});
