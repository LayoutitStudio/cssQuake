import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const generatedFactsJsonPath = path.join(projectRoot, "src/generated/quakeProgramFacts.json");
const generatedFactsPath = path.join(projectRoot, "src/generated/quakeProgramFacts.ts");

const { outputFiles } = await build({
  bundle: true,
  entryPoints: [generatedFactsPath],
  format: "esm",
  logLevel: "silent",
  platform: "node",
  write: false,
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`;
const { QUAKE_PROGRAM_FACTS } = await import(moduleUrl);
const entities = QUAKE_PROGRAM_FACTS.entities;
const jsonFacts = JSON.parse(await readFile(generatedFactsJsonPath, "utf8"));
const jsonEntities = jsonFacts.entities;

const checks = [
  [
    entities.monster_army?.dependencies.models.some((dep) => dep.path === "progs/soldier.mdl"),
    "monster_army should include progs/soldier.mdl",
  ],
  [
    entities.item_health?.spawnflagChecks.some((flag) => flag.name === "H_ROTTEN" && flag.value === 1),
    "item_health should include H_ROTTEN=1",
  ],
  [
    entities.item_health?.spawnflagChecks.some((flag) => flag.name === "H_MEGA" && flag.value === 2),
    "item_health should include H_MEGA=2",
  ],
  [
    entities.func_plat?.defaultAssignments.some((assignment) => assignment.field === "speed" && assignment.value === 150),
    "func_plat should default speed to 150",
  ],
  [
    entities.func_plat?.callbacks.blocked === "plat_crush",
    "func_plat should expose plat_crush blocked callback",
  ],
  [
    entities.func_plat?.dependencies.sounds.some((dep) => dep.path === "plats/medplat1.wav"),
    "func_plat should include medium platform sound dependencies",
  ],
  [
    !entities.func_plat?.fieldAssignments.some((assignment) => assignment.expression.includes("= 0)") || assignment.expression.includes("= 1)")),
    "func_plat field assignments should not parse equality checks as assignments",
  ],
  [
    entities.func_door?.defaultAssignments.some((assignment) => assignment.field === "wait" && assignment.value === 3),
    "func_door should default wait to 3",
  ],
  [
    entities.trigger_multiple?.defaultAssignments.some((assignment) => assignment.field === "wait" && assignment.value === 0.2),
    "trigger_multiple should default wait to 0.2",
  ],
  [
    jsonEntities.monster_army?.dependencies.models.some((dep) => dep.path === "progs/soldier.mdl"),
    "JSON facts should include monster_army progs/soldier.mdl",
  ],
  [
    jsonEntities.func_plat?.defaultAssignments.some((assignment) => assignment.field === "speed" && assignment.value === 150),
    "JSON facts should include func_plat speed default",
  ],
  [
    JSON.stringify(jsonFacts.source) === JSON.stringify(QUAKE_PROGRAM_FACTS.source),
    "JSON and TS facts should use the same source metadata",
  ],
];

for (const [passed, message] of checks) {
  if (!passed) throw new Error(message);
}

console.log(`Quake program facts smoke passed: ${checks.length} checks.`);
