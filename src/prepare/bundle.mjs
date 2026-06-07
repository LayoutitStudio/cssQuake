import {
  BASE_TILE,
  createPolyPerspectiveCamera,
  createPolyScene,
} from "@layoutit/polycss";

import { QUAKE_RENDER_SUPERSAMPLE } from "../quakeScale.js";

const QUAKE_CAMERA_ZOOM = (BASE_TILE * 0.65) / QUAKE_RENDER_SUPERSAMPLE;
const QUAKE_RENDER_BUNDLE_TIMEOUT_MS = 30000;
const QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_MIN = 1;
const QUAKE_ADAPTIVE_ATLAS_LEAF_SIZE_STEP = 1;
const QUAKE_ADAPTIVE_ATLAS_BACKGROUND_SNAP_EPSILON = 0.25;

window.__buildQuakeRenderBundle = async function buildQuakeRenderBundle({
  polygons,
  textureQuality = 1,
  merge = false,
  extractLeafStyles = false,
  styleClassName = "",
  tightenAtlasLeaves = false,
  adaptiveAtlasLeafSize = false,
}) {
  const host = createQuakeRenderHost();

  try {
    const scene = createQuakeRenderScene(host, textureQuality);
    const handle = scene.add(
      { polygons, objectUrls: [], warnings: [], dispose: () => undefined },
      {
        merge,
        meshResolution: "lossless",
        excludeFromAutoCenter: true,
      },
    );

    await waitForBakedTextureLeaves(handle.element);
    if (tightenAtlasLeaves) await tightenQuakeAtlasLeaves(handle.element);
    const adaptiveAtlasLeafSizeStats = adaptiveAtlasLeafSize
      ? applyAdaptiveQuakeAtlasLeafSizes(handle.element)
      : null;
    const { meshHtml, meshCss, assets, leafMetadata, leafFrameStyles } = await serializeMeshWithAssets(handle.element, {
      extractLeafStyles,
      styleClassName,
      mutateOriginal: true,
    });
    return {
      meshHtml,
      meshCss,
      assets,
      leafMetadata,
      leafFrameStyles,
      leafCount: handle.element.querySelectorAll("b,i,s,u").length,
      atlasLeafCount: handle.element.querySelectorAll("s").length,
      polygonCount: polygons.length,
      ...(adaptiveAtlasLeafSizeStats ? { adaptiveAtlasLeafSizeStats } : {}),
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
    const scene = createQuakeRenderScene(host, textureQuality);
    const handle = scene.add(
      { polygons: firstFrame.polygons, objectUrls: [], warnings: [], dispose: () => undefined },
      {
        merge: false,
        meshResolution: "lossless",
        stableDom: true,
        excludeFromAutoCenter: true,
      },
    );
    const outFrames = [];
    let baseLeafFrameStylesByClass = new Map();
    let baseTightAtlasBoundsByKey = null;
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index];
      if (!frame?.polygons?.length) {
        throw new Error(`Animated render bundle frame ${index} has no polygons.`);
      }
      if (index > 0) {
        handle.setPolygons(frame.polygons, {
          merge: false,
          stableDom: true,
          recomputeAutoCenter: false,
        });
        await waitForRenderBundleFrameUpdate();
      }
      const name = frame.name ?? `frame-${index}`;
      await waitForBakedTextureLeaves(handle.element);
      if (tightenAtlasLeaves) {
        baseTightAtlasBoundsByKey = await tightenQuakeAtlasLeaves(handle.element, baseTightAtlasBoundsByKey);
      }
      const adaptiveAtlasLeafSizeStats = adaptiveAtlasLeafSize
        ? applyAdaptiveQuakeAtlasLeafSizes(handle.element)
        : null;
      if (index === 0) {
        const { meshHtml, meshCss, assets, leafMetadata, leafFrameStyles } = await serializeMeshWithAssets(handle.element, {
          extractLeafStyles,
          styleClassName: frame.styleClassName,
        });
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
        });
        continue;
      }
      const { leafFrameStyles } = extractRenderBundleFrameStyles(handle.element, {
        styleClassName: frame.styleClassName,
        baseLeafFrameStylesByClass,
      });
      outFrames.push({
        name,
        styleClassName: frame.styleClassName,
        leafFrameStyles,
        leafCount: handle.element.querySelectorAll("b,i,s,u").length,
        atlasLeafCount: handle.element.querySelectorAll("s").length,
        polygonCount: frame.polygons.length,
      });
    }
    return { frames: outFrames };
  } finally {
    host.remove();
  }
};

function createQuakeRenderHost() {
  const host = document.createElement("main");
  host.style.position = "absolute";
  host.style.left = "-100000px";
  host.style.top = "0";
  host.style.width = "1280px";
  host.style.height = "720px";
  document.body.appendChild(host);
  return host;
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
    requestAnimationFrame(() => requestAnimationFrame(resolve));
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
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

const quakeAtlasImageDataCache = new Map();

async function tightenQuakeAtlasLeaves(mesh, boundsByKey = null) {
  const leaves = [...mesh.querySelectorAll("s")];
  if (!leaves.length) return boundsByKey ?? new Map();
  const outBoundsByKey = boundsByKey ?? new Map();
  await Promise.all(leaves.map((leaf) => tightenQuakeAtlasLeaf(leaf, outBoundsByKey, Boolean(boundsByKey))));
  return outBoundsByKey;
}

async function tightenQuakeAtlasLeaf(leaf, boundsByKey, useExistingBounds) {
  const win = leaf.ownerDocument.defaultView ?? window;
  const style = win.getComputedStyle(leaf);
  const atlasSize = cssPixelValue(leaf.style.getPropertyValue("--polycss-atlas-size")) ||
    cssPixelValue(style.width) ||
    64;
  const position = cssPixelPair(style.backgroundPosition, style.backgroundPositionX, style.backgroundPositionY);
  const size = cssPixelPair(style.backgroundSize);
  const matrix = parseMatrix3d(leaf.style.transform || style.transform);
  if (!position || !size || !matrix || atlasSize <= 0 || size[0] <= 0 || size[1] <= 0) return;
  const key = quakeAtlasLeafKey(leaf);
  let bounds = key ? boundsByKey.get(key) : null;
  if (!bounds && !useExistingBounds) {
    const imageUrl = cssUrlValue(style.backgroundImage);
    if (!imageUrl) return;
    const atlas = await loadQuakeAtlasImageData(imageUrl);
    if (!atlas) return;
    bounds = atlasLeafAlphaBounds(atlas, atlasSize, position, size);
    if (bounds && key) boundsByKey.set(key, bounds);
  }
  if (!bounds) return;
  const fullArea = atlasSize * atlasSize;
  const tightArea = bounds.width * bounds.height;
  if (tightArea <= 0 || tightArea >= fullArea * 0.985) return;
  const nextMatrix = translateMatrix3d(matrix, bounds.x, bounds.y);
  leaf.style.transform = formatMatrix3d(nextMatrix);
  leaf.style.width = `${roundCssPx(bounds.width)}px`;
  leaf.style.height = `${roundCssPx(bounds.height)}px`;
  leaf.style.background = `${style.backgroundImage} ${roundCssPx(position[0] - bounds.x)}px ` +
    `${roundCssPx(position[1] - bounds.y)}px / ${roundCssPx(size[0])}px ${roundCssPx(size[1])}px no-repeat`;
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
  const style = win.getComputedStyle(leaf);
  const matrix = parseMatrix3d(leaf.style.transform || style.transform);
  if (!matrix) return null;

  const beforeWidth = cssPixelValue(leaf.style.width) ||
    cssPixelValue(leaf.style.getPropertyValue("--polycss-atlas-size")) ||
    cssPixelValue(style.width) ||
    64;
  const beforeHeight = cssPixelValue(leaf.style.height) ||
    cssPixelValue(leaf.style.getPropertyValue("--polycss-atlas-size")) ||
    cssPixelValue(style.height) ||
    64;
  if (beforeWidth <= 0 || beforeHeight <= 0) return null;

  const matrixScaleX = Math.hypot(matrix[0], matrix[1], matrix[2]);
  const matrixScaleY = Math.hypot(matrix[4], matrix[5], matrix[6]);
  const afterWidth = adaptiveQuakeAtlasLeafSide(beforeWidth, matrixScaleX);
  const afterHeight = adaptiveQuakeAtlasLeafSide(beforeHeight, matrixScaleY);
  if (afterWidth === beforeWidth && afterHeight === beforeHeight) {
    return { beforeWidth, beforeHeight, afterWidth, afterHeight, resized: false };
  }

  const background = adaptiveQuakeAtlasLeafBackground(leaf, style, afterWidth / beforeWidth, afterHeight / beforeHeight);
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
  return `${backgroundImage} ${roundAdaptiveCssPx(position[0] * scaleX)}px ` +
    `${roundAdaptiveCssPx(position[1] * scaleY)}px / ${roundAdaptiveCssPx(size[0] * scaleX)}px ` +
    `${roundAdaptiveCssPx(size[1] * scaleY)}px no-repeat`;
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

function roundAdaptiveCssPx(value) {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) <= QUAKE_ADAPTIVE_ATLAS_BACKGROUND_SNAP_EPSILON
    ? rounded
    : roundCssPx(value);
}

async function serializeMeshWithAssets(mesh, options = {}) {
  const serializableMesh = options.mutateOriginal ? mesh : mesh.cloneNode(true);
  const leafMetadata = extractRenderBundleLeafMetadata(serializableMesh);
  stripRenderBundleMeshMetadata(serializableMesh, {
    preserveLeafPolyIndex: Boolean(options.extractLeafStyles),
  });
  const assetByBlobUrl = new Map();
  const styleElements = [serializableMesh, ...serializableMesh.querySelectorAll("[style]")];
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
  hoistRenderBundleBackgroundImages(serializableMesh);
  const { meshCss, leafFrameStyles } = options.extractLeafStyles
    ? extractRenderBundleLeafStyles(serializableMesh, options.styleClassName)
    : { meshCss: "", leafFrameStyles: [] };

  const assets = [];
  for (const asset of assetByBlobUrl.values()) {
    const response = await fetch(asset.blobUrl);
    const blob = await response.blob();
    assets.push({
      placeholder: asset.placeholder,
      mime: blob.type || "image/png",
      base64: await blobToBase64(blob),
    });
  }

  return {
    meshHtml: serializableMesh.outerHTML,
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
  const { leafFrameStyles } = extractRenderBundleLeafStyles(serializableMesh, options.styleClassName);
  return {
    leafFrameStyles: inheritRenderBundleFrameStyleBackgrounds(
      leafFrameStyles,
      options.baseLeafFrameStylesByClass ?? new Map(),
    ),
  };
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
  const value = Number(element.getAttribute(name));
  return Number.isInteger(value) ? value : undefined;
}

function extractRenderBundleLeafStyles(mesh, styleClassName) {
  if (!styleClassName || !/^[a-z_][a-z0-9_-]*$/i.test(styleClassName)) {
    throw new Error(`Invalid render bundle style class name ${JSON.stringify(styleClassName)}.`);
  }
  mesh.classList.add(styleClassName);
  const rules = [];
  const leafFrameStyles = [];
  const usedLeafClasses = new Set();
  let fallbackLeafIndex = 0;
  for (const leaf of mesh.querySelectorAll("b,i,s,u")) {
    const style = leaf.getAttribute("style");
    if (!style) continue;
    let leafClass = renderBundleLeafClass(leaf, usedLeafClasses);
    if (!leafClass) {
      do {
        leafClass = `qf${fallbackLeafIndex.toString(36)}`;
        fallbackLeafIndex++;
      } while (usedLeafClasses.has(leafClass));
      usedLeafClasses.add(leafClass);
    }
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

function renderBundleLeafClass(leaf, usedLeafClasses) {
  const polyIndex = Number(leaf.getAttribute("data-poly-index"));
  if (!Number.isSafeInteger(polyIndex) || polyIndex < 0) return "";
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
