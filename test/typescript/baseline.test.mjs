import assert from "node:assert/strict";
import test from "node:test";
import { newDiagnostics } from "./check.mjs";

const error = { file: "src/example.ts", code: 2322, message: "Type mismatch", source: "assignment" };
test("fixing an existing error cannot pay for a new error elsewhere", () => {
  const replacement = { ...error, source: "anotherAssignment" };
  assert.deepEqual(newDiagnostics([replacement], [error]), [replacement]);
});
test("another occurrence of the same error fails the baseline", () => {
  assert.deepEqual(newDiagnostics([error, error], [error]), [error]);
});
test("existing errors may move or be removed", () => {
  assert.deepEqual(newDiagnostics([error], [error, error]), []);
  assert.deepEqual(newDiagnostics([], [error]), []);
});
