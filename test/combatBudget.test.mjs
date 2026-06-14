import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "./importTsModule.mjs";

const {
  QUAKE_COMBAT_BUDGET_LIMITS,
  createQuakeCombatBudgetRuntime,
  quakeCombatLogicalWeaponTargetIndexes,
} = await importTsModule("src/runtime/shootables/combatBudget.ts");

test("mounted enemy acquisition switch defaults on and stays independent from broad combat flags", () => {
  const budget = createQuakeCombatBudgetRuntime();

  assert.equal(budget.mountedEnemyAcquisitionEnabled(), true);
  assert.equal(budget.expandedLogicalCombatEnabled(), false);
  assert.equal(budget.debugStats().mountedEnemyAcquisitionEnabled, true);

  budget.setMountedEnemyAcquisitionEnabled(false);
  assert.equal(budget.mountedEnemyAcquisitionEnabled(), false);
  assert.equal(budget.expandedLogicalCombatEnabled(), false);
  assert.equal(budget.debugStats().mountedEnemyAcquisitionEnabled, false);
  assert.equal(budget.debugStats().counters.disableSwitchActivationsTotal, 1);

  budget.setExpandedLogicalCombatEnabled(true);
  assert.equal(budget.expandedLogicalCombatEnabled(), true);
  assert.equal(budget.mountedEnemyAcquisitionEnabled(), false);

  budget.reset();
  assert.equal(budget.expandedLogicalCombatEnabled(), false);
  assert.equal(budget.mountedEnemyAcquisitionEnabled(), true);
  assert.equal(budget.debugStats().mountedEnemyAcquisitionEnabled, true);
});

test("combat budget exposes the initial fast-path caps", () => {
  assert.deepEqual(QUAKE_COMBAT_BUDGET_LIMITS, {
    ambientPathCadenceHz: 5,
    ambientPathTicksPerFrame: 1,
    ambientPathTicksPerSecond: 30,
    attackChainChecksPerFrame: 8,
    combatInterestSet: 12,
    domReads: 0,
    lineOfSightChecksPerFrame: 8,
    lineOfSightChecksPerSecond: 200,
    unmountedAiActiveSet: 4,
    unmountedAiCadenceHz: 5,
  });
});

test("ambient path scheduler is frame-capped and per-entity cadenced", () => {
  const budget = createQuakeCombatBudgetRuntime();

  assert.deepEqual(budget.tryStartAmbientPathTick(1, 1000), { accepted: true, reason: "accepted" });
  assert.deepEqual(budget.tryStartAmbientPathTick(2, 1000), { accepted: false, reason: "frame-cap" });
  budget.beginFrame(1100);
  assert.deepEqual(budget.tryStartAmbientPathTick(1, 1100), { accepted: false, reason: "cadence" });
  assert.deepEqual(budget.tryStartAmbientPathTick(2, 1100), { accepted: true, reason: "accepted" });
  budget.beginFrame(1200);
  assert.deepEqual(budget.tryStartAmbientPathTick(1, 1200), { accepted: true, reason: "accepted" });

  const stats = budget.debugStats();
  assert.equal(stats.counters.ambientPathTicksTotal, 3);
  assert.equal(stats.counters.ambientPathTickDeferralsTotal, 2);
  assert.equal(stats.maxFrame.ambientPathTicks, QUAKE_COMBAT_BUDGET_LIMITS.ambientPathTicksPerFrame);
});

test("ambient path scheduler enforces a global per-second cap", () => {
  const budget = createQuakeCombatBudgetRuntime();

  for (let entityIndex = 1; entityIndex <= QUAKE_COMBAT_BUDGET_LIMITS.ambientPathTicksPerSecond; entityIndex += 1) {
    budget.beginFrame(1000 + entityIndex);
    assert.deepEqual(budget.tryStartAmbientPathTick(entityIndex, 1000 + entityIndex), {
      accepted: true,
      reason: "accepted",
    });
  }
  budget.beginFrame(1100);
  assert.deepEqual(budget.tryStartAmbientPathTick(999, 1100), { accepted: false, reason: "second-cap" });
});

test("logical weapon target indexes include mounted-visible or combat-interested live targets only", () => {
  const indexes = quakeCombatLogicalWeaponTargetIndexes([
    { combatInterested: false, entityIndex: 1, inLineOfFire: true, live: true, mounted: true, visible: true },
    { combatInterested: true, entityIndex: 2, inLineOfFire: true, live: true, mounted: false, visible: false },
    { combatInterested: true, entityIndex: 3, inLineOfFire: false, live: true, mounted: false, visible: false },
    { combatInterested: true, entityIndex: 4, inLineOfFire: true, live: false, mounted: false, visible: false },
    { combatInterested: false, entityIndex: 5, inLineOfFire: true, live: true, mounted: false, visible: false },
  ]);

  assert.deepEqual(indexes, [1, 2]);
});

test("combat interest set is capped and evicts oldest entries", () => {
  const budget = createQuakeCombatBudgetRuntime();
  budget.setExpandedLogicalCombatEnabled(true);

  for (let entityIndex = 1; entityIndex <= QUAKE_COMBAT_BUDGET_LIMITS.combatInterestSet + 2; entityIndex += 1) {
    const result = budget.recordCombatInterest(entityIndex, entityIndex * 10);
    assert.equal(result.accepted, true);
  }

  const stats = budget.debugStats();
  assert.equal(stats.combatInterestSetSize, QUAKE_COMBAT_BUDGET_LIMITS.combatInterestSet);
  assert.equal(stats.counters.combatInterestAddsTotal, QUAKE_COMBAT_BUDGET_LIMITS.combatInterestSet + 2);
  assert.equal(stats.counters.combatInterestEvictionsTotal, 2);
  assert.equal(budget.hasCombatInterest(1), false);
  assert.equal(budget.hasCombatInterest(2), false);
  assert.equal(budget.hasCombatInterest(3), true);
});

test("unmounted AI scheduler is disabled by default and requires combat interest", () => {
  const budget = createQuakeCombatBudgetRuntime();

  assert.deepEqual(budget.tryStartUnmountedAiTick(1, 0), { accepted: false, reason: "disabled" });
  budget.setUnmountedAiEnabled(true);
  assert.deepEqual(budget.tryStartUnmountedAiTick(1, 100), { accepted: false, reason: "disabled" });
  budget.setExpandedLogicalCombatEnabled(true);
  assert.deepEqual(budget.tryStartUnmountedAiTick(1, 200), { accepted: false, reason: "disabled" });
  budget.setUnmountedAiEnabled(true);
  assert.deepEqual(budget.tryStartUnmountedAiTick(1, 300), { accepted: false, reason: "not-interested" });

  budget.recordCombatInterest(1, 300);
  assert.deepEqual(budget.tryStartUnmountedAiTick(1, 400), { accepted: true, reason: "accepted" });
  budget.completeUnmountedAiTick(1);
});

test("unmounted AI scheduler enforces cadence and active-set cap", () => {
  const budget = createQuakeCombatBudgetRuntime();
  budget.setExpandedLogicalCombatEnabled(true);
  budget.setUnmountedAiEnabled(true);

  for (let entityIndex = 1; entityIndex <= 5; entityIndex += 1) {
    budget.recordCombatInterest(entityIndex, 0);
  }

  assert.deepEqual(budget.tryStartUnmountedAiTick(1, 1000), { accepted: true, reason: "accepted" });
  budget.completeUnmountedAiTick(1);
  assert.deepEqual(budget.tryStartUnmountedAiTick(1, 1100), { accepted: false, reason: "cadence" });
  assert.deepEqual(budget.tryStartUnmountedAiTick(1, 1200), { accepted: true, reason: "accepted" });

  for (let entityIndex = 2; entityIndex <= 4; entityIndex += 1) {
    assert.deepEqual(budget.tryStartUnmountedAiTick(entityIndex, 1200), { accepted: true, reason: "accepted" });
  }
  assert.deepEqual(budget.tryStartUnmountedAiTick(5, 1200), { accepted: false, reason: "capacity" });

  const stats = budget.debugStats();
  assert.equal(stats.unmountedAiActiveSetSize, QUAKE_COMBAT_BUDGET_LIMITS.unmountedAiActiveSet);
  assert.equal(stats.counters.unmountedAiTicksTotal, 5);
  assert.equal(stats.counters.capDeferralsTotal, 1);
});
