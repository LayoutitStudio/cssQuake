#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import path from "node:path";

import { projectRoot, runNodeScript, runStep } from "./testSupport.mjs";

const testDir = path.join(projectRoot, "test");
const testFiles = (await readdir(testDir))
  .filter((entry) => entry.endsWith(".test.mjs"))
  .sort()
  .map((entry) => path.join(testDir, entry));

if (!testFiles.length) {
  throw new Error("No contract test files found in test/*.test.mjs.");
}

await runStep("pure contract tests", process.execPath, ["--test", ...testFiles]);

const smokeScripts = [
  ["program facts", "scripts/smokeProgramFacts.mjs"],
  ["game logic facts", "scripts/smokeGameLogicFacts.mjs"],
  ["game logic preloads", "scripts/smokeGameLogicPreloads.mjs"],
  ["game logic sound preloads", "scripts/smokeGameLogicSoundPreloads.mjs"],
  ["shootable runtime audit", "scripts/smokeShootableRuntimeAudit.mjs"],
  ["pickup runtime audit", "scripts/smokePickupRuntimeAudit.mjs"],
  ["trigger runtime audit", "scripts/smokeTriggerRuntimeAudit.mjs"],
  ["mover runtime audit", "scripts/smokeMoverRuntimeAudit.mjs"],
];

for (const [label, scriptPath] of smokeScripts) {
  await runNodeScript(label, scriptPath);
}

console.log("\nContract suite passed.");
