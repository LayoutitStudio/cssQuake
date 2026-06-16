#!/usr/bin/env node
import { assertAssetState } from "./checkAssetState.mjs";
import {
  readGeneratedJson,
  readPreparedManifest,
} from "./preparedAssets.mjs";

console.log("Asset integrity gate");
console.log("validates: prepared manifest, scene URLs, renderBundle, gameLogic, collision, and preload path arrays");
console.log("requires prepared assets: yes");
console.log("classification: acceptance");

const state = assertAssetState({ requireRenderBundle: false });
const manifest = readPreparedManifest();
const errors = [];

if (!Number.isFinite(manifest.version)) errors.push("manifest version must be finite");
if (typeof manifest.assetRoot !== "string" || !manifest.assetRoot.startsWith("/q")) {
  errors.push(`manifest assetRoot should start with /q, got ${JSON.stringify(manifest.assetRoot)}`);
}

const mapNames = new Set();
for (const mapEntry of Array.isArray(manifest.maps) ? manifest.maps : []) {
  validateMapEntry(mapEntry, mapNames);
}
if (typeof manifest.startMap !== "string" || !mapNames.has(manifest.startMap)) {
  errors.push(`manifest startMap ${JSON.stringify(manifest.startMap)} must exist in maps`);
}

if (errors.length) {
  throw new Error(`Asset integrity failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

console.log(`Asset integrity passed: ${state.mapCount} maps, startMap=${manifest.startMap}.`);

function readJsonFile(relativeUrl) {
  try {
    return readGeneratedJson(relativeUrl);
  } catch (error) {
    errors.push(`could not read ${relativeUrl}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function validateSceneUrl(sceneUrl, mapName) {
  const scene = readJsonFile(sceneUrl);
  if (!scene) return;
  if (!Number.isFinite(scene.version)) errors.push(`${mapName} scene version must be finite`);
  if (!Array.isArray(scene.entities)) errors.push(`${mapName} scene must include entities`);
  if (!scene.entityManifest || typeof scene.entityManifest !== "object") errors.push(`${mapName} scene must include entityManifest`);
  if (!scene.gameLogic || typeof scene.gameLogic !== "object") errors.push(`${mapName} scene must include gameLogic facts`);
  if (!scene.collision || typeof scene.collision !== "object") errors.push(`${mapName} scene must include collision data`);
  if (!scene.renderBundle || typeof scene.renderBundle !== "object") errors.push(`${mapName} scene must include a renderBundle`);
}

function validateMapEntry(mapEntry, mapNames) {
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
    validateSceneUrl(mapEntry.sceneUrl, mapName);
  }
  if (!Array.isArray(mapEntry.modelPaths)) errors.push(`${mapName} modelPaths must be an array`);
  if (mapEntry.soundPaths !== undefined && !Array.isArray(mapEntry.soundPaths)) {
    errors.push(`${mapName} soundPaths must be an array when present`);
  }
}
