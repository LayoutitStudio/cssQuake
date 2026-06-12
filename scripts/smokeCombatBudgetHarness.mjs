#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { chromium } from "playwright";

const DEFAULT_PORT = 5183;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_VIEWPORT = "1280x800";
const DEFAULT_MAP = "e1m1";
const DEFAULT_FOCUS_ENTITY = 298;

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
  node scripts/smokeCombatBudgetHarness.mjs [options]

Options:
  --url <url>          Use an already-running cssQuake dev server.
  --port <port>        Port for the temporary Vite server. Default: ${DEFAULT_PORT}
  --map <map>          Map to load. Default: ${DEFAULT_MAP}
  --entity <index>     Entity to focus before firing. Default: ${DEFAULT_FOCUS_ENTITY}
  --headed             Run Chromium headed.
  --viewport <WxH>     Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>    Readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --json-out <file>    Write the full result JSON.

This smoke validates the combat budget harness baseline. It does not enable
broad logical combat or unmounted AI ticking.`);
}

function preflightRenderBundle(mapName) {
  const path = `build/generated/public/q/${mapName}.json`;
  if (!existsSync(path)) {
    throw new Error(`Combat budget harness requires ${path}. Run asset prepare only if the generated map is missing.`);
  }
  const prepared = JSON.parse(readFileSync(path, "utf8"));
  if (!prepared.renderBundle) {
    throw new Error(`Combat budget harness requires renderBundle in ${path}.`);
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
    if (child.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready.\n${output}`);
    }
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

async function runHarnessCase(browser, baseUrl, { entityIndex, mapName, timeoutMs, viewport }) {
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
    }, { entityIndex });
    return { ...result, pageErrors };
  } finally {
    await page.close();
  }
}

function validateHarnessResult(result) {
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
  if (limits.combatInterestSet !== 12) failures.push(`combatInterestSet limit ${limits.combatInterestSet}`);
  if (limits.unmountedAiActiveSet !== 4) failures.push(`unmountedAiActiveSet limit ${limits.unmountedAiActiveSet}`);
  if (limits.unmountedAiCadenceHz !== 5) failures.push(`unmountedAiCadenceHz limit ${limits.unmountedAiCadenceHz}`);
  if (limits.lineOfSightChecksPerFrame !== 8) failures.push(`lineOfSightChecksPerFrame limit ${limits.lineOfSightChecksPerFrame}`);
  if (limits.lineOfSightChecksPerSecond !== 200) failures.push(`lineOfSightChecksPerSecond limit ${limits.lineOfSightChecksPerSecond}`);
  if (limits.attackChainChecksPerFrame !== 8) failures.push(`attackChainChecksPerFrame limit ${limits.attackChainChecksPerFrame}`);
  if (limits.domReads !== 0) failures.push(`domReads limit ${limits.domReads}`);

  if (after.expandedLogicalCombatEnabled !== false) failures.push("expanded logical combat should be disabled");
  if (after.unmountedAiEnabled !== false) failures.push("unmounted AI should be disabled");
  if (after.combatInterestSetSize > limits.combatInterestSet) {
    failures.push(`combatInterestSetSize over cap, got ${after.combatInterestSetSize}`);
  }
  if (after.unmountedAiActiveSetSize !== 0) {
    failures.push(`unmountedAiActiveSetSize should be 0, got ${after.unmountedAiActiveSetSize}`);
  }
  if ((after.maxFrame?.lineOfSightChecks ?? 0) > limits.lineOfSightChecksPerFrame) {
    failures.push(`lineOfSightChecks max frame ${after.maxFrame.lineOfSightChecks}`);
  }
  if ((after.maxFrame?.attackChainChecks ?? 0) > limits.attackChainChecksPerFrame) {
    failures.push(`attackChainChecks max frame ${after.maxFrame.attackChainChecks}`);
  }
  if ((after.maxPerSecond?.lineOfSightChecks ?? 0) > limits.lineOfSightChecksPerSecond) {
    failures.push(`lineOfSightChecks max second ${after.maxPerSecond.lineOfSightChecks}`);
  }

  const counters = after.counters ?? {};
  const beforeCounters = before.counters ?? {};
  if (counters.unmountedAiTicksTotal !== 0) failures.push(`unmountedAiTicksTotal ${counters.unmountedAiTicksTotal}`);
  if (counters.capDeferralsTotal !== 0) failures.push(`capDeferralsTotal ${counters.capDeferralsTotal}`);
  if (counters.domReadsTotal !== 0) failures.push(`domReadsTotal ${counters.domReadsTotal}`);
  if ((counters.weaponTargetQueriesTotal ?? 0) <= (beforeCounters.weaponTargetQueriesTotal ?? 0)) {
    failures.push("weaponTargetQueriesTotal did not increase after event-bound fire");
  }
  if ((counters.weaponTargetCandidatesTotal ?? 0) <= (beforeCounters.weaponTargetCandidatesTotal ?? 0)) {
    failures.push("weaponTargetCandidatesTotal did not increase after event-bound fire");
  }
  return failures;
}

async function main() {
  if (flag("help") || flag("h")) {
    printHelp();
    return;
  }
  const mapName = option("map", DEFAULT_MAP);
  const entityIndex = Math.max(1, Math.round(numberOption("entity", DEFAULT_FOCUS_ENTITY)));
  const timeoutMs = Math.max(1_000, Math.round(numberOption("timeout-ms", DEFAULT_TIMEOUT_MS)));
  const viewport = viewportOption();
  preflightRenderBundle(mapName);
  const server = await startServer();
  const browser = await chromium.launch({ headless: !flag("headed") });
  let result;
  try {
    result = await runHarnessCase(browser, server.url, { entityIndex, mapName, timeoutMs, viewport });
  } finally {
    await browser.close();
    await server.close();
  }

  const failures = validateHarnessResult(result);
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
    throw new Error(`Combat budget harness failed: ${failures.join("; ")}`);
  }
  console.log("Combat budget harness passed.");
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
