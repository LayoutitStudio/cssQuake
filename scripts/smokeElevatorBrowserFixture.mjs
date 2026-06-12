#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const DEFAULT_PORT = 5177;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_VIEWPORT = "1280x800";
const FIRST_LIFT_ENTITY = 70;
const MAP_NAME = "e1m1";
const PLAYER_MINS_Z_QUAKE_UNITS = -24;
const RIDE_TIMEOUT_MS = 9_000;
const OFFSET_EPSILON = 0.035;
const BOTTOM_RETRIGGER_EPSILON = 0.2;
const CARRY_EPSILON = 0.18;
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
  pnpm smoke:elevator-browser [options]

Options:
  --url <url>          Use an already-running cssQuake dev server.
  --port <port>        Port for the temporary Vite server. Default: ${DEFAULT_PORT}
  --headed             Run Chromium headed.
  --viewport <WxH>     Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>    E1M1 readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --json-out <file>    Write the full result JSON.

This smoke validates the E1M1 first lift in the browser: trigger activation,
full rise, bottom pass or immediate retrigger, and player carry through the pusher path.`);
}

function preflightLiftPose() {
  if (!existsSync(mapPath)) {
    throw new Error(`Missing ${path.relative(projectRoot, mapPath)}. Run pnpm prepare:quake first.`);
  }
  const prepared = JSON.parse(readFileSync(mapPath, "utf8"));
  if (!prepared.renderBundle) {
    throw new Error(`Elevator browser smoke requires render-bundled E1M1. Run pnpm prepare:quake first.`);
  }
  const fact = prepared.gameLogic?.entities?.find((entity) => entity.entityIndex === FIRST_LIFT_ENTITY);
  const mover = fact?.resolvedMover;
  if (fact?.classname !== "func_plat" || mover?.kind !== "func_plat" || !fact.brushModel) {
    throw new Error(`E1M1 first lift facts are missing or not resolved.`);
  }
  if (mover.initialState !== "bottom") {
    throw new Error(`Expected first lift to start at bottom, got ${mover.initialState}.`);
  }

  const trigger = mover.trigger;
  const brush = fact.brushModel;
  const bottomZ = brush.maxs.z + mover.initialOrigin.z;
  return {
    entity: FIRST_LIFT_ENTITY,
    map: MAP_NAME,
    pose: {
      x: (trigger.mins.x + trigger.maxs.x) / 2,
      y: (trigger.mins.y + trigger.maxs.y) / 2,
      z: bottomZ - PLAYER_MINS_Z_QUAKE_UNITS,
    },
    facts: {
      brushMaxZ: brush.maxs.z,
      initialOriginZ: mover.initialOrigin.z,
      topOriginZ: mover.topOrigin.z,
      bottomOriginZ: mover.bottomOrigin.z,
      travelDistance: mover.travelDistance,
      trigger,
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

function mapUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set("debug", "1");
  url.searchParams.set("map", MAP_NAME);
  return url.toString();
}

async function waitForMapReady(page, timeoutMs) {
  const state = await waitForDebugMapState(page, timeoutMs);
  if (!state.ready) throw new Error(`Elevator map readiness timed out: ${JSON.stringify(state.last)}`);
}

async function waitForDebugMapState(page, timeoutMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await page.evaluate((mapName) => {
        const debug = window.__cssQuakeDebug;
        const stats = debug?.stats?.();
        const meshCount = document.querySelectorAll(".polycss-mesh").length;
        return {
          href: window.location.href,
          bodyClass: document.body.className,
          hasDebug: Boolean(debug),
          loading: stats?.loading ?? null,
          mapName: stats?.mapName ?? null,
          meshCount,
          ready: Boolean(stats && stats.mapName === mapName && !stats.loading && meshCount > 0),
          text: document.body.innerText?.slice(0, 300) ?? "",
        };
      }, MAP_NAME);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Execution context was destroyed|Cannot find context|Target closed/.test(message)) throw error;
      last = { navigation: "reloading", message };
    }
    if (last.ready) return { ready: true, last };
    await page.waitForTimeout(250);
  }
  return { ready: false, last };
}

async function runLiftRide(page, lift) {
  return await page.evaluate(async ({ lift, rideTimeoutMs }) => {
    const debug = window.__cssQuakeDebug;
    if (!debug?.stats || !debug.setGroundViewpos) return { pass: false, reason: "missing debug lift hooks" };

    const now = () => Math.round(performance.now() * 10) / 10;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const closeZ = (a, b, epsilon) => Math.abs(a - b) <= epsilon;
    const disableDamageOption = document.getElementById("quake-option-disable-damage");
    if (disableDamageOption instanceof HTMLInputElement && !disableDamageOption.checked) {
      disableDamageOption.checked = true;
      disableDamageOption.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const liftState = () => {
      const stats = debug.stats();
      const mover = stats.movers?.movers?.find?.((candidate) => candidate.entityIndex === lift.entity) ?? null;
      return {
        at: now(),
        health: stats.playerHealth,
        origin: stats.origin,
        playerGroundEntity: stats.playerGroundEntity,
        mover,
      };
    };

    const placedOk = debug.setGroundViewpos(
      lift.pose.x,
      lift.pose.y,
      lift.pose.z,
      undefined,
      undefined,
      { gameplay: true },
    );
    const placed = liftState();
    const samples = [placed];
    let top = null;
    let returned = null;
    let bottomPass = null;
    let previous = placed;
    const deadline = performance.now() + rideTimeoutMs;

    while (performance.now() < deadline) {
      await sleep(50);
      const sample = liftState();
      if (!sample.mover) return { pass: false, reason: "missing first lift mover stats", placed, samples };
      if (!top && sample.mover.mode === "open" && closeZ(sample.mover.offset[2], sample.mover.openOffset[2], 0.035)) {
        top = sample;
      }
      if (top && sample.mover.mode === "closed" && closeZ(sample.mover.offset[2], sample.mover.closedOffset[2], 0.035)) {
        returned = sample;
        break;
      }
      if (
        top &&
        previous?.mover?.mode === "closing" &&
        sample.mover.mode === "opening" &&
        Math.abs(sample.mover.offset[2] - sample.mover.closedOffset[2]) <= 0.2
      ) {
        bottomPass = sample;
        break;
      }
      const previousLogged = samples[samples.length - 1];
      if (!previousLogged || sample.at - previousLogged.at >= 250) samples.push(sample);
      previous = sample;
    }

    return {
      pass: true,
      placedOk,
      placed,
      top,
      returned,
      bottomPass,
      samples,
    };
  }, { lift, rideTimeoutMs: RIDE_TIMEOUT_MS });
}

async function runLiftRideWithNavigationRetry(page, lift, timeoutMs) {
  try {
    return await runLiftRide(page, lift);
  } catch (error) {
    if (!isTransientNavigationError(error)) throw error;
    console.warn(`Retrying elevator ride after transient navigation: ${error.message}`);
    await waitForMapReady(page, timeoutMs);
    return await runLiftRide(page, lift);
  }
}

function isTransientNavigationError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|Cannot find context/.test(message);
}

function assertLiftRide(result) {
  if (!result.pass) throw new Error(`First lift smoke failed before validation: ${result.reason ?? "unknown"}`);
  if (!result.placedOk) throw new Error(`Could not place player on first lift trigger.`);
  if (!result.placed.mover) throw new Error(`Missing first lift mover stats after placement.`);
  if (!result.top) throw new Error(`First lift did not reach the top: ${JSON.stringify(result.samples.at(-1))}`);
  const bottom = result.returned ?? result.bottomPass;
  if (!bottom) throw new Error(`First lift did not return fully to the bottom: ${JSON.stringify(result.samples.at(-1))}`);

  const ascentMover = result.top.mover.offset[2] - result.placed.mover.offset[2];
  const ascentPlayer = result.top.origin[2] - result.placed.origin[2];
  const descentMover = result.top.mover.offset[2] - bottom.mover.offset[2];
  const descentPlayer = result.top.origin[2] - bottom.origin[2];

  const bottomOffsetEpsilon = result.returned ? OFFSET_EPSILON : BOTTOM_RETRIGGER_EPSILON;
  if (Math.abs(bottom.mover.offset[2] - bottom.mover.closedOffset[2]) > bottomOffsetEpsilon) {
    throw new Error(`First lift returned offset is not fully closed: ${JSON.stringify(bottom.mover)}`);
  }
  if (Math.abs(ascentMover - ascentPlayer) > CARRY_EPSILON) {
    throw new Error(`First lift did not carry player upward: mover=${ascentMover} player=${ascentPlayer}`);
  }
  if (Math.abs(descentMover - descentPlayer) > CARRY_EPSILON) {
    throw new Error(`First lift did not carry player downward: mover=${descentMover} player=${descentPlayer}`);
  }
  if (result.top.playerGroundEntity !== FIRST_LIFT_ENTITY && bottom.playerGroundEntity !== FIRST_LIFT_ENTITY) {
    throw new Error(
      `Player was not grounded on first lift during ride: top=${result.top.playerGroundEntity} bottom=${bottom.playerGroundEntity}`,
    );
  }
  if (bottom.health !== result.placed.health) {
    throw new Error(`First lift ride should not damage player: before=${result.placed.health} after=${bottom.health}`);
  }
}

async function main() {
  if (flag("help") || flag("h")) {
    printHelp();
    return 0;
  }

  const lift = preflightLiftPose();
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
  let result = null;
  let summary = null;
  try {
    await page.goto(mapUrl(server.url), { waitUntil: "domcontentloaded" });
    await waitForMapReady(page, timeoutMs);
    result = await runLiftRideWithNavigationRetry(page, lift, timeoutMs);
    summary = {
      startedAt,
      lift,
      result,
    };
    const jsonOut = option("json-out");
    if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(summary, null, 2)}\n`);
    assertLiftRide(result);
  } finally {
    await browser.close();
    await server.close();
  }

  if (consoleMessages.length) {
    throw new Error(`Browser emitted console/page errors:\n${JSON.stringify(consoleMessages, null, 2)}`);
  }

  const jsonOut = option("json-out");
  if (jsonOut && !summary) writeFileSync(jsonOut, `${JSON.stringify({ startedAt, lift, result }, null, 2)}\n`);
  const rise = Math.round((result.top.origin[2] - result.placed.origin[2]) * 100) / 100;
  const bottom = result.returned ?? result.bottomPass;
  const descent = Math.round((result.top.origin[2] - bottom.origin[2]) * 100) / 100;
  const bottomLabel = result.returned ? "returned" : "bottom-retriggered";
  console.log(`Elevator browser smoke passed: first lift rose ${rise} and ${bottomLabel} ${descent} with player carry.`);
  return 0;
}

main().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  },
);
