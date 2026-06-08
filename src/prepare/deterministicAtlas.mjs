import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { BASE_TILE, computeTextureAtlasPlanPublic } from "@layoutit/polycss";
import sharp from "sharp";

import { QUAKE_UNIT_SCALE } from "../quakeScale.js";

const execFile = promisify(execFileCallback);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
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
const QUAKE_LIGHT_SAMPLE_SIZE = 16;
const QUAKE_LIGHT_MIN = 0.18;
const QUAKE_LIGHT_MAX = 1.45;
const QUAKE_LIGHT_SAMPLE_NORMAL_SCALE = 272 / 256;
const QUAKE_LIGHT_DISPLAY_GAMMA = 0.86;
const QUAKE_DETERMINISTIC_ATLAS_PAGE_SIZE = 4096;
const QUAKE_DETERMINISTIC_ATLAS_PAGE_PADDING = 1;
const QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_MIN = 1;
const QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_STEP = 1;
const QUAKE_LIGHTSTYLE0_SCALE = 1;
const WINQUAKE_VID_CBITS = 6;
const WINQUAKE_DEFAULT_STYLE_VALUE = 256;
const WINQUAKE_LIGHTSTYLE_VALUES = new Map([[0, 12 * 22]]);
const SOFTWARE_SURFACE_REQUEST_MAGIC = 0x46525351;
const SOFTWARE_SURFACE_RESPONSE_MAGIC = 0x314f5351;
const SOFTWARE_SURFACE_HEADER_BYTES = 68;
const SOFTWARE_SURFACE_RESPONSE_HEADER_BYTES = 16;
const QUAKE_POLYCSS_PROJECTIVE_QUAD_GUARDS = { bleed: 0 };

export async function replaceQuakeRenderBundleWorldAtlas({
  atlasSource = "css",
  imagePolicy = "atlas",
  mapPath,
  name,
  optimizeAtlasLeafBasis = false,
  outputDir,
  pakBuffer,
  polygons,
  publicPath,
  renderBundle,
  visibility,
}) {
  if (!renderBundle?.meshHtml || !Array.isArray(renderBundle.leafMetadata) || !Array.isArray(polygons)) {
    return { enabled: true, replacedLeaves: 0, skippedLeaves: 0, skipped: { invalidInput: 1 } };
  }

  const bspData = parseQuakeBspFromPak(pakBuffer, mapPath);
  const renderPolygons = optimizeAtlasLeafBasis
    ? applyQuakeAtlasLeafBasisRotationPlan(polygons, quakeAtlasLeafBasisRotationPlan(polygons))
    : polygons;
  const leaves = parseRenderBundleAtlasLeaves(renderBundle.meshHtml, renderBundle.leafMetadata);
  const tiles = [];
  const skipped = new Map();
  const skipSamples = new Map();
  const startedAt = Date.now();
  const normalizedAtlasSource = atlasSource === "software" ? "software" : "css";
  const normalizedImagePolicy = normalizeDeterministicImagePolicy(imagePolicy);
  const softwareOracle = normalizedAtlasSource === "software"
    ? await createSoftwareQuakeSurfaceOracle()
    : null;
  const context = {
    boundsBySourceFace: new Map(),
    gridBySourceFace: new Map(),
    planByPolygon: new Map(),
    sourceByFace: new Map(),
    softwareSurfaceBySourceFace: new Map(),
    softwareOracle,
  };

  try {
    for (const leaf of leaves) {
      const tile = await deterministicLeafTile({
        bspData,
        context,
        atlasSource: normalizedAtlasSource,
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
  } finally {
    await softwareOracle?.close?.();
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
  for (const tile of tiles) {
    if (deterministicTileUsesLeafImage(tile, normalizedImagePolicy)) {
      leafImageTiles.push(tile);
    } else {
      atlasTiles.push(tile);
    }
  }
  const pages = packDeterministicAtlasTiles(atlasTiles);
  const coverageFallbackLeaves = tiles.reduce((total, tile) => total + (tile.coverageFallback ? 1 : 0), 0);
  const derivedUvAffineLeaves = tiles.reduce((total, tile) => total + (tile.derivedUvAffine ? 1 : 0), 0);
  const mergedSourceLeaves = tiles.reduce((total, tile) => total + (tile.mergedSourceFaces > 1 ? 1 : 0), 0);
  await mkdir(outputDir, { recursive: true });
  let pageBytes = 0;
  let leafImageBytes = 0;
  const pageAssetUrls = [];
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const filename = `det-${index}.png`;
    const outputPath = path.join(outputDir, filename);
    const image = await renderDeterministicAtlasPage(page);
    await writeFile(outputPath, image);
    pageBytes += image.byteLength;
    pageAssetUrls.push(`${publicPath}/${filename}`);
  }
  for (const tile of leafImageTiles) {
    const filename = `det-leaf-${tile.leafIndex}.png`;
    const image = await renderDeterministicLeafImage(tile);
    await writeFile(path.join(outputDir, filename), image);
    leafImageBytes += image.byteLength;
    tile.leafImageUrl = `${publicPath}/${filename}`;
  }

  const firstNewAssetIndex = renderBundle.assetUrls.length;
  renderBundle.assetUrls = [...renderBundle.assetUrls, ...pageAssetUrls];
  renderBundle.meshHtml = rewriteRenderBundleMeshHtmlForDeterministicAtlas(
    renderBundle.meshHtml,
    tiles,
    pageAssetUrls,
    firstNewAssetIndex,
  );

  const oldBytes = await referencedAssetBytes(renderBundle.assetUrls.slice(0, firstNewAssetIndex), outputDir, publicPath);
  return {
    enabled: true,
    atlasSource: normalizedAtlasSource,
    imagePolicy: normalizedImagePolicy,
    name,
    pageBytes: pageBytes + leafImageBytes,
    atlasPageBytes: pageBytes,
    leafImageBytes,
    pageCount: pages.length,
    atlasTileCount: atlasTiles.length,
    leafImageCount: leafImageTiles.length,
    coverageFallbackLeaves,
    derivedUvAffineLeaves,
    mergedSourceLeaves,
    elapsedMs: Date.now() - startedAt,
    replacedLeaves: tiles.length,
    skippedLeaves: leaves.length - tiles.length,
    skipped: Object.fromEntries([...skipped.entries()].sort()),
    skipSamples: serializeSkipSamples(skipSamples),
    oldAtlasBytesStillReferenced: oldBytes,
  };
}

function parseQuakeBspFromPak(pakBuffer, mapPath) {
  const pak = parsePak(pakBuffer);
  const entry = pak.entries.get(mapPath);
  if (!entry) throw new Error(`Could not find ${mapPath} in PAK.`);
  const bsp = pakBuffer.subarray(entry.offset, entry.offset + entry.size);
  return parseBsp(bsp, pak, pakBuffer);
}

async function deterministicLeafTile({ atlasSource, bspData, context, leaf, polygons, visibility }) {
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
  if (source.texture.name.startsWith("sky") || source.texture.name.startsWith("*") || source.texture.name.startsWith("+")) {
    return { skip: "special-texture", sample: sourceSample() };
  }
  if (sources.some((item) =>
    item.texture.name.startsWith("sky") ||
    item.texture.name.startsWith("*") ||
    item.texture.name.startsWith("+")
  )) {
    return { skip: "special-texture", sample: sourceSample() };
  }
  if (sources.some((item) => item.texture.name.toLowerCase() !== source.texture.name.toLowerCase())) {
    return { skip: "merged-texture-mismatch", sample: sourceSample() };
  }
  if (sources.some((item) => !item.face.styles.every((style) => style === 0 || style === 255))) {
    return { skip: "animated-lightstyle", sample: sourceSample() };
  }
  if (sources.some((item) => item.face.lightOffset < 0) || !bspData.lighting.length) {
    if (atlasSource !== "software") return { skip: "unlit-source-face", sample: sourceSample() };
  }

  const polygon = polygons[polygonIndex];
  if (!polygon?.vertices?.length || !polygon?.uvs?.length) {
    return { skip: "missing-polygon-uvs", sample: sourceSample() };
  }
  const plan = cachedTextureAtlasPlan(context, polygon, polygonIndex);
  if (!plan || plan.canvasW <= 0 || plan.canvasH <= 0) {
    return { skip: "missing-atlas-plan", sample: sourceSample() };
  }

  const sourceBounds = cachedSourceBounds(context, source);
  const baked = polygon.data?.["lm-bake"] === true;
  const sourceEntries = await Promise.all(sources.map(async (item) => {
    const bounds = cachedSourceBounds(context, item);
    return {
      bounds,
      lightGrid: baked ? cachedLightmapGrid(context, item, bounds) : null,
      polyPoints: item.points.map((point) => quakeToPoly(point, bspData.pivot)),
      softwareSurface: atlasSource === "software"
        ? await cachedWinQuakeSurface(context, item, bounds, bspData)
        : null,
      source: item,
    };
  }));
  const mergedSourceEntries = sourceEntries.length > 1 ? sourceEntries : null;
  const screenToPoly = mergedSourceEntries ? screenToPolyMapperForPlan(plan, polygon) : null;
  if (mergedSourceEntries && !screenToPoly) {
    return { skip: "merged-missing-plan-map", sample: sourceSample() };
  }
  const lightGrid = sourceEntries[0].lightGrid;
  const softwareSurface = sourceEntries[0].softwareSurface;
  const rawLight = baked ? 1 : Number(polygon.data?.lit) || 1;
  const rgba = Buffer.alloc(leaf.width * leaf.height * 4);
  let solidPixels = 0;
  const derivedUvAffine = plan.uvAffine ? null : derivePlanUvAffine(plan, polygon);
  const useAffineUv = Boolean(plan.uvAffine ?? derivedUvAffine);
  const affine = plan.uvAffine ?? derivedUvAffine;
  const affineDet = affine ? affine.a * affine.d - affine.b * affine.c : 0;
  const sampleRect = plan.uvSampleRect;
  let coverageFallback = false;

  const paintPixelAtPlanPoint = (x, y, planX, planY) => {
    let u;
    let v;
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
    let sampleSource = source;
    let sampleBounds = sourceBounds;
    let sampleLightGrid = lightGrid;
    let sampleSoftwareSurface = softwareSurface;
    let s = baked
      ? sourceBounds.minS + u * (sourceBounds.maxS - sourceBounds.minS)
      : u * source.texture.width;
    let t = baked
      ? sourceBounds.maxT - v * (sourceBounds.maxT - sourceBounds.minT)
      : (v - 1) * source.texture.height;
    if (mergedSourceEntries && screenToPoly) {
      const polyPoint = screenToPoly(planX, planY);
      const entry = polyPoint ? sourceEntryAtPolyPoint(mergedSourceEntries, polyPoint) : null;
      if (!entry) return false;
      sampleSource = entry.source;
      sampleBounds = entry.bounds;
      sampleLightGrid = entry.lightGrid;
      sampleSoftwareSurface = entry.softwareSurface;
      const quakePoint = polyToQuake(polyPoint, bspData.pivot);
      const coords = textureCoordsAtQuakePoint(quakePoint, sampleSource.texInfo);
      s = coords.s;
      t = coords.t;
    }
    const rgb = sampleSoftwareSurface
      ? winQuakeRgbAt(sampleSoftwareSurface, s, t)
      : baked
        ? cssExpectedBakedRgbAt(sampleSource, sampleBounds, sampleLightGrid, s, t, bspData)
        : cssExpectedRawRgbAt(sampleSource, s, t, rawLight, bspData);
    const offset = (y * leaf.width + x) * 4;
    rgba[offset] = rgb[0];
    rgba[offset + 1] = rgb[1];
    rgba[offset + 2] = rgb[2];
    rgba[offset + 3] = 255;
    return true;
  };

  for (let y = 0; y < leaf.height; y++) {
    const planY = ((y + 0.5) / leaf.height) * plan.canvasH;
    for (let x = 0; x < leaf.width; x++) {
      const planX = ((x + 0.5) / leaf.width) * plan.canvasW;
      if (!pointInScreenPolygon(planX, planY, plan.screenPts)) continue;
      if (paintPixelAtPlanPoint(x, y, planX, planY)) solidPixels++;
    }
  }

  if (!solidPixels) {
    const stepX = plan.canvasW / leaf.width;
    const stepY = plan.canvasH / leaf.height;
    for (let y = 0; y < leaf.height; y++) {
      const planY = ((y + 0.5) / leaf.height) * plan.canvasH;
      const minY = planY - stepY * 0.5;
      const maxY = planY + stepY * 0.5;
      for (let x = 0; x < leaf.width; x++) {
        const planX = ((x + 0.5) / leaf.width) * plan.canvasW;
        const minX = planX - stepX * 0.5;
        const maxX = planX + stepX * 0.5;
        if (!pixelIntersectsScreenPolygon(minX, minY, maxX, maxY, plan.screenPts)) continue;
        if (paintPixelAtPlanPoint(x, y, planX, planY)) solidPixels++;
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
  return {
    height: leaf.height,
    leafIndex: leaf.index,
    coverageFallback,
    derivedUvAffine: Boolean(derivedUvAffine),
    mergedSourceFaces: sourceEntries.length,
    rgba,
    transformCompensationX: leaf.transformCompensationX,
    transformCompensationY: leaf.transformCompensationY,
    solidPixels,
    width: leaf.width,
  };
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

function cachedSourceBounds(context, source) {
  const key = source.faceIndex;
  if (context.boundsBySourceFace.has(key)) return context.boundsBySourceFace.get(key);
  const bounds = faceTextureCoordinateBounds(source.points, source.texInfo);
  context.boundsBySourceFace.set(key, bounds);
  return bounds;
}

function cachedLightmapGrid(context, source, bounds) {
  const key = source.faceIndex;
  if (context.gridBySourceFace.has(key)) return context.gridBySourceFace.get(key);
  const grid = lightmapGrid(source, bounds);
  context.gridBySourceFace.set(key, grid);
  return grid;
}

async function cachedWinQuakeSurface(context, source, bounds, data) {
  const key = source.faceIndex;
  if (context.softwareSurfaceBySourceFace.has(key)) return context.softwareSurfaceBySourceFace.get(key);
  const surface = await buildWinQuakeSurface(source, bounds, data, context.softwareOracle);
  context.softwareSurfaceBySourceFace.set(key, surface);
  return surface;
}

async function buildWinQuakeSurface(source, bounds, data, softwareOracle) {
  const texturemins = [
    Math.floor(bounds.minS / 16) * 16,
    Math.floor(bounds.minT / 16) * 16,
  ];
  const extents = [
    (Math.ceil(bounds.maxS / 16) - Math.floor(bounds.minS / 16)) * 16,
    (Math.ceil(bounds.maxT / 16) - Math.floor(bounds.minT / 16)) * 16,
  ];
  const lightWidth = (extents[0] >> 4) + 1;
  const lightHeight = (extents[1] >> 4) + 1;
  const sampleCount = lightWidth * lightHeight;
  if (softwareOracle) {
    const cache = await softwareOracle.renderMip0({ data, extents, sampleCount, source, texturemins });
    return {
      texturemins,
      ...cache,
    };
  }
  const blocklights = new Int32Array(sampleCount);
  if (source.face.lightOffset >= 0) {
    for (let styleIndex = 0; styleIndex < source.face.styles.length; styleIndex++) {
      const style = source.face.styles[styleIndex];
      if (style === 255) continue;
      const scale = WINQUAKE_LIGHTSTYLE_VALUES.get(style) ?? WINQUAKE_DEFAULT_STYLE_VALUE;
      const base = source.face.lightOffset + styleIndex * sampleCount;
      for (let index = 0; index < sampleCount; index++) {
        blocklights[index] += (data.lighting[base + index] ?? 0) * scale;
      }
    }
  }
  for (let index = 0; index < sampleCount; index++) {
    let light = ((255 * 256 - blocklights[index]) >> (8 - WINQUAKE_VID_CBITS));
    if (light < (1 << WINQUAKE_VID_CBITS)) light = (1 << WINQUAKE_VID_CBITS);
    blocklights[index] = light;
  }
  return {
    texturemins,
    ...buildSoftwareQuakeMip0Cache(source.texture, texturemins, extents, lightWidth, blocklights, data),
  };
}

function buildSoftwareQuakeMip0Cache(texture, texturemins, extents, lightWidth, blocklights, data) {
  const width = extents[0];
  const height = extents[1];
  const cacheData = Buffer.alloc(width * height * 4);
  const numHBlocks = width >> 4;
  const numVBlocks = height >> 4;

  for (let u = 0; u < numHBlocks; u++) {
    for (let v = 0; v < numVBlocks; v++) {
      let lightleft = blocklights[v * lightWidth + u] ?? 0;
      let lightright = blocklights[v * lightWidth + u + 1] ?? lightleft;
      const lightleftstep = ((blocklights[(v + 1) * lightWidth + u] ?? lightleft) - lightleft) >> 4;
      const lightrightstep = ((blocklights[(v + 1) * lightWidth + u + 1] ?? lightright) - lightright) >> 4;

      for (let row = 0; row < 16; row++) {
        const lightstep = (lightleft - lightright) >> 4;
        let light = lightright;
        const y = v * 16 + row;
        const texY = wrappedCoord(texturemins[1] + y, texture.height);
        for (let column = 15; column >= 0; column--) {
          const x = u * 16 + column;
          const texX = wrappedCoord(texturemins[0] + x, texture.width);
          const paletteIndex = texture.pixels[texY * texture.width + texX] ?? 0;
          const colormapOffset = light & 0xFF00;
          const mapped = data.colormap[colormapOffset + paletteIndex] ?? paletteIndex;
          const [r, g, b] = data.palette[mapped] ?? [0, 0, 0];
          const target = (y * width + x) * 4;
          cacheData[target] = r;
          cacheData[target + 1] = g;
          cacheData[target + 2] = b;
          cacheData[target + 3] = 255;
          light += lightstep;
        }
        lightright += lightrightstep;
        lightleft += lightleftstep;
      }
    }
  }

  return { cacheData, cacheHeight: height, cacheWidth: width };
}

function winQuakeRgbAt(surface, s, t) {
  const x = Math.max(0, Math.min(surface.cacheWidth - 1, Math.floor(s - surface.texturemins[0])));
  const y = Math.max(0, Math.min(surface.cacheHeight - 1, Math.floor(t - surface.texturemins[1])));
  const target = (y * surface.cacheWidth + x) * 4;
  return [
    surface.cacheData[target] ?? 0,
    surface.cacheData[target + 1] ?? 0,
    surface.cacheData[target + 2] ?? 0,
  ];
}

async function createSoftwareQuakeSurfaceOracle() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "cssquake-software-oracle-"));
  const sourcePath = path.join(projectRoot, "scripts/native/softwareQuakeSurface.c");
  const binaryPath = path.join(tmp, "softwareQuakeSurface");
  try {
    await execFile("clang", ["-O2", "-std=c99", sourcePath, "-o", binaryPath]);
  } catch (error) {
    await rm(tmp, { recursive: true, force: true });
    throw error;
  }
  const child = spawn(binaryPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  return createSoftwareQuakeSurfaceOracleClient(child, tmp);
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
    const scale = index < styleCount ? (WINQUAKE_LIGHTSTYLE_VALUES.get(style) ?? WINQUAKE_DEFAULT_STYLE_VALUE) : 0;
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

async function renderDeterministicAtlasPage(page) {
  const pageRgba = Buffer.alloc(page.width * page.height * 4);
  for (const tile of page.tiles) {
    const sourceStride = tile.width * 4;
    const targetStride = page.width * 4;
    for (let y = 0; y < tile.height; y++) {
      const sourceStart = y * sourceStride;
      const targetStart = ((tile.y + y) * page.width + tile.x) * 4;
      tile.rgba.copy(pageRgba, targetStart, sourceStart, sourceStart + sourceStride);
    }
  }
  return sharp(pageRgba, { raw: { width: page.width, height: page.height, channels: 4 } })
    .png()
    .toBuffer();
}

function renderDeterministicLeafImage(tile) {
  return sharp(tile.rgba, { raw: { width: tile.width, height: tile.height, channels: 4 } })
    .png()
    .toBuffer();
}

function normalizeDeterministicImagePolicy(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "hybrid" || normalized === "leaf" || normalized === "individual") {
    return normalized === "individual" ? "leaf" : normalized;
  }
  return "atlas";
}

function deterministicTileUsesLeafImage(tile, policy) {
  if (policy === "leaf") return true;
  if (policy !== "hybrid") return false;
  const area = tile.width * tile.height;
  const maxSide = Math.max(tile.width, tile.height);
  const minSide = Math.max(1, Math.min(tile.width, tile.height));
  const aspect = maxSide / minSide;
  return area >= 8192 || maxSide >= 160 || aspect >= 4;
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
    const background = tile.leafImageUrl
      ? `url(&quot;${tile.leafImageUrl}&quot;) 0 0 / 100% 100% no-repeat`
      : deterministicAtlasTileBackground(tile, firstNewAssetIndex);
    const transformedStyle = compensateAtlasLeafTransform(
      style,
      tile.transformCompensationX,
      tile.transformCompensationY,
    );
    const nextStyle = replaceStyleDeclaration(
      replaceStyleDeclaration(
        replaceStyleDeclaration(transformedStyle, "background", background),
        "width",
        `${tile.width}px`,
      ),
      "height",
      `${tile.height}px`,
    );
    return match.replace(`style="${style}"`, `style="${nextStyle}"`);
  });
  return appendRenderBundleBackgroundVars(htmlWithLeaves, pageAssetUrls, firstNewAssetIndex);
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

function replaceStyleDeclaration(style, name, value) {
  const declarations = style.split(";").map((part) => part.trim()).filter(Boolean);
  let replaced = false;
  const next = declarations.map((part) => {
    const separator = part.indexOf(":");
    if (separator <= 0 || part.slice(0, separator).trim() !== name) return part;
    replaced = true;
    return `${name}:${value}`;
  });
  if (!replaced) next.push(`${name}:${value}`);
  return next.join(";");
}

function parseRenderBundleAtlasLeaves(html, metadata) {
  const out = [];
  const tags = [...html.matchAll(/<s\b([^>]*)>/g)];
  for (let index = 0; index < tags.length; index++) {
    const attrs = attributes(tags[index][1]);
    const style = attrs.style ?? "";
    const width = style.match(/(?:^|;)\s*width:\s*(\d+(?:\.\d+)?)px\b/);
    const height = style.match(/(?:^|;)\s*height:\s*(\d+(?:\.\d+)?)px\b/);
    const sizing = atlasLeafSizingFromStyle(style, width?.[1], height?.[1]);
    out.push({
      index,
      metadata: metadata[index],
      ...sizing,
    });
  }
  return out;
}

function atlasLeafSizingFromStyle(style, inlineWidth, inlineHeight) {
  const width = inlineWidth ? Math.max(1, Math.round(Number(inlineWidth))) : null;
  const height = inlineHeight ? Math.max(1, Math.round(Number(inlineHeight))) : null;
  if (width && height) {
    return {
      height,
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
  const afterWidth = width ?? adaptiveQuakeAtlasLeafSide(beforeWidth, matrixScaleX);
  const afterHeight = height ?? adaptiveQuakeAtlasLeafSide(beforeHeight, matrixScaleY);
  return {
    height: afterHeight,
    transformCompensationX: width ? 1 : beforeWidth / afterWidth,
    transformCompensationY: height ? 1 : beforeHeight / afterHeight,
    width: afterWidth,
  };
}

function adaptiveQuakeAtlasLeafSide(beforeSide, matrixScale) {
  const desiredSide = beforeSide * matrixScale;
  const roundedSide = Math.round(desiredSide / QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_STEP) *
    QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_STEP;
  return Math.max(QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_MIN, roundedSide);
}

function compensateAtlasLeafTransform(style, scaleX = 1, scaleY = 1) {
  if (Math.abs(scaleX - 1) <= 1e-9 && Math.abs(scaleY - 1) <= 1e-9) return style;
  const matrix = parseMatrix3dDeclaration(styleDeclarationValue(style, "transform"));
  if (!matrix) return style;
  for (let index = 0; index < 4; index++) matrix[index] *= scaleX;
  for (let index = 4; index < 8; index++) matrix[index] *= scaleY;
  return replaceStyleDeclaration(style, "transform", `matrix3d(${matrix.map(formatCssNumber).join(", ")})`);
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
  if (points.length < 4 || faceFirstTripleAreaSq(points) > 0.000001) return points;
  for (let index = 1; index < points.length; index++) {
    const rotated = [...points.slice(index), ...points.slice(0, index)];
    if (faceFirstTripleAreaSq(rotated) > 0.000001) return rotated;
  }
  return points;
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
  for (let index = 0; index < points.length - 2; index++) {
    const a = points[index];
    const b = points[index + 1];
    const c = points[index + 2];
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const normal = {
      x: ab.y * ac.z - ab.z * ac.y,
      y: ab.z * ac.x - ab.x * ac.z,
      z: ab.x * ac.y - ab.y * ac.x,
    };
    const length = Math.hypot(normal.x, normal.y, normal.z);
    if (length > 0.000001) return { x: normal.x / length, y: normal.y / length, z: normal.z / length };
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

function cssExpectedRawRgbAt(source, s, t, light, data) {
  const paletteIndex = sampleWrappedTextureTexel(source.texture, s, t);
  const [r, g, b] = data.palette[paletteIndex] ?? [0, 0, 0];
  if (paletteIndex >= 224) return [r, g, b];
  return [clampByte(r * light), clampByte(g * light), clampByte(b * light)];
}

function cssExpectedBakedRgbAt(source, bounds, grid, s, t, data) {
  const paletteIndex = sampleWrappedTextureTexel(source.texture, s, t);
  const [r, g, b] = data.palette[paletteIndex] ?? [0, 0, 0];
  if (paletteIndex >= 224) return [r, g, b];
  const light = displayLightBrightness(faceLightmapBrightnessAt(source, bounds, grid, s, t, data));
  return [clampByte(r * light), clampByte(g * light), clampByte(b * light)];
}

function faceLightmapBrightnessAt(source, bounds, grid, s, t, data) {
  const sampleS = s / QUAKE_LIGHT_SAMPLE_SIZE - grid.minS;
  const sampleT = t / QUAKE_LIGHT_SAMPLE_SIZE - grid.minT;
  const x0 = Math.max(0, Math.min(grid.width - 1, Math.floor(sampleS)));
  const y0 = Math.max(0, Math.min(grid.height - 1, Math.floor(sampleT)));
  const x1 = Math.min(grid.width - 1, x0 + 1);
  const y1 = Math.min(grid.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, sampleS - x0));
  const fy = Math.max(0, Math.min(1, sampleT - y0));
  const top = lerp(lightmapSampleBrightness(source, grid, x0, y0, data), lightmapSampleBrightness(source, grid, x1, y0, data), fx);
  const bottom = lerp(lightmapSampleBrightness(source, grid, x0, y1, data), lightmapSampleBrightness(source, grid, x1, y1, data), fx);
  return clampLightBrightness(lerp(top, bottom, fy));
}

function lightmapGrid(source, bounds) {
  const minS = Math.floor(bounds.minS / QUAKE_LIGHT_SAMPLE_SIZE);
  const minT = Math.floor(bounds.minT / QUAKE_LIGHT_SAMPLE_SIZE);
  const width = Math.max(1, Math.ceil(bounds.maxS / QUAKE_LIGHT_SAMPLE_SIZE) - minS + 1);
  const height = Math.max(1, Math.ceil(bounds.maxT / QUAKE_LIGHT_SAMPLE_SIZE) - minT + 1);
  const styles = source.face.styles.filter((style) => style !== 255);
  return { height, minS, minT, sampleCount: width * height, styles, width };
}

function lightmapSampleBrightness(source, grid, x, y, data) {
  const sampleIndex = y * grid.width + x;
  let brightness = 0;
  for (let styleIndex = 0; styleIndex < grid.styles.length; styleIndex++) {
    const offset = source.face.lightOffset + styleIndex * grid.sampleCount + sampleIndex;
    brightness += lightSampleToBrightness(data.lighting[offset] ?? 0) * lightScaleForStyle(grid.styles[styleIndex] ?? 0);
  }
  return clampLightBrightness(brightness);
}

function lightSampleToBrightness(sample) {
  return clampLightBrightness((sample / 128) * QUAKE_LIGHT_SAMPLE_NORMAL_SCALE);
}

function lightScaleForStyle(style) {
  return style === 0 ? QUAKE_LIGHTSTYLE0_SCALE : 1;
}

function displayLightBrightness(brightness) {
  const clamped = clampLightBrightness(brightness);
  return clamped < 1 ? Math.pow(clamped, QUAKE_LIGHT_DISPLAY_GAMMA) : clamped;
}

function clampLightBrightness(value) {
  return Math.max(QUAKE_LIGHT_MIN, Math.min(QUAKE_LIGHT_MAX, value));
}

function sampleWrappedTextureTexel(texture, s, t) {
  const x = wrappedCoord(s, texture.width);
  const y = wrappedCoord(t, texture.height);
  return texture.pixels[y * texture.width + x] ?? 0;
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

function wrappedCoord(value, size) {
  const whole = Math.floor(value);
  return ((whole % size) + size) % size;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
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
