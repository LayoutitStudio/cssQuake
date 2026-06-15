#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";

import { projectRoot } from "./checkAssetState.mjs";

const packagePath = path.join(projectRoot, "package.json");
const harnessDocPath = path.join(projectRoot, "test/HARNESS.md");
const requiredScripts = [
  "test",
  "test:asset-state",
  "test:assets",
  "test:browser:smoke",
  "test:browser",
  "test:harness",
  "test:perf",
  "test:dev",
  "test:all",
];
const requiredDocPhrases = [
  "Perf claim or monster-render work",
  "pnpm test:perf",
  "pnpm test:harness",
  "notes/monster-render-spike.md",
  "Committed runners should print what they validate",
];

console.log("Perf preflight gate");
console.log("validates: committed no-asset perf command surface and harness guidance");
console.log("requires prepared assets: no");
console.log("classification: diagnostic-only");

const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
for (const scriptName of requiredScripts) {
  if (!packageJson.scripts?.[scriptName]) throw new Error(`package.json is missing scripts.${scriptName}`);
  console.log(`ok package script ${scriptName}`);
}

const harnessDoc = readFileSync(harnessDocPath, "utf8");
for (const phrase of requiredDocPhrases) {
  if (!harnessDoc.includes(phrase)) throw new Error(`test/HARNESS.md is missing required guidance: ${phrase}`);
  console.log(`ok harness doc phrase ${phrase}`);
}

console.log("Perf preflight passed. For local perf claims, read notes/monster-render-spike.md when present and run the ignored perf harness explicitly.");
