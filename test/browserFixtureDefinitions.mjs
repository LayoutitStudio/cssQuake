import { readFileSync } from "node:fs";
import path from "node:path";

import {
  debugMapUrl,
  openDebugMapPage,
  waitForDebugMapReady,
} from "./browserHarnessSupport.mjs";
import {
  ogreGrenadeChainFixture,
  ogreGrenadeBounceFixture,
  ogreGrenadeLifecycleFixture,
  rocketFireFixture,
  rocketTouchFixture,
  wizardSpikeChainFixture,
  zombieProjectileChainFixture,
  zombieProjectileStopFixture,
} from "./browserFixtureProjectile.mjs";
import { projectRoot } from "./checkAssetState.mjs";

const REPRESENTATIVE_MONSTERS = [
  { map: "e1m1", classname: "monster_army", entity: 298 },
  { map: "e1m1", classname: "monster_dog", entity: 247 },
  { map: "e1m2", classname: "monster_knight", entity: 99 },
  { map: "e1m2", classname: "monster_ogre", entity: 80 },
  { map: "e1m5", classname: "monster_demon1", entity: 205 },
  { map: "e1m3", classname: "monster_wizard", entity: 294 },
  { map: "e1m6", classname: "monster_shambler", entity: 396 },
  { map: "e1m3", classname: "monster_zombie", entity: 272 },
  { map: "e1m7", classname: "monster_boss", entity: 28 },
];
const MONSTER_FOCUS_YAWS = [0, 45, 90, 135, 180, 225, 270, 315];
const MONSTER_FOCUS_DISTANCES = [2.35, 3.5, 5, 8, 12];

const PICKUP_MAP = "e1m1";
const PICKUP_CASES = [
  { classname: "item_armor1", entity: 20, label: "armor", stat: "playerArmor", delta: 100 },
  { classname: "item_spikes", entity: 226, label: "large nails", stat: "playerNails", delta: 50 },
];
const DISABLED_PICKUP = { classname: "weapon_rocketlauncher", entity: 201 };
const PICKUP_FOCUS_YAWS = [0, 45, 90, 135, 180, 225, 270, 315];

const LIQUID_DAMAGE_MAP = "e1m1";
const LIQUID_DAMAGE_CASE = {
  contents: "slime",
  contentsValue: -4,
  expectedDamage: 8,
  expectedWaterLevel: 2,
  label: "E1M1 slime pool",
  origin: { x: 0, y: 2688, z: -144 },
  sampleOffsets: [-23, 4, 32],
};

const MAP_LOGIC_MAP = "e1m1";
const MAP_LOGIC_CASE = {
  delayedRefireMs: 260,
  doorEntity: 189,
  expectedDoorClassname: "func_door_secret",
  expectedDoorInitialMode: "closed",
  expectedDoorTriggeredMode: "opening",
  expectedTriggerClassname: "trigger_multiple",
  inside: { x: 792, y: 512, z: 8 },
  label: "E1M1 trigger_multiple secret door",
  outside: { x: 704, y: 512, z: 8 },
  targetname: "t8",
  triggerEntity: 190,
};

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

export const browserFixtures = [
  {
    id: "monster-dom",
    label: "DOM monster browser fixture",
    artifact: "bench/results/quake/monster-dom-smoke-summary.json",
    requirements: { requiredMaps: unique(REPRESENTATIVE_MONSTERS.map((monster) => monster.map)), requireRenderBundle: true },
    run: runMonsterDomFixture,
  },
  {
    id: "combat-budget",
    label: "Combat budget browser fixture",
    artifact: "bench/results/quake/combat-budget-harness-smoke-summary.json",
    requirements: { requiredMaps: [COMBAT_MAP], requireRenderBundle: true },
    run: runCombatBudgetFixture,
  },
  {
    id: "logical-targetability",
    label: "Logical targetability browser fixture",
    artifact: "bench/results/quake/logical-targetability-smoke-summary.json",
    requirements: { requiredMaps: [LOGICAL_MAP], requireRenderBundle: true },
    run: runLogicalTargetabilityFixture,
  },
  rocketFireFixture,
  rocketTouchFixture,
  ogreGrenadeChainFixture,
  ogreGrenadeBounceFixture,
  ogreGrenadeLifecycleFixture,
  wizardSpikeChainFixture,
  zombieProjectileChainFixture,
  zombieProjectileStopFixture,
  {
    id: "map-logic",
    label: "Map logic browser fixture",
    artifact: "bench/results/quake/map-logic-browser-smoke-summary.json",
    requirements: { requiredMaps: [MAP_LOGIC_MAP], requireRenderBundle: true, requireGameLogic: true },
    run: runMapLogicFixture,
  },
  {
    id: "liquid-damage",
    label: "Liquid damage browser fixture",
    artifact: "bench/results/quake/liquid-damage-browser-smoke-summary.json",
    requirements: { requiredMaps: [LIQUID_DAMAGE_MAP], requireRenderBundle: true, requireGameLogic: true },
    run: runLiquidDamageFixture,
  },
  {
    id: "pickup",
    label: "Pickup browser fixture",
    artifact: "bench/results/quake/pickup-browser-smoke-summary.json",
    requirements: { requiredMaps: [PICKUP_MAP], requireRenderBundle: true, requireGameLogic: true },
    run: runPickupFixture,
  },
];

export function browserFixtureById(id) {
  return browserFixtures.find((fixture) => fixture.id === id) ?? null;
}

async function runMonsterDomFixture({ browser, baseUrl, options }) {
  let page = null;
  let pageErrors = [];
  const results = [];
  try {
    let currentMap = "";
    for (const monster of REPRESENTATIVE_MONSTERS) {
      if (monster.map !== currentMap) {
        if (!page) {
          ({ page, pageErrors } = await openDebugMapPage(browser, baseUrl, monster.map, options));
        } else {
          await page.goto(debugMapUrl(baseUrl, monster.map), { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
          await waitForDebugMapReady(page, { mapName: monster.map, timeoutMs: options.timeoutMs });
        }
        currentMap = monster.map;
      }
      const result = await validateMonster(page, monster);
      results.push(result);
      const status = result.pass ? "PASS" : "FAIL";
      const attempt = result.attempt;
      console.log(`${status} ${monster.map} ${monster.classname} #${monster.entity}` +
        (attempt ? ` distance=${attempt.distance} yaw=${attempt.yaw} leaves=${attempt.leafCount}` : ""));
    }
  } finally {
    await page?.close();
  }
  const failed = results.filter((result) => !result.pass);
  if (pageErrors.length || failed.length) {
    throw new Error(`DOM monster browser fixture failed: ${results.length - failed.length}/${results.length} passed.\n${pageErrors.join("\n")}`);
  }
  return {
    kind: "cssquake-monster-dom-smoke",
    startedAt: new Date().toISOString(),
    viewport: options.viewport,
    total: results.length,
    passed: results.length,
    failed: 0,
    results,
  };
}

async function runCombatBudgetFixture({ browser, baseUrl, options }) {
  const { page, pageErrors } = await openDebugMapPage(browser, baseUrl, COMBAT_MAP, options);
  try {
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
  } finally {
    await page.close();
  }
}

async function runLogicalTargetabilityFixture({ browser, baseUrl, options }) {
  const { page, pageErrors } = await openDebugMapPage(browser, baseUrl, LOGICAL_MAP, options);
  try {
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
  } finally {
    await page.close();
  }
}

async function runPickupFixture({ browser, baseUrl, options }) {
  const prepared = JSON.parse(readFileSync(path.join(projectRoot, `build/generated/public/q/${PICKUP_MAP}.json`), "utf8"));
  const pickupCases = pickupCasesWithOrigins(prepared);
  const { page, pageErrors } = await openDebugMapPage(browser, baseUrl, PICKUP_MAP, options);
  const results = [];
  let disabled = null;
  try {
    disabled = await disabledPickupSnapshot(page);
    if (disabled.mounted) throw new Error(`Skill-disabled pickup should not mount: ${JSON.stringify(disabled)}`);
    for (const testCase of pickupCases) {
      const result = await validatePickup(page, testCase);
      assertPickupResult(testCase, result);
      results.push({ ...testCase, result });
      console.log(`PASS ${PICKUP_MAP} ${testCase.classname} #${testCase.entity} ${testCase.stat} ${result.before[testCase.stat]} -> ${result.after[testCase.stat]}`);
    }
  } finally {
    await page.close();
  }
  if (pageErrors.length) throw new Error(`Browser emitted console/page errors:\n${pageErrors.join("\n")}`);
  return { kind: "cssquake-pickup-browser-fixture", startedAt: new Date().toISOString(), map: PICKUP_MAP, disabled, results };
}

async function runLiquidDamageFixture({ browser, baseUrl, options }) {
  const { page, pageErrors } = await openDebugMapPage(browser, baseUrl, LIQUID_DAMAGE_MAP, options);
  try {
    const result = await validateLiquidDamage(page, LIQUID_DAMAGE_CASE);
    assertLiquidDamageResult(LIQUID_DAMAGE_CASE, result);
    if (pageErrors.length) throw new Error(`Browser emitted console/page errors:\n${pageErrors.join("\n")}`);
    console.log(
      `PASS ${LIQUID_DAMAGE_MAP} ${LIQUID_DAMAGE_CASE.contents} damage ${result.beforeHealth} -> ${result.afterHealth}`,
    );
    return {
      kind: "cssquake-liquid-damage-browser-fixture",
      startedAt: new Date().toISOString(),
      map: LIQUID_DAMAGE_MAP,
      result,
    };
  } finally {
    await page.close();
  }
}

async function runMapLogicFixture({ browser, baseUrl, options }) {
  const prepared = JSON.parse(readFileSync(path.join(projectRoot, `build/generated/public/q/${MAP_LOGIC_MAP}.json`), "utf8"));
  assertMapLogicFixturePrepared(prepared, MAP_LOGIC_CASE);
  const { page, pageErrors } = await openDebugMapPage(browser, baseUrl, MAP_LOGIC_MAP, options);
  try {
    const result = await validateMapLogic(page, MAP_LOGIC_CASE);
    assertMapLogicResult(MAP_LOGIC_CASE, result);
    if (pageErrors.length) throw new Error(`Browser emitted console/page errors:\n${pageErrors.join("\n")}`);
    console.log(
      `PASS ${MAP_LOGIC_MAP} trigger #${MAP_LOGIC_CASE.triggerEntity} count ${result.before.count} -> ${result.afterThird.count}, door #${MAP_LOGIC_CASE.doorEntity} ${result.before.mover.mode} -> ${result.afterFirst.mover.mode}`,
    );
    return {
      kind: "cssquake-map-logic-browser-fixture",
      startedAt: new Date().toISOString(),
      map: MAP_LOGIC_MAP,
      result,
    };
  } finally {
    await page.close();
  }
}

async function validateMonster(page, monster) {
  let lastAttempt = null;
  for (const distance of MONSTER_FOCUS_DISTANCES) {
    for (const yaw of MONSTER_FOCUS_YAWS) {
      const attempt = await page.evaluate(async ({ entity, expectedClassname, distance, yaw }) => {
        const debug = window.__cssQuakeDebug;
        const ok = debug.focusEntity(entity, distance, 90, yaw);
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        await new Promise((resolve) => setTimeout(resolve, 120));
        const selector = `.polycss-mesh.shootable.enemy[data-entity-index="${entity}"]`;
        const element = document.querySelector(selector);
        const active = Boolean(
          element &&
          element.getAttribute("aria-hidden") !== "true" &&
          !element.classList.contains("quake-shootable-prewarmed") &&
          !element.classList.contains("quake-frame-hidden")
        );
        const stats = debug.stats();
        return {
          distance,
          yaw,
          focusOk: ok,
          mounted: Boolean(element),
          active,
          classname: element?.dataset.classname ?? null,
          classnameOk: element?.dataset.classname === expectedClassname,
          leafCount: element ? element.querySelectorAll("b,i,s,u").length : 0,
          animationFrame: element?.dataset.animationFrame ?? null,
          quakecState: element?.dataset.quakecState ?? null,
          stats: {
            activeEnemyMeshes: stats.activeEnemyMeshes,
            mountedEnemyShootables: stats.shootables?.mountedEnemyShootables ?? null,
            visibleEnemyShootables: stats.shootables?.visibleEnemyShootables ?? null,
          },
        };
      }, { entity: monster.entity, expectedClassname: monster.classname, distance, yaw });
      lastAttempt = attempt;
      if (attempt.active && attempt.classnameOk && attempt.leafCount > 0) {
        return { ...monster, pass: true, naturalVisibility: true, attempt };
      }
    }
  }
  return { ...monster, pass: false, naturalVisibility: false, attempt: lastAttempt };
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

function pickupCasesWithOrigins(preparedScene) {
  return PICKUP_CASES.map((testCase) => {
    const entity = preparedScene.entities?.find((candidate) => candidate.index === testCase.entity);
    if (!entity?.origin) throw new Error(`Missing E1M1 pickup entity ${testCase.entity}.`);
    if (entity.classname !== testCase.classname) {
      throw new Error(`Expected E1M1 entity ${testCase.entity} to be ${testCase.classname}, got ${entity.classname}.`);
    }
    return { ...testCase, origin: entity.origin };
  });
}

async function validatePickup(page, testCase) {
  return await page.evaluate(async ({ testCase, yaws }) => {
    const debug = window.__cssQuakeDebug;
    if (!debug?.stats || !debug.focusEntity || !debug.setViewpos) return { pass: false, reason: "missing debug pickup hooks" };
    const settle = async (ms = 160) => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, ms));
    };
    const pickupInfo = (entityIndex) => {
      const element = document.querySelector(`.polycss-mesh.pickup[data-entity-index="${entityIndex}"]`);
      if (!element) return { mounted: false };
      return {
        mounted: true,
        hidden: element.hidden,
        classname: element.dataset.classname ?? null,
        leafCount: element.querySelectorAll("b,i,s,u").length,
      };
    };
    const statsSnapshot = () => {
      const stats = debug.stats();
      return {
        activePickupMeshes: stats.activePickupMeshes,
        pickupMeshes: stats.pickupMeshes,
        playerArmor: stats.playerArmor,
        playerHealth: stats.playerHealth,
        playerNails: stats.playerNails,
        playerShells: stats.playerShells,
      };
    };
    const before = statsSnapshot();
    let focused = null;
    for (const yaw of yaws) {
      const focusOk = debug.focusEntity(testCase.entity, 4, 90, yaw);
      await settle();
      const info = pickupInfo(testCase.entity);
      focused = { focusOk, yaw, ...info };
      if (focusOk && info.mounted && !info.hidden && info.classname === testCase.classname && info.leafCount > 0) break;
    }
    const beforePickup = statsSnapshot();
    const pickupOk = debug.setViewpos(testCase.origin.x, testCase.origin.y, testCase.origin.z, undefined, undefined, { gameplay: true });
    await settle(220);
    const after = statsSnapshot();
    const afterInfo = pickupInfo(testCase.entity);
    const repeatOk = debug.setViewpos(testCase.origin.x, testCase.origin.y, testCase.origin.z, undefined, undefined, { gameplay: true });
    await settle(120);
    const afterRepeat = statsSnapshot();
    return { pass: true, before, beforePickup, focused, pickupOk, after, afterInfo, repeatOk, afterRepeat };
  }, { testCase, yaws: PICKUP_FOCUS_YAWS });
}

async function disabledPickupSnapshot(page) {
  return await page.evaluate((pickup) => {
    const element = document.querySelector(`.polycss-mesh.pickup[data-entity-index="${pickup.entity}"]`);
    return { classname: pickup.classname, entity: pickup.entity, mounted: Boolean(element), elementClassname: element?.dataset.classname ?? null };
  }, DISABLED_PICKUP);
}

function assertPickupResult(testCase, result) {
  if (!result.pass) throw new Error(`${testCase.label} failed before validation: ${result.reason ?? "unknown"}`);
  const focused = result.focused;
  if (!focused?.focusOk || !focused.mounted || focused.hidden || focused.classname !== testCase.classname) {
    throw new Error(`${testCase.label} pickup did not become visible: ${JSON.stringify(focused)}`);
  }
  if (!(focused.leafCount > 0)) throw new Error(`${testCase.label} pickup mounted without render leaves: ${JSON.stringify(focused)}`);
  if (!result.pickupOk) throw new Error(`${testCase.label} pickup debug gameplay pose failed.`);
  const expected = result.before[testCase.stat] + testCase.delta;
  if (result.after[testCase.stat] !== expected) throw new Error(`${testCase.label} should change ${testCase.stat} to ${expected}, got ${result.after[testCase.stat]}.`);
  if (result.afterInfo.mounted) throw new Error(`${testCase.label} pickup mesh should be removed after pickup: ${JSON.stringify(result.afterInfo)}`);
  if (result.after.pickupMeshes !== result.beforePickup.pickupMeshes - 1) {
    throw new Error(`${testCase.label} should remove exactly one pickup mesh, before=${result.beforePickup.pickupMeshes} after=${result.after.pickupMeshes}.`);
  }
  if (!result.repeatOk) throw new Error(`${testCase.label} repeat gameplay pose failed.`);
  if (result.afterRepeat[testCase.stat] !== result.after[testCase.stat]) {
    throw new Error(`${testCase.label} should not apply twice, after=${result.after[testCase.stat]} repeat=${result.afterRepeat[testCase.stat]}.`);
  }
}

async function validateLiquidDamage(page, testCase) {
  return await page.evaluate(async ({ testCase, mapName }) => {
    const debug = window.__cssQuakeDebug;
    if (!debug?.stats || !debug.contentsAt || !debug.setViewpos) {
      return { pass: false, reason: "missing debug liquid-damage hooks" };
    }

    const settle = async (ms = 80) => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, ms));
    };
    const liquidContents = new Set([-3, -4, -5]);
    const samples = testCase.sampleOffsets.map((offset) => {
      const z = testCase.origin.z + offset;
      return {
        contents: debug.contentsAt(testCase.origin.x, testCase.origin.y, z),
        offset,
        z,
      };
    });
    let waterLevel = 0;
    for (const sample of samples) {
      if (!liquidContents.has(sample.contents)) break;
      waterLevel += 1;
    }
    const before = debug.stats();
    const setViewposOk = debug.setViewpos(
      testCase.origin.x,
      testCase.origin.y,
      testCase.origin.z,
      undefined,
      undefined,
      { gameplay: true },
    );
    const immediate = debug.stats();
    await settle();
    const after = debug.stats();
    return {
      afterHealth: after.playerHealth,
      beforeHealth: before.playerHealth,
      bodyClass: document.body.className,
      expectedMapName: mapName,
      hasDebug: true,
      immediateHealth: immediate.playerHealth,
      mapName: after.mapName ?? null,
      origin: testCase.origin,
      playerMove: after.playerMove ?? null,
      samples,
      setViewposOk,
      waterLevel,
    };
  }, { mapName: LIQUID_DAMAGE_MAP, testCase });
}

async function validateMapLogic(page, testCase) {
  return await page.evaluate(async ({ testCase, mapName }) => {
    const debug = window.__cssQuakeDebug;
    if (!debug?.stats || !debug.setViewpos) {
      return { pass: false, reason: "missing debug map-logic hooks" };
    }

    const settle = async (ms = 80) => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, ms));
    };
    const triggerCount = () =>
      debug.stats().triggers?.triggerMultipleActivationCounts
        ?.find((entry) => entry.entityIndex === testCase.triggerEntity)
        ?.count ?? 0;
    const mover = () =>
      debug.stats().movers?.movers
        ?.find((entry) => entry.entityIndex === testCase.doorEntity) ?? null;
    const snapshot = (label) => {
      const stats = debug.stats();
      return {
        activeTriggerIndexes: stats.triggers?.activeTriggerIndexes ?? [],
        cooldownTriggerIndexes: stats.triggers?.cooldownTriggerIndexes ?? [],
        count: triggerCount(),
        label,
        mapName: stats.mapName ?? null,
        mover: mover(),
        origin: stats.origin ?? null,
      };
    };
    const setPose = (pose) => debug.setViewpos(
      pose.x,
      pose.y,
      pose.z,
      undefined,
      undefined,
      { gameplay: true },
    );

    const before = snapshot("before");
    const firstTouchOk = setPose(testCase.inside);
    const afterFirst = snapshot("afterFirst");
    const leaveDuringCooldownOk = setPose(testCase.outside);
    const afterLeaveDuringCooldown = snapshot("afterLeaveDuringCooldown");
    const blockedRetouchOk = setPose(testCase.inside);
    const afterBlockedRetouch = snapshot("afterBlockedRetouch");
    const leaveForRefireOk = setPose(testCase.outside);
    await settle(testCase.delayedRefireMs);
    const afterCooldown = snapshot("afterCooldown");
    const refireTouchOk = setPose(testCase.inside);
    const afterThird = snapshot("afterThird");
    await settle();
    const afterSettled = snapshot("afterSettled");

    return {
      afterBlockedRetouch,
      afterCooldown,
      afterFirst,
      afterLeaveDuringCooldown,
      afterSettled,
      afterThird,
      before,
      blockedRetouchOk,
      expectedMapName: mapName,
      firstTouchOk,
      hasDebug: true,
      leaveDuringCooldownOk,
      leaveForRefireOk,
      refireTouchOk,
    };
  }, { mapName: MAP_LOGIC_MAP, testCase });
}

function assertMapLogicFixturePrepared(preparedScene, testCase) {
  const trigger = preparedScene.entities?.find((entity) => entity.index === testCase.triggerEntity);
  const door = preparedScene.entities?.find((entity) => entity.index === testCase.doorEntity);
  if (trigger?.classname !== testCase.expectedTriggerClassname) {
    throw new Error(`${testCase.label} expected trigger #${testCase.triggerEntity} to be ${testCase.expectedTriggerClassname}, got ${trigger?.classname}.`);
  }
  if (door?.classname !== testCase.expectedDoorClassname) {
    throw new Error(`${testCase.label} expected door #${testCase.doorEntity} to be ${testCase.expectedDoorClassname}, got ${door?.classname}.`);
  }
  if (trigger.properties?.target !== testCase.targetname) {
    throw new Error(`${testCase.label} expected trigger target ${testCase.targetname}, got ${trigger.properties?.target}.`);
  }
  if (door.properties?.targetname !== testCase.targetname) {
    throw new Error(`${testCase.label} expected door targetname ${testCase.targetname}, got ${door.properties?.targetname}.`);
  }
}

function assertMapLogicResult(testCase, result) {
  if (!result.pass && result.reason) throw new Error(`${testCase.label} failed before validation: ${result.reason}`);
  if (!result.hasDebug) throw new Error(`${testCase.label} debug hooks missing.`);
  for (const [name, ok] of [
    ["firstTouchOk", result.firstTouchOk],
    ["leaveDuringCooldownOk", result.leaveDuringCooldownOk],
    ["blockedRetouchOk", result.blockedRetouchOk],
    ["leaveForRefireOk", result.leaveForRefireOk],
    ["refireTouchOk", result.refireTouchOk],
  ]) {
    if (!ok) throw new Error(`${testCase.label} ${name} failed.`);
  }
  if (result.before.mapName !== result.expectedMapName || result.afterSettled.mapName !== result.expectedMapName) {
    throw new Error(`${testCase.label} unexpected map: before=${result.before.mapName} after=${result.afterSettled.mapName}.`);
  }
  if (result.before.mover?.mode !== testCase.expectedDoorInitialMode) {
    throw new Error(`${testCase.label} expected initial door mode ${testCase.expectedDoorInitialMode}, got ${result.before.mover?.mode}.`);
  }
  if (result.afterFirst.mover?.mode !== testCase.expectedDoorTriggeredMode) {
    throw new Error(`${testCase.label} expected triggered door mode ${testCase.expectedDoorTriggeredMode}, got ${result.afterFirst.mover?.mode}.`);
  }
  if (result.before.count !== 0) throw new Error(`${testCase.label} expected trigger count 0 before touch, got ${result.before.count}.`);
  if (result.afterFirst.count !== 1) throw new Error(`${testCase.label} expected first touch count 1, got ${result.afterFirst.count}.`);
  if (!result.afterFirst.activeTriggerIndexes.includes(testCase.triggerEntity)) {
    throw new Error(`${testCase.label} trigger should be active after first touch: ${JSON.stringify(result.afterFirst.activeTriggerIndexes)}`);
  }
  if (!result.afterFirst.cooldownTriggerIndexes.includes(testCase.triggerEntity)) {
    throw new Error(`${testCase.label} trigger should be cooling down after first touch: ${JSON.stringify(result.afterFirst.cooldownTriggerIndexes)}`);
  }
  if (result.afterLeaveDuringCooldown.activeTriggerIndexes.includes(testCase.triggerEntity)) {
    throw new Error(`${testCase.label} trigger should clear active state after leaving.`);
  }
  if (result.afterBlockedRetouch.count !== 1) {
    throw new Error(`${testCase.label} cooldown retouch should stay at count 1, got ${result.afterBlockedRetouch.count}.`);
  }
  if (result.afterCooldown.cooldownTriggerIndexes.includes(testCase.triggerEntity)) {
    throw new Error(`${testCase.label} trigger should leave cooldown before delayed refire.`);
  }
  if (result.afterThird.count !== 2) {
    throw new Error(`${testCase.label} delayed refire should increment count to 2, got ${result.afterThird.count}.`);
  }
}

function assertLiquidDamageResult(testCase, result) {
  if (!result.pass && result.reason) throw new Error(`${testCase.label} failed before validation: ${result.reason}`);
  if (!result.hasDebug) throw new Error(`${testCase.label} debug hooks missing.`);
  if (result.mapName !== result.expectedMapName) {
    throw new Error(`${testCase.label} expected map ${result.expectedMapName}, got ${result.mapName}.`);
  }
  if (!result.setViewposOk) throw new Error(`${testCase.label} debug gameplay pose failed.`);
  if (result.waterLevel !== testCase.expectedWaterLevel) {
    throw new Error(`${testCase.label} expected waterLevel ${testCase.expectedWaterLevel}, got ${result.waterLevel}.`);
  }
  for (let index = 0; index < testCase.expectedWaterLevel; index += 1) {
    const sample = result.samples[index];
    if (sample?.contents !== testCase.contentsValue) {
      throw new Error(`${testCase.label} sample ${index} expected ${testCase.contentsValue}, got ${sample?.contents}.`);
    }
  }
  if (!Number.isFinite(result.beforeHealth) || !Number.isFinite(result.afterHealth)) {
    throw new Error(`${testCase.label} missing health values: ${JSON.stringify(result)}`);
  }
  const actualDamage = result.beforeHealth - result.afterHealth;
  if (actualDamage !== testCase.expectedDamage) {
    throw new Error(`${testCase.label} expected ${testCase.expectedDamage} damage, got ${actualDamage}.`);
  }
}

function unique(values) {
  return [...new Set(values)].sort();
}
