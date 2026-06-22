#!/usr/bin/env node
import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import { assertAssetState, readAssetManifest } from "../assets/checkAssetState.mjs";
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
const CONTROLLED_DAMAGE_CENTER_DROP = 0.85;
const CONTROLLED_WEAPONS = [
  { weapon: "axe", damage: 20, distance: 1.2 },
  { weapon: "shotgun", damage: 24, distance: 3.0 },
];

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
const skipControlledDamage = hasFlag(args, "skip-controlled-damage");
const skipControlledKill = hasFlag(args, "skip-controlled-kill");
const skipReconnect = hasFlag(args, "skip-reconnect");
const controlledWeaponNames = new Set(optionList(args, "weapons", CONTROLLED_WEAPONS.map((spec) => spec.weapon)));
const controlledDirections = optionList(args, "directions", ["a-to-b", "b-to-a"]);

console.log("Multiplayer deep checks");
console.log("validates: controlled A/B damage, remote animation evidence, reconnect no-duplicate state");
console.log(`requires prepared assets: yes, map ${mapName}`);
console.log("classification: multiplayer deep acceptance");
assertAssetState({ requiredMaps: [mapName], requireRenderBundle: true, requireGameLogic: true });

const manifest = readAssetManifest();
const vitePort = await findFreePort(common.port);
const partyPort = await findFreePort(preferredPartyPort, new Set([vitePort]));
const appUrl = `http://127.0.0.1:${vitePort}/`;
const partyHost = `127.0.0.1:${partyPort}`;
const servers = [];
let browser = null;

try {
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
  await assertHttpReady(appUrl, common.timeoutMs);

  const chromium = await loadChromium();
  browser = await chromium.launch({ headless: !common.headed });

  const checks = [];
  if (!skipControlledDamage) {
    for (const spec of CONTROLLED_WEAPONS.filter((candidate) => controlledWeaponNames.has(candidate.weapon))) {
      for (const direction of controlledDirections) {
        checks.push(await runControlledDamageCase({
          appUrl,
          browser,
          common,
          direction,
          mapName,
          manifest,
          partyHost,
          spec,
        }));
      }
    }
  }
  if (!skipControlledKill) {
    checks.push(await runControlledKillCase({
      appUrl,
      browser,
      common,
      mapName,
      manifest,
      partyHost,
    }));
  }
  if (!skipReconnect) {
    checks.push(await runReconnectCase({
      appUrl,
      browser,
      common,
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
  --weapons <list>             Controlled damage weapons. Default: axe,shotgun
  --directions <list>          Controlled damage directions. Default: a-to-b,b-to-a
  --skip-controlled-damage     Skip controlled A/B damage checks.
  --skip-controlled-kill       Skip controlled browser death/kill animation check.
  --skip-reconnect             Skip reconnect check.`);
}

function optionList(args, name, fallback) {
  const raw = optionValue(args, name, fallback.join(","));
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

async function runControlledDamageCase(options) {
  const room = `cssquake-deep-${options.mapName}-${options.spec.weapon}-${options.direction}-${createRoomToken(6)}`;
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
    const pose = await setControlledDuelPose(clients, options.spec, options.direction);
    await Promise.all(clients.map((client) => client.page.evaluate(() => window.__cssQuakeDebug?.syncMultiplayerPose?.())));
    await waitForSnapshotPlayers(clients, 2, options.common.timeoutMs);
    await Promise.all(clients.map((client) => client.page.evaluate((weapon) => window.__cssQuakeDebug?.setWeapon?.(weapon), options.spec.weapon)));

    const attackerIndex = options.direction === "a-to-b" ? 0 : 1;
    const victimIndex = attackerIndex === 0 ? 1 : 0;
    const attacker = clients[attackerIndex];
    const victim = clients[victimIndex];
    const attackerPlayer = await localSnapshotPlayer(attacker);
    const victimPlayer = await localSnapshotPlayer(victim);
    await attacker.page.evaluate(() => window.__cssQuakeDebug?.setMultiplayerInputPaused?.(false));
    await waitForLocalInput(attacker, options.common.timeoutMs);
    await waitForSnapshotPlayerWeapon(clients, attackerPlayer.clientId, options.spec.weapon, options.common.timeoutMs);

    const before = await readClientSnapshot(victim);
    const beforeAttacker = await readClientSnapshot(attacker);
    const fireResult = await attacker.page.evaluate(() => window.__cssQuakeDebug?.fire?.() ?? null);
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
    const impactParticles = event
      ? await waitForImpactParticles(attacker, "blood", 1_000)
      : null;
    if (event) await waitForRemoteFramePrefix(attacker, victimPlayer.clientId, "pain", 1_000);
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
    if (event && !animation.names.some((name) => name.startsWith("pain"))) {
      failures.push("attacker did not sample victim pain animation");
    }
    if (event && (impactParticles?.blood ?? 0) <= 0) {
      failures.push("attacker did not sample remote victim blood particles");
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
      impactParticles,
      pose,
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
  const room = `cssquake-deep-${options.mapName}-shotgun-kill-${createRoomToken(6)}`;
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
    let pose = await setControlledDuelPose(clients, spec, "a-to-b");
    await Promise.all(clients.map((client) => client.page.evaluate(() => window.__cssQuakeDebug?.syncMultiplayerPose?.())));
    await waitForSnapshotPlayers(clients, 2, options.common.timeoutMs);
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
    for (let index = 0; index < 6; index += 1) {
      pose = await setControlledDuelPose(clients, spec, "a-to-b");
      poseUpdates.push(pose);
      await Promise.all(clients.map((client) => client.page.evaluate(() => window.__cssQuakeDebug?.syncMultiplayerPose?.())));
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
    const impactParticles = killEvent
      ? await waitForImpactParticles(attacker, "blood", 1_000)
      : null;
    if (killEvent) await waitForRemoteFramePrefix(attacker, victimPlayer.clientId, "deatha", 1_500);
    const after = await readClientSnapshot(victim);
    const afterAttacker = await readClientSnapshot(attacker);
    const victimSnapshotPlayer = after.trace.lastSnapshot?.players?.find((player) => player.playerId === victimPlayer.playerId);
    if (killEvent) {
      if (victimSnapshotPlayer?.alive !== false) failures.push("victim snapshot did not mark player dead");
      if (victimSnapshotPlayer?.health !== 0) failures.push(`expected victim health 0 after kill, got ${String(victimSnapshotPlayer?.health)}`);
    }
    const animation = remoteAnimationSummary(attacker.afterRemoteFrames ?? []);
    if (killEvent && !animation.names.some((name) => name.startsWith("deatha"))) {
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
      fireResults,
      impactParticles,
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

async function runReconnectCase(options) {
  const room = `cssquake-deep-reconnect-${options.mapName}-${createRoomToken(8)}`;
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
  url.searchParams.set("debug", "1");
  url.searchParams.set("map", options.mapName);
  url.searchParams.set("room", options.room);
  url.searchParams.set("partyHost", options.partyHost);
  url.searchParams.set("clientId", `deep-${options.clientIndex + 1}`);
  url.searchParams.set("player", `Deep ${options.clientIndex + 1}`);
  url.searchParams.set("color", colorForClient(options.clientIndex));
  url.searchParams.set("maxPlayers", String(options.clientsCount));
  url.searchParams.set("disableEnemies", "1");
  if (options.debugMultiplayer) url.searchParams.set("debugMultiplayer", "party");
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

async function waitForRemoteDomCounts(clients, expected, timeoutMs) {
  await Promise.all(clients.map((client) =>
    client.page.waitForFunction((minimum) => {
      const players = Array.from(document.querySelectorAll("[data-player-id][data-client-id]"));
      return players.length >= minimum &&
        players.filter((element) => element instanceof HTMLElement && !element.hidden).length >= minimum;
    }, expected, { timeout: timeoutMs })
  ));
}

async function setControlledDuelPose(clients, spec, direction) {
  const attackerIndex = direction === "a-to-b" ? 0 : 1;
  const victimIndex = attackerIndex === 0 ? 1 : 0;
  const attacker = clients[attackerIndex];
  const victim = clients[victimIndex];
  const aimRotX = (Math.atan2(spec.distance, CONTROLLED_DAMAGE_CENTER_DROP) * 180) / Math.PI;
  const pose = await attacker.page.evaluate((rotX) => {
    const debug = window.__cssQuakeDebug;
    const stats = debug.stats();
    const origin = stats.origin;
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
    };
  }, aimRotX);
  const victimOrigin = [
    pose.origin[0] + pose.horizontalForward[0] * spec.distance,
    pose.origin[1] + pose.horizontalForward[1] * spec.distance,
    pose.origin[2],
  ];
  await victim.page.evaluate(({ origin, rotX, rotY }) => {
    window.__cssQuakeDebug?.setPose?.(origin, rotX, (rotY + 180) % 360, {
      gameplay: true,
      stableViewmodel: true,
    });
  }, { origin: victimOrigin, rotX: pose.rotX, rotY: pose.rotY });
  return {
    attackerIndex,
    victimIndex,
    attackerOrigin: pose.origin,
    attackerForward: pose.forward,
    attackerHorizontalForward: pose.horizontalForward,
    attackerRotX: pose.rotX,
    attackerRotY: pose.rotY,
    damageCenterDrop: CONTROLLED_DAMAGE_CENTER_DROP,
    distance: spec.distance,
    targetCenter: [victimOrigin[0], victimOrigin[1], victimOrigin[2] - CONTROLLED_DAMAGE_CENTER_DROP],
    victimOrigin,
  };
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

async function waitForRemoteFramePrefix(client, remoteClientId, prefix, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const samples = await sampleRemoteFrames(client);
    client.afterRemoteFrames = samples;
    if (samples.some((sample) =>
      sample.clientId === remoteClientId &&
      !sample.hidden &&
      String(sample.frameName ?? "").startsWith(prefix)
    )) {
      return true;
    }
    await sleep(50);
  }
  return false;
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
        hidden: element instanceof HTMLElement ? element.hidden : false,
        frameIndex: element.dataset.remoteFrameIndex ?? null,
        frameName: element.dataset.remoteFrameName ?? null,
      });
    }
    if (trace.remoteFrames.length > 500) trace.remoteFrames.splice(0, trace.remoteFrames.length - 500);
    return trace.remoteFrames;
  });
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
        frameIndex: element.dataset.remoteFrameIndex ?? null,
        frameName: element.dataset.remoteFrameName ?? null,
        hidden: element instanceof HTMLElement ? element.hidden : false,
      }));
    return {
      stats,
      remotePlayers,
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

async function safeReadClientSnapshots(clients) {
  const snapshots = [];
  for (const client of clients) {
    try {
      snapshots.push(await readClientSnapshot(client));
    } catch (error) {
      snapshots.push({
        stats: null,
        remotePlayers: [],
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
        inputSequence: payload?.inputSequence ?? null,
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
      console.log(`damage ${check.direction} ${check.weapon}: ${check.pass ? "pass" : "fail"} damage=${check.event?.damage ?? "n/a"} health=${check.event?.health ?? "n/a"} frames=${compactCounts(countAll(check.remoteAnimation.names))}`);
    } else if (check.kind === "controlled-kill") {
      console.log(`kill ${check.weapon}: ${check.pass ? "pass" : "fail"} killed=${check.event ? "yes" : "no"} frames=${compactCounts(countAll(check.remoteAnimation.names))}`);
    } else {
      console.log(`${check.kind}: ${check.pass ? "pass" : "fail"}`);
    }
  }
  console.log(`failures: ${report.failures.length ? report.failures.join(" | ") : "none"}`);
  if (artifact) console.log(`artifact: ${artifact}`);
}

function compactClient(client) {
  return {
    index: client.index,
    url: client.url,
    pageErrors: client.pageErrors,
    requestFailures: client.requestFailures,
  };
}

function compactSnapshot(snapshot) {
  return {
    clientId: snapshot.stats?.multiplayer?.clientId ?? null,
    health: snapshot.stats?.playerHealth ?? null,
    multiplayer: {
      inputPaused: snapshot.stats?.multiplayer?.inputPaused ?? null,
      inputSequence: snapshot.stats?.multiplayer?.inputSequence ?? null,
      lastReject: snapshot.stats?.multiplayer?.lastReject ?? null,
      remoteDomCount: snapshot.stats?.multiplayer?.remoteDomCount ?? null,
      remoteVisibleDomCount: snapshot.stats?.multiplayer?.remoteVisibleDomCount ?? null,
      scoreboardRows: snapshot.stats?.multiplayer?.scoreboardRows ?? null,
    },
    remotePlayers: snapshot.remotePlayers,
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
