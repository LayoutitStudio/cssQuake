#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_SCENARIO = "notes/oracle-scenarios/e1m1-soldier-targetability.json";
const DEFAULT_OUT_DIR = "bench/results/quake/oracle";
const DEFAULT_APP = "/tmp/cssquake-vkquake/Quake/vkquake";
const DEFAULT_BASEDIR = "/tmp/cssquake-vkquake-basedir";
const DEFAULT_HELPER = "/Users/ekrof/.codex/cssquake-tools/vkquake-shot.mjs";
const DEFAULT_WIDTH = "640";
const DEFAULT_HEIGHT = "480";

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
  node scripts/vkquakeSceneOracle.mjs [options]

Options:
  --scenario <file>    Scenario JSON. Default: ${DEFAULT_SCENARIO}
  --out <file>         Oracle JSON output. Default: ${DEFAULT_OUT_DIR}/<scenario>.vkquake.json
  --app <file>         Patched vkQuake binary. Default: ${DEFAULT_APP}
  --basedir <dir>      Isolated Quake basedir. Default: ${DEFAULT_BASEDIR}
  --helper <file>      Existing vkQuake helper used to prepare basedir. Default: ${DEFAULT_HELPER}
  --skip-prepare       Do not prepare basedir before running vkQuake.
  --expect-invalid     Require vkQuake to return status=invalid-scenario.
  --width <px>         Hidden vkQuake window width. Default: ${DEFAULT_WIDTH}
  --height <px>        Hidden vkQuake window height. Default: ${DEFAULT_HEIGHT}

This runner calls the local vkQuake -cssquake_scene_oracle probe and validates
the returned source artifact before it is used as cssQuake evidence.`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function scenarioHash(scenario) {
  return createHash("sha256").update(stableStringify(scenario)).digest("hex");
}

function validateVec3(name, value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`${name} must be a finite [x, y, z] array`);
  }
}

function assertAllowedKeys(name, value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${name} has unsupported field(s): ${unknown.join(", ")}`);
}

function validateScenario(scenario) {
  assertAllowedKeys("scenario", scenario, [
    "actions",
    "coordinateSpace",
    "durationTicks",
    "edits",
    "id",
    "map",
    "player",
    "schemaVersion",
    "seed",
    "skill",
    "snapshotsEveryTicks",
    "sourceAuthority",
    "tickHz",
    "tolerances",
    "watch",
  ]);
  if (scenario.schemaVersion !== 1) throw new Error("scenario.schemaVersion must be 1");
  if (!scenario.id || typeof scenario.id !== "string") throw new Error("scenario.id is required");
  if (!scenario.map || typeof scenario.map !== "string") throw new Error("scenario.map is required");
  if (!Number.isInteger(scenario.skill) || scenario.skill < 0 || scenario.skill > 3) {
    throw new Error("scenario.skill must be an integer from 0 to 3");
  }
  if (!Number.isInteger(scenario.seed) || scenario.seed < 0) throw new Error("scenario.seed must be a non-negative integer");
  if (scenario.coordinateSpace !== "quake-units") throw new Error("only coordinateSpace=quake-units is supported");
  if (scenario.sourceAuthority !== "quakec-progs-dat-via-vkquake") {
    throw new Error("this runner currently supports only sourceAuthority=quakec-progs-dat-via-vkquake");
  }
  if (!Number.isFinite(scenario.tickHz) || scenario.tickHz <= 0) throw new Error("scenario.tickHz must be positive");
  if (!Number.isInteger(scenario.durationTicks) || scenario.durationTicks < 0) {
    throw new Error("scenario.durationTicks must be a non-negative integer");
  }
  if (!Number.isInteger(scenario.snapshotsEveryTicks) || scenario.snapshotsEveryTicks <= 0) {
    throw new Error("scenario.snapshotsEveryTicks must be a positive integer");
  }
  if (!scenario.player) throw new Error("scenario.player is required");
  assertAllowedKeys("scenario.player", scenario.player, ["angles", "health", "origin", "weapon"]);
  validateVec3("scenario.player.origin", scenario.player.origin);
  validateVec3("scenario.player.angles", scenario.player.angles);
  if (!Number.isFinite(scenario.player.health)) throw new Error("scenario.player.health must be finite");
  if (!Array.isArray(scenario.edits) || scenario.edits.length !== 1) {
    throw new Error("this runner currently supports exactly one edit");
  }
  if (!Array.isArray(scenario.actions) || scenario.actions.length !== 1) {
    throw new Error("this runner currently supports exactly one action");
  }
  if (!Array.isArray(scenario.watch)) throw new Error("scenario.watch must be an array");
  const edit = scenario.edits[0];
  assertAllowedKeys("scenario.edits[0]", edit, [
    "enemy",
    "flags",
    "goalentity",
    "health",
    "id",
    "origin",
    "select",
    "spawnflags",
  ]);
  if (!edit.id) throw new Error("edit.id is required");
  assertAllowedKeys("scenario.edits[0].select", edit.select, ["classname", "edict", "nth", "targetname"]);
  if (!edit.select?.classname) throw new Error("this runner currently requires edit.select.classname");
  if (edit.select.nth !== undefined && edit.select.nth !== 0) {
    throw new Error("this runner currently supports only edit.select.nth=0");
  }
  validateVec3("edit.origin", edit.origin);
  if (!Number.isFinite(edit.health)) throw new Error("edit.health must be finite");
  const action = scenario.actions[0];
  assertAllowedKeys("scenario.actions[0]", action, [
    "amount",
    "attacker",
    "expectedDirectDamageMax",
    "expectedDirectDamageMin",
    "expectedPlayerSplashDamageMax",
    "expectedPlayerSplashDamageMin",
    "expectedResult",
    "expectedTargetKilled",
    "inflictor",
    "missileOrigin",
    "missileVelocity",
    "target",
    "tick",
    "type",
    "weapon",
  ]);
  if (action.type !== "damage" && action.type !== "canDamage" && action.type !== "rocketTouch") {
    throw new Error("this runner currently supports only action.type=damage, action.type=canDamage, or action.type=rocketTouch");
  }
  if (action.tick !== 0) throw new Error("this runner currently supports only action.tick=0");
  if (action.target !== edit.id) throw new Error("action must target the only edit id");
  if (action.type === "damage") {
    if (!Number.isFinite(action.amount)) throw new Error("damage action requires a finite amount");
    if (action.attacker !== "player") throw new Error("damage action currently requires attacker=player");
  } else if (action.type === "canDamage") {
    if (action.inflictor !== "player") throw new Error("canDamage action currently requires inflictor=player");
    if (typeof action.expectedResult !== "boolean") throw new Error("canDamage action requires expectedResult");
  } else {
    if (action.attacker !== "player") throw new Error("rocketTouch action currently requires attacker=player");
    if (action.weapon !== "rocketlauncher") throw new Error("rocketTouch action currently requires weapon=rocketlauncher");
    if (action.missileOrigin !== undefined) validateVec3("action.missileOrigin", action.missileOrigin);
    if (action.missileVelocity !== undefined) validateVec3("action.missileVelocity", action.missileVelocity);
    for (const key of [
      "expectedDirectDamageMin",
      "expectedDirectDamageMax",
      "expectedPlayerSplashDamageMin",
      "expectedPlayerSplashDamageMax",
    ]) {
      if (!Number.isFinite(action[key])) throw new Error(`rocketTouch action requires finite ${key}`);
    }
    if (action.expectedDirectDamageMin > action.expectedDirectDamageMax) {
      throw new Error("rocketTouch expectedDirectDamageMin must be <= expectedDirectDamageMax");
    }
    if (action.expectedPlayerSplashDamageMin > action.expectedPlayerSplashDamageMax) {
      throw new Error("rocketTouch expectedPlayerSplashDamageMin must be <= expectedPlayerSplashDamageMax");
    }
    if (typeof action.expectedTargetKilled !== "boolean") {
      throw new Error("rocketTouch action requires expectedTargetKilled");
    }
  }
  scenario.watch.forEach((watch, index) => {
    assertAllowedKeys(`scenario.watch[${index}]`, watch, ["classname", "edict", "id"]);
  });
  if (scenario.tolerances !== undefined) {
    assertAllowedKeys("scenario.tolerances", scenario.tolerances, ["eventTicks", "originUnits"]);
  }
}

function runCommand(label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(`${label} failed with exit ${result.status}.\n${combined.slice(-4000)}`);
  }
  return result;
}

function quakePoseText(player) {
  return [...player.origin, ...player.angles].join(" ");
}

function prepareBasedir({ app, basedir, helper, scenario }) {
  if (!existsSync(helper)) {
    throw new Error(`vkQuake helper not found: ${helper}. Pass --skip-prepare if ${basedir} is already prepared.`);
  }
  runCommand("vkQuake basedir prepare", process.execPath, [
    helper,
    "--app", app,
    "--basedir", basedir,
    "--map", scenario.map,
    "--quake", quakePoseText(scenario.player),
    "--vk-only",
    "--no-diff",
    "--dry-run",
  ]);
}

function runSceneOracleProbe({ app, basedir, out, scenarioPath, width, height }) {
  const args = [
    "-basedir", basedir,
    "-window",
    "-width", width,
    "-height", height,
    "-nosound",
    "-nomouse",
    "-cssquake_capture_hidden",
    "-cssquake_scene_oracle",
    scenarioPath,
    out,
  ];
  runCommand("vkQuake scene oracle probe", app, args, { cwd: basedir });
  if (!existsSync(out)) {
    throw new Error(`vkQuake probe completed without writing ${out}. Is the local vkQuake scene-oracle patch built?`);
  }
  return readJson(out);
}

function validateOracleArtifact({ oracle, scenario, expectInvalid }) {
  const failures = [];
  const edit = scenario.edits[0];
  const action = scenario.actions[0];
  const sourceDamageEvent = oracle.events?.find((event) => event.type === "T_Damage");
  const sourceCanDamageEvent = oracle.events?.find((event) => event.type === "CanDamage");
  const sourceRocketTouchEvent = oracle.events?.find((event) => event.type === "T_MissileTouch");

  if (oracle.schemaVersion !== 1) failures.push("oracle schemaVersion must be 1");
  if (oracle.scenarioId !== scenario.id) failures.push(`oracle scenarioId ${oracle.scenarioId}, expected ${scenario.id}`);
  if (oracle.engine !== "vkQuake") failures.push(`oracle engine ${oracle.engine}, expected vkQuake`);
  if (!oracle.engineRevision) failures.push("oracle engineRevision is required");
  if (!oracle.patchId) failures.push("oracle patchId is required");
  if (oracle.map !== scenario.map) failures.push(`oracle map ${oracle.map}, expected ${scenario.map}`);
  if (oracle.skill !== scenario.skill) failures.push(`oracle skill ${oracle.skill}, expected ${scenario.skill}`);
  if (oracle.seed !== scenario.seed) failures.push(`oracle seed ${oracle.seed}, expected ${scenario.seed}`);
  if (oracle.random?.seededAtSpawn !== true) failures.push("oracle random.seededAtSpawn must be true");
  if (oracle.coordinateSpace !== scenario.coordinateSpace) failures.push("oracle coordinateSpace mismatch");
  if (oracle.sourceAuthority !== scenario.sourceAuthority) failures.push("oracle sourceAuthority mismatch");
  if (!Number.isFinite(oracle.progsCrc)) failures.push("oracle progsCrc is required");
  if (!oracle.cvars?.host_framerate) failures.push("oracle host_framerate cvar is required");
  if (!Array.isArray(oracle.setup?.failures)) failures.push("oracle setup.failures must be an array");

  if (expectInvalid) {
    if (oracle.status !== "invalid-scenario" || oracle.setup?.status !== "invalid") {
      failures.push(`expected invalid-scenario, got status=${oracle.status} setup=${oracle.setup?.status}`);
    }
    if (!oracle.setup?.failures?.length) failures.push("invalid-scenario artifact should include setup failures");
    return failures;
  }

  if (oracle.status !== "pass") failures.push(`oracle status ${oracle.status}, expected pass`);
  if (oracle.setup?.status !== "valid") failures.push(`oracle setup ${oracle.setup?.status}, expected valid`);
  if (!vecEquals(oracle.setup?.requestedTargetOrigin, edit.origin)) {
    failures.push("oracle requested target origin does not match scenario");
  }
  if (!vecEquals(oracle.setup?.effectiveTargetOrigin, edit.origin)) {
    failures.push("oracle effective target origin changed before actions");
  }
  if (!vecEquals(oracle.setup?.requestedPlayerOrigin, scenario.player.origin)) {
    failures.push("oracle requested player origin does not match scenario");
  }
  if (!vecEquals(oracle.setup?.effectivePlayerOrigin, scenario.player.origin)) {
    failures.push("oracle effective player origin does not match scenario");
  }
  if (oracle.setup?.traceToTarget?.startsolid) failures.push("oracle trace to target started solid");
  if (oracle.setup?.traceToTarget?.allsolid) failures.push("oracle trace to target was allsolid");
  if (action.type === "damage" && oracle.setup?.traceToTarget?.hit !== edit.id) {
    failures.push(`oracle trace hit ${oracle.setup?.traceToTarget?.hit}, expected ${edit.id}`);
  }
  if (action.type === "damage") {
    if (!sourceDamageEvent) failures.push("oracle T_Damage event is required");
    if (sourceDamageEvent) {
      if (sourceDamageEvent.sourceFunctionFound !== true) failures.push("oracle T_Damage source function was not found");
      if (sourceDamageEvent.amount !== action.amount) failures.push(`oracle damage ${sourceDamageEvent.amount}, expected ${action.amount}`);
      if (sourceDamageEvent.healthBefore !== edit.health) {
        failures.push(`oracle healthBefore ${sourceDamageEvent.healthBefore}, expected ${edit.health}`);
      }
      if (sourceDamageEvent.healthAfter !== edit.health - action.amount) {
        failures.push(`oracle healthAfter ${sourceDamageEvent.healthAfter}, expected ${edit.health - action.amount}`);
      }
      if (sourceDamageEvent.killed !== true) failures.push("oracle target should be killed by this scenario");
    }
  } else if (action.type === "canDamage") {
    if (!sourceCanDamageEvent) failures.push("oracle CanDamage event is required");
    if (sourceCanDamageEvent) {
      if (sourceCanDamageEvent.sourceFunctionFound !== true) failures.push("oracle CanDamage source function was not found");
      if (sourceCanDamageEvent.inflictor !== action.inflictor) {
        failures.push(`oracle CanDamage inflictor ${sourceCanDamageEvent.inflictor}, expected ${action.inflictor}`);
      }
      if (sourceCanDamageEvent.result !== action.expectedResult) {
        failures.push(`oracle CanDamage result ${sourceCanDamageEvent.result}, expected ${action.expectedResult}`);
      }
      if (!Array.isArray(sourceCanDamageEvent.traces) || sourceCanDamageEvent.traces.length !== 5) {
        failures.push("oracle CanDamage event should include five source trace records");
      } else if (sourceCanDamageEvent.traces.some((trace) => trace.startsolid || trace.allsolid)) {
        failures.push("oracle CanDamage traces should not start/all solid for this fixture");
      }
    }
  } else {
    if (!sourceRocketTouchEvent) failures.push("oracle T_MissileTouch event is required");
    if (sourceRocketTouchEvent) {
      const direct = sourceRocketTouchEvent.directDamage ?? {};
      const radiusPlayer = sourceRocketTouchEvent.radiusDamage?.player ?? {};
      if (sourceRocketTouchEvent.sourceFunctionFound !== true) failures.push("oracle T_MissileTouch source function was not found");
      if (sourceRocketTouchEvent.weapon !== "rocketlauncher") failures.push(`oracle rocketTouch weapon ${sourceRocketTouchEvent.weapon}, expected rocketlauncher`);
      if (direct.sourceFunctionFound !== true) failures.push("oracle rocketTouch direct T_Damage source function was not found");
      if (sourceRocketTouchEvent.radiusDamage?.sourceFunctionFound !== true) {
        failures.push("oracle rocketTouch T_RadiusDamage source function was not found");
      }
      if (radiusPlayer.canDamageSourceFunctionFound !== true) failures.push("oracle rocketTouch CanDamage source function was not found");
      if (direct.healthBefore !== edit.health) {
        failures.push(`oracle rocketTouch target healthBefore ${direct.healthBefore}, expected ${edit.health}`);
      }
      if (direct.amount < action.expectedDirectDamageMin || direct.amount > action.expectedDirectDamageMax) {
        failures.push(`oracle rocketTouch direct damage ${direct.amount}, expected ${action.expectedDirectDamageMin}-${action.expectedDirectDamageMax}`);
      }
      if (direct.killed !== action.expectedTargetKilled) {
        failures.push(`oracle rocketTouch killed ${direct.killed}, expected ${action.expectedTargetKilled}`);
      }
      if (sourceRocketTouchEvent.radiusDamage?.directHitTargetIgnored !== true) {
        failures.push("oracle rocketTouch radius damage should ignore the direct-hit target");
      }
      if (radiusPlayer.amount < action.expectedPlayerSplashDamageMin ||
        radiusPlayer.amount > action.expectedPlayerSplashDamageMax) {
        failures.push(`oracle rocketTouch player splash ${radiusPlayer.amount}, expected ${action.expectedPlayerSplashDamageMin}-${action.expectedPlayerSplashDamageMax}`);
      }
      if (radiusPlayer.canDamage !== true) failures.push("oracle rocketTouch player splash CanDamage should be true");
      if (!Array.isArray(radiusPlayer.traces) || radiusPlayer.traces.length !== 5) {
        failures.push("oracle rocketTouch player splash should include five CanDamage traces");
      } else if (radiusPlayer.traces.some((trace) => trace.startsolid || trace.allsolid)) {
        failures.push("oracle rocketTouch player splash traces should not start/all solid");
      }
      const snapshotsWithMissile = (oracle.snapshots ?? [])
        .filter((snapshot) => (snapshot.watched ?? []).some((item) => item.id === "missile" && item.edict >= 0));
      if (snapshotsWithMissile.length < 2) failures.push("oracle rocketTouch should include before/after missile snapshots");
    }
  }
  if (!Array.isArray(oracle.snapshots) || oracle.snapshots.length < 2) {
    failures.push("oracle should include before/after snapshots");
  }
  return failures;
}

function vecEquals(a, b) {
  return Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, index) => value === b[index]);
}

async function main() {
  if (flag("help") || flag("h")) {
    printHelp();
    return;
  }
  const scenarioPath = path.resolve(option("scenario", DEFAULT_SCENARIO));
  const scenario = readJson(scenarioPath);
  validateScenario(scenario);

  const out = path.resolve(option("out", path.join(DEFAULT_OUT_DIR, `${scenario.id}.vkquake.json`)));
  const app = option("app", DEFAULT_APP);
  const basedir = option("basedir", DEFAULT_BASEDIR);
  const helper = option("helper", DEFAULT_HELPER);
  const width = option("width", DEFAULT_WIDTH);
  const height = option("height", DEFAULT_HEIGHT);
  const expectInvalid = flag("expect-invalid");

  if (!existsSync(app)) throw new Error(`vkQuake binary not found: ${app}`);
  mkdirSync(path.dirname(out), { recursive: true });
  if (!flag("skip-prepare")) prepareBasedir({ app, basedir, helper, scenario });

  const oracle = runSceneOracleProbe({ app, basedir, out, scenarioPath, width, height });
  oracle.scenarioHash = scenarioHash(scenario);
  oracle.generatedAt = new Date().toISOString();
  oracle.sourcePath = scenarioPath;
  writeJson(out, oracle);
  const failures = validateOracleArtifact({ oracle, scenario, expectInvalid });
  if (failures.length) {
    throw new Error(`vkQuake scene oracle trust gates failed: ${failures.join("; ")}`);
  }
  console.log(`vkQuake scene oracle ${expectInvalid ? "invalid fixture passed" : "passed"}: ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
