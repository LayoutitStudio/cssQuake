import { openDebugMapPage } from "./browserHarnessSupport.mjs";

const ROCKET_TOUCH_MAP = "e1m1";
const ROCKET_TOUCH_SCENARIO = {
  id: "e1m1-soldier-rocket-touch",
  map: ROCKET_TOUCH_MAP,
  player: {
    origin: [616, 160, 75],
    angles: [0, 270, 0],
  },
  edit: {
    select: { classname: "monster_army", nth: 0 },
    origin: [616, 72, 40],
  },
  action: {
    type: "rocketTouch",
    weapon: "rocketlauncher",
    missileOrigin: [616, 72, 40],
    expectedPlayerSplashDamageMin: 30,
    expectedPlayerSplashDamageMax: 45,
  },
};
const ROCKET_TOUCH_SOURCE = {
  directDamage: 117,
  playerSplashDamage: 36,
  sourceEvent: "T_MissileTouch",
};

const ROCKET_FIRE_MAP = "e1m1";
const ROCKET_FIRE_SCENARIO = {
  id: "e1m1-soldier-rocket-fire",
  map: ROCKET_FIRE_MAP,
  player: {
    origin: [616, 300, 40],
    angles: [0, 270, 0],
  },
  edit: {
    select: { classname: "monster_army", nth: 0 },
    origin: [616, 72, 40],
  },
  action: {
    type: "rocketFire",
    weapon: "rocketlauncher",
    expectedPlayerSplashDamageMin: 0,
    expectedPlayerSplashDamageMax: 0,
  },
};
const ROCKET_FIRE_SOURCE = {
  directDamage: 118,
  missileOrigin: [616, 292, 56],
  missileVelocity: [0.0000119249, -1000, 0],
  playerSplashDamage: 0,
  sourceEvent: "W_FireRocket",
};

const ENEMY_PROJECTILE_STEP_MS = 1000 / 72;
const OGRE_GRENADE_CHAIN_SCENARIO = {
  id: "e1m2-ogre-grenade-chain",
  map: "e1m2",
  player: { origin: [1300, 156, 220], angles: [0, 225, 0] },
  edit: {
    select: { classname: "monster_ogre", nth: 0 },
    origin: [1018, -126, 320],
    yaw: 45,
  },
  chain: "missile",
  expected: {
    damage: 40,
    modelPath: "progs/grenade.mdl",
    projectile: "enemy_projectile_grenade",
    minMoveEvents: 8,
  },
};
const OGRE_GRENADE_BOUNCE_SCENARIO = {
  id: "e1m2-ogre-grenade-bounce",
  map: "e1m2",
  player: { origin: [2000, 1000, 500], angles: [0, 225, 0] },
  edit: {
    select: { classname: "monster_ogre", nth: 0 },
    origin: [1018, -126, 320],
    yaw: 45,
  },
  chain: "missile",
  targetOrigin: [1300, 156, 220],
  expected: {
    damage: 40,
    impactResult: "keep",
    impactTraceClassname: "worldspawn",
    impactVelocityZ: "positive",
    modelPath: "progs/grenade.mdl",
    projectile: "enemy_projectile_grenade",
    minMoveEvents: 60,
    worldTouch: "bounce",
  },
};
const OGRE_GRENADE_LIFECYCLE_SCENARIO = {
  id: "e1m2-ogre-grenade-lifecycle",
  map: "e1m2",
  player: { origin: [2000, 1000, 500], angles: [0, 225, 0] },
  edit: {
    select: { classname: "monster_ogre", nth: 0 },
    origin: [1018, -126, 320],
    yaw: 45,
  },
  chain: "missile",
  targetOrigin: [1300, 156, 220],
  expected: {
    damage: 40,
    expireEvents: 1,
    explosionEvents: 1,
    impactResult: "keep",
    impactTraceClassname: "worldspawn",
    impactVelocityZ: "positive",
    modelPath: "progs/grenade.mdl",
    projectile: "enemy_projectile_grenade",
    minMoveEvents: 120,
    removeEvents: 1,
    splashDamage: 40,
    splashRadiusQuakeUnits: 80,
    worldTouch: "bounce",
  },
};
const WIZARD_SPIKE_CHAIN_SCENARIO = {
  id: "e1m4-wizard-spike-chain",
  map: "e1m4",
  player: { origin: [944, 980, 1016], angles: [0, 270, 0] },
  edit: {
    select: { classname: "monster_wizard", entityIndex: 317, nth: 0 },
    origin: [944, 840, 956],
    yaw: 270,
  },
  chain: "attack",
  expected: {
    damage: 9,
    modelPath: "progs/w_spike.mdl",
    projectile: "enemy_projectile_spike",
    spawnEvents: 2,
    minMoveEvents: 2,
  },
};
const ZOMBIE_PROJECTILE_CHAIN_SCENARIO = {
  id: "e1m7-zombie-projectile-chain",
  map: "e1m7",
  player: { origin: [1760, -160, 100], angles: [0, 90, 0] },
  edit: {
    select: { classname: "monster_zombie", nth: 0 },
    origin: [1760, 128, 24],
    yaw: 270,
  },
  chain: "attack",
  expected: {
    damage: 10,
    modelPath: "progs/zom_gib.mdl",
    projectile: "enemy_projectile_zombie_grenade",
    minMoveEvents: 1,
  },
};
const ZOMBIE_PROJECTILE_STOP_SCENARIO = {
  id: "e1m7-zombie-projectile-stop",
  map: "e1m7",
  player: { origin: [2400, -900, 300], angles: [0, 90, 0] },
  edit: {
    select: { classname: "monster_zombie", nth: 0 },
    origin: [1760, 128, 24],
    yaw: 270,
  },
  chain: "attack",
  targetOrigin: [1760, -160, 24],
  expected: {
    damage: 10,
    impactResult: "stop",
    impactVelocity: [0, 0, 0],
    modelPath: "progs/zom_gib.mdl",
    projectile: "enemy_projectile_zombie_grenade",
    minMoveEvents: 4,
    worldTouch: "stop",
  },
};

export const rocketTouchFixture = {
  id: "rocket-touch",
  label: "Rocket touch browser fixture",
  artifact: "bench/results/quake/oracle/e1m1-soldier-rocket-touch.cssquake.json",
  requirements: { requiredMaps: [ROCKET_TOUCH_MAP], requireRenderBundle: true },
  run: runRocketTouchFixture,
};

export const rocketFireFixture = {
  id: "rocket-fire",
  label: "Rocket fire browser fixture",
  artifact: "bench/results/quake/oracle/e1m1-soldier-rocket-fire.cssquake.json",
  requirements: { requiredMaps: [ROCKET_FIRE_MAP], requireRenderBundle: true },
  run: runRocketFireFixture,
};

export const ogreGrenadeChainFixture = enemyProjectileChainFixture({
  artifact: "bench/results/quake/oracle/e1m2-ogre-grenade-chain.cssquake.json",
  id: "ogre-grenade-chain",
  label: "Ogre grenade chain browser fixture",
  scenario: OGRE_GRENADE_CHAIN_SCENARIO,
});

export const ogreGrenadeBounceFixture = enemyProjectileChainFixture({
  artifact: "bench/results/quake/oracle/e1m2-ogre-grenade-bounce.cssquake.json",
  id: "ogre-grenade-bounce",
  label: "Ogre grenade bounce browser fixture",
  scenario: OGRE_GRENADE_BOUNCE_SCENARIO,
});

export const ogreGrenadeLifecycleFixture = enemyProjectileChainFixture({
  artifact: "bench/results/quake/oracle/e1m2-ogre-grenade-lifecycle.cssquake.json",
  id: "ogre-grenade-lifecycle",
  label: "Ogre grenade lifecycle browser fixture",
  scenario: OGRE_GRENADE_LIFECYCLE_SCENARIO,
});

export const wizardSpikeChainFixture = enemyProjectileChainFixture({
  artifact: "bench/results/quake/oracle/e1m4-wizard-spike-chain.cssquake.json",
  id: "wizard-spike-chain",
  label: "Wizard spike chain browser fixture",
  scenario: WIZARD_SPIKE_CHAIN_SCENARIO,
});

export const zombieProjectileChainFixture = enemyProjectileChainFixture({
  artifact: "bench/results/quake/oracle/e1m7-zombie-projectile-chain.cssquake.json",
  id: "zombie-projectile-chain",
  label: "Zombie projectile chain browser fixture",
  scenario: ZOMBIE_PROJECTILE_CHAIN_SCENARIO,
});

export const zombieProjectileStopFixture = enemyProjectileChainFixture({
  artifact: "bench/results/quake/oracle/e1m7-zombie-projectile-stop.cssquake.json",
  id: "zombie-projectile-stop",
  label: "Zombie projectile stop browser fixture",
  scenario: ZOMBIE_PROJECTILE_STOP_SCENARIO,
});

async function runRocketTouchFixture({ browser, baseUrl, options }) {
  const { page, pageErrors } = await openDebugMapPage(browser, baseUrl, ROCKET_TOUCH_MAP, options);
  try {
    const result = await page.evaluate(async ({ scenario, sourceReference }) => {
      const debug = window.__cssQuakeDebug;
      const [playerX, playerY, playerZ] = scenario.player.origin;
      const [pitch, yaw, roll] = scenario.player.angles;
      const [targetX, targetY, targetZ] = scenario.edit.origin;
      const [missileX, missileY, missileZ] = scenario.action.missileOrigin;
      if (!debug?.stats) return { hasDebug: false };

      debug.setExpandedLogicalCombat?.(false);
      debug.setUnmountedAi?.(false);
      const setPlayerOk = Boolean(debug.setViewpos?.(playerX, playerY, playerZ, pitch, yaw, roll, {
        gameplay: true,
      }));
      const setWeaponOk = Boolean(debug.setWeapon?.(scenario.action.weapon));

      const targetEntityIndexes = debug.entityIndexes?.(scenario.edit.select.classname) ?? [];
      const requestedTargetEntity = targetEntityIndexes[scenario.edit.select.nth ?? 0] ?? null;
      let targetEntity = null;
      let setTargetOriginOk = false;
      let mountTargetOk = false;
      for (const entityIndex of targetEntityIndexes) {
        if (!debug.setEntityOrigin?.(entityIndex, targetX, targetY, targetZ)) continue;
        targetEntity = entityIndex;
        setTargetOriginOk = true;
        mountTargetOk = Boolean(debug.debugMountEntity?.(entityIndex));
        break;
      }

      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);

      const beforeStats = debug.stats();
      const beforeBudget = beforeStats.shootables?.combatBudget ?? null;
      const beforeInventory = {
        armor: beforeStats.playerArmor ?? null,
        health: beforeStats.playerHealth ?? null,
      };
      const beforeShootables = {
        dead: beforeStats.shootables?.deadShootables ?? null,
        live: beforeStats.shootables?.liveShootables ?? null,
      };
      const impact = targetEntity === null
        ? null
        : debug.projectileImpact?.(
          scenario.action.weapon,
          targetEntity,
          missileX,
          missileY,
          missileZ,
          sourceReference.directDamage,
        ) ?? null;

      await new Promise(requestAnimationFrame);
      const afterStats = debug.stats();
      const afterBudget = afterStats.shootables?.combatBudget ?? null;
      const afterInventory = {
        armor: afterStats.playerArmor ?? null,
        health: afterStats.playerHealth ?? null,
      };
      const afterShootables = {
        dead: afterStats.shootables?.deadShootables ?? null,
        live: afterStats.shootables?.liveShootables ?? null,
      };

      return {
        action: scenario.action,
        after: afterBudget,
        afterInventory,
        afterShootables,
        before: beforeBudget,
        beforeInventory,
        beforeShootables,
        hasDebug: true,
        impact,
        mapName: afterStats.mapName ?? null,
        mountTargetOk,
        scenarioId: scenario.id,
        setPlayerOk,
        setTargetOriginOk,
        setWeaponOk,
        sourceReference: {
          directDamage: sourceReference.directDamage,
          expectedSourcePlayerSplashDamage: sourceReference.playerSplashDamage,
          missileOrigin: { x: missileX, y: missileY, z: missileZ },
          playerAngles: { pitch, roll, yaw },
          playerOrigin: { x: playerX, y: playerY, z: playerZ },
          requestedTargetEntity,
          sourceEvent: sourceReference.sourceEvent,
          targetClassname: scenario.edit.select.classname,
          targetEntity,
          targetEntityIndexes,
          targetSelection: targetEntity === requestedTargetEntity ? "requested-nth" : "first-active-shootable",
          targetOrigin: { x: targetX, y: targetY, z: targetZ },
          weapon: scenario.action.weapon,
        },
        targetEntity,
      };
    }, { scenario: ROCKET_TOUCH_SCENARIO, sourceReference: ROCKET_TOUCH_SOURCE });
    result.pageErrors = pageErrors;
    const failures = validateRocketTouchResult(result);
    if (failures.length) throw new Error(`Rocket touch fixture failed: ${failures.join("; ")}`);
    const playerDamage = result.beforeInventory.health - result.afterInventory.health;
    const losDelta = budgetCounterDelta(result.before, result.after, "lineOfSightChecksTotal");
    console.log(`PASS rocket touch direct ${ROCKET_TOUCH_SOURCE.directDamage}, player splash ${playerDamage}, LOS cost ${losDelta}`);
    return {
      failures,
      generatedAt: new Date().toISOString(),
      kind: "cssquake-rocket-touch-browser-fixture",
      mapName: ROCKET_TOUCH_MAP,
      pass: true,
      result,
      scenarioId: ROCKET_TOUCH_SCENARIO.id,
      sourceReference: ROCKET_TOUCH_SOURCE,
    };
  } finally {
    await page.close();
  }
}

function validateRocketTouchResult(result) {
  const failures = [];
  const action = ROCKET_TOUCH_SCENARIO.action;
  const expectedSplash = ROCKET_TOUCH_SOURCE.playerSplashDamage;
  if (!result.hasDebug) failures.push("debug hooks missing");
  if (result.pageErrors?.length) failures.push(`page errors: ${result.pageErrors.join(" | ")}`);
  if (result.mapName !== ROCKET_TOUCH_MAP) failures.push(`unexpected map ${result.mapName}`);
  if (result.scenarioId !== ROCKET_TOUCH_SCENARIO.id) failures.push(`scenario id mismatch: ${result.scenarioId}`);
  if (!result.targetEntity) failures.push("target entity was not selected");
  if (!result.setPlayerOk) failures.push("failed to place player fixture");
  if (!result.setTargetOriginOk) failures.push("failed to place target fixture");
  if (!result.mountTargetOk) failures.push("failed to mount target fixture");
  if (!result.setWeaponOk) failures.push("failed to set rocketlauncher");
  if (!result.impact) failures.push("debug projectileImpact returned null");
  if (!result.before) failures.push("missing before combat budget stats");
  if (!result.after) failures.push("missing after combat budget stats");
  if (result.impact) {
    if (result.impact.weapon !== action.weapon) failures.push(`impact weapon ${result.impact.weapon}, expected ${action.weapon}`);
    if (result.impact.impactResult !== "remove") failures.push(`impact result ${result.impact.impactResult}, expected remove`);
    if (result.impact.directDamage !== ROCKET_TOUCH_SOURCE.directDamage) {
      failures.push(`impact direct damage ${result.impact.directDamage}, expected ${ROCKET_TOUCH_SOURCE.directDamage}`);
    }
    if (result.impact.directEntityIndex !== result.targetEntity) {
      failures.push(`impact direct entity ${result.impact.directEntityIndex}, expected ${result.targetEntity}`);
    }
    if (result.impact.splashDamage !== 120) failures.push(`rocket splash damage ${result.impact.splashDamage}, expected 120`);
    if (result.impact.splashRadiusQuakeUnits !== 160) {
      failures.push(`rocket splash radius ${result.impact.splashRadiusQuakeUnits}, expected 160 Quake units`);
    }
    if (result.impact.splashRequiresCanDamage !== true) failures.push("rocket splash should require CanDamage");
    if (result.impact.splashIgnoresDirectHit !== true) failures.push("rocket splash should ignore direct-hit target");
  }
  if (result.beforeInventory && result.afterInventory) {
    const healthDelta = result.beforeInventory.health - result.afterInventory.health;
    if (healthDelta !== expectedSplash) {
      failures.push(`player splash damage ${healthDelta}, expected source ${expectedSplash}`);
    }
  }
  if (result.beforeShootables && result.afterShootables) {
    const liveDelta = result.afterShootables.live - result.beforeShootables.live;
    if (liveDelta !== -1) failures.push(`live shootable delta ${liveDelta}, expected -1`);
  }
  if (result.before && result.after) {
    const losDelta = budgetCounterDelta(result.before, result.after, "lineOfSightChecksTotal");
    const unmountedAiDelta = budgetCounterDelta(result.before, result.after, "unmountedAiTicksTotal");
    const domReadDelta = budgetCounterDelta(result.before, result.after, "domReadsTotal");
    const limits = result.after.limits ?? {};
    if (losDelta < 1 || losDelta > 5) failures.push(`rocket touch LOS cost ${losDelta}, expected 1-5`);
    if (unmountedAiDelta !== 0) failures.push(`unmounted AI ticks changed by ${unmountedAiDelta}`);
    if (domReadDelta !== 0) failures.push(`DOM reads changed by ${domReadDelta}`);
    if (result.after.expandedLogicalCombatEnabled !== false) failures.push("expanded logical combat should stay disabled");
    if (result.after.unmountedAiEnabled !== false) failures.push("unmounted AI should stay disabled");
    if ((result.after.currentFrame?.lineOfSightChecks ?? 0) > (limits.lineOfSightChecksPerFrame ?? Infinity)) {
      failures.push(`current-frame LOS over cap: ${result.after.currentFrame.lineOfSightChecks}`);
    }
    if ((result.after.maxFrame?.lineOfSightChecks ?? 0) > (limits.lineOfSightChecksPerFrame ?? Infinity)) {
      failures.push(`max-frame LOS over cap: ${result.after.maxFrame.lineOfSightChecks}`);
    }
    if ((result.after.maxPerSecond?.lineOfSightChecks ?? 0) > (limits.lineOfSightChecksPerSecond ?? Infinity)) {
      failures.push(`per-second LOS over cap: ${result.after.maxPerSecond.lineOfSightChecks}`);
    }
  }
  return failures;
}

async function runRocketFireFixture({ browser, baseUrl, options }) {
  const { page, pageErrors } = await openDebugMapPage(browser, baseUrl, ROCKET_FIRE_MAP, options);
  try {
    const result = await page.evaluate(async ({ scenario, sourceReference, timeoutMs }) => {
      const debug = window.__cssQuakeDebug;
      const [playerX, playerY, playerZ] = scenario.player.origin;
      const [pitch, yaw, roll] = scenario.player.angles;
      const [targetX, targetY, targetZ] = scenario.edit.origin;
      if (!debug?.stats) return { hasDebug: false };

      debug.setExpandedLogicalCombat?.(false);
      debug.setUnmountedAi?.(false);
      const setPlayerOk = Boolean(debug.setViewpos?.(playerX, playerY, playerZ, pitch, yaw, roll, {
        gameplay: true,
        stableViewmodel: true,
      }));
      const setWeaponOk = Boolean(debug.setWeapon?.(scenario.action.weapon));

      const targetEntityIndexes = debug.entityIndexes?.(scenario.edit.select.classname) ?? [];
      const requestedTargetEntity = targetEntityIndexes[scenario.edit.select.nth ?? 0] ?? null;
      const targetSearchOrder = [
        ...targetEntityIndexes.slice(scenario.edit.select.nth ?? 0),
        ...targetEntityIndexes.slice(0, scenario.edit.select.nth ?? 0),
      ];
      let targetEntity = null;
      let setTargetOriginOk = false;
      let mountTargetOk = false;
      for (const entityIndex of targetSearchOrder) {
        if (!debug.setEntityOrigin?.(entityIndex, targetX, targetY, targetZ)) continue;
        targetEntity = entityIndex;
        setTargetOriginOk = true;
        mountTargetOk = Boolean(debug.debugMountEntity?.(entityIndex));
        break;
      }

      await nextFrame();
      await nextFrame();

      const beforeStats = debug.stats();
      const beforeInventory = {
        armor: beforeStats.playerArmor ?? null,
        health: beforeStats.playerHealth ?? null,
      };
      const beforeShootables = {
        dead: beforeStats.shootables?.deadShootables ?? null,
        live: beforeStats.shootables?.liveShootables ?? null,
      };
      const fireTrace = await debug.fireProjectileTrace?.(
        sourceReference.directDamage,
        Math.min(timeoutMs, 5000),
      ) ?? null;
      await nextFrame();
      const afterStats = debug.stats();
      const afterInventory = {
        armor: afterStats.playerArmor ?? null,
        health: afterStats.playerHealth ?? null,
      };
      const afterShootables = {
        dead: afterStats.shootables?.deadShootables ?? null,
        live: afterStats.shootables?.liveShootables ?? null,
      };

      return {
        action: scenario.action,
        after: afterStats.shootables?.combatBudget ?? null,
        afterInventory,
        afterShootables,
        before: beforeStats.shootables?.combatBudget ?? null,
        beforeInventory,
        beforeShootables,
        fireTrace,
        hasDebug: true,
        mapName: afterStats.mapName ?? null,
        mountTargetOk,
        scenarioId: scenario.id,
        setPlayerOk,
        setTargetOriginOk,
        setWeaponOk,
        sourceReference: {
          directDamage: sourceReference.directDamage,
          expectedSourcePlayerSplashDamage: sourceReference.playerSplashDamage,
          playerAngles: { pitch, roll, yaw },
          playerOrigin: { x: playerX, y: playerY, z: playerZ },
          requestedTargetEntity,
          sourceEvent: sourceReference.sourceEvent,
          sourceMissileOrigin: sourceReference.missileOrigin,
          sourceMissileVelocity: sourceReference.missileVelocity,
          targetClassname: scenario.edit.select.classname,
          targetEntity,
          targetEntityIndexes,
          targetSelection: targetEntity === requestedTargetEntity ? "requested-nth" : "first-active-shootable",
          targetOrigin: { x: targetX, y: targetY, z: targetZ },
          weapon: scenario.action.weapon,
        },
        targetEntity,
      };

      function nextFrame() {
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
      }
    }, { scenario: ROCKET_FIRE_SCENARIO, sourceReference: ROCKET_FIRE_SOURCE, timeoutMs: options.timeoutMs });
    result.pageErrors = pageErrors;
    const failures = validateRocketFireResult(result);
    if (failures.length) throw new Error(`Rocket fire fixture failed: ${failures.join("; ")}`);
    const playerDamage = result.beforeInventory.health - result.afterInventory.health;
    const moveCount = captureRocketFireEvents(result, "move").length;
    console.log(`PASS rocket fire direct ${ROCKET_FIRE_SOURCE.directDamage}, player splash ${playerDamage}, projectile moves ${moveCount}`);
    return {
      failures,
      generatedAt: new Date().toISOString(),
      kind: "cssquake-rocket-fire-browser-fixture",
      mapName: ROCKET_FIRE_MAP,
      pass: true,
      result,
      scenarioId: ROCKET_FIRE_SCENARIO.id,
      sourceReference: ROCKET_FIRE_SOURCE,
    };
  } finally {
    await page.close();
  }
}

function validateRocketFireResult(result) {
  const failures = [];
  const action = ROCKET_FIRE_SCENARIO.action;
  const expectedSplash = ROCKET_FIRE_SOURCE.playerSplashDamage;
  const fireEvents = captureRocketFireEvents(result, "fire");
  const spawnEvents = captureRocketFireEvents(result, "spawn");
  const moveEvents = captureRocketFireEvents(result, "move");
  const impactEvents = captureRocketFireEvents(result, "impact");
  const removeEvents = captureRocketFireEvents(result, "remove");
  const finalImpact = impactEvents.find((event) => event.impactResult === "remove") ?? null;
  if (!result.hasDebug) failures.push("debug hooks missing");
  if (result.pageErrors?.length) failures.push(`page errors: ${result.pageErrors.join(" | ")}`);
  if (result.mapName !== ROCKET_FIRE_MAP) failures.push(`unexpected map ${result.mapName}`);
  if (result.scenarioId !== ROCKET_FIRE_SCENARIO.id) failures.push(`scenario id mismatch: ${result.scenarioId}`);
  if (!result.targetEntity) failures.push("target entity was not selected");
  if (!result.setPlayerOk) failures.push("failed to place player fixture");
  if (!result.setTargetOriginOk) failures.push("failed to place target fixture");
  if (!result.mountTargetOk) failures.push("failed to mount target fixture");
  if (!result.setWeaponOk) failures.push("failed to set rocketlauncher");
  if (!result.fireTrace) failures.push("debug fireProjectileTrace returned null");
  if (result.fireTrace && result.fireTrace.fired !== true) failures.push("debug fireProjectileTrace did not fire");
  if (!fireEvents.length) failures.push("missing projectile fire event");
  if (!spawnEvents.length) failures.push("missing projectile spawn event");
  if (!moveEvents.length) failures.push("missing projectile move event");
  if (!impactEvents.length) failures.push("missing projectile impact event");
  if (!removeEvents.length) failures.push("missing projectile remove event");
  if (!finalImpact) failures.push("missing terminal projectile impact event");
  if (finalImpact) {
    if (finalImpact.weapon !== action.weapon) failures.push(`impact weapon ${finalImpact.weapon}, expected ${action.weapon}`);
    if (finalImpact.target?.entityIndex !== result.targetEntity) {
      failures.push(`impact target ${finalImpact.target?.entityIndex}, expected ${result.targetEntity}`);
    }
    if (finalImpact.damage !== ROCKET_FIRE_SOURCE.directDamage) {
      failures.push(`impact direct damage ${finalImpact.damage}, expected ${ROCKET_FIRE_SOURCE.directDamage}`);
    }
    if (finalImpact.splashDamage !== 120) failures.push(`rocket splash damage ${finalImpact.splashDamage}, expected 120`);
    if (finalImpact.splashRadiusQuakeUnits !== 160) {
      failures.push(`rocket splash radius ${finalImpact.splashRadiusQuakeUnits}, expected 160 Quake units`);
    }
    if (finalImpact.splashIgnoresDirectHit !== true) failures.push("rocket splash should ignore direct-hit target");
  }
  if (result.beforeInventory && result.afterInventory) {
    const healthDelta = result.beforeInventory.health - result.afterInventory.health;
    if (healthDelta !== expectedSplash) failures.push(`player splash damage ${healthDelta}, expected source ${expectedSplash}`);
  }
  if (result.beforeShootables && result.afterShootables) {
    const liveDelta = result.afterShootables.live - result.beforeShootables.live;
    if (liveDelta !== -1) failures.push(`live shootable delta ${liveDelta}, expected -1`);
  }
  if (result.before && result.after) {
    const unmountedAiDelta = budgetCounterDelta(result.before, result.after, "unmountedAiTicksTotal");
    const domReadDelta = budgetCounterDelta(result.before, result.after, "domReadsTotal");
    const limits = result.after.limits ?? {};
    if (unmountedAiDelta !== 0) failures.push(`unmounted AI ticks changed by ${unmountedAiDelta}`);
    if (domReadDelta !== 0) failures.push(`DOM reads changed by ${domReadDelta}`);
    if (result.after.expandedLogicalCombatEnabled !== false) failures.push("expanded logical combat should stay disabled");
    if (result.after.unmountedAiEnabled !== false) failures.push("unmounted AI should stay disabled");
    if ((result.after.maxFrame?.lineOfSightChecks ?? 0) > (limits.lineOfSightChecksPerFrame ?? Infinity)) {
      failures.push(`max-frame LOS over cap: ${result.after.maxFrame.lineOfSightChecks}`);
    }
    if ((result.after.maxPerSecond?.lineOfSightChecks ?? 0) > (limits.lineOfSightChecksPerSecond ?? Infinity)) {
      failures.push(`per-second LOS over cap: ${result.after.maxPerSecond.lineOfSightChecks}`);
    }
  } else {
    failures.push("missing combat budget stats");
  }
  return failures;
}

function captureRocketFireEvents(result, type) {
  return result.fireTrace?.capture?.events?.filter((event) => event.type === type) ?? [];
}

function enemyProjectileChainFixture({ artifact, id, label, scenario }) {
  return {
    id,
    label,
    artifact,
    requirements: { requiredMaps: [scenario.map], requireRenderBundle: true },
    run: (context) => runEnemyProjectileChainFixture(context, scenario),
  };
}

async function runEnemyProjectileChainFixture({ browser, baseUrl, options }, scenario) {
  const { page, pageErrors } = await openDebugMapPage(browser, baseUrl, scenario.map, options);
  try {
    const result = await page.evaluate(async ({ scenario, stepMs }) => {
      const debug = window.__cssQuakeDebug;
      const [playerX, playerY, playerZ] = scenario.player.origin;
      const [pitch, yaw, roll] = scenario.player.angles;
      const [targetX, targetY, targetZ] = scenario.edit.origin;
      if (!debug?.stats) return { hasDebug: false };

      debug.setExpandedLogicalCombat?.(false);
      debug.setUnmountedAi?.(false);
      debug.setMountedEnemyAcquisition?.(true);
      const setPlayerOk = Boolean(debug.setViewpos?.(playerX, playerY, playerZ, pitch, yaw, roll, {
        gameplay: true,
        stableViewmodel: true,
      }));
      const targetEntityIndexes = debug.entityIndexes?.(scenario.edit.select.classname) ?? [];
      const targetEntity = Number.isFinite(scenario.edit.select.entityIndex)
        ? scenario.edit.select.entityIndex
        : targetEntityIndexes[scenario.edit.select.nth ?? 0] ?? null;
      const setTargetOriginOk = targetEntity !== null &&
        Boolean(debug.setEntityOrigin?.(targetEntity, targetX, targetY, targetZ));
      const setTargetYawOk = targetEntity !== null && Boolean(debug.setEntityYaw?.(targetEntity, scenario.edit.yaw));
      const mountTargetOk = targetEntity !== null && Boolean(debug.debugMountEntity?.(targetEntity));
      const setFilterOk = targetEntity !== null && Boolean(debug.setEnemyTickFilter?.([targetEntity]));

      await nextFrame();
      await nextFrame();
      const clearCaptureOk = Boolean(debug.enemyProjectileTraceClear?.());
      const enableCaptureOk = Boolean(debug.enemyProjectileTraceEnabled?.(true));
      const beforeStats = debug.stats();
      const [aimX, aimY, aimZ] = scenario.targetOrigin ?? scenario.player.origin;
      const forceAttackOk = targetEntity !== null &&
        Boolean(debug.enemyForceAttackChain?.(targetEntity, scenario.chain, aimX, aimY, aimZ));
      let capture = debug.enemyProjectileTraceCapture?.() ?? null;
      for (let step = 0; step < 700; step++) {
        if (enemyProjectileChainDone(capture, scenario.expected)) break;
        capture = debug.enemyProjectileTraceStep?.(stepMs) ?? debug.enemyProjectileTraceCapture?.() ?? null;
      }
      const afterStats = debug.stats();
      const disableCaptureOk = Boolean(debug.enemyProjectileTraceEnabled?.(false));
      debug.setEnemyTickFilter?.(null);

      return {
        after: afterStats.shootables?.combatBudget ?? null,
        before: beforeStats.shootables?.combatBudget ?? null,
        capture,
        clearCaptureOk,
        disableCaptureOk,
        enableCaptureOk,
        forceAttackOk,
        hasDebug: true,
        mapName: afterStats.mapName ?? null,
        mountTargetOk,
        scenarioId: scenario.id,
        setFilterOk,
        setPlayerOk,
        setTargetOriginOk,
        setTargetYawOk,
        sourceReference: {
          chain: scenario.chain,
          expected: scenario.expected,
          playerAngles: { pitch, roll, yaw },
          playerOrigin: { x: playerX, y: playerY, z: playerZ },
          targetOrigin: { x: aimX, y: aimY, z: aimZ },
          targetClassname: scenario.edit.select.classname,
          targetEntity,
          targetEntityIndexes,
          targetOrigin: { x: targetX, y: targetY, z: targetZ },
          targetYaw: scenario.edit.yaw,
        },
        targetEntity,
      };

      function enemyProjectileChainDone(captureValue, expected) {
        const events = captureValue?.events ?? [];
        const projectileEvents = events.filter((event) => event.projectile === expected.projectile);
        const spawnCount = projectileEvents.filter((event) => event.type === "spawn").length;
        const moveCount = projectileEvents.filter((event) => event.type === "move").length;
        const expectedImpact = expected.impactResult
          ? projectileEvents.some((event) => event.type === "impact" && event.impactResult === expected.impactResult)
          : true;
        const expectedExpire = expected.expireEvents
          ? projectileEvents.filter((event) => event.type === "expire").length >= expected.expireEvents
          : true;
        const expectedExplosion = expected.explosionEvents
          ? projectileEvents.filter((event) => event.type === "explode").length >= expected.explosionEvents
          : true;
        const expectedRemove = expected.removeEvents
          ? projectileEvents.filter((event) => event.type === "remove").length >= expected.removeEvents
          : true;
        return spawnCount >= (expected.spawnEvents ?? 1) &&
          moveCount >= expected.minMoveEvents &&
          expectedImpact &&
          expectedExpire &&
          expectedExplosion &&
          expectedRemove;
      }

      function nextFrame() {
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
      }
    }, { scenario, stepMs: ENEMY_PROJECTILE_STEP_MS });
    result.pageErrors = pageErrors;
    const failures = validateEnemyProjectileChainResult(result, scenario);
    if (failures.length) throw new Error(`${scenario.id} fixture failed: ${failures.join("; ")}`);
    const projectileEvents = enemyProjectileEvents(result, scenario.expected.projectile);
    const spawnCount = projectileEvents.filter((event) => event.type === "spawn").length;
    const moveCount = projectileEvents.filter((event) => event.type === "move").length;
    const impact = projectileEvents.find((event) =>
      event.type === "impact" &&
      (!scenario.expected.impactResult || event.impactResult === scenario.expected.impactResult)
    );
    const expireCount = projectileEvents.filter((event) => event.type === "expire").length;
    const explosionCount = projectileEvents.filter((event) => event.type === "explode").length;
    const removeCount = projectileEvents.filter((event) => event.type === "remove").length;
    console.log(`PASS ${scenario.id} ${scenario.expected.projectile} spawns ${spawnCount}, moves ${moveCount}` +
      (impact ? `, impact ${impact.impactResult}` : "") +
      (expireCount ? `, expires ${expireCount}` : "") +
      (explosionCount ? `, explodes ${explosionCount}` : "") +
      (removeCount ? `, removes ${removeCount}` : ""));
    return {
      failures,
      generatedAt: new Date().toISOString(),
      kind: "cssquake-enemy-projectile-chain-browser-fixture",
      mapName: scenario.map,
      pass: true,
      result,
      scenario,
      scenarioId: scenario.id,
    };
  } finally {
    await page.close();
  }
}

function validateEnemyProjectileChainResult(result, scenario) {
  const failures = [];
  const expected = scenario.expected;
  const projectileEvents = enemyProjectileEvents(result, expected.projectile);
  const spawnEvents = projectileEvents.filter((event) => event.type === "spawn");
  const moveEvents = projectileEvents.filter((event) => event.type === "move");
  const impactEvents = projectileEvents.filter((event) => event.type === "impact");
  const expireEvents = projectileEvents.filter((event) => event.type === "expire");
  const explosionEvents = projectileEvents.filter((event) => event.type === "explode");
  const removeEvents = projectileEvents.filter((event) => event.type === "remove");
  const expectedSpawns = expected.spawnEvents ?? 1;
  if (!result.hasDebug) failures.push("debug hooks missing");
  if (result.pageErrors?.length) failures.push(`page errors: ${result.pageErrors.join(" | ")}`);
  if (result.mapName !== scenario.map) failures.push(`unexpected map ${result.mapName}`);
  if (result.scenarioId !== scenario.id) failures.push(`scenario id mismatch: ${result.scenarioId}`);
  if (!result.targetEntity) failures.push("target entity was not selected");
  if (!result.setPlayerOk) failures.push("failed to place player fixture");
  if (!result.setTargetOriginOk) failures.push("failed to place enemy fixture");
  if (!result.setTargetYawOk) failures.push("failed to set enemy yaw");
  if (!result.mountTargetOk) failures.push("failed to mount enemy fixture");
  if (!result.setFilterOk) failures.push("failed to focus enemy tick filter");
  if (!result.clearCaptureOk) failures.push("failed to clear enemy projectile capture");
  if (!result.enableCaptureOk) failures.push("failed to enable enemy projectile capture");
  if (!result.disableCaptureOk) failures.push("failed to disable enemy projectile capture");
  if (!result.forceAttackOk) failures.push(`failed to force enemy attack chain ${scenario.chain}`);
  if (!result.before || !result.after) failures.push("missing combat budget stats");
  if (spawnEvents.length < expectedSpawns) failures.push(`projectile spawns ${spawnEvents.length}, expected at least ${expectedSpawns}`);
  if (moveEvents.length < expected.minMoveEvents) failures.push(`projectile moves ${moveEvents.length}, expected at least ${expected.minMoveEvents}`);
  if (expected.expireEvents && expireEvents.length < expected.expireEvents) {
    failures.push(`projectile expires ${expireEvents.length}, expected at least ${expected.expireEvents}`);
  }
  if (expected.explosionEvents && explosionEvents.length < expected.explosionEvents) {
    failures.push(`projectile explosions ${explosionEvents.length}, expected at least ${expected.explosionEvents}`);
  }
  if (expected.removeEvents && removeEvents.length < expected.removeEvents) {
    failures.push(`projectile removes ${removeEvents.length}, expected at least ${expected.removeEvents}`);
  }
  for (const event of spawnEvents) {
    if (event.modelPath !== expected.modelPath) failures.push(`spawn model ${event.modelPath}, expected ${expected.modelPath}`);
    if (event.damage !== expected.damage) failures.push(`spawn damage ${event.damage}, expected ${expected.damage}`);
    if (expected.splashDamage !== undefined && event.splashDamage !== expected.splashDamage) {
      failures.push(`spawn splash damage ${event.splashDamage}, expected ${expected.splashDamage}`);
    }
    if (expected.splashRadiusQuakeUnits !== undefined && event.splashRadiusQuakeUnits !== expected.splashRadiusQuakeUnits) {
      failures.push(`spawn splash radius ${event.splashRadiusQuakeUnits}, expected ${expected.splashRadiusQuakeUnits}`);
    }
    if (expected.worldTouch && event.worldTouch !== expected.worldTouch) {
      failures.push(`spawn worldTouch ${event.worldTouch}, expected ${expected.worldTouch}`);
    }
    if (event.sourceEntityIndex !== result.targetEntity) {
      failures.push(`spawn source ${event.sourceEntityIndex}, expected ${result.targetEntity}`);
    }
  }
  if (expected.impactResult) {
    const impact = impactEvents.find((event) => event.impactResult === expected.impactResult) ?? null;
    if (!impact) failures.push(`missing projectile impact ${expected.impactResult}`);
    else {
      if (expected.worldTouch && impact.worldTouch !== expected.worldTouch) {
        failures.push(`impact worldTouch ${impact.worldTouch}, expected ${expected.worldTouch}`);
      }
      if (expected.impactTraceClassname && impact.trace?.classname !== expected.impactTraceClassname) {
        failures.push(`impact trace classname ${impact.trace?.classname}, expected ${expected.impactTraceClassname}`);
      }
      if (expected.impactVelocity && !vec3Equals(impact.velocity, expected.impactVelocity)) {
        failures.push(`impact velocity ${JSON.stringify(impact.velocity)}, expected ${JSON.stringify(expected.impactVelocity)}`);
      }
      if (expected.impactVelocityZ === "positive" && !(impact.velocity?.[2] > 0)) {
        failures.push(`impact velocity z ${impact.velocity?.[2]}, expected positive`);
      }
    }
  }
  if (expected.explosionEvents) {
    for (const event of explosionEvents) {
      if (expected.splashDamage !== undefined && event.splashDamage !== expected.splashDamage) {
        failures.push(`explosion splash damage ${event.splashDamage}, expected ${expected.splashDamage}`);
      }
      if (expected.splashRadiusQuakeUnits !== undefined && event.splashRadiusQuakeUnits !== expected.splashRadiusQuakeUnits) {
        failures.push(`explosion splash radius ${event.splashRadiusQuakeUnits}, expected ${expected.splashRadiusQuakeUnits}`);
      }
      if (expected.worldTouch && event.worldTouch !== expected.worldTouch) {
        failures.push(`explosion worldTouch ${event.worldTouch}, expected ${expected.worldTouch}`);
      }
    }
  }
  return failures;
}

function enemyProjectileEvents(result, projectile) {
  return result.capture?.events?.filter((event) => event.projectile === projectile) ?? [];
}

function budgetCounterDelta(before, after, name) {
  return (after?.counters?.[name] ?? 0) - (before?.counters?.[name] ?? 0);
}

function vec3Equals(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}
