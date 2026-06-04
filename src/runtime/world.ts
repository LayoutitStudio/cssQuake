import {
  type ParseResult,
  type Polygon,
  type PolyMeshHandle,
  type Vec3,
} from "@layoutit/polycss";

import {
  QUAKE_LIGHT_STYLE_PATTERNS,
  type QuakePreparedRenderBundle,
  type QuakeScene,
  type QuakeVisibility,
} from "../prepare/prepared-scene";
import { polygonNormal } from "./math";

const QUAKE_LEAF_PRESENTATION_RESYNC_DELAYS = [0, 80, 300] as const;
const QUAKE_LIGHTSTYLE_FPS = 6;
const QUAKE_LIGHTSTYLE_STARTED_AT = performance.now();
const QUAKE_LIGHTSTYLE_OVERLAY_OFFSET = 0.001;
const QUAKE_TEXTURE_ANIMATION_FPS = 5;
const QUAKE_TEXTURE_ANIMATION_STARTED_AT = performance.now();
const quakeTextureAnimationPresentationObservers = new WeakMap<HTMLElement, MutationObserver>();

export interface QuakeFaceLeaf {
  faceIndex: number;
  modelIndex?: number;
  entityIndex?: number;
  element: HTMLElement;
  anchor: Comment;
  mounted: boolean;
  baseTransform: string;
  baseBackgroundImage: string;
  baseBackgroundPosition: string;
  baseBackgroundSize: string;
  baseBackgroundRepeat: string;
}

interface QuakeWorldScene {
  add: (
    result: ParseResult,
    options: {
      id?: string;
      merge: boolean;
      meshResolution: "lossless";
      excludeFromAutoCenter: boolean;
    },
  ) => PolyMeshHandle;
}

export interface QuakeWorldControllerOptions {
  applyMoverLeafTransform: (leaf: QuakeFaceLeaf) => void;
  getOrigin: () => [number, number, number];
  makeParseResult: (polygons: Polygon[]) => ParseResult;
  scene: QuakeWorldScene;
  sceneElement: HTMLElement | null;
  syncButtonLeafVisual: (leaf: QuakeFaceLeaf) => void;
  syncPickupsVisibility: (origin: [number, number, number]) => void;
}

export interface QuakeWorldController {
  clear: () => void;
  dispose: () => void;
  leafIndexAt: (origin: Vec3) => number | undefined;
  modelLeaves: (modelIndex: number) => QuakeFaceLeaf[];
  mount: (result: QuakeScene) => void;
  pixelate: (handle?: PolyMeshHandle | null) => void;
  schedulePresentationResync: (handle?: PolyMeshHandle | null) => Promise<void>;
  syncVisibility: (force?: boolean) => void;
  visibleLeavesAt: (origin: [number, number, number]) => Set<number> | null;
  waitForPresentationResyncs: () => Promise<void>;
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
  let currentTextureUrls: string[] = [];
  let currentVisibility: QuakeVisibility | null = null;
  let faceLeaves = new Map<number, QuakeFaceLeaf[]>();
  let modelLeaves = new Map<number, QuakeFaceLeaf[]>();
  let quakeLeaves: QuakeFaceLeaf[] = [];
  let visibleFaceKey = "";
  const preloadedButtonImages = new Set<HTMLImageElement>();
  let presentationResyncTasks = new Set<QuakePresentationResyncTask>();

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
    for (const url of currentTextureUrls) {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    }
    currentTextureUrls = [];
  };

  const clearPresentationResyncTimers = (): void => {
    for (const task of presentationResyncTasks) settlePresentationResyncTask(task);
  };

  const mount = (result: QuakeScene): void => {
    currentTextureUrls = result.textureUrls;
    currentVisibility = result.visibility ?? null;
    currentHandle = result.renderBundle ? addQuakeRenderBundleMesh(result.renderBundle) : addQuakeMesh(result.polygons);
    currentLightstyleOverlayHandle = addQuakeLightstyleOverlayMesh(result.polygons);
  };

  const pixelate = (handle = currentHandle): void => {
    if (!handle) return;
    for (const leaf of handle.element.querySelectorAll<HTMLElement>("b,i,s,u")) {
      applyQuakeLeafPresentation(leaf);
    }
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

  const waitForPresentationResyncs = async (): Promise<void> => {
    await Promise.all([...presentationResyncTasks].map((task) => task.promise ?? Promise.resolve()));
  };

  const syncVisibility = (force = false): void => {
    if (!currentHandle) return;
    const origin = options.getOrigin();
    options.syncPickupsVisibility(origin);
    const visibleFaces = currentVisibility?.visibleFacesAt(origin) ?? null;
    if (!visibleFaces) {
      if (force || visibleFaceKey !== "all") {
        const now = performance.now();
        for (const leaf of quakeLeaves) setQuakeLeafMounted(leaf, true, now);
        visibleFaceKey = "all";
      }
      return;
    }

    const nextKey = faceSetKey(visibleFaces);
    if (!force && nextKey === visibleFaceKey) return;
    visibleFaceKey = nextKey;
    const now = performance.now();
    for (const [faceIndex, leaves] of faceLeaves) {
      const visible = visibleFaces.has(faceIndex);
      for (const leaf of leaves) setQuakeLeafMounted(leaf, visible, now);
    }
  };

  const setQuakeLeafMounted = (leaf: QuakeFaceLeaf, mounted: boolean, now = performance.now()): void => {
    if (leaf.mounted === mounted) return;
    if (mounted) {
      applyQuakeLeafPresentation(leaf.element);
      options.applyMoverLeafTransform(leaf);
      options.syncButtonLeafVisual(leaf);
      syncQuakeLightstyleLeafAnimationClock(leaf.element, now);
      syncQuakeTextureAnimationLeafAnimationClock(leaf.element, now);
      leaf.anchor.parentNode?.insertBefore(leaf.element, leaf.anchor);
      leaf.element.hidden = false;
    } else {
      leaf.element.remove();
    }
    leaf.mounted = mounted;
  };

  const addQuakeMesh = (polygons: Polygon[]): PolyMeshHandle => {
    const handle = options.scene.add(options.makeParseResult(polygons), {
      merge: false,
      meshResolution: "lossless",
      excludeFromAutoCenter: true,
    });
    stripQuakeWorldMeshMetadata(handle.element);
    faceLeaves = indexQuakeFaceLeaves(handle, new Map(), true);
    preloadQuakeButtonStateTextures();
    return handle;
  };

  const addQuakeRenderBundleMesh = (renderBundle: QuakePreparedRenderBundle): PolyMeshHandle => {
    if (!options.sceneElement) {
      throw new Error("Quake render bundle mount requires a PolyCSS scene element.");
    }
    const template = document.createElement("template");
    template.innerHTML = renderBundle.meshHtml.trim();
    const element = template.content.firstElementChild;
    if (!(element instanceof HTMLElement) || !element.classList.contains("polycss-mesh")) {
      throw new Error("Quake render bundle did not contain a .polycss-mesh root.");
    }
    const leafCount = element.querySelectorAll("b,i,s,u").length;
    if (leafCount !== renderBundle.leafCount) {
      throw new Error(`Quake render bundle leaf count mismatch: expected ${renderBundle.leafCount}, got ${leafCount}.`);
    }
    stripQuakeWorldMeshMetadata(element);
    options.sceneElement.appendChild(element);
    const handle = createQuakeRenderBundleMeshHandle(element);
    faceLeaves = indexQuakeFaceLeaves(handle, new Map(), true);
    preloadQuakeButtonStateTextures();
    return handle;
  };

  const addQuakeLightstyleOverlayMesh = (polygons: Polygon[]): PolyMeshHandle | null => {
    const overlayPolygons = quakeLightstyleOverlayPolygons(polygons);
    if (overlayPolygons.length === 0) return null;
    const handle = options.scene.add(options.makeParseResult(overlayPolygons), {
      id: "quake-lightstyle-overlay",
      merge: false,
      meshResolution: "lossless",
      excludeFromAutoCenter: true,
    });
    indexQuakeFaceLeaves(handle, faceLeaves, false);
    syncQuakeLightstyleOverlayAnimations(handle);
    return handle;
  };

  const indexQuakeFaceLeaves = (
    handle: PolyMeshHandle,
    leaves = new Map<number, QuakeFaceLeaf[]>(),
    reset = true,
  ): Map<number, QuakeFaceLeaf[]> => {
    if (reset) {
      quakeLeaves = [];
      modelLeaves = new Map();
    }
    for (const leaf of handle.element.querySelectorAll<HTMLElement>("b,i,s,u")) {
      const faceIndex = Number(leaf.dataset.quakeFace);
      if (!Number.isInteger(faceIndex)) continue;
      const modelIndex = Number(leaf.dataset.quakeModel);
      const entityIndex = Number(leaf.dataset.quakeEntity);
      applyQuakeLeafPresentation(leaf);
      const anchor = leaf.ownerDocument.createComment(`quake-face:${faceIndex}`);
      leaf.after(anchor);
      const record: QuakeFaceLeaf = {
        faceIndex,
        ...(Number.isInteger(modelIndex) ? { modelIndex } : {}),
        ...(Number.isInteger(entityIndex) ? { entityIndex } : {}),
        element: leaf,
        anchor,
        mounted: true,
        baseTransform: leaf.style.transform,
        baseBackgroundImage: leaf.style.backgroundImage,
        baseBackgroundPosition: leaf.style.backgroundPosition,
        baseBackgroundSize: leaf.style.backgroundSize,
        baseBackgroundRepeat: leaf.style.backgroundRepeat,
      };
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
      const baseUrl = leaf.element.dataset.quakeButtonBaseTexture;
      const pressedUrl = leaf.element.dataset.quakeButtonPressedTexture;
      const animationUrl = leaf.element.dataset.quakeTextureAnimationSprite;
      if (baseUrl) urls.add(baseUrl);
      if (pressedUrl) urls.add(pressedUrl);
      if (animationUrl) urls.add(animationUrl);
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

  return {
    clear,
    dispose: clear,
    leafIndexAt: (origin: Vec3) => currentVisibility?.leafIndexAt(origin),
    modelLeaves: (modelIndex: number) => modelLeaves.get(modelIndex) ?? [],
    mount,
    pixelate,
    schedulePresentationResync,
    syncVisibility,
    visibleLeavesAt: (origin: [number, number, number]) => currentVisibility?.visibleLeavesAt(origin) ?? null,
    waitForPresentationResyncs,
  };
}

function stripQuakeWorldMeshMetadata(element: HTMLElement): void {
  element.removeAttribute("data-poly-mesh-id");
  element.removeAttribute("data-poly-mesh-index");
}

function createQuakeRenderBundleMeshHandle(element: HTMLElement): PolyMeshHandle {
  const transform: { id?: string; position?: Vec3; rotation?: Vec3; scale?: number | Vec3 } = {
    id: element.dataset.polyMeshId,
  };
  return {
    polygons: [],
    element,
    id: element.dataset.polyMeshId,
    transform,
    remove: () => element.remove(),
    setPolygons: () => undefined,
    updatePolygon: () => undefined,
    setTransform: () => undefined,
    dispose: () => element.remove(),
    rebakeAtlas: () => undefined,
    getPosition: () => transform.position,
    getRotation: () => transform.rotation,
    getScale: () => transform.scale,
    getPolygons: () => [],
  } as PolyMeshHandle;
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
  leaf.style.imageRendering = "pixelated";
  leaf.style.removeProperty("filter");
  applyQuakeTextureAnimationLeafPresentation(leaf);
  if (leaf.dataset.quakePickupModel?.startsWith("progs/") || quakeLeafUsesSpecialTexture(leaf)) {
    leaf.style.backfaceVisibility = "visible";
  } else {
    leaf.style.removeProperty("backface-visibility");
  }
}

function quakeLeafUsesSpecialTexture(leaf: HTMLElement): boolean {
  return leaf.dataset.quakeTexture?.startsWith("*") === true;
}

function applyQuakeTextureAnimationLeafPresentation(leaf: HTMLElement): void {
  const sprite = leaf.dataset.quakeTextureAnimationSprite;
  if (!sprite) return;
  const frameCount = Number(leaf.dataset.quakeTextureAnimationFrameCount);
  if (!Number.isInteger(frameCount) || frameCount <= 1) return;
  observeQuakeTextureAnimationLeafPresentation(leaf);
  if (leaf.dataset.quakeButtonActive === "true") return;
  leaf.style.backgroundImage = quakeCssUrl(sprite);
  leaf.style.backgroundPosition = "0px 0px";
  leaf.style.backgroundPositionY = "0px";
  leaf.style.backgroundSize = `${frameCount * 100}% 100%`;
  leaf.style.backgroundRepeat = "no-repeat";
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
  observer.observe(leaf, { attributes: true, attributeFilter: ["style", "data-quake-button-active"] });
  quakeTextureAnimationPresentationObservers.set(leaf, observer);
}

function quakeTextureAnimationLeafNeedsPresentation(leaf: HTMLElement): boolean {
  const sprite = leaf.dataset.quakeTextureAnimationSprite;
  if (!sprite || leaf.dataset.quakeButtonActive === "true") return false;
  const frameCount = Number(leaf.dataset.quakeTextureAnimationFrameCount);
  if (!Number.isInteger(frameCount) || frameCount <= 1) return false;
  return !leaf.style.backgroundImage.includes(sprite.slice(0, 64)) ||
    leaf.style.backgroundPositionY !== "0px" ||
    leaf.style.backgroundSize !== `${frameCount * 100}% 100%` ||
    leaf.style.backgroundRepeat !== "no-repeat";
}

export function syncQuakeTextureAnimationLeafAnimationClock(leaf: HTMLElement, now = performance.now()): void {
  if (leaf.dataset.quakeTextureAnimationSprite === undefined) return;
  const frameCount = Number(leaf.dataset.quakeTextureAnimationFrameCount);
  if (!Number.isInteger(frameCount) || frameCount <= 1) return;
  const duration = frameCount / QUAKE_TEXTURE_ANIMATION_FPS;
  const elapsed = (now - QUAKE_TEXTURE_ANIMATION_STARTED_AT) / 1000;
  leaf.style.animationDelay = `${(-(elapsed % duration)).toFixed(4)}s`;
}

function syncQuakeLightstyleOverlayAnimations(handle: PolyMeshHandle): void {
  const now = performance.now();
  for (const leaf of handle.element.querySelectorAll<HTMLElement>("[data-quake-lightstyle-overlay-pattern]")) {
    const pattern = leaf.dataset.quakeLightstyleOverlayPattern;
    if (!pattern) continue;
    const opacities = parseLightstyleOverlayPattern(pattern);
    for (let i = 0; i < opacities.length; i++) {
      leaf.style.setProperty(`--quake-lightstyle-frame-${i}`, Math.max(0, Math.min(0.85, opacities[i] ?? 0)).toFixed(3));
    }
    syncQuakeLightstyleLeafAnimationClock(leaf, now);
  }
}

function syncQuakeLightstyleLeafAnimationClock(leaf: HTMLElement, now = performance.now()): void {
  if (leaf.dataset.quakeLightstyleOverlay === undefined) return;
  const styleId = Number(leaf.dataset.quakeLightstyleAnimation);
  if (!Number.isInteger(styleId)) return;
  const pattern = QUAKE_LIGHT_STYLE_PATTERNS.get(styleId);
  if (!pattern) return;
  const duration = pattern.length / QUAKE_LIGHTSTYLE_FPS;
  if (duration <= 0) return;
  const elapsed = (now - QUAKE_LIGHTSTYLE_STARTED_AT) / 1000;
  leaf.style.animationDelay = `${(-(elapsed % duration)).toFixed(4)}s`;
}

function quakeLightstyleOverlayPolygons(polygons: Polygon[]): Polygon[] {
  const overlays: Polygon[] = [];
  for (const polygon of polygons) {
    const styleId = polygon.data?.["quake-lightstyle-animation"];
    const faceIndex = polygon.data?.["quake-face"];
    if (styleId === undefined || faceIndex === undefined) continue;
    overlays.push({
      vertices: offsetPolygonVertices(polygon.vertices, QUAKE_LIGHTSTYLE_OVERLAY_OFFSET),
      color: "#000000",
      data: {
        quake: true,
        "quake-face": faceIndex,
        ...(polygon.data?.["quake-model"] !== undefined ? { "quake-model": polygon.data["quake-model"] } : {}),
        ...(polygon.data?.["quake-entity"] !== undefined ? { "quake-entity": polygon.data["quake-entity"] } : {}),
        "quake-lightstyle-overlay": true,
        "quake-lightstyle-animation": styleId,
        ...(polygon.data?.["quake-lightstyle-overlay-pattern"] !== undefined
          ? { "quake-lightstyle-overlay-pattern": polygon.data["quake-lightstyle-overlay-pattern"] }
          : {}),
      },
    });
  }
  return overlays;
}

function offsetPolygonVertices(vertices: Vec3[], amount: number): Vec3[] {
  const normal = polygonNormal(vertices);
  return vertices.map((vertex) => [
    vertex[0] + normal[0] * amount,
    vertex[1] + normal[1] * amount,
    vertex[2] + normal[2] * amount,
  ] as Vec3);
}

function quakeLightstyleBaseRules(): string[] {
  const rules = [
    '#quake-host [data-quake-lightstyle-overlay] { opacity: 0; pointer-events: none; }',
  ];
  for (const [styleId, pattern] of QUAKE_LIGHT_STYLE_PATTERNS) {
    if (styleId === 0) continue;
    const name = `quake-lightstyle-${styleId}`;
    rules.push(
      `#quake-host [data-quake-lightstyle-overlay][data-quake-lightstyle-animation="${styleId}"] { animation: ${name} ${(pattern.length / QUAKE_LIGHTSTYLE_FPS).toFixed(3)}s linear infinite; }`,
    );
    rules.push(`@keyframes ${name} { ${lightstyleKeyframes(pattern.length)} }`);
  }
  return rules;
}

function quakeTextureAnimationBaseRules(): string[] {
  const rules = [
    '#quake-host [data-quake-texture-animation-sprite] { background-repeat: no-repeat; animation-timing-function: linear; animation-iteration-count: infinite; }',
  ];
  for (let frameCount = 2; frameCount <= 10; frameCount++) {
    const name = `quake-texture-animation-${frameCount}`;
    rules.push(
      `#quake-host [data-quake-texture-animation-frame-count="${frameCount}"] { animation-name: ${name}; animation-duration: ${(frameCount / QUAKE_TEXTURE_ANIMATION_FPS).toFixed(3)}s; }`,
    );
    rules.push(`@keyframes ${name} { ${textureAnimationKeyframes(frameCount)} }`);
  }
  return rules;
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
