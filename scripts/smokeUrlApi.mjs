#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 5188;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_VIEWPORT = "1280x720";
const TEST_VIEW = "-576,192,184,0,90,0";
const TEST_VIEW_FIVE = "-576,192,184,0,90";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

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
  node scripts/smokeUrlApi.mjs [options]

Options:
  --url <url>          Use an already-running cssQuake dev server.
  --port <port>        Port for the temporary Vite server. Default: ${DEFAULT_PORT}
  --force-deps         Start Vite with --force to rebuild optimized deps.
  --headed             Run Chromium headed.
  --viewport <WxH>     Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>    Per-route readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}

This smoke validates the public URL API:
  map/view direct links use Quake-native x y z pitch yaw roll.
  five-part view input is rejected.
  non-zero roll is rejected.
  invalid map suppresses pose application.
  /debug capture dry-run maps URL view to the vkQuake --quake path.`);
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

async function startServer() {
  const explicitUrl = option("url", process.env.CSSQUAKE_SMOKE_URL ?? "");
  if (explicitUrl) return { url: explicitUrl, close: async () => {} };

  const port = Math.max(1, Math.round(numberOption("port", DEFAULT_PORT)));
  const viteArgs = ["exec", "vite", "--host", "127.0.0.1", "--port", String(port)];
  if (flag("force-deps")) viteArgs.push("--force");
  const child = spawn("pnpm", viteArgs, {
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

function routeUrl(baseUrl, params) {
  const url = new URL(baseUrl);
  url.search = "";
  for (const [key, value] of Object.entries(params)) {
    if (value === true) url.searchParams.set(key, "");
    else url.searchParams.set(key, String(value));
    if (key === "view") url.search = url.search.replace(/([?&]view=)[^&]*/, `$1${value}`);
  }
  return url.toString();
}

async function waitForState(page, name, timeoutMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await page.evaluate(() => {
        const debug = window.__cssQuakeDebug;
        if (!debug) return { href: window.location.href, hasDebug: false, bodyClass: document.body.className };
        const stats = debug.stats();
        return {
          href: window.location.href,
          hasDebug: true,
          bodyClass: document.body.className,
          loading: stats.loading,
          mapName: stats.mapName,
          origin: stats.origin,
          cameraRotX: stats.cameraRotX,
          cameraRotY: stats.cameraRotY,
          menuOpen: document.body.classList.contains("quake-menu-open"),
          paused: document.body.classList.contains("quake-game-paused"),
          viewUrl: debug.viewUrl(),
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Execution context was destroyed|Cannot find context|Target closed/.test(message)) throw error;
      last = { navigation: "reloading", message };
    }
    if (last.hasDebug && last.loading === false) return last;
    await page.waitForTimeout(250);
  }
  throw new Error(`${name} timed out: ${JSON.stringify(last)}`);
}

async function runRouteCase(page, baseUrl, testCase, timeoutMs) {
  await page.goto(routeUrl(baseUrl, testCase.params), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const state = await waitForState(page, testCase.name, timeoutMs);
  testCase.assert(state);
  console.log(`ok ${testCase.name}`);
  return state;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function near(actual, expected, epsilon = 0.001) {
  return Math.abs(actual - expected) <= epsilon;
}

function assertCanonicalView(state) {
  const url = new URL(state.href);
  const viewUrl = new URL(state.viewUrl);
  assert(url.searchParams.get("map") === "e1m5", `expected canonical map=e1m5, got ${state.href}`);
  assert(url.searchParams.get("view") === TEST_VIEW, `expected canonical view=${TEST_VIEW}, got ${state.href}`);
  assert(viewUrl.searchParams.get("view") === TEST_VIEW, `expected copied view=${TEST_VIEW}, got ${state.viewUrl}`);
  assert(state.viewUrl.includes(`view=${TEST_VIEW}`), `expected readable comma view URL, got ${state.viewUrl}`);
  assert(state.mapName === "e1m5", `expected e1m5, got ${state.mapName}`);
  assert(near(state.origin[0], 0) && near(state.origin[1], 0) && near(state.origin[2], 0.92),
    `unexpected origin ${JSON.stringify(state.origin)}`);
  assert(state.cameraRotX === 90 && state.cameraRotY === 270,
    `unexpected rotation ${state.cameraRotX}/${state.cameraRotY}`);
  assert(state.menuOpen === false && state.paused === false, "direct view route should enter gameplay");
}

function assertNoView(state, name) {
  const url = new URL(state.href);
  assert(!url.searchParams.has("view"), `${name} should strip view, got ${state.href}`);
  assert(state.mapName === "e1m5", `${name} expected e1m5, got ${state.mapName}`);
  assert(state.menuOpen === false && state.paused === false, `${name} should enter gameplay via valid map`);
}

async function assertDebugCaptureDryRun(page, baseUrl) {
  const validPose = routeUrl(baseUrl, { map: "e1m5", view: TEST_VIEW });
  const valid = await page.evaluate(async (pose) => {
    const response = await fetch("/debug/api/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pose, dryRun: true }),
    });
    return { status: response.status, body: await response.json() };
  }, validPose);
  assert(valid.status === 200 && valid.body.ok === true, `valid dry-run failed: ${JSON.stringify(valid)}`);
  assert(valid.body.args.includes("--quake"), `valid dry-run did not use --quake: ${valid.body.command}`);
  assert(valid.body.args.includes("-576 192 184 0 90 0"), `valid dry-run lost Quake pose: ${valid.body.command}`);
  assert(valid.body.args.includes("--map") && valid.body.args.includes("e1m5"),
    `valid dry-run lost map: ${valid.body.command}`);

  const invalidPose = routeUrl(baseUrl, { map: "e1m5", view: "-576,192,184,0,90,3" });
  const invalid = await page.evaluate(async (pose) => {
    const response = await fetch("/debug/api/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pose, dryRun: true }),
    });
    return { status: response.status, body: await response.json() };
  }, invalidPose);
  assert(invalid.status === 409, `invalid dry-run should fail, got ${JSON.stringify(invalid)}`);
  assert(String(invalid.body.error ?? "").includes("zero roll"),
    `invalid dry-run should explain zero roll, got ${JSON.stringify(invalid.body)}`);
  console.log("ok debugCaptureDryRun");
}

async function main() {
  if (flag("help") || flag("h")) {
    printHelp();
    return;
  }
  const timeoutMs = Math.max(1_000, Math.round(numberOption("timeout-ms", DEFAULT_TIMEOUT_MS)));
  const viewport = viewportOption();
  const server = await startServer();
  let browser = null;
  try {
    const chromium = await loadChromium();
    browser = await chromium.launch({ headless: !flag("headed") });
    const page = await browser.newPage({ viewport });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (text.includes("the server responded with a status of 409 (Conflict)")) return;
      pageErrors.push(text);
    });

    const cases = [
      {
        name: "nativeSix",
        params: { map: "e1m5", view: TEST_VIEW, debug: true },
        assert: assertCanonicalView,
      },
      {
        name: "fivePartRejected",
        params: { map: "e1m5", view: TEST_VIEW_FIVE, debug: true },
        assert: (state) => assertNoView(state, "fivePartRejected"),
      },
      {
        name: "nonZeroRollRejected",
        params: { map: "e1m5", view: "-576,192,184,0,90,3", debug: true },
        assert: (state) => assertNoView(state, "nonZeroRollRejected"),
      },
      {
        name: "underscoreRejected",
        params: { map: "e1m5", view: "-576_192_184_0_90_0", debug: true },
        assert: (state) => assertNoView(state, "underscoreRejected"),
      },
      {
        name: "invalidMapWithViewIgnored",
        params: { map: "badmap", view: TEST_VIEW, debug: true },
        assert: (state) => {
          assert(state.mapName === "e1m1", `invalid map should load fallback e1m1, got ${state.mapName}`);
          assert(state.menuOpen === true && state.paused === true, "invalid map should keep menu open");
          assert(new URL(state.href).searchParams.get("map") === "badmap",
            `invalid map should not publish a fake canonical URL, got ${state.href}`);
        },
      },
    ];

    for (const testCase of cases) {
      await runRouteCase(page, server.url, testCase, timeoutMs);
    }
    const debugRoll = await page.evaluate(() => ({
      zeroRoll: window.__cssQuakeDebug?.setViewpos?.(-576, 192, 184, 0, 90, 0),
      nonZeroRoll: window.__cssQuakeDebug?.setViewpos?.(-576, 192, 184, 0, 90, 3),
    }));
    assert(debugRoll.zeroRoll === true, `debug zero roll should succeed: ${JSON.stringify(debugRoll)}`);
    assert(debugRoll.nonZeroRoll === false, `debug non-zero roll should fail: ${JSON.stringify(debugRoll)}`);
    console.log("ok debugRoll");

    await assertDebugCaptureDryRun(page, server.url);
    if (pageErrors.length) throw new Error(`Page errors:\n${pageErrors.join("\n")}`);
  } finally {
    await browser?.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
