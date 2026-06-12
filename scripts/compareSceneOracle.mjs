#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_SCENARIO = "notes/oracle-scenarios/e1m1-soldier-targetability.json";
const DEFAULT_VKQUAKE = "bench/results/quake/oracle/e1m1-soldier-targetability.vkquake.json";
const DEFAULT_CSSQUAKE = "bench/results/quake/logical-targetability-smoke-summary.json";
const DEFAULT_OUT = "bench/results/quake/oracle/e1m1-soldier-targetability.compare.json";
const DEFAULT_MARKDOWN_OUT = "bench/results/quake/oracle/e1m1-soldier-targetability.md";

const argv = process.argv.slice(2);

function flag(name) {
  return argv.includes(`--${name}`);
}

function option(name, fallback = "") {
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--")) return argv[index + 1];
  const prefixed = argv.find((arg) => arg.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : fallback;
}

function printHelp() {
  console.log(`Usage:
  node scripts/compareSceneOracle.mjs [options]

Options:
  --scenario <file>      Scenario JSON. Default: ${DEFAULT_SCENARIO}
  --vkquake <file>       vkQuake oracle JSON. Default: ${DEFAULT_VKQUAKE}
  --cssquake <file>      cssQuake browser artifact. Default: ${DEFAULT_CSSQUAKE}
  --out <file>           Compare JSON. Default: ${DEFAULT_OUT}
  --markdown-out <file>  Markdown report. Default: ${DEFAULT_MARKDOWN_OUT}
  --no-markdown          Do not write the Markdown report.`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeText(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, value);
}

function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function vecEquals(a, b) {
  return Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, index) => value === b[index]);
}

function getSourceDamageEvent(vkquake) {
  return vkquake.events?.find((event) => event.type === "T_Damage") ?? null;
}

function getCssBudget(cssquake, phase) {
  return cssquake.result?.[phase] ?? null;
}

function compareArtifacts({ scenario, vkquake, cssquake, scenarioPath, vkquakePath, cssquakePath }) {
  const failures = [];
  const warnings = [];
  const matches = [];
  const acceptableDivergences = [];
  const sourceEvent = getSourceDamageEvent(vkquake);
  const cssResult = cssquake.result ?? {};
  const cssReference = cssResult.sourceReference ?? {};
  const beforeBudget = getCssBudget(cssquake, "before");
  const afterBudget = getCssBudget(cssquake, "after");
  const limits = afterBudget?.limits ?? beforeBudget?.limits ?? {};
  const action = scenario.actions?.[0] ?? {};
  const edit = scenario.edits?.[0] ?? {};

  if (scenario.id !== vkquake.scenarioId) {
    failures.push(`scenario id mismatch: ${scenario.id} vs ${vkquake.scenarioId}`);
  } else {
    matches.push("scenario id matches");
  }
  if (vkquake.status !== "pass" || vkquake.setup?.status !== "valid") {
    failures.push(`vkQuake setup is not valid: ${vkquake.setup?.failures?.join("; ") || vkquake.status}`);
  } else {
    matches.push("vkQuake setup is valid");
  }
  if (!vkquake.engineRevision) failures.push("vkQuake artifact is missing engineRevision");
  if (!vkquake.patchId) failures.push("vkQuake artifact is missing patchId");
  if (!Number.isFinite(vkquake.progsCrc)) failures.push("vkQuake artifact is missing progsCrc");
  if (vkquake.map !== scenario.map) failures.push(`vkQuake map ${vkquake.map}, expected ${scenario.map}`);
  if (!vecEquals(vkquake.setup?.requestedTargetOrigin, edit.origin)) {
    failures.push("vkQuake requested target origin does not match scenario");
  }
  if (!vecEquals(vkquake.setup?.requestedPlayerOrigin, scenario.player?.origin)) {
    failures.push("vkQuake requested player origin does not match scenario");
  }
  if (vkquake.setup?.traceToTarget?.startsolid) failures.push("vkQuake trace to target started solid");
  if (vkquake.setup?.traceToTarget?.allsolid) failures.push("vkQuake trace to target was allsolid");
  if (vkquake.setup?.traceToTarget?.hit !== edit.id) {
    failures.push(`vkQuake trace hit ${vkquake.setup?.traceToTarget?.hit}, expected ${edit.id}`);
  }
  if (!sourceEvent) failures.push("missing vkQuake T_Damage event");
  if (sourceEvent) {
    if (sourceEvent.sourceFunctionFound !== true) failures.push("vkQuake T_Damage source function was not found");
    if (sourceEvent.amount !== action.amount) failures.push(`vkQuake damage ${sourceEvent.amount}, expected ${action.amount}`);
    if (sourceEvent.healthBefore !== edit.health) {
      failures.push(`vkQuake healthBefore ${sourceEvent.healthBefore}, expected ${edit.health}`);
    }
    if (sourceEvent.killed !== true) failures.push("vkQuake source event did not kill the target");
    if (sourceEvent.amount === action.amount && sourceEvent.healthBefore === edit.health && sourceEvent.killed) {
      matches.push(`vkQuake T_Damage ${sourceEvent.amount} killed ${edit.select?.classname}`);
    }
  }

  if (cssquake.pass !== true) failures.push(`cssQuake artifact failed: ${(cssquake.failures ?? []).join("; ")}`);
  else matches.push("cssQuake targetability smoke passed");
  if (cssReference.monsterClassname !== edit.select?.classname) {
    failures.push(`cssQuake sourceReference monster ${cssReference.monsterClassname}, expected ${edit.select?.classname}`);
  }
  if (cssReference.directDamage !== action.amount) {
    failures.push(`cssQuake sourceReference damage ${cssReference.directDamage}, expected ${action.amount}`);
  }
  if (cssReference.monsterHealth !== edit.health) {
    failures.push(`cssQuake sourceReference health ${cssReference.monsterHealth}, expected ${edit.health}`);
  }
  if (!cssResult.damageWeaponTargetOk) failures.push("cssQuake damageWeaponTarget did not succeed");
  if (!(cssResult.afterLiveShootables < cssResult.beforeLiveShootables)) {
    failures.push(`cssQuake live shootables did not drop: ${cssResult.beforeLiveShootables} -> ${cssResult.afterLiveShootables}`);
  }
  if (cssResult.damageWeaponTargetOk && cssResult.afterLiveShootables < cssResult.beforeLiveShootables) {
    matches.push("cssQuake damage through weaponTargets removed one live shootable");
  }
  if (cssResult.targetMountedBefore === false) {
    acceptableDivergences.push("cssQuake target is intentionally unmounted because the browser fixture exercises the DOM mount budget");
  } else {
    failures.push("cssQuake target was mounted; this does not prove over-mount-budget targetability");
  }
  if (!beforeBudget || !afterBudget) failures.push("missing cssQuake combat budget stats");
  if (beforeBudget && afterBudget) {
    if (beforeBudget.expandedLogicalCombatEnabled !== true) failures.push("cssQuake expanded logical combat was not enabled");
    if (afterBudget.unmountedAiEnabled !== false) failures.push("cssQuake unmounted AI should remain disabled");
    if ((afterBudget.counters?.unmountedAiTicksTotal ?? 0) !== 0) {
      failures.push(`cssQuake unmounted AI ticks ${afterBudget.counters.unmountedAiTicksTotal}, expected 0`);
    }
    if ((afterBudget.counters?.domReadsTotal ?? 0) !== 0) {
      failures.push(`cssQuake DOM reads ${afterBudget.counters.domReadsTotal}, expected 0`);
    }
    if ((beforeBudget.combatInterestSetSize ?? 0) > (limits.combatInterestSet ?? Infinity)) {
      failures.push(`cssQuake combat interest over cap: ${beforeBudget.combatInterestSetSize}`);
    }
    if ((afterBudget.maxFrame?.lineOfSightChecks ?? 0) > (limits.lineOfSightChecksPerFrame ?? Infinity)) {
      failures.push(`cssQuake LOS max frame over cap: ${afterBudget.maxFrame.lineOfSightChecks}`);
    }
    if ((afterBudget.maxPerSecond?.lineOfSightChecks ?? 0) > (limits.lineOfSightChecksPerSecond ?? Infinity)) {
      failures.push(`cssQuake LOS max second over cap: ${afterBudget.maxPerSecond.lineOfSightChecks}`);
    }
    if ((afterBudget.maxFrame?.attackChainChecks ?? 0) > (limits.attackChainChecksPerFrame ?? Infinity)) {
      failures.push(`cssQuake attack checks max frame over cap: ${afterBudget.maxFrame.attackChainChecks}`);
    }
    if (!failures.some((failure) => failure.includes("cssQuake LOS") || failure.includes("unmounted AI") || failure.includes("DOM reads") || failure.includes("combat interest"))) {
      matches.push("cssQuake combat budget counters stayed under targetability caps");
    }
  }

  if (!vecEquals(cssReference.targetOrigin && [
    cssReference.targetOrigin.x,
    cssReference.targetOrigin.y,
    cssReference.targetOrigin.z,
  ], edit.origin)) {
    warnings.push("cssQuake sourceReference target origin does not exactly match scenario origin");
  }
  if (!vecEquals(cssReference.playerOrigin && [
    cssReference.playerOrigin.x,
    cssReference.playerOrigin.y,
    cssReference.playerOrigin.z,
  ], scenario.player?.origin)) {
    warnings.push("cssQuake sourceReference player origin does not exactly match scenario origin");
  }

  const verdict = failures.length
    ? (vkquake.setup?.status === "valid" ? "cssquake-bug" : "invalid-scenario")
    : (acceptableDivergences.length ? "acceptable-divergence" : "match");

  return {
    generatedAt: new Date().toISOString(),
    scenarioId: scenario.id,
    scenarioPath,
    vkquakePath,
    cssquakePath,
    verdict,
    pass: failures.length === 0,
    failures,
    warnings,
    matches,
    acceptableDivergences,
    summary: {
      sourceDamage: sourceEvent ? {
        amount: sourceEvent.amount,
        healthAfter: sourceEvent.healthAfter,
        healthBefore: sourceEvent.healthBefore,
        killed: sourceEvent.killed,
      } : null,
      cssquake: {
        afterLiveShootables: cssResult.afterLiveShootables,
        beforeLiveShootables: cssResult.beforeLiveShootables,
        damageWeaponTargetOk: cssResult.damageWeaponTargetOk,
        targetEntity: cssResult.targetEntity,
        targetMountedBefore: cssResult.targetMountedBefore,
      },
      budgets: afterBudget ? {
        combatInterestSetSize: beforeBudget?.combatInterestSetSize ?? null,
        domReadsTotal: afterBudget.counters?.domReadsTotal ?? null,
        lineOfSightMaxFrame: afterBudget.maxFrame?.lineOfSightChecks ?? null,
        lineOfSightMaxSecond: afterBudget.maxPerSecond?.lineOfSightChecks ?? null,
        unmountedAiTicksTotal: afterBudget.counters?.unmountedAiTicksTotal ?? null,
      } : null,
    },
  };
}

function markdownReport(compare) {
  const lines = [
    `# ${compare.scenarioId}`,
    "",
    `Verdict: ${compare.verdict}`,
    "",
    "## Matches",
    ...bulletLines(compare.matches),
    "",
    "## Acceptable Divergences",
    ...bulletLines(compare.acceptableDivergences),
  ];
  if (compare.warnings.length) {
    lines.push("", "## Warnings", ...bulletLines(compare.warnings));
  }
  if (compare.failures.length) {
    lines.push("", "## Failures", ...bulletLines(compare.failures));
  }
  lines.push(
    "",
    "## Artifacts",
    "",
    `- vkQuake: \`${compare.vkquakePath}\``,
    `- cssQuake: \`${compare.cssquakePath}\``,
    ""
  );
  return `${lines.join("\n")}\n`;
}

function bulletLines(items) {
  return items.length ? items.map((item) => `- ${item}`) : ["- None"];
}

async function main() {
  if (flag("help") || flag("h")) {
    printHelp();
    return;
  }
  const scenarioPath = option("scenario", DEFAULT_SCENARIO);
  const vkquakePath = option("vkquake", DEFAULT_VKQUAKE);
  const cssquakePath = option("cssquake", DEFAULT_CSSQUAKE);
  const out = option("out", DEFAULT_OUT);
  const markdownOut = option("markdown-out", DEFAULT_MARKDOWN_OUT);
  const scenario = readJson(scenarioPath);
  const vkquake = readJson(vkquakePath);
  const cssquake = readJson(cssquakePath);
  const compare = compareArtifacts({ scenario, vkquake, cssquake, scenarioPath, vkquakePath, cssquakePath });
  writeJson(out, compare);
  if (!flag("no-markdown")) writeText(markdownOut, markdownReport(compare));
  if (!compare.pass) {
    throw new Error(`Scene oracle comparison failed: ${compare.failures.join("; ")}`);
  }
  console.log(`Scene oracle comparison passed: ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
