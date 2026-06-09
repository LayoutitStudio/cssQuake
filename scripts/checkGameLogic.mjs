import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const checks = [
  ["program facts", "scripts/smokeProgramFacts.mjs"],
  ["map facts", "scripts/smokeGameLogicFacts.mjs"],
  ["model preloads", "scripts/smokeGameLogicPreloads.mjs"],
  ["sound preloads", "scripts/smokeGameLogicSoundPreloads.mjs"],
  ["shootables", "scripts/smokeShootableRuntimeAudit.mjs"],
  ["pickups", "scripts/smokePickupRuntimeAudit.mjs"],
  ["triggers", "scripts/smokeTriggerRuntimeAudit.mjs"],
];

for (const [label, script] of checks) {
  console.log(`\n> game logic check: ${label}`);
  const result = spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\nGame logic checks passed.");
