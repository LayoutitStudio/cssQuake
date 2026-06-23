import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const entities = await importTsModule("src/runtime/entities.ts");

function entityWithSpawnflags(spawnflags) {
  return {
    index: 1,
    classname: "item_shells",
    properties: {
      spawnflags: String(spawnflags),
    },
  };
}

test("deathmatch spawn filtering ignores skill-only exclusion flags", () => {
  const deathmatchOnly = entityWithSpawnflags(256 | 512 | 1024);

  assert.equal(entities.shouldSpawnQuakeEntityForGameMode(deathmatchOnly, { skill: 0 }), false);
  assert.equal(entities.shouldSpawnQuakeEntityForGameMode(deathmatchOnly, { skill: 1 }), false);
  assert.equal(entities.shouldSpawnQuakeEntityForGameMode(deathmatchOnly, { skill: 2 }), false);
  assert.equal(entities.shouldSpawnQuakeEntityForGameMode(deathmatchOnly, { deathmatch: true }), true);
});

test("deathmatch spawn filtering rejects NOT_DEATHMATCH entities", () => {
  assert.equal(
    entities.shouldSpawnQuakeEntityForGameMode(entityWithSpawnflags(2048), { deathmatch: true }),
    false,
  );
});
