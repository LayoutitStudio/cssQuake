#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const DEFAULT_PORT = 5177;
const DEFAULT_VIEWPORT = "1280x800";
const DEFAULT_TIMEOUT_MS = 90_000;
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
const FOCUS_YAWS = [0, 45, 90, 135, 180, 225, 270, 315];
const FOCUS_DISTANCES = [2.35, 3.5, 5, 8, 12];

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
  pnpm smoke:monster-dom [options]

Options:
  --url <url>          Use an already-running cssQuake dev server.
  --port <port>        Port for the temporary Vite server. Default: ${DEFAULT_PORT}
  --headed             Run Chromium headed.
  --viewport <WxH>     Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>    Per-map readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --json-out <file>    Write the full result JSON.

This smoke validates natural DOM visibility. It uses debug set-pose/focus hooks to
place the camera, but it does not call debugMountEntity().`);
}

function requiredMaps() {
  return [...new Set(REPRESENTATIVE_MONSTERS.map((monster) => monster.map))].sort();
}

function preflightRenderBundles() {
  const missing = [];
  for (const mapName of requiredMaps()) {
    const path = `build/generated/public/q/${mapName}.json`;
    if (!existsSync(path)) {
      missing.push(`${mapName}: missing ${path}`);
      continue;
    }
    const prepared = JSON.parse(readFileSync(path, "utf8"));
    if (!prepared.renderBundle) missing.push(`${mapName}: missing renderBundle`);
  }
  if (missing.length) {
    throw new Error(
      `DOM monster smoke requires render-bundled maps. Run pnpm prepare:quake first.\n${missing.join("\n")}`,
    );
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

async function waitForInitialIdle(page, timeoutMs) {
  await page.waitForFunction(() => window.__cssQuakeDebug?.stats, null, { timeout: timeoutMs });
  await page.waitForFunction(() => {
    const stats = window.__cssQuakeDebug?.stats?.();
    return stats && !stats.loading && document.querySelectorAll(".polycss-mesh").length > 0;
  }, null, { timeout: timeoutMs });
}

async function loadMap(page, mapName, timeoutMs) {
  await page.waitForFunction(() => {
    const stats = window.__cssQuakeDebug?.stats?.();
    return stats && !stats.loading;
  }, null, { timeout: timeoutMs });
  const loadResult = await page.evaluate(async (targetMap) => {
    const debug = window.__cssQuakeDebug;
    if (!debug?.loadMap) return { ok: false, reason: "missing debug.loadMap" };
    try {
      const ok = await debug.loadMap(targetMap);
      return { ok };
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) };
    }
  }, mapName);
  if (!loadResult.ok) throw new Error(`Could not load ${mapName}: ${loadResult.reason ?? "loadMap returned false"}`);
  await page.waitForFunction((targetMap) => {
    const stats = window.__cssQuakeDebug?.stats?.();
    return stats &&
      stats.mapName === targetMap &&
      !stats.loading &&
      document.querySelectorAll(".polycss-mesh").length > 0;
  }, mapName, { timeout: timeoutMs });
}

async function validateMonster(page, monster) {
  let lastAttempt = null;
  for (const distance of FOCUS_DISTANCES) {
    for (const yaw of FOCUS_YAWS) {
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
          element.dataset.prewarmed !== "true" &&
          element.dataset.frameHidden !== "true",
        );
        const stats = debug.stats();
        const projection = stats.enemyProjection?.meshes?.find?.((mesh) => mesh.entityIndex === entity) ?? null;
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
          animationMode: element?.dataset.animationMode ?? null,
          quakecChain: element?.dataset.quakecChain ?? null,
          quakecState: element?.dataset.quakecState ?? null,
          projection,
          stats: {
            activeEnemyMeshes: stats.activeEnemyMeshes,
            mountedEnemyShootables: stats.shootables?.mountedEnemyShootables ?? null,
            visibleEnemyShootables: stats.shootables?.visibleEnemyShootables ?? null,
            enemyFrameHandles: stats.shootables?.enemyFrameHandles ?? null,
          },
        };
      }, {
        entity: monster.entity,
        expectedClassname: monster.classname,
        distance,
        yaw,
      });
      lastAttempt = attempt;
      if (attempt.active && attempt.classnameOk && attempt.leafCount > 0) {
        return {
          ...monster,
          pass: true,
          naturalVisibility: true,
          attempt,
        };
      }
    }
  }
  return {
    ...monster,
    pass: false,
    naturalVisibility: false,
    attempt: lastAttempt,
  };
}

async function main() {
  if (flag("help") || flag("h")) {
    printHelp();
    return 0;
  }

  preflightRenderBundles();
  const timeoutMs = Math.max(1_000, Math.round(numberOption("timeout-ms", DEFAULT_TIMEOUT_MS)));
  const viewport = viewportOption();
  const server = await startServer();
  const browser = await chromium.launch({ headless: !flag("headed") });
  const page = await browser.newPage({ viewport });
  const consoleMessages = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" || !text.startsWith("[vite]")) {
      consoleMessages.push({ type: message.type(), text });
    }
  });
  page.on("pageerror", (error) => {
    consoleMessages.push({ type: "pageerror", text: error.message });
  });

  const startedAt = new Date().toISOString();
  const results = [];
  try {
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await waitForInitialIdle(page, timeoutMs);
    let currentMap = "";
    for (const monster of REPRESENTATIVE_MONSTERS) {
      if (monster.map !== currentMap) {
        await loadMap(page, monster.map, timeoutMs);
        currentMap = monster.map;
      }
      const result = await validateMonster(page, monster);
      results.push(result);
      const status = result.pass ? "PASS" : "FAIL";
      const attempt = result.attempt;
      console.log(
        `${status} ${monster.map} ${monster.classname} #${monster.entity}` +
          (attempt ? ` distance=${attempt.distance} yaw=${attempt.yaw} leaves=${attempt.leafCount}` : ""),
      );
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const summary = {
    kind: "cssquake-monster-dom-smoke",
    startedAt,
    url: server.url,
    viewport,
    total: results.length,
    passed: results.filter((result) => result.pass).length,
    failed: results.filter((result) => !result.pass).length,
    results,
    consoleMessages,
  };
  const jsonOut = option("json-out");
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(summary, null, 2)}\n`);
  if (consoleMessages.length) {
    console.error(`Console/page messages: ${consoleMessages.length}`);
    for (const message of consoleMessages.slice(0, 20)) {
      console.error(`${message.type}: ${message.text}`);
    }
  }
  if (summary.failed > 0 || consoleMessages.some((message) => message.type === "pageerror")) {
    throw new Error(`DOM monster smoke failed: ${summary.passed}/${summary.total} passed.`);
  }
  console.log(`DOM monster smoke passed: ${summary.passed}/${summary.total}.`);
  return 0;
}

main().then((status) => {
  process.exit(status);
}).catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
