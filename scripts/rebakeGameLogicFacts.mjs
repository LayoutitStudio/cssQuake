import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import {
  deriveQuakeGameLogicModelPreloads,
  deriveQuakeGameLogicSoundPreloads,
} from "../src/prepare/gameLogicPreloads.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const sceneDir = path.join(projectRoot, "build/generated/public/q");
const manifestPath = path.join(sceneDir, "manifest.json");
const pickupModelsPath = path.join(sceneDir, "pickups.json");
const soundManifestPath = path.join(sceneDir, "sounds.json");
const programFactsPath = path.join(projectRoot, "src/generated/quakeProgramFacts.json");
const gameLogicFactsPath = path.join(projectRoot, "src/prepare/gameLogicFacts.ts");
const quakePublicPath = "/q";
const quakeStartMap = "e1m1";
const quakeMapTitles = new Map([
  ["start", "Introduction"],
  ["e1m1", "the Slipgate Complex"],
  ["e1m2", "Castle of the Damned"],
  ["e1m3", "the Necropolis"],
  ["e1m4", "the Grisly Grotto"],
  ["e1m5", "Gloom Keep"],
  ["e1m6", "The Door To Chthon"],
  ["e1m7", "The House of Chthon"],
  ["e1m8", "Ziggurat Vertigo"],
]);

const requestedMaps = new Set(process.argv.slice(2).map((value) => value.trim().toLowerCase()).filter(Boolean));
const programFacts = JSON.parse(await readFile(programFactsPath, "utf8"));
const pickupModels = await readJsonIfPresent(pickupModelsPath);
const soundManifest = await readJsonIfPresent(soundManifestPath);
const { buildQuakeGameLogicFacts } = await importBundledModule(gameLogicFactsPath);

const sceneFiles = await selectedSceneFiles();
const rebakedScenes = new Map();
let updatedScenes = 0;

for (const filePath of sceneFiles) {
  const scene = JSON.parse(await readFile(filePath, "utf8"));
  const nextGameLogic = buildQuakeGameLogicFacts({
    label: scene.label,
    entities: scene.entities ?? [],
    entityManifest: scene.entityManifest,
    models: scene.collision?.models ?? scene.models ?? [],
    collision: scene.collision,
    programFacts,
  });
  const before = JSON.stringify(scene.gameLogic ?? null);
  const after = JSON.stringify(nextGameLogic);
  scene.gameLogic = nextGameLogic;
  if (before !== after) {
    await writeFile(filePath, JSON.stringify(scene));
    updatedScenes++;
  }
  rebakedScenes.set(mapNameFromSceneFile(filePath), scene);
}

const updatedManifest = await updateManifest(rebakedScenes);
console.log(
  `Rebaked gameLogic facts for ${sceneFiles.length} map${sceneFiles.length === 1 ? "" : "s"} ` +
    `(${updatedScenes} scene${updatedScenes === 1 ? "" : "s"} changed, ` +
    `${updatedManifest ? "manifest updated" : "manifest unchanged"}).`,
);

async function selectedSceneFiles() {
  const names = (await readdir(sceneDir))
    .filter((name) => name.endsWith(".json"))
    .filter((name) => !["manifest.json", "pickups.json", "progs.json", "sounds.json", "weapon.json"].includes(name))
    .filter((name) => requestedMaps.size === 0 || requestedMaps.has(path.basename(name, ".json")))
    .sort();
  const files = [];
  for (const name of names) {
    const filePath = path.join(sceneDir, name);
    const scene = JSON.parse(await readFile(filePath, "utf8"));
    if (!scene?.entityManifest?.entries || !Array.isArray(scene.entities)) continue;
    files.push(filePath);
  }
  if (requestedMaps.size > 0 && files.length === 0) {
    throw new Error(`No prepared scene JSON matched: ${[...requestedMaps].join(", ")}`);
  }
  return files;
}

async function updateManifest(rebakedScenes) {
  const manifest = await readJsonIfPresent(manifestPath);
  const preparedModelPaths = new Set(Object.keys(pickupModels?.models ?? {}));
  const preparedSoundPaths = new Set(Object.keys(soundManifest?.sounds ?? {}));
  if (shouldRebuildManifest(manifest)) {
    await writeFile(manifestPath, JSON.stringify(buildManifestFromScenes(rebakedScenes, {
      assetRoot: manifest?.assetRoot,
      preparedModelPaths,
      preparedSoundPaths,
    })));
    return true;
  }
  if (!manifest?.maps?.length) return false;
  const before = JSON.stringify(manifest);
  manifest.maps = manifest.maps.map((entry) => {
    const mapName = entry.mapName ?? path.basename(entry.sceneUrl ?? "", ".json");
    const scene = rebakedScenes.get(mapName);
    if (!scene?.gameLogic) return entry;
    const modelPaths = deriveQuakeGameLogicModelPreloads(scene.gameLogic, {
      preparedModelPaths,
    }).modelPaths;
    const soundPaths = deriveQuakeGameLogicSoundPreloads(scene.gameLogic, {
      preparedSoundPaths,
    }).soundPaths;
    const next = {
      ...entry,
      modelPaths,
    };
    if (soundPaths.length) next.soundPaths = soundPaths;
    else delete next.soundPaths;
    return next;
  });
  const after = JSON.stringify(manifest);
  if (before === after) return false;
  await writeFile(manifestPath, after);
  return true;
}

function shouldRebuildManifest(manifest) {
  return !manifest ||
    manifest.status === "regenerating" ||
    !Array.isArray(manifest.maps) ||
    manifest.maps.some((entry) => typeof entry === "string") ||
    !manifest.assets;
}

function buildManifestFromScenes(rebakedScenes, {
  assetRoot = quakePublicPath,
  preparedModelPaths,
  preparedSoundPaths,
}) {
  const maps = [...rebakedScenes.entries()].map(([mapName, scene]) => {
    const modelPaths = deriveQuakeGameLogicModelPreloads(scene.gameLogic, {
      preparedModelPaths,
    }).modelPaths;
    const soundPaths = deriveQuakeGameLogicSoundPreloads(scene.gameLogic, {
      preparedSoundPaths,
    }).soundPaths;
    return {
      mapName,
      title: quakeMapTitles.get(mapName) ?? mapName.toUpperCase(),
      pakPath: `maps/${mapName}.bsp`,
      sceneUrl: `${assetRoot}/${mapName}.json`,
      selectable: mapName !== "start",
      modelPaths,
      ...(soundPaths.length ? { soundPaths } : {}),
    };
  });
  const mapNames = new Set(maps.map((entry) => entry.mapName));
  return {
    version: 1,
    assetRoot,
    startMap: mapNames.has(quakeStartMap) ? quakeStartMap : maps[0]?.mapName ?? quakeStartMap,
    maps,
    assets: {
      weaponModelUrl: `${assetRoot}/weapon.json`,
      pickupModelsUrl: `${assetRoot}/pickups.json`,
      programMetadataUrl: `${assetRoot}/progs.json`,
      soundManifestUrl: `${assetRoot}/sounds.json`,
    },
  };
}

function mapNameFromSceneFile(filePath) {
  return path.basename(filePath, ".json").toLowerCase();
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function importBundledModule(entryPoint) {
  const result = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    entryPoints: [entryPoint],
    format: "esm",
    packages: "external",
    platform: "node",
    write: false,
  });
  const code = result.outputFiles[0].text;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  return import(dataUrl);
}
