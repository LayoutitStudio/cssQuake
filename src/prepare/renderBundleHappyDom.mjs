import { createCanvas, DOMMatrix, DOMPoint, DOMRect, Image as CanvasImage, ImageData, Path2D } from "@napi-rs/canvas";
import { Window } from "happy-dom";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const bundleModulePath = path.join(scriptDir, "bundle.mjs");
const chromeUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) HeadlessChrome/148.0.7778.96 Safari/537.36";

let renderBundleFunctionsPromise;
let renderBundleQueue = Promise.resolve();
const chromeBackgroundByStyle = new WeakMap();

export async function buildQuakeRenderBundleHappyDom(input, options = {}) {
  return enqueueQuakeRenderBundleHappyDomBuild(async () => {
    let environment = null;
    try {
      environment = await createQuakeRenderBundleHappyDomEnvironment();
      const resolvedInput = await resolveRenderBundleTextureUrls(input, options);
      return await environment.window.__buildQuakeRenderBundle(resolvedInput);
    } finally {
      await environment?.close();
    }
  });
}

export async function buildQuakeAnimatedRenderBundleHappyDom(input, options = {}) {
  return enqueueQuakeRenderBundleHappyDomBuild(async () => {
    let environment = null;
    try {
      environment = await createQuakeRenderBundleHappyDomEnvironment();
      const resolvedInput = await resolveAnimatedRenderBundleTextureUrls(input, options);
      return await environment.window.__buildQuakeAnimatedRenderBundle(resolvedInput);
    } finally {
      await environment?.close();
    }
  });
}

function enqueueQuakeRenderBundleHappyDomBuild(callback) {
  const run = renderBundleQueue.then(
    () => callback(),
    () => callback(),
  );
  renderBundleQueue = run.catch(() => undefined);
  return run;
}

async function createQuakeRenderBundleHappyDomEnvironment() {
  const window = new Window({
    url: "http://quake-render-bundle.local/",
    settings: {
      disableJavaScriptFileLoading: true,
      disableJavaScriptEvaluation: true,
      disableCSSFileLoading: true,
    },
  });
  const { document } = window;
  const blobUrls = new Map();
  const NativeURL = URL;
  let nextBlobId = 0;

  class RenderBundleURL extends NativeURL {
    static createObjectURL(blob) {
      const url = `blob:quake-render-bundle-${nextBlobId++}`;
      blobUrls.set(url, blob);
      return url;
    }

    static revokeObjectURL(url) {
      blobUrls.delete(url);
    }
  }

  const nativeFetch = globalThis.fetch.bind(globalThis);
  const fetchBlobUrl = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    if (blobUrls.has(url)) {
      const blob = blobUrls.get(url);
      return {
        ok: true,
        status: 200,
        blob: async () => blob,
        arrayBuffer: () => blob.arrayBuffer(),
      };
    }
    return nativeFetch(input, init);
  };
  const RenderBundleImage = createRenderBundleImageClass(blobUrls);
  const renderBundleImageInfo = createRenderBundleImageInfoReader(blobUrls);
  const scheduler = createQuakeRenderBundleScheduler(window);

  patchQuakeRenderBundleCanvas(document);
  patchQuakeRenderBundleStyleDeclaration(window);
  patchQuakeRenderBundleFeatureDetection(window);
  const restoreGlobals = exposeQuakeRenderBundleGlobals(window, {
    DOMMatrix,
    DOMPoint,
    DOMRect,
    fetch: fetchBlobUrl,
    Image: RenderBundleImage,
    ImageData,
    Path2D,
    __quakeRenderBundleImageInfo: renderBundleImageInfo,
    clearTimeout: scheduler.clearTimeout,
    requestAnimationFrame: scheduler.requestAnimationFrame,
    cancelAnimationFrame: scheduler.cancelAnimationFrame,
    setTimeout: scheduler.setTimeout,
    URL: RenderBundleURL,
  });
  await attachQuakeRenderBundleFunctions(window);

  return {
    window,
    close() {
      blobUrls.clear();
      window.close?.();
      restoreGlobals();
    },
  };
}

function createQuakeRenderBundleScheduler(window) {
  const nativeClearTimeout = clearTimeout;
  const nativeSetTimeout = setTimeout;
  return {
    clearTimeout: (id) => nativeClearTimeout(id),
    cancelAnimationFrame: (id) => nativeClearTimeout(id),
    requestAnimationFrame(callback) {
      return nativeSetTimeout(() => callback(window.performance.now()), 0);
    },
    setTimeout(callback, delay = 0, ...args) {
      const delayMs = Number(delay) || 0;
      return nativeSetTimeout(() => {
        if (typeof callback !== "function") return undefined;
        return callback(...args);
      }, delayMs);
    },
  };
}

async function attachQuakeRenderBundleFunctions(window) {
  if (!renderBundleFunctionsPromise) {
    renderBundleFunctionsPromise = import(`${pathToFileURL(bundleModulePath).href}?happy-dom-runtime`)
      .then(() => {
        const build = window.__buildQuakeRenderBundle;
        const buildAnimated = window.__buildQuakeAnimatedRenderBundle;
        if (typeof build !== "function" || typeof buildAnimated !== "function") {
          throw new Error("Could not initialize happy-dom render bundle functions.");
        }
        return { build, buildAnimated };
      });
  }
  const functions = await renderBundleFunctionsPromise;
  window.__buildQuakeRenderBundle = functions.build;
  window.__buildQuakeAnimatedRenderBundle = functions.buildAnimated;
}

function patchQuakeRenderBundleCanvas(document) {
  const originalCreateElement = document.createElement.bind(document);
  document.createElement = (tagName, elementOptions) => {
    if (String(tagName).toLowerCase() !== "canvas") {
      return originalCreateElement(tagName, elementOptions);
    }
    const canvas = createCanvas(1, 1);
    canvas.ownerDocument = document;
    const getContext = canvas.getContext.bind(canvas);
    canvas.getContext = (...args) => {
      const context = getContext(...args);
      if (!context || context.__quakeRenderBundleDrawImagePatched) return context;
      context.imageSmoothingEnabled = false;
      patchQuakeCanvasContextPathTracking(context);
      const drawImage = context.drawImage.bind(context);
      context.drawImage = (...drawArgs) => {
        if (drawQuakeNearestImageData(context, drawArgs)) {
          return;
        }
        return drawImage(...drawArgs.map((arg) => arg?.__quakeCanvasImage ?? arg));
      };
      context.__quakeRenderBundleDrawImagePatched = true;
      return context;
    };
    canvas.toBlob = (callback, type = "image/png") => {
      try {
        const buffer = canvas.toBuffer(type);
        callback(new document.defaultView.Blob([buffer], { type }));
      } catch {
        callback(null);
      }
    };
    return canvas;
  };
}

function patchQuakeCanvasContextPathTracking(context) {
  if (context.__quakePathTrackingPatched) return;
  const native = {
    beginPath: context.beginPath.bind(context),
    clip: context.clip.bind(context),
    closePath: context.closePath.bind(context),
    lineTo: context.lineTo.bind(context),
    moveTo: context.moveTo.bind(context),
    restore: context.restore.bind(context),
    save: context.save.bind(context),
  };
  const stateStack = [];
  let currentClips = [];
  let currentPath = [];

  const transformedPoint = (x, y) => {
    const matrix = context.getTransform?.();
    return matrix?.is2D
      ? [matrix.a * x + matrix.c * y + matrix.e, matrix.b * x + matrix.d * y + matrix.f]
      : [x, y];
  };

  context.__quakeCanvasClipPolygons = () => currentClips;
  context.save = (...args) => {
    stateStack.push({
      clips: currentClips.map((polygon) => polygon.map((point) => [...point])),
    });
    return native.save(...args);
  };
  context.restore = (...args) => {
    const state = stateStack.pop();
    currentClips = state?.clips ?? [];
    currentPath = [];
    return native.restore(...args);
  };
  context.beginPath = (...args) => {
    currentPath = [];
    return native.beginPath(...args);
  };
  context.moveTo = (x, y, ...args) => {
    currentPath = [transformedPoint(x, y)];
    return native.moveTo(x, y, ...args);
  };
  context.lineTo = (x, y, ...args) => {
    currentPath.push(transformedPoint(x, y));
    return native.lineTo(x, y, ...args);
  };
  context.closePath = (...args) => native.closePath(...args);
  context.clip = (...args) => {
    if (currentPath.length >= 3) currentClips.push(currentPath.map((point) => [...point]));
    return native.clip(...args);
  };
  context.__quakePathTrackingPatched = true;
}

function patchQuakeRenderBundleStyleDeclaration(window) {
  const style = window.document.createElement("s").style;
  const stylePrototype = Object.getPrototypeOf(style);
  const backgroundDescriptor = Object.getOwnPropertyDescriptor(stylePrototype, "background");
  const cssTextDescriptor = Object.getOwnPropertyDescriptor(stylePrototype, "cssText");
  const setProperty = stylePrototype.setProperty;
  const getPropertyValue = stylePrototype.getPropertyValue;
  stylePrototype.setProperty = function patchedSetProperty(name, value, priority) {
    const normalizedName = String(name).trim().toLowerCase();
    if (normalizedName === "background") {
      const parsed = parseChromeBackgroundShorthand(value);
      if (parsed) {
        setChromeBackgroundLonghands(this, parsed, setProperty);
        return undefined;
      }
    }
    updateChromeBackgroundPart(this, chromeBackgroundPatchForProperty(normalizedName, value));
    return setProperty.call(this, name, value, priority);
  };
  stylePrototype.getPropertyValue = function patchedGetPropertyValue(name) {
    const parsedValue = chromeBackgroundPropertyValue(chromeBackgroundByStyle.get(this), name);
    return parsedValue ?? getPropertyValue.call(this, name);
  };
  patchChromeBackgroundLonghandProperty(stylePrototype, "backgroundImage", "background-image", (parsed) => parsed.image);
  patchChromeBackgroundLonghandProperty(stylePrototype, "backgroundPosition", "background-position", (parsed) =>
    parsed.x && parsed.y ? `${parsed.x} ${parsed.y}` : null
  );
  patchChromeBackgroundLonghandProperty(stylePrototype, "backgroundPositionX", "background-position-x", (parsed) => parsed.x);
  patchChromeBackgroundLonghandProperty(stylePrototype, "backgroundPositionY", "background-position-y", (parsed) => parsed.y);
  patchChromeBackgroundLonghandProperty(stylePrototype, "backgroundRepeat", "background-repeat", (parsed) => parsed.repeat);
  patchChromeBackgroundLonghandProperty(stylePrototype, "backgroundSize", "background-size", (parsed) =>
    parsed.width && parsed.height ? `${parsed.width} ${parsed.height}` : null
  );
  Object.defineProperty(stylePrototype, "background", {
    configurable: true,
    get() {
      const parsed = chromeBackgroundByStyle.get(this);
      return chromeBackgroundIsComplete(parsed)
        ? chromeBackgroundShorthand(parsed)
        : backgroundDescriptor?.get?.call(this) ?? this.getPropertyValue("background");
    },
    set(value) {
      const parsed = parseChromeBackgroundShorthand(value);
      if (!parsed) {
        if (backgroundDescriptor?.set) {
          backgroundDescriptor.set.call(this, value);
        } else {
          this.setProperty("background", value);
        }
        return;
      }
      setChromeBackgroundLonghands(this, parsed, setProperty);
    },
  });
  Object.defineProperty(stylePrototype, "cssText", {
    configurable: true,
    get() {
      return cssTextDescriptor?.get?.call(this) ?? "";
    },
    set(value) {
      const parsed = chromeBackgroundFromStyleAttribute(value);
      const expanded = expandChromeStyleAttributeBackgrounds(value);
      if (cssTextDescriptor?.set) {
        cssTextDescriptor.set.call(this, expanded);
      } else {
        for (const part of expanded.split(";").map((item) => item.trim()).filter(Boolean)) {
          const separator = part.indexOf(":");
          if (separator > 0) setProperty.call(this, part.slice(0, separator).trim(), part.slice(separator + 1).trim());
        }
      }
      if (parsed) chromeBackgroundByStyle.set(this, parsed);
    },
  });

  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = (element, pseudoElement) => {
    const computed = getComputedStyle(element, pseudoElement);
    const parsed = element?.style ? chromeBackgroundByStyle.get(element.style) : null;
    if (parsed) chromeBackgroundByStyle.set(computed, parsed);
    return computed;
  };

  const elementPrototype = window.Element.prototype;
  const cloneNode = elementPrototype.cloneNode;
  const getAttribute = elementPrototype.getAttribute;
  const outerHTMLDescriptor = Object.getOwnPropertyDescriptor(elementPrototype, "outerHTML");
  const setAttribute = elementPrototype.setAttribute;
  if (outerHTMLDescriptor?.get) {
    Object.defineProperty(elementPrototype, "outerHTML", {
      configurable: true,
      get() {
        return canonicalizeChromeStyleAttributesInHtml(outerHTMLDescriptor.get.call(this));
      },
      set: outerHTMLDescriptor.set,
    });
  }
  elementPrototype.cloneNode = function patchedCloneNode(deep = false) {
    const clone = cloneNode.call(this, deep);
    copyChromeBackgroundStyleCache(this, clone, Boolean(deep));
    return clone;
  };
  elementPrototype.setAttribute = function patchedSetAttribute(name, value) {
    if (String(name).toLowerCase() !== "style") {
      return setAttribute.call(this, name, value);
    }
    const parsed = chromeBackgroundFromStyleAttribute(value);
    const result = setAttribute.call(this, name, expandChromeStyleAttributeBackgrounds(value));
    if (parsed) chromeBackgroundByStyle.set(this.style, parsed);
    return result;
  };
  elementPrototype.getAttribute = function patchedGetAttribute(name) {
    const value = getAttribute.call(this, name);
    return String(name).toLowerCase() === "style"
      ? canonicalizeChromeStyleAttribute(value, this.style)
      : value;
  };
}

function canonicalizeChromeStyleAttributesInHtml(html) {
  return String(html ?? "").replace(/\sstyle="([^"]*)"/g, (match, style) => {
    const canonical = canonicalizeChromeStyleAttribute(style);
    return canonical === style ? match : ` style="${canonical}"`;
  });
}

function copyChromeBackgroundStyleCache(source, target, deep) {
  copyOneChromeBackgroundStyleCache(source, target);
  if (!deep || typeof source.querySelectorAll !== "function" || typeof target.querySelectorAll !== "function") return;
  const sourceElements = source.querySelectorAll("[style]");
  const targetElements = target.querySelectorAll("[style]");
  for (let index = 0; index < sourceElements.length; index++) {
    copyOneChromeBackgroundStyleCache(sourceElements[index], targetElements[index]);
  }
}

function copyOneChromeBackgroundStyleCache(source, target) {
  if (!source?.style || !target?.style) return;
  const parsed = chromeBackgroundByStyle.get(source.style);
  if (parsed) chromeBackgroundByStyle.set(target.style, parsed);
}

function setChromeBackgroundLonghands(style, parsed, setProperty) {
  setProperty.call(style, "background-image", parsed.image);
  setProperty.call(style, "background-position", `${parsed.x} ${parsed.y}`);
  setProperty.call(style, "background-size", `${parsed.width} ${parsed.height}`);
  setProperty.call(style, "background-repeat", parsed.repeat);
  chromeBackgroundByStyle.set(style, parsed);
}

function patchChromeBackgroundLonghandProperty(stylePrototype, property, cssProperty, valueForParsed) {
  const descriptor = Object.getOwnPropertyDescriptor(stylePrototype, property);
  if (!descriptor?.get) return;
  Object.defineProperty(stylePrototype, property, {
    configurable: true,
    get() {
      const parsed = chromeBackgroundByStyle.get(this);
      const value = parsed ? valueForParsed(parsed) : null;
      return value ?? descriptor.get.call(this);
    },
    set: descriptor.set
      ? function patchedChromeBackgroundLonghandSetter(value) {
        updateChromeBackgroundPart(this, chromeBackgroundPatchForProperty(cssProperty, value));
        return descriptor.set.call(this, value);
      }
      : undefined,
  });
}

function chromeBackgroundPropertyValue(parsed, name) {
  if (!parsed) return null;
  switch (String(name).trim().toLowerCase()) {
    case "background":
      return chromeBackgroundIsComplete(parsed) ? chromeBackgroundShorthand(parsed) : null;
    case "background-image":
      return parsed.image ?? null;
    case "background-position":
      return parsed.x && parsed.y ? `${parsed.x} ${parsed.y}` : null;
    case "background-position-x":
      return parsed.x ?? null;
    case "background-position-y":
      return parsed.y ?? null;
    case "background-repeat":
      return parsed.repeat ?? null;
    case "background-size":
      return parsed.width && parsed.height ? `${parsed.width} ${parsed.height}` : null;
    default:
      return null;
  }
}

function chromeBackgroundPatchForProperty(name, value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  switch (name) {
    case "background-image":
      return { image: text };
    case "background-position": {
      const pair = cssPixelPair(text);
      return pair ? { x: pair[0], y: pair[1] } : null;
    }
    case "background-position-x":
      return { x: text };
    case "background-position-y":
      return { y: text };
    case "background-repeat":
      return { repeat: text };
    case "background-size": {
      const pair = cssPixelPair(text);
      return pair ? { width: pair[0], height: pair[1] } : null;
    }
    default:
      return null;
  }
}

function updateChromeBackgroundPart(style, patch) {
  if (!style || !patch) return;
  chromeBackgroundByStyle.set(style, {
    repeat: "no-repeat",
    ...(chromeBackgroundByStyle.get(style) ?? {}),
    ...patch,
  });
}

function cssPixelPair(value) {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length || !parts.every((part) => /^-?\d+(?:\.\d+)?px$/i.test(part))) return null;
  return [parts[0], parts[1] ?? parts[0]];
}

function chromeBackgroundIsComplete(parsed) {
  return Boolean(parsed?.image && parsed?.x && parsed?.y && parsed?.width && parsed?.height && parsed?.repeat);
}

function parseChromeBackgroundShorthand(value) {
  const match = String(value ?? "").trim().match(
    /^((?:url\((?:"[^"]+"|'[^']+'|[^)]+)\)|var\(--[a-z0-9_-]+\)))\s+(-?\d+(?:\.\d+)?px)\s+(-?\d+(?:\.\d+)?px)\s*\/\s*(-?\d+(?:\.\d+)?px)\s+(-?\d+(?:\.\d+)?px)(?:\s+([a-z-]+))?$/i,
  );
  if (!match) return null;
  return {
    image: match[1],
    x: match[2],
    y: match[3],
    width: match[4],
    height: match[5],
    repeat: match[6] ?? "no-repeat",
  };
}

function chromeBackgroundFromStyleAttribute(style) {
  let out = null;
  for (const part of String(style ?? "").split(";")) {
    const separator = part.indexOf(":");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === "background") {
      const parsed = parseChromeBackgroundShorthand(value);
      if (parsed) return parsed;
    }
    const patch = chromeBackgroundPatchForProperty(name, value);
    if (patch) {
      out = { repeat: "no-repeat", ...(out ?? {}), ...patch };
    }
  }
  return out;
}

function expandChromeStyleAttributeBackgrounds(style) {
  return String(style ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const separator = part.indexOf(":");
      if (separator <= 0 || part.slice(0, separator).trim() !== "background") return [part];
      const parsed = parseChromeBackgroundShorthand(part.slice(separator + 1));
      if (!parsed) return [part];
      return [
        `background-image: ${parsed.image}`,
        `background-position: ${parsed.x} ${parsed.y}`,
        `background-size: ${parsed.width} ${parsed.height}`,
        `background-repeat: ${parsed.repeat}`,
      ];
    })
    .join("; ");
}

function chromeBackgroundShorthand(parsed) {
  return `${parsed.image} ${parsed.x} ${parsed.y} / ${parsed.width} ${parsed.height} ${parsed.repeat}`;
}

function canonicalizeChromeStyleAttribute(style, styleDeclaration = null) {
  const parsed = styleDeclaration ? chromeBackgroundByStyle.get(styleDeclaration) : null;
  if (parsed && style?.includes("background:") && !style.includes("background-image")) {
    return canonicalizeChromeStyleTransforms(String(style)
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf(":");
        return separator > 0 && part.slice(0, separator).trim() === "background"
          ? `background: ${chromeBackgroundShorthand(parsed)}`
          : part;
      })
      .join("; "));
  }
  if (!style || !style.includes("background-image")) return canonicalizeChromeStyleTransforms(style);
  const declarations = style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => {
      const separator = part.indexOf(":");
      return separator > 0
        ? { index, name: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim() }
        : null;
    })
    .filter(Boolean);
  const image = declarations.find((part) => part.name === "background-image");
  const position = declarations.find((part) => part.name === "background-position");
  const size = declarations.find((part) => part.name === "background-size");
  const repeat = declarations.find((part) => part.name === "background-repeat");
  if (!image || !position || !size || !repeat) return canonicalizeChromeStyleTransforms(style);
  const background = {
    index: Math.min(image.index, position.index, size.index, repeat.index),
    name: "background",
    value: `${image.value} ${position.value} / ${size.value} ${repeat.value}`,
  };
  const canonical = [...declarations.filter((part) => ![
    "background-image",
    "background-position",
    "background-size",
    "background-repeat",
  ].includes(part.name)), background]
    .sort((a, b) => a.index - b.index)
    .map((part) => `${part.name}: ${part.value}`)
    .join("; ");
  return canonicalizeChromeStyleTransforms(canonical);
}

function canonicalizeChromeStyleTransforms(style) {
  if (!style || !String(style).includes("matrix3d(")) return style;
  return String(style)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf(":");
      if (separator <= 0 || part.slice(0, separator).trim() !== "transform") return part;
      return `transform: ${canonicalChromeMatrix3d(part.slice(separator + 1).trim())}`;
    })
    .join("; ");
}

function canonicalChromeMatrix3d(value) {
  const match = String(value ?? "").match(/^matrix3d\(([^)]+)\)$/);
  if (!match) return value;
  const values = match[1].split(",").map((part) => Number(part.trim()));
  if (values.length !== 16 || values.some((part) => !Number.isFinite(part))) return value;
  return `matrix3d(${values.map((part, index) => formatChromeMatrixNumber(part, index)).join(", ")})`;
}

function formatChromeMatrixNumber(value, index) {
  const snapped = index >= 12 && index <= 14 ? snapChromeMatrixTranslation(value) : value;
  if (Math.abs(snapped) >= 1000) return formatChromeLargeMatrixNumber(snapped);
  return trimFixed(snapped, 6);
}

function formatChromeLargeMatrixNumber(value) {
  const grid = Math.round(value / 0.125) * 0.125;
  const rounded = Math.abs(value - grid) <= 1e-9
    ? roundHalfEven(value, 2)
    : Number(adjustChromeNonGridLargeNumber(value).toFixed(2));
  return trimFixed(rounded, 2);
}

function adjustChromeNonGridLargeNumber(value) {
  if (value >= 0) return value;
  const scaled = Math.abs(value) * 1000;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) <= 1e-6 && rounded % 10 === 6) return value + 0.001;
  return value;
}

function snapChromeMatrixTranslation(value) {
  if (value < 0 || Math.abs(value) < 1000) return value;
  const snapped = Math.round(value / 0.125) * 0.125;
  return Math.abs(value - snapped) <= 0.01 ? snapped : value;
}

function roundHalfEven(value, decimals) {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const sign = Math.sign(scaled) || 1;
  const abs = Math.abs(scaled);
  const floor = Math.floor(abs);
  const fraction = abs - floor;
  if (fraction === 0.5) {
    const even = floor % 2 === 0 ? floor : floor + 1;
    return (sign * even) / factor;
  }
  return Math.round(scaled) / factor;
}

function trimFixed(value, decimals) {
  return Number(value.toFixed(decimals)).toString();
}

function createRenderBundleImageInfoReader(blobUrls) {
  const cache = new Map();
  return async (source) => {
    const blobUrl = renderBundleBlobUrl(source, blobUrls);
    const blob = blobUrl ? blobUrls.get(blobUrl) : null;
    if (!blob) return null;
    let promise = cache.get(blobUrl);
    if (!promise) {
      promise = (async () => {
        const buffer = Buffer.from(await blob.arrayBuffer());
        const { data, info } = await sharp(buffer)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        return info.width && info.height
          ? { width: info.width, height: info.height, data: new Uint8ClampedArray(data) }
          : null;
      })();
      cache.set(blobUrl, promise);
    }
    return promise;
  };
}

function createRenderBundleImageClass(blobUrls) {
  return class RenderBundleImage {
    constructor() {
      this.__quakeCanvasImage = new CanvasImage();
      this.onload = null;
      this.onerror = null;
      this.decoding = "auto";
      this.crossOrigin = "";
      this._loadPromise = Promise.resolve();
      this._src = "";
    }

    get src() {
      return this._src;
    }

    set src(value) {
      this._src = String(value ?? "");
      this._loadPromise = this._load(this._src);
    }

    get width() {
      return this.__quakeCanvasImage.width;
    }

    get height() {
      return this.__quakeCanvasImage.height;
    }

    get naturalWidth() {
      return this.__quakeCanvasImage.naturalWidth || this.__quakeCanvasImage.width;
    }

    get naturalHeight() {
      return this.__quakeCanvasImage.naturalHeight || this.__quakeCanvasImage.height;
    }

    async decode() {
      await this._loadPromise;
    }

    async _load(source) {
      try {
        const resolved = await imageSourceForRenderBundleUrl(source, blobUrls);
        await new Promise((resolve, reject) => {
          this.__quakeCanvasImage.onload = resolve;
          this.__quakeCanvasImage.onerror = reject;
          this.__quakeCanvasImage.src = resolved;
        });
        this.__quakeImageData = readCanvasImagePixels(this.__quakeCanvasImage);
        this.onload?.();
      } catch (error) {
        this.onerror?.(error);
        throw error;
      }
    }
  };
}

async function imageSourceForRenderBundleUrl(source, blobUrls) {
  const blobUrl = renderBundleBlobUrl(source, blobUrls);
  const blob = blobUrl ? blobUrls.get(blobUrl) : null;
  if (!blob) return source;
  const buffer = Buffer.from(await blob.arrayBuffer());
  return `data:${blob.type || "image/png"};base64,${buffer.toString("base64")}`;
}

function renderBundleBlobUrl(source, blobUrls) {
  const value = String(source ?? "");
  if (blobUrls.has(value)) return value;
  const match = value.match(/blob:quake-render-bundle-\d+/);
  return match && blobUrls.has(match[0]) ? match[0] : "";
}

function readCanvasImagePixels(image) {
  const width = image.naturalWidth || image.width || 0;
  const height = image.naturalHeight || image.height || 0;
  if (!width || !height) return null;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0);
  return {
    width,
    height,
    data: context.getImageData(0, 0, width, height).data,
  };
}

function drawQuakeNearestImageData(context, drawArgs) {
  const debug = typeof process !== "undefined" && process.env.QUAKE_RENDER_BUNDLE_DRAW_DEBUG === "1";
  const image = drawArgs[0];
  const pixels = image?.__quakeImageData;
  if (debug) {
    console.error("drawImage candidate", {
      args: drawArgs.length,
      hasPixels: Boolean(pixels),
      smoothing: context.imageSmoothingEnabled,
      transform: context.getTransform?.(),
    });
  }
  if (!pixels || context.imageSmoothingEnabled !== false || ![3, 5, 9].includes(drawArgs.length)) return false;
  const transform = context.getTransform?.();
  if (!transform?.is2D) {
    if (debug) console.error("drawImage native: transform");
    return false;
  }
  const det = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    if (debug) console.error("drawImage native: singular transform");
    return false;
  }
  const sourceRect = drawArgs.length === 9
    ? { sx: drawArgs[1], sy: drawArgs[2], sw: drawArgs[3], sh: drawArgs[4] }
    : { sx: 0, sy: 0, sw: pixels.width, sh: pixels.height };
  const localDestRect = drawArgs.length === 9
    ? { dx: drawArgs[5], dy: drawArgs[6], dw: drawArgs[7], dh: drawArgs[8] }
    : drawArgs.length === 5
      ? { dx: drawArgs[1], dy: drawArgs[2], dw: drawArgs[3], dh: drawArgs[4] }
      : { dx: drawArgs[1], dy: drawArgs[2], dw: pixels.width, dh: pixels.height };
  const { sx, sy, sw, sh } = sourceRect;
  const { dx, dy, dw, dh } = localDestRect;
  if (![sx, sy, sw, sh, dx, dy, dw, dh].every(Number.isFinite) || sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) {
    if (debug) console.error("drawImage native: rect", { sx, sy, sw, sh, dx, dy, dw, dh });
    return false;
  }
  if (debug) console.error("drawImage custom", { sx, sy, sw, sh, dx, dy, dw, dh, transform });

  const canvas = context.canvas;
  const corners = [
    [dx, dy],
    [dx + dw, dy],
    [dx + dw, dy + dh],
    [dx, dy + dh],
  ].map(([x, y]) => [
    transform.a * x + transform.c * y + transform.e,
    transform.b * x + transform.d * y + transform.f,
  ]);
  const startX = Math.max(0, Math.ceil(Math.min(...corners.map(([x]) => x))));
  const startY = Math.max(0, Math.ceil(Math.min(...corners.map(([, y]) => y))));
  const endX = Math.min(canvas.width, Math.ceil(Math.max(...corners.map(([x]) => x))));
  const endY = Math.min(canvas.height, Math.ceil(Math.max(...corners.map(([, y]) => y))));
  if (endX <= startX || endY <= startY) return true;

  const clips = context.__quakeCanvasClipPolygons?.() ?? [];
  const clipMaxSides = clips.map((clip) => polygonMaxSide(clip));
  if (clipMaxSides.some((side) => side > 128)) {
    if (debug) console.error("drawImage native: large clip");
    return false;
  }
  const preservePartialClipCoverage = clips.length > 0 && clipMaxSides.every((side) => side <= 16);
  const destRows = process.env.QUAKE_RENDER_BUNDLE_DEST_SCANLINE !== "0"
    ? quakeCanvasPolygonRows(corners, startX, endX, startY, endY, 1)
    : null;
  const clipRows = process.env.QUAKE_RENDER_BUNDLE_SCANLINE_CLIP !== "0" && clips.length > 0
    ? quakeCanvasClipRows(clips, startX, endX, startY, endY)
    : null;
  const drawRows = destRows && clipRows
    ? intersectQuakeCanvasRows(destRows, clipRows)
    : destRows ?? clipRows;
  const imageData = context.getImageData(startX, startY, endX - startX, endY - startY);
  const out = imageData.data;
  for (let y = startY; y < endY; y++) {
    const ranges = drawRows ? drawRows[y - startY] : [[startX, endX]];
    for (const [rangeStartX, rangeEndX] of ranges) {
      for (let x = rangeStartX; x < rangeEndX; x++) {
        if (clips.some((clip) => !pointInPolygon(x + 0.5, y + 0.5, clip))) continue;
        const tx = x + 0.5 - transform.e;
        const ty = y + 0.5 - transform.f;
        const localX = (transform.d * tx - transform.c * ty) / det;
        const localY = (-transform.b * tx + transform.a * ty) / det;
        if (localX < dx || localY < dy || localX >= dx + dw || localY >= dy + dh) continue;
        const sourceX = Math.max(0, Math.min(pixels.width - 1, Math.floor(sx + ((localX - dx) * sw) / dw)));
        const sourceY = Math.max(0, Math.min(pixels.height - 1, Math.floor(sy + ((localY - dy) * sh) / dh)));
        const sourceOffset = (sourceY * pixels.width + sourceX) * 4;
        const targetOffset = ((y - startY) * imageData.width + (x - startX)) * 4;
        const targetAlpha = out[targetOffset + 3];
        const sourceAlpha = pixels.data[sourceOffset + 3];
        if (preservePartialClipCoverage && targetAlpha > 0 && targetAlpha < 255 && sourceAlpha >= targetAlpha) {
          compositeQuakeCanvasPixel(out, targetOffset, pixels.data, sourceOffset, targetAlpha / 255);
          continue;
        }
        out[targetOffset] = pixels.data[sourceOffset];
        out[targetOffset + 1] = pixels.data[sourceOffset + 1];
        out[targetOffset + 2] = pixels.data[sourceOffset + 2];
        out[targetOffset + 3] = pixels.data[sourceOffset + 3];
      }
    }
  }
  context.putImageData(imageData, startX, startY);
  return true;
}

function quakeCanvasClipRows(clips, startX, endX, startY, endY) {
  let rows = quakeCanvasPolygonRows(clips[0], startX, endX, startY, endY, 1);
  for (const clip of clips.slice(1)) {
    rows = intersectQuakeCanvasRows(rows, quakeCanvasPolygonRows(clip, startX, endX, startY, endY, 1));
  }
  return rows;
}

function quakeCanvasPolygonRows(polygon, startX, endX, startY, endY, padding = 0) {
  const rows = [];
  for (let y = startY; y < endY; y++) {
    const yCenter = y + 0.5;
    const intersections = [];
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const [xi, yi] = polygon[index];
      const [xj, yj] = polygon[previous];
      if ((yi > yCenter) === (yj > yCenter)) continue;
      intersections.push(((xj - xi) * (yCenter - yi)) / (yj - yi) + xi);
    }
    intersections.sort((left, right) => left - right);
    const ranges = [];
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const rangeStart = Math.max(startX, Math.ceil(intersections[index] - 0.5) - padding);
      const rangeEnd = Math.min(endX, Math.ceil(intersections[index + 1] - 0.5) + padding);
      if (rangeEnd > rangeStart) ranges.push([rangeStart, rangeEnd]);
    }
    rows.push(ranges);
  }
  return rows;
}

function intersectQuakeCanvasRows(leftRows, rightRows) {
  return leftRows.map((leftRanges, index) => intersectQuakeCanvasRangeList(leftRanges, rightRows[index] ?? []));
}

function intersectQuakeCanvasRangeList(leftRanges, rightRanges) {
  const ranges = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < leftRanges.length && rightIndex < rightRanges.length) {
    const left = leftRanges[leftIndex];
    const right = rightRanges[rightIndex];
    const start = Math.max(left[0], right[0]);
    const end = Math.min(left[1], right[1]);
    if (end > start) ranges.push([start, end]);
    if (left[1] < right[1]) {
      leftIndex++;
    } else {
      rightIndex++;
    }
  }
  return ranges;
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    if ((yi > y) === (yj > y)) continue;
    const intersectX = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (x < intersectX) inside = !inside;
  }
  return inside;
}

function polygonMaxSide(polygon) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Math.max(maxX - minX, maxY - minY);
}

function compositeQuakeCanvasPixel(out, targetOffset, source, sourceOffset, coverage) {
  const sourceAlpha = (source[sourceOffset + 3] / 255) * coverage;
  if (sourceAlpha <= 0) return;
  const targetAlpha = out[targetOffset + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) return;
  out[targetOffset] = Math.round(
    (source[sourceOffset] * sourceAlpha + out[targetOffset] * targetAlpha * (1 - sourceAlpha)) / outAlpha,
  );
  out[targetOffset + 1] = Math.round(
    (source[sourceOffset + 1] * sourceAlpha + out[targetOffset + 1] * targetAlpha * (1 - sourceAlpha)) / outAlpha,
  );
  out[targetOffset + 2] = Math.round(
    (source[sourceOffset + 2] * sourceAlpha + out[targetOffset + 2] * targetAlpha * (1 - sourceAlpha)) / outAlpha,
  );
  out[targetOffset + 3] = Math.round(outAlpha * 255);
}

function patchQuakeRenderBundleFeatureDetection(window) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: chromeUserAgent,
  });
  Object.defineProperty(window, "CSS", {
    configurable: true,
    value: {
    supports(property, value) {
      if (property === "border-shape" && String(value).startsWith("polygon(")) return true;
      if (property?.startsWith("corner-") && value === "bevel") return true;
      return true;
    },
    },
  });
  window.matchMedia = (query) => ({
    matches: query.includes("pointer: fine") || query.includes("hover: hover"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
}

function exposeQuakeRenderBundleGlobals(window, values) {
  const globals = {
    Blob: window.Blob,
    CustomEvent: window.CustomEvent,
    Document: window.Document,
    Element: window.Element,
    Event: window.Event,
    FileReader: window.FileReader,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    XMLSerializer: window.XMLSerializer,
    atob: window.atob.bind(window),
    btoa: window.btoa.bind(window),
    document: window.document,
    location: window.location,
    navigator: window.navigator,
    performance: window.performance,
    requestAnimationFrame: (callback) => setTimeout(() => callback(window.performance.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout,
    clearTimeout,
    window,
    ...values,
  };
  const previousDescriptors = new Map();
  for (const [name, value] of Object.entries(globals)) {
    previousDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value,
      writable: true,
    });
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        value,
        writable: true,
      });
    } catch {
      // Some happy-dom globals are exposed through non-writable accessors.
    }
  }
  return () => {
    for (const [name, descriptor] of previousDescriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
  };
}

async function resolveRenderBundleTextureUrls(input, options) {
  const textureDataUrlByUrl = new Map();
  return {
    ...input,
    polygons: await resolvePolygonTextureUrls(input.polygons, options, textureDataUrlByUrl),
  };
}

async function resolveAnimatedRenderBundleTextureUrls(input, options) {
  const textureDataUrlByUrl = new Map();
  return {
    ...input,
    frames: await Promise.all((input.frames ?? []).map(async (frame) => ({
      ...frame,
      polygons: await resolvePolygonTextureUrls(frame.polygons, options, textureDataUrlByUrl),
    }))),
  };
}

async function resolvePolygonTextureUrls(polygons = [], options = {}, textureDataUrlByUrl = new Map()) {
  if (typeof options.readTextureUrl !== "function") return polygons;
  return Promise.all(polygons.map(async (polygon) => {
    if (typeof polygon?.texture !== "string") return polygon;
    const dataUrl = await resolveTextureDataUrl(polygon.texture, options, textureDataUrlByUrl);
    return { ...polygon, texture: dataUrl };
  }));
}

function resolveTextureDataUrl(textureUrl, options, textureDataUrlByUrl) {
  let dataUrl = textureDataUrlByUrl.get(textureUrl);
  if (!dataUrl) {
    dataUrl = (async () => {
      const source = await options.readTextureUrl(textureUrl);
      return typeof source === "string"
        ? source
        : `data:${options.contentTypeForTextureUrl?.(textureUrl) ?? "image/png"};base64,${Buffer.from(source).toString("base64")}`;
    })();
    textureDataUrlByUrl.set(textureUrl, dataUrl);
  }
  return dataUrl;
}
