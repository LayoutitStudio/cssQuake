import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const auditPath = path.join(projectRoot, "src/runtime/triggerRuntimeAudit.ts");
const sceneDir = path.join(projectRoot, "build/generated/public/q");
const mapNames = ["start", "e1m1", "e1m2", "e1m3", "e1m4", "e1m5", "e1m6", "e1m7", "e1m8"];

const { auditQuakeTriggerRuntimeFacts } = await importBundledModule(auditPath);
const reports = [];

for (const mapName of mapNames) {
  const scene = await readScene(path.join(sceneDir, `${mapName}.json`));
  reports.push(auditQuakeTriggerRuntimeFacts({
    mapLabel: mapName,
    entities: scene.entities ?? [],
    runtime: scene.entityManifest?.runtime,
    gameLogic: scene.gameLogic,
  }));
}

const errors = reports.flatMap((report) =>
  report.findings
    .filter((finding) => finding.severity === "error")
    .map((finding) => ({ mapLabel: report.mapLabel, ...finding })),
);

if (errors.length) {
  throw new Error(`Trigger runtime audit failed:\n${errors.map(formatFinding).join("\n")}`);
}

const warnings = reports.flatMap((report) =>
  report.findings
    .filter((finding) => finding.severity === "warning")
    .map((finding) => ({ mapLabel: report.mapLabel, ...finding })),
);

if (warnings.length) {
  throw new Error(`Trigger runtime audit warnings:\n${warnings.map(formatFinding).join("\n")}`);
}

const totalCoverage = reports.reduce((acc, report) => {
  for (const [key, value] of Object.entries(report.coverage)) {
    acc[key] = (acc[key] ?? 0) + value;
  }
  return acc;
}, {});

const infoCounts = findingCounts(reports, "info");

const checks = [
  [
    totalCoverage.checkedTriggers > 80,
    `trigger runtime audit should cover shareware trigger facts, found ${totalCoverage.checkedTriggers}`,
  ],
  [
    totalCoverage.callbackConsumptionChecks > 0,
    "trigger runtime audit should check active QuakeC trigger callback consumption",
  ],
  [
    totalCoverage.controllerTouchChecks > 0,
    "trigger runtime audit should exercise controller touch paths",
  ],
  [
    totalCoverage.triggerWaitChecks > 0,
    "trigger runtime audit should exercise prebaked trigger wait formulas",
  ],
  [
    totalCoverage.counterChecks > 0,
    "trigger runtime audit should exercise trigger_counter use paths",
  ],
  [
    totalCoverage.teleporterChecks > 0,
    "trigger runtime audit should exercise trigger_teleport touch/use paths",
  ],
  [
    totalCoverage.teleporterGateChecks > 0,
    "trigger runtime audit should exercise named trigger_teleport touch gating",
  ],
  [
    totalCoverage.oneShotDisableChecks > 0,
    "trigger runtime audit should exercise one-shot trigger disable behavior",
  ],
  [
    totalCoverage.repeatCooldownChecks > 0,
    "trigger runtime audit should exercise trigger_multiple cooldown behavior",
  ],
  [
    totalCoverage.changelevelChecks > 0,
    "trigger runtime audit should exercise trigger_changelevel completion behavior",
  ],
  [
    totalCoverage.targetUseChecks > 0,
    "trigger runtime audit should compare target graph facts",
  ],
  [
    totalCoverage.targetMonsterUseChecks > 0,
    "trigger runtime audit should find trigger target facts that mention monsters",
  ],
  [
    totalCoverage.targetMonsterActivationChecks > 0,
    "trigger runtime audit should prove runtime dispatch activates targeted monsters",
  ],
  [
    totalCoverage.targetMonsterActivationChecks +
      totalCoverage.targetMonsterKilltargetFilteredChecks +
      totalCoverage.targetMonsterSelfFilteredChecks === totalCoverage.targetMonsterUseChecks,
    `trigger runtime audit should explain every monster target, got ${
      JSON.stringify({
        facts: totalCoverage.targetMonsterUseChecks,
        activated: totalCoverage.targetMonsterActivationChecks,
        killtargetFiltered: totalCoverage.targetMonsterKilltargetFilteredChecks,
        selfFiltered: totalCoverage.targetMonsterSelfFilteredChecks,
      })
    }`,
  ],
  [
    (infoCounts["monsterjump-player-touch-not-consumed"] ?? 0) > 0,
    "trigger runtime audit should mark trigger_monsterjump as monster-runtime consumed and player-dispatch ignored",
  ],
];

for (const [passed, message] of checks) {
  if (!passed) throw new Error(message);
}

console.log(
  `Trigger runtime audit smoke passed: ${reports.length} maps, ` +
    `${totalCoverage.checkedTriggers} triggers, ` +
    `${totalCoverage.callbackConsumptionChecks} callback checks, ` +
    `${totalCoverage.controllerTouchChecks} touch checks, ` +
    `${totalCoverage.triggerWaitChecks} wait checks, ` +
    `${totalCoverage.useChecks} use checks, ` +
    `${totalCoverage.oneShotDisableChecks} one-shot disable checks, ` +
    `${totalCoverage.repeatCooldownChecks} repeat cooldown checks, ` +
    `${totalCoverage.targetMonsterUseChecks} monster target facts, ` +
    `${totalCoverage.targetMonsterActivationChecks} monster target activations, ` +
    `${totalCoverage.targetMonsterImmediateActivationChecks} immediate monster activations, ` +
    `${totalCoverage.targetMonsterDelayedActivationChecks} delayed monster activations, ` +
    `${totalCoverage.teleporterGateChecks} teleporter gate checks, ` +
    `${totalCoverage.changelevelChecks} changelevel checks, ` +
    `${Object.values(infoCounts).reduce((sum, count) => sum + count, 0)} info notes.`,
);

async function readScene(filePath) {
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

function findingCounts(reports, severity) {
  const out = {};
  for (const report of reports) {
    for (const finding of report.findings) {
      if (finding.severity !== severity) continue;
      out[finding.code] = (out[finding.code] ?? 0) + 1;
    }
  }
  return out;
}

function formatFinding(finding) {
  const place = `${finding.mapLabel}:${finding.classname ?? "unknown"}#${finding.entityIndex ?? "?"}`;
  const expected = finding.expected === undefined ? "" : ` expected=${JSON.stringify(finding.expected)}`;
  const actual = finding.actual === undefined ? "" : ` actual=${JSON.stringify(finding.actual)}`;
  return `- ${place} ${finding.code}: ${finding.message}${expected}${actual}`;
}
