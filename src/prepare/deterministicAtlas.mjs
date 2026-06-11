import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { BASE_TILE, computeTextureAtlasPlanPublic } from "@layoutit/polycss";
import sharp from "sharp";

import { QUAKE_UNIT_SCALE } from "../quakeScale.js";

export const deterministicAtlasDebugSourceImagesSymbol = Symbol.for("cssquake.deterministicAtlasDebugSourceImages");

const execFile = promisify(execFileCallback);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const projectRoot = path.resolve(moduleDir, "../..");
const BSP_LUMP_ENTITIES = 0;
const BSP_LUMP_PLANES = 1;
const BSP_LUMP_TEXTURES = 2;
const BSP_LUMP_VERTICES = 3;
const BSP_LUMP_TEXINFO = 6;
const BSP_LUMP_FACES = 7;
const BSP_LUMP_LIGHTING = 8;
const BSP_LUMP_EDGES = 12;
const BSP_LUMP_SURFEDGES = 13;
const BSP_LUMP_MODELS = 14;
const BSP_LUMP_COUNT = 15;
const BSP_HEADER_SIZE = 4 + BSP_LUMP_COUNT * 8;
const QUAKE_PLAYER_MINS_Z = -24;
const QUAKE_DETERMINISTIC_ATLAS_PAGE_SIZE = 4096;
const QUAKE_DETERMINISTIC_ATLAS_PAGE_PADDING = 1;
// Quake renders sky through a separate projected tile path, not direct BSP texture scale.
// Keep the coarser sky UV scale, but sample from the full prepared sky texture.
const QUAKE_DETERMINISTIC_SKY_UV_SCALE = 0.25;
const QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_MIN = 1;
const QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_STEP = 1;
const QUAKE_LIGHT_SAMPLE_SIZE = 16;
const VKQUAKE_LIGHTMAP_QUANTIZATION = 16;
const VKQUAKE_WORLD_LIGHTMAP_MULTIPLIER = 2;
const QUAKE_DETERMINISTIC_ATLAS_LIGHT_SAMPLING = normalizeDeterministicAtlasLightSampling(
  process.env.QUAKE_DETERMINISTIC_ATLAS_LIGHT_SAMPLING,
);
const VKQUAKE_WORLD_POSTPROCESS_GAMMA = 0.9;
const VKQUAKE_WORLD_POSTPROCESS_CONTRAST = 1.4;
const VKQUAKE_WORLD_POSTPROCESS_LUT = createVkQuakeWorldPostprocessLut();
const WINQUAKE_VID_CBITS = 6;
const WINQUAKE_DEFAULT_STYLE_VALUE = 256;
const WINQUAKE_LIGHTSTYLE_VALUES = new Map([[0, 12 * 22]]);
const WINQUAKE_LIGHTSTYLE_PATTERNS = new Map([
  [1, "mmnmmommommnonmmonqnmmo"],
  [2, "abcdefghijklmnopqrstuvwxyzyxwvutsrqponmlkjihgfedcba"],
  [3, "mmmmmaaaaammmmmaaaaaabcdefgabcdefg"],
  [4, "mamamamamama"],
  [5, "jklmnopqrstuvwxyzyxwvutsrqponmlkj"],
  [6, "nmonqnmomnmomomno"],
  [7, "mmmaaaabcdefgmmmmaaaammmaamm"],
  [8, "mmmaaammmaaammmabcdefaaaammmmabcdefmmmaaaa"],
  [9, "aaaaaaaazzzzzzzz"],
  [10, "mmamammmmammamamaaamammma"],
  [11, "abcdefghijklmnopqrrqponmlkjihgfedcba"],
]);
const SOFTWARE_SURFACE_REQUEST_MAGIC = 0x46525351;
const SOFTWARE_SURFACE_RESPONSE_MAGIC = 0x314f5351;
const SOFTWARE_SURFACE_HEADER_BYTES = 68;
const SOFTWARE_SURFACE_RESPONSE_HEADER_BYTES = 16;
const VKQUAKE_NATIVE_RASTER_DOUBLE_COUNT = 32;
const VKQUAKE_NATIVE_RASTER_JOB_META_COUNT = 17;
const QUAKE_POLYCSS_PROJECTIVE_QUAD_GUARDS = { bleed: 0 };
const QUAKE_FACE_NORMAL_AREA_EPS = 1e-4;
const QUAKE_SKY_TRANSPARENT_INDEX = 0;
const QUAKE_DETERMINISTIC_ATLAS_TIMING = process.env.QUAKE_DETERMINISTIC_ATLAS_TIMING === "1";
let vkQuakeNativeBatchRasterAddonClientPromise = null;
let vkQuakeNativeBatchRasterAddonClientRefCount = 0;

function normalizeDeterministicAtlasLightSampling(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "vkquake" || normalized === "vkquake-world") {
    return "vkquake-world";
  }
  if (normalized === "bilinear" || normalized === "texture-nearest-light-bilinear") {
    return "texture-nearest-light-bilinear";
  }
  if (normalized === "nearest" || normalized === "nearest-rgb") return "nearest-rgb";
  throw new Error(
    `Unsupported QUAKE_DETERMINISTIC_ATLAS_LIGHT_SAMPLING=${value}. Use vkquake, bilinear, or nearest-rgb.`,
  );
}

function createDeterministicAtlasTiming(name) {
  return QUAKE_DETERMINISTIC_ATLAS_TIMING
    ? {
        durations: new Map(),
        counts: new Map(),
        name,
        startedAt: performance.now(),
      }
    : null;
}

async function withDeterministicAtlasTiming(timing, label, callback) {
  if (!timing) return await callback();
  const start = performance.now();
  try {
    return await callback();
  } finally {
    addDeterministicAtlasTimingDuration(timing, label, performance.now() - start);
  }
}

function withDeterministicAtlasTimingSync(timing, label, callback) {
  if (!timing) return callback();
  const start = performance.now();
  try {
    return callback();
  } finally {
    addDeterministicAtlasTimingDuration(timing, label, performance.now() - start);
  }
}

function addDeterministicAtlasTimingDuration(timing, label, ms) {
  if (!timing) return;
  timing.durations.set(label, (timing.durations.get(label) ?? 0) + ms);
}

function incrementDeterministicAtlasTimingCount(timing, label, value = 1) {
  if (!timing) return;
  timing.counts.set(label, (timing.counts.get(label) ?? 0) + value);
}

function deterministicAtlasTimingDuration(timing, label) {
  return timing?.durations.get(label) ?? 0;
}

function deterministicAtlasTimingCount(timing, label) {
  return timing?.counts.get(label) ?? 0;
}

function logDeterministicAtlasTiming(timing, stats) {
  if (!timing) return;
  addDeterministicAtlasTimingDuration(timing, "total", performance.now() - timing.startedAt);
  const pngEncodeMs =
    deterministicAtlasTimingDuration(timing, "png.encode.atlasPage") +
    deterministicAtlasTimingDuration(timing, "png.encode.leafImage") +
    deterministicAtlasTimingDuration(timing, "png.encode.runtimeTexture");
  const pngEncodeWriteMs =
    deterministicAtlasTimingDuration(timing, "png.encodeWrite.leafImage") +
    deterministicAtlasTimingDuration(timing, "png.encodeWrite.runtimeTexture");
  const pngWriteMs =
    deterministicAtlasTimingDuration(timing, "png.write.atlasPage") +
    deterministicAtlasTimingDuration(timing, "png.write.leafImage") +
    deterministicAtlasTimingDuration(timing, "png.write.runtimeTexture");
  console.log(
    `Deterministic atlas timing for ${timing.name}: ` +
    `total=${formatDeterministicAtlasTimingMs(deterministicAtlasTimingDuration(timing, "total"))}, ` +
    `leafTiles=${formatDeterministicAtlasTimingMs(deterministicAtlasTimingDuration(timing, "leafTiles"))}, ` +
    `nativePack=${formatDeterministicAtlasTimingMs(deterministicAtlasTimingDuration(timing, "native.batch.pack"))}, ` +
    `nativeCall=${formatDeterministicAtlasTimingMs(deterministicAtlasTimingDuration(timing, "native.batch.call"))}, ` +
    `policyPack=${formatDeterministicAtlasTimingMs(deterministicAtlasTimingDuration(timing, "policy.pack"))}, ` +
    `pageCompose=${formatDeterministicAtlasTimingMs(deterministicAtlasTimingDuration(timing, "png.compose.atlasPage"))}, ` +
    `pngEncode=${formatDeterministicAtlasTimingMs(pngEncodeMs)}, ` +
    `pngEncodeWrite=${formatDeterministicAtlasTimingMs(pngEncodeWriteMs)}, ` +
    `pngWrite=${formatDeterministicAtlasTimingMs(pngWriteMs)}, ` +
    `rewrite=${formatDeterministicAtlasTimingMs(deterministicAtlasTimingDuration(timing, "mesh.rewrite"))}, ` +
    `compact=${formatDeterministicAtlasTimingMs(deterministicAtlasTimingDuration(timing, "mesh.compactAssets"))}, ` +
    `oldAssetScan=${formatDeterministicAtlasTimingMs(deterministicAtlasTimingDuration(timing, "oldAssetScan"))}, ` +
    `tiles=${stats.replacedLeaves}, pages=${stats.pageCount ?? 0}, leafImages=${stats.leafImageCount ?? 0}, ` +
    `nativeJobs=${deterministicAtlasTimingCount(timing, "native.jobs")}, ` +
    `nativePixels=${deterministicAtlasTimingCount(timing, "native.pixels")}`,
  );
}

function formatDeterministicAtlasTimingMs(ms) {
  return `${ms.toFixed(ms >= 100 ? 1 : 3)}ms`;
}

export async function replaceQuakeRenderBundleWorldAtlas({
  imagePolicy = "atlas",
  mapPath,
  name,
  optimizeAtlasLeafBasis = false,
  outputDir,
  pakBuffer,
  polygons,
  publicPath,
  readTextureUrl,
  renderBundle,
  visibility,
}) {
  if (!renderBundle?.meshHtml || !Array.isArray(renderBundle.leafMetadata) || !Array.isArray(polygons)) {
    return { enabled: true, replacedLeaves: 0, skippedLeaves: 0, skipped: { invalidInput: 1 } };
  }

  const timing = createDeterministicAtlasTiming(name);
  const { bspData, renderPolygons, leaves } = withDeterministicAtlasTimingSync(timing, "setup", () => ({
    bspData: parseQuakeBspFromPak(pakBuffer, mapPath),
    renderPolygons: optimizeAtlasLeafBasis
      ? applyQuakeAtlasLeafBasisRotationPlan(polygons, quakeAtlasLeafBasisRotationPlan(polygons))
      : polygons,
    leaves: parseRenderBundleAtlasLeaves(renderBundle.meshHtml, renderBundle.leafMetadata),
  }));
  const tiles = [];
  const skipped = new Map();
  const skipSamples = new Map();
  const normalizedImagePolicy = normalizeDeterministicImagePolicy(imagePolicy);
  const softwareOracle = deterministicAtlasNeedsSoftwareOracle() ? await createSoftwareQuakeSurfaceOracle() : null;
  const nativeRasterAddon = deterministicAtlasNeedsNativeBatchRaster()
    ? await createVkQuakeNativeBatchRasterAddon()
    : null;
  const context = {
    boundsBySourceFace: new Map(),
    directPreparedTextureByKey: new Map(),
    nativeRasterAddon,
    nativeRasterJobs: nativeRasterAddon ? [] : null,
    planByPolygon: new Map(),
    preparedTextureByUrl: new Map(),
    readTextureUrl,
    sourceByFace: new Map(),
    softwareSurfaceBySourceFace: new Map(),
    softwareOracle,
    timing,
  };

  try {
    await withDeterministicAtlasTiming(timing, "leafTiles", async () => {
      for (const leaf of leaves) {
        const tile = await deterministicLeafTile({
          bspData,
          context,
          leaf,
          polygons: renderPolygons,
          visibility,
        });
        if (tile?.skip) {
          incrementStat(skipped, tile.skip);
          recordSkipSample(skipSamples, tile.skip, tile.sample);
          continue;
        }
        if (!tile) {
          incrementStat(skipped, "unknown");
          recordSkipSample(skipSamples, "unknown", { leafIndex: leaf.index });
          continue;
        }
        tiles.push(tile);
      }
    });
    flushVkQuakeNativeRasterJobs(context);
  } finally {
    await softwareOracle?.close?.();
    await nativeRasterAddon?.close?.();
  }

  if (!tiles.length) {
    return {
      enabled: true,
      pageCount: 0,
      replacedLeaves: 0,
      skippedLeaves: leaves.length,
      skipped: Object.fromEntries([...skipped.entries()].sort()),
      skipSamples: serializeSkipSamples(skipSamples),
    };
  }

  const atlasTiles = [];
  const leafImageTiles = [];
  const imagePolicyBuckets = new Map();
  withDeterministicAtlasTimingSync(timing, "policy.pack", () => {
    for (const tile of tiles) {
      const bucket = deterministicTileImagePolicyBucket(tile, normalizedImagePolicy);
      tile.imagePolicyBucket = bucket;
      incrementStat(imagePolicyBuckets, bucket);
      if (deterministicImagePolicyBucketUsesLeafImage(bucket)) {
        leafImageTiles.push(tile);
      } else {
        atlasTiles.push(tile);
      }
    }
  });
  const pages = withDeterministicAtlasTimingSync(timing, "atlas.packPages", () =>
    packDeterministicAtlasTiles(atlasTiles));
  const coverageFallbackLeaves = tiles.reduce((total, tile) => total + (tile.coverageFallback ? 1 : 0), 0);
  const derivedUvAffineLeaves = tiles.reduce((total, tile) => total + (tile.derivedUvAffine ? 1 : 0), 0);
  const mergedSourceLeaves = tiles.reduce((total, tile) => total + (tile.mergedSourceFaces > 1 ? 1 : 0), 0);
  await withDeterministicAtlasTiming(timing, "fs.mkdir", () => mkdir(outputDir, { recursive: true }));
  await withDeterministicAtlasTiming(timing, "fs.removeStaleImages", () => removeStaleDeterministicImageFiles(outputDir));
  let pageBytes = 0;
  let leafImageBytes = 0;
  let runtimeTextureImageBytes = 0;
  let runtimeTextureImageCount = 0;
  const pageAssetUrls = [];
  const debugSourceImages = new Map();
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const filename = deterministicAtlasPageFilename(index);
    const outputPath = path.join(outputDir, filename);
    const image = await renderDeterministicAtlasPage(page, timing);
    await withDeterministicAtlasTiming(timing, "png.write.atlasPage", () => writeFile(outputPath, image));
    pageBytes += image.byteLength;
    pageAssetUrls.push(`${publicPath}/${filename}`);
  }
  for (const tile of leafImageTiles) {
    const filename = deterministicLeafImageFilename(tile.leafIndex);
    const outputPath = path.join(outputDir, filename);
    leafImageBytes += await writeDeterministicLeafImage(tile, outputPath, timing);
    tile.leafImageUrl = `${publicPath}/${filename}`;
    debugSourceImages.set(tile.leafImageUrl, {
      height: tile.height,
      rgba: tile.rgba,
      width: tile.width,
    });
  }
  for (const tile of tiles) {
    if (!tile.runtimeTextureImages) continue;
    tile.runtimeTextureUrls = {};
    for (const [kind, runtimeImage] of Object.entries(tile.runtimeTextureImages)) {
      if (!runtimeImage?.rgba || !runtimeImage.width || !runtimeImage.height) continue;
      const filename = deterministicLeafImageFilename(tile.leafIndex, kind);
      runtimeTextureImageBytes += await writeDeterministicRgbaImage(
        runtimeImage.width,
        runtimeImage.height,
        runtimeImage.rgba,
        path.join(outputDir, filename),
        timing,
        "png.encodeWrite.runtimeTexture",
      );
      runtimeTextureImageCount++;
      tile.runtimeTextureUrls[kind] = `${publicPath}/${filename}`;
    }
  }

  const originalAssetUrls = renderBundle.assetUrls.slice();
  const firstNewAssetIndex = renderBundle.assetUrls.length;
  renderBundle.assetUrls = [...renderBundle.assetUrls, ...pageAssetUrls];
  if (debugSourceImages.size) {
    Object.defineProperty(renderBundle, deterministicAtlasDebugSourceImagesSymbol, {
      configurable: true,
      value: debugSourceImages,
    });
  }
  renderBundle.meshHtml = withDeterministicAtlasTimingSync(timing, "mesh.rewrite", () =>
    rewriteRenderBundleMeshHtmlForDeterministicAtlas(
      renderBundle.meshHtml,
      tiles,
      pageAssetUrls,
      firstNewAssetIndex,
    ));
  renderBundle.leafCount = renderBundle.leafMetadata.length;
  await withDeterministicAtlasTiming(timing, "mesh.compactAssets", () =>
    compactRenderBundleBackgroundAssets(renderBundle, outputDir, publicPath));

  const oldBytes = await withDeterministicAtlasTiming(timing, "oldAssetScan", () =>
    referencedAssetBytes(originalAssetUrls, outputDir, publicPath));
  const stats = {
    enabled: true,
    imagePolicy: normalizedImagePolicy,
    name,
    pageBytes: pageBytes + leafImageBytes + runtimeTextureImageBytes,
    atlasPageBytes: pageBytes,
    leafImageBytes,
    runtimeTextureImageBytes,
    pageCount: pages.length,
    atlasTileCount: atlasTiles.length,
    leafImageCount: leafImageTiles.length,
    runtimeTextureImageCount,
    coverageFallbackLeaves,
    derivedUvAffineLeaves,
    mergedSourceLeaves,
    replacedLeaves: tiles.length,
    skippedLeaves: leaves.length - tiles.length,
    skipped: Object.fromEntries([...skipped.entries()].sort()),
    skipSamples: serializeSkipSamples(skipSamples),
    imagePolicyBuckets: Object.fromEntries([...imagePolicyBuckets.entries()].sort()),
    oldAtlasBytesStillReferenced: oldBytes,
  };
  logDeterministicAtlasTiming(timing, stats);
  return stats;
}

function parseQuakeBspFromPak(pakBuffer, mapPath) {
  const pak = parsePak(pakBuffer);
  const entry = pak.entries.get(mapPath);
  if (!entry) throw new Error(`Could not find ${mapPath} in PAK.`);
  const bsp = pakBuffer.subarray(entry.offset, entry.offset + entry.size);
  return parseBsp(bsp, pak, pakBuffer);
}

async function deterministicLeafTile({ bspData, context, leaf, polygons, visibility }) {
  const metadata = leaf.metadata ?? {};
  const polygonIndex = metadata.p;
  const renderFaceIndex = metadata.f;
  const renderCandidate = visibility?.candidates?.[renderFaceIndex];
  const sourceFaceIndices = renderCandidate?.sourceFaceIndices ?? [];
  const baseSample = () => ({
    leafIndex: leaf.index,
    width: leaf.width,
    height: leaf.height,
    metadata,
    sourceFaceCount: sourceFaceIndices.length,
    sourceFaceIndices: sourceFaceIndices.slice(0, 8),
  });
  if (!Number.isInteger(polygonIndex) || !polygons[polygonIndex]) {
    return { skip: "missing-prepared-polygon", sample: baseSample() };
  }
  if (sourceFaceIndices.length < 1) {
    return { skip: "merged-or-missing-source-face", sample: baseSample() };
  }
  if (!leaf.width || !leaf.height) return { skip: "missing-leaf-size", sample: baseSample() };

  const sources = sourceFaceIndices.map((sourceFaceIndex) => cachedSourceFace(context, bspData, sourceFaceIndex));
  if (sources.some((item) => !item)) return { skip: "missing-source-face", sample: baseSample() };
  const source = sources[0];
  const sourceFaceIndex = source.faceIndex;
  const sourceSample = () => ({
    ...baseSample(),
    sourceFaceIndex,
    sourceFaceIndices,
    sourceModelIndex: source.modelIndex,
    sourceTexture: source.texture.name,
    sourceStyles: source.face.styles,
    sourceLightOffset: source.face.lightOffset,
    sourceEdgeCount: source.face.edgeCount,
  });
  const hasSpecialTexture = sources.some((item) => quakeTextureNeedsPreparedAtlas(item.texture.name));
  if (sources.some((item) => item.texture.name.toLowerCase() !== source.texture.name.toLowerCase())) {
    return { skip: "merged-texture-mismatch", sample: sourceSample() };
  }
  const polygon = polygons[polygonIndex];
  if (!polygon?.vertices?.length || !polygon?.uvs?.length) {
    return { skip: "missing-polygon-uvs", sample: sourceSample() };
  }
  const plan = cachedTextureAtlasPlan(context, polygon, polygonIndex);
  if (!plan || plan.canvasW <= 0 || plan.canvasH <= 0) {
    return { skip: "missing-atlas-plan", sample: sourceSample() };
  }

  if (hasSpecialTexture) {
    return deterministicPreparedTextureLeafTile({
      bspData,
      context,
      leaf,
      plan,
      polygon,
      source,
      sourceSample,
      sources,
    });
  }

  const sourceBounds = cachedSourceBounds(context, source);
  const baked = polygon.data?.["lm-bake"] === true;
  const planMatrix = parseMatrix3dDeclaration(plan.atlasMatrix);
  const sampleMatrix = leaf.matrix ?? planMatrix;
  const sourceEntries = await Promise.all(sources.map(async (item) => {
    const bounds = cachedSourceBounds(context, item);
    return {
      bounds,
      polyPoints: item.points.map((point) => quakeToPoly(point, bspData.pivot)),
      softwareSurface: await cachedWinQuakeSurface(context, item, bounds, bspData),
      source: item,
    };
  }));
  const mergedSourceEntries = sourceEntries.length > 1 ? sourceEntries : null;
  const leafSampler = leafLocalSourceSamplerFor(sampleMatrix, polygon, sourceEntries, bspData);
  const screenToPoly = mergedSourceEntries ? screenToPolyMapperForPlan(plan, polygon) : null;
  if (mergedSourceEntries && !leafSampler && !screenToPoly) {
    return { skip: "merged-missing-plan-map", sample: sourceSample() };
  }
  const softwareSurface = sourceEntries[0].softwareSurface;
  const rgba = Buffer.alloc(leaf.width * leaf.height * 4);
  let solidPixels = 0;
  const derivedUvAffine = plan.uvAffine ? null : derivePlanUvAffine(plan, polygon);
  const useAffineUv = Boolean(plan.uvAffine ?? derivedUvAffine);
  const affine = plan.uvAffine ?? derivedUvAffine;
  const affineDet = affine ? affine.a * affine.d - affine.b * affine.c : 0;
  const sampleRect = plan.uvSampleRect;
  const planScreenPolygonPoints = screenPolygonPoints(plan.screenPts);
  let coverageFallback = false;
  const leafSamplerCoversTile = leafSampler
    ? polygonCoversRasterSampleRect(leafSampler.coveragePoints, leaf.width, leaf.height)
    : false;
  const leafSingleSourceFullCoverage = leafSamplerCoversTile ? leafSampler?.singleSourceSample ?? null : null;
  const paintPixelAtPlanPoint = (x, y, planX, planY, localX, localY, options = {}) => {
    let u;
    let v;
    let sampleSoftwareSurface = softwareSurface;
    let s;
    let t;
    if (leafSampler && options.useLeafSampler !== false) {
      if (leafSampler.singleSourceSample) {
        const offset = (y * leaf.width + x) * 4;
        return writeLeafLocalSingleSourceSampleRgbAt(leafSampler.singleSourceSample, localX, localY, rgba, offset);
      } else {
        const sample = leafSampler.sample(localX, localY);
        if (!sample) return false;
        sampleSoftwareSurface = sample.softwareSurface;
        s = sample.s;
        t = sample.t;
      }
    } else {
      if (useAffineUv) {
        if (Math.abs(affineDet) <= 1e-9) return false;
        const dx = planX - affine.e;
        const dy = planY - affine.f;
        u = (dx * affine.d - affine.b * dy) / affineDet;
        v = (affine.a * dy - dx * affine.c) / affineDet;
      } else if (sampleRect) {
        u = sampleRect.minU + (planX / plan.canvasW) * (sampleRect.maxU - sampleRect.minU);
        v = sampleRect.minV + (planY / plan.canvasH) * (sampleRect.maxV - sampleRect.minV);
      } else {
        return false;
      }
      s = baked
        ? sourceBounds.minS + u * (sourceBounds.maxS - sourceBounds.minS)
        : u * source.texture.width;
      t = baked
        ? sourceBounds.maxT - v * (sourceBounds.maxT - sourceBounds.minT)
        : (v - 1) * source.texture.height;
      if (mergedSourceEntries && screenToPoly) {
        const polyPoint = screenToPoly(planX, planY);
        const entry = polyPoint ? sourceEntryAtPolyPoint(mergedSourceEntries, polyPoint) : null;
        if (!entry) return false;
        sampleSoftwareSurface = entry.softwareSurface;
        const quakePoint = polyToQuake(polyPoint, bspData.pivot);
        const coords = textureCoordsAtQuakePoint(quakePoint, entry.source.texInfo);
        s = coords.s;
        t = coords.t;
      }
    }
    const offset = (y * leaf.width + x) * 4;
    writeVkQuakePostprocessedRgbAt(sampleSoftwareSurface, s, t, rgba, offset);
    return true;
  };

  if (leafSingleSourceFullCoverage) {
    const sample = leafSingleSourceFullCoverage;
    const matrix = sample.matrix;
    const texInfo = sample.texInfo;
    const pivot = sample.pivot;
    const surface = sample.softwareSurface;
    const writeRgbAt = QUAKE_DETERMINISTIC_ATLAS_LIGHT_SAMPLING === "vkquake-world" &&
      surface.texturePixels &&
      surface.paletteRgb
      ? writeVkQuakeWorldPassRgbAt
      : writeVkQuakePostprocessedRgbAt;
    const nativeRasterJob = context.nativeRasterJobs && writeRgbAt === writeVkQuakeWorldPassRgbAt
      ? createVkQuakeNativeRasterJob({
          height: leaf.height,
          matrix,
          output: rgba,
          pivot,
          surface,
          texInfo,
          width: leaf.width,
        })
      : null;
    if (nativeRasterJob) {
      context.nativeRasterJobs.push(nativeRasterJob);
      solidPixels += leaf.width * leaf.height;
    } else {
      for (let y = 0; y < leaf.height; y++) {
        const localY = y + 0.5;
        const polyXLocalY = matrix[5] * localY;
        const polyYLocalY = matrix[4] * localY;
        const polyZLocalY = matrix[6] * localY;
        for (let x = 0; x < leaf.width; x++) {
          const localX = x + 0.5;
          const offset = (y * leaf.width + x) * 4;
          const polyX = (matrix[1] * localX + polyXLocalY + matrix[13]) / BASE_TILE;
          const polyY = (matrix[0] * localX + polyYLocalY + matrix[12]) / BASE_TILE;
          const polyZ = (matrix[2] * localX + polyZLocalY + matrix[14]) / BASE_TILE;
          const quakeX = polyX / QUAKE_UNIT_SCALE + pivot.x;
          const quakeY = polyY / QUAKE_UNIT_SCALE + pivot.y;
          const quakeZ = polyZ / QUAKE_UNIT_SCALE + pivot.z;
          const s = quakeX * texInfo.s[0] + quakeY * texInfo.s[1] + quakeZ * texInfo.s[2] + texInfo.s[3];
          const t = quakeX * texInfo.t[0] + quakeY * texInfo.t[1] + quakeZ * texInfo.t[2] + texInfo.t[3];
          writeRgbAt(surface, s, t, rgba, offset);
          solidPixels++;
        }
      }
    }
  } else {
    for (let y = 0; y < leaf.height; y++) {
      const localY = y + 0.5;
      const planY = (localY / leaf.height) * plan.canvasH;
      for (let x = 0; x < leaf.width; x++) {
        const localX = x + 0.5;
        const planX = (localX / leaf.width) * plan.canvasW;
        const inside = leafSamplerCoversTile
          ? true
          : leafSampler
          ? pointInPolygon2(localX, localY, leafSampler.coveragePoints)
          : pointInScreenPolygon(planX, planY, plan.screenPts);
        if (!inside) continue;
        if (paintPixelAtPlanPoint(x, y, planX, planY, localX, localY)) solidPixels++;
      }
    }
  }

  if (!solidPixels) {
    const stepX = plan.canvasW / leaf.width;
    const stepY = plan.canvasH / leaf.height;
    for (let y = 0; y < leaf.height; y++) {
      const localY = y + 0.5;
      const planY = (localY / leaf.height) * plan.canvasH;
      const minY = planY - stepY * 0.5;
      const maxY = planY + stepY * 0.5;
      for (let x = 0; x < leaf.width; x++) {
        const localX = x + 0.5;
        const planX = (localX / leaf.width) * plan.canvasW;
        const minX = planX - stepX * 0.5;
        const maxX = planX + stepX * 0.5;
        let painted = false;
        const localSample = leafSampler
          ? samplePolygonPointInRect(leafSampler.coveragePoints, x, y, x + 1, y + 1)
          : null;
        if (localSample) {
          const sampleLocalX = localSample[0];
          const sampleLocalY = localSample[1];
          const samplePlanX = (sampleLocalX / leaf.width) * plan.canvasW;
          const samplePlanY = (sampleLocalY / leaf.height) * plan.canvasH;
          painted = paintPixelAtPlanPoint(x, y, samplePlanX, samplePlanY, sampleLocalX, sampleLocalY);
        }
        if (!painted) {
          const planSample = samplePolygonPointInRect(planScreenPolygonPoints, minX, minY, maxX, maxY);
          if (!planSample) continue;
          painted = paintPixelAtPlanPoint(x, y, planSample[0], planSample[1], localX, localY, {
            useLeafSampler: false,
          });
        }
        if (painted) solidPixels++;
      }
    }
    coverageFallback = solidPixels > 0;
  }

  if (!solidPixels) {
    return {
      skip: "empty-raster",
      sample: {
        ...sourceSample(),
        planCanvasW: plan.canvasW,
        planCanvasH: plan.canvasH,
        planScreenBounds: screenPointBounds(plan.screenPts),
        planScreenPointCount: Math.floor((plan.screenPts?.length ?? 0) / 2),
        planScreenPts: sampleScreenPoints(plan.screenPts),
      },
    };
  }
  const runtimeTextureImages = deterministicRuntimeTextureImagesForLeaf({
    leaf,
    renderTexture: (texture) => renderSingleSourceFullCoverageTexture({
      height: leaf.height,
      sample: leafSingleSourceFullCoverage,
      texture,
      width: leaf.width,
    }),
    sourceTexture: source.texture,
    textures: bspData.textures,
  });
  return {
    height: leaf.height,
    leafIndex: leaf.index,
    coverageFallback,
    derivedUvAffine: Boolean(derivedUvAffine),
    mergedSourceFaces: sourceEntries.length,
    matrix: planMatrix,
    rgba,
    ...(runtimeTextureImages ? { runtimeTextureImages } : {}),
    sourceTexture: source.texture.name,
    transformCompensationX: leaf.transformCompensationX,
    transformCompensationY: leaf.transformCompensationY,
    solidPixels,
    width: leaf.width,
  };
}

async function deterministicPreparedTextureLeafTile({
  bspData,
  context,
  leaf,
  plan,
  polygon,
  source,
  sourceSample,
  sources,
}) {
  if (typeof polygon.texture !== "string" || !polygon.texture) {
    return { skip: "missing-prepared-texture-url", sample: sourceSample() };
  }
  if (typeof context.readTextureUrl !== "function") {
    return { skip: "missing-prepared-texture-reader", sample: sourceSample() };
  }

  const texture = directPreparedTextureForSource(context, polygon, source, bspData) ??
    await cachedPreparedTexture(context, polygon.texture);
  if (!texture) return { skip: "missing-prepared-texture", sample: sourceSample() };

  const planMatrix = parseMatrix3dDeclaration(plan.atlasMatrix);
  const tileWidth = leaf.width;
  const tileHeight = leaf.height;
  const rgba = Buffer.alloc(tileWidth * tileHeight * 4);
  let solidPixels = 0;
  const derivedUvAffine = plan.uvAffine ? null : derivePlanUvAffine(plan, polygon);
  const planScreenPolygonPoints = screenPolygonPoints(plan.screenPts);
  const baseRgb = polygon.textureAlphaMode === "opaque" ? parseCssHexRgb(polygon.color) : null;
  let coverageFallback = false;

  const paintPixelAtPlanPoint = (x, y, planX, planY) => {
    const sample = preparedTextureSampleAtPlanPoint(plan, polygon, texture, planX, planY, derivedUvAffine);
    if (!sample) return false;
    const offset = (y * tileWidth + x) * 4;
    return writePreparedTextureSampleAt(texture, sample, rgba, offset, baseRgb);
  };

  for (let y = 0; y < tileHeight; y++) {
    const localY = y + 0.5;
    const planY = (localY / tileHeight) * plan.canvasH;
    for (let x = 0; x < tileWidth; x++) {
      const localX = x + 0.5;
      const planX = (localX / tileWidth) * plan.canvasW;
      const inside = pointInScreenPolygon(planX, planY, plan.screenPts);
      if (!inside) continue;
      if (paintPixelAtPlanPoint(x, y, planX, planY)) solidPixels++;
    }
  }

  if (!solidPixels) {
    const stepX = plan.canvasW / tileWidth;
    const stepY = plan.canvasH / tileHeight;
    for (let y = 0; y < tileHeight; y++) {
      const localY = y + 0.5;
      const planY = (localY / tileHeight) * plan.canvasH;
      const minY = planY - stepY * 0.5;
      const maxY = planY + stepY * 0.5;
      for (let x = 0; x < tileWidth; x++) {
        const localX = x + 0.5;
        const planX = (localX / tileWidth) * plan.canvasW;
        const minX = planX - stepX * 0.5;
        const maxX = planX + stepX * 0.5;
        let painted = false;
        const planSample = samplePolygonPointInRect(planScreenPolygonPoints, minX, minY, maxX, maxY);
        if (!planSample) continue;
        painted = paintPixelAtPlanPoint(x, y, planSample[0], planSample[1]);
        if (painted) solidPixels++;
      }
    }
    coverageFallback = solidPixels > 0;
  }

  if (!solidPixels) {
    return {
      skip: "empty-prepared-texture-raster",
      sample: {
        ...sourceSample(),
        planCanvasW: plan.canvasW,
        planCanvasH: plan.canvasH,
        planScreenBounds: screenPointBounds(plan.screenPts),
        planScreenPointCount: Math.floor((plan.screenPts?.length ?? 0) / 2),
        planScreenPts: sampleScreenPoints(plan.screenPts),
      },
    };
  }

  return {
    height: tileHeight,
    leafIndex: leaf.index,
    coverageFallback,
    derivedUvAffine: Boolean(derivedUvAffine),
    mergedSourceFaces: sources.length,
    matrix: planMatrix,
    rgba,
    sourceTexture: source.texture.name,
    transformCompensationX: leaf.transformCompensationX,
    transformCompensationY: leaf.transformCompensationY,
    solidPixels,
    width: tileWidth,
  };
}

async function cachedPreparedTexture(context, url) {
  if (context.preparedTextureByUrl.has(url)) {
    return context.preparedTextureByUrl.get(url);
  }
  const buffer = await context.readTextureUrl(url);
  if (!buffer) {
    context.preparedTextureByUrl.set(url, null);
    return null;
  }
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const texture = !info?.width || !info?.height || info.channels !== 4
    ? null
    : {
        height: info.height,
        rgba: data,
        url,
        width: info.width,
      };
  context.preparedTextureByUrl.set(url, texture);
  return texture;
}

function directPreparedTextureForSource(context, polygon, source, bspData) {
  const textureName = String(polygon.data?.["tex"] ?? "").toLowerCase();
  if (!textureName || textureName !== source.texture.name.toLowerCase()) return null;
  if (polygon.textureAlphaMode && polygon.textureAlphaMode !== "opaque") return null;
  if (!textureName.startsWith("sky") && !textureName.startsWith("*") && !textureName.startsWith("+")) return null;

  const brightness = textureName.startsWith("sky") ? 1 : preparedTextureBrightnessForPolygon(polygon);
  const sourceKind = textureName.startsWith("sky") ? "sky" : "indexed";
  const key = `${sourceKind}:${source.texture.name}:${brightness.toFixed(4)}`;
  if (context.directPreparedTextureByKey.has(key)) {
    return context.directPreparedTextureByKey.get(key);
  }

  const prepared = sourceKind === "sky"
    ? quakePreparedSkyTexture(source.texture)
    : {
        height: source.texture.height,
        pixels: source.texture.pixels,
        width: source.texture.width,
      };
  const texture = {
    height: prepared.height,
    rgba: indexedPreparedTextureRgba(
      prepared.width,
      prepared.height,
      prepared.pixels,
      bspData.palette,
      brightness,
    ),
    ...(sourceKind === "sky"
      ? {
          sampleScaleS: QUAKE_DETERMINISTIC_SKY_UV_SCALE,
          sampleScaleT: QUAKE_DETERMINISTIC_SKY_UV_SCALE,
        }
      : {}),
    url: polygon.texture,
    width: prepared.width,
  };
  context.directPreparedTextureByKey.set(key, texture);
  return texture;
}

function preparedTextureBrightnessForPolygon(polygon) {
  const value = polygon.data?.["lit"];
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : 1;
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 1;
}

function indexedPreparedTextureRgba(width, height, pixels, palette, brightness) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < pixels.length; index++) {
    const paletteIndex = pixels[index] ?? 0;
    const [r, g, b] = palette[paletteIndex] ?? [0, 0, 0];
    const light = paletteIndex >= 224 ? 1 : brightness;
    const offset = index * 4;
    rgba[offset] = clampByte(r * light);
    rgba[offset + 1] = clampByte(g * light);
    rgba[offset + 2] = clampByte(b * light);
    rgba[offset + 3] = 255;
  }
  return rgba;
}

function quakeCompositeSkyPixels(texture) {
  const layerWidth = Math.floor(texture.width / 2);
  if (layerWidth <= 0) return texture.pixels.slice();

  const pixels = new Uint8Array(texture.pixels.length);
  for (let y = 0; y < texture.height; y++) {
    const row = y * texture.width;
    for (let x = 0; x < texture.width; x++) {
      const layerX = x % layerWidth;
      const cloud = texture.pixels[row + layerX] ?? QUAKE_SKY_TRANSPARENT_INDEX;
      pixels[row + x] = cloud === QUAKE_SKY_TRANSPARENT_INDEX
        ? texture.pixels[row + layerWidth + layerX] ?? QUAKE_SKY_TRANSPARENT_INDEX
        : cloud;
    }
  }
  return pixels;
}

function quakePreparedSkyTexture(texture) {
  return {
    height: texture.height,
    pixels: quakeCompositeSkyPixels(texture),
    width: texture.width,
  };
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function preparedTextureSampleAtPlanPoint(plan, polygon, texture, planX, planY, derivedUvAffine) {
  const triangle = preparedTextureTriangleAtPlanPoint(plan, planX, planY);
  if (triangle?.uvAffine) {
    return preparedTextureSampleFromAffine(
      triangle.uvAffine,
      polygon.textureWrap?.s,
      polygon.textureWrap?.t,
      planX,
      planY,
    );
  }
  if (triangle?.uvSampleRect) {
    return preparedTextureSampleFromUvRect(texture, triangle.uvSampleRect, planX, planY, plan.canvasW, plan.canvasH);
  }
  const affine = plan.uvAffine ?? derivedUvAffine;
  if (affine) {
    return preparedTextureSampleFromAffine(
      affine,
      polygon.textureWrap?.s,
      polygon.textureWrap?.t,
      planX,
      planY,
    );
  }
  if (plan.uvSampleRect) {
    return preparedTextureSampleFromUvRect(texture, plan.uvSampleRect, planX, planY, plan.canvasW, plan.canvasH);
  }
  return preparedTextureSampleFromCover(texture, planX, planY, plan.canvasW, plan.canvasH);
}

function preparedTextureTriangleAtPlanPoint(plan, planX, planY) {
  const triangles = plan.textureTriangles;
  if (!Array.isArray(triangles) || triangles.length === 0) return null;
  for (const triangle of triangles) {
    if (pointInScreenPolygon(planX, planY, triangle.screenPts)) return triangle;
  }
  return null;
}

function preparedTextureSampleFromAffine(affine, wrapS, wrapT, planX, planY) {
  const det = affine.a * affine.d - affine.b * affine.c;
  if (Math.abs(det) <= 1e-9) return null;
  const dx = planX - affine.e;
  const dy = planY - affine.f;
  return {
    kind: "uv",
    u: (dx * affine.d - affine.b * dy) / det,
    v: (affine.a * dy - dx * affine.c) / det,
    wrapS,
    wrapT,
  };
}

function preparedTextureSampleFromUvRect(texture, rect, planX, planY, canvasW, canvasH) {
  const source = preparedTextureUvSampleSourceRect(texture, rect);
  if (!source) return null;
  return {
    kind: "source",
    x: source.sx + (planX / canvasW) * source.sw,
    y: source.sy + (planY / canvasH) * source.sh,
  };
}

function preparedTextureUvSampleSourceRect(texture, rect) {
  const imgW = texture.width || 1;
  const imgH = texture.height || 1;
  const rawX0 = clampSourceCoord(Math.min(rect.minU, rect.maxU) * imgW, imgW);
  const rawX1 = clampSourceCoord(Math.max(rect.minU, rect.maxU) * imgW, imgW);
  const rawY0 = clampSourceCoord(Math.min(rect.minV, rect.maxV) * imgH, imgH);
  const rawY1 = clampSourceCoord(Math.max(rect.minV, rect.maxV) * imgH, imgH);

  let sx = Math.floor(rawX0);
  let sy = Math.floor(rawY0);
  let sw = Math.ceil(rawX1) - sx;
  let sh = Math.ceil(rawY1) - sy;

  if (sw < 1) {
    sx = Math.floor(clampSourceCoord(((rect.minU + rect.maxU) / 2) * imgW, imgW - 1));
    sw = 1;
  }
  if (sh < 1) {
    sy = Math.floor(clampSourceCoord(((rect.minV + rect.maxV) / 2) * imgH, imgH - 1));
    sh = 1;
  }
  sx = Math.max(0, Math.min(imgW - 1, sx));
  sy = Math.max(0, Math.min(imgH - 1, sy));
  sw = Math.max(1, Math.min(imgW - sx, sw));
  sh = Math.max(1, Math.min(imgH - sy, sh));
  return { sx, sy, sw, sh };
}

function clampSourceCoord(value, max) {
  return Math.max(0, Math.min(max, value));
}

function preparedTextureSampleFromCover(texture, planX, planY, canvasW, canvasH) {
  const scale = Math.max(canvasW / texture.width, canvasH / texture.height);
  const drawW = texture.width * scale;
  const drawH = texture.height * scale;
  return {
    kind: "source",
    x: (planX - (canvasW - drawW) / 2) / scale,
    y: (planY - (canvasH - drawH) / 2) / scale,
  };
}

function writePreparedTextureSampleAt(texture, sample, rgba, offset, baseRgb) {
  const point = sample.kind === "uv"
    ? preparedTextureWrappedPoint(texture, sample.u, sample.v, sample.wrapS, sample.wrapT)
    : preparedTextureSourcePoint(texture, sample.x, sample.y);
  if (!point) {
    if (!baseRgb) return false;
    rgba[offset] = baseRgb[0];
    rgba[offset + 1] = baseRgb[1];
    rgba[offset + 2] = baseRgb[2];
    rgba[offset + 3] = 255;
    return true;
  }
  const sourceOffset = (point.y * texture.width + point.x) * 4;
  const alpha = texture.rgba[sourceOffset + 3] ?? 0;
  if (alpha >= 255 || !baseRgb) {
    rgba[offset] = texture.rgba[sourceOffset] ?? 0;
    rgba[offset + 1] = texture.rgba[sourceOffset + 1] ?? 0;
    rgba[offset + 2] = texture.rgba[sourceOffset + 2] ?? 0;
    rgba[offset + 3] = alpha;
    return alpha > 0;
  }
  if (alpha <= 0) {
    rgba[offset] = baseRgb[0];
    rgba[offset + 1] = baseRgb[1];
    rgba[offset + 2] = baseRgb[2];
    rgba[offset + 3] = 255;
    return true;
  }
  const inverseAlpha = 255 - alpha;
  rgba[offset] = Math.round(((texture.rgba[sourceOffset] ?? 0) * alpha + baseRgb[0] * inverseAlpha) / 255);
  rgba[offset + 1] = Math.round(((texture.rgba[sourceOffset + 1] ?? 0) * alpha + baseRgb[1] * inverseAlpha) / 255);
  rgba[offset + 2] = Math.round(((texture.rgba[sourceOffset + 2] ?? 0) * alpha + baseRgb[2] * inverseAlpha) / 255);
  rgba[offset + 3] = 255;
  return true;
}

function preparedTextureWrappedPoint(texture, u, v, wrapS, wrapT) {
  const x = preparedTextureAxisPoint(u * (texture.sampleScaleS ?? 1), texture.width, wrapS);
  const y = preparedTextureAxisPoint(v * (texture.sampleScaleT ?? 1), texture.height, wrapT);
  if (x === null || y === null) return null;
  return { x, y };
}

function preparedTextureAxisPoint(value, side, wrap) {
  const scaled = value * side;
  if (wrap === "repeat") return positiveModulo(Math.floor(scaled), side);
  if (wrap === "mirrored-repeat") {
    const tile = Math.floor(value);
    const local = value - tile;
    const mirrored = Math.abs(tile % 2) === 1 ? 1 - local : local;
    return Math.max(0, Math.min(side - 1, Math.floor(mirrored * side)));
  }
  if (value < 0 || value > 1) return null;
  return Math.max(0, Math.min(side - 1, Math.floor(scaled)));
}

function preparedTextureSourcePoint(texture, x, y) {
  if (x < 0 || y < 0 || x > texture.width || y > texture.height) return null;
  return {
    x: Math.max(0, Math.min(texture.width - 1, Math.floor(x))),
    y: Math.max(0, Math.min(texture.height - 1, Math.floor(y))),
  };
}

function parseCssHexRgb(value) {
  const match = String(value ?? "").trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function quakeTextureNeedsPreparedAtlas(name) {
  return name.startsWith("sky") || name.startsWith("*");
}

function cachedSourceFace(context, bspData, sourceFaceIndex) {
  if (context.sourceByFace.has(sourceFaceIndex)) return context.sourceByFace.get(sourceFaceIndex);
  const source = buildSourceFace(bspData, sourceFaceIndex);
  context.sourceByFace.set(sourceFaceIndex, source);
  return source;
}

function cachedTextureAtlasPlan(context, polygon, polygonIndex) {
  if (context.planByPolygon.has(polygonIndex)) return context.planByPolygon.get(polygonIndex);
  const plan = computeTextureAtlasPlanPublic(polygon, polygonIndex, {
    tileSize: BASE_TILE,
    layerElevation: BASE_TILE,
  }, QUAKE_POLYCSS_PROJECTIVE_QUAD_GUARDS);
  context.planByPolygon.set(polygonIndex, plan);
  return plan;
}

function leafLocalSourceSamplerFor(matrix, polygon, sourceEntries, data) {
  if (!matrix || !polygon?.vertices?.length || !sourceEntries?.length) return null;
  const coveragePoints = polygon.vertices.map((point) => polyPointToLeafLocal(matrix, point));
  if (coveragePoints.some((point) => !validLocalPoint(point))) return null;
  if (Math.abs(signedLocalPolygonArea(coveragePoints)) <= 1e-7) return null;
  const singleSourceSample = sourceEntries.length === 1
    ? leafLocalSingleSourceTextureSampleContext(matrix, sourceEntries[0], data.pivot)
    : null;
  return {
    coveragePoints,
    ...(singleSourceSample ? { singleSourceSample } : {}),
    sample(localX, localY) {
      const polyPoint = leafLocalToPolyPoint(matrix, localX, localY);
      const entry = sourceEntries.length === 1
        ? sourceEntries[0]
        : sourceEntryAtPolyPoint(sourceEntries, polyPoint);
      if (!entry) return null;
      const quakePoint = polyToQuake(polyPoint, data.pivot);
      const coords = textureCoordsAtQuakePoint(quakePoint, entry.source.texInfo);
      return {
        s: coords.s,
        source: entry.source,
        softwareSurface: entry.softwareSurface,
        t: coords.t,
      };
    },
  };
}

function leafLocalSingleSourceTextureSampleContext(matrix, entry, pivot) {
  if (!entry?.source?.texInfo || !entry.softwareSurface || !pivot) return null;
  return {
    matrix,
    pivot,
    softwareSurface: entry.softwareSurface,
    texInfo: entry.source.texInfo,
  };
}

function writeLeafLocalSingleSourceSampleRgbAt(context, localX, localY, rgba, offset) {
  const matrix = context.matrix;
  const texInfo = context.texInfo;
  const pivot = context.pivot;
  const polyX = (matrix[1] * localX + matrix[5] * localY + matrix[13]) / BASE_TILE;
  const polyY = (matrix[0] * localX + matrix[4] * localY + matrix[12]) / BASE_TILE;
  const polyZ = (matrix[2] * localX + matrix[6] * localY + matrix[14]) / BASE_TILE;
  const quakeX = polyX / QUAKE_UNIT_SCALE + pivot.x;
  const quakeY = polyY / QUAKE_UNIT_SCALE + pivot.y;
  const quakeZ = polyZ / QUAKE_UNIT_SCALE + pivot.z;
  const s = quakeX * texInfo.s[0] + quakeY * texInfo.s[1] + quakeZ * texInfo.s[2] + texInfo.s[3];
  const t = quakeX * texInfo.t[0] + quakeY * texInfo.t[1] + quakeZ * texInfo.t[2] + texInfo.t[3];
  writeVkQuakePostprocessedRgbAt(context.softwareSurface, s, t, rgba, offset);
  return true;
}

function renderSingleSourceFullCoverageTexture({ height, sample, texture, width }) {
  if (!sample || !texture?.pixels || !texture.width || !texture.height || !width || !height) return null;
  const matrix = sample.matrix;
  const texInfo = sample.texInfo;
  const pivot = sample.pivot;
  const surface = {
    ...sample.softwareSurface,
    texturePixels: texture.pixels,
    textureHeight: texture.height,
    textureWidth: texture.width,
  };
  const rgba = Buffer.alloc(width * height * 4);
  const writeRgbAt = QUAKE_DETERMINISTIC_ATLAS_LIGHT_SAMPLING === "vkquake-world" &&
    surface.texturePixels &&
    surface.paletteRgb
    ? writeVkQuakeWorldPassRgbAt
    : writeVkQuakePostprocessedRgbAt;
  for (let y = 0; y < height; y++) {
    const localY = y + 0.5;
    const polyXLocalY = matrix[5] * localY;
    const polyYLocalY = matrix[4] * localY;
    const polyZLocalY = matrix[6] * localY;
    for (let x = 0; x < width; x++) {
      const localX = x + 0.5;
      const offset = (y * width + x) * 4;
      const polyX = (matrix[1] * localX + polyXLocalY + matrix[13]) / BASE_TILE;
      const polyY = (matrix[0] * localX + polyYLocalY + matrix[12]) / BASE_TILE;
      const polyZ = (matrix[2] * localX + polyZLocalY + matrix[14]) / BASE_TILE;
      const quakeX = polyX / QUAKE_UNIT_SCALE + pivot.x;
      const quakeY = polyY / QUAKE_UNIT_SCALE + pivot.y;
      const quakeZ = polyZ / QUAKE_UNIT_SCALE + pivot.z;
      const s = quakeX * texInfo.s[0] + quakeY * texInfo.s[1] + quakeZ * texInfo.s[2] + texInfo.s[3];
      const t = quakeX * texInfo.t[0] + quakeY * texInfo.t[1] + quakeZ * texInfo.t[2] + texInfo.t[3];
      writeRgbAt(surface, s, t, rgba, offset);
    }
  }
  return { height, rgba, width };
}

function deterministicRuntimeTextureImagesForLeaf({ leaf, renderTexture, sourceTexture, textures }) {
  const attrs = leaf.attrs ?? {};
  if (!attrs["data-base"] && !attrs["data-pressed"] && !attrs["data-sprite"]) return null;
  const out = {};
  if (attrs["data-base"]) {
    const base = renderTexture(sourceTexture);
    if (base) out.base = base;
  }
  if (attrs["data-pressed"]) {
    const pressedTexture = buttonPressedTextureFrame(sourceTexture, textures);
    const pressed = pressedTexture ? renderTexture(pressedTexture) : null;
    if (pressed) out.pressed = pressed;
  }
  if (attrs["data-sprite"]) {
    const animation = textureAnimationFrameTextures(sourceTexture, textures);
    if (animation) {
      const frames = rotateTextureAnimationFrames(animation.frames, animation.frameIndex)
        .map((frame) => renderTexture(frame));
      if (frames.length > 1 && frames.every(Boolean)) {
        out.sprite = stitchHorizontalRuntimeFrames(frames);
      }
    }
  }
  return Object.keys(out).length ? out : null;
}

function stitchHorizontalRuntimeFrames(frames) {
  const frameWidth = frames[0].width;
  const frameHeight = frames[0].height;
  if (!frames.every((frame) => frame.width === frameWidth && frame.height === frameHeight)) return null;
  const width = frameWidth * frames.length;
  const height = frameHeight;
  const rgba = Buffer.alloc(width * height * 4);
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    const frame = frames[frameIndex];
    const sourceStride = frameWidth * 4;
    const targetStride = width * 4;
    for (let y = 0; y < frameHeight; y++) {
      const sourceStart = y * sourceStride;
      const targetStart = (y * targetStride) + frameIndex * sourceStride;
      frame.rgba.copy(rgba, targetStart, sourceStart, sourceStart + sourceStride);
    }
  }
  return { height, rgba, width };
}

function textureAnimationFrameTextures(texture, textures) {
  const match = texture.name.match(/^\+([0-9])(.+)$/);
  if (!match) return undefined;
  const suffix = match[2]?.toLowerCase();
  if (!suffix) return undefined;
  const frames = textures
    .filter((item) => {
      if (!item) return false;
      const itemMatch = item.name.match(/^\+([0-9])(.+)$/);
      return Boolean(itemMatch && itemMatch[2]?.toLowerCase() === suffix);
    })
    .sort((a, b) => Number(a.name[1]) - Number(b.name[1]));
  if (frames.length <= 1) return undefined;
  const frameIndex = frames.findIndex((frame) => frame.name.toLowerCase() === texture.name.toLowerCase());
  return frameIndex >= 0 ? { frames, frameIndex } : undefined;
}

function rotateTextureAnimationFrames(frames, frameIndex) {
  if (frameIndex <= 0) return frames;
  return [...frames.slice(frameIndex), ...frames.slice(0, frameIndex)];
}

function buttonPressedTextureFrame(texture, textures) {
  if (!texture.name.startsWith("+0") || texture.name.length <= 2) return undefined;
  const pressedName = `+a${texture.name.slice(2)}`.toLowerCase();
  return textures.find((item) => Boolean(item && item.name.toLowerCase() === pressedName));
}

function leafLocalToPolyPoint(matrix, localX, localY) {
  const cssX = matrix[0] * localX + matrix[4] * localY + matrix[12];
  const cssY = matrix[1] * localX + matrix[5] * localY + matrix[13];
  const cssZ = matrix[2] * localX + matrix[6] * localY + matrix[14];
  return [
    cssY / BASE_TILE,
    cssX / BASE_TILE,
    cssZ / BASE_TILE,
  ];
}

function polyPointToLeafLocal(matrix, point) {
  if (!validVec3(point)) return null;
  return cssPointToLeafLocal(matrix, [
    point[1] * BASE_TILE,
    point[0] * BASE_TILE,
    point[2] * BASE_TILE,
  ]);
}

function cssPointToLeafLocal(matrix, point) {
  const origin = [matrix[12], matrix[13], matrix[14]];
  const xAxis = [matrix[0], matrix[1], matrix[2]];
  const yAxis = [matrix[4], matrix[5], matrix[6]];
  const delta = [
    point[0] - origin[0],
    point[1] - origin[1],
    point[2] - origin[2],
  ];
  const xx = vec3Dot(xAxis, xAxis);
  const xy = vec3Dot(xAxis, yAxis);
  const yy = vec3Dot(yAxis, yAxis);
  const dx = vec3Dot(delta, xAxis);
  const dy = vec3Dot(delta, yAxis);
  const det = xx * yy - xy * xy;
  if (Math.abs(det) <= 1e-9) return null;
  return [
    (dx * yy - dy * xy) / det,
    (xx * dy - xy * dx) / det,
  ];
}

function validLocalPoint(point) {
  return Array.isArray(point) &&
    point.length >= 2 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1]);
}

function signedLocalPolygonArea(points) {
  let area = 0;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    area += points[previous][0] * points[index][1] - points[index][0] * points[previous][1];
  }
  return area * 0.5;
}

function polygonCoversRasterSampleRect(points, width, height) {
  if (!localPolygonIsConvex(points)) return false;
  const minX = 0.5;
  const minY = 0.5;
  const maxX = Math.max(minX, width - 0.5);
  const maxY = Math.max(minY, height - 0.5);
  return pointInPolygon2(minX, minY, points) &&
    pointInPolygon2(maxX, minY, points) &&
    pointInPolygon2(maxX, maxY, points) &&
    pointInPolygon2(minX, maxY, points);
}

function localPolygonIsConvex(points) {
  if (!Array.isArray(points) || points.length < 3) return false;
  let sign = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];
    if (!validLocalPoint(a) || !validLocalPoint(b) || !validLocalPoint(c)) return false;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) <= 1e-9) continue;
    const nextSign = Math.sign(cross);
    if (sign && nextSign !== sign) return false;
    sign = nextSign;
  }
  return sign !== 0;
}

function pixelIntersectsLocalPolygon(minX, minY, maxX, maxY, points) {
  if (
    pointInPolygon2(minX, minY, points) ||
    pointInPolygon2(maxX, minY, points) ||
    pointInPolygon2(maxX, maxY, points) ||
    pointInPolygon2(minX, maxY, points)
  ) {
    return true;
  }

  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [ax, ay] = points[previous];
    const [bx, by] = points[index];
    if (pointInRect(ax, ay, minX, minY, maxX, maxY) || pointInRect(bx, by, minX, minY, maxX, maxY)) {
      return true;
    }
    if (segmentIntersectsRect(ax, ay, bx, by, minX, minY, maxX, maxY)) return true;
  }
  return false;
}

function samplePolygonPointInRect(points, minX, minY, maxX, maxY) {
  const clipped = clipPolygonToRect(points, minX, minY, maxX, maxY);
  if (clipped.length === 0) return null;
  const point = polygonSamplePoint(clipped);
  if (!point) return null;
  return [
    Math.max(minX, Math.min(maxX, point[0])),
    Math.max(minY, Math.min(maxY, point[1])),
  ];
}

function clipPolygonToRect(points, minX, minY, maxX, maxY) {
  let out = (points ?? []).filter(validLocalPoint);
  out = clipPolygonToBoundary(out, (point) => point[0] >= minX, (a, b) => intersectSegmentAtX(a, b, minX));
  out = clipPolygonToBoundary(out, (point) => point[0] <= maxX, (a, b) => intersectSegmentAtX(a, b, maxX));
  out = clipPolygonToBoundary(out, (point) => point[1] >= minY, (a, b) => intersectSegmentAtY(a, b, minY));
  out = clipPolygonToBoundary(out, (point) => point[1] <= maxY, (a, b) => intersectSegmentAtY(a, b, maxY));
  return out.filter(validLocalPoint);
}

function clipPolygonToBoundary(points, inside, intersect) {
  if (points.length === 0) return [];
  const out = [];
  let previous = points[points.length - 1];
  let previousInside = inside(previous);
  for (const current of points) {
    const currentInside = inside(current);
    if (currentInside) {
      if (!previousInside) {
        const point = intersect(previous, current);
        if (validLocalPoint(point)) out.push(point);
      }
      out.push(current);
    } else if (previousInside) {
      const point = intersect(previous, current);
      if (validLocalPoint(point)) out.push(point);
    }
    previous = current;
    previousInside = currentInside;
  }
  return out;
}

function intersectSegmentAtX(a, b, x) {
  const dx = b[0] - a[0];
  if (Math.abs(dx) <= 1e-12) return [x, a[1]];
  const t = (x - a[0]) / dx;
  return [x, a[1] + (b[1] - a[1]) * t];
}

function intersectSegmentAtY(a, b, y) {
  const dy = b[1] - a[1];
  if (Math.abs(dy) <= 1e-12) return [a[0], y];
  const t = (y - a[1]) / dy;
  return [a[0] + (b[0] - a[0]) * t, y];
}

function polygonSamplePoint(points) {
  let crossTotal = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[previous];
    const b = points[index];
    const cross = a[0] * b[1] - b[0] * a[1];
    crossTotal += cross;
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
  }
  if (Math.abs(crossTotal) > 1e-12) {
    return [cx / (3 * crossTotal), cy / (3 * crossTotal)];
  }
  let totalX = 0;
  let totalY = 0;
  for (const point of points) {
    totalX += point[0];
    totalY += point[1];
  }
  return points.length ? [totalX / points.length, totalY / points.length] : null;
}

function screenPolygonPoints(points) {
  const out = [];
  for (let index = 0; index < (points?.length ?? 0); index += 2) {
    const point = [points[index] ?? 0, points[index + 1] ?? 0];
    if (validLocalPoint(point)) out.push(point);
  }
  return out;
}

function vec3Dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cachedSourceBounds(context, source) {
  const key = source.faceIndex;
  if (context.boundsBySourceFace.has(key)) return context.boundsBySourceFace.get(key);
  const bounds = faceTextureCoordinateBounds(source.points, source.texInfo);
  context.boundsBySourceFace.set(key, bounds);
  return bounds;
}

async function cachedWinQuakeSurface(context, source, bounds, data) {
  const key = source.faceIndex;
  if (context.softwareSurfaceBySourceFace.has(key)) {
    return context.softwareSurfaceBySourceFace.get(key);
  }
  const surface = deterministicAtlasNeedsSoftwareOracle()
    ? await buildWinQuakeSurface(source, bounds, data, context.softwareOracle)
    : buildVkQuakeWorldSurface(source, bounds, data);
  context.softwareSurfaceBySourceFace.set(key, surface);
  return surface;
}

function deterministicAtlasNeedsSoftwareOracle() {
  return QUAKE_DETERMINISTIC_ATLAS_LIGHT_SAMPLING !== "vkquake-world";
}

function deterministicAtlasNeedsNativeBatchRaster() {
  return QUAKE_DETERMINISTIC_ATLAS_LIGHT_SAMPLING === "vkquake-world";
}

async function buildWinQuakeSurface(source, bounds, data, softwareOracle) {
  if (!softwareOracle?.renderMip0) {
    throw new Error("softwareQuakeSurface oracle is required for deterministic world atlas generation.");
  }
  const texturemins = [
    Math.floor(bounds.minS / 16) * 16,
    Math.floor(bounds.minT / 16) * 16,
  ];
  const extents = [
    (Math.ceil(bounds.maxS / 16) - Math.floor(bounds.minS / 16)) * 16,
    (Math.ceil(bounds.maxT / 16) - Math.floor(bounds.minT / 16)) * 16,
  ];
  const sampleCount = ((extents[0] >> 4) + 1) * ((extents[1] >> 4) + 1);
  const cache = await softwareOracle.renderMip0({ data, extents, sampleCount, source, texturemins });
  return {
    colormap: data.colormap,
    paletteRgb: paletteBuffer(data.palette),
    texturemins,
    texturePixels: source.texture.pixels,
    textureHeight: source.texture.height,
    textureWidth: source.texture.width,
    vkLightGrid: buildVkQuakeLightGrid(source, bounds, data.lighting),
    ...cache,
  };
}

function buildVkQuakeWorldSurface(source, bounds, data) {
  return {
    paletteRgb: paletteBuffer(data.palette),
    texturePixels: source.texture.pixels,
    textureHeight: source.texture.height,
    textureWidth: source.texture.width,
    vkLightGrid: buildVkQuakeLightGrid(source, bounds, data.lighting),
  };
}

function createVkQuakeWorldPostprocessLut() {
  const lut = new Uint8Array(256);
  for (let channel = 0; channel < 256; channel++) {
    const normalized = Math.min(1, Math.max(0, (channel / 255) * VKQUAKE_WORLD_POSTPROCESS_CONTRAST));
    lut[channel] = Math.round(Math.pow(normalized, VKQUAKE_WORLD_POSTPROCESS_GAMMA) * 255);
  }
  return lut;
}

function writeVkQuakePostprocessedRgbAt(surface, s, t, rgba, offset) {
  if (QUAKE_DETERMINISTIC_ATLAS_LIGHT_SAMPLING === "vkquake-world" &&
    surface.texturePixels &&
    surface.paletteRgb) {
    writeVkQuakeWorldPassRgbAt(surface, s, t, rgba, offset);
    return;
  }
  if (QUAKE_DETERMINISTIC_ATLAS_LIGHT_SAMPLING === "texture-nearest-light-bilinear" &&
    surface.texturePixels &&
    surface.colormap &&
    surface.paletteRgb) {
    writeVkQuakePostprocessedNearestTextureBilinearLightAt(surface, s, t, rgba, offset);
    return;
  }
  const x = Math.max(0, Math.min(surface.cacheWidth - 1, Math.floor(s - surface.texturemins[0])));
  const y = Math.max(0, Math.min(surface.cacheHeight - 1, Math.floor(t - surface.texturemins[1])));
  const target = (y * surface.cacheWidth + x) * 4;
  const cacheData = surface.cacheData;
  rgba[offset] = VKQUAKE_WORLD_POSTPROCESS_LUT[cacheData[target] ?? 0];
  rgba[offset + 1] = VKQUAKE_WORLD_POSTPROCESS_LUT[cacheData[target + 1] ?? 0];
  rgba[offset + 2] = VKQUAKE_WORLD_POSTPROCESS_LUT[cacheData[target + 2] ?? 0];
  rgba[offset + 3] = 255;
}

function writeVkQuakeWorldPassRgbAt(surface, s, t, rgba, offset) {
  const texX = wrappedTextureIndex(s, surface.textureWidth);
  const texY = wrappedTextureIndex(t, surface.textureHeight);
  const paletteIndex = surface.texturePixels[texY * surface.textureWidth + texX] ?? 0;
  const paletteOffset = paletteIndex * 3;
  const light = paletteIndex >= 224
    ? 1
    : typeof surface.vkLightGrid?.constantLight === "number"
      ? surface.vkLightGrid.constantLight
      : vkQuakeWorldLightAt(surface, s, t);
  rgba[offset] = VKQUAKE_WORLD_POSTPROCESS_LUT[Math.min(255, Math.round((surface.paletteRgb[paletteOffset] ?? 0) * light))];
  rgba[offset + 1] = VKQUAKE_WORLD_POSTPROCESS_LUT[Math.min(255, Math.round((surface.paletteRgb[paletteOffset + 1] ?? 0) * light))];
  rgba[offset + 2] = VKQUAKE_WORLD_POSTPROCESS_LUT[Math.min(255, Math.round((surface.paletteRgb[paletteOffset + 2] ?? 0) * light))];
  rgba[offset + 3] = 255;
}

function wrappedTextureIndex(value, side) {
  const index = Math.floor(value);
  if (
    side > 0 &&
    side <= 0x40000000 &&
    (side & (side - 1)) === 0 &&
    index >= -0x80000000 &&
    index <= 0x7fffffff
  ) {
    return index & (side - 1);
  }
  return positiveModulo(index, side);
}

function vkQuakeWorldLightAt(surface, s, t) {
  const grid = surface.vkLightGrid;
  if (!grid) return 1;
  if (typeof grid.constantLight === "number") return grid.constantLight;
  let sampleS = s / QUAKE_LIGHT_SAMPLE_SIZE - grid.minS;
  let sampleT = t / QUAKE_LIGHT_SAMPLE_SIZE - grid.minT;
  sampleS = (Math.floor(sampleS * VKQUAKE_LIGHTMAP_QUANTIZATION) + 0.5) / VKQUAKE_LIGHTMAP_QUANTIZATION;
  sampleT = (Math.floor(sampleT * VKQUAKE_LIGHTMAP_QUANTIZATION) + 0.5) / VKQUAKE_LIGHTMAP_QUANTIZATION;
  const x0 = Math.max(0, Math.min(grid.width - 1, Math.floor(sampleS)));
  const y0 = Math.max(0, Math.min(grid.height - 1, Math.floor(sampleT)));
  const x1 = Math.min(grid.width - 1, x0 + 1);
  const y1 = Math.min(grid.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, sampleS - x0));
  const fy = Math.max(0, Math.min(1, sampleT - y0));
  const top = lerp(vkQuakeLightSampleByte(grid, x0, y0), vkQuakeLightSampleByte(grid, x1, y0), fx);
  const bottom = lerp(vkQuakeLightSampleByte(grid, x0, y1), vkQuakeLightSampleByte(grid, x1, y1), fx);
  return (lerp(top, bottom, fy) / 255) * VKQUAKE_WORLD_LIGHTMAP_MULTIPLIER;
}

function vkQuakeLightSampleByte(grid, x, y) {
  const sampleIndex = y * grid.width + x;
  let value = 0;
  for (let styleIndex = 0; styleIndex < grid.styles.length; styleIndex++) {
    const offset = grid.lightOffset + styleIndex * grid.sampleCount + sampleIndex;
    const style = grid.styles[styleIndex] ?? 0;
    value += (grid.lighting[offset] ?? 0) * winQuakeLightstyleValue(style);
  }
  return Math.max(0, Math.min(255, value >> 8));
}

function writeVkQuakePostprocessedNearestTextureBilinearLightAt(surface, s, t, rgba, offset) {
  const texX = wrappedTextureIndex(s, surface.textureWidth);
  const texY = wrappedTextureIndex(t, surface.textureHeight);
  const pix = surface.texturePixels[texY * surface.textureWidth + texX] ?? 0;
  const lightRow = Math.max(0, Math.min((1 << WINQUAKE_VID_CBITS) - 1, Math.round(
    bilinearSoftwareSurfaceLightRow(surface, s - surface.texturemins[0], t - surface.texturemins[1]),
  )));
  const paletteIndex = surface.colormap[lightRow * 256 + pix] ?? 0;
  const paletteOffset = paletteIndex * 3;
  rgba[offset] = VKQUAKE_WORLD_POSTPROCESS_LUT[surface.paletteRgb[paletteOffset] ?? 0];
  rgba[offset + 1] = VKQUAKE_WORLD_POSTPROCESS_LUT[surface.paletteRgb[paletteOffset + 1] ?? 0];
  rgba[offset + 2] = VKQUAKE_WORLD_POSTPROCESS_LUT[surface.paletteRgb[paletteOffset + 2] ?? 0];
  rgba[offset + 3] = 255;
}

function bilinearSoftwareSurfaceLightRow(surface, x, y) {
  const x0 = Math.max(0, Math.min(surface.cacheWidth - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(surface.cacheHeight - 1, Math.floor(y)));
  const x1 = Math.max(0, Math.min(surface.cacheWidth - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(surface.cacheHeight - 1, y0 + 1));
  const fx = Math.max(0, Math.min(1, x - Math.floor(x)));
  const fy = Math.max(0, Math.min(1, y - Math.floor(y)));
  const a = softwareSurfaceLightRowAt(surface, x0, y0);
  const b = softwareSurfaceLightRowAt(surface, x1, y0);
  const c = softwareSurfaceLightRowAt(surface, x0, y1);
  const d = softwareSurfaceLightRowAt(surface, x1, y1);
  return a * (1 - fx) * (1 - fy) +
    b * fx * (1 - fy) +
    c * (1 - fx) * fy +
    d * fx * fy;
}

function softwareSurfaceLightRowAt(surface, x, y) {
  return surface.cacheData[(y * surface.cacheWidth + x) * 4 + 3] ?? 0;
}

function positiveModulo(value, divisor) {
  const remainder = value % divisor;
  return remainder < 0 ? remainder + divisor : remainder;
}

function buildVkQuakeLightGrid(source, bounds, lighting) {
  if (!lighting.length) return { constantLight: 1 };
  if (source.face.lightOffset < 0) return { constantLight: 0 };
  const styles = activeLightStyles(source.face.styles);
  if (!styles.length) return { constantLight: 0 };
  const minS = Math.floor(bounds.minS / QUAKE_LIGHT_SAMPLE_SIZE);
  const minT = Math.floor(bounds.minT / QUAKE_LIGHT_SAMPLE_SIZE);
  const width = Math.max(1, Math.ceil(bounds.maxS / QUAKE_LIGHT_SAMPLE_SIZE) - minS + 1);
  const height = Math.max(1, Math.ceil(bounds.maxT / QUAKE_LIGHT_SAMPLE_SIZE) - minT + 1);
  const sampleCount = width * height;
  const byteCount = sampleCount * styles.length;
  if (!Number.isFinite(byteCount) || byteCount <= 0 || source.face.lightOffset + byteCount > lighting.length) {
    return null;
  }
  return {
    height,
    lightOffset: source.face.lightOffset,
    lighting,
    minS,
    minT,
    sampleCount,
    styles,
    width,
  };
}

function activeLightStyles(styles) {
  return styles.filter((style) => style !== 255);
}

async function createSoftwareQuakeSurfaceOracle() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "cssquake-software-oracle-"));
  const sourcePath = path.join(projectRoot, "src/prepare/native/softwareQuakeSurface.c");
  const binaryPath = path.join(tmp, "softwareQuakeSurface");
  try {
    const compiler = await compileSoftwareQuakeSurface(sourcePath, binaryPath);
    if (!compiler) {
      await rm(tmp, { recursive: true, force: true });
      throw new Error(
        `No C compiler found for softwareQuakeSurface. ` +
          `Tried ${softwareQuakeCompilerCandidates().join(", ")}.`,
      );
    }
  } catch (error) {
    await rm(tmp, { recursive: true, force: true });
    throw error;
  }
  const child = spawn(binaryPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  return createSoftwareQuakeSurfaceOracleClient(child, tmp);
}

async function compileSoftwareQuakeSurface(sourcePath, binaryPath) {
  const args = ["-O2", "-std=c99", sourcePath, "-o", binaryPath];
  for (const compiler of softwareQuakeCompilerCandidates()) {
    try {
      await execFile(compiler, args);
      return compiler;
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw new Error(`Failed to compile softwareQuakeSurface with ${compiler}: ${formatExecError(error)}`, {
        cause: error,
      });
    }
  }
  return null;
}

function softwareQuakeCompilerCandidates() {
  const candidates = [process.env.QUAKE_SOFTWARE_CC, process.env.CC, "cc", "gcc", "clang"];
  const seen = new Set();
  return candidates.flatMap((value) => {
    const compiler = value?.trim();
    if (!compiler || seen.has(compiler)) return [];
    seen.add(compiler);
    return [compiler];
  });
}

function formatExecError(error) {
  const details = [
    error?.message,
    error?.stderr?.toString().trim(),
    error?.stdout?.toString().trim(),
  ].filter(Boolean);
  return details.join("\n").trim() || String(error);
}

function createSoftwareQuakeSurfaceOracleClient(child, tmp) {
  let buffer = Buffer.alloc(0);
  let closed = false;
  let last = Promise.resolve();
  let stderr = "";
  let waiter = null;

  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    drain();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.on("exit", (code, signal) => {
    closed = true;
    if (waiter) {
      waiter.reject(new Error(`softwareQuakeSurface exited (${code ?? signal}). ${stderr}`.trim()));
      waiter = null;
    }
  });

  function renderMip0(input) {
    const request = buildSoftwareSurfaceRequest(input);
    last = last.then(() => exchange(request));
    return last;
  }

  async function exchange(request) {
    if (closed) throw new Error(`softwareQuakeSurface is closed. ${stderr}`.trim());
    const response = readResponse();
    await new Promise((resolve, reject) => {
      child.stdin.write(request, (error) => error ? reject(error) : resolve());
    });
    return response;
  }

  function readResponse() {
    if (waiter) throw new Error("softwareQuakeSurface protocol already has a pending response.");
    return new Promise((resolve, reject) => {
      waiter = { reject, resolve };
      drain();
    });
  }

  function drain() {
    if (!waiter || buffer.length < SOFTWARE_SURFACE_RESPONSE_HEADER_BYTES) return;
    const magic = buffer.readUInt32LE(0);
    const width = buffer.readUInt32LE(4);
    const height = buffer.readUInt32LE(8);
    const payloadLen = buffer.readUInt32LE(12);
    if (magic !== SOFTWARE_SURFACE_RESPONSE_MAGIC) {
      const active = waiter;
      waiter = null;
      active.reject(new Error(`Invalid softwareQuakeSurface response magic: ${magic.toString(16)}.`));
      return;
    }
    const total = SOFTWARE_SURFACE_RESPONSE_HEADER_BYTES + payloadLen;
    if (buffer.length < total) return;
    const payload = Buffer.from(buffer.subarray(SOFTWARE_SURFACE_RESPONSE_HEADER_BYTES, total));
    buffer = buffer.subarray(total);
    const active = waiter;
    waiter = null;
    active.resolve({ cacheData: payload, cacheHeight: height, cacheWidth: width });
  }

  async function close() {
    if (!closed) {
      child.stdin.end();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await rm(tmp, { recursive: true, force: true });
  }

  return { close, renderMip0 };
}

async function createVkQuakeNativeBatchRasterAddon() {
  if (!vkQuakeNativeBatchRasterAddonClientPromise) {
    vkQuakeNativeBatchRasterAddonClientPromise = loadVkQuakeNativeBatchRasterAddonClient();
  }
  const client = await vkQuakeNativeBatchRasterAddonClientPromise;
  vkQuakeNativeBatchRasterAddonClientRefCount++;
  let closed = false;
  return {
    renderVkQuakeWorldFullCoverageBatch: client.renderVkQuakeWorldFullCoverageBatch,
    async close() {
      if (closed) return;
      closed = true;
      vkQuakeNativeBatchRasterAddonClientRefCount = Math.max(0, vkQuakeNativeBatchRasterAddonClientRefCount - 1);
      if (vkQuakeNativeBatchRasterAddonClientRefCount === 0) await client.close();
    },
  };
}

async function loadVkQuakeNativeBatchRasterAddonClient() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "cssquake-native-batch-raster-"));
  const sourcePath = path.join(projectRoot, "src/prepare/native/vkQuakeNativeBatchRasterAddon.c");
  const binaryPath = path.join(tmp, "vkQuakeNativeBatchRasterAddon.node");
  try {
    const compiler = await compileVkQuakeNativeBatchRasterAddon(sourcePath, binaryPath);
    if (!compiler) {
      await rm(tmp, { recursive: true, force: true });
      throw new Error(
        `No C compiler found for vkQuakeNativeBatchRasterAddon. ` +
        `Tried ${softwareQuakeCompilerCandidates().join(", ")}.`,
      );
    }
    const addon = require(binaryPath);
    if (typeof addon?.renderVkQuakeWorldFullCoverageBatch !== "function") {
      throw new Error("vkQuakeNativeBatchRasterAddon did not export renderVkQuakeWorldFullCoverageBatch.");
    }
    return createVkQuakeNativeBatchRasterAddonClient(addon, tmp);
  } catch (error) {
    await rm(tmp, { recursive: true, force: true });
    throw error;
  }
}

async function compileVkQuakeNativeBatchRasterAddon(sourcePath, binaryPath) {
  const includeDir = nodeApiIncludeDir();
  const args = [
    "-O3",
    "-std=c99",
    "-ffp-contract=off",
    `-DNAPI_VERSION=${process.versions.napi ?? 9}`,
    "-DNODE_GYP_MODULE_NAME=vk_quake_native_batch_raster_addon",
    "-I",
    includeDir,
    ...(process.platform === "darwin"
      ? ["-bundle", "-undefined", "dynamic_lookup"]
      : ["-shared", "-fPIC"]),
    sourcePath,
    "-o",
    binaryPath,
  ];
  for (const compiler of softwareQuakeCompilerCandidates()) {
    try {
      await execFile(compiler, args);
      return compiler;
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw new Error(`Failed to compile vkQuakeNativeBatchRasterAddon with ${compiler}: ${formatExecError(error)}`, {
        cause: error,
      });
    }
  }
  return null;
}

function nodeApiIncludeDir() {
  return path.resolve(path.dirname(process.execPath), "../include/node");
}

function createVkQuakeNativeBatchRasterAddonClient(addon, tmp) {
  function renderVkQuakeWorldFullCoverageBatch(jobs, timing = null) {
    if (!jobs?.length) return true;
    const batch = withDeterministicAtlasTimingSync(timing, "native.batch.pack", () =>
      buildVkQuakeNativeRasterBatch(jobs));
    const ok = withDeterministicAtlasTimingSync(timing, "native.batch.call", () =>
      addon.renderVkQuakeWorldFullCoverageBatch(
        batch.jobDoubles,
        batch.jobMeta,
        batch.textures,
        batch.lightings,
        batch.palette,
        VKQUAKE_WORLD_POSTPROCESS_LUT,
        batch.outputs,
      ));
    if (!ok) {
      throw new Error(`vkQuakeNativeBatchRasterAddon failed to render ${jobs.length} raster job(s).`);
    }
    return true;
  }

  async function close() {
    await rm(tmp, { recursive: true, force: true });
  }

  return { close, renderVkQuakeWorldFullCoverageBatch };
}

function createVkQuakeNativeRasterJob({ height, matrix, output, pivot, surface, texInfo, width }) {
  if (!width || !height || !matrix || !pivot || !surface?.texturePixels || !surface.paletteRgb || !texInfo) return null;
  const textureWidth = surface.textureWidth | 0;
  const textureHeight = surface.textureHeight | 0;
  if (textureWidth <= 0 || textureHeight <= 0 || surface.texturePixels.length < textureWidth * textureHeight) return null;
  const grid = surface.vkLightGrid;
  const constantLight = !grid || typeof grid.constantLight === "number"
    ? typeof grid?.constantLight === "number" ? grid.constantLight : 1
    : Number.NaN;
  if (Number.isNaN(constantLight)) {
    if (!grid?.lighting || grid.lightOffset < 0 || !grid.width || !grid.height || !grid.sampleCount) return null;
  }
  return {
    constantLight,
    height,
    lighting: Number.isNaN(constantLight) ? grid.lighting : null,
    lightGrid: Number.isNaN(constantLight) ? grid : null,
    matrix,
    output,
    paletteRgb: surface.paletteRgb,
    pivot,
    surface,
    texInfo,
    textureHeight,
    texturePixels: surface.texturePixels,
    textureWidth,
    width,
  };
}

function buildVkQuakeNativeRasterBatch(jobs) {
  const jobDoubles = new Float64Array(jobs.length * VKQUAKE_NATIVE_RASTER_DOUBLE_COUNT);
  const jobMeta = new Int32Array(jobs.length * VKQUAKE_NATIVE_RASTER_JOB_META_COUNT);
  const textures = [];
  const lightings = [];
  const outputs = new Array(jobs.length);
  const textureIndexByPixels = new Map();
  const lightingIndexByBuffer = new Map();
  const palette = jobs[0]?.paletteRgb ?? Buffer.alloc(256 * 3);
  for (let jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
    const job = jobs[jobIndex];
    const textureIndex = internNativeRasterBuffer(textureIndexByPixels, textures, job.texturePixels);
    const lightGrid = job.lightGrid;
    const lightingIndex = lightGrid
      ? internNativeRasterBuffer(lightingIndexByBuffer, lightings, lightGrid.lighting)
      : -1;
    fillVkQuakeNativeRasterDoubles(
      jobDoubles,
      jobIndex * VKQUAKE_NATIVE_RASTER_DOUBLE_COUNT,
      job,
    );
    fillVkQuakeNativeRasterMeta(
      jobMeta,
      jobIndex * VKQUAKE_NATIVE_RASTER_JOB_META_COUNT,
      job,
      textureIndex,
      lightingIndex,
    );
    outputs[jobIndex] = job.output;
  }
  return { jobDoubles, jobMeta, lightings, outputs, palette, textures };
}

function internNativeRasterBuffer(indexByBuffer, buffers, buffer) {
  const existing = indexByBuffer.get(buffer);
  if (existing !== undefined) return existing;
  const index = buffers.length;
  buffers.push(buffer);
  indexByBuffer.set(buffer, index);
  return index;
}

function fillVkQuakeNativeRasterDoubles(target, offset, job) {
  target[offset++] = BASE_TILE;
  target[offset++] = QUAKE_UNIT_SCALE;
  target[offset++] = job.surface.textureCoordScaleS ?? 1;
  target[offset++] = job.surface.textureCoordScaleT ?? 1;
  target[offset++] = job.constantLight;
  target[offset++] = job.pivot.x;
  target[offset++] = job.pivot.y;
  target[offset++] = job.pivot.z;
  for (let index = 0; index < 16; index++) target[offset++] = job.matrix[index] ?? 0;
  for (let index = 0; index < 4; index++) target[offset++] = job.texInfo.s[index] ?? 0;
  for (let index = 0; index < 4; index++) target[offset++] = job.texInfo.t[index] ?? 0;
}

function fillVkQuakeNativeRasterMeta(target, offset, job, textureIndex, lightingIndex) {
  const grid = job.lightGrid;
  const styles = grid?.styles ?? [];
  target[offset++] = job.width;
  target[offset++] = job.height;
  target[offset++] = textureIndex;
  target[offset++] = job.textureWidth;
  target[offset++] = job.textureHeight;
  target[offset++] = lightingIndex;
  target[offset++] = grid?.lightOffset ?? -1;
  target[offset++] = grid?.width ?? 0;
  target[offset++] = grid?.height ?? 0;
  target[offset++] = grid?.sampleCount ?? 0;
  target[offset++] = grid?.minS ?? 0;
  target[offset++] = grid?.minT ?? 0;
  target[offset++] = styles.length;
  for (let index = 0; index < 4; index++) {
    target[offset++] = index < styles.length ? winQuakeLightstyleValue(styles[index] ?? 0) : 0;
  }
}

function flushVkQuakeNativeRasterJobs(context) {
  const jobs = context.nativeRasterJobs;
  if (!jobs?.length) return;
  if (context.timing) {
    incrementDeterministicAtlasTimingCount(context.timing, "native.jobs", jobs.length);
    incrementDeterministicAtlasTimingCount(
      context.timing,
      "native.pixels",
      jobs.reduce((total, job) => total + job.width * job.height, 0),
    );
  }
  context.nativeRasterAddon.renderVkQuakeWorldFullCoverageBatch(jobs, context.timing);
  jobs.length = 0;
}

function buildSoftwareSurfaceRequest({ data, extents, sampleCount, source, texturemins }) {
  const styleCount = source.face.lightOffset >= 0 ? softwareSurfaceStyleCount(source.face.styles) : 0;
  const texture = source.texture.pixels;
  const textureLen = source.texture.width * source.texture.height;
  const lightmapLen = styleCount * sampleCount;
  const colormapLen = 256 * (1 << WINQUAKE_VID_CBITS);
  const paletteLen = 256 * 3;
  const total = SOFTWARE_SURFACE_HEADER_BYTES + textureLen + lightmapLen + colormapLen + paletteLen;
  const request = Buffer.alloc(total);
  let offset = 0;

  request.writeUInt32LE(SOFTWARE_SURFACE_REQUEST_MAGIC, offset); offset += 4;
  request.writeUInt32LE(source.texture.width, offset); offset += 4;
  request.writeUInt32LE(source.texture.height, offset); offset += 4;
  request.writeUInt32LE(extents[0], offset); offset += 4;
  request.writeUInt32LE(extents[1], offset); offset += 4;
  request.writeInt32LE(texturemins[0], offset); offset += 4;
  request.writeInt32LE(texturemins[1], offset); offset += 4;
  request.writeUInt32LE(styleCount, offset); offset += 4;
  request.writeUInt32LE(sampleCount, offset); offset += 4;
  request.writeUInt32LE(textureLen, offset); offset += 4;
  request.writeUInt32LE(lightmapLen, offset); offset += 4;
  request.writeUInt32LE(colormapLen, offset); offset += 4;
  request.writeUInt32LE(paletteLen, offset); offset += 4;
  for (let index = 0; index < 4; index++) {
    const style = source.face.styles[index] ?? 255;
    const scale = index < styleCount ? winQuakeLightstyleValue(style) : 0;
    request.writeUInt32LE(scale, offset);
    offset += 4;
  }

  Buffer.from(texture.buffer, texture.byteOffset, textureLen).copy(request, offset);
  offset += textureLen;
  for (let styleIndex = 0; styleIndex < styleCount; styleIndex++) {
    const sourceOffset = source.face.lightOffset + styleIndex * sampleCount;
    for (let index = 0; index < sampleCount; index++) request[offset + index] = data.lighting[sourceOffset + index] ?? 0;
    offset += sampleCount;
  }
  Buffer.from(data.colormap.buffer, data.colormap.byteOffset, colormapLen).copy(request, offset);
  offset += colormapLen;
  paletteBuffer(data.palette).copy(request, offset);
  return request;
}

function softwareSurfaceStyleCount(styles) {
  let count = 0;
  for (const style of styles) {
    if (style === 255) break;
    count++;
  }
  return count;
}

function winQuakeLightstyleValue(style) {
  const staticValue = WINQUAKE_LIGHTSTYLE_VALUES.get(style);
  if (staticValue !== undefined) return staticValue;
  const pattern = WINQUAKE_LIGHTSTYLE_PATTERNS.get(style);
  if (!pattern) return WINQUAKE_DEFAULT_STYLE_VALUE;
  let value = 0;
  for (const char of pattern) value = Math.max(value, Math.max(0, char.charCodeAt(0) - 97) * 22);
  return value || WINQUAKE_DEFAULT_STYLE_VALUE;
}

function paletteBuffer(palette) {
  const out = Buffer.alloc(256 * 3);
  for (let index = 0; index < 256; index++) {
    const [r, g, b] = palette[index] ?? [0, 0, 0];
    out[index * 3] = r;
    out[index * 3 + 1] = g;
    out[index * 3 + 2] = b;
  }
  return out;
}

function packDeterministicAtlasTiles(tiles) {
  const pages = [];
  let page = null;
  const newPage = () => {
    const next = {
      height: QUAKE_DETERMINISTIC_ATLAS_PAGE_PADDING,
      tiles: [],
      width: QUAKE_DETERMINISTIC_ATLAS_PAGE_PADDING,
      cursorX: QUAKE_DETERMINISTIC_ATLAS_PAGE_PADDING,
      cursorY: QUAKE_DETERMINISTIC_ATLAS_PAGE_PADDING,
      rowHeight: 0,
    };
    pages.push(next);
    return next;
  };

  for (const tile of [...tiles].sort((a, b) => b.height - a.height || b.width - a.width)) {
    if (!page) page = newPage();
    if (tile.width + QUAKE_DETERMINISTIC_ATLAS_PAGE_PADDING * 2 > QUAKE_DETERMINISTIC_ATLAS_PAGE_SIZE) {
      tile.skip = "tile-too-wide";
      continue;
    }
    if (page.cursorX + tile.width + QUAKE_DETERMINISTIC_ATLAS_PAGE_PADDING > QUAKE_DETERMINISTIC_ATLAS_PAGE_SIZE) {
      page.cursorX = QUAKE_DETERMINISTIC_ATLAS_PAGE_PADDING;
      page.cursorY += page.rowHeight + QUAKE_DETERMINISTIC_ATLAS_PAGE_PADDING;
      page.rowHeight = 0;
    }
    if (page.cursorY + tile.height + QUAKE_DETERMINISTIC_ATLAS_PAGE_PADDING > QUAKE_DETERMINISTIC_ATLAS_PAGE_SIZE) {
      page = newPage();
    }
    tile.page = page;
    tile.pageIndex = pages.length - 1;
    tile.x = page.cursorX;
    tile.y = page.cursorY;
    page.tiles.push(tile);
    page.cursorX += tile.width + QUAKE_DETERMINISTIC_ATLAS_PAGE_PADDING;
    page.rowHeight = Math.max(page.rowHeight, tile.height);
    page.width = Math.max(page.width, tile.x + tile.width + QUAKE_DETERMINISTIC_ATLAS_PAGE_PADDING);
    page.height = Math.max(page.height, tile.y + tile.height + QUAKE_DETERMINISTIC_ATLAS_PAGE_PADDING);
  }

  for (const out of pages) {
    out.width = Math.max(1, out.width);
    out.height = Math.max(1, out.height);
  }
  return pages.filter((item) => item.tiles.length);
}

async function renderDeterministicAtlasPage(page, timing = null) {
  const pageRgba = withDeterministicAtlasTimingSync(timing, "png.compose.atlasPage", () => {
    const rgba = Buffer.alloc(page.width * page.height * 4);
    for (const tile of page.tiles) {
      const sourceStride = tile.width * 4;
      const targetStride = page.width * 4;
      for (let y = 0; y < tile.height; y++) {
        const sourceStart = y * sourceStride;
        const targetStart = ((tile.y + y) * page.width + tile.x) * 4;
        tile.rgba.copy(rgba, targetStart, sourceStart, sourceStart + sourceStride);
      }
    }
    return rgba;
  });
  return withDeterministicAtlasTiming(timing, "png.encode.atlasPage", () =>
    sharp(pageRgba, { raw: { width: page.width, height: page.height, channels: 4 } })
      .png()
      .toBuffer());
}

function writeDeterministicLeafImage(tile, outputPath, timing = null) {
  return writeDeterministicRgbaImage(
    tile.width,
    tile.height,
    tile.rgba,
    outputPath,
    timing,
    "png.encodeWrite.leafImage",
  );
}

function renderDeterministicRgbaImage(width, height, rgba, timing = null, label = "png.encode.leafImage") {
  return withDeterministicAtlasTiming(timing, label, () =>
    sharp(rgba, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer());
}

async function writeDeterministicRgbaImage(width, height, rgba, outputPath, timing = null, label = "png.encodeWrite.leafImage") {
  const info = await withDeterministicAtlasTiming(timing, label, () =>
    sharp(rgba, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(outputPath));
  if (Number.isFinite(info?.size)) return info.size;
  const file = await stat(outputPath);
  return file.size;
}

function deterministicAtlasPageFilename(index) {
  return `a${index}.png`;
}

function deterministicLeafImageFilename(leafIndex, kind = "") {
  const suffix = kind ? deterministicRuntimeTextureImageSuffix(kind) : "";
  return `l${leafIndex}${suffix}.png`;
}

function deterministicRuntimeTextureImageSuffix(kind) {
  switch (String(kind).trim().toLowerCase()) {
    case "base":
      return "b";
    case "pressed":
      return "p";
    case "sprite":
      return "s";
    default: {
      const normalized = String(kind).trim().toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16);
      return normalized ? `-${normalized}` : "-x";
    }
  }
}

async function removeStaleDeterministicImageFiles(outputDir) {
  let entries;
  try {
    entries = await readdir(outputDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await Promise.all(entries
    .filter((entry) => entry.isFile() && deterministicLeafImageFileIsGenerated(entry.name))
    .map((entry) => rm(path.join(outputDir, entry.name), { force: true })));
}

function deterministicLeafImageFileIsGenerated(filename) {
  return /^det-leaf-\d+(?:-[a-z0-9_-]+)?\.png$/i.test(filename) ||
    /^l\d+(?:[bps]|-[a-z0-9]+)?\.png$/i.test(filename) ||
    /^(?:o|ot)\d+\.png$/i.test(filename);
}

function normalizeDeterministicImagePolicy(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "smart" || normalized === "static" || normalized === "hybrid-static") {
    return "smart";
  }
  if (normalized === "hybrid" || normalized === "leaf" || normalized === "individual") {
    return normalized === "individual" ? "leaf" : normalized;
  }
  return "atlas";
}

function deterministicTileImagePolicyBucket(tile, policy) {
  if (policy === "leaf") return "leaf-forced";
  if (policy === "atlas") return "atlas-forced";
  const area = tile.width * tile.height;
  const maxSide = Math.max(tile.width, tile.height);
  const minSide = Math.max(1, Math.min(tile.width, tile.height));
  const aspect = maxSide / minSide;
  if (policy === "hybrid") {
    return area >= 8192 || maxSide >= 160 || aspect >= 4
      ? "leaf-large-or-skinny"
      : "atlas-hybrid-default";
  }
  if (policy === "smart") return deterministicSmartImagePolicyBucket(tile, { area, aspect, maxSide });
  return "atlas-forced";
}

function deterministicSmartImagePolicyBucket(tile, metrics) {
  const textureName = String(tile.sourceTexture ?? "").toLowerCase();
  if (tile.runtimeTextureImages) return "atlas-runtime-texture";
  if (textureName.startsWith("sky") || textureName.startsWith("*") || textureName.startsWith("+")) {
    return "atlas-special-texture";
  }
  if (metrics.area < 512 && metrics.maxSide < 64 && metrics.aspect < 4) {
    return "atlas-tiny-static";
  }
  return "leaf-static";
}

function deterministicImagePolicyBucketUsesLeafImage(bucket) {
  return bucket.startsWith("leaf-");
}

function rewriteRenderBundleMeshHtmlForDeterministicAtlas(html, tiles, pageAssetUrls, firstNewAssetIndex) {
  const tileByLeafIndex = new Map(tiles.map((tile) => [tile.leafIndex, tile]));
  let leafIndex = 0;
  const htmlWithLeaves = html.replace(/<s\b([^>]*)>/g, (match, rawAttrs) => {
    const currentIndex = leafIndex++;
    const tile = tileByLeafIndex.get(currentIndex);
    if (!tile) return match;
    const attrs = attributes(rawAttrs);
    const style = attrs.style ?? "";
    const transformedStyle = compensateAtlasLeafTransform(
      style,
      tile.transformCompensationX,
      tile.transformCompensationY,
      tile.matrix,
    );
    const cleanStyle = removeStyleDeclarations(transformedStyle, [
      "--qi",
      "background",
      "background-attachment",
      "background-clip",
      "background-color",
      "background-image",
      "background-origin",
      "background-position",
      "background-position-x",
      "background-position-y",
      "background-repeat",
      "background-size",
    ]);
    const backgroundStyle = tile.leafImageUrl
      ? replaceStyleDeclaration(
          cleanStyle,
          "background",
          `url(&quot;${tile.leafImageUrl}&quot;)`,
        )
      : replaceStyleDeclaration(
          cleanStyle,
          "background",
          deterministicAtlasTileBackground(tile, firstNewAssetIndex),
        );
    const nextStyle = orderStyleDeclarations(
      replaceStyleDeclaration(
        replaceStyleDeclaration(
          backgroundStyle,
          "width",
          `${tile.width}px`,
        ),
        "height",
        `${tile.height}px`,
      ),
      ["transform", "width", "height", "background"],
    );
    let next = match.replace(`style="${style}"`, `style="${nextStyle}"`);
    if (tile.runtimeTextureUrls?.base) {
      next = replaceTagAttribute(next, "data-base", tile.runtimeTextureUrls.base);
    }
    if (tile.runtimeTextureUrls?.pressed) {
      next = replaceTagAttribute(next, "data-pressed", tile.runtimeTextureUrls.pressed);
    }
    if (tile.runtimeTextureUrls?.sprite) {
      next = replaceTagAttribute(next, "data-sprite", tile.runtimeTextureUrls.sprite);
    }
    return next;
  });
  return appendRenderBundleBackgroundVars(htmlWithLeaves, pageAssetUrls, firstNewAssetIndex);
}

function replaceTagAttribute(tag, name, value) {
  const escaped = String(value).replace(/"/g, "&quot;");
  const pattern = new RegExp(`\\s${name}="[^"]*"`);
  if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${escaped}"`);
  return tag.replace(/>$/, ` ${name}="${escaped}">`);
}

function deterministicAtlasTileBackground(tile, firstNewAssetIndex) {
  const pageAssetIndex = firstNewAssetIndex + tile.pageIndex;
  return `var(--bg${pageAssetIndex}) -${tile.x}px -${tile.y}px / ${tile.page.width}px ${tile.page.height}px no-repeat`;
}

function appendRenderBundleBackgroundVars(html, pageAssetUrls, firstNewAssetIndex) {
  const root = html.match(/^<div\b([^>]*)>/);
  if (!root) return html;
  const attrs = attributes(root[1]);
  const style = attrs.style ?? "";
  const additions = pageAssetUrls.map((url, index) =>
    `--bg${firstNewAssetIndex + index}:url(&quot;${url}&quot;)`
  );
  const nextStyle = [...additions, ...style.split(";").filter(Boolean)].join(";");
  if (style) {
    return html.replace(`style="${style}"`, `style="${nextStyle}"`);
  }
  return html.replace(/^<div\b/, `<div style="${nextStyle}"`);
}

async function compactRenderBundleBackgroundAssets(renderBundle, outputDir, publicPath) {
  const assetUrls = renderBundle.assetUrls ?? [];
  if (!assetUrls.length || !renderBundle.meshHtml) return;
  const usedIndices = renderBundleBackgroundVarUseIndices(renderBundle.meshHtml);
  if (!usedIndices.size) return;
  const orderedUsedIndices = [...usedIndices].sort((a, b) => a - b);
  const identity = orderedUsedIndices.length === assetUrls.length &&
    orderedUsedIndices.every((index, nextIndex) => index === nextIndex);
  if (identity) return;

  const indexMap = new Map(orderedUsedIndices.map((index, nextIndex) => [index, nextIndex]));
  const nextAssetUrls = orderedUsedIndices.map((index) => assetUrls[index]).filter(Boolean);
  const removedAssetUrls = assetUrls.filter((_url, index) => !usedIndices.has(index));
  renderBundle.meshHtml = setRenderBundleBackgroundVars(
    renderBundle.meshHtml.replace(/var\(--bg(\d+)\)/g, (match, indexText) => {
      const nextIndex = indexMap.get(Number(indexText));
      return nextIndex === undefined ? match : `var(--bg${nextIndex})`;
    }),
    nextAssetUrls,
  );
  renderBundle.assetUrls = nextAssetUrls;
  await removeRenderBundleAssetFiles(removedAssetUrls, outputDir, publicPath);
}

function renderBundleBackgroundVarUseIndices(html) {
  const indices = new Set();
  for (const match of html.matchAll(/var\(--bg(\d+)\)/g)) {
    const index = Number(match[1]);
    if (Number.isInteger(index) && index >= 0) indices.add(index);
  }
  return indices;
}

function setRenderBundleBackgroundVars(html, assetUrls) {
  const root = html.match(/^<div\b([^>]*)>/);
  if (!root) return html;
  const attrs = attributes(root[1]);
  const style = attrs.style ?? "";
  const declarations = removeRenderBundleBackgroundVarDeclarations(style);
  const additions = assetUrls.map((url, index) => `--bg${index}:url(&quot;${url}&quot;)`);
  const nextStyle = [...additions, ...(declarations ? [declarations] : [])].join(";");
  if (style) return html.replace(`style="${style}"`, `style="${nextStyle}"`);
  return html.replace(/^<div\b/, `<div style="${nextStyle}"`);
}

function removeRenderBundleBackgroundVarDeclarations(style) {
  return String(style ?? "")
    .replace(/(^|;)\s*--bg\d+\s*:\s*url\((?:&quot;[^)]*&quot;|[^)]*)\)/g, "$1")
    .replace(/;{2,}/g, ";")
    .replace(/^;|;$/g, "");
}

async function removeRenderBundleAssetFiles(assetUrls, outputDir, publicPath) {
  await Promise.all(assetUrls.map(async (url) => {
    const filePath = renderBundleAssetOutputPath(url, outputDir, publicPath);
    if (!filePath) return;
    await rm(filePath, { force: true });
    const extension = path.extname(filePath);
    if (extension) {
      const basename = filePath.slice(0, -extension.length);
      await rm(`${basename}-outline${extension}`, { force: true });
    }
  }));
}

function renderBundleAssetOutputPath(url, outputDir, publicPath) {
  if (typeof url !== "string" || !url.startsWith(`${publicPath}/`)) return null;
  const relative = url.slice(publicPath.length + 1);
  if (!relative || relative.includes("/") || relative.includes("\\")) return null;
  return path.join(outputDir, relative);
}

function replaceStyleDeclaration(style, name, value) {
  const declarations = style.split(";").map((part) => part.trim()).filter(Boolean);
  let replaced = false;
  const next = declarations.map((part) => {
    const separator = part.indexOf(":");
    if (separator <= 0 || part.slice(0, separator).trim() !== name) return compactStyleDeclaration(part);
    replaced = true;
    return `${name}:${value}`;
  });
  if (!replaced) next.push(`${name}:${value}`);
  return next.join(";");
}

function removeStyleDeclarations(style, names) {
  const nameSet = new Set(names);
  return style
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      const separator = part.indexOf(":");
      if (separator <= 0) return Boolean(part);
      return !nameSet.has(part.slice(0, separator).trim());
    })
    .join(";");
}

function orderStyleDeclarations(style, names) {
  const order = new Map(names.map((name, index) => [name, index]));
  const declarations = style.split(";").map(compactStyleDeclaration).filter(Boolean);
  const ordered = [];
  const rest = [];
  for (const declaration of declarations) {
    const separator = declaration.indexOf(":");
    const name = separator > 0 ? declaration.slice(0, separator).trim() : "";
    const index = order.get(name);
    if (index === undefined) {
      rest.push(declaration);
    } else {
      ordered[index] = declaration;
    }
  }
  return [...ordered.filter(Boolean), ...rest].join(";");
}

function compactStyleDeclaration(declaration) {
  const trimmed = declaration.trim();
  const separator = trimmed.indexOf(":");
  if (separator <= 0) return trimmed;
  const name = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim();
  return `${name}:${value}`;
}

function parseRenderBundleAtlasLeaves(html, metadata) {
  const out = [];
  const tags = [...html.matchAll(/<s\b([^>]*)>/g)];
  for (let index = 0; index < tags.length; index++) {
    const attrs = attributes(tags[index][1]);
    const style = attrs.style ?? "";
    const width = style.match(/(?:^|;)\s*width:\s*(\d+(?:\.\d+)?)px\b/);
    const height = style.match(/(?:^|;)\s*height:\s*(\d+(?:\.\d+)?)px\b/);
    const leafMetadata = metadata[index];
    const sizing = atlasLeafSizingFromStyle(style, width?.[1], height?.[1], leafMetadata);
    const matrix = compensatedAtlasLeafMatrix(style, sizing);
    out.push({
      attrs,
      index,
      matrix,
      metadata: leafMetadata,
      ...sizing,
    });
  }
  return out;
}

function atlasLeafSizingFromStyle(style, inlineWidth, inlineHeight, metadata) {
  const width = inlineWidth ? Math.max(1, Math.round(Number(inlineWidth))) : null;
  const height = inlineHeight ? Math.max(1, Math.round(Number(inlineHeight))) : null;
  const adaptive = quakeTextureNeedsAdaptivePreparedAtlasLeaf(metadata?.t);
  if (width && height && !adaptive) {
    return {
      height,
      sourceHeight: height,
      sourceWidth: width,
      transformCompensationX: 1,
      transformCompensationY: 1,
      width,
    };
  }

  const matrix = parseMatrix3dDeclaration(styleDeclarationValue(style, "transform"));
  const beforeWidth = width ?? 64;
  const beforeHeight = height ?? 64;
  const matrixScaleX = matrix ? Math.hypot(matrix[0], matrix[1], matrix[2]) : 1;
  const matrixScaleY = matrix ? Math.hypot(matrix[4], matrix[5], matrix[6]) : 1;
  const afterWidth = adaptive || !width ? adaptiveQuakeAtlasLeafSide(beforeWidth, matrixScaleX) : width;
  const afterHeight = adaptive || !height ? adaptiveQuakeAtlasLeafSide(beforeHeight, matrixScaleY) : height;
  return {
    height: afterHeight,
    sourceHeight: beforeHeight,
    sourceWidth: beforeWidth,
    transformCompensationX: adaptive || !width ? beforeWidth / afterWidth : 1,
    transformCompensationY: adaptive || !height ? beforeHeight / afterHeight : 1,
    width: afterWidth,
  };
}

function adaptiveQuakeAtlasLeafSide(beforeSide, matrixScale) {
  const desiredSide = beforeSide * matrixScale;
  const roundedSide = Math.round(desiredSide / QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_STEP) *
    QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_STEP;
  return Math.max(QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_MIN, roundedSide);
}

function quakeTextureNeedsAdaptivePreparedAtlasLeaf(name) {
  const normalized = String(name ?? "").toLowerCase();
  return normalized.startsWith("sky") || normalized.startsWith("*") || normalized.startsWith("+");
}

function compensateAtlasLeafTransform(style, scaleX = 1, scaleY = 1, matrixOverride = null) {
  if (!matrixOverride && Math.abs(scaleX - 1) <= 1e-9 && Math.abs(scaleY - 1) <= 1e-9) return style;
  const matrix = (matrixOverride ?? parseMatrix3dDeclaration(styleDeclarationValue(style, "transform")))?.slice();
  if (!matrix) return style;
  for (let index = 0; index < 4; index++) matrix[index] *= scaleX;
  for (let index = 4; index < 8; index++) matrix[index] *= scaleY;
  return replaceStyleDeclaration(style, "transform", `matrix3d(${matrix.map(formatCssNumber).join(", ")})`);
}

function compensatedAtlasLeafMatrix(style, sizing) {
  const matrix = parseMatrix3dDeclaration(styleDeclarationValue(style, "transform"));
  if (!matrix) return null;
  const out = matrix.slice();
  for (let index = 0; index < 4; index++) out[index] *= sizing.transformCompensationX ?? 1;
  for (let index = 4; index < 8; index++) out[index] *= sizing.transformCompensationY ?? 1;
  return out;
}

function styleDeclarationValue(style, name) {
  for (const part of style.split(";")) {
    const separator = part.indexOf(":");
    if (separator <= 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return "";
}

function parseMatrix3dDeclaration(value) {
  const match = String(value ?? "").trim().match(/^matrix3d\(([^)]+)\)$/);
  if (!match) return null;
  const values = match[1].split(",").map((part) => Number(part.trim()));
  return values.length === 16 && values.every(Number.isFinite) ? values : null;
}

function formatCssNumber(value) {
  if (Math.abs(value) < 1e-9) return "0";
  return String(Number(value.toFixed(6)));
}

function attributes(raw) {
  const out = {};
  for (const match of raw.matchAll(/([\w-]+)="([^"]*)"/g)) out[match[1]] = match[2];
  return out;
}

async function referencedAssetBytes(assetUrls, outputDir, publicPath) {
  let total = 0;
  const bundleRoot = outputDir.slice(0, Math.max(0, outputDir.length - publicPath.length));
  for (const url of assetUrls) {
    try {
      const filePath = path.join(bundleRoot, url.replace(/^\/+/, ""));
      total += (await stat(filePath)).size;
    } catch {
      // Best-effort reporting only.
    }
  }
  return total;
}

function parsePak(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "PACK") throw new Error("Invalid PAK header.");
  const dirOffset = buffer.readInt32LE(4);
  const dirSize = buffer.readInt32LE(8);
  const entries = new Map();
  for (let offset = dirOffset; offset < dirOffset + dirSize; offset += 64) {
    const name = buffer.toString("ascii", offset, offset + 56).replace(/\0.*$/, "");
    const fileOffset = buffer.readInt32LE(offset + 56);
    const size = buffer.readInt32LE(offset + 60);
    entries.set(name, { name, offset: fileOffset, size });
  }
  return { entries };
}

function parseBsp(buffer, pak, pakBuffer) {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const view = new DataView(arrayBuffer);
  if (view.byteLength < BSP_HEADER_SIZE || view.getInt32(0, true) !== 29) {
    throw new Error("Invalid or unsupported Quake BSP.");
  }
  const entities = parseEntities(readLumpText(view, arrayBuffer, BSP_LUMP_ENTITIES));
  const spawn = entities.find((entity) => entity.classname === "info_player_start" && entity.origin);
  const vertices = parseVertices(view);
  const bounds = vertexBounds(vertices);
  const floorZ = spawn?.origin ? spawn.origin.z + QUAKE_PLAYER_MINS_Z : bounds.min.z;
  const pivot = spawn?.origin
    ? { x: spawn.origin.x, y: spawn.origin.y, z: floorZ }
    : {
      x: (bounds.min.x + bounds.max.x) * 0.5,
      y: (bounds.min.y + bounds.max.y) * 0.5,
      z: bounds.min.z,
    };
  const palette = parsePalette(pak, pakBuffer);
  const colormap = parseColormap(pak, pakBuffer);
  const textures = parseMipTextures(view, arrayBuffer);
  const texInfos = parseTexInfos(view);
  const faces = parseFaces(view);
  const planes = parsePlanes(view);
  const edges = parseEdges(view);
  const surfEdges = parseSurfEdges(view);
  const models = parseModels(view);
  const lighting = parseLighting(view, arrayBuffer);
  const faceModels = buildFaceModelIndices(models, faces.length);
  return {
    colormap,
    edges,
    faceModels,
    faces,
    lighting,
    palette,
    pivot,
    planes,
    surfEdges,
    texInfos,
    textures,
    vertices,
  };
}

function parsePalette(pak, pakBuffer) {
  const entry = pak.entries.get("gfx/palette.lmp");
  if (!entry) throw new Error("Missing gfx/palette.lmp.");
  const bytes = pakBuffer.subarray(entry.offset, entry.offset + entry.size);
  return Array.from({ length: 256 }, (_, index) => [
    bytes[index * 3] ?? 0,
    bytes[index * 3 + 1] ?? 0,
    bytes[index * 3 + 2] ?? 0,
  ]);
}

function parseColormap(pak, pakBuffer) {
  const entry = pak.entries.get("gfx/colormap.lmp");
  if (!entry || entry.size < 256 * 64) throw new Error("Missing or invalid gfx/colormap.lmp.");
  return pakBuffer.subarray(entry.offset, entry.offset + 256 * 64);
}

function bspLump(view, index) {
  const offset = view.getInt32(4 + index * 8, true);
  const length = view.getInt32(8 + index * 8, true);
  if (offset < 0 || length < 0 || offset > view.byteLength || length > view.byteLength - offset) {
    throw new Error(`Invalid BSP lump ${index}.`);
  }
  return { offset, length };
}

function readLumpText(view, buffer, index) {
  const lump = bspLump(view, index);
  return new TextDecoder("ascii").decode(new Uint8Array(buffer, lump.offset, lump.length));
}

function readFixedAscii(view, offset, length) {
  let out = "";
  for (let index = 0; index < length; index++) {
    const value = view.getUint8(offset + index);
    if (value === 0) break;
    out += String.fromCharCode(value);
  }
  return out;
}

function parseEntities(text) {
  const blocks = text.match(/\{[\s\S]*?\}/g) ?? [];
  return blocks.map((block, index) => {
    const tokens = [...block.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? "");
    const properties = {};
    for (let token = 0; token < tokens.length; token += 2) {
      if (tokens[token]) properties[tokens[token]] = tokens[token + 1] ?? "";
    }
    return {
      index,
      classname: properties.classname ?? "",
      origin: parseVector(properties.origin),
    };
  });
}

function parseVector(value) {
  if (!value) return null;
  const [x, y, z] = value.trim().split(/\s+/).map(Number);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
}

function parseVertices(view) {
  const lump = bspLump(view, BSP_LUMP_VERTICES);
  const out = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 12) {
    out.push({
      x: view.getFloat32(offset, true),
      y: view.getFloat32(offset + 4, true),
      z: view.getFloat32(offset + 8, true),
    });
  }
  return out;
}

function parsePlanes(view) {
  const lump = bspLump(view, BSP_LUMP_PLANES);
  const out = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 20) {
    out.push({
      normal: {
        x: view.getFloat32(offset, true),
        y: view.getFloat32(offset + 4, true),
        z: view.getFloat32(offset + 8, true),
      },
      dist: view.getFloat32(offset + 12, true),
    });
  }
  return out;
}

function parseMipTextures(view, buffer) {
  const lump = bspLump(view, BSP_LUMP_TEXTURES);
  const count = view.getInt32(lump.offset, true);
  const out = [];
  for (let index = 0; index < count; index++) {
    const relative = view.getInt32(lump.offset + 4 + index * 4, true);
    if (relative < 0) {
      out.push(null);
      continue;
    }
    const base = lump.offset + relative;
    const name = readFixedAscii(view, base, 16).toLowerCase();
    const width = view.getUint32(base + 16, true);
    const height = view.getUint32(base + 20, true);
    const mipOffset = view.getUint32(base + 24, true);
    out.push({
      name,
      width,
      height,
      pixels: new Uint8Array(buffer, base + mipOffset, width * height).slice(),
    });
  }
  return out;
}

function parseTexInfos(view) {
  const lump = bspLump(view, BSP_LUMP_TEXINFO);
  const out = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 40) {
    out.push({
      s: [
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true),
        view.getFloat32(offset + 12, true),
      ],
      t: [
        view.getFloat32(offset + 16, true),
        view.getFloat32(offset + 20, true),
        view.getFloat32(offset + 24, true),
        view.getFloat32(offset + 28, true),
      ],
      miptex: view.getInt32(offset + 32, true),
    });
  }
  return out;
}

function parseFaces(view) {
  const lump = bspLump(view, BSP_LUMP_FACES);
  const out = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 20) {
    out.push({
      plane: view.getUint16(offset, true),
      side: view.getUint16(offset + 2, true),
      firstEdge: view.getInt32(offset + 4, true),
      edgeCount: view.getUint16(offset + 8, true),
      texInfo: view.getUint16(offset + 10, true),
      styles: [
        view.getUint8(offset + 12),
        view.getUint8(offset + 13),
        view.getUint8(offset + 14),
        view.getUint8(offset + 15),
      ],
      lightOffset: view.getInt32(offset + 16, true),
    });
  }
  return out;
}

function parseEdges(view) {
  const lump = bspLump(view, BSP_LUMP_EDGES);
  const out = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 4) {
    out.push([view.getUint16(offset, true), view.getUint16(offset + 2, true)]);
  }
  return out;
}

function parseSurfEdges(view) {
  const lump = bspLump(view, BSP_LUMP_SURFEDGES);
  const out = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 4) {
    out.push(view.getInt32(offset, true));
  }
  return out;
}

function parseModels(view) {
  const lump = bspLump(view, BSP_LUMP_MODELS);
  const out = [];
  for (let offset = lump.offset; offset < lump.offset + lump.length; offset += 64) {
    out.push({
      firstFace: view.getInt32(offset + 56, true),
      faceCount: view.getInt32(offset + 60, true),
    });
  }
  return out;
}

function parseLighting(view, buffer) {
  const lump = bspLump(view, BSP_LUMP_LIGHTING);
  return new Uint8Array(buffer, lump.offset, lump.length);
}

function vertexBounds(vertices) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const vertex of vertices) {
    min.x = Math.min(min.x, vertex.x);
    min.y = Math.min(min.y, vertex.y);
    min.z = Math.min(min.z, vertex.z);
    max.x = Math.max(max.x, vertex.x);
    max.y = Math.max(max.y, vertex.y);
    max.z = Math.max(max.z, vertex.z);
  }
  return { min, max };
}

function buildFaceModelIndices(models, faceCount) {
  const out = Array(faceCount).fill(0);
  models.forEach((model, modelIndex) => {
    for (let index = 0; index < model.faceCount; index++) out[model.firstFace + index] = modelIndex;
  });
  return out;
}

function buildSourceFace(data, faceIndex) {
  const face = data.faces[faceIndex];
  if (!face) return null;
  const texInfo = data.texInfos[face.texInfo];
  const texture = texInfo ? data.textures[texInfo.miptex] : null;
  if (!texInfo || !texture) return null;
  const points = [];
  for (let index = 0; index < face.edgeCount; index++) {
    const surfEdge = data.surfEdges[face.firstEdge + index];
    const edge = data.edges[Math.abs(surfEdge)];
    if (!edge) continue;
    const vertexIndex = surfEdge >= 0 ? edge[0] : edge[1];
    const point = data.vertices[vertexIndex];
    if (point) points.push(point);
  }
  const oriented = stabilizeFacePoints(orientFacePoints(stabilizeFacePoints(dedupeFacePoints(points)), face, data.planes));
  if (oriented.length < 3) return null;
  return {
    face,
    faceIndex,
    modelIndex: data.faceModels[faceIndex] ?? 0,
    points: oriented,
    texInfo,
    texture,
  };
}

function dedupeFacePoints(points) {
  const out = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (previous && samePoint(previous, point)) continue;
    out.push(point);
  }
  if (out.length > 1 && samePoint(out[0], out[out.length - 1])) out.pop();
  return out;
}

function stabilizeFacePoints(points) {
  if (points.length < 4) return points;
  let bestArea = faceFirstTripleAreaSq(points);
  let best = points;
  for (let index = 1; index < points.length; index++) {
    const rotated = [...points.slice(index), ...points.slice(0, index)];
    const area = faceFirstTripleAreaSq(rotated);
    if (area > bestArea) {
      bestArea = area;
      best = rotated;
    }
  }
  return bestArea > QUAKE_FACE_NORMAL_AREA_EPS ? best : points;
}

function orientFacePoints(points, face, planes) {
  const plane = planes[face.plane];
  if (!plane || points.length < 3) return points;
  const expected = face.side
    ? { x: -plane.normal.x, y: -plane.normal.y, z: -plane.normal.z }
    : plane.normal;
  const actual = faceNormal(points);
  const dot = actual.x * expected.x + actual.y * expected.y + actual.z * expected.z;
  return dot < 0 ? points.slice().reverse() : points;
}

function faceNormal(points) {
  let bestNormal = { x: 0, y: 0, z: 0 };
  let bestArea = 0;
  for (let index = 0; index < points.length - 2; index++) {
    const a = points[index];
    if (!a) continue;
    for (let j = index + 1; j < points.length - 1; j++) {
      const b = points[j];
      if (!b) continue;
      for (let k = j + 1; k < points.length; k++) {
        const c = points[k];
        if (!c) continue;
        const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
        const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
        const normal = {
          x: ab.y * ac.z - ab.z * ac.y,
          y: ab.z * ac.x - ab.x * ac.z,
          z: ab.x * ac.y - ab.y * ac.x,
        };
        const area = normal.x * normal.x + normal.y * normal.y + normal.z * normal.z;
        if (area > bestArea) {
          bestArea = area;
          bestNormal = normal;
        }
      }
    }
  }
  if (bestArea > QUAKE_FACE_NORMAL_AREA_EPS) {
    const length = Math.hypot(bestNormal.x, bestNormal.y, bestNormal.z);
    return { x: bestNormal.x / length, y: bestNormal.y / length, z: bestNormal.z / length };
  }
  return { x: 0, y: 0, z: 0 };
}

function faceFirstTripleAreaSq(points) {
  if (points.length < 3) return 0;
  const [a, b, c] = points;
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const nx = ab.y * ac.z - ab.z * ac.y;
  const ny = ab.z * ac.x - ab.x * ac.z;
  const nz = ab.x * ac.y - ab.y * ac.x;
  return nx * nx + ny * ny + nz * nz;
}

function samePoint(a, b) {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001 && Math.abs(a.z - b.z) < 0.001;
}

function faceTextureCoordinateBounds(points, texInfo) {
  let minS = Infinity;
  let maxS = -Infinity;
  let minT = Infinity;
  let maxT = -Infinity;
  for (const point of points) {
    const s = point.x * texInfo.s[0] + point.y * texInfo.s[1] + point.z * texInfo.s[2] + texInfo.s[3];
    const t = point.x * texInfo.t[0] + point.y * texInfo.t[1] + point.z * texInfo.t[2] + texInfo.t[3];
    minS = Math.min(minS, s);
    maxS = Math.max(maxS, s);
    minT = Math.min(minT, t);
    maxT = Math.max(maxT, t);
  }
  return { minS, maxS, minT, maxT };
}

function textureCoordsAtQuakePoint(point, texInfo) {
  return {
    s: point.x * texInfo.s[0] + point.y * texInfo.s[1] + point.z * texInfo.s[2] + texInfo.s[3],
    t: point.x * texInfo.t[0] + point.y * texInfo.t[1] + point.z * texInfo.t[2] + texInfo.t[3],
  };
}

function quakeToPoly(point, pivot) {
  return [
    (point.x - pivot.x) * QUAKE_UNIT_SCALE,
    (point.y - pivot.y) * QUAKE_UNIT_SCALE,
    (point.z - pivot.z) * QUAKE_UNIT_SCALE,
  ];
}

function polyToQuake(point, pivot) {
  return {
    x: point[0] / QUAKE_UNIT_SCALE + pivot.x,
    y: point[1] / QUAKE_UNIT_SCALE + pivot.y,
    z: point[2] / QUAKE_UNIT_SCALE + pivot.z,
  };
}

function uvAtPlanPoint(plan, x, y, frameW, frameH) {
  if (plan.uvAffine) {
    const { a, b, c, d, e, f } = plan.uvAffine;
    const det = a * d - b * c;
    if (Math.abs(det) <= 1e-9) return null;
    const dx = x - e;
    const dy = y - f;
    return {
      u: (dx * d - b * dy) / det,
      v: (a * dy - dx * c) / det,
    };
  }
  if (!plan.uvSampleRect) return null;
  return {
    u: plan.uvSampleRect.minU + (x / frameW) * (plan.uvSampleRect.maxU - plan.uvSampleRect.minU),
    v: plan.uvSampleRect.minV + (y / frameH) * (plan.uvSampleRect.maxV - plan.uvSampleRect.minV),
  };
}

function screenToPolyMapperForPlan(plan, polygon) {
  const points = plan.screenPts;
  const vertices = polygon?.vertices;
  const vertexCount = Math.min(Math.floor((points?.length ?? 0) / 2), vertices?.length ?? 0);
  if (vertexCount < 3) return null;

  for (let i = 0; i < vertexCount - 2; i++) {
    for (let j = i + 1; j < vertexCount - 1; j++) {
      for (let k = j + 1; k < vertexCount; k++) {
        const x0 = points[i * 2] ?? 0;
        const y0 = points[i * 2 + 1] ?? 0;
        const x1 = points[j * 2] ?? 0;
        const y1 = points[j * 2 + 1] ?? 0;
        const x2 = points[k * 2] ?? 0;
        const y2 = points[k * 2 + 1] ?? 0;
        const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
        if (Math.abs(det) <= 1e-9) continue;
        const v0 = vertices[i];
        const v1 = vertices[j];
        const v2 = vertices[k];
        if (!validVec3(v0) || !validVec3(v1) || !validVec3(v2)) continue;
        return (x, y) => {
          const alpha = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / det;
          const beta = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / det;
          return [
            v0[0] + alpha * (v1[0] - v0[0]) + beta * (v2[0] - v0[0]),
            v0[1] + alpha * (v1[1] - v0[1]) + beta * (v2[1] - v0[1]),
            v0[2] + alpha * (v1[2] - v0[2]) + beta * (v2[2] - v0[2]),
          ];
        };
      }
    }
  }
  return null;
}

function validVec3(value) {
  return Array.isArray(value) &&
    value.length >= 3 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Number.isFinite(value[2]);
}

function sourceEntryAtPolyPoint(entries, point) {
  for (const entry of entries) {
    if (pointInPolyFace(point, entry.polyPoints)) return entry;
  }
  return null;
}

function pointInPolyFace(point, points) {
  if (!points?.length) return false;
  const normal = vec3Normal(points);
  const axis = dominantAbsAxis(normal);
  const polygon = points.map((item) => projectVec3To2(item, axis));
  const projected = projectVec3To2(point, axis);
  return pointInPolygon2(projected[0], projected[1], polygon);
}

function vec3Normal(points) {
  for (let index = 0; index < points.length - 2; index++) {
    const a = points[index];
    const b = points[index + 1];
    const c = points[index + 2];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const length = Math.hypot(normal[0], normal[1], normal[2]);
    if (length > 1e-9) return [normal[0] / length, normal[1] / length, normal[2] / length];
  }
  return [0, 0, 1];
}

function dominantAbsAxis(normal) {
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  if (ax >= ay && ax >= az) return 0;
  return ay >= az ? 1 : 2;
}

function projectVec3To2(point, dropAxis) {
  if (dropAxis === 0) return [point[1], point[2]];
  if (dropAxis === 1) return [point[0], point[2]];
  return [point[0], point[1]];
}

function pointInPolygon2(x, y, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [xi, yi] = points[index];
    const [xj, yj] = points[previous];
    if (pointOnSegment(x, y, xi, yi, xj, yj)) return true;
    const crosses = (yi > y) !== (yj > y);
    if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function derivePlanUvAffine(plan, polygon) {
  const points = plan.screenPts;
  const uvs = polygon?.uvs;
  const vertexCount = Math.min(Math.floor((points?.length ?? 0) / 2), polygon?.vertices?.length ?? 0);
  if (vertexCount < 3 || !Array.isArray(uvs) || uvs.length < vertexCount) return null;

  for (let i = 0; i < vertexCount - 2; i++) {
    for (let j = i + 1; j < vertexCount - 1; j++) {
      for (let k = j + 1; k < vertexCount; k++) {
        const uv0 = uvs[i];
        const uv1 = uvs[j];
        const uv2 = uvs[k];
        if (!validUvPoint(uv0) || !validUvPoint(uv1) || !validUvPoint(uv2)) continue;
        const x0 = points[i * 2] ?? 0;
        const y0 = points[i * 2 + 1] ?? 0;
        const x1 = points[j * 2] ?? 0;
        const y1 = points[j * 2 + 1] ?? 0;
        const x2 = points[k * 2] ?? 0;
        const y2 = points[k * 2 + 1] ?? 0;
        const affine = affineFromUvToScreen(uv0, uv1, uv2, x0, y0, x1, y1, x2, y2);
        if (affine) return affine;
      }
    }
  }
  return null;
}

function validUvPoint(value) {
  return Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]);
}

function affineFromUvToScreen(uv0, uv1, uv2, x0, y0, x1, y1, x2, y2) {
  const u0 = uv0[0];
  const v0 = uv0[1];
  const du1 = uv1[0] - u0;
  const dv1 = uv1[1] - v0;
  const du2 = uv2[0] - u0;
  const dv2 = uv2[1] - v0;
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) <= 1e-9) return null;

  const dx1 = x1 - x0;
  const dx2 = x2 - x0;
  const dy1 = y1 - y0;
  const dy2 = y2 - y0;
  const a = (dx1 * dv2 - dx2 * dv1) / det;
  const b = (du1 * dx2 - du2 * dx1) / det;
  const c = (dy1 * dv2 - dy2 * dv1) / det;
  const d = (du1 * dy2 - du2 * dy1) / det;
  const e = x0 - a * u0 - b * v0;
  const f = y0 - c * u0 - d * v0;
  if (![a, b, c, d, e, f].every(Number.isFinite)) return null;
  return { a, b, c, d, e, f };
}

function pointInScreenPolygon(x, y, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 2; index < points.length; previous = index, index += 2) {
    const xi = points[index] ?? 0;
    const yi = points[index + 1] ?? 0;
    const xj = points[previous] ?? 0;
    const yj = points[previous + 1] ?? 0;
    if (pointOnSegment(x, y, xi, yi, xj, yj)) return true;
    const crosses = (yi > y) !== (yj > y);
    if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pixelIntersectsScreenPolygon(minX, minY, maxX, maxY, points) {
  if (
    pointInScreenPolygon(minX, minY, points) ||
    pointInScreenPolygon(maxX, minY, points) ||
    pointInScreenPolygon(maxX, maxY, points) ||
    pointInScreenPolygon(minX, maxY, points)
  ) {
    return true;
  }

  for (let index = 0, previous = points.length - 2; index < points.length; previous = index, index += 2) {
    const ax = points[previous] ?? 0;
    const ay = points[previous + 1] ?? 0;
    const bx = points[index] ?? 0;
    const by = points[index + 1] ?? 0;
    if (pointInRect(ax, ay, minX, minY, maxX, maxY) || pointInRect(bx, by, minX, minY, maxX, maxY)) {
      return true;
    }
    if (segmentIntersectsRect(ax, ay, bx, by, minX, minY, maxX, maxY)) return true;
  }
  return false;
}

function pointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const cross = (px - ax) * dy - (py - ay) * dx;
  if (Math.abs(cross) > 1e-5) return false;
  const dot = (px - ax) * dx + (py - ay) * dy;
  if (dot < -1e-5) return false;
  return dot <= dx * dx + dy * dy + 1e-5;
}

function pointInRect(x, y, minX, minY, maxX, maxY) {
  return x >= minX - 1e-5 && x <= maxX + 1e-5 && y >= minY - 1e-5 && y <= maxY + 1e-5;
}

function segmentIntersectsRect(ax, ay, bx, by, minX, minY, maxX, maxY) {
  return (
    segmentsIntersect(ax, ay, bx, by, minX, minY, maxX, minY) ||
    segmentsIntersect(ax, ay, bx, by, maxX, minY, maxX, maxY) ||
    segmentsIntersect(ax, ay, bx, by, maxX, maxY, minX, maxY) ||
    segmentsIntersect(ax, ay, bx, by, minX, maxY, minX, minY)
  );
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const abC = orient2d(ax, ay, bx, by, cx, cy);
  const abD = orient2d(ax, ay, bx, by, dx, dy);
  const cdA = orient2d(cx, cy, dx, dy, ax, ay);
  const cdB = orient2d(cx, cy, dx, dy, bx, by);
  if (Math.abs(abC) <= 1e-5 && pointOnSegment(cx, cy, ax, ay, bx, by)) return true;
  if (Math.abs(abD) <= 1e-5 && pointOnSegment(dx, dy, ax, ay, bx, by)) return true;
  if (Math.abs(cdA) <= 1e-5 && pointOnSegment(ax, ay, cx, cy, dx, dy)) return true;
  if (Math.abs(cdB) <= 1e-5 && pointOnSegment(bx, by, cx, cy, dx, dy)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function orient2d(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function quakeAtlasLeafBasisRotationPlan(polygons) {
  const rotations = [];
  const stats = {
    totalPolygons: Array.isArray(polygons) ? polygons.length : 0,
    texturedPolygons: 0,
    candidatePolygons: 0,
    rotatedPolygons: 0,
    beforeArea: 0,
    afterArea: 0,
    maxSavedArea: 0,
  };
  if (!Array.isArray(polygons)) return { rotations, stats };

  for (let index = 0; index < polygons.length; index++) {
    const polygon = polygons[index];
    const vertices = polygon?.vertices;
    if (polygon?.texture) stats.texturedPolygons++;
    const rotation = quakeAtlasLeafBasisRotation(vertices, Boolean(polygon?.texture));
    rotations[index] = rotation.offset;
    if (!rotation.candidate) continue;
    stats.candidatePolygons++;
    stats.beforeArea += rotation.beforeArea;
    stats.afterArea += rotation.afterArea;
    const savedArea = Math.max(0, rotation.beforeArea - rotation.afterArea);
    if (rotation.offset > 0) {
      stats.rotatedPolygons++;
      stats.maxSavedArea = Math.max(stats.maxSavedArea, savedArea);
    }
  }
  stats.beforeArea = Math.round(stats.beforeArea);
  stats.afterArea = Math.round(stats.afterArea);
  stats.savedArea = Math.max(0, stats.beforeArea - stats.afterArea);
  stats.savedRatio = stats.beforeArea > 0 ? Number((stats.savedArea / stats.beforeArea).toFixed(4)) : 0;
  stats.maxSavedArea = Math.round(stats.maxSavedArea);
  return { rotations, stats };
}

function quakeAtlasLeafBasisRotation(vertices, isTextured) {
  if (!isTextured || !Array.isArray(vertices) || vertices.length < 3) {
    return { offset: 0, candidate: false, beforeArea: 0, afterArea: 0 };
  }
  const normal = quakePolygonNormal(vertices);
  if (!normal) return { offset: 0, candidate: false, beforeArea: 0, afterArea: 0 };
  let base = null;
  let best = null;
  for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex++) {
    const area = quakePolygonBasisArea(vertices, normal, edgeIndex);
    if (!area) continue;
    if (edgeIndex === 0) base = area;
    if (!best || area.pixelArea < best.pixelArea || (
      area.pixelArea === best.pixelArea &&
      area.rawArea < best.rawArea
    )) {
      best = area;
    }
  }
  if (!base || !best) return { offset: 0, candidate: false, beforeArea: 0, afterArea: 0 };
  const improved = best.edgeIndex > 0 && best.pixelArea + 0.5 < base.pixelArea;
  return {
    offset: improved ? best.edgeIndex : 0,
    candidate: true,
    beforeArea: base.pixelArea,
    afterArea: improved ? best.pixelArea : base.pixelArea,
  };
}

function quakePolygonNormal(vertices) {
  for (let index = 1; index < vertices.length - 1; index++) {
    const a = quakeVecSub(vertices[index], vertices[0]);
    const b = quakeVecSub(vertices[index + 1], vertices[0]);
    const normal = quakeVecNormalize(quakeVecCross(a, b));
    if (normal) return normal;
  }
  return null;
}

function quakePolygonBasisArea(vertices, normal, edgeIndex) {
  const start = vertices[edgeIndex];
  const end = vertices[(edgeIndex + 1) % vertices.length];
  const xAxis = quakeVecNormalize(quakeVecSub(end, start));
  if (!xAxis) return null;
  const yAxis = quakeVecNormalize(quakeVecCross(normal, xAxis));
  if (!yAxis) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const vertex of vertices) {
    const x = quakeVecDot(vertex, xAxis);
    const y = quakeVecDot(vertex, yAxis);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const rawWidth = maxX - minX;
  const rawHeight = maxY - minY;
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) return null;
  return {
    edgeIndex,
    rawArea: rawWidth * rawHeight,
    pixelArea: Math.max(1, Math.ceil(rawWidth)) * Math.max(1, Math.ceil(rawHeight)),
  };
}

function applyQuakeAtlasLeafBasisRotationPlan(polygons, plan) {
  if (!plan?.stats?.rotatedPolygons) return polygons;
  return polygons.map((polygon, index) => rotateQuakeAtlasLeafBasisPolygon(polygon, plan.rotations[index] ?? 0));
}

function rotateQuakeAtlasLeafBasisPolygon(polygon, offset) {
  const vertices = polygon?.vertices;
  if (!offset || !Array.isArray(vertices) || offset <= 0 || offset >= vertices.length) return polygon;
  return {
    ...polygon,
    vertices: rotateQuakePolygonArray(vertices, offset),
    ...(Array.isArray(polygon.uvs) && polygon.uvs.length === vertices.length
      ? { uvs: rotateQuakePolygonArray(polygon.uvs, offset) }
      : {}),
  };
}

function rotateQuakePolygonArray(values, offset) {
  return [...values.slice(offset), ...values.slice(0, offset)].map((value) =>
    Array.isArray(value) ? [...value] : value
  );
}

function quakeVecSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function quakeVecCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function quakeVecDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function quakeVecNormalize(value) {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length > 1e-9 ? [value[0] / length, value[1] / length, value[2] / length] : null;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function incrementStat(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function recordSkipSample(samples, reason, sample) {
  if (!sample) return;
  const list = samples.get(reason) ?? [];
  if (list.length >= 12) return;
  list.push(sample);
  samples.set(reason, list);
}

function serializeSkipSamples(samples) {
  return Object.fromEntries([...samples.entries()].sort());
}

function screenPointBounds(points) {
  if (!points?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index] ?? 0;
    const y = points[index + 1] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    minX: roundSampleNumber(minX),
    minY: roundSampleNumber(minY),
    maxX: roundSampleNumber(maxX),
    maxY: roundSampleNumber(maxY),
  };
}

function sampleScreenPoints(points) {
  if (!points?.length) return [];
  const out = [];
  for (let index = 0; index < Math.min(points.length, 24); index += 2) {
    out.push([
      roundSampleNumber(points[index] ?? 0),
      roundSampleNumber(points[index + 1] ?? 0),
    ]);
  }
  return out;
}

function roundSampleNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : value;
}
