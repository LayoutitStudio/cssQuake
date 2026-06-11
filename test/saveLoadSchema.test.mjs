import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "./importTsModule.mjs";

const {
  createCssQuakeSaveSlot,
  readCssQuakeSaveSlot,
  writeCssQuakeSaveSlot,
} = await importTsModule("src/runtime/saveLoad.ts");

test("save slots are versioned and readable from localStorage", () => {
  const storage = installStorage();
  const slot = createCssQuakeSaveSlot(validSaveInput());

  assert.equal(slot.version, 1);
  assert.equal(slot.mapName, "e1m1");
  assert.equal(Number.isFinite(slot.savedAt), true);

  writeCssQuakeSaveSlot(slot);
  assert.deepEqual(readCssQuakeSaveSlot(), slot);
  assert.equal(storage.getItem("cssquake.save.v1"), JSON.stringify(slot));
});

test("invalid or incompatible save slots are ignored", () => {
  const storage = installStorage();
  const warn = silenceWarn();
  try {
    storage.setItem("cssquake.save.v1", "{not json");
    assert.equal(readCssQuakeSaveSlot(), null);

    storage.setItem("cssquake.save.v1", JSON.stringify({ ...createCssQuakeSaveSlot(validSaveInput()), version: 2 }));
    assert.equal(readCssQuakeSaveSlot(), null);

    storage.setItem("cssquake.save.v1", JSON.stringify({
      ...createCssQuakeSaveSlot(validSaveInput()),
      view: { origin: [0, "bad", 0], rotX: 0, rotY: 0 },
    }));
    assert.equal(readCssQuakeSaveSlot(), null);
  } finally {
    warn.restore();
  }
});

test("missing storage reads as no save and writes fail explicitly", () => {
  delete globalThis.window;
  assert.equal(readCssQuakeSaveSlot(), null);
  assert.throws(
    () => writeCssQuakeSaveSlot(createCssQuakeSaveSlot(validSaveInput())),
    /storage is unavailable/,
  );
});

function validSaveInput() {
  return {
    mapName: "e1m1",
    view: {
      origin: [-576, 192, 184],
      rotX: 0,
      rotY: 90,
    },
    damageableBrushes: {
      brushes: [{ entityIndex: 10, health: 20 }],
    },
    player: {},
    pickups: {},
    shootables: {},
    movers: {},
    targets: {},
  };
}

function installStorage() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => {
      values.set(String(key), String(value));
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
  };
  globalThis.window = { localStorage: storage };
  return storage;
}

function silenceWarn() {
  const originalWarn = console.warn;
  console.warn = () => {};
  return {
    restore: () => {
      console.warn = originalWarn;
    },
  };
}
