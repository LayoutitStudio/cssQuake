import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  NORMALIZED_ROOM_KEY,
  correctionOptions,
  helloEnvelope,
  inputEnvelope,
  latestMessage,
  latestSnapshotPlayer,
  loopback,
  presenceEnvelope,
  reconciliation,
  waitForMessage,
} from "./harness.mjs";

test("loopback authority consumes ordered input, snapshots it, reconciles it, and ignores paused input", async () => {
  const messages = [];
  const session = loopback.createQuakeLoopbackMultiplayerSession({
    now: () => Date.now(),
    asyncDispatch: false,
    heartbeatIntervalMs: false,
    simulationTickMs: 1,
    snapshotIntervalMs: false,
  });
  const unsubscribe = session.subscribe((message) => messages.push(message));
  try {
    const connected = await session.connect({
      roomKey: NORMALIZED_ROOM_KEY,
      clientId: "client-a",
      displayName: "Alice",
      color: "#00ffaa",
    });
    assert.equal(connected.state, "connected");

    session.send(helloEnvelope({
      color: "#00ffaa",
      messageId: "flow-hello",
      sequence: 1,
      sentAt: Date.now(),
    }));
    assert.equal(latestSnapshotPlayer(messages).lastInputSequence, 0);

    for (const inputSequence of [1, 2, 3]) {
      session.send(inputEnvelope({
        messageId: `flow-input-${inputSequence}`,
        sequence: inputSequence + 1,
        inputSequence,
        sentAt: Date.now(),
      }));
      await delay(12);
    }

    await waitForMessage(
      messages,
      (message) =>
        message.type === "room.snapshot" &&
        message.payload.players.some((player) =>
          player.playerId === "loopback:client-a" && player.lastInputSequence >= 3
        ),
      { message: "timed out waiting for authoritative input snapshot" },
    );
    const authoritative = latestSnapshotPlayer(messages);
    assert.equal(authoritative.lastInputSequence, 3);

    const correction = reconciliation.decideQuakeMultiplayerLocalCorrection(
      authoritative.origin,
      authoritative,
      2,
      correctionOptions(),
    );
    assert.equal(correction.action, "none");
    assert.equal(correction.reason, "within-threshold");
    assert.equal(correction.inputSequence, 3);

    session.send(presenceEnvelope("backgrounded", {
      messageId: "flow-backgrounded",
      sequence: 5,
      sentAt: Date.now(),
    }));
    assert.equal(latestMessage(messages, "room.event").payload.event.status, "backgrounded");
    assert.equal(latestSnapshotPlayer(messages).lastInputSequence, 3);

    const messageCountBeforePausedInput = messages.length;
    await delay(12);
    session.send(inputEnvelope({
      messageId: "flow-paused-input",
      sequence: 6,
      inputSequence: 4,
      sentAt: Date.now(),
    }));
    await delay(20);
    assert.equal(messages.length, messageCountBeforePausedInput);
    assert.equal(latestSnapshotPlayer(messages).lastInputSequence, 3);
  } finally {
    unsubscribe();
    session.disconnect("test-complete");
  }
});
