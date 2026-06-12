import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "./importTsModule.mjs";

const {
  QUAKE_CANDAMAGE_TRACE_OFFSETS,
  quakecCanDamageAnyTracePointClear,
  quakecCanDamageFromTracePoints,
  quakecCanDamageTracePointsForRuntimeOrigin,
  quakecCanDamageTracePointsForTargetOrigin,
} = await importTsModule("src/runtime/shootables/damage.ts");

test("QuakeC CanDamage trace offsets match source order", () => {
  assert.deepEqual(QUAKE_CANDAMAGE_TRACE_OFFSETS, [
    { label: "origin", offset: [0, 0, 0] },
    { label: "plus15-plus15", offset: [15, 15, 0] },
    { label: "minus15-minus15", offset: [-15, -15, 0] },
    { label: "minus15-plus15", offset: [-15, 15, 0] },
    { label: "plus15-minus15", offset: [15, -15, 0] },
  ]);
});

test("CanDamage target trace points are converted from Quake-space offsets", () => {
  const targetOrigin = { x: 616, y: 72, z: 40 };
  const points = quakecCanDamageTracePointsForTargetOrigin(targetOrigin, ({ x, y, z }) => [x / 8, y / 8, z / 8]);

  assert.deepEqual(points.map((point) => point.label), [
    "origin",
    "plus15-plus15",
    "minus15-minus15",
    "minus15-plus15",
    "plus15-minus15",
  ]);
  assert.deepEqual(points.map((point) => point.end), [
    [77, 9, 5],
    [78.875, 10.875, 5],
    [75.125, 7.125, 5],
    [75.125, 10.875, 5],
    [78.875, 7.125, 5],
  ]);
});

test("CanDamage records all five traces and succeeds when any source trace is clear", () => {
  const tracePoints = QUAKE_CANDAMAGE_TRACE_OFFSETS.map((offset, index) => ({
    ...offset,
    end: [index, 0, 0],
  }));
  const calls = [];
  const result = quakecCanDamageFromTracePoints([99, 0, 0], tracePoints, (start, end) => {
    calls.push({ start, end });
    return end[0] === 2;
  });

  assert.equal(result.result, true);
  assert.deepEqual(result.traces.map((trace) => trace.clear), [false, false, true, false, false]);
  assert.deepEqual(calls.map((call) => call.end[0]), [0, 1, 2, 3, 4]);
});

test("runtime CanDamage trace points use scaled Quake offsets", () => {
  const points = quakecCanDamageTracePointsForRuntimeOrigin([10, 20, 30]);

  assert.deepEqual(points.map((point) => point.end), [
    [10, 20, 30],
    [10.3, 20.3, 30],
    [9.7, 19.7, 30],
    [9.7, 20.3, 30],
    [10.3, 19.7, 30],
  ]);
});

test("runtime CanDamage short-circuits on the first clear trace", () => {
  const tracePoints = QUAKE_CANDAMAGE_TRACE_OFFSETS.map((offset, index) => ({
    ...offset,
    end: [index, 0, 0],
  }));
  const calls = [];
  const result = quakecCanDamageAnyTracePointClear([99, 0, 0], tracePoints, (_start, end) => {
    calls.push(end[0]);
    return end[0] === 2;
  });

  assert.equal(result, true);
  assert.deepEqual(calls, [0, 1, 2]);
});

test("CanDamage fails when every trace is blocked", () => {
  const tracePoints = QUAKE_CANDAMAGE_TRACE_OFFSETS.map((offset, index) => ({
    ...offset,
    end: [index, 0, 0],
  }));
  const result = quakecCanDamageFromTracePoints([99, 0, 0], tracePoints, () => false);

  assert.equal(result.result, false);
  assert.deepEqual(result.traces.map((trace) => trace.clear), [false, false, false, false, false]);
});
