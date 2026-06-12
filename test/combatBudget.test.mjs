import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "./importTsModule.mjs";

const {
  QUAKE_COMBAT_BUDGET_LIMITS,
  createQuakeCombatBudgetRuntime,
  quakeCombatLogicalWeaponTargetIndexes,
} = await importTsModule("src/runtime/shootables/combatBudget.ts");

test("combat budget limits encode the fast-path stop line", () => {
  assert.deepEqual(QUAKE_COMBAT_BUDGET_LIMITS, {
    attackChainChecksPerFrame: 8,
    combatInterestSet: 12,
    domReads: 0,
    lineOfSightChecksPerFrame: 8,
    lineOfSightChecksPerSecond: 200,
    unmountedAiActiveSet: 4,
    unmountedAiCadenceHz: 5,
  });
});

test("combat budget runtime starts with expanded logical combat disabled", () => {
  const budget = createQuakeCombatBudgetRuntime();
  const stats = budget.debugStats();

  assert.equal(stats.expandedLogicalCombatEnabled, false);
  assert.equal(stats.unmountedAiEnabled, false);
  assert.equal(stats.combatInterestSetSize, 0);
  assert.equal(stats.unmountedAiActiveSetSize, 0);
  assert.equal(stats.counters.unmountedAiTicksTotal, 0);
  assert.equal(stats.counters.unmountedAiTickDeferralsTotal, 0);
  assert.equal(stats.counters.capDeferralsTotal, 0);
  assert.equal(stats.counters.domReadsTotal, 0);
});

test("combat budget runtime counts event-bound and frame-bound work", () => {
  const budget = createQuakeCombatBudgetRuntime();

  budget.recordWeaponTargetQuery();
  budget.recordWeaponTargetCandidate();
  budget.recordWeaponTargetCandidate();
  budget.recordWeaponTargetYield();
  budget.recordLineOfSightCheck(50);
  budget.beginEnemyFrame(100);
  budget.recordEnemyUpdate("skipped-unmounted");
  budget.recordEnemyUpdate("mounted-visible");
  budget.recordLineOfSightCheck(101);
  budget.recordAttackChainCheck(102);

  const stats = budget.debugStats();
  assert.equal(stats.counters.weaponTargetQueriesTotal, 1);
  assert.equal(stats.counters.weaponTargetCandidatesTotal, 2);
  assert.equal(stats.counters.weaponTargetsYieldedTotal, 1);
  assert.equal(stats.counters.lineOfSightChecksTotal, 2);
  assert.equal(stats.counters.lineOfSightChecksUnframedTotal, 1);
  assert.equal(stats.counters.enemyLoopFramesTotal, 1);
  assert.equal(stats.counters.enemyUpdateCandidatesTotal, 2);
  assert.equal(stats.counters.skippedUnmountedEnemyUpdatesTotal, 1);
  assert.equal(stats.counters.mountedVisibleEnemyUpdatesTotal, 1);
  assert.equal(stats.counters.attackChainChecksTotal, 1);
  assert.equal(stats.currentFrame.lineOfSightChecks, 1);
  assert.equal(stats.currentFrame.attackChainChecks, 1);
  assert.equal(stats.maxFrame.lineOfSightChecks, 1);
  assert.equal(stats.maxFrame.attackChainChecks, 1);
});

test("line-of-sight budget gate caps frame work and counts deferrals", () => {
  const budget = createQuakeCombatBudgetRuntime();
  budget.beginFrame(100);

  for (let index = 0; index < QUAKE_COMBAT_BUDGET_LIMITS.lineOfSightChecksPerFrame; index++) {
    assert.equal(budget.tryRecordLineOfSightCheck(101 + index), true);
  }
  assert.equal(budget.tryRecordLineOfSightCheck(200), false);

  const stats = budget.debugStats();
  assert.equal(stats.currentFrame.lineOfSightChecks, QUAKE_COMBAT_BUDGET_LIMITS.lineOfSightChecksPerFrame);
  assert.equal(stats.maxFrame.lineOfSightChecks, QUAKE_COMBAT_BUDGET_LIMITS.lineOfSightChecksPerFrame);
  assert.equal(stats.counters.capDeferralsTotal, 1);
});

test("combat interest set is bounded and evicts the oldest entry", () => {
  const budget = createQuakeCombatBudgetRuntime();

  for (let index = 1; index <= QUAKE_COMBAT_BUDGET_LIMITS.combatInterestSet; index++) {
    const result = budget.recordCombatInterest(index, index * 10);
    assert.deepEqual(result, { accepted: true, evictedEntityIndex: null });
  }

  const overflow = budget.recordCombatInterest(99, 999);
  const stats = budget.debugStats();

  assert.deepEqual(overflow, { accepted: true, evictedEntityIndex: 1 });
  assert.equal(stats.combatInterestSetSize, QUAKE_COMBAT_BUDGET_LIMITS.combatInterestSet);
  assert.equal(stats.combatInterestEntityIndexes.includes(1), false);
  assert.equal(stats.combatInterestEntityIndexes.includes(99), true);
  assert.equal(stats.counters.combatInterestAddsTotal, QUAKE_COMBAT_BUDGET_LIMITS.combatInterestSet + 1);
  assert.equal(stats.counters.combatInterestEvictionsTotal, 1);
});

test("combat interest refresh protects an entry from oldest-first eviction", () => {
  const budget = createQuakeCombatBudgetRuntime();

  for (let index = 1; index <= QUAKE_COMBAT_BUDGET_LIMITS.combatInterestSet; index++) {
    budget.recordCombatInterest(index, index * 10);
  }
  budget.recordCombatInterest(1, 10_000);
  const overflow = budget.recordCombatInterest(99, 10_001);
  const stats = budget.debugStats();

  assert.deepEqual(overflow, { accepted: true, evictedEntityIndex: 2 });
  assert.equal(stats.combatInterestEntityIndexes.includes(1), true);
  assert.equal(stats.combatInterestEntityIndexes.includes(2), false);
});

test("expanded logical combat exposes interest membership and clears it on disable", () => {
  const budget = createQuakeCombatBudgetRuntime();

  assert.equal(budget.expandedLogicalCombatEnabled(), false);
  assert.equal(budget.hasCombatInterest(7), false);

  budget.setExpandedLogicalCombatEnabled(true);
  budget.recordCombatInterest(7, 100);
  assert.equal(budget.expandedLogicalCombatEnabled(), true);
  assert.equal(budget.hasCombatInterest(7), true);

  budget.setExpandedLogicalCombatEnabled(false);
  const stats = budget.debugStats();
  assert.equal(budget.expandedLogicalCombatEnabled(), false);
  assert.equal(budget.hasCombatInterest(7), false);
  assert.equal(stats.combatInterestSetSize, 0);
  assert.equal(stats.unmountedAiEnabled, false);
  assert.equal(stats.unmountedAiActiveSetSize, 0);
});

test("logical targetability model includes live unmounted combat-interest targets", () => {
  const targets = quakeCombatLogicalWeaponTargetIndexes([
    {
      combatInterested: false,
      entityIndex: 1,
      inLineOfFire: true,
      live: true,
      mounted: true,
      visible: true,
    },
    {
      combatInterested: true,
      entityIndex: 2,
      inLineOfFire: true,
      live: true,
      mounted: false,
      visible: false,
    },
    {
      combatInterested: false,
      entityIndex: 3,
      inLineOfFire: true,
      live: true,
      mounted: false,
      visible: false,
    },
    {
      combatInterested: true,
      entityIndex: 4,
      inLineOfFire: false,
      live: true,
      mounted: false,
      visible: false,
    },
    {
      combatInterested: true,
      entityIndex: 5,
      inLineOfFire: true,
      live: false,
      mounted: false,
      visible: false,
    },
  ]);

  assert.deepEqual(targets, [1, 2]);
});

test("logical targetability model stays bounded under over-mount-budget candidates", () => {
  const candidates = Array.from({ length: QUAKE_COMBAT_BUDGET_LIMITS.combatInterestSet + 3 }, (_, index) => ({
    combatInterested: true,
    entityIndex: index + 1,
    inLineOfFire: true,
    live: true,
    mounted: index < 5,
    visible: index < 5,
  }));

  const targets = quakeCombatLogicalWeaponTargetIndexes(candidates);

  assert.equal(targets.length, QUAKE_COMBAT_BUDGET_LIMITS.combatInterestSet);
  assert.deepEqual(targets.slice(0, 6), [1, 2, 3, 4, 5, 6]);
  assert.equal(targets.includes(QUAKE_COMBAT_BUDGET_LIMITS.combatInterestSet + 1), false);
});

test("manual cap deferrals are counted for future scheduler harnesses", () => {
  const budget = createQuakeCombatBudgetRuntime();
  budget.recordCapDeferral();
  budget.recordCapDeferral();

  assert.equal(budget.debugStats().counters.capDeferralsTotal, 2);
});

test("unmounted AI scheduler is disabled until both switches are enabled", () => {
  const budget = createQuakeCombatBudgetRuntime();
  budget.recordCombatInterest(7, 100);

  assert.deepEqual(budget.tryStartUnmountedAiTick(7, 200), {
    accepted: false,
    reason: "disabled",
  });

  budget.setUnmountedAiEnabled(true);
  assert.deepEqual(budget.tryStartUnmountedAiTick(7, 300), {
    accepted: false,
    reason: "disabled",
  });

  budget.setExpandedLogicalCombatEnabled(true);
  budget.setUnmountedAiEnabled(true);
  assert.deepEqual(budget.tryStartUnmountedAiTick(7, 400), {
    accepted: true,
    reason: "accepted",
  });

  const stats = budget.debugStats();
  assert.equal(stats.expandedLogicalCombatEnabled, true);
  assert.equal(stats.unmountedAiEnabled, true);
  assert.equal(stats.counters.unmountedAiTicksTotal, 1);
  assert.equal(stats.counters.unmountedAiTickDeferralsTotal, 2);
});

test("unmounted AI scheduler enforces interest, cadence, and active-set caps", () => {
  const budget = createQuakeCombatBudgetRuntime();
  budget.setExpandedLogicalCombatEnabled(true);
  budget.setUnmountedAiEnabled(true);

  assert.deepEqual(budget.tryStartUnmountedAiTick(99, 100), {
    accepted: false,
    reason: "not-interested",
  });

  for (let index = 1; index <= QUAKE_COMBAT_BUDGET_LIMITS.unmountedAiActiveSet + 1; index++) {
    budget.recordCombatInterest(index, index);
  }

  assert.deepEqual(budget.tryStartUnmountedAiTick(1, 200), {
    accepted: true,
    reason: "accepted",
  });
  assert.deepEqual(budget.tryStartUnmountedAiTick(1, 250), {
    accepted: false,
    reason: "cadence",
  });

  for (let index = 2; index <= QUAKE_COMBAT_BUDGET_LIMITS.unmountedAiActiveSet; index++) {
    assert.deepEqual(budget.tryStartUnmountedAiTick(index, 200), {
      accepted: true,
      reason: "accepted",
    });
  }
  assert.deepEqual(budget.tryStartUnmountedAiTick(QUAKE_COMBAT_BUDGET_LIMITS.unmountedAiActiveSet + 1, 200), {
    accepted: false,
    reason: "capacity",
  });

  let stats = budget.debugStats();
  assert.equal(stats.unmountedAiActiveSetSize, QUAKE_COMBAT_BUDGET_LIMITS.unmountedAiActiveSet);
  assert.equal(stats.counters.capDeferralsTotal, 1);
  assert.equal(stats.counters.unmountedAiTickDeferralsTotal, 3);

  budget.completeUnmountedAiTick(1);
  assert.deepEqual(budget.tryStartUnmountedAiTick(QUAKE_COMBAT_BUDGET_LIMITS.unmountedAiActiveSet + 1, 500), {
    accepted: true,
    reason: "accepted",
  });
  stats = budget.debugStats();
  assert.equal(stats.unmountedAiActiveSetSize, QUAKE_COMBAT_BUDGET_LIMITS.unmountedAiActiveSet);
});

test("disable switch clears unmounted AI while preserving event-bound counters", () => {
  const budget = createQuakeCombatBudgetRuntime();
  budget.setExpandedLogicalCombatEnabled(true);
  budget.setUnmountedAiEnabled(true);
  budget.recordCombatInterest(7, 100);
  budget.recordWeaponTargetQuery();
  assert.deepEqual(budget.tryStartUnmountedAiTick(7, 200), {
    accepted: true,
    reason: "accepted",
  });

  budget.setExpandedLogicalCombatEnabled(false);
  const stats = budget.debugStats();

  assert.equal(stats.expandedLogicalCombatEnabled, false);
  assert.equal(stats.unmountedAiEnabled, false);
  assert.equal(stats.unmountedAiActiveSetSize, 0);
  assert.equal(stats.counters.weaponTargetQueriesTotal, 1);
  assert.ok(stats.counters.disableSwitchActivationsTotal >= 2);
});

test("combat budget reset clears counters and preserves limits", () => {
  const budget = createQuakeCombatBudgetRuntime();
  budget.beginEnemyFrame(100);
  budget.recordLineOfSightCheck(101);
  budget.recordAttackChainCheck(102);
  budget.reset();

  const stats = budget.debugStats();
  assert.deepEqual(stats.limits, QUAKE_COMBAT_BUDGET_LIMITS);
  assert.equal(stats.counters.lineOfSightChecksTotal, 0);
  assert.equal(stats.counters.attackChainChecksTotal, 0);
  assert.equal(stats.currentFrame.startedAtMs, 0);
  assert.equal(stats.maxFrame.lineOfSightChecks, 0);
});
