import { createHash } from "node:crypto";
import { Window } from "happy-dom";

export const ownershipCases = ["monster_army", "monster_dog", "monster_knight", "monster_ogre", "monster_demon1", "monster_wizard", "monster_shambler", "monster_zombie", "monster_boss"]
  .flatMap(classname => ["frameset", "replace"].flatMap(backend => [false, true].map(quakec => ({ classname, backend, quakec }))));

const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// This drives the production controller at fixed times. Mesh handles record publication;
// real prepared meshes are covered separately by the headless browser fixtures.
export function runShootableOwnershipScenario(api, scenario) {
  const saved = Object.fromEntries(["window", "document", "performance"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const window = new Window();
  let now = 1000, nextId = 0, paused = false, frozen = false, inView = true, inPvs = true;
  let origin = [0, 0, 1];
  const raf = new Map(), timers = new Map(), handles = [], events = [], checkpoints = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: window.document });
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => now } });
  window.__cssQuakeDebugDomMetadata = true;
  window.requestAnimationFrame = callback => { const id = ++nextId; raf.set(id, callback); return id; };
  window.cancelAnimationFrame = id => raf.delete(id);
  window.setTimeout = (callback, delay = 0) => { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; };
  window.clearTimeout = id => timers.delete(id);
  window.requestIdleCallback = undefined;
  const stopTrace = api.registerQuakeTraceMarkSink(event => events.push({ trace: event }));
  const emit = event => events.push({ at: now, ...structuredClone(event) });
  function mesh(entity, model, frameIndex = 0) {
    const id = handles.length;
    const element = document.createElement("div");
    document.body.append(element);
    let frame = frameIndex;
    const handle = {
      element, entityIndex: entity.index, removed: 0,
      remove() { this.removed++; emit({ remove: id }); element.remove(); },
      setTransform(transform) { emit({ transform: id, value: transform }); },
    };
    if (scenario.backend === "frameset" && model?.animationFrameSet) handle.setFrameIndex = next => {
      const changed = next !== frame;
      if (changed) { frame = next; emit({ frame: id, value: next }); }
      return changed;
    };
    handles.push(handle);
    emit({ mount: id, entity: entity.index, frame: frameIndex });
    return handle;
  }
  function advance(ms) {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) {
      now += 50;
      for (const [id, timer] of [...timers]) if (timers.has(id) && timer.at <= now) { timers.delete(id); timer.callback(); }
      for (const [id, callback] of [...raf]) if (raf.has(id)) { raf.delete(id); callback(now); }
    }
  }
  const entity = { index: 1, classname: scenario.classname, angle: 180, origin: { x: 5, y: 0, z: 1 }, properties: { classname: scenario.classname, angle: "180" } };
  const frameCount = Math.max(...Object.values(api.QUAKE_MONSTER_LOGIC[scenario.classname].chains).flatMap(chain => chain.states.map(state => state.frameIndex))) + 1;
  const modelPath = api.quakeShootableModelPath(entity);
  const model = {
    source: modelPath, bounds: { min: [-0.4, -0.4, -0.7], max: [0.4, 0.4, 0.7] },
    animationFrames: Array.from({ length: frameCount }, (_, index) => ({ name: `frame${index}` })),
    ...(scenario.backend === "frameset" ? { animationFrameSet: {} } : {}),
  };
  const library = { models: { [modelPath]: model } };
  let controller;
  try {
    controller = api.createQuakeShootablesController({
      addMesh: mesh, damagePlayer: (damage, context) => { emit({ damagePlayer: damage, context }); return true; },
      fireTarget: (...args) => emit({ fireTarget: args }), onDestroyed: item => emit({ destroyed: item.index }),
      floorAt: () => 0, getPlayerEyeHeight: () => 1, getPlayerForward: () => [1, 0, 0], getPlayerOrigin: () => origin,
      hasLineOfSight: () => true, isInPlayerView: () => inView, leafIndexAt: () => 0,
      visibleLeavesAt: () => new Set(inPvs ? [0] : []), prewarmLeavesAt: () => new Set(inPvs ? [0] : []),
      monsterRuntimeEnabled: () => true, isGameplayPaused: () => paused, enemiesFrozen: () => frozen,
      createMonsterStateRunner: classname => api.createQuakeMonsterStateRunner(classname, { enabled: scenario.quakec }),
      enemyRandomSalt: 12345, pixelate() {}, pointToPoly: point => [point.x, point.y, point.z],
      schedulePresentationResync() {}, shouldSpawn: () => true, playSound: path => { emit({ sound: path }); return true; },
    });
    const checkpoint = label => {
      const targets = [...controller.weaponTargets()].map(target => target.entity.index);
      const progress = structuredClone(controller.snapshotProgress());
      const culling = controller.debugCullingSnapshot(origin);
      const publication = handles.map((handle, id) => ({ id, entity: handle.entityIndex, removed: handle.removed, html: handle.element.outerHTML }));
      checkpoints.push({ label, now, targets, progress, visible: culling.visibleIndexes, mounted: culling.mountedIndexes,
        events: events.length, eventDigest: digest(events), stateDigest: digest(culling), publicationDigest: digest(publication),
        liveHandles: handles.filter(handle => !handle.removed).length, maxRemovals: Math.max(0, ...handles.map(handle => handle.removed)),
        raf: raf.size, timers: timers.size });
    };
    controller.spawn([entity], library);
    checkpoint("spawn-unmounted");
    controller.syncVisibility(origin, true);
    controller.debugMountEntity(1);
    checkpoint("mounted");
    controller.debugForceEnemyAttack(1, origin);
    advance(150);
    checkpoint("attack-start");
    paused = true; advance(500); checkpoint("paused");
    paused = false; advance(250); checkpoint("resumed");
    frozen = true; advance(300); checkpoint("frozen");
    frozen = false; advance(200); checkpoint("unfrozen");
    controller.damage(1, 5); advance(150); checkpoint("pain");
    const save = structuredClone(controller.snapshotProgress());
    controller.debugForceEnemyAttack(1, origin);
    inView = false; inPvs = false; origin = [-100, 0, 1];
    controller.syncVisibility(origin, true); advance(700); controller.syncVisibility(origin, true);
    checkpoint("attack-unmounted");
    origin = [0, 0, 1]; inView = true; inPvs = true;
    controller.debugSetOrigin(1, [5, 0, 1]); controller.syncVisibility(origin, true); controller.debugMountEntity(1);
    advance(150); checkpoint("remounted");
    const health = controller.snapshotProgress().shootables[0]?.health ?? 0;
    controller.damage(1, health + 1); advance(2000); controller.syncVisibility(origin, true); checkpoint("lethal-damage");
    controller.spawn([entity], library);
    controller.restoreProgress(save); controller.syncVisibility(origin, true); advance(200); checkpoint("restored");
    controller.debugMountEntity(1);
    controller.debugForceEnemyAttack(1, origin); advance(150); checkpoint("attack-before-clear");
    controller.clear(); checkpoint("cleared-with-attack");
    advance(1500); checkpoint("after-clear-callbacks");
    controller.spawn([entity], library); controller.syncVisibility(origin, true); controller.debugMountEntity(1); advance(150);
    checkpoint("respawn-reused-index");
    controller.damage(1, 10000); advance(2000); checkpoint("gib-damage");
    controller.clear(); advance(1500); checkpoint("final-clear");
    return { scenario, frameCount, checkpoints };
  } finally {
    controller?.clear(); stopTrace();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    window.happyDOM.abort();
  }
}
