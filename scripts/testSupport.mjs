import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(scriptDir, "..");

export async function runStep(label, command, args, options = {}) {
  const display = [command, ...args].join(" ");
  console.log(`\n> ${label}\n  ${display}`);
  const child = spawn(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${label} was killed by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}.`);
  }
}

export function nodeScript(scriptPath, ...args) {
  return [process.execPath, [path.join(projectRoot, scriptPath), ...args]];
}

export async function runNodeScript(label, scriptPath, args = []) {
  const [command, commandArgs] = nodeScript(scriptPath, ...args);
  await runStep(label, command, commandArgs);
}

export function requireExistingPath(relativePath, message) {
  const fullPath = path.join(projectRoot, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(message ?? `Missing ${relativePath}.`);
  }
  return fullPath;
}

export function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

export function optionValue(args, name, fallback = "") {
  const flag = `--${name}`;
  const index = args.indexOf(flag);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) return args[index + 1];
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  return prefixed ? prefixed.slice(flag.length + 1) : fallback;
}
