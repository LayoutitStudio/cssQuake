#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";

import { projectRoot } from "./checkAssetState.mjs";

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
  let needsBrowserSmoke = false;
  let needsPerfPreflight = false;

  for (const file of files) {
    const route = routeFile(file);
    if (route.reason) reasons.push({ file, ...route });
    for (const family of route.browserFamilies) browserFamilies.add(family);
    needsDev ||= route.needsDev;
    needsBuild ||= route.needsBuild;
    needsAssetIntegrity ||= route.needsAssetIntegrity;
    needsBrowserSmoke ||= route.needsBrowserSmoke;
    needsPerfPreflight ||= route.needsPerfPreflight;
  }

  if (needsDev) commands.push("pnpm test:dev");
  if (needsAssetIntegrity) commands.push("pnpm test:assets");
  if (needsBrowserSmoke) commands.push("pnpm test:browser:smoke");
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
    needsBrowserSmoke: false,
    needsBuild: false,
    needsDev: false,
    needsPerfPreflight: false,
    reason: "",
  };

  if (file === "package.json" || file === "test/HARNESS.md" || file.startsWith("test/run")) {
    route.needsDev = true;
    route.needsPerfPreflight = true;
    route.reason = "harness command surface";
  }
  if (file.startsWith("src/") || file === "package.json") {
    route.needsDev = true;
    route.needsBuild = true;
  }
  if (file.startsWith("src/App") || file.includes("/app/") || file.includes("/debug/")) {
    route.needsBrowserSmoke = true;
    route.browserFamilies.push("combat", "map-logic", "projectile");
    route.reason ||= "debug/app browser surface";
  }
  if (file.includes("/shootables") || file.includes("/weapons") || file.includes("/player")) {
    route.browserFamilies.push("combat", "projectile");
    route.reason ||= "combat/projectile runtime";
  }
  if (file.includes("/world") || file === "src/quake.css" || file.includes("/visibility")) {
    route.browserFamilies.push("monster");
    route.reason ||= "world rendering or visibility";
  }
  if (file.includes("/triggers") || file.includes("/movers") || file.includes("/pickups") || file.includes("/liquid")) {
    route.browserFamilies.push("map-logic");
    route.reason ||= "map gameplay logic";
  }
  if (file.startsWith("src/prepare/")) {
    route.needsAssetIntegrity = true;
    route.needsBuild = true;
    route.browserFamilies.push("monster");
    route.reason ||= "prepared asset pipeline";
  }
  if (file === "test/browserFixtureDefinitions.mjs" || file === "test/runBrowserFixtures.mjs") {
    route.browserFamilies.push("combat", "map-logic", "monster", "projectile");
    route.reason ||= "browser fixture router";
  }
  if (file === "test/browserFixtureCombat.mjs") {
    route.browserFamilies.push("combat");
    route.reason ||= "combat browser fixture family";
  }
  if (file === "test/browserFixtureMapLogic.mjs") {
    route.browserFamilies.push("map-logic");
    route.reason ||= "map-logic browser fixture family";
  }
  if (file === "test/browserFixtureMonster.mjs") {
    route.browserFamilies.push("monster");
    route.reason ||= "monster browser fixture family";
  }
  if (file === "test/browserFixtureProjectile.mjs") {
    route.browserFamilies.push("projectile");
    route.reason ||= "projectile browser fixture family";
  }
  if (file.endsWith(".test.mjs")) {
    route.needsDev = true;
    route.reason ||= "contract test";
  }

  route.browserFamilies = [...new Set(route.browserFamilies)];
  return route;
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
