#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { hasFlag, requireExistingPath, runNodeScript } from "./testSupport.mjs";

const args = process.argv.slice(2);
const run = hasFlag(args, "run");
const ledgerPath = requireExistingPath(
  "notes/monster-render-spike.md",
  "Missing notes/monster-render-spike.md. Monster-render performance work needs the canonical attempt ledger.",
);
const ledger = await readFile(ledgerPath, "utf8");

for (const required of ["## Attempt Ledger", "Decision vocabulary", "Acceptance Checks"]) {
  if (!ledger.includes(required)) {
    throw new Error(`Monster-render ledger is missing required section: ${required}`);
  }
}

if (!run) {
  await runNodeScript("monster lab trace plan preflight", "scripts/trace-monster-lab.mjs", [
    "--print-plan",
    "--model",
    "dog",
    "--mode",
    "static",
    "--count",
    "1",
    "--duration-ms",
    "600",
    "--label",
    "perf-preflight",
  ]);
  console.log("\nPerf preflight passed. Use `node scripts/testPerf.mjs --run` for an actual monster-lab trace run.");
  process.exit(0);
}

const forwarded = args.filter((arg) => arg !== "--run");
await runNodeScript("monster lab trace run", "scripts/trace-monster-lab.mjs", forwarded.length ? forwarded : [
  "--model",
  "dog",
  "--mode",
  "both",
  "--count",
  "1",
  "--duration-ms",
  "1200",
  "--label",
  "perf-monster-smoke",
]);
