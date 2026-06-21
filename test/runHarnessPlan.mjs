#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";

import { projectRoot } from "./assets/checkAssetState.mjs";

const ALL_BROWSER_FAMILIES = ["combat", "map-logic", "monster", "projectile"];
const HARNESS_RUNNER_PREFIXES = [
  "test/assets/run",
  "test/browser/run",
  "test/perf/run",
];
const HARNESS_COMMAND_SURFACE_FILES = new Set([
  "package.json",
  "test/HARNESS.md",
  "test/runHarnessPlan.mjs",
]);
const SHARED_ASSET_GATE_FILES = new Set([
  "test/assets/checkAssetState.mjs",
  "test/assets/preparedAssets.mjs",
]);
const SHARED_BROWSER_FIXTURE_FILES = new Set([
  "test/browser/browserFixtureDefinitions.mjs",
  "test/browser/browserHarnessSupport.mjs",
  "test/browser/fixtureHarness.mjs",
  "test/browser/runBrowserFixtures.mjs",
]);
const BROWSER_SMOKE_FILES = new Set([
  "test/browser/browserHarnessSupport.mjs",
  "test/browser/runBrowserSmoke.mjs",
]);
const BROWSER_FIXTURE_FAMILY_BY_FILE = new Map([
  ["test/browser/browserFixtureCombat.mjs", "combat"],
  ["test/browser/browserFixtureMapLogic.mjs", "map-logic"],
  ["test/browser/browserFixtureMonster.mjs", "monster"],
  ["test/browser/browserFixtureProjectile.mjs", "projectile"],
]);
const args = process.argv.slice(2);
const files = selectedFiles(args);
const plan = planHarnessCommands(files);

if (hasFlag(args, "json")) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  printPlan(plan);
}

function selectedFiles(argv) {
  const explicit = optionValues(argv, "file")
    .flatMap((value) => value.split(","))
    .map(normalizePath)
    .filter(Boolean);
  if (explicit.length) return [...new Set(explicit)].sort();

  const status = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (status.error || status.status !== 0) {
    throw new Error(status.error?.message ?? status.stderr?.trim() ?? `git status exited with ${status.status}`);
  }
  return [...new Set(status.stdout
    .split("\n")
    .map(statusPath)
    .filter(Boolean)
    .map(normalizePath))].sort();
}

function statusPath(line) {
  if (!line.trim()) return "";
  const rawPath = line.slice(3).trim();
  const renamed = rawPath.split(" -> ").pop() ?? rawPath;
  return renamed.replace(/^"|"$/g, "");
}

function planHarnessCommands(files) {
  const reasons = [];
  const browserFamilies = new Set();
  const commands = [];
  let needsDev = false;
  let needsBuild = false;
  let needsAssetIntegrity = false;
  let needsBrowserMultiplayer = false;
  let needsBrowserSmoke = false;
  let needsPerfPreflight = false;

  for (const file of files) {
    const route = routeFile(file);
    if (route.reason) reasons.push({ file, ...route });
    for (const family of route.browserFamilies) browserFamilies.add(family);
    needsDev ||= route.needsDev;
    needsBuild ||= route.needsBuild;
    needsAssetIntegrity ||= route.needsAssetIntegrity;
    needsBrowserMultiplayer ||= route.needsBrowserMultiplayer;
    needsBrowserSmoke ||= route.needsBrowserSmoke;
    needsPerfPreflight ||= route.needsPerfPreflight;
  }

  if (needsDev) commands.push("pnpm test:dev");
  if (needsAssetIntegrity) commands.push("pnpm test:assets");
  if (needsBrowserSmoke) commands.push("pnpm test:browser:smoke");
  if (needsBrowserMultiplayer) commands.push("pnpm test:browser:multiplayer");
  if (browserFamilies.size) {
    commands.push(`pnpm test:browser -- --family ${[...browserFamilies].sort().join(",")}`);
  }
  if (needsPerfPreflight && !commands.includes("pnpm test:dev")) commands.push("pnpm test:perf");
  if (needsBuild) commands.push("pnpm build");
  if (!commands.length) commands.push("pnpm test:dev && pnpm build");

  return {
    changedFiles: files,
    commands,
    browserFamilies: [...browserFamilies].sort(),
    reasons,
  };
}

function routeFile(file) {
  const route = {
    browserFamilies: [],
    needsAssetIntegrity: false,
    needsBrowserMultiplayer: false,
    needsBrowserSmoke: false,
    needsBuild: false,
    needsDev: false,
    needsPerfPreflight: false,
    reason: "",
  };
  const sourceFile = file.startsWith("src/");

  if (BROWSER_SMOKE_FILES.has(file)) {
    route.needsBrowserSmoke = true;
    route.needsBrowserMultiplayer ||= file === "test/browser/browserHarnessSupport.mjs";
    route.reason = file === "test/browser/runBrowserSmoke.mjs"
      ? "browser smoke runner"
      : "shared browser harness support";
  }
  if (file === "test/browser/runMultiplayerBrowserSmoke.mjs") {
    route.needsBrowserMultiplayer = true;
    route.reason ||= "browser multiplayer runner";
  }
  if (isHarnessCommandSurfaceFile(file)) {
    route.needsDev = true;
    route.needsPerfPreflight = true;
    route.reason ||= "harness command surface";
  }
  if (sourceFile || file === "package.json") {
    route.needsDev = true;
    route.needsBuild = true;
  }
  if (sourceFile && (file.startsWith("src/App") || file.includes("/app/") || file.includes("/debug/"))) {
    route.needsBrowserSmoke = true;
    if (file.startsWith("src/App")) route.needsBrowserMultiplayer = true;
    addBrowserFamilies(route, ["combat", "map-logic", "projectile"]);
    route.reason ||= "debug/app browser surface";
  }
  if (sourceFile && file.startsWith("src/runtime/multiplayer/")) {
    route.needsBrowserMultiplayer = true;
    route.reason ||= "multiplayer runtime";
  }
  if (sourceFile && (file.includes("/shootables") || file.includes("/weapons") || file.includes("/player"))) {
    addBrowserFamilies(route, ["combat", "projectile"]);
    route.reason ||= "combat/projectile runtime";
  }
  if (sourceFile && (file.includes("/world") || file === "src/quake.css" || file.includes("/visibility"))) {
    addBrowserFamilies(route, ["monster"]);
    route.reason ||= "world rendering or visibility";
  }
  if (sourceFile && (
    file.includes("/triggers") ||
    file.includes("/movers") ||
    file.includes("/pickups") ||
    file.includes("/liquid")
  )) {
    addBrowserFamilies(route, ["map-logic"]);
    route.reason ||= "map gameplay logic";
  }
  if (file.startsWith("src/prepare/")) {
    route.needsAssetIntegrity = true;
    route.needsBuild = true;
    addBrowserFamilies(route, ["monster"]);
    route.reason ||= "prepared asset pipeline";
  }
  if (SHARED_ASSET_GATE_FILES.has(file)) {
    route.needsAssetIntegrity = true;
    route.needsBrowserSmoke = true;
    addBrowserFamilies(route, ALL_BROWSER_FAMILIES);
    route.reason ||= "shared asset gate helper";
  }
  if (file === "test/assets/runAssetIntegrity.mjs") {
    route.needsAssetIntegrity = true;
    route.reason ||= "asset integrity runner";
  }
  if (SHARED_BROWSER_FIXTURE_FILES.has(file)) {
    addBrowserFamilies(route, ALL_BROWSER_FAMILIES);
    route.reason ||= "browser fixture router";
  }
  const fixtureFamily = BROWSER_FIXTURE_FAMILY_BY_FILE.get(file);
  if (fixtureFamily) {
    addBrowserFamilies(route, [fixtureFamily]);
    route.reason ||= `${fixtureFamily} browser fixture family`;
  }
  if (file.endsWith(".test.mjs")) {
    route.needsDev = true;
    route.reason ||= contractTestReason(file);
  }

  route.browserFamilies = [...new Set(route.browserFamilies)];
  return route;
}

function addBrowserFamilies(route, families) {
  route.browserFamilies.push(...families);
}

function isHarnessCommandSurfaceFile(file) {
  return HARNESS_COMMAND_SURFACE_FILES.has(file) ||
    HARNESS_RUNNER_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function contractTestReason(file) {
  if (file.startsWith("test/gameplay/")) return "gameplay contract test";
  if (file.startsWith("test/runtime/")) return "runtime contract test";
  return "contract test";
}

function printPlan(plan) {
  console.log("Harness plan");
  console.log("validates: changed-file routing to committed gates");
  console.log("requires prepared assets: only for commands that say browser/assets");
  console.log("classification: diagnostic-only");
  console.log(`changed files: ${plan.changedFiles.length ? plan.changedFiles.join(", ") : "(none)"}`);
  console.log("commands:");
  for (const command of plan.commands) console.log(`  ${command}`);
  if (plan.browserFamilies.length) console.log(`browser families: ${plan.browserFamilies.join(", ")}`);
  if (plan.reasons.length) {
    console.log("routing:");
    for (const reason of plan.reasons) {
      const families = reason.browserFamilies.length ? ` families=${reason.browserFamilies.join(",")}` : "";
      console.log(`  ${reason.file}: ${reason.reason}${families}`);
    }
  }
}

function optionValues(argv, name) {
  const values = [];
  const flag = `--${name}`;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1] && !argv[index + 1].startsWith("--")) {
      values.push(argv[index + 1]);
      index += 1;
    } else if (argv[index].startsWith(`${flag}=`)) {
      values.push(argv[index].slice(flag.length + 1));
    }
  }
  return values;
}

function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}

function normalizePath(file) {
  const normalized = path.relative(projectRoot, path.resolve(projectRoot, file));
  return normalized && !normalized.startsWith("..") ? normalized : file.replaceAll("\\", "/");
}
