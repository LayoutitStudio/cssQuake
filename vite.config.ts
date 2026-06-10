import { defineConfig, type Plugin } from "vite";
import { execSync, spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_DEBUG_DIR = path.join(CONFIG_DIR, "debug");
const CAPTURE_SCRIPT = "/Users/ekrof/.codex/cssquake-tools/vkquake-shot.mjs";
const DEFAULT_CSSQUAKE_URL = "http://localhost:5173/";
const DEFAULT_CAPTURE_OUTDIR = path.join(process.env.HOME ?? "/Users/ekrof", "Desktop", "cssquake-captures");

const DEBUG_CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
]);

let activeCapture: { startedAt: string; args: string[] } | null = null;

function cssQuakeVersion(): string {
  try {
    const commitCount = execSync("git rev-list --count HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return `0.${commitCount}`;
  } catch {
    return "0.0";
  }
}

function polyCssVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(path.join(CONFIG_DIR, "node_modules/@layoutit/polycss/package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(`${JSON.stringify(data, null, 2)}\n`);
}

function sendText(res: ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8"): void {
  res.statusCode = status;
  res.setHeader("content-type", contentType);
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function safeString(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safePositiveInt(value: unknown, fallback: string): string {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return String(Math.round(number));
}

function safePositiveNumber(value: unknown, fallback: string): string {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return String(number);
}

type CapturePoseMode = "css" | "quake";

interface CapturePoseInput {
  mapName: string | null;
  mode: CapturePoseMode;
  pose: string;
}

function quakePoseFromViewParam(view: string): string {
  const parts = view.trim().split(/[,\s]+/).filter(Boolean).map((part) => Number(part));
  if ((parts.length !== 5 && parts.length !== 6) || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("URL view must be x,y,z,pitch,yaw or x,y,z,pitch,yaw,roll.");
  }
  const roll = parts[5] ?? 0;
  if (Math.abs(roll) > 0.001) {
    throw new Error("cssQuake URL capture only supports zero roll.");
  }
  return [...parts.slice(0, 5), 0].join(" ");
}

function parseCapturePoseInput(value: unknown): CapturePoseInput {
  const pose = safeString(value, "");
  if (!pose) return { mapName: null, mode: "css", pose };
  let url: URL | null = null;
  try {
    url = new URL(pose, DEFAULT_CSSQUAKE_URL);
  } catch {
    // Keep supporting the plain pose format.
  }
  if (url) {
    const view = url.searchParams.get("view");
    if (view) {
      return {
        mapName: url.searchParams.get("map")?.trim().toLowerCase() || null,
        mode: "quake",
        pose: quakePoseFromViewParam(view),
      };
    }
  }

  const parts = pose.split("|").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3 && /^[a-z][a-z0-9_]*$/i.test(parts[0])) {
    return {
      mapName: parts[0].toLowerCase(),
      mode: "css",
      pose: parts.slice(1).join(" | "),
    };
  }
  return { mapName: null, mode: "css", pose };
}

function captureArgs(input: Record<string, unknown>): string[] {
  const parsedPose = parseCapturePoseInput(input.pose);
  const pose = parsedPose.pose;
  const useSpawn = input.spawn === true;
  if (!useSpawn && !pose) throw new Error("Paste a CSS pose first.");
  const args = [
    CAPTURE_SCRIPT,
    "--map", parsedPose.mapName ?? safeString(input.map, "e1m1"),
    "--skill", safeString(input.skill, "easy"),
    "--vk-palettize", safeString(input.vkPalettize, "0"),
    "--vk-filter", safeString(input.vkFilter, "1"),
    "--width", safePositiveInt(input.width, "2560"),
    "--height", safePositiveInt(input.height, "1295"),
    "--diff-gain", safePositiveNumber(input.diffGain, "4"),
    "--out", DEFAULT_CAPTURE_OUTDIR,
  ];
  if (useSpawn) {
    args.push("--spawn");
  } else {
    args.push(parsedPose.mode === "quake" ? "--quake" : "--css", pose);
  }
  if (input.weaponOnly === true) {
    args.push("--weapon-only");
  } else if (input.worldOnly !== false) {
    args.push("--world-only");
  }
  if (input.weaponTuning && typeof input.weaponTuning === "object" && !Array.isArray(input.weaponTuning)) {
    args.push("--weapon-tuning", JSON.stringify(input.weaponTuning));
  }
  if (input.openFolder === true) args.push("--open");
  return args;
}

function dryRunCapture(input: Record<string, unknown>): Record<string, unknown> {
  const args = captureArgs(input);
  return {
    ok: true,
    dryRun: true,
    command: [process.execPath, ...args].join(" "),
    args,
  };
}

function runCapture(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (activeCapture) throw new Error("A capture is already running.");
  const args = captureArgs(input);
  const startedAt = new Date().toISOString();
  activeCapture = { startedAt, args };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: CONFIG_DIR,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code, signal) => {
      activeCapture = null;
      const reportPath = path.join(DEFAULT_CAPTURE_OUTDIR, "report.json");
      let report: unknown = null;
      let reportParseError: string | null = null;
      if (existsSync(reportPath)) {
        try {
          report = JSON.parse(readFileSync(reportPath, "utf8"));
        } catch (error) {
          reportParseError = error instanceof Error ? error.message : String(error);
        }
      }
      resolve({
        ok: code === 0,
        code,
        signal,
        startedAt,
        finishedAt: new Date().toISOString(),
        command: [process.execPath, ...args].join(" "),
        stdout,
        stderr,
        reportParseError,
        report,
        files: {
          folder: DEFAULT_CAPTURE_OUTDIR,
          quakecss: "/debug/captures/quakecss.png",
          quakevk: "/debug/captures/quakevk.png",
          diff: "/debug/captures/diff.png",
          overlay: "/debug/captures/overlay.png",
          report: "/debug/api/report",
        },
      });
    });
    child.on("error", (error) => {
      activeCapture = null;
      resolve({
        ok: false,
        code: null,
        signal: null,
        startedAt,
        finishedAt: new Date().toISOString(),
        command: [process.execPath, ...args].join(" "),
        stdout,
        stderr,
        error: error instanceof Error ? error.message : String(error),
        report: null,
      });
    });
  });
}

function reportResponse(res: ServerResponse): void {
  const reportPath = path.join(DEFAULT_CAPTURE_OUTDIR, "report.json");
  if (!existsSync(reportPath)) {
    sendJson(res, 404, { error: "No report.json yet. Run a capture first." });
    return;
  }
  sendText(res, 200, readFileSync(reportPath, "utf8"), "application/json; charset=utf-8");
}

function captureImageResponse(res: ServerResponse, imageName: string): void {
  const name = path.basename(imageName);
  if (!["quakecss.png", "quakevk.png", "diff.png", "overlay.png"].includes(name)) {
    sendText(res, 404, "Not found");
    return;
  }
  const filePath = path.join(DEFAULT_CAPTURE_OUTDIR, name);
  if (!existsSync(filePath)) {
    sendText(res, 404, "Not found");
    return;
  }
  res.statusCode = 200;
  res.setHeader("content-type", "image/png");
  res.setHeader("cache-control", "no-store");
  createReadStream(filePath).pipe(res);
}

function localDebugSitePlugin(): Plugin {
  return {
    name: "cssquake-local-debug-site",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== "/debug" && !url.pathname.startsWith("/debug/")) {
          next();
          return;
        }
        if (url.pathname === "/debug") {
          res.statusCode = 302;
          res.setHeader("location", `/debug/${url.search}`);
          res.end();
          return;
        }
        if (url.pathname === "/debug/api/status") {
          sendJson(res, 200, { activeCapture });
          return;
        }
        if (url.pathname === "/debug/api/report") {
          reportResponse(res);
          return;
        }
        if (url.pathname.startsWith("/debug/captures/")) {
          captureImageResponse(res, url.pathname.slice("/debug/captures/".length));
          return;
        }
        if (req.method === "POST" && url.pathname === "/debug/api/capture") {
          void (async () => {
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(await readBody(req));
            } catch (error) {
              sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
              return;
            }
            try {
              const result = input.dryRun === true ? dryRunCapture(input) : await runCapture(input);
              sendJson(res, result.ok === true ? 200 : 500, result);
            } catch (error) {
              sendJson(res, 409, { error: error instanceof Error ? error.message : String(error), activeCapture });
            }
          })();
          return;
        }
        if (!existsSync(LOCAL_DEBUG_DIR)) {
          next();
          return;
        }

        const relativePath = decodeURIComponent(url.pathname.slice("/debug/".length)) || "index.html";
        let filePath = path.resolve(LOCAL_DEBUG_DIR, relativePath);
        if (!filePath.startsWith(`${LOCAL_DEBUG_DIR}${path.sep}`)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        if (existsSync(filePath) && statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, "index.html");
        }
        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        res.setHeader("content-type", DEBUG_CONTENT_TYPES.get(path.extname(filePath)) ?? "application/octet-stream");
        res.setHeader("cache-control", "no-store");
        res.end(readFileSync(filePath));
      });
    },
  };
}

export default defineConfig({
  plugins: [localDebugSitePlugin()],
  define: {
    __CSSQUAKE_VERSION__: JSON.stringify(cssQuakeVersion()),
    __POLYCSS_VERSION__: JSON.stringify(polyCssVersion()),
  },
  publicDir: "build/generated/public",
  server: {
    host: "127.0.0.1",
  },
});
