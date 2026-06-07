#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const DEFAULT_PORT = 5177;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_VIEWPORT = "1280x800";

const COMBAT_CASES = [
  {
    call: "army_fire",
    classname: "monster_army",
    distance: 4.5,
    entity: 298,
    eventKind: "event",
    map: "e1m1",
    type: "fire_bullets",
    waitMs: 7_500,
    yaw: 45,
  },
  {
    call: "dog_bite",
    classname: "monster_dog",
    distance: 1.2,
    entity: 247,
    eventKind: "call",
    map: "e1m1",
    type: "melee_damage",
    waitMs: 4_500,
    yaw: 0,
  },
  {
    call: "ai_melee",
    classname: "monster_knight",
    distance: 1.2,
    entity: 99,
    eventKind: "call",
    map: "e1m2",
    type: "melee_damage",
    waitMs: 4_500,
    yaw: 0,
  },
  {
    call: "chainsaw",
    classname: "monster_ogre",
    distance: 1.2,
    entity: 80,
    eventKind: "call",
    map: "e1m2",
    type: "melee_damage",
    waitMs: 6_000,
    yaw: 0,
  },
  {
    call: "Demon_Melee",
    classname: "monster_demon1",
    distance: 1.6,
    entity: 205,
    eventKind: "call",
    map: "e1m5",
    type: "melee_damage",
    waitMs: 7_000,
    yaw: 90,
  },
  {
    call: "Wiz_FastFire",
    classname: "monster_wizard",
    distance: 2.35,
    entity: 294,
    eventKind: "call",
    map: "e1m3",
    type: "projectile",
    waitMs: 8_000,
    yaw: 0,
  },
  {
    call: "CastLightning",
    classname: "monster_shambler",
    distance: 4.5,
    entity: 396,
    eventKind: "call",
    map: "e1m6",
    type: "lightning_damage",
    waitMs: 9_000,
    yaw: 0,
  },
  {
    call: "ZombieFireGrenade",
    classname: "monster_zombie",
    distance: 2.35,
    entity: 272,
    eventKind: "call",
    map: "e1m3",
    type: "projectile",
    waitMs: 10_000,
    yaw: 135,
  },
  {
    call: "boss_missile",
    classname: "monster_boss",
    distance: 3.5,
    entity: 28,
    eventKind: "call",
    map: "e1m7",
    type: "projectile",
    waitMs: 9_000,
    yaw: 180,
  },
];

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
  pnpm smoke:monster-combat [options]

Options:
  --url <url>          Use an already-running cssQuake dev server.
  --port <port>        Port for the temporary Vite server. Default: ${DEFAULT_PORT}
  --headed             Run Chromium headed.
  --viewport <WxH>     Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>    Per-map readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --json-out <file>    Write the full result JSON.

This smoke validates that each representative monster reaches its generated
QuakeC attack frame event in the browser runtime.`);
}

function requiredMaps() {
  return [...new Set(COMBAT_CASES.map((testCase) => testCase.map))].sort();
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
      `Monster combat smoke requires render-bundled maps. Run pnpm prepare:quake first.\n${missing.join("\n")}`,
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

async function runCombatCase(browser, baseUrl, testCase, viewport, timeoutMs) {
  const page = await browser.newPage({ viewport });
  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error?.message ?? error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  try {
    await page.goto(mapUrl(baseUrl, testCase.map), { waitUntil: "domcontentloaded" });
    await waitForMapReady(page, testCase.map, timeoutMs);
    return await page.evaluate(async (testCase) => {
      window.__chromeCaptureTraceSampling = true;
      performance.clearMarks();
      const debug = window.__cssQuakeDebug;
      const focusOk = Boolean(debug?.focusEntity?.(testCase.entity, testCase.distance, 90, testCase.yaw));
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, 400));

      const selector = `.polycss-mesh.shootable.enemy[data-entity-index="${testCase.entity}"]`;
      const element = document.querySelector(selector);
      const mounted = Boolean(element);
      const active = Boolean(
        element &&
        element.getAttribute("aria-hidden") !== "true" &&
        element.dataset.prewarmed !== "true" &&
        element.dataset.frameHidden !== "true",
      );
      const before = debug.stats();
      await new Promise((resolve) => setTimeout(resolve, testCase.waitMs));
      const after = debug.stats();
      const marks = performance.getEntriesByType("mark")
        .map((entry) => entry.name)
        .filter((name) => name.startsWith("cssquake:"));
      const entityToken = `entity=${testCase.entity}`;
      const relevantMarks = marks.filter((name) => name.includes(entityToken));
      const eventMarks = relevantMarks.filter((name) =>
        name.includes("enemy-quakec-event") &&
        name.includes(`${testCase.eventKind}=${testCase.call}`) &&
        name.includes(`type=${testCase.type}`)
      );
      const scheduledProjectileMarks = relevantMarks.filter((name) =>
        name.includes("enemy-quakec-projectile-schedule") &&
        name.includes(`call=${testCase.call}`) &&
        name.includes(`type=${testCase.type}`)
      );
      const attackStateMarks = relevantMarks.filter((name) =>
        name.includes("enemy-quakec-state") &&
        name.includes("mode=attack")
      );
      const projectileEffectMarks = marks.filter((name) =>
        (name.includes("enemy-projectile-hit") ||
          name.includes("enemy-projectile-splash") ||
          name.includes("enemy-projectile-blocked")) &&
        name.includes(`source=${testCase.entity}`)
      );
      const pass = focusOk && mounted && active && eventMarks.length > 0;
      return {
        active,
        animation: element ? {
          frame: element.dataset.animationFrame ?? null,
          mode: element.dataset.animationMode ?? null,
          quakecCalls: element.dataset.quakecCalls ?? null,
          quakecChain: element.dataset.quakecChain ?? null,
          quakecState: element.dataset.quakecState ?? null,
        } : null,
        attackStateCount: attackStateMarks.length,
        attackStateTail: attackStateMarks.slice(-12),
        eventCount: eventMarks.length,
        eventMarks: eventMarks.slice(-8),
        focusOk,
        healthAfter: after.playerHealth,
        healthBefore: before.playerHealth,
        healthDelta: after.playerHealth - before.playerHealth,
        mounted,
        pass,
        projectileEffectMarks: projectileEffectMarks.slice(-8),
        scheduledProjectileMarks: scheduledProjectileMarks.slice(-8),
      };
    }, testCase);
  } finally {
    await page.close();
  }
}

async function main() {
  if (flag("help") || flag("h")) {
    printHelp();
    return;
  }
  preflightRenderBundles();
  const viewport = viewportOption();
  const timeoutMs = Math.max(1_000, Math.round(numberOption("timeout-ms", DEFAULT_TIMEOUT_MS)));
  const server = await startServer();
  const browser = await chromium.launch({ headless: !flag("headed") });
  const results = [];
  try {
    for (const testCase of COMBAT_CASES) {
      const result = await runCombatCase(browser, server.url, testCase, viewport, timeoutMs);
      results.push({ ...testCase, ...result });
      const status = result.pass ? "PASS" : "FAIL";
      const health = result.healthBefore === null || result.healthAfter === null
        ? "health=n/a"
        : `health=${Math.round(result.healthBefore)}->${Math.round(result.healthAfter)}`;
      const event = result.eventMarks[0] ?? result.scheduledProjectileMarks[0] ?? "no event marker";
      console.log(`${status} ${testCase.map} ${testCase.classname} #${testCase.entity} ${testCase.call} events=${result.eventCount} ${health}`);
      if (!result.pass) console.log(`  ${event}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const jsonOut = option("json-out");
  const summary = {
    generatedAt: new Date().toISOString(),
    pass: results.every((result) => result.pass),
    results,
  };
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.pass) {
    const failures = results.filter((result) => !result.pass)
      .map((result) => `${result.map} ${result.classname} #${result.entity}`)
      .join(", ");
    throw new Error(`Monster combat smoke failed: ${failures}`);
  }
  console.log(`Monster combat smoke passed: ${results.length}/${results.length}.`);
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
