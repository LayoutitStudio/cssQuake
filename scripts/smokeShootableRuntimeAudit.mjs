import { Buffer } from "node:buffer";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const runtimeShootablesPath = path.join(projectRoot, "src/runtime/shootables.ts");

const {
  createQuakeShootablesController,
  quakeMonsterCanAcquirePlayer,
  quakeShootableModelPath,
} = await importBundledModule(runtimeShootablesPath);

const monster = {
  index: 246,
  classname: "monster_army",
  origin: { x: 8, y: 1520, z: -200 },
  properties: { classname: "monster_army", origin: "8 1520 -200" },
};
const explobox = {
  index: 21,
  classname: "misc_explobox",
  origin: { x: 616, y: 72, z: 40 },
  properties: { classname: "misc_explobox", origin: "616 72 40" },
};
const soldierModel = {
  source: "progs/soldier.mdl",
  bounds: {
    min: [-0.4, -0.4, 0],
    max: [0.4, 0.4, 1.2],
  },
};

const checks = [
  [
    quakeShootableModelPath(monster, null) === "progs/soldier.mdl",
    "monster_army should resolve the expected real model path",
  ],
];

const missingMonsterModel = captureSpawn(() => createController().spawn([monster], { models: {} }, null));
checks.push([
  quakeMonsterCanAcquirePlayer(false) === true && quakeMonsterCanAcquirePlayer(true) === false,
  "Ring of Shadows should block new monster target acquisition while active",
]);

checks.push([
  missingMonsterModel.threw &&
    missingMonsterModel.message.includes("progs/soldier.mdl") &&
    missingMonsterModel.message.includes("not a procedural fallback"),
  `missing monster model should throw a strict preload/asset error, got ${JSON.stringify(missingMonsterModel)}`,
]);

const availableMonsterModel = captureSpawn(() =>
  createController().spawn([monster], { models: { "progs/soldier.mdl": soldierModel } }, null)
);
checks.push([
  !availableMonsterModel.threw,
  `available monster model should spawn without strict fallback error, got ${JSON.stringify(availableMonsterModel)}`,
]);

const fallbackShootable = createController();
const fallbackResult = captureSpawn(() => fallbackShootable.spawn([explobox], { models: {} }, null));
checks.push([
  !fallbackResult.threw && fallbackShootable.has(explobox.index),
  `non-monster shootable fallback should remain available, got ${JSON.stringify(fallbackResult)}`,
]);

for (const [passed, message] of checks) {
  if (!passed) throw new Error(message);
}

console.log(`Shootable runtime audit smoke passed: ${checks.length} checks.`);

function captureSpawn(callback) {
  try {
    callback();
    return { threw: false, message: "" };
  } catch (error) {
    return { threw: true, message: String(error?.message ?? error) };
  }
}

function createController() {
  return createQuakeShootablesController({
    addMesh: () => null,
    createMonsterStateRunner: () => null,
    damagePlayer: () => false,
    fireTarget: () => undefined,
    floorAt: () => null,
    getPlayerEyeHeight: () => 1,
    getPlayerForward: () => [0, 1, 0],
    getPlayerOrigin: () => [0, 0, 0],
    hasLineOfSight: () => false,
    isInPlayerView: () => true,
    leafIndexAt: () => undefined,
    monsterRuntimeEnabled: () => false,
    pixelate: () => undefined,
    pointToPoly: (point) => [point.x, point.y, point.z],
    schedulePresentationResync: () => undefined,
    shouldSpawn: () => true,
    visibleLeavesAt: () => null,
  });
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
