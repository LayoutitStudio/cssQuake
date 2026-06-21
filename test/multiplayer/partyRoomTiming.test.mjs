import assert from "node:assert/strict";
import test from "node:test";

import {
  helloEnvelope,
  partyRoomModule,
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

function createFakePartyRoom(id = "timing-room") {
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

async function withFakeRoomClock(startAt, run) {
  const originalNow = Date.now;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let current = startAt;
  const intervals = [];
  const timeouts = [];
  try {
    Date.now = () => current;
    globalThis.setInterval = (callback, delay, ...args) => {
      const timer = { callback, delay, args, cleared: false, unref: () => undefined };
      intervals.push(timer);
      return timer;
    };
    globalThis.clearInterval = (timer) => {
      if (timer) timer.cleared = true;
    };
    globalThis.setTimeout = (callback, delay, ...args) => {
      const timer = { callback, delay, args, cleared: false, unref: () => undefined };
      timeouts.push(timer);
      return timer;
    };
    globalThis.clearTimeout = (timer) => {
      if (timer) timer.cleared = true;
    };
    return await run({
      advance(ms) {
        current += ms;
        return current;
      },
      interval(delay) {
        const timer = intervals.find((candidate) => candidate.delay === delay && !candidate.cleared);
        assert.ok(timer, `expected interval ${delay}ms`);
        return timer;
      },
      timeout() {
        const timer = timeouts.findLast((candidate) => !candidate.cleared);
        assert.ok(timer, "expected pending timeout");
        return timer;
      },
      now: () => current,
    });
  } finally {
    Date.now = originalNow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

function sendEnvelope(partyRoom, connection, envelope) {
  partyRoom.onMessage(JSON.stringify(envelope), connection);
}

function connectionMessages(connection, type) {
  return connection.messages.filter((message) => message.type === type);
}

test("party room stale heartbeat preserves a player through reconnect grace", async () => {
  await withFakeRoomClock(100_000, async (clock) => {
    const { room, createConnection } = createFakePartyRoom();
    const RoomClass = partyRoomModule.default;
    const partyRoom = new RoomClass(room);
    const connection = createConnection("player-connection");
    partyRoom.onConnect(connection);

    sendEnvelope(partyRoom, connection, helloEnvelope({
      clientId: "client-a",
      displayName: "Alice",
      messageId: "hello-a",
      sequence: 1,
      sentAt: clock.now(),
    }));
    assert.equal(partyRoom.players.size, 1);
    assert.equal(partyRoom.connectionPlayers.size, 1);

    clock.advance(16_000);
    clock.interval(2_000).callback();

    assert.deepEqual(connection.closed.at(-1), { code: 4000, reason: "stale" });
    assert.equal(partyRoom.players.size, 1);
    assert.equal(partyRoom.connectionPlayers.size, 0);
    assert.equal(partyRoom.playerSimulationStates.has("party:client-a"), true);
    assert.equal(connectionMessages(connection, "room.snapshot").at(-1).payload.players.length, 1);
    assert.equal(connectionMessages(connection, "room.event").at(-1).payload.event.status, "disconnecting");

    const graceTimer = clock.timeout();
    assert.equal(graceTimer.delay, 15_000);
    clock.advance(graceTimer.delay);
    graceTimer.callback(...graceTimer.args);

    assert.equal(partyRoom.players.size, 0);
    assert.equal(partyRoom.playerSimulationStates.size, 0);
    assert.equal(connectionMessages(connection, "room.event").at(-1).payload.event.eventType, "player.left");
  });
});

test("party room heartbeat only marks clients stale after the grace threshold is exceeded", async () => {
  await withFakeRoomClock(300_000, async (clock) => {
    const { room, createConnection } = createFakePartyRoom("stale-boundary-room");
    const RoomClass = partyRoomModule.default;
    const partyRoom = new RoomClass(room);
    const connection = createConnection("player-connection");
    partyRoom.onConnect(connection);

    sendEnvelope(partyRoom, connection, helloEnvelope({
      clientId: "client-a",
      displayName: "Alice",
      messageId: "hello-a",
      sequence: 1,
      sentAt: clock.now(),
    }));

    const heartbeat = clock.interval(2_000);
    clock.advance(15_000);
    heartbeat.callback();

    assert.equal(connection.closed.length, 0);
    assert.equal(connectionMessages(connection, "room.ping").length, 1);
    assert.equal(partyRoom.players.size, 1);
    assert.equal(partyRoom.connectionPlayers.size, 1);

    clock.advance(1);
    heartbeat.callback();

    assert.deepEqual(connection.closed.at(-1), { code: 4000, reason: "stale" });
    assert.equal(partyRoom.players.size, 1);
    assert.equal(partyRoom.connectionPlayers.size, 0);
    assert.equal(clock.timeout().delay, 15_000);
  });
});

test("party room reconnect during stale grace cancels delayed player removal", async () => {
  await withFakeRoomClock(200_000, async (clock) => {
    const { room, createConnection } = createFakePartyRoom("reconnect-room");
    const RoomClass = partyRoomModule.default;
    const partyRoom = new RoomClass(room);
    const firstConnection = createConnection("player-connection-1");
    partyRoom.onConnect(firstConnection);

    sendEnvelope(partyRoom, firstConnection, helloEnvelope({
      clientId: "client-a",
      displayName: "Alice",
      messageId: "hello-a",
      sequence: 1,
      sentAt: clock.now(),
    }));

    clock.advance(16_000);
    clock.interval(2_000).callback();
    const graceTimer = clock.timeout();
    assert.equal(partyRoom.players.size, 1);
    assert.equal(partyRoom.connectionPlayers.size, 0);

    clock.advance(1_000);
    const secondConnection = createConnection("player-connection-2");
    partyRoom.onConnect(secondConnection);
    sendEnvelope(partyRoom, secondConnection, helloEnvelope({
      clientId: "client-a",
      displayName: "Alice",
      messageId: "hello-a-reconnect",
      sequence: 1,
      sentAt: clock.now(),
    }));

    assert.equal(graceTimer.cleared, true);
    assert.equal(partyRoom.players.size, 1);
    assert.equal(partyRoom.connectionPlayers.size, 1);
    assert.equal(secondConnection.closed.length, 0);

    clock.advance(15_000);
    graceTimer.callback(...graceTimer.args);

    assert.equal(partyRoom.players.size, 1);
    assert.equal(partyRoom.connectionPlayers.size, 1);
    assert.equal(partyRoom.playerSimulationStates.has("party:client-a"), true);
    assert.equal(connectionMessages(secondConnection, "room.snapshot").at(-1).payload.players.length, 1);
  });
});
