#!/usr/bin/env node
import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import { assertAssetState, readAssetManifest } from "../assets/checkAssetState.mjs";
import { assertPreparedEntity, readPreparedScene } from "../assets/preparedAssets.mjs";
import {
  collectPageErrors,
  hasFlag,
  loadChromium,
  numberOption,
  optionValue,
  parseCommonBrowserArgs,
  writeJsonArtifact,
} from "./browserHarnessSupport.mjs";

const DEFAULT_PORT = 5191;
const DEFAULT_PARTY_PORT = 2001;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_VIEWPORT = "960x540";
const DEFAULT_JSON_OUT = "bench/results/quake/multiplayer-deep-checks.json";
const ROOM_TOKEN_ALPHABET = "bcdfghjkmnpqrstvwxyz23456789";
const DEBUG_ROOM_ID_MAX_LENGTH = 32;
const CONTROLLED_DAMAGE_CENTER_DROP = 0.85;
const CONTROLLED_DAMAGE_HISTORY_SETTLE_MS = 220;
const CONTROLLED_DUEL_POSE_EPSILON = 0.2;
const CONTROLLED_DUEL_ROT_EPSILON = 1;
const CONTROLLED_DUEL_LANES_BY_MAP = {
  e1m7: [
    [3.84, 0, 4.6],
    [11.52, -8.48, 5.4],
    [23.04, -8.48, 5.4],
    [29.44, 0, 3.32],
    [23.04, 8.48, 5.4],
    [11.52, 8.48, 5.4],
    [3.84, 0, 1.08],
  ],
};
const CONTROLLED_WEAPONS = [
  { weapon: "axe", damage: 20, distance: 1.2 },
  { weapon: "shotgun", damage: 24, distance: 3.0 },
  { weapon: "supershotgun", damage: 56, distance: 3.0, pickup: true },
  { weapon: "nailgun", damage: 9, distance: 4.0, pickup: true },
  { weapon: "supernailgun", damage: 18, distance: 4.0, pickup: true },
];
const CONTROLLED_SUSTAINED_DAMAGE_SPECS = [
  {
    weapon: "shotgun",
    damage: 24,
    direction: "a-to-b",
    distance: 3.0,
    intervalMs: 650,
    expectedHealths: [76, 52, 28, 4],
  },
  {
    weapon: "nailgun",
    damage: 9,
    direction: "b-to-a",
    distance: 4.0,
    intervalMs: 260,
    pickup: true,
    expectedHealths: [91, 82, 73, 64, 55, 46],
  },
];
const CONTROLLED_PROJECTILE_SPECS = [
  {
    weapon: "rocketlauncher",
    distance: 4.0,
    expectedImpactKind: "player",
    expectedPlayerDamageCount: 2,
    expectedSelfDamage: 22,
    expectedAttackerHealth: 78,
    expectedVictimEventType: "player.killed",
    expectedVictimHealth: -5,
  },
  {
    weapon: "grenadelauncher",
    distance: 4.0,
    expectedImpactKind: "player",
    expectedPlayerDamageCount: 2,
    expectedSelfDamage: 22,
    expectedAttackerHealth: 78,
    expectedVictimDamage: 94,
    expectedVictimEventType: "player.damaged",
    expectedVictimHealth: 6,
  },
];
const REMOTE_ATTACK_FRAME_PREFIXES_BY_WEAPON = {
  axe: ["axatt"],
  shotgun: ["shotatt"],
  supershotgun: ["shotatt"],
  nailgun: ["nailatt"],
  supernailgun: ["nailatt"],
  grenadelauncher: ["rockatt"],
  rocketlauncher: ["rockatt"],
  lightning: ["light"],
};
const SHAREWARE_MULTIPLAYER_MAPS = ["start", "e1m1", "e1m2", "e1m3", "e1m4", "e1m5", "e1m6", "e1m7", "e1m8"];
const LOCAL_WORLD_MUTATION_MAP = "e1m1";
const WORLD_INTERACTION_MAP = "e1m1";
const WORLD_INTERACTION_CASE = {
  doorEntity: 189,
  expectedDoorClassname: "func_door_secret",
  expectedDoorTriggeredModes: new Set(["opening", "open", "closing"]),
  expectedTriggerClassname: "trigger_multiple",
  inside: { x: 792, y: 512, z: 8 },
  label: "E1M1 trigger_multiple secret door",
  targetname: "t8",
  triggerEntity: 190,
};
const SPAWN_ESCAPE_MAP = "e1m1";
const SPAWN_ESCAPE_SAMPLES = 5;
const SPAWN_ESCAPE_MIN_DISTANCE = 0.75;
const SPAWN_ESCAPE_KEYS = ["w", "a", "d", "s", "w", "d", "a", "s"];
const ROOM_LIFECYCLE_MAX_PLAYERS = 2;
const ROOM_LIFECYCLE_SPECTATOR_SLOTS = 8;
const REMOTE_POSE_ROT_EPSILON = 2;
const DAMAGE_OVERLAY_ACTIVE_TIMEOUT_MS = 1_000;
const DAMAGE_OVERLAY_CLEAR_TIMEOUT_MS = 1_500;
const DAMAGE_CUE_CLEAR_TIMEOUT_MS = 1_500;

const args = process.argv.slice(2);
if (hasFlag(args, "help") || hasFlag(args, "h")) {
  printHelp();
  process.exit(0);
}

const common = parseCommonBrowserArgs(args, {
  port: DEFAULT_PORT,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  viewport: DEFAULT_VIEWPORT,
  jsonOut: DEFAULT_JSON_OUT,
});
const mapName = optionValue(args, "map", "e1m7").trim().toLowerCase();
const preferredPartyPort = Math.max(1, Math.round(numberOption(args, "party-port", DEFAULT_PARTY_PORT)));
const externalAppUrl = normalizeAppUrl(common.explicitUrl);
const requestedPartyHost = optionValue(args, "party-host", "");
const externalPartyHost = normalizePartyHost(requestedPartyHost || (externalAppUrl ? process.env.VITE_CSSQUAKE_PARTY_HOST ?? "" : ""));
const externalMode = Boolean(externalAppUrl);
const extendedChecks = hasFlag(args, "extended");
const skipControlledDamage = hasFlag(args, "skip-controlled-damage");
const skipControlledSustainedDamage = hasFlag(args, "skip-controlled-sustained-damage");
const skipControlledKill = hasFlag(args, "skip-controlled-kill");
const skipControlledRespawn = hasFlag(args, "skip-controlled-respawn");
const skipControlledProjectile = hasFlag(args, "skip-controlled-projectile");
const skipSharedPickup = hasFlag(args, "skip-shared-pickup");
const skipLocalWorldMutation = !extendedChecks || hasFlag(args, "skip-local-world-mutation");
const skipWorldInteraction = !extendedChecks || hasFlag(args, "skip-world-interaction");
const skipSpawnEscape = !extendedChecks || hasFlag(args, "skip-spawn-escape");
const skipReconnect = hasFlag(args, "skip-reconnect");
const skipRoomLifecycle = !extendedChecks || hasFlag(args, "skip-room-lifecycle");
const skipWrongMap = hasFlag(args, "skip-wrong-map");
const skipMapReadiness = hasFlag(args, "skip-map-readiness");
const controlledWeaponNames = new Set(optionList(args, "weapons", CONTROLLED_WEAPONS.map((spec) => spec.weapon)));
const controlledDirections = optionList(args, "directions", ["a-to-b", "b-to-a"]);
const readinessMaps = optionList(args, "readiness-maps", SHAREWARE_MULTIPLAYER_MAPS)
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const requiredMaps = [mapName];
if (!skipMapReadiness) {
  for (const readinessMap of readinessMaps) {
    if (!requiredMaps.includes(readinessMap)) requiredMaps.push(readinessMap);
  }
}
if (!skipLocalWorldMutation && !requiredMaps.includes(LOCAL_WORLD_MUTATION_MAP)) {
  requiredMaps.push(LOCAL_WORLD_MUTATION_MAP);
}
if (!skipWorldInteraction && !requiredMaps.includes(WORLD_INTERACTION_MAP)) {
  requiredMaps.push(WORLD_INTERACTION_MAP);
}
if (!skipSpawnEscape && !requiredMaps.includes(SPAWN_ESCAPE_MAP)) {
  requiredMaps.push(SPAWN_ESCAPE_MAP);
}
if (!skipWrongMap) {
  const wrongMap = wrongMapProbeMap(mapName);
  if (!requiredMaps.includes(wrongMap)) requiredMaps.push(wrongMap);
}

console.log("Multiplayer deep checks");
console.log(extendedChecks
  ? "validates: core two-client multiplayer plus extended world/spawn/lifecycle checks"
  : "validates: all-map two-client readiness, controlled A/B weapon damage, sustained browser damage, death/respawn recovery, shared pickup state, remote animation evidence, projectile visuals, reconnect no-duplicate state, wrong-map rejection");
console.log("classification: multiplayer deep acceptance");
if (externalAppUrl) {
  if (!externalPartyHost) throw new Error("--party-host <host> is required when --url is used.");
  console.log(`requires prepared assets: deployed app manifest, maps ${requiredMaps.join(",")}`);
} else {
  if (externalPartyHost) throw new Error("--party-host is only supported with --url.");
  console.log(`requires prepared assets: yes, maps ${requiredMaps.join(",")}`);
  assertAssetState({ requiredMaps, requireRenderBundle: true, requireGameLogic: true });
}

const manifest = externalAppUrl ? await readRemoteAssetManifest(externalAppUrl, common.timeoutMs) : readAssetManifest();
const vitePort = externalAppUrl ? null : await findFreePort(common.port);
const partyPort = externalAppUrl ? null : await findFreePort(preferredPartyPort, new Set([vitePort]));
const appUrl = externalAppUrl || `http://127.0.0.1:${vitePort}/`;
const partyHost = externalPartyHost || `127.0.0.1:${partyPort}`;
const servers = [];
let browser = null;

try {
  if (!externalAppUrl) {
    servers.push(await startManagedServer({
      name: "vite",
      command: "pnpm",
      args: ["exec", "vite", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"],
      ready: /Local:\s+http:\/\/127\.0\.0\.1:|ready in/i,
      timeoutMs: common.timeoutMs,
    }));
    servers.push(await startManagedServer({
      name: "partykit",
      command: "pnpm",
      args: ["exec", "partykit", "dev", "--port", String(partyPort), "--serve", "build/generated/public"],
      ready: /Ready on|Updated and ready/i,
      timeoutMs: common.timeoutMs,
    }));
  }
  await assertHttpReady(appUrl, common.timeoutMs);
  if (externalAppUrl) {
    await assertHttpReady(partyPresenceUrl(partyHost), common.timeoutMs);
  }

  const chromium = await loadChromium();
  browser = await chromium.launch({ headless: !common.headed });

  const checks = [];
  if (!skipMapReadiness) {
    checks.push(await runMapReadinessCase({
      appUrl,
      browser,
      common,
      externalMode,
      manifest,
      maps: readinessMaps,
      partyHost,
    }));
  }
  if (!skipControlledDamage) {
    for (const spec of CONTROLLED_WEAPONS.filter((candidate) => controlledWeaponNames.has(candidate.weapon))) {
      for (const direction of controlledDirections) {
        checks.push(await runControlledDamageCase({
          appUrl,
          browser,
          common,
          direction,
          externalMode,
          mapName,
          manifest,
          partyHost,
          spec,
        }));
      }
    }
  }
  if (!skipControlledSustainedDamage) {
    for (const spec of CONTROLLED_SUSTAINED_DAMAGE_SPECS.filter((candidate) => controlledWeaponNames.has(candidate.weapon))) {
      checks.push(await runControlledSustainedDamageCase({
        appUrl,
        browser,
        common,
        externalMode,
        mapName,
        manifest,
        partyHost,
        spec,
      }));
    }
  }
  if (!skipControlledKill) {
    checks.push(await runControlledKillCase({
      appUrl,
      browser,
      common,
      externalMode,
      mapName,
      manifest,
      partyHost,
    }));
  }
  if (!skipControlledRespawn) {
    checks.push(await runControlledRespawnCase({
      appUrl,
      browser,
      common,
      externalMode,
      mapName,
      manifest,
      partyHost,
    }));
  }
  if (!skipControlledProjectile) {
    for (const spec of CONTROLLED_PROJECTILE_SPECS) {
      checks.push(await runControlledProjectileVisualCase({
        appUrl,
        browser,
        common,
        externalMode,
        mapName,
        manifest,
        partyHost,
        spec,
      }));
    }
  }
  if (!skipSharedPickup) {
    checks.push(await runSharedPickupStateCase({
      appUrl,
      browser,
      common,
      externalMode,
      mapName,
      manifest,
      partyHost,
    }));
  }
  if (!skipLocalWorldMutation) {
    checks.push(await runLocalWorldMutationSuppressionCase({
      appUrl,
      browser,
      common,
      externalMode,
      mapName: LOCAL_WORLD_MUTATION_MAP,
      manifest,
      partyHost,
    }));
  }
  if (!skipWorldInteraction) {
    checks.push(await runWorldInteractionCase({
      appUrl,
      browser,
      common,
      externalMode,
      mapName: WORLD_INTERACTION_MAP,
      manifest,
      partyHost,
    }));
  }
  if (!skipSpawnEscape) {
    checks.push(await runSpawnEscapeCase({
      appUrl,
      browser,
      common,
      externalMode,
      mapName: SPAWN_ESCAPE_MAP,
      manifest,
      partyHost,
    }));
  }
  if (!skipReconnect) {
    checks.push(await runReconnectCase({
      appUrl,
      browser,
      common,
      externalMode,
      mapName,
      manifest,
      partyHost,
    }));
  }
  if (!skipRoomLifecycle) {
    checks.push(await runRoomLifecycleCase({
      appUrl,
      browser,
      common,
      externalMode,
      mapName,
      manifest,
      partyHost,
    }));
  }
  if (!skipWrongMap) {
    checks.push(await runWrongMapCase({
      appUrl,
      browser,
      common,
      externalMode,
      mapName,
      manifest,
      partyHost,
    }));
  }

  const report = buildReport({
    appUrl,
    checks,
    mapName,
    partyHost,
  });
  await writeJsonArtifact(common.jsonOut, report);
  printSummary(report, common.jsonOut);
  if (report.failures.length) throw new Error(report.failures.join("\n"));
} finally {
  await browser?.close().catch(() => undefined);
  await Promise.all([...servers].reverse().map((server) => stopManagedServer(server)));
}

function printHelp() {
  console.log(`Usage:
  node test/browser/runMultiplayerDeepChecks.mjs [options]

Options:
  --map <name>                 Map route. Default: e1m7
  --port <port>                Preferred Vite port. Default: ${DEFAULT_PORT}
  --party-port <port>          Preferred PartyKit port. Default: ${DEFAULT_PARTY_PORT}
  --headed                     Run Chromium headed.
  --viewport <WxH>             Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>            Server/page readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --json-out <file>            Report path. Default: ${DEFAULT_JSON_OUT}
  --url <url>                  Use an already deployed app instead of starting local Vite.
  --party-host <host>          PartyKit host for --url, without protocol.
  --extended                   Include slower world/spawn/lifecycle checks.
  --readiness-maps <list>      Map readiness list. Default: ${SHAREWARE_MULTIPLAYER_MAPS.join(",")}
  --weapons <list>             Controlled damage weapons. Default: ${CONTROLLED_WEAPONS.map((spec) => spec.weapon).join(",")}
  --directions <list>          Controlled damage directions. Default: a-to-b,b-to-a
  --skip-controlled-damage     Skip controlled A/B damage checks.
  --skip-controlled-sustained-damage
                               Skip sustained browser damage checks.
  --skip-controlled-kill       Skip controlled browser death/kill animation check.
  --skip-controlled-respawn    Skip controlled browser respawn recovery check.
  --skip-controlled-projectile Skip controlled remote projectile presentation check.
  --skip-shared-pickup         Skip shared pickup state check.
  --skip-local-world-mutation  Skip extended local world-damage mutation check.
  --skip-world-interaction     Skip extended room-owned world trigger/mover check.
  --skip-spawn-escape          Skip extended E1M1 spawn escape sampling check.
  --skip-reconnect             Skip reconnect check.
  --skip-room-lifecycle        Skip extended browser spectator/room-full lifecycle check.
  --skip-wrong-map             Skip browser wrong-map rejection check.
  --skip-map-readiness         Skip all-map two-client browser room readiness check.`);
}

function optionList(args, name, fallback) {
  const raw = optionValue(args, name, fallback.join(","));
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeAppUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const url = new URL(trimmed);
  return url.toString();
}

function normalizePartyHost(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).host;
  } catch {
    return trimmed.replace(/^wss?:\/\//i, "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  }
}

async function readRemoteAssetManifest(appUrl, timeoutMs) {
  const manifestUrl = new URL("/q/manifest.json", appUrl).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(manifestUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 404) {
      console.warn(`${manifestUrl} returned 404; using the local generated manifest for invite encoding only.`);
      return readAssetManifest();
    }
    if (!response.ok) throw new Error(`${manifestUrl} returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function createCompactInvite(manifest, mapName, token = createRoomToken()) {
  const mapNames = (manifest?.maps ?? [])
    .filter((map) => map?.selectable !== false)
    .map((map) => String(map.mapName ?? "").trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const normalizedMapName = String(mapName ?? "").trim().toLowerCase();
  const index = mapNames.indexOf(normalizedMapName);
  if (index < 0) throw new Error(`Map ${normalizedMapName} is not selectable in the deployed manifest.`);
  const safeToken = roomTokenForCompactInvite(token);
  const mapCode = index.toString(36).padStart(2, "0");
  return {
    value: `${mapCode}${safeToken}au`,
    internalRoom: `cssquake-auto-${normalizedMapName}-${safeToken}`,
  };
}

function roomTokenForCompactInvite(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  const debugRoomMatch = raw.match(/^d([bcdfghjkmnpqrstvwxyz23456789]{8})(?:-|$)/);
  if (debugRoomMatch?.[1]) return debugRoomMatch[1];
  const match = raw.match(/[bcdfghjkmnpqrstvwxyz23456789]{8}/);
  return match?.[0] ?? createRoomToken();
}

function ignoreRequestFailure(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "www.google-analytics.com" && parsed.pathname === "/g/collect";
  } catch {
    return false;
  }
}

function partyPresenceUrl(host) {
  const protocol = isLocalPartyHost(host) ? "http" : "https";
  return `${protocol}://${host}/parties/presence/global`;
}

function isLocalPartyHost(host) {
  return /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host);
}

async function runMapReadinessCase(options) {
  const failures = [];
  const mapReports = [];
  console.log(`map readiness: maps=${options.maps.join(",")}`);

  for (const readyMap of options.maps) {
    const room = createDeepRoomName("mapready", readyMap);
    const mapFailures = [];
    const clients = [];
    let snapshots = [];
    console.log(`map readiness: ${readyMap} room=${room}`);
    try {
      for (let index = 0; index < 2; index += 1) {
        const client = await openClient(options.browser, {
          ...options,
          clientIndex: index,
          clientsCount: 2,
          debugMultiplayer: true,
          debugMultiplayerInputPaused: true,
          mapName: readyMap,
          maxPlayers: 2,
          room,
        });
        clients.push(client);
      }

      try {
        await Promise.all(clients.map((client) =>
          waitForClientReady(client, 2, options.common.timeoutMs, { allowInputPaused: true })
        ));
        await waitForSnapshotPlayers(clients, 2, options.common.timeoutMs);
        await waitForRemoteDomCounts(clients, 1, options.common.timeoutMs);
      } catch (error) {
        mapFailures.push(`readiness failed: ${errorMessage(error)}`);
      }

      snapshots = await safeReadClientSnapshots(clients);
      for (const [index, snapshot] of snapshots.entries()) {
        const multiplayer = snapshot.stats?.multiplayer;
        const playerCount = snapshot.trace?.lastSnapshot?.players?.length ?? 0;
        if (!snapshot.stats) mapFailures.push(`client ${index} did not expose debug stats`);
        if (multiplayer?.sessionState !== "connected") {
          mapFailures.push(`client ${index} session state ${String(multiplayer?.sessionState)} did not equal connected`);
        }
        if (multiplayer?.helloAccepted !== true) {
          mapFailures.push(`client ${index} helloAccepted ${String(multiplayer?.helloAccepted)} did not equal true`);
        }
        if (multiplayer?.lastReject?.code) {
          mapFailures.push(`client ${index} received reject ${multiplayer.lastReject.code}`);
        }
        if ((multiplayer?.scoreboardRows ?? 0) < 2) {
          mapFailures.push(`client ${index} scoreboard rows ${String(multiplayer?.scoreboardRows)} did not reach 2`);
        }
        if ((multiplayer?.remoteDomCount ?? 0) < 1) {
          mapFailures.push(`client ${index} remote DOM count ${String(multiplayer?.remoteDomCount)} did not reach 1`);
        }
        if (playerCount < 2) {
          mapFailures.push(`client ${index} room snapshot player count ${playerCount} did not reach 2`);
        }
      }
    } catch (error) {
      mapFailures.push(errorMessage(error));
      snapshots = await safeReadClientSnapshots(clients);
    } finally {
      mapReports.push({
        mapName: readyMap,
        room,
        pass: mapFailures.length === 0,
        failures: mapFailures,
        snapshots: snapshots.map(compactSnapshot),
        clients: clients.map(compactClient),
      });
      await Promise.all(clients.map((client) => client.context.close().catch(() => undefined)));
    }

    failures.push(...mapFailures.map((failure) => `${readyMap}: ${failure}`));
  }

  return {
    kind: "map-readiness",
    pass: failures.length === 0,
    failures,
    mapCount: options.maps.length,
    passedMapCount: mapReports.filter((report) => report.pass).length,
    maps: mapReports,
    clients: mapReports.flatMap((report) => report.clients),
  };
}

async function runControlledDamageCase(options) {
  const room = createDeepRoomName("dmg", options.mapName, options.spec.weapon, options.direction);
  console.log(`controlled damage: ${options.direction} ${options.spec.weapon} room=${room}`);
  const clients = await Promise.all([
    openClient(options.browser, {
      ...options,
      clientIndex: 0,
      clientsCount: 2,
      debugMultiplayer: true,
      debugMultiplayerInputPaused: true,
      room,
    }),
    openClient(options.browser, {
      ...options,
      clientIndex: 1,
      clientsCount: 2,
      debugMultiplayer: true,
      debugMultiplayerInputPaused: true,
      room,
    }),
  ]);
  try {
    await Promise.all(clients.map((client) =>
      waitForClientReady(client, 2, options.common.timeoutMs, { allowInputPaused: true })
    ));
    await waitForSnapshotPlayers(clients, 2, options.common.timeoutMs);
    const attackerIndex = options.direction === "a-to-b" ? 0 : 1;
    const victimIndex = attackerIndex === 0 ? 1 : 0;
    const attacker = clients[attackerIndex];
    const victim = clients[victimIndex];
    const duelBaseOrigin = (await localSnapshotPlayer(attacker)).origin;
    const pickup = options.spec.pickup
      ? await pickupWeaponForControlledCase(attacker, options.spec.weapon, options.common.timeoutMs)
      : null;
    const pose = await setControlledDuelPose(clients, options.spec, options.direction, {
      baseOrigin: duelBaseOrigin,
      mapName: options.mapName,
      timeoutMs: options.common.timeoutMs,
    });
    await sleep(CONTROLLED_DAMAGE_HISTORY_SETTLE_MS);
    await attacker.page.evaluate((weapon) => window.__cssQuakeDebug?.setWeapon?.(weapon), options.spec.weapon);
    const attackerPlayer = await localSnapshotPlayer(attacker);
    const victimPlayer = await localSnapshotPlayer(victim);
    await attacker.page.evaluate(() => window.__cssQuakeDebug?.setMultiplayerInputPaused?.(false));
    await waitForLocalInput(attacker, options.common.timeoutMs);
    await waitForSnapshotPlayerWeapon(clients, attackerPlayer.clientId, options.spec.weapon, options.common.timeoutMs);
    const remotePoseSamples = [];
    try {
      remotePoseSamples.push({
        observer: "attacker",
        target: "victim",
        sample: await waitForRemoteVisualPose(attacker, victimPlayer.clientId, pose.victimRotY, options.common.timeoutMs),
      });
      remotePoseSamples.push({
        observer: "victim",
        target: "attacker",
        sample: await waitForRemoteVisualPose(victim, attackerPlayer.clientId, pose.attackerRotY, options.common.timeoutMs),
      });
    } catch (error) {
      remotePoseSamples.push({ error: errorMessage(error) });
    }

    const before = await readClientSnapshot(victim);
    const beforeAttacker = await readClientSnapshot(attacker);
    await clearRemoteFrameSamplesForAll(clients);
    const fireResult = await attacker.page.evaluate(() => window.__cssQuakeDebug?.fire?.() ?? null);
    const damageOverlayActivePromise = fireResult === true
      ? waitForDamageOverlayState(victim, true, DAMAGE_OVERLAY_ACTIVE_TIMEOUT_MS)
        .catch((error) => ({ error: errorMessage(error) }))
      : Promise.resolve(null);
    const attackFramePromise = fireResult === true
      ? waitForRemoteFramePrefixes(
        victim,
        attackerPlayer.clientId,
        remoteAttackFramePrefixesForWeapon(options.spec.weapon),
        1_000,
      )
      : Promise.resolve(false);
    const impactParticlesPromise = fireResult === true
      ? waitForImpactParticles(attacker, "blood", 1_000)
      : Promise.resolve(null);
    const victimPainFramePromise = fireResult === true
      ? waitForRemoteFramePrefix(attacker, victimPlayer.clientId, "pain", 1_000)
      : Promise.resolve(false);
    let event = null;
    const failures = [];
    if (fireResult !== true) {
      failures.push(`debug fire returned ${String(fireResult)}`);
    }
    try {
      event = await waitForPlayerEvent(clients, (candidate) =>
        candidate.eventType === "player.damaged" &&
        candidate.attackerPlayerId === attackerPlayer.playerId &&
        candidate.victimPlayerId === victimPlayer.playerId &&
        candidate.damageSource === options.spec.weapon,
        options.common.timeoutMs,
      );
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    let damageOverlayActive = null;
    let damageOverlayCleared = null;
    let damageCueCleared = null;
    if (event) {
      damageOverlayActive = await damageOverlayActivePromise;
      if (damageOverlayActive?.error) {
        failures.push(`victim damage overlay did not activate: ${damageOverlayActive.error}`);
      } else if (damageOverlayActive?.classicHudDamage !== true) {
        failures.push("victim HUD damage cue did not activate");
      } else {
        damageOverlayCleared = await waitForDamageOverlayState(
          victim,
          false,
          DAMAGE_OVERLAY_CLEAR_TIMEOUT_MS,
        ).catch((error) => ({ error: errorMessage(error) }));
        if (damageOverlayCleared?.error) {
          failures.push(`victim damage overlay did not clear after alive damage: ${damageOverlayCleared.error}`);
        }
      }
    } else {
      damageOverlayActive = await damageOverlayActivePromise;
    }
    const impactParticles = await impactParticlesPromise;
    const attackSeen = await attackFramePromise;
    const victimPainSeen = await victimPainFramePromise;
    if (event && damageOverlayActive && !damageOverlayActive.error) {
      damageCueCleared = await waitForHudDamageCueState(
        victim,
        false,
        DAMAGE_CUE_CLEAR_TIMEOUT_MS,
      ).catch((error) => ({ error: errorMessage(error) }));
      if (damageCueCleared?.error) {
        failures.push(`victim HUD damage cue did not clear after alive damage: ${damageCueCleared.error}`);
      }
    }
    const after = await readClientSnapshot(victim);
    const afterAttacker = await readClientSnapshot(attacker);
    if (event) {
      if (event.damage !== options.spec.damage) {
        failures.push(`expected damage ${options.spec.damage}, got ${String(event.damage)}`);
      }
      if (event.health !== 100 - options.spec.damage) {
        failures.push(`expected victim health ${100 - options.spec.damage}, got ${String(event.health)}`);
      }
      if (after.stats?.playerHealth !== event.health) {
        failures.push(`victim local health ${String(after.stats?.playerHealth)} did not match event health ${String(event.health)}`);
      }
    }
    const animation = remoteAnimationSummary(attacker.afterRemoteFrames ?? []);
    if (event && !victimPainSeen) {
      failures.push("attacker did not sample victim pain animation");
    }
    const attackAnimation = remoteAnimationSummary(victim.afterRemoteFrames ?? []);
    if (event && !attackSeen) {
      failures.push("victim did not sample attacker attack animation");
    }
    if (event && (impactParticles?.blood ?? 0) <= 0) {
      failures.push("attacker did not sample remote victim blood particles");
    }
    if (remotePoseSamples.some((sample) => sample.error)) {
      failures.push(`remote pose metadata did not match controlled pose: ${JSON.stringify(remotePoseSamples)}`);
    }
    return {
      kind: "controlled-damage",
      direction: options.direction,
      mapName: options.mapName,
      room,
      weapon: options.spec.weapon,
      expectedDamage: options.spec.damage,
      pass: failures.length === 0,
      failures,
      before: compactSnapshot(before),
      beforeAttacker: compactSnapshot(beforeAttacker),
      after: compactSnapshot(after),
      afterAttacker: compactSnapshot(afterAttacker),
      event,
      fireResult,
      damageOverlayActive,
      damageOverlayCleared,
      damageCueCleared,
      impactParticles,
      remoteAttackAnimation: attackAnimation,
      pickup,
      pose,
      remotePoseSamples,
      attacker: compactClient(attacker),
      victim: compactClient(victim),
      remoteAnimation: animation,
      victimPainSeen,
    };
  } finally {
    await Promise.all(clients.map((client) => client.context.close().catch(() => undefined)));
  }
}

async function runControlledSustainedDamageCase(options) {
  const room = createDeepRoomName("sustain", options.mapName, options.spec.weapon, options.spec.direction);
  console.log(`sustained damage: ${options.spec.direction} ${options.spec.weapon} room=${room}`);
  const clients = await Promise.all([
    openClient(options.browser, {
      ...options,
      clientIndex: 0,
      clientsCount: 2,
      debugMultiplayer: true,
      debugMultiplayerInputPaused: true,
      room,
    }),
    openClient(options.browser, {
      ...options,
      clientIndex: 1,
      clientsCount: 2,
      debugMultiplayer: true,
      debugMultiplayerInputPaused: true,
      room,
    }),
  ]);
  try {
    await Promise.all(clients.map((client) =>
      waitForClientReady(client, 2, options.common.timeoutMs, { allowInputPaused: true })
    ));
    await waitForSnapshotPlayers(clients, 2, options.common.timeoutMs);
    const attackerIndex = options.spec.direction === "a-to-b" ? 0 : 1;
    const victimIndex = attackerIndex === 0 ? 1 : 0;
    const attacker = clients[attackerIndex];
    const victim = clients[victimIndex];
    const duelBaseOrigin = (await localSnapshotPlayer(attacker)).origin;
    const pickup = options.spec.pickup
      ? await pickupWeaponForControlledCase(attacker, options.spec.weapon, options.common.timeoutMs)
      : null;
    let pose = await setControlledDuelPose(clients, options.spec, options.spec.direction, {
      baseOrigin: duelBaseOrigin,
      mapName: options.mapName,
      timeoutMs: options.common.timeoutMs,
    });
    await sleep(CONTROLLED_DAMAGE_HISTORY_SETTLE_MS);
    await attacker.page.evaluate((weapon) => window.__cssQuakeDebug?.setWeapon?.(weapon), options.spec.weapon);
    const attackerPlayer = await localSnapshotPlayer(attacker);
    const victimPlayer = await localSnapshotPlayer(victim);
    await attacker.page.evaluate(() => window.__cssQuakeDebug?.setMultiplayerInputPaused?.(false));
    await waitForLocalInput(attacker, options.common.timeoutMs);
    await waitForSnapshotPlayerWeapon(clients, attackerPlayer.clientId, options.spec.weapon, options.common.timeoutMs);

    const before = await readClientSnapshot(victim);
    const beforeAttacker = await readClientSnapshot(attacker);
    const failures = [];
    const events = [];
    const fireResults = [];
    const impactParticles = [];
    const poseUpdates = [pose];
    let painSeen = false;
    for (let index = 0; index < options.spec.expectedHealths.length; index += 1) {
      if (index > 0) await sleep(options.spec.intervalMs);
      pose = await setControlledDuelPose(clients, options.spec, options.spec.direction, {
        baseOrigin: duelBaseOrigin,
        mapName: options.mapName,
        timeoutMs: options.common.timeoutMs,
      });
      poseUpdates.push(pose);
      await sleep(100);
      const expectedHealth = options.spec.expectedHealths[index];
      const fireResult = await attacker.page.evaluate(() => window.__cssQuakeDebug?.fire?.() ?? null);
      fireResults.push(fireResult);
      if (fireResult !== true) {
        failures.push(`debug fire ${index + 1} returned ${String(fireResult)}`);
        continue;
      }
      const particlesPromise = waitForImpactParticles(attacker, "blood", 750);
      const painFramePromise = waitForRemoteFramePrefix(attacker, victimPlayer.clientId, "pain", 750);
      try {
        const event = await waitForPlayerEvent(clients, (candidate) =>
          candidate.eventType === "player.damaged" &&
          candidate.attackerPlayerId === attackerPlayer.playerId &&
          candidate.victimPlayerId === victimPlayer.playerId &&
          candidate.damageSource === options.spec.weapon &&
          candidate.health === expectedHealth,
          options.common.timeoutMs,
        );
        events.push(event);
        if (event.damage !== options.spec.damage) {
          failures.push(`shot ${index + 1} expected damage ${options.spec.damage}, got ${String(event.damage)}`);
        }
      } catch (error) {
        failures.push(`shot ${index + 1}: ${errorMessage(error)}`);
      }
      const particles = await particlesPromise;
      impactParticles.push(particles);
      painSeen = (await painFramePromise) || painSeen;
    }

    const after = await readClientSnapshot(victim);
    const afterAttacker = await readClientSnapshot(attacker);
    const finalHealth = options.spec.expectedHealths.at(-1);
    if (after.stats?.playerHealth !== finalHealth) {
      failures.push(`expected final victim local health ${finalHealth}, got ${String(after.stats?.playerHealth)}`);
    }
    const victimSnapshotPlayer = after.trace.lastSnapshot?.players?.find((player) => player.playerId === victimPlayer.playerId);
    if (victimSnapshotPlayer?.health !== finalHealth) {
      failures.push(`expected final victim snapshot health ${finalHealth}, got ${String(victimSnapshotPlayer?.health)}`);
    }
    if (events.length !== options.spec.expectedHealths.length) {
      failures.push(`expected ${options.spec.expectedHealths.length} damage events, got ${events.length}`);
    }
    const rejects = [...(after.trace.rejects ?? []), ...(afterAttacker.trace.rejects ?? [])];
    if (rejects.length) failures.push(`unexpected room rejects during sustained damage: ${JSON.stringify(rejects)}`);
    if (!painSeen) failures.push("attacker did not sample victim pain animation during sustained damage");
    if (!impactParticles.some((particles) => (particles?.blood ?? 0) > 0)) {
      failures.push("attacker did not sample blood particles during sustained damage");
    }
    const animation = remoteAnimationSummary(attacker.afterRemoteFrames ?? []);
    return {
      kind: "controlled-sustained-damage",
      direction: options.spec.direction,
      mapName: options.mapName,
      room,
      weapon: options.spec.weapon,
      expectedDamage: options.spec.damage,
      expectedHealths: options.spec.expectedHealths,
      pass: failures.length === 0,
      failures,
      before: compactSnapshot(before),
      beforeAttacker: compactSnapshot(beforeAttacker),
      after: compactSnapshot(after),
      afterAttacker: compactSnapshot(afterAttacker),
      events,
      fireResults,
      impactParticles,
      pickup,
      pose,
      poseUpdates,
      attacker: compactClient(attacker),
      victim: compactClient(victim),
      remoteAnimation: animation,
    };
  } finally {
    await Promise.all(clients.map((client) => client.context.close().catch(() => undefined)));
  }
}

async function runControlledKillCase(options) {
  const spec = { weapon: "shotgun", damage: 24, distance: 3.0 };
  const room = createDeepRoomName("kill", options.mapName, "shotgun");
  console.log(`controlled kill: shotgun room=${room}`);
  const clients = await Promise.all([
    openClient(options.browser, {
      ...options,
      clientIndex: 0,
      clientsCount: 2,
      debugMultiplayer: true,
      debugMultiplayerInputPaused: true,
      room,
    }),
    openClient(options.browser, {
      ...options,
      clientIndex: 1,
      clientsCount: 2,
      debugMultiplayer: true,
      debugMultiplayerInputPaused: true,
      room,
    }),
  ]);
  try {
    await Promise.all(clients.map((client) =>
      waitForClientReady(client, 2, options.common.timeoutMs, { allowInputPaused: true })
    ));
    await waitForSnapshotPlayers(clients, 2, options.common.timeoutMs);
    let pose = await setControlledDuelPose(clients, spec, "a-to-b", {
      mapName: options.mapName,
      timeoutMs: options.common.timeoutMs,
    });
    await Promise.all(clients.map((client) => client.page.evaluate(() => window.__cssQuakeDebug?.setWeapon?.("shotgun"))));
    const attacker = clients[0];
    const victim = clients[1];
    await attacker.page.evaluate(() => window.__cssQuakeDebug?.setMultiplayerInputPaused?.(false));
    await waitForLocalInput(attacker, options.common.timeoutMs);

    const attackerPlayer = await localSnapshotPlayer(attacker);
    const victimPlayer = await localSnapshotPlayer(victim);
    const before = await readClientSnapshot(victim);
    const beforeAttacker = await readClientSnapshot(attacker);
    const failures = [];
    const fireResults = [];
    const poseUpdates = [pose];
    let killEvent = null;
    let backpackEvent = null;
    let backpackStats = null;
    await clearRemoteFrameSamples(attacker);
    for (let index = 0; index < 6; index += 1) {
      pose = await setControlledDuelPose(clients, spec, "a-to-b", {
        mapName: options.mapName,
        timeoutMs: options.common.timeoutMs,
      });
      poseUpdates.push(pose);
      await sleep(150);
      const fireResult = await attacker.page.evaluate(() => window.__cssQuakeDebug?.fire?.() ?? null);
      fireResults.push(fireResult);
      if (fireResult !== true) failures.push(`debug fire ${index + 1} returned ${String(fireResult)}`);
      try {
        killEvent = await waitForPlayerEvent(clients, (candidate) =>
          candidate.eventType === "player.killed" &&
          candidate.attackerPlayerId === attackerPlayer.playerId &&
          candidate.victimPlayerId === victimPlayer.playerId &&
          candidate.damageSource === "shotgun",
          650,
        );
      } catch {
        // Keep firing until cumulative shotgun damage kills the victim.
      }
      if (killEvent) break;
      await sleep(600);
    }
    if (!killEvent) failures.push("Timed out waiting for authoritative shotgun kill.");
    const impactParticlesPromise = killEvent
      ? waitForImpactParticles(attacker, "blood", 1_000)
      : Promise.resolve(null);
    const deathFramePromise = killEvent
      ? waitForRemoteFramePrefix(attacker, victimPlayer.clientId, "deatha", 1_500)
      : Promise.resolve(false);
    if (killEvent) {
      try {
        backpackEvent = await waitForRoomEvent(clients, (candidate) =>
          candidate.eventType === "pickup.dropped" &&
          candidate.sourcePlayerId === victimPlayer.playerId,
          1_000,
        );
      } catch (error) {
        failures.push(`dropped backpack event: ${errorMessage(error)}`);
      }
    }
    const impactParticles = await impactParticlesPromise;
    const deathFrameSeen = await deathFramePromise;
    const after = await readClientSnapshot(victim);
    const afterAttacker = await readClientSnapshot(attacker);
    if (backpackEvent) {
      backpackStats = await attacker.page.evaluate(() => window.__cssQuakeDebug?.stats?.()?.pickups ?? null);
      if (!backpackStats?.runtimeEntityIndexes?.includes(backpackEvent.definition.entityIndex)) {
        failures.push(`dropped backpack ${backpackEvent.definition.entityIndex} was not registered as a runtime pickup`);
      }
      const snapshotHasBackpack = afterAttacker.trace.lastSnapshot?.dynamicPickups?.some((definition) =>
        definition.entityIndex === backpackEvent.definition.entityIndex
      );
      if (!snapshotHasBackpack) {
        failures.push(`dropped backpack ${backpackEvent.definition.entityIndex} was missing from the browser snapshot`);
      }
    }
    const victimSnapshotPlayer = after.trace.lastSnapshot?.players?.find((player) => player.playerId === victimPlayer.playerId);
    if (killEvent) {
      if (victimSnapshotPlayer?.alive !== false) failures.push("victim snapshot did not mark player dead");
      if ((victimSnapshotPlayer?.health ?? 1) > 0) {
        failures.push(`expected victim health <= 0 after kill, got ${String(victimSnapshotPlayer?.health)}`);
      }
    }
    const animation = remoteAnimationSummary(attacker.afterRemoteFrames ?? []);
    if (killEvent && !deathFrameSeen) {
      failures.push("attacker did not sample victim death animation");
    }
    if (killEvent && (impactParticles?.blood ?? 0) <= 0) {
      failures.push("attacker did not sample victim kill blood particles");
    }
    return {
      kind: "controlled-kill",
      mapName: options.mapName,
      room,
      weapon: "shotgun",
      pass: failures.length === 0,
      failures,
      before: compactSnapshot(before),
      beforeAttacker: compactSnapshot(beforeAttacker),
      after: compactSnapshot(after),
      afterAttacker: compactSnapshot(afterAttacker),
      event: killEvent,
      backpackEvent,
      backpackStats,
      fireResults,
      impactParticles,
      deathFrameSeen,
      pose,
      poseUpdates,
      attacker: compactClient(attacker),
      victim: compactClient(victim),
      remoteAnimation: animation,
    };
  } finally {
    await Promise.all(clients.map((client) => client.context.close().catch(() => undefined)));
  }
}

async function runControlledRespawnCase(options) {
  const spec = { weapon: "shotgun", damage: 24, distance: 3.0 };
  const room = createDeepRoomName("respawn", options.mapName, "shotgun");
  console.log(`controlled respawn: shotgun room=${room}`);
  const clients = await Promise.all([
    openClient(options.browser, {
      ...options,
      clientIndex: 0,
      clientsCount: 2,
      debugMultiplayer: true,
      debugMultiplayerInputPaused: true,
      room,
    }),
    openClient(options.browser, {
      ...options,
      clientIndex: 1,
      clientsCount: 2,
      debugMultiplayer: true,
      debugMultiplayerInputPaused: true,
      room,
    }),
  ]);
  try {
    await Promise.all(clients.map((client) =>
      waitForClientReady(client, 2, options.common.timeoutMs, { allowInputPaused: true })
    ));
    await waitForSnapshotPlayers(clients, 2, options.common.timeoutMs);
    let pose = await setControlledDuelPose(clients, spec, "a-to-b", {
      mapName: options.mapName,
      timeoutMs: options.common.timeoutMs,
    });
    await Promise.all(clients.map((client) => client.page.evaluate(() => window.__cssQuakeDebug?.setWeapon?.("shotgun"))));
    const attacker = clients[0];
    const victim = clients[1];
    await attacker.page.evaluate(() => window.__cssQuakeDebug?.setMultiplayerInputPaused?.(false));
    await waitForLocalInput(attacker, options.common.timeoutMs);

    const attackerPlayer = await localSnapshotPlayer(attacker);
    const victimPlayer = await localSnapshotPlayer(victim);
    const before = await readClientSnapshot(victim);
    const beforeAttacker = await readClientSnapshot(attacker);
    const failures = [];
    const fireResults = [];
    const poseUpdates = [pose];
    let killEvent = null;
    let deathOverlayActive = null;
    let respawnOverlayCleared = null;
    let respawnCueCleared = null;
    await clearRemoteFrameSamples(attacker);
    for (let index = 0; index < 6; index += 1) {
      pose = await setControlledDuelPose(clients, spec, "a-to-b", {
        mapName: options.mapName,
        timeoutMs: options.common.timeoutMs,
      });
      poseUpdates.push(pose);
      await sleep(150);
      const fireResult = await attacker.page.evaluate(() => window.__cssQuakeDebug?.fire?.() ?? null);
      fireResults.push(fireResult);
      if (fireResult !== true) failures.push(`debug fire ${index + 1} returned ${String(fireResult)}`);
      try {
        killEvent = await waitForPlayerEvent(clients, (candidate) =>
          candidate.eventType === "player.killed" &&
          candidate.attackerPlayerId === attackerPlayer.playerId &&
          candidate.victimPlayerId === victimPlayer.playerId &&
          candidate.damageSource === "shotgun",
          650,
        );
      } catch {
        // Keep firing until cumulative shotgun damage kills the victim.
      }
      if (killEvent) break;
      await sleep(600);
    }
    if (!killEvent) failures.push("Timed out waiting for authoritative shotgun kill before respawn.");
    const deathFramePromise = killEvent
      ? waitForRemoteFramePrefix(attacker, victimPlayer.clientId, "deatha", 1_500)
      : Promise.resolve(false);
    if (killEvent) {
      deathOverlayActive = await waitForDamageOverlayState(
        victim,
        true,
        DAMAGE_OVERLAY_ACTIVE_TIMEOUT_MS,
      ).catch((error) => ({ error: errorMessage(error) }));
      if (deathOverlayActive?.error) {
        failures.push(`victim death damage overlay did not activate: ${deathOverlayActive.error}`);
      } else if (deathOverlayActive?.classicHudDamage !== true) {
        failures.push("victim death HUD damage cue did not activate");
      }
    }
    const deathFrameSeen = await deathFramePromise;
    const deathAnimation = remoteAnimationSummary(attacker.afterRemoteFrames ?? []);
    if (killEvent && !deathFrameSeen) {
      failures.push("attacker did not sample victim death animation before respawn");
    }

    let respawnEvent = null;
    if (killEvent) {
      try {
        respawnEvent = await waitForPlayerEvent(clients, (candidate) =>
          candidate.eventType === "player.respawned" &&
          candidate.player?.playerId === victimPlayer.playerId,
          options.common.timeoutMs,
        );
      } catch (error) {
        failures.push(`respawn: ${errorMessage(error)}`);
      }
    }
    if (respawnEvent) {
      await waitForSnapshotPlayerState(clients, {
        alive: true,
        health: 100,
        playerId: victimPlayer.playerId,
      }, options.common.timeoutMs);
      await waitForRemoteDomCounts(clients, 1, options.common.timeoutMs);
      respawnOverlayCleared = await waitForDamageOverlayState(
        victim,
        false,
        DAMAGE_OVERLAY_CLEAR_TIMEOUT_MS,
      ).catch((error) => ({ error: errorMessage(error) }));
      if (respawnOverlayCleared?.error) {
        failures.push(`victim damage overlay did not clear after respawn: ${respawnOverlayCleared.error}`);
      }
      respawnCueCleared = await waitForHudDamageCueState(
        victim,
        false,
        DAMAGE_CUE_CLEAR_TIMEOUT_MS,
      ).catch((error) => ({ error: errorMessage(error) }));
      if (respawnCueCleared?.error) {
        failures.push(`victim HUD damage cue did not clear after respawn: ${respawnCueCleared.error}`);
      }
    }

    const afterRespawn = await readClientSnapshot(victim);
    const afterRespawnAttacker = await readClientSnapshot(attacker);
    const respawnedVictim = snapshotPlayer(afterRespawn, victimPlayer.playerId);
    const respawnedAttacker = snapshotPlayer(afterRespawn, attackerPlayer.playerId);
    if (respawnEvent) {
      if (!respawnedVictim?.alive) failures.push("victim snapshot did not mark player alive after respawn");
      if (respawnedVictim?.health !== 100) {
        failures.push(`expected victim health 100 after respawn, got ${String(respawnedVictim?.health)}`);
      }
      if (afterRespawn.stats?.playerHealth !== 100) {
        failures.push(`victim local health after respawn ${String(afterRespawn.stats?.playerHealth)} did not reset to 100`);
      }
      if (respawnedVictim?.deaths !== 1) {
        failures.push(`expected victim deaths 1 after respawn, got ${String(respawnedVictim?.deaths)}`);
      }
      if (respawnedAttacker?.frags !== 1) {
        failures.push(`expected attacker frags 1 after respawn, got ${String(respawnedAttacker?.frags)}`);
      }
      const attackerRemoteVictim = afterRespawnAttacker.remotePlayers
        .filter((player) => player.clientId === victimPlayer.clientId);
      if (attackerRemoteVictim.length !== 1) {
        failures.push(`expected one remote victim DOM after respawn, got ${attackerRemoteVictim.length}`);
      } else if (attackerRemoteVictim[0].hidden) {
        failures.push("remote victim DOM stayed hidden after respawn");
      }
    }

    let postRespawnDamage = null;
    let postRespawnImpactParticles = null;
    let postRespawnPainSeen = false;
    if (respawnEvent) {
      await sleep(650);
      const duelBaseOrigin = (await localSnapshotPlayer(attacker)).origin;
      pose = await setControlledDuelPose(clients, spec, "a-to-b", {
        baseOrigin: duelBaseOrigin,
        mapName: options.mapName,
        timeoutMs: options.common.timeoutMs,
      });
      poseUpdates.push(pose);
      await sleep(CONTROLLED_DAMAGE_HISTORY_SETTLE_MS);
      await clearRemoteFrameSamples(attacker);
      const fireResult = await attacker.page.evaluate(() => window.__cssQuakeDebug?.fire?.() ?? null);
      fireResults.push(fireResult);
      if (fireResult !== true) {
        failures.push(`post-respawn debug fire returned ${String(fireResult)}`);
      } else {
        const particlesPromise = waitForImpactParticles(attacker, "blood", 1_000);
        const painFramePromise = waitForRemoteFramePrefix(attacker, victimPlayer.clientId, "pain", 1_000);
        try {
          postRespawnDamage = await waitForPlayerEvent(clients, (candidate) =>
            candidate.eventType === "player.damaged" &&
            candidate.attackerPlayerId === attackerPlayer.playerId &&
            candidate.victimPlayerId === victimPlayer.playerId &&
            candidate.damageSource === "shotgun" &&
            candidate.health === 76 &&
            candidate.roomTime > respawnEvent.roomTime,
            options.common.timeoutMs,
          );
        } catch (error) {
          failures.push(`post-respawn damage: ${errorMessage(error)}`);
        }
        postRespawnImpactParticles = await particlesPromise;
        postRespawnPainSeen = await painFramePromise;
      }
    }

    const afterPostDamage = await readClientSnapshot(victim);
    const afterPostDamageAttacker = await readClientSnapshot(attacker);
    const postDamageVictim = snapshotPlayer(afterPostDamage, victimPlayer.playerId);
    if (postRespawnDamage) {
      if (postRespawnDamage.damage !== 24) {
        failures.push(`expected post-respawn damage 24, got ${String(postRespawnDamage.damage)}`);
      }
      if (postDamageVictim?.health !== 76) {
        failures.push(`expected victim snapshot health 76 after post-respawn damage, got ${String(postDamageVictim?.health)}`);
      }
      if (afterPostDamage.stats?.playerHealth !== 76) {
        failures.push(`expected victim local health 76 after post-respawn damage, got ${String(afterPostDamage.stats?.playerHealth)}`);
      }
      if ((postRespawnImpactParticles?.blood ?? 0) <= 0) {
        failures.push("attacker did not sample blood particles after respawn damage");
      }
    }
    const rejects = [
      ...(afterRespawn.trace.rejects ?? []),
      ...(afterRespawnAttacker.trace.rejects ?? []),
      ...(afterPostDamage.trace.rejects ?? []),
      ...(afterPostDamageAttacker.trace.rejects ?? []),
    ];
    if (rejects.length) failures.push(`unexpected room rejects during respawn flow: ${JSON.stringify(rejects)}`);
    const postAnimation = remoteAnimationSummary(attacker.afterRemoteFrames ?? []);
    if (postRespawnDamage && !postRespawnPainSeen) {
      failures.push("attacker did not sample victim pain animation after respawn damage");
    }

    return {
      kind: "controlled-respawn",
      mapName: options.mapName,
      room,
      weapon: "shotgun",
      pass: failures.length === 0,
      failures,
      before: compactSnapshot(before),
      beforeAttacker: compactSnapshot(beforeAttacker),
      afterRespawn: compactSnapshot(afterRespawn),
      afterRespawnAttacker: compactSnapshot(afterRespawnAttacker),
      afterPostDamage: compactSnapshot(afterPostDamage),
      afterPostDamageAttacker: compactSnapshot(afterPostDamageAttacker),
      deathAnimation,
      deathFrameSeen,
      deathOverlayActive,
      event: killEvent,
      fireResults,
      pose,
      poseUpdates,
      postRespawnDamage,
      postRespawnImpactParticles,
      postRespawnPainSeen,
      respawnCueCleared,
      respawnOverlayCleared,
      respawnEvent,
      postAnimation,
      attacker: compactClient(attacker),
      victim: compactClient(victim),
    };
  } finally {
    await Promise.all(clients.map((client) => client.context.close().catch(() => undefined)));
  }
}

async function runControlledProjectileVisualCase(options) {
  const spec = options.spec;
  const room = createDeepRoomName("proj", options.mapName, spec.weapon);
  console.log(`controlled projectile visual: ${spec.weapon} room=${room}`);
  const clients = await Promise.all([
    openClient(options.browser, {
      ...options,
      clientIndex: 0,
      clientsCount: 2,
      debugMultiplayer: true,
      debugMultiplayerInputPaused: true,
      room,
    }),
    openClient(options.browser, {
      ...options,
      clientIndex: 1,
      clientsCount: 2,
      debugMultiplayer: true,
      debugMultiplayerInputPaused: true,
      room,
    }),
  ]);
  try {
    await Promise.all(clients.map((client) =>
      waitForClientReady(client, 2, options.common.timeoutMs, { allowInputPaused: true })
    ));
    await waitForSnapshotPlayers(clients, 2, options.common.timeoutMs);
    const attacker = clients[0];
    const victim = clients[1];
    const duelBaseOrigin = (await localSnapshotPlayer(attacker)).origin;
    const pickup = await pickupWeaponForControlledCase(attacker, spec.weapon, options.common.timeoutMs);
    await waitForSnapshotPlayerWeapon(clients, pickup.player.clientId, spec.weapon, options.common.timeoutMs);
    const pose = await setControlledDuelPose(clients, spec, "a-to-b", {
      baseOrigin: duelBaseOrigin,
      mapName: options.mapName,
      timeoutMs: options.common.timeoutMs,
    });
    await sleep(CONTROLLED_DAMAGE_HISTORY_SETTLE_MS);
    await Promise.all(clients.map((client) => client.page.evaluate((weapon) => window.__cssQuakeDebug?.setWeapon?.(weapon), spec.weapon)));

    const attackerPlayer = await localSnapshotPlayer(attacker);
    const victimPlayer = await localSnapshotPlayer(victim);
    await attacker.page.evaluate(() => window.__cssQuakeDebug?.setMultiplayerInputPaused?.(false));
    await waitForLocalInput(attacker, options.common.timeoutMs);
    await waitForSnapshotPlayerWeapon(clients, attackerPlayer.clientId, spec.weapon, options.common.timeoutMs);

    const before = await readClientSnapshot(victim);
    const beforeAttacker = await readClientSnapshot(attacker);
    const failures = [];
    await clearRemoteFrameSamplesForAll(clients);
    const fireResult = await attacker.page.evaluate(() => window.__cssQuakeDebug?.fire?.() ?? null);
    const attackFramePromise = fireResult === true
      ? waitForRemoteFramePrefixes(
        victim,
        attackerPlayer.clientId,
        remoteAttackFramePrefixesForWeapon(spec.weapon),
        1_000,
      )
      : Promise.resolve(false);
    if (fireResult !== true) failures.push(`debug fire returned ${String(fireResult)}`);

    let spawned = null;
    let impacted = null;
    let explosionSprite = null;
    let visibleProjectile = null;
    let movedProjectile = null;
    let postImpact = null;
    let postImpactAttacker = null;
    let projectileFlightMs = null;
    if (fireResult === true) {
      try {
        spawned = await waitForRoomEvent(clients, (candidate) =>
          candidate.eventType === "projectile.spawned" &&
          candidate.projectile?.ownerPlayerId === attackerPlayer.playerId &&
          candidate.projectile?.weapon === spec.weapon,
          options.common.timeoutMs,
        );
        const projectileResult = await waitForRemoteProjectilePresentationOrImpact(
          victim,
          clients,
          spawned.projectile.projectileId,
          options.common.timeoutMs,
        );
        visibleProjectile = projectileResult.visibleProjectile;
        movedProjectile = projectileResult.movedProjectile;
        impacted = projectileResult.impacted;
        projectileFlightMs = Number(impacted?.roomTime) - Number(spawned.roomTime);
        postImpact = impacted ? await readClientSnapshot(victim) : null;
        postImpactAttacker = impacted ? await readClientSnapshot(attacker) : null;
        explosionSprite = await waitForExplosionSprite(victim, 1_000);
        await waitForNoRemoteProjectileDom(victim, spawned.projectile.projectileId, 2_000);
      } catch (error) {
        failures.push(errorMessage(error));
      }
    }

    const attackSeen = await attackFramePromise;
    const finalAfter = await readClientSnapshot(victim);
    const finalAfterAttacker = await readClientSnapshot(attacker);
    const after = postImpact ?? finalAfter;
    const afterAttacker = postImpactAttacker ?? finalAfterAttacker;
    const attackAnimation = remoteAnimationSummary(victim.afterRemoteFrames ?? []);
    const firedDecision = [
      ...(after.trace.roomEvents ?? []),
      ...(afterAttacker.trace.roomEvents ?? []),
    ].findLast((event) =>
      event?.eventType === "player.fired" &&
      event?.playerId === attackerPlayer.playerId &&
      event?.weapon === spec.weapon
    )?.decision;
    if (firedDecision?.outcome !== "projectile-spawned") {
      failures.push(`expected projectile-spawned decision, got ${JSON.stringify(firedDecision ?? null)}`);
    }
    if (impacted) {
      if (spec.expectedImpactKind && impacted.impactKind !== spec.expectedImpactKind) {
        failures.push(`expected ${spec.weapon} impact kind ${spec.expectedImpactKind}, got ${String(impacted.impactKind)}`);
      }
      if (impacted.targetPlayerId !== victimPlayer.playerId) {
        failures.push(`expected ${spec.weapon} impact target ${victimPlayer.playerId}, got ${String(impacted.targetPlayerId)}`);
      }
      if (spec.expectedPlayerDamageCount !== undefined &&
        impacted.playerDamageCount !== spec.expectedPlayerDamageCount) {
        failures.push(`expected ${spec.weapon} player damage count ${spec.expectedPlayerDamageCount}, got ${String(impacted.playerDamageCount)}`);
      }
    }
    const victimEvent = findPlayerDamageOutcome(after, {
      attackerPlayerId: attackerPlayer.playerId,
      damageSource: spec.weapon,
      eventType: spec.expectedVictimEventType,
      victimPlayerId: victimPlayer.playerId,
    });
    if (!victimEvent) {
      failures.push(`expected ${spec.weapon} ${spec.expectedVictimEventType} event for projectile victim`);
    } else {
      if (spec.expectedVictimDamage !== undefined && victimEvent.damage !== spec.expectedVictimDamage) {
        failures.push(`expected ${spec.weapon} victim damage ${spec.expectedVictimDamage}, got ${String(victimEvent.damage)}`);
      }
      if ("health" in victimEvent &&
        spec.expectedVictimHealth !== undefined &&
        victimEvent.health !== spec.expectedVictimHealth) {
        failures.push(`expected ${spec.weapon} victim event health ${spec.expectedVictimHealth}, got ${String(victimEvent.health)}`);
      }
    }
    const victimSnapshotAfterImpact = snapshotPlayer(after, victimPlayer.playerId);
    if (spec.expectedVictimHealth !== undefined) {
      const snapshotHealth = victimSnapshotAfterImpact?.health ?? null;
      if (snapshotHealth !== spec.expectedVictimHealth) {
        failures.push(`expected ${spec.weapon} victim snapshot health ${spec.expectedVictimHealth}, got ${String(snapshotHealth)}`);
      }
      if (after.stats?.playerHealth !== spec.expectedVictimHealth) {
        failures.push(`expected ${spec.weapon} victim local health ${spec.expectedVictimHealth}, got ${String(after.stats?.playerHealth)}`);
      }
    }
    if (spec.expectedSelfDamage !== undefined) {
      const selfEvent = findPlayerDamageOutcome(afterAttacker, {
        attackerPlayerId: attackerPlayer.playerId,
        damageSource: spec.weapon,
        eventType: "player.damaged",
        victimPlayerId: attackerPlayer.playerId,
      });
      if (!selfEvent) {
        failures.push(`expected ${spec.weapon} self-damage event`);
      } else if (selfEvent.damage !== spec.expectedSelfDamage) {
        failures.push(`expected ${spec.weapon} self damage ${spec.expectedSelfDamage}, got ${String(selfEvent.damage)}`);
      }
    }
    if (spec.expectedAttackerHealth !== undefined &&
      afterAttacker.stats?.playerHealth !== spec.expectedAttackerHealth) {
      failures.push(`expected ${spec.weapon} attacker local health ${spec.expectedAttackerHealth}, got ${String(afterAttacker.stats?.playerHealth)}`);
    }
    const projectilePresentationExpected = !Number.isFinite(projectileFlightMs) || projectileFlightMs >= 250;
    if (spawned && !visibleProjectile && projectilePresentationExpected) {
      failures.push("victim did not render remote projectile DOM before impact");
    }
    if (spawned && !movedProjectile && projectilePresentationExpected) {
      failures.push("victim remote projectile DOM did not receive a moved snapshot before impact");
    }
    if (spawned && !attackSeen) failures.push("victim did not sample projectile attacker attack animation");
    if (impacted && !explosionSprite) failures.push("victim did not render projectile explosion sprite after impact");
    if (impacted && (finalAfter.stats?.multiplayer?.remoteProjectileDomCount ?? 0) !== 0) {
      failures.push(`remote projectile DOM leaked after impact: ${finalAfter.stats?.multiplayer?.remoteProjectileDomCount}`);
    }

    return {
      kind: "controlled-projectile",
      mapName: options.mapName,
      room,
      weapon: spec.weapon,
      pass: failures.length === 0,
      failures,
      before: compactSnapshot(before),
      beforeAttacker: compactSnapshot(beforeAttacker),
      after: compactSnapshot(after),
      afterAttacker: compactSnapshot(afterAttacker),
      finalAfter: compactSnapshot(finalAfter),
      finalAfterAttacker: compactSnapshot(finalAfterAttacker),
      explosionSprite,
      fireResult,
      firedDecision,
      impacted,
      movedProjectile,
      projectileFlightMs,
      remoteAttackAnimation: attackAnimation,
      pickup,
      pose,
      spawned,
      visibleProjectile,
      attacker: compactClient(attacker),
      victim: compactClient(victim),
    };
  } finally {
    await Promise.all(clients.map((client) => client.context.close().catch(() => undefined)));
  }
}

async function runSharedPickupStateCase(options) {
  const room = createDeepRoomName("pickup", options.mapName, "supershotgun");
  console.log(`shared pickup state: supershotgun room=${room}`);
  const clients = await Promise.all([
    openClient(options.browser, {
      ...options,
      clientIndex: 0,
      clientsCount: 2,
      debugMultiplayer: true,
      debugMultiplayerInputPaused: true,
      room,
    }),
    openClient(options.browser, {
      ...options,
      clientIndex: 1,
      clientsCount: 2,
      debugMultiplayer: true,
      debugMultiplayerInputPaused: true,
      room,
    }),
  ]);
  try {
    await Promise.all(clients.map((client) =>
      waitForClientReady(client, 2, options.common.timeoutMs, { allowInputPaused: true })
    ));
    await waitForSnapshotPlayers(clients, 2, options.common.timeoutMs);
    const actor = clients[0];
    const observer = clients[1];
    const pickup = await pickupWeaponForControlledCase(actor, "supershotgun", options.common.timeoutMs);
    try {
      await waitForPickupSnapshotUnavailable(clients, pickup.pickupEntityIndex, options.common.timeoutMs);
    } catch (error) {
      const snapshots = await safeReadClientSnapshots(clients);
      return {
        kind: "shared-pickup",
        mapName: options.mapName,
        room,
        weapon: "supershotgun",
        pass: false,
        failures: [`pickup unavailable snapshot: ${errorMessage(error)}`],
        actor: compactClient(actor),
        observer: compactClient(observer),
        afterFirst: snapshots.map(compactSnapshot),
        afterDuplicate: [],
        duplicateRejected: null,
        duplicateRequested: null,
        pickup,
        takenEvents: await uniqueRoomEvents(clients, (event) =>
          event.eventType === "pickup.taken" &&
          event.entityIndex === pickup.pickupEntityIndex
        ),
      };
    }
    const afterFirst = await safeReadClientSnapshots(clients);
    const firstTakenEvents = await uniqueRoomEvents(clients, (event) =>
      event.eventType === "pickup.taken" &&
      event.entityIndex === pickup.pickupEntityIndex
    );

    await sleep(300);
    const duplicateRequested = await actor.page.evaluate((entityIndex) =>
      window.__cssQuakeDebug?.requestMultiplayerPickup?.(entityIndex) ?? false,
      pickup.pickupEntityIndex,
    );
    let duplicateRejected = null;
    const failures = [];
    if (!duplicateRequested) failures.push("duplicate pickup request did not leave the client");
    try {
      duplicateRejected = await waitForRoomEvent(clients, (event) =>
        event.eventType === "pickup.rejected" &&
        event.entityIndex === pickup.pickupEntityIndex &&
        event.playerId === pickup.player.playerId &&
        event.reason === "unavailable",
        2_000,
      );
    } catch (error) {
      failures.push(`duplicate unavailable pickup rejection: ${errorMessage(error)}`);
    }
    await sleep(100);
    const afterDuplicate = await safeReadClientSnapshots(clients);
    const takenEvents = await uniqueRoomEvents(clients, (event) =>
      event.eventType === "pickup.taken" &&
      event.entityIndex === pickup.pickupEntityIndex
    );
    const rejects = afterDuplicate.flatMap((snapshot) => snapshot.trace.rejects ?? []);
    if (rejects.length) failures.push(`unexpected room rejects during shared pickup: ${JSON.stringify(rejects)}`);
    if (firstTakenEvents.length !== 1) {
      failures.push(`expected one first pickup.taken event, got ${firstTakenEvents.length}`);
    }
    if (takenEvents.length !== 1) {
      failures.push(`expected duplicate pickup not to emit pickup.taken, got ${takenEvents.length}`);
    }
    for (const [index, snapshot] of afterDuplicate.entries()) {
      const pickupState = snapshot.trace.lastSnapshot?.pickups?.find((candidate) =>
        candidate.entityIndex === pickup.pickupEntityIndex
      );
      if (!pickupState) {
        failures.push(`client ${index} snapshot missing pickup ${pickup.pickupEntityIndex}`);
      } else if (pickupState.available !== false) {
        failures.push(`client ${index} pickup ${pickup.pickupEntityIndex} availability ${String(pickupState.available)} after take`);
      }
      const pickupStats = snapshot.stats?.pickups ?? null;
      if (!pickupStats?.pickedEntityIndexes?.includes(pickup.pickupEntityIndex)) {
        failures.push(`client ${index} pickup stats did not mark ${pickup.pickupEntityIndex} picked`);
      }
      if (!pickupStats?.hiddenEntityIndexes?.includes(pickup.pickupEntityIndex)) {
        failures.push(`client ${index} pickup stats did not hide ${pickup.pickupEntityIndex}`);
      }
    }
    return {
      kind: "shared-pickup",
      mapName: options.mapName,
      room,
      weapon: "supershotgun",
      pass: failures.length === 0,
      failures,
      actor: compactClient(actor),
      observer: compactClient(observer),
      afterFirst: afterFirst.map(compactSnapshot),
      afterDuplicate: afterDuplicate.map(compactSnapshot),
      duplicateRejected,
      duplicateRequested,
      pickup,
      takenEvents,
    };
  } finally {
    await Promise.all(clients.map((client) => client.context.close().catch(() => undefined)));
  }
}

async function runLocalWorldMutationSuppressionCase(options) {
  const room = createDeepRoomName("world", options.mapName);
  console.log(`local world mutation suppression: ${options.mapName} room=${room}`);
  const clients = [
    await openClient(options.browser, {
      ...options,
      clientIndex: 0,
      clientsCount: 1,
      debugMultiplayer: true,
      debugMultiplayerInputPaused: true,
      room,
    }),
  ];
  const client = clients[0];
  const failures = [];
  let before = null;
  let after = null;
  let impact = null;
  let target = null;
  let snapshot = null;
  try {
    await waitForClientReady(client, 1, options.common.timeoutMs, { allowInputPaused: true });
    await waitForSnapshotPlayers(clients, 1, options.common.timeoutMs);
    before = await client.page.evaluate(() => window.__cssQuakeDebug?.damageableBrushesStats?.() ?? null);
    target = Array.isArray(before?.brushes)
      ? before.brushes.find((brush) => Number.isInteger(brush.entityIndex) && Number.isFinite(brush.health))
      : null;
    if (!target) {
      failures.push(`map ${options.mapName} did not expose a damageable brush snapshot`);
    } else {
      impact = await client.page.evaluate((entityIndex) =>
        window.__cssQuakeDebug?.projectileImpact?.("rocketlauncher", entityIndex, 0, 0, 0, 200) ?? null,
        target.entityIndex,
      );
      after = await client.page.evaluate(() => window.__cssQuakeDebug?.damageableBrushesStats?.() ?? null);
      const afterTarget = Array.isArray(after?.brushes)
        ? after.brushes.find((brush) => brush.entityIndex === target.entityIndex)
        : null;
      if (!impact) {
        failures.push(`debug projectile impact returned ${String(impact)}`);
      }
      if (!afterTarget) {
        failures.push(`local projectile impact removed damageable brush ${target.entityIndex}`);
      } else if (afterTarget.health !== target.health) {
        failures.push(`local projectile impact mutated damageable brush ${target.entityIndex} health ${target.health} -> ${afterTarget.health}`);
      }
    }
    snapshot = await readClientSnapshot(client);
    return {
      kind: "local-world-mutation",
      mapName: options.mapName,
      room,
      pass: failures.length === 0,
      failures,
      after,
      before,
      clients: clients.map(compactClient),
      impact,
      snapshot: snapshot ? compactSnapshot(snapshot) : null,
      target,
    };
  } finally {
    await Promise.all(clients.map((item) => item.context.close().catch(() => undefined)));
  }
}

async function runWorldInteractionCase(options) {
  const testCase = worldInteractionCaseForPage(WORLD_INTERACTION_CASE);
  const prepared = readPreparedScene(options.mapName);
  const trigger = assertPreparedEntity(prepared, testCase.triggerEntity, testCase.expectedTriggerClassname);
  const door = assertPreparedEntity(prepared, testCase.doorEntity, testCase.expectedDoorClassname);
  const room = createDeepRoomName("world-interaction", options.mapName);
  console.log(`room world interaction: ${testCase.label} room=${room}`);
  const clients = [
    await openClient(options.browser, {
      ...options,
      clientIndex: 0,
      clientsCount: 2,
      debugMultiplayer: true,
      debugMultiplayerInputPaused: true,
      room,
    }),
    await openClient(options.browser, {
      ...options,
      clientIndex: 1,
      clientsCount: 2,
      debugMultiplayer: true,
      debugMultiplayerInputPaused: true,
      room,
    }),
  ];
  const actor = clients[0];
  const failures = [];
  let before = [];
  let after = [];
  let pose = null;
  let touch = null;
  try {
    if (trigger.properties?.target !== testCase.targetname) {
      failures.push(`trigger ${testCase.triggerEntity} expected target ${testCase.targetname}, got ${trigger.properties?.target}`);
    }
    if (door.properties?.targetname !== testCase.targetname) {
      failures.push(`door ${testCase.doorEntity} expected targetname ${testCase.targetname}, got ${door.properties?.targetname}`);
    }
    try {
      await Promise.all(clients.map((client) =>
        waitForClientReady(client, 2, options.common.timeoutMs, { allowInputPaused: true })
      ));
      await waitForSnapshotPlayers(clients, 2, options.common.timeoutMs);
    } catch (error) {
      before = await safeReadWorldInteractionSnapshots(clients, testCase);
      failures.push(`clients did not become ready for world interaction: ${errorMessage(error)}`);
      return {
        kind: "world-interaction",
        mapName: options.mapName,
        room,
        pass: false,
        failures,
        clients: clients.map(compactClient),
        before,
        prepared: {
          door: {
            classname: door.classname,
            entityIndex: door.index,
            targetname: door.properties?.targetname ?? null,
          },
          trigger: {
            classname: trigger.classname,
            entityIndex: trigger.index,
            target: trigger.properties?.target ?? null,
          },
        },
      };
    }
    before = await Promise.all(clients.map((client) => readWorldInteractionSnapshot(client, testCase)));
    pose = await syncMultiplayerPoseAtQuakePoint(actor, testCase.inside, options.common.timeoutMs);
    touch = await actor.page.evaluate(async (testCase) => {
      const debug = window.__cssQuakeDebug;
      if (!debug?.stats || !debug.setViewpos) return { ok: false, reason: "missing debug hooks" };
      const settle = async (ms = 80) => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        await new Promise((resolve) => setTimeout(resolve, ms));
      };
      const touchOk = debug.setViewpos(
        testCase.inside.x,
        testCase.inside.y,
        testCase.inside.z,
        undefined,
        undefined,
        { gameplay: true, stableViewmodel: true },
      );
      await settle();
      return {
        clientId: debug.stats().multiplayer?.clientId ?? null,
        ok: true,
        origin: debug.stats().origin ?? null,
        touchOk,
        worldSequence: debug.stats().multiplayer?.worldSequence ?? null,
      };
    }, testCase);
    if (!touch?.touchOk) failures.push(`trigger touch failed: ${JSON.stringify(touch)}`);
    await waitForWorldEvent(clients, {
      entityIndex: testCase.triggerEntity,
      eventType: "world.trigger",
    }, options.common.timeoutMs);
    await waitForWorldEvent(clients, {
      eventType: "world.targets",
      sourceEntityIndex: testCase.triggerEntity,
    }, options.common.timeoutMs);
    await waitForWorldEvent(clients, {
      classname: testCase.expectedDoorClassname,
      entityIndex: testCase.doorEntity,
      eventType: "world.mover",
    }, options.common.timeoutMs);
    await waitForMoverMode(clients, testCase.doorEntity, testCase.expectedDoorTriggeredModes, options.common.timeoutMs);
    after = await Promise.all(clients.map((client) => readWorldInteractionSnapshot(client, testCase)));
    for (const [index, snapshot] of after.entries()) {
      if (!snapshot.triggerEvent) failures.push(`client ${index} did not record world.trigger ${testCase.triggerEntity}`);
      if (!snapshot.targetsEvent) failures.push(`client ${index} did not record world.targets from ${testCase.triggerEntity}`);
      if (!snapshot.moverEvent) failures.push(`client ${index} did not record world.mover ${testCase.doorEntity}`);
      if (!testCase.expectedDoorTriggeredModes.includes(snapshot.mover?.mode)) {
        failures.push(`client ${index} mover ${testCase.doorEntity} stayed ${snapshot.mover?.mode ?? "missing"}`);
      }
    }
    return {
      kind: "world-interaction",
      mapName: options.mapName,
      room,
      pass: failures.length === 0,
      failures,
      actor: compactClient(actor),
      before,
      after,
      pose,
      prepared: {
        door: {
          classname: door.classname,
          entityIndex: door.index,
          targetname: door.properties?.targetname ?? null,
        },
        trigger: {
          classname: trigger.classname,
          entityIndex: trigger.index,
          target: trigger.properties?.target ?? null,
        },
      },
      touch,
    };
  } finally {
    await Promise.all(clients.map((client) => client.context.close().catch(() => undefined)));
  }
}

async function runSpawnEscapeCase(options) {
  console.log(`spawn escape sampling: ${options.mapName} samples=${SPAWN_ESCAPE_SAMPLES}`);
  const failures = [];
  const samples = [];
  for (let sampleIndex = 0; sampleIndex < SPAWN_ESCAPE_SAMPLES; sampleIndex += 1) {
    const room = createDeepRoomName("spawn", options.mapName, String(sampleIndex + 1));
    const clients = [
      await openClient(options.browser, {
        ...options,
        clientIndex: 0,
        clientsCount: 1,
        debugMultiplayer: true,
        room,
      }),
    ];
    const client = clients[0];
    const sampleFailures = [];
    let before = null;
    let after = null;
    let movement = null;
    let startPlayer = null;
    try {
      await waitForClientReady(client, 1, options.common.timeoutMs);
      await waitForSnapshotPlayers(clients, 1, options.common.timeoutMs);
      before = await readClientSnapshot(client);
      startPlayer = await localSnapshotPlayer(client);
      if (!Array.isArray(startPlayer.origin) || startPlayer.origin.length !== 3) {
        sampleFailures.push("local snapshot player did not expose a valid start origin");
      } else {
        movement = await driveSpawnEscapeSample(client, startPlayer, options.common.timeoutMs);
        after = await readClientSnapshot(client);
        const endPlayer = snapshotPlayer(after, startPlayer.playerId);
        if (!endPlayer) {
          sampleFailures.push("final snapshot did not include the local player");
        } else {
          if (endPlayer.alive !== true) sampleFailures.push(`final authoritative player alive=${String(endPlayer.alive)}`);
          if (Number(endPlayer.health) <= 0) sampleFailures.push(`final authoritative player health=${String(endPlayer.health)}`);
        }
        if (Number(after.stats?.playerHealth) <= 0) {
          sampleFailures.push(`final local player health=${String(after.stats?.playerHealth)}`);
        }
        if (movement.maxLocalHorizontalDistance < SPAWN_ESCAPE_MIN_DISTANCE) {
          sampleFailures.push(`local movement only ${movement.maxLocalHorizontalDistance.toFixed(3)} from spawn`);
        }
        if (movement.maxAuthoritativeHorizontalDistance < SPAWN_ESCAPE_MIN_DISTANCE) {
          sampleFailures.push(`authoritative movement only ${movement.maxAuthoritativeHorizontalDistance.toFixed(3)} from spawn`);
        }
        if ((after.trace.rejects ?? []).length) {
          sampleFailures.push(`room rejects while escaping spawn: ${JSON.stringify(after.trace.rejects)}`);
        }
      }
      if (client.pageErrors.length) {
        sampleFailures.push(`${client.pageErrors.length} page error(s) while escaping spawn`);
      }
      if (client.requestFailures.length) {
        sampleFailures.push(`${client.requestFailures.length} request failure(s) while escaping spawn`);
      }
    } catch (error) {
      sampleFailures.push(errorMessage(error));
      after = await safeReadClientSnapshots(clients).then((snapshots) => snapshots[0] ?? null);
    } finally {
      await Promise.all(clients.map((item) => item.context.close().catch(() => undefined)));
    }
    if (sampleFailures.length) {
      failures.push(`sample ${sampleIndex + 1} room=${room}: ${sampleFailures.join("; ")}`);
    }
    samples.push({
      sample: sampleIndex + 1,
      room,
      pass: sampleFailures.length === 0,
      failures: sampleFailures,
      start: compactSpawnEscapePlayer(startPlayer),
      movement,
      before: before ? compactSnapshot(before) : null,
      after: after ? compactSnapshot(after) : null,
      client: compactClient(client),
    });
  }
  const uniqueSpawnIds = [...new Set(samples.map((sample) => sample.start?.spawnId).filter(Boolean))].sort();
  return {
    kind: "spawn-escape",
    mapName: options.mapName,
    sampleCount: samples.length,
    uniqueSpawnIds,
    pass: failures.length === 0,
    failures,
    samples,
    clients: samples.map((sample) => sample.client),
  };
}

async function runReconnectCase(options) {
  const room = createDeepRoomName("reconn", options.mapName);
  const clients = await Promise.all(Array.from({ length: 3 }, (_, index) =>
    openClient(options.browser, {
      ...options,
      clientIndex: index,
      clientsCount: 3,
      debugMultiplayer: true,
      room,
    })
  ));
  const failures = [];
  let before = [];
  let after = [];
  try {
    try {
      await Promise.all(clients.map((client) => waitForClientReady(client, 3, options.common.timeoutMs)));
      await waitForSnapshotPlayers(clients, 3, options.common.timeoutMs);
      await waitForRemoteDomCounts(clients, 2, options.common.timeoutMs);
    } catch (error) {
      failures.push(`initial readiness failed: ${errorMessage(error)}`);
      before = await safeReadClientSnapshots(clients);
      return {
        kind: "reconnect",
        mapName: options.mapName,
        room,
        pass: false,
        failures,
        before: before.map(compactSnapshot),
        after: [],
        clients: clients.map(compactClient),
      };
    }
    before = await safeReadClientSnapshots(clients);
    try {
      await clients[2].page.reload({ waitUntil: "domcontentloaded", timeout: options.common.timeoutMs });
      await waitForClientReady(clients[2], 3, options.common.timeoutMs);
      await waitForSnapshotPlayers(clients, 3, options.common.timeoutMs);
      await waitForRemoteDomCounts(clients, 2, options.common.timeoutMs);
    } catch (error) {
      failures.push(`reload readiness failed: ${errorMessage(error)}`);
    }
    after = await safeReadClientSnapshots(clients);
    for (const [index, snapshot] of after.entries()) {
      const players = snapshot.trace.lastSnapshot?.players ?? [];
      const clientIds = players.map((player) => player.clientId);
      if (new Set(clientIds).size !== clientIds.length) {
        failures.push(`client ${index} saw duplicate snapshot client ids: ${clientIds.join(",")}`);
      }
      if (snapshot.remotePlayers.length < 2) failures.push(`client ${index} saw only ${snapshot.remotePlayers.length} remote DOM players`);
      if (snapshot.remotePlayers.filter((player) => !player.hidden).length < 2) {
        failures.push(`client ${index} saw hidden/missing remote players after reconnect`);
      }
    }
    return {
      kind: "reconnect",
      mapName: options.mapName,
      room,
      pass: failures.length === 0,
      failures,
      before: before.map(compactSnapshot),
      after: after.map(compactSnapshot),
      clients: clients.map(compactClient),
    };
  } finally {
    await Promise.all(clients.map((client) => client.context.close().catch(() => undefined)));
  }
}

async function runRoomLifecycleCase(options) {
  const room = createDeepRoomName("lifecycle", options.mapName);
  const failures = [];
  const clients = [];
  const playerClients = [];
  const spectatorClients = [];
  let overflowClient = null;
  let snapshots = [];
  console.log(`room lifecycle: maxPlayers=${ROOM_LIFECYCLE_MAX_PLAYERS} spectators=${ROOM_LIFECYCLE_SPECTATOR_SLOTS} room=${room}`);
  try {
    for (let index = 0; index < ROOM_LIFECYCLE_MAX_PLAYERS; index += 1) {
      const client = await openClient(options.browser, {
        ...options,
        clientIndex: index,
        clientsCount: ROOM_LIFECYCLE_MAX_PLAYERS,
        debugMultiplayer: true,
        maxPlayers: ROOM_LIFECYCLE_MAX_PLAYERS,
        room,
      });
      clients.push(client);
      playerClients.push(client);
    }
    try {
      await Promise.all(playerClients.map((client) =>
        waitForClientReady(client, ROOM_LIFECYCLE_MAX_PLAYERS, options.common.timeoutMs)
      ));
      await waitForSnapshotPlayers(playerClients, ROOM_LIFECYCLE_MAX_PLAYERS, options.common.timeoutMs);
      await waitForRemoteDomCounts(playerClients, ROOM_LIFECYCLE_MAX_PLAYERS - 1, options.common.timeoutMs);
    } catch (error) {
      failures.push(`player readiness failed: ${errorMessage(error)}`);
    }

    for (let index = 0; index < ROOM_LIFECYCLE_SPECTATOR_SLOTS; index += 1) {
      const clientIndex = ROOM_LIFECYCLE_MAX_PLAYERS + index;
      const client = await openClient(options.browser, {
        ...options,
        clientIndex,
        clientsCount: ROOM_LIFECYCLE_MAX_PLAYERS,
        debugMultiplayer: true,
        maxPlayers: ROOM_LIFECYCLE_MAX_PLAYERS,
        room,
      });
      clients.push(client);
      spectatorClients.push(client);
      try {
        await waitForSpectatorReady(client, index + 1, options.common.timeoutMs);
      } catch (error) {
        failures.push(`spectator ${index + 1} readiness failed: ${errorMessage(error)}`);
      }
    }

    try {
      await Promise.all(playerClients.map((client) =>
        waitForSpectatorCount(client, ROOM_LIFECYCLE_SPECTATOR_SLOTS, options.common.timeoutMs)
      ));
    } catch (error) {
      failures.push(`player spectator-count sync failed: ${errorMessage(error)}`);
    }

    overflowClient = await openClient(options.browser, {
      ...options,
      clientIndex: ROOM_LIFECYCLE_MAX_PLAYERS + ROOM_LIFECYCLE_SPECTATOR_SLOTS,
      clientsCount: ROOM_LIFECYCLE_MAX_PLAYERS,
      debugMultiplayer: true,
      maxPlayers: ROOM_LIFECYCLE_MAX_PLAYERS,
      room,
    });
    clients.push(overflowClient);
    try {
      await waitForMultiplayerReject(overflowClient, "room-full", options.common.timeoutMs);
    } catch (error) {
      failures.push(`overflow client did not receive room-full reject: ${errorMessage(error)}`);
    }

    snapshots = await safeReadClientSnapshots(clients);
    for (const [index, snapshot] of snapshots.entries()) {
      const multiplayer = snapshot.stats?.multiplayer;
      if (index < ROOM_LIFECYCLE_MAX_PLAYERS) {
        if (multiplayer?.spectating) failures.push(`player client ${index} became spectator`);
        if (multiplayer?.scoreboardRows !== ROOM_LIFECYCLE_MAX_PLAYERS) {
          failures.push(`player client ${index} scoreboard rows ${String(multiplayer?.scoreboardRows)} did not equal ${ROOM_LIFECYCLE_MAX_PLAYERS}`);
        }
        if (multiplayer?.spectatorCount !== ROOM_LIFECYCLE_SPECTATOR_SLOTS) {
          failures.push(`player client ${index} spectator count ${String(multiplayer?.spectatorCount)} did not equal ${ROOM_LIFECYCLE_SPECTATOR_SLOTS}`);
        }
      } else if (index < ROOM_LIFECYCLE_MAX_PLAYERS + ROOM_LIFECYCLE_SPECTATOR_SLOTS) {
        if (multiplayer?.spectating !== true) failures.push(`spectator client ${index} did not enter spectating mode`);
        if (!multiplayer?.spectatorFollowedPlayerId) failures.push(`spectator client ${index} did not choose a followed player`);
        if (multiplayer?.scoreboardRows !== ROOM_LIFECYCLE_MAX_PLAYERS) {
          failures.push(`spectator client ${index} scoreboard rows ${String(multiplayer?.scoreboardRows)} did not equal ${ROOM_LIFECYCLE_MAX_PLAYERS}`);
        }
      } else if (multiplayer?.lastReject?.code !== "room-full") {
        failures.push(`overflow client lastReject ${String(multiplayer?.lastReject?.code)} did not equal room-full`);
      }
    }

    return {
      kind: "room-lifecycle",
      mapName: options.mapName,
      room,
      maxPlayers: ROOM_LIFECYCLE_MAX_PLAYERS,
      spectatorSlots: ROOM_LIFECYCLE_SPECTATOR_SLOTS,
      pass: failures.length === 0,
      failures,
      snapshots: snapshots.map(compactSnapshot),
      clients: clients.map(compactClient),
    };
  } finally {
    await Promise.all(clients.map((client) => client.context.close().catch(() => undefined)));
  }
}

async function runWrongMapCase(options) {
  const room = createDeepRoomName("wrongmap", options.mapName);
  const wrongMap = wrongMapProbeMap(options.mapName);
  const failures = [];
  const clients = [];
  let snapshots = [];
  console.log(`wrong-map rejection: host=${options.mapName} joiner=${wrongMap} room=${room}`);
  try {
    const host = await openClient(options.browser, {
      ...options,
      clientIndex: 0,
      clientsCount: 1,
      debugMultiplayer: true,
      maxPlayers: 1,
      room,
    });
    clients.push(host);
    try {
      await waitForClientReady(host, 1, options.common.timeoutMs);
      await waitForSnapshotPlayers([host], 1, options.common.timeoutMs);
    } catch (error) {
      failures.push(`host readiness failed: ${errorMessage(error)}`);
    }

    const joiner = await openClient(options.browser, {
      ...options,
      clientIndex: 1,
      clientsCount: 1,
      compactInviteMapName: options.mapName,
      debugMultiplayer: true,
      mapName: wrongMap,
      maxPlayers: 1,
      room,
    });
    clients.push(joiner);
    try {
      await waitForMultiplayerReject(joiner, "wrong-map", options.common.timeoutMs);
    } catch (error) {
      failures.push(`wrong-map client did not receive wrong-map reject: ${errorMessage(error)}`);
    }

    snapshots = await safeReadClientSnapshots(clients);
    const hostSnapshot = snapshots[0];
    const rejectSnapshot = snapshots[1];
    if (hostSnapshot?.stats?.multiplayer?.sessionState !== "connected") {
      failures.push(`host session state changed to ${String(hostSnapshot?.stats?.multiplayer?.sessionState)}`);
    }
    if (rejectSnapshot?.stats?.multiplayer?.lastReject?.code !== "wrong-map") {
      failures.push(`wrong-map reject snapshot code ${String(rejectSnapshot?.stats?.multiplayer?.lastReject?.code)} did not equal wrong-map`);
    }
    if (rejectSnapshot?.stats?.multiplayer?.helloAccepted === true) {
      failures.push("wrong-map joiner accepted hello after fatal reject");
    }

    return {
      kind: "wrong-map",
      hostMapName: options.mapName,
      wrongMapName: wrongMap,
      room,
      pass: failures.length === 0,
      failures,
      snapshots: snapshots.map(compactSnapshot),
      clients: clients.map(compactClient),
    };
  } finally {
    await Promise.all(clients.map((client) => client.context.close().catch(() => undefined)));
  }
}

async function openClient(browser, options) {
  const context = await browser.newContext({
    viewport: options.common.viewport,
    deviceScaleFactor: 1,
  });
  await context.addInitScript(installMultiplayerTrace);
  const page = await context.newPage();
  const pageErrors = collectPageErrors(page, {
    ignoreConsoleError: (text) => text.startsWith("[vite]"),
  });
  const requestFailures = [];
  page.on("requestfailed", (request) => {
    if (ignoreRequestFailure(request.url())) return;
    const failure = request.failure();
    requestFailures.push({
      url: request.url(),
      method: request.method(),
      errorText: failure?.errorText ?? "request failed",
    });
  });
  const url = clientUrl(options);
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: options.common.timeoutMs,
  });
  return {
    context,
    index: options.clientIndex,
    page,
    pageErrors,
    requestFailures,
    url,
  };
}

function clientUrl(options) {
  const url = new URL(options.appUrl);
  const compactInviteMapName = options.compactInviteMapName ?? options.mapName;
  const room = options.externalMode
    ? createCompactInvite(options.manifest, compactInviteMapName, roomTokenForCompactInvite(options.room)).value
    : options.room;
  url.searchParams.set("debug", "1");
  url.searchParams.set("map", options.mapName);
  url.searchParams.set("room", room);
  url.searchParams.set("partyHost", options.partyHost);
  url.searchParams.set("clientId", `deep-${options.clientIndex + 1}`);
  url.searchParams.set("player", `Deep ${options.clientIndex + 1}`);
  url.searchParams.set("color", colorForClient(options.clientIndex));
  url.searchParams.set("maxPlayers", String(options.maxPlayers ?? options.clientsCount));
  url.searchParams.set("disableEnemies", "1");
  if (options.externalMode) url.searchParams.set("multiplayer", "party");
  else if (options.debugMultiplayer) url.searchParams.set("debugMultiplayer", "party");
  if (options.debugMultiplayerInputPaused) url.searchParams.set("debugMultiplayerInputPaused", "1");
  return url.toString();
}

async function waitForClientReady(client, clientsCount, timeoutMs, options = {}) {
  await client.page.waitForFunction(({ minPlayers, allowInputPaused }) => {
    const stats = window.__cssQuakeDebug?.stats?.();
    const rows = document.querySelectorAll("#quake-multiplayer-scoreboard tbody tr");
    return Boolean(
      stats &&
      !stats.loading &&
      stats.multiplayer?.sessionState === "connected" &&
      stats.multiplayer?.helloAccepted === true &&
      (allowInputPaused || stats.multiplayer?.inputPaused === false) &&
      rows.length >= minPlayers
    );
  }, { minPlayers: clientsCount, allowInputPaused: Boolean(options.allowInputPaused) }, { timeout: timeoutMs });
}

async function waitForSpectatorReady(client, minSpectators, timeoutMs) {
  await client.page.waitForFunction(({ minSpectators, minScoreboardRows }) => {
    const stats = window.__cssQuakeDebug?.stats?.();
    return Boolean(
      stats &&
      !stats.loading &&
      stats.multiplayer?.sessionState === "connected" &&
      stats.multiplayer?.helloAccepted === true &&
      stats.multiplayer?.spectating === true &&
      stats.multiplayer?.spectatorCount >= minSpectators &&
      stats.multiplayer?.spectatorFollowedPlayerId &&
      stats.multiplayer?.scoreboardRows >= minScoreboardRows
    );
  }, {
    minScoreboardRows: ROOM_LIFECYCLE_MAX_PLAYERS,
    minSpectators,
  }, { timeout: timeoutMs });
}

async function waitForSpectatorCount(client, spectatorCount, timeoutMs) {
  await client.page.waitForFunction((spectatorCount) => {
    const stats = window.__cssQuakeDebug?.stats?.();
    return stats?.multiplayer?.spectatorCount === spectatorCount;
  }, spectatorCount, { timeout: timeoutMs });
}

async function waitForMultiplayerReject(client, code, timeoutMs) {
  await client.page.waitForFunction((code) => {
    const stats = window.__cssQuakeDebug?.stats?.();
    return stats?.multiplayer?.lastReject?.code === code;
  }, code, { timeout: timeoutMs });
}

async function syncMultiplayerPoseAtQuakePoint(client, point, timeoutMs) {
  const pose = await client.page.evaluate((point) => {
    const debug = window.__cssQuakeDebug;
    if (!debug?.stats || !debug.setViewpos) {
      return { ok: false, reason: "missing debug hooks" };
    }
    const setOk = debug.setViewpos(
      point.x,
      point.y,
      point.z,
      undefined,
      undefined,
      { stableViewmodel: true },
    );
    const synced = debug.syncMultiplayerPose?.() ?? false;
    const stats = debug.stats();
    return {
      clientId: stats.multiplayer?.clientId ?? null,
      ok: true,
      origin: stats.origin ?? null,
      setOk,
      synced,
    };
  }, point);
  if (!pose?.ok || !pose.setOk || !pose.synced) {
    throw new Error(`Failed to sync multiplayer pose at ${JSON.stringify(point)}: ${JSON.stringify(pose)}`);
  }
  await waitForLocalAuthoritativePose(client, pose, timeoutMs);
  return pose;
}

async function waitForWorldEvent(clients, criteria, timeoutMs) {
  await Promise.all(clients.map((client) =>
    client.page.waitForFunction((criteria) => {
      const events = window.__cssQuakeMpDeepTrace?.roomEvents ?? [];
      return events.some((event) => worldEventMatches(event, criteria));

      function worldEventMatches(event, criteria) {
        if (!event || event.eventType !== criteria.eventType) return false;
        if (criteria.entityIndex !== undefined && event.entityIndex !== criteria.entityIndex) return false;
        if (criteria.sourceEntityIndex !== undefined && event.sourceEntityIndex !== criteria.sourceEntityIndex) {
          return false;
        }
        if (criteria.classname !== undefined && event.classname !== criteria.classname) return false;
        return true;
      }
    }, criteria, { timeout: timeoutMs })
  ));
}

async function waitForMoverMode(clients, entityIndex, modes, timeoutMs) {
  await Promise.all(clients.map((client) =>
    client.page.waitForFunction(({ entityIndex, modes }) => {
      const stats = window.__cssQuakeDebug?.stats?.();
      const mover = stats?.movers?.movers?.find((candidate) => candidate.entityIndex === entityIndex);
      return modes.includes(mover?.mode);
    }, { entityIndex, modes }, { timeout: timeoutMs })
  ));
}

async function waitForLocalInput(client, timeoutMs) {
  await client.page.waitForFunction(() => {
    const stats = window.__cssQuakeDebug?.stats?.();
    return Boolean(stats?.multiplayer?.inputPaused === false && Number(stats.multiplayer.inputSequence) > 0);
  }, undefined, { timeout: timeoutMs });
}

async function waitForSnapshotPlayerWeapon(clients, clientId, weapon, timeoutMs) {
  const expectedWeapon = String(weapon ?? "").trim().toLowerCase();
  await Promise.all(clients.map((client) =>
    client.page.waitForFunction(({ clientId, expectedWeapon }) => {
      const players = window.__cssQuakeMpDeepTrace?.lastSnapshot?.players ?? [];
      const player = players.find((candidate) => candidate.clientId === clientId);
      const snapshotWeapon = String(player?.activeWeapon ?? player?.inventory?.activeWeapon ?? player?.weapon ?? "")
        .trim()
        .toLowerCase();
      return snapshotWeapon === expectedWeapon;
    }, { clientId, expectedWeapon }, { timeout: timeoutMs })
  ));
}

async function waitForSnapshotPlayers(clients, count, timeoutMs) {
  await Promise.all(clients.map((client) =>
    client.page.waitForFunction((expected) => {
      const trace = window.__cssQuakeMpDeepTrace;
      return (trace?.lastSnapshot?.players?.length ?? 0) >= expected;
    }, count, { timeout: timeoutMs })
  ));
}

async function syncControlledDuelPose(clients, pose, timeoutMs) {
  const synced = await Promise.all(clients.map((client) =>
    client.page.evaluate(() => window.__cssQuakeDebug?.syncMultiplayerPose?.() ?? false)
  ));
  if (!synced.every(Boolean)) {
    throw new Error(`Controlled duel pose sync failed: ${JSON.stringify(synced)}`);
  }
  await waitForControlledDuelPose(clients, pose, timeoutMs);
}

async function waitForControlledDuelPose(clients, pose, timeoutMs) {
  const expected = {
    attackerClientId: pose.attackerClientId,
    victimClientId: pose.victimClientId,
    attackerOrigin: pose.attackerOrigin,
    victimOrigin: pose.victimOrigin,
    attackerRotX: pose.attackerRotX,
    attackerRotY: pose.attackerRotY,
    victimRotX: pose.victimRotX,
    victimRotY: pose.victimRotY,
    originEpsilon: CONTROLLED_DUEL_POSE_EPSILON,
    rotEpsilon: CONTROLLED_DUEL_ROT_EPSILON,
  };
  await Promise.all(clients.map((client) =>
    client.page.waitForFunction((expected) => {
      const players = window.__cssQuakeMpDeepTrace?.lastSnapshot?.players ?? [];
      const attacker = players.find((player) => player.clientId === expected.attackerClientId);
      const victim = players.find((player) => player.clientId === expected.victimClientId);
      const originClose = (actual, wanted) =>
        Array.isArray(actual) &&
        Array.isArray(wanted) &&
        actual.length === 3 &&
        wanted.length === 3 &&
        actual.every((value, index) => Math.abs(Number(value) - Number(wanted[index])) <= expected.originEpsilon);
      const angleClose = (actual, wanted) => {
        if (!Number.isFinite(Number(actual)) || !Number.isFinite(Number(wanted))) return false;
        const delta = Math.abs((((Number(actual) - Number(wanted) + 540) % 360) - 180));
        return delta <= expected.rotEpsilon;
      };
      return Boolean(
        attacker &&
        victim &&
        originClose(attacker.origin, expected.attackerOrigin) &&
        originClose(victim.origin, expected.victimOrigin) &&
        angleClose(attacker.rotX, expected.attackerRotX) &&
        angleClose(attacker.rotY, expected.attackerRotY) &&
        angleClose(victim.rotX, expected.victimRotX) &&
        angleClose(victim.rotY, expected.victimRotY)
      );
    }, expected, { timeout: timeoutMs })
  ));
}

async function waitForLocalAuthoritativePose(client, pose, timeoutMs) {
  await client.page.waitForFunction(({ clientId, origin, originEpsilon }) => {
    const players = window.__cssQuakeMpDeepTrace?.lastSnapshot?.players ?? [];
    const player = players.find((candidate) => candidate.clientId === clientId);
    if (!player || !Array.isArray(player.origin) || !Array.isArray(origin)) return false;
    if (player.origin.length !== 3 || origin.length !== 3) return false;
    return player.origin.every((value, index) =>
      Math.abs(Number(value) - Number(origin[index])) <= originEpsilon
    );
  }, {
    clientId: pose.clientId,
    origin: pose.origin,
    originEpsilon: CONTROLLED_DUEL_POSE_EPSILON,
  }, { timeout: timeoutMs });
}

async function waitForSnapshotPlayerState(clients, criteria, timeoutMs) {
  await Promise.all(clients.map((client) =>
    client.page.waitForFunction((criteria) => {
      const players = window.__cssQuakeMpDeepTrace?.lastSnapshot?.players ?? [];
      const player = players.find((candidate) => candidate.playerId === criteria.playerId);
      if (!player) return false;
      if (criteria.alive !== undefined && player.alive !== criteria.alive) return false;
      if (criteria.health !== undefined && player.health !== criteria.health) return false;
      return true;
    }, criteria, { timeout: timeoutMs })
  ));
}

async function waitForPickupSnapshotUnavailable(clients, entityIndex, timeoutMs) {
  await Promise.all(clients.map((client) =>
    client.page.waitForFunction((entityIndex) => {
      const pickup = (window.__cssQuakeMpDeepTrace?.lastSnapshot?.pickups ?? [])
        .find((candidate) => candidate.entityIndex === entityIndex);
      return pickup?.available === false;
    }, entityIndex, { timeout: timeoutMs })
  ));
}

async function waitForRemoteDomCounts(clients, expected, timeoutMs) {
  await Promise.all(clients.map((client) =>
    client.page.waitForFunction((minimum) => {
      const players = Array.from(document.querySelectorAll("[data-player-id][data-client-id]"));
      return players.length >= minimum &&
        players.filter((element) => element instanceof HTMLElement && !element.hidden).length >= minimum;
    }, expected, { timeout: timeoutMs })
  ));
}

async function setControlledDuelPose(clients, spec, direction, options = {}) {
  const attackerIndex = direction === "a-to-b" ? 0 : 1;
  const victimIndex = attackerIndex === 0 ? 1 : 0;
  const attacker = clients[attackerIndex];
  const victim = clients[victimIndex];
  const aimRotX = (Math.atan2(spec.distance, CONTROLLED_DAMAGE_CENTER_DROP) * 180) / Math.PI;
  const baseOrigin = await findControlledDuelBaseOrigin(clients, spec, options);
  if (!Array.isArray(baseOrigin) || baseOrigin.length !== 3) {
    throw new Error("Controlled duel pose could not read a stable base origin.");
  }
  const pose = await attacker.page.evaluate(({ origin, rotX }) => {
    const debug = window.__cssQuakeDebug;
    debug.setPose(origin, rotX, 270, { gameplay: true, stableViewmodel: true });
    const next = debug.stats();
    const forward = next.cameraForward;
    const horizontalLength = Math.hypot(forward[0], forward[1]) || 1;
    return {
      origin: next.origin,
      forward,
      horizontalForward: [forward[0] / horizontalLength, forward[1] / horizontalLength, 0],
      rotX: next.cameraRotX,
      rotY: next.cameraRotY,
      clientId: next.multiplayer?.clientId ?? null,
    };
  }, { origin: baseOrigin, rotX: aimRotX });
  const victimOrigin = [
    pose.origin[0] + pose.horizontalForward[0] * spec.distance,
    pose.origin[1] + pose.horizontalForward[1] * spec.distance,
    pose.origin[2],
  ];
  const victimPose = await victim.page.evaluate(({ origin, rotX, rotY }) => {
    window.__cssQuakeDebug?.setPose?.(origin, rotX, (rotY + 180) % 360, {
      gameplay: true,
      stableViewmodel: true,
    });
    const next = window.__cssQuakeDebug?.stats?.();
    return {
      origin: next?.origin ?? origin,
      rotX: next?.cameraRotX ?? rotX,
      rotY: next?.cameraRotY ?? ((rotY + 180) % 360),
      clientId: next?.multiplayer?.clientId ?? null,
    };
  }, { origin: victimOrigin, rotX: pose.rotX, rotY: pose.rotY });
  const nextPose = {
    attackerIndex,
    victimIndex,
    attackerClientId: pose.clientId,
    victimClientId: victimPose.clientId,
    baseOrigin,
    attackerOrigin: pose.origin,
    attackerForward: pose.forward,
    attackerHorizontalForward: pose.horizontalForward,
    attackerRotX: pose.rotX,
    attackerRotY: pose.rotY,
    damageCenterDrop: CONTROLLED_DAMAGE_CENTER_DROP,
    distance: spec.distance,
    targetCenter: [victimOrigin[0], victimOrigin[1], victimOrigin[2] - CONTROLLED_DAMAGE_CENTER_DROP],
    victimOrigin: victimPose.origin,
    victimRotX: victimPose.rotX,
    victimRotY: victimPose.rotY,
  };
  await syncControlledDuelPose(clients, nextPose, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return nextPose;
}

async function findControlledDuelBaseOrigin(clients, spec, options = {}) {
  const baseOriginCandidates = (await Promise.all(clients.map((client) =>
    client.page.evaluate(() =>
      (window.__cssQuakeMpDeepTrace?.lastSnapshot?.players ?? [])
        .map((player) => player.origin)
        .filter((origin) => Array.isArray(origin) && origin.length === 3)
    )
  ))).flat();
  const fallbackOrigin = await clients[0].page.evaluate(() => window.__cssQuakeDebug?.stats?.().origin ?? null);
  const mapLanes = CONTROLLED_DUEL_LANES_BY_MAP[String(options.mapName ?? "").toLowerCase()] ?? [];
  const candidates = [
    ...mapLanes,
    ...(Array.isArray(options.baseOrigin) && options.baseOrigin.length === 3 ? [options.baseOrigin] : []),
    ...baseOriginCandidates.sort((left, right) =>
      left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
    ),
    ...(Array.isArray(fallbackOrigin) && fallbackOrigin.length === 3 ? [fallbackOrigin] : []),
  ];
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length !== 3) continue;
    const origin = candidate.map((value) => Number(value));
    if (!origin.every(Number.isFinite)) continue;
    const key = origin.map((value) => value.toFixed(4)).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(origin);
  }
  for (const candidate of unique) {
    if (await controlledDuelLaneIsClear(clients[0], candidate, spec)) return candidate;
  }
  return unique[0] ?? null;
}

async function controlledDuelLaneIsClear(client, origin, spec) {
  return await client.page.evaluate(({ centerDrop, origin, distance }) => {
    const target = [origin[0], origin[1] + distance, origin[2] - centerDrop];
    const result = window.__cssQuakeDebug?.canDamage?.(
      origin[0],
      origin[1],
      origin[2],
      target[0],
      target[1],
      target[2],
    );
    return result?.result === true;
  }, { centerDrop: CONTROLLED_DAMAGE_CENTER_DROP, origin, distance: spec.distance });
}

async function pickupWeaponForControlledCase(client, weapon, timeoutMs) {
  const pickupClassname = weaponPickupClassname(weapon);
  if (!pickupClassname) throw new Error(`No pickup classname known for ${weapon}.`);
  const pickupEntityIndex = await client.page.evaluate((pickupClassname) => {
    const indexes = window.__cssQuakeDebug?.entityIndexes?.(pickupClassname) ?? [];
    return Number.isInteger(indexes[0]) ? indexes[0] : null;
  }, pickupClassname);
  if (!Number.isInteger(pickupEntityIndex)) throw new Error(`Could not find ${pickupClassname} pickup entity.`);
  const pickupPose = await client.page.evaluate((pickupEntityIndex) => {
    const debug = window.__cssQuakeDebug;
    const focused = debug?.focusEntity?.(pickupEntityIndex, 0, 90, 270);
    if (!focused) return null;
    const origin = debug.stats?.().origin ?? null;
    if (!Array.isArray(origin) || origin.length !== 3) return null;
    debug.setPose?.(origin, 90, 270, { gameplay: true, stableViewmodel: true });
    const poseSynced = debug.syncMultiplayerPose?.() ?? false;
    return {
      clientId: debug.stats?.().multiplayer?.clientId ?? null,
      entityIndex: pickupEntityIndex,
      origin: debug.stats?.().origin ?? null,
      poseSynced,
    };
  }, pickupEntityIndex);
  if (!pickupPose?.poseSynced) {
    throw new Error(`Failed to sync multiplayer pose for ${pickupClassname} (${pickupEntityIndex}).`);
  }
  await waitForLocalAuthoritativePose(client, pickupPose, timeoutMs);
  const pickupRequest = await client.page.evaluate((pickupEntityIndex) => {
    const debug = window.__cssQuakeDebug;
    const collisionSynced = debug?.syncCollision?.() ?? false;
    const pickupRequested = debug?.requestMultiplayerPickup?.(pickupEntityIndex) ?? false;
    return {
      collisionSynced,
      origin: debug?.stats?.().origin ?? null,
      pickupRequested,
    };
  }, pickupEntityIndex);
  if (!pickupRequest?.collisionSynced) {
    throw new Error(`Failed to sync collision for ${pickupClassname} (${pickupEntityIndex}).`);
  }
  if (!pickupRequest.pickupRequested) {
    throw new Error(`Failed to request multiplayer pickup for ${pickupClassname} (${pickupEntityIndex}).`);
  }
  const player = await localSnapshotPlayer(client);
  let event;
  try {
    event = await waitForRoomEvent([client], (candidate) =>
      candidate.eventType === "pickup.taken" &&
      candidate.entityIndex === pickupEntityIndex &&
      candidate.playerId === player.playerId,
      timeoutMs,
    );
  } catch (error) {
    const debug = await client.page.evaluate(() => ({
      inventory: window.__cssQuakeDebug?.inventory?.() ?? null,
      pickupStats: window.__cssQuakeDebug?.pickupsStats?.() ?? null,
      sent: window.__cssQuakeMpDeepTrace?.sent?.slice(-20) ?? [],
      roomEvents: window.__cssQuakeMpDeepTrace?.roomEvents?.slice(-20) ?? [],
      stats: window.__cssQuakeDebug?.stats?.() ?? null,
    }));
    throw new Error(`Timed out waiting for ${pickupClassname} pickup ${pickupEntityIndex}: ${errorMessage(error)} ${JSON.stringify(debug)}`);
  }
  return {
    event,
    pickupClassname,
    pickupEntityIndex,
    player,
    pose: {
      ...pickupPose,
      collisionSynced: pickupRequest.collisionSynced,
      pickupRequested: pickupRequest.pickupRequested,
      requestOrigin: pickupRequest.origin,
    },
  };
}

function weaponPickupClassname(weapon) {
  if (weapon === "grenadelauncher") return "weapon_grenadelauncher";
  if (weapon === "rocketlauncher") return "weapon_rocketlauncher";
  if (weapon === "nailgun") return "weapon_nailgun";
  if (weapon === "supernailgun") return "weapon_supernailgun";
  if (weapon === "supershotgun") return "weapon_supershotgun";
  if (weapon === "lightning") return "weapon_lightning";
  return null;
}

async function waitForPlayerEvent(clients, predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const client of clients) {
      const events = await client.page.evaluate(() => window.__cssQuakeMpDeepTrace?.playerEvents ?? []);
      const match = events.findLast(predicate);
      if (match) return match;
    }
    await sleep(50);
  }
  throw new Error("Timed out waiting for authoritative player event.");
}

async function waitForRoomEvent(clients, predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const match = await findRoomEvent(clients, predicate);
    if (match) return match;
    await sleep(50);
  }
  throw new Error("Timed out waiting for authoritative room event.");
}

async function findRoomEvent(clients, predicate) {
  for (const client of clients) {
    const events = await client.page.evaluate(() => window.__cssQuakeMpDeepTrace?.roomEvents ?? []);
    const match = events.findLast(predicate);
    if (match) return match;
  }
  return null;
}

async function uniqueRoomEvents(clients, predicate = () => true) {
  const events = (await Promise.all(clients.map((client) =>
    client.page.evaluate(() => window.__cssQuakeMpDeepTrace?.roomEvents ?? [])
  ))).flat();
  const unique = new Map();
  for (const event of events) {
    if (!predicate(event)) continue;
    unique.set(event.eventId ?? JSON.stringify(event), event);
  }
  return [...unique.values()];
}

async function waitForRemoteProjectileDom(client, projectileId, timeoutMs) {
  await client.page.waitForFunction((projectileId) => {
    const element = document.querySelector(`.remote-projectile[data-projectile-id="${CSS.escape(projectileId)}"]`);
    const stats = window.__cssQuakeDebug?.stats?.();
    return Boolean(
      element instanceof HTMLElement &&
      !element.hidden &&
      (stats?.multiplayer?.remoteProjectileDomCount ?? 0) >= 1
    );
  }, projectileId, { timeout: timeoutMs });
  return await client.page.evaluate((projectileId) => {
    const element = document.querySelector(`.remote-projectile[data-projectile-id="${CSS.escape(projectileId)}"]`);
    return element instanceof HTMLElement
      ? {
          className: element.className,
          hidden: element.hidden,
          ownerPlayerId: element.dataset.ownerPlayerId ?? null,
          projectileId: element.dataset.projectileId ?? null,
          origin: element.dataset.remoteProjectileOrigin ?? null,
        }
      : null;
  }, projectileId);
}

async function waitForRemoteProjectilePresentationOrImpact(client, clients, projectileId, timeoutMs) {
  const started = Date.now();
  let visibleProjectile = null;
  let movedProjectile = null;
  let initialOrigin = null;
  while (Date.now() - started < timeoutMs) {
    const projectile = await readRemoteProjectileDom(client, projectileId);
    if (projectile) {
      if (!visibleProjectile) {
        visibleProjectile = projectile;
        initialOrigin = projectile.origin ?? "";
      } else if (!movedProjectile && projectile.origin !== "" && projectile.origin !== initialOrigin) {
        movedProjectile = projectile;
      }
    }
    const impacted = await findRoomEvent(clients, (candidate) =>
      candidate.eventType === "projectile.impacted" &&
      candidate.projectileId === projectileId
    );
    if (impacted) return { impacted, movedProjectile, visibleProjectile };
    await sleep(25);
  }
  throw new Error(`Timed out waiting for projectile ${projectileId} impact.`);
}

async function readRemoteProjectileDom(client, projectileId) {
  return await client.page.evaluate((projectileId) => {
    const element = document.querySelector(`.remote-projectile[data-projectile-id="${CSS.escape(projectileId)}"]`);
    return element instanceof HTMLElement
      ? {
          className: element.className,
          hidden: element.hidden,
          ownerPlayerId: element.dataset.ownerPlayerId ?? null,
          projectileId: element.dataset.projectileId ?? null,
          origin: element.dataset.remoteProjectileOrigin ?? null,
        }
      : null;
  }, projectileId);
}

async function waitForDamageOverlayState(client, active, timeoutMs) {
  await client.page.waitForFunction((active) => {
    const overlay = document.querySelector("#quake-damage-overlay");
    if (!(overlay instanceof HTMLElement)) return false;
    return overlay.classList.contains("quake-damage-overlay-active") === active;
  }, active, { timeout: timeoutMs });
  return await readHudFeedback(client);
}

async function waitForHudDamageCueState(client, active, timeoutMs) {
  await client.page.waitForFunction((active) => {
    const classicHud = document.querySelector("#quake-classic-hud");
    if (!(classicHud instanceof HTMLElement)) return false;
    return classicHud.classList.contains("quake-hud-damage") === active;
  }, active, { timeout: timeoutMs });
  return await readHudFeedback(client);
}

async function readHudFeedback(client) {
  return await client.page.evaluate(() => {
    const overlay = document.querySelector("#quake-damage-overlay");
    const classicHud = document.querySelector("#quake-classic-hud");
    return {
      bodyDead: document.body.classList.contains("quake-dead"),
      classicHudDamage: classicHud instanceof HTMLElement
        ? classicHud.classList.contains("quake-hud-damage")
        : null,
      damageOverlayActive: overlay instanceof HTMLElement
        ? overlay.classList.contains("quake-damage-overlay-active")
        : null,
    };
  });
}

async function waitForNoRemoteProjectileDom(client, projectileId, timeoutMs) {
  await client.page.waitForFunction((projectileId) => {
    const element = document.querySelector(`.remote-projectile[data-projectile-id="${CSS.escape(projectileId)}"]`);
    const stats = window.__cssQuakeDebug?.stats?.();
    return !element && (stats?.multiplayer?.remoteProjectileDomCount ?? 0) === 0;
  }, projectileId, { timeout: timeoutMs });
}

async function waitForExplosionSprite(client, timeoutMs) {
  const started = Date.now();
  let lastSample = null;
  while (Date.now() - started < timeoutMs) {
    lastSample = await client.page.evaluate(() => {
      const sprites = Array.from(document.querySelectorAll(".quake-effect-sprite"))
        .filter((element) => {
          if (!(element instanceof HTMLElement)) return false;
          const opacity = Number(element.style.opacity || window.getComputedStyle(element).opacity || "0");
          return opacity > 0.01;
        })
        .map((element) => ({
          className: element.className,
          opacity: element instanceof HTMLElement
            ? Number(element.style.opacity || window.getComputedStyle(element).opacity || "0")
            : 0,
        }));
      return {
        count: sprites.length,
        sprites,
      };
    });
    if (lastSample.count > 0) return lastSample;
    await sleep(25);
  }
  return lastSample;
}

async function waitForRemoteFramePrefix(client, remoteClientId, prefix, timeoutMs) {
  return waitForRemoteFramePrefixes(client, remoteClientId, [prefix], timeoutMs);
}

async function waitForRemoteFramePrefixes(client, remoteClientId, prefixes, timeoutMs) {
  const started = Date.now();
  const expectedPrefixes = prefixes.length ? prefixes : [""];
  while (Date.now() - started < timeoutMs) {
    const samples = await sampleRemoteFrames(client);
    client.afterRemoteFrames = samples;
    if (samples.some((sample) =>
      sample.clientId === remoteClientId &&
      !sample.hidden &&
      expectedPrefixes.some((prefix) => String(sample.frameName ?? "").startsWith(prefix))
    )) {
      return true;
    }
    await sleep(50);
  }
  return false;
}

async function clearRemoteFrameSamplesForAll(clients) {
  await Promise.all(clients.map((client) => clearRemoteFrameSamples(client)));
}

async function clearRemoteFrameSamples(client) {
  client.afterRemoteFrames = [];
  await client.page.evaluate(() => {
    const trace = window.__cssQuakeMpDeepTrace;
    if (trace) trace.remoteFrames = [];
  });
}

function remoteAttackFramePrefixesForWeapon(weapon) {
  return REMOTE_ATTACK_FRAME_PREFIXES_BY_WEAPON[weapon] ?? [];
}

async function sampleRemoteFrames(client) {
  return await client.page.evaluate(() => {
    const trace = window.__cssQuakeMpDeepTrace;
    if (!trace) return [];
    for (const element of document.querySelectorAll("[data-player-id][data-client-id]")) {
      trace.remoteFrames.push({
        sampledAt: performance.now(),
        playerId: element.dataset.playerId ?? null,
        clientId: element.dataset.clientId ?? null,
        alive: element.dataset.remoteAlive ?? null,
        appliedRotY: element.dataset.remoteAppliedRotY ?? null,
        lastAttackAt: element.dataset.remoteLastAttackAt ?? null,
        lastPainAt: element.dataset.remoteLastPainAt ?? null,
        hidden: element instanceof HTMLElement ? element.hidden : false,
        frameIndex: element.dataset.remoteFrameIndex ?? null,
        frameName: element.dataset.remoteFrameName ?? null,
        origin: element.dataset.remoteOrigin ?? null,
        renderAt: element.dataset.remoteRenderAt ?? null,
        renderRotY: element.dataset.remoteRenderRotY ?? null,
        stale: element.dataset.remoteStale ?? null,
        visualRotY: element.dataset.remoteVisualRotY ?? null,
      });
    }
    if (trace.remoteFrames.length > 500) trace.remoteFrames.splice(0, trace.remoteFrames.length - 500);
    return trace.remoteFrames;
  });
}

async function waitForRemoteVisualPose(client, remoteClientId, expectedRotY, timeoutMs) {
  await client.page.waitForFunction(({ expectedRotY, remoteClientId, rotEpsilon }) => {
    const element = document.querySelector(`[data-client-id="${CSS.escape(remoteClientId)}"]`);
    if (!(element instanceof HTMLElement) || element.hidden) return false;
    const visualRotY = Number(element.dataset.remoteVisualRotY);
    const renderRotY = Number(element.dataset.remoteRenderRotY);
    const alive = element.dataset.remoteAlive === "true";
    const stale = element.dataset.remoteStale === "true";
    const angleDelta = (left, right) =>
      Math.abs(((Number(left) - Number(right) + 540) % 360) - 180);
    return alive &&
      !stale &&
      Number.isFinite(visualRotY) &&
      Number.isFinite(renderRotY) &&
      angleDelta(visualRotY, expectedRotY) <= rotEpsilon &&
      angleDelta(renderRotY, expectedRotY) <= rotEpsilon;
  }, {
    expectedRotY,
    remoteClientId,
    rotEpsilon: REMOTE_POSE_ROT_EPSILON,
  }, { timeout: timeoutMs });
  return await readRemoteVisualPose(client, remoteClientId);
}

async function readRemoteVisualPose(client, remoteClientId) {
  return await client.page.evaluate((remoteClientId) => {
    const element = document.querySelector(`[data-client-id="${CSS.escape(remoteClientId)}"]`);
    return element instanceof HTMLElement
      ? {
          alive: element.dataset.remoteAlive ?? null,
          appliedRotY: element.dataset.remoteAppliedRotY ?? null,
          clientId: element.dataset.clientId ?? null,
          frameIndex: element.dataset.remoteFrameIndex ?? null,
          frameName: element.dataset.remoteFrameName ?? null,
          hidden: element.hidden,
          lastAttackAt: element.dataset.remoteLastAttackAt ?? null,
          lastPainAt: element.dataset.remoteLastPainAt ?? null,
          origin: element.dataset.remoteOrigin ?? null,
          playerId: element.dataset.playerId ?? null,
          renderAt: element.dataset.remoteRenderAt ?? null,
          renderRotY: element.dataset.remoteRenderRotY ?? null,
          stale: element.dataset.remoteStale ?? null,
          visualRotY: element.dataset.remoteVisualRotY ?? null,
        }
      : null;
  }, remoteClientId);
}

async function waitForImpactParticles(client, expectedKind, timeoutMs) {
  const started = Date.now();
  let lastSample = null;
  while (Date.now() - started < timeoutMs) {
    lastSample = await sampleImpactParticles(client);
    if ((lastSample[expectedKind] ?? 0) > 0) return lastSample;
    await sleep(25);
  }
  return lastSample ?? { blood: 0, explosion: 0, total: 0, wall: 0 };
}

async function sampleImpactParticles(client) {
  return await client.page.evaluate(() => {
    const active = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const opacity = Number(element.style.opacity || window.getComputedStyle(element).opacity || "0");
      return opacity > 0.01;
    };
    const particles = Array.from(document.querySelectorAll(".quake-impact-particle")).filter(active);
    const countWithClassPrefix = (prefix) =>
      particles.filter((element) => Array.from(element.classList).some((className) => className.startsWith(prefix))).length;
    return {
      blood: countWithClassPrefix("quake-impact-particle-red-"),
      explosion: countWithClassPrefix("quake-impact-particle-explosion-"),
      total: particles.length,
      wall: countWithClassPrefix("quake-impact-particle-dust-"),
    };
  });
}

async function localSnapshotPlayer(client) {
  const value = await client.page.evaluate(() => {
    const stats = window.__cssQuakeDebug?.stats?.();
    const clientId = stats?.multiplayer?.clientId;
    const players = window.__cssQuakeMpDeepTrace?.lastSnapshot?.players ?? [];
    return players.find((player) => player.clientId === clientId) ?? null;
  });
  if (!value) throw new Error(`Could not find local snapshot player for client ${client.index}.`);
  return value;
}

async function readClientSnapshot(client) {
  return await client.page.evaluate(() => {
    const stats = window.__cssQuakeDebug?.stats?.() ?? null;
    const trace = window.__cssQuakeMpDeepTrace ?? {};
    const remotePlayers = Array.from(document.querySelectorAll("[data-player-id][data-client-id]"))
      .map((element) => ({
        playerId: element.dataset.playerId ?? null,
        clientId: element.dataset.clientId ?? null,
        alive: element.dataset.remoteAlive ?? null,
        appliedRotY: element.dataset.remoteAppliedRotY ?? null,
        frameIndex: element.dataset.remoteFrameIndex ?? null,
        frameName: element.dataset.remoteFrameName ?? null,
        hidden: element instanceof HTMLElement ? element.hidden : false,
        lastAttackAt: element.dataset.remoteLastAttackAt ?? null,
        lastPainAt: element.dataset.remoteLastPainAt ?? null,
        origin: element.dataset.remoteOrigin ?? null,
        renderAt: element.dataset.remoteRenderAt ?? null,
        renderRotY: element.dataset.remoteRenderRotY ?? null,
        stale: element.dataset.remoteStale ?? null,
        visualRotY: element.dataset.remoteVisualRotY ?? null,
      }));
    const remoteProjectiles = Array.from(document.querySelectorAll(".remote-projectile"))
      .map((element) => ({
        className: element.className,
        hidden: element instanceof HTMLElement ? element.hidden : false,
        ownerPlayerId: element.dataset.ownerPlayerId ?? null,
        projectileId: element.dataset.projectileId ?? null,
        origin: element.dataset.remoteProjectileOrigin ?? null,
      }));
    const damageOverlay = document.querySelector("#quake-damage-overlay");
    const classicHud = document.querySelector("#quake-classic-hud");
    return {
      hud: {
        bodyDead: document.body.classList.contains("quake-dead"),
        classicHudDamage: classicHud instanceof HTMLElement
          ? classicHud.classList.contains("quake-hud-damage")
          : null,
        damageOverlayActive: damageOverlay instanceof HTMLElement
          ? damageOverlay.classList.contains("quake-damage-overlay-active")
          : null,
      },
      stats,
      remotePlayers,
      remoteProjectiles,
      trace: {
        events: trace.events ?? [],
        lastSnapshot: trace.lastSnapshot ?? null,
        playerEvents: trace.playerEvents ?? [],
        received: trace.received ?? [],
        rejects: trace.rejects ?? [],
        remoteFrames: trace.remoteFrames ?? [],
        roomEvents: trace.roomEvents ?? [],
        sent: trace.sent ?? [],
      },
    };
  });
}

async function readWorldInteractionSnapshot(client, testCase) {
  return await client.page.evaluate((testCase) => {
    const stats = window.__cssQuakeDebug?.stats?.() ?? null;
    const roomEvents = window.__cssQuakeMpDeepTrace?.roomEvents ?? [];
    const mover = stats?.movers?.movers?.find((candidate) => candidate.entityIndex === testCase.doorEntity) ?? null;
    const triggerEvent = roomEvents.find((event) =>
      event.eventType === "world.trigger" &&
      event.entityIndex === testCase.triggerEntity
    ) ?? null;
    const targetsEvent = roomEvents.find((event) =>
      event.eventType === "world.targets" &&
      event.sourceEntityIndex === testCase.triggerEntity
    ) ?? null;
    const moverEvent = roomEvents.find((event) =>
      event.eventType === "world.mover" &&
      event.entityIndex === testCase.doorEntity
    ) ?? null;
    return {
      clientId: stats?.multiplayer?.clientId ?? null,
      helloAccepted: stats?.multiplayer?.helloAccepted ?? null,
      inputPaused: stats?.multiplayer?.inputPaused ?? null,
      inputSequence: stats?.multiplayer?.inputSequence ?? null,
      lastReject: stats?.multiplayer?.lastReject ?? null,
      mover,
      moverEvent,
      origin: stats?.origin ?? null,
      recentWorldEvents: stats?.multiplayer?.recentWorldEvents ?? [],
      scoreboardRows: stats?.multiplayer?.scoreboardRows ?? null,
      sentWorldMessages: (window.__cssQuakeMpDeepTrace?.sent ?? [])
        .filter((message) => message.type === "client.world"),
      sessionState: stats?.multiplayer?.sessionState ?? null,
      targetsEvent,
      tracePlayerCount: window.__cssQuakeMpDeepTrace?.lastSnapshot?.players?.length ?? null,
      triggerEvent,
      worldSequence: stats?.multiplayer?.worldSequence ?? null,
    };
  }, testCase);
}

async function safeReadWorldInteractionSnapshots(clients, testCase) {
  const snapshots = [];
  for (const client of clients) {
    try {
      snapshots.push(await readWorldInteractionSnapshot(client, testCase));
    } catch (error) {
      snapshots.push({
        clientId: null,
        error: errorMessage(error),
        inputPaused: null,
        inputSequence: null,
        mover: null,
        moverEvent: null,
        origin: null,
        recentWorldEvents: [],
        sentWorldMessages: [],
        targetsEvent: null,
        triggerEvent: null,
        worldSequence: null,
      });
    }
  }
  return snapshots;
}

async function driveSpawnEscapeSample(client, startPlayer, timeoutMs) {
  const startedAt = Date.now();
  const startOrigin = startPlayer.origin;
  let maxLocalHorizontalDistance = 0;
  let maxAuthoritativeHorizontalDistance = 0;
  const samples = [];
  await client.page.evaluate(() => {
    const debug = window.__cssQuakeDebug;
    debug?.setWeapon?.("axe");
    debug?.setMultiplayerInputPaused?.(false);
    const host = document.querySelector("#quake-app [tabindex='0']");
    if (host instanceof HTMLElement) host.focus({ preventScroll: true });
  });
  await waitForLocalInput(client, timeoutMs);
  try {
    for (const key of SPAWN_ESCAPE_KEYS) {
      await client.page.keyboard.down(key);
      await client.page.waitForTimeout(180);
      const sample = await readSpawnEscapeMovementSample(client, startOrigin, startPlayer.playerId);
      samples.push({ key, ...sample });
      maxLocalHorizontalDistance = Math.max(maxLocalHorizontalDistance, sample.localHorizontalDistance);
      maxAuthoritativeHorizontalDistance = Math.max(
        maxAuthoritativeHorizontalDistance,
        sample.authoritativeHorizontalDistance,
      );
      await client.page.keyboard.up(key);
      await client.page.waitForTimeout(80);
    }
    await client.page.waitForTimeout(400);
    const finalSample = await readSpawnEscapeMovementSample(client, startOrigin, startPlayer.playerId);
    samples.push({ key: "settle", ...finalSample });
    maxLocalHorizontalDistance = Math.max(maxLocalHorizontalDistance, finalSample.localHorizontalDistance);
    maxAuthoritativeHorizontalDistance = Math.max(
      maxAuthoritativeHorizontalDistance,
      finalSample.authoritativeHorizontalDistance,
    );
  } finally {
    await Promise.all(SPAWN_ESCAPE_KEYS.map((key) => client.page.keyboard.up(key).catch(() => undefined)));
  }
  return {
    durationMs: Date.now() - startedAt,
    maxLocalHorizontalDistance,
    maxAuthoritativeHorizontalDistance,
    samples,
  };
}

async function readSpawnEscapeMovementSample(client, startOrigin, playerId) {
  return await client.page.evaluate(({ playerId, startOrigin }) => {
    const horizontalDistance = (left, right) => {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length < 2 || right.length < 2) return 0;
      return Math.hypot(Number(left[0]) - Number(right[0]), Number(left[1]) - Number(right[1]));
    };
    const stats = window.__cssQuakeDebug?.stats?.() ?? null;
    const player = (window.__cssQuakeMpDeepTrace?.lastSnapshot?.players ?? [])
      .find((candidate) => candidate.playerId === playerId) ?? null;
    const localOrigin = stats?.origin ?? null;
    const authoritativeOrigin = player?.origin ?? null;
    return {
      authoritativeHorizontalDistance: horizontalDistance(authoritativeOrigin, startOrigin),
      authoritativeOrigin,
      authoritativePlayer: player
        ? {
            alive: player.alive,
            health: player.health,
            inputSequence: player.inputSequence ?? player.lastInputSequence ?? null,
            origin: player.origin,
            spawnId: player.spawnId ?? null,
          }
        : null,
      inputSequence: stats?.multiplayer?.inputSequence ?? null,
      localHorizontalDistance: horizontalDistance(localOrigin, startOrigin),
      localOrigin,
      playerHealth: stats?.playerHealth ?? null,
    };
  }, { playerId, startOrigin });
}

async function safeReadClientSnapshots(clients) {
  const snapshots = [];
  for (const client of clients) {
    try {
      snapshots.push(await readClientSnapshot(client));
    } catch (error) {
      snapshots.push({
        hud: {
          bodyDead: null,
          classicHudDamage: null,
          damageOverlayActive: null,
        },
        stats: null,
        remotePlayers: [],
        remoteProjectiles: [],
        trace: {
          events: [],
          lastSnapshot: null,
          playerEvents: [],
          received: [],
          rejects: [],
          remoteFrames: [],
          roomEvents: [],
          sent: [],
        },
        error: errorMessage(error),
      });
    }
  }
  return snapshots;
}

function worldInteractionCaseForPage(testCase) {
  return {
    doorEntity: testCase.doorEntity,
    expectedDoorClassname: testCase.expectedDoorClassname,
    expectedDoorTriggeredModes: [...testCase.expectedDoorTriggeredModes],
    expectedTriggerClassname: testCase.expectedTriggerClassname,
    inside: { ...testCase.inside },
    label: testCase.label,
    targetname: testCase.targetname,
    triggerEntity: testCase.triggerEntity,
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function installMultiplayerTrace() {
  const trace = {
    connections: [],
    events: [],
    lastSnapshot: null,
    playerEvents: [],
    received: [],
    rejects: [],
    remoteFrames: [],
    roomEvents: [],
    sent: [],
    snapshots: 0,
  };
  Object.defineProperty(window, "__cssQuakeMpDeepTrace", {
    value: trace,
    configurable: true,
  });

  const NativeWebSocket = window.WebSocket;
  function record(bucket, data) {
    if (typeof data !== "string") return;
    try {
      const message = JSON.parse(data);
      if (!message || typeof message !== "object") return;
      if (bucket === "sent") {
        trace.sent.push(compactTraceMessage(message));
        if (trace.sent.length > 500) trace.sent.shift();
        return;
      }
      trace.received.push(compactTraceMessage(message));
      if (trace.received.length > 500) trace.received.shift();
      if (message.type === "room.snapshot") {
        trace.snapshots += 1;
        trace.lastSnapshot = message.payload;
      }
      if (message.type === "room.event" && message.payload?.event) {
        const event = message.payload.event;
        trace.events.push(event.eventType);
        trace.roomEvents.push(event);
        if (trace.roomEvents.length > 200) trace.roomEvents.shift();
        if (String(event.eventType ?? "").startsWith("player.")) {
          trace.playerEvents.push(event);
          if (trace.playerEvents.length > 200) trace.playerEvents.shift();
        }
        if (trace.events.length > 500) trace.events.shift();
      }
      if (message.type === "room.reject") {
        trace.rejects.push(message.payload);
        if (trace.rejects.length > 100) trace.rejects.shift();
      }
    } catch {
      return;
    }
  }

  function compactTraceMessage(message) {
    const payload = message.payload ?? null;
    const compact = {
      messageId: message.messageId ?? null,
      sequence: message.sequence ?? null,
      type: message.type ?? null,
    };
    if (message.type === "client.fire") {
      compact.payload = payload;
    } else if (message.type === "client.input") {
      compact.payload = {
        activeWeapon: payload?.input?.activeWeapon ?? null,
        clientId: payload?.clientId ?? null,
        inputSequence: payload?.input?.inputSequence ?? null,
      };
    } else if (message.type === "client.inputBatch") {
      compact.payload = {
        clientId: payload?.clientId ?? null,
        inputCount: Array.isArray(payload?.inputs) ? payload.inputs.length : 0,
        inputSequences: Array.isArray(payload?.inputs)
          ? payload.inputs.map((input) => input?.inputSequence ?? null)
          : [],
      };
    } else if (message.type === "room.event") {
      compact.event = payload?.event ?? null;
    } else if (message.type === "room.reject") {
      compact.payload = payload;
    } else if (message.type === "room.snapshot") {
      compact.players = Array.isArray(payload?.players)
        ? payload.players.map((player) => ({
            alive: player.alive,
            clientId: player.clientId,
            health: player.health,
            origin: player.origin,
            playerId: player.playerId,
            rotX: player.rotX,
            rotY: player.rotY,
            weapon: player.activeWeapon ?? player.inventory?.activeWeapon ?? null,
          }))
        : [];
      compact.projectiles = Array.isArray(payload?.projectiles)
        ? payload.projectiles.map((projectile) => ({
            origin: projectile.origin,
            ownerPlayerId: projectile.ownerPlayerId,
            projectileId: projectile.projectileId,
            updatedAt: projectile.updatedAt,
            weapon: projectile.weapon,
          }))
        : [];
    }
    return compact;
  }

  function WrappedWebSocket(...socketArgs) {
    trace.connections.push(String(socketArgs[0] ?? ""));
    if (trace.connections.length > 20) trace.connections.shift();
    const socket = new NativeWebSocket(...socketArgs);
    const nativeSend = socket.send;
    socket.send = function send(data) {
      record("sent", data);
      return nativeSend.call(this, data);
    };
    socket.addEventListener("message", (event) => record("received", event.data));
    return socket;
  }
  WrappedWebSocket.prototype = NativeWebSocket.prototype;
  Object.setPrototypeOf(WrappedWebSocket, NativeWebSocket);
  window.WebSocket = WrappedWebSocket;
}

function buildReport({ appUrl, checks, mapName, partyHost }) {
  const failures = checks.flatMap((check) =>
    check.pass ? [] : check.failures.map((failure) => `${check.kind}:${check.weapon ?? check.direction ?? check.room}: ${failure}`)
  );
  const pageErrors = checks.flatMap((check) => check.clients ?? [check.attacker, check.victim].filter(Boolean))
    .flatMap((client) => client?.pageErrors ?? []);
  const requestFailures = checks.flatMap((check) => check.clients ?? [check.attacker, check.victim].filter(Boolean))
    .flatMap((client) => client?.requestFailures ?? []);
  if (pageErrors.length) failures.push(`${pageErrors.length} page error(s) were reported.`);
  if (requestFailures.length) failures.push(`${requestFailures.length} request failure(s) were reported.`);
  return {
    kind: "cssquake-multiplayer-deep-checks",
    generatedAt: new Date().toISOString(),
    target: {
      appUrl,
      partyHost,
      mapName,
    },
    aggregate: {
      checks: checks.length,
      passed: checks.filter((check) => check.pass).length,
      pageErrors: pageErrors.length,
      requestFailures: requestFailures.length,
    },
    checks,
    failures,
  };
}

function printSummary(report, artifact) {
  console.log(`target: app=${report.target.appUrl}, party=${report.target.partyHost}, map=${report.target.mapName}`);
  console.log(`checks: passed ${report.aggregate.passed}/${report.aggregate.checks}, page errors ${report.aggregate.pageErrors}, request failures ${report.aggregate.requestFailures}`);
  for (const check of report.checks) {
    if (check.kind === "controlled-damage") {
      console.log(`damage ${check.direction} ${check.weapon}: ${check.pass ? "pass" : "fail"} damage=${check.event?.damage ?? "n/a"} health=${check.event?.health ?? "n/a"} decision=${lastFireDecisionSummary(check)} victimFrames=${compactCounts(countAll(check.remoteAnimation.names))} attackerFrames=${compactCounts(countAll(check.remoteAttackAnimation?.names ?? []))}`);
    } else if (check.kind === "map-readiness") {
      const failedMaps = (check.maps ?? []).filter((sample) => !sample.pass).map((sample) => sample.mapName);
      console.log(`map readiness: ${check.pass ? "pass" : "fail"} maps=${check.passedMapCount}/${check.mapCount}${failedMaps.length ? ` failed=${failedMaps.join(",")}` : ""}`);
    } else if (check.kind === "controlled-sustained-damage") {
      console.log(`sustained ${check.direction} ${check.weapon}: ${check.pass ? "pass" : "fail"} healths=${check.events.map((event) => event.health).join(",") || "n/a"} fires=${check.fireResults.map(String).join(",")} frames=${compactCounts(countAll(check.remoteAnimation.names))}`);
    } else if (check.kind === "controlled-kill") {
      console.log(`kill ${check.weapon}: ${check.pass ? "pass" : "fail"} killed=${check.event ? "yes" : "no"} frames=${compactCounts(countAll(check.remoteAnimation.names))}`);
    } else if (check.kind === "controlled-respawn") {
      console.log(`respawn ${check.weapon}: ${check.pass ? "pass" : "fail"} respawned=${check.respawnEvent ? "yes" : "no"} postDamage=${check.postRespawnDamage?.health ?? "n/a"} deathFrames=${compactCounts(countAll(check.deathAnimation.names))} postFrames=${compactCounts(countAll(check.postAnimation.names))}`);
    } else if (check.kind === "controlled-projectile") {
      console.log(`projectile ${check.weapon}: ${check.pass ? "pass" : "fail"} spawned=${check.spawned ? "yes" : "no"} visible=${check.visibleProjectile ? "yes" : "no"} moved=${check.movedProjectile ? "yes" : "no"} impact=${check.impacted?.impactKind ?? "n/a"} victimHealth=${check.after?.health ?? "n/a"} attackerHealth=${check.afterAttacker?.health ?? "n/a"} explosion=${check.explosionSprite ? "yes" : "no"} attackerFrames=${compactCounts(countAll(check.remoteAttackAnimation?.names ?? []))}`);
    } else if (check.kind === "shared-pickup") {
      console.log(`shared pickup ${check.weapon}: ${check.pass ? "pass" : "fail"} entity=${check.pickup?.pickupEntityIndex ?? "n/a"} taken=${check.takenEvents?.length ?? 0} duplicateReject=${check.duplicateRejected?.reason ?? "n/a"}`);
    } else if (check.kind === "local-world-mutation") {
      console.log(`local world mutation: ${check.pass ? "pass" : "fail"} entity=${check.target?.entityIndex ?? "n/a"} health=${check.target?.health ?? "n/a"} impact=${check.impact?.impactResult ?? "n/a"}`);
    } else if (check.kind === "world-interaction") {
      const mover = check.after?.[0]?.mover;
      console.log(`world interaction ${check.mapName}: ${check.pass ? "pass" : "fail"} trigger=${check.prepared?.trigger?.entityIndex ?? "n/a"} mover=${mover?.entityIndex ?? check.prepared?.door?.entityIndex ?? "n/a"} mode=${mover?.mode ?? "n/a"}`);
    } else if (check.kind === "spawn-escape") {
      const maxLocal = Math.max(...(check.samples ?? []).map((sample) =>
        sample.movement?.maxLocalHorizontalDistance ?? 0
      ));
      const maxAuthoritative = Math.max(...(check.samples ?? []).map((sample) =>
        sample.movement?.maxAuthoritativeHorizontalDistance ?? 0
      ));
      console.log(`spawn escape ${check.mapName}: ${check.pass ? "pass" : "fail"} samples=${check.sampleCount ?? 0} uniqueSpawns=${check.uniqueSpawnIds?.length ?? 0} maxLocal=${maxLocal.toFixed(3)} maxRoom=${maxAuthoritative.toFixed(3)}`);
    } else if (check.kind === "room-lifecycle") {
      const overflow = check.snapshots?.at(-1)?.multiplayer?.lastReject?.code ?? "n/a";
      console.log(`room lifecycle: ${check.pass ? "pass" : "fail"} players=${check.maxPlayers} spectators=${check.spectatorSlots} overflow=${overflow}`);
    } else if (check.kind === "wrong-map") {
      const reject = check.snapshots?.[1]?.multiplayer?.lastReject?.code ?? "n/a";
      console.log(`wrong-map ${check.hostMapName}->${check.wrongMapName}: ${check.pass ? "pass" : "fail"} reject=${reject}`);
    } else {
      console.log(`${check.kind}: ${check.pass ? "pass" : "fail"}`);
    }
  }
  console.log(`failures: ${report.failures.length ? report.failures.join(" | ") : "none"}`);
  if (artifact) console.log(`artifact: ${artifact}`);
}

function lastFireDecisionSummary(check) {
  const events = [
    ...(check.after?.playerEvents ?? []),
    ...(check.afterAttacker?.playerEvents ?? []),
  ];
  const fired = events.findLast((event) =>
    event?.eventType === "player.fired" &&
    event?.weapon === check.weapon
  );
  const decision = fired?.decision;
  return decision ? `${decision.outcome}:${decision.reason}` : "n/a";
}

function findPlayerDamageOutcome(snapshot, expected) {
  const events = [
    ...(snapshot.trace?.playerEvents ?? []),
    ...(snapshot.trace?.roomEvents ?? []),
    ...(snapshot.playerEvents ?? []),
    ...(snapshot.roomEvents ?? []),
  ];
  return events.findLast((event) =>
    event?.eventType === expected.eventType &&
    event?.attackerPlayerId === expected.attackerPlayerId &&
    event?.victimPlayerId === expected.victimPlayerId &&
    event?.damageSource === expected.damageSource
  ) ?? null;
}

function snapshotPlayer(snapshot, playerId) {
  return snapshot.trace?.lastSnapshot?.players?.find((player) => player.playerId === playerId) ?? null;
}

function compactClient(client) {
  return {
    index: client.index,
    url: client.url,
    pageErrors: client.pageErrors,
    requestFailures: client.requestFailures,
  };
}

function compactSpawnEscapePlayer(player) {
  if (!player) return null;
  return {
    alive: player.alive,
    clientId: player.clientId,
    health: player.health,
    origin: player.origin,
    playerId: player.playerId,
    spawnId: player.spawnId ?? null,
  };
}

function compactSnapshot(snapshot) {
  return {
    clientId: snapshot.stats?.multiplayer?.clientId ?? null,
    health: snapshot.stats?.playerHealth ?? null,
    multiplayer: {
      helloAccepted: snapshot.stats?.multiplayer?.helloAccepted ?? null,
      inputPaused: snapshot.stats?.multiplayer?.inputPaused ?? null,
      inputSequence: snapshot.stats?.multiplayer?.inputSequence ?? null,
      lastReject: snapshot.stats?.multiplayer?.lastReject ?? null,
      remoteDomCount: snapshot.stats?.multiplayer?.remoteDomCount ?? null,
      remoteProjectileCount: snapshot.stats?.multiplayer?.remoteProjectileCount ?? null,
      remoteProjectileDomCount: snapshot.stats?.multiplayer?.remoteProjectileDomCount ?? null,
      remoteVisibleProjectileDomCount: snapshot.stats?.multiplayer?.remoteVisibleProjectileDomCount ?? null,
      remoteVisibleDomCount: snapshot.stats?.multiplayer?.remoteVisibleDomCount ?? null,
      scoreboardRows: snapshot.stats?.multiplayer?.scoreboardRows ?? null,
      sessionState: snapshot.stats?.multiplayer?.sessionState ?? null,
      spectating: snapshot.stats?.multiplayer?.spectating ?? null,
      spectatorCount: snapshot.stats?.multiplayer?.spectatorCount ?? null,
      spectatorFollowedPlayerId: snapshot.stats?.multiplayer?.spectatorFollowedPlayerId ?? null,
    },
    remotePlayers: snapshot.remotePlayers,
    remoteProjectiles: snapshot.remoteProjectiles,
    hud: snapshot.hud ?? null,
    pickups: snapshot.stats?.pickups ?? null,
    pickupStates: (snapshot.trace.lastSnapshot?.pickups ?? []).map((pickup) => ({
      entityIndex: pickup.entityIndex,
      available: pickup.available,
      respawnAt: pickup.respawnAt ?? null,
      ownerPlayerIds: pickup.ownerPlayerIds ?? [],
    })),
    playerEvents: snapshot.trace.playerEvents,
    received: snapshot.trace.received.slice(-20),
    rejects: snapshot.trace.rejects,
    roomEvents: snapshot.trace.roomEvents.slice(-20),
    sent: snapshot.trace.sent.slice(-20),
    error: snapshot.error ?? null,
  };
}

function remoteAnimationSummary(samples) {
  return {
    count: samples.length,
    names: [...new Set(samples.map((sample) => sample.frameName).filter(Boolean))],
  };
}

async function findFreePort(preferred, reserved = new Set()) {
  let port = preferred;
  while (reserved.has(port) || !(await portAvailable(port))) port += 1;
  return port;
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function startManagedServer({ name, command, args, ready, timeoutMs }) {
  const logs = [];
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const appendLog = (chunk) => {
    logs.push(chunk.toString());
    while (logs.length > 80) logs.shift();
  };
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = logs.join("");
    if (ready.test(text)) return { name, child, logs };
    if (child.exitCode !== null) {
      throw new Error(`${name} exited before ready.\n${text}`);
    }
    await sleep(100);
  }
  child.kill("SIGTERM");
  throw new Error(`Timed out waiting for ${name}.\n${logs.join("")}`);
}

async function stopManagedServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  const started = Date.now();
  while (server.child.exitCode === null && Date.now() - started < 3_000) await sleep(100);
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
}

async function assertHttpReady(url, timeoutMs) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

function createRoomToken(length = 8) {
  let token = "";
  for (let index = 0; index < length; index += 1) {
    token += ROOM_TOKEN_ALPHABET[Math.floor(Math.random() * ROOM_TOKEN_ALPHABET.length)];
  }
  return token;
}

function wrongMapProbeMap(mapName) {
  return String(mapName).trim().toLowerCase() === "e1m1" ? "e1m7" : "e1m1";
}

function createDeepRoomName(...parts) {
  const token = createRoomToken(8);
  const label = parts.map(compactRoomNamePart).filter(Boolean).join("-");
  return [`d${token}`, label].filter(Boolean).join("-").slice(0, DEBUG_ROOM_ID_MAX_LENGTH);
}

function compactRoomNamePart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 8);
}

function colorForClient(index) {
  const colors = ["#f2a94b", "#4ba3ff", "#78d66b", "#e66b91"];
  return colors[index % colors.length];
}

function countAll(values) {
  const counts = {};
  for (const value of values) {
    const key = String(value ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function compactCounts(counts) {
  const entries = Object.entries(counts ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "none";
}
