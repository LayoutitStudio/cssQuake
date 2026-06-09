import {
  BASE_TILE,
  SOLID_QUAD_CANONICAL_SIZE,
  computeProjectiveQuadMatrix,
  computeTextureAtlasPlanPublic,
  createPolyPerspectiveCamera,
  createPolyScene,
  resolveProjectiveQuadGuards,
  stableBasisFromPlan,
} from "@layoutit/polycss";

import { QUAKE_RENDER_SUPERSAMPLE } from "../quakeScale.js";

const QUAKE_CAMERA_ZOOM = (BASE_TILE * 0.65) / QUAKE_RENDER_SUPERSAMPLE;
const QUAKE_RENDER_BUNDLE_TIMEOUT_MS = 30000;
const QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_MIN = 1;
const QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_STEP = 1;
const QUAKE_MATRIX_LINEAR_SNAP_EPSILON = 0.0015;
const QUAKE_MATRIX_TRANSLATION_SNAP_EPSILON = 0.012;
const QUAKE_MATRIX_TRANSLATION_SNAP_GRID = 0.125;
const QUAKE_MATRIX_LINEAR_SNAP_TARGETS = [-1, -0.5, -0.25, -0.125, 0, 0.125, 0.25, 0.5, 1];
const QUAKE_ATLAS_HOMOGRAPHY_AREA_PAD = 1.04;
const QUAKE_ATLAS_HOMOGRAPHY_MIN_SAVED_AREA = 256;
const QUAKE_ATLAS_HOMOGRAPHY_MIN_SAVED_RATIO = 0.08;
const QUAKE_ANIMATED_ATLAS_HOMOGRAPHY_MIN_SAVED_AREA = 1;
const QUAKE_ANIMATED_ATLAS_HOMOGRAPHY_MIN_SAVED_RATIO = 0.01;
const QUAKE_ATLAS_HOMOGRAPHY_MIN_SIDE = 4;
const QUAKE_ATLAS_HOMOGRAPHY_MAX_SIDE_RATIO = 2;
const QUAKE_ATLAS_HOMOGRAPHY_PAGE_SIZE = 4096;
const QUAKE_ATLAS_HOMOGRAPHY_PAGE_PADDING = 1;
const QUAKE_ATLAS_HOMOGRAPHY_MATRIX_EPSILON = 0.075;
const QUAKE_ATLAS_HOMOGRAPHY_MIN_CORNER_W = 0.05;
const QUAKE_ATLAS_HOMOGRAPHY_GUARDS = resolveProjectiveQuadGuards({ bleed: 0 });
const QUAKE_POLYCSS_PROJECTIVE_QUAD_GUARDS = { bleed: 0 };
const QUAKE_TRIANGLE_ATLAS_BASIS_ANGLE_STEP_DEGREES = 5;
const QUAKE_TRIANGLE_ATLAS_BASIS_PADDING = 1;
const QUAKE_TRIANGLE_ATLAS_BASIS_MIN_SAVED_AREA = 4;
const QUAKE_TRIANGLE_ATLAS_BASIS_MIN_SAVED_RATIO = 0.01;

window.__buildQuakeRenderBundle = async function buildQuakeRenderBundle({
  polygons,
  textureQuality = 1,
  merge = false,
  extractLeafStyles = false,
  styleClassName = "",
  tightenAtlasLeaves = false,
  adaptiveAtlasLeafSize = false,
  optimizeAtlasLeafBasis = false,
  optimizeAtlasLeafHomography = false,
  skipAssetPayloads = false,
  layoutOnly = false,
}) {
  const host = createQuakeRenderHost();

  try {
    const scene = runQuakeRenderBundleStep("scene-create", () =>
      createQuakeRenderScene(host, textureQuality)
    );
    const atlasLeafBasisOptimization = runQuakeRenderBundleStep("basis-optimize", () =>
      optimizeAtlasLeafBasis ? optimizeQuakeAtlasLeafBasisPolygons(polygons) : null
    );
    let renderPolygons = atlasLeafBasisOptimization?.polygons ?? polygons;
    const handle = runQuakeRenderBundleStep("scene-add-polygons", () =>
      scene.add(
        {
          polygons: renderPolygons,
          objectUrls: [],
          warnings: [],
          dispose: () => undefined,
        },
        {
          merge,
          meshResolution: "lossless",
          excludeFromAutoCenter: true,
        },
      )
    );

    const canOptimizeAtlasLeafHomography = optimizeAtlasLeafHomography && !layoutOnly;
    const needsTextureLeaves = !layoutOnly || canOptimizeAtlasLeafHomography;
    if (needsTextureLeaves) {
      await runQuakeRenderBundleStepAsync("texture-wait", () =>
        waitForBakedTextureLeaves(handle.element)
      );
    }
    const atlasLeafHomographyOptimizationStats = await runQuakeRenderBundleStepAsync("homography-optimize", () =>
      canOptimizeAtlasLeafHomography
        ? optimizeQuakeAtlasLeafHomography(handle.element, renderPolygons)
        : null
    );
    await runQuakeRenderBundleStepAsync("tighten-atlas", () =>
      tightenAtlasLeaves && !layoutOnly ? tightenQuakeAtlasLeaves(handle.element) : null
    );
    const adaptiveAtlasLeafSizeStats = runQuakeRenderBundleStep("adaptive-atlas-size", () =>
      adaptiveAtlasLeafSize ? applyAdaptiveQuakeAtlasLeafSizes(handle.element) : null
    );
    const transformSnapStats = runQuakeRenderBundleStep("snap-transforms", () =>
      snapQuakeLeafTransformsToStableGrid(handle.element)
    );
    const atlasBackgroundSnapStats = runQuakeRenderBundleStep("snap-backgrounds", () =>
      layoutOnly ? null : snapQuakeAtlasLeafBackgroundsToIntegerPx(handle.element)
    );
    const layoutOnlyPendingStyleStats = runQuakeRenderBundleStep("clear-layout-only-pending-styles", () =>
      layoutOnly ? clearQuakeLayoutOnlyPendingLeafStyles(handle.element) : null
    );
    const { meshHtml, meshCss, assets, leafMetadata, leafFrameStyles } = await runQuakeRenderBundleStepAsync("serialize",
      () => serializeMeshWithAssets(handle.element, {
      extractLeafStyles,
      skipBackgroundAssetExtraction: layoutOnly,
      skipAssetPayloads: skipAssetPayloads || layoutOnly,
      styleClassName,
      mutateOriginal: true,
    }));
    const leafCount = handle.element.querySelectorAll("b,i,s,u").length;
    const atlasLeafCount = handle.element.querySelectorAll("s").length;
    if (layoutOnly) {
      runQuakeRenderBundleStep("dispose-layout-only-handle", () => handle.dispose?.());
    }
    return {
      meshHtml,
      meshCss,
      assets,
      leafMetadata,
      leafFrameStyles,
      leafCount,
      atlasLeafCount,
      polygonCount: renderPolygons.length,
      ...(adaptiveAtlasLeafSizeStats ? { adaptiveAtlasLeafSizeStats } : {}),
      ...(transformSnapStats.snappedLeaves || transformSnapStats.precisionLeaves ? { transformSnapStats } : {}),
      ...(atlasBackgroundSnapStats?.snappedLeaves ? { atlasBackgroundSnapStats } : {}),
      ...(layoutOnlyPendingStyleStats?.clearedOpacityLeaves ? { layoutOnlyPendingStyleStats } : {}),
      ...(atlasLeafBasisOptimization?.stats?.rotatedPolygons
        ? { atlasLeafBasisOptimizationStats: atlasLeafBasisOptimization.stats }
        : {}),
      ...(atlasLeafHomographyOptimizationStats?.optimizedLeaves
        ? { atlasLeafHomographyOptimizationStats }
        : {}),
    };
  } finally {
    host.remove();
  }
};

window.__buildQuakeAnimatedRenderBundle = async function buildQuakeAnimatedRenderBundle({
  frames,
  textureQuality = 1,
  extractLeafStyles = true,
  tightenAtlasLeaves = false,
  adaptiveAtlasLeafSize = false,
  fastFrameStyles = false,
  optimizeAtlasLeafBasis = false,
  optimizeAtlasLeafHomography = false,
  optimizeAtlasTriangleBasis = false,
}) {
  if (!Array.isArray(frames) || !frames.length) {
    throw new Error("Animated render bundle build requires at least one frame.");
  }
  const firstFrame = frames[0];
  if (!firstFrame?.polygons?.length) {
    throw new Error("Animated render bundle first frame has no polygons.");
  }
  const host = createQuakeRenderHost();

  try {
    const atlasLeafBasisRotationPlan = runQuakeRenderBundleStep("basis-plan", () =>
      optimizeAtlasLeafBasis
        ? quakeAtlasLeafBasisRotationPlan(firstFrame.polygons)
        : null
    );
    const renderFramePolygons = runQuakeRenderBundleStep("prepare-frame-polygons", () =>
      frames.map((frame) =>
        atlasLeafBasisRotationPlan
          ? applyQuakeAtlasLeafBasisRotationPlan(frame.polygons, atlasLeafBasisRotationPlan)
          : frame.polygons
      )
    );
    const scene = runQuakeRenderBundleStep("scene-create", () =>
      createQuakeRenderScene(host, textureQuality)
    );
    const handle = runQuakeRenderBundleStep("scene-add-first-frame", () =>
      scene.add(
        {
          polygons: renderFramePolygons[0],
          objectUrls: [],
          warnings: [],
          dispose: () => undefined,
        },
        {
          merge: false,
          meshResolution: "lossless",
          stableDom: true,
          excludeFromAutoCenter: true,
        },
      )
    );
    const outFrames = [];
    let baseLeafFrameStylesByClass = new Map();
    let baseTightAtlasBoundsByKey = null;
    await runQuakeRenderBundleStepAsync("initial-texture-wait", () =>
      waitForBakedTextureLeaves(handle.element)
    );
    const animatedAtlasLeafHomographyPlan = await runQuakeRenderBundleStepAsync("homography-plan", () =>
      optimizeAtlasLeafHomography
        ? createQuakeAnimatedAtlasLeafHomographyPlan(handle, renderFramePolygons)
        : null
    );
    const animatedTriangleAtlasBasisPlan = await runQuakeRenderBundleStepAsync("triangle-basis-plan", () =>
      optimizeAtlasTriangleBasis
        ? createQuakeAnimatedTriangleAtlasBasisPlan(handle.element, renderFramePolygons[0])
        : null
    );
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index];
      if (!frame?.polygons?.length) {
        throw new Error(`Animated render bundle frame ${index} has no polygons.`);
      }
      if (index > 0) {
        runQuakeRenderBundleStep("frame-set-polygons", () =>
          handle.setPolygons(
            renderFramePolygons[index],
            {
              merge: false,
              stableDom: true,
              recomputeAutoCenter: false,
            },
          )
        );
      }
      const name = frame.name ?? `frame-${index}`;
      await runQuakeRenderBundleStepAsync("frame-texture-wait", () =>
        waitForBakedTextureLeaves(handle.element)
      );
      if (animatedAtlasLeafHomographyPlan) {
        runQuakeRenderBundleStep("frame-apply-homography", () =>
          applyQuakeAnimatedAtlasLeafHomographyPlan(handle.element, animatedAtlasLeafHomographyPlan, index)
        );
      }
      if (animatedTriangleAtlasBasisPlan) {
        runQuakeRenderBundleStep("frame-apply-triangle-basis", () =>
          applyQuakeAnimatedTriangleAtlasBasisPlan(handle.element, animatedTriangleAtlasBasisPlan)
        );
      }
      if (tightenAtlasLeaves) {
        baseTightAtlasBoundsByKey = await runQuakeRenderBundleStepAsync("frame-tighten-atlas", () =>
          tightenQuakeAtlasLeaves(handle.element, baseTightAtlasBoundsByKey)
        );
      }
      const adaptiveAtlasLeafSizeStats = runQuakeRenderBundleStep("frame-adaptive-atlas-size", () =>
        adaptiveAtlasLeafSize
          ? applyAdaptiveQuakeAtlasLeafSizes(handle.element)
          : null
      );
      const transformSnapStats = runQuakeRenderBundleStep("frame-snap-transforms", () =>
        snapQuakeLeafTransformsToStableGrid(handle.element)
      );
      const inheritedFrameStyleResult = runQuakeRenderBundleStep("frame-inherited-style-probe", () =>
        index > 0 && fastFrameStyles
          ? extractRenderBundleFrameStylesFromInheritedBase(handle.element, baseLeafFrameStylesByClass)
          : null
      );
      const atlasBackgroundSnapStats = runQuakeRenderBundleStep("frame-snap-backgrounds", () =>
        inheritedFrameStyleResult
          ? null
          : snapQuakeAtlasLeafBackgroundsToIntegerPx(handle.element)
      );
      if (index === 0) {
        const { meshHtml, meshCss, assets, leafMetadata, leafFrameStyles } = await runQuakeRenderBundleStepAsync("frame-serialize-first",
          () => serializeMeshWithAssets(handle.element, {
            extractLeafStyles,
            normalizeAtlasLeafImagePixelBoxes: true,
            styleClassName: frame.styleClassName,
          }),
        );
        baseLeafFrameStylesByClass = new Map(leafFrameStyles);
        outFrames.push({
          name,
          styleClassName: frame.styleClassName,
          meshHtml,
          meshCss,
          assets,
          leafMetadata,
          leafFrameStyles,
          leafCount: handle.element.querySelectorAll("b,i,s,u").length,
          atlasLeafCount: handle.element.querySelectorAll("s").length,
          polygonCount: frame.polygons.length,
          ...(adaptiveAtlasLeafSizeStats ? { adaptiveAtlasLeafSizeStats } : {}),
          ...(transformSnapStats.snappedLeaves || transformSnapStats.precisionLeaves ? { transformSnapStats } : {}),
          ...(atlasBackgroundSnapStats.snappedLeaves ? { atlasBackgroundSnapStats } : {}),
          ...(atlasLeafBasisRotationPlan?.stats?.rotatedPolygons
            ? { atlasLeafBasisOptimizationStats: atlasLeafBasisRotationPlan.stats }
            : {}),
          ...(animatedAtlasLeafHomographyPlan?.stats?.optimizedLeaves
            ? { atlasLeafHomographyOptimizationStats: animatedAtlasLeafHomographyPlan.stats }
            : {}),
          ...(animatedTriangleAtlasBasisPlan?.stats?.optimizedLeaves
            ? { triangleAtlasBasisOptimizationStats: animatedTriangleAtlasBasisPlan.stats }
            : {}),
        });
        continue;
      }
      const frameStyleResult = inheritedFrameStyleResult ?? runQuakeRenderBundleStep("frame-extract-styles", () =>
        (fastFrameStyles
          ? extractRenderBundleFrameStylesReadOnly
          : extractRenderBundleFrameStyles)(handle.element, {
          styleClassName: frame.styleClassName,
          baseLeafFrameStylesByClass,
        })
      );
      const { leafFrameStyles } = frameStyleResult;
      outFrames.push({
        name,
        styleClassName: frame.styleClassName,
        leafFrameStyles,
        leafCount: frameStyleResult.leafCount ?? handle.element.querySelectorAll("b,i,s,u").length,
        atlasLeafCount: frameStyleResult.atlasLeafCount ?? handle.element.querySelectorAll("s").length,
        polygonCount: frame.polygons.length,
      });
    }
    return { frames: outFrames };
  } finally {
    host.remove();
  }
};

async function runQuakeRenderBundleStepAsync(_label, callback) {
  return await callback();
}

function runQuakeRenderBundleStep(_label, callback) {
  return callback();
}

function createQuakeRenderHost() {
  window.__polycssProjectiveQuadGuards = QUAKE_POLYCSS_PROJECTIVE_QUAD_GUARDS;
  patchQuakeCanvas2dDefaults();
  const host = document.createElement("main");
  host.style.position = "absolute";
  host.style.left = "-100000px";
  host.style.top = "0";
  host.style.width = "1280px";
  host.style.height = "720px";
  document.body.appendChild(host);
  return host;
}

function patchQuakeCanvas2dDefaults() {
  const canvasPrototype = window.HTMLCanvasElement?.prototype;
  if (!canvasPrototype || canvasPrototype.__quakeCanvas2dDefaultsPatched) return;
  const getContext = canvasPrototype.getContext;
  canvasPrototype.getContext = function getQuakeCanvasContext(type, ...args) {
    const context = getContext.call(this, type, ...args);
    if (type === "2d" && context) {
      context.imageSmoothingEnabled = false;
    }
    return context;
  };
  canvasPrototype.__quakeCanvas2dDefaultsPatched = true;
}

function createQuakeRenderScene(host, textureQuality) {
  const camera = createPolyPerspectiveCamera({
    perspective: 900,
    zoom: QUAKE_CAMERA_ZOOM,
    rotX: 88,
    rotY: 270,
    target: [0, 0, 1.72],
  });
  return createPolyScene(host, {
    camera,
    ambientLight: { color: "#ffffff", intensity: Math.PI },
    directionalLight: { direction: [-0.4, -0.55, -0.65], color: "#ffffff", intensity: 0 },
    textureLighting: "baked",
    textureQuality,
    autoCenter: false,
  });
}

function waitForRenderBundleFrameUpdate() {
  return new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
}

async function waitForBakedTextureLeaves(mesh) {
  const startedAt = performance.now();
  while (true) {
    const leaves = [...mesh.querySelectorAll("s")];
    const pending = leaves.filter((leaf) => {
      const style = leaf.getAttribute("style") ?? "";
      return !/background(?:-image)?\s*:/.test(style);
    });
    if (leaves.length === 0 || pending.length === 0) return;
    if (performance.now() - startedAt > QUAKE_RENDER_BUNDLE_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for ${pending.length}/${leaves.length} baked texture leaves.`);
    }
    await waitForRenderBundleFrameUpdate();
  }
}

function optimizeQuakeAtlasLeafBasisPolygons(polygons) {
  const plan = quakeAtlasLeafBasisRotationPlan(polygons);
  return {
    polygons: applyQuakeAtlasLeafBasisRotationPlan(polygons, plan),
    stats: plan.stats,
  };
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
  stats.savedRatio = stats.beforeArea > 0
    ? Number((stats.savedArea / stats.beforeArea).toFixed(4))
    : 0;
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
    ...(Array.isArray(polygon.simplifyVertexKeys) && polygon.simplifyVertexKeys.length === vertices.length
      ? { simplifyVertexKeys: rotateQuakePolygonArray(polygon.simplifyVertexKeys, offset) }
      : {}),
    ...(Array.isArray(polygon.simplifySourceVertexKeys) && polygon.simplifySourceVertexKeys.length === vertices.length
      ? { simplifySourceVertexKeys: rotateQuakePolygonArray(polygon.simplifySourceVertexKeys, offset) }
      : {}),
  };
}

function rotateQuakePolygonArray(values, offset) {
  return [...values.slice(offset), ...values.slice(0, offset)].map((value) =>
    Array.isArray(value) ? [...value] : value
  );
}

async function optimizeQuakeAtlasLeafHomography(mesh, polygons) {
  const { candidates, stats } = await quakeAtlasLeafHomographyCandidates(mesh, polygons);
  if (!candidates.length) return stats;
  await applyQuakeAtlasLeafHomographyCandidates(candidates);
  finalizeQuakeAtlasLeafHomographyStats(stats, candidates);
  return stats;
}

async function quakeAtlasLeafHomographyCandidates(mesh, polygons, options = {}) {
  const stats = {
    totalLeaves: 0,
    quadLeaves: 0,
    candidateLeaves: 0,
    optimizedLeaves: 0,
    beforeArea: 0,
    afterArea: 0,
    savedArea: 0,
    skipped: {},
  };
  const leaves = [...mesh.querySelectorAll("s")];
  const candidates = [];
  for (const leaf of leaves) {
    stats.totalLeaves++;
    const candidate = await quakeAtlasLeafHomographyCandidate(leaf, polygons, options);
    if (!candidate) continue;
    if (candidate.skip) {
      incrementQuakeStat(stats.skipped, candidate.skip);
      continue;
    }
    stats.quadLeaves++;
    if (!candidate.optimize) continue;
    stats.candidateLeaves++;
    candidates.push(candidate);
  }
  return { candidates, stats };
}

function finalizeQuakeAtlasLeafHomographyStats(stats, candidates) {
  stats.optimizedLeaves = 0;
  stats.beforeArea = 0;
  stats.afterArea = 0;
  for (const candidate of candidates) {
    stats.optimizedLeaves++;
    stats.beforeArea += candidate.beforeArea;
    stats.afterArea += candidate.afterArea;
  }
  stats.beforeArea = Math.round(stats.beforeArea);
  stats.afterArea = Math.round(stats.afterArea);
  stats.savedArea = Math.max(0, stats.beforeArea - stats.afterArea);
  stats.savedRatio = stats.beforeArea > 0
    ? Number((stats.savedArea / stats.beforeArea).toFixed(4))
    : 0;
  return stats;
}

async function quakeAtlasLeafHomographyCandidate(leaf, polygons, options = {}) {
  const polygonIndex = renderBundleIntegerAttr(leaf, "data-poly-index");
  if (polygonIndex === undefined || polygonIndex < 0) return { skip: "missing-poly-index" };
  const polygon = polygons?.[polygonIndex];
  if (!polygon?.texture) return { skip: "untextured" };
  if (!Array.isArray(polygon.vertices) || polygon.vertices.length !== 4) return { skip: "non-quad" };
  if (!Array.isArray(polygon.uvs) || polygon.uvs.length !== 4) return { skip: "missing-quad-uvs" };
  if (Array.isArray(polygon.textureTriangles) && polygon.textureTriangles.length) return { skip: "texture-triangles" };

  const win = leaf.ownerDocument.defaultView ?? window;
  const style = win.getComputedStyle(leaf);
  const atlasSize = cssPixelValue(leaf.style.getPropertyValue("--polycss-atlas-size")) ||
    cssPixelValue(style.width) ||
    64;
  const position = cssPixelPair(style.backgroundPosition, style.backgroundPositionX, style.backgroundPositionY);
  const size = cssPixelPair(style.backgroundSize);
  const matrix = parseMatrix3d(leaf.style.transform || style.transform);
  const imageUrl = cssUrlValue(style.backgroundImage);
  if (!position || !size || !matrix || !imageUrl || atlasSize <= 0 || size[0] <= 0 || size[1] <= 0) {
    return { skip: "invalid-leaf-style" };
  }

  const plan = computeTextureAtlasPlanPublic(polygon, polygonIndex, {
    tileSize: BASE_TILE,
    layerElevation: BASE_TILE,
  }, QUAKE_POLYCSS_PROJECTIVE_QUAD_GUARDS);
  if (!plan || plan.screenPts.length !== 8 || plan.canvasW <= 0 || plan.canvasH <= 0) {
    return { skip: "invalid-plan" };
  }
  const expectedMatrix = parseMatrix3dValues(plan.atlasMatrix);
  if (!expectedMatrix || !matrix3dAlmostEqual(matrix, expectedMatrix, QUAKE_ATLAS_HOMOGRAPHY_MATRIX_EPSILON)) {
    return { skip: "matrix-mismatch" };
  }
  const basis = stableBasisFromPlan(plan, polygon);
  if (!basis) return { skip: "missing-basis" };
  const projectiveMatrix = computeProjectiveQuadMatrix(
    plan.screenPts,
    basis.xAxis,
    basis.yAxis,
    basis.normal,
    basis.tx,
    basis.ty,
    basis.tz,
    QUAKE_ATLAS_HOMOGRAPHY_GUARDS,
  );
  if (!projectiveMatrix) return { skip: "projective-rejected" };

  const localPoints = quakeAtlasHomographyLocalPoints(plan, atlasSize);
  const coveredArea = Math.abs(signedQuakeFlatPolygonArea(localPoints));
  const atlas = await loadQuakeAtlasImageData(imageUrl);
  if (!atlas) return { skip: "missing-atlas" };
  const tightBounds = atlasLeafAlphaBounds(atlas, atlasSize, position, size);
  const beforeArea = Math.round(tightBounds ? tightBounds.width * tightBounds.height : atlasSize * atlasSize);
  const targetArea = Math.max(1, Math.ceil(coveredArea * QUAKE_ATLAS_HOMOGRAPHY_AREA_PAD));
  const savedArea = beforeArea - targetArea;
  const minSavedArea = options.minSavedArea ?? QUAKE_ATLAS_HOMOGRAPHY_MIN_SAVED_AREA;
  const minSavedRatio = options.minSavedRatio ?? QUAKE_ATLAS_HOMOGRAPHY_MIN_SAVED_RATIO;
  if (
    beforeArea <= 0 ||
    savedArea < minSavedArea ||
    savedArea / beforeArea < minSavedRatio
  ) {
    return { optimize: false };
  }

  const dimensions = quakeAtlasHomographyTargetDimensions(localPoints, targetArea, atlasSize);
  if (!dimensions) return { skip: "invalid-target-size" };
  const nextMatrix = scaleQuakeProjectiveMatrix(projectiveMatrix, dimensions.width, dimensions.height);
  if (!quakeProjectiveMatrixHasStableCornerW(nextMatrix, dimensions.width, dimensions.height)) {
    return { skip: "unstable-projective-corner-w" };
  }
  const tile = renderQuakeAtlasHomographyTile({
    atlas,
    atlasSize,
    backgroundPosition: position,
    backgroundSize: size,
    height: dimensions.height,
    plan,
    width: dimensions.width,
  });
  if (!tile) return { skip: "render-failed" };

  return {
    afterArea: dimensions.width * dimensions.height,
    beforeArea,
    height: dimensions.height,
    leaf,
    matrix: nextMatrix,
    optimize: true,
    polygonIndex,
    tile,
    texture: polygon.texture,
    uvs: polygon.uvs.map((uv) => [...uv]),
    width: dimensions.width,
  };
}

function quakeAtlasHomographyLocalPoints(plan, atlasSize) {
  const scaleX = atlasSize / plan.canvasW;
  const scaleY = atlasSize / plan.canvasH;
  const out = [];
  for (let index = 0; index < plan.screenPts.length; index += 2) {
    out.push((plan.screenPts[index] ?? 0) * scaleX, (plan.screenPts[index + 1] ?? 0) * scaleY);
  }
  return out;
}

function quakeAtlasHomographyTargetDimensions(points, targetArea, atlasSize) {
  const edge = (a, b) => {
    const ax = points[a * 2] ?? 0;
    const ay = points[a * 2 + 1] ?? 0;
    const bx = points[b * 2] ?? 0;
    const by = points[b * 2 + 1] ?? 0;
    return Math.hypot(bx - ax, by - ay);
  };
  const widthHint = Math.max(1, (edge(0, 1) + edge(2, 3)) / 2);
  const heightHint = Math.max(1, (edge(1, 2) + edge(3, 0)) / 2);
  const aspect = Math.max(0.2, Math.min(5, widthHint / heightHint));
  let width = Math.max(QUAKE_ATLAS_HOMOGRAPHY_MIN_SIDE, Math.ceil(Math.sqrt(targetArea * aspect)));
  let height = Math.max(QUAKE_ATLAS_HOMOGRAPHY_MIN_SIDE, Math.ceil(targetArea / width));
  const maxSide = Math.max(QUAKE_ATLAS_HOMOGRAPHY_MIN_SIDE, Math.ceil(atlasSize * QUAKE_ATLAS_HOMOGRAPHY_MAX_SIDE_RATIO));
  if (width > maxSide || height > maxSide) {
    const scale = Math.min(maxSide / width, maxSide / height);
    width = Math.max(QUAKE_ATLAS_HOMOGRAPHY_MIN_SIDE, Math.floor(width * scale));
    height = Math.max(QUAKE_ATLAS_HOMOGRAPHY_MIN_SIDE, Math.ceil(targetArea / width));
  }
  if (width <= 0 || height <= 0 || width > QUAKE_ATLAS_HOMOGRAPHY_PAGE_SIZE || height > QUAKE_ATLAS_HOMOGRAPHY_PAGE_SIZE) {
    return null;
  }
  return { width, height };
}

function renderQuakeAtlasHomographyTile({
  atlas,
  atlasSize,
  backgroundPosition,
  backgroundSize,
  height,
  plan,
  width,
}) {
  const homography = computeQuakeHomography2d(
    [
      0, SOLID_QUAD_CANONICAL_SIZE,
      SOLID_QUAD_CANONICAL_SIZE, SOLID_QUAD_CANONICAL_SIZE,
      SOLID_QUAD_CANONICAL_SIZE, 0,
      0, 0,
    ],
    plan.screenPts,
  );
  if (!homography) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const imageData = context.createImageData(width, height);
  const data = imageData.data;
  for (let y = 0; y < height; y++) {
    const canonicalY = ((y + 0.5) / height) * SOLID_QUAD_CANONICAL_SIZE;
    for (let x = 0; x < width; x++) {
      const canonicalX = ((x + 0.5) / width) * SOLID_QUAD_CANONICAL_SIZE;
      const point = applyQuakeHomography2d(homography, canonicalX, canonicalY);
      if (!point) continue;
      const localX = (point[0] / plan.canvasW) * atlasSize;
      const localY = (point[1] / plan.canvasH) * atlasSize;
      const rgba = sampleQuakeAtlasBackground(atlas, backgroundPosition, backgroundSize, localX, localY);
      const offset = (y * width + x) * 4;
      data[offset] = rgba[0];
      data[offset + 1] = rgba[1];
      data[offset + 2] = rgba[2];
      data[offset + 3] = rgba[3];
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

async function applyQuakeAtlasLeafHomographyCandidates(candidates) {
  await prepareQuakeAtlasLeafHomographyCandidatePages(candidates);
  for (const candidate of candidates) {
    applyQuakeAtlasLeafHomographyCandidateStyle(candidate.leaf, candidate, candidate.matrix);
  }
}

async function prepareQuakeAtlasLeafHomographyCandidatePages(candidates) {
  const pages = packQuakeAtlasHomographyTiles(candidates);
  for (const page of pages) {
    const canvas = document.createElement("canvas");
    canvas.width = page.width;
    canvas.height = page.height;
    const context = canvas.getContext("2d");
    if (!context) continue;
    context.drawImage(page.canvas, 0, 0);
    page.url = await canvasToQuakeBlobUrl(canvas);
  }
  for (const candidate of candidates) {
    const page = candidate.page;
    if (!page?.url) continue;
    candidate.background = quakeAtlasLeafHomographyCandidateBackground(candidate);
  }
}

function quakeAtlasLeafHomographyCandidateBackground(candidate) {
  const page = candidate.page;
  return `url("${page.url}") -${roundCssPx(candidate.x)}px ` +
    `-${roundCssPx(candidate.y)}px / ${roundCssPx(page.width)}px ${roundCssPx(page.height)}px no-repeat`;
}

function applyQuakeAtlasLeafHomographyCandidateStyle(leaf, candidate, matrix) {
  if (!leaf || !candidate?.background || !matrix) return;
  leaf.style.transform = matrix;
  leaf.style.width = `${roundCssPx(candidate.width)}px`;
  leaf.style.height = `${roundCssPx(candidate.height)}px`;
  leaf.style.background = candidate.background;
}

async function createQuakeAnimatedAtlasLeafHomographyPlan(handle, framePolygons) {
  const { candidates: baseCandidates, stats } = await quakeAtlasLeafHomographyCandidates(
    handle.element,
    framePolygons[0],
    {
      minSavedArea: QUAKE_ANIMATED_ATLAS_HOMOGRAPHY_MIN_SAVED_AREA,
      minSavedRatio: QUAKE_ANIMATED_ATLAS_HOMOGRAPHY_MIN_SAVED_RATIO,
    },
  );
  let candidates = baseCandidates;
  const matricesByFrame = [
    new Map(candidates.map((candidate) => [candidate.polygonIndex, candidate.matrix])),
  ];
  let currentFrameIndex = 0;

  for (let frameIndex = 1; frameIndex < framePolygons.length && candidates.length; frameIndex++) {
    handle.setPolygons(framePolygons[frameIndex], {
      merge: false,
      stableDom: true,
      recomputeAutoCenter: false,
    });
    currentFrameIndex = frameIndex;
    await waitForRenderBundleFrameUpdate();
    await waitForBakedTextureLeaves(handle.element);

    const leavesByPolyIndex = quakeAtlasLeavesByPolyIndex(handle.element);
    const frameMatrices = new Map();
    const stableCandidates = [];
    for (const candidate of candidates) {
      const result = quakeReusableAtlasLeafHomographyFrameMatrix(
        leavesByPolyIndex.get(candidate.polygonIndex),
        framePolygons[frameIndex],
        candidate,
      );
      if (result.skip) {
        incrementQuakeStat(stats.skipped, `animated-${result.skip}`);
        continue;
      }
      frameMatrices.set(candidate.polygonIndex, result.matrix);
      stableCandidates.push(candidate);
    }
    matricesByFrame[frameIndex] = frameMatrices;
    candidates = stableCandidates;
  }

  if (currentFrameIndex !== 0) {
    handle.setPolygons(framePolygons[0], {
      merge: false,
      stableDom: true,
      recomputeAutoCenter: false,
    });
    await waitForRenderBundleFrameUpdate();
    await waitForBakedTextureLeaves(handle.element);
  }

  stats.animatedFrames = framePolygons.length;
  if (!candidates.length) {
    finalizeQuakeAtlasLeafHomographyStats(stats, []);
    return {
      candidates: [],
      candidatesByPolygonIndex: new Map(),
      matricesByFrame,
      stats,
    };
  }

  await prepareQuakeAtlasLeafHomographyCandidatePages(candidates);
  const candidatesByPolygonIndex = new Map(candidates.map((candidate) => [candidate.polygonIndex, candidate]));
  const stableMatricesByFrame = matricesByFrame.map((frameMatrices) =>
    new Map(candidates.map((candidate) => [
      candidate.polygonIndex,
      frameMatrices?.get(candidate.polygonIndex) ?? candidate.matrix,
    ]))
  );
  finalizeQuakeAtlasLeafHomographyStats(stats, candidates);
  return {
    candidates,
    candidatesByPolygonIndex,
    matricesByFrame: stableMatricesByFrame,
    stats,
  };
}

function applyQuakeAnimatedAtlasLeafHomographyPlan(mesh, plan, frameIndex) {
  const frameMatrices = plan.matricesByFrame[frameIndex];
  if (!frameMatrices?.size || !plan.candidatesByPolygonIndex.size) return;
  const leavesByPolyIndex = quakeAtlasLeavesByPolyIndex(mesh);
  for (const [polygonIndex, candidate] of plan.candidatesByPolygonIndex) {
    applyQuakeAtlasLeafHomographyCandidateStyle(
      leavesByPolyIndex.get(polygonIndex),
      candidate,
      frameMatrices.get(polygonIndex),
    );
  }
}

async function createQuakeAnimatedTriangleAtlasBasisPlan(mesh, polygons) {
  const stats = {
    totalLeaves: 0,
    triangleLeaves: 0,
    candidateLeaves: 0,
    optimizedLeaves: 0,
    beforeArea: 0,
    afterArea: 0,
    savedArea: 0,
    skipped: {},
  };
  const candidates = [];
  for (const leaf of mesh.querySelectorAll("s")) {
    stats.totalLeaves++;
    const candidate = await quakeTriangleAtlasBasisCandidate(leaf, polygons);
    if (!candidate) continue;
    if (candidate.skip) {
      incrementQuakeStat(stats.skipped, candidate.skip);
      continue;
    }
    stats.triangleLeaves++;
    if (!candidate.optimize) continue;
    stats.candidateLeaves++;
    candidates.push(candidate);
  }
  if (!candidates.length) return { candidatesByPolygonIndex: new Map(), stats };
  await prepareQuakeAtlasLeafHomographyCandidatePages(candidates);
  stats.optimizedLeaves = candidates.length;
  stats.beforeArea = Math.round(candidates.reduce((sum, candidate) => sum + candidate.beforeArea, 0));
  stats.afterArea = Math.round(candidates.reduce((sum, candidate) => sum + candidate.afterArea, 0));
  stats.savedArea = Math.max(0, stats.beforeArea - stats.afterArea);
  stats.savedRatio = stats.beforeArea > 0
    ? Number((stats.savedArea / stats.beforeArea).toFixed(4))
    : 0;
  return {
    candidatesByPolygonIndex: new Map(candidates.map((candidate) => [candidate.polygonIndex, candidate])),
    stats,
  };
}

async function quakeTriangleAtlasBasisCandidate(leaf, polygons) {
  const polygonIndex = renderBundleIntegerAttr(leaf, "data-poly-index");
  if (polygonIndex === undefined || polygonIndex < 0) return { skip: "missing-poly-index" };
  const polygon = polygons?.[polygonIndex];
  if (!polygon?.texture) return { skip: "untextured" };
  if (!Array.isArray(polygon.vertices) || polygon.vertices.length !== 3) return { skip: "non-triangle" };
  if (!Array.isArray(polygon.uvs) || polygon.uvs.length !== 3) return { skip: "missing-triangle-uvs" };

  const win = leaf.ownerDocument.defaultView ?? window;
  const style = win.getComputedStyle(leaf);
  const matrix = parseMatrix3d(leaf.style.transform || style.transform);
  const width = cssPixelValue(leaf.style.width) ||
    cssPixelValue(style.width) ||
    cssPixelValue(leaf.style.getPropertyValue("--polycss-atlas-size")) ||
    64;
  const height = cssPixelValue(leaf.style.height) ||
    cssPixelValue(style.height) ||
    cssPixelValue(leaf.style.getPropertyValue("--polycss-atlas-size")) ||
    64;
  const position = cssPixelPair(style.backgroundPosition, style.backgroundPositionX, style.backgroundPositionY);
  const size = cssPixelPair(style.backgroundSize);
  const imageUrl = cssUrlValue(style.backgroundImage);
  if (!matrix || !position || !size || !imageUrl || width <= 0 || height <= 0 || size[0] <= 0 || size[1] <= 0) {
    return { skip: "invalid-leaf-style" };
  }
  if (matrix[3] || matrix[7] || matrix[11] || matrix[15] !== 1) return { skip: "projective" };

  const atlas = await loadQuakeAtlasImageData(imageUrl);
  if (!atlas) return { skip: "missing-atlas" };
  const basis = quakeTriangleAtlasRotatedBasis(atlas, position, size, width, height);
  if (!basis) return { skip: "empty-alpha" };

  const beforeArea = width * height;
  const afterArea = basis.width * basis.height;
  const savedArea = beforeArea - afterArea;
  if (
    afterArea <= 0 ||
    savedArea < QUAKE_TRIANGLE_ATLAS_BASIS_MIN_SAVED_AREA ||
    savedArea / beforeArea < QUAKE_TRIANGLE_ATLAS_BASIS_MIN_SAVED_RATIO
  ) {
    return { optimize: false };
  }

  const tile = renderQuakeTriangleAtlasBasisTile({
    atlas,
    backgroundPosition: position,
    backgroundSize: size,
    basis,
  });
  if (!tile) return { skip: "render-failed" };

  return {
    afterArea,
    basis,
    beforeArea,
    height: basis.height,
    optimize: true,
    polygonIndex,
    tile,
    width: basis.width,
  };
}

function quakeTriangleAtlasRotatedBasis(atlas, position, backgroundSize, width, height) {
  const points = quakeAtlasLeafAlphaLocalPoints(atlas, position, backgroundSize, width, height);
  if (points.length < 3) return null;
  let best = null;
  for (
    let degrees = 0;
    degrees < 90;
    degrees += QUAKE_TRIANGLE_ATLAS_BASIS_ANGLE_STEP_DEGREES
  ) {
    const angle = degrees * Math.PI / 180;
    const current = quakeRotatedAlphaBounds(points, angle);
    if (!current) continue;
    if (!best || current.area < best.area) best = current;
  }
  return best;
}

function quakeAtlasLeafAlphaLocalPoints(atlas, position, backgroundSize, width, height) {
  const [positionX, positionY] = position;
  const [backgroundWidth, backgroundHeight] = backgroundSize;
  const sourceLeft = Math.max(0, Math.floor((-positionX / backgroundWidth) * atlas.width) - 1);
  const sourceTop = Math.max(0, Math.floor((-positionY / backgroundHeight) * atlas.height) - 1);
  const sourceRight = Math.min(
    atlas.width,
    Math.ceil(((width - positionX) / backgroundWidth) * atlas.width) + 1,
  );
  const sourceBottom = Math.min(
    atlas.height,
    Math.ceil(((height - positionY) / backgroundHeight) * atlas.height) + 1,
  );
  const points = [];
  for (let y = sourceTop; y < sourceBottom; y++) {
    for (let x = sourceLeft; x < sourceRight; x++) {
      const alpha = atlas.data[(y * atlas.width + x) * 4 + 3];
      if (alpha <= 2) continue;
      const localX = ((x + 0.5) / atlas.width) * backgroundWidth + positionX;
      const localY = ((y + 0.5) / atlas.height) * backgroundHeight + positionY;
      if (localX < -1 || localY < -1 || localX > width + 1 || localY > height + 1) continue;
      points.push([localX, localY]);
    }
  }
  return points;
}

function quakeRotatedAlphaBounds(points, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    const rotatedX = x * cos + y * sin;
    const rotatedY = -x * sin + y * cos;
    minX = Math.min(minX, rotatedX);
    minY = Math.min(minY, rotatedY);
    maxX = Math.max(maxX, rotatedX);
    maxY = Math.max(maxY, rotatedY);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  minX -= QUAKE_TRIANGLE_ATLAS_BASIS_PADDING;
  minY -= QUAKE_TRIANGLE_ATLAS_BASIS_PADDING;
  maxX += QUAKE_TRIANGLE_ATLAS_BASIS_PADDING;
  maxY += QUAKE_TRIANGLE_ATLAS_BASIS_PADDING;
  const width = Math.max(1, Math.ceil(maxX - minX));
  const height = Math.max(1, Math.ceil(maxY - minY));
  return {
    angle,
    area: width * height,
    cos,
    height,
    minX,
    minY,
    sin,
    width,
  };
}

function renderQuakeTriangleAtlasBasisTile({
  atlas,
  backgroundPosition,
  backgroundSize,
  basis,
}) {
  const canvas = document.createElement("canvas");
  canvas.width = basis.width;
  canvas.height = basis.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const imageData = context.createImageData(basis.width, basis.height);
  const data = imageData.data;
  for (let y = 0; y < basis.height; y++) {
    for (let x = 0; x < basis.width; x++) {
      const rotatedX = basis.minX + x + 0.5;
      const rotatedY = basis.minY + y + 0.5;
      const localX = rotatedX * basis.cos - rotatedY * basis.sin;
      const localY = rotatedX * basis.sin + rotatedY * basis.cos;
      const rgba = sampleQuakeAtlasBackground(atlas, backgroundPosition, backgroundSize, localX, localY);
      const offset = (y * basis.width + x) * 4;
      data[offset] = rgba[0];
      data[offset + 1] = rgba[1];
      data[offset + 2] = rgba[2];
      data[offset + 3] = rgba[3];
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function transformQuakeAffineMatrix2d(matrix, basis) {
  const next = [...matrix];
  for (let index = 0; index < 4; index++) {
    const x = matrix[index];
    const y = matrix[index + 4];
    next[index] = x * basis.cos + y * basis.sin;
    next[index + 4] = -x * basis.sin + y * basis.cos;
  }
  const offsetX = basis.minX * basis.cos - basis.minY * basis.sin;
  const offsetY = basis.minX * basis.sin + basis.minY * basis.cos;
  next[12] += matrix[0] * offsetX + matrix[4] * offsetY;
  next[13] += matrix[1] * offsetX + matrix[5] * offsetY;
  next[14] += matrix[2] * offsetX + matrix[6] * offsetY;
  next[15] += matrix[3] * offsetX + matrix[7] * offsetY;
  return formatMatrix3d(next);
}

function applyQuakeAnimatedTriangleAtlasBasisPlan(mesh, plan) {
  if (!plan.candidatesByPolygonIndex.size) return;
  const leavesByPolyIndex = quakeAtlasLeavesByPolyIndex(mesh);
  for (const [polygonIndex, candidate] of plan.candidatesByPolygonIndex) {
    const leaf = leavesByPolyIndex.get(polygonIndex);
    const win = leaf?.ownerDocument.defaultView ?? window;
    const style = leaf ? win.getComputedStyle(leaf) : null;
    const matrix = style ? parseMatrix3d(leaf.style.transform || style.transform) : null;
    if (!matrix) continue;
    applyQuakeAtlasLeafHomographyCandidateStyle(
      leaf,
      candidate,
      transformQuakeAffineMatrix2d(matrix, candidate.basis),
    );
  }
}

function quakeReusableAtlasLeafHomographyFrameMatrix(leaf, polygons, baseCandidate) {
  if (!leaf) return { skip: "missing-leaf" };
  const polygonIndex = renderBundleIntegerAttr(leaf, "data-poly-index");
  if (polygonIndex !== baseCandidate.polygonIndex) return { skip: "poly-index-mismatch" };
  const polygon = polygons?.[polygonIndex];
  if (!polygon?.texture) return { skip: "untextured" };
  if (!Array.isArray(polygon.vertices) || polygon.vertices.length !== 4) return { skip: "non-quad" };
  if (!Array.isArray(polygon.uvs) || polygon.uvs.length !== 4) return { skip: "missing-quad-uvs" };
  if (Array.isArray(polygon.textureTriangles) && polygon.textureTriangles.length) return { skip: "texture-triangles" };
  if (polygon.texture !== baseCandidate.texture) return { skip: "texture-mismatch" };
  if (!quakePolygonUvsAlmostEqual(polygon.uvs, baseCandidate.uvs)) return { skip: "uv-mismatch" };

  const win = leaf.ownerDocument.defaultView ?? window;
  const style = win.getComputedStyle(leaf);
  const matrix = parseMatrix3d(leaf.style.transform || style.transform);
  if (!matrix) return { skip: "invalid-leaf-style" };
  const plan = computeTextureAtlasPlanPublic(polygon, polygonIndex, {
    tileSize: BASE_TILE,
    layerElevation: BASE_TILE,
  }, QUAKE_POLYCSS_PROJECTIVE_QUAD_GUARDS);
  if (!plan || plan.screenPts.length !== 8 || plan.canvasW <= 0 || plan.canvasH <= 0) {
    return { skip: "invalid-plan" };
  }
  const expectedMatrix = parseMatrix3dValues(plan.atlasMatrix);
  if (!expectedMatrix || !matrix3dAlmostEqual(matrix, expectedMatrix, QUAKE_ATLAS_HOMOGRAPHY_MATRIX_EPSILON)) {
    return { skip: "matrix-mismatch" };
  }
  const basis = stableBasisFromPlan(plan, polygon);
  if (!basis) return { skip: "missing-basis" };
  const projectiveMatrix = computeProjectiveQuadMatrix(
    plan.screenPts,
    basis.xAxis,
    basis.yAxis,
    basis.normal,
    basis.tx,
    basis.ty,
    basis.tz,
    QUAKE_ATLAS_HOMOGRAPHY_GUARDS,
  );
  if (!projectiveMatrix) return { skip: "projective-rejected" };
  const nextMatrix = scaleQuakeProjectiveMatrix(projectiveMatrix, baseCandidate.width, baseCandidate.height);
  if (!quakeProjectiveMatrixHasStableCornerW(nextMatrix, baseCandidate.width, baseCandidate.height)) {
    return { skip: "unstable-projective-corner-w" };
  }
  return { matrix: nextMatrix };
}

function quakeAtlasLeavesByPolyIndex(mesh) {
  const out = new Map();
  for (const leaf of mesh.querySelectorAll("s")) {
    const polygonIndex = renderBundleIntegerAttr(leaf, "data-poly-index");
    if (polygonIndex === undefined || polygonIndex < 0 || out.has(polygonIndex)) continue;
    out.set(polygonIndex, leaf);
  }
  return out;
}

function quakePolygonUvsAlmostEqual(left, right, epsilon = 1e-6) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((uv, index) => {
    const other = right[index];
    return Array.isArray(uv) &&
      Array.isArray(other) &&
      uv.length === other.length &&
      uv.every((value, component) => Math.abs(value - other[component]) <= epsilon);
  });
}

function packQuakeAtlasHomographyTiles(candidates) {
  const pages = [];
  let page = null;
  const newPage = () => {
    const canvas = document.createElement("canvas");
    canvas.width = QUAKE_ATLAS_HOMOGRAPHY_PAGE_SIZE;
    canvas.height = QUAKE_ATLAS_HOMOGRAPHY_PAGE_SIZE;
    const out = {
      canvas,
      context: canvas.getContext("2d"),
      cursorX: QUAKE_ATLAS_HOMOGRAPHY_PAGE_PADDING,
      cursorY: QUAKE_ATLAS_HOMOGRAPHY_PAGE_PADDING,
      rowHeight: 0,
      width: 1,
      height: 1,
      url: "",
    };
    pages.push(out);
    return out;
  };
  for (const candidate of [...candidates].sort((a, b) => b.height - a.height || b.width - a.width)) {
    if (!page) page = newPage();
    if (page.cursorX + candidate.width + QUAKE_ATLAS_HOMOGRAPHY_PAGE_PADDING > QUAKE_ATLAS_HOMOGRAPHY_PAGE_SIZE) {
      page.cursorX = QUAKE_ATLAS_HOMOGRAPHY_PAGE_PADDING;
      page.cursorY += page.rowHeight + QUAKE_ATLAS_HOMOGRAPHY_PAGE_PADDING;
      page.rowHeight = 0;
    }
    if (page.cursorY + candidate.height + QUAKE_ATLAS_HOMOGRAPHY_PAGE_PADDING > QUAKE_ATLAS_HOMOGRAPHY_PAGE_SIZE) {
      page = newPage();
    }
    candidate.page = page;
    candidate.x = page.cursorX;
    candidate.y = page.cursorY;
    page.context.drawImage(candidate.tile, candidate.x, candidate.y);
    page.cursorX += candidate.width + QUAKE_ATLAS_HOMOGRAPHY_PAGE_PADDING;
    page.rowHeight = Math.max(page.rowHeight, candidate.height);
    page.width = Math.max(page.width, candidate.x + candidate.width + QUAKE_ATLAS_HOMOGRAPHY_PAGE_PADDING);
    page.height = Math.max(page.height, candidate.y + candidate.height + QUAKE_ATLAS_HOMOGRAPHY_PAGE_PADDING);
  }
  return pages;
}

function canvasToQuakeBlobUrl(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(URL.createObjectURL(blob));
      } else {
        reject(new Error("Could not encode homography atlas page."));
      }
    }, "image/png");
  });
}

function sampleQuakeAtlasBackground(atlas, position, size, localX, localY) {
  const sourceX = ((localX - position[0]) / size[0]) * atlas.width;
  const sourceY = ((localY - position[1]) / size[1]) * atlas.height;
  return sampleQuakeAtlasBilinear(atlas, sourceX, sourceY);
}

function sampleQuakeAtlasBilinear(atlas, x, y) {
  if (x < 0 || y < 0 || x > atlas.width - 1 || y > atlas.height - 1) return [0, 0, 0, 0];
  const x0 = Math.max(0, Math.min(atlas.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(atlas.height - 1, Math.floor(y)));
  const x1 = Math.max(0, Math.min(atlas.width - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(atlas.height - 1, y0 + 1));
  const tx = x - x0;
  const ty = y - y0;
  const c00 = quakeAtlasPixel(atlas, x0, y0);
  const c10 = quakeAtlasPixel(atlas, x1, y0);
  const c01 = quakeAtlasPixel(atlas, x0, y1);
  const c11 = quakeAtlasPixel(atlas, x1, y1);
  return [0, 1, 2, 3].map((index) => {
    const top = c00[index] * (1 - tx) + c10[index] * tx;
    const bottom = c01[index] * (1 - tx) + c11[index] * tx;
    return Math.max(0, Math.min(255, Math.round(top * (1 - ty) + bottom * ty)));
  });
}

function quakeAtlasPixel(atlas, x, y) {
  const offset = (y * atlas.width + x) * 4;
  return [
    atlas.data[offset] ?? 0,
    atlas.data[offset + 1] ?? 0,
    atlas.data[offset + 2] ?? 0,
    atlas.data[offset + 3] ?? 0,
  ];
}

function computeQuakeHomography2d(source, target) {
  if (!Array.isArray(source) || !Array.isArray(target) || source.length !== 8 || target.length !== 8) return null;
  const rows = [];
  const rhs = [];
  for (let index = 0; index < 4; index++) {
    const x = source[index * 2];
    const y = source[index * 2 + 1];
    const u = target[index * 2];
    const v = target[index * 2 + 1];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  const solution = solveQuakeLinearSystem(rows, rhs);
  return solution ? [...solution, 1] : null;
}

function applyQuakeHomography2d(h, x, y) {
  const denominator = h[6] * x + h[7] * y + h[8];
  if (Math.abs(denominator) <= 1e-9) return null;
  return [
    (h[0] * x + h[1] * y + h[2]) / denominator,
    (h[3] * x + h[4] * y + h[5]) / denominator,
  ];
}

function solveQuakeLinearSystem(rows, rhs) {
  const size = rhs.length;
  const matrix = rows.map((row, index) => [...row, rhs[index]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    if (Math.abs(matrix[pivot][column]) <= 1e-9) return null;
    if (pivot !== column) [matrix[pivot], matrix[column]] = [matrix[column], matrix[pivot]];
    const pivotValue = matrix[column][column];
    for (let col = column; col <= size; col++) matrix[column][col] /= pivotValue;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = matrix[row][column];
      if (Math.abs(factor) <= 1e-12) continue;
      for (let col = column; col <= size; col++) matrix[row][col] -= factor * matrix[column][col];
    }
  }
  return matrix.map((row) => row[size]);
}

function signedQuakeFlatPolygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 2) {
    const next = (index + 2) % points.length;
    area += (points[index] ?? 0) * (points[next + 1] ?? 0) -
      (points[next] ?? 0) * (points[index + 1] ?? 0);
  }
  return area / 2;
}

function scaleQuakeProjectiveMatrix(value, width, height) {
  const values = parseMatrix3dValues(value);
  if (!values) return `matrix3d(${value})`;
  const scaleX = SOLID_QUAD_CANONICAL_SIZE / width;
  const scaleY = SOLID_QUAD_CANONICAL_SIZE / height;
  for (let index = 0; index < 4; index++) values[index] *= scaleX;
  for (let index = 4; index < 8; index++) values[index] *= scaleY;
  return formatMatrix3d(values);
}

function quakeProjectiveMatrixHasStableCornerW(value, width, height) {
  const matrix = Array.isArray(value) ? value : parseMatrix3dValues(value);
  if (!matrix || width <= 0 || height <= 0) return false;
  const corners = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  return corners.every(([x, y]) => {
    const w = matrix[3] * x + matrix[7] * y + matrix[15];
    return Number.isFinite(w) && w >= QUAKE_ATLAS_HOMOGRAPHY_MIN_CORNER_W;
  });
}

function parseMatrix3dValues(value) {
  const text = String(value ?? "").trim();
  const match = /^matrix3d\(([^)]+)\)$/.exec(text);
  const body = match ? match[1] : text;
  const values = body.split(",").map((part) => Number(part.trim()));
  return values.length === 16 && values.every(Number.isFinite) ? values : null;
}

function matrix3dAlmostEqual(a, b, epsilon) {
  return a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) <= epsilon);
}

function incrementQuakeStat(stats, key) {
  stats[key] = (stats[key] ?? 0) + 1;
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

const quakeAtlasImageDataCache = new Map();

async function tightenQuakeAtlasLeaves(mesh, boundsByKey = null) {
  const leaves = [...mesh.querySelectorAll("s")];
  if (!leaves.length) return boundsByKey ?? new Map();
  const outBoundsByKey = boundsByKey ?? new Map();
  if (boundsByKey) {
    for (const leaf of leaves) {
      tightenQuakeAtlasLeaf(leaf, outBoundsByKey, true);
    }
    return outBoundsByKey;
  }
  await Promise.all(leaves.map((leaf) => tightenQuakeAtlasLeaf(leaf, outBoundsByKey, Boolean(boundsByKey))));
  return outBoundsByKey;
}

async function tightenQuakeAtlasLeaf(leaf, boundsByKey, useExistingBounds) {
  const key = quakeAtlasLeafKey(leaf);
  let bounds = key ? boundsByKey.get(key) : null;
  if (useExistingBounds && !bounds) return;

  const win = leaf.ownerDocument.defaultView ?? window;
  let computedStyle = null;
  const style = () => {
    computedStyle ??= win.getComputedStyle(leaf);
    return computedStyle;
  };
  const atlasSize = cssPixelValue(leaf.style.getPropertyValue("--polycss-atlas-size")) ||
    cssPixelValue(leaf.style.width) ||
    cssPixelValue(style().width) ||
    64;
  const position = cssPixelPair(
    leaf.style.backgroundPosition,
    leaf.style.backgroundPositionX,
    leaf.style.backgroundPositionY,
  ) ?? cssPixelPair(style().backgroundPosition, style().backgroundPositionX, style().backgroundPositionY);
  const size = cssPixelPair(leaf.style.backgroundSize) ?? cssPixelPair(style().backgroundSize);
  const matrix = parseMatrix3d(leaf.style.transform || style().transform);
  if (!position || !size || !matrix || atlasSize <= 0 || size[0] <= 0 || size[1] <= 0) return;
  if (!bounds && !useExistingBounds) {
    const imageUrl = cssUrlValue(leaf.style.backgroundImage || style().backgroundImage);
    if (!imageUrl) return;
    const atlas = await loadQuakeAtlasImageData(imageUrl);
    if (!atlas) return;
    bounds = atlasLeafAlphaBounds(atlas, atlasSize, position, size);
    if (bounds && key && quakeAtlasLeafBoundsAreTight(bounds, atlasSize)) boundsByKey.set(key, bounds);
  }
  if (!bounds) return;
  if (!quakeAtlasLeafBoundsAreTight(bounds, atlasSize)) return;
  const nextMatrix = translateMatrix3d(matrix, bounds.x, bounds.y);
  if (!quakeProjectiveMatrixHasStableCornerW(nextMatrix, bounds.width, bounds.height)) return;
  leaf.style.transform = formatMatrix3d(nextMatrix);
  leaf.style.width = `${roundCssPx(bounds.width)}px`;
  leaf.style.height = `${roundCssPx(bounds.height)}px`;
  leaf.style.background = `${leaf.style.backgroundImage || style().backgroundImage} ` +
    `${roundCssPx(position[0] - bounds.x)}px ` +
    `${roundCssPx(position[1] - bounds.y)}px / ${roundCssPx(size[0])}px ${roundCssPx(size[1])}px no-repeat`;
}

function quakeAtlasLeafBoundsAreTight(bounds, atlasSize) {
  const fullArea = atlasSize * atlasSize;
  const tightArea = bounds.width * bounds.height;
  return tightArea > 0 && tightArea < fullArea * 0.985;
}

function applyAdaptiveQuakeAtlasLeafSizes(mesh) {
  const stats = {
    totalLeaves: 0,
    resizedLeaves: 0,
    beforeArea: 0,
    afterArea: 0,
    maxWidth: 0,
    maxHeight: 0,
  };
  for (const leaf of mesh.querySelectorAll("s")) {
    const result = applyAdaptiveQuakeAtlasLeafSize(leaf);
    if (!result) continue;
    stats.totalLeaves++;
    stats.beforeArea += Math.round(result.beforeWidth * result.beforeHeight);
    stats.afterArea += Math.round(result.afterWidth * result.afterHeight);
    stats.maxWidth = Math.max(stats.maxWidth, result.afterWidth);
    stats.maxHeight = Math.max(stats.maxHeight, result.afterHeight);
    if (result.resized) stats.resizedLeaves++;
  }
  return stats;
}

function applyAdaptiveQuakeAtlasLeafSize(leaf) {
  const win = leaf.ownerDocument.defaultView ?? window;
  let computedStyle = null;
  const style = () => {
    computedStyle ??= win.getComputedStyle(leaf);
    return computedStyle;
  };
  const matrix = parseMatrix3d(leaf.style.transform || style().transform);
  if (!matrix) return null;

  const beforeWidth = cssPixelValue(leaf.style.width) ||
    cssPixelValue(leaf.style.getPropertyValue("--polycss-atlas-size")) ||
    cssPixelValue(style().width) ||
    64;
  const beforeHeight = cssPixelValue(leaf.style.height) ||
    cssPixelValue(leaf.style.getPropertyValue("--polycss-atlas-size")) ||
    cssPixelValue(style().height) ||
    64;
  if (beforeWidth <= 0 || beforeHeight <= 0) return null;

  const matrixScaleX = Math.hypot(matrix[0], matrix[1], matrix[2]);
  const matrixScaleY = Math.hypot(matrix[4], matrix[5], matrix[6]);
  const afterWidth = adaptiveQuakeAtlasLeafSide(beforeWidth, matrixScaleX);
  const afterHeight = adaptiveQuakeAtlasLeafSide(beforeHeight, matrixScaleY);
  if (afterWidth === beforeWidth && afterHeight === beforeHeight) {
    return { beforeWidth, beforeHeight, afterWidth, afterHeight, resized: false };
  }

  const background = adaptiveQuakeAtlasLeafBackground(leaf, style(), afterWidth / beforeWidth, afterHeight / beforeHeight);
  if (!background) return null;

  const nextMatrix = [...matrix];
  const matrixScaleCompensationX = beforeWidth / afterWidth;
  const matrixScaleCompensationY = beforeHeight / afterHeight;
  for (let index = 0; index < 4; index++) nextMatrix[index] *= matrixScaleCompensationX;
  for (let index = 4; index < 8; index++) nextMatrix[index] *= matrixScaleCompensationY;

  leaf.style.transform = formatMatrix3d(nextMatrix);
  leaf.style.width = `${roundCssPx(afterWidth)}px`;
  leaf.style.height = `${roundCssPx(afterHeight)}px`;
  leaf.style.background = background;
  return { beforeWidth, beforeHeight, afterWidth, afterHeight, resized: true };
}

function adaptiveQuakeAtlasLeafSide(beforeSide, matrixScale) {
  const desiredSide = beforeSide * matrixScale;
  const roundedSide = Math.round(desiredSide / QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_STEP) *
    QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_STEP;
  return Math.max(QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_MIN, roundedSide);
}

function adaptiveQuakeAtlasLeafBackground(leaf, style, scaleX, scaleY) {
  const backgroundImage = style.backgroundImage;
  if (!backgroundImage || backgroundImage === "none") return "";
  const position = cssPixelPair(style.backgroundPosition, style.backgroundPositionX, style.backgroundPositionY);
  const size = cssPixelPair(style.backgroundSize);
  if (!position || !size || size[0] <= 0 || size[1] <= 0) return "";
  return `${backgroundImage} ${roundCssIntegerPx(position[0] * scaleX)}px ` +
    `${roundCssIntegerPx(position[1] * scaleY)}px / ${roundCssIntegerPx(size[0] * scaleX)}px ` +
    `${roundCssIntegerPx(size[1] * scaleY)}px no-repeat`;
}

function snapQuakeLeafTransformsToStableGrid(mesh) {
    const stats = {
      totalLeaves: 0,
      snappedLeaves: 0,
      snappedValues: 0,
      precisionLeaves: 0,
    };
    for (const leaf of mesh.querySelectorAll("b,i,s,u")) {
      stats.totalLeaves++;
      const result = snapQuakeLeafTransformToStableGrid(leaf);
      if (!result) continue;
      if (result.snappedValues) stats.snappedLeaves++;
      stats.snappedValues += result.snappedValues;
      if (result.precisionChanged) stats.precisionLeaves++;
    }
    return stats;
  }

function snapQuakeLeafTransformToStableGrid(leaf) {
  const win = leaf.ownerDocument.defaultView ?? window;
  const inlineTransform = leaf.style.transform;
  const computedTransform = inlineTransform ? "" : win.getComputedStyle(leaf).transform;
  const sourceTransform = inlineTransform || computedTransform;
  const matrix = parseMatrix3d(sourceTransform);
  if (!matrix) return null;

  let snappedValues = 0;
  const next = matrix.map((value, index) => {
    const snapped = index >= 12 && index <= 14
      ? snapQuakeMatrixTranslation(value)
      : snapQuakeMatrixLinear(value);
      if (snapped !== value) snappedValues++;
      return snapped;
    });
    const formatted = formatMatrix3d(next);
    const precisionChanged = compactCssTransform(sourceTransform) !==
      compactCssTransform(formatted);
    if (!snappedValues && !precisionChanged) return null;
    leaf.style.transform = formatted;
    return { snappedValues, precisionChanged };
  }

  function compactCssTransform(value) {
    return String(value ?? "").replace(/\s+/g, "");
  }

function snapQuakeMatrixLinear(value) {
  for (const target of QUAKE_MATRIX_LINEAR_SNAP_TARGETS) {
    if (Math.abs(value - target) <= QUAKE_MATRIX_LINEAR_SNAP_EPSILON) return target;
  }
  return value;
}

function snapQuakeMatrixTranslation(value) {
  const snapped = Math.round(value / QUAKE_MATRIX_TRANSLATION_SNAP_GRID) *
    QUAKE_MATRIX_TRANSLATION_SNAP_GRID;
  return Math.abs(value - snapped) <= QUAKE_MATRIX_TRANSLATION_SNAP_EPSILON
    ? snapped
    : value;
}

function snapQuakeAtlasLeafBackgroundsToIntegerPx(mesh) {
  const stats = {
    totalLeaves: 0,
    snappedLeaves: 0,
  };
  for (const leaf of mesh.querySelectorAll("s")) {
    stats.totalLeaves++;
    if (snapQuakeAtlasLeafBackgroundToIntegerPx(leaf)) stats.snappedLeaves++;
  }
  return stats;
}

function snapQuakeAtlasLeafBackgroundToIntegerPx(leaf) {
  const win = leaf.ownerDocument.defaultView ?? window;
  let computedStyle = null;
  const style = () => {
    computedStyle ??= win.getComputedStyle(leaf);
    return computedStyle;
  };
  const backgroundImage = leaf.style.backgroundImage || style().backgroundImage;
  if (!backgroundImage || backgroundImage === "none") return false;
  const position = cssPixelPair(
    leaf.style.backgroundPosition,
    leaf.style.backgroundPositionX,
    leaf.style.backgroundPositionY,
  ) ?? cssPixelPair(style().backgroundPosition, style().backgroundPositionX, style().backgroundPositionY);
  const size = cssPixelPair(leaf.style.backgroundSize) ?? cssPixelPair(style().backgroundSize);
  if (!position || !size || size[0] <= 0 || size[1] <= 0) return false;

  const snapped = [
    roundCssIntegerPx(position[0]),
    roundCssIntegerPx(position[1]),
    Math.max(1, roundCssIntegerPx(size[0])),
    Math.max(1, roundCssIntegerPx(size[1])),
  ];
  const changed = Math.abs(position[0] - snapped[0]) > 0.000001 ||
    Math.abs(position[1] - snapped[1]) > 0.000001 ||
    Math.abs(size[0] - snapped[2]) > 0.000001 ||
    Math.abs(size[1] - snapped[3]) > 0.000001;

  leaf.style.background = `${backgroundImage} ${snapped[0]}px ${snapped[1]}px / ` +
    `${snapped[2]}px ${snapped[3]}px no-repeat`;
  return changed;
}

function clearQuakeLayoutOnlyPendingLeafStyles(mesh) {
  const stats = {
    totalLeaves: 0,
    clearedOpacityLeaves: 0,
  };
  for (const leaf of mesh.querySelectorAll("s")) {
    stats.totalLeaves++;
    const opacity = leaf.style.opacity;
    if (opacity === "" || Number(opacity) !== 0) continue;
    leaf.style.removeProperty("opacity");
    stats.clearedOpacityLeaves++;
  }
  return stats;
}

function quakeAtlasLeafKey(leaf) {
  const polyIndex = leaf.getAttribute("data-poly-index");
  if (polyIndex) return `p:${polyIndex}`;
  const leafClass = [...leaf.classList].find((className) => /^q[a-z0-9]+$/i.test(className));
  return leafClass ? `c:${leafClass}` : "";
}

async function loadQuakeAtlasImageData(url) {
  let cached = quakeAtlasImageDataCache.get(url);
  if (cached) return cached;
  cached = (async () => {
    const imageInfo = await renderBundleImageInfo(url);
    if (imageInfo?.data) {
      return {
        width: imageInfo.width,
        height: imageInfo.height,
        data: imageInfo.data,
      };
    }
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await (image.decode?.() ?? new Promise((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Could not load atlas image ${url}.`));
    }));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, image.naturalWidth || image.width || 1);
    canvas.height = Math.max(1, image.naturalHeight || image.height || 1);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0);
    return {
      width: canvas.width,
      height: canvas.height,
      data: context.getImageData(0, 0, canvas.width, canvas.height).data,
    };
  })();
  quakeAtlasImageDataCache.set(url, cached);
  return cached;
}

async function renderBundleImageInfo(url) {
  const readImageInfo = globalThis.__quakeRenderBundleImageInfo;
  if (typeof readImageInfo !== "function") return null;
  const info = await readImageInfo(url);
  return info?.width && info.height ? info : null;
}

function atlasLeafAlphaBounds(atlas, atlasSize, position, backgroundSize) {
  const [positionX, positionY] = position;
  const [backgroundWidth, backgroundHeight] = backgroundSize;
  const sourceLeft = Math.max(0, Math.floor((-positionX / backgroundWidth) * atlas.width) - 1);
  const sourceTop = Math.max(0, Math.floor((-positionY / backgroundHeight) * atlas.height) - 1);
  const sourceRight = Math.min(
    atlas.width,
    Math.ceil(((atlasSize - positionX) / backgroundWidth) * atlas.width) + 1,
  );
  const sourceBottom = Math.min(
    atlas.height,
    Math.ceil(((atlasSize - positionY) / backgroundHeight) * atlas.height) + 1,
  );
  if (sourceRight <= sourceLeft || sourceBottom <= sourceTop) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = sourceTop; y < sourceBottom; y++) {
    for (let x = sourceLeft; x < sourceRight; x++) {
      const alpha = atlas.data[(y * atlas.width + x) * 4 + 3];
      if (alpha <= 2) continue;
      const localX = ((x + 0.5) / atlas.width) * backgroundWidth + positionX;
      const localY = ((y + 0.5) / atlas.height) * backgroundHeight + positionY;
      if (localX < -1 || localY < -1 || localX > atlasSize + 1 || localY > atlasSize + 1) continue;
      minX = Math.min(minX, localX);
      minY = Math.min(minY, localY);
      maxX = Math.max(maxX, localX);
      maxY = Math.max(maxY, localY);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  const padding = 1;
  const x = Math.max(0, Math.floor(minX - padding));
  const y = Math.max(0, Math.floor(minY - padding));
  const right = Math.min(atlasSize, Math.ceil(maxX + padding));
  const bottom = Math.min(atlasSize, Math.ceil(maxY + padding));
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function cssUrlValue(value) {
  const match = /^url\((?:"([^"]+)"|'([^']+)'|([^)]*))\)$/.exec(value.trim());
  return match ? (match[1] ?? match[2] ?? match[3] ?? "").trim() : "";
}

function cssPixelPair(value, fallbackX = "", fallbackY = "") {
  const parts = value && value !== "normal"
    ? value.trim().split(/\s+/)
    : [fallbackX, fallbackY].filter(Boolean);
  if (parts.length === 1) parts.push(parts[0]);
  const x = cssPixelValue(parts[0]);
  const y = cssPixelValue(parts[1]);
  return x === null || y === null ? null : [x, y];
}

function cssPixelValue(value) {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(String(value).trim());
  return match ? Number(match[1]) : null;
}

function parseMatrix3d(value) {
  const match = /^matrix3d\(([^)]+)\)$/.exec(String(value).trim());
  if (!match) return null;
  const values = match[1].split(",").map((part) => Number(part.trim()));
  return values.length === 16 && values.every(Number.isFinite) ? values : null;
}

function translateMatrix3d(matrix, localX, localY) {
  const next = [...matrix];
  next[12] += matrix[0] * localX + matrix[4] * localY;
  next[13] += matrix[1] * localX + matrix[5] * localY;
  next[14] += matrix[2] * localX + matrix[6] * localY;
  next[15] += matrix[3] * localX + matrix[7] * localY;
  return next;
}

function formatMatrix3d(values) {
  return `matrix3d(${values.map((value) => Number(value.toFixed(6))).join(",")})`;
}

function roundCssPx(value) {
  return Number(value.toFixed(3));
}

function roundCssIntegerPx(value) {
  return Math.round(value);
}

async function serializeMeshWithAssets(mesh, options = {}) {
  const serializableMesh = runQuakeRenderBundleStep("serialize-clone", () =>
    options.mutateOriginal ? mesh : mesh.cloneNode(true)
  );
  const leafMetadata = runQuakeRenderBundleStep("serialize-metadata", () =>
    extractRenderBundleLeafMetadata(serializableMesh)
  );
  runQuakeRenderBundleStep("serialize-strip-metadata", () =>
    stripRenderBundleMeshMetadata(serializableMesh, {
      preserveLeafPolyIndex: Boolean(options.extractLeafStyles),
    })
  );
  const assetByBlobUrl = new Map();
  if (!options.skipBackgroundAssetExtraction) {
    if (options.normalizeAtlasLeafImagePixelBoxes) {
      await runQuakeRenderBundleStepAsync("serialize-normalize-atlas-leaf-boxes", () =>
        normalizeRenderBundleAtlasLeafImagePixelBoxes(serializableMesh)
      );
    }
    const styleElements = runQuakeRenderBundleStep("serialize-query-styles", () => [
      serializableMesh,
      ...serializableMesh.querySelectorAll("[style]"),
    ]);
    runQuakeRenderBundleStep("serialize-replace-blob-urls", () => {
      for (const element of styleElements) {
        const style = element.getAttribute("style");
        if (!style || !style.includes("blob:")) continue;
        const nextStyle = style.replace(/url\((['\"]?)(blob:[^)'\"]+)\1\)/g, (_match, _quote, blobUrl) => {
          let asset = assetByBlobUrl.get(blobUrl);
          if (!asset) {
            asset = {
              blobUrl,
              placeholder: `__QUAKE_RENDER_BUNDLE_ASSET_${assetByBlobUrl.size}__`,
            };
            assetByBlobUrl.set(blobUrl, asset);
          }
          return `url("${asset.placeholder}")`;
        });
        element.setAttribute("style", nextStyle);
      }
    });
    runQuakeRenderBundleStep("serialize-hoist-backgrounds", () =>
      hoistRenderBundleBackgroundImages(serializableMesh)
    );
  }
  const { meshCss, leafFrameStyles } = runQuakeRenderBundleStep("serialize-extract-styles", () =>
    options.extractLeafStyles
      ? extractRenderBundleLeafStyles(serializableMesh, options.styleClassName)
      : { meshCss: "", leafFrameStyles: [] }
  );

  const assets = [];
  await runQuakeRenderBundleStepAsync("serialize-assets", async () => {
    for (const asset of assetByBlobUrl.values()) {
      if (options.skipAssetPayloads) {
        assets.push({
          placeholder: asset.placeholder,
          mime: "image/png",
          skippedPayload: true,
        });
        continue;
      }
      const response = await runQuakeRenderBundleStepAsync("serialize-fetch-asset", () =>
        fetch(asset.blobUrl)
      );
      const blob = await runQuakeRenderBundleStepAsync("serialize-asset-blob", () =>
        response.blob()
      );
      const base64 = await runQuakeRenderBundleStepAsync("serialize-asset-base64", () =>
        blobToBase64(blob)
      );
      assets.push({
        placeholder: asset.placeholder,
        mime: blob.type || "image/png",
        base64,
      });
    }
  });

  return {
    meshHtml: runQuakeRenderBundleStep("serialize-outer-html", () => serializableMesh.outerHTML),
    meshCss,
    assets,
    leafMetadata,
    leafFrameStyles,
  };
}

function extractRenderBundleFrameStyles(mesh, options = {}) {
  const serializableMesh = mesh.cloneNode(true);
  stripRenderBundleMeshMetadata(serializableMesh, {
    preserveLeafPolyIndex: true,
  });
  hoistRenderBundleBackgroundImages(serializableMesh);
  const { leafFrameStyles } = extractRenderBundleLeafStyles(serializableMesh, options.styleClassName, {
    baseLeafFrameStylesByClass: options.baseLeafFrameStylesByClass ?? new Map(),
  });
  return {
    leafFrameStyles: inheritRenderBundleFrameStyleBackgrounds(
      leafFrameStyles,
      options.baseLeafFrameStylesByClass ?? new Map(),
    ),
  };
}

function extractRenderBundleFrameStylesReadOnly(mesh, options = {}) {
  const baseLeafFrameStylesByClass = options.baseLeafFrameStylesByClass ?? new Map();
  const inheritedBaseResult = extractRenderBundleFrameStylesFromInheritedBase(mesh, baseLeafFrameStylesByClass);
  if (inheritedBaseResult) return inheritedBaseResult;

  const stylesByElement = renderBundleHoistedStylesByElement(mesh);
  const leafFrameStyles = [];
  const usedLeafClasses = new Set();
  let fallbackLeafIndex = 0;
  let leafCount = 0;
  let atlasLeafCount = 0;
  for (const leaf of mesh.querySelectorAll("b,i,s,u")) {
    leafCount++;
    if (leaf.tagName?.toLowerCase() === "s") atlasLeafCount++;
    const rawStyle = stylesByElement.get(leaf) ?? leaf.getAttribute("style") ?? "";
    if (!rawStyle) continue;
    let leafClass = renderBundleLeafClass(leaf, usedLeafClasses);
    if (!leafClass) {
      do {
        leafClass = `qf${fallbackLeafIndex.toString(36)}`;
        fallbackLeafIndex++;
      } while (usedLeafClasses.has(leafClass));
      usedLeafClasses.add(leafClass);
    }
    const style = renderBundleLeafStyleWithExplicitAtlasSize(leaf, rawStyle, {
      baseFrameStyle: baseLeafFrameStylesByClass.get(leafClass),
    });
    leafFrameStyles.push([leafClass, compactRenderBundleLeafFrameStyle(style)]);
  }
  return {
    atlasLeafCount,
    leafCount,
    leafFrameStyles: inheritRenderBundleFrameStyleBackgrounds(
      leafFrameStyles,
      baseLeafFrameStylesByClass,
    ),
  };
}

function extractRenderBundleFrameStylesFromInheritedBase(mesh, baseLeafFrameStylesByClass) {
  if (!baseLeafFrameStylesByClass?.size) return null;
  const leafFrameStyles = [];
  const usedLeafClasses = new Set();
  let fallbackLeafIndex = 0;
  let leafCount = 0;
  let atlasLeafCount = 0;
  for (const leaf of mesh.querySelectorAll("b,i,s,u")) {
    leafCount++;
    if (leaf.tagName?.toLowerCase() === "s") atlasLeafCount++;
    const rawStyle = leaf.getAttribute("style") ?? "";
    if (!rawStyle) continue;
    let leafClass = renderBundleLeafClass(leaf, usedLeafClasses);
    if (!leafClass) {
      do {
        leafClass = `qf${fallbackLeafIndex.toString(36)}`;
        fallbackLeafIndex++;
      } while (usedLeafClasses.has(leafClass));
      usedLeafClasses.add(leafClass);
    }
    if (!baseLeafFrameStylesByClass.has(leafClass)) return null;
    const rawFrameStyle = (
      rawStyle.includes("--pn") ||
      rawStyle.includes("--polycss-atlas-size") ||
      rawStyle.includes("background-repeat")
    )
      ? stripRenderBundleStyleMetadata(rawStyle)
      : rawStyle;
    const style = renderBundleLeafStyleWithExplicitAtlasSize(leaf, rawFrameStyle, {
      baseFrameStyle: baseLeafFrameStylesByClass.get(leafClass),
    });
    leafFrameStyles.push([leafClass, compactRenderBundleInheritedLeafFrameStyle(style)]);
  }
  return {
    atlasLeafCount,
    leafCount,
    leafFrameStyles: inheritRenderBundleFrameStyleBackgrounds(
      leafFrameStyles,
      baseLeafFrameStylesByClass,
    ),
  };
}

function renderBundleHoistedStylesByElement(mesh) {
  const stylesByElement = new Map();
  const varByImage = new Map();
  const elements = [...mesh.querySelectorAll("[style]")];
  const imageUseCounts = renderBundleBackgroundImageUseCounts(elements);
  for (const element of elements) {
    const rawStyle = element.getAttribute("style") ?? "";
    const style = (
      rawStyle.includes("--pn") ||
      rawStyle.includes("--polycss-atlas-size") ||
      rawStyle.includes("background-repeat")
    )
      ? stripRenderBundleStyleMetadata(rawStyle)
      : rawStyle;
    if (!style.includes("background")) {
      stylesByElement.set(element, style);
      continue;
    }
    const nextStyle = compactRenderBundleBackgroundStyle(
      style.replace(/(background(?:-image)?):\s*url\(([^)]+)\)/g, (_match, property, image) => {
        if ((imageUseCounts.get(image) ?? 0) <= 1) return _match;
        let varName = varByImage.get(image);
        if (!varName) {
          varName = `--bg${varByImage.size}`;
          varByImage.set(image, varName);
        }
        return `${property}:var(${varName})`;
      }),
    );
    stylesByElement.set(element, nextStyle);
  }
  return stylesByElement;
}

function inheritRenderBundleFrameStyleBackgrounds(leafFrameStyles, baseLeafFrameStylesByClass) {
  return leafFrameStyles.map(([leafClass, frameStyle]) => {
    const baseFrameStyle = baseLeafFrameStylesByClass.get(leafClass);
    const background = baseFrameStyle?.[1] ?? frameStyle[1];
    return background
      ? [leafClass, [frameStyle[0] ?? "", background, frameStyle[2] ?? ""]]
      : [leafClass, frameStyle];
  });
}

function extractRenderBundleLeafMetadata(mesh) {
  return [...mesh.querySelectorAll("b,i,s,u")].map((leaf) => {
    const faceIndex = renderBundleIntegerAttr(leaf, "data-f");
    const polyIndex = renderBundleIntegerAttr(leaf, "data-poly-index");
    const modelIndex = renderBundleIntegerAttr(leaf, "data-m");
    const entityIndex = renderBundleIntegerAttr(leaf, "data-e");
    const textureName = leaf.getAttribute("data-tex");
    const lightstyle = leaf.getAttribute("data-ls");
    return {
      f: faceIndex ?? -1,
      ...(polyIndex !== undefined ? { p: polyIndex } : {}),
      ...(modelIndex !== undefined ? { m: modelIndex } : {}),
      ...(entityIndex !== undefined ? { e: entityIndex } : {}),
      ...(textureName ? { t: textureName } : {}),
      ...(lightstyle ? { l: lightstyle } : {}),
    };
  });
}

function renderBundleIntegerAttr(element, name) {
  const rawValue = element.getAttribute(name);
  if (rawValue === null || rawValue === "") return undefined;
  const value = Number(rawValue);
  return Number.isInteger(value) ? value : undefined;
}

function extractRenderBundleLeafStyles(mesh, styleClassName, options = {}) {
  if (!styleClassName || !/^[a-z_][a-z0-9_-]*$/i.test(styleClassName)) {
    throw new Error(`Invalid render bundle style class name ${JSON.stringify(styleClassName)}.`);
  }
  mesh.classList.add(styleClassName);
  const rules = [];
  const leafFrameStyles = [];
  const usedLeafClasses = new Set();
  let fallbackLeafIndex = 0;
  for (const leaf of mesh.querySelectorAll("b,i,s,u")) {
    const rawStyle = leaf.getAttribute("style") ?? "";
    if (!rawStyle) continue;
    let leafClass = renderBundleLeafClass(leaf, usedLeafClasses);
    if (!leafClass) {
      do {
        leafClass = `qf${fallbackLeafIndex.toString(36)}`;
        fallbackLeafIndex++;
      } while (usedLeafClasses.has(leafClass));
      usedLeafClasses.add(leafClass);
    }
    const style = renderBundleLeafStyleWithExplicitAtlasSize(leaf, rawStyle, {
      baseFrameStyle: options.baseLeafFrameStylesByClass?.get(leafClass),
    });
    leaf.classList.add(leafClass);
    leaf.removeAttribute("style");
    leaf.removeAttribute("data-poly-index");
    rules.push(`.${styleClassName} .${leafClass}{${style}}`);
    leafFrameStyles.push([leafClass, compactRenderBundleLeafFrameStyle(style)]);
  }
  for (const leaf of mesh.querySelectorAll("[data-poly-index]")) {
    leaf.removeAttribute("data-poly-index");
  }
  return { meshCss: rules.join(""), leafFrameStyles };
}

function compactRenderBundleLeafFrameStyle(style) {
  const declarations = renderBundleStyleDeclarations(style);
  const transform = declarations.find((part) => part.name === "transform");
  const background = declarations.find((part) => part.name === "background");
  const extras = declarations
    .filter((part) => part.name !== "transform" && part.name !== "background")
    .map((part) => `${part.name}:${part.value}`)
    .join(";");
  const matrix = transform?.value?.match(/^matrix3d\((.*)\)$/)?.[1] ?? transform?.value ?? "";
  const backgroundValue = background?.value?.replace(/^var\(--bg0\)\s*/, "") ?? "";
  if (!matrix && !backgroundValue) return ["", "", style];
  return [
    matrix,
    ...(backgroundValue ? [backgroundValue] : []),
    ...(extras ? [extras] : []),
  ];
}

function compactRenderBundleInheritedLeafFrameStyle(style) {
  const declarations = renderBundleStyleDeclarations(style);
  const transform = declarations.find((part) => part.name === "transform");
  const extras = declarations
    .filter((part) => part.name !== "transform" && part.name !== "background" && !part.name.startsWith("background-"))
    .map((part) => `${part.name}:${part.value}`)
    .join(";");
  const matrix = transform?.value?.match(/^matrix3d\((.*)\)$/)?.[1] ?? transform?.value ?? "";
  return [matrix, "", extras];
}

async function normalizeRenderBundleAtlasLeafImagePixelBoxes(mesh) {
  await Promise.all([...mesh.querySelectorAll("s")]
    .map((leaf) => normalizeRenderBundleAtlasLeafImagePixelBox(leaf)));
}

async function normalizeRenderBundleAtlasLeafImagePixelBox(leaf) {
  const win = leaf.ownerDocument.defaultView ?? window;
  let computedStyle = null;
  const style = () => {
    computedStyle ??= win.getComputedStyle(leaf);
    return computedStyle;
  };
  const backgroundImage = leaf.style.backgroundImage || style().backgroundImage;
  if (!backgroundImage || backgroundImage === "none") return;
  const imageUrl = cssUrlValue(backgroundImage);
  if (!imageUrl) return;
  const atlas = await loadQuakeAtlasImageData(imageUrl);
  if (!atlas?.width || !atlas.height) return;
  const backgroundPosition = cssPixelPair(
    leaf.style.backgroundPosition,
    leaf.style.backgroundPositionX,
    leaf.style.backgroundPositionY,
  ) ?? cssPixelPair(style().backgroundPosition, style().backgroundPositionX, style().backgroundPositionY);
  const backgroundSize = cssPixelPair(leaf.style.backgroundSize) ?? cssPixelPair(style().backgroundSize);
  const sourceWidth = renderBundleLeafCssSize(leaf, "width", style());
  const sourceHeight = renderBundleLeafCssSize(leaf, "height", style());
  if (
    !backgroundPosition ||
    !backgroundSize ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    backgroundSize[0] <= 0 ||
    backgroundSize[1] <= 0
  ) {
    return;
  }
  const targetWidth = atlas.width * sourceWidth / backgroundSize[0];
  const targetHeight = atlas.height * sourceHeight / backgroundSize[1];
  if (
    !Number.isFinite(targetWidth) ||
    !Number.isFinite(targetHeight) ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    return;
  }
  const matrix = parseMatrix3d(leaf.style.transform || style().transform);
  if (matrix) {
    leaf.style.transform = scaleRenderBundleLeafMatrix(matrix, sourceWidth, sourceHeight, targetWidth, targetHeight);
  }
  const scaleX = atlas.width / backgroundSize[0];
  const scaleY = atlas.height / backgroundSize[1];
  leaf.style.width = `${roundCssPx(targetWidth)}px`;
  leaf.style.height = `${roundCssPx(targetHeight)}px`;
  leaf.style.background = `${backgroundImage} ${roundCssPx(backgroundPosition[0] * scaleX)}px ` +
    `${roundCssPx(backgroundPosition[1] * scaleY)}px / ${roundCssPx(atlas.width)}px ` +
    `${roundCssPx(atlas.height)}px no-repeat`;
}

function renderBundleLeafCssSize(leaf, propertyName, style) {
  return cssPixelValue(leaf.style[propertyName]) ||
    cssPixelValue(leaf.style.getPropertyValue("--polycss-atlas-size")) ||
    cssPixelValue(style?.[propertyName]) ||
    64;
}

function renderBundleLeafFrameStyleSize(frameStyle, propertyName) {
  const extraStyle = frameStyle?.[2] ?? "";
  const declaration = renderBundleStyleDeclarations(extraStyle)
    .find((part) => part.name === propertyName);
  return cssPixelValue(declaration?.value);
}

function scaleRenderBundleLeafStyleToBox(leaf, style, width, height) {
  const declarations = renderBundleStyleDeclarations(style);
  const transform = declarations.find((part) => part.name === "transform");
  const matrix = parseMatrix3d(transform?.value);
  if (!matrix) return style;
  const computedStyle = leaf.ownerDocument.defaultView?.getComputedStyle(leaf);
  const sourceWidth = renderBundleLeafCssSize(leaf, "width", computedStyle);
  const sourceHeight = renderBundleLeafCssSize(leaf, "height", computedStyle);
  if (sourceWidth <= 0 || sourceHeight <= 0 || width <= 0 || height <= 0) return style;
  transform.value = scaleRenderBundleLeafMatrix(matrix, sourceWidth, sourceHeight, width, height);
  return declarations.map((part) => `${part.name}:${part.value}`).join(";");
}

function scaleRenderBundleLeafMatrix(matrix, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const next = [...matrix];
  const scaleX = sourceWidth / targetWidth;
  const scaleY = sourceHeight / targetHeight;
  for (let index = 0; index < 4; index++) next[index] *= scaleX;
  for (let index = 4; index < 8; index++) next[index] *= scaleY;
  return formatMatrix3d(next);
}

function renderBundleLeafStyleWithExplicitAtlasSize(leaf, style, options = {}) {
  if (leaf.tagName?.toLowerCase() !== "s" || !style) return style;
  const declarations = renderBundleStyleDeclarations(style);
  const hasWidth = declarations.some((part) => part.name === "width");
  const hasHeight = declarations.some((part) => part.name === "height");
  const baseWidth = renderBundleLeafFrameStyleSize(options.baseFrameStyle, "width");
  const baseHeight = renderBundleLeafFrameStyleSize(options.baseFrameStyle, "height");
  if (baseWidth && baseHeight) {
    style = scaleRenderBundleLeafStyleToBox(leaf, style, baseWidth, baseHeight);
    return renderBundleLeafStyleWithBox(style, baseWidth, baseHeight);
  }
  if (hasWidth && hasHeight) return style;
  const atlasSize = declarations.find((part) => part.name === "--polycss-atlas-size")?.value || "64px";
  return [
    style.replace(/;+$/, ""),
    ...(!hasWidth ? [`width:${baseWidth ? `${roundCssPx(baseWidth)}px` : atlasSize}`] : []),
    ...(!hasHeight ? [`height:${baseHeight ? `${roundCssPx(baseHeight)}px` : atlasSize}`] : []),
  ].filter(Boolean).join(";");
}

function renderBundleLeafStyleWithBox(style, width, height) {
  const declarations = renderBundleStyleDeclarations(style)
    .filter((part) => part.name !== "width" && part.name !== "height");
  declarations.push(
    { index: declarations.length, name: "width", value: `${roundCssPx(width)}px` },
    { index: declarations.length + 1, name: "height", value: `${roundCssPx(height)}px` },
  );
  return declarations.map((part) => `${part.name}:${part.value}`).join(";");
}

function renderBundleLeafClass(leaf, usedLeafClasses) {
  const polyIndex = renderBundleIntegerAttr(leaf, "data-poly-index");
  if (polyIndex === undefined || polyIndex < 0) return "";
  const leafClass = `q${polyIndex.toString(36)}`;
  if (usedLeafClasses.has(leafClass)) return "";
  usedLeafClasses.add(leafClass);
  return leafClass;
}

function hoistRenderBundleBackgroundImages(mesh) {
  const varByImage = new Map();
  const elements = [...mesh.querySelectorAll("[style]")];
  const imageUseCounts = renderBundleBackgroundImageUseCounts(elements);
  for (const element of elements) {
    const style = element.getAttribute("style") ?? "";
    if (!style.includes("background")) continue;
    const nextStyle = compactRenderBundleBackgroundStyle(
      style.replace(/(background(?:-image)?):\s*url\(([^)]+)\)/g, (_match, property, image) => {
        if ((imageUseCounts.get(image) ?? 0) <= 1) return _match;
        let varName = varByImage.get(image);
        if (!varName) {
          varName = `--bg${varByImage.size}`;
          varByImage.set(image, varName);
        }
        return `${property}:var(${varName})`;
      }),
    );
    if (nextStyle !== style) element.setAttribute("style", nextStyle);
  }

  const usedVarNames = renderBundleBackgroundVarNames(elements);
  setRenderBundleBackgroundVars(mesh, varByImage, usedVarNames);
}

function renderBundleBackgroundImageUseCounts(elements) {
  const counts = new Map();
  for (const element of elements) {
    const style = element.getAttribute("style") ?? "";
    if (!style.includes("background")) continue;
    for (const match of style.matchAll(/background(?:-image)?:\s*url\(([^)]+)\)/g)) {
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    }
  }
  return counts;
}

function renderBundleBackgroundVarNames(elements) {
  const names = new Set();
  for (const element of elements) {
    const style = element.getAttribute("style") ?? "";
    if (!style.includes("var(--bg")) continue;
    for (const match of style.matchAll(/var\(--bg(\d+)\)/g)) {
      names.add(`--bg${match[1]}`);
    }
  }
  return names;
}

function setRenderBundleBackgroundVars(mesh, varByImage, usedVarNames) {
  const declarations = [...varByImage]
    .filter(([_image, varName]) => usedVarNames.has(varName))
    .map(([image, varName]) => `${varName}:url(${image})`);
  const style = (mesh.getAttribute("style") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !/^--bg\d+\s*:/.test(part));
  const nextStyle = [...declarations, ...style].join(";");
  if (nextStyle) {
    mesh.setAttribute("style", nextStyle);
  } else {
    mesh.removeAttribute("style");
  }
}

function compactRenderBundleBackgroundStyle(style) {
  const declarations = renderBundleStyleDeclarations(style);
  const image = declarations.find((part) => part.name === "background-image");
  const position = declarations.find((part) => part.name === "background-position");
  const size = declarations.find((part) => part.name === "background-size");
  if (!image || !position || !size) return style;
  const background = {
    index: Math.min(image.index, position.index, size.index),
    name: "background",
    value: `${image.value} ${position.value}/${size.value}`,
  };
  return [...declarations.filter((part) => ![
    "background-image",
    "background-position",
    "background-size",
    "background-repeat",
  ].includes(part.name)), background]
    .sort((a, b) => a.index - b.index)
    .map((part) => `${part.name}:${part.value}`)
    .join(";");
}

function renderBundleStyleDeclarations(style) {
  return style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => {
      const separator = part.indexOf(":");
      return separator > 0
        ? { index, name: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim() }
        : null;
    })
    .filter((part) => part && part.value);
}

function stripRenderBundleMeshMetadata(mesh, options = {}) {
  mesh.removeAttribute("data-poly-mesh-id");
  mesh.removeAttribute("data-poly-mesh-index");
  if (!options.preserveLeafPolyIndex) {
    for (const leaf of mesh.querySelectorAll("[data-poly-index]")) {
      leaf.removeAttribute("data-poly-index");
    }
  }
  for (const leaf of mesh.querySelectorAll("b,i,s,u")) {
    leaf.removeAttribute("data-f");
    leaf.removeAttribute("data-m");
    leaf.removeAttribute("data-e");
    leaf.removeAttribute("data-lit");
    leaf.removeAttribute("data-ls");
    leaf.removeAttribute("data-tex");
  }
  for (const element of mesh.querySelectorAll("[style]")) {
    const style = element.getAttribute("style") ?? "";
    if (
      !style.includes("--pn") &&
      !style.includes("--polycss-atlas-size") &&
      !style.includes("background-repeat")
    ) continue;
    const nextStyle = stripRenderBundleStyleMetadata(style);
    if (nextStyle) {
      element.setAttribute("style", nextStyle);
    } else {
      element.removeAttribute("style");
    }
  }
}

function stripRenderBundleStyleMetadata(style) {
  return style
    .split(";")
    .map((part) => part.trim())
    .filter((part) =>
      part &&
      !/^--pn[xyz]\s*:/.test(part) &&
      !/^--polycss-atlas-size\s*:\s*64px$/i.test(part) &&
      !/^background-repeat\s*:\s*no-repeat$/i.test(part)
    )
    .join(";");
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read blob.")));
    reader.readAsDataURL(blob);
  });
}
