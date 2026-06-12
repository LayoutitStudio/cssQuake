import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { deriveQuakeGameLogicModelPreloads } from "../src/prepare/gameLogicPreloads.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const sceneDir = path.join(projectRoot, "build/generated/public/q");
const requestedScenePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const manifestPath = process.argv[3] ?? path.join(sceneDir, "manifest.json");
const pickupModelsPath = process.argv[4] ?? path.join(sceneDir, "pickups.json");
const programMetadataPath = process.argv[5] ?? path.join(sceneDir, "progs.json");
const generatedFactsPath = path.join(projectRoot, "src/generated/quakeProgramFacts.ts");
const runtimeShootablesPath = path.join(projectRoot, "src/runtime/shootables.ts");
const multiplayerRuntimeModelPaths = ["progs/h_player.mdl", "progs/player.mdl"];

const manifest = await readJson(manifestPath);
const pickupModels = await readJson(pickupModelsPath);
const programMetadata = await readJson(programMetadataPath);
const { QUAKE_PROGRAM_FACTS } = await importBundledModule(generatedFactsPath);
const { quakeShootableModelPath } = await importBundledModule(runtimeShootablesPath);
const callbackAssetPreloadProbe = deriveQuakeGameLogicModelPreloads({
  programFacts: QUAKE_PROGRAM_FACTS,
  entities: [
    { entityIndex: 9001, classname: "monster_dog" },
    { entityIndex: 9002, classname: "monster_army" },
  ],
});

const mapNames = requestedScenePath
  ? [path.basename(requestedScenePath, ".json")]
  : quakeManifestMapNames(manifest, manifestPath);
const reports = [];
const runtimeShootableResolverChecks = [];
const checks = [];

for (const mapName of mapNames) {
  const scenePath = requestedScenePath ?? path.join(sceneDir, `${mapName}.json`);
  const scene = await readJson(scenePath);
  const manifestMap = quakeManifestMapEntry(manifest, mapName);
  if (!manifestMap) throw new Error(quakeManifestMapError(manifest, mapName, manifestPath));

  const derived = deriveQuakeGameLogicModelPreloads(scene.gameLogic, {
    preparedModelPaths: Object.keys(pickupModels.models ?? {}),
  });
  const manifestModelPaths = [...(manifestMap.modelPaths ?? [])].sort();
  const manifestGameLogicModelPaths = manifestModelPaths
    .filter((modelPath) => !multiplayerRuntimeModelPaths.includes(modelPath))
    .sort();
  const manifestModelPathSet = new Set(manifestModelPaths);
  const sceneEntityByIndex = new Map((scene.entities ?? []).map((entity) => [entity.index, entity]));
  const logicEntityByIndex = new Map((scene.gameLogic?.entities ?? []).map((entity) => [entity.entityIndex, entity]));
  const derivedEntityByIndex = new Map(derived.entities.map((entity) => [entity.entityIndex, entity]));
  const shootableIndexes = scene.entityManifest?.runtime?.shootableEntityIndexes ?? [];

  checks.push([
    sameArray(derived.modelPaths, manifestGameLogicModelPaths),
    `${mapName} gameLogic-derived preload model paths should match manifest gameLogic model paths.\n` +
      `Derived: ${derived.modelPaths.join(", ")}\nManifest gameLogic: ${manifestGameLogicModelPaths.join(", ")}`,
  ]);
  checks.push([
    multiplayerRuntimeModelPaths.every((modelPath) => manifestModelPathSet.has(modelPath)),
    `${mapName} manifest should include multiplayer runtime player model preloads: ${multiplayerRuntimeModelPaths.join(", ")}`,
  ]);

  for (const entityIndex of shootableIndexes) {
    const entity = sceneEntityByIndex.get(entityIndex);
    const logicEntity = logicEntityByIndex.get(entityIndex);
    if (!entity || !logicEntity?.modeMask?.includes("singleplayer:normal")) continue;
    const runtimeModelPath = quakeShootableModelPath(entity, programMetadata);
    if (!runtimeModelPath) continue;
    runtimeShootableResolverChecks.push({
      mapName,
      entityIndex,
      classname: entity.classname,
      runtimeModelPath,
      derivedModelPaths: derivedEntityByIndex.get(entityIndex)?.modelPaths ?? [],
      inManifest: manifestModelPathSet.has(runtimeModelPath),
    });
  }

  reports.push({
    mapName,
    derived,
    sceneEntityByIndex,
  });
}

const e1m1 = reports.find((report) => report.mapName === "e1m1");
const postLiftRuntimeResolverChecks = runtimeShootableResolverChecks.filter((entry) =>
  entry.mapName === "e1m1" && (entry.entityIndex === 246 || entry.entityIndex === 247)
);

if (!requestedScenePath) {
  checks.push([
    Boolean(e1m1),
    "default gameLogic preload check should include E1M1 representative coverage",
  ]);
}

if (e1m1) {
  checks.push(
    [
      e1m1.derived.entities.some((entry) =>
        entry.entityIndex === 247 &&
        entry.classname === "monster_dog" &&
        entry.modelPaths.includes("progs/dog.mdl")
      ),
      "gameLogic-derived preloads should include E1M1 monster_dog entity 247",
    ],
    [
      e1m1.derived.entities.some((entry) =>
        entry.entityIndex === 246 &&
        entry.classname === "monster_army" &&
        entry.modelPaths.includes("progs/soldier.mdl")
      ),
      "gameLogic-derived preloads should include E1M1 monster_army entity 246",
    ],
    [
      e1m1.derived.entities.some((entry) =>
        entry.classname === "item_health" &&
        entry.modelPaths.includes("maps/b_bh100.bsp")
      ),
      "gameLogic-derived preloads should include megahealth BSP model when present",
    ],
    [
      e1m1.derived.entities.every((entry) =>
        e1m1.sceneEntityByIndex.get(entry.entityIndex)?.classname === entry.classname
      ),
      "gameLogic-derived preload entries should match current scene entity indexes/classnames",
    ],
    [
      postLiftRuntimeResolverChecks.length === 2 &&
        postLiftRuntimeResolverChecks.every((entry) =>
          entry.derivedModelPaths.includes(entry.runtimeModelPath) && entry.inManifest
        ),
      `runtime shootable resolver should agree with gameLogic preloads and manifest for post-lift monsters: ${JSON.stringify(postLiftRuntimeResolverChecks)}`,
    ],
  );
}

checks.push(
  [
    callbackAssetPreloadProbe.entities.some((entry) =>
      entry.entityIndex === 9001 &&
      entry.modelPaths.includes("progs/dog.mdl") &&
      entry.modelPaths.includes("progs/h_dog.mdl") &&
      entry.modelPaths.includes("progs/gib3.mdl")
    ) &&
      callbackAssetPreloadProbe.entities.some((entry) =>
        entry.entityIndex === 9002 &&
        entry.modelPaths.includes("progs/soldier.mdl") &&
        entry.modelPaths.includes("progs/backpack.mdl") &&
        entry.modelPaths.includes("progs/h_guard.mdl") &&
        entry.modelPaths.includes("progs/gib1.mdl")
      ),
    `source-backed callback model preloads should include monster death output models and backpack drops: ${
      JSON.stringify(callbackAssetPreloadProbe.entities)
    }`,
  ],
  [
    runtimeShootableResolverChecks.length > 0 &&
      runtimeShootableResolverChecks.every((entry) =>
        entry.derivedModelPaths.includes(entry.runtimeModelPath) && entry.inManifest
      ),
    `runtime shootable resolver should agree with gameLogic preloads and manifest for normal-skill shootables: ${JSON.stringify(runtimeShootableResolverChecks)}`,
  ],
  [
    reports.every((report) => report.derived.modelPaths.length > 0),
    "each checked map should derive at least one gameLogic model preload path",
  ],
);

for (const [passed, message] of checks) {
  if (!passed) throw new Error(message);
}

const totalModelPaths = new Set(reports.flatMap((report) => report.derived.modelPaths));
console.log(
  `Quake gameLogic preload check passed: ${checks.length} checks, ` +
    `${reports.length} maps, ${totalModelPaths.size} model paths, ` +
    `${runtimeShootableResolverChecks.length} runtime shootables.`,
);

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing ${path.relative(projectRoot, filePath)}. Run pnpm prepare:quake first.`);
    }
    throw error;
  }
}

async function importBundledModule(entryPath) {
  const { outputFiles } = await build({
    bundle: true,
    entryPoints: [entryPath],
    format: "esm",
    logLevel: "silent",
    platform: "node",
    write: false,
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`;
  return import(moduleUrl);
}

function quakeManifestMapEntry(manifest, mapName) {
  return manifest.maps?.find((map) => map && typeof map === "object" && map.mapName === mapName) ?? null;
}

function quakeManifestMapNames(manifest, manifestPath) {
  const relativeManifestPath = path.relative(projectRoot, manifestPath);
  if (manifest?.status === "regenerating") {
    throw new Error(
      `${relativeManifestPath} is regenerating and does not contain per-map model paths yet. ` +
        "Wait for pnpm prepare:quake to finish before running this check.",
    );
  }
  if (!Array.isArray(manifest.maps) || !manifest.maps.length) {
    throw new Error(`${relativeManifestPath} does not contain map entries.`);
  }
  if (manifest.maps.some((map) => typeof map === "string")) {
    throw new Error(
      `${relativeManifestPath} contains map-name-only entries, not per-map manifest objects with modelPaths. ` +
        "Run pnpm prepare:quake to refresh the full asset manifest.",
    );
  }
  const mapNames = manifest.maps
    .map((map) => typeof map?.mapName === "string" ? map.mapName : "")
    .filter(Boolean);
  if (!mapNames.length) throw new Error(`${relativeManifestPath} does not contain named map entries.`);
  return mapNames;
}

function quakeManifestMapError(manifest, mapName, manifestPath) {
  const relativeManifestPath = path.relative(projectRoot, manifestPath);
  if (manifest?.status === "regenerating") {
    return `${relativeManifestPath} is regenerating and does not contain per-map model paths yet. ` +
      "Wait for pnpm prepare:quake to finish before running this check.";
  }
  if (manifest.maps?.some((map) => typeof map === "string")) {
    return `${relativeManifestPath} contains map-name-only entries, not per-map manifest objects with modelPaths. ` +
      "Run pnpm prepare:quake to refresh the full asset manifest.";
  }
  return `Manifest does not include map ${mapName}.`;
}

function sameArray(a, b) {
  return Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((item, index) => item === b[index]);
}
