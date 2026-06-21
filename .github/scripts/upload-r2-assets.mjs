#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_GENERATED_PUBLIC_DIR = path.join(PROJECT_ROOT, "build/generated/public");
const DEFAULT_BUCKET = "cssquake-assets";
const DEFAULT_CONCURRENCY = 8;

const argv = process.argv.slice(2);
const dryRun = hasFlag("--dry-run");
const bucket =
  readOption("--bucket") ??
  process.env.CSSQUAKE_R2_BUCKET ??
  process.env.R2_BUCKET_NAME ??
  DEFAULT_BUCKET;
const keyPrefix = normalizeKeyPrefix(readOption("--key-prefix") ?? process.env.CSSQUAKE_R2_KEY_PREFIX);
const concurrency = parsePositiveInt(
  readOption("--concurrency") ?? process.env.CSSQUAKE_R2_UPLOAD_CONCURRENCY,
  DEFAULT_CONCURRENCY,
);
const retries = parseNonNegativeInt(readOption("--retries") ?? process.env.CSSQUAKE_R2_UPLOAD_RETRIES, 2);
const generatedPublicDir = path.resolve(
  PROJECT_ROOT,
  readOption("--generated-public-dir") ??
    process.env.QUAKE_GENERATED_PUBLIC_DIR ??
    DEFAULT_GENERATED_PUBLIC_DIR,
);
const qRoot = path.join(generatedPublicDir, "q");
const manifestPath = path.join(qRoot, "manifest.json");

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  validateInput();
  validateManifest(manifestPath);

  const files = walkFiles(qRoot)
    .map((absolutePath) => {
      const sourceKey = toPosixPath(path.relative(generatedPublicDir, absolutePath));
      return {
        absolutePath,
        sourceKey,
        uploadKey: uploadKeyForSourceKey(sourceKey),
        contentType: contentTypeForPath(absolutePath),
        cacheControl: cacheControlForKey(sourceKey),
      };
    })
    .filter((entry) => shouldUpload(entry.sourceKey))
    .sort((a, b) => a.uploadKey.localeCompare(b.uploadKey));

  const manifest = files.find((entry) => entry.sourceKey === "q/manifest.json");
  if (!manifest) {
    throw new Error(`Missing required upload object: ${toPosixPath(path.relative(PROJECT_ROOT, manifestPath))}`);
  }

  const dataFiles = files.filter((entry) => entry.sourceKey !== "q/manifest.json");
  const topologySkipped = countTopologyFiles(qRoot, generatedPublicDir);

  console.log(`R2 bucket: ${bucket}`);
  console.log(`R2 key prefix: ${keyPrefix || "(none)"}`);
  console.log(`Generated public dir: ${toPosixPath(path.relative(PROJECT_ROOT, generatedPublicDir))}`);
  console.log(`Upload objects: ${dataFiles.length} data files + manifest last`);
  console.log(`Skipped topology files: ${topologySkipped}`);

  if (dryRun) {
    console.log("Dry run: no R2 objects uploaded.");
    console.log(`First object: ${dataFiles[0]?.uploadKey ?? "none"}`);
    console.log(`Last object: ${manifest.uploadKey}`);
    return;
  }

  await uploadInPool(dataFiles, concurrency);
  await uploadObject(manifest);
  console.log(`Uploaded ${dataFiles.length + 1} R2 objects. Manifest published last.`);
}

function validateInput() {
  if (!bucket.trim()) {
    throw new Error("Missing R2 bucket. Set CSSQUAKE_R2_BUCKET or pass --bucket.");
  }
  assertDirectory(qRoot, "generated q asset directory");
  assertFile(manifestPath, "manifest");
}

function validateManifest(filePath) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse ${toPosixPath(path.relative(PROJECT_ROOT, filePath))}: ${error.message}`);
  }

  if (manifest.status && manifest.status !== "ready") {
    throw new Error(`Refusing to upload manifest with status ${JSON.stringify(manifest.status)}.`);
  }
  if (!Array.isArray(manifest.maps) || manifest.maps.length === 0) {
    throw new Error("Refusing to upload manifest without map entries.");
  }
  if (!manifest.startMap) {
    throw new Error("Refusing to upload manifest without startMap.");
  }
}

function walkFiles(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const absolutePath = path.join(dir, name);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      entries.push(...walkFiles(absolutePath));
    } else if (stat.isFile()) {
      entries.push(absolutePath);
    }
  }
  return entries;
}

function shouldUpload(key) {
  if (!key.startsWith("q/")) {
    return false;
  }
  if (key === "q/.DS_Store" || key.endsWith("/.DS_Store")) {
    return false;
  }
  return !key.startsWith("q/topology/");
}

function countTopologyFiles(root, generatedRoot) {
  const topologyRoot = path.join(root, "topology");
  try {
    const stat = statSync(topologyRoot);
    if (!stat.isDirectory()) {
      return 0;
    }
  } catch {
    return 0;
  }
  return walkFiles(topologyRoot)
    .map((absolutePath) => toPosixPath(path.relative(generatedRoot, absolutePath)))
    .filter((key) => !key.endsWith("/.DS_Store"))
    .length;
}

async function uploadInPool(entries, maxConcurrency) {
  let nextIndex = 0;
  let completed = 0;
  const failures = [];

  async function worker() {
    while (nextIndex < entries.length) {
      const entry = entries[nextIndex++];
      try {
        await uploadObject(entry);
        completed += 1;
        if (completed % 100 === 0 || completed === entries.length) {
          console.log(`Uploaded ${completed}/${entries.length} data files`);
        }
      } catch (error) {
        failures.push({ entry, error });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxConcurrency, entries.length) }, () => worker()));

  if (failures.length > 0) {
    const first = failures[0];
    throw new Error(
      `Failed to upload ${failures.length} data file(s). First failure ${first.entry.uploadKey}: ${first.error.message}`,
    );
  }
}

async function uploadObject(entry) {
  const destination = `${bucket}/${entry.uploadKey}`;
  const args = [
    "--package=wrangler@latest",
    "dlx",
    "wrangler",
    "r2",
    "object",
    "put",
    destination,
    "--file",
    entry.absolutePath,
    "--content-type",
    entry.contentType,
    "--cache-control",
    entry.cacheControl,
    "--remote",
    "--force",
  ];
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await run("pnpm", args);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const delayMs = 500 * (attempt + 1);
        console.warn(`Retrying ${entry.uploadKey} after upload failure (${attempt + 1}/${retries})`);
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with ${signal ? `signal ${signal}` : `exit ${code}`}\n${stderr}${stdout}`,
        ),
      );
    });
  });
}

function contentTypeForPath(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".avif":
      return "image/avif";
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".jpeg":
    case ".jpg":
      return "image/jpeg";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".wav":
      return "audio/wav";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function cacheControlForKey(key) {
  if (key === "q/manifest.json") {
    return "no-store";
  }
  return "public, max-age=0, must-revalidate";
}

function uploadKeyForSourceKey(sourceKey) {
  if (!keyPrefix) {
    return sourceKey;
  }
  if (!sourceKey.startsWith("q/")) {
    throw new Error(`Cannot prefix non-q asset key: ${sourceKey}`);
  }
  return `${keyPrefix}/${sourceKey.slice("q/".length)}`;
}

function readOption(name) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }
  return value;
}

function hasFlag(name) {
  return argv.includes(name);
}

function normalizeKeyPrefix(value) {
  if (value === undefined) {
    return "";
  }
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return "";
  }
  if (normalized.includes("..") || normalized.includes("//")) {
    throw new Error(`Invalid R2 key prefix: ${JSON.stringify(value)}`);
  }
  return normalized;
}

function parsePositiveInt(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${JSON.stringify(value)}.`);
  }
  return parsed;
}

function parseNonNegativeInt(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received ${JSON.stringify(value)}.`);
  }
  return parsed;
}

function assertDirectory(filePath, label) {
  try {
    if (statSync(filePath).isDirectory()) {
      return;
    }
  } catch {
    // handled below
  }
  throw new Error(`Missing ${label}: ${toPosixPath(path.relative(PROJECT_ROOT, filePath))}`);
}

function assertFile(filePath, label) {
  try {
    if (statSync(filePath).isFile()) {
      return;
    }
  } catch {
    // handled below
  }
  throw new Error(`Missing ${label}: ${toPosixPath(path.relative(PROJECT_ROOT, filePath))}`);
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
