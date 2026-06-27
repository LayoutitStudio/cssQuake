import assert from "node:assert/strict";
import test from "node:test";

import { quakePreparedSceneVariant } from "../../src/prepare/sceneVariants.mjs";

function preparedFixture() {
  const entities = [
    entity(0, "worldspawn", 0),
    entity(1, "func_wall", 0),
    entity(2, "func_wall", 256 | 512 | 1024),
    entity(3, "item_shells", 2048),
    entity(4, "info_player_deathmatch", 0),
  ];
  return {
    version: 2,
    textureCount: 1,
    faceCount: 4,
    sourceFaceCount: 4,
    label: "maps/e1m1.bsp",
    warnings: [],
    entities,
    entityManifest: {
      totals: { entities: 5, active: 5, metadataOnly: 0, ignored: 0, byClassname: {}, byCategory: {} },
      entries: entities.map((item) => ({
        entityIndex: item.index,
        classname: item.classname,
        category: item.classname === "worldspawn" ? "worldspawn" : "brush",
        runtimeStatus: "active",
        spawnflags: Number(item.properties.spawnflags ?? 0),
      })),
      starts: [],
      pickups: [{ entityIndex: 3, classname: "item_shells", origin: { x: 0, y: 0, z: 0 }, spawnflags: 2048 }],
      monsters: [],
      triggers: [],
      movers: [],
      teleporters: [],
      exits: [],
      lights: [],
      counters: [],
      secrets: [],
      inert: [],
      runtime: {
        targetEntities: { t1: [1, 2, 3, 4] },
        triggerCounterCounts: [[2, 1], [3, 1]],
        damageableBrushEntityIndexes: [1, 2],
        fireballEmitterEntityIndexes: [],
        ambientEntityIndexes: [],
        pickupEntityIndexes: [3],
        shootableEntityIndexes: [],
        moverEntityIndexes: [1, 2],
        moverSupportEntityIndexes: [3],
      },
    },
    gameLogic: {
      spawnSets: {
        singleplayerEasy: [0, 1, 3],
        singleplayerNormal: [0, 1, 3],
        singleplayerHard: [0, 1, 3],
      },
      entities: [
        { entityIndex: 1, modeMask: ["singleplayer:easy"], resolvedTrigger: { targetUse: { targetEntityIndexes: [1, 2, 3] } } },
        { entityIndex: 2, modeMask: [] },
        { entityIndex: 3, modeMask: ["singleplayer:easy"] },
      ],
      brushModels: {},
    },
    models: [],
    spawn: { origin: [0, 0, 0], groundZ: 0, eyeHeight: 1, rotX: 0, rotY: 0 },
    visibility: {
      brushModels: [
        { entityIndex: 1, modelIndex: 1 },
        { entityIndex: 2, modelIndex: 2 },
        { entityIndex: 3, modelIndex: 3 },
      ],
    },
    collision: {
      planes: [],
      clipNodes: [],
      headNodes: [0, 0, 0, 0],
      hulls: [],
      models: [],
      brushModels: [
        { entityIndex: 1, modelIndex: 1 },
        { entityIndex: 2, modelIndex: 2 },
        { entityIndex: 3, modelIndex: 3 },
      ],
      pivot: { x: 0, y: 0, z: 0 },
      runtime: {
        groundGrid: { cellSize: 1, height: 1, nullSample: -32768, origin: [0, 0], samples: "", width: 1, zScale: 1 },
        hullMinsZ: 0,
        planes: [],
        brushes: [
          { headNode: 0, kind: "solid", baseOffset: [0, 0, 0], modelIndex: 0, classname: "worldspawn" },
          { headNode: 0, kind: "solid", baseOffset: [0, 0, 0], entityIndex: 1, modelIndex: 1, classname: "func_wall" },
          { headNode: 0, kind: "solid", baseOffset: [0, 0, 0], entityIndex: 2, modelIndex: 2, classname: "func_wall" },
          { headNode: 0, kind: "solid", baseOffset: [0, 0, 0], entityIndex: 3, modelIndex: 3, classname: "item_shells" },
        ],
        solidBrushIndexes: [0, 1, 2, 3],
        triggerBrushIndexes: [],
      },
    },
    renderBundle: renderBundleFixture(),
  };
}

function entity(index, classname, spawnflags) {
  return {
    index,
    classname,
    properties: { classname, spawnflags: String(spawnflags) },
  };
}

function renderBundleFixture() {
  return {
    version: 1,
    kind: "polycss-mesh",
    polycssVersion: "test",
    textureLighting: "baked",
    textureQuality: 1,
    meshHtml: '<div class="polycss-mesh"><s></s><s></s><s></s><s></s><s></s></div>',
    assetUrls: [],
    assetUrlsComplete: true,
    leafMetadata: [{ f: 0 }, { f: 1, e: 1 }, { f: 2, e: 2 }, { f: 3, e: 3 }, { f: 4, e: 4 }],
    leafFrameStyles: [["w"], ["a"], ["dm"], ["sp"], ["spawn"]],
    polygonCount: 5,
    leafCount: 5,
    atlasLeafCount: 5,
    atlasResidency: {
      version: 1,
      mode: "pvs-pages",
      pageSize: 4096,
      pages: [],
      leafPageIndexes: [0, 1, 2, 3, 4],
      visibilityLeafPages: [],
      visibilityLeafPrewarmPages: [],
    },
  };
}

test("singleplayer prepared scene variant removes deathmatch-only brush surfaces and collision", () => {
  const variant = quakePreparedSceneVariant(preparedFixture(), "singleplayer");

  assert.deepEqual(variant.entities.map((item) => item.index), [0, 1, 3]);
  assert.deepEqual(variant.renderBundle.leafMetadata.map((item) => item?.e ?? 0), [0, 1, 3]);
  assert.equal(variant.renderBundle.leafCount, 3);
  assert.equal(variant.collision.runtime.brushes.some((brush) => brush.entityIndex === 2), false);
  assert.deepEqual(variant.collision.runtime.solidBrushIndexes, [0, 1, 2]);
  assert.deepEqual(variant.entityManifest.runtime.targetEntities, { t1: [1, 3] });
  assert.deepEqual(
    variant.gameLogic.entities[0].resolvedTrigger.targetUse.targetEntityIndexes,
    [1, 3],
  );
});

test("deathmatch prepared scene variant keeps deathmatch-only brush and removes NOT_DEATHMATCH entities", () => {
  const variant = quakePreparedSceneVariant(preparedFixture(), "deathmatch");

  assert.deepEqual(variant.entities.map((item) => item.index), [0, 1, 2, 4]);
  assert.deepEqual(variant.renderBundle.leafMetadata.map((item) => item?.e ?? 0), [0, 1, 2, 4]);
  assert.equal(variant.collision.runtime.brushes.some((brush) => brush.entityIndex === 2), true);
  assert.equal(variant.collision.runtime.brushes.some((brush) => brush.entityIndex === 3), false);
  assert.deepEqual(variant.entityManifest.runtime.targetEntities, { t1: [1, 2, 4] });
});
