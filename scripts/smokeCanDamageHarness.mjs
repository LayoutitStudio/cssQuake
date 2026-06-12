#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { chromium } from "playwright";

const DEFAULT_PORT = 5186;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_VIEWPORT = "1280x800";
const DEFAULT_SCENARIO = "notes/oracle-scenarios/e1m1-soldier-candamage-edge.json";
const DEFAULT_JSON_OUT = "bench/results/quake/oracle/e1m1-soldier-candamage-edge.cssquake.json";

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
  node scripts/smokeCanDamageHarness.mjs [options]

Options:
  --scenario <file>    Scenario JSON. Default: ${DEFAULT_SCENARIO}
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
  if (action?.type !== "canDamage") {
    throw new Error(`CanDamage harness requires first action.type=canDamage, got ${action?.type}`);
  }
  return action;
}

function scenarioEdit(scenario) {
  const edit = scenario.edits?.[0];
  if (!edit?.select?.classname || !Array.isArray(edit.origin) || edit.origin.length !== 3) {
    throw new Error("CanDamage harness requires one classname-selected edit with a three-value origin");
  }
  return edit;
}

function preflightRenderBundle(mapName) {
  const file = `build/generated/public/q/${mapName}.json`;
  if (!existsSync(file)) {
    throw new Error(`CanDamage harness requires ${file}. Run asset prepare only if the generated map is missing.`);
  }
  const prepared = readJson(file);
  if (!prepared.renderBundle) throw new Error(`CanDamage harness requires renderBundle in ${file}.`);
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

async function runHarnessCase(browser, baseUrl, { scenario, scenarioPath, timeoutMs, viewport }) {
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
    const result = await page.evaluate(async ({ scenario, scenarioPath }) => {
      const debug = window.__cssQuakeDebug;
      const edit = scenario.edits[0];
      const action = scenario.actions[0];
      const [playerX, playerY, playerZ] = scenario.player.origin;
      const [targetX, targetY, targetZ] = edit.origin;
      if (!debug?.stats) return { hasDebug: false, scenarioPath };

      debug.setExpandedLogicalCombat?.(false);
      debug.setUnmountedAi?.(false);
      const nth = edit.select.nth ?? 0;
      const targetEntityIndexes = debug.entityIndexes?.(edit.select.classname) ?? [];
      const requestedTargetEntity = targetEntityIndexes[nth] ?? null;
      const targetSearchOrder = [
        ...targetEntityIndexes.slice(nth),
        ...targetEntityIndexes.slice(0, nth),
      ];
      let targetEntity = null;
      let setTargetOriginOk = false;
      for (const entityIndex of targetSearchOrder) {
        if (!debug.setEntityOrigin?.(entityIndex, targetX, targetY, targetZ)) continue;
        targetEntity = entityIndex;
        setTargetOriginOk = true;
        break;
      }

      await new Promise(requestAnimationFrame);
      const beforeStats = debug.stats();
      const beforeBudget = beforeStats.shootables?.combatBudget ?? null;
      const canDamage = debug.canDamage?.(playerX, playerY, playerZ, targetX, targetY, targetZ) ?? null;
      const afterStats = debug.stats();
      const afterBudget = afterStats.shootables?.combatBudget ?? null;

      return {
        action,
        after: afterBudget,
        before: beforeBudget,
        canDamage,
        hasDebug: true,
        mapName: afterStats.mapName ?? null,
        pageScenarioId: scenario.id,
        scenarioPath,
        setTargetOriginOk,
        sourceReference: {
          actionType: action.type,
          expectedResult: action.expectedResult,
          inflictor: action.inflictor,
          playerOrigin: { x: playerX, y: playerY, z: playerZ },
          requestedTargetEntity,
          targetClassname: edit.select.classname,
          targetEntity,
          targetEntityIndexes,
          targetSelection: targetEntity === requestedTargetEntity ? "requested-nth" : "first-active-shootable",
          targetOrigin: { x: targetX, y: targetY, z: targetZ },
        },
        targetEntity,
      };
    }, { scenario, scenarioPath });
    return { ...result, pageErrors };
  } finally {
    await page.close();
  }
}

function budgetCounterDelta(before, after, name) {
  return (after?.counters?.[name] ?? 0) - (before?.counters?.[name] ?? 0);
}

function validateHarnessResult(result, scenario) {
  const failures = [];
  const action = scenarioAction(scenario);
  if (!result.hasDebug) failures.push("debug hooks missing");
  if (result.pageErrors?.length) failures.push(`page errors: ${result.pageErrors.join(" | ")}`);
  if (result.mapName !== scenario.map) failures.push(`unexpected map ${result.mapName}`);
  if (result.pageScenarioId !== scenario.id) failures.push(`scenario id mismatch in page result: ${result.pageScenarioId}`);
  if (!result.targetEntity) failures.push("target entity was not selected");
  if (!result.setTargetOriginOk) failures.push("failed to place target fixture");
  if (!result.canDamage) failures.push("debug canDamage returned null");
  if (!result.before) failures.push("missing before combat budget stats");
  if (!result.after) failures.push("missing after combat budget stats");
  if (result.canDamage) {
    if (result.canDamage.result !== action.expectedResult) {
      failures.push(`CanDamage result ${result.canDamage.result}, expected ${action.expectedResult}`);
    }
    if (!Array.isArray(result.canDamage.traces) || result.canDamage.traces.length !== 5) {
      failures.push("CanDamage should report five traces");
    }
  }
  if (result.before && result.after) {
    const losDelta = budgetCounterDelta(result.before, result.after, "lineOfSightChecksTotal");
    const unmountedAiDelta = budgetCounterDelta(result.before, result.after, "unmountedAiTicksTotal");
    const domReadDelta = budgetCounterDelta(result.before, result.after, "domReadsTotal");
    const limits = result.after.limits ?? {};
    if (losDelta !== 5) failures.push(`CanDamage should cost exactly five LOS checks, got ${losDelta}`);
    if (unmountedAiDelta !== 0) failures.push(`unmounted AI ticks changed by ${unmountedAiDelta}`);
    if (domReadDelta !== 0) failures.push(`DOM reads changed by ${domReadDelta}`);
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
  const timeoutMs = Math.max(1_000, Math.round(numberOption("timeout-ms", DEFAULT_TIMEOUT_MS)));
  const viewport = viewportOption();
  preflightRenderBundle(scenario.map);
  const server = await startServer();
  const browser = await chromium.launch({ headless: !flag("headed") });
  let result;
  try {
    result = await runHarnessCase(browser, server.url, { scenario, scenarioPath, timeoutMs, viewport });
  } finally {
    await browser.close();
    await server.close();
  }

  const failures = validateHarnessResult(result, scenario);
  const summary = {
    generatedAt: new Date().toISOString(),
    mapName: scenario.map,
    pass: failures.length === 0,
    result,
    scenarioId: scenario.id,
    scenarioPath,
    failures,
  };
  const jsonOut = option("json-out", DEFAULT_JSON_OUT);
  if (jsonOut) writeJson(jsonOut, summary);
  if (!summary.pass) {
    throw new Error(`CanDamage harness failed: ${failures.join("; ")}`);
  }
  console.log(`CanDamage harness passed: result ${result.canDamage.result}, LOS cost 5.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
