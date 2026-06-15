import { readFileSync } from "node:fs";
import path from "node:path";

import { projectRoot, readAssetManifest } from "./checkAssetState.mjs";

export const generatedPublicRoot = path.join(projectRoot, "build/generated/public");

export function readGeneratedJson(relativeUrl) {
  const normalized = relativeUrl.replace(/^\/+/, "");
  return JSON.parse(readFileSync(path.join(generatedPublicRoot, normalized), "utf8"));
}

export function readPreparedScene(mapName) {
  return readGeneratedJson(`/q/${mapName}.json`);
}

export function readPreparedManifest() {
  const manifest = readAssetManifest();
  if (!manifest) throw new Error("missing build/generated/public/q/manifest.json");
  return manifest;
}

export function preparedEntity(preparedScene, entityIndex) {
  return preparedScene.entities?.find((entity) => entity.index === entityIndex) ?? null;
}

export function assertPreparedEntity(preparedScene, entityIndex, expectedClassname) {
  const entity = preparedEntity(preparedScene, entityIndex);
  if (entity?.classname !== expectedClassname) {
    throw new Error(`Expected prepared entity ${entityIndex} to be ${expectedClassname}, got ${entity?.classname}.`);
  }
  return entity;
}
