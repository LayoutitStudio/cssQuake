import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { importTsModule } from "../importTsModule.mjs";
import { runShootableOwnershipScenario } from "./shootableOwnershipScenario.mjs";

const api = await importTsModule("test/runtime/shootableOwnershipModules.ts");
const reference = JSON.parse(readFileSync(new URL("./fixtures/shootableOwnershipMain.json", import.meta.url), "utf8"));
for (const expected of reference.cases) {
  const { classname, backend, quakec } = expected.scenario;
  test(`main gameplay and mesh lifetime: ${classname}, ${backend}, QuakeC ${quakec}`, () => {
    const actual = runShootableOwnershipScenario(api, expected.scenario);
    assert.equal(actual.frameCount, expected.frameCount);
    for (let i = 0; i < expected.checkpoints.length; i++) {
      assert.deepEqual(actual.checkpoints[i], expected.checkpoints[i], `First divergence at ${expected.checkpoints[i].label}`);
    }
    assert.equal(actual.checkpoints.length, expected.checkpoints.length);
  });
}
