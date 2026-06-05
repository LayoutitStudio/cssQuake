import {
  BASE_TILE,
  type Polygon,
  type PolyMeshHandle,
  type Vec3,
} from "@layoutit/polycss";

import type { QuakePreparedRenderBundle } from "../prepare/scene";

export interface QuakeRenderBundleFrameSetFrame {
  name: string;
  renderBundle: QuakePreparedRenderBundle;
}

export interface QuakeRenderBundleFrameSet {
  leafCount: number;
  renderBundle: QuakePreparedRenderBundle;
  frames: QuakeRenderBundleFrameSetFrame[];
}

export type QuakeRenderBundleFrameSetHandle = PolyMeshHandle & {
  getFrameIndex(): number;
  setFrameIndex(frameIndex: number): void;
};

const renderBundleTemplateCache = new WeakMap<QuakePreparedRenderBundle, HTMLTemplateElement>();
const renderBundleRootVarsCache = new WeakMap<QuakePreparedRenderBundle, Map<string, string>>();
const renderBundleElementRootVarNames = new WeakMap<HTMLElement, Set<string>>();
const renderBundleStyleCache = new Map<string, HTMLStyleElement | HTMLLinkElement>();
const renderBundleStyleLoadPromises = new Map<string, Promise<void>>();
const renderBundleLeafFrameStylesLoadPromises = new Map<string, Promise<QuakeRenderBundleLeafFrameStylesFile>>();
const renderBundleAssetPreloads = new Map<string, {
  image: HTMLImageElement;
  promise: Promise<void>;
}>();
const renderBundlePreferredAssetApplied = new WeakSet<QuakePreparedRenderBundle>();
let quakeAvifSupport: boolean | undefined;
let quakeAvifSupportPromise: Promise<boolean> | null = null;

type QuakeRenderBundleLeafFrameStylesFile = {
  version: 1;
  frames: NonNullable<QuakePreparedRenderBundle["leafFrameStyles"]>[];
};

const QUAKE_AVIF_TEST_IMAGE =
  "data:image/avif;base64," +
  "AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAAXBtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAANGlsb2MAAAAAREAAAgABAAAAAAGUAAEAAAAAAAAAHwACAAAAAAGzAAEAAAAAAAAAFAAAADhpaW5mAAAAAAACAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAFWluZmUCAAAAAAIAAGF2MDEAAAAAr2lwcnAAAACKaXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAcAAAAAA5waXhpAAAAAAEIAAAAOGF1eEMAAAAAdXJuOm1wZWc6bXBlZ0I6Y2ljcDpzeXN0ZW1zOmF1eGlsaWFyeTphbHBoYQAAAAAdaXBtYQAAAAAAAAACAAEDgQIDAAIEhAIFhgAAABppcmVmAAAAAAAAAA5hdXhsAAIAAQABAAAAO21kYXQSAAoHOAAGEBDQaTISGAAKKKKEAEZs7/ZgvZYw0YmuEgAKBBgABhUyChgAKKEAAiEbo2A=";

export function mountQuakeRenderBundleMesh(
  sceneElement: HTMLElement,
  renderBundle: QuakePreparedRenderBundle,
): PolyMeshHandle {
  applyQuakeRenderBundlePreferredAssetsSync(renderBundle);
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
  handle.element.dataset.frameSet = "true";
  handle.element.dataset.frameIndex = String(currentFrameIndex);
  syncQuakeRenderBundleRootVars(handle.element, firstFrame.renderBundle);
  handle.getFrameIndex = () => currentFrameIndex;
  handle.setFrameIndex = (nextFrameIndex: number) => {
    const boundedNextFrameIndex = quakeRenderBundleFrameSetIndex(frameSet, nextFrameIndex);
    if (boundedNextFrameIndex === currentFrameIndex) return;
    const previous = frameSet.frames[currentFrameIndex]?.renderBundle;
    const next = frameSet.frames[boundedNextFrameIndex]?.renderBundle;
    if (!next) return;
    syncQuakeRenderBundleRootVars(handle.element, next);
    if (next.leafFrameStyles?.length) {
      applyQuakeRenderBundleLeafFrameStyles(handle.element, next);
    } else {
      ensureQuakeRenderBundleStyles(next, handle.element.ownerDocument);
      if (previous?.styleClassName) handle.element.classList.remove(previous.styleClassName);
      if (next.styleClassName) handle.element.classList.add(next.styleClassName);
    }
    currentFrameIndex = boundedNextFrameIndex;
    handle.element.dataset.frameIndex = String(currentFrameIndex);
  };
  if (boundedFrameIndex !== currentFrameIndex) handle.setFrameIndex(boundedFrameIndex);
  return handle;
}

export function setQuakeRenderBundleFrameSetHandleFrame(handle: PolyMeshHandle | null, frameIndex: number): boolean {
  if (!handle || !isQuakeRenderBundleFrameSetHandle(handle)) return false;
  handle.setFrameIndex(frameIndex);
  return true;
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

export async function preloadQuakeRenderBundleAssets(renderBundle: QuakePreparedRenderBundle): Promise<void> {
  await applyQuakeRenderBundlePreferredAssets(renderBundle);
  await loadQuakeRenderBundleLeafFrameStyles(renderBundle);
  quakeRenderBundleTemplate(renderBundle);
  await Promise.all([
    preloadQuakeRenderBundleStyle(renderBundle),
    ...renderBundle.assetUrls.map(preloadQuakeRenderBundleAsset),
  ]);
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
  const frameIndex = renderBundle.leafFrameStylesIndex ?? 0;
  const frameStyles = file.frames[frameIndex];
  if (!frameStyles) {
    throw new Error(`Quake render bundle frame styles missing frame ${frameIndex} in ${url}.`);
  }
  renderBundle.leafFrameStyles = frameStyles;
}

async function applyQuakeRenderBundlePreferredAssets(renderBundle: QuakePreparedRenderBundle): Promise<void> {
  if (renderBundlePreferredAssetApplied.has(renderBundle) || !renderBundle.assetVariants?.length) return;
  if (!(await supportsQuakeAvifAssets())) return;
  applyQuakeRenderBundlePreferredAssetReplacements(renderBundle, "image/avif");
}

function applyQuakeRenderBundlePreferredAssetsSync(renderBundle: QuakePreparedRenderBundle): void {
  if (quakeAvifSupport !== true || renderBundlePreferredAssetApplied.has(renderBundle)) return;
  applyQuakeRenderBundlePreferredAssetReplacements(renderBundle, "image/avif");
}

function applyQuakeRenderBundlePreferredAssetReplacements(
  renderBundle: QuakePreparedRenderBundle,
  mime: string,
): void {
  const replacements = new Map<string, string>();
  for (const variant of renderBundle.assetVariants ?? []) {
    if (variant.mime === mime) replacements.set(variant.sourceUrl, variant.url);
  }
  if (!replacements.size) return;
  for (const [sourceUrl, preferredUrl] of replacements) {
    renderBundle.meshHtml = renderBundle.meshHtml.split(sourceUrl).join(preferredUrl);
    if (renderBundle.meshCss) {
      renderBundle.meshCss = renderBundle.meshCss.split(sourceUrl).join(preferredUrl);
    }
  }
  renderBundle.assetUrls = renderBundle.assetUrls.map((url) => replacements.get(url) ?? url);
  for (const frameStyle of renderBundle.leafFrameStyles ?? []) {
    for (let index = 0; index < frameStyle.length; index++) {
      const value = frameStyle[index];
      if (typeof value === "string") {
        frameStyle[index] = replacements.get(value) ?? value;
        for (const [sourceUrl, preferredUrl] of replacements) {
          frameStyle[index] = frameStyle[index].split(sourceUrl).join(preferredUrl);
        }
      }
    }
  }
  renderBundleTemplateCache.delete(renderBundle);
  renderBundleRootVarsCache.delete(renderBundle);
  renderBundlePreferredAssetApplied.add(renderBundle);
}

function applyQuakeRenderBundleLeafFrameStyles(
  element: HTMLElement,
  renderBundle: QuakePreparedRenderBundle,
): void {
  const frameStyles = renderBundle.leafFrameStyles;
  if (!frameStyles?.length && renderBundle.leafFrameStylesUrl) {
    throw new Error(`Quake render bundle frame styles were not preloaded from ${renderBundle.leafFrameStylesUrl}.`);
  }
  if (!frameStyles?.length) return;
  const leaves = element.querySelectorAll<HTMLElement>("b,i,s,u");
  const count = Math.min(leaves.length, frameStyles.length);
  for (let index = 0; index < count; index++) {
    const leaf = leaves[index];
    const frameStyle = frameStyles[index];
    if (!leaf || !frameStyle) continue;
    applyQuakeRenderBundleLeafFrameStyle(leaf, frameStyle);
  }
}

function applyQuakeRenderBundleLeafFrameStyle(
  leaf: HTMLElement,
  [matrix, background, extraStyle]: NonNullable<QuakePreparedRenderBundle["leafFrameStyles"]>[number],
): void {
  leaf.removeAttribute("style");
  if (extraStyle) leaf.style.cssText = extraStyle;
  if (matrix) {
    leaf.style.transform = matrix.startsWith("matrix3d(") ? matrix : `matrix3d(${matrix})`;
  }
  if (background) {
    leaf.style.background = background.startsWith("var(") ? background : `var(--bg0) ${background}`;
  }
}

function supportsQuakeAvifAssets(): Promise<boolean> {
  if (quakeAvifSupport !== undefined) return Promise.resolve(quakeAvifSupport);
  quakeAvifSupportPromise ??= new Promise<boolean>((resolve) => {
    const image = new Image();
    const done = (supported: boolean) => {
      quakeAvifSupport = supported;
      resolve(supported);
    };
    image.onload = () => done(image.width === 1 && image.height === 1);
    image.onerror = () => done(false);
    image.src = QUAKE_AVIF_TEST_IMAGE;
  });
  return quakeAvifSupportPromise;
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
    element.style.setProperty(name, value);
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
      if (style) {
        element.style.transform = style;
      } else {
        element.style.removeProperty("transform");
      }
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
