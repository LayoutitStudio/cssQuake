#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const testDir = path.join(projectRoot, "test");
const testFiles = (await collectContractTestFiles(testDir)).sort();

if (!testFiles.length) {
  throw new Error("No contract test files found in test/**/*.test.mjs.");
}

const child = spawn(process.execPath, ["--test", ...testFiles], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});

const exitCode = await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    if (signal) reject(new Error(`contract tests were killed by ${signal}.`));
    else resolve(code ?? 1);
  });
});

if (exitCode !== 0) {
  throw new Error(`contract tests failed with exit code ${exitCode}.`);
}

console.log("\nContract tests passed.");

async function collectContractTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const testFiles = [];
  for (const entry of entries) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      testFiles.push(...await collectContractTestFiles(resolved));
    } else if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      testFiles.push(resolved);
    }
  }
  return testFiles;
}
