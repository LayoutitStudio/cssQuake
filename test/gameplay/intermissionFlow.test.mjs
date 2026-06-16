import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import { importTsModule } from "../importTsModule.mjs";

const {
  createQuakeIntermissionFlow,
} = await importTsModule("src/runtime/app/intermissionFlow.ts");
const {
  createQuakeEntityActivationFlow,
} = await importTsModule("src/runtime/app/entityActivationFlow.ts");
const {
  createQuakeLevelStatsFlow,
  quakeLevelStatsTotalsForEntities,
} = await importTsModule("src/runtime/app/levelStatsFlow.ts");
const {
  buildEntityManifest,
} = await importTsModule("src/prepare/entities.ts");

test("level stat totals count active monsters and trigger secrets only", () => {
  assert.deepEqual(quakeLevelStatsTotalsForEntities([
    { classname: "monster_grunt", index: 1, properties: { classname: "monster_grunt" } },
    { classname: "monster_ogre", index: 2, properties: { classname: "monster_ogre", spawnflags: "256" } },
    { classname: "trigger_secret", index: 3, properties: { classname: "trigger_secret" } },
    { classname: "trigger_secret", index: 4, properties: { classname: "trigger_secret", spawnflags: "256" } },
    { classname: "func_door_secret", index: 5, properties: { classname: "func_door_secret" } },
  ]), {
    monsters: 1,
    secrets: 1,
  });
});

test("entity manifest preserves info_intermission mangle", () => {
  const manifest = buildEntityManifest([
    {
      classname: "info_intermission",
      index: 12,
      origin: { x: -112, y: 704, z: 56 },
      properties: {
        classname: "info_intermission",
        mangle: "20 45 0",
        origin: "-112 704 56",
      },
    },
  ]);

  assert.deepEqual(manifest.intermissions?.[0], {
    classname: "info_intermission",
    entityIndex: 12,
    mangle: { x: 20, y: 45, z: 0 },
    origin: { x: -112, y: 704, z: 56 },
    spawnflags: 0,
  });
});

test("level stats freeze at intermission completion", () => {
  let now = 1000;
  const stats = createQuakeLevelStatsFlow({ now: () => now });

  stats.reset("e1m1", { monsters: 2, secrets: 1 });
  stats.markMonsterKilled(10);
  stats.markMonsterKilled(10);
  stats.markSecret(20);
  now = 61_000;

  const frozen = stats.freeze();

  assert.deepEqual(frozen, {
    elapsedSeconds: 60,
    mapName: "e1m1",
    monstersKilled: 1,
    secretsFound: 1,
    totalMonsters: 2,
    totalSecrets: 1,
  });

  stats.markMonsterKilled(11);
  now = 90_000;
  assert.deepEqual(stats.snapshot(), frozen);
});

test("intermission flow renders classic completion rows and clears them", () => {
  const previousDocument = globalThis.document;
  const window = new Window();
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: window.document,
  });

  try {
    const root = document.createElement("div");
    let renderedRoot = null;
    const intermission = createQuakeIntermissionFlow({
      renderBitmapText: (element) => { renderedRoot = element; },
      root,
    });

    intermission.show({
      elapsedSeconds: 65,
      mapName: "e1m1",
      monstersKilled: 3,
      secretsFound: 1,
      totalMonsters: 10,
      totalSecrets: 2,
    });

    assert.equal(intermission.active(), true);
    assert.equal(root.hidden, false);
    assert.equal(root.textContent, "COMPLETEDTIME1:05SECRETS1/ 2KILLS3/10");
    assert.equal(root.querySelector(".quake-intermission-scrim") instanceof window.HTMLElement, true);
    assert.equal(root.querySelector(".quake-intermission-canvas") instanceof window.HTMLElement, true);
    assert.equal(root.querySelectorAll(".quake-intermission-row").length, 3);
    assert.equal(root.querySelector(".quake-intermission-complete-art")?.getAttribute("src"), "/q/intermission-complete.png");
    assert.equal(root.querySelector(".quake-intermission-label-art")?.getAttribute("src"), "/q/intermission-labels.png");
    assert.equal(root.querySelector(".quake-intermission-stats")?.style.getPropertyValue("--quake-intermission-label-x"), "20");
    assert.equal(root.querySelector(".quake-intermission-stats")?.style.getPropertyValue("--quake-intermission-value-right"), "300");
    assert.deepEqual(
      [...root.querySelectorAll(".quake-intermission-value")].map((value) => value.dataset.value),
      ["1:05", "1/ 2", "3/10"],
    );
    assert.equal(root.querySelectorAll(".quake-intermission-value-glyph").length, 11);
    assert.equal(root.querySelectorAll(".quake-intermission-value-space").length, 0);
    assert.equal(renderedRoot, root);

    root.querySelector(".quake-intermission-complete-art")?.dispatchEvent(new window.Event("load"));
    root.querySelector(".quake-intermission-label-art")?.dispatchEvent(new window.Event("load"));
    assert.equal(root.querySelector(".quake-intermission-complete")?.classList.contains("quake-intermission-complete-source-ready"), true);
    assert.equal(root.querySelector(".quake-intermission-stats")?.classList.contains("quake-intermission-label-source-ready"), true);

    intermission.clear();

    assert.equal(intermission.active(), false);
    assert.equal(root.hidden, true);
    assert.equal(root.children.length, 0);
  } finally {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  }
});

test("level intermission input advance is gated by a minimum dwell", async () => {
  const previousPerformance = globalThis.performance;
  const previousWindow = globalThis.window;
  let now = 1000;
  let nextTimerId = 1;
  const timers = new Map();
  const loaded = [];
  let shown = 0;
  let syncedCamera = 0;

  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => now },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearTimeout: (timerId) => { timers.delete(timerId); },
      setTimeout: (callback, ms) => {
        const timerId = nextTimerId++;
        timers.set(timerId, { callback, ms });
        return timerId;
      },
    },
  });

  try {
    const flow = createQuakeEntityActivationFlow({
      addBodyClasses: () => undefined,
      audio: { playEvent: () => undefined, playSound: () => undefined },
      clearAttackInput: () => undefined,
      currentCollisionWorld: () => null,
      currentGameLogic: () => null,
      entities: () => new Map(),
      getOrigin: () => [0, 0, 0],
      intermission: {
        show: () => { shown++; },
        syncCamera: () => { syncedCamera++; },
      },
      loadMap: async (mapName, options) => {
        loaded.push({ mapName, options });
      },
      mapExists: (mapName) => mapName === "e1m2",
      movers: {
        activateEntity: () => false,
        forceDoorsDownAfter: () => undefined,
        get: () => null,
      },
      pickups: { syncCollision: () => undefined },
      player: () => ({
        clearLevelState: () => undefined,
        currentOrigin: () => [0, 0, 0],
        damage: () => false,
        eyeHeight: () => 1,
        push: () => undefined,
        teleportTo: () => false,
      }),
      pointToPoly: (point) => [point.x, point.y, point.z],
      publishWorldChanged: () => undefined,
      shootables: {
        activate: () => false,
        destroy: () => false,
        has: () => false,
        triggerBossLightning: () => false,
      },
      syncCrosshairTarget: () => undefined,
      syncSceneCamera: () => undefined,
      syncTouchedTriggers: () => [],
      targets: {
        disableEntity: () => undefined,
        entityIndexesFor: () => [],
        fire: () => undefined,
        isDisabled: () => false,
        useTargets: () => false,
      },
      text: {
        centerPrint: () => undefined,
        clearCenterPrint: () => undefined,
        hasUseTargetsMessageText: () => false,
        setCenterPrint: () => undefined,
        showDirectCenterPrintMessageText: () => false,
      },
      transitionSerialIncrement: () => undefined,
      triggers: {
        activateCounterEntity: () => undefined,
        activateTeleporterEntity: () => false,
        setActive: () => undefined,
      },
      viewmodel: {
        clearFireAnimation: () => undefined,
        syncTransform: () => undefined,
      },
      world: { syncVisibility: () => undefined },
    });

    flow.completeLevel({
      classname: "trigger_changelevel",
      index: 1,
      properties: { map: "e1m2" },
    });

    assert.equal(shown, 1);
    assert.equal(syncedCamera, 1);
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].ms, 3000);
    assert.deepEqual(loaded, []);

    assert.equal(flow.requestIntermissionAdvance(), true);
    assert.equal(timers.size, 1);
    assert.deepEqual(loaded, []);

    now = 2001;
    assert.equal(flow.requestIntermissionAdvance(), true);
    await Promise.resolve();

    assert.equal(timers.size, 0);
    assert.deepEqual(loaded, [{
      mapName: "e1m2",
      options: { loadingStatus: "Loading", resumeGameplay: true },
    }]);
    assert.equal(flow.requestIntermissionAdvance(), false);

    flow.completeLevel({
      classname: "trigger_changelevel",
      index: 2,
      properties: { map: "end" },
    });

    assert.equal(shown, 2);
    assert.equal(syncedCamera, 2);
    assert.equal(timers.size, 0);
    assert.equal(flow.isLevelLoadPending(), true);
    assert.equal(flow.requestIntermissionAdvance(), true);
    now = 5000;
    assert.equal(flow.requestIntermissionAdvance(), true);
    await Promise.resolve();
    assert.deepEqual(loaded, [{
      mapName: "e1m2",
      options: { loadingStatus: "Loading", resumeGameplay: true },
    }]);
  } finally {
    Object.defineProperty(globalThis, "performance", {
      configurable: true,
      value: previousPerformance,
    });
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});
