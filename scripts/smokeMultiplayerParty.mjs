#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_VITE_PORT = 5184;
const DEFAULT_PARTY_PORT = 1999;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_VIEWPORT = "1280x800";
const MENU_ROOM_CONTROLS_VIEWPORT = { width: 870, height: 480 };
const MAP_NAME = "e1m1";
const MAP_MISMATCH_NAME = "e1m2";
const TELEPORTER_ENTITY = 178;
const PICKUP_ENTITY = 208;
const SLIME_HAZARD_PROBE = { x: 960, y: 1664, z: -524, damageSource: "slime" };
const COMBAT_HIT_CENTER_Z_OFFSET = -0.85;
const COMBAT_ATTACKER_VIEWPOS = { x: 480, y: -40, z: 30, yaw: 90 };
const COMBAT_VICTIM_VIEWPOS = { x: 480, y: 88, z: 30, yaw: 270 };
const COMBAT_SHOT_COOLDOWN_MS = 650;
const COMBAT_KILL_MAX_FOLLOWUP_SHOTS = 6;
const PICKUP_FOCUS_YAWS = [0, 90, 180, 270];
const ORIGIN_EPSILON = 0.25;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const mapPath = path.join(projectRoot, "build/generated/public/q/e1m1.json");
const defaultServeDir = path.join(projectRoot, "build/generated/public");
const argv = process.argv.slice(2);
let currentSmokePhase = "startup";

function setSmokePhase(phase) {
  currentSmokePhase = phase;
  console.log(`[party-smoke] ${phase}`);
}

function flag(name) {
  return argv.includes(`--${name}`);
}

function option(name, fallback = "") {
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--")) return argv[index + 1];
  const prefixed = argv.find((arg) => arg.startsWith(`--${name}=`));
  return prefixed ? prefixed.slice(name.length + 3) : fallback;
}

function numberOption(name, fallback) {
  const raw = option(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function viewportOption() {
  const raw = option("viewport", DEFAULT_VIEWPORT);
  const match = raw.match(/^(\d+)x(\d+)$/i);
  if (!match) throw new Error(`Invalid --viewport "${raw}". Expected WIDTHxHEIGHT.`);
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function printHelp() {
  console.log(`Usage:
  node scripts/smokeMultiplayerParty.mjs [options]

Options:
  --url <url>             Use an already-running cssQuake dev server.
  --port <port>           Port for the temporary Vite server. Default: ${DEFAULT_VITE_PORT}
  --party-host <host>     Use an already-running PartyKit host, for example 127.0.0.1:1999.
  --party-port <port>     Port for the temporary PartyKit server. Default: ${DEFAULT_PARTY_PORT}
  --serve <path>          Static asset directory for PartyKit --serve. Default: build/generated/public
  --headed                Run Chromium headed.
  --viewport <WxH>        Browser viewport. Default: ${DEFAULT_VIEWPORT}
  --timeout-ms <ms>       Multiplayer readiness timeout. Default: ${DEFAULT_TIMEOUT_MS}

This smoke validates the real PartyKit transport vertical slice with two browser clients:
  both clients join the same room, receive each other's authoritative snapshots,
  render remote players, page A kills and scores against page B through authoritative
  room combat, page B respawns and reconnects with state preserved, page A receives
  authoritative world.teleport and player.damaged events, both clients agree on a
  shared pickup take/respawn, a wrong-map room join is rejected, and a focused room
  reaches frag-limit intermission.`);
}

async function loadChromium() {
  const require = createRequire(import.meta.url);
  try {
    return (await import("playwright")).chromium;
  } catch (error) {
    const roots = [
      ...splitPathList(process.env.PLAYWRIGHT_NODE_MODULES),
      ...splitPathList(process.env.NODE_PATH),
      projectRoot,
      path.join(projectRoot, "node_modules"),
    ];
    for (const root of roots) {
      try {
        const resolved = require.resolve("playwright", { paths: [root] });
        return require(resolved).chromium;
      } catch {
        // Try the next configured module root.
      }
    }
    for (const packageDir of pnpmPackageDirs("playwright")) {
      try {
        return require(packageDir).chromium;
      } catch {
        // Try the next pnpm package directory.
      }
    }
    throw new Error(
      `Could not load Playwright. Install it for this workspace or set PLAYWRIGHT_NODE_MODULES=/path/to/node_modules.\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function pnpmPackageDirs(packageName) {
  const pnpmDir = path.join(projectRoot, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return [];
  return readdirSync(pnpmDir)
    .filter((entry) => entry.startsWith(`${packageName}@`))
    .map((entry) => path.join(pnpmDir, entry, "node_modules", packageName))
    .filter((packageDir) => existsSync(packageDir));
}

function splitPathList(value) {
  return (value ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function preflightMap() {
  if (!existsSync(mapPath)) {
    throw new Error(`Missing ${path.relative(projectRoot, mapPath)}. Run pnpm prepare:quake:map ${MAP_NAME} first.`);
  }
}

function loadTeleporterProbe() {
  const prepared = JSON.parse(readFileSync(mapPath, "utf8"));
  const fact = prepared.gameLogic?.entities?.find?.((entity) => entity.entityIndex === TELEPORTER_ENTITY);
  const bounds = fact?.brushModel;
  const destinationIndex = fact?.resolvedTrigger?.destinationEntityIndexes?.[0];
  const destination = prepared.entities?.find?.((entity) => entity.index === destinationIndex);
  if (
    fact?.classname !== "trigger_teleport" ||
    fact?.resolvedTrigger?.kind !== "trigger_teleport" ||
    !bounds ||
    typeof destinationIndex !== "number" ||
    !destination?.origin
  ) {
    throw new Error(`E1M1 teleporter ${TELEPORTER_ENTITY} facts are missing or not resolved.`);
  }
  return {
    entityIndex: TELEPORTER_ENTITY,
    destinationEntityIndex: destinationIndex,
    pose: {
      x: (bounds.mins.x + bounds.maxs.x) / 2,
      y: (bounds.mins.y + bounds.maxs.y) / 2,
      z: (bounds.mins.z + bounds.maxs.z) / 2,
    },
  };
}

function loadPickupProbe() {
  const prepared = JSON.parse(readFileSync(mapPath, "utf8"));
  const fact = prepared.gameLogic?.entities?.find?.((entity) => entity.entityIndex === PICKUP_ENTITY);
  const respawnRule = fact?.resolvedPickup?.lifecycle?.respawn?.rules?.find?.((rule) => rule.action === "respawn");
  if (
    fact?.classname !== "item_health" ||
    typeof fact?.resolvedPickup?.inventoryDelta?.health !== "number" ||
    !fact?.origin ||
    respawnRule?.delaySeconds !== 20
  ) {
    throw new Error(`E1M1 pickup ${PICKUP_ENTITY} facts are missing or not resolved.`);
  }
  return {
    entityIndex: PICKUP_ENTITY,
    classname: fact.classname,
    origin: fact.origin,
    respawnDelayMs: respawnRule.delaySeconds * 1000,
    stat: "playerHealth",
  };
}

async function startViteServer() {
  const explicitUrl = option("url", process.env.CSSQUAKE_SMOKE_URL ?? "");
  if (explicitUrl) return { url: explicitUrl, close: async () => {} };

  const port = Math.max(1, Math.round(numberOption("port", DEFAULT_VITE_PORT)));
  const child = spawnManaged("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port)]);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const output = child.output();
    const match = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
    if (match) {
      return {
        url: match[1],
        close: () => child.close(),
      };
    }
    if (child.exited()) {
      throw new Error(`Vite exited before becoming ready.\n${output}`);
    }
    await sleep(100);
  }
  await child.close();
  throw new Error(`Timed out waiting for Vite.\n${child.output()}`);
}

async function startPartyServer() {
  const explicitHost = option("party-host", process.env.CSSQUAKE_PARTY_HOST ?? "");
  if (explicitHost) return { host: explicitHost, close: async () => {} };

  const port = Math.max(1, Math.round(numberOption("party-port", DEFAULT_PARTY_PORT)));
  const serveDir = path.resolve(projectRoot, option("serve", defaultServeDir));
  if (!existsSync(serveDir)) {
    throw new Error(`Missing PartyKit --serve directory: ${path.relative(projectRoot, serveDir)}`);
  }
  const child = spawnManaged("pnpm", [
    "exec",
    "partykit",
    "dev",
    "--port",
    String(port),
    "--serve",
    serveDir,
    "--no-hotkeys",
  ]);
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const output = child.output();
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) {
      return {
        host: `127.0.0.1:${match[1]}`,
        close: () => child.close(),
      };
    }
    if (child.exited()) {
      throw new Error(`PartyKit exited before becoming ready.\n${stripAnsi(output)}`);
    }
    await sleep(100);
  }
  await child.close();
  throw new Error(`Timed out waiting for PartyKit.\n${stripAnsi(child.output())}`);
}

function spawnManaged(command, args) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return {
    output: () => output,
    exited: () => child.exitCode !== null,
    close: async () => {
      if (child.exitCode === null && child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
        await sleep(500);
      }
      if (child.exitCode === null && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    },
  };
}

function partyMultiplayerUrl(baseUrl, options) {
  const url = new URL(baseUrl);
  url.searchParams.set("debug", "1");
  url.searchParams.set("debugMultiplayer", "party");
  url.searchParams.set("debugMultiplayerPoseOnly", "1");
  url.searchParams.set("map", options.mapName ?? MAP_NAME);
  url.searchParams.set("room", options.roomId);
  url.searchParams.set("clientId", options.clientId);
  url.searchParams.set("player", options.player);
  url.searchParams.set("color", options.color);
  url.searchParams.set("partyHost", options.partyHost);
  url.searchParams.set("maxPlayers", String(options.maxPlayers ?? 4));
  if (options.fragLimit !== undefined) url.searchParams.set("fraglimit", String(options.fragLimit));
  return url.toString();
}

function menuSmokeUrl(baseUrl, partyHost) {
  const url = new URL(baseUrl);
  url.searchParams.set("debug", "1");
  url.searchParams.set("partyHost", partyHost);
  return url.toString();
}

async function runMenuRoomControlsSmoke(browser, options) {
  const context = await browser.newContext({ viewport: MENU_ROOM_CONTROLS_VIEWPORT });
  await context.addInitScript(() => {
    window.__cssQuakeDebugDomMetadata = true;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__cssQuakeCopiedText = String(text);
        },
      },
    });
  });
  try {
    const joinPage = await context.newPage();
    attachPageLogs(joinPage, options.logs, "M1");
    await openMultiplayerMenu(joinPage, options);
    await fillMultiplayerMenu(joinPage, {
      player: "Menu A",
      color: "#d8893f",
      fragLimit: 7,
      timeLimit: 5,
      maxPlayers: 4,
    });
    await joinPage.locator("#quake-multiplayer-copy").click({ timeout: options.timeoutMs });
    const copiedUrl = await waitForCopiedMultiplayerLink(joinPage, options.timeoutMs);
    const joinRoomId = new URL(copiedUrl).searchParams.get("room") ?? "";
    assertGeneratedMenuInviteId(joinRoomId);
    assertMenuRoomUrl(copiedUrl, {
      inviteId: joinRoomId,
    });
    await joinPage.locator("#quake-multiplayer-join").click({ timeout: options.timeoutMs });
    await waitForMenuNavigation(joinPage, joinRoomId, options.timeoutMs);
    const joinedUrl = joinPage.url();
    assertMenuRoomUrl(joinedUrl, {
      inviteId: joinRoomId,
    });

    const createPage = await context.newPage();
    attachPageLogs(createPage, options.logs, "M2");
    await openMultiplayerMenu(createPage, options);
    await fillMultiplayerMenu(createPage, {
      player: "Menu B",
      color: "#6fb7d8",
      fragLimit: 20,
      timeLimit: 0,
      maxPlayers: 8,
    });
    await createPage.locator("#quake-multiplayer-create").click({ timeout: options.timeoutMs });
    await createPage.waitForURL((url) => {
      const inviteId = url.searchParams.get("room") ?? "";
      return isGeneratedMenuInviteId(inviteId);
    }, { timeout: options.timeoutMs });
    const createUrl = createPage.url();
    const createRoomId = new URL(createUrl).searchParams.get("room") ?? "";
    assertGeneratedMenuInviteId(createRoomId);
    assertMenuRoomUrl(createUrl, {
      inviteId: createRoomId,
    });
    return { joinRoomId, createRoomId };
  } finally {
    await context.close();
  }
}

async function openMultiplayerMenu(page, options) {
  await page.goto(menuSmokeUrl(options.baseUrl, options.partyHost), { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
  await page.waitForFunction(() => window.__cssQuakeDebug?.stats?.().loading === false, null, {
    timeout: options.timeoutMs,
  });
  await page.locator('[data-quake-main-menu-action="multiplayer"]').click({ timeout: options.timeoutMs });
  await page.locator("#quake-multiplayer-panel").waitFor({ state: "visible", timeout: options.timeoutMs });
  await expectNoRoomNameField(page, options.timeoutMs);
  await expectNoMultiplayerMenuControlOverlap(page);
  await page.waitForFunction((mapName) => {
    const select = document.querySelector("#quake-multiplayer-map");
    return Boolean(select?.querySelector(`option[value="${mapName}"]`));
  }, MAP_NAME, { timeout: options.timeoutMs });
}

async function fillMultiplayerMenu(page, values) {
  await page.locator("#quake-multiplayer-name").fill(values.player);
  await page.locator("#quake-multiplayer-map").selectOption(MAP_NAME);
  await page.locator("#quake-multiplayer-fraglimit").fill(String(values.fragLimit));
  await page.locator("#quake-multiplayer-timelimit").fill(String(values.timeLimit));
  await page.locator("#quake-multiplayer-maxplayers").fill(String(values.maxPlayers));
  await page.locator("#quake-multiplayer-color").evaluate((input, color) => {
    input.value = color;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, values.color);
}

function assertGeneratedMenuInviteId(inviteId) {
  if (!isGeneratedMenuInviteId(inviteId)) {
    throw new Error(`Expected generated multiplayer invite id, got "${inviteId}".`);
  }
}

function isGeneratedMenuInviteId(inviteId) {
  return /^[0-9a-z]{2}[bcdfghjkmnpqrstvwxyz23456789]{8}$/i.test(inviteId);
}

async function expectNoRoomNameField(page, timeoutMs) {
  await page.waitForFunction(() => document.querySelector("#quake-multiplayer-room") === null, null, {
    timeout: timeoutMs,
  });
}

async function expectNoMultiplayerMenuControlOverlap(page) {
  const overlaps = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll(
      "#quake-multiplayer-panel .quake-multiplayer-field > .quake-bm-label, " +
        "#quake-multiplayer-panel .quake-multiplayer-field > input, " +
        "#quake-multiplayer-panel .quake-multiplayer-field > select, " +
        "#quake-multiplayer-panel .quake-multiplayer-actions > button, " +
        "#quake-multiplayer-panel-actions > button",
    ));
    const rects = elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.id || element.textContent?.replace(/\s+/g, " ").trim() || element.tagName.toLowerCase(),
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((rect) => rect.width > 0 && rect.height > 0);
    const pairs = [];
    for (let firstIndex = 0; firstIndex < rects.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < rects.length; secondIndex++) {
        const first = rects[firstIndex];
        const second = rects[secondIndex];
        const xOverlap = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
        const yOverlap = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
        if (xOverlap > 1 && yOverlap > 1) {
          pairs.push({ first: first.label, second: second.label, xOverlap, yOverlap });
        }
      }
    }
    return pairs;
  });
  if (overlaps.length > 0) {
    throw new Error(`Multiplayer menu controls overlap at 870x480: ${JSON.stringify(overlaps)}`);
  }
}

async function waitForCopiedMultiplayerLink(page, timeoutMs) {
  await page.waitForFunction(() => {
    return typeof window.__cssQuakeCopiedText === "string" &&
      new URL(window.__cssQuakeCopiedText).searchParams.has("room");
  }, null, { timeout: timeoutMs });
  return page.evaluate(() => window.__cssQuakeCopiedText);
}

async function waitForMenuNavigation(page, inviteId, timeoutMs) {
  await page.waitForURL((url) => {
    return url.searchParams.get("room") === inviteId;
  }, { timeout: timeoutMs });
}

function assertMenuRoomUrl(rawUrl, expected) {
  const url = new URL(rawUrl);
  const actual = {
    paramCount: Array.from(url.searchParams.keys()).length,
    inviteId: url.searchParams.get("room"),
    shortInvite: url.searchParams.get("r"),
    multiplayer: url.searchParams.get("multiplayer"),
    map: url.searchParams.get("map"),
    player: url.searchParams.get("player"),
    color: url.searchParams.get("color"),
    clientId: url.searchParams.get("clientId"),
    debug: url.searchParams.get("debug"),
    fragLimit: url.searchParams.get("fraglimit"),
    timeLimit: url.searchParams.get("timelimit"),
    maxPlayers: url.searchParams.get("maxPlayers"),
    partyHost: url.searchParams.get("partyHost"),
  };
  if (
    actual.paramCount !== 1 ||
    actual.inviteId !== expected.inviteId ||
    actual.shortInvite !== null ||
    actual.multiplayer !== null ||
    actual.map !== null ||
    actual.player !== null ||
    actual.color !== null ||
    actual.clientId !== null ||
    actual.debug !== null ||
    actual.fragLimit !== null ||
    actual.timeLimit !== null ||
    actual.maxPlayers !== null ||
    actual.partyHost !== null
  ) {
    throw new Error(`Unexpected multiplayer menu URL: ${JSON.stringify({ actual, expected, rawUrl })}`);
  }
}

async function runMapMismatchRejectSmoke(browser, options) {
  const roomId = `mismatch-smoke-${Date.now().toString(36)}`;
  const contextA = await browser.newContext({ viewport: options.viewport });
  const contextB = await browser.newContext({ viewport: options.viewport });
  await Promise.all([
    contextA.addInitScript(() => {
      window.__cssQuakeDebugDomMetadata = true;
    }),
    contextB.addInitScript(() => {
      window.__cssQuakeDebugDomMetadata = true;
    }),
  ]);
  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    attachPageLogs(pageA, options.logs, "MM1");
    attachPageLogs(pageB, options.logs, "MM2");
    await pageA.goto(partyMultiplayerUrl(options.baseUrl, {
      roomId,
      clientId: "party-mismatch-a",
      player: "Mismatch A",
      color: "#d8893f",
      partyHost: options.partyHost,
      mapName: MAP_NAME,
    }), { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    await waitForPartySessionReady(pageA, "map mismatch room seed", {
      mapName: MAP_NAME,
      timeoutMs: options.timeoutMs,
    });
    await pageB.goto(partyMultiplayerUrl(options.baseUrl, {
      roomId,
      clientId: "party-mismatch-b",
      player: "Mismatch B",
      color: "#6fb7d8",
      partyHost: options.partyHost,
      mapName: MAP_MISMATCH_NAME,
    }), { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    const reject = await waitForPartyReject(pageB, {
      code: "wrong-map",
      mapName: MAP_MISMATCH_NAME,
      timeoutMs: options.timeoutMs,
    });
    return { roomId, code: reject.multiplayer.lastReject.code };
  } finally {
    await contextA.close();
    await contextB.close();
  }
}

async function waitForPartySessionReady(page, label, options) {
  let last = null;
  const started = Date.now();
  while (Date.now() - started < options.timeoutMs) {
    last = await page.evaluate(() => {
      const stats = window.__cssQuakeDebug?.stats?.();
      return {
        hasDebug: Boolean(window.__cssQuakeDebug),
        loading: stats?.loading,
        mapName: stats?.mapName,
        multiplayer: stats?.multiplayer,
      };
    });
    const multiplayer = last.multiplayer;
    if (
      last.hasDebug &&
      last.loading === false &&
      last.mapName === options.mapName &&
      multiplayer?.enabled === true &&
      multiplayer?.transport === "party" &&
      multiplayer?.sessionState === "connected" &&
      multiplayer?.sessionMode === "network" &&
      multiplayer?.scoreboardRows >= 1
    ) {
      return last;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for ${label} PartyKit session readiness: ${JSON.stringify(last)}`);
}

async function waitForPartyReject(page, options) {
  let last = null;
  const started = Date.now();
  while (Date.now() - started < options.timeoutMs) {
    last = await page.evaluate(() => {
      const stats = window.__cssQuakeDebug?.stats?.();
      return {
        loading: stats?.loading,
        mapName: stats?.mapName,
        multiplayer: stats?.multiplayer,
      };
    });
    const reject = last.multiplayer?.lastReject;
    if (
      last.loading === false &&
      last.mapName === options.mapName &&
      reject?.code === options.code &&
      reject?.recoverable === false
    ) {
      return last;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for PartyKit ${options.code} reject: ${JSON.stringify(last)}`);
}

async function waitForPartyMultiplayerReady(page, label, timeoutMs) {
  let last = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(() => {
      const stats = window.__cssQuakeDebug?.stats?.();
      const multiplayer = stats?.multiplayer;
      return {
        hasDebug: Boolean(window.__cssQuakeDebug),
        loading: stats?.loading,
        mapName: stats?.mapName,
        multiplayer,
      };
    });
    const multiplayer = last.multiplayer;
    if (
      last.hasDebug &&
      last.loading === false &&
      last.mapName === MAP_NAME &&
      multiplayer?.enabled === true &&
      multiplayer?.transport === "party" &&
      multiplayer?.poseOnly === true &&
      multiplayer?.sessionState === "connected" &&
      multiplayer?.sessionMode === "network" &&
      multiplayer?.poseSequence >= 2 &&
      multiplayer?.remotePresenterCount >= 1 &&
      multiplayer?.remoteDomCount >= 1 &&
      multiplayer?.scoreboardRows >= 2
    ) {
      return last;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for ${label} PartyKit multiplayer readiness: ${JSON.stringify(last)}`);
}

async function runCombatDamageSmoke(pageA, pageB, timeoutMs, options = {}) {
  const attackerPlayerId = options.attackerPlayerId ?? "party:client-party-smoke-a";
  const placement = await placeCombatants(pageA, pageB, timeoutMs);
  await waitForRemoteStillVisible(pageA, "page A after combat placement", timeoutMs);
  await waitForRemoteStillVisible(pageB, "page B after combat placement", timeoutMs);
  await pageA.waitForTimeout(500);

  const fired = await fireCombatShot(pageA);
  if (!fired.firedOk) {
    throw new Error(`Could not fire PartyKit combat shot: ${JSON.stringify(fired)}`);
  }

  const damageState = await waitForShotgunDamage(pageB, {
    attackerPlayerId,
    beforeHealth: placement.victimBeforeHealth,
    beforePlayerEventId: placement.victimBeforePlayerEventId,
  }, timeoutMs);
  const killState = await finishCombatKill(pageA, pageB, {
    attackerPlayerId,
    beforePlayerEventId: damageState.event.eventId,
  }, timeoutMs);
  const [scoreboardA, scoreboardB] = await Promise.all([
    waitForCombatScoreboard(pageA, "page A", timeoutMs),
    waitForCombatScoreboard(pageB, "page B", timeoutMs),
  ]);
  let respawnState = null;
  if (options.expectRespawn !== false) {
    respawnState = await waitForVictimRespawn(pageB, timeoutMs);
    await waitForRemoteStillVisible(pageA, "page A after combat respawn", timeoutMs);
    await waitForRemoteStillVisible(pageB, "page B after combat respawn", timeoutMs);
  }

  return {
    damage: { ...damageState, fired },
    kill: killState,
    respawn: respawnState,
    scoreboardA,
    scoreboardB,
  };
}

async function fireCombatShot(page) {
  return page.evaluate(() => {
    const debug = window.__cssQuakeDebug;
    const before = debug?.stats?.();
    const firedOk = debug?.fire?.() ?? false;
    const after = debug?.stats?.();
    return {
      activeWeapon: before?.activeWeapon,
      beforeShells: before?.playerShells,
      afterShells: after?.playerShells,
      firedOk,
    };
  });
}

async function waitForShotgunDamage(page, expected, timeoutMs) {
  let last = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate((probe) => {
      const stats = window.__cssQuakeDebug?.stats?.();
      const event = stats?.multiplayer?.lastPlayerEvent;
      return {
        playerHealth: stats?.playerHealth,
        playerArmor: stats?.playerArmor,
        multiplayer: stats?.multiplayer,
        event,
        damaged: event?.eventType === "player.damaged" &&
          event?.eventId !== probe.beforePlayerEventId &&
          event?.damageSource === "shotgun" &&
          event?.attackerPlayerId === probe.attackerPlayerId &&
          typeof event?.health === "number" &&
          typeof probe.beforeHealth === "number" &&
          event.health < probe.beforeHealth &&
          stats?.playerHealth === event.health,
      };
    }, expected);
    if (last.damaged) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for PartyKit shotgun damage on page B: ${JSON.stringify({ expected, last })}`);
}

async function finishCombatKill(pageA, pageB, expected, timeoutMs) {
  const shots = [];
  let last = null;
  const started = Date.now();
  for (let shot = 0; shot < COMBAT_KILL_MAX_FOLLOWUP_SHOTS && Date.now() - started < timeoutMs; shot += 1) {
    await pageA.waitForTimeout(COMBAT_SHOT_COOLDOWN_MS);
    const fired = await fireCombatShot(pageA);
    shots.push(fired);
    if (!fired.firedOk) {
      throw new Error(`Could not fire PartyKit kill follow-up shot ${shot + 1}: ${JSON.stringify({ fired, shots })}`);
    }

    const shotStarted = Date.now();
    while (Date.now() - shotStarted < COMBAT_SHOT_COOLDOWN_MS && Date.now() - started < timeoutMs) {
      last = await pageB.evaluate((probe) => {
        const stats = window.__cssQuakeDebug?.stats?.();
        const event = stats?.multiplayer?.lastPlayerEvent;
        return {
          bodyDead: document.body.classList.contains("quake-dead"),
          playerHealth: stats?.playerHealth,
          playerArmor: stats?.playerArmor,
          multiplayer: stats?.multiplayer,
          event,
          killed: event?.eventType === "player.killed" &&
            event?.eventId !== probe.beforePlayerEventId &&
            event?.damageSource === "shotgun" &&
            event?.attackerPlayerId === probe.attackerPlayerId &&
            typeof stats?.playerHealth === "number" &&
            stats.playerHealth <= 0 &&
            document.body.classList.contains("quake-dead"),
        };
      }, expected);
      if (last.killed) return { ...last, shots };
      await pageB.waitForTimeout(100);
    }
  }
  throw new Error(`Timed out waiting for PartyKit shotgun kill on page B: ${JSON.stringify({ expected, shots, last })}`);
}

async function waitForCombatScoreboard(page, label, timeoutMs) {
  let last = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("#quake-multiplayer-scoreboard tbody tr")).map((row) => {
        const cells = Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim() ?? "");
        return {
          name: cells[0] ?? "",
          frags: Number(cells[1] ?? Number.NaN),
          deaths: Number(cells[2] ?? Number.NaN),
          ping: cells[3] ?? "",
          local: row.classList.contains("quake-multiplayer-scoreboard-local"),
        };
      });
      return {
        rows,
        attacker: rows.find((row) => row.name === "Party A") ?? null,
        victim: rows.find((row) => row.name === "Party B") ?? null,
      };
    });
    if (last.attacker?.frags >= 1 && last.victim?.deaths >= 1) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${label} combat scoreboard update: ${JSON.stringify(last)}`);
}

async function waitForVictimRespawn(page, timeoutMs) {
  let last = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(() => {
      const stats = window.__cssQuakeDebug?.stats?.();
      return {
        bodyDead: document.body.classList.contains("quake-dead"),
        playerHealth: stats?.playerHealth,
        playerArmor: stats?.playerArmor,
        multiplayer: stats?.multiplayer,
        origin: stats?.origin,
        respawned: !document.body.classList.contains("quake-dead") &&
          stats?.playerHealth === 100 &&
          stats?.multiplayer?.sessionState === "connected",
      };
    });
    if (last.respawned) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for PartyKit victim respawn: ${JSON.stringify(last)}`);
}

async function runReconnectSmoke(contextB, logs, pageA, pageB, options) {
  await waitForCombatScoreboard(pageA, "page A before page B reconnect", options.timeoutMs);
  await pageB.close();
  await pageA.waitForTimeout(500);

  const nextPageB = await contextB.newPage();
  attachPageLogs(nextPageB, logs, "B2");
  await nextPageB.goto(partyMultiplayerUrl(options.baseUrl, {
    roomId: options.roomId,
    clientId: "party-smoke-b",
    player: "Party B",
    color: "#6fb7d8",
    partyHost: options.partyHost,
  }), { waitUntil: "domcontentloaded", timeout: options.timeoutMs });

  const readyB = await waitForPartyMultiplayerReady(nextPageB, "page B reconnect", options.timeoutMs);
  const [scoreboardA, scoreboardB] = await Promise.all([
    waitForCombatScoreboard(pageA, "page A after page B reconnect", options.timeoutMs),
    waitForCombatScoreboard(nextPageB, "page B after reconnect", options.timeoutMs),
  ]);
  await waitForRemoteStillVisible(pageA, "page A after page B reconnect", options.timeoutMs);
  await waitForRemoteStillVisible(nextPageB, "page B after reconnect", options.timeoutMs);

  return {
    page: nextPageB,
    readyB,
    scoreboardA,
    scoreboardB,
  };
}

async function runSharedPickupSmoke(pageA, pageB, pickup, timeoutMs) {
  await Promise.all([
    focusPickupForVisibility(pageA, pickup, "page A before pickup", timeoutMs),
    focusPickupForVisibility(pageB, pickup, "page B before pickup", timeoutMs),
  ]);
  const [beforeA, beforeB] = await Promise.all([
    pickupSnapshot(pageA, pickup),
    pickupSnapshot(pageB, pickup),
  ]);
  await placeAtPickupForAuthority(pageA, pickup, timeoutMs);

  const takenByA = await pageA.evaluate(async (probe) => {
    const debug = window.__cssQuakeDebug;
    const before = pickupSnapshotInPage(probe.entityIndex);
    const pickupOk = debug?.setViewpos?.(
      probe.origin.x,
      probe.origin.y,
      probe.origin.z,
      undefined,
      undefined,
      { gameplay: true },
    ) ?? false;
    await settlePickupProbe();
    return {
      before,
      pickupOk,
      after: pickupSnapshotInPage(probe.entityIndex),
    };

    async function settlePickupProbe() {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, 180));
    }

    function pickupSnapshotInPage(entityIndex) {
      const stats = debug?.stats?.();
      const element = document.querySelector(`.polycss-mesh.pickup[data-entity-index="${entityIndex}"]`);
      return {
        info: pickupInfoInPage(element),
        playerArmor: stats?.playerArmor,
        playerHealth: stats?.playerHealth,
        pickupMeshes: stats?.pickupMeshes,
        activePickupMeshes: stats?.activePickupMeshes,
        multiplayer: stats?.multiplayer,
      };
    }

    function pickupInfoInPage(element) {
      if (!element) return { mounted: false };
      return {
        mounted: true,
        hidden: element.hidden,
        classname: element.dataset.classname ?? null,
        leafCount: element.querySelectorAll("b,i,s,u").length,
      };
    }
  }, pickup);
  if (!takenByA.pickupOk) {
    throw new Error(`Could not trigger PartyKit shared pickup ${pickup.entityIndex}: ${JSON.stringify(takenByA)}`);
  }

  const [takenA, takenB] = await Promise.all([
    waitForPickupTaken(pageA, pickup, "page A", {
      before: beforeA,
      expectStatIncrease: true,
    }, timeoutMs),
    waitForPickupTaken(pageB, pickup, "page B", {
      before: beforeB,
      expectStatIncrease: false,
    }, timeoutMs),
  ]);

  await Promise.all([
    moveAwayFromPickup(pageA, pickup),
    moveAwayFromPickup(pageB, pickup),
  ]);

  const [respawnA, respawnB] = await Promise.all([
    waitForPickupRespawn(pageA, pickup, "page A", takenA, timeoutMs),
    waitForPickupRespawn(pageB, pickup, "page B", takenB, timeoutMs),
  ]);

  return {
    takenByA,
    takenA,
    takenB,
    respawnA,
    respawnB,
  };
}

async function placeAtPickupForAuthority(page, pickup, timeoutMs) {
  const placed = await page.evaluate((probe) => {
    const debug = window.__cssQuakeDebug;
    const before = debug?.stats?.();
    const placedOk = debug?.setViewpos?.(
      probe.origin.x,
      probe.origin.y,
      probe.origin.z,
      undefined,
      undefined,
      { stableViewmodel: true },
    ) ?? false;
    return {
      placedOk,
      beforePoseSequence: before?.multiplayer?.poseSequence,
      after: debug?.stats?.(),
    };
  }, pickup);
  if (!placed.placedOk) {
    throw new Error(`Could not place player at shared pickup ${pickup.entityIndex}: ${JSON.stringify(placed)}`);
  }
  await waitForPoseSequence(page, placed.beforePoseSequence ?? 0, timeoutMs);
  return placed;
}

async function focusPickupForVisibility(page, pickup, label, timeoutMs) {
  let last = null;
  let yawIndex = 0;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(async ({ pickup, yaw }) => {
      const debug = window.__cssQuakeDebug;
      const focusOk = debug?.focusEntity?.(pickup.entityIndex, 6, 90, yaw) ?? false;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, 90));
      const snapshot = pickupSnapshotInPage(pickup.entityIndex);
      return {
        focusOk,
        yaw,
        ...snapshot,
        visible: snapshot.info.mounted &&
          !snapshot.info.hidden &&
          snapshot.info.classname === pickup.classname &&
          snapshot.info.leafCount > 0,
      };

      function pickupSnapshotInPage(entityIndex) {
        const stats = debug?.stats?.();
        const element = document.querySelector(`.polycss-mesh.pickup[data-entity-index="${entityIndex}"]`);
        return {
          info: pickupInfoInPage(element),
          playerArmor: stats?.playerArmor,
          pickupMeshes: stats?.pickupMeshes,
          activePickupMeshes: stats?.activePickupMeshes,
          multiplayer: stats?.multiplayer,
        };
      }

      function pickupInfoInPage(element) {
        if (!element) return { mounted: false };
        return {
          mounted: true,
          hidden: element.hidden,
          classname: element.dataset.classname ?? null,
          leafCount: element.querySelectorAll("b,i,s,u").length,
        };
      }
    }, {
      pickup,
      yaw: PICKUP_FOCUS_YAWS[yawIndex % PICKUP_FOCUS_YAWS.length],
    });
    if (last.focusOk && last.visible) return last;
    yawIndex += 1;
    await page.waitForTimeout(150);
  }
  throw new Error(`Timed out waiting for ${label} shared pickup visibility: ${JSON.stringify(last)}`);
}

async function pickupSnapshot(page, pickup) {
  return page.evaluate((probe) => {
    const debug = window.__cssQuakeDebug;
    const stats = debug?.stats?.();
    const element = document.querySelector(`.polycss-mesh.pickup[data-entity-index="${probe.entityIndex}"]`);
    return {
      info: pickupInfoInPage(element),
      playerArmor: stats?.playerArmor,
      playerHealth: stats?.playerHealth,
      pickupMeshes: stats?.pickupMeshes,
      activePickupMeshes: stats?.activePickupMeshes,
      multiplayer: stats?.multiplayer,
    };

    function pickupInfoInPage(element) {
      if (!element) return { mounted: false };
      return {
        mounted: true,
        hidden: element.hidden,
        classname: element.dataset.classname ?? null,
        leafCount: element.querySelectorAll("b,i,s,u").length,
      };
    }
  }, pickup);
}

async function waitForPickupTaken(page, pickup, label, expected, timeoutMs) {
  let last = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    last = await pickupSnapshot(page, pickup);
    const statOk = expected.expectStatIncrease
      ? last[pickup.stat] > expected.before[pickup.stat]
      : last[pickup.stat] === expected.before[pickup.stat];
    if (
      !last.info.mounted &&
      last.pickupMeshes === expected.before.pickupMeshes - 1 &&
      statOk
    ) {
      return last;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${label} shared pickup take: ${JSON.stringify({ expected, last })}`);
}

async function moveAwayFromPickup(page, pickup) {
  return page.evaluate(async (probe) => {
    const debug = window.__cssQuakeDebug;
    const movedOk = debug?.focusEntity?.(probe.entityIndex, 8, 90, 180) ?? false;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      movedOk,
      stats: debug?.stats?.(),
    };
  }, pickup);
}

async function waitForPickupRespawn(page, pickup, label, takenState, timeoutMs) {
  let last = null;
  let yawIndex = 0;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(async ({ pickup, yaw }) => {
      const debug = window.__cssQuakeDebug;
      const focusOk = debug?.focusEntity?.(pickup.entityIndex, 6, 90, yaw) ?? false;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, 90));
      const stats = debug?.stats?.();
      const element = document.querySelector(`.polycss-mesh.pickup[data-entity-index="${pickup.entityIndex}"]`);
      const info = !element
        ? { mounted: false }
        : {
          mounted: true,
          hidden: element.hidden,
          classname: element.dataset.classname ?? null,
          leafCount: element.querySelectorAll("b,i,s,u").length,
        };
      return {
        focusOk,
        info,
        playerArmor: stats?.playerArmor,
        pickupMeshes: stats?.pickupMeshes,
        activePickupMeshes: stats?.activePickupMeshes,
        multiplayer: stats?.multiplayer,
      };
    }, {
      pickup,
      yaw: PICKUP_FOCUS_YAWS[yawIndex % PICKUP_FOCUS_YAWS.length],
    });
    if (
      last.focusOk &&
      last.info.mounted &&
      !last.info.hidden &&
      last.info.classname === pickup.classname &&
      last.info.leafCount > 0 &&
      last.pickupMeshes === takenState.pickupMeshes + 1
    ) {
      return {
        ...last,
        respawnedAfterMs: Date.now() - started,
      };
    }
    yawIndex += 1;
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for ${label} shared pickup respawn: ${JSON.stringify({ takenState, last })}`);
}

async function runIntermissionSmoke(pageA, pageB, options) {
  await Promise.all([
    pageA.goto(partyMultiplayerUrl(options.baseUrl, {
      roomId: options.roomId,
      clientId: "party-smoke-intermission-a",
      player: "Party A",
      color: "#d8893f",
      partyHost: options.partyHost,
      fragLimit: 1,
    }), { waitUntil: "domcontentloaded", timeout: options.timeoutMs }),
    pageB.goto(partyMultiplayerUrl(options.baseUrl, {
      roomId: options.roomId,
      clientId: "party-smoke-intermission-b",
      player: "Party B",
      color: "#6fb7d8",
      partyHost: options.partyHost,
      fragLimit: 1,
    }), { waitUntil: "domcontentloaded", timeout: options.timeoutMs }),
  ]);
  const [stateA, stateB] = await Promise.all([
    waitForPartyMultiplayerReady(pageA, "intermission page A", options.timeoutMs),
    waitForPartyMultiplayerReady(pageB, "intermission page B", options.timeoutMs),
  ]);
  const combat = await runCombatDamageSmoke(pageA, pageB, options.timeoutMs, {
    attackerPlayerId: "party:client-party-smoke-intermission-a",
    expectRespawn: false,
  });
  const [matchA, matchB] = await Promise.all([
    waitForMatchIntermission(pageA, "page A", options.timeoutMs),
    waitForMatchIntermission(pageB, "page B", options.timeoutMs),
  ]);
  return {
    stateA,
    stateB,
    combat,
    matchA,
    matchB,
  };
}

async function waitForMatchIntermission(page, label, timeoutMs) {
  let last = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(() => {
      const stats = window.__cssQuakeDebug?.stats?.();
      const multiplayer = stats?.multiplayer;
      return {
        multiplayer,
        intermission: multiplayer?.match?.status === "intermission" &&
          multiplayer?.lastMatchEvent?.eventType === "match.notice" &&
          multiplayer?.lastMatchEvent?.code === "frag-limit",
      };
    });
    if (last.intermission) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${label} frag-limit intermission: ${JSON.stringify(last)}`);
}

async function placeCombatants(pageA, pageB, timeoutMs) {
  const [groundA, groundB] = await Promise.all([
    setCombatGroundViewpos(pageA, COMBAT_ATTACKER_VIEWPOS),
    setCombatGroundViewpos(pageB, COMBAT_VICTIM_VIEWPOS),
  ]);
  const attackerOrigin = groundA.origin;
  const victimOrigin = groundB.origin;
  const targetCenter = [
    victimOrigin[0],
    victimOrigin[1],
    victimOrigin[2] + COMBAT_HIT_CENTER_Z_OFFSET,
  ];
  const attackerRotation = rotationToward(attackerOrigin, targetCenter);
  const victimRotation = {
    rotX: 90,
    rotY: normalizeAngle(attackerRotation.rotY + 180),
  };

  const [placedA, placedB] = await Promise.all([
    pageA.evaluate((placement) => {
      const debug = window.__cssQuakeDebug;
      const before = debug?.stats?.();
      const placedOk = debug?.setPose?.(
        placement.origin,
        placement.rotX,
        placement.rotY,
        { stableViewmodel: true },
      ) ?? false;
      return {
        placedOk,
        beforePoseSequence: before?.multiplayer?.poseSequence,
        after: debug?.stats?.(),
      };
    }, {
      origin: attackerOrigin,
      rotX: attackerRotation.rotX,
      rotY: attackerRotation.rotY,
    }),
    pageB.evaluate((placement) => {
      const debug = window.__cssQuakeDebug;
      const before = debug?.stats?.();
      const placedOk = debug?.setPose?.(
        placement.origin,
        placement.rotX,
        placement.rotY,
        { stableViewmodel: true },
      ) ?? false;
      return {
        placedOk,
        beforeHealth: before?.playerHealth,
        beforePlayerEventId: before?.multiplayer?.lastPlayerEvent?.eventId ?? null,
        beforePoseSequence: before?.multiplayer?.poseSequence,
        after: debug?.stats?.(),
      };
    }, {
      origin: victimOrigin,
      rotX: victimRotation.rotX,
      rotY: victimRotation.rotY,
    }),
  ]);
  if (!placedA.placedOk || !placedB.placedOk) {
    throw new Error(`Could not place PartyKit combatants: ${JSON.stringify({ placedA, placedB })}`);
  }

  await Promise.all([
    waitForPoseSequence(pageA, placedA.beforePoseSequence ?? 0, timeoutMs),
    waitForPoseSequence(pageB, placedB.beforePoseSequence ?? 0, timeoutMs),
  ]);
  return {
    attackerOrigin,
    attackerRotation,
    victimBeforeHealth: groundB.beforeHealth,
    victimBeforePlayerEventId: groundB.beforePlayerEventId,
    victimOrigin,
  };
}

async function setCombatGroundViewpos(page, viewpos) {
  const result = await page.evaluate((viewpos) => {
    const debug = window.__cssQuakeDebug;
    const before = debug?.stats?.();
    const placedOk = debug?.setGroundViewpos?.(
      viewpos.x,
      viewpos.y,
      viewpos.z,
      0,
      viewpos.yaw,
      0,
      { gameplay: true, collisionBypassMs: 1000, stableViewmodel: true },
    ) ?? false;
    const after = debug?.stats?.();
    return {
      placedOk,
      beforeHealth: before?.playerHealth,
      beforePlayerEventId: before?.multiplayer?.lastPlayerEvent?.eventId ?? null,
      origin: after?.origin,
      poseSequence: after?.multiplayer?.poseSequence,
    };
  }, viewpos);
  if (!result.placedOk || !Array.isArray(result.origin) || result.origin.length < 3) {
    throw new Error(`Could not place PartyKit combat viewpos: ${JSON.stringify({ viewpos, result })}`);
  }
  return {
    beforeHealth: result.beforeHealth,
    beforePlayerEventId: result.beforePlayerEventId,
    origin: [result.origin[0], result.origin[1], result.origin[2]],
    poseSequence: result.poseSequence,
  };
}

async function waitForPoseSequence(page, previousPoseSequence, timeoutMs) {
  await page.waitForFunction(
    (previous) => {
      const multiplayer = window.__cssQuakeDebug?.stats?.()?.multiplayer;
      return multiplayer?.poseSequence >= previous + 2;
    },
    previousPoseSequence,
    { timeout: timeoutMs },
  );
}

async function runTeleporterWorldIntentSmoke(page, teleporter, timeoutMs) {
  const placed = await page.evaluate((probe) => {
    const debug = window.__cssQuakeDebug;
    const before = debug?.stats?.();
    const placedOk = debug?.setViewpos?.(
      probe.pose.x,
      probe.pose.y,
      probe.pose.z,
      undefined,
      undefined,
      { stableViewmodel: true },
    ) ?? false;
    return {
      placedOk,
      beforeOrigin: before?.origin,
      afterOrigin: debug?.stats?.()?.origin,
      multiplayer: debug?.stats?.()?.multiplayer,
    };
  }, teleporter);
  if (!placed.placedOk) {
    throw new Error(`Could not place player at teleporter ${teleporter.entityIndex}: ${JSON.stringify(placed)}`);
  }

  await page.waitForFunction(
    (previousPoseSequence) => {
      const multiplayer = window.__cssQuakeDebug?.stats?.()?.multiplayer;
      return multiplayer?.poseSequence >= previousPoseSequence + 2;
    },
    placed.multiplayer?.poseSequence ?? 0,
    { timeout: timeoutMs },
  );

  const activated = await page.evaluate((probe) => {
    const debug = window.__cssQuakeDebug;
    const before = debug?.stats?.();
    const activatedOk = debug?.setViewpos?.(
      probe.pose.x,
      probe.pose.y,
      probe.pose.z,
      undefined,
      undefined,
      { gameplay: true },
    ) ?? false;
    return {
      activatedOk,
      beforeOrigin: before?.origin,
      beforeWorldSequence: before?.multiplayer?.worldSequence,
      after: debug?.stats?.(),
    };
  }, teleporter);
  if (!activated.activatedOk) {
    throw new Error(`Could not activate teleporter ${teleporter.entityIndex}: ${JSON.stringify(activated)}`);
  }

  let last = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate((probe) => {
      const stats = window.__cssQuakeDebug?.stats?.();
      const event = stats?.multiplayer?.lastWorldEvent;
      return {
        origin: stats?.origin,
        multiplayer: stats?.multiplayer,
        event,
        reachedTeleportEvent: event?.eventType === "world.teleport" &&
          event?.entityIndex === probe.entityIndex &&
          event?.origin &&
          stats?.multiplayer?.worldSequence > probe.beforeWorldSequence,
      };
    }, {
      entityIndex: teleporter.entityIndex,
      beforeWorldSequence: activated.beforeWorldSequence ?? -1,
    });
    if (last.reachedTeleportEvent && vec3Distance(last.origin, last.event.origin) <= ORIGIN_EPSILON) {
      return last;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for PartyKit authoritative teleporter world event: ${JSON.stringify(last)}`);
}

async function runLiquidHazardSmoke(page, probe, timeoutMs) {
  const placed = await page.evaluate((hazardProbe) => {
    const debug = window.__cssQuakeDebug;
    const before = debug?.stats?.();
    const placedOk = debug?.setViewpos?.(
      hazardProbe.x,
      hazardProbe.y,
      hazardProbe.z,
      undefined,
      undefined,
      { stableViewmodel: true },
    ) ?? false;
    return {
      placedOk,
      beforeHealth: before?.playerHealth,
      beforePoseSequence: before?.multiplayer?.poseSequence,
      beforePlayerEventId: before?.multiplayer?.lastPlayerEvent?.eventId ?? null,
      after: debug?.stats?.(),
    };
  }, probe);
  if (!placed.placedOk) {
    throw new Error(`Could not place player at liquid hazard probe: ${JSON.stringify(placed)}`);
  }

  await page.waitForFunction(
    (previousPoseSequence) => {
      const multiplayer = window.__cssQuakeDebug?.stats?.()?.multiplayer;
      return multiplayer?.poseSequence >= previousPoseSequence + 2;
    },
    placed.beforePoseSequence ?? 0,
    { timeout: timeoutMs },
  );

  let last = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate((hazardProbe) => {
      const stats = window.__cssQuakeDebug?.stats?.();
      const event = stats?.multiplayer?.lastPlayerEvent;
      return {
        playerHealth: stats?.playerHealth,
        multiplayer: stats?.multiplayer,
        event,
        damaged: event?.eventType === "player.damaged" &&
          event?.eventId !== hazardProbe.beforePlayerEventId &&
          event?.damageSource === hazardProbe.damageSource &&
          typeof stats?.playerHealth === "number" &&
          typeof hazardProbe.beforeHealth === "number" &&
          stats.playerHealth < hazardProbe.beforeHealth,
      };
    }, {
      beforeHealth: placed.beforeHealth,
      beforePlayerEventId: placed.beforePlayerEventId,
      damageSource: probe.damageSource,
    });
    if (last.damaged) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for PartyKit authoritative liquid hazard damage: ${JSON.stringify(last)}`);
}

async function waitForRemoteStillVisible(page, label, timeoutMs) {
  let last = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(() => window.__cssQuakeDebug?.stats?.()?.multiplayer ?? null);
    if (last?.remotePresenterCount >= 1 && last?.remoteDomCount >= 1 && last?.remoteVisibleDomCount >= 1) {
      return last;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${label} remote player visibility: ${JSON.stringify(last)}`);
}

function vec3Distance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return Infinity;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function rotationToward(origin, target) {
  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  const dz = target[2] - origin[2];
  const length = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(length) || length <= 0) throw new Error("Invalid combat aim vector.");
  const direction = [dx / length, dy / length, dz / length];
  return {
    rotX: (Math.acos(clamp(-direction[2], -1, 1)) * 180) / Math.PI,
    rotY: normalizeAngle((Math.atan2(-direction[1], -direction[0]) * 180) / Math.PI),
  };
}

function normalizeAngle(value) {
  return ((value % 360) + 360) % 360;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

async function main() {
  if (flag("help") || flag("h")) {
    printHelp();
    return;
  }
  setSmokePhase("preflight");
  preflightMap();
  const teleporter = loadTeleporterProbe();
  const pickup = loadPickupProbe();
  const timeoutMs = Math.max(1_000, Math.round(numberOption("timeout-ms", DEFAULT_TIMEOUT_MS)));
  const viewport = viewportOption();
  const roomId = option("room", `party-smoke-${Date.now().toString(36)}`);
  const intermissionRoomId = `${roomId}-fraglimit`;
  setSmokePhase("load Playwright");
  const chromium = await loadChromium();
  setSmokePhase("start Vite");
  const vite = await startViteServer();
  setSmokePhase("start PartyKit");
  const party = await startPartyServer();
  setSmokePhase("launch browser");
  const browser = await chromium.launch({ headless: !flag("headed") });
  const logs = [];
  let menuState = { joinRoomId: "", createRoomId: "" };
  let mismatchState = { roomId: "", code: "" };
  const contextA = await browser.newContext({ viewport });
  const contextB = await browser.newContext({ viewport });
  await Promise.all([
    contextA.addInitScript(() => {
      window.__cssQuakeDebugDomMetadata = true;
    }),
    contextB.addInitScript(() => {
      window.__cssQuakeDebugDomMetadata = true;
    }),
  ]);
  const pageA = await contextA.newPage();
  let pageB = await contextB.newPage();
  attachPageLogs(pageA, logs, "A");
  attachPageLogs(pageB, logs, "B");

  try {
    setSmokePhase("menu room controls");
    menuState = await runMenuRoomControlsSmoke(browser, {
      baseUrl: vite.url,
      partyHost: party.host,
      timeoutMs,
      viewport,
      logs,
    });
    setSmokePhase("map mismatch reject");
    mismatchState = await runMapMismatchRejectSmoke(browser, {
      baseUrl: vite.url,
      partyHost: party.host,
      timeoutMs,
      viewport,
      logs,
    });
    setSmokePhase("connect clients");
    await Promise.all([
      pageA.goto(partyMultiplayerUrl(vite.url, {
        roomId,
        clientId: "party-smoke-a",
        player: "Party A",
        color: "#d8893f",
        partyHost: party.host,
      }), { waitUntil: "domcontentloaded", timeout: timeoutMs }),
      pageB.goto(partyMultiplayerUrl(vite.url, {
        roomId,
        clientId: "party-smoke-b",
        player: "Party B",
        color: "#6fb7d8",
        partyHost: party.host,
      }), { waitUntil: "domcontentloaded", timeout: timeoutMs }),
    ]);
    setSmokePhase("wait for multiplayer readiness");
    const [stateA, stateB] = await Promise.all([
      waitForPartyMultiplayerReady(pageA, "page A", timeoutMs),
      waitForPartyMultiplayerReady(pageB, "page B", timeoutMs),
    ]);
    setSmokePhase("shotgun combat");
    const combatState = await runCombatDamageSmoke(pageA, pageB, timeoutMs);
    setSmokePhase("reconnect");
    const reconnectState = await runReconnectSmoke(contextB, logs, pageA, pageB, {
      baseUrl: vite.url,
      partyHost: party.host,
      roomId,
      timeoutMs,
    });
    pageB = reconnectState.page;
    setSmokePhase("teleporter world intent");
    const worldIntentState = await runTeleporterWorldIntentSmoke(pageA, teleporter, timeoutMs);
    await waitForRemoteStillVisible(pageB, "page B after teleport", timeoutMs);
    setSmokePhase("liquid hazard damage");
    const hazardState = await runLiquidHazardSmoke(pageA, SLIME_HAZARD_PROBE, timeoutMs);
    await waitForRemoteStillVisible(pageB, "page B after hazard damage", timeoutMs);
    setSmokePhase("shared pickup");
    const pickupState = await runSharedPickupSmoke(pageA, pageB, pickup, timeoutMs);
    setSmokePhase("frag-limit intermission");
    const intermissionState = await runIntermissionSmoke(pageA, pageB, {
      baseUrl: vite.url,
      partyHost: party.host,
      roomId: intermissionRoomId,
      timeoutMs,
    });
    setSmokePhase("browser log check");
    if (logs.length) {
      throw new Error(`Browser logged errors during PartyKit multiplayer smoke:\n${logs.join("\n")}`);
    }
    setSmokePhase("complete");
    console.log(
      `PartyKit multiplayer smoke passed: room ${roomId}, ` +
        `A rows=${stateA.multiplayer.scoreboardRows}, B rows=${stateB.multiplayer.scoreboardRows}, ` +
        `A remote=${stateA.multiplayer.remoteDomCount}, B remote=${stateB.multiplayer.remoteDomCount}, ` +
        `${combatState.damage.event.eventType} ${combatState.damage.event.damageSource} combat damage, ` +
        `${combatState.kill.event.eventType} ${combatState.kill.event.damageSource} kill, ` +
        `score A=${combatState.scoreboardA.attacker.frags}/${combatState.scoreboardA.victim.deaths}, ` +
        `score B=${combatState.scoreboardB.attacker.frags}/${combatState.scoreboardB.victim.deaths}, ` +
        `respawned health ${combatState.respawn.playerHealth}, ` +
        `reconnected B deaths=${reconnectState.scoreboardB.victim.deaths}, ` +
        `menu join ${menuState.joinRoomId}, menu create ${menuState.createRoomId}, ` +
        `map mismatch ${mismatchState.code}, ` +
        `${worldIntentState.event.eventType} entity ${worldIntentState.event.entityIndex}, ` +
        `${hazardState.event.eventType} ${hazardState.event.damageSource} damage, ` +
        `pickup ${pickup.entityIndex} ${pickup.stat}=${pickupState.takenA[pickup.stat]} respawned ` +
          `${pickupState.respawnA.respawnedAfterMs}ms/${pickupState.respawnB.respawnedAfterMs}ms, ` +
        `intermission ${intermissionState.matchA.multiplayer.lastMatchEvent.code}.`,
    );
  } finally {
    await contextA.close();
    await contextB.close();
    await browser.close();
    await vite.close();
    await party.close();
  }
}

function attachPageLogs(page, logs, label) {
  page.on("console", (message) => {
    if (message.type() !== "error" || expectedCompactMenuLocalPartyHostError(label, message.text())) return;
    logs.push(`${label} ${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    logs.push(`${label} pageerror: ${error.message}`);
  });
}

function expectedCompactMenuLocalPartyHostError(label, text) {
  return /^M[12]$/.test(label) &&
    text.includes("WebSocket connection to 'ws://localhost:1999/parties/main/cssquake-") &&
    text.includes("net::ERR_CONNECTION_REFUSED");
}

main().catch((error) => {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`PartyKit multiplayer smoke failed during phase "${currentSmokePhase}".\n${detail}`);
  process.exitCode = 1;
});
