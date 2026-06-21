import type { Vec3 } from "@layoutit/polycss";

import { QUAKE_COLLISION_UNIT_SCALE } from "../constants";

const QUAKE_EFFECT_SPRITE_CLASS = "quake-effect-sprite";
const QUAKE_EFFECT_SPRITE_DEFAULT_MAX = 4;
const QUAKE_EFFECT_SPRITE_MIN_DEPTH = 0.02;
const QUAKE_EFFECT_SPRITE_MIN_SCALE = 0.2;
const QUAKE_EFFECT_SPRITE_MAX_SCALE = 12;
const QUAKE_EFFECT_SPRITE_FALLBACK_VIEWPORT_WIDTH = 800;
const QUAKE_EFFECT_SPRITE_FALLBACK_VIEWPORT_HEIGHT = 600;

export interface QuakeEffectSpriteSpawn {
  origin?: Vec3;
  radiusUnits?: number;
}

export interface QuakeEffectSpriteFlow {
  clear(): void;
  dispose(): void;
  preload(): Promise<boolean>;
  setEnabled(enabled: boolean): void;
  spawnExplosion(input?: QuakeEffectSpriteSpawn): void;
}

export interface QuakeEffectSpriteFlowOptions {
  canShow(): boolean;
  cameraPerspectiveStyle?: () => string | null | undefined;
  decodeImage?: (url: string) => Promise<void>;
  effectSpritesUrl(): string | null | undefined;
  isGameplayPaused(): boolean;
  layer: HTMLElement;
  maxSprites?: number;
  now?: () => number;
  viewOrigin?: () => Vec3 | null;
  viewRotation?: () => { rotX: number; rotY: number } | null;
}

interface QuakeEffectSpriteManifest {
  explosionSprite: string;
  sprites: Record<string, QuakePreparedEffectSprite>;
}

interface QuakePreparedEffectSprite {
  frameCount: number;
  frameDurationMs: number;
  frames: QuakePreparedEffectSpriteFrame[];
  header?: {
    maxHeight?: number;
    maxWidth?: number;
  };
  sourcePath: string;
  texture: {
    height: number;
    url: string;
    width: number;
  };
}

interface QuakePreparedEffectSpriteFrame {
  height: number;
  index: number;
  width: number;
  x: number;
  y: number;
}

interface EffectSpriteHandle {
  active: boolean;
  element: HTMLElement;
  frameIndex: number;
  origin: Vec3 | null;
  sprite: QuakePreparedEffectSprite | null;
  startedAt: number;
}

interface EffectSpriteProjection {
  scale: number;
  visible: boolean;
  x: number;
  y: number;
}

export function createQuakeEffectSpriteFlow(options: QuakeEffectSpriteFlowOptions): QuakeEffectSpriteFlow {
  const maxSprites = Math.max(1, Math.floor(options.maxSprites ?? QUAKE_EFFECT_SPRITE_DEFAULT_MAX));
  const now = options.now ?? (() => performance.now());
  const handles: EffectSpriteHandle[] = [];
  let disposed = false;
  let enabled = true;
  let frameId: number | null = null;
  let loadPromise: Promise<boolean> | null = null;
  let nextSpriteIndex = 0;
  let preparedExplosionSprite: QuakePreparedEffectSprite | null = null;

  for (let index = 0; index < maxSprites; index++) {
    const element = document.createElement("i");
    element.className = `${QUAKE_EFFECT_SPRITE_CLASS} quake-effect-sprite-explosion`;
    element.setAttribute("aria-hidden", "true");
    element.dataset.quakeEffectSpriteActive = "false";
    initializeEffectSpriteElement(element);
    options.layer.appendChild(element);
    handles.push({
      active: false,
      element,
      frameIndex: 0,
      origin: null,
      sprite: null,
      startedAt: 0,
    });
  }

  void preload();

  function setEnabled(nextEnabled: boolean): void {
    enabled = nextEnabled;
    if (!enabled) clear();
  }

  async function preload(): Promise<boolean> {
    if (preparedExplosionSprite) return true;
    if (loadPromise) return loadPromise;
    const url = options.effectSpritesUrl();
    if (!url) return false;
    loadPromise = loadExplosionSprite(url)
      .then((sprite) => {
        if (!sprite || disposed) return false;
        preparedExplosionSprite = sprite;
        applyPreparedSpriteTexture(sprite);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        loadPromise = null;
      });
    return loadPromise;
  }

  function spawnExplosion(input: QuakeEffectSpriteSpawn = {}): void {
    if (!enabled || disposed || options.isGameplayPaused() || !options.canShow()) return;
    const sprite = preparedExplosionSprite;
    if (!sprite) {
      void preload();
      return;
    }
    const handle = nextHandle();
    handle.active = true;
    handle.frameIndex = 0;
    handle.origin = input.origin ? [...input.origin] as Vec3 : null;
    handle.sprite = sprite;
    handle.startedAt = now();
    handle.element.dataset.quakeEffectSpriteActive = "true";
    handle.element.dataset.quakeEffectSpriteSource = sprite.sourcePath;
    handle.element.style.opacity = "1";
    syncHandle(handle);
    ensureFrame();
  }

  function clear(): void {
    for (const handle of handles) {
      handle.active = false;
      handle.origin = null;
      handle.sprite = null;
      handle.startedAt = 0;
      handle.frameIndex = 0;
      handle.element.dataset.quakeEffectSpriteActive = "false";
      delete handle.element.dataset.quakeEffectSpriteFrame;
      delete handle.element.dataset.quakeEffectSpriteSource;
      handle.element.style.opacity = "0";
      handle.element.style.transform = "translate3d(-50%, -50%, 0) scale(1)";
    }
    cancelFrame();
  }

  function dispose(): void {
    disposed = true;
    clear();
    for (const handle of handles) handle.element.remove();
  }

  function nextHandle(): EffectSpriteHandle {
    const inactive = handles.find((handle) => !handle.active);
    if (inactive) return inactive;
    const handle = handles[nextSpriteIndex];
    nextSpriteIndex = (nextSpriteIndex + 1) % handles.length;
    return handle;
  }

  async function loadExplosionSprite(url: string): Promise<QuakePreparedEffectSprite | null> {
    const response = await fetch(url);
    if (!response.ok) return null;
    const manifest = normalizeEffectSpriteManifest(await response.json());
    if (!manifest) return null;
    const sprite = manifest.sprites[manifest.explosionSprite];
    if (!sprite) return null;
    const textureUrl = resolveEffectSpriteUrl(sprite.texture.url, url);
    const prepared: QuakePreparedEffectSprite = {
      ...sprite,
      texture: {
        ...sprite.texture,
        url: textureUrl,
      },
    };
    await decodeSpriteTexture(textureUrl);
    return prepared;
  }

  async function decodeSpriteTexture(url: string): Promise<void> {
    if (options.decodeImage) {
      await options.decodeImage(url);
      return;
    }
    await decodeImage(url);
  }

  function applyPreparedSpriteTexture(sprite: QuakePreparedEffectSprite): void {
    for (const handle of handles) {
      handle.element.style.backgroundImage = cssUrl(sprite.texture.url);
      handle.element.style.backgroundSize = `${sprite.texture.width}px ${sprite.texture.height}px`;
    }
  }

  function syncHandle(handle: EffectSpriteHandle): void {
    const sprite = handle.sprite;
    if (!sprite) return;
    const frame = sprite.frames[handle.frameIndex] ?? sprite.frames[0];
    handle.element.style.width = `${frame.width}px`;
    handle.element.style.height = `${frame.height}px`;
    handle.element.style.backgroundImage = cssUrl(sprite.texture.url);
    handle.element.style.backgroundSize = `${sprite.texture.width}px ${sprite.texture.height}px`;
    handle.element.style.backgroundPosition = `${-frame.x}px ${-frame.y}px`;
    handle.element.dataset.quakeEffectSpriteActive = handle.active ? "true" : "false";
    handle.element.dataset.quakeEffectSpriteFrame = String(frame.index);
    handle.element.dataset.quakeEffectSpriteSource = sprite.sourcePath;
    const projection = effectSpriteProjection(handle.origin, sprite, frame);
    handle.element.style.left = `${projection.x}px`;
    handle.element.style.top = `${projection.y}px`;
    handle.element.style.opacity = handle.active && projection.visible ? "1" : "0";
    handle.element.style.transform = `translate3d(-50%, -50%, 0) scale(${roundCssNumber(projection.scale)})`;
  }

  function effectSpriteProjection(
    origin: Vec3 | null,
    sprite: QuakePreparedEffectSprite,
    frame: QuakePreparedEffectSpriteFrame,
  ): EffectSpriteProjection {
    const viewport = layerViewport();
    if (!origin) {
      return {
        scale: 1,
        visible: true,
        x: viewport.width / 2,
        y: viewport.height / 2,
      };
    }
    const viewOrigin = options.viewOrigin?.();
    const rotation = options.viewRotation?.();
    const perspective = effectSpritePerspectivePx();
    if (!viewOrigin || !rotation || !Number.isFinite(perspective) || perspective <= 0) {
      return {
        scale: 1,
        visible: true,
        x: viewport.width / 2,
        y: viewport.height / 2,
      };
    }
    const axes = viewAxes(rotation.rotX, rotation.rotY);
    const relative: Vec3 = [
      origin[0] - viewOrigin[0],
      origin[1] - viewOrigin[1],
      origin[2] - viewOrigin[2],
    ];
    const depth = dotVec3(relative, axes.forward);
    if (depth <= QUAKE_EFFECT_SPRITE_MIN_DEPTH) {
      return {
        scale: 0,
        visible: false,
        x: viewport.width / 2,
        y: viewport.height / 2,
      };
    }
    const x = dotVec3(relative, axes.right);
    const y = -dotVec3(relative, axes.up);
    const worldWidth = Math.max(1, sprite.header?.maxWidth ?? frame.width) * QUAKE_COLLISION_UNIT_SCALE;
    const scale = clampNumber(
      (perspective * worldWidth) / (depth * Math.max(1, frame.width)),
      QUAKE_EFFECT_SPRITE_MIN_SCALE,
      QUAKE_EFFECT_SPRITE_MAX_SCALE,
    );
    return {
      scale,
      visible: true,
      x: viewport.width / 2 + (x / depth) * perspective,
      y: viewport.height / 2 + (y / depth) * perspective,
    };
  }

  function effectSpritePerspectivePx(): number {
    const value = options.cameraPerspectiveStyle?.() ?? "";
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : layerViewport().width;
  }

  function layerViewport(): { height: number; width: number } {
    return {
      width: options.layer.clientWidth || window.innerWidth || QUAKE_EFFECT_SPRITE_FALLBACK_VIEWPORT_WIDTH,
      height: options.layer.clientHeight || window.innerHeight || QUAKE_EFFECT_SPRITE_FALLBACK_VIEWPORT_HEIGHT,
    };
  }

  function ensureFrame(): void {
    if (frameId !== null) return;
    frameId = requestAnimationFrame(tick);
  }

  function cancelFrame(): void {
    if (frameId === null) return;
    cancelAnimationFrame(frameId);
    frameId = null;
  }

  function tick(at: number): void {
    frameId = null;
    if (disposed || !enabled || options.isGameplayPaused() || !options.canShow()) {
      clear();
      return;
    }
    let activeCount = 0;
    for (const handle of handles) {
      const sprite = handle.sprite;
      if (!handle.active || !sprite) continue;
      const elapsed = at - handle.startedAt;
      const frameIndex = Math.floor(elapsed / sprite.frameDurationMs);
      if (frameIndex >= sprite.frameCount) {
        handle.active = false;
        handle.element.dataset.quakeEffectSpriteActive = "false";
        handle.element.style.opacity = "0";
        continue;
      }
      handle.frameIndex = clampNumber(frameIndex, 0, sprite.frameCount - 1);
      syncHandle(handle);
      activeCount++;
    }
    if (activeCount > 0) ensureFrame();
  }

  return {
    clear,
    dispose,
    preload,
    setEnabled,
    spawnExplosion,
  };
}

function normalizeEffectSpriteManifest(value: unknown): QuakeEffectSpriteManifest | null {
  if (!isRecord(value) || typeof value.explosionSprite !== "string" || !isRecord(value.sprites)) return null;
  const sprites: Record<string, QuakePreparedEffectSprite> = {};
  for (const [path, sprite] of Object.entries(value.sprites)) {
    const prepared = normalizeEffectSprite(sprite);
    if (prepared) sprites[path] = prepared;
  }
  return {
    explosionSprite: value.explosionSprite,
    sprites,
  };
}

function normalizeEffectSprite(value: unknown): QuakePreparedEffectSprite | null {
  if (!isRecord(value) || !isRecord(value.texture) || !Array.isArray(value.frames)) return null;
  if (typeof value.sourcePath !== "string") return null;
  const texture = value.texture;
  const textureUrl = typeof texture.url === "string" ? texture.url : "";
  const textureWidth = typeof texture.width === "number" ? texture.width : 0;
  const textureHeight = typeof texture.height === "number" ? texture.height : 0;
  if (!textureUrl || textureWidth <= 0 || textureHeight <= 0) return null;
  const frames = value.frames.map(normalizeEffectSpriteFrame)
    .filter((frame): frame is QuakePreparedEffectSpriteFrame => frame !== null);
  const frameCount = typeof value.frameCount === "number" ? Math.floor(value.frameCount) : frames.length;
  if (frameCount <= 0 || frames.length < frameCount) return null;
  return {
    frameCount,
    frameDurationMs: typeof value.frameDurationMs === "number" && value.frameDurationMs > 0
      ? value.frameDurationMs
      : 100,
    frames,
    header: isRecord(value.header)
      ? {
        ...(typeof value.header.maxHeight === "number" ? { maxHeight: value.header.maxHeight } : {}),
        ...(typeof value.header.maxWidth === "number" ? { maxWidth: value.header.maxWidth } : {}),
      }
      : undefined,
    sourcePath: value.sourcePath,
    texture: {
      height: textureHeight,
      url: textureUrl,
      width: textureWidth,
    },
  };
}

function normalizeEffectSpriteFrame(value: unknown): QuakePreparedEffectSpriteFrame | null {
  if (!isRecord(value)) return null;
  const index = typeof value.index === "number" ? Math.floor(value.index) : -1;
  const x = typeof value.x === "number" ? value.x : 0;
  const y = typeof value.y === "number" ? value.y : 0;
  const width = typeof value.width === "number" ? value.width : 0;
  const height = typeof value.height === "number" ? value.height : 0;
  if (index < 0 || width <= 0 || height <= 0) return null;
  return { height, index, width, x, y };
}

function resolveEffectSpriteUrl(url: string, manifestUrl: string): string {
  try {
    return new URL(url, new URL(manifestUrl, window.location.href)).toString();
  } catch {
    return url;
  }
}

async function decodeImage(url: string): Promise<void> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error(`Could not load effect sprite texture ${url}.`)), { once: true });
    image.src = url;
  });
  if (typeof image.decode === "function") await image.decode();
}

function viewAxes(rotX: number, rotY: number): { forward: Vec3; right: Vec3; up: Vec3 } {
  const rx = (rotX * Math.PI) / 180;
  const ry = (rotY * Math.PI) / 180;
  const forward = normalizeVec3([
    -Math.sin(rx) * Math.cos(ry),
    -Math.sin(rx) * Math.sin(ry),
    -Math.cos(rx),
  ]);
  const right = normalizeVec3([-Math.sin(ry), Math.cos(ry), 0]);
  return {
    forward,
    right,
    up: normalizeVec3(crossVec3(right, forward)),
  };
}

function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalizeVec3(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= 0.000001) return [0, 0, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundCssNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function cssUrl(url: string): string {
  return `url("${url.replace(/["\\\n\r\f]/g, "\\$&")}")`;
}

function initializeEffectSpriteElement(element: HTMLElement): void {
  element.style.position = "absolute";
  element.style.left = "50%";
  element.style.top = "50%";
  element.style.display = "block";
  element.style.imageRendering = "pixelated";
  element.style.opacity = "0";
  element.style.pointerEvents = "none";
  element.style.backgroundRepeat = "no-repeat";
  element.style.transform = "translate3d(-50%, -50%, 0) scale(1)";
  element.style.transformOrigin = "center";
  element.style.willChange = "transform, opacity";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
