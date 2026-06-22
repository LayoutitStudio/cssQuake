import assert from "node:assert/strict";
import test from "node:test";

import {
  parseQuakeSprite,
  quakeEffectSpriteAsset,
  quakeEffectSpriteSheetRgba,
} from "../../src/prepare/effectSprites.mjs";

test("Quake effect sprite parser preserves source frame offsets and alpha index", () => {
  const spriteBytes = makeTestSprite([
    {
      originX: -1,
      originY: 1,
      width: 2,
      height: 2,
      pixels: [255, 1, 2, 3],
    },
    {
      originX: -1,
      originY: 1,
      width: 2,
      height: 2,
      pixels: [4, 255, 5, 6],
    },
  ]);
  const palette = makePalette();

  const sprite = parseQuakeSprite(spriteBytes, "progs/test.spr");
  assert.equal(sprite.header.numFrames, 2);
  assert.equal(sprite.header.maxWidth, 2);
  assert.equal(sprite.header.maxHeight, 2);
  assert.deepEqual(sprite.frames.map((frame) => [frame.originX, frame.originY]), [[-1, 1], [-1, 1]]);

  const sheet = quakeEffectSpriteSheetRgba(sprite, palette);
  assert.equal(sheet.width, 4);
  assert.equal(sheet.height, 2);
  assert.equal(sheet.transparentPixels, 2);
  assert.equal(sheet.visiblePixels, 6);
  assert.equal(sheet.rgba[3], 0);
  assert.deepEqual([...sheet.rgba.slice(4, 8)], [1, 2, 3, 255]);

  const asset = quakeEffectSpriteAsset({
    frameDurationMs: 100,
    kind: "explosion",
    sourceHash: "test-hash",
    sourcePath: "progs/test.spr",
    sprite,
    texture: {
      url: "/q/e/test.png",
      width: sheet.width,
      height: sheet.height,
    },
  });
  assert.equal(asset.frameCount, 2);
  assert.deepEqual(asset.frames.map((frame) => [frame.x, frame.y, frame.xoff, frame.yoff]), [
    [0, 0, -1, -1],
    [2, 0, -1, -1],
  ]);
});

function makeTestSprite(frames) {
  const frameBytes = frames.reduce((sum, frame) => sum + 4 + 16 + frame.width * frame.height, 0);
  const buffer = Buffer.alloc(36 + frameBytes);
  buffer.write("IDSP", 0, "ascii");
  buffer.writeInt32LE(1, 4);
  buffer.writeInt32LE(2, 8);
  buffer.writeFloatLE(2, 12);
  buffer.writeInt32LE(Math.max(...frames.map((frame) => frame.width)), 16);
  buffer.writeInt32LE(Math.max(...frames.map((frame) => frame.height)), 20);
  buffer.writeInt32LE(frames.length, 24);
  buffer.writeFloatLE(0, 28);
  buffer.writeInt32LE(0, 32);
  let offset = 36;
  for (const frame of frames) {
    buffer.writeInt32LE(0, offset);
    buffer.writeInt32LE(frame.originX, offset + 4);
    buffer.writeInt32LE(frame.originY, offset + 8);
    buffer.writeInt32LE(frame.width, offset + 12);
    buffer.writeInt32LE(frame.height, offset + 16);
    offset += 20;
    Buffer.from(frame.pixels).copy(buffer, offset);
    offset += frame.width * frame.height;
  }
  return buffer;
}

function makePalette() {
  const palette = Buffer.alloc(256 * 3);
  for (let index = 0; index < 256; index++) {
    palette[index * 3] = index;
    palette[index * 3 + 1] = index + 1;
    palette[index * 3 + 2] = index + 2;
  }
  return palette;
}
