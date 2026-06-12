#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_SCENARIO = "notes/oracle-scenarios/e1m1-soldier-candamage-edge.json";
const DEFAULT_VKQUAKE = "bench/results/quake/oracle/e1m1-soldier-candamage-edge.vkquake.json";
const DEFAULT_CSSQUAKE = "bench/results/quake/oracle/e1m1-soldier-candamage-edge.cssquake.json";
const DEFAULT_OUT = "bench/results/quake/oracle/e1m1-soldier-candamage-edge.compare.json";
const DEFAULT_MARKDOWN_OUT = "bench/results/quake/oracle/e1m1-soldier-candamage-edge.md";

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
  node scripts/compareCanDamageOracle.mjs [options]

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

function sourceCanDamageEvent(vkquake) {
  return vkquake.events?.find((event) => event.type === "CanDamage") ?? null;
}

function tracePattern(traces) {
  return (traces ?? []).map((trace) => ({
    clear: Boolean(trace.clear),
    label: trace.label,
  }));
}

function sameTracePattern(sourceTraces, cssTraces) {
  const source = tracePattern(sourceTraces);
  const css = tracePattern(cssTraces);
  return source.length === css.length &&
    source.every((trace, index) => trace.label === css[index]?.label && trace.clear === css[index]?.clear);
}

function compareArtifacts({ scenario, vkquake, cssquake, scenarioPath, vkquakePath, cssquakePath }) {
  const failures = [];
  const warnings = [];
  const matches = [];
  const action = scenario.actions?.[0] ?? {};
  const edit = scenario.edits?.[0] ?? {};
  const sourceEvent = sourceCanDamageEvent(vkquake);
  const cssResult = cssquake.result ?? {};
  const cssCanDamage = cssResult.canDamage ?? null;
  const beforeBudget = cssResult.before ?? null;
  const afterBudget = cssResult.after ?? null;
  const limits = afterBudget?.limits ?? beforeBudget?.limits ?? {};

  if (action.type !== "canDamage") failures.push(`scenario action type ${action.type}, expected canDamage`);
  if (scenario.id !== vkquake.scenarioId) failures.push(`scenario id mismatch: ${scenario.id} vs ${vkquake.scenarioId}`);
  else matches.push("scenario id matches");
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
  if (vkquake.setup?.traceToTarget?.startsolid) failures.push("vkQuake setup trace started solid");
  if (vkquake.setup?.traceToTarget?.allsolid) failures.push("vkQuake setup trace was allsolid");

  if (!sourceEvent) failures.push("missing vkQuake CanDamage event");
  if (sourceEvent) {
    if (sourceEvent.sourceFunctionFound !== true) failures.push("vkQuake CanDamage source function was not found");
    if (sourceEvent.inflictor !== action.inflictor) {
      failures.push(`vkQuake CanDamage inflictor ${sourceEvent.inflictor}, expected ${action.inflictor}`);
    }
    if (sourceEvent.result !== action.expectedResult) {
      failures.push(`vkQuake CanDamage result ${sourceEvent.result}, expected ${action.expectedResult}`);
    }
    if (!Array.isArray(sourceEvent.traces) || sourceEvent.traces.length !== 5) {
      failures.push("vkQuake CanDamage should report five traces");
    } else if (sourceEvent.traces.some((trace) => trace.startsolid || trace.allsolid)) {
      failures.push("vkQuake CanDamage trace started/all solid");
    } else {
      matches.push(`vkQuake CanDamage result ${sourceEvent.result} with five source traces`);
    }
  }

  if (cssquake.pass !== true) failures.push(`cssQuake artifact failed: ${(cssquake.failures ?? []).join("; ")}`);
  else matches.push("cssQuake CanDamage smoke passed");
  if (cssquake.scenarioId !== scenario.id) failures.push(`cssQuake scenario id ${cssquake.scenarioId}, expected ${scenario.id}`);
  if (cssquake.mapName !== scenario.map) failures.push(`cssQuake map ${cssquake.mapName}, expected ${scenario.map}`);
  if (!cssResult.setTargetOriginOk) failures.push("cssQuake failed to place target origin");
  if (cssResult.sourceReference?.targetClassname !== edit.select?.classname) {
    failures.push(`cssQuake target classname ${cssResult.sourceReference?.targetClassname}, expected ${edit.select?.classname}`);
  }
  if (!cssCanDamage) failures.push("missing cssQuake CanDamage result");
  if (cssCanDamage) {
    if (cssCanDamage.result !== sourceEvent?.result) {
      failures.push(`cssQuake CanDamage result ${cssCanDamage.result}, vkQuake ${sourceEvent?.result}`);
    } else {
      matches.push("cssQuake CanDamage boolean matches vkQuake");
    }
    if (!sameTracePattern(sourceEvent?.traces, cssCanDamage.traces)) {
      failures.push(`cssQuake trace clear pattern ${JSON.stringify(tracePattern(cssCanDamage.traces))}, vkQuake ${JSON.stringify(tracePattern(sourceEvent?.traces))}`);
    } else {
      matches.push("cssQuake five-trace clear pattern matches vkQuake");
    }
  }

  if (!beforeBudget || !afterBudget) failures.push("missing cssQuake combat budget stats");
  if (beforeBudget && afterBudget) {
    const losDelta = (afterBudget.counters?.lineOfSightChecksTotal ?? 0) -
      (beforeBudget.counters?.lineOfSightChecksTotal ?? 0);
    const unmountedAiDelta = (afterBudget.counters?.unmountedAiTicksTotal ?? 0) -
      (beforeBudget.counters?.unmountedAiTicksTotal ?? 0);
    const domReadDelta = (afterBudget.counters?.domReadsTotal ?? 0) -
      (beforeBudget.counters?.domReadsTotal ?? 0);
    if (losDelta !== 5) failures.push(`cssQuake CanDamage LOS cost ${losDelta}, expected 5`);
    if (unmountedAiDelta !== 0) failures.push(`cssQuake unmounted AI tick delta ${unmountedAiDelta}, expected 0`);
    if (domReadDelta !== 0) failures.push(`cssQuake DOM read delta ${domReadDelta}, expected 0`);
    if ((afterBudget.currentFrame?.lineOfSightChecks ?? 0) > (limits.lineOfSightChecksPerFrame ?? Infinity)) {
      failures.push(`cssQuake current-frame LOS over cap: ${afterBudget.currentFrame.lineOfSightChecks}`);
    }
    if ((afterBudget.maxFrame?.lineOfSightChecks ?? 0) > (limits.lineOfSightChecksPerFrame ?? Infinity)) {
      failures.push(`cssQuake max-frame LOS over cap: ${afterBudget.maxFrame.lineOfSightChecks}`);
    }
    if ((afterBudget.maxPerSecond?.lineOfSightChecks ?? 0) > (limits.lineOfSightChecksPerSecond ?? Infinity)) {
      failures.push(`cssQuake per-second LOS over cap: ${afterBudget.maxPerSecond.lineOfSightChecks}`);
    }
    if (!failures.some((failure) => failure.includes("LOS") || failure.includes("unmounted AI") || failure.includes("DOM read"))) {
      matches.push("cssQuake CanDamage stayed inside event-bound budget caps");
    }
  }

  if (cssResult.sourceReference?.targetEntity === null) {
    warnings.push("cssQuake did not report a target entity id");
  }

  return {
    generatedAt: new Date().toISOString(),
    scenarioId: scenario.id,
    scenarioPath,
    vkquakePath,
    cssquakePath,
    verdict: failures.length ? "cssquake-bug" : "match",
    pass: failures.length === 0,
    failures,
    warnings,
    matches,
    summary: {
      source: sourceEvent ? {
        result: sourceEvent.result,
        traces: tracePattern(sourceEvent.traces),
      } : null,
      cssquake: cssCanDamage ? {
        result: cssCanDamage.result,
        targetEntity: cssResult.sourceReference?.targetEntity ?? null,
        traces: tracePattern(cssCanDamage.traces),
      } : null,
      budgets: afterBudget ? {
        currentFrameLineOfSight: afterBudget.currentFrame?.lineOfSightChecks ?? null,
        lineOfSightDelta: beforeBudget
          ? (afterBudget.counters?.lineOfSightChecksTotal ?? 0) -
            (beforeBudget.counters?.lineOfSightChecksTotal ?? 0)
          : null,
        lineOfSightMaxFrame: afterBudget.maxFrame?.lineOfSightChecks ?? null,
        lineOfSightMaxSecond: afterBudget.maxPerSecond?.lineOfSightChecks ?? null,
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
  ];
  if (compare.warnings.length) {
    lines.push("", "## Warnings", ...bulletLines(compare.warnings));
  }
  if (compare.failures.length) {
    lines.push("", "## Failures", ...bulletLines(compare.failures));
  }
  lines.push(
    "",
    "## Trace Pattern",
    "",
    `- vkQuake: \`${JSON.stringify(compare.summary.source?.traces ?? [])}\``,
    `- cssQuake: \`${JSON.stringify(compare.summary.cssquake?.traces ?? [])}\``,
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
  const outPath = option("out", DEFAULT_OUT);
  const markdownOut = option("markdown-out", DEFAULT_MARKDOWN_OUT);
  const compare = compareArtifacts({
    scenario: readJson(scenarioPath),
    vkquake: readJson(vkquakePath),
    cssquake: readJson(cssquakePath),
    scenarioPath,
    vkquakePath,
    cssquakePath,
  });
  writeJson(outPath, compare);
  if (!flag("no-markdown")) writeText(markdownOut, markdownReport(compare));
  if (!compare.pass) {
    throw new Error(`CanDamage oracle comparison failed: ${compare.failures.join("; ")}`);
  }
  console.log(`CanDamage oracle comparison passed: ${compare.verdict}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
