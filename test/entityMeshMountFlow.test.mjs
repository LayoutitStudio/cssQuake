import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

import { importTsModule } from "./importTsModule.mjs";

const {
  createQuakeEntityMeshMountFlow,
} = await importTsModule("src/runtime/app/entityMeshMountFlow.ts");

test("pickup mesh mounts keep generated face backfaces visible", () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;

  try {
    const element = window.document.createElement("div");
    for (const tagName of ["b", "i", "s", "u"]) {
      const leaf = window.document.createElement(tagName);
      leaf.style.backfaceVisibility = "hidden";
      element.append(leaf);
    }

    const transforms = [];
    const handle = {
      element,
      remove: () => undefined,
      setTransform: (transform) => transforms.push(transform),
    };
    const flow = createQuakeEntityMeshMountFlow({
      pixelate: () => undefined,
      pointToPoly: ({ x, y, z }) => [x, y, z],
      scene: {
        add: () => handle,
      },
      sceneElement: window.document.createElement("div"),
      schedulePresentationResync: async () => undefined,
    });

    const mounted = flow.addPickupMesh({
      index: 7,
      classname: "item_health",
      origin: { x: 1, y: 2, z: 3 },
      properties: { classname: "item_health" },
    });

    assert.equal(mounted, handle);
    assert.equal(element.classList.contains("pickup"), true);
    assert.deepEqual(
      [...element.querySelectorAll("b,i,s,u")].map((leaf) => leaf.style.backfaceVisibility),
      ["visible", "visible", "visible", "visible"],
    );
    assert.deepEqual(transforms, [{
      position: [1, 2, 3],
      rotation: [0, 0, 0],
      scale: 1,
    }]);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
  }
});
