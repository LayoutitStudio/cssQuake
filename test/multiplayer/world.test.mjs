import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createPlayer } from "./harness.mjs";
import { importTsModule } from "../importTsModule.mjs";

const world = await importTsModule("src/runtime/multiplayer/world.ts");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const PREPARED_SHAREWARE_MAPS = [
  "start",
  "e1m1",
  "e1m2",
  "e1m3",
  "e1m4",
  "e1m5",
  "e1m6",
  "e1m7",
  "e1m8",
];

const MIN_WORLD_DEFINITION_COUNTS = {
  start: 31,
  e1m1: 55,
  e1m2: 57,
  e1m3: 93,
  e1m4: 90,
  e1m5: 70,
  e1m6: 99,
  e1m7: 31,
  e1m8: 24,
};

const SUPPORTED_SHARED_WORLD_TARGET_CLASSNAMES = new Set([
  "trigger_teleport",
  "trigger_changelevel",
  "trigger_hurt",
  "trigger_push",
  "trigger_multiple",
  "trigger_once",
  "trigger_secret",
  "trigger_counter",
  "trigger_relay",
  "func_button",
  "func_door",
  "func_door_secret",
  "func_plat",
]);

const CLASSIFIED_UNSHARED_TARGET_CLASSNAMES = new Set([
  "event_lightning",
  "func_train",
  "light",
  "monster_army",
  "monster_demon1",
  "monster_knight",
  "monster_ogre",
  "monster_shambler",
  "monster_wizard",
  "monster_zombie",
  "trap_spikeshooter",
]);

function triggerDefinition(overrides = {}) {
  return {
    kind: "trigger",
    entityIndex: 42,
    classname: "trigger_once",
    bounds: {
      mins: [2, -1, 0],
      maxs: [3, 1, 1],
    },
    touchActivates: true,
    useActivates: true,
    oneShot: true,
    delayMs: 0,
    waitMs: -1,
    targetEntityIndexes: [],
    ...overrides,
  };
}

function touchIntent(overrides = {}) {
  return {
    intentType: "touch",
    worldSequence: 1,
    requestedAt: 100,
    entityIndex: 42,
    origin: [0, 0, 1],
    ...overrides,
  };
}

function readPreparedScene(mapName) {
  const scenePath = path.join(projectRoot, "build/generated/public/q", `${mapName}.json`);
  return JSON.parse(readFileSync(scenePath, "utf8"));
}

function assertFiniteVec3(value, label) {
  assert.equal(Array.isArray(value), true, `${label} must be an array`);
  assert.equal(value.length, 3, `${label} must have three components`);
  for (const component of value) {
    assert.equal(Number.isFinite(component), true, `${label} has non-finite component ${String(component)}`);
  }
}

test("prepared shareware maps derive trusted multiplayer world definitions without shared-target holes", () => {
  const failures = [];
  for (const mapName of PREPARED_SHAREWARE_MAPS) {
    const scene = readPreparedScene(mapName);
    const entityByIndex = new Map(scene.entities.map((entity) => [entity.index, entity]));
    const definitions = world.quakeMultiplayerWorldDefinitionsFromScene(scene, {});
    const definitionsByIndex = new Map(definitions.map((definition) => [definition.entityIndex, definition]));

    if (definitions.length < MIN_WORLD_DEFINITION_COUNTS[mapName]) {
      failures.push(`${mapName}: expected at least ${MIN_WORLD_DEFINITION_COUNTS[mapName]} world definitions, got ${definitions.length}`);
    }
    if (definitionsByIndex.size !== definitions.length) {
      failures.push(`${mapName}: duplicate world definition entity indexes`);
    }

    for (const definition of definitions) {
      if (definition.bounds) {
        assertFiniteVec3(definition.bounds.mins, `${mapName}:${definition.entityIndex} bounds.mins`);
        assertFiniteVec3(definition.bounds.maxs, `${mapName}:${definition.entityIndex} bounds.maxs`);
      }
      if (definition.kind === "mover") {
        assertFiniteVec3(definition.fromOrigin, `${mapName}:${definition.entityIndex} fromOrigin`);
        assertFiniteVec3(definition.toOrigin, `${mapName}:${definition.entityIndex} toOrigin`);
        if (!Number.isFinite(definition.speed) || definition.speed <= 0) {
          failures.push(`${mapName}:${definition.entityIndex}: invalid mover speed ${String(definition.speed)}`);
        }
        if (!Number.isFinite(definition.moveMs) || definition.moveMs < 0) {
          failures.push(`${mapName}:${definition.entityIndex}: invalid mover duration ${String(definition.moveMs)}`);
        }
      } else if (definition.kind === "teleport") {
        assertFiniteVec3(definition.destinationOrigin, `${mapName}:${definition.entityIndex} destinationOrigin`);
      } else if (definition.kind === "hurt" && (!Number.isFinite(definition.damage) || definition.damage <= 0)) {
        failures.push(`${mapName}:${definition.entityIndex}: invalid trigger_hurt damage ${String(definition.damage)}`);
      } else if (definition.kind === "push") {
        assertFiniteVec3(definition.velocity, `${mapName}:${definition.entityIndex} push velocity`);
      } else if (definition.kind === "changelevel" && !definition.targetMap) {
        failures.push(`${mapName}:${definition.entityIndex}: missing changelevel target map`);
      }

      const targetIndexes = [
        ...(definition.targetEntityIndexes ?? []),
        ...(definition.killtargetEntityIndexes ?? []),
      ];
      for (const targetIndex of targetIndexes) {
        if (definitionsByIndex.has(targetIndex)) continue;
        const targetClassname = entityByIndex.get(targetIndex)?.classname ?? "<missing>";
        if (SUPPORTED_SHARED_WORLD_TARGET_CLASSNAMES.has(targetClassname)) {
          failures.push(`${mapName}:${definition.entityIndex} targets unsupported missing shared entity ${targetIndex} ${targetClassname}`);
        } else if (!CLASSIFIED_UNSHARED_TARGET_CLASSNAMES.has(targetClassname)) {
          failures.push(`${mapName}:${definition.entityIndex} targets unclassified non-shared entity ${targetIndex} ${targetClassname}`);
        }
      }
    }
  }

  assert.deepEqual(failures, []);
});

test("world touch accepts a bounded local origin hint when the authoritative pose is one tick behind", () => {
  const resolution = world.resolveQuakeMultiplayerWorldIntent(
    createPlayer({ origin: [0, 0, 1] }),
    touchIntent({ origin: [1.2, 0, 1] }),
    [triggerDefinition()],
    100,
  );

  assert.equal(resolution.ok, true);
  assert.equal(resolution.kind, "trigger");
});

test("world touch accepts a local origin hint during vertical server prediction drift", () => {
  const resolution = world.resolveQuakeMultiplayerWorldIntent(
    createPlayer({ origin: [1.2, 0, 6] }),
    touchIntent({ origin: [1.2, 0, 1] }),
    [triggerDefinition()],
    100,
  );

  assert.equal(resolution.ok, true);
  assert.equal(resolution.kind, "trigger");
});

test("world touch rejects a forged origin hint far from the authoritative player", () => {
  const resolution = world.resolveQuakeMultiplayerWorldIntent(
    createPlayer({ origin: [0, 0, 1] }),
    touchIntent({ origin: [20, 0, 1] }),
    [triggerDefinition({
      bounds: {
        mins: [20, -1, 0],
        maxs: [21, 1, 1],
      },
    })],
    100,
  );

  assert.equal(resolution.ok, false);
  assert.equal(resolution.reason, "too-far");
});
