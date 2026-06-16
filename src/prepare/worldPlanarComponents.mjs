import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_SURFACES = new Set(["floor-like", "ceiling-like"]);
const COMPONENT_MIN_LEAVES = 2;
const COMPONENT_MAX_SIDE = 2048;
const COMPONENT_MAX_AREA = 2048 * 2048;
const DEFAULT_COMPONENT_MAX_EXTRA_PIXELS_PER_SAVED_LEAF = 7000;
const RECT_COVER_ENABLED = process.env.QUAKE_WORLD_PLANAR_COMPONENT_RECT_COVER !== "0";
const RECT_COVER_MAX_RECTS = positiveIntegerEnv("QUAKE_WORLD_PLANAR_COMPONENT_RECT_COVER_MAX_RECTS", 4);
const RECT_COVER_MIN_TRANSPARENT_RATIO = positiveNumberEnv(
  "QUAKE_WORLD_PLANAR_COMPONENT_RECT_COVER_MIN_TRANSPARENT_RATIO",
  0.2,
);
const RECT_COVER_MIN_AREA_REDUCTION_RATIO = positiveNumberEnv(
  "QUAKE_WORLD_PLANAR_COMPONENT_RECT_COVER_MIN_AREA_REDUCTION_RATIO",
  0.15,
);
const RECT_COVER_MAX_ADDED_ENTRIES = nonNegativeIntegerEnv(
  "QUAKE_WORLD_PLANAR_COMPONENT_RECT_COVER_MAX_ADDED_ENTRIES",
  3,
);
const RECT_COVER_MIN_SAVED_PIXELS_PER_EXTRA_ENTRY = positiveNumberEnv(
  "QUAKE_WORLD_PLANAR_COMPONENT_RECT_COVER_MIN_SAVED_PIXELS_PER_EXTRA_ENTRY",
  8000,
);
const COMPONENT_MAX_AREA_RATIO = positiveNumberEnv("QUAKE_WORLD_PLANAR_COMPONENT_MAX_AREA_RATIO", Infinity);
const COMPONENT_MAX_EXTRA_PIXELS_PER_SAVED_LEAF = positiveNumberEnv(
  "QUAKE_WORLD_PLANAR_COMPONENT_MAX_EXTRA_PIXELS_PER_SAVED_LEAF",
  DEFAULT_COMPONENT_MAX_EXTRA_PIXELS_PER_SAVED_LEAF,
);

export async function applyQuakeWorldPlanarComponents(prepared, {
  generatedPublicDir,
  mapName,
  outputDir,
  publicPath,
  projectRoot,
} = {}) {
  if (mapName !== "e1m1" || !prepared?.renderBundle || !prepared?.visibility?.metadata?.sourceFaces) {
    return null;
  }
  const renderBundle = prepared.renderBundle;
  if (renderBundle.atlasResidency?.mode !== "pvs-pages") {
    return { enabled: true, skipped: "missing-pvs-pages", components: 0, suppressedLeaves: 0 };
  }
  const elementEntries = parseRenderBundleElementEntries(renderBundle.meshHtml);
  if (elementEntries.length !== renderBundle.leafMetadata.length) {
    throw new Error(
      `Planar component bake expected ${renderBundle.leafMetadata.length} render leaves, got ${elementEntries.length}.`,
    );
  }

  const context = buildPlanarComponentContext(prepared, elementEntries);
  const plan = buildPlanarComponentPlan(context);
  if (!plan.components.length) {
    renderBundle.worldPlanarComponentStats = {
      mode: "e1m1-opaque-floor-ceiling-components",
      components: 0,
      suppressedLeaves: 0,
      coveredRenderFaces: 0,
      skipped: plan.skipped,
    };
    return renderBundle.worldPlanarComponentStats;
  }

  await mkdir(outputDir, { recursive: true });
  const atlasImageByPage = new Map();
  const componentEntries = [];
  const rectCoverStats = createRectCoverStats();
  for (const component of plan.components) {
    const bakedEntries = await bakePlanarComponent(component, {
      atlasImageByPage,
      generatedPublicDir,
      outputDir,
      projectRoot,
      publicPath,
      rectCoverStats,
      renderBundle,
    });
    componentEntries.push(...bakedEntries);
  }

  rewriteRenderBundleWithPlanarComponents(renderBundle, elementEntries, componentEntries);
  renderBundle.worldPlanarComponentStats = {
    mode: "e1m1-opaque-floor-ceiling-components",
    surfaces: [...DEFAULT_SURFACES],
    groups: plan.groups,
    components: componentEntries.length,
    suppressedLeaves: plan.selectedLeafIndexes.size,
    coveredRenderFaces: new Set(componentEntries.flatMap((entry) => entry.metadata.fs)).size,
    costGate: {
      maxAreaRatio: Number.isFinite(COMPONENT_MAX_AREA_RATIO) ? COMPONENT_MAX_AREA_RATIO : null,
      maxExtraPixelsPerSavedLeaf: Number.isFinite(COMPONENT_MAX_EXTRA_PIXELS_PER_SAVED_LEAF)
        ? COMPONENT_MAX_EXTRA_PIXELS_PER_SAVED_LEAF
        : null,
    },
    rectCover: {
      enabled: RECT_COVER_ENABLED,
      maxRects: RECT_COVER_MAX_RECTS,
      maxAddedEntries: RECT_COVER_MAX_ADDED_ENTRIES,
      minTransparentRatio: RECT_COVER_MIN_TRANSPARENT_RATIO,
      minAreaReductionRatio: RECT_COVER_MIN_AREA_REDUCTION_RATIO,
      minSavedPixelsPerExtraEntry: RECT_COVER_MIN_SAVED_PIXELS_PER_EXTRA_ENTRY,
      evaluated: rectCoverStats.evaluated,
      accepted: rectCoverStats.accepted,
      entries: componentEntries.filter((entry) => entry.representation === "rect-cover").length,
      sourceComponents: new Set(
        componentEntries
          .filter((entry) => entry.representation === "rect-cover")
          .map((entry) => entry.componentId),
      ).size,
      addedEntries: rectCoverStats.addedEntries,
      savedPixels: rectCoverStats.savedPixels,
      savedPixelsPerExtraEntry: rectCoverStats.addedEntries > 0
        ? round(rectCoverStats.savedPixels / rectCoverStats.addedEntries)
        : 0,
      splitArea: rectCoverStats.splitArea,
      componentArea: rectCoverStats.componentArea,
      sourceArea: rectCoverStats.sourceArea,
      rejected: Object.fromEntries([...rectCoverStats.rejected.entries()].sort()),
    },
    dynamicLightstyleComponents: componentEntries
      .filter((entry) => lightstyleHasDynamic(entry.metadata.l))
      .length,
    lightstyles: countBy(componentEntries, (entry) => entry.metadata.l),
    textures: countBy(componentEntries, (entry) => entry.texture),
    surfaceTypes: countBy(componentEntries, (entry) => entry.surfaceType),
    skipped: plan.skipped,
  };
  return renderBundle.worldPlanarComponentStats;
}

function buildPlanarComponentContext(prepared, elementEntries) {
  const { renderBundle, visibility } = prepared;
  const sourceFaceByIndex = new Map(visibility.metadata.sourceFaces.map((face) => [face.faceIndex, face]));
  const sourceFacesByRender = new Map((visibility.candidates ?? [])
    .map((candidate) => [candidate.faceIndex, candidate.sourceFaceIndices ?? []]));
  const renderFacesBySource = new Map();
  for (const [renderFaceIndex, sourceFaceIndexes] of sourceFacesByRender) {
    for (const sourceFaceIndex of sourceFaceIndexes) {
      const rows = renderFacesBySource.get(sourceFaceIndex) ?? [];
      rows.push(renderFaceIndex);
      renderFacesBySource.set(sourceFaceIndex, rows);
    }
  }

  const rows = [];
  const skipped = new Map();
  for (let leafIndex = 0; leafIndex < renderBundle.leafMetadata.length; leafIndex++) {
    const metadata = renderBundle.leafMetadata[leafIndex];
    const entry = elementEntries[leafIndex];
    const row = eligiblePlanarComponentRow({
      entry,
      leafIndex,
      metadata,
      renderBundle,
      sourceFaceByIndex,
      sourceFacesByRender,
    });
    if (!row) {
      incrementSkip(skipped, "ineligible");
      continue;
    }
    rows.push(row);
  }
  return {
    renderFacesBySource,
    rows,
    skipped,
  };
}

function eligiblePlanarComponentRow({
  entry,
  leafIndex,
  metadata,
  renderBundle,
  sourceFaceByIndex,
  sourceFacesByRender,
}) {
  if (!metadata || !entry || entry.tagName !== "s") return null;
  if (metadata.m !== 0 || metadata.e !== undefined) return null;
  const texture = String(metadata.t ?? "").toLowerCase();
  if (!texture || isSpecialTexture(texture)) return null;
  const sourceFaceIndexes = sourceFacesByRender.get(metadata.f) ?? [];
  if (sourceFaceIndexes.length !== 1) return null;
  const sourceFaceIndex = sourceFaceIndexes[0];
  const sourceFace = sourceFaceByIndex.get(sourceFaceIndex);
  if (!sourceFace || sourceFace.modelIndex !== 0 || sourceFace.entityIndex !== undefined) return null;
  if (String(sourceFace.texture ?? "").toLowerCase() !== texture) return null;
  const surfaceTypeValue = surfaceType(effectivePlaneNormal(sourceFace));
  if (!DEFAULT_SURFACES.has(surfaceTypeValue)) return null;
  const pageIndex = renderBundle.atlasResidency?.leafPageIndexes?.[leafIndex];
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;
  const matrix = parseMatrix3d(entry.attributes);
  const width = cssNumber(entry.attributes, "width");
  const height = cssNumber(entry.attributes, "height");
  const background = parseBackground(entry.attributes, width, height, renderBundle);
  if (!matrix || !background) return null;
  const axis = planeProjectionAxis(sourceFace.plane?.normal);
  const rect = sourceFaceRect(sourceFace, axis);
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    axis,
    background,
    entry,
    height,
    leafIndex,
    matrix,
    metadata,
    pageIndex,
    rect,
    sourceFace,
    sourceFaceIndex,
    surfaceType: surfaceTypeValue,
    texture,
    width,
  };
}

function buildPlanarComponentPlan(context) {
  const groups = new Map();
  for (const row of context.rows) {
    const key = [
      row.sourceFace.planeIndex,
      row.sourceFace.side,
      row.texture,
      row.surfaceType,
      row.axis.u,
      row.axis.v,
    ].join("|");
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }

  const components = [];
  const selectedLeafIndexes = new Set();
  const skipped = new Map(context.skipped);
  for (const rows of groups.values()) {
    for (const componentRows of connectedComponents(rows)) {
      if (componentRows.length < COMPONENT_MIN_LEAVES) {
        incrementSkip(skipped, "singleton-component");
        continue;
      }
      const component = createPlanarComponent(componentRows, context);
      if (component.pixelWidth > COMPONENT_MAX_SIDE || component.pixelHeight > COMPONENT_MAX_SIDE) {
        incrementSkip(skipped, "component-side-too-large");
        continue;
      }
      if (component.pixelWidth * component.pixelHeight > COMPONENT_MAX_AREA) {
        incrementSkip(skipped, "component-area-too-large");
        continue;
      }
      if (component.areaRatio > COMPONENT_MAX_AREA_RATIO) {
        incrementSkip(skipped, "component-area-ratio-too-large");
        continue;
      }
      if (component.extraPixelsPerSavedLeaf > COMPONENT_MAX_EXTRA_PIXELS_PER_SAVED_LEAF) {
        incrementSkip(skipped, "component-extra-pixels-per-saved-leaf-too-large");
        continue;
      }
      components.push(component);
      for (const row of componentRows) selectedLeafIndexes.add(row.leafIndex);
    }
  }

  components.sort((a, b) => a.insertAt - b.insertAt || a.id.localeCompare(b.id));
  components.forEach((component, index) => {
    component.index = index;
    component.id = `${component.id}-c${index}`;
  });
  return {
    components,
    groups: groups.size,
    selectedLeafIndexes,
    skipped: Object.fromEntries([...skipped.entries()].sort()),
  };
}

function createPlanarComponent(rows, context) {
  rows.sort((a, b) => a.sourceFaceIndex - b.sourceFaceIndex || a.leafIndex - b.leafIndex);
  const first = rows[0];
  const placement = componentPlacement(rows);
  if (!placement) return null;
  const sourceArea = rows.reduce((total, row) => total + (row.width * row.height), 0);
  const componentArea = Math.max(1, Math.ceil(placement.width) * Math.ceil(placement.height));
  const savedLeaves = Math.max(0, rows.length - 1);
  const areaDelta = componentArea - sourceArea;
  const renderFaceIndexes = rows
    .flatMap((row) => context.renderFacesBySource.get(row.sourceFaceIndex) ?? [])
    .sort((a, b) => a - b);
  const planeIndex = first.sourceFace.planeIndex;
  const side = first.sourceFace.side;
  const id = [
    "e1m1",
    first.surfaceType.replace(/-like$/u, ""),
    `p${planeIndex}`,
    `s${side}`,
    safeName(first.texture),
  ].join("-");
  return {
    axis: first.axis,
    areaRatio: sourceArea > 0 ? componentArea / sourceArea : Infinity,
    bounds: placement.bounds,
    componentArea,
    areaDelta,
    extraPixelsPerSavedLeaf: savedLeaves > 0 ? areaDelta / savedLeaves : Infinity,
    height: placement.height,
    id,
    index: 0,
    insertAt: Math.min(...rows.map((row) => row.leafIndex)),
    metadata: {
      f: renderFaceIndexes[0],
      fs: renderFaceIndexes,
      m: 0,
      t: first.texture,
      l: componentLightstyleValue(rows),
    },
    pixelHeight: Math.max(1, Math.ceil(placement.height)),
    pixelWidth: Math.max(1, Math.ceil(placement.width)),
    planeIndex,
    placement,
    rows,
    side,
    leafIndexes: rows.map((row) => row.leafIndex).sort((a, b) => a - b),
    sourceFaceIndexes: rows.map((row) => row.sourceFaceIndex).sort((a, b) => a - b),
    sourceArea,
    surfaceType: first.surfaceType,
    texture: first.texture,
    transform: placement.transform,
    width: placement.width,
  };
}

async function bakePlanarComponent(component, {
  atlasImageByPage,
  generatedPublicDir,
  outputDir,
  projectRoot,
  publicPath,
  rectCoverStats,
  renderBundle,
}) {
  const canvas = createCanvas(component.pixelWidth, component.pixelHeight);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  for (const row of component.rows) {
    await drawLeaf(
      ctx,
      row,
      component.placement,
      renderBundle,
      atlasImageByPage,
      generatedPublicDir,
      projectRoot,
    );
  }
  const rectCover = RECT_COVER_ENABLED ? opaqueRectCoverForComponent(canvas, component, rectCoverStats) : null;
  if (rectCover) {
    return writePlanarComponentRectCover(component, canvas, rectCover, outputDir, publicPath);
  }
  return [await writePlanarComponentImage(component, canvas, outputDir, publicPath)];
}

async function writePlanarComponentImage(component, canvas, outputDir, publicPath) {
  const filename = `pc-${safeName(component.id)}.png`;
  const url = `${publicPath}/${filename}`;
  await writeFile(path.join(outputDir, filename), canvas.toBuffer("image/png"));
  const style = [
    `transform:${matrix3dStyle(component.transform)}`,
    `width:${round(component.width)}px`,
    `height:${round(component.height)}px`,
    `background:url(${url}) 0px 0px / ${round(component.width)}px ${round(component.height)}px no-repeat`,
  ].join(";");
  return {
    componentId: component.id,
    insertAt: component.insertAt,
    leafIndexes: component.leafIndexes,
    metadata: component.metadata,
    representation: "alpha-rect",
    sourceFaceIndexes: component.sourceFaceIndexes,
    surfaceType: component.surfaceType,
    tag: `<s data-planar-component="${component.id}" data-planar-surface="${component.surfaceType}" style="${style}"></s>`,
    texture: component.texture,
    url,
  };
}

async function writePlanarComponentRectCover(component, canvas, rectCover, outputDir, publicPath) {
  const entries = [];
  for (let index = 0; index < rectCover.rects.length; index++) {
    const rect = rectCover.rects[index];
    const childCanvas = createCanvas(rect.width, rect.height);
    const childCtx = childCanvas.getContext("2d");
    childCtx.imageSmoothingEnabled = false;
    childCtx.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    const childId = `${component.id}-r${index}`;
    const filename = `pc-${safeName(childId)}.png`;
    const url = `${publicPath}/${filename}`;
    await writeFile(path.join(outputDir, filename), childCanvas.toBuffer("image/png"));
    const transform = offsetTransform(component.transform, rect.x, rect.y);
    const style = [
      `transform:${matrix3dStyle(transform)}`,
      `width:${round(rect.width)}px`,
      `height:${round(rect.height)}px`,
      `background:url(${url}) 0px 0px / ${round(rect.width)}px ${round(rect.height)}px no-repeat`,
    ].join(";");
    entries.push({
      componentId: component.id,
      insertAt: component.insertAt,
      leafIndexes: component.leafIndexes,
      metadata: component.metadata,
      representation: "rect-cover",
      sourceFaceIndexes: component.sourceFaceIndexes,
      surfaceType: component.surfaceType,
      tag: `<s data-planar-component="${childId}" data-planar-parent-component="${component.id}" data-planar-representation="rect-cover" data-planar-surface="${component.surfaceType}" style="${style}"></s>`,
      texture: component.texture,
      url,
    });
  }
  return entries;
}

function opaqueRectCoverForComponent(canvas, component, stats) {
  stats.evaluated++;
  const reject = (reason) => {
    incrementSkip(stats.rejected, reason);
    return null;
  };
  if (RECT_COVER_MAX_RECTS < 2) return reject("max-rects-too-low");
  if (RECT_COVER_MAX_ADDED_ENTRIES <= 0) return reject("added-entries-disabled");
  if (component.rows.length <= 2) return reject("not-enough-source-leaves");
  const ctx = canvas.getContext("2d");
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const mask = new Uint8Array(width * height);
  let opaquePixels = 0;
  for (let index = 0; index < width * height; index++) {
    if (data[index * 4 + 3] === 0) continue;
    mask[index] = 1;
    opaquePixels++;
  }
  if (opaquePixels <= 0) return reject("empty-opaque-mask");
  const componentArea = width * height;
  const transparentRatio = (componentArea - opaquePixels) / componentArea;
  if (transparentRatio < RECT_COVER_MIN_TRANSPARENT_RATIO) return reject("transparent-ratio-too-low");

  const cover = greedyOpaqueRectCover(mask, width, height, opaquePixels, RECT_COVER_MAX_RECTS);
  if (!cover || cover.coveredPixels !== opaquePixels) return reject("no-exact-opaque-rect-cover");
  if (cover.rects.length < 2) return reject("single-rect-cover");
  const addedEntries = cover.rects.length - 1;
  if (addedEntries > RECT_COVER_MAX_ADDED_ENTRIES) return reject("too-many-added-entries");
  const savedLeaves = component.rows.length - cover.rects.length;
  if (savedLeaves <= 0) return reject("no-leaf-savings");
  const splitArea = cover.rects.reduce((total, rect) => total + rect.width * rect.height, 0);
  const areaReductionRatio = (componentArea - splitArea) / componentArea;
  if (areaReductionRatio < RECT_COVER_MIN_AREA_REDUCTION_RATIO) return reject("area-reduction-too-low");
  const savedPixels = componentArea - splitArea;
  const savedPixelsPerExtraEntry = savedPixels / addedEntries;
  if (savedPixelsPerExtraEntry < RECT_COVER_MIN_SAVED_PIXELS_PER_EXTRA_ENTRY) {
    return reject("saved-pixels-per-extra-entry-too-low");
  }
  const splitExtraPixelsPerSavedLeaf = (splitArea - component.sourceArea) / savedLeaves;
  if (splitExtraPixelsPerSavedLeaf > component.extraPixelsPerSavedLeaf) {
    return reject("split-extra-pixels-worse-than-parent");
  }
  if (splitExtraPixelsPerSavedLeaf > COMPONENT_MAX_EXTRA_PIXELS_PER_SAVED_LEAF) {
    return reject("split-extra-pixels-per-saved-leaf-too-large");
  }
  stats.accepted++;
  stats.addedEntries += addedEntries;
  stats.componentArea += componentArea;
  stats.savedPixels += savedPixels;
  stats.sourceArea += component.sourceArea;
  stats.splitArea += splitArea;
  return {
    ...cover,
    addedEntries,
    areaReductionRatio,
    savedPixels,
    savedPixelsPerExtraEntry,
    splitArea,
    splitExtraPixelsPerSavedLeaf,
    transparentRatio,
  };
}

function greedyOpaqueRectCover(mask, width, height, opaquePixels, maxRects) {
  const covered = new Uint8Array(width * height);
  const rects = [];
  let coveredPixels = 0;
  for (let pass = 0; pass < maxRects && coveredPixels < opaquePixels; pass++) {
    const coveredPrefix = rectCoverPrefix(covered, width, height);
    const rect = largestUsefulOpaqueRect(mask, coveredPrefix, width, height);
    if (!rect || rect.newPixels <= 0) break;
    rects.push(rect);
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      const rowOffset = y * width;
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const index = rowOffset + x;
        if (!mask[index] || covered[index]) continue;
        covered[index] = 1;
        coveredPixels++;
      }
    }
  }
  if (coveredPixels !== opaquePixels) return null;
  return {
    coveredPixels,
    rects: rects.map(({ x, y, width: rectWidth, height: rectHeight }) => ({
      x,
      y,
      width: rectWidth,
      height: rectHeight,
    })),
  };
}

function largestUsefulOpaqueRect(mask, coveredPrefix, width, height) {
  const heights = new Int32Array(width);
  let best = null;
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      heights[x] = mask[rowOffset + x] ? heights[x] + 1 : 0;
    }
    const stack = [];
    for (let x = 0; x <= width; x++) {
      const currentHeight = x < width ? heights[x] : 0;
      let start = x;
      while (stack.length && stack[stack.length - 1].height > currentHeight) {
        const item = stack.pop();
        const rectWidth = x - item.start;
        const rectHeight = item.height;
        const rectX = item.start;
        const rectY = y - rectHeight + 1;
        const area = rectWidth * rectHeight;
        const newPixels = area - rectSum(coveredPrefix, width, rectX, rectY, rectWidth, rectHeight);
        if (newPixels > 0 && betterOpaqueRect({ area, height: rectHeight, newPixels, width: rectWidth }, best)) {
          best = {
            area,
            height: rectHeight,
            newPixels,
            width: rectWidth,
            x: rectX,
            y: rectY,
          };
        }
        start = item.start;
      }
      if (!stack.length || stack[stack.length - 1].height < currentHeight) {
        stack.push({ height: currentHeight, start });
      }
    }
  }
  return best;
}

function betterOpaqueRect(candidate, best) {
  if (!best) return true;
  if (candidate.newPixels !== best.newPixels) return candidate.newPixels > best.newPixels;
  const candidateWaste = candidate.area - candidate.newPixels;
  const bestWaste = best.area - best.newPixels;
  if (candidateWaste !== bestWaste) return candidateWaste < bestWaste;
  return candidate.area > best.area;
}

function rectCoverPrefix(values, width, height) {
  const prefix = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += values[y * width + x];
      prefix[(y + 1) * (width + 1) + x + 1] = prefix[y * (width + 1) + x + 1] + rowSum;
    }
  }
  return prefix;
}

function rectSum(prefix, width, x, y, rectWidth, rectHeight) {
  const stride = width + 1;
  const x2 = x + rectWidth;
  const y2 = y + rectHeight;
  return prefix[y2 * stride + x2] - prefix[y * stride + x2] -
    prefix[y2 * stride + x] + prefix[y * stride + x];
}

function createRectCoverStats() {
  return {
    accepted: 0,
    addedEntries: 0,
    componentArea: 0,
    evaluated: 0,
    rejected: new Map(),
    savedPixels: 0,
    sourceArea: 0,
    splitArea: 0,
  };
}

function offsetTransform(transform, x, y) {
  const next = [...transform];
  next[12] += transform[0] * x + transform[4] * y;
  next[13] += transform[1] * x + transform[5] * y;
  next[14] += transform[2] * x + transform[6] * y;
  return next;
}

function rewriteRenderBundleWithPlanarComponents(renderBundle, elementEntries, componentEntries) {
  const selectedLeafIndexes = new Set(componentEntries.flatMap((entry) => entry.leafIndexes));
  const insertByLeafIndex = new Map();
  for (const entry of componentEntries) {
    const list = insertByLeafIndex.get(entry.insertAt) ?? [];
    list.push(entry);
    insertByLeafIndex.set(entry.insertAt, list);
  }

  const nextElements = [];
  const nextMetadata = [];
  const nextLeafPageIndexes = [];
  for (let leafIndex = 0; leafIndex < elementEntries.length; leafIndex++) {
    for (const insert of insertByLeafIndex.get(leafIndex) ?? []) {
      nextElements.push(insert.tag);
      nextMetadata.push(insert.metadata);
      nextLeafPageIndexes.push(-1);
    }
    if (selectedLeafIndexes.has(leafIndex)) continue;
    nextElements.push(elementEntries[leafIndex].source);
    nextMetadata.push(renderBundle.leafMetadata[leafIndex]);
    nextLeafPageIndexes.push(renderBundle.atlasResidency?.leafPageIndexes?.[leafIndex] ?? -1);
  }

  renderBundle.meshHtml = `<div class="polycss-mesh">${nextElements.join("")}</div>`;
  renderBundle.leafMetadata = nextMetadata;
  renderBundle.leafCount = nextMetadata.length;
  renderBundle.polygonCount = Math.max(0, (renderBundle.polygonCount ?? nextMetadata.length) -
    selectedLeafIndexes.size + componentEntries.length);
  renderBundle.atlasLeafCount = Math.max(0, (renderBundle.atlasLeafCount ?? nextMetadata.length) -
    selectedLeafIndexes.size + componentEntries.length);
  renderBundle.atlasResidency = {
    ...renderBundle.atlasResidency,
    leafPageIndexes: nextLeafPageIndexes,
  };
  renderBundle.assetUrls = [...new Set([...(renderBundle.assetUrls ?? []), ...componentEntries.map((entry) => entry.url)])];
}

async function drawLeaf(ctx, row, placement, renderBundle, atlasImageByPage, generatedPublicDir, projectRoot) {
  const image = await atlasImage(row.pageIndex, renderBundle, atlasImageByPage, generatedPublicDir, projectRoot);
  const { sx, sy, sw, sh } = row.background;
  const matrix = rowLocalMatrix(row.matrix, placement);
  ctx.save();
  ctx.setTransform(matrix[0], matrix[1], matrix[4], matrix[5], matrix[12], matrix[13]);
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, row.width, row.height);
  ctx.restore();
}

async function atlasImage(pageIndex, renderBundle, atlasImageByPage, generatedPublicDir, projectRoot) {
  const cached = atlasImageByPage.get(pageIndex);
  if (cached) return cached;
  const page = renderBundle.atlasResidency?.pages?.find((candidate) => candidate.index === pageIndex);
  if (!page) throw new Error(`Missing atlas page ${pageIndex}`);
  const file = path.join(generatedPublicDir ?? path.join(projectRoot, "build/generated/public"), page.url.replace(/^\//u, ""));
  const image = await loadImage(file);
  atlasImageByPage.set(pageIndex, image);
  return image;
}

function componentPlacement(rows) {
  const candidates = componentBasisCandidates(rows);
  let best = null;
  for (const candidate of candidates) {
    const bounds = componentLocalBounds(rows, candidate);
    if (!bounds) continue;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (width <= 0 || height <= 0) continue;
    const area = width * height;
    if (best && area >= best.area) continue;
    const origin = vecAdd(candidate.origin, vecAdd(vecScale(candidate.xAxis, bounds.minX), vecScale(candidate.yAxis, bounds.minY)));
    const transform = [
      candidate.xAxis.x, candidate.xAxis.y, candidate.xAxis.z, 0,
      candidate.yAxis.x, candidate.yAxis.y, candidate.yAxis.z, 0,
      candidate.normal.x, candidate.normal.y, candidate.normal.z, 0,
      origin.x, origin.y, origin.z, 1,
    ];
    best = {
      ...candidate,
      area,
      bounds,
      height,
      origin,
      transform,
      width,
    };
  }
  return best;
}

function componentBasisCandidates(rows) {
  const candidates = [];
  const seen = new Set();
  for (const row of [...rows].sort((a, b) => (b.width * b.height) - (a.width * a.height))) {
    const xAxis = vectorFromMatrixColumn(row.matrix, 0);
    const yAxis = vectorFromMatrixColumn(row.matrix, 4);
    const xLength = vecLength(xAxis);
    const yLength = vecLength(yAxis);
    if (xLength <= 0 || yLength <= 0) continue;
    const normal = vecNormalize(vecCross(xAxis, yAxis));
    if (!normal) continue;
    const key = [
      round(xAxis.x, 4),
      round(xAxis.y, 4),
      round(xAxis.z, 4),
      round(yAxis.x, 4),
      round(yAxis.y, 4),
      round(yAxis.z, 4),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      normal,
      origin: matrixTranslation(row.matrix),
      xAxis,
      xLengthSq: vecDot(xAxis, xAxis),
      yAxis,
      yLengthSq: vecDot(yAxis, yAxis),
    });
  }
  return candidates;
}

function componentLocalBounds(rows, basis) {
  const points = rows.flatMap((row) => [
    rowLocalPoint(row.matrix, 0, 0, basis),
    rowLocalPoint(row.matrix, row.width, 0, basis),
    rowLocalPoint(row.matrix, 0, row.height, basis),
    rowLocalPoint(row.matrix, row.width, row.height, basis),
  ]);
  if (!points.length || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function rowLocalMatrix(matrix, placement) {
  const xColumn = projectVectorToBasis(vectorFromMatrixColumn(matrix, 0), placement);
  const yColumn = projectVectorToBasis(vectorFromMatrixColumn(matrix, 4), placement);
  const translation = projectPointToBasis(matrixTranslation(matrix), placement);
  return [
    xColumn.x, xColumn.y, 0, 0,
    yColumn.x, yColumn.y, 0, 0,
    0, 0, 1, 0,
    translation.x, translation.y, 0, 1,
  ];
}

function rowLocalPoint(matrix, x, y, basis) {
  return projectPointToBasis(transformPoint(matrix, x, y), basis);
}

function projectPointToBasis(point, basis) {
  return projectVectorToBasis(vecSub(point, basis.origin), basis);
}

function projectVectorToBasis(vector, basis) {
  return {
    x: vecDot(vector, basis.xAxis) / basis.xLengthSq,
    y: vecDot(vector, basis.yAxis) / basis.yLengthSq,
  };
}

function transformPoint(matrix, x, y) {
  return {
    x: matrix[0] * x + matrix[4] * y + matrix[12],
    y: matrix[1] * x + matrix[5] * y + matrix[13],
    z: matrix[2] * x + matrix[6] * y + matrix[14],
  };
}

function vectorFromMatrixColumn(matrix, offset) {
  return {
    x: Number(matrix[offset] ?? 0),
    y: Number(matrix[offset + 1] ?? 0),
    z: Number(matrix[offset + 2] ?? 0),
  };
}

function matrixTranslation(matrix) {
  return {
    x: Number(matrix[12] ?? 0),
    y: Number(matrix[13] ?? 0),
    z: Number(matrix[14] ?? 0),
  };
}

function vecAdd(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function vecSub(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function vecScale(vector, scale) {
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  };
}

function vecDot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vecCross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function vecLength(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function vecNormalize(vector) {
  const length = vecLength(vector);
  if (length <= 0) return null;
  return vecScale(vector, 1 / length);
}

function parseRenderBundleElementEntries(meshHtml) {
  const entries = [];
  const regex = /<([bisu])\b([^>]*)><\/\1>|<([bisu])\b([^>]*)>/g;
  let match;
  while ((match = regex.exec(meshHtml))) {
    entries.push({
      attributes: match[2] ?? match[4] ?? "",
      source: match[0],
      tagName: match[1] ?? match[3],
    });
  }
  return entries;
}

function parseMatrix3d(attributes) {
  const raw = /\bstyle="[^"]*transform:matrix3d\(([^)]*)\)/u.exec(attributes)?.[1];
  if (!raw) return null;
  const values = raw.split(",").map((part) => Number(part.trim()));
  return values.length === 16 && values.every(Number.isFinite) ? values : null;
}

function parseBackground(attributes, fallbackWidth, fallbackHeight, renderBundle) {
  const match = /\bstyle="[^"]*background:var\(--bg(\d+)\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+\/\s+([\d.]+)px\s+([\d.]+)px/u
    .exec(attributes);
  if (!match) return null;
  const pageIndex = Number(match[1]);
  const page = renderBundle.atlasResidency?.pages?.find((candidate) => candidate.index === pageIndex);
  const bgWidth = Number(match[4]);
  const bgHeight = Number(match[5]);
  const naturalWidth = Number(page?.width ?? bgWidth);
  const naturalHeight = Number(page?.height ?? bgHeight);
  const scaleX = naturalWidth / bgWidth;
  const scaleY = naturalHeight / bgHeight;
  return {
    sx: -Number(match[2]) * scaleX,
    sy: -Number(match[3]) * scaleY,
    sw: fallbackWidth * scaleX,
    sh: fallbackHeight * scaleY,
  };
}

function cssNumber(attributes, property) {
  const raw = new RegExp(`${property}:(-?[\\d.]+)px`, "u").exec(attributes)?.[1];
  const value = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Could not parse ${property} from ${attributes}`);
  return value;
}

function connectedComponents(rectRows) {
  const remaining = new Set(rectRows);
  const components = [];
  while (remaining.size) {
    const first = remaining.values().next().value;
    remaining.delete(first);
    const component = [first];
    const queue = [first];
    while (queue.length) {
      const current = queue.pop();
      for (const candidate of [...remaining]) {
        if (!rectsTouchOrOverlap(current.rect, candidate.rect)) continue;
        remaining.delete(candidate);
        component.push(candidate);
        queue.push(candidate);
      }
    }
    components.push(component);
  }
  return components;
}

function sourceFaceRect(sourceFace, axis) {
  const mins = sourceFace.bounds?.mins ?? {};
  const maxs = sourceFace.bounds?.maxs ?? {};
  return normalizeRect({
    minU: Number(mins[axis.u] ?? 0),
    minV: Number(mins[axis.v] ?? 0),
    maxU: Number(maxs[axis.u] ?? 0),
    maxV: Number(maxs[axis.v] ?? 0),
  });
}

function planeProjectionAxis(normal = {}) {
  const axes = [
    ["x", Math.abs(Number(normal.x ?? 0))],
    ["y", Math.abs(Number(normal.y ?? 0))],
    ["z", Math.abs(Number(normal.z ?? 0))],
  ].sort((a, b) => b[1] - a[1]);
  const dropped = axes[0]?.[0] ?? "z";
  const kept = ["x", "y", "z"].filter((axis) => axis !== dropped);
  return { dropped, u: kept[0], v: kept[1] };
}

function surfaceType(normal = {}) {
  const z = Number(normal.z ?? 0);
  if (z > 0.7) return "floor-like";
  if (z < -0.7) return "ceiling-like";
  return "wall-like";
}

function effectivePlaneNormal(sourceFace) {
  const normal = sourceFace?.plane?.normal ?? {};
  const sign = sourceFace?.side === 1 ? -1 : 1;
  return {
    x: Number(normal.x ?? 0) * sign,
    y: Number(normal.y ?? 0) * sign,
    z: Number(normal.z ?? 0) * sign,
  };
}

function isSpecialTexture(name) {
  return name.startsWith("sky") || name.startsWith("*") || name.startsWith("+");
}

function componentLightstyleValue(rows) {
  const styles = new Set();
  for (const row of rows) {
    for (const style of lightstyleValues(row.metadata.l)) styles.add(style);
  }
  return [...styles].sort((a, b) => a - b).join(",");
}

function lightstyle0Only(value) {
  const styles = lightstyleValues(value);
  return styles.length === 1 && styles[0] === 0;
}

function lightstyleHasDynamic(value) {
  return lightstyleValues(value).some((style) => style !== 0);
}

function lightstyleValues(value) {
  if (value === undefined || value === null || value === "") return [];
  return String(value)
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((style) => Number.isInteger(style));
}

function normalizeRect(rect) {
  const minU = Math.min(rect.minU, rect.maxU);
  const maxU = Math.max(rect.minU, rect.maxU);
  const minV = Math.min(rect.minV, rect.maxV);
  const maxV = Math.max(rect.minV, rect.maxV);
  return {
    minU,
    minV,
    maxU,
    maxV,
    width: maxU - minU,
    height: maxV - minV,
  };
}

function boundingRect(rects) {
  return normalizeRect({
    minU: Math.min(...rects.map((rect) => rect.minU)),
    minV: Math.min(...rects.map((rect) => rect.minV)),
    maxU: Math.max(...rects.map((rect) => rect.maxU)),
    maxV: Math.max(...rects.map((rect) => rect.maxV)),
  });
}

function rectsTouchOrOverlap(a, b) {
  return a.minU <= b.maxU && a.maxU >= b.minU && a.minV <= b.maxV && a.maxV >= b.minV;
}

function matrix3dStyle(matrix) {
  return `matrix3d(${matrix.map((value) => round(value)).join(", ")})`;
}

function safeName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "component";
}

function countBy(values, keyFor) {
  const counts = {};
  for (const value of values) {
    const key = String(keyFor(value));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function incrementSkip(skipped, reason) {
  skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
}

function positiveNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveIntegerEnv(name, fallback) {
  const value = positiveNumberEnv(name, fallback);
  return Number.isInteger(value) ? value : fallback;
}

function nonNegativeIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
