import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const {
  buildQuakeLeafVisibilityMountRequests,
} = await importTsModule("src/runtime/world.ts");

test("merged world leaves stay mounted when any indexed face is visible", () => {
  const mergedLeaf = { leafIndex: 2804 };
  const hiddenLeaf = { leafIndex: 2020 };
  const faceLeaves = new Map([
    [3345, [mergedLeaf]],
    [3346, [mergedLeaf]],
    [4286, [mergedLeaf]],
    [2395, [hiddenLeaf]],
  ]);

  const { leafMountRequests, scannedFaceLeafCount } = buildQuakeLeafVisibilityMountRequests(
    faceLeaves,
    new Set([3345]),
  );

  assert.equal(scannedFaceLeafCount, 4);
  assert.equal(leafMountRequests.get(mergedLeaf), true);
  assert.equal(leafMountRequests.get(hiddenLeaf), false);
});
