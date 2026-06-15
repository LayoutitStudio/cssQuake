import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { projectRoot } from "../assets/checkAssetState.mjs";

export function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

export function optionValue(args, name, fallback = "") {
  const flag = `--${name}`;
  const index = args.indexOf(flag);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) return args[index + 1];
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  return prefixed ? prefixed.slice(flag.length + 1) : fallback;
}

export function numberOption(args, name, fallback) {
  const raw = optionValue(args, name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function parseCommonBrowserArgs(args, defaults = {}) {
  return {
    explicitUrl: optionValue(args, "url", process.env.CSSQUAKE_SMOKE_URL ?? ""),
    headed: hasFlag(args, "headed"),
    host: optionValue(args, "host", defaults.host ?? "127.0.0.1"),
    jsonOut: optionValue(args, "json-out", defaults.jsonOut ?? ""),
    port: Math.max(1, Math.round(numberOption(args, "port", defaults.port ?? 5177))),
    timeoutMs: Math.max(1_000, Math.round(numberOption(args, "timeout-ms", defaults.timeoutMs ?? 90_000))),
    viewport: viewportFromOption(optionValue(args, "viewport", defaults.viewport ?? "1280x800")),
  };
}

export function viewportFromOption(raw) {
  const match = String(raw).match(/^(\d+)x(\d+)$/i);
  if (!match) throw new Error(`Invalid viewport "${raw}". Expected WIDTHxHEIGHT.`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

export async function loadChromium() {
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
        return require(require.resolve("playwright", { paths: [root] })).chromium;
      } catch {
        // Try the next module root.
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

function splitPathList(value) {
  return (value ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function pnpmPackageDirs(packageName) {
  const pnpmDir = path.join(projectRoot, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return [];
  return readdirSync(pnpmDir)
    .filter((entry) => entry.startsWith(`${packageName}@`))
    .map((entry) => path.join(pnpmDir, entry, "node_modules", packageName))
    .filter((packageDir) => existsSync(packageDir));
}

export async function startViteServer({ port, host = "127.0.0.1", strictPort = false, forceDeps = false } = {}) {
  const args = ["exec", "vite", "--host", host, "--port", String(port)];
  if (strictPort) args.push("--strictPort");
  if (forceDeps) args.push("--force");
  const child = spawn("pnpm", args, {
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
    const match = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/) ??
      output.match(/Local:\s+(http:\/\/localhost:\d+\/)/);
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

export async function resolveBrowserTarget({ explicitUrl, port, host = "127.0.0.1", envName = "CSSQUAKE_SMOKE_URL", ...serverOptions } = {}) {
  const url = explicitUrl || process.env[envName] || "";
  if (url) return { url, close: async () => {} };
  return await startViteServer({ port, host, ...serverOptions });
}

export function debugMapUrl(baseUrl, mapName, extraParams = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set("debug", "1");
  if (mapName) url.searchParams.set("map", mapName);
  for (const [key, value] of Object.entries(extraParams)) {
    if (value === undefined || value === null) continue;
    if (value === true) url.searchParams.set(key, "");
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function waitForDebugMapReady(page, { mapName = "", timeoutMs = 90_000, minMeshes = 1 } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await page.evaluate((expected) => {
        const debug = window.__cssQuakeDebug;
        const stats = debug?.stats?.();
        const meshCount = document.querySelectorAll(".polycss-mesh").length;
        return {
          href: window.location.href,
          hasDebug: Boolean(debug),
          loading: stats?.loading ?? null,
          mapName: stats?.mapName ?? null,
          meshCount,
          ready: Boolean(
            stats &&
            !stats.loading &&
            meshCount >= expected.minMeshes &&
            (!expected.mapName || stats.mapName === expected.mapName)
          ),
          text: document.body.innerText?.slice(0, 300) ?? "",
        };
      }, { mapName, minMeshes });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Execution context was destroyed|Cannot find context|Target closed/.test(message)) throw error;
      last = { navigation: "reloading", message };
    }
    if (last.ready) return last;
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for ${mapName || "debug map"} readiness: ${JSON.stringify(last)}`);
}

export function collectPageErrors(page, options = {}) {
  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error?.message ?? error));
  });
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() !== "error") return;
    if (options.ignoreConsoleError?.(text)) return;
    pageErrors.push(text);
  });
  return pageErrors;
}

export async function openDebugMapPage(browser, baseUrl, mapName, options = {}) {
  const page = await browser.newPage({ viewport: options.viewport });
  if (options.domMetadata !== false) {
    await page.addInitScript(() => {
      window.__cssQuakeDebugDomMetadata = true;
    });
  }
  const pageErrors = collectPageErrors(page, {
    ignoreConsoleError: (text) => text.startsWith("[vite]"),
  });
  try {
    await page.goto(debugMapUrl(baseUrl, mapName), {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await waitForDebugMapReady(page, {
      mapName,
      timeoutMs: options.timeoutMs,
      minMeshes: options.minMeshes ?? 1,
    });
    return { page, pageErrors };
  } catch (error) {
    await page.close();
    throw error;
  }
}

export async function writeJsonArtifact(file, value) {
  if (!file) return;
  await mkdir(path.dirname(path.resolve(projectRoot, file)), { recursive: true });
  writeFileSync(path.resolve(projectRoot, file), `${JSON.stringify(value, null, 2)}\n`);
}
