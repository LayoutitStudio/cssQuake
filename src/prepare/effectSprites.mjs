import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const QUAKE_SPRITE_MAGIC = 0x50534449; // IDSP
const QUAKE_SPRITE_VERSION = 1;
const QUAKE_SPRITE_HEADER_BYTES = 36;
const QUAKE_SPRITE_SINGLE_FRAME = 0;
const QUAKE_SPRITE_TRANSPARENT_INDEX = 255;
const QUAKE_PALETTE_PATH = "gfx/palette.lmp";
const QUAKE_EXPLOSION_SPRITE_PATH = "progs/s_explod.spr";
const QUAKE_EXPLOSION_FRAME_DURATION_MS = 100;

export async function prepareQuakeEffectSprites({
  outputDir,
  pak,
  parsePakDirectory,
  publicUrlForOutputPath,
} = {}) {
  if (!outputDir) throw new Error("Missing Quake effect sprite output directory.");
  if (!pak) throw new Error("Missing Quake PAK bytes for effect sprite prepare.");
  if (typeof parsePakDirectory !== "function") throw new Error("Missing Quake PAK directory parser.");
  if (typeof publicUrlForOutputPath !== "function") throw new Error("Missing Quake public URL mapper.");

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const entriesByName = new Map(parsePakDirectory(pak).map((entry) => [String(entry.name).toLowerCase(), entry]));
  const paletteEntry = entriesByName.get(QUAKE_PALETTE_PATH);
  if (!paletteEntry) throw new Error(`Quake PAK is missing ${QUAKE_PALETTE_PATH}.`);
  const spriteEntry = entriesByName.get(QUAKE_EXPLOSION_SPRITE_PATH);
  if (!spriteEntry) throw new Error(`Quake PAK is missing ${QUAKE_EXPLOSION_SPRITE_PATH}.`);

  const palette = quakePakEntryBytes(pak, paletteEntry);
  const spriteBytes = quakePakEntryBytes(pak, spriteEntry);
  const sprite = parseQuakeSprite(spriteBytes, QUAKE_EXPLOSION_SPRITE_PATH);
  const sheet = quakeEffectSpriteSheetRgba(sprite, palette);
  const sourceHash = createHash("sha256").update(spriteBytes).digest("hex");
  const outputPath = path.join(outputDir, `s_explod-${sourceHash.slice(0, 12)}.png`);
  await sharp(sheet.rgba, {
    raw: {
      width: sheet.width,
      height: sheet.height,
      channels: 4,
    },
  }).png().toFile(outputPath);

  const asset = quakeEffectSpriteAsset({
    frameDurationMs: QUAKE_EXPLOSION_FRAME_DURATION_MS,
    kind: "explosion",
    sourceHash,
    sourcePath: QUAKE_EXPLOSION_SPRITE_PATH,
    sprite,
    texture: {
      alphaMode: "quake-sprite-index-255-alpha",
      height: sheet.height,
      transparentPixels: sheet.transparentPixels,
      url: publicUrlForOutputPath(outputPath),
      visiblePixels: sheet.visiblePixels,
      width: sheet.width,
    },
  });

  return {
    version: 1,
    schema: "cssquake-effect-sprites@1",
    explosionSprite: QUAKE_EXPLOSION_SPRITE_PATH,
    sprites: {
      [QUAKE_EXPLOSION_SPRITE_PATH]: asset,
    },
  };
}

export function parseQuakeSprite(bytes, sourcePath = "sprite.spr") {
  const data = bytesView(bytes);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.byteLength < QUAKE_SPRITE_HEADER_BYTES) {
    throw new Error(`${sourcePath} is too small to be a Quake sprite.`);
  }
  const magic = view.getUint32(0, true);
  if (magic !== QUAKE_SPRITE_MAGIC) throw new Error(`${sourcePath} has invalid sprite magic.`);
  const version = view.getInt32(4, true);
  if (version !== QUAKE_SPRITE_VERSION) throw new Error(`${sourcePath} has unsupported sprite version ${version}.`);

  const header = {
    type: view.getInt32(8, true),
    boundingRadius: view.getFloat32(12, true),
    maxWidth: view.getInt32(16, true),
    maxHeight: view.getInt32(20, true),
    numFrames: view.getInt32(24, true),
    beamLength: view.getFloat32(28, true),
    syncType: view.getInt32(32, true),
  };
  if (header.numFrames <= 0 || header.maxWidth <= 0 || header.maxHeight <= 0) {
    throw new Error(`${sourcePath} has invalid sprite dimensions or frame count.`);
  }

  let offset = QUAKE_SPRITE_HEADER_BYTES;
  const frames = [];
  for (let index = 0; index < header.numFrames; index++) {
    requireBytes(data, offset, 4, `${sourcePath} frame ${index} type`);
    const frameType = view.getInt32(offset, true);
    offset += 4;
    if (frameType !== QUAKE_SPRITE_SINGLE_FRAME) {
      throw new Error(`${sourcePath} frame ${index} uses unsupported grouped sprite frame type ${frameType}.`);
    }
    requireBytes(data, offset, 16, `${sourcePath} frame ${index} header`);
    const originX = view.getInt32(offset, true);
    const originY = view.getInt32(offset + 4, true);
    const width = view.getInt32(offset + 8, true);
    const height = view.getInt32(offset + 12, true);
    offset += 16;
    if (width <= 0 || height <= 0) throw new Error(`${sourcePath} frame ${index} has invalid size ${width}x${height}.`);
    const pixelCount = width * height;
    requireBytes(data, offset, pixelCount, `${sourcePath} frame ${index} pixels`);
    frames.push({
      index,
      originX,
      originY,
      width,
      height,
      pixels: data.slice(offset, offset + pixelCount),
    });
    offset += pixelCount;
  }
  if (offset !== data.byteLength) {
    throw new Error(`${sourcePath} has ${data.byteLength - offset} trailing sprite bytes.`);
  }

  return {
    sourcePath,
    header,
    frames,
  };
}

export function quakeEffectSpriteSheetRgba(sprite, paletteBytes) {
  const palette = bytesView(paletteBytes);
  if (palette.byteLength < 256 * 3) throw new Error("Quake palette must contain 256 RGB entries.");
  const frames = Array.isArray(sprite?.frames) ? sprite.frames : [];
  if (!frames.length) throw new Error("Quake sprite has no frames.");
  const frameWidth = Math.max(1, sprite.header?.maxWidth ?? Math.max(...frames.map((frame) => frame.width)));
  const frameHeight = Math.max(1, sprite.header?.maxHeight ?? Math.max(...frames.map((frame) => frame.height)));
  const width = frameWidth * frames.length;
  const height = frameHeight;
  const rgba = Buffer.alloc(width * height * 4);
  let transparentPixels = 0;
  let visiblePixels = 0;

  for (const frame of frames) {
    const frameX = frame.index * frameWidth;
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const paletteIndex = frame.pixels[y * frame.width + x];
        const outOffset = ((y * width) + frameX + x) * 4;
        if (paletteIndex === QUAKE_SPRITE_TRANSPARENT_INDEX) {
          rgba[outOffset + 3] = 0;
          transparentPixels++;
          continue;
        }
        const paletteOffset = paletteIndex * 3;
        rgba[outOffset] = palette[paletteOffset];
        rgba[outOffset + 1] = palette[paletteOffset + 1];
        rgba[outOffset + 2] = palette[paletteOffset + 2];
        rgba[outOffset + 3] = 255;
        visiblePixels++;
      }
    }
  }

  return {
    frameHeight,
    frameWidth,
    height,
    rgba,
    transparentPixels,
    visiblePixels,
    width,
  };
}

export function quakeEffectSpriteAsset({
  frameDurationMs,
  kind,
  sourceHash,
  sourcePath,
  sprite,
  texture,
}) {
  const frames = sprite.frames.map((frame) => ({
    index: frame.index,
    x: frame.index * sprite.header.maxWidth,
    y: 0,
    width: frame.width,
    height: frame.height,
    originX: frame.originX,
    originY: frame.originY,
    xoff: frame.originX,
    yoff: -frame.originY,
  }));
  return {
    id: "s_explod",
    kind,
    sourcePath,
    sourceHash,
    header: sprite.header,
    frameCount: frames.length,
    frameDurationMs,
    texture,
    frames,
  };
}

function quakePakEntryBytes(pak, entry) {
  const data = bytesView(pak);
  const offset = Number(entry.offset);
  const size = Number(entry.size);
  if (!Number.isInteger(offset) || !Number.isInteger(size) || offset < 0 || size < 0 || offset + size > data.byteLength) {
    throw new Error(`Invalid Quake PAK entry bounds for ${entry.name}.`);
  }
  return data.slice(offset, offset + size);
}

function bytesView(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  throw new Error("Expected byte buffer.");
}

function requireBytes(bytes, offset, count, label) {
  if (offset + count > bytes.byteLength) throw new Error(`${label} extends past end of file.`);
}
