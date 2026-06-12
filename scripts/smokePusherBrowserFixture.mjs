#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 5177;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_VIEWPORT = "1280x800";
const PUSH_TIMEOUT_MS = 7_000;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

const E1M4_TRAIN_CASE = {
  expectedDamage: 90,
  map: "e1m4",
  monsterClassname: "monster_knight",
  monsterEntity: 552,
  moverClassname: "func_train",
  moverEntity: 57,
};

const E1M6_DOOR_CASE = {
  map: "e1m6",
  monsterClassname: "monster_ogre",
  monsterEntity: 242,
  moverClassname: "func_door",
  moverEntity: 264,
};

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
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function printHelp() {
  console.log(`Usage:
  pnpm smoke:pusher-browser [options]

Options:
  --url <url>          Use an already-running cssQuake dev server.
  --port <port>        Port for the temporary Vite server. Default: ${DEFAULT_PORT}
  --headed             Run Chromium headed.
  --viewport <WxH>     Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>    Per-map readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --json-out <file>    Write the full result JSON.

This smoke validates real-level mover/monster pusher behavior:
  e1m4 func_train#57 crushes monster_knight#552 instead of pushing.
  e1m6 func_door#264 pushes monster_ogre#242 without damaging it.`);
}

async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch (error) {
    const roots = [
      ...splitPathList(process.env.PLAYWRIGHT_NODE_MODULES),
      ...splitPathList(process.env.NODE_PATH),
    ];
    const require = createRequire(import.meta.url);
    for (const root of roots) {
      try {
        const resolved = require.resolve("playwright", { paths: [root] });
        return require(resolved).chromium;
      } catch {
        // Try the next configured module root.
      }
    }
    throw new Error(
      `Could not load Playwright. Install it for this workspace or set PLAYWRIGHT_NODE_MODULES=/path/to/node_modules.\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function splitPathList(value) {
  return (value ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function preflightWatchpoints() {
  const e1m4 = preflightMap(E1M4_TRAIN_CASE.map);
  const e1m6 = preflightMap(E1M6_DOOR_CASE.map);
  const e1m4Mover = entityByIndex(e1m4).get(E1M4_TRAIN_CASE.moverEntity);
  const e1m4Monster = entityByIndex(e1m4).get(E1M4_TRAIN_CASE.monsterEntity);
  const e1m6Mover = entityByIndex(e1m6).get(E1M6_DOOR_CASE.moverEntity);
  const e1m6Monster = entityByIndex(e1m6).get(E1M6_DOOR_CASE.monsterEntity);
  assertEntity(e1m4Mover, E1M4_TRAIN_CASE.moverClassname, E1M4_TRAIN_CASE.moverEntity, E1M4_TRAIN_CASE.map);
  assertEntity(e1m4Monster, E1M4_TRAIN_CASE.monsterClassname, E1M4_TRAIN_CASE.monsterEntity, E1M4_TRAIN_CASE.map);
  assertEntity(e1m6Mover, E1M6_DOOR_CASE.moverClassname, E1M6_DOOR_CASE.moverEntity, E1M6_DOOR_CASE.map);
  assertEntity(e1m6Monster, E1M6_DOOR_CASE.monsterClassname, E1M6_DOOR_CASE.monsterEntity, E1M6_DOOR_CASE.map);
  const e1m4PathTarget = (e1m4.entities ?? []).find((entity) =>
    entity.classname === "path_corner" &&
    entity.properties?.targetname === e1m4Monster.properties?.target
  );
  if (!e1m4PathTarget?.origin) {
    throw new Error(`Missing ${E1M4_TRAIN_CASE.map} path_corner target for monster #${E1M4_TRAIN_CASE.monsterEntity}.`);
  }
  return {
    e1m4PathOrigin: e1m4PathTarget.origin,
  };
}

function preflightMap(mapName) {
  const mapPath = path.join(projectRoot, `build/generated/public/q/${mapName}.json`);
  if (!existsSync(mapPath)) {
    throw new Error(`Missing ${path.relative(projectRoot, mapPath)}. Run pnpm prepare:quake first.`);
  }
  const prepared = JSON.parse(readFileSync(mapPath, "utf8"));
  if (!prepared.renderBundle) {
    throw new Error(`Pusher browser smoke requires render-bundled ${mapName}. Run pnpm prepare:quake:map ${mapName}.`);
  }
  return prepared;
}

function entityByIndex(map) {
  return new Map((map.entities ?? []).map((entity) => [entity.index, entity]));
}

function assertEntity(entity, classname, entityIndex, mapName) {
  if (entity?.classname !== classname) {
    throw new Error(`Expected ${mapName} #${entityIndex} to be ${classname}, got ${entity?.classname ?? "missing"}.`);
  }
}

async function startServer() {
  const explicitUrl = option("url", process.env.CSSQUAKE_SMOKE_URL ?? "");
  if (explicitUrl) return { url: explicitUrl, close: async () => {} };

  const port = Math.max(1, Math.round(numberOption("port", DEFAULT_PORT)));
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: projectRoot,
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
        url: `${match[1]}?debug=1`,
        close: async () => {
          child.kill("SIGTERM");
          await sleep(250);
          if (!child.killed) child.kill("SIGKILL");
        },
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

async function runE1m4TrainCrushCase(browser, baseUrl, viewport, timeoutMs, watchpoints) {
  const page = await browser.newPage({ viewport });
  const pageErrors = collectPageErrors(page);
  try {
    await page.goto(mapUrl(baseUrl, E1M4_TRAIN_CASE.map), { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForMapReady(page, E1M4_TRAIN_CASE.map, timeoutMs);
    const result = await page.evaluate(async ({ pathOrigin, testCase, timeoutMs }) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const moverState = (stats, entityIndex) =>
        stats?.movers?.movers?.find?.((mover) => mover.entityIndex === entityIndex) ?? null;
      async function waitForPusherMarks({ damageEntities, pushEntities, timeoutMs }) {
        const samples = [];
        let pushMarks = [];
        let damageMarks = [];
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          await sleep(50);
          const stats = window.__cssQuakeDebug?.stats?.();
          const marks = performance.getEntriesByType("mark").map((entry) => entry.name);
          pushMarks = marks.filter((name) =>
            name.includes("cssquake:monster-pushed-by-mover") &&
            pushEntities.some((entityIndex) => name.includes(`entity=${entityIndex}`))
          );
          damageMarks = marks.filter((name) =>
            name.includes("cssquake:shootable-damage") &&
            damageEntities.some((entityIndex) => name.includes(`entity=${entityIndex}`))
          );
          if (samples.length === 0 || performance.now() - samples[samples.length - 1].at >= 250) {
            samples.push({
              at: Math.round(performance.now()),
              damageMarks: damageMarks.length,
              liveEnemyShootables: stats?.shootables?.liveEnemyShootables ?? null,
              pushMarks: pushMarks.length,
            });
          }
          if (pushMarks.length > 0 || damageMarks.length > 0) break;
        }
        return { damageMarks, pushMarks, samples };
      }

      const debug = window.__cssQuakeDebug;
      if (!debug?.activateEntity || !debug.setEntityOrigin) return { pass: false, reason: "missing debug pusher hooks" };
      window.__chromeCaptureTraceSampling = true;
      performance.clearMarks();

      const before = debug.stats();
      const beforeMover = moverState(before, testCase.moverEntity);
      const placed = debug.setEntityOrigin(
        testCase.monsterEntity,
        pathOrigin.x,
        pathOrigin.y,
        pathOrigin.z,
      );
      const mounted = debug.debugMountEntity?.(testCase.monsterEntity) ?? false;
      const activated = debug.activateEntity(testCase.moverEntity);
      const observed = await waitForPusherMarks({
        damageEntities: [testCase.monsterEntity],
        pushEntities: [testCase.monsterEntity],
        timeoutMs,
      });
      const after = debug.stats();
      const afterMover = moverState(after, testCase.moverEntity);
      const damageMark = observed.damageMarks.find((name) => name.includes(`entity=${testCase.monsterEntity}`)) ?? null;
      const pass = placed &&
        activated &&
        damageMark?.includes(`amount=${testCase.expectedDamage}`) === true &&
        damageMark.includes("killed=true") &&
        observed.pushMarks.length === 0;
      return {
        pass,
        activated,
        afterMover,
        beforeMover,
        damageMarks: observed.damageMarks,
        mounted,
        placed,
        pushMarks: observed.pushMarks,
        samples: observed.samples,
      };
    }, {
      pathOrigin: watchpoints.e1m4PathOrigin,
      testCase: E1M4_TRAIN_CASE,
      timeoutMs: PUSH_TIMEOUT_MS,
    });
    return { ...E1M4_TRAIN_CASE, ...result, pageErrors };
  } finally {
    await page.close();
  }
}

async function runE1m6DoorPushCase(browser, baseUrl, viewport, timeoutMs) {
  const page = await browser.newPage({ viewport });
  const pageErrors = collectPageErrors(page);
  try {
    await page.goto(mapUrl(baseUrl, E1M6_DOOR_CASE.map), { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForMapReady(page, E1M6_DOOR_CASE.map, timeoutMs);
    const result = await page.evaluate(async ({ testCase, timeoutMs }) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const moverState = (stats, entityIndex) =>
        stats?.movers?.movers?.find?.((mover) => mover.entityIndex === entityIndex) ?? null;
      async function waitForPusherMarks({ damageEntities, pushEntities, timeoutMs }) {
        const samples = [];
        let pushMarks = [];
        let damageMarks = [];
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          await sleep(50);
          const stats = window.__cssQuakeDebug?.stats?.();
          const marks = performance.getEntriesByType("mark").map((entry) => entry.name);
          pushMarks = marks.filter((name) =>
            name.includes("cssquake:monster-pushed-by-mover") &&
            pushEntities.some((entityIndex) => name.includes(`entity=${entityIndex}`))
          );
          damageMarks = marks.filter((name) =>
            name.includes("cssquake:shootable-damage") &&
            damageEntities.some((entityIndex) => name.includes(`entity=${entityIndex}`))
          );
          if (samples.length === 0 || performance.now() - samples[samples.length - 1].at >= 250) {
            samples.push({
              at: Math.round(performance.now()),
              damageMarks: damageMarks.length,
              liveEnemyShootables: stats?.shootables?.liveEnemyShootables ?? null,
              pushMarks: pushMarks.length,
            });
          }
          if (pushMarks.length > 0 || damageMarks.length > 0) break;
        }
        return { damageMarks, pushMarks, samples };
      }

      const debug = window.__cssQuakeDebug;
      if (!debug?.activateEntity) return { pass: false, reason: "missing debug pusher hooks" };
      window.__chromeCaptureTraceSampling = true;
      performance.clearMarks();

      const before = debug.stats();
      const beforeMover = moverState(before, testCase.moverEntity);
      const activated = debug.activateEntity(testCase.moverEntity);
      const observed = await waitForPusherMarks({
        damageEntities: [testCase.monsterEntity],
        pushEntities: [testCase.monsterEntity],
        timeoutMs,
      });
      const after = debug.stats();
      const afterMover = moverState(after, testCase.moverEntity);
      const pushed = observed.pushMarks.some((name) => name.includes(`entity=${testCase.monsterEntity}`));
      const moved = Array.isArray(afterMover?.offset) &&
        Array.isArray(beforeMover?.offset) &&
        afterMover.offset[0] > beforeMover.offset[0];
      return {
        pass: activated && pushed && observed.damageMarks.length === 0 && moved,
        activated,
        afterMover,
        beforeMover,
        damageMarks: observed.damageMarks,
        pushMarks: observed.pushMarks,
        samples: observed.samples,
      };
    }, { testCase: E1M6_DOOR_CASE, timeoutMs: PUSH_TIMEOUT_MS });
    return { ...E1M6_DOOR_CASE, ...result, pageErrors };
  } finally {
    await page.close();
  }
}

function collectPageErrors(page) {
  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error?.message ?? error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  return pageErrors;
}

function assertCase(result, label) {
  if (result.pageErrors?.length) {
    throw new Error(`${label} browser errors:\n${result.pageErrors.join("\n")}`);
  }
  if (!result.pass) {
    throw new Error(`${label} failed:\n${JSON.stringify(result, null, 2)}`);
  }
}

async function main() {
  if (flag("help") || flag("h")) {
    printHelp();
    return;
  }
  const watchpoints = preflightWatchpoints();
  const viewport = viewportOption();
  const timeoutMs = Math.max(1_000, Math.round(numberOption("timeout-ms", DEFAULT_TIMEOUT_MS)));
  const chromium = await loadChromium();
  const server = await startServer();
  const browser = await chromium.launch({ headless: !flag("headed") });
  const results = [];
  try {
    const e1m4 = await runE1m4TrainCrushCase(browser, server.url, viewport, timeoutMs, watchpoints);
    assertCase(e1m4, "E1M4 train/knight crush watchpoint");
    results.push(e1m4);
    console.log(
      `PASS e1m4 train#${E1M4_TRAIN_CASE.moverEntity} crushed knight#${E1M4_TRAIN_CASE.monsterEntity} with damage=${E1M4_TRAIN_CASE.expectedDamage}; push marks=${e1m4.pushMarks.length}`,
    );

    const e1m6 = await runE1m6DoorPushCase(browser, server.url, viewport, timeoutMs);
    assertCase(e1m6, "E1M6 side-door/ogre push watchpoint");
    results.push(e1m6);
    console.log(
      `PASS e1m6 door#${E1M6_DOOR_CASE.moverEntity} pushed ogre#${E1M6_DOOR_CASE.monsterEntity}; damage marks=${e1m6.damageMarks.length}`,
    );
  } finally {
    await browser.close();
    await server.close();
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    pass: results.every((result) => result.pass),
    results,
  };
  const jsonOut = option("json-out");
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Pusher browser smoke passed: ${results.length} real-level watchpoints.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
