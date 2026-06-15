import { readFileSync } from "node:fs";
import path from "node:path";

import { openDebugMapPage } from "./browserHarnessSupport.mjs";
import { projectRoot } from "./checkAssetState.mjs";

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

export const mapLogicFixture = {
  id: "map-logic",
  label: "Map logic browser fixture",
  artifact: "bench/results/quake/map-logic-browser-smoke-summary.json",
  family: "map-logic",
  requirements: { requiredMaps: [MAP_LOGIC_MAP], requireRenderBundle: true, requireGameLogic: true },
  run: runMapLogicFixture,
};

export const liquidDamageFixture = {
  id: "liquid-damage",
  label: "Liquid damage browser fixture",
  artifact: "bench/results/quake/liquid-damage-browser-smoke-summary.json",
  family: "map-logic",
  requirements: { requiredMaps: [LIQUID_DAMAGE_MAP], requireRenderBundle: true, requireGameLogic: true },
  run: runLiquidDamageFixture,
};

export const pickupFixture = {
  id: "pickup",
  label: "Pickup browser fixture",
  artifact: "bench/results/quake/pickup-browser-smoke-summary.json",
  family: "map-logic",
  requirements: { requiredMaps: [PICKUP_MAP], requireRenderBundle: true, requireGameLogic: true },
  run: runPickupFixture,
};

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
