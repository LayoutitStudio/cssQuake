import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { deriveQuakeGameLogicSoundPreloads } from "../src/prepare/gameLogicPreloads.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const sceneDir = path.join(projectRoot, "build/generated/public/q");
const soundManifestPath = path.join(sceneDir, "sounds.json");
const assetManifestPath = path.join(sceneDir, "manifest.json");
const mapNames = ["start", "e1m1", "e1m2", "e1m3", "e1m4", "e1m5", "e1m6", "e1m7", "e1m8"];

const soundManifest = await readJson(soundManifestPath);
const assetManifest = await readJson(assetManifestPath);
const preparedSoundPaths = new Set(Object.keys(soundManifest.sounds ?? {}));
const reports = [];
const missing = [];

for (const mapName of mapNames) {
  const scene = await readJson(path.join(sceneDir, `${mapName}.json`));
  const manifestMap = quakeManifestMapEntry(assetManifest, mapName);
  if (!manifestMap) throw new Error(quakeManifestMapError(assetManifest, mapName, assetManifestPath));
  const allSounds = deriveQuakeGameLogicSoundPreloads(scene.gameLogic);
  const preparedSounds = deriveQuakeGameLogicSoundPreloads(scene.gameLogic, { preparedSoundPaths });
  const manifestSoundPaths = [...(manifestMap.soundPaths ?? [])].sort();
  const missingForMap = allSounds.soundPaths.filter((soundPath) => !preparedSoundPaths.has(soundPath));
  if (missingForMap.length) missing.push({ mapName, soundPaths: missingForMap });
  reports.push({
    mapName,
    allSoundPaths: allSounds.soundPaths,
    preparedSoundPaths: preparedSounds.soundPaths,
    manifestSoundPaths,
    entities: preparedSounds.entities,
  });
}

if (missing.length) {
  throw new Error(
    "Quake gameLogic sound preload smoke found missing prepared sounds:\n" +
      missing.map((entry) => `- ${entry.mapName}: ${entry.soundPaths.join(", ")}`).join("\n"),
  );
}

const e1m1 = reports.find((report) => report.mapName === "e1m1");
const checks = [
  [
    reports.every((report) => report.allSoundPaths.length > 0),
    "every shareware map should derive at least one source-backed sound dependency",
  ],
  [
    reports.every((report) => sameArray(report.allSoundPaths, report.preparedSoundPaths)),
    "derived gameLogic sound paths should all exist in the prepared sound manifest",
  ],
  [
    reports.every((report) => sameArray(report.preparedSoundPaths, report.manifestSoundPaths)),
    "gameLogic-derived sound preload paths should match per-map manifest soundPaths",
  ],
  [
    e1m1?.preparedSoundPaths.includes("soldier/death1.wav") &&
      e1m1.preparedSoundPaths.includes("dog/ddeath.wav") &&
      e1m1.preparedSoundPaths.includes("items/health1.wav") &&
      e1m1.preparedSoundPaths.includes("misc/secret.wav"),
    "E1M1 sound preloads should include representative monster, pickup, and trigger sounds",
  ],
  [
    e1m1?.entities.some((entry) =>
      entry.classname === "monster_army" &&
      entry.soundPaths.includes("soldier/death1.wav")
    ),
    "E1M1 sound preload entities should retain per-entity monster sound ownership",
  ],
];

for (const [passed, message] of checks) {
  if (!passed) throw new Error(message);
}

const totalSounds = new Set(reports.flatMap((report) => report.preparedSoundPaths));
const totalEntities = reports.reduce((sum, report) => sum + report.entities.length, 0);
console.log(
  `Quake gameLogic sound preload check passed: ${reports.length} maps, ` +
    `${totalSounds.size} unique sounds, ${totalEntities} entity sound sets.`,
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

function sameArray(a, b) {
  return Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((item, index) => item === b[index]);
}

function quakeManifestMapEntry(manifest, mapName) {
  return manifest.maps?.find((map) => map && typeof map === "object" && map.mapName === mapName) ?? null;
}

function quakeManifestMapError(manifest, mapName, manifestPath) {
  const relativeManifestPath = path.relative(projectRoot, manifestPath);
  if (manifest?.status === "regenerating") {
    return `${relativeManifestPath} is regenerating and does not contain per-map sound paths yet. ` +
      "Wait for pnpm prepare:quake to finish before running this check.";
  }
  if (manifest.maps?.some((map) => typeof map === "string")) {
    return `${relativeManifestPath} contains map-name-only entries, not per-map manifest objects with soundPaths. ` +
      "Run pnpm prepare:quake to refresh the full asset manifest.";
  }
  return `Manifest does not include map ${mapName}.`;
}
