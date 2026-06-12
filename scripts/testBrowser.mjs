#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { hasFlag, projectRoot, runNodeScript } from "./testSupport.mjs";

const args = process.argv.slice(2);
const full = hasFlag(args, "full");
const outDir = path.join(projectRoot, "bench/results/quake");

await mkdir(outDir, { recursive: true });

await runNodeScript("URL API browser smoke", "scripts/smokeUrlApi.mjs", ["--port", "5177", "--timeout-ms", "120000"]);

if (!full) {
  console.log("\nBrowser smoke suite passed. Use `pnpm test:browser` for monster/pickup/mover fixtures.");
  process.exit(0);
}

const fixtureScripts = [
  [
    "DOM monster browser smoke",
    "scripts/smokeDomMonsters.mjs",
    ["--port", "5178", "--timeout-ms", "120000", "--json-out", "bench/results/quake/monster-dom-smoke-summary.json"],
  ],
  [
    "monster combat browser smoke",
    "scripts/smokeMonsterCombat.mjs",
    ["--port", "5179", "--timeout-ms", "120000", "--json-out", "bench/results/quake/monster-combat-smoke-summary.json"],
  ],
  [
    "combat budget harness smoke",
    "scripts/smokeCombatBudgetHarness.mjs",
    ["--port", "5183", "--timeout-ms", "120000", "--json-out", "bench/results/quake/combat-budget-harness-smoke-summary.json"],
  ],
  [
    "logical targetability browser smoke",
    "scripts/smokeLogicalTargetabilityHarness.mjs",
    ["--port", "5185", "--timeout-ms", "120000", "--json-out", "bench/results/quake/logical-targetability-smoke-summary.json"],
  ],
  [
    "pickup browser fixture",
    "scripts/smokePickupBrowserFixture.mjs",
    ["--port", "5180", "--timeout-ms", "120000", "--json-out", "bench/results/quake/pickup-browser-smoke-summary.json"],
  ],
  [
    "pusher browser fixture",
    "scripts/smokePusherBrowserFixture.mjs",
    ["--port", "5181", "--timeout-ms", "120000", "--json-out", "bench/results/quake/pusher-browser-smoke-summary.json"],
  ],
  [
    "elevator browser fixture",
    "scripts/smokeElevatorBrowserFixture.mjs",
    ["--port", "5182", "--timeout-ms", "120000", "--json-out", "bench/results/quake/elevator-browser-smoke-summary.json"],
  ],
];

for (const [label, scriptPath, scriptArgs] of fixtureScripts) {
  await runBrowserFixture(label, scriptPath, scriptArgs);
}

console.log("\nFull browser gameplay suite passed.");

async function runBrowserFixture(label, scriptPath, scriptArgs) {
  try {
    await runNodeScript(label, scriptPath, scriptArgs);
  } catch (error) {
    console.warn(`${label} failed once; retrying with a fresh browser/server process.`);
    await runNodeScript(`${label} retry`, scriptPath, scriptArgs);
  }
}
