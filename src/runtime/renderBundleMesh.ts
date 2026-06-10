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
  startTask(status?: string): () => void;
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
const renderBundleLoadedStyles = new WeakSet<HTMLLinkElement>();
const renderBundleLeafFrameStylesLoadPromises = new Map<string, Promise<QuakeRenderBundleLeafFrameStylesFile>>();
const renderBundleDebugOutlinePreloads = new WeakMap<QuakePreparedRenderBundle, Promise<void>>();
const renderBundleDebugTransparentOutlinePreloads = new WeakMap<QuakePreparedRenderBundle, Promise<void>>();
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
const QUAKE_DEBUG_POLY_ID_ATTR = "data-qpid";
const mountedRenderBundleByElement = new WeakMap<HTMLElement, QuakePreparedRenderBundle>();
const mountedRenderBundleElements = new Set<HTMLElement>();
let renderBundleDebugOutlinesEnabled = false;
let renderBundleDebugTransparentOutlinesEnabled = false;
let renderBundleDebugLabelsEnabled = false;
const renderBundleDebugLeafBackgrounds = new WeakMap<HTMLElement, QuakeRenderBundleDebugLeafBackground>();
const renderBundleDebugLeavesByElement = new WeakMap<HTMLElement, Set<HTMLElement>>();
const renderBundleDebugOutlineLeavesByElement = new WeakMap<HTMLElement, Set<HTMLElement>>();

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

interface QuakeRenderBundleDebugLeafBackground {
  background: string;
  computedBackgroundImage: string;
  computedBackgroundPosition: string;
  computedBackgroundSize: string;
  backgroundImage: string;
  backgroundPosition: string;
  backgroundRepeat: string;
  backgroundSize: string;
}

interface QuakeRenderBundleDebugOutlineAssets {
  outlineByBackgroundVar: Map<string, QuakeRenderBundleDebugOutlineEntry>;
  outlineBySourcePath: Map<string, QuakeRenderBundleDebugOutlineEntry>;
  overpainted: boolean;
  rootVars: Map<string, string>;
  urls: readonly string[];
}

interface QuakeRenderBundleDebugOutlineEntry {
  image: string;
  position?: string;
  size?: string;
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
  const leaves = element.querySelectorAll<HTMLElement>("b,i,s,u");
  const leafCount = leaves.length;
  if (leafCount !== renderBundle.leafCount) {
    throw new Error(`Quake render bundle leaf count mismatch: expected ${renderBundle.leafCount}, got ${leafCount}.`);
  }
  if (renderBundle.leafMetadata.length !== leafCount) {
    throw new Error(
      `Quake render bundle leaf metadata mismatch: expected ${leafCount}, got ${renderBundle.leafMetadata.length}.`,
    );
  }
  syncQuakeRenderBundleDebugLeafIds(leaves, renderBundle);
  mountedRenderBundleByElement.set(element, renderBundle);
  mountedRenderBundleElements.add(element);
  sceneElement.appendChild(element);
  if (renderBundleDebugOutlinesEnabled) {
    void enableQuakeRenderBundleDebugOutlines(element, renderBundle, {
      hideTextures: renderBundleDebugTransparentOutlinesEnabled,
    }).catch((error) => console.error("[cssQuake] Could not load debug outline atlas.", error));
  }
  return createQuakeRenderBundleMeshHandle(element);
}

function syncQuakeRenderBundleDebugLeafIds(
  leaves: NodeListOf<HTMLElement>,
  renderBundle: QuakePreparedRenderBundle,
): void {
  for (let index = 0; index < leaves.length; index++) {
    const leaf = leaves[index];
    if (!renderBundleDebugLabelsEnabled) {
      leaf?.removeAttribute(QUAKE_DEBUG_POLY_ID_ATTR);
      continue;
    }
    const id = quakeRenderBundleDebugLeafId(leaf, renderBundle.leafMetadata[index]);
    if (id === null) {
      leaf?.removeAttribute(QUAKE_DEBUG_POLY_ID_ATTR);
      continue;
    }
    leaf.setAttribute(QUAKE_DEBUG_POLY_ID_ATTR, String(id));
  }
}

function quakeRenderBundleDebugLeafId(
  leaf: HTMLElement | undefined,
  metadata: QuakePreparedRenderBundle["leafMetadata"][number] | undefined,
): number | null {
  const polyIndex = metadata?.p ?? renderBundleDebugIntegerAttr(leaf, "data-poly-index");
  if (Number.isSafeInteger(polyIndex) && polyIndex >= 0) return polyIndex;
  const faceIndex = metadata?.f;
  return Number.isSafeInteger(faceIndex) && faceIndex >= 0 ? faceIndex : null;
}

function renderBundleDebugIntegerAttr(element: HTMLElement | undefined, name: string): number | undefined {
  const rawValue = element?.getAttribute(name);
  if (rawValue === undefined || rawValue === null || rawValue === "") return undefined;
  const value = Number(rawValue);
  return Number.isSafeInteger(value) ? value : undefined;
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
    syncQuakeRenderBundleDebugOutlineLeaves(handle.element, frameSetLeaves);
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
    document.head.append(link);
    renderBundleStyleCache.set(key, link);
    return link;
  }
  if (!renderBundle.meshCss) return null;
  const style = document.createElement("style");
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

export interface QuakeRenderBundleDebugOutlineOptions {
  hideTextures?: boolean;
}

export function syncQuakeRenderBundleDebugLabels(enabled: boolean): void {
  renderBundleDebugLabelsEnabled = enabled;
  if (!enabled) {
    document.querySelectorAll<HTMLElement>(`[${QUAKE_DEBUG_POLY_ID_ATTR}]`).forEach((leaf) => {
      leaf.removeAttribute(QUAKE_DEBUG_POLY_ID_ATTR);
    });
  }
  for (const element of mountedRenderBundleElements) {
    if (!element.isConnected) {
      mountedRenderBundleElements.delete(element);
      continue;
    }
    const renderBundle = mountedRenderBundleByElement.get(element);
    if (!renderBundle) continue;
    syncQuakeRenderBundleDebugLeafIds(element.querySelectorAll<HTMLElement>("b,i,s,u"), renderBundle);
  }
}

export function syncQuakeRenderBundleDebugOutlines(
  enabled: boolean,
  options: QuakeRenderBundleDebugOutlineOptions = {},
): void {
  renderBundleDebugOutlinesEnabled = enabled;
  renderBundleDebugTransparentOutlinesEnabled = options.hideTextures === true;
  for (const element of mountedRenderBundleElements) {
    if (!element.isConnected) {
      mountedRenderBundleElements.delete(element);
      continue;
    }
    const renderBundle = mountedRenderBundleByElement.get(element);
    if (!renderBundle) continue;
    if (enabled) {
      void enableQuakeRenderBundleDebugOutlines(element, renderBundle, options)
        .catch((error) => console.error("[cssQuake] Could not load debug outline atlas.", error));
    } else {
      disableQuakeRenderBundleDebugOutlines(element, renderBundle);
    }
  }
}

export function syncQuakeRenderBundleDebugOutlineLeaves(
  context: HTMLElement,
  leaves: Iterable<HTMLElement>,
): void {
  if (!renderBundleDebugOutlinesEnabled) return;
  const element = quakeRenderBundleMeshElement(context);
  if (!element?.classList.contains("quake-debug-outline-atlas-ready")) return;
  const renderBundle = mountedRenderBundleByElement.get(element);
  if (!renderBundle) return;
  const options = { hideTextures: renderBundleDebugTransparentOutlinesEnabled };
  const outlineAssets = quakeRenderBundleDebugOutlineAssets(renderBundle, options);
  if (!outlineAssets) return;
  setQuakeRenderBundleDebugOutlineRootVars(element, outlineAssets);
  applyQuakeRenderBundleDebugOutlineLeaves(element, outlineAssets, options, leaves);
}

export function registerQuakeRenderBundleDebugOutlineLeaves(
  context: HTMLElement,
  leaves: Iterable<HTMLElement>,
): void {
  const element = quakeRenderBundleMeshElement(context);
  if (!element) return;
  renderBundleDebugOutlineLeavesByElement.set(element, new Set(leaves));
  if (!renderBundleDebugOutlinesEnabled || !element.classList.contains("quake-debug-outline-atlas-ready")) return;
  syncQuakeRenderBundleDebugOutlineLeaves(element, leaves);
}

async function enableQuakeRenderBundleDebugOutlines(
  element: HTMLElement,
  renderBundle: QuakePreparedRenderBundle,
  options: QuakeRenderBundleDebugOutlineOptions,
): Promise<void> {
  const outlineAssets = quakeRenderBundleDebugOutlineAssets(renderBundle, options);
  if (!outlineAssets) {
    element.classList.remove("quake-debug-outline-atlas-ready");
    restoreQuakeRenderBundleDebugOutlineLeafBackgrounds(element);
    return;
  }
  await preloadQuakeRenderBundleDebugOutlineAssets(renderBundle, options);
  if (
    !renderBundleDebugOutlinesEnabled ||
    renderBundleDebugTransparentOutlinesEnabled !== (options.hideTextures === true) ||
    !element.isConnected
  ) {
    return;
  }
  setQuakeRenderBundleDebugOutlineRootVars(element, outlineAssets);
  element.classList.add("quake-debug-outline-atlas-ready");
  applyQuakeRenderBundleDebugOutlineLeafBackgrounds(element, outlineAssets, options);
}

function disableQuakeRenderBundleDebugOutlines(
  element: HTMLElement,
  renderBundle: QuakePreparedRenderBundle,
): void {
  element.classList.remove("quake-debug-outline-atlas-ready");
  for (const property of [...Array(element.style.length)].map((_value, index) => element.style.item(index))) {
    if (/^--qdbg\d+$/.test(property)) {
      element.style.removeProperty(property);
    }
  }
  restoreQuakeRenderBundleDebugOutlineLeafBackgrounds(element);
}

function preloadQuakeRenderBundleDebugOutlineAssets(
  renderBundle: QuakePreparedRenderBundle,
  options: QuakeRenderBundleDebugOutlineOptions,
): Promise<void> {
  const cache = options.hideTextures === true
    ? renderBundleDebugTransparentOutlinePreloads
    : renderBundleDebugOutlinePreloads;
  const existing = cache.get(renderBundle);
  if (existing) return existing;
  const outlineAssets = quakeRenderBundleDebugOutlineAssets(renderBundle, options);
  const preloadUrls = outlineAssets ? [...outlineAssets.rootVars.values()] : [];
  const promise = Promise.all(preloadUrls
    .map(preloadQuakeRenderBundleAsset))
    .then(() => undefined);
  cache.set(renderBundle, promise);
  return promise;
}

function quakeRenderBundleDebugOutlineUrls(
  renderBundle: QuakePreparedRenderBundle,
  options: QuakeRenderBundleDebugOutlineOptions,
): string[] | undefined {
  return options.hideTextures === true
    ? renderBundle.debugTransparentOutlineAssetUrls
    : renderBundle.debugOutlineAssetUrls;
}

function quakeRenderBundleDebugOutlineSourceUrls(
  renderBundle: QuakePreparedRenderBundle,
  options: QuakeRenderBundleDebugOutlineOptions,
): readonly string[] {
  const sourceUrls = options.hideTextures === true
    ? renderBundle.debugTransparentOutlineSourceAssetUrls
    : renderBundle.debugOutlineSourceAssetUrls;
  return sourceUrls?.length ? sourceUrls : renderBundle.assetUrls;
}

function quakeRenderBundleDebugOutlineBackgrounds(
  renderBundle: QuakePreparedRenderBundle,
  options: QuakeRenderBundleDebugOutlineOptions,
): readonly (readonly [string, string] | null)[] {
  return options.hideTextures === true
    ? renderBundle.debugTransparentOutlineBackgrounds ?? []
    : renderBundle.debugOutlineBackgrounds ?? [];
}

function quakeRenderBundleDebugOutlineAssets(
  renderBundle: QuakePreparedRenderBundle,
  options: QuakeRenderBundleDebugOutlineOptions,
): QuakeRenderBundleDebugOutlineAssets | undefined {
  const urls = quakeRenderBundleDebugOutlineUrls(renderBundle, options);
  if (!urls?.length) return undefined;
  const sourceUrls = quakeRenderBundleDebugOutlineSourceUrls(renderBundle, options);
  const backgrounds = quakeRenderBundleDebugOutlineBackgrounds(renderBundle, options);
  const bundleAssetPaths = new Set(renderBundle.assetUrls.map(quakeRenderBundleUrlPath).filter(Boolean));
  const backgroundVarBySourcePath = quakeRenderBundleBackgroundVarBySourcePath(renderBundle.assetUrls);
  const outlineByBackgroundVar = new Map<string, QuakeRenderBundleDebugOutlineEntry>();
  const outlineBySourcePath = new Map<string, QuakeRenderBundleDebugOutlineEntry>();
  const rootVars = new Map<string, string>();
  const overpainted = options.hideTextures !== true && renderBundle.debugOutlineOverpainted === true;
  for (let index = 0; index < urls.length; index++) {
    const url = urls[index];
    const sourcePath = quakeRenderBundleUrlPath(sourceUrls[index]);
    if (!url || !sourcePath) continue;
    const background = backgrounds[index];
    const usesRootVar = bundleAssetPaths.has(sourcePath) || Boolean(background);
    const entry = {
      image: usesRootVar ? quakeRenderBundleDebugOutlineRootVar(rootVars, url) : quakeRenderBundleCssUrl(url),
      ...(background ? { position: background[0], size: background[1] } : {}),
    };
    outlineBySourcePath.set(sourcePath, entry);
    const backgroundVar = backgroundVarBySourcePath.get(sourcePath);
    if (backgroundVar) outlineByBackgroundVar.set(backgroundVar, entry);
  }
  return outlineBySourcePath.size ? { outlineByBackgroundVar, outlineBySourcePath, overpainted, rootVars, urls } : undefined;
}

function quakeRenderBundleDebugOutlineRootVar(rootVars: Map<string, string>, url: string): string {
  for (const [varName, existingUrl] of rootVars) {
    if (existingUrl === url) return `var(${varName})`;
  }
  const varName = `--qdbg${rootVars.size}`;
  rootVars.set(varName, url);
  return `var(${varName})`;
}

function applyQuakeRenderBundleDebugOutlineLeafBackgrounds(
  element: HTMLElement,
  outlineAssets: QuakeRenderBundleDebugOutlineAssets,
  options: QuakeRenderBundleDebugOutlineOptions,
): void {
  applyQuakeRenderBundleDebugOutlineLeaves(
    element,
    outlineAssets,
    options,
    quakeRenderBundleDebugOutlineLeaves(element),
  );
}

function applyQuakeRenderBundleDebugOutlineLeaves(
  element: HTMLElement,
  outlineAssets: QuakeRenderBundleDebugOutlineAssets,
  options: QuakeRenderBundleDebugOutlineOptions,
  leaves: Iterable<HTMLElement>,
): void {
  for (const leaf of leaves) {
    const style = leaf.isConnected ? getComputedStyle(leaf) : null;
    captureQuakeRenderBundleDebugOutlineLeafBackground(element, leaf, style, {
      replace: !quakeRenderBundleDebugLeafOverrideIsApplied(leaf),
    });
    const previous = renderBundleDebugLeafBackgrounds.get(leaf);
    const backgroundImage = previous?.computedBackgroundImage ??
      style?.backgroundImage ??
      quakeRenderBundleInlineLeafBackgroundImage(leaf);
    const originalImage = quakeRenderBundleOriginalBackgroundImage(
      backgroundImage,
      outlineAssets.outlineBySourcePath,
      outlineAssets.outlineByBackgroundVar,
    );
    if (!originalImage) {
      if (options.hideTextures === true) {
        hideQuakeRenderBundleDebugLeafTexture(leaf);
      } else if (quakeRenderBundleDebugLeafTextureIsHidden(leaf)) {
        restoreQuakeRenderBundleDebugOutlineLeafBackground(leaf);
      }
      continue;
    }
    const position = firstQuakeRenderBundleBackgroundLayerValue(
      previous?.computedBackgroundPosition ??
        style?.backgroundPosition ??
        quakeRenderBundleInlineLeafBackgroundPosition(leaf),
    ) || "0px 0px";
    const size = firstQuakeRenderBundleBackgroundLayerValue(
      previous?.computedBackgroundSize ??
        style?.backgroundSize ??
        quakeRenderBundleInlineLeafBackgroundSize(leaf),
    ) || "auto";
    const outlinePosition = originalImage.outlinePosition ?? position;
    const outlineSize = originalImage.outlineSize ?? size;
    const overpainted = options.hideTextures !== true && outlineAssets.overpainted;
    const image = overpainted || options.hideTextures === true
      ? originalImage.outlineImage
      : `${originalImage.outlineImage}, ${originalImage.image}`;
    const repeat = overpainted || options.hideTextures === true ? "no-repeat" : "no-repeat, no-repeat";
    const layeredPosition = overpainted || options.hideTextures === true
      ? outlinePosition
      : `${outlinePosition}, ${position}`;
    const layeredSize = overpainted || options.hideTextures === true
      ? outlineSize
      : `${outlineSize}, ${size}`;
    if (
      leaf.style.backgroundImage === image &&
      leaf.style.backgroundPosition === layeredPosition &&
      leaf.style.backgroundSize === layeredSize &&
      leaf.style.backgroundRepeat === repeat
    ) {
      continue;
    }
    if (options.hideTextures === true) {
      leaf.removeAttribute("data-quake-debug-texture-hidden");
      leaf.style.backgroundImage = image;
      leaf.style.backgroundPosition = layeredPosition;
      leaf.style.backgroundSize = layeredSize;
      leaf.style.backgroundRepeat = repeat;
    } else {
      leaf.removeAttribute("data-quake-debug-texture-hidden");
      leaf.style.backgroundImage = image;
      leaf.style.backgroundPosition = layeredPosition;
      leaf.style.backgroundSize = layeredSize;
      leaf.style.backgroundRepeat = repeat;
    }
  }
}

function captureQuakeRenderBundleDebugOutlineLeafBackgrounds(element: HTMLElement): void {
  for (const leaf of quakeRenderBundleDebugOutlineLeaves(element)) {
    captureQuakeRenderBundleDebugOutlineLeafBackground(element, leaf);
  }
}

function captureQuakeRenderBundleDebugOutlineLeafBackground(
  element: HTMLElement,
  leaf: HTMLElement,
  style: CSSStyleDeclaration | null = leaf.isConnected ? getComputedStyle(leaf) : null,
  options: { replace?: boolean } = {},
): void {
  if (renderBundleDebugLeafBackgrounds.has(leaf) && !options.replace) return;
  let leaves = renderBundleDebugLeavesByElement.get(element);
  if (!leaves) {
    leaves = new Set();
    renderBundleDebugLeavesByElement.set(element, leaves);
  }
  leaves.add(leaf);
  renderBundleDebugLeafBackgrounds.set(leaf, {
    background: leaf.style.background,
    computedBackgroundImage: style?.backgroundImage || quakeRenderBundleInlineLeafBackgroundImage(leaf),
    computedBackgroundPosition: style?.backgroundPosition || quakeRenderBundleInlineLeafBackgroundPosition(leaf),
    computedBackgroundSize: style?.backgroundSize || quakeRenderBundleInlineLeafBackgroundSize(leaf),
    backgroundImage: leaf.style.backgroundImage,
    backgroundPosition: leaf.style.backgroundPosition,
    backgroundRepeat: leaf.style.backgroundRepeat,
    backgroundSize: leaf.style.backgroundSize,
  });
}

function quakeRenderBundleDebugOutlineLeaves(element: HTMLElement): Iterable<HTMLElement> {
  return renderBundleDebugOutlineLeavesByElement.get(element) ?? element.querySelectorAll<HTMLElement>("s");
}

function quakeRenderBundleDebugOutlineBackgroundIsApplied(backgroundImage: string): boolean {
  return backgroundImage.includes("var(--qdbg");
}

function quakeRenderBundleDebugLeafOverrideIsApplied(leaf: HTMLElement): boolean {
  return quakeRenderBundleDebugOutlineBackgroundIsApplied(leaf.style.backgroundImage) ||
    quakeRenderBundleDebugLeafTextureIsHidden(leaf);
}

function quakeRenderBundleDebugLeafTextureIsHidden(leaf: HTMLElement): boolean {
  return leaf.dataset.quakeDebugTextureHidden === "true" && leaf.style.backgroundImage === "none";
}

function hideQuakeRenderBundleDebugLeafTexture(leaf: HTMLElement): void {
  if (quakeRenderBundleDebugLeafTextureIsHidden(leaf)) return;
  leaf.dataset.quakeDebugTextureHidden = "true";
  leaf.style.background = "none";
}

function restoreQuakeRenderBundleDebugOutlineLeafBackgrounds(element: HTMLElement): void {
  const leaves = new Set<HTMLElement>(renderBundleDebugLeavesByElement.get(element));
  for (const leaf of element.querySelectorAll<HTMLElement>("s")) leaves.add(leaf);
  for (const leaf of leaves) {
    restoreQuakeRenderBundleDebugOutlineLeafBackground(leaf);
  }
  renderBundleDebugLeavesByElement.delete(element);
}

function restoreQuakeRenderBundleDebugOutlineLeafBackground(leaf: HTMLElement): void {
  const previous = renderBundleDebugLeafBackgrounds.get(leaf);
  leaf.removeAttribute("data-quake-debug-texture-hidden");
  if (!previous) return;
  leaf.style.removeProperty("background");
  leaf.style.removeProperty("background-image");
  leaf.style.removeProperty("background-position");
  leaf.style.removeProperty("background-repeat");
  leaf.style.removeProperty("background-size");
  if (previous.background) leaf.style.background = previous.background;
  if (previous.backgroundImage) leaf.style.backgroundImage = previous.backgroundImage;
  if (previous.backgroundPosition) leaf.style.backgroundPosition = previous.backgroundPosition;
  if (previous.backgroundRepeat) leaf.style.backgroundRepeat = previous.backgroundRepeat;
  if (previous.backgroundSize) leaf.style.backgroundSize = previous.backgroundSize;
  renderBundleDebugLeafBackgrounds.delete(leaf);
}

function setQuakeRenderBundleDebugOutlineRootVars(
  element: HTMLElement,
  outlineAssets: QuakeRenderBundleDebugOutlineAssets,
): void {
  for (const [varName, url] of outlineAssets.rootVars) {
    element.style.setProperty(varName, quakeRenderBundleCssUrl(url));
  }
}

function quakeRenderBundleBackgroundVarBySourcePath(assetUrls: readonly string[]): Map<string, string> {
  const varBySourcePath = new Map<string, string>();
  for (let index = 0; index < assetUrls.length; index++) {
    const sourcePath = quakeRenderBundleUrlPath(assetUrls[index]);
    if (sourcePath) varBySourcePath.set(sourcePath, `--bg${index}`);
  }
  return varBySourcePath;
}

function quakeRenderBundleMeshElement(element: HTMLElement): HTMLElement | null {
  return element.classList.contains("polycss-mesh") ? element : element.closest(".polycss-mesh");
}

function quakeRenderBundleOriginalBackgroundImage(
  backgroundImage: string,
  outlineBySourcePath: Map<string, QuakeRenderBundleDebugOutlineEntry>,
  outlineByBackgroundVar: Map<string, QuakeRenderBundleDebugOutlineEntry>,
): { image: string; outlineImage: string; outlinePosition?: string; outlineSize?: string } | undefined {
  for (const match of backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    const path = quakeRenderBundleUrlPath(match[1]);
    const outline = path ? outlineBySourcePath.get(path) : undefined;
    if (outline) {
      return {
        image: match[0],
        outlineImage: outline.image,
        ...(outline.position ? { outlinePosition: outline.position } : {}),
        ...(outline.size ? { outlineSize: outline.size } : {}),
      };
    }
  }
  for (const match of backgroundImage.matchAll(/var\((--bg\d+)\)/g)) {
    const outline = outlineByBackgroundVar.get(match[1]);
    if (!outline) continue;
    return {
      image: match[0],
      outlineImage: outline.image,
      ...(outline.position ? { outlinePosition: outline.position } : {}),
      ...(outline.size ? { outlineSize: outline.size } : {}),
    };
  }
  return undefined;
}

function quakeRenderBundleInlineLeafBackgroundImage(leaf: HTMLElement): string {
  return leaf.style.backgroundImage ||
    quakeRenderBundleInlineStyleDeclaration(leaf, "background") ||
    "";
}

function quakeRenderBundleInlineLeafBackgroundPosition(leaf: HTMLElement): string {
  return leaf.style.backgroundPosition ||
    quakeRenderBundleBackgroundPositionFromShorthand(quakeRenderBundleInlineStyleDeclaration(leaf, "background")) ||
    "";
}

function quakeRenderBundleInlineLeafBackgroundSize(leaf: HTMLElement): string {
  return leaf.style.backgroundSize ||
    quakeRenderBundleBackgroundSizeFromShorthand(quakeRenderBundleInlineStyleDeclaration(leaf, "background")) ||
    "";
}

function quakeRenderBundleInlineStyleDeclaration(leaf: HTMLElement, name: string): string {
  const style = leaf.getAttribute("style");
  if (!style?.includes(name)) return "";
  for (const part of style.split(";")) {
    const separator = part.indexOf(":");
    if (separator <= 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return "";
}

function quakeRenderBundleBackgroundPositionFromShorthand(background: string): string {
  const match = background.match(/(?:url\([^)]*\)|var\(--[^)]+\))\s+([^/;]+?)\s*(?:\/|$)/);
  return match?.[1]?.trim() ?? "";
}

function quakeRenderBundleBackgroundSizeFromShorthand(background: string): string {
  const match = background.match(/\/\s*([^;]+?)(?:\s+(?:repeat|no-repeat|repeat-x|repeat-y|space|round)\b|$)/);
  return match?.[1]?.trim() ?? "";
}

function firstQuakeRenderBundleBackgroundLayerValue(value: string): string {
  return value.split(",")[0]?.trim() ?? "";
}

function quakeRenderBundleUrlPath(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, window.location.href).pathname;
  } catch {
    return undefined;
  }
}

function quakeRenderBundleCssUrl(url: string): string {
  return `url("${url.replace(/["\\\n\r\f]/g, "\\$&")}")`;
}

function preloadQuakeRenderBundleStyle(renderBundle: QuakePreparedRenderBundle): Promise<void> {
  const key = quakeRenderBundleStyleKey(renderBundle);
  if (!key) return Promise.resolve();
  const existing = renderBundleStyleLoadPromises.get(key);
  if (existing) return existing;
  const element = ensureQuakeRenderBundleStyles(renderBundle, document);
  if (!(element instanceof HTMLLinkElement)) return Promise.resolve();
  const promise = new Promise<void>((resolve) => {
    if (renderBundleLoadedStyles.has(element) || element.sheet) {
      resolve();
      return;
    }
    const done = () => {
      renderBundleLoadedStyles.add(element);
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
  for (const leaf of element.querySelectorAll<HTMLElement>("[data-two-sided]")) {
    leaf.style.backfaceVisibility = "visible";
    leaf.removeAttribute("data-two-sided");
  }
}

export function createQuakeRenderBundleMeshHandle(element: HTMLElement): PolyMeshHandle {
  const transform: { position?: Vec3; rotation?: Vec3; scale?: number | Vec3 } = {};
  let appliedTransformStyle = element.style.transform;
  const removeElement = () => {
    mountedRenderBundleElements.delete(element);
    element.remove();
  };
  const handle = {
    polygons: [] as Polygon[],
    element,
    transform,
    remove: removeElement,
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
    dispose: removeElement,
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
