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
const MAP_NAME = "e1m1";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const mapPath = path.join(projectRoot, "build/generated/public/q/e1m1.json");

const PICKUP_CASES = [
  {
    classname: "item_armor1",
    entity: 20,
    label: "armor",
    stat: "playerArmor",
    delta: 100,
  },
  {
    classname: "item_spikes",
    entity: 226,
    label: "large nails",
    stat: "playerNails",
    delta: 50,
  },
];

const DISABLED_PICKUP = {
  classname: "weapon_rocketlauncher",
  entity: 201,
};

const FOCUS_YAWS = [0, 45, 90, 135, 180, 225, 270, 315];

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
  pnpm smoke:pickup-browser [options]

Options:
  --url <url>          Use an already-running cssQuake dev server.
  --port <port>        Port for the temporary Vite server. Default: ${DEFAULT_PORT}
  --headed             Run Chromium headed.
  --viewport <WxH>     Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>    E1M1 readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --json-out <file>    Write the full result JSON.

This smoke validates visible browser pickup behavior for representative E1M1
entities before deeper pickup semantics move onto prebaked facts.`);
}

function preflightMap() {
  if (!existsSync(mapPath)) {
    throw new Error(`Missing ${path.relative(projectRoot, mapPath)}. Run pnpm prepare:quake first.`);
  }
  const prepared = JSON.parse(readFileSync(mapPath, "utf8"));
  if (!prepared.renderBundle) {
    throw new Error(`Pickup browser smoke requires render-bundled E1M1. Run pnpm prepare:quake first.`);
  }
  if (!prepared.gameLogic?.entities?.length) {
    throw new Error(`Pickup browser smoke requires E1M1 gameLogic facts. Run pnpm prepare:quake first.`);
  }
  return prepared;
}

function pickupCasesWithOrigins(prepared) {
  return PICKUP_CASES.map((testCase) => {
    const entity = prepared.entities?.find((candidate) => candidate.index === testCase.entity);
    if (!entity?.origin) throw new Error(`Missing E1M1 pickup entity ${testCase.entity}.`);
    if (entity.classname !== testCase.classname) {
      throw new Error(
        `Expected E1M1 entity ${testCase.entity} to be ${testCase.classname}, got ${entity.classname}.`,
      );
    }
    return {
      ...testCase,
      origin: entity.origin,
    };
  });
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
  await page.waitForFunction((mapName) => {
    const stats = window.__cssQuakeDebug?.stats?.();
    return stats &&
      stats.mapName === mapName &&
      !stats.loading &&
      document.querySelectorAll(".polycss-mesh").length > 0;
  }, MAP_NAME, { timeout: timeoutMs });
}

async function validatePickup(page, testCase) {
  return await page.evaluate(async ({ testCase, yaws }) => {
    const debug = window.__cssQuakeDebug;
    if (!debug?.stats || !debug.focusEntity || !debug.setViewpos) {
      return { pass: false, reason: "missing debug pickup hooks" };
    }

    const settle = async (ms = 160) => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, ms));
    };

    const pickupInfo = (entityIndex) => {
      const element = document.querySelector(`.polycss-mesh.pickup[data-entity-index="${entityIndex}"]`);
      if (!element) return { mounted: false };
      const leafCount = element.querySelectorAll("b,i,s,u").length;
      return {
        mounted: true,
        hidden: element.hidden,
        classname: element.dataset.classname ?? null,
        leafCount,
      };
    };

    const statsSnapshot = () => {
      const stats = debug.stats();
      return {
        activePickupMeshes: stats.activePickupMeshes,
        pickupMeshes: stats.pickupMeshes,
        playerArmor: stats.playerArmor,
        playerHealth: stats.playerHealth,
        playerNails: stats.playerNails,
        playerShells: stats.playerShells,
      };
    };

    const before = statsSnapshot();
    let focused = null;
    for (const yaw of yaws) {
      const focusOk = debug.focusEntity(testCase.entity, 4, 90, yaw);
      await settle();
      const info = pickupInfo(testCase.entity);
      focused = { focusOk, yaw, ...info };
      if (focusOk && info.mounted && !info.hidden && info.classname === testCase.classname && info.leafCount > 0) {
        break;
      }
    }

    const beforePickup = statsSnapshot();
    const pickupOk = debug.setViewpos(
      testCase.origin.x,
      testCase.origin.y,
      testCase.origin.z,
      undefined,
      undefined,
      { gameplay: true },
    );
    await settle(220);
    const after = statsSnapshot();
    const afterInfo = pickupInfo(testCase.entity);

    const repeatOk = debug.setViewpos(
      testCase.origin.x,
      testCase.origin.y,
      testCase.origin.z,
      undefined,
      undefined,
      { gameplay: true },
    );
    await settle(120);
    const afterRepeat = statsSnapshot();

    return {
      pass: true,
      before,
      beforePickup,
      focused,
      pickupOk,
      after,
      afterInfo,
      repeatOk,
      afterRepeat,
    };
  }, { testCase, yaws: FOCUS_YAWS });
}

async function disabledPickupSnapshot(page) {
  return await page.evaluate((pickup) => {
    const element = document.querySelector(`.polycss-mesh.pickup[data-entity-index="${pickup.entity}"]`);
    return {
      classname: pickup.classname,
      entity: pickup.entity,
      mounted: Boolean(element),
      elementClassname: element?.dataset.classname ?? null,
    };
  }, DISABLED_PICKUP);
}

function assertPickupResult(testCase, result) {
  if (!result.pass) throw new Error(`${testCase.label} failed before validation: ${result.reason ?? "unknown"}`);
  const focused = result.focused;
  if (!focused?.focusOk || !focused.mounted || focused.hidden || focused.classname !== testCase.classname) {
    throw new Error(`${testCase.label} pickup did not become visible: ${JSON.stringify(focused)}`);
  }
  if (!(focused.leafCount > 0)) {
    throw new Error(`${testCase.label} pickup mounted without render leaves: ${JSON.stringify(focused)}`);
  }
  if (!result.pickupOk) {
    throw new Error(`${testCase.label} pickup debug gameplay pose failed.`);
  }
  const expected = result.before[testCase.stat] + testCase.delta;
  if (result.after[testCase.stat] !== expected) {
    throw new Error(
      `${testCase.label} should change ${testCase.stat} to ${expected}, got ${result.after[testCase.stat]}.`,
    );
  }
  if (result.afterInfo.mounted) {
    throw new Error(`${testCase.label} pickup mesh should be removed after pickup: ${JSON.stringify(result.afterInfo)}`);
  }
  if (result.after.pickupMeshes !== result.beforePickup.pickupMeshes - 1) {
    throw new Error(
      `${testCase.label} should remove exactly one pickup mesh, before=${result.beforePickup.pickupMeshes} after=${result.after.pickupMeshes}.`,
    );
  }
  if (!result.repeatOk) {
    throw new Error(`${testCase.label} repeat gameplay pose failed.`);
  }
  if (result.afterRepeat[testCase.stat] !== result.after[testCase.stat]) {
    throw new Error(
      `${testCase.label} should not apply twice, after=${result.after[testCase.stat]} repeat=${result.afterRepeat[testCase.stat]}.`,
    );
  }
}

async function main() {
  if (flag("help") || flag("h")) {
    printHelp();
    return 0;
  }

  const prepared = preflightMap();
  const pickupCases = pickupCasesWithOrigins(prepared);
  const timeoutMs = Math.max(1_000, Math.round(numberOption("timeout-ms", DEFAULT_TIMEOUT_MS)));
  const viewport = viewportOption();
  const server = await startServer();
  const browser = await chromium.launch({ headless: !flag("headed") });
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => {
    window.__cssQuakeDebugDomMetadata = true;
  });

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
  let disabled = null;
  try {
    await page.goto(mapUrl(server.url), { waitUntil: "domcontentloaded" });
    await waitForMapReady(page, timeoutMs);
    disabled = await disabledPickupSnapshot(page);
    if (disabled.mounted) {
      throw new Error(`Skill-disabled pickup should not mount in normal single-player: ${JSON.stringify(disabled)}`);
    }

    for (const testCase of pickupCases) {
      const result = await validatePickup(page, testCase);
      assertPickupResult(testCase, result);
      results.push({ ...testCase, result });
      console.log(
        `PASS ${MAP_NAME} ${testCase.classname} #${testCase.entity} ${testCase.stat}` +
          ` ${result.before[testCase.stat]} -> ${result.after[testCase.stat]}`,
      );
    }
  } finally {
    await browser.close();
    await server.close();
  }

  if (consoleMessages.length) {
    throw new Error(`Browser emitted console/page errors:\n${JSON.stringify(consoleMessages, null, 2)}`);
  }

  const summary = {
    startedAt,
    map: MAP_NAME,
    disabled,
    results,
  };
  const jsonOut = option("json-out");
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Pickup browser smoke passed: ${results.length} pickups, disabled #${DISABLED_PICKUP.entity} stayed inactive.`);
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
