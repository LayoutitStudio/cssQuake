#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { chromium } from "playwright";

const DEFAULT_PORT = 5185;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_VIEWPORT = "1280x800";
const DEFAULT_MAP = "e1m1";
const ANCHOR_ENTITY = 21;
const TARGET_ORIGIN = { x: 616, y: 72, z: 40 };
const VIEW_DISTANCE = 4.96;
const VIEW_ROT_X = 90;
const VIEW_ROT_Y = 90;
const SOURCE_REFERENCE = {
  engine: "Quake/vkQuake",
  monsterClassname: "monster_army",
  monsterHealth: 30,
  weapon: "rocketlauncher",
  directDamage: 100,
  expectedKilled: true,
  targetOrigin: TARGET_ORIGIN,
  playerOrigin: { x: 616, y: 320, z: 75 },
  playerAngles: { pitch: 0, yaw: 270, roll: 0 },
  comparison: "same map-space target path; cssQuake damage must pass through weaponTargets() while the target is unmounted",
};
const CANDIDATE_ENTITIES = [
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
  node scripts/smokeLogicalTargetabilityHarness.mjs [options]

Options:
  --url <url>          Use an already-running cssQuake dev server.
  --port <port>        Port for the temporary Vite server. Default: ${DEFAULT_PORT}
  --map <map>          Map to load. Default: ${DEFAULT_MAP}
  --headed             Run Chromium headed.
  --viewport <WxH>     Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>    Readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --json-out <file>    Write the full result JSON.

This fixture enables expanded logical combat through the debug hook, but keeps
unmounted AI disabled. It proves an over-mount-budget monster can be damaged
through logical weapon target bounds.`);
}

function preflightRenderBundle(mapName) {
  const path = `build/generated/public/q/${mapName}.json`;
  if (!existsSync(path)) {
    throw new Error(`Logical targetability harness requires ${path}. Run asset prepare only if the generated map is missing.`);
  }
  const prepared = JSON.parse(readFileSync(path, "utf8"));
  if (!prepared.renderBundle) {
    throw new Error(`Logical targetability harness requires renderBundle in ${path}.`);
  }
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

async function runHarnessCase(browser, baseUrl, { mapName, timeoutMs, viewport }) {
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
    await page.goto(mapUrl(baseUrl, mapName), { waitUntil: "domcontentloaded" });
    await waitForMapReady(page, mapName, timeoutMs);
    const result = await page.evaluate(async ({
      anchorEntity,
      candidateEntities,
      SOURCE_REFERENCE,
      TARGET_ORIGIN,
      VIEW_DISTANCE,
      VIEW_ROT_X,
      VIEW_ROT_Y,
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
      const targetFixture = activeCandidates.find((candidate) =>
        !preferredBlockerIndexes.includes(candidate.entityIndex)
      ) ?? null;
      const fixtureCandidates = targetFixture ? [targetFixture, ...blockerFixtures] : [];
      const targetOrigin = TARGET_ORIGIN;
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
      const viewPoseOk = Boolean(debug.focusEntity?.(anchorEntity, VIEW_DISTANCE, VIEW_ROT_X, VIEW_ROT_Y));
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
        debug.damageWeaponTarget?.(targetEntity, SOURCE_REFERENCE.directDamage)
      );
      await sleepInPage(100);
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);

      const afterStats = debug.stats();
      const afterBudget = afterStats.shootables?.combatBudget ?? null;
      return {
        activeEnemyIndexesBefore,
        after: afterBudget,
        afterDeadShootables: afterStats.shootables?.deadShootables ?? 0,
        afterLiveShootables: afterStats.shootables?.liveShootables ?? 0,
        before: beforeBudget,
        beforeDeadShootables,
        beforeLiveShootables,
        beforeOrigin: beforeStats.origin ?? null,
        beforeCameraRotX: beforeStats.cameraRotX ?? null,
        beforeCameraRotY: beforeStats.cameraRotY ?? null,
        damageWeaponTargetOk,
        disableUnmountedAiOk,
        enableExpandedOk,
        hasDebug: true,
        mapName: afterStats.mapName ?? null,
        originResults,
        activeCandidateEntityIndexes: activeCandidates.map((candidate) => candidate.entityIndex),
        selectedFixtureEntityIndexes: fixtureCandidates.map((candidate) => candidate.entityIndex),
        sourceReference: SOURCE_REFERENCE,
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
      anchorEntity: ANCHOR_ENTITY,
      candidateEntities: CANDIDATE_ENTITIES,
      SOURCE_REFERENCE,
      TARGET_ORIGIN,
      VIEW_DISTANCE,
      VIEW_ROT_X,
      VIEW_ROT_Y,
    });
    return { ...result, pageErrors };
  } finally {
    await page.close();
  }
}

function validateHarnessResult(result, expectedMapName) {
  const failures = [];
  if (!result.hasDebug) failures.push("debug hooks missing");
  if (result.pageErrors?.length) failures.push(`page errors: ${result.pageErrors.join(" | ")}`);
  if (result.mapName !== expectedMapName) failures.push(`unexpected map ${result.mapName}`);
  if (!result.originResults?.every(Boolean)) failures.push(`failed to place target fixtures: ${JSON.stringify(result.originResults)}`);
  if (!result.enableExpandedOk) failures.push("failed to enable expanded logical combat");
  if (!result.disableUnmountedAiOk) failures.push("failed to disable unmounted AI");
  if ((result.selectedFixtureEntityIndexes?.length ?? 0) < 6) {
    failures.push(`expected at least 6 active monster fixtures, got ${JSON.stringify(result.selectedFixtureEntityIndexes)}`);
  }
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
    if (!result.before.combatInterestEntityIndexes?.includes?.(result.targetEntity)) {
      failures.push(`combat interest set should include target ${result.targetEntity}`);
    }
    if ((result.before.combatInterestSetSize ?? 0) > limits.combatInterestSet) {
      failures.push(`combat interest size over cap before fire: ${result.before.combatInterestSetSize}`);
    }
    if ((afterCounters.weaponTargetsYieldedTotal ?? 0) <= (beforeCounters.weaponTargetsYieldedTotal ?? 0)) {
      failures.push("weaponTargetsYieldedTotal did not increase after logical weapon-target damage");
    }
    if ((afterCounters.unmountedAiTicksTotal ?? 0) !== 0) {
      failures.push(`unmountedAiTicksTotal should stay 0, got ${afterCounters.unmountedAiTicksTotal}`);
    }
    if ((afterCounters.domReadsTotal ?? 0) !== 0) failures.push(`domReadsTotal ${afterCounters.domReadsTotal}`);
    if ((result.after.maxFrame?.lineOfSightChecks ?? 0) > limits.lineOfSightChecksPerFrame) {
      failures.push(`lineOfSightChecks max frame ${result.after.maxFrame.lineOfSightChecks}`);
    }
    if ((result.after.maxFrame?.attackChainChecks ?? 0) > limits.attackChainChecksPerFrame) {
      failures.push(`attackChainChecks max frame ${result.after.maxFrame.attackChainChecks}`);
    }
    if ((result.after.maxPerSecond?.lineOfSightChecks ?? 0) > limits.lineOfSightChecksPerSecond) {
      failures.push(`lineOfSightChecks max second ${result.after.maxPerSecond.lineOfSightChecks}`);
    }
  }
  if (!(result.afterLiveShootables < result.beforeLiveShootables)) {
    failures.push(`live shootable count did not decrease: ${result.beforeLiveShootables} -> ${result.afterLiveShootables}`);
  }
  return failures;
}

async function main() {
  if (flag("help") || flag("h")) {
    printHelp();
    return;
  }
  const mapName = option("map", DEFAULT_MAP);
  const timeoutMs = Math.max(1_000, Math.round(numberOption("timeout-ms", DEFAULT_TIMEOUT_MS)));
  const viewport = viewportOption();
  preflightRenderBundle(mapName);
  const server = await startServer();
  const browser = await chromium.launch({ headless: !flag("headed") });
  let result;
  try {
    result = await runHarnessCase(browser, server.url, { mapName, timeoutMs, viewport });
  } finally {
    await browser.close();
    await server.close();
  }

  const failures = validateHarnessResult(result, mapName);
  const summary = {
    generatedAt: new Date().toISOString(),
    mapName,
    pass: failures.length === 0,
    result,
    failures,
  };
  const jsonOut = option("json-out");
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.pass) {
    throw new Error(`Logical targetability harness failed: ${failures.join("; ")}`);
  }
  console.log(`Logical targetability harness passed: target ${result.targetEntity} damaged while unmounted.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
