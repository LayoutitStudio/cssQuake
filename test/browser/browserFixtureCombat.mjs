import {
  defineBrowserFixture,
  runDebugMapFixture,
} from "./fixtureHarness.mjs";

const LOGICAL_MAP = "e1m1";
const LOGICAL_ANCHOR_ENTITY = 21;
const LOGICAL_TARGET_ORIGIN = { x: 616, y: 72, z: 40 };
const LOGICAL_VIEW_DISTANCE = 4.96;
const LOGICAL_VIEW_ROT_X = 90;
const LOGICAL_VIEW_ROT_Y = 90;
const LOGICAL_SOURCE_REFERENCE = {
  engine: "Quake/vkQuake",
  monsterClassname: "monster_army",
  monsterHealth: 30,
  weapon: "rocketlauncher",
  directDamage: 100,
  expectedKilled: true,
  targetOrigin: LOGICAL_TARGET_ORIGIN,
  playerOrigin: { x: 616, y: 320, z: 75 },
  playerAngles: { pitch: 0, yaw: 270, roll: 0 },
  comparison: "same map-space target path; cssQuake damage must pass through weaponTargets() while the target is unmounted",
};
const LOGICAL_CANDIDATE_ENTITIES = [
  [21, 616, 72, 40],
  [100, 248, 2392, 40],
  [245, 0, 576, 24],
  [246, 8, 1520, -200],
  [247, 88, 1520, -200],
  [248, 224, 1552, -200],
  [249, -8, 936, -200],
  [250, 648, 736, 104],
  [255, 1312, 936, -248],
  [256, 1336, 1784, -408],
  [257, 1392, 928, -248],
  [258, 1384, 1008, -248],
  [259, 1240, 1008, -248],
  [260, 1256, 1760, -408],
  [261, 824, 1784, -408],
  [262, 1128, 1760, -408],
  [265, 1232, 2088, -216],
  [266, 1232, 2448, -280],
  [267, 832, 2464, -344],
  [268, 832, 2072, -408],
  [269, 840, 1960, -408],
  [277, 416, 1912, -168],
  [278, 432, 2120, -168],
  [283, 80, 2024, -184],
  [284, -16, 1888, -184],
  [285, -248, 2144, -136],
  [288, -432, 2352, 56],
  [289, -544, 2584, 56],
  [290, -344, 2656, -104],
  [291, -72, 2896, -56],
  [292, 432, 2920, -56],
  [293, 424, 2832, -56],
  [298, 424, 2672, -56],
  [299, 424, 2880, -56],
  [300, 424, 2760, -56],
  [303, 848, 2584, -72],
  [304, 824, 2008, -152],
  [306, 248, 2352, 40],
  [307, -72, 2464, 40],
  [308, 904, 1024, -248],
  [349, 288, 1536, -200],
  [350, 968, 2432, -112],
].map(([entityIndex, x, y, z]) => ({ entityIndex, x, y, z }));

const COMBAT_MAP = "e1m1";
const COMBAT_FOCUS_ENTITY = 298;

export const combatBudgetFixture = defineBrowserFixture({
  id: "combat-budget",
  label: "Combat budget browser fixture",
  artifact: "bench/results/quake/combat-budget-harness-smoke-summary.json",
  family: "combat",
  mapName: COMBAT_MAP,
  run: runCombatBudgetFixture,
});

export const logicalTargetabilityFixture = defineBrowserFixture({
  id: "logical-targetability",
  label: "Logical targetability browser fixture",
  artifact: "bench/results/quake/logical-targetability-smoke-summary.json",
  family: "combat",
  mapName: LOGICAL_MAP,
  run: runLogicalTargetabilityFixture,
});

async function runCombatBudgetFixture({ browser, baseUrl, options }) {
  return await runDebugMapFixture({
    browser,
    baseUrl,
    options,
    mapName: COMBAT_MAP,
    run: async ({ page, pageErrors }) => {
    const result = await page.evaluate(async ({ entityIndex }) => {
      const debug = window.__cssQuakeDebug;
      if (!debug?.stats) return { hasDebug: false };
      const beforeStats = debug.stats();
      const before = beforeStats.shootables?.combatBudget ?? null;
      const focusOk = Boolean(debug.focusEntity?.(entityIndex, 4.5, 90, 45));
      debug.setWeapon?.("shotgun");
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const fired = Boolean(debug.fire?.());
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const afterStats = debug.stats();
      return {
        after: afterStats.shootables?.combatBudget ?? null,
        before,
        fired,
        focusOk,
        hasDebug: true,
        mapName: afterStats.mapName ?? null,
      };
    }, { entityIndex: COMBAT_FOCUS_ENTITY });
    result.pageErrors = pageErrors;
    const failures = validateCombatBudgetResult(result);
    if (failures.length) throw new Error(`Combat budget harness failed: ${failures.join("; ")}`);
    console.log("PASS combat budget caps and event-bound weapon target counters");
    return {
      generatedAt: new Date().toISOString(),
      kind: "cssquake-combat-budget-browser-fixture",
      mapName: COMBAT_MAP,
      pass: true,
      result,
      failures,
    };
    },
  });
}

async function runLogicalTargetabilityFixture({ browser, baseUrl, options }) {
  return await runDebugMapFixture({
    browser,
    baseUrl,
    options,
    mapName: LOGICAL_MAP,
    run: async ({ page, pageErrors }) => {
    const result = await page.evaluate(async ({
      anchorEntity,
      candidateEntities,
      sourceReference,
      targetOrigin,
      viewDistance,
      viewRotX,
      viewRotY,
    }) => {
      const debug = window.__cssQuakeDebug;
      if (!debug?.stats) return { hasDebug: false };

      debug.setExpandedLogicalCombat?.(false);
      debug.setUnmountedAi?.(false);
      const activeCandidates = [];
      for (const candidate of candidateEntities) {
        if (debug.setEntityOrigin?.(candidate.entityIndex, candidate.x, candidate.y, candidate.z)) {
          activeCandidates.push(candidate);
        }
      }
      const preferredBlockerIndexes = [246, 247, 255, 265, 298, 245, 248, 249, 250, 256, 257];
      const blockerFixtures = preferredBlockerIndexes
        .map((entityIndex) => activeCandidates.find((candidate) => candidate.entityIndex === entityIndex))
        .filter(Boolean);
      const targetFixture = activeCandidates.find((candidate) => !preferredBlockerIndexes.includes(candidate.entityIndex)) ?? null;
      const fixtureCandidates = targetFixture ? [targetFixture, ...blockerFixtures] : [];
      const blockerOffsets = [
        [-48, 0], [-32, 0], [-16, 0], [0, 0], [16, 0], [32, 0],
        [-40, -16], [-20, -16], [0, -16], [20, -16], [40, -16],
      ];
      const blockers = blockerFixtures.map((fixture, index) => {
        const [xOffset, yOffset] = blockerOffsets[index] ?? [0, -32 - index * 8];
        return {
          entityIndex: fixture.entityIndex,
          x: 616 + xOffset,
          y: 260 + yOffset,
          z: 40,
        };
      });
      const targetEntity = targetFixture?.entityIndex ?? null;
      const originResults = targetEntity === null
        ? []
        : [
          debug.setEntityOrigin?.(targetEntity, targetOrigin.x, targetOrigin.y, targetOrigin.z),
          ...blockers.map((blocker) =>
            blocker.entityIndex !== undefined &&
            debug.setEntityOrigin?.(blocker.entityIndex, blocker.x, blocker.y, blocker.z)
          ),
      ];
      const enableExpandedOk = Boolean(debug.setExpandedLogicalCombat?.(true));
      const disableUnmountedAiOk = Boolean(debug.setUnmountedAi?.(false));
      const viewPoseOk = Boolean(debug.focusEntity?.(anchorEntity, viewDistance, viewRotX, viewRotY));
      debug.setWeapon?.("rocketlauncher");
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);

      const beforeStats = debug.stats();
      const targetMountedBefore = activeEnemyElementsForEntity(targetEntity).length > 0;
      const activeEnemyIndexesBefore = activeEnemyEntityIndexes();
      const beforeDeadShootables = beforeStats.shootables?.deadShootables ?? 0;
      const beforeLiveShootables = beforeStats.shootables?.liveShootables ?? 0;
      const beforeBudget = beforeStats.shootables?.combatBudget ?? null;

      const damageWeaponTargetOk = Boolean(
        targetEntity !== null &&
        debug.damageWeaponTarget?.(targetEntity, sourceReference.directDamage)
      );
      await sleepInPage(100);
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);

      const afterStats = debug.stats();
      const afterBudget = afterStats.shootables?.combatBudget ?? null;
      return {
        activeEnemyIndexesBefore,
        activeCandidateEntityIndexes: activeCandidates.map((candidate) => candidate.entityIndex),
        after: afterBudget,
        afterDeadShootables: afterStats.shootables?.deadShootables ?? 0,
        afterLiveShootables: afterStats.shootables?.liveShootables ?? 0,
        before: beforeBudget,
        beforeCameraRotX: beforeStats.cameraRotX ?? null,
        beforeCameraRotY: beforeStats.cameraRotY ?? null,
        beforeDeadShootables,
        beforeLiveShootables,
        beforeOrigin: beforeStats.origin ?? null,
        damageWeaponTargetOk,
        disableUnmountedAiOk,
        enableExpandedOk,
        hasDebug: true,
        mapName: afterStats.mapName ?? null,
        originResults,
        selectedFixtureEntityIndexes: fixtureCandidates.map((candidate) => candidate.entityIndex),
        sourceReference,
        targetEntity,
        targetMountedBefore,
        viewPoseOk,
      };

      function activeEnemyElementsForEntity(entityIndex) {
        return [...document.querySelectorAll(`.polycss-mesh.shootable.enemy[data-entity-index="${entityIndex}"]`)]
          .filter((element) =>
            !element.classList.contains("quake-frame-hidden") &&
            !element.classList.contains("quake-shootable-prewarmed") &&
            !element.hidden
          );
      }

      function activeEnemyEntityIndexes() {
        return [...document.querySelectorAll(".polycss-mesh.shootable.enemy[data-entity-index]")]
          .filter((element) =>
            !element.classList.contains("quake-frame-hidden") &&
            !element.classList.contains("quake-shootable-prewarmed") &&
            !element.hidden
          )
          .map((element) => Number(element.dataset.entityIndex))
          .filter((entityIndex) => Number.isFinite(entityIndex))
          .sort((a, b) => a - b);
      }

      function sleepInPage(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }
    }, {
      anchorEntity: LOGICAL_ANCHOR_ENTITY,
      candidateEntities: LOGICAL_CANDIDATE_ENTITIES,
      sourceReference: LOGICAL_SOURCE_REFERENCE,
      targetOrigin: LOGICAL_TARGET_ORIGIN,
      viewDistance: LOGICAL_VIEW_DISTANCE,
      viewRotX: LOGICAL_VIEW_ROT_X,
      viewRotY: LOGICAL_VIEW_ROT_Y,
    });
    result.pageErrors = pageErrors;
    const failures = validateLogicalTargetabilityResult(result);
    if (failures.length) throw new Error(`Logical targetability harness failed: ${failures.join("; ")}`);
    console.log(`PASS target ${result.targetEntity} damaged while unmounted`);
    return {
      generatedAt: new Date().toISOString(),
      kind: "cssquake-logical-targetability-browser-fixture",
      mapName: LOGICAL_MAP,
      pass: true,
      result,
      failures,
    };
    },
  });
}

function validateCombatBudgetResult(result) {
  const failures = [];
  if (!result.hasDebug) failures.push("debug hooks missing");
  if (!result.before) failures.push("missing before combat budget stats");
  if (!result.after) failures.push("missing after combat budget stats");
  if (!result.focusOk) failures.push("debug focusEntity failed");
  if (!result.fired) failures.push("debug fire failed");
  if (result.pageErrors?.length) failures.push(`page errors: ${result.pageErrors.join(" | ")}`);
  if (!result.after || !result.before) return failures;

  const { after, before } = result;
  const limits = after.limits ?? {};
  if (limits.ambientPathTicksPerFrame !== 1) failures.push(`ambientPathTicksPerFrame limit ${limits.ambientPathTicksPerFrame}`);
  if (limits.ambientPathTicksPerSecond !== 30) failures.push(`ambientPathTicksPerSecond limit ${limits.ambientPathTicksPerSecond}`);
  if (limits.ambientPathCadenceHz !== 5) failures.push(`ambientPathCadenceHz limit ${limits.ambientPathCadenceHz}`);
  if (limits.combatInterestSet !== 12) failures.push(`combatInterestSet limit ${limits.combatInterestSet}`);
  if (limits.unmountedAiActiveSet !== 4) failures.push(`unmountedAiActiveSet limit ${limits.unmountedAiActiveSet}`);
  if (limits.unmountedAiCadenceHz !== 5) failures.push(`unmountedAiCadenceHz limit ${limits.unmountedAiCadenceHz}`);
  if (limits.lineOfSightChecksPerFrame !== 8) failures.push(`lineOfSightChecksPerFrame limit ${limits.lineOfSightChecksPerFrame}`);
  if (limits.lineOfSightChecksPerSecond !== 200) failures.push(`lineOfSightChecksPerSecond limit ${limits.lineOfSightChecksPerSecond}`);
  if (limits.attackChainChecksPerFrame !== 8) failures.push(`attackChainChecksPerFrame limit ${limits.attackChainChecksPerFrame}`);
  if (limits.domReads !== 0) failures.push(`domReads limit ${limits.domReads}`);

  if (after.expandedLogicalCombatEnabled !== false) failures.push("expanded logical combat should be disabled");
  if (after.unmountedAiEnabled !== false) failures.push("unmounted AI should be disabled");
  if (after.combatInterestSetSize > limits.combatInterestSet) failures.push(`combatInterestSetSize over cap, got ${after.combatInterestSetSize}`);
  if (after.unmountedAiActiveSetSize !== 0) failures.push(`unmountedAiActiveSetSize should be 0, got ${after.unmountedAiActiveSetSize}`);
  if ((after.maxFrame?.lineOfSightChecks ?? 0) > limits.lineOfSightChecksPerFrame) failures.push(`lineOfSightChecks max frame ${after.maxFrame.lineOfSightChecks}`);
  if ((after.maxFrame?.attackChainChecks ?? 0) > limits.attackChainChecksPerFrame) failures.push(`attackChainChecks max frame ${after.maxFrame.attackChainChecks}`);
  if ((after.maxFrame?.ambientPathTicks ?? 0) > limits.ambientPathTicksPerFrame) failures.push(`ambientPathTicks max frame ${after.maxFrame.ambientPathTicks}`);
  if ((after.maxPerSecond?.ambientPathTicks ?? 0) > limits.ambientPathTicksPerSecond) failures.push(`ambientPathTicks max second ${after.maxPerSecond.ambientPathTicks}`);
  if ((after.maxPerSecond?.lineOfSightChecks ?? 0) > limits.lineOfSightChecksPerSecond) failures.push(`lineOfSightChecks max second ${after.maxPerSecond.lineOfSightChecks}`);

  const counters = after.counters ?? {};
  const beforeCounters = before.counters ?? {};
  if (counters.unmountedAiTicksTotal !== 0) failures.push(`unmountedAiTicksTotal ${counters.unmountedAiTicksTotal}`);
  if (counters.capDeferralsTotal !== 0) failures.push(`capDeferralsTotal ${counters.capDeferralsTotal}`);
  if (counters.domReadsTotal !== 0) failures.push(`domReadsTotal ${counters.domReadsTotal}`);
  if ((counters.weaponTargetQueriesTotal ?? 0) <= (beforeCounters.weaponTargetQueriesTotal ?? 0)) failures.push("weaponTargetQueriesTotal did not increase after event-bound fire");
  if ((counters.weaponTargetCandidatesTotal ?? 0) <= (beforeCounters.weaponTargetCandidatesTotal ?? 0)) failures.push("weaponTargetCandidatesTotal did not increase after event-bound fire");
  return failures;
}

function validateLogicalTargetabilityResult(result) {
  const failures = [];
  if (!result.hasDebug) failures.push("debug hooks missing");
  if (result.pageErrors?.length) failures.push(`page errors: ${result.pageErrors.join(" | ")}`);
  if (result.mapName !== LOGICAL_MAP) failures.push(`unexpected map ${result.mapName}`);
  if (!result.originResults?.every(Boolean)) failures.push(`failed to place target fixtures: ${JSON.stringify(result.originResults)}`);
  if (!result.enableExpandedOk) failures.push("failed to enable expanded logical combat");
  if (!result.disableUnmountedAiOk) failures.push("failed to disable unmounted AI");
  if ((result.selectedFixtureEntityIndexes?.length ?? 0) < 6) failures.push(`expected at least 6 active monster fixtures, got ${JSON.stringify(result.selectedFixtureEntityIndexes)}`);
  if (!result.viewPoseOk) failures.push("debug focusEntity failed");
  if (result.targetMountedBefore) failures.push(`target ${result.targetEntity} should be over mount budget and unmounted`);
  if (!result.damageWeaponTargetOk) failures.push("debug damageWeaponTarget failed");
  if (!result.before) failures.push("missing before combat budget stats");
  if (!result.after) failures.push("missing after combat budget stats");
  if (result.before && result.after) {
    const beforeCounters = result.before.counters ?? {};
    const afterCounters = result.after.counters ?? {};
    const limits = result.after.limits ?? {};
    if (result.before.expandedLogicalCombatEnabled !== true) failures.push("expanded logical combat should be enabled before fire");
    if (result.before.unmountedAiEnabled !== false) failures.push("unmounted AI should stay disabled before fire");
    if (!result.before.combatInterestEntityIndexes?.includes?.(result.targetEntity)) failures.push(`combat interest set should include target ${result.targetEntity}`);
    if ((result.before.combatInterestSetSize ?? 0) > limits.combatInterestSet) failures.push(`combat interest size over cap before fire: ${result.before.combatInterestSetSize}`);
    if ((afterCounters.weaponTargetsYieldedTotal ?? 0) <= (beforeCounters.weaponTargetsYieldedTotal ?? 0)) failures.push("weaponTargetsYieldedTotal did not increase after logical weapon-target damage");
    if ((afterCounters.unmountedAiTicksTotal ?? 0) !== 0) failures.push(`unmountedAiTicksTotal should stay 0, got ${afterCounters.unmountedAiTicksTotal}`);
    if ((afterCounters.domReadsTotal ?? 0) !== 0) failures.push(`domReadsTotal ${afterCounters.domReadsTotal}`);
    if ((result.after.maxFrame?.lineOfSightChecks ?? 0) > limits.lineOfSightChecksPerFrame) failures.push(`lineOfSightChecks max frame ${result.after.maxFrame.lineOfSightChecks}`);
    if ((result.after.maxFrame?.attackChainChecks ?? 0) > limits.attackChainChecksPerFrame) failures.push(`attackChainChecks max frame ${result.after.maxFrame.attackChainChecks}`);
    if ((result.after.maxPerSecond?.lineOfSightChecks ?? 0) > limits.lineOfSightChecksPerSecond) failures.push(`lineOfSightChecks max second ${result.after.maxPerSecond.lineOfSightChecks}`);
  }
  if (!(result.afterLiveShootables < result.beforeLiveShootables)) failures.push(`live shootable count did not decrease: ${result.beforeLiveShootables} -> ${result.afterLiveShootables}`);
  return failures;
}
