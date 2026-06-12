#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

import { projectRoot, requireExistingPath, runNodeScript } from "./testSupport.mjs";

const generatedRoot = path.join(projectRoot, "build/generated/public");
const manifestPath = requireExistingPath(
  "build/generated/public/q/manifest.json",
  "Missing build/generated/public/q/manifest.json. Run an explicit prepare step before asset tests.",
);

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const errors = [];

if (manifest.status && manifest.status !== "ready") {
  errors.push(`manifest status is ${JSON.stringify(manifest.status)}, expected ready or absent`);
}
if (!Number.isFinite(manifest.version)) errors.push("manifest version must be finite");
if (typeof manifest.assetRoot !== "string" || !manifest.assetRoot.startsWith("/q")) {
  errors.push(`manifest assetRoot should start with /q, got ${JSON.stringify(manifest.assetRoot)}`);
}
if (!Array.isArray(manifest.maps) || manifest.maps.length === 0) {
  errors.push("manifest maps must be a non-empty array");
}

const mapNames = new Set();
for (const mapEntry of Array.isArray(manifest.maps) ? manifest.maps : []) {
  await validateMapEntry(mapEntry, mapNames);
}

if (typeof manifest.startMap !== "string" || !mapNames.has(manifest.startMap)) {
  errors.push(`manifest startMap ${JSON.stringify(manifest.startMap)} must exist in maps`);
}

if (errors.length) {
  throw new Error(`Asset integrity preflight failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

console.log(`Asset manifest preflight passed: ${manifest.maps.length} maps, startMap=${manifest.startMap}.`);

await runNodeScript("game logic preloads", "scripts/smokeGameLogicPreloads.mjs");
await runNodeScript("game logic sound preloads", "scripts/smokeGameLogicSoundPreloads.mjs");

console.log("\nAsset integrity suite passed.");

async function readJsonFile(relativeUrl) {
  const normalized = relativeUrl.replace(/^\/+/, "");
  const fullPath = path.join(generatedRoot, normalized);
  try {
    return JSON.parse(await readFile(fullPath, "utf8"));
  } catch (error) {
    errors.push(`could not read ${relativeUrl}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function validateSceneUrl(sceneUrl, mapName) {
  const scene = await readJsonFile(sceneUrl);
  if (!scene) return;
  if (!Number.isFinite(scene.version)) errors.push(`${mapName} scene version must be finite`);
  if (!Array.isArray(scene.entities)) errors.push(`${mapName} scene must include entities`);
  if (!scene.entityManifest || typeof scene.entityManifest !== "object") {
    errors.push(`${mapName} scene must include entityManifest`);
  }
  if (!scene.gameLogic || typeof scene.gameLogic !== "object") {
    errors.push(`${mapName} scene must include gameLogic facts`);
  }
  if (!scene.collision || typeof scene.collision !== "object") {
    errors.push(`${mapName} scene must include collision data`);
  }
  if (!scene.renderBundle || typeof scene.renderBundle !== "object") {
    errors.push(`${mapName} scene must include a renderBundle`);
  }
}

async function validateMapEntry(mapEntry, mapNames) {
  if (!mapEntry || typeof mapEntry !== "object") {
    errors.push("manifest map entry must be an object");
    return;
  }
  const mapName = mapEntry.mapName;
  if (typeof mapName !== "string" || !mapName) {
    errors.push(`manifest map entry has invalid mapName ${JSON.stringify(mapName)}`);
    return;
  }
  if (mapNames.has(mapName)) errors.push(`manifest has duplicate map ${mapName}`);
  mapNames.add(mapName);
  if (typeof mapEntry.sceneUrl !== "string" || !mapEntry.sceneUrl.startsWith("/q/")) {
    errors.push(`${mapName} sceneUrl should start with /q/, got ${JSON.stringify(mapEntry.sceneUrl)}`);
  } else {
    await validateSceneUrl(mapEntry.sceneUrl, mapName);
  }
  if (!Array.isArray(mapEntry.modelPaths)) errors.push(`${mapName} modelPaths must be an array`);
  if (!Array.isArray(mapEntry.soundPaths)) errors.push(`${mapName} soundPaths must be an array`);
}
