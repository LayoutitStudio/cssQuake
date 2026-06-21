#!/usr/bin/env node
import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import { assertAssetState, readAssetManifest, projectRoot } from "../assets/checkAssetState.mjs";
import {
  collectPageErrors,
  hasFlag,
  loadChromium,
  numberOption,
  optionValue,
  parseCommonBrowserArgs,
  writeJsonArtifact,
} from "./browserHarnessSupport.mjs";

const DEFAULT_PORT = 5189;
const DEFAULT_PARTY_PORT = 1999;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_VIEWPORT = "960x540";
const DEFAULT_DURATION_MS = 6_000;
const DEFAULT_JSON_OUT = "bench/results/quake/multiplayer-browser-smoke.json";
const ROOM_TOKEN_ALPHABET = "bcdfghjkmnpqrstvwxyz23456789";

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
const clientsCount = Math.max(2, Math.min(4, Math.round(numberOption(args, "clients", 2))));
const durationMs = Math.max(1_000, Math.round(numberOption(args, "duration-ms", DEFAULT_DURATION_MS)));
const fireEnabled = hasFlag(args, "fire");
const mapName = optionValue(args, "map", "e1m1").trim().toLowerCase();
const preferredPartyPort = Math.max(1, Math.round(numberOption(args, "party-port", DEFAULT_PARTY_PORT)));

console.log("Multiplayer browser smoke gate");
console.log("validates: PartyKit room join, compact invite route, isolated browser clients, remote player movement, zero rejects");
console.log(`requires prepared assets: yes, map ${mapName}`);
console.log("classification: multiplayer acceptance");
assertAssetState({ requiredMaps: [mapName], requireRenderBundle: true, requireGameLogic: true });

const manifest = readAssetManifest();
const invite = createCompactInvite(manifest, mapName);
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
  await assertHttpReady(`http://${partyHost}/parties/main/${encodeURIComponent(invite.internalRoom)}`, common.timeoutMs);

  const chromium = await loadChromium();
  browser = await chromium.launch({ headless: !common.headed });
  const clients = await Promise.all(Array.from({ length: clientsCount }, (_, index) =>
    openClient(browser, {
      appUrl,
      clientIndex: index,
      clientsCount,
      invite,
      mapName,
      partyHost,
      timeoutMs: common.timeoutMs,
      viewport: common.viewport,
    })
  ));

  await Promise.all(clients.map((client) => prepareClientForPlay(client, clientsCount, common.timeoutMs)));
  const before = await Promise.all(clients.map(readClientSnapshot));
  await driveClients(clients, { durationMs, fireEnabled });
  const after = await Promise.all(clients.map(readClientSnapshot));

  const report = buildReport({
    after,
    appUrl,
    before,
    clients,
    clientsCount,
    durationMs,
    fireEnabled,
    invite,
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
  node test/browser/runMultiplayerBrowserSmoke.mjs [options]

Options:
  --map <name>          Map route. Default: e1m1
  --clients <n>         Active browser players, 2-4. Default: 2
  --duration-ms <ms>    Input-driving duration. Default: ${DEFAULT_DURATION_MS}
  --fire                Also trigger debug weapon fire while moving.
  --port <port>         Preferred Vite port. Default: ${DEFAULT_PORT}
  --party-port <port>   Preferred PartyKit port. Default: ${DEFAULT_PARTY_PORT}
  --headed              Run Chromium headed.
  --viewport <WxH>      Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>     Server/page readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --json-out <file>     Report path. Default: ${DEFAULT_JSON_OUT}`);
}

async function openClient(browser, options) {
  const context = await browser.newContext({
    viewport: options.viewport,
    deviceScaleFactor: 1,
  });
  await context.addInitScript(installWebSocketTrace);
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
    timeout: options.timeoutMs,
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
  url.searchParams.set("room", options.invite.value);
  url.searchParams.set("partyHost", options.partyHost);
  url.searchParams.set("clientId", `browser-${options.clientIndex + 1}`);
  url.searchParams.set("player", `Browser ${options.clientIndex + 1}`);
  url.searchParams.set("color", colorForClient(options.clientIndex));
  url.searchParams.set("maxPlayers", String(options.clientsCount));
  url.searchParams.set("disableEnemies", "1");
  return url.toString();
}

async function prepareClientForPlay(client, clientsCount, timeoutMs) {
  await client.page.waitForFunction(() => {
    const stats = window.__cssQuakeDebug?.stats?.();
    return Boolean(stats && !stats.loading && stats.multiplayer?.sessionState === "connected");
  }, undefined, { timeout: timeoutMs });

  await client.page.evaluate(() => {
    const debug = window.__cssQuakeDebug;
    debug.setWeapon?.("axe");
    const host = document.querySelector("#quake-app [tabindex='0']");
    if (host instanceof HTMLElement) host.focus({ preventScroll: true });
  });

  await client.page.waitForFunction(({ minPlayers }) => {
    const stats = window.__cssQuakeDebug?.stats?.();
    const rows = document.querySelectorAll("#quake-multiplayer-scoreboard tbody tr");
    return Boolean(
      stats &&
      !stats.loading &&
      stats.multiplayer?.helloAccepted === true &&
      stats.multiplayer?.inputPaused === false &&
      !document.body.classList.contains("quake-menu-open") &&
      !document.body.classList.contains("quake-menu-unlocked") &&
      rows.length >= minPlayers
    );
  }, { minPlayers: clientsCount }, { timeout: timeoutMs });
}

async function driveClients(clients, { durationMs, fireEnabled }) {
  const keys = ["w", "a", "d", "s"];
  const startedAt = Date.now();
  let tick = 0;
  while (Date.now() - startedAt < durationMs) {
    await Promise.all(clients.map(async (client) => {
      const key = keys[(tick + client.index) % keys.length];
      await client.page.keyboard.down(key);
      await client.page.waitForTimeout(120);
      if (fireEnabled && tick % 4 === 0) await client.page.evaluate(() => window.__cssQuakeDebug?.fire?.());
      await client.page.keyboard.up(key);
    }));
    tick += 1;
    await sleep(120);
  }
  await Promise.all(clients.map(async (client) => {
    for (const key of keys) await client.page.keyboard.up(key).catch(() => undefined);
  }));
}

async function readClientSnapshot(client) {
  return await client.page.evaluate(() => {
    const stats = window.__cssQuakeDebug?.stats?.() ?? null;
    const trace = window.__cssQuakeMpTrace ??
      { connections: [], sent: [], received: [], events: [], rejects: [], snapshots: 0 };
    const remotePlayers = Array.from(document.querySelectorAll("[data-player-id][data-client-id]"))
      .map((element) => ({
        playerId: element.dataset.playerId ?? null,
        clientId: element.dataset.clientId ?? null,
        hidden: element instanceof HTMLElement ? element.hidden : false,
        transform: element instanceof HTMLElement ? element.style.transform : "",
        computedTransform: element instanceof HTMLElement ? getComputedStyle(element).transform : "",
      }));
    return {
      stats,
      presentation: {
        menuOpen: document.body.classList.contains("quake-menu-open"),
        menuUnlocked: document.body.classList.contains("quake-menu-unlocked"),
        multiplayerInputPaused: document.body.classList.contains("quake-multiplayer-input-paused"),
      },
      remotePlayers,
      scoreboardRows: Array.from(document.querySelectorAll("#quake-multiplayer-scoreboard tbody tr"))
        .map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim() ?? "")),
      mpTrace: {
        connections: trace.connections,
        sent: trace.sent,
        received: trace.received,
        events: trace.events,
        rejects: trace.rejects,
        snapshots: trace.snapshots,
      },
    };
  });
}

function installWebSocketTrace() {
  const trace = {
    connections: [],
    events: [],
    received: [],
    rejects: [],
    sent: [],
    snapshots: 0,
  };
  Object.defineProperty(window, "__cssQuakeMpTrace", {
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
        trace.sent.push(message.type);
        if (trace.sent.length > 500) trace.sent.shift();
        return;
      }
      trace.received.push(message.type);
      if (trace.received.length > 500) trace.received.shift();
      if (message.type === "room.snapshot") trace.snapshots += 1;
      if (message.type === "room.event" && message.payload?.event?.eventType) {
        trace.events.push(message.payload.event.eventType);
        if (trace.events.length > 500) trace.events.shift();
      }
      if (message.type === "room.reject") {
        trace.rejects.push({
          code: message.payload?.code ?? "unknown",
          message: message.payload?.message ?? "",
          recoverable: Boolean(message.payload?.recoverable),
          rejectedMessageId: message.payload?.rejectedMessageId ?? null,
          retryAfterMs: message.payload?.retryAfterMs ?? null,
        });
        if (trace.rejects.length > 50) trace.rejects.shift();
      }
    } catch {
      return;
    }
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

function buildReport({ after, appUrl, before, clients, clientsCount, durationMs, fireEnabled, invite, mapName, partyHost }) {
  const clientReports = clients.map((client, index) => ({
    index,
    url: client.url,
    before: before[index],
    after: after[index],
    pageErrors: client.pageErrors,
    requestFailures: client.requestFailures,
  }));
  const aggregate = {
    clients: clientsCount,
    loaded: clientReports.filter((client) => client.after.stats?.loading === false).length,
    scoreboardReady: clientReports.filter((client) => client.after.scoreboardRows.length >= clientsCount).length,
    remotePlayersReady: clientReports.filter((client) => client.after.remotePlayers.length >= clientsCount - 1).length,
    remotePlayersVisible: clientReports.filter((client) =>
      client.after.remotePlayers.filter((player) => !player.hidden).length >= clientsCount - 1
    ).length,
    remotePlayersMoved: clientReports.filter((client) =>
      remotePlayersMoved(client.before.remotePlayers, client.after.remotePlayers)
    ).length,
    presentationReady: clientReports.filter((client) =>
      client.after.presentation.menuOpen === false &&
      client.after.presentation.menuUnlocked === false &&
      client.after.presentation.multiplayerInputPaused === false &&
      client.after.stats?.multiplayer?.inputPaused === false
    ).length,
    moved: clientReports.filter((client) =>
      distance3(client.before.stats?.origin, client.after.stats?.origin) > 0.01
    ).length,
    websocket: {
      sentByType: countAll(clientReports.flatMap((client) => client.after.mpTrace.sent)),
      receivedByType: countAll(clientReports.flatMap((client) => client.after.mpTrace.received)),
      events: countAll(clientReports.flatMap((client) => client.after.mpTrace.events)),
      snapshots: clientReports.reduce((total, client) => total + client.after.mpTrace.snapshots, 0),
      rejects: clientReports.flatMap((client) => client.after.mpTrace.rejects),
    },
    errors: {
      page: clientReports.reduce((total, client) => total + client.pageErrors.length, 0),
      request: clientReports.reduce((total, client) => total + client.requestFailures.length, 0),
    },
  };
  const report = {
    kind: "cssquake-multiplayer-browser-smoke",
    generatedAt: new Date().toISOString(),
    target: {
      appUrl,
      partyHost,
      room: invite.internalRoom,
      invite: invite.value,
      mapName,
    },
    options: {
      clients: clientsCount,
      durationMs,
      fireEnabled,
    },
    aggregate,
    clients: clientReports,
    failures: [],
  };
  report.failures = validateReport(report);
  return report;
}

function validateReport(report) {
  const failures = [];
  const clients = report.options.clients;
  if (report.aggregate.loaded !== clients) failures.push(`Only ${report.aggregate.loaded}/${clients} clients loaded.`);
  if (report.aggregate.scoreboardReady !== clients) failures.push(`Only ${report.aggregate.scoreboardReady}/${clients} clients saw the full scoreboard.`);
  if (report.aggregate.remotePlayersReady !== clients) failures.push(`Only ${report.aggregate.remotePlayersReady}/${clients} clients saw remote player DOM.`);
  if (report.aggregate.remotePlayersVisible !== clients) failures.push(`Only ${report.aggregate.remotePlayersVisible}/${clients} clients saw visible remote players.`);
  if (report.aggregate.presentationReady !== clients) failures.push(`Only ${report.aggregate.presentationReady}/${clients} clients entered active play presentation.`);
  if (report.aggregate.moved !== clients) failures.push(`Only ${report.aggregate.moved}/${clients} clients moved locally.`);
  if (report.aggregate.remotePlayersMoved !== clients) failures.push(`Only ${report.aggregate.remotePlayersMoved}/${clients} clients saw remote player movement.`);
  if (report.aggregate.websocket.snapshots === 0) failures.push("No room snapshots were observed.");
  if (report.aggregate.websocket.rejects.length) failures.push(`Room rejected ${report.aggregate.websocket.rejects.length} message(s).`);
  if (report.aggregate.errors.page) failures.push(`${report.aggregate.errors.page} page error(s) were reported.`);
  if (report.aggregate.errors.request) failures.push(`${report.aggregate.errors.request} request failure(s) were reported.`);
  for (const client of report.clients) {
    const multiplayer = client.after.stats?.multiplayer;
    if (multiplayer?.roomId !== report.target.room) {
      failures.push(`Client ${client.index} joined room ${String(multiplayer?.roomId)} instead of ${report.target.room}.`);
    }
    if (multiplayer?.partyHost !== report.target.partyHost) {
      failures.push(`Client ${client.index} used party host ${String(multiplayer?.partyHost)} instead of ${report.target.partyHost}.`);
    }
    if (!client.after.mpTrace.connections.some((url) => socketUrlMatchesTarget(url, report.target))) {
      failures.push(`Client ${client.index} did not open a WebSocket for ${report.target.room}.`);
    }
  }
  return failures;
}

function printSummary(report, artifact) {
  console.log(`target: app=${report.target.appUrl}, party=${report.target.partyHost}, room=${report.target.room}, invite=${report.target.invite}`);
  console.log(`clients: loaded ${report.aggregate.loaded}/${report.options.clients}, scoreboard ${report.aggregate.scoreboardReady}/${report.options.clients}, remote DOM ${report.aggregate.remotePlayersReady}/${report.options.clients}, visible ${report.aggregate.remotePlayersVisible}/${report.options.clients}`);
  console.log(`play: moved ${report.aggregate.moved}/${report.options.clients}, remote movement ${report.aggregate.remotePlayersMoved}/${report.options.clients}, snapshots ${report.aggregate.websocket.snapshots}, rejects ${report.aggregate.websocket.rejects.length}`);
  console.log(`messages sent: ${compactCounts(report.aggregate.websocket.sentByType)}`);
  console.log(`messages received: ${compactCounts(report.aggregate.websocket.receivedByType)}`);
  console.log(`events: ${compactCounts(report.aggregate.websocket.events)}`);
  console.log(`failures: ${report.failures.length ? report.failures.join(" | ") : "none"}`);
  if (artifact) console.log(`artifact: ${artifact}`);
}

function remotePlayersMoved(before, after) {
  const beforeByClient = new Map((before ?? []).map((player) => [player.clientId, player]));
  for (const player of after ?? []) {
    if (!player.clientId || player.hidden) continue;
    const previous = beforeByClient.get(player.clientId);
    if (!previous || previous.hidden) continue;
    if (player.transform !== previous.transform) return true;
    if (player.computedTransform !== previous.computedTransform) return true;
  }
  return false;
}

function distance3(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  return Math.hypot(
    Number(a[0] ?? 0) - Number(b[0] ?? 0),
    Number(a[1] ?? 0) - Number(b[1] ?? 0),
    Number(a[2] ?? 0) - Number(b[2] ?? 0),
  );
}

function createCompactInvite(manifest, mapName) {
  const mapNames = (manifest.maps ?? [])
    .filter((map) => map?.selectable !== false)
    .map((map) => String(map.mapName ?? "").trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const index = mapNames.indexOf(mapName);
  if (index < 0) throw new Error(`Map ${mapName} is not selectable in the generated manifest.`);
  const mapCode = index.toString(36).padStart(2, "0");
  const token = createRoomToken();
  return {
    value: `${mapCode}${token}au`,
    internalRoom: `cssquake-auto-${mapName}-${token}`,
  };
}

function socketUrlMatchesTarget(value, target) {
  try {
    const url = new URL(value);
    return url.host === target.partyHost &&
      url.pathname === `/parties/main/${target.room}` &&
      !url.searchParams.has("region");
  } catch {
    return false;
  }
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

async function startManagedServer({ name, command, args, ready, timeoutMs }) {
  const logs = [];
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  child.stdout.on("data", (chunk) => pushLog(logs, chunk));
  child.stderr.on("data", (chunk) => pushLog(logs, chunk));
  await waitForServerReady(name, child, logs, ready, timeoutMs);
  return { child, logs, name };
}

function pushLog(logs, chunk) {
  const text = stripAnsi(String(chunk));
  logs.push(...text.split(/\r?\n/).filter(Boolean));
  while (logs.length > 80) logs.shift();
}

async function waitForServerReady(name, child, logs, ready, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (logs.some((line) => ready.test(line))) return;
    if (child.exitCode !== null) {
      throw new Error(`${name} exited before ready with code ${child.exitCode}.\n${logs.join("\n")}`);
    }
    await sleep(100);
  }
  throw new Error(`${name} did not become ready within ${timeoutMs}ms.\n${logs.join("\n")}`);
}

async function stopManagedServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  const pid = server.child.pid;
  if (!pid) return;
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    signalProcessGroup(pid, signal);
    if (await waitForExitOrDead(server.child, pid, signal === "SIGTERM" ? 1_500 : 500)) return;
  }
}

function signalProcessGroup(pid, signal) {
  try {
    if (process.platform !== "win32") process.kill(-pid, signal);
    else process.kill(pid, signal);
  } catch {
    // Process already exited or was not in the expected process group.
  }
}

async function waitForExitOrDead(child, pid, timeoutMs) {
  if (child.exitCode !== null) return true;
  return await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(timeoutMs).then(() => !processIsAlive(pid)),
  ]);
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function assertHttpReady(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 101 || response.status === 404) return;
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError ?? new Error(`${url} did not become reachable.`);
}

async function findFreePort(startPort, reserved = new Set()) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (reserved.has(port)) continue;
    if (await portIsFree(port)) return port;
  }
  throw new Error(`Could not find a free port near ${startPort}.`);
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

function stripAnsi(value) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}
