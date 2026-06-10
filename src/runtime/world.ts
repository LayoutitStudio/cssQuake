import {
  type PolyMeshHandle,
  type Vec3,
} from "@layoutit/polycss";

import {
  QUAKE_LIGHT_STYLE_PATTERNS,
  type QuakePreparedRenderBundle,
  type QuakeScene,
  type QuakeVisibility,
} from "../prepare/scene";
import {
  createQuakeWorldVisibilityChurnStats,
  recordQuakeWorldVisibilitySync,
  type QuakeWorldVisibilityChurnStats,
} from "./debug/churnStats";
import { markQuakeTrace } from "./debug/traceMarks";
import {
  mountQuakeRenderBundleMesh,
  registerQuakeRenderBundleDebugOutlineLeaves,
  stripPolyMeshMetadata,
  syncQuakeRenderBundleDebugOutlineLeaves,
} from "./renderBundleMesh";

const QUAKE_LEAF_PRESENTATION_RESYNC_DELAYS = [0, 80, 300] as const;
const QUAKE_LIGHTSTYLE_FPS = 6;
const QUAKE_LIGHTSTYLE_STARTED_AT = performance.now();
const QUAKE_TEXTURE_ANIMATION_FPS = 5;
const QUAKE_TEXTURE_ANIMATION_STARTED_AT = performance.now();
const quakeTextureAnimationActiveLeaves = new WeakSet<HTMLElement>();
const quakeTextureAnimationMetadataByLeaf = new WeakMap<HTMLElement, QuakeTextureAnimationMetadata>();
const quakeTextureAnimationPresentationObservers = new WeakMap<HTMLElement, MutationObserver>();
const quakeMeshPresentationObservers = new WeakMap<HTMLElement, MutationObserver>();
const quakeBackfaceVisibleLeaves = new WeakSet<HTMLElement>();

export interface QuakeFaceLeaf {
  faceIndex: number;
  modelIndex?: number;
  entityIndex?: number;
  meshKind: "world" | "lightstyle";
  tagName: string;
  textureName?: string;
  buttonBaseTexture?: string;
  buttonPressedTexture?: string;
  specialTexture: boolean;
  textureAnimated: boolean;
  lightstyleAnimated: boolean;
  lightstyleStyleId?: number;
  element: HTMLElement;
  parent: HTMLElement;
  previous?: QuakeFaceLeaf;
  next?: QuakeFaceLeaf;
  mounted: boolean;
  baseTransform: string;
  baseBackgroundImage: string;
  baseBackgroundPosition: string;
  baseBackgroundSize: string;
}

interface QuakeTextureAnimationMetadata {
  frameCount: number;
  sprite: string;
}

export interface QuakeWorldControllerOptions {
  applyMoverLeafTransform: (leaf: QuakeFaceLeaf) => void;
  getOrigin: () => [number, number, number];
  sceneElement: HTMLElement;
  syncButtonLeafVisual: (leaf: QuakeFaceLeaf) => void;
  syncPickupsVisibility: (origin: [number, number, number]) => void;
}

export interface QuakeWorldController {
  clear: () => void;
  debugStats: () => QuakeWorldDebugStats;
  dispose: () => void;
  leafIndexAt: (origin: Vec3) => number | undefined;
  modelLeaves: (modelIndex: number) => QuakeFaceLeaf[];
  mount: (result: QuakeScene) => void;
  pixelate: (handle?: PolyMeshHandle | null) => void;
  schedulePresentationResync: (handle?: PolyMeshHandle | null) => Promise<void>;
  syncVisibility: (force?: boolean) => void;
  visibleLeavesAt: (origin: [number, number, number]) => Set<number> | null;
}

export interface QuakeWorldDebugBucket {
  total: number;
  mounted: number;
}

export interface QuakeWorldDebugStats {
  currentLeafIndex: number | null;
  visibleLeafCount: number | null;
  pvsFaceCount: number | null;
  renderFaceCount: number;
  totalLeaves: number;
  mountedLeaves: number;
  unmountedLeaves: number;
  mountedAtlasLeaves: number;
  mountedSpecialTextureLeaves: number;
  mountedTextureAnimatedLeaves: number;
  mountedLightstyleLeaves: number;
  mountedBrushModelLeaves: number;
  mountedEntityLeaves: number;
  leavesByMesh: Record<string, QuakeWorldDebugBucket>;
  leavesByTag: Record<string, QuakeWorldDebugBucket>;
  visibilityChurn: QuakeWorldVisibilityChurnStats;
}

interface QuakePresentationResyncTask {
  timers: number[];
  resolve: () => void;
  settled: boolean;
  promise?: Promise<void>;
}

export function createQuakeWorldController(options: QuakeWorldControllerOptions): QuakeWorldController {
  let currentHandle: PolyMeshHandle | null = null;
  let currentLightstyleOverlayHandle: PolyMeshHandle | null = null;
  let currentVisibility: QuakeVisibility | null = null;
  let faceLeaves = new Map<number, QuakeFaceLeaf[]>();
  let modelLeaves = new Map<number, QuakeFaceLeaf[]>();
  let quakeLeaves: QuakeFaceLeaf[] = [];
  let visibleFaceKey = "";
  const preloadedButtonImages = new Set<HTMLImageElement>();
  let presentationResyncTasks = new Set<QuakePresentationResyncTask>();
  let visibilityChurn = createQuakeWorldVisibilityChurnStats();

  const clear = (): void => {
    clearPresentationResyncTimers();
    currentHandle?.remove();
    currentLightstyleOverlayHandle?.remove();
    currentHandle = null;
    currentLightstyleOverlayHandle = null;
    currentVisibility = null;
    faceLeaves = new Map();
    modelLeaves = new Map();
    quakeLeaves = [];
    visibleFaceKey = "";
    preloadedButtonImages.clear();
    visibilityChurn = createQuakeWorldVisibilityChurnStats();
  };

  const clearPresentationResyncTimers = (): void => {
    for (const task of presentationResyncTasks) settlePresentationResyncTask(task);
  };

  const mount = (result: QuakeScene): void => {
    currentVisibility = result.visibility ?? null;
    if (!result.renderBundle) throw new Error(`Prepared Quake scene ${result.label} is missing its render bundle.`);
    currentHandle = addQuakeRenderBundleMesh(result.renderBundle);
    currentLightstyleOverlayHandle = result.lightstyleRenderBundle
      ? addQuakeLightstyleRenderBundleMesh(result.lightstyleRenderBundle)
      : null;
  };

  const pixelate = (handle = currentHandle): void => {
    if (!handle) return;
    for (const leaf of handle.element.querySelectorAll<HTMLElement>("b,i,s,u")) {
      applyQuakeLeafPresentation(leaf);
    }
    hoistQuakeMeshBackgroundImages(handle.element);
    syncQuakeDebugOutlineLeavesForHandle(handle);
    observeQuakeMeshPresentation(handle.element);
  };

  const schedulePresentationResync = (handle?: PolyMeshHandle | null): Promise<void> => {
    const task: QuakePresentationResyncTask = {
      timers: [],
      resolve: () => undefined,
      settled: false,
    };
    let remaining = QUAKE_LEAF_PRESENTATION_RESYNC_DELAYS.length;
    const promise = new Promise<void>((resolve) => {
      task.resolve = resolve;
      presentationResyncTasks.add(task);
      for (const delay of QUAKE_LEAF_PRESENTATION_RESYNC_DELAYS) {
        const timer = window.setTimeout(() => {
          task.timers = task.timers.filter((item) => item !== timer);
          try {
            if (handle) {
              pixelate(handle);
            } else {
              for (const leaf of quakeLeaves) applyQuakeLeafPresentation(leaf.element);
              syncQuakeDebugOutlineLeavesForHandle(currentHandle);
              syncQuakeDebugOutlineLeavesForHandle(currentLightstyleOverlayHandle);
            }
          } finally {
            remaining--;
            if (remaining <= 0) settlePresentationResyncTask(task);
          }
        }, delay);
        task.timers.push(timer);
      }
    });
    task.promise = promise;
    return promise;
  };

  const settlePresentationResyncTask = (task: QuakePresentationResyncTask): void => {
    if (task.settled) return;
    task.settled = true;
    for (const timer of task.timers) window.clearTimeout(timer);
    task.timers = [];
    presentationResyncTasks.delete(task);
    task.resolve();
  };

  const syncVisibility = (force = false): void => {
    const startedAt = performance.now();
    if (!currentHandle) {
      recordQuakeWorldVisibilitySync(visibilityChurn, "no-handle", startedAt, { force });
      return;
    }
    const origin = options.getOrigin();
    options.syncPickupsVisibility(origin);
    const visibleFaceGroup = currentVisibility?.visibleFaceGroupAt(origin) ?? null;
    const visibleFaces = visibleFaceGroup?.faces ?? null;
    if (!visibleFaces) {
      let addedLeaves = 0;
      let removedLeaves = 0;
      if (force || visibleFaceKey !== "all") {
        const now = performance.now();
        for (const leaf of quakeLeaves) {
          const change = setQuakeLeafMounted(leaf, true, now);
          if (change > 0) addedLeaves++;
          if (change < 0) removedLeaves++;
        }
        visibleFaceKey = "all";
      }
      recordQuakeWorldVisibilitySync(visibilityChurn, "no-pvs", startedAt, { force, addedLeaves, removedLeaves });
      if (force || addedLeaves > 0 || removedLeaves > 0) {
        markQuakeTrace("world-visibility", {
          reason: "no-pvs",
          force,
          addedLeaves,
          removedLeaves,
          mountedLeaves: quakeLeaves.length,
        });
      }
      return;
    }

    const nextKey = visibleFaceGroup?.key ?? faceSetKey(visibleFaces);
    if (!force && nextKey === visibleFaceKey) {
      recordQuakeWorldVisibilitySync(visibilityChurn, "same-key", startedAt, { pvsFaceCount: visibleFaces.size });
      return;
    }
    visibleFaceKey = nextKey;
    const now = performance.now();
    let addedLeaves = 0;
    let removedLeaves = 0;
    for (const [faceIndex, leaves] of faceLeaves) {
      const visible = visibleFaces.has(faceIndex);
      for (const leaf of leaves) {
        const change = setQuakeLeafMounted(leaf, visible, now);
        if (change > 0) addedLeaves++;
        if (change < 0) removedLeaves++;
      }
    }
    recordQuakeWorldVisibilitySync(visibilityChurn, force ? "force" : "leaf-change", startedAt, {
      force,
      pvsFaceCount: visibleFaces.size,
      addedLeaves,
      removedLeaves,
    });
    markQuakeTrace("world-visibility", {
      reason: force ? "force" : "leaf-change",
      force,
      pvsFaces: visibleFaces.size,
      addedLeaves,
      removedLeaves,
    });
  };

  const setQuakeLeafMounted = (leaf: QuakeFaceLeaf, mounted: boolean, now = performance.now()): number => {
    if (leaf.mounted === mounted) return 0;
    if (mounted) {
      applyQuakeLeafPresentation(leaf.element);
      options.applyMoverLeafTransform(leaf);
      options.syncButtonLeafVisual(leaf);
      syncQuakeLightstyleLeafAnimationClock(leaf.element, leaf.lightstyleStyleId, now);
      syncQuakeTextureAnimationLeafAnimationClock(leaf.element, now);
      insertQuakeLeafInOrder(leaf);
      leaf.element.hidden = false;
    } else {
      leaf.element.remove();
    }
    leaf.mounted = mounted;
    return mounted ? 1 : -1;
  };

  const debugStats = (): QuakeWorldDebugStats => {
    const origin = options.getOrigin();
    const currentLeafIndex = currentVisibility?.leafIndexAt(origin);
    const visibleLeaves = currentVisibility?.visibleLeavesAt(origin) ?? null;
    const visibleFaces = currentVisibility?.visibleFacesAt(origin) ?? null;
    let mountedLeaves = 0;
    let mountedAtlasLeaves = 0;
    let mountedSpecialTextureLeaves = 0;
    let mountedTextureAnimatedLeaves = 0;
    let mountedLightstyleLeaves = 0;
    let mountedBrushModelLeaves = 0;
    let mountedEntityLeaves = 0;
    const leavesByMesh: Record<string, QuakeWorldDebugBucket> = {};
    const leavesByTag: Record<string, QuakeWorldDebugBucket> = {};

    for (const leaf of quakeLeaves) {
      const mounted = leaf.mounted && leaf.element.isConnected;
      if (mounted) {
        mountedLeaves++;
        if (leaf.tagName === "s") mountedAtlasLeaves++;
        if (leaf.specialTexture) mountedSpecialTextureLeaves++;
        if (leaf.textureAnimated) mountedTextureAnimatedLeaves++;
        if (leaf.lightstyleAnimated) mountedLightstyleLeaves++;
        if (leaf.modelIndex !== undefined && leaf.modelIndex !== 0) mountedBrushModelLeaves++;
        if (leaf.entityIndex !== undefined) mountedEntityLeaves++;
      }
      addQuakeWorldDebugBucket(leavesByMesh, leaf.meshKind, mounted);
      addQuakeWorldDebugBucket(leavesByTag, leaf.tagName, mounted);
    }

    return {
      currentLeafIndex: Number.isInteger(currentLeafIndex) ? currentLeafIndex : null,
      visibleLeafCount: visibleLeaves?.size ?? null,
      pvsFaceCount: visibleFaces?.size ?? null,
      renderFaceCount: faceLeaves.size,
      totalLeaves: quakeLeaves.length,
      mountedLeaves,
      unmountedLeaves: quakeLeaves.length - mountedLeaves,
      mountedAtlasLeaves,
      mountedSpecialTextureLeaves,
      mountedTextureAnimatedLeaves,
      mountedLightstyleLeaves,
      mountedBrushModelLeaves,
      mountedEntityLeaves,
      leavesByMesh,
      leavesByTag,
      visibilityChurn: { ...visibilityChurn },
    };
  };

  const addQuakeRenderBundleMesh = (renderBundle: QuakePreparedRenderBundle): PolyMeshHandle => {
    const handle = mountQuakeRenderBundleMesh(options.sceneElement, renderBundle);
    const element = handle.element;
    stripQuakeWorldMeshMetadata(element);
    faceLeaves = indexQuakeFaceLeaves(handle, renderBundle, new Map(), true, "world");
    preloadQuakeButtonStateTextures();
    return handle;
  };

  const addQuakeLightstyleRenderBundleMesh = (renderBundle: QuakePreparedRenderBundle): PolyMeshHandle => {
    const handle = mountQuakeRenderBundleMesh(options.sceneElement, renderBundle);
    handle.element.classList.add("quake-lightstyle-mesh");
    stripQuakeWorldMeshMetadata(handle.element);
    indexQuakeFaceLeaves(handle, renderBundle, faceLeaves, false, "lightstyle");
    syncQuakeLightstyleOverlayAnimations(handle);
    return handle;
  };

  const indexQuakeFaceLeaves = (
    handle: PolyMeshHandle,
    renderBundle: QuakePreparedRenderBundle,
    leaves = new Map<number, QuakeFaceLeaf[]>(),
    reset = true,
    meshKind: QuakeFaceLeaf["meshKind"] = "world",
  ): Map<number, QuakeFaceLeaf[]> => {
    if (reset) {
      quakeLeaves = [];
      modelLeaves = new Map();
    }
    const previousByParent = new Map<HTMLElement, QuakeFaceLeaf>();
    const elements = [...handle.element.querySelectorAll<HTMLElement>("b,i,s,u")];
    registerQuakeRenderBundleDebugOutlineLeaves(
      handle.element,
      elements.filter((element) => element.tagName.toLowerCase() === "s"),
    );
    if (elements.length !== renderBundle.leafMetadata.length) {
      throw new Error(
        `Quake render bundle metadata mismatch: expected ${elements.length} leaves, got ${renderBundle.leafMetadata.length}.`,
      );
    }
    for (let index = 0; index < elements.length; index++) {
      const leaf = elements[index];
      const metadata = renderBundle.leafMetadata[index];
      if (!leaf || !metadata) continue;
      const parent = leaf.parentElement;
      if (!parent) continue;
      const faceIndex = metadata.f;
      if (!Number.isInteger(faceIndex)) continue;
      const modelIndex = metadata.m;
      const entityIndex = metadata.e;
      const textureName = metadata.t;
      const lightstyleValue = Number(metadata.l);
      const lightstyleAnimation = Number(leaf.dataset.lsAnim);
      const lightstyleStyleId = Number.isInteger(lightstyleAnimation) ? lightstyleAnimation : undefined;
      const buttonBaseTexture = leaf.dataset.base;
      const buttonPressedTexture = leaf.dataset.pressed;
      const textureAnimationMetadata = registerQuakeTextureAnimationLeaf(leaf);
      const tagName = leaf.tagName.toLowerCase();
      const specialTexture = textureName?.startsWith("*") === true;
      if (specialTexture) quakeBackfaceVisibleLeaves.add(leaf);
      applyQuakeLeafPresentation(leaf);
      stripQuakeWorldLeafMetadata(leaf);
      if (meshKind === "world") {
        leaf.removeAttribute("data-ls-anim");
        leaf.removeAttribute("data-ls-pattern");
      }
      const previous = previousByParent.get(parent);
      const record: QuakeFaceLeaf = {
        faceIndex,
        ...(Number.isInteger(modelIndex) ? { modelIndex } : {}),
        ...(Number.isInteger(entityIndex) ? { entityIndex } : {}),
        meshKind,
        tagName,
        ...(textureName ? { textureName } : {}),
        ...(buttonBaseTexture ? { buttonBaseTexture } : {}),
        ...(buttonPressedTexture ? { buttonPressedTexture } : {}),
        specialTexture,
        textureAnimated: textureAnimationMetadata !== undefined,
        lightstyleAnimated: lightstyleStyleId !== undefined || Number.isInteger(lightstyleValue),
        ...(lightstyleStyleId !== undefined ? { lightstyleStyleId } : {}),
        element: leaf,
        parent,
        ...(previous ? { previous } : {}),
        mounted: true,
        baseTransform: leaf.style.transform,
        baseBackgroundImage: leaf.style.backgroundImage,
        baseBackgroundPosition: leaf.style.backgroundPosition,
        baseBackgroundSize: leaf.style.backgroundSize,
      };
      if (previous) previous.next = record;
      previousByParent.set(parent, record);
      quakeLeaves.push(record);
      const bucket = leaves.get(faceIndex);
      if (bucket) {
        bucket.push(record);
      } else {
        leaves.set(faceIndex, [record]);
      }
      if (Number.isInteger(modelIndex)) {
        const modelBucket = modelLeaves.get(modelIndex);
        if (modelBucket) {
          modelBucket.push(record);
        } else {
          modelLeaves.set(modelIndex, [record]);
        }
      }
    }
    return leaves;
  };

  const preloadQuakeButtonStateTextures = (): void => {
    const urls = new Set<string>();
    for (const leaf of quakeLeaves) {
      const animation = quakeTextureAnimationMetadataByLeaf.get(leaf.element);
      if (leaf.buttonBaseTexture) urls.add(leaf.buttonBaseTexture);
      if (leaf.buttonPressedTexture) urls.add(leaf.buttonPressedTexture);
      if (animation) urls.add(animation.sprite);
    }
    preloadedButtonImages.clear();
    for (const url of urls) {
      const image = new Image();
      image.decoding = "sync";
      image.loading = "eager";
      image.src = url;
      void image.decode().catch(() => undefined);
      preloadedButtonImages.add(image);
    }
  };

  const syncQuakeDebugOutlineLeavesForHandle = (handle: PolyMeshHandle | null): void => {
    if (!handle) return;
    syncQuakeRenderBundleDebugOutlineLeaves(handle.element, handle.element.querySelectorAll<HTMLElement>("s"));
  };

  return {
    clear,
    debugStats,
    dispose: clear,
    leafIndexAt: (origin: Vec3) => currentVisibility?.leafIndexAt(origin),
    modelLeaves: (modelIndex: number) => modelLeaves.get(modelIndex) ?? [],
    mount,
    pixelate,
    schedulePresentationResync,
    syncVisibility,
    visibleLeavesAt: (origin: [number, number, number]) => currentVisibility?.visibleLeavesAt(origin) ?? null,
  };
}

function addQuakeWorldDebugBucket(
  buckets: Record<string, QuakeWorldDebugBucket>,
  key: string,
  mounted: boolean,
): void {
  const bucket = buckets[key] ?? { total: 0, mounted: 0 };
  bucket.total++;
  if (mounted) bucket.mounted++;
  buckets[key] = bucket;
}

function stripQuakeWorldMeshMetadata(element: HTMLElement): void {
  stripPolyMeshMetadata(element);
}

function stripQuakeWorldLeafMetadata(leaf: HTMLElement): void {
  stripQuakeLeafMetadata(leaf);
}

export function injectQuakeWorldAnimations(): void {
  const lightstyle = document.getElementById("quake-lightstyle-animations") ?? document.createElement("style");
  lightstyle.id = "quake-lightstyle-animations";
  lightstyle.textContent = quakeLightstyleBaseRules().join("\n");
  if (!lightstyle.parentNode) document.head.append(lightstyle);

  const textureAnimation = document.getElementById("quake-texture-animation-animations") ?? document.createElement("style");
  textureAnimation.id = "quake-texture-animation-animations";
  textureAnimation.textContent = quakeTextureAnimationBaseRules().join("\n");
  if (!textureAnimation.parentNode) document.head.append(textureAnimation);
}

export function quakeCssUrl(url: string): string {
  return `url("${url.replace(/["\\\n\r\f]/g, "\\$&")}")`;
}

function applyQuakeLeafPresentation(leaf: HTMLElement): void {
  leaf.style.removeProperty("filter");
  applyQuakeTextureAnimationLeafPresentation(leaf);
  const backfaceVisible = quakeBackfaceVisibleLeaves.has(leaf) ||
    quakeLeafUsesSpecialTexture(leaf);
  if (backfaceVisible) {
    quakeBackfaceVisibleLeaves.add(leaf);
    leaf.style.backfaceVisibility = "visible";
  } else {
    leaf.style.removeProperty("backface-visibility");
  }
  stripQuakeLeafMetadata(leaf);
}

function quakeLeafUsesSpecialTexture(leaf: HTMLElement): boolean {
  return leaf.dataset.tex?.startsWith("*") === true;
}

function stripQuakeLeafMetadata(leaf: HTMLElement): void {
  leaf.removeAttribute("data-poly-index");
  leaf.removeAttribute("data-f");
  leaf.removeAttribute("data-m");
  leaf.removeAttribute("data-e");
  leaf.removeAttribute("data-lit");
  leaf.removeAttribute("data-ls");
  leaf.removeAttribute("data-tex");
  leaf.removeAttribute("data-lm-bake");
  leaf.removeAttribute("data-lm-range");
  leaf.removeAttribute("data-lm-texels");
  leaf.removeAttribute("data-base");
  leaf.removeAttribute("data-pressed");
  leaf.removeAttribute("data-sprite");
  leaf.removeAttribute("data-frames");
  if (leaf.hasAttribute("data-two-sided")) {
    leaf.style.backfaceVisibility = "visible";
    leaf.removeAttribute("data-two-sided");
  }
  stripQuakeLeafStyleMetadata(leaf);
}

function insertQuakeLeafInOrder(leaf: QuakeFaceLeaf): void {
  let previous = leaf.previous;
  while (previous && (!previous.mounted || previous.element.parentNode !== leaf.parent)) {
    previous = previous.previous;
  }
  if (previous) {
    leaf.parent.insertBefore(leaf.element, previous.element.nextSibling);
    return;
  }

  let next = leaf.next;
  while (next && (!next.mounted || next.element.parentNode !== leaf.parent)) {
    next = next.next;
  }
  leaf.parent.insertBefore(leaf.element, next?.element ?? null);
}

function stripQuakeLeafStyleMetadata(leaf: HTMLElement): void {
  leaf.style.removeProperty("--pnx");
  leaf.style.removeProperty("--pny");
  leaf.style.removeProperty("--pnz");
  if (leaf.style.getPropertyValue("--polycss-atlas-size").trim() === "64px") {
    leaf.style.removeProperty("--polycss-atlas-size");
  }
  if (leaf.style.imageRendering === "pixelated") {
    leaf.style.removeProperty("image-rendering");
  }
  if (leaf.style.backgroundRepeat === "no-repeat" && !quakeLeafDebugOutlineBackgroundIsApplied(leaf)) {
    leaf.style.removeProperty("background-repeat");
  }
}

function observeQuakeMeshPresentation(element: HTMLElement): void {
  if (quakeMeshPresentationObservers.has(element)) return;
  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(() => {
      pending = false;
      for (const leaf of element.querySelectorAll<HTMLElement>("b,i,s,u")) {
        applyQuakeLeafPresentation(leaf);
      }
      hoistQuakeMeshBackgroundImages(element);
    });
  });
  observer.observe(element, { attributes: true, attributeFilter: ["style"], subtree: true });
  quakeMeshPresentationObservers.set(element, observer);
}

function hoistQuakeMeshBackgroundImages(element: HTMLElement): void {
  const leaves = [...element.querySelectorAll<HTMLElement>("[style]")];
  const imageUseCounts = quakeBackgroundImageUseCounts(leaves);
  const usedVarNames = quakeBackgroundVarNames(leaves);
  const reservedVarNames = new Set(usedVarNames);
  const varByImage = quakeExistingBackgroundVars(element, usedVarNames);
  for (const leaf of leaves) {
    const style = leaf.getAttribute("style") ?? "";
    if (!style.includes("background")) continue;
    const nextStyle = compactQuakeBackgroundStyle(
      style.replace(/(background(?:-image)?):\s*url\(([^)]+)\)/g, (_match, property: string, image: string) => {
        if ((imageUseCounts.get(image) ?? 0) <= 1) return _match;
        let varName = varByImage.get(image);
        if (!varName) {
          varName = nextQuakeBackgroundVarName(reservedVarNames);
          varByImage.set(image, varName);
        }
        return `${property}:var(${varName})`;
      }),
    );
    if (nextStyle !== style) leaf.setAttribute("style", nextStyle);
  }

  const finalUsedVarNames = quakeBackgroundVarNames(leaves);
  for (const [image, varName] of varByImage) {
    if (finalUsedVarNames.has(varName)) {
      element.style.setProperty(varName, `url(${image})`);
    }
  }
  for (const property of [...Array(element.style.length)].map((_value, index) => element.style.item(index))) {
    if (/^--bg\d+$/.test(property) && !finalUsedVarNames.has(property)) {
      element.style.removeProperty(property);
    }
  }
}

function quakeBackgroundImageUseCounts(leaves: HTMLElement[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const leaf of leaves) {
    const style = leaf.getAttribute("style") ?? "";
    if (!style.includes("background")) continue;
    for (const match of style.matchAll(/background(?:-image)?:\s*url\(([^)]+)\)/g)) {
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    }
  }
  return counts;
}

function quakeBackgroundVarNames(leaves: HTMLElement[]): Set<string> {
  const names = new Set<string>();
  for (const leaf of leaves) {
    const style = leaf.getAttribute("style") ?? "";
    if (!style.includes("var(--bg")) continue;
    for (const match of style.matchAll(/var\(--bg(\d+)\)/g)) {
      names.add(`--bg${match[1]}`);
    }
  }
  return names;
}

function quakeExistingBackgroundVars(element: HTMLElement, usedVarNames: Set<string>): Map<string, string> {
  const varByImage = new Map<string, string>();
  for (const property of [...Array(element.style.length)].map((_value, index) => element.style.item(index))) {
    if (!usedVarNames.has(property)) continue;
    const image = quakeCssUrlImage(element.style.getPropertyValue(property).trim());
    if (image) varByImage.set(image, property);
  }
  return varByImage;
}

function quakeCssUrlImage(value: string): string | null {
  const match = value.match(/^url\((.*)\)$/);
  return match?.[1] ?? null;
}

function nextQuakeBackgroundVarName(reservedVarNames: Set<string>): string {
  for (let index = 0; ; index += 1) {
    const varName = `--bg${index}`;
    if (reservedVarNames.has(varName)) continue;
    reservedVarNames.add(varName);
    return varName;
  }
}

function compactQuakeBackgroundStyle(style: string): string {
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
    .filter((part): part is { index: number; name: string; value: string } => part !== null && part.value !== "");
  const image = declarations.find((part) => part.name === "background-image");
  const position = declarations.find((part) => part.name === "background-position");
  const size = declarations.find((part) => part.name === "background-size");
  const compactDeclarations = image && position && size
    ? [
        ...declarations.filter((part) => ![
          "background-image",
          "background-position",
          "background-size",
          "background-repeat",
        ].includes(part.name)),
        {
          index: Math.min(image.index, position.index, size.index),
          name: "background",
          value: `${image.value} ${position.value}/${size.value}`,
        },
      ]
    : declarations;
  return orderQuakeStyleDeclarations(compactDeclarations);
}

function orderQuakeStyleDeclarations(
  declarations: readonly { index: number; name: string; value: string }[],
): string {
  const order = new Map([
    ["transform", 0],
    ["width", 1],
    ["height", 2],
    ["background", 3],
  ]);
  return [...declarations]
    .sort((a, b) => {
      const aOrder = order.get(a.name);
      const bOrder = order.get(b.name);
      if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
      if (aOrder !== undefined) return -1;
      if (bOrder !== undefined) return 1;
      return a.index - b.index;
    })
    .map((part) => `${part.name}:${part.value}`)
    .join(";");
}

function registerQuakeTextureAnimationLeaf(leaf: HTMLElement): QuakeTextureAnimationMetadata | undefined {
  const existing = quakeTextureAnimationMetadataByLeaf.get(leaf);
  if (existing) return existing;
  const sprite = leaf.dataset.sprite;
  const frameCount = Number(leaf.dataset.frames);
  if (!sprite || !Number.isInteger(frameCount) || frameCount <= 1) return undefined;
  const metadata = { frameCount, sprite };
  quakeTextureAnimationMetadataByLeaf.set(leaf, metadata);
  return metadata;
}

function applyQuakeTextureAnimationLeafPresentation(leaf: HTMLElement): void {
  const animation = quakeTextureAnimationMetadataByLeaf.get(leaf) ?? registerQuakeTextureAnimationLeaf(leaf);
  if (!animation) return;
  observeQuakeTextureAnimationLeafPresentation(leaf);
  if (quakeTextureAnimationActiveLeaves.has(leaf)) return;
  if (quakeLeafDebugOutlineBackgroundIsApplied(leaf)) return;
  leaf.style.backgroundImage = quakeCssUrl(animation.sprite);
  leaf.style.backgroundPosition = "0px 0px";
  leaf.style.backgroundPositionY = "0px";
  leaf.style.backgroundSize = `${animation.frameCount * 100}% 100%`;
  leaf.style.animationName = quakeTextureAnimationName(animation.frameCount);
  leaf.style.animationDuration = `${(animation.frameCount / QUAKE_TEXTURE_ANIMATION_FPS).toFixed(3)}s`;
  leaf.style.animationTimingFunction = "linear";
  leaf.style.animationIterationCount = "infinite";
  syncQuakeTextureAnimationLeafAnimationClock(leaf);
}

function observeQuakeTextureAnimationLeafPresentation(leaf: HTMLElement): void {
  if (quakeTextureAnimationPresentationObservers.has(leaf)) return;
  const observer = new MutationObserver(() => {
    if (!quakeTextureAnimationLeafNeedsPresentation(leaf)) return;
    window.requestAnimationFrame(() => {
      if (quakeTextureAnimationLeafNeedsPresentation(leaf)) {
        applyQuakeTextureAnimationLeafPresentation(leaf);
      }
    });
  });
  observer.observe(leaf, { attributes: true, attributeFilter: ["style"] });
  quakeTextureAnimationPresentationObservers.set(leaf, observer);
}

function quakeTextureAnimationLeafNeedsPresentation(leaf: HTMLElement): boolean {
  const animation = quakeTextureAnimationMetadataByLeaf.get(leaf);
  if (!animation || quakeTextureAnimationActiveLeaves.has(leaf)) return false;
  return !quakeLeafBackgroundImageReferences(leaf, animation.sprite) ||
    leaf.style.backgroundPositionY !== "0px" ||
    leaf.style.backgroundSize !== `${animation.frameCount * 100}% 100%` ||
    leaf.style.animationName !== quakeTextureAnimationName(animation.frameCount);
}

function quakeLeafBackgroundImageReferences(leaf: HTMLElement, url: string): boolean {
  const needle = url.slice(0, 64);
  if (leaf.style.backgroundImage.includes(needle)) return true;
  const match = /^var\((--[^)]+)\)$/.exec(leaf.style.backgroundImage.trim());
  if (!match) return false;
  const varName = match[1];
  const mesh = leaf.closest<HTMLElement>(".polycss-mesh");
  return Boolean(
    leaf.style.getPropertyValue(varName).includes(needle) ||
      mesh?.style.getPropertyValue(varName).includes(needle),
  );
}

function quakeLeafDebugOutlineBackgroundIsApplied(leaf: HTMLElement): boolean {
  return leaf.style.backgroundImage.includes("var(--qdbg");
}

export function syncQuakeTextureAnimationLeafAnimationClock(leaf: HTMLElement, now = performance.now()): void {
  const animation = quakeTextureAnimationMetadataByLeaf.get(leaf);
  if (!animation) return;
  const duration = animation.frameCount / QUAKE_TEXTURE_ANIMATION_FPS;
  const elapsed = (now - QUAKE_TEXTURE_ANIMATION_STARTED_AT) / 1000;
  leaf.style.animationDelay = `${(-(elapsed % duration)).toFixed(4)}s`;
}

export function setQuakeTextureAnimationLeafActive(leaf: HTMLElement, active: boolean): void {
  if (active) {
    quakeTextureAnimationActiveLeaves.add(leaf);
  } else {
    quakeTextureAnimationActiveLeaves.delete(leaf);
  }
}

function syncQuakeLightstyleOverlayAnimations(handle: PolyMeshHandle): void {
  const now = performance.now();
  for (const leaf of handle.element.querySelectorAll<HTMLElement>("[data-ls-pattern]")) {
    const pattern = leaf.dataset.lsPattern;
    if (!pattern) continue;
    const styleId = Number(leaf.dataset.lsAnim);
    const opacities = parseLightstyleOverlayPattern(pattern);
    for (let i = 0; i < opacities.length; i++) {
      leaf.style.setProperty(`--quake-lightstyle-frame-${i}`, Math.max(0, Math.min(0.85, opacities[i] ?? 0)).toFixed(3));
    }
    if (Number.isInteger(styleId)) {
      leaf.style.opacity = "0";
      leaf.style.pointerEvents = "none";
      leaf.style.animationName = quakeLightstyleAnimationName(styleId);
      leaf.style.animationDuration = `${(opacities.length / QUAKE_LIGHTSTYLE_FPS).toFixed(3)}s`;
      leaf.style.animationTimingFunction = "linear";
      leaf.style.animationIterationCount = "infinite";
      syncQuakeLightstyleLeafAnimationClock(leaf, styleId, now);
    }
    leaf.removeAttribute("data-ls-overlay");
    leaf.removeAttribute("data-ls-anim");
    leaf.removeAttribute("data-ls-pattern");
  }
}

function syncQuakeLightstyleLeafAnimationClock(
  leaf: HTMLElement,
  styleId: number | undefined,
  now = performance.now(),
): void {
  if (!Number.isInteger(styleId)) return;
  const pattern = QUAKE_LIGHT_STYLE_PATTERNS.get(styleId);
  if (!pattern) return;
  const duration = pattern.length / QUAKE_LIGHTSTYLE_FPS;
  if (duration <= 0) return;
  const elapsed = (now - QUAKE_LIGHTSTYLE_STARTED_AT) / 1000;
  leaf.style.animationDelay = `${(-(elapsed % duration)).toFixed(4)}s`;
}

function quakeLightstyleBaseRules(): string[] {
  const rules: string[] = [];
  for (const [styleId, pattern] of QUAKE_LIGHT_STYLE_PATTERNS) {
    if (styleId === 0) continue;
    const name = quakeLightstyleAnimationName(styleId);
    rules.push(`@keyframes ${name} { ${lightstyleKeyframes(pattern.length)} }`);
  }
  return rules;
}

function quakeLightstyleAnimationName(styleId: number): string {
  return `quake-lightstyle-${styleId}`;
}

function quakeTextureAnimationBaseRules(): string[] {
  const rules: string[] = [];
  for (let frameCount = 2; frameCount <= 10; frameCount++) {
    const name = quakeTextureAnimationName(frameCount);
    rules.push(
      `@keyframes ${name} { ${textureAnimationKeyframes(frameCount)} }`,
    );
  }
  return rules;
}

function quakeTextureAnimationName(frameCount: number): string {
  return `quake-texture-animation-${frameCount}`;
}

function textureAnimationKeyframes(frameCount: number): string {
  const frames: string[] = [];
  for (let i = 0; i < frameCount; i++) {
    const start = (i / frameCount) * 100;
    const end = Math.max(start, ((i + 1) / frameCount) * 100 - 0.001);
    const position = frameCount <= 1 ? 0 : (i / (frameCount - 1)) * 100;
    frames.push(`${start.toFixed(4)}% { background-position-x: ${position.toFixed(4)}%; }`);
    if (end < 100) frames.push(`${end.toFixed(4)}% { background-position-x: ${position.toFixed(4)}%; }`);
  }
  const finalPosition = frameCount <= 1 ? 0 : 100;
  frames.push(`100% { background-position-x: ${finalPosition.toFixed(4)}%; }`);
  return frames.join(" ");
}

function parseLightstyleOverlayPattern(pattern: string): number[] {
  return pattern
    .split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

function lightstyleKeyframes(frameCount: number): string {
  const frames: string[] = [];
  for (let i = 0; i < frameCount; i++) {
    const pct = ((i / frameCount) * 100).toFixed(4);
    frames.push(`${pct}% { opacity: var(--quake-lightstyle-frame-${i}, 0); }`);
  }
  frames.push("100% { opacity: var(--quake-lightstyle-frame-0, 0); }");
  return frames.join(" ");
}

function faceSetKey(faces: Set<number>): string {
  return [...faces].sort((a, b) => a - b).join(",");
}
