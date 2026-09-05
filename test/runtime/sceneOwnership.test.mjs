import assert from "node:assert/strict";
import test from "node:test";
import { importTsModule } from "../importTsModule.mjs";

const { createQuakeSceneState } = await importTsModule("src/runtime/app/sceneState.ts");
const { createQuakeSceneMountFlow } = await importTsModule("src/runtime/app/sceneMountFlow.ts");
const { createQuakeAppMapLoader } = await importTsModule("src/runtime/app/session.ts", {
  define: { "import.meta.env": '{"DEV":false}', __POLYCSS_VERSION__: '"0.2.6"' },
});

function retainedScene() {
  const state = createQuakeSceneState();
  const scene = { label: "old", gameLogic: null };
  const entity = { index: 17, classname: "trigger_hurt", properties: { dmg: "10" } };
  const collision = { traceUse: () => ({ fraction: 0 }), touchingTriggers: () => [] };
  state.writer.setCurrentScene(scene);
  state.writer.setCollisionWorld(collision);
  state.writer.setEntityIndex(new Map([[17, entity]]));
  state.writer.setModelPivot({ x: 1, y: 2, z: 3 });
  state.advanceTransition();
  const events = [];
  const controller = name => new Proxy({}, { get: (_target, method) => () => events.push(`${name}.${String(method)}`) });
  const options = {
    state,
    ...Object.fromEntries(["audio", "damageableBrushes", "movers", "pickups", "player", "pointHazards", "shootables", "targets", "triggers", "viewmodel", "weapons", "world"].map(name => [name, controller(name)])),
    beforeDisposeScene: () => events.push("beforeDisposeScene"),
    clearPreControllerState: () => events.push("clearPreControllerState"),
    clearPostControllerState: () => events.push("clearPostControllerState"),
    onModelPivotChange: () => events.push("pivot"),
  };
  return { state, scene, entity, collision, events, flow: createQuakeSceneMountFlow(options) };
}

for (const collision of [undefined, { runtime: { brushes: [], planes: [] } }, { runtime: { brushes: [{}], planes: [{}] } }]) {
  test(`scene preflight preserves the live scene when collision is ${collision ? collision.runtime.brushes.length ? "incomplete" : "empty" : "missing"}`, async () => {
    const { state, scene, entity, collision: oldCollision, events, flow } = retainedScene();
    let currentMap = "e1m1";
    const loader = createQuakeAppMapLoader({
      fetchScene: async () => ({ label: "invalid", collision }),
      prepareScene: flow.prepareScene,
      onCurrentMapChange: map => { currentMap = map; },
      preloadMapAssets: async () => {}, preloadSceneAssets: async () => {}, preloadWeapon: async () => ({}),
      completeSceneReadiness: async () => {},
      createProgressTracker: () => ({ setStatus() {}, startTask: () => () => {} }),
      mapLoadView: () => null, isDisposed: () => false, sceneUrl: map => map,
      setLoading() {}, setGameplayStarted() {}, syncUrlView() {}, updateUrl() {}, resumeGameplayAfterMapLoad() {},
    });
    await assert.rejects(loader.loadMap("e1m2"), /collision|groundGrid/);
    assert.equal(currentMap, "e1m1");
    assert.equal(state.view.scene, scene);
    assert.equal(state.view.collisionWorld, oldCollision);
    assert.deepEqual(flow.entitiesForIndexes([17, 17, 99]), [entity]);
    assert.deepEqual(state.view.modelPivot, { x: 1, y: 2, z: 3 });
    assert.equal(state.view.transitionSerial, 1);
    assert.equal(flow.lineOfSight([0, 0, 0], [1, 0, 0]), false);
    assert.deepEqual(events, [], "Preflight must not release old controllers or handles");
  });
}

test("scene disposal retains controller order and clears every shared read", () => {
  const { state, events, flow } = retainedScene();
  const heldView = state.view;
  flow.disposeCurrentScene();
  assert.deepEqual(events, [
    "beforeDisposeScene", "clearPreControllerState", "viewmodel.remove", "world.clear",
    "movers.clear", "pickups.clear", "shootables.clear", "clearPostControllerState",
    "player.resetForSceneDispose", "damageableBrushes.clear", "targets.clear", "pointHazards.clear",
    "pivot", "audio.syncAmbientEntities", "weapons.reset",
  ]);
  assert.equal(heldView.scene, null);
  assert.equal(heldView.collisionWorld, null);
  assert.equal(heldView.entities.size, 0);
  assert.equal(heldView.transitionSerial, 0);
  assert.deepEqual(heldView.modelPivot, { x: 0, y: 0, z: 0 });
  assert.deepEqual(flow.entitiesForIndexes([17]), []);
  assert.equal(flow.lineOfSight([0, 0, 0], [1, 0, 0]), true);
});
