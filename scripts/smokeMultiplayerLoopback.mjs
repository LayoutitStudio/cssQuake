#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 5183;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_VIEWPORT = "1280x800";
const MAP_NAME = "e1m1";
const TELEPORTER_ENTITY = 178;
const SLIME_HAZARD_PROBE = { x: 960, y: 1664, z: -524, damageSource: "slime" };
const ORIGIN_EPSILON = 0.25;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const mapPath = path.join(projectRoot, "build/generated/public/q/e1m1.json");
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
  node scripts/smokeMultiplayerLoopback.mjs [options]

Options:
  --url <url>          Use an already-running cssQuake dev server.
  --port <port>        Port for the temporary Vite server. Default: ${DEFAULT_PORT}
  --headed             Run Chromium headed.
  --viewport <WxH>     Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>    Multiplayer readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}

This smoke validates the opt-in loopback multiplayer vertical slice:
  the app connects a multiplayer session, sends hello/input samples,
  verifies explicit debug pose samples in pose-only mode,
  receives room snapshots, mounts a remote player, renders scoreboard rows,
  runs a structured world-intent teleporter flow through loopback authority,
  and applies authoritative liquid hazard damage from room simulation.`);
}

async function loadChromium() {
  const require = createRequire(import.meta.url);
  try {
    return (await import("playwright")).chromium;
  } catch (error) {
    const roots = [
      ...splitPathList(process.env.PLAYWRIGHT_NODE_MODULES),
      ...splitPathList(process.env.NODE_PATH),
      projectRoot,
      path.join(projectRoot, "node_modules"),
    ];
    for (const root of roots) {
      try {
        const resolved = require.resolve("playwright", { paths: [root] });
        return require(resolved).chromium;
      } catch {
        // Try the next configured module root.
      }
    }
    for (const packageDir of pnpmPackageDirs("playwright")) {
      try {
        return require(packageDir).chromium;
      } catch {
        // Try the next pnpm package directory.
      }
    }
    throw new Error(
      `Could not load Playwright. Install it for this workspace or set PLAYWRIGHT_NODE_MODULES=/path/to/node_modules.\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function pnpmPackageDirs(packageName) {
  const pnpmDir = path.join(projectRoot, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return [];
  return readdirSync(pnpmDir)
    .filter((entry) => entry.startsWith(`${packageName}@`))
    .map((entry) => path.join(pnpmDir, entry, "node_modules", packageName))
    .filter((packageDir) => existsSync(packageDir));
}

function splitPathList(value) {
  return (value ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function preflightMap() {
  if (!existsSync(mapPath)) {
    throw new Error(`Missing ${path.relative(projectRoot, mapPath)}. Run pnpm prepare:quake:map ${MAP_NAME} first.`);
  }
}

function loadTeleporterProbe() {
  const prepared = JSON.parse(readFileSync(mapPath, "utf8"));
  const fact = prepared.gameLogic?.entities?.find?.((entity) => entity.entityIndex === TELEPORTER_ENTITY);
  const bounds = fact?.brushModel;
  const destinationIndex = fact?.resolvedTrigger?.destinationEntityIndexes?.[0];
  const destination = prepared.entities?.find?.((entity) => entity.index === destinationIndex);
  if (
    fact?.classname !== "trigger_teleport" ||
    fact?.resolvedTrigger?.kind !== "trigger_teleport" ||
    !bounds ||
    typeof destinationIndex !== "number" ||
    !destination?.origin
  ) {
    throw new Error(`E1M1 teleporter ${TELEPORTER_ENTITY} facts are missing or not resolved.`);
  }
  return {
    entityIndex: TELEPORTER_ENTITY,
    destinationEntityIndex: destinationIndex,
    pose: {
      x: (bounds.mins.x + bounds.maxs.x) / 2,
      y: (bounds.mins.y + bounds.maxs.y) / 2,
      z: (bounds.mins.z + bounds.maxs.z) / 2,
    },
  };
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
        url: match[1],
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

function multiplayerUrl(baseUrl, options = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set("debug", "1");
  url.searchParams.set("debugMultiplayer", "loopback");
  url.searchParams.set("map", MAP_NAME);
  if (options.poseOnly) url.searchParams.set("debugMultiplayerPoseOnly", "1");
  return url.toString();
}

async function waitForMultiplayerReady(page, timeoutMs) {
  let last = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(() => {
      const stats = window.__cssQuakeDebug?.stats?.();
      const multiplayer = stats?.multiplayer;
      return {
        hasDebug: Boolean(window.__cssQuakeDebug),
        loading: stats?.loading,
        mapName: stats?.mapName,
        multiplayer,
      };
    });
    const multiplayer = last.multiplayer;
    if (
      last.hasDebug &&
      last.loading === false &&
      last.mapName === MAP_NAME &&
      multiplayer?.enabled === true &&
      multiplayer?.transport === "loopback" &&
      multiplayer?.sessionState === "connected" &&
      multiplayer?.sessionMode === "loopback" &&
      multiplayer?.inputSequence >= 2 &&
      multiplayer?.remotePresenterCount >= 1 &&
      multiplayer?.remoteDomCount >= 1 &&
      multiplayer?.scoreboardRows >= 2
    ) {
      return last;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for loopback multiplayer readiness: ${JSON.stringify(last)}`);
}

async function waitForPoseOnlyMultiplayerReady(page, timeoutMs) {
  let last = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(() => {
      const stats = window.__cssQuakeDebug?.stats?.();
      const multiplayer = stats?.multiplayer;
      return {
        hasDebug: Boolean(window.__cssQuakeDebug),
        loading: stats?.loading,
        mapName: stats?.mapName,
        multiplayer,
      };
    });
    const multiplayer = last.multiplayer;
    if (
      last.hasDebug &&
      last.loading === false &&
      last.mapName === MAP_NAME &&
      multiplayer?.enabled === true &&
      multiplayer?.transport === "loopback" &&
      multiplayer?.poseOnly === true &&
      multiplayer?.sessionState === "connected" &&
      multiplayer?.sessionMode === "loopback" &&
      multiplayer?.poseSequence >= 2 &&
      multiplayer?.remotePresenterCount >= 1 &&
      multiplayer?.scoreboardRows >= 2
    ) {
      return last;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for pose-only loopback multiplayer readiness: ${JSON.stringify(last)}`);
}

async function runTeleporterWorldIntentSmoke(page, teleporter, timeoutMs) {
  const placed = await page.evaluate((probe) => {
    const debug = window.__cssQuakeDebug;
    const before = debug?.stats?.();
    const placedOk = debug?.setViewpos?.(
      probe.pose.x,
      probe.pose.y,
      probe.pose.z,
      undefined,
      undefined,
      { stableViewmodel: true },
    ) ?? false;
    return {
      placedOk,
      beforeOrigin: before?.origin,
      afterOrigin: debug?.stats?.()?.origin,
      multiplayer: debug?.stats?.()?.multiplayer,
    };
  }, teleporter);
  if (!placed.placedOk) {
    throw new Error(`Could not place player at teleporter ${teleporter.entityIndex}: ${JSON.stringify(placed)}`);
  }

  await page.waitForFunction(
    (previousPoseSequence) => {
      const multiplayer = window.__cssQuakeDebug?.stats?.()?.multiplayer;
      return multiplayer?.poseSequence >= previousPoseSequence + 2;
    },
    placed.multiplayer?.poseSequence ?? 0,
    { timeout: timeoutMs },
  );

  const activated = await page.evaluate((probe) => {
    const debug = window.__cssQuakeDebug;
    const before = debug?.stats?.();
    const activatedOk = debug?.setViewpos?.(
      probe.pose.x,
      probe.pose.y,
      probe.pose.z,
      undefined,
      undefined,
      { gameplay: true },
    ) ?? false;
    return {
      activatedOk,
      beforeOrigin: before?.origin,
      beforeWorldSequence: before?.multiplayer?.worldSequence,
      after: debug?.stats?.(),
    };
  }, teleporter);
  if (!activated.activatedOk) {
    throw new Error(`Could not activate teleporter ${teleporter.entityIndex}: ${JSON.stringify(activated)}`);
  }

  let last = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate((probe) => {
      const stats = window.__cssQuakeDebug?.stats?.();
      const event = stats?.multiplayer?.lastWorldEvent;
      return {
        origin: stats?.origin,
        multiplayer: stats?.multiplayer,
        event,
        reachedTeleportEvent: event?.eventType === "world.teleport" &&
          event?.entityIndex === probe.entityIndex &&
          event?.origin &&
          stats?.multiplayer?.worldSequence > probe.beforeWorldSequence,
      };
    }, {
      entityIndex: teleporter.entityIndex,
      beforeWorldSequence: activated.beforeWorldSequence ?? -1,
    });
    if (last.reachedTeleportEvent && vec3Distance(last.origin, last.event.origin) <= ORIGIN_EPSILON) {
      return last;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for authoritative teleporter world event: ${JSON.stringify(last)}`);
}

async function runLiquidHazardSmoke(page, probe, timeoutMs) {
  const placed = await page.evaluate((hazardProbe) => {
    const debug = window.__cssQuakeDebug;
    const before = debug?.stats?.();
    const placedOk = debug?.setViewpos?.(
      hazardProbe.x,
      hazardProbe.y,
      hazardProbe.z,
      undefined,
      undefined,
      { stableViewmodel: true },
    ) ?? false;
    return {
      placedOk,
      beforeHealth: before?.playerHealth,
      beforePoseSequence: before?.multiplayer?.poseSequence,
      beforePlayerEventId: before?.multiplayer?.lastPlayerEvent?.eventId ?? null,
      after: debug?.stats?.(),
    };
  }, probe);
  if (!placed.placedOk) {
    throw new Error(`Could not place player at liquid hazard probe: ${JSON.stringify(placed)}`);
  }

  await page.waitForFunction(
    (previousPoseSequence) => {
      const multiplayer = window.__cssQuakeDebug?.stats?.()?.multiplayer;
      return multiplayer?.poseSequence >= previousPoseSequence + 2;
    },
    placed.beforePoseSequence ?? 0,
    { timeout: timeoutMs },
  );

  let last = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate((hazardProbe) => {
      const stats = window.__cssQuakeDebug?.stats?.();
      const event = stats?.multiplayer?.lastPlayerEvent;
      return {
        playerHealth: stats?.playerHealth,
        multiplayer: stats?.multiplayer,
        event,
        damaged: event?.eventType === "player.damaged" &&
          event?.eventId !== hazardProbe.beforePlayerEventId &&
          event?.damageSource === hazardProbe.damageSource &&
          typeof stats?.playerHealth === "number" &&
          typeof hazardProbe.beforeHealth === "number" &&
          stats.playerHealth < hazardProbe.beforeHealth,
      };
    }, {
      beforeHealth: placed.beforeHealth,
      beforePlayerEventId: placed.beforePlayerEventId,
      damageSource: probe.damageSource,
    });
    if (last.damaged) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for authoritative liquid hazard damage: ${JSON.stringify(last)}`);
}

function vec3Distance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return Infinity;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

async function main() {
  if (flag("help") || flag("h")) {
    printHelp();
    return;
  }
  preflightMap();
  const teleporter = loadTeleporterProbe();
  const timeoutMs = Math.max(1_000, Math.round(numberOption("timeout-ms", DEFAULT_TIMEOUT_MS)));
  const viewport = viewportOption();
  const chromium = await loadChromium();
  const server = await startServer();
  const browser = await chromium.launch({ headless: !flag("headed") });
  const page = await browser.newPage({ viewport });
  const logs = [];
  page.on("console", (message) => {
    if (message.type() === "error" || !message.text().startsWith("[vite]")) {
      logs.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    logs.push(`pageerror: ${error.message}`);
  });

  try {
    await page.goto(multiplayerUrl(server.url), { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const state = await waitForMultiplayerReady(page, timeoutMs);
    await page.goto(multiplayerUrl(server.url, { poseOnly: true }), { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForPoseOnlyMultiplayerReady(page, timeoutMs);
    const worldIntentState = await runTeleporterWorldIntentSmoke(page, teleporter, timeoutMs);
    const hazardState = await runLiquidHazardSmoke(page, SLIME_HAZARD_PROBE, timeoutMs);
    if (logs.length) {
      throw new Error(`Browser logged errors during multiplayer smoke:\n${logs.join("\n")}`);
    }
    console.log(
      `Multiplayer loopback smoke passed: ${state.multiplayer.scoreboardRows} scoreboard rows, ` +
        `${state.multiplayer.remoteDomCount} remote player DOM node(s), ` +
        `${worldIntentState.event.eventType} entity ${worldIntentState.event.entityIndex}, ` +
        `${hazardState.event.eventType} ${hazardState.event.damageSource} damage.`,
    );
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
