#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { chromium } from "playwright";

const DEFAULT_PORT = 5184;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_VIEWPORT = "1280x800";
const DEFAULT_MAP = "e1m1";
const DEFAULT_FOCUS_ENTITY = 298;
const DEFAULT_DURATION_MS = 3000;
const DEFAULT_FIRE_INTERVAL_MS = 350;
const DEFAULT_OUT = "bench/results/quake/combat-loop-harness-summary.json";
const DEFAULT_MAX_P95_REGRESSION_MS = 1.5;
const DEFAULT_MAX_FPS_REGRESSION_PCT = 5;

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
  node scripts/traceCombatLoopHarness.mjs [options]

Options:
  --url <url>               Use an already-running cssQuake dev server.
  --port <port>             Port for the temporary Vite server. Default: ${DEFAULT_PORT}
  --map <map>               Map to load. Default: ${DEFAULT_MAP}
  --entity <index>          Entity to focus before firing. Default: ${DEFAULT_FOCUS_ENTITY}
  --duration-ms <ms>        Combat loop duration. Default: ${DEFAULT_DURATION_MS}
  --fire-interval-ms <ms>   Debug fire cadence. Default: ${DEFAULT_FIRE_INTERVAL_MS}
  --baseline <file>         Optional prior summary JSON for regression checks.
  --enable-expanded-logical-combat
                            Enable expanded logical targetability through debug hooks.
  --expect-logical-targetability
                            Validate expanded targetability while unmounted AI stays disabled.
  --expect-expanded         Validate expanded logical combat/unmounted AI stop-line conditions.
  --out <file>              Summary JSON path. Default: ${DEFAULT_OUT}
  --headed                  Run Chromium headed.
  --viewport <WxH>          Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>         Readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}

This is a real-map combat-loop harness. It records frame deltas and combat
budget counters. Expanded logical targetability is enabled only when requested.`);
}

function preflightRenderBundle(mapName) {
  const path = `build/generated/public/q/${mapName}.json`;
  if (!existsSync(path)) {
    throw new Error(`Combat loop harness requires ${path}. Run asset prepare only if the generated map is missing.`);
  }
  const prepared = JSON.parse(readFileSync(path, "utf8"));
  if (!prepared.renderBundle) throw new Error(`Combat loop harness requires renderBundle in ${path}.`);
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

async function runCombatLoop(browser, baseUrl, options) {
  const page = await browser.newPage({ viewport: options.viewport });
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
    await page.goto(mapUrl(baseUrl, options.mapName), { waitUntil: "domcontentloaded" });
    await waitForMapReady(page, options.mapName, options.timeoutMs);
    const result = await page.evaluate(async ({ durationMs, enableExpandedLogicalCombat, entityIndex, fireIntervalMs }) => {
      const debug = window.__cssQuakeDebug;
      if (!debug?.stats) return { hasDebug: false };
      if (enableExpandedLogicalCombat) {
        debug.setExpandedLogicalCombat?.(true);
        debug.setUnmountedAi?.(false);
      }
      const beforeStats = debug.stats();
      const before = beforeStats.shootables?.combatBudget ?? null;
      const focusOk = Boolean(debug.focusEntity?.(entityIndex, 4.5, 90, 45));
      debug.setWeapon?.("shotgun");
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);

      const frameDeltas = [];
      const start = performance.now();
      let lastFrame = start;
      let nextFire = start;
      let fireCount = 0;
      while (performance.now() - start < durationMs) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        frameDeltas.push(now - lastFrame);
        lastFrame = now;
        if (now >= nextFire) {
          if (debug.fire?.()) fireCount++;
          nextFire = now + fireIntervalMs;
        }
      }

      const afterStats = debug.stats();
      return {
        after: afterStats.shootables?.combatBudget ?? null,
        before,
        fireCount,
        focusOk,
        frame: summarizeFrameDeltas(frameDeltas),
        hasDebug: true,
        mapName: afterStats.mapName ?? null,
      };

      function summarizeFrameDeltas(deltas) {
        const sorted = [...deltas].sort((a, b) => a - b);
        const elapsedMs = deltas.reduce((total, delta) => total + delta, 0);
        const frames = deltas.length;
        const averageMs = frames ? elapsedMs / frames : 0;
        return {
          averageMs,
          elapsedMs,
          fps: elapsedMs > 0 ? frames * 1000 / elapsedMs : 0,
          frames,
          longFramesOver16Ms: deltas.filter((delta) => delta > 1000 / 60).length,
          longFramesOver33Ms: deltas.filter((delta) => delta > 1000 / 30).length,
          maxMs: sorted.at(-1) ?? 0,
          minMs: sorted[0] ?? 0,
          p95Ms: percentile(sorted, 0.95),
          p99Ms: percentile(sorted, 0.99),
        };
      }

      function percentile(sorted, percentileValue) {
        if (!sorted.length) return 0;
        const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
        return sorted[index];
      }
    }, {
      durationMs: options.durationMs,
      enableExpandedLogicalCombat: options.enableExpandedLogicalCombat,
      entityIndex: options.entityIndex,
      fireIntervalMs: options.fireIntervalMs,
    });
    return { ...result, pageErrors };
  } finally {
    await page.close();
  }
}

function validateResult(result, baseline) {
  const failures = [];
  if (!result.hasDebug) failures.push("debug hooks missing");
  if (!result.before) failures.push("missing before combat budget stats");
  if (!result.after) failures.push("missing after combat budget stats");
  if (!result.focusOk) failures.push("debug focusEntity failed");
  if (!result.fireCount) failures.push("debug fire did not run during combat loop");
  if (result.pageErrors?.length) failures.push(`page errors: ${result.pageErrors.join(" | ")}`);
  if (result.after) {
    const budget = result.after;
    const beforeBudget = result.before ?? {};
    const expectExpanded = flag("expect-expanded");
    const expectLogicalTargetability = flag("expect-logical-targetability") || flag("enable-expanded-logical-combat");
    const limits = budget.limits ?? {};
    if (expectExpanded) {
      if (budget.expandedLogicalCombatEnabled !== true) failures.push("expanded logical combat should be enabled");
      if (budget.unmountedAiEnabled !== true) failures.push("unmounted AI should be enabled");
      if ((budget.combatInterestSetSize ?? 0) <= 0) failures.push("combat interest set should be non-empty");
      if ((budget.counters?.unmountedAiTicksTotal ?? 0) <= (beforeBudget.counters?.unmountedAiTicksTotal ?? 0)) {
        failures.push("unmounted AI ticks did not increase");
      }
      if ((budget.counters?.capDeferralsTotal ?? 0) < 0) failures.push("cap deferrals counter missing");
    } else if (expectLogicalTargetability) {
      if (budget.expandedLogicalCombatEnabled !== true) failures.push("expanded logical combat should be enabled");
      if (budget.unmountedAiEnabled !== false) failures.push("unmounted AI should remain disabled");
      if ((budget.combatInterestSetSize ?? 0) <= 0) failures.push("combat interest set should be non-empty");
      if ((budget.counters?.unmountedAiTicksTotal ?? 0) !== (beforeBudget.counters?.unmountedAiTicksTotal ?? 0)) {
        failures.push("unmounted AI ticks should not change");
      }
    } else {
      if (budget.expandedLogicalCombatEnabled !== false) failures.push("expanded logical combat should be disabled");
      if (budget.unmountedAiEnabled !== false) failures.push("unmounted AI should be disabled");
      if ((budget.counters?.unmountedAiTicksTotal ?? 0) !== 0) {
        failures.push(`unexpected unmounted AI ticks: ${budget.counters.unmountedAiTicksTotal}`);
      }
    }
    if (budget.unmountedAiActiveSetSize > limits.unmountedAiActiveSet) {
      failures.push(`unmounted active set over cap: ${budget.unmountedAiActiveSetSize}`);
    }
    if (budget.combatInterestSetSize > limits.combatInterestSet) {
      failures.push(`combat interest set over cap: ${budget.combatInterestSetSize}`);
    }
    if ((budget.maxFrame?.lineOfSightChecks ?? 0) > limits.lineOfSightChecksPerFrame) {
      failures.push(`LOS checks per frame over cap: ${budget.maxFrame.lineOfSightChecks}`);
    }
    if ((budget.maxFrame?.attackChainChecks ?? 0) > limits.attackChainChecksPerFrame) {
      failures.push(`attack checks per frame over cap: ${budget.maxFrame.attackChainChecks}`);
    }
    if ((budget.maxPerSecond?.lineOfSightChecks ?? 0) > limits.lineOfSightChecksPerSecond) {
      failures.push(`LOS checks per second over cap: ${budget.maxPerSecond.lineOfSightChecks}`);
    }
    if ((budget.counters?.domReadsTotal ?? 0) !== 0) failures.push(`combat DOM reads: ${budget.counters.domReadsTotal}`);
  }
  if (baseline) failures.push(...compareBaseline(result, baseline));
  return failures;
}

function compareBaseline(result, baseline) {
  const failures = [];
  const baselineFrame = baseline.result?.frame ?? baseline.frame;
  if (!baselineFrame || !result.frame) return ["baseline is missing frame stats"];
  const maxP95RegressionMs = numberOption("max-p95-regression-ms", DEFAULT_MAX_P95_REGRESSION_MS);
  const maxFpsRegressionPct = numberOption("max-fps-regression-pct", DEFAULT_MAX_FPS_REGRESSION_PCT);
  const p95RegressionMs = result.frame.p95Ms - baselineFrame.p95Ms;
  if (p95RegressionMs > maxP95RegressionMs) {
    failures.push(`p95 frame regression ${p95RegressionMs.toFixed(2)}ms > ${maxP95RegressionMs}ms`);
  }
  if (baselineFrame.fps > 0) {
    const fpsRegressionPct = ((baselineFrame.fps - result.frame.fps) / baselineFrame.fps) * 100;
    if (fpsRegressionPct > maxFpsRegressionPct) {
      failures.push(`fps regression ${fpsRegressionPct.toFixed(2)}% > ${maxFpsRegressionPct}%`);
    }
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
  const durationMs = Math.max(100, Math.round(numberOption("duration-ms", DEFAULT_DURATION_MS)));
  const fireIntervalMs = Math.max(50, Math.round(numberOption("fire-interval-ms", DEFAULT_FIRE_INTERVAL_MS)));
  const outPath = option("out", DEFAULT_OUT);
  const baselinePath = option("baseline");
  const baseline = baselinePath ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;
  preflightRenderBundle(mapName);
  const server = await startServer();
  const browser = await chromium.launch({ headless: !flag("headed") });
  let result;
  try {
    result = await runCombatLoop(browser, server.url, {
      durationMs,
      enableExpandedLogicalCombat: flag("enable-expanded-logical-combat") || flag("expect-logical-targetability"),
      entityIndex,
      fireIntervalMs,
      mapName,
      timeoutMs,
      viewport: viewportOption(),
    });
  } finally {
    await browser.close();
    await server.close();
  }

  const failures = validateResult(result, baseline);
  const summary = {
    baselinePath: baselinePath || null,
    failures,
    generatedAt: new Date().toISOString(),
    mapName,
    parameters: {
      durationMs,
      enableExpandedLogicalCombat: flag("enable-expanded-logical-combat") || flag("expect-logical-targetability"),
      entityIndex,
      fireIntervalMs,
      viewport: option("viewport", DEFAULT_VIEWPORT),
    },
    pass: failures.length === 0,
    result,
  };
  await mkdir(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.pass) throw new Error(`Combat loop harness failed: ${failures.join("; ")}`);
  console.log(`Combat loop harness passed: ${outPath}`);
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
