import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const {
  requestQuakeLandscapeOnMobile,
} = await importTsModule("src/runtime/orientation.ts");

test("landscape request skips non-mobile viewports", async () => {
  let lockCalls = 0;
  const result = await requestQuakeLandscapeOnMobile(target(), environment({
    mobile: false,
    orientation: {
      type: "portrait-primary",
      lock: async () => { lockCalls += 1; },
    },
  }));

  assert.deepEqual(result, {
    fullscreenRequested: false,
    reason: "not-mobile",
  });
  assert.equal(lockCalls, 0);
});

test("landscape request skips when already landscape", async () => {
  let fullscreenCalls = 0;
  let lockCalls = 0;
  const result = await requestQuakeLandscapeOnMobile(target({
    fullscreen: async () => { fullscreenCalls += 1; },
  }), environment({
    orientation: {
      type: "landscape-primary",
      lock: async () => { lockCalls += 1; },
    },
  }));

  assert.deepEqual(result, {
    fullscreenRequested: false,
    reason: "already-landscape",
  });
  assert.equal(fullscreenCalls, 0);
  assert.equal(lockCalls, 0);
});

test("landscape request enters fullscreen before locking portrait mobile", async () => {
  const calls = [];
  const result = await requestQuakeLandscapeOnMobile(target({
    fullscreen: async (options) => { calls.push(["fullscreen", options]); },
  }), environment({
    orientation: {
      type: "portrait-primary",
      lock: async (orientation) => { calls.push(["lock", orientation]); },
    },
  }));

  assert.deepEqual(result, {
    fullscreenRequested: true,
    reason: "locked",
  });
  assert.deepEqual(calls, [
    ["fullscreen", { navigationUI: "hide" }],
    ["lock", "landscape"],
  ]);
});

test("landscape request still tries lock if fullscreen fails", async () => {
  const calls = [];
  const result = await requestQuakeLandscapeOnMobile(target({
    fullscreen: async () => {
      calls.push("fullscreen");
      throw new Error("denied");
    },
  }), environment({
    orientation: {
      type: "portrait-primary",
      lock: async () => { calls.push("lock"); },
    },
  }));

  assert.deepEqual(result, {
    fullscreenRequested: true,
    reason: "locked",
  });
  assert.deepEqual(calls, ["fullscreen", "lock"]);
});

test("landscape request reports unsupported and failed locks without throwing", async () => {
  assert.deepEqual(await requestQuakeLandscapeOnMobile(target(), environment({
    orientation: { type: "portrait-primary" },
  })), {
    fullscreenRequested: false,
    reason: "orientation-unsupported",
  });

  assert.deepEqual(await requestQuakeLandscapeOnMobile(target(), environment({
    orientation: {
      type: "portrait-primary",
      lock: async () => { throw new Error("unsupported"); },
    },
  })), {
    fullscreenRequested: false,
    reason: "lock-failed",
  });
});

function target({ fullscreen } = {}) {
  return {
    ownerDocument: {
      fullscreenElement: null,
      fullscreenEnabled: Boolean(fullscreen),
    },
    requestFullscreen: fullscreen,
  };
}

function environment({ mobile = true, orientation } = {}) {
  return {
    matchMedia: () => ({ matches: mobile }),
    screen: { orientation },
  };
}
