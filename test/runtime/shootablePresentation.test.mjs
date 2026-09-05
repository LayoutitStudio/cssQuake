import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { importTsModule } from "../importTsModule.mjs";
const { createQuakeShootablePresentation } = await importTsModule("src/runtime/shootables/presentation.ts");

function actor(index = 1) {
  return Object.freeze({
    entity: Object.freeze({ index, classname: "monster_army", origin: Object.freeze({ x: 1, y: 2, z: 3 }), properties: {} }),
    origin: Object.freeze([1, 2, 3]), yaw: 0, dead: false,
    enemy: Object.freeze({ animationFrameIndex: 0 }),
    model: Object.freeze({ renderScale: 1, animationFrames: [0, 1, 2, 3, 4] }),
  });
}
function harness() {
  const window = new Window();
  const handles = [];
  let fail = false;
  const options = {
    addMesh(_entity, _model, frame) {
      if (fail) return null;
      const element = window.document.createElement("div");
      window.document.body.append(element);
      const handle = { element, frame, removes: 0, remove() { this.removes++; element.remove(); }, setTransform() {} };
      handles.push(handle);
      return handle;
    },
    pointToPoly: point => [point.x, point.y, point.z], pixelate() {}, schedulePresentationResync() {},
    lifecycle: () => ({ deathAnimating: false, persistentCorpse: false }), nextFrameIndex: () => 1,
    markTrace() {}, onHandlesChanged() {},
  };
  return { owner: createQuakeShootablePresentation(options), anotherOwner: () => createQuakeShootablePresentation(options),
    handles, setFail: value => { fail = value; } };
}

test("presentation isolates actor identity and controller instances, including reused entity indexes", () => {
  const { owner, anotherOwner, handles } = harness();
  const first = actor(), reusedIndex = actor(), otherOwner = anotherOwner();
  owner.mount(first, false); owner.setVisible(first, true);
  owner.mount(first, false); // Repeated acquisition cannot orphan the first handle.
  owner.mount(reusedIndex, false); otherOwner.mount(first, false);
  owner.remove(first); owner.remove(first);
  assert.equal(owner.hasHandle(first), false);
  assert.equal(owner.isVisible(first), false);
  assert.equal(owner.hasHandle(reusedIndex), true);
  assert.equal(otherOwner.hasHandle(first), true);
  assert.deepEqual(handles.map(handle => handle.removes), [1, 0, 0]);
  owner.remove(reusedIndex); otherOwner.remove(first);
  assert.deepEqual(handles.map(handle => handle.removes), [1, 1, 1]);
  assert.deepEqual(Object.keys(first).sort(), ["dead", "enemy", "entity", "model", "origin", "yaw"], "No presentation fields may be written onto simulation state");
});

test("failed frame replacement preserves the currently visible handle", () => {
  const { owner, handles, setFail } = harness();
  const shootable = actor();
  owner.mount(shootable, false); owner.setVisible(shootable, true);
  setFail(true); owner.activateFrame(shootable, 1, false);
  assert.equal(owner.handleCount(shootable), 1);
  assert.equal(owner.isVisible(shootable), true);
  assert.equal(handles[0].removes, 0);
  setFail(false); owner.activateFrame(shootable, 1, false);
  assert.deepEqual(handles.map(handle => handle.removes), [1, 0]);
  owner.remove(shootable);
  assert.deepEqual(handles.map(handle => handle.removes), [1, 1]);
});

test("frame pool eviction protects the active and next frame and removes each retained handle once", () => {
  const { owner, handles } = harness();
  const shootable = actor();
  assert.equal(owner.mount(shootable, true), "pool");
  owner.setVisible(shootable, true);
  for (const frame of [1, 2, 3, 4]) owner.ensureFrame(shootable, frame);
  owner.trimFrames(shootable);
  assert.equal(owner.frameHandleCount(shootable), 3);
  assert.equal(owner.hasFrame(shootable, 0), true);
  assert.equal(owner.hasFrame(shootable, 1), true);
  owner.activateFrame(shootable, 4, true);
  assert.equal(handles.find(handle => handle.frame === 4).element.getAttribute("aria-hidden"), null);
  assert.equal(handles[0].element.getAttribute("aria-hidden"), "true");
  owner.remove(shootable); owner.remove(shootable);
  assert.deepEqual(handles.map(handle => handle.removes), [1, 1, 1, 1, 1]);
  assert.equal(owner.frameHandleCount(shootable), 0);
});

test("failed mount cannot publish visible residency or animate an absent mesh", () => {
  const { owner, handles, setFail } = harness();
  const shootable = actor();
  setFail(true); owner.mount(shootable, false); owner.setVisible(shootable, true);
  assert.equal(owner.hasHandle(shootable), false);
  assert.equal(owner.isVisible(shootable), false);
  assert.equal(owner.activateFrame(shootable, 1, false), null);
  assert.equal(handles.length, 0);
});
