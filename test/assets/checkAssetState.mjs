#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const manifestPath = path.join(projectRoot, "build/generated/public/q/manifest.json");

function option(args, name, fallback = "") {
  const flag = `--${name}`;
  const index = args.indexOf(flag);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) return args[index + 1];
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  return prefixed ? prefixed.slice(flag.length + 1) : fallback;
}

function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

export function parseMapList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function activePrepareProcesses() {
  const ps = spawnSync("ps", ["-axo", "pid,command"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (ps.error || ps.status !== 0) {
    return {
      error: ps.error?.message ?? ps.stderr?.trim() ?? `ps exited with status ${ps.status}`,
      processes: [],
    };
  }
  const selfPid = String(process.pid);
  return {
    error: "",
    processes: ps.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) =>
        line &&
        !line.startsWith("PID ") &&
        !line.startsWith(`${selfPid} `) &&
        /pnpm prepare:quake|node src\/prepare\/assets\.mjs/.test(line)
      ),
  };
}

export function readAssetManifest() {
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

export function inspectAssetState(options = {}) {
  const requiredMaps = options.requiredMaps ?? [];
  const prepare = activePrepareProcesses();
  const manifest = readAssetManifest();
  const problems = [];
  const warnings = [];

  if (prepare.error) warnings.push(`could not inspect active prepare processes: ${prepare.error}`);
  if (prepare.processes.length) {
    problems.push(`active shared prepare process detected:\n${prepare.processes.join("\n")}`);
  }

  if (!manifest) {
    problems.push("missing build/generated/public/q/manifest.json");
  } else {
    if (manifest.status && manifest.status !== "ready") {
      problems.push(`manifest status is ${JSON.stringify(manifest.status)}, expected ready or absent`);
    }
    if (!Array.isArray(manifest.maps) || manifest.maps.length === 0) {
      problems.push("manifest maps must be a non-empty array");
    }
    const mapNames = new Set((manifest.maps ?? []).map((entry) => entry?.mapName).filter(Boolean));
    for (const mapName of requiredMaps) {
      if (!mapNames.has(mapName)) problems.push(`manifest is missing required map ${mapName}`);
      const scenePath = path.join(projectRoot, `build/generated/public/q/${mapName}.json`);
      if (!existsSync(scenePath)) {
        problems.push(`missing prepared scene build/generated/public/q/${mapName}.json`);
        continue;
      }
      try {
        const scene = JSON.parse(readFileSync(scenePath, "utf8"));
        if (options.requireRenderBundle && !scene.renderBundle) {
          problems.push(`${mapName} prepared scene is missing renderBundle`);
        }
        if (options.requireGameLogic && !scene.gameLogic) {
          problems.push(`${mapName} prepared scene is missing gameLogic`);
        }
      } catch (error) {
        problems.push(`could not read prepared scene ${mapName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return {
    ok: problems.length === 0,
    manifestPath,
    manifestStatus: manifest?.status ?? (manifest ? "ready" : "missing"),
    mapCount: Array.isArray(manifest?.maps) ? manifest.maps.length : 0,
    requiredMaps,
    activePrepareProcesses: prepare.processes,
    problems,
    warnings,
  };
}

export function assertAssetState(options = {}) {
  const state = inspectAssetState(options);
  if (!state.ok) {
    const next = [
      "Prepared Quake assets are not ready for this gate.",
      "Do not start a shared prepare automatically from a test gate.",
      "Run the explicit prepare command requested by the task, then rerun this gate.",
    ].join("\n");
    throw new Error(`${state.problems.join("\n")}\n\n${next}`);
  }
  return state;
}

function printState(state, json) {
  if (json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  console.log(`Asset state: ${state.ok ? "ready" : "not ready"}`);
  console.log(`manifest: ${state.manifestPath}`);
  console.log(`manifestStatus: ${state.manifestStatus}`);
  console.log(`maps: ${state.mapCount}`);
  if (state.requiredMaps.length) console.log(`requiredMaps: ${state.requiredMaps.join(",")}`);
  if (state.activePrepareProcesses.length) {
    console.log("activePrepareProcesses:");
    for (const processLine of state.activePrepareProcesses) console.log(`  ${processLine}`);
  }
  for (const warning of state.warnings) console.warn(`warning: ${warning}`);
  for (const problem of state.problems) console.error(`problem: ${problem}`);
}

async function main() {
  const args = process.argv.slice(2);
  const requiredMaps = parseMapList(option(args, "maps", ""));
  const state = inspectAssetState({
    requiredMaps,
    requireRenderBundle: hasFlag(args, "require-render-bundle"),
    requireGameLogic: hasFlag(args, "require-game-logic"),
  });
  printState(state, hasFlag(args, "json"));
  process.exitCode = state.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
