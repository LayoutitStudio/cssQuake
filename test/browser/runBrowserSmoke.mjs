#!/usr/bin/env node
import {
  collectPageErrors,
  debugMapUrl,
  hasFlag,
  loadChromium,
  optionValue,
  parseCommonBrowserArgs,
  resolveBrowserTarget,
} from "./browserHarnessSupport.mjs";
import { assertAssetState } from "../assets/checkAssetState.mjs";

const DEFAULT_PORT = 5188;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_VIEWPORT = "1280x720";
const TEST_VIEW = "-576,192,184,0,90,0";
const TEST_VIEW_FIVE = "-576,192,184,0,90";

if (hasFlag(process.argv.slice(2), "help") || hasFlag(process.argv.slice(2), "h")) {
  printHelp();
  process.exit(0);
}

const args = process.argv.slice(2);
const common = parseCommonBrowserArgs(args, {
  port: DEFAULT_PORT,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  viewport: DEFAULT_VIEWPORT,
});

console.log("Browser URL/API smoke gate");
console.log("validates: public URL map/view links, invalid views, debug roll rejection");
console.log("requires prepared assets: yes, maps e1m1 and e1m5");
console.log("classification: acceptance");
assertAssetState({ requiredMaps: ["e1m1", "e1m5"], requireRenderBundle: true });

const server = await resolveBrowserTarget({ ...common, forceDeps: hasFlag(args, "force-deps") });
let browser = null;
try {
  const chromium = await loadChromium();
  browser = await chromium.launch({ headless: !common.headed });
  const page = await browser.newPage({ viewport: common.viewport });
  const pageErrors = collectPageErrors(page, {
    ignoreConsoleError: (text) => text.includes("the server responded with a status of 409 (Conflict)"),
  });

  const cases = [
    { name: "nativeSix", params: { map: "e1m5", view: TEST_VIEW, debug: true }, assert: assertCanonicalView },
    { name: "fivePartRejected", params: { map: "e1m5", view: TEST_VIEW_FIVE, debug: true }, assert: (state) => assertNoView(state, "fivePartRejected") },
    { name: "nonZeroRollRejected", params: { map: "e1m5", view: "-576,192,184,0,90,3", debug: true }, assert: (state) => assertNoView(state, "nonZeroRollRejected") },
    { name: "underscoreRejected", params: { map: "e1m5", view: "-576_192_184_0_90_0", debug: true }, assert: (state) => assertNoView(state, "underscoreRejected") },
    {
      name: "invalidMapWithViewIgnored",
      params: { map: "badmap", view: TEST_VIEW, debug: true },
      assert: (state) => {
        assert(state.mapName === "e1m1", `invalid map should load fallback e1m1, got ${state.mapName}`);
        assert(state.menuOpen === true && state.paused === true, "invalid map should keep menu open");
        assert(new URL(state.href).searchParams.get("map") === "badmap", `invalid map should not publish fake canonical URL: ${state.href}`);
      },
    },
  ];

  for (const testCase of cases) await runRouteCase(page, server.url, testCase, common.timeoutMs);
  const debugRoll = await page.evaluate(() => ({
    zeroRoll: window.__cssQuakeDebug?.setViewpos?.(-576, 192, 184, 0, 90, 0),
    nonZeroRoll: window.__cssQuakeDebug?.setViewpos?.(-576, 192, 184, 0, 90, 3),
  }));
  assert(debugRoll.zeroRoll === true, `debug zero roll should succeed: ${JSON.stringify(debugRoll)}`);
  assert(debugRoll.nonZeroRoll === false, `debug non-zero roll should fail: ${JSON.stringify(debugRoll)}`);
  console.log("ok debugRoll");
  if (pageErrors.length) throw new Error(`Page errors:\n${pageErrors.join("\n")}`);
  console.log("Browser URL/API smoke passed.");
} finally {
  await browser?.close();
  await server.close();
}

function printHelp() {
  console.log(`Usage:
  node test/browser/runBrowserSmoke.mjs [options]

Options:
  --url <url>          Use an already-running cssQuake dev server.
  --port <port>        Port for temporary Vite. Default: ${DEFAULT_PORT}
  --force-deps         Start Vite with --force.
  --headed             Run Chromium headed.
  --viewport <WxH>     Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>    Per-route readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}`);
}

function routeUrl(baseUrl, params) {
  const url = new URL(debugMapUrl(baseUrl, "", params));
  if (params.view) url.search = url.search.replace(/([?&]view=)[^&]*/, `$1${params.view}`);
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
  assert(state.mapName === "e1m5", `expected e1m5, got ${state.mapName}`);
  assert(near(state.origin[0], 0) && near(state.origin[1], 0) && near(state.origin[2], 0.92), `unexpected origin ${JSON.stringify(state.origin)}`);
  assert(state.cameraRotX === 90 && state.cameraRotY === 270, `unexpected rotation ${state.cameraRotX}/${state.cameraRotY}`);
}

function assertNoView(state, name) {
  const url = new URL(state.href);
  assert(!url.searchParams.has("view"), `${name} should strip view, got ${state.href}`);
  assert(state.mapName === "e1m5", `${name} expected e1m5, got ${state.mapName}`);
}
