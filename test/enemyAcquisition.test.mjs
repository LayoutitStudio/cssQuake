import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "./importTsModule.mjs";

const {
  createQuakeEnemyAcquisitionVisibilityCache,
  quakeEnemyAcquisitionInFront,
  quakeEnemyAcquisitionRangeFromSourceUnits,
  quakeEnemyFindTarget,
} = await importTsModule("src/runtime/shootables/enemyAcquisition.ts");

const FL_NOTARGET = 128;
const IT_INVISIBILITY = 524_288;

function monster(overrides = {}) {
  return {
    classname: "monster_army",
    id: "monster",
    origin: [0, 0, 0],
    spawnflags: 0,
    viewOffset: [0, 0, 0],
    yaw: 0,
    ...overrides,
  };
}

function player(overrides = {}) {
  return {
    classname: "player",
    health: 100,
    id: "player",
    inPvs: true,
    origin: [240, 0, 0],
    showHostileUntilSeconds: 0,
    viewOffset: [0, 0, 0],
    ...overrides,
  };
}

function acquisition(overrides = {}) {
  let losCalls = 0;
  let budgetCalls = 0;
  const losResult = overrides.losResult ?? true;
  const budgetResult = overrides.budgetResult ?? true;
  const result = quakeEnemyFindTarget({
    checkClient: overrides.checkClient === undefined ? player(overrides.player ?? {}) : overrides.checkClient,
    hasLineOfSight: (...args) => {
      losCalls += 1;
      return typeof losResult === "function" ? losResult(...args) : losResult;
    },
    monster: monster(overrides.monster ?? {}),
    nowSeconds: overrides.nowSeconds ?? 10,
    sightEntity: overrides.sightEntity,
    sourceUnitScale: overrides.sourceUnitScale,
    trySpendLineOfSightCheck: overrides.withoutBudget
      ? undefined
      : () => {
          budgetCalls += 1;
          return typeof budgetResult === "function" ? budgetResult() : budgetResult;
        },
    visibilityCache: overrides.visibilityCache,
  });
  return { budgetCalls, losCalls, result };
}

test("source range thresholds match QuakeC range()", () => {
  assert.equal(quakeEnemyAcquisitionRangeFromSourceUnits(119.99), "melee");
  assert.equal(quakeEnemyAcquisitionRangeFromSourceUnits(120), "near");
  assert.equal(quakeEnemyAcquisitionRangeFromSourceUnits(499.99), "near");
  assert.equal(quakeEnemyAcquisitionRangeFromSourceUnits(500), "mid");
  assert.equal(quakeEnemyAcquisitionRangeFromSourceUnits(999.99), "mid");
  assert.equal(quakeEnemyAcquisitionRangeFromSourceUnits(1000), "far");
});

test("runtime-scaled callers can pass an explicit source unit scale", () => {
  const sourceUnitScale = 0.02;
  const near = acquisition({
    player: { origin: [240 * sourceUnitScale, 0, 0] },
    sourceUnitScale,
  });
  const far = acquisition({
    player: { origin: [1200 * sourceUnitScale, 0, 0] },
    sourceUnitScale,
  });

  assert.equal(near.result.acquired, true);
  assert.equal(near.result.range, "near");
  assert.equal(far.result.acquired, false);
  assert.equal(far.result.range, "far");
  assert.equal(far.result.reason, "far");
  assert.equal(far.losCalls, 0);
});

test("source infront gate uses a yaw forward dot greater than 0.3", () => {
  assert.equal(quakeEnemyAcquisitionInFront(monster({ yaw: 0 }), player({ origin: [240, 0, 0] })), true);
  assert.equal(quakeEnemyAcquisitionInFront(monster({ yaw: 0 }), player({ origin: [-240, 0, 0] })), false);
  assert.equal(quakeEnemyAcquisitionInFront(monster({ yaw: 90 }), player({ origin: [0, 240, 0] })), true);
  assert.equal(quakeEnemyAcquisitionInFront(monster({ yaw: 90 }), player({ origin: [240, 0, 0] })), false);
});

test("acquisition rejects non-viable clients before spending LOS", () => {
  const cases = [
    {
      name: "dead target",
      player: { health: 0 },
      reason: "dead-target",
    },
    {
      name: "FL_NOTARGET",
      player: { flags: FL_NOTARGET },
      reason: "notarget",
    },
    {
      name: "notarget boolean",
      player: { notarget: true },
      reason: "notarget",
    },
    {
      name: "IT_INVISIBILITY",
      player: { items: IT_INVISIBILITY },
      reason: "invisibility",
    },
    {
      name: "invisible boolean",
      player: { invisible: true },
      reason: "invisibility",
    },
    {
      name: "far target",
      player: { origin: [1200, 0, 0] },
      reason: "far",
    },
    {
      name: "near behind and not hostile",
      player: { origin: [-240, 0, 0], showHostileUntilSeconds: 0 },
      reason: "behind-near",
    },
    {
      name: "mid behind even when hostile",
      player: { origin: [-700, 0, 0], showHostileUntilSeconds: 20 },
      reason: "behind-mid",
    },
  ];

  for (const entry of cases) {
    const { budgetCalls, losCalls, result } = acquisition({ player: entry.player });
    assert.equal(result.acquired, false, entry.name);
    assert.equal(result.reason, entry.reason, entry.name);
    assert.equal(result.lineOfSight, "not-needed", entry.name);
    assert.equal(budgetCalls, 0, entry.name);
    assert.equal(losCalls, 0, entry.name);
  }
});

test("acquisition rejects a missing or non-PVS checkclient without LOS", () => {
  for (const checkClient of [null, player({ inPvs: false })]) {
    const { budgetCalls, losCalls, result } = acquisition({ checkClient });
    assert.equal(result.acquired, false);
    assert.equal(result.reason, "no-client");
    assert.equal(result.candidateId, null);
    assert.equal(budgetCalls, 0);
    assert.equal(losCalls, 0);
  }
});

test("melee target can be acquired from behind but still needs visibility", () => {
  const { budgetCalls, losCalls, result } = acquisition({
    player: { origin: [-80, 0, 0], showHostileUntilSeconds: 0 },
  });

  assert.equal(result.acquired, true);
  assert.equal(result.reason, "acquired");
  assert.equal(result.range, "melee");
  assert.equal(result.inFront, null);
  assert.equal(result.visible, true);
  assert.equal(result.lineOfSight, "computed");
  assert.equal(budgetCalls, 1);
  assert.equal(losCalls, 1);
});

test("near target behind the monster can be acquired while show_hostile is active", () => {
  const { budgetCalls, losCalls, result } = acquisition({
    player: { origin: [-240, 0, 0], showHostileUntilSeconds: 20 },
  });

  assert.equal(result.acquired, true);
  assert.equal(result.reason, "acquired");
  assert.equal(result.range, "near");
  assert.equal(result.inFront, null);
  assert.equal(result.visible, true);
  assert.equal(budgetCalls, 1);
  assert.equal(losCalls, 1);
});

test("mid target behind the monster is rejected even while show_hostile is active", () => {
  const { budgetCalls, losCalls, result } = acquisition({
    player: { origin: [-700, 0, 0], showHostileUntilSeconds: 20 },
  });

  assert.equal(result.acquired, false);
  assert.equal(result.reason, "behind-mid");
  assert.equal(result.range, "mid");
  assert.equal(result.inFront, false);
  assert.equal(budgetCalls, 0);
  assert.equal(losCalls, 0);
});

test("visible candidate acquires and blocked LOS rejects after the budgeted trace", () => {
  const hit = acquisition({ player: { origin: [240, 0, 0] } });
  assert.equal(hit.result.acquired, true);
  assert.equal(hit.result.reason, "acquired");
  assert.equal(hit.result.range, "near");
  assert.equal(hit.result.inFront, true);
  assert.equal(hit.result.lineOfSight, "computed");
  assert.equal(hit.result.targetId, "player");
  assert.equal(hit.budgetCalls, 1);
  assert.equal(hit.losCalls, 1);

  const blocked = acquisition({ losResult: false, player: { origin: [240, 0, 0] } });
  assert.equal(blocked.result.acquired, false);
  assert.equal(blocked.result.reason, "not-visible");
  assert.equal(blocked.result.visible, false);
  assert.equal(blocked.result.lineOfSight, "computed");
  assert.equal(blocked.budgetCalls, 1);
  assert.equal(blocked.losCalls, 1);
});

test("LOS budget denial defers acquisition without calling the trace", () => {
  const { budgetCalls, losCalls, result } = acquisition({
    budgetResult: false,
    player: { origin: [240, 0, 0] },
  });

  assert.equal(result.acquired, false);
  assert.equal(result.deferred, true);
  assert.equal(result.reason, "los-budget");
  assert.equal(result.lineOfSight, "budget-denied");
  assert.equal(result.visible, null);
  assert.equal(budgetCalls, 1);
  assert.equal(losCalls, 0);
});

test("visibility cache reuses recent LOS and expires by TTL", () => {
  const cache = createQuakeEnemyAcquisitionVisibilityCache({ ttlSeconds: 0.25 });
  const first = acquisition({
    nowSeconds: 10,
    player: { origin: [240, 0, 0] },
    visibilityCache: cache,
  });
  assert.equal(first.result.acquired, true);
  assert.equal(first.result.lineOfSight, "computed");
  assert.equal(first.budgetCalls, 1);
  assert.equal(first.losCalls, 1);
  assert.equal(cache.size(), 1);

  const cached = acquisition({
    budgetResult: false,
    nowSeconds: 10.1,
    player: { origin: [240, 0, 0] },
    visibilityCache: cache,
  });
  assert.equal(cached.result.acquired, true);
  assert.equal(cached.result.lineOfSight, "cached");
  assert.equal(cached.budgetCalls, 0);
  assert.equal(cached.losCalls, 0);

  const expired = acquisition({
    budgetResult: false,
    nowSeconds: 10.5,
    player: { origin: [240, 0, 0] },
    visibilityCache: cache,
  });
  assert.equal(expired.result.acquired, false);
  assert.equal(expired.result.reason, "los-budget");
  assert.equal(expired.budgetCalls, 1);
  assert.equal(expired.losCalls, 0);
});

test("visibility cache key includes positions so moved targets recompute LOS", () => {
  const cache = createQuakeEnemyAcquisitionVisibilityCache();
  const first = acquisition({
    nowSeconds: 10,
    player: { origin: [240, 0, 0] },
    visibilityCache: cache,
  });
  const moved = acquisition({
    nowSeconds: 10.05,
    player: { origin: [260, 0, 0] },
    visibilityCache: cache,
  });

  assert.equal(first.result.lineOfSight, "computed");
  assert.equal(moved.result.lineOfSight, "computed");
  assert.equal(moved.budgetCalls, 1);
  assert.equal(moved.losCalls, 1);
});

test("recent sight_entity can stand in for checkclient unless ambush flags block it", () => {
  const sightPlayer = player({ id: "sight-player", origin: [400, 0, 0] });
  const sightMonster = player({
    classname: "monster_army",
    enemy: sightPlayer,
    id: "sight-monster",
    origin: [240, 0, 0],
  });
  const open = acquisition({
    checkClient: null,
    sightEntity: { entity: sightMonster, seenAtSeconds: 9.95 },
  });
  assert.equal(open.result.acquired, true);
  assert.equal(open.result.usedSightEntity, true);
  assert.equal(open.result.candidateId, "sight-monster");
  assert.equal(open.result.targetId, "sight-player");
  assert.equal(open.budgetCalls, 1);
  assert.equal(open.losCalls, 1);

  for (const spawnflags of [1, 2, 3]) {
    const blocked = acquisition({
      checkClient: null,
      monster: { spawnflags },
      sightEntity: { entity: sightMonster, seenAtSeconds: 9.95 },
    });
    assert.equal(blocked.result.acquired, false, `spawnflags ${spawnflags}`);
    assert.equal(blocked.result.reason, "no-client", `spawnflags ${spawnflags}`);
    assert.equal(blocked.result.usedSightEntity, false, `spawnflags ${spawnflags}`);
    assert.equal(blocked.budgetCalls, 0, `spawnflags ${spawnflags}`);
    assert.equal(blocked.losCalls, 0, `spawnflags ${spawnflags}`);
  }
});

test("sight_entity is ignored when it already points at the current enemy", () => {
  const sightPlayer = player({ id: "player-current", origin: [400, 0, 0] });
  const sightMonster = player({
    classname: "monster_army",
    enemy: sightPlayer,
    id: "sight-monster",
    origin: [240, 0, 0],
  });
  const { budgetCalls, losCalls, result } = acquisition({
    checkClient: null,
    monster: { currentEnemyId: "player-current" },
    sightEntity: { entity: sightMonster, seenAtSeconds: 9.95 },
  });

  assert.equal(result.acquired, false);
  assert.equal(result.reason, "same-enemy");
  assert.equal(result.usedSightEntity, true);
  assert.equal(budgetCalls, 0);
  assert.equal(losCalls, 0);
});

test("non-player proxy without a player enemy fails before LOS", () => {
  const proxy = player({
    classname: "monster_army",
    enemy: player({ classname: "monster_dog", id: "dog" }),
    id: "proxy",
    origin: [240, 0, 0],
  });
  const { budgetCalls, losCalls, result } = acquisition({ checkClient: proxy });

  assert.equal(result.acquired, false);
  assert.equal(result.reason, "non-player-proxy");
  assert.equal(budgetCalls, 0);
  assert.equal(losCalls, 0);
});
