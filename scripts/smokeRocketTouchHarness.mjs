#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { chromium } from "playwright";

const DEFAULT_PORT = 5187;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_VIEWPORT = "1280x800";
const DEFAULT_SCENARIO = "notes/oracle-scenarios/e1m1-soldier-rocket-touch.json";
const DEFAULT_VKQUAKE = "bench/results/quake/oracle/e1m1-soldier-rocket-touch.vkquake.json";
const DEFAULT_JSON_OUT = "bench/results/quake/oracle/e1m1-soldier-rocket-touch.cssquake.json";

const argv = process.argv.slice(2);

function flag(name) {
  return argv.includes(`--${name}`);
}

function option(name, fallback = "") {
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--")) return argv[index + 1];
  const prefixed = argv.find((arg) => arg.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : fallback;
}

function numberOption(name, fallback) {
  const raw = option(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function viewportOption() {
  const raw = option("viewport", DEFAULT_VIEWPORT);
  const match = raw.match(/^(\d+)x(\d+)$/i);
  if (!match) throw new Error(`Invalid --viewport "${raw}". Expected WIDTHxHEIGHT.`);
  return {
    height: Number(match[2]),
    width: Number(match[1]),
  };
}

function printHelp() {
  console.log(`Usage:
  node scripts/smokeRocketTouchHarness.mjs [options]

Options:
  --scenario <file>    Scenario JSON. Default: ${DEFAULT_SCENARIO}
  --vkquake <file>     vkQuake source oracle JSON. Default: ${DEFAULT_VKQUAKE}
  --url <url>          Use an already-running cssQuake dev server.
  --port <port>        Port for the temporary Vite server. Default: ${DEFAULT_PORT}
  --headed             Run Chromium headed.
  --viewport <WxH>     Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>    Readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --json-out <file>    Write the result JSON. Default: ${DEFAULT_JSON_OUT}`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function scenarioAction(scenario) {
  const action = scenario.actions?.[0];
  if (action?.type !== "rocketTouch") {
    throw new Error(`Rocket-touch harness requires first action.type=rocketTouch, got ${action?.type}`);
  }
  if (action.weapon !== "rocketlauncher") {
    throw new Error(`Rocket-touch harness currently supports weapon=rocketlauncher, got ${action.weapon}`);
  }
  if (!Array.isArray(action.missileOrigin) || action.missileOrigin.length !== 3) {
    throw new Error("Rocket-touch harness requires action.missileOrigin");
  }
  return action;
}

function scenarioEdit(scenario) {
  const edit = scenario.edits?.[0];
  if (!edit?.select?.classname || !Array.isArray(edit.origin) || edit.origin.length !== 3) {
    throw new Error("Rocket-touch harness requires one classname-selected edit with a three-value origin");
  }
  return edit;
}

function sourceRocketTouchEvent(vkquake) {
  return vkquake?.events?.find((event) => event.type === "T_MissileTouch") ?? null;
}

function sourceReferenceFromVkquake(vkquake, scenario) {
  const event = sourceRocketTouchEvent(vkquake);
  const action = scenarioAction(scenario);
  return {
    directDamage: finiteNumber(event?.directDamage?.amount, action.expectedDirectDamageMin),
    playerSplashDamage: finiteNumber(event?.radiusDamage?.player?.amount, null),
    sourceEventFound: Boolean(event),
    sourcePath: option("vkquake", DEFAULT_VKQUAKE),
  };
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function preflightRenderBundle(mapName) {
  const file = `build/generated/public/q/${mapName}.json`;
  if (!existsSync(file)) {
    throw new Error(`Rocket-touch harness requires ${file}. Run asset prepare only if the generated map is missing.`);
  }
  const prepared = readJson(file);
  if (!prepared.renderBundle) throw new Error(`Rocket-touch harness requires renderBundle in ${file}.`);
}

async function startServer() {
  const explicitUrl = option("url", process.env.CSSQUAKE_SMOKE_URL ?? "");
  if (explicitUrl) return { url: explicitUrl, close: async () => {} };

  const port = Math.max(1, Math.round(numberOption("port", DEFAULT_PORT)));
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const match = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
    if (match) {
      return {
        close: async () => {
          child.kill("SIGTERM");
          await sleep(250);
          if (!child.killed) child.kill("SIGKILL");
        },
        url: `${match[1]}?debug=1`,
      };
    }
    if (child.exitCode !== null) throw new Error(`Vite exited before becoming ready.\n${output}`);
    await sleep(100);
  }
  child.kill("SIGTERM");
  throw new Error(`Timed out waiting for Vite.\n${output}`);
}

function mapUrl(baseUrl, mapName) {
  const url = new URL(baseUrl);
  url.searchParams.set("debug", "1");
  url.searchParams.set("map", mapName);
  return url.toString();
}

async function waitForMapReady(page, mapName, timeoutMs) {
  await page.waitForFunction((targetMap) => {
    const stats = window.__cssQuakeDebug?.stats?.();
    return stats &&
      stats.mapName === targetMap &&
      !stats.loading &&
      document.querySelectorAll(".polycss-mesh").length > 0;
  }, mapName, { timeout: timeoutMs });
}

async function runHarnessCase(browser, baseUrl, { scenario, scenarioPath, sourceReference, timeoutMs, viewport }) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => {
    window.__cssQuakeDebugDomMetadata = true;
  });
  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error?.message ?? error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  try {
    await page.goto(mapUrl(baseUrl, scenario.map), { waitUntil: "domcontentloaded" });
    await waitForMapReady(page, scenario.map, timeoutMs);
    const result = await page.evaluate(async ({ scenario, scenarioPath, sourceReference }) => {
      const debug = window.__cssQuakeDebug;
      const edit = scenario.edits[0];
      const action = scenario.actions[0];
      const [playerX, playerY, playerZ] = scenario.player.origin;
      const [pitch, yaw, roll] = scenario.player.angles;
      const [targetX, targetY, targetZ] = edit.origin;
      const [missileX, missileY, missileZ] = action.missileOrigin;
      if (!debug?.stats) return { hasDebug: false, scenarioPath };

      debug.setExpandedLogicalCombat?.(false);
      debug.setUnmountedAi?.(false);
      const setPlayerOk = Boolean(debug.setViewpos?.(playerX, playerY, playerZ, pitch, yaw, roll, {
        gameplay: true,
      }));
      const setWeaponOk = Boolean(debug.setWeapon?.(action.weapon));

      const nth = edit.select.nth ?? 0;
      const targetEntityIndexes = debug.entityIndexes?.(edit.select.classname) ?? [];
      const requestedTargetEntity = targetEntityIndexes[nth] ?? null;
      const targetSearchOrder = [
        ...targetEntityIndexes.slice(nth),
        ...targetEntityIndexes.slice(0, nth),
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
          action.weapon,
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
        action,
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
        pageScenarioId: scenario.id,
        scenarioPath,
        setPlayerOk,
        setTargetOriginOk,
        setWeaponOk,
        sourceReference: {
          actionType: action.type,
          directDamage: sourceReference.directDamage,
          expectedPlayerSplashDamageMax: action.expectedPlayerSplashDamageMax,
          expectedPlayerSplashDamageMin: action.expectedPlayerSplashDamageMin,
          expectedSourcePlayerSplashDamage: sourceReference.playerSplashDamage,
          missileOrigin: { x: missileX, y: missileY, z: missileZ },
          playerAngles: { pitch, roll, yaw },
          playerOrigin: { x: playerX, y: playerY, z: playerZ },
          requestedTargetEntity,
          targetClassname: edit.select.classname,
          targetEntity,
          targetEntityIndexes,
          targetSelection: targetEntity === requestedTargetEntity ? "requested-nth" : "first-active-shootable",
          targetOrigin: { x: targetX, y: targetY, z: targetZ },
          weapon: action.weapon,
        },
        targetEntity,
      };
    }, { scenario, scenarioPath, sourceReference });
    return { ...result, pageErrors };
  } finally {
    await page.close();
  }
}

function budgetCounterDelta(before, after, name) {
  return (after?.counters?.[name] ?? 0) - (before?.counters?.[name] ?? 0);
}

function validateHarnessResult(result, scenario, sourceReference) {
  const failures = [];
  const action = scenarioAction(scenario);
  const expectedSplash = sourceReference.playerSplashDamage;
  if (!result.hasDebug) failures.push("debug hooks missing");
  if (result.pageErrors?.length) failures.push(`page errors: ${result.pageErrors.join(" | ")}`);
  if (result.mapName !== scenario.map) failures.push(`unexpected map ${result.mapName}`);
  if (result.pageScenarioId !== scenario.id) failures.push(`scenario id mismatch in page result: ${result.pageScenarioId}`);
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
    if (result.impact.directDamage !== sourceReference.directDamage) {
      failures.push(`impact direct damage ${result.impact.directDamage}, expected ${sourceReference.directDamage}`);
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
    if (Number.isFinite(expectedSplash)) {
      if (healthDelta !== expectedSplash) {
        failures.push(`player splash damage ${healthDelta}, expected vkQuake ${expectedSplash}`);
      }
    } else if (healthDelta < action.expectedPlayerSplashDamageMin || healthDelta > action.expectedPlayerSplashDamageMax) {
      failures.push(`player splash damage ${healthDelta}, expected ${action.expectedPlayerSplashDamageMin}-${action.expectedPlayerSplashDamageMax}`);
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

async function main() {
  if (flag("help") || flag("h")) {
    printHelp();
    return;
  }
  const scenarioPath = option("scenario", DEFAULT_SCENARIO);
  const scenario = readJson(scenarioPath);
  scenarioAction(scenario);
  scenarioEdit(scenario);
  const vkquakePath = option("vkquake", DEFAULT_VKQUAKE);
  const vkquake = existsSync(vkquakePath) ? readJson(vkquakePath) : null;
  const sourceReference = sourceReferenceFromVkquake(vkquake, scenario);
  const timeoutMs = Math.max(1_000, Math.round(numberOption("timeout-ms", DEFAULT_TIMEOUT_MS)));
  const viewport = viewportOption();
  preflightRenderBundle(scenario.map);
  const server = await startServer();
  const browser = await chromium.launch({ headless: !flag("headed") });
  let result;
  try {
    result = await runHarnessCase(browser, server.url, { scenario, scenarioPath, sourceReference, timeoutMs, viewport });
  } finally {
    await browser.close();
    await server.close();
  }

  const failures = validateHarnessResult(result, scenario, sourceReference);
  const summary = {
    failures,
    generatedAt: new Date().toISOString(),
    mapName: scenario.map,
    pass: failures.length === 0,
    result,
    scenarioId: scenario.id,
    scenarioPath,
    sourceReference,
    vkquakePath,
  };
  const jsonOut = option("json-out", DEFAULT_JSON_OUT);
  if (jsonOut) writeJson(jsonOut, summary);
  if (!summary.pass) {
    throw new Error(`Rocket-touch harness failed: ${failures.join("; ")}`);
  }
  const playerDamage = result.beforeInventory.health - result.afterInventory.health;
  const losDelta = budgetCounterDelta(result.before, result.after, "lineOfSightChecksTotal");
  console.log(`Rocket-touch harness passed: direct ${sourceReference.directDamage}, player splash ${playerDamage}, LOS cost ${losDelta}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
