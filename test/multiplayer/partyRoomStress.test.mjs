import assert from "node:assert/strict";
import test from "node:test";

import {
  NORMALIZED_ROOM_KEY,
  helloEnvelope,
  inputEnvelope,
  partyRoomModule,
  protocol,
  simulation,
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

function createFakePartyRoom(id = "stress-room") {
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

async function withFakeNow(startAt, run) {
  const originalNow = Date.now;
  let current = startAt;
  Date.now = () => current;
  try {
    return await run({
      now: () => current,
      advance(ms) {
        current += ms;
        return current;
      },
    });
  } finally {
    Date.now = originalNow;
  }
}

function sendEnvelope(partyRoom, connection, envelope) {
  partyRoom.onMessage(JSON.stringify(envelope), connection);
}

function connectionMessages(connection, type) {
  return connection.messages.filter((message) => message.type === type);
}

test("party room stress keeps four active players bounded under sustained input", async () => {
  await withFakeNow(10_000, async (clock) => {
    const { room, createConnection } = createFakePartyRoom();
    const RoomClass = partyRoomModule.default;
    const partyRoom = new RoomClass(room);
    const connections = [];

    for (let playerIndex = 0; playerIndex < 4; playerIndex += 1) {
      const connection = createConnection(`player-${playerIndex}`);
      connections.push(connection);
      partyRoom.onConnect(connection);
      sendEnvelope(partyRoom, connection, helloEnvelope({
        clientId: `client-${playerIndex}`,
        displayName: `Player ${playerIndex}`,
        messageId: `hello-${playerIndex}`,
        sequence: 1,
        sentAt: clock.now(),
        matchSettings: { maxPlayers: 8 },
      }));
      clock.advance(20);
    }

    for (let inputSequence = 1; inputSequence <= 64; inputSequence += 1) {
      for (let playerIndex = 0; playerIndex < connections.length; playerIndex += 1) {
        const connection = connections[playerIndex];
        clock.advance(12);
        sendEnvelope(partyRoom, connection, inputEnvelope({
          clientId: `client-${playerIndex}`,
          messageId: `input-${playerIndex}-${inputSequence}`,
          sequence: inputSequence + 1,
          inputSequence,
          sentAt: clock.now(),
          input: {
            sampledAt: clock.now(),
            dt: 0.016,
            move: {
              forward: inputSequence % 2 === 0 ? 320 : -160,
              side: playerIndex % 2 === 0 ? 120 : -120,
              up: 0,
            },
            rotX: 0,
            rotY: (inputSequence * 7 + playerIndex * 45) % 360,
          },
        }));
      }
    }

    const status = await partyRoom.onRequest().json();
    assert.equal(status.players, 4);
    assert.equal(status.mapName, "e1m1");
    assert.equal(protocol.QUAKE_MULTIPLAYER_MAX_PLAYERS_CAP, 4);

    for (const connection of connections) {
      assert.equal(connectionMessages(connection, "room.reject").length, 0);
      assert.equal(connection.closed.length, 0);
    }

    assert.equal(partyRoom.players.size, 4);
    for (const state of partyRoom.playerSimulationStates.values()) {
      assert.ok(state.pendingInputs.length <= simulation.QUAKE_MULTIPLAYER_MAX_QUEUED_INPUTS);
    }

    for (const connection of connections) partyRoom.onClose(connection);
  });
});

test("party room stress closes noisy rejected connections without poisoning the room", async () => {
  await withFakeNow(20_000, async (clock) => {
    const { room, createConnection } = createFakePartyRoom();
    const RoomClass = partyRoomModule.default;
    const partyRoom = new RoomClass(room);

    const host = createConnection("host");
    partyRoom.onConnect(host);
    sendEnvelope(partyRoom, host, helloEnvelope({
      clientId: "host-client",
      displayName: "Host",
      messageId: "hello-host",
      sequence: 1,
      sentAt: clock.now(),
      matchSettings: { maxPlayers: 4 },
    }));

    const badConnections = [];
    for (let index = 0; index < 60; index += 1) {
      clock.advance(5);
      const connection = createConnection(`bad-${index}`);
      badConnections.push(connection);
      partyRoom.onConnect(connection);

      if (index % 3 === 0) {
        partyRoom.onMessage("{not json", connection);
      } else if (index % 3 === 1) {
        sendEnvelope(partyRoom, connection, inputEnvelope({
          clientId: `bad-client-${index}`,
          messageId: `bad-input-${index}`,
          sequence: 1,
          inputSequence: 1,
          sentAt: clock.now(),
        }));
      } else {
        sendEnvelope(partyRoom, connection, helloEnvelope({
          clientId: `bad-client-${index}`,
          displayName: `Bad ${index}`,
          messageId: `bad-hello-${index}`,
          sequence: 1,
          sentAt: clock.now(),
          roomKey: {
            ...NORMALIZED_ROOM_KEY,
            mapName: "e1m2",
            sceneUrl: "/q/e1m2.json",
          },
        }));
      }
    }

    const status = await partyRoom.onRequest().json();
    assert.equal(status.players, 1);
    assert.equal(host.closed.length, 0);
    assert.equal(connectionMessages(host, "room.reject").length, 0);
    assert.equal(partyRoom.players.size, 1);

    for (const connection of badConnections) {
      assert.ok(connection.closed.length > 0, `expected ${connection.id} to close`);
      assert.equal(connection.closed.at(-1).code, 1008);
    }

    partyRoom.onClose(host);
  });
});
