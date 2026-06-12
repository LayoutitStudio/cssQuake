#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_SCENARIO = "notes/oracle-scenarios/e1m1-soldier-rocket-touch.json";
const DEFAULT_VKQUAKE = "bench/results/quake/oracle/e1m1-soldier-rocket-touch.vkquake.json";
const DEFAULT_CSSQUAKE = "bench/results/quake/oracle/e1m1-soldier-rocket-touch.cssquake.json";
const DEFAULT_OUT = "bench/results/quake/oracle/e1m1-soldier-rocket-touch.compare.json";
const DEFAULT_MARKDOWN_OUT = "bench/results/quake/oracle/e1m1-soldier-rocket-touch.md";

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
  node scripts/compareRocketTouchOracle.mjs [options]

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

function sourceRocketTouchEvent(vkquake) {
  return vkquake.events?.find((event) => event.type === "T_MissileTouch") ?? null;
}

function budgetCounterDelta(before, after, name) {
  return (after?.counters?.[name] ?? 0) - (before?.counters?.[name] ?? 0);
}

function compareArtifacts({ scenario, vkquake, cssquake, scenarioPath, vkquakePath, cssquakePath }) {
  const failures = [];
  const warnings = [];
  const matches = [];
  const action = scenario.actions?.[0] ?? {};
  const edit = scenario.edits?.[0] ?? {};
  const sourceEvent = sourceRocketTouchEvent(vkquake);
  const sourceDirect = sourceEvent?.directDamage ?? {};
  const sourceRadius = sourceEvent?.radiusDamage ?? {};
  const sourcePlayer = sourceRadius.player ?? {};
  const cssResult = cssquake.result ?? {};
  const impact = cssResult.impact ?? null;
  const beforeBudget = cssResult.before ?? null;
  const afterBudget = cssResult.after ?? null;
  const beforeInventory = cssResult.beforeInventory ?? {};
  const afterInventory = cssResult.afterInventory ?? {};
  const beforeShootables = cssResult.beforeShootables ?? {};
  const afterShootables = cssResult.afterShootables ?? {};
  const limits = afterBudget?.limits ?? beforeBudget?.limits ?? {};
  const playerDamage = beforeInventory.health - afterInventory.health;
  const liveDelta = afterShootables.live - beforeShootables.live;
  const deadDelta = afterShootables.dead - beforeShootables.dead;
  const losDelta = budgetCounterDelta(beforeBudget, afterBudget, "lineOfSightChecksTotal");
  const unmountedAiDelta = budgetCounterDelta(beforeBudget, afterBudget, "unmountedAiTicksTotal");
  const domReadDelta = budgetCounterDelta(beforeBudget, afterBudget, "domReadsTotal");

  if (action.type !== "rocketTouch") failures.push(`scenario action type ${action.type}, expected rocketTouch`);
  if (action.weapon !== "rocketlauncher") failures.push(`scenario weapon ${action.weapon}, expected rocketlauncher`);
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
  if (!sourceEvent) failures.push("missing vkQuake T_MissileTouch event");
  if (sourceEvent) {
    if (sourceEvent.sourceFunctionFound !== true) failures.push("vkQuake T_MissileTouch source function was not found");
    if (sourceEvent.weapon !== "rocketlauncher") failures.push(`vkQuake weapon ${sourceEvent.weapon}, expected rocketlauncher`);
    if (sourceDirect.sourceFunctionFound !== true) failures.push("vkQuake T_Damage source function was not found");
    if (sourceRadius.sourceFunctionFound !== true) failures.push("vkQuake T_RadiusDamage source function was not found");
    if (sourcePlayer.canDamageSourceFunctionFound !== true) failures.push("vkQuake CanDamage source function was not found");
    if (sourceDirect.amount < action.expectedDirectDamageMin || sourceDirect.amount > action.expectedDirectDamageMax) {
      failures.push(`vkQuake direct damage ${sourceDirect.amount}, expected ${action.expectedDirectDamageMin}-${action.expectedDirectDamageMax}`);
    }
    if (sourceDirect.killed !== action.expectedTargetKilled) {
      failures.push(`vkQuake killed ${sourceDirect.killed}, expected ${action.expectedTargetKilled}`);
    }
    if (sourceRadius.directHitTargetIgnored !== true) failures.push("vkQuake radius damage should ignore direct-hit target");
    if (sourcePlayer.amount < action.expectedPlayerSplashDamageMin ||
      sourcePlayer.amount > action.expectedPlayerSplashDamageMax) {
      failures.push(`vkQuake player splash ${sourcePlayer.amount}, expected ${action.expectedPlayerSplashDamageMin}-${action.expectedPlayerSplashDamageMax}`);
    }
    if (sourcePlayer.canDamage !== true) failures.push("vkQuake player CanDamage should be true");
    if (!Array.isArray(sourcePlayer.traces) || sourcePlayer.traces.length !== 5) {
      failures.push("vkQuake player CanDamage should report five traces");
    } else {
      matches.push(`vkQuake source rocket direct ${sourceDirect.amount}, player splash ${sourcePlayer.amount}, five CanDamage traces`);
    }
  }

  if (cssquake.pass !== true) failures.push(`cssQuake artifact failed: ${(cssquake.failures ?? []).join("; ")}`);
  else matches.push("cssQuake rocket-touch smoke passed");
  if (cssquake.scenarioId !== scenario.id) failures.push(`cssQuake scenario id ${cssquake.scenarioId}, expected ${scenario.id}`);
  if (cssquake.mapName !== scenario.map) failures.push(`cssQuake map ${cssquake.mapName}, expected ${scenario.map}`);
  if (!cssResult.setPlayerOk) failures.push("cssQuake failed to place player fixture");
  if (!cssResult.setTargetOriginOk) failures.push("cssQuake failed to place target fixture");
  if (!cssResult.mountTargetOk) failures.push("cssQuake failed to mount target fixture");
  if (cssResult.sourceReference?.targetClassname !== edit.select?.classname) {
    failures.push(`cssQuake target classname ${cssResult.sourceReference?.targetClassname}, expected ${edit.select?.classname}`);
  }
  if (!impact) failures.push("missing cssQuake projectile impact result");
  if (impact) {
    if (impact.weapon !== action.weapon) failures.push(`cssQuake impact weapon ${impact.weapon}, expected ${action.weapon}`);
    if (impact.directDamage !== sourceDirect.amount) {
      failures.push(`cssQuake direct damage ${impact.directDamage}, vkQuake ${sourceDirect.amount}`);
    } else {
      matches.push("cssQuake direct damage input matches vkQuake source roll");
    }
    if (impact.impactResult !== "remove") failures.push(`cssQuake impact result ${impact.impactResult}, expected remove`);
    if (impact.splashDamage !== sourceRadius.damageUnits) {
      failures.push(`cssQuake splash damage ${impact.splashDamage}, vkQuake ${sourceRadius.damageUnits}`);
    }
    if (impact.splashRadiusQuakeUnits !== sourceRadius.radiusUnits) {
      failures.push(`cssQuake splash radius ${impact.splashRadiusQuakeUnits}, vkQuake ${sourceRadius.radiusUnits} Quake units`);
    }
    if (impact.splashIgnoresDirectHit !== sourceRadius.directHitTargetIgnored) {
      failures.push(`cssQuake direct-hit ignore ${impact.splashIgnoresDirectHit}, vkQuake ${sourceRadius.directHitTargetIgnored}`);
    }
    if (impact.splashRequiresCanDamage !== true) failures.push("cssQuake rocket splash should require CanDamage");
  }

  if (playerDamage !== sourcePlayer.amount) {
    failures.push(`cssQuake player splash ${playerDamage}, vkQuake ${sourcePlayer.amount}`);
  } else {
    matches.push("cssQuake player splash damage matches vkQuake");
  }
  if (liveDelta !== -1) failures.push(`cssQuake live shootable delta ${liveDelta}, expected -1`);
  if (liveDelta === -1) matches.push("cssQuake target kill reduced live shootable count exactly once");

  if (!beforeBudget || !afterBudget) failures.push("missing cssQuake combat budget stats");
  if (beforeBudget && afterBudget) {
    if (losDelta < 1 || losDelta > 5) failures.push(`cssQuake rocket-touch LOS cost ${losDelta}, expected 1-5`);
    if (unmountedAiDelta !== 0) failures.push(`cssQuake unmounted AI tick delta ${unmountedAiDelta}, expected 0`);
    if (domReadDelta !== 0) failures.push(`cssQuake DOM read delta ${domReadDelta}, expected 0`);
    if (afterBudget.expandedLogicalCombatEnabled !== false) failures.push("cssQuake expanded logical combat should stay disabled");
    if (afterBudget.unmountedAiEnabled !== false) failures.push("cssQuake unmounted AI should stay disabled");
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
      matches.push(`cssQuake event-bound budget passed with LOS delta ${losDelta}, no DOM reads, no unmounted AI`);
    }
  }

  if (cssResult.sourceReference?.targetEntity === null) {
    warnings.push("cssQuake did not report a target entity id");
  }

  return {
    cssquakePath,
    failures,
    generatedAt: new Date().toISOString(),
    matches,
    scenarioId: scenario.id,
    scenarioPath,
    summary: {
      budgets: afterBudget ? {
        domReadDelta,
        lineOfSightDelta: losDelta,
        lineOfSightMaxFrame: afterBudget.maxFrame?.lineOfSightChecks ?? null,
        lineOfSightMaxSecond: afterBudget.maxPerSecond?.lineOfSightChecks ?? null,
        unmountedAiDelta,
      } : null,
      cssquake: {
        deadShootableDelta: deadDelta,
        directDamage: impact?.directDamage ?? null,
        liveShootableDelta: liveDelta,
        playerSplashDamage: playerDamage,
        targetEntity: cssResult.sourceReference?.targetEntity ?? null,
      },
      source: sourceEvent ? {
        directDamage: sourceDirect.amount,
        playerSplashDamage: sourcePlayer.amount,
        playerTraceCount: sourcePlayer.traces?.length ?? 0,
        radiusIgnoresDirectHit: sourceRadius.directHitTargetIgnored,
      } : null,
    },
    verdict: failures.length ? "cssquake-bug" : "match",
    pass: failures.length === 0,
    vkquakePath,
    warnings,
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
  if (compare.failures.length) {
    lines.push("", "## Failures", ...bulletLines(compare.failures));
  }
  if (compare.warnings.length) {
    lines.push("", "## Warnings", ...bulletLines(compare.warnings));
  }
  lines.push(
    "",
    "## Summary",
    "",
    "```json",
    JSON.stringify(compare.summary, null, 2),
    "```",
    "",
  );
  return lines.join("\n");
}

function bulletLines(values) {
  return values.length ? values.map((value) => `- ${value}`) : ["- None"];
}

function main() {
  if (flag("help") || flag("h")) {
    printHelp();
    return;
  }
  const scenarioPath = option("scenario", DEFAULT_SCENARIO);
  const vkquakePath = option("vkquake", DEFAULT_VKQUAKE);
  const cssquakePath = option("cssquake", DEFAULT_CSSQUAKE);
  const outPath = option("out", DEFAULT_OUT);
  const markdownOut = option("markdown-out", DEFAULT_MARKDOWN_OUT);
  const scenario = readJson(scenarioPath);
  const vkquake = readJson(vkquakePath);
  const cssquake = readJson(cssquakePath);
  const compare = compareArtifacts({ scenario, vkquake, cssquake, scenarioPath, vkquakePath, cssquakePath });
  writeJson(outPath, compare);
  if (!flag("no-markdown")) writeText(markdownOut, markdownReport(compare));
  if (!compare.pass) {
    throw new Error(`Rocket-touch oracle comparison failed: ${compare.failures.join("; ")}`);
  }
  console.log(`Rocket-touch oracle comparison passed: ${outPath}`);
}

try {
  main();
} catch (error) {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
}
