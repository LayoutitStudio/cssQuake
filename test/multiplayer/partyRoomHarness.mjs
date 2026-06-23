import assert from "node:assert/strict";
import { importTsModule } from "../importTsModule.mjs";
import {
  NORMALIZED_ROOM_KEY,
  ROOM_KEY,
  authority,
  clientEnvelope,
  createLoopbackHarness,
  createPlayer,
  fireEnvelope,
  helloEnvelope,
  inputBatchEnvelope,
  inputEnvelope,
  latestMessage,
  matchEnvelope,
  partyRoomModule,
  pickupEnvelope,
  presenceEnvelope,
  protocol,
  projectileAuthority,
  validation,
  waitForMessage,
  worldEnvelope,
} from "./harness.mjs";

export {
  NORMALIZED_ROOM_KEY,
  ROOM_KEY,
  authority,
  clientEnvelope,
  createLoopbackHarness,
  createPlayer,
  fireEnvelope,
  helloEnvelope,
  inputBatchEnvelope,
  inputEnvelope,
  latestMessage,
  matchEnvelope,
  partyRoomModule,
  pickupEnvelope,
  presenceEnvelope,
  protocol,
  projectileAuthority,
  validation,
  waitForMessage,
  worldEnvelope,
};

export const facts = await importTsModule("src/runtime/multiplayer/facts.ts");
export const items = await importTsModule("src/runtime/multiplayer/items.ts");

export const DUEL_FORWARD_DIRECTION = [0.9781476007338057, 0, -0.20791169081775934];

export class FakePartyConnection {
  constructor(id) {
    this.id = id;
    this.messages = [];
    this.closed = [];
    this.state = null;
  }

  send(message) {
    this.messages.push(JSON.parse(message));
  }

  setState(state) {
    this.state = state;
  }

  close(code, reason) {
    this.closed.push({ code, reason });
  }
}

export function createFakePartyRoom(id = "test-room") {
  const connections = [];
  return {
    room: {
      id,
      context: {},
      broadcast(message, without = []) {
        const payload = JSON.parse(message);
        for (const connection of connections) {
          if (without.includes(connection.id)) continue;
          connection.messages.push(payload);
        }
      },
      getConnections() {
        return connections;
      },
    },
    createConnection(connectionId) {
      const connection = new FakePartyConnection(connectionId);
      connections.push(connection);
      return connection;
    },
  };
}

export function latestConnectionMessage(connection, type) {
  const message = connection.messages.findLast((candidate) => candidate.type === type);
  assert.ok(message, `expected ${type} message on ${connection.id}`);
  return message;
}

export function roomEvents(connection, eventType) {
  return connection.messages
    .filter((message) => message.type === "room.event" && message.payload.event.eventType === eventType)
    .map((message) => message.payload.event);
}

export function latestSnapshotPlayerForClient(connection, clientId) {
  const snapshot = latestConnectionMessage(connection, "room.snapshot");
  const player = snapshot.payload.players.find((candidate) => candidate.clientId === clientId);
  assert.ok(player, `expected snapshot player for ${clientId}`);
  return player;
}

export const weaponPickupFlags = {
  axe: 4096,
  supershotgun: 2,
  nailgun: 4,
  supernailgun: 8,
  grenadelauncher: 16,
  rocketlauncher: 32,
  lightning: 64,
};

export const weaponPickupAmmo = {
  axe: { shells: 0 },
  supershotgun: { shells: 10 },
  nailgun: { nails: 25 },
  supernailgun: { nails: 25 },
  grenadelauncher: { rockets: 5 },
  rocketlauncher: { rockets: 5 },
  lightning: { cells: 25 },
};

export const QUAD_ITEM_FLAG = 4_194_304;
export const INVULNERABILITY_ITEM_FLAG = 1_048_576;

export function weaponPickupDefinition(weapon) {
  return {
    pickupId: `weapon-${weapon}`,
    entityIndex: 1000 + Object.keys(weaponPickupFlags).indexOf(weapon),
    classname: `weapon_${weapon}`,
    origin: [0, 0, 0],
    effect: {
      ...(weaponPickupAmmo[weapon] ?? {}),
      weapon: {
        id: weapon,
        itemFlag: weaponPickupFlags[weapon] ?? 0,
        select: true,
      },
    },
  };
}

export function quadPickupDefinition({ entityIndex = 1999, durationMs = 30_000, origin = [0, 0, 0] } = {}) {
  return {
    pickupId: `powerup-quad-${entityIndex}`,
    entityIndex,
    classname: "item_artifact_super_damage",
    origin,
    effect: {
      powerup: {
        activationField: "super_damage_time",
        durationMs,
        finishedField: "super_damage_finished",
        itemFlag: QUAD_ITEM_FLAG,
        itemFlagExpression: "IT_QUAD",
      },
    },
  };
}

export function invulnerabilityPickupDefinition({ entityIndex = 2999, durationMs = 30_000, origin = [0, 0, 0] } = {}) {
  return {
    pickupId: `powerup-invulnerability-${entityIndex}`,
    entityIndex,
    classname: "item_artifact_invulnerability",
    origin,
    effect: {
      powerup: {
        activationField: "invincible_time",
        durationMs,
        finishedField: "invincible_finished",
        itemFlag: INVULNERABILITY_ITEM_FLAG,
      },
    },
  };
}

export function connectDuelRoom({
  id,
  deathmatchSpawns,
  matchSettings = { fragLimit: 1 },
  pickupDefinitions = [],
  roomOptions = {},
  spawnDistance = 4,
}) {
  const spawns = deathmatchSpawns ?? [
    {
      spawnId: "spawn-a",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 0,
    },
    {
      spawnId: "spawn-b",
      classname: "info_player_deathmatch",
      origin: [spawnDistance, 0, 0],
      rotX: -78,
      rotY: 180,
    },
  ];
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: spawns,
    pickupDefinitions,
  });
  const { room, createConnection } = createFakePartyRoom(id);
  const RoomClass = partyRoomModule.default;
  const partyRoom = new RoomClass(room, {
    random: () => 0.999999,
    trustedGameplayDefinitions: gameplayDefinitions,
    ...roomOptions,
  });
  const alice = createConnection("alice");
  const bob = createConnection("bob");
  partyRoom.onConnect(alice);
  partyRoom.onConnect(bob);
  partyRoom.onMessage(JSON.stringify(helloEnvelope({
    clientId: "client-a",
    displayName: "Alice",
    messageId: `hello-a-${id}`,
    sequence: 1,
    sentAt: Date.now(),
    matchSettings,
  })), alice);
  partyRoom.onMessage(JSON.stringify(helloEnvelope({
    clientId: "client-b",
    displayName: "Bob",
    messageId: `hello-b-${id}`,
    sequence: 1,
    sentAt: Date.now(),
    matchSettings,
  })), bob);
  return { alice, bob, partyRoom };
}

export function connectTripleRoom({ id, roomOptions = {}, spawns }) {
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns: spawns,
    pickupDefinitions: [],
  });
  const { room, createConnection } = createFakePartyRoom(id);
  const RoomClass = partyRoomModule.default;
  const partyRoom = new RoomClass(room, {
    random: () => 0.999999,
    trustedGameplayDefinitions: gameplayDefinitions,
    ...roomOptions,
  });
  const alice = createConnection("alice");
  const bob = createConnection("bob");
  const cara = createConnection("cara");
  partyRoom.onConnect(alice);
  partyRoom.onConnect(bob);
  partyRoom.onConnect(cara);
  const clients = [
    { clientId: "client-a", connection: alice, displayName: "Alice" },
    { clientId: "client-b", connection: bob, displayName: "Bob" },
    { clientId: "client-c", connection: cara, displayName: "Cara" },
  ];
  for (const [index, client] of clients.entries()) {
    partyRoom.onMessage(JSON.stringify(helloEnvelope({
      clientId: client.clientId,
      displayName: client.displayName,
      messageId: `hello-${client.clientId}-${id}`,
      sequence: 1,
      sentAt: Date.now(),
      matchSettings: { fragLimit: 99, maxPlayers: 4 },
    })), client.connection);
  }
  return { alice, bob, cara, partyRoom };
}

export function cleanupDuelRoom(partyRoom, alice, bob) {
  cleanupPartyRoomConnections(partyRoom, alice, bob);
}

export function cleanupPartyRoomConnections(partyRoom, ...connections) {
  for (const connection of connections) partyRoom.onClose(connection);
}

export function setPartyRoomPlayerWeapon(partyRoom, clientId, weapon) {
  const playerId = `party:${clientId}`;
  const player = partyRoom.players.get(playerId);
  assert.ok(player, `expected player ${playerId}`);
  const inventory = items.quakeMultiplayerPlayerInventory(player);
  inventory.weapons = [...new Set([...inventory.weapons, weapon])];
  inventory.activeWeapon = weapon;
  inventory.shells = Math.max(inventory.shells, 50);
  inventory.nails = Math.max(inventory.nails, 50);
  inventory.rockets = Math.max(inventory.rockets, 50);
  inventory.cells = Math.max(inventory.cells, 50);
  partyRoom.players.set(playerId, items.quakeMultiplayerPlayerWithInventory(player, inventory));
}

export function setPartyRoomPlayerQuad(partyRoom, clientId, finishedAt) {
  const playerId = `party:${clientId}`;
  const player = partyRoom.players.get(playerId);
  assert.ok(player, `expected player ${playerId}`);
  const inventory = items.quakeMultiplayerPlayerInventory(player);
  inventory.itemFlags |= QUAD_ITEM_FLAG;
  inventory.powerups = [
    ...inventory.powerups.filter((powerup) => powerup.finishedField !== "super_damage_finished"),
    {
      active: true,
      activationField: "super_damage_time",
      finishedAt,
      finishedField: "super_damage_finished",
      itemFlag: QUAD_ITEM_FLAG,
      itemFlagExpression: "IT_QUAD",
    },
  ];
  partyRoom.players.set(playerId, items.quakeMultiplayerPlayerWithInventory(player, inventory));
}

export function setPartyRoomPlayerInvulnerable(partyRoom, clientId, finishedAt) {
  const playerId = `party:${clientId}`;
  const player = partyRoom.players.get(playerId);
  assert.ok(player, `expected player ${playerId}`);
  const inventory = items.quakeMultiplayerPlayerInventory(player);
  inventory.itemFlags |= INVULNERABILITY_ITEM_FLAG;
  inventory.powerups = [
    ...inventory.powerups.filter((powerup) => powerup.finishedField !== "invincible_finished"),
    {
      active: true,
      activationField: "invincible_time",
      finishedAt,
      finishedField: "invincible_finished",
      itemFlag: INVULNERABILITY_ITEM_FLAG,
    },
  ];
  partyRoom.players.set(playerId, items.quakeMultiplayerPlayerWithInventory(player, inventory));
}

export function pickupWeapon(partyRoom, connection, { clientId, sequence, weapon }) {
  const definition = weaponPickupDefinition(weapon);
  partyRoom.onMessage(JSON.stringify(pickupEnvelope({
    clientId,
    messageId: `pickup-${weapon}-${clientId}`,
    sequence,
    pickupSequence: 1,
    sentAt: Date.now(),
    pickup: {
      entityIndex: definition.entityIndex,
      origin: [0, 0, 0],
    },
  })), connection);
  const event = roomEvents(connection, "pickup.taken")
    .find((candidate) => candidate.entityIndex === definition.entityIndex);
  assert.ok(event, `expected ${clientId} to pick up ${weapon}`);
  return event;
}
