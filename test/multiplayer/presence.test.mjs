import assert from "node:assert/strict";
import test from "node:test";

import {
  helloEnvelope,
  partyRoomModule,
  presenceRoomModule,
} from "./harness.mjs";

class FakePartyConnection {
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

class FakePresenceStorage {
  constructor() {
    this.values = new Map();
    this.alarmAt = null;
  }

  async get(key) {
    return this.values.get(key);
  }

  async put(key, value) {
    this.values.set(key, value);
  }

  async setAlarm(timestamp) {
    this.alarmAt = timestamp;
  }
}

function createFakePartyRoom(options = {}) {
  const connections = [];
  const updates = [];
  const roomId = options.roomId ?? "cssquake-auto-e1m1-test";
  const presenceParty = {
    get(id) {
      assert.equal(id, presenceRoomModule.CSSQUAKE_PRESENCE_ROOM_ID);
      return {
        async fetch(init) {
          updates.push(JSON.parse(init.body));
          return Response.json({ ok: true });
        },
      };
    },
  };
  return {
    updates,
    room: {
      id: roomId,
      context: { parties: { presence: presenceParty } },
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

function createFakePresenceRoom(id = presenceRoomModule.CSSQUAKE_PRESENCE_ROOM_ID) {
  const storage = new FakePresenceStorage();
  return {
    storage,
    room: {
      id,
      storage,
      context: {},
      broadcast() {},
      getConnections() {
        return [];
      },
    },
  };
}

function request(method, body) {
  return new Request("https://cssquake.test/parties/presence/global", {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function withFakeNow(startAt, run) {
  const originalNow = Date.now;
  let current = startAt;
  Date.now = () => current;
  try {
    return await run({
      advance(ms) {
        current += ms;
        return current;
      },
    });
  } finally {
    Date.now = originalNow;
  }
}

test("presence room aggregates active room counts and removes empty rooms", async () => {
  await withFakeNow(50_000, async () => {
    const { room, storage } = createFakePresenceRoom();
    const PresenceRoom = presenceRoomModule.default;
    const presenceRoom = new PresenceRoom(room);
    await presenceRoom.onStart();

    const update = presenceRoomModule.createCssQuakePresenceUpdatePayload({
      roomId: "cssquake-auto-e1m1-abc123",
      mapName: "e1m1",
      gameplayFactsHash: "facts-a",
      activePlayers: 2,
      roomPlayers: 2,
      spectators: 1,
      connections: 3,
    });

    let response = await presenceRoom.onRequest(request("POST", update));
    let snapshot = await response.json();
    assert.equal(snapshot.totals.activePlayers, 2);
    assert.equal(snapshot.totals.roomPlayers, 2);
    assert.equal(snapshot.totals.spectators, 1);
    assert.equal(snapshot.totals.connections, 3);
    assert.equal(snapshot.totals.rooms, 1);
    assert.equal(snapshot.rooms[0].roomId, "cssquake-auto-e1m1-abc123");
    assert.equal(snapshot.history.bucketMs, presenceRoomModule.CSSQUAKE_PRESENCE_HISTORY_BUCKET_MS);
    assert.equal(snapshot.history.retentionMs, presenceRoomModule.CSSQUAKE_PRESENCE_HISTORY_RETENTION_MS);
    assert.equal(snapshot.history.buckets.length, 1);
    assert.equal(snapshot.history.peaks.activePlayers, 2);
    assert.equal(snapshot.history.buckets[0].peaks.activePlayers, 2);
    assert.equal(snapshot.history.buckets[0].latest.activePlayers, 2);
    assert.ok(storage.alarmAt > Date.now());

    response = await presenceRoom.onRequest(request("POST", {
      ...update,
      activePlayers: 0,
      roomPlayers: 0,
      spectators: 0,
      connections: 0,
    }));
    snapshot = await response.json();
    assert.equal(snapshot.totals.activePlayers, 0);
    assert.equal(snapshot.totals.rooms, 0);
    assert.deepEqual(snapshot.rooms, []);
    assert.equal(snapshot.history.buckets.length, 1);
    assert.equal(snapshot.history.buckets[0].samples, 2);
    assert.equal(snapshot.history.buckets[0].peaks.activePlayers, 2);
    assert.equal(snapshot.history.buckets[0].latest.activePlayers, 0);
  });
});

test("presence room records minute peak history and prunes old buckets", async () => {
  await withFakeNow(10_000, async (clock) => {
    const { room } = createFakePresenceRoom();
    const PresenceRoom = presenceRoomModule.default;
    const presenceRoom = new PresenceRoom(room);
    const update = presenceRoomModule.createCssQuakePresenceUpdatePayload({
      roomId: "cssquake-auto-e1m1-history",
      mapName: "e1m1",
      gameplayFactsHash: "facts-a",
      activePlayers: 1,
      roomPlayers: 1,
      spectators: 0,
      connections: 1,
    });

    let snapshot = await (await presenceRoom.onRequest(request("POST", update))).json();
    assert.equal(snapshot.history.buckets.length, 1);
    assert.equal(snapshot.history.buckets[0].startedAt, 0);
    assert.equal(snapshot.history.buckets[0].peaks.activePlayers, 1);
    assert.equal(snapshot.history.buckets[0].latest.activePlayers, 1);

    clock.advance(10_000);
    snapshot = await (await presenceRoom.onRequest(request("POST", {
      ...update,
      activePlayers: 0,
      roomPlayers: 0,
      connections: 0,
    }))).json();
    assert.equal(snapshot.history.buckets.length, 1);
    assert.equal(snapshot.history.buckets[0].samples, 2);
    assert.equal(snapshot.history.buckets[0].peaks.activePlayers, 1);
    assert.equal(snapshot.history.buckets[0].latest.activePlayers, 0);

    clock.advance(presenceRoomModule.CSSQUAKE_PRESENCE_HISTORY_BUCKET_MS);
    snapshot = await (await presenceRoom.onRequest(request("POST", {
      ...update,
      activePlayers: 3,
      roomPlayers: 3,
      connections: 3,
    }))).json();
    assert.equal(snapshot.history.buckets.length, 2);
    assert.equal(snapshot.history.peaks.activePlayers, 3);
    assert.equal(snapshot.history.buckets.at(-1).peaks.connections, 3);

    clock.advance(
      presenceRoomModule.CSSQUAKE_PRESENCE_HISTORY_RETENTION_MS +
        presenceRoomModule.CSSQUAKE_PRESENCE_HISTORY_BUCKET_MS,
    );
    snapshot = await (await presenceRoom.onRequest(request("POST", {
      ...update,
      roomId: "cssquake-auto-e1m1-fresh-history",
      activePlayers: 1,
      roomPlayers: 1,
      connections: 1,
    }))).json();
    assert.equal(snapshot.history.buckets.length, 1);
    assert.equal(snapshot.history.buckets[0].peaks.activePlayers, 1);
    assert.equal(snapshot.history.peaks.activePlayers, 1);
  });
});

test("presence room prunes stale room reports", async () => {
  await withFakeNow(100_000, async (clock) => {
    const { room } = createFakePresenceRoom();
    const PresenceRoom = presenceRoomModule.default;
    const presenceRoom = new PresenceRoom(room);
    await presenceRoom.onRequest(request("POST", {
      type: "cssquake.room-presence",
      roomId: "cssquake-auto-e1m1-stale",
      mapName: "e1m1",
      gameplayFactsHash: null,
      activePlayers: 1,
      roomPlayers: 1,
      spectators: 0,
      connections: 1,
    }));

    clock.advance(presenceRoomModule.CSSQUAKE_PRESENCE_STALE_ROOM_MS + 1);
    await presenceRoom.onAlarm();
    const snapshot = await (await presenceRoom.onRequest(request("GET"))).json();
    assert.equal(snapshot.totals.rooms, 0);
    assert.equal(snapshot.totals.activePlayers, 0);
  });
});

test("party room reports joined and disconnected counts to presence room", () => {
  const { room, updates, createConnection } = createFakePartyRoom();
  const RoomClass = partyRoomModule.default;
  const partyRoom = new RoomClass(room);
  const connection = createConnection("connection-a");

  partyRoom.onConnect(connection);
  partyRoom.onMessage(JSON.stringify(helloEnvelope({
    clientId: "client-a",
    displayName: "Alice",
    messageId: "hello-a",
    sequence: 1,
    sentAt: Date.now(),
  })), connection);

  assert.equal(updates.at(-1).roomId, "cssquake-auto-e1m1-test");
  assert.equal(updates.at(-1).mapName, "e1m1");
  assert.equal(updates.at(-1).activePlayers, 1);
  assert.equal(updates.at(-1).roomPlayers, 1);
  assert.equal(updates.at(-1).connections, 1);
  assert.equal("region" in updates.at(-1), false);

  partyRoom.onClose(connection);
  assert.equal(updates.at(-1).activePlayers, 0);
  assert.equal(updates.at(-1).roomPlayers, 1);
  assert.equal(updates.at(-1).connections, 0);
});
