import {
  BASE_TILE,
  type Polygon,
  type PolyMeshHandle,
  type Vec3,
} from "@layoutit/polycss";

import type { QuakePreparedRenderBundle, QuakeRenderBundleLeafFrameStyle } from "../prepare/scene";
import { isQuakeDebugDomMetadataEnabled, markQuakeTrace } from "./debug/traceMarks";

export interface QuakeRenderBundleFrameSetFrame {
  name: string;
  renderBundle: QuakePreparedRenderBundle;
}

export interface QuakeRenderBundleFrameSet {
  leafCount: number;
  renderBundle: QuakePreparedRenderBundle;
  frames: QuakeRenderBundleFrameSetFrame[];
}

export interface QuakeRenderBundlePreloadProgress {
  startTask(): () => void;
}

export type QuakeRenderBundleFrameSetHandle = PolyMeshHandle & {
  getFrameIndex(): number;
  setFrameIndex(frameIndex: number): boolean;
};

const renderBundleTemplateCache = new WeakMap<QuakePreparedRenderBundle, HTMLTemplateElement>();
const renderBundleRootVarsCache = new WeakMap<QuakePreparedRenderBundle, Map<string, string>>();
const renderBundleElementRootVarNames = new WeakMap<HTMLElement, Set<string>>();
const renderBundleStyleCache = new Map<string, HTMLStyleElement | HTMLLinkElement>();
const renderBundleStyleLoadPromises = new Map<string, Promise<void>>();
const renderBundleLeafFrameStylesLoadPromises = new Map<string, Promise<QuakeRenderBundleLeafFrameStylesFile>>();
const renderBundleCompiledLeafFrameStylesCache = new WeakMap<
  QuakePreparedRenderBundle,
  readonly QuakeCompiledRenderBundleLeafFrameStyle[]
>();
const renderBundleFrameSetStyleOptimizationCache = new WeakMap<
  QuakePreparedRenderBundle,
  QuakeRenderBundleFrameSetStyleOptimization
>();
const renderBundleAssetPreloads = new Map<string, {
  image: HTMLImageElement;
  promise: Promise<void>;
}>();

type QuakeRenderBundleLeafFrameStylesFile = {
  version: 3;
  frames: QuakePackedRenderBundleLeafFrameStyle[][];
};

type QuakePackedRenderBundleLeafFrameStyle = [
  matrix?: string | null,
  background?: string | null,
  extraStyle?: string | null,
];

interface QuakeRenderBundleLeafFrameStyleApplyOptions {
  extraStylePropertyNames?: readonly string[];
  extraStylePropertyNamesByLeaf?: readonly (readonly string[] | undefined)[];
  leaves?: readonly HTMLElement[] | NodeListOf<HTMLElement>;
  preserveBackground?: boolean;
}

interface QuakeRenderBundleFrameSetStyleOptimization {
  extraStylePropertyNames: string[];
  extraStylePropertyNamesByLeaf: readonly (readonly string[] | undefined)[];
  dynamicExtraStyleLeafCount: number;
  preserveBackground: boolean;
  stableRootVars: boolean;
}

interface QuakeCompiledRenderBundleLeafFrameStyle {
  background: string;
  extraDeclarations: readonly QuakeRenderBundleStyleDeclaration[];
  extraStyle: string;
  matrix: string;
}

interface QuakeRenderBundleStyleDeclaration {
  name: string;
  priority: string;
  value: string;
}

export function mountQuakeRenderBundleMesh(
  sceneElement: HTMLElement,
  renderBundle: QuakePreparedRenderBundle,
): PolyMeshHandle {
  ensureQuakeRenderBundleStyles(renderBundle, sceneElement.ownerDocument);
  const template = quakeRenderBundleTemplate(renderBundle);
  const element = template.content.firstElementChild?.cloneNode(true);
  if (!(element instanceof HTMLElement) || !element.classList.contains("polycss-mesh")) {
    throw new Error("Quake render bundle did not contain a .polycss-mesh root.");
  }
  applyQuakeRenderBundleLeafFrameStyles(element, renderBundle);
  const leafCount = element.querySelectorAll("b,i,s,u").length;
  if (leafCount !== renderBundle.leafCount) {
    throw new Error(`Quake render bundle leaf count mismatch: expected ${renderBundle.leafCount}, got ${leafCount}.`);
  }
  if (renderBundle.leafMetadata.length !== leafCount) {
    throw new Error(
      `Quake render bundle leaf metadata mismatch: expected ${leafCount}, got ${renderBundle.leafMetadata.length}.`,
    );
  }
  sceneElement.appendChild(element);
  return createQuakeRenderBundleMeshHandle(element);
}

export function mountQuakeRenderBundleFrameSetMesh(
  sceneElement: HTMLElement,
  frameSet: QuakeRenderBundleFrameSet,
  frameIndex = 0,
): QuakeRenderBundleFrameSetHandle {
  const boundedFrameIndex = quakeRenderBundleFrameSetIndex(frameSet, frameIndex);
  const firstFrame = frameSet.frames[0];
  if (!firstFrame || !frameSet.frames[boundedFrameIndex]) {
    throw new Error("Quake render bundle frame set has no frames.");
  }
  const handle = mountQuakeRenderBundleMesh(sceneElement, frameSet.renderBundle) as QuakeRenderBundleFrameSetHandle;
  let currentFrameIndex = 0;
  syncQuakeRenderBundleFrameSetMetadata(handle.element, currentFrameIndex);
  const frameSetLeaves = handle.element.querySelectorAll<HTMLElement>("b,i,s,u");
  const styleOptimization = quakeRenderBundleFrameSetStyleOptimization(frameSet);
  syncQuakeRenderBundleRootVars(handle.element, firstFrame.renderBundle);
  handle.getFrameIndex = () => currentFrameIndex;
  handle.setFrameIndex = (nextFrameIndex: number) => {
    const boundedNextFrameIndex = quakeRenderBundleFrameSetIndex(frameSet, nextFrameIndex);
    if (boundedNextFrameIndex === currentFrameIndex) return false;
    const previous = frameSet.frames[currentFrameIndex]?.renderBundle;
    const next = frameSet.frames[boundedNextFrameIndex]?.renderBundle;
    if (!next) return false;
    if (!styleOptimization.stableRootVars) syncQuakeRenderBundleRootVars(handle.element, next);
    if (next.leafFrameStyles?.length) {
      markQuakeTrace("renderbundle-frame-style-swap", {
        from: currentFrameIndex,
        to: boundedNextFrameIndex,
        leaves: frameSet.leafCount,
        preserveBackground: styleOptimization.preserveBackground,
        extraProps: styleOptimization.extraStylePropertyNames.length,
        dynamicExtraLeaves: styleOptimization.dynamicExtraStyleLeafCount,
        stableRootVars: styleOptimization.stableRootVars,
      });
      applyQuakeRenderBundleLeafFrameStyles(handle.element, next, {
        extraStylePropertyNames: styleOptimization.extraStylePropertyNames,
        extraStylePropertyNamesByLeaf: styleOptimization.extraStylePropertyNamesByLeaf,
        leaves: frameSetLeaves,
        preserveBackground: styleOptimization.preserveBackground,
      });
    } else {
      markQuakeTrace("renderbundle-frame-class-swap", {
        from: currentFrameIndex,
        to: boundedNextFrameIndex,
        leaves: frameSet.leafCount,
      });
      ensureQuakeRenderBundleStyles(next, handle.element.ownerDocument);
      if (previous?.styleClassName) handle.element.classList.remove(previous.styleClassName);
      if (next.styleClassName) handle.element.classList.add(next.styleClassName);
    }
    currentFrameIndex = boundedNextFrameIndex;
    syncQuakeRenderBundleFrameSetMetadata(handle.element, currentFrameIndex);
    return true;
  };
  if (boundedFrameIndex !== currentFrameIndex) handle.setFrameIndex(boundedFrameIndex);
  return handle;
}

function syncQuakeRenderBundleFrameSetMetadata(element: HTMLElement, frameIndex: number): void {
  if (!isQuakeDebugDomMetadataEnabled()) return;
  element.dataset.frameSet = "true";
  element.dataset.frameIndex = String(frameIndex);
}

export function setQuakeRenderBundleFrameSetHandleFrame(handle: PolyMeshHandle | null, frameIndex: number): boolean {
  if (!handle || !isQuakeRenderBundleFrameSetHandle(handle)) return false;
  return handle.setFrameIndex(frameIndex);
}

export function isQuakeRenderBundleFrameSetHandle(
  handle: PolyMeshHandle,
): handle is QuakeRenderBundleFrameSetHandle {
  return typeof (handle as Partial<QuakeRenderBundleFrameSetHandle>).setFrameIndex === "function";
}

function ensureQuakeRenderBundleStyles(
  renderBundle: QuakePreparedRenderBundle,
  document: Document,
): HTMLStyleElement | HTMLLinkElement | null {
  const key = quakeRenderBundleStyleKey(renderBundle);
  if (!key) return null;
  const existing = renderBundleStyleCache.get(key);
  if (existing?.isConnected) return existing;
  if (renderBundle.styleUrl) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = renderBundle.styleUrl;
    link.dataset.quakeRenderBundle = renderBundle.styleClassName ?? renderBundle.styleUrl;
    document.head.append(link);
    renderBundleStyleCache.set(key, link);
    return link;
  }
  if (!renderBundle.meshCss) return null;
  const style = document.createElement("style");
  style.dataset.quakeRenderBundle = renderBundle.styleClassName ?? "inline";
  style.textContent = renderBundle.meshCss;
  document.head.append(style);
  renderBundleStyleCache.set(key, style);
  return style;
}

export async function preloadQuakeRenderBundleAssets(
  renderBundle: QuakePreparedRenderBundle,
  progress?: QuakeRenderBundlePreloadProgress,
): Promise<void> {
  const leafFrameStylesUrl = renderBundle.leafFrameStylesUrl;
  const tasks: Promise<void>[] = [];
  if (leafFrameStylesUrl && !renderBundle.leafFrameStyles?.length) {
    const complete = renderBundleLeafFrameStylesLoadPromises.has(leafFrameStylesUrl)
      ? null
      : progress?.startTask();
    tasks.push(loadQuakeRenderBundleLeafFrameStyles(renderBundle).finally(() => complete?.()));
  }
  quakeRenderBundleTemplate(renderBundle);
  const styleKey = quakeRenderBundleStyleKey(renderBundle);
  if (styleKey) {
    const complete = renderBundle.styleUrl && !renderBundleStyleLoadPromises.has(styleKey)
      ? progress?.startTask()
      : null;
    tasks.push(preloadQuakeRenderBundleStyle(renderBundle).finally(() => complete?.()));
  }
  for (const url of renderBundle.assetUrls) {
    const complete = renderBundleAssetPreloads.has(url) ? null : progress?.startTask();
    tasks.push(preloadQuakeRenderBundleAsset(url).finally(() => complete?.()));
  }
  await Promise.all(tasks);
}

function preloadQuakeRenderBundleStyle(renderBundle: QuakePreparedRenderBundle): Promise<void> {
  const key = quakeRenderBundleStyleKey(renderBundle);
  if (!key) return Promise.resolve();
  const existing = renderBundleStyleLoadPromises.get(key);
  if (existing) return existing;
  const element = ensureQuakeRenderBundleStyles(renderBundle, document);
  if (!(element instanceof HTMLLinkElement)) return Promise.resolve();
  const promise = new Promise<void>((resolve) => {
    if (element.dataset.loaded === "true" || element.sheet) {
      resolve();
      return;
    }
    const done = () => {
      element.dataset.loaded = "true";
      element.removeEventListener("load", done);
      element.removeEventListener("error", done);
      resolve();
    };
    element.addEventListener("load", done);
    element.addEventListener("error", done);
  });
  renderBundleStyleLoadPromises.set(key, promise);
  return promise;
}

async function loadQuakeRenderBundleLeafFrameStyles(renderBundle: QuakePreparedRenderBundle): Promise<void> {
  const url = renderBundle.leafFrameStylesUrl;
  if (!url || renderBundle.leafFrameStyles?.length) return;
  let promise = renderBundleLeafFrameStylesLoadPromises.get(url);
  if (!promise) {
    promise = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load ${url}.`);
        return response.json() as Promise<QuakeRenderBundleLeafFrameStylesFile>;
      });
    renderBundleLeafFrameStylesLoadPromises.set(url, promise);
  }
  const file = await promise;
  if (file.version !== 3) {
    throw new Error(`Unsupported Quake render bundle frame styles version ${String(file.version)} in ${url}.`);
  }
  const frameIndex = renderBundle.leafFrameStylesIndex ?? 0;
  const frameStyles = file.frames[frameIndex];
  if (!frameStyles) {
    throw new Error(`Quake render bundle frame styles missing frame ${frameIndex} in ${url}.`);
  }
  renderBundle.leafFrameStyles = hydrateQuakePackedRenderBundleLeafFrameStyles(file.frames, frameIndex);
  quakeRenderBundleCompiledLeafFrameStyles(renderBundle);
}

function hydrateQuakePackedRenderBundleLeafFrameStyles(
  frames: readonly QuakePackedRenderBundleLeafFrameStyle[][],
  frameIndex: number,
): QuakeRenderBundleLeafFrameStyle[] {
  const baseFrameStyles = frames[0] ?? [];
  const frameStyles = frames[frameIndex] ?? [];
  return frameStyles.map((frameStyle = [], leafIndex): QuakeRenderBundleLeafFrameStyle => {
    const baseFrameStyle = baseFrameStyles[leafIndex] ?? [];
    const matrix = frameStyle[0] ?? "";
    const background = effectiveQuakeRenderBundleLeafFrameBackground(frameStyle, baseFrameStyle);
    const extraStyle = effectiveQuakeRenderBundleLeafFrameExtraStyle(frameStyle, baseFrameStyle, {
      dynamicExtraStylePropertyNames: ["*"],
      preserveBackground: false,
    });
    return [matrix, background, extraStyle];
  });
}

function applyQuakeRenderBundleLeafFrameStyles(
  element: HTMLElement,
  renderBundle: QuakePreparedRenderBundle,
  options: QuakeRenderBundleLeafFrameStyleApplyOptions = {},
): void {
  const frameStyles = renderBundle.leafFrameStyles;
  if (!frameStyles?.length && renderBundle.leafFrameStylesUrl) {
    throw new Error(`Quake render bundle frame styles were not preloaded from ${renderBundle.leafFrameStylesUrl}.`);
  }
  if (!frameStyles?.length) return;
  const compiledFrameStyles = quakeRenderBundleCompiledLeafFrameStyles(renderBundle);
  const leaves = options.leaves ?? element.querySelectorAll<HTMLElement>("b,i,s,u");
  const count = Math.min(leaves.length, compiledFrameStyles.length);
  for (let index = 0; index < count; index++) {
    const leaf = leaves[index];
    const frameStyle = compiledFrameStyles[index];
    if (!leaf || !frameStyle) continue;
    applyQuakeRenderBundleLeafFrameStyle(leaf, frameStyle, options, index);
  }
}

function applyQuakeRenderBundleLeafFrameStyle(
  leaf: HTMLElement,
  frameStyle: QuakeCompiledRenderBundleLeafFrameStyle,
  options: QuakeRenderBundleLeafFrameStyleApplyOptions,
  leafIndex: number,
): void {
  const { background, extraDeclarations, extraStyle, matrix } = frameStyle;
  if (options.preserveBackground) {
    const extraStylePropertyNames = options.extraStylePropertyNamesByLeaf
      ? options.extraStylePropertyNamesByLeaf[leafIndex] ?? []
      : options.extraStylePropertyNames ?? [];
    for (const propertyName of extraStylePropertyNames) {
      leaf.style.removeProperty(propertyName);
    }
    if (extraDeclarations.length && extraStylePropertyNames.length) {
      applyQuakeRenderBundleLeafExtraStyle(leaf, extraDeclarations);
    }
    if (matrix) {
      leaf.style.transform = matrix;
    } else {
      leaf.style.removeProperty("transform");
    }
    return;
  }
  leaf.removeAttribute("style");
  if (extraStyle) leaf.style.cssText = extraStyle;
  if (matrix) {
    leaf.style.transform = matrix;
  }
  if (background) {
    leaf.style.background = background;
  }
}

function applyQuakeRenderBundleLeafExtraStyle(
  leaf: HTMLElement,
  declarations: readonly QuakeRenderBundleStyleDeclaration[],
): void {
  for (const declaration of declarations) {
    leaf.style.setProperty(declaration.name, declaration.value, declaration.priority);
  }
}

function compileQuakeRenderBundleLeafExtraStyle(extraStyle: string): QuakeRenderBundleStyleDeclaration[] {
  const declarations: QuakeRenderBundleStyleDeclaration[] = [];
  for (const declaration of extraStyle.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator <= 0) continue;
    const propertyName = declaration.slice(0, separator).trim();
    let propertyValue = declaration.slice(separator + 1).trim();
    if (!propertyName || !propertyValue) continue;
    let priority = "";
    if (propertyValue.endsWith("!important")) {
      propertyValue = propertyValue.slice(0, -"!important".length).trimEnd();
      priority = "important";
    }
    declarations.push({ name: propertyName, priority, value: propertyValue });
  }
  return declarations;
}

function quakeRenderBundleCompiledLeafFrameStyles(
  renderBundle: QuakePreparedRenderBundle,
): readonly QuakeCompiledRenderBundleLeafFrameStyle[] {
  const existing = renderBundleCompiledLeafFrameStylesCache.get(renderBundle);
  if (existing) return existing;
  const compiled = (renderBundle.leafFrameStyles ?? []).map((frameStyle) =>
    compileQuakeRenderBundleLeafFrameStyle(frameStyle));
  renderBundleCompiledLeafFrameStylesCache.set(renderBundle, compiled);
  return compiled;
}

interface QuakeRenderBundleLeafFrameStyleCompileOptions {
  baseFrameStyle?: Partial<QuakeRenderBundleLeafFrameStyle>;
  dynamicExtraStylePropertyNames?: readonly string[];
  preserveBackground: boolean;
}

function compileQuakeRenderBundleLeafFrameStyle(
  frameStyle: Partial<QuakeRenderBundleLeafFrameStyle> | undefined,
  options: QuakeRenderBundleLeafFrameStyleCompileOptions = { preserveBackground: false },
): QuakeCompiledRenderBundleLeafFrameStyle {
  const baseFrameStyle = options.baseFrameStyle;
  const matrix = frameStyle?.[0] ?? "";
  const background = options.preserveBackground
    ? ""
    : effectiveQuakeRenderBundleLeafFrameBackground(frameStyle, baseFrameStyle);
  const extraStyle = effectiveQuakeRenderBundleLeafFrameExtraStyle(frameStyle, baseFrameStyle, options);
  return {
    background: background
      ? background.startsWith("var(") ? background : `var(--bg0) ${background}`
      : "",
    extraDeclarations: extraStyle ? compileQuakeRenderBundleLeafExtraStyle(extraStyle) : [],
    extraStyle,
    matrix: matrix
      ? matrix.startsWith("matrix3d(") ? matrix : `matrix3d(${matrix})`
      : "",
  };
}

function effectiveQuakeRenderBundleLeafFrameBackground(
  frameStyle: Partial<QuakeRenderBundleLeafFrameStyle> | undefined,
  baseFrameStyle: Partial<QuakeRenderBundleLeafFrameStyle> | undefined,
): string {
  if (!baseFrameStyle || !frameStyle || frameStyle.length >= 2) {
    return frameStyle?.[1] === null ? baseFrameStyle?.[1] ?? "" : frameStyle?.[1] ?? "";
  }
  return baseFrameStyle[1] ?? "";
}

function effectiveQuakeRenderBundleLeafFrameExtraStyle(
  frameStyle: Partial<QuakeRenderBundleLeafFrameStyle> | undefined,
  baseFrameStyle: Partial<QuakeRenderBundleLeafFrameStyle> | undefined,
  options: QuakeRenderBundleLeafFrameStyleCompileOptions,
): string {
  const shouldRestoreDynamicExtraStyle = Boolean(options.dynamicExtraStylePropertyNames?.length);
  if (!baseFrameStyle || !frameStyle || frameStyle.length >= 3) return frameStyle?.[2] ?? "";
  return shouldRestoreDynamicExtraStyle ? baseFrameStyle[2] ?? "" : "";
}

function quakeRenderBundleFrameSetStyleOptimization(
  frameSet: QuakeRenderBundleFrameSet,
): QuakeRenderBundleFrameSetStyleOptimization {
  const existing = renderBundleFrameSetStyleOptimizationCache.get(frameSet.renderBundle);
  if (existing) return existing;
  const firstFrameStyles = frameSet.frames[0]?.renderBundle.leafFrameStyles;
  const firstFrameRenderBundle = frameSet.frames[0]?.renderBundle;
  const extraStylePropertyNames = new Set<string>();
  const extraStylePropertyNamesByLeaf = new Map<number, Set<string>>();
  let preserveBackground = Boolean(firstFrameStyles?.length);
  let stableRootVars = Boolean(firstFrameRenderBundle);
  for (const frame of frameSet.frames) {
    if (
      firstFrameRenderBundle &&
      !quakeRenderBundleRootVarsEqual(firstFrameRenderBundle, frame.renderBundle)
    ) {
      stableRootVars = false;
    }
    const frameStyles = frame.renderBundle.leafFrameStyles;
    if (!firstFrameStyles?.length || !frameStyles || frameStyles.length !== firstFrameStyles.length) {
      preserveBackground = false;
      continue;
    }
    for (let index = 0; index < frameStyles.length; index++) {
      const frameStyle = frameStyles[index];
      const firstFrameStyle = firstFrameStyles[index];
      const extraStyle = frameStyle?.[2];
      const firstExtraStyle = firstFrameStyle?.[2];
      if ((extraStyle ?? "") !== (firstExtraStyle ?? "")) {
        for (const propertyName of [
          ...quakeRenderBundleExtraStylePropertyNames(firstExtraStyle),
          ...quakeRenderBundleExtraStylePropertyNames(extraStyle),
        ]) {
          extraStylePropertyNames.add(propertyName);
          let leafPropertyNames = extraStylePropertyNamesByLeaf.get(index);
          if (!leafPropertyNames) {
            leafPropertyNames = new Set<string>();
            extraStylePropertyNamesByLeaf.set(index, leafPropertyNames);
          }
          leafPropertyNames.add(propertyName);
        }
      }
      if ((frameStyle?.[1] ?? "") !== (firstFrameStyle?.[1] ?? "")) {
        preserveBackground = false;
      }
    }
  }
  const leafCount = firstFrameStyles?.length ?? 0;
  const extraStylePropertyNamesByLeafList = Array.from({ length: leafCount }, (_item, index) => {
    const leafPropertyNames = extraStylePropertyNamesByLeaf.get(index);
    return leafPropertyNames?.size ? [...leafPropertyNames] : undefined;
  });
  const optimization = {
    extraStylePropertyNames: [...extraStylePropertyNames],
    extraStylePropertyNamesByLeaf: extraStylePropertyNamesByLeafList,
    dynamicExtraStyleLeafCount: extraStylePropertyNamesByLeaf.size,
    preserveBackground,
    stableRootVars,
  };
  renderBundleFrameSetStyleOptimizationCache.set(frameSet.renderBundle, optimization);
  return optimization;
}

function quakeRenderBundleRootVarsEqual(
  left: QuakePreparedRenderBundle,
  right: QuakePreparedRenderBundle,
): boolean {
  const leftVars = quakeRenderBundleRootVars(left);
  const rightVars = quakeRenderBundleRootVars(right);
  if (leftVars.size !== rightVars.size) return false;
  for (const [name, value] of leftVars) {
    if (rightVars.get(name) !== value) return false;
  }
  return true;
}

function quakeRenderBundleExtraStylePropertyNames(extraStyle?: string): string[] {
  const propertyNames: string[] = [];
  if (!extraStyle) return propertyNames;
  for (const declaration of extraStyle.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator <= 0) continue;
    const propertyName = declaration.slice(0, separator).trim();
    if (propertyName) propertyNames.push(propertyName);
  }
  return propertyNames;
}

function quakeRenderBundleStyleKey(renderBundle: QuakePreparedRenderBundle): string {
  return renderBundle.styleUrl ?? renderBundle.styleClassName ?? renderBundle.meshCss ?? "";
}

function syncQuakeRenderBundleRootVars(element: HTMLElement, renderBundle: QuakePreparedRenderBundle): void {
  const nextVars = quakeRenderBundleRootVars(renderBundle);
  const previousNames = renderBundleElementRootVarNames.get(element);
  if (previousNames) {
    for (const name of previousNames) {
      if (!nextVars.has(name)) element.style.removeProperty(name);
    }
  }
  for (const [name, value] of nextVars) {
    if (element.style.getPropertyValue(name) !== value) {
      element.style.setProperty(name, value);
    }
  }
  renderBundleElementRootVarNames.set(element, new Set(nextVars.keys()));
}

function quakeRenderBundleRootVars(renderBundle: QuakePreparedRenderBundle): Map<string, string> {
  const existing = renderBundleRootVarsCache.get(renderBundle);
  if (existing) return existing;
  const vars = new Map<string, string>();
  const root = quakeRenderBundleTemplate(renderBundle).content.firstElementChild;
  const style = root instanceof HTMLElement ? root.getAttribute("style") ?? "" : "";
  for (const match of style.matchAll(/(?:^|;)\s*(--bg\d+)\s*:\s*([^;]+)/g)) {
    vars.set(match[1], match[2].trim());
  }
  renderBundleRootVarsCache.set(renderBundle, vars);
  return vars;
}

function quakeRenderBundleFrameSetIndex(frameSet: QuakeRenderBundleFrameSet, frameIndex: number): number {
  const frameCount = frameSet.frames.length;
  if (frameCount <= 0) return 0;
  return ((Math.trunc(frameIndex) % frameCount) + frameCount) % frameCount;
}

function quakeRenderBundleTemplate(renderBundle: QuakePreparedRenderBundle): HTMLTemplateElement {
  let template = renderBundleTemplateCache.get(renderBundle);
  if (template) return template;
  template = document.createElement("template");
  template.innerHTML = renderBundle.meshHtml.trim();
  renderBundleTemplateCache.set(renderBundle, template);
  return template;
}

function preloadQuakeRenderBundleAsset(url: string): Promise<void> {
  const existing = renderBundleAssetPreloads.get(url);
  if (existing) return existing.promise;
  const image = new Image();
  image.decoding = "async";
  image.loading = "eager";
  (image as HTMLImageElement & { fetchPriority?: "low" | "high" | "auto" }).fetchPriority = "high";
  const promise = new Promise<void>((resolve) => {
    image.onload = () => {
      void image.decode().catch(() => undefined).finally(resolve);
    };
    image.onerror = () => resolve();
  });
  renderBundleAssetPreloads.set(url, { image, promise });
  image.src = url;
  return promise;
}

export function stripPolyMeshMetadata(element: HTMLElement): void {
  element.removeAttribute("data-poly-mesh-id");
  element.removeAttribute("data-poly-mesh-index");
  for (const leaf of element.querySelectorAll<HTMLElement>("[data-poly-index]")) {
    leaf.removeAttribute("data-poly-index");
  }
}

export function createQuakeRenderBundleMeshHandle(element: HTMLElement): PolyMeshHandle {
  const transform: { position?: Vec3; rotation?: Vec3; scale?: number | Vec3 } = {};
  let appliedTransformStyle = element.style.transform;
  const handle = {
    polygons: [] as Polygon[],
    element,
    transform,
    remove: () => element.remove(),
    setPolygons: () => undefined,
    updatePolygon: () => undefined,
    setTransform: (nextTransform: Partial<typeof transform>) => {
      if (nextTransform.position !== undefined) transform.position = nextTransform.position;
      if (nextTransform.rotation !== undefined) transform.rotation = nextTransform.rotation;
      if (nextTransform.scale !== undefined) transform.scale = nextTransform.scale;
      const style = quakeMeshTransformStyle(transform);
      const nextStyle = style ?? "";
      if (nextStyle === appliedTransformStyle) return;
      if (style) {
        element.style.transform = style;
      } else {
        element.style.removeProperty("transform");
      }
      appliedTransformStyle = nextStyle;
    },
    dispose: () => element.remove(),
    rebakeAtlas: () => undefined,
    getPosition: () => transform.position,
    getRotation: () => transform.rotation,
    getScale: () => transform.scale,
    getPolygons: () => [],
  };
  return handle as PolyMeshHandle;
}

function quakeMeshTransformStyle(transform: {
  position?: Vec3;
  rotation?: Vec3;
  scale?: number | Vec3;
}): string | undefined {
  const scaleX = typeof transform.scale === "number" ? transform.scale : transform.scale?.[0] ?? 1;
  const scaleY = typeof transform.scale === "number" ? transform.scale : transform.scale?.[1] ?? 1;
  const scaleZ = typeof transform.scale === "number" ? transform.scale : transform.scale?.[2] ?? 1;
  const hasScale = scaleX !== 1 || scaleY !== 1 || scaleZ !== 1;
  const [x, y, z] = transform.position
    ? [transform.position[1] * BASE_TILE, transform.position[0] * BASE_TILE, transform.position[2] * BASE_TILE]
    : [0, 0, 0];
  const parts: string[] = [];
  if (x !== 0 || y !== 0 || z !== 0) parts.push(`translate3d(${x}px, ${y}px, ${z}px)`);
  if (transform.rotation?.[0]) parts.push(`rotateY(${-transform.rotation[0]}deg)`);
  if (transform.rotation?.[1]) parts.push(`rotateX(${-transform.rotation[1]}deg)`);
  if (transform.rotation?.[2]) parts.push(`rotateZ(${-transform.rotation[2]}deg)`);
  if (hasScale) parts.push(`scale3d(${scaleX}, ${scaleY}, ${scaleZ})`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}
