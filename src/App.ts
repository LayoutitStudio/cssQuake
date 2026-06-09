import {
  BASE_TILE,
  createPolyPerspectiveCamera,
  createPolyFirstPersonControls,
  createPolyScene,
  type ParseResult,
  type Polygon,
  type PolyMeshHandle,
  type Vec3,
} from "@layoutit/polycss";
import nipplejs from "nipplejs";
import {
  QUAKE_RENDER_SUPERSAMPLE,
  createQuakeSceneFromPreparedScene,
  type QuakeEntity,
  type QuakePreparedScene,
  type QuakePreparedRenderBundle,
  type QuakeScene,
} from "./prepare/scene";
import {
  quakeGameLogicEntityFact,
  type QuakeGameLogicGeneratedTextFact,
  type QuakeGameLogicTextFact,
} from "./prepare/gameLogicFacts";
import { createQuakeSoundController, type QuakeSoundManifest } from "./runtime/audio";
import { mountQuakeBitmapText } from "./runtime/bitmapText";
import {
  COLLISION_EPSILON,
  GROUND_SNAP,
  PLAYER_RADIUS,
  QUAKE_BUTTON_USE_RANGE,
  QUAKE_COLLISION_UNIT_SCALE,
  STEP_HEIGHT,
} from "./runtime/constants";
import {
  buildQuakeClipCollisionWorld,
  type QuakeCollisionWorld,
  type QuakeTouchedTrigger,
  type QuakeUseTrace,
} from "./runtime/collision";
import { installQuakeDebugHooks, isQuakeDebugHooksEnabled } from "./runtime/debug/quakeDebug";
import { isQuakeDebugDomMetadataEnabled, markQuakeTrace } from "./runtime/debug/traceMarks";
import { quakeDoorGroupKeyRequirement, quakePlayerHasDoorKey, type QuakeDoorKey } from "./runtime/doors";
import {
  quakeEntityNumber,
  shouldSpawnQuakeEntityForCurrentGame,
} from "./runtime/entities";
import {
  activateQuakeInventoryPowerup,
  applyQuakeInventoryDelta,
  clearQuakeInventoryPowerup,
  clearQuakeInventoryPowerups,
  createQuakeHudElements,
  syncQuakeHud as syncQuakeHudElements,
  type QuakeInventoryPowerupBehavior,
} from "./runtime/hud";
import {
  quakeContentsDamage,
  quakeRadsuitProtectedContentsDamage,
  quakeTriggerHurtDamage,
  type QuakeHazardDamage,
} from "./runtime/hazards";
import { distanceSq3, dotVec3, normalizeVec3, subtractVec3 } from "./runtime/math";
import { createQuakeMenuController } from "./runtime/menu";
import {
  createQuakeMoversController,
  quakeButtonIsPressed,
  quakeMoverBlockDamage,
  type QuakeMoverState,
} from "./runtime/movers";
import { createQuakeMonsterStateRunner } from "./runtime/quakeMonsterStateRunner";
import {
  createQuakeShootablesController,
  quakeShootableModelPath,
  quakeShootableFallbackPolygons,
  type QuakeShootablesDebugStats,
} from "./runtime/shootables";
import { createQuakeTargetsController, type QuakeCounterActivationResult } from "./runtime/targets";
import { createQuakeTextController } from "./runtime/text";
import {
  quakeTriggerChangelevelMap,
  quakeTriggerOnlyRegisteredActivation,
  quakeTriggerOneShot,
  quakeTriggerPushActivation,
  quakeTriggerSecretActivation,
  quakeTriggerSetSkillValue,
  quakeTriggerTeleportDestination,
  quakeTriggerWait,
} from "./runtime/triggerEffects";
import { createQuakeTriggersController } from "./runtime/triggers";
import { createQuakeViewmodelController, type QuakeViewmodelModel } from "./runtime/viewmodel";
import { createQuakeWeaponsController } from "./runtime/weapons";
import {
  createQuakeWorldController,
  injectQuakeWorldAnimations,
  quakeCssUrl,
  setQuakeTextureAnimationLeafActive,
  syncQuakeTextureAnimationLeafAnimationClock,
  type QuakeFaceLeaf,
  type QuakeWorldDebugStats,
} from "./runtime/world";
import {
  createQuakePickupController,
  quakeCanPickupForInventory,
  quakePickupMessageForEntity,
  quakePickupModelRenderBundleFrameSet,
  quakePickupModelRenderBundle,
  quakePickupModelPath,
  quakePickupPolygons,
  type QuakePickupModel,
  type QuakePickupModelLibrary,
  type QuakeProgramMetadata,
} from "./runtime/pickups";
import { createQuakePlayerController, type QuakePlayerDamageFeedback } from "./runtime/player";
import {
  mountQuakeRenderBundleFrameSetMesh,
  mountQuakeRenderBundleMesh,
  preloadQuakeRenderBundleAssets,
  syncQuakeRenderBundleDebugOutlineLeaves,
  syncQuakeRenderBundleDebugOutlines,
  stripPolyMeshMetadata,
} from "./runtime/renderBundleMesh";

declare const __CSSQUAKE_VERSION__: string;

const quakeApp = document.getElementById("quake-app") as HTMLElement;
const host = document.getElementById("quake-host") as HTMLElement;
const viewmodelLayer = document.getElementById("quake-viewmodel-layer") as HTMLElement | null;
const mainMenu = document.getElementById("quake-main-menu") as HTMLElement | null;
const mainMenuArt = document.getElementById("quake-main-menu-art") as HTMLElement | null;
const versionLabel = document.getElementById("cssquake-version") as HTMLElement | null;
const mainMenuVersionLabel = document.getElementById("quake-main-menu-version") as HTMLElement | null;
const levelPanel = document.getElementById("quake-level-panel") as HTMLElement | null;
const levelList = document.getElementById("quake-level-list") as HTMLElement | null;
const aboutPanel = document.getElementById("quake-about-panel") as HTMLElement | null;
const optionsPanel = document.getElementById("quake-options-panel") as HTMLElement | null;
const disableSoundOption = document.getElementById("quake-option-disable-sound") as HTMLInputElement | null;
const disableEnemiesOption = document.getElementById("quake-option-disable-enemies") as HTMLInputElement | null;
const disableDamageOption = document.getElementById("quake-option-disable-damage") as HTMLInputElement | null;
const invertMouseOption = document.getElementById("quake-option-invert-mouse") as HTMLInputElement | null;
const debugPanel = document.getElementById("quake-debug-panel") as HTMLElement | null;
const debugPanelClose = document.getElementById("quake-debug-close") as HTMLButtonElement | null;
const debugHideTexturesOption = document.getElementById("quake-debug-hide-textures") as HTMLInputElement | null;
const debugStaticLightingOption = document.getElementById("quake-debug-static-lighting") as HTMLInputElement | null;
const debugFlyModeOption = document.getElementById("quake-debug-fly-mode") as HTMLInputElement | null;
const debugShowOutlinesOption = document.getElementById("quake-debug-show-outlines") as HTMLInputElement | null;
const debugShowLabelsOption = document.getElementById("quake-debug-show-labels") as HTMLInputElement | null;
const debugStatElements = new Map(
  Array.from(document.querySelectorAll<HTMLElement>("[data-quake-debug-stat]"))
    .map((element) => [element.dataset.quakeDebugStat ?? "", element] as const)
    .filter(([key]) => key.length > 0),
);
const loadingOverlay = document.getElementById("quake-loading-overlay") as HTMLElement | null;
const loadingStatus = document.getElementById("quake-loading-status") as HTMLElement | null;
const loadingProgress = document.getElementById("quake-loading-progress") as HTMLElement | null;
const loadingProgressFill = document.getElementById("quake-loading-progress-fill") as HTMLElement | null;
const loadingAction = document.getElementById("quake-loading-action") as HTMLElement | null;
const hudArmorValue = document.getElementById("quake-hud-armor-value") as HTMLElement | null;
const hudHealthValue = document.getElementById("quake-hud-health-value") as HTMLElement | null;
const hudHealthDamageValue = document.getElementById("quake-hud-health-damage-value") as HTMLElement | null;
const hudAmmoValue = document.getElementById("quake-hud-ammo-value") as HTMLElement | null;
const classicHud = document.getElementById("quake-classic-hud") as HTMLElement | null;
const quakeHud = document.getElementById("quake-hud") as HTMLElement | null;
const bonusOverlay = document.getElementById("quake-bonus-overlay") as HTMLElement | null;
const damageOverlay = document.getElementById("quake-damage-overlay") as HTMLElement | null;
const quakeNotify = document.getElementById("quake-notify") as HTMLElement | null;
const quakeCenterPrint = document.getElementById("quake-centerprint") as HTMLElement | null;
const quakeText = createQuakeTextController({
  centerPrintRoot: quakeCenterPrint,
  notifyRoot: quakeNotify,
});
const hudElements = createQuakeHudElements({
  root: classicHud,
  armor: hudArmorValue,
  health: hudHealthValue,
  healthDamage: hudHealthDamageValue,
  ammo: hudAmmoValue,
});
const QUAKE_HUD_DAMAGE_CUE_MS = 900;
let quakeHudDamageTimer: number | null = null;
let quakeHudDamageSerial = 0;
let quakeHudDamageCueActive = false;
const QUAKE_ASSET_ROOT = "/q";
const QUAKE_MANIFEST_URL = `${QUAKE_ASSET_ROOT}/manifest.json`;
const QUAKE_ASSETS_REGENERATING_STATUS = "Assets regenerating";
const QUAKE_ASSETS_REGENERATING_ACTION =
  "Wait for pnpm prepare:quake to finish, then reload.";
const QUAKE_LOADING_PREVIEW_ENABLED = import.meta.env.DEV && new URLSearchParams(window.location.search).has("loading");
const QUAKE_LOADING_READY_MIN_PRESENTED_FRAMES = 6;
const QUAKE_LOADING_READY_STABLE_PRESENTED_FRAMES = 3;

interface QuakeCrosshairTargetCache {
  actionTrace: QuakeUseTrace | null;
  shootableTrace: QuakeUseTrace | null;
  origin: Vec3 | null;
  rotX: number;
  rotY: number;
  mapName: string;
  valid: boolean;
}

interface QuakeMobileMoveStickEvent {
  data: {
    raw?: {
      position?: {
        x: number;
        y: number;
      };
    };
    vector?: {
      x: number;
      y: number;
    };
  };
}

const quakeCrosshairTargetCache: QuakeCrosshairTargetCache = {
  actionTrace: null,
  shootableTrace: null,
  origin: null,
  rotX: 0,
  rotY: 0,
  mapName: "",
  valid: false,
};
let quakeCrosshairTargetSyncFrame = 0;
let quakeAttackInputDown = false;
let quakeAttackPointerId: number | null = null;
let quakeAttackFrame = 0;
let quakePointerLockRetryAt = -Infinity;
let quakeMobileControlsRoot: HTMLElement | null = null;
let quakeMobileMoveZone: HTMLElement | null = null;
let quakeMobileFireButton: HTMLButtonElement | null = null;
let quakeMobileMoveStick: ReturnType<typeof nipplejs.create> | null = null;
let quakeMobileMoveFrame = 0;
let quakeMobileMoveTime = 0;
let quakeMobileMoveX = 0;
let quakeMobileMoveY = 0;
let quakeDebugFlyFrame = 0;
let quakeDebugFlyTime = 0;
let quakeDebugFlyKeyCodesDown = new Set<string>();
let quakeWeaponViewPunchFrame = 0;
let quakeWeaponViewPunchOffset = 0;
let quakeWeaponViewPunchAt = 0;
let quakeWeaponViewPunchBaseRotX: number | null = null;
let quakeBonusFlashTimer: number | null = null;
let quakeBonusFlashSerial = 0;
const QUAKE_LOADING_READY_FRAME_BUDGET_MS = 45;
const QUAKE_LOADING_READY_TIMEOUT_MS = 1500;
const QUAKE_DEATH_UNLOCK_MENU_SUPPRESS_MS = 1000;
const QUAKE_POINTER_LOCK_RETRY_MS = 500;
const QUAKE_MOBILE_CONTROLS_QUERY = "(any-pointer: coarse), (max-width: 960px) and (orientation: landscape)";
const quakeMobileControlsMedia = window.matchMedia(QUAKE_MOBILE_CONTROLS_QUERY);
const QUAKE_WEAPON_VIEW_PUNCH_DEG = 2;
const QUAKE_WEAPON_VIEW_PUNCH_MAX_DEG = 4;
const QUAKE_WEAPON_VIEW_PUNCH_DECAY_MS = 55;
const QUAKE_WEAPON_VIEW_PUNCH_EPSILON_DEG = 0.001;
const QUAKE_WEAPON_VIEW_PUNCH_EXTERNAL_EPSILON_DEG = 0.05;
const QUAKE_CAMERA_ROT_X_MIN = 5;
const QUAKE_CAMERA_ROT_X_MAX = 175;
const QUAKE_CAMERA_STEP_SMOOTH_SPEED = 80 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_CAMERA_STEP_SMOOTH_MAX_OFFSET = 12 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_CAMERA_STEP_SMOOTH_DT_CLAMP = 0.05;
const QUAKE_DAMAGE_VIEW_PITCH_SCALE = 0.035;
const QUAKE_DAMAGE_VIEW_PITCH_MAX_DEG = 2;
const QUAKE_BONUS_FLASH_HOLD_MS = 80;
const QUAKE_URL_VIEW_PART_COUNT = 5;
const QUAKE_URL_NUMBER_SCALE = 1000;
const QUAKE_URL_VIEW_ORIGIN_LIMIT = 100000;
const QUAKE_URL_VIEW_ROT_X_MIN = 0;
const QUAKE_URL_VIEW_ROT_X_MAX = 180;
const QUAKE_URL_VIEW_ROT_Y_LIMIT = 36000;
const QUAKE_URL_PERSPECTIVE_MAX = 20000;
const QUAKE_URL_ZOOM_MAX = 1000;

function quakeCameraPerspectiveFromUrl(): number | null {
  const rawValue = new URLSearchParams(window.location.search).get("perspective");
  if (rawValue === null) return null;
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 && value <= QUAKE_URL_PERSPECTIVE_MAX ? value : null;
}

function quakeCameraZoomFromUrl(): number | null {
  const rawValue = new URLSearchParams(window.location.search).get("zoom");
  if (rawValue === null) return null;
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 && value <= QUAKE_URL_ZOOM_MAX ? value : null;
}

function quakeUrlBoolean(name: string): boolean {
  const rawValue = new URLSearchParams(window.location.search).get(name);
  if (rawValue === null) return false;
  return rawValue === "" || rawValue === "1" || rawValue.toLowerCase() === "true";
}

function quakeReferencePerspectiveForViewport(width: number, height: number, fov: number): number {
  const aspect = width / Math.max(1, height);
  const fovX = 2 * Math.atan(aspect * 0.75 * Math.tan((fov * Math.PI) / 360));
  return width / (2 * Math.tan(fovX / 2));
}

function setQuakeHudDamageCue(active: boolean): void {
  if (quakeHudDamageCueActive === active) return;
  quakeHudDamageCueActive = active;
  markQuakeTrace("hud-damage-cue", { active });
  if (classicHud) {
    if (active) {
      classicHud.classList.add("quake-hud-damage");
    } else {
      classicHud.classList.remove("quake-hud-damage");
    }
  }
}

function setQuakeDamageOverlay(active: boolean): void {
  if (!damageOverlay) return;
  const wasActive = damageOverlay.classList.contains("quake-damage-overlay-active");
  if (wasActive === active) return;
  markQuakeTrace("hud-damage-overlay", { active });
  if (active) {
    damageOverlay.classList.add("quake-damage-overlay-active");
  } else {
    damageOverlay.classList.remove("quake-damage-overlay-active");
  }
}

function flashQuakeBonusOverlay(): void {
  if (!bonusOverlay) return;
  quakeBonusFlashSerial += 1;
  if (quakeBonusFlashTimer !== null) {
    window.clearTimeout(quakeBonusFlashTimer);
    quakeBonusFlashTimer = null;
  }
  bonusOverlay.classList.add("quake-bonus-overlay-active");
  markQuakeTrace("hud-bonus-overlay", { active: true });
  const serial = quakeBonusFlashSerial;
  quakeBonusFlashTimer = window.setTimeout(() => {
    if (serial !== quakeBonusFlashSerial) return;
    quakeBonusFlashTimer = null;
    bonusOverlay.classList.remove("quake-bonus-overlay-active");
    markQuakeTrace("hud-bonus-overlay", { active: false });
  }, QUAKE_BONUS_FLASH_HOLD_MS);
}

function clearQuakeBonusOverlay(): void {
  quakeBonusFlashSerial += 1;
  if (quakeBonusFlashTimer !== null) {
    window.clearTimeout(quakeBonusFlashTimer);
    quakeBonusFlashTimer = null;
  }
  if (!bonusOverlay?.classList.contains("quake-bonus-overlay-active")) return;
  bonusOverlay.classList.remove("quake-bonus-overlay-active");
  markQuakeTrace("hud-bonus-overlay", { active: false });
}

const cssQuakeVersionLabel = `v${__CSSQUAKE_VERSION__}`;

if (versionLabel) versionLabel.textContent = cssQuakeVersionLabel;
if (mainMenuVersionLabel) mainMenuVersionLabel.textContent = cssQuakeVersionLabel;

interface QuakeAssetManifestMap {
  mapName: string;
  title?: string;
  pakPath?: string;
  sceneUrl: string;
  selectable?: boolean;
  modelPaths?: string[];
}

interface QuakeAssetManifest {
  version: number;
  assetRoot?: string;
  startMap: string;
  maps: QuakeAssetManifestMap[];
  assets: {
    weaponModelUrl: string;
    pickupModelsUrl: string;
    programMetadataUrl: string;
    soundManifestUrl?: string;
  };
}

class QuakeAssetsRegeneratingError extends Error {
  constructor(message = QUAKE_ASSETS_REGENERATING_ACTION) {
    super(message);
    this.name = "QuakeAssetsRegeneratingError";
  }
}

interface QuakeLoadingProgressSnapshot {
  completed: number;
  total: number;
  visualProgress?: number;
}

interface QuakeLoadingProgressTracker {
  setStatus(status: string): void;
  startTask(): () => void;
}

interface QuakeLoadingReadinessSnapshot {
  elapsedMs: number;
  frames: number;
  maxFrameMs: number;
  maxIntervalMs: number;
  maxPresentDelayMs: number;
  slowFrames: number;
  stableFrames: number;
  timedOut: boolean;
}

type QuakeUrlUpdateMode = "none" | "push" | "replace";

interface QuakeUrlView {
  origin: [number, number, number];
  rotX: number;
  rotY: number;
}

interface QuakeUrlRoute {
  mapName: string;
  mapParamPresent: boolean;
  view: QuakeUrlView | null;
}

interface QuakeMapLoadOptions {
  loadingStatus?: string;
  urlMode?: QuakeUrlUpdateMode;
  resumeGameplay?: boolean;
  view?: QuakeUrlView | null;
}

interface QuakePointHazard {
  entityIndex: number;
  origin: Vec3;
  radiusSq: number;
  damage: number;
  kind: QuakeHazardDamage["kind"];
  velocity?: Vec3;
  expiresAt?: number;
}

interface QuakeFireballEmitter {
  entityIndex: number;
  origin: Vec3;
  speed: number;
  nextSpawnAt: number;
}

const FALLBACK_QUAKE_ASSET_MANIFEST: QuakeAssetManifest = {
  version: 1,
  assetRoot: QUAKE_ASSET_ROOT,
  startMap: "e1m1",
  maps: [
    {
      mapName: "start",
      title: "Introduction",
      pakPath: "maps/start.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/start.json`,
      selectable: false,
    },
    {
      mapName: "e1m1",
      title: "the Slipgate Complex",
      pakPath: "maps/e1m1.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m1.json`,
      selectable: true,
    },
    {
      mapName: "e1m2",
      title: "Castle of the Damned",
      pakPath: "maps/e1m2.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m2.json`,
      selectable: true,
    },
    {
      mapName: "e1m3",
      title: "the Necropolis",
      pakPath: "maps/e1m3.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m3.json`,
      selectable: true,
    },
    {
      mapName: "e1m4",
      title: "the Grisly Grotto",
      pakPath: "maps/e1m4.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m4.json`,
      selectable: true,
    },
    {
      mapName: "e1m5",
      title: "Gloom Keep",
      pakPath: "maps/e1m5.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m5.json`,
      selectable: true,
    },
    {
      mapName: "e1m6",
      title: "The Door To Chthon",
      pakPath: "maps/e1m6.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m6.json`,
      selectable: true,
    },
    {
      mapName: "e1m7",
      title: "The House of Chthon",
      pakPath: "maps/e1m7.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m7.json`,
      selectable: true,
    },
    {
      mapName: "e1m8",
      title: "Ziggurat Vertigo",
      pakPath: "maps/e1m8.bsp",
      sceneUrl: `${QUAKE_ASSET_ROOT}/e1m8.json`,
      selectable: true,
    },
  ],
  assets: {
    weaponModelUrl: `${QUAKE_ASSET_ROOT}/weapon.json`,
    pickupModelsUrl: `${QUAKE_ASSET_ROOT}/pickups.json`,
    programMetadataUrl: `${QUAKE_ASSET_ROOT}/progs.json`,
    soundManifestUrl: `${QUAKE_ASSET_ROOT}/sounds.json`,
  },
};
const QUAKE_GAMEPLAY_KEY_CODES = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ControlLeft",
  "ControlRight",
  "KeyA",
  "KeyD",
  "KeyS",
  "KeyW",
  "Space",
]);
const QUAKE_MOVE_KEY_CODES = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "KeyA", "KeyD", "KeyS", "KeyW"]);
const QUAKE_CROUCH_KEY_CODES = new Set(["ControlLeft", "ControlRight"]);
const QUAKE_JUMP_VELOCITY = 270 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_GRAVITY = 800 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MOBILE_MOVE_SPEED = 5.4 * QUAKE_RENDER_SUPERSAMPLE;
const QUAKE_MOBILE_MOVE_DEADZONE = 0.08;
const QUAKE_MOBILE_MOVE_DT_CLAMP = 0.035;
const QUAKE_DEBUG_FLY_SPEED = 10.8 * QUAKE_RENDER_SUPERSAMPLE;
const QUAKE_DEBUG_FLY_FAST_MULTIPLIER = 3;
const QUAKE_DEBUG_FLY_DT_CLAMP = 0.05;
const QUAKE_DEFAULT_CAMERA_ZOOM = (BASE_TILE * 0.65) / QUAKE_RENDER_SUPERSAMPLE;
const QUAKE_CAMERA_ZOOM = quakeCameraZoomFromUrl() ?? QUAKE_DEFAULT_CAMERA_ZOOM;
const QUAKE_REFERENCE_FOV = 90;
const QUAKE_CAMERA_PERSPECTIVE_OVERRIDE = quakeCameraPerspectiveFromUrl();
function quakeViewportSize(): { width: number; height: number } {
  const root = document.documentElement;
  const width = window.innerWidth || root.clientWidth || 1;
  const height = window.innerHeight || root.clientHeight || 1;
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

function quakeCameraPerspectiveForViewport(width: number, height: number): number {
  return (
    QUAKE_CAMERA_PERSPECTIVE_OVERRIDE ??
    quakeReferencePerspectiveForViewport(width, height, QUAKE_REFERENCE_FOV) / (QUAKE_CAMERA_ZOOM / BASE_TILE)
  );
}

function quakeViewportCenterCss(value: number): string {
  return Math.round(value) % 2 === 0 ? "50%" : "calc(50% + 0.5px)";
}

const initialQuakeViewportSize = quakeViewportSize();
const QUAKE_CAMERA_PERSPECTIVE = quakeCameraPerspectiveForViewport(
  initialQuakeViewportSize.width,
  initialQuakeViewportSize.height,
);
const QUAKE_MENU_ENABLED = true;
const QUAKE_MONSTER_RUNTIME_ENABLED = true;
const QUAKE_MONSTER_MOUNT_VIEW_DOT_MIN = -0.1;
let quakeAssetManifest = FALLBACK_QUAKE_ASSET_MANIFEST;
let quakeMapUrls = quakeSceneUrlMap(quakeAssetManifest);
let quakeEnemiesDisabled = quakeUrlBoolean("disableEnemies") || (disableEnemiesOption?.checked ?? false);
let quakeDamageDisabled = disableDamageOption?.checked ?? false;
let quakeDebugMode = quakeUrlBoolean("debugPolys");
let quakeDebugHideTextures = debugHideTexturesOption?.checked ?? false;
let quakeDebugStaticLighting = debugStaticLightingOption?.checked ?? false;
let quakeDebugFlyMode = quakeUrlBoolean("debugFly") || (debugFlyModeOption?.checked ?? false);
let quakeDebugFlyModeActive = false;
let quakeDebugShowOutlines = debugShowOutlinesOption?.checked ?? true;
let quakeDebugShowLabels = debugShowLabelsOption?.checked ?? false;
let quakeDebugPanelStatsTimer: number | null = null;
let quakeInvertMouse = invertMouseOption?.checked ?? false;
let quakeCrouchKeyCodesDown = new Set<string>();

function mountQuakeLevelSelector(renderBitmapText = false): void {
  if (!levelList) return;
  levelList.replaceChildren();
  for (const level of quakeSelectableLevels()) {
    const button = document.createElement("button");
    button.className = "quake-level-button";
    button.type = "button";
    button.value = level.mapName;
    button.setAttribute("aria-label", `${level.mapName.toUpperCase()} ${quakeMapTitle(level)}`);

    const code = document.createElement("span");
    code.className = "quake-level-code quake-bm-label quake-bm-alt";
    code.textContent = level.mapName.toUpperCase();

    const title = document.createElement("span");
    title.className = "quake-level-name quake-bm-label";
    title.textContent = quakeMapTitle(level);

    button.append(code, title);
    levelList.append(button);
  }
  if (renderBitmapText) mountQuakeBitmapText(levelList);
}

function quakeSelectableLevels(): QuakeAssetManifestMap[] {
  return quakeAssetManifest.maps.filter((level) => level.selectable !== false);
}

function quakeMapTitle(level: QuakeAssetManifestMap): string {
  return level.title?.trim() || level.mapName.toUpperCase();
}

function quakeSceneUrl(mapName: string): string | undefined {
  return quakeMapUrls.get(mapName);
}

function quakeSceneUrlMap(manifest: QuakeAssetManifest): Map<string, string> {
  return new Map(manifest.maps.map((map) => [map.mapName, map.sceneUrl]));
}

function quakeUrlRouteFromLocation(): QuakeUrlRoute {
  const params = new URLSearchParams(window.location.search);
  const mapName = quakeUrlMapName(params);
  const view = quakeUrlView(params);
  return {
    mapName: mapName ?? quakeAssetManifest.startMap,
    mapParamPresent: params.has("map"),
    view,
  };
}

function quakeUrlRouteIsDirect(route: QuakeUrlRoute): boolean {
  return route.mapParamPresent || route.view !== null;
}

function quakeUrlMapName(params: URLSearchParams): string | null {
  const mapName = params.get("map")?.trim().toLowerCase();
  return mapName && quakeSceneUrl(mapName) ? mapName : null;
}

function quakeUrlView(params: URLSearchParams): QuakeUrlView | null {
  const rawValue = params.get("view");
  if (!rawValue) return null;
  const parts = rawValue.trim().split(/[,_\s]+/).filter(Boolean).map((part) => Number(part));
  if (parts.length !== QUAKE_URL_VIEW_PART_COUNT || parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.slice(0, 3).some((part) => Math.abs(part) > QUAKE_URL_VIEW_ORIGIN_LIMIT)) return null;
  if (parts[3] < QUAKE_URL_VIEW_ROT_X_MIN || parts[3] > QUAKE_URL_VIEW_ROT_X_MAX) return null;
  if (Math.abs(parts[4]) > QUAKE_URL_VIEW_ROT_Y_LIMIT) return null;
  return {
    origin: [parts[0], parts[1], parts[2]],
    rotX: parts[3],
    rotY: normalizeQuakeUrlAngle(parts[4]),
  };
}

function normalizeQuakeUrlAngle(value: number): number {
  return (value % 360 + 360) % 360;
}

function updateQuakeUrl(mapName: string, mode: QuakeUrlUpdateMode, view: QuakeUrlView | null = null): void {
  if (mode === "none") return;
  const url = quakeUrlFor(mapName, view);
  const state = { cssQuake: true, mapName, view };
  if (url.href === window.location.href) {
    window.history.replaceState(state, "", url);
    return;
  }
  if (mode === "replace") {
    window.history.replaceState(state, "", url);
  } else {
    window.history.pushState(state, "", url);
  }
}

function quakeUrlFor(mapName: string, view: QuakeUrlView | null = null): URL {
  const url = new URL(window.location.href);
  url.searchParams.set("map", mapName);
  if (view) {
    url.searchParams.set("view", quakeUrlViewValue(view));
  } else {
    url.searchParams.delete("view");
  }
  return url;
}

function quakeUrlViewValue(view: QuakeUrlView): string {
  return [
    ...view.origin,
    view.rotX,
    view.rotY,
  ].map(formatQuakeUrlNumber).join("_");
}

function formatQuakeUrlNumber(value: number): string {
  const rounded = Math.round(value * QUAKE_URL_NUMBER_SCALE) / QUAKE_URL_NUMBER_SCALE;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function currentQuakeUrlView(): QuakeUrlView {
  const origin = controls.getOrigin();
  return {
    origin: [origin[0], origin[1], origin[2]],
    rotX: scene.camera.state.rotX ?? 88,
    rotY: scene.camera.state.rotY ?? 270,
  };
}

function currentQuakeViewUrl(): string {
  return quakeUrlFor(currentMapName, currentQuakeUrlView()).href;
}

async function copyCurrentQuakeViewUrl(): Promise<string> {
  const url = currentQuakeViewUrl();
  await navigator.clipboard?.writeText(url);
  return url;
}

function setQuakeAssetManifest(manifest: QuakeAssetManifest): void {
  quakeAssetManifest = manifest;
  quakeMapUrls = quakeSceneUrlMap(manifest);
  mountQuakeLevelSelector(true);
  menu.setCurrentLevel(currentMapName);
}

injectQuakeWorldAnimations();
mountQuakeLevelSelector();

const camera = createPolyPerspectiveCamera({
  perspective: QUAKE_CAMERA_PERSPECTIVE,
  zoom: QUAKE_CAMERA_ZOOM,
  rotX: 88,
  rotY: 270,
  target: [0, 0, 1.72],
});
const scene = createPolyScene(host, {
  camera,
  ambientLight: { color: "#ffffff", intensity: Math.PI },
  directionalLight: { direction: [-0.4, -0.55, -0.65], color: "#ffffff", intensity: 0 },
  textureLighting: "baked",
  textureQuality: 1,
  autoCenter: false,
});
const sceneElement = scene.cameraEl.querySelector<HTMLElement>(".polycss-scene");
if (!sceneElement) throw new Error("Quake scene mount requires a PolyCSS scene element.");
sceneElement.removeAttribute("data-polycss-lighting");
function syncQuakeViewportProjection(): void {
  const { width, height } = quakeViewportSize();
  const perspective = quakeCameraPerspectiveForViewport(width, height);
  scene.cameraEl.style.perspective = `${Number(perspective.toFixed(6))}px`;
  const centerX = quakeViewportCenterCss(width);
  const centerY = quakeViewportCenterCss(height);
  scene.cameraEl.style.perspectiveOrigin = `${centerX} ${centerY}`;
  sceneElement.style.left = centerX;
  sceneElement.style.top = centerY;
}
syncQuakeViewportProjection();
const controls = createPolyFirstPersonControls(scene, {
  eyeHeight: 1.72,
  groundZ: 0,
  moveSpeed: QUAKE_MOBILE_MOVE_SPEED,
  lookSensitivity: 0.12,
  invertY: quakeInvertMouse,
  moveEnabled: false,
  jumpEnabled: false,
  crouchEnabled: false,
  jumpVelocity: QUAKE_JUMP_VELOCITY,
  gravity: 0,
});
let quakeCameraRenderOrigin: Vec3 = [0, 0, 1.72];
let quakeCameraStepSmoothFrame = 0;
let quakeCameraStepSmoothAt = 0;
let quakePlayerDead = false;
let quakeDeathUnlockMenuSuppressUntil = 0;

type QuakePickupControllerHandle = ReturnType<typeof createQuakePickupController>;
type QuakePlayerControllerHandle = ReturnType<typeof createQuakePlayerController>;

let pickups: QuakePickupControllerHandle | null = null;
let player: QuakePlayerControllerHandle | null = null;
let weaponViewModelPromise: Promise<QuakeViewmodelModel> | null = null;

function getPickups(): QuakePickupControllerHandle {
  if (!pickups) throw new Error("Quake pickup controller is not initialized.");
  return pickups;
}

function getPlayer(): QuakePlayerControllerHandle {
  if (!player) throw new Error("Quake player controller is not initialized.");
  return player;
}

const world = createQuakeWorldController({
  applyMoverLeafTransform,
  getOrigin: () => controls.getOrigin(),
  sceneElement,
  syncButtonLeafVisual: syncQuakeButtonLeafVisual,
  syncPickupsVisibility: (origin) => getPickups().syncVisibility(origin),
});
const menu = createQuakeMenuController({
  enabled: QUAKE_MENU_ENABLED,
  host,
  controls,
  mainMenu,
  mainMenuArt,
  levelPanel,
  aboutPanel,
  optionsPanel,
  onSelectNewGame: startQuakeNewGame,
  onSelectLevel: loadQuakeMap,
  onSelectDebug: () => setQuakeDebugMode(true),
  shouldResumeMainMenuOnEscape: shouldResumeQuakeMainMenuOnEscape,
  shouldOpenMainMenuOnControlsEnd: shouldOpenQuakeMainMenuOnControlsEnd,
  clearCrosshairTarget: clearQuakeCrosshairTarget,
  syncCrosshairTarget: syncQuakeCrosshairTarget,
});
menu.setCurrentLevel(quakeAssetManifest.startMap);
const audio = createQuakeSoundController();
syncQuakeAudioToggle();
const viewmodel = createQuakeViewmodelController({
  scene,
  controls,
  getRenderOrigin: currentQuakeCameraRenderOrigin,
  host,
  hud: classicHud,
  layer: viewmodelLayer,
});
const shootables = createQuakeShootablesController({
  addMesh: addQuakeShootableMesh,
  createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
  damagePlayer: (amount) => getPlayer().damage(amount),
  floorAt: (x, y, maxZ, minZ) =>
    currentCollisionWorld?.floorAt(x, y, maxZ, minZ) ??
    currentCollisionWorld?.staticFloorAt(x, y, maxZ, minZ) ??
    null,
  getPlayerEyeHeight: () => getPlayer().eyeHeight(),
  getPlayerForward: () => forwardDirection(scene.camera.state.rotX ?? 90, scene.camera.state.rotY ?? 270),
  getPlayerOrigin: () => getPlayer().currentOrigin(),
  hasLineOfSight: quakeLineOfSight,
  isPlayerInvisible: quakePlayerInvisible,
  isInPlayerView: isQuakePointInPlayerView,
  leafIndexAt: world.leafIndexAt,
  monsterRuntimeEnabled: () => QUAKE_MONSTER_RUNTIME_ENABLED && !quakeEnemiesDisabled,
  pointToPoly: quakePointToPoly,
  shouldSpawn: shouldSpawnQuakeEntityForCurrentGame,
  pixelate: world.pixelate,
  schedulePresentationResync: world.schedulePresentationResync,
  visibleLeavesAt: world.visibleLeavesAt,
  fireTarget: fireQuakeTarget,
  playSound: (soundPath, options) => audio.playSound(soundPath, options),
});
const targetSystem = createQuakeTargetsController({
  activateEntity: activateQuakeEntity,
  onCounterStateChange: showQuakeCounterGeneratedText,
  onUseTargetsMessage: showQuakeUseTargetsMessageText,
});
const movers = createQuakeMoversController({
  applyState: applyMoverState,
  fireTarget: fireQuakeTarget,
  groupUnlocked: quakeMoverGroupUnlocked,
  playerBlocks: moverBlockedByPlayer,
});
const triggerSystem = createQuakeTriggersController({
  activateCounter: targetSystem.activateCounter,
  activateEntity: activateQuakeEntity,
  activateTeleport: activateQuakeTeleport,
  completeLevel: completeQuakeLevel,
  disableEntity: targetSystem.disableEntity,
  getEntity: (entityIndex) => entityByIndex.get(entityIndex),
  getOrigin: () => controls.getOrigin(),
  getTouchedTriggers: currentQuakeTouchedTriggers,
  isEntityDisabled: targetSystem.isDisabled,
  isOneShotTrigger: quakeRuntimeTriggerOneShot,
  onActiveKeyChange: syncQuakeActiveTriggerDataset,
  triggerSpecial: activateQuakeSpecialTrigger,
  triggerWait: quakeRuntimeTriggerWait,
  transitionSerial: () => quakeTransitionSerial,
  useTargets: targetSystem.useTargets,
});
pickups = createQuakePickupController({
  addMesh: addQuakePickupMesh,
  applyEffect: (effect, entity) => {
    applyQuakeInventoryDelta(getPlayer().inventory(), effect);
    syncQuakeHud();
    flashQuakeBonusOverlay();
    const gameLogic = currentResult?.gameLogic ?? null;
    const pickupMessage = quakePickupMessageForEntity(entity, gameLogic);
    if (pickupMessage) showQuakeNotifyText(pickupMessage);
    audio.playPickup(entity, gameLogic);
  },
  canPickup: (effect, entity) =>
    quakeCanPickupForInventory(entity, getPlayer().inventory(), currentResult?.gameLogic ?? null, effect),
  leafIndexAt: world.leafIndexAt,
  playerForward: () => forwardDirection(scene.camera.state.rotX ?? 90, scene.camera.state.rotY ?? 270),
  playerViewDot: quakePlayerViewDot,
  pointToPoly: quakePointToPoly,
  gameLogic: () => currentResult?.gameLogic ?? null,
  programMetadata: () => currentProgramMetadata,
  shouldSpawn: shouldSpawnQuakeEntityForCurrentGame,
  startMegahealthRot: startQuakeMegahealthRot,
  startPowerup: startQuakePowerup,
  useTargets: targetSystem.useTargets,
  visibleLeavesAt: world.visibleLeavesAt,
});
const weapons = createQuakeWeaponsController({
  scene,
  controls,
  canUseGameplayInput: canUseQuakeGameplayInput,
  hasViewmodel: viewmodel.hasWeapon,
  getCollisionWorld: () => currentCollisionWorld,
  getEntities: () => entityByIndex,
  getShootables: shootables.weaponTargets,
  getShells: () => getPlayer().inventory().shells,
  consumeShell: () => {
    const inventory = getPlayer().inventory();
    inventory.shells = Math.max(0, inventory.shells - 1);
  },
  syncHud: syncQuakeHud,
  playFireSound: () => audio.playEvent("weaponShotgun", { volume: 0.74 }),
  playFireAnimation: playQuakeWeaponFireFeedback,
  damageShootable: shootables.damage,
  damageBrushEntity: damageQuakeBrushEntity,
  damageMultiplier: quakeWeaponDamageMultiplier,
  onHit: flashQuakeCrosshairHit,
  syncCrosshairTarget: queueQuakeCrosshairTargetSync,
});
player = createQuakePlayerController({
  activateSolidTouch,
  canUseGameplayInput: canUseQuakeGameplayInput,
  canTakeDamage: () => !quakeDamageDisabled && !quakePlayerDead,
  controls,
  getYaw: () => scene.camera.state.rotY ?? 270,
  getCollisionWorld: () => currentCollisionWorld,
  getCurrentScene: () => currentResult,
  gravity: QUAKE_GRAVITY,
  isInvulnerable: quakePlayerInvulnerable,
  jumpVelocity: QUAKE_JUMP_VELOCITY,
  onDamageFlash: (active, feedback) => {
    if (!active) {
      if (!quakePlayerDead) {
        setQuakeDamageOverlay(false);
        if (quakeHudDamageTimer === null) setQuakeHudDamageCue(false);
      }
      return;
    }
    setQuakeDamageOverlay(true);
    playQuakeDamageViewFeedback(feedback);
    const damageCueActive = quakeHudDamageTimer !== null;
    if (quakeHudDamageTimer !== null) window.clearTimeout(quakeHudDamageTimer);
    const serial = ++quakeHudDamageSerial;
    if (!damageCueActive) setQuakeHudDamageCue(true);
    quakeHudDamageTimer = window.setTimeout(() => {
      if (serial !== quakeHudDamageSerial) return;
      setQuakeHudDamageCue(false);
      quakeHudDamageTimer = null;
    }, QUAKE_HUD_DAMAGE_CUE_MS);
    audio.playEvent("pain", { volume: 0.58 });
  },
  onDeath: showQuakePlayerDeath,
  onHazardState: () => undefined,
  onInventoryChanged: syncQuakeHud,
  onRespawn: (result, previousOrigin) => {
    clearQuakePlayerDeath();
    triggerSystem.resetActive();
    const runtime = result.entityManifest.runtime;
    shootables.spawn(quakeEntitiesForIndexes(runtime.shootableEntityIndexes), currentPickupModelLibrary, currentProgramMetadata);
    getPickups().spawn(quakeEntitiesForIndexes(runtime.pickupEntityIndexes), currentPickupModelLibrary, previousOrigin);
  },
  pointToPoly: quakePointToPoly,
  resolveShootablesCollision: shootables.resolvePlayerCollision,
  syncCrosshairTarget: syncQuakeCrosshairTarget,
  syncCamera: syncQuakeCameraOrigin,
  syncHazards: syncQuakeHazards,
  syncPickups: (origin, eyeHeight) => getPickups().syncCollision(origin, eyeHeight, STEP_HEIGHT),
  syncTouchedTriggers,
  syncViewmodel: () => viewmodel.syncTransform(),
  syncWorldVisibility: (force) => {
    world.syncVisibility(force);
    shootables.syncVisibility(controls.getOrigin(), force);
  },
  transitionSerial: () => quakeTransitionSerial,
});

let currentPickupModelLibrary: QuakePickupModelLibrary | null = null;
let currentProgramMetadata: QuakeProgramMetadata | null = null;
let currentCollisionWorld: QuakeCollisionWorld | null = null;
let currentResult: QuakeScene | null = null;
let quakeGameplayStarted = false;
let entityByIndex = new Map<number, QuakeEntity>();
let quakeDamageableBrushHealth = new Map<number, number>();
let quakeDamageableBrushResetTimers: number[] = [];
let quakeMoverCrushDamageAt = new Map<number, number>();
let quakeMoverSoundModes = new Map<number, QuakeMoverState["mode"]>();
let quakePointHazards: QuakePointHazard[] = [];
let quakeFireballEmitters: QuakeFireballEmitter[] = [];
let quakePointHazardFrame: number | null = null;
let quakePointHazardTime = 0;
let quakeCrosshairHitTimer: number | null = null;
let quakeMegahealthRotTimer: number | null = null;
let quakePowerupTimers = new Map<string, number>();
let quakeDoorMessageCooldownUntil = new Map<number, number>();
let quakeSkill = 1;
let quakeModelPivot = { x: 0, y: 0, z: 0 };
let quakeLevelLoadTimer: number | null = null;
let quakeTransitionSerial = 0;
let currentMapName = quakeAssetManifest.startMap;
let quakeAppDisposed = false;
let quakeAppLoading = true;
let quakeDebugCollisionBypassUntil = 0;
let disposeStatsOverlay: (() => void) | null = null;
let quakeSoundManifestPromise: Promise<void> | null = null;

interface QuakeStatsPanel {
  value: HTMLElement;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  history: number[];
  max: number;
  label: string;
  fg: string;
}

const FPS_SAMPLE_MS = 1000;
const MS_SAMPLE_MS = 500;
const QUAKE_DEBUG_PANEL_STATS_MS = 250;
const STATS_GRAPH_COLUMNS = 40;
const STATS_GRAPH_COLUMN_WIDTH = 2;
const STATS_GRAPH_WIDTH = STATS_GRAPH_COLUMNS * STATS_GRAPH_COLUMN_WIDTH;
const STATS_GRAPH_HEIGHT = 30;
const STATS_OVERLAY_BACKGROUND = "#050302";
const STATS_GRAPH_BACKGROUND = "#050302";
const STATS_FPS_FOREGROUND = "#9a4a24";
const STATS_FPS_BACKGROUND = "#100604";
const STATS_MS_FOREGROUND = "#a98c3f";
const STATS_MS_BACKGROUND = "#100803";
const QUAKE_HAZARD_FOOT_SAMPLE_Z = 2 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_CHANGELEVEL_DELAY_MS = 850;
const QUAKE_CENTERPRINT_MS = 2600;
const QUAKE_NOTIFY_TEXT_MS = 3000;
const QUAKE_DOOR_MESSAGE_COOLDOWN_MS = 2000;
const QUAKE_PLAYER_DEFAULT_MAX_HEALTH = 100;
const QUAKE_MEGAHEALTH_ROT_INTERVAL_MS = 1000;
const QUAKE_SHAREWARE_REGISTERED = false;
const QUAKE_FIREBALL_RADIUS = 56 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_FIREBALL_DEFAULT_SPEED = 1000;
const QUAKE_FIREBALL_DAMAGE = 20;
const QUAKE_FIREBALL_LIFETIME_MS = 5000;
const QUAKE_FIREBALL_INITIAL_DELAY_MS = 5000;
const QUAKE_FIREBALL_MIN_WAIT_MS = 3000;
const QUAKE_FIREBALL_WAIT_JITTER_MS = 5000;
const QUAKE_FIREBALL_DRIFT_SPEED = 50 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_FIREBALL_SPEED_JITTER = 200 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_POINT_HAZARD_DT_CLAMP = 0.05;
const QUAKE_TRAP_SPIKE_RANGE = 2048 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_TRAP_SPIKE_RADIUS = 36 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_TRAP_SPIKE_DAMAGE = 10;
const QUAKE_QUAD_DAMAGE_MULTIPLIER = 4;
function makeParseResult(polygons: Polygon[]): ParseResult {
  return { polygons, objectUrls: [], warnings: [], dispose: () => undefined };
}

function syncQuakeHud(): void {
  const inventory = getPlayer().inventory();
  markQuakeTrace("hud-sync", {
    health: inventory.health,
    armor: inventory.armor,
    itemFlags: inventory.itemFlags,
    powerups: Object.keys(inventory.powerups),
    shells: inventory.shells,
  });
  syncQuakeHudElements(hudElements, inventory);
}

function startQuakeMegahealthRot(entity: QuakeEntity, delaySeconds: number): void {
  clearQuakeMegahealthRot();
  if (!Number.isFinite(delaySeconds) || delaySeconds < 0) return;
  markQuakeTrace("pickup-megahealth-rot-start", { entityIndex: entity.index, delaySeconds });
  quakeMegahealthRotTimer = window.setTimeout(runQuakeMegahealthRot, delaySeconds * 1000);
}

function runQuakeMegahealthRot(): void {
  quakeMegahealthRotTimer = null;
  if (quakeAppDisposed || !currentResult || quakePlayerDead) return;
  const inventory = getPlayer().inventory();
  if (inventory.health <= QUAKE_PLAYER_DEFAULT_MAX_HEALTH) return;
  inventory.health = Math.max(QUAKE_PLAYER_DEFAULT_MAX_HEALTH, inventory.health - 1);
  markQuakeTrace("pickup-megahealth-rot", { health: inventory.health });
  syncQuakeHud();
  if (inventory.health > QUAKE_PLAYER_DEFAULT_MAX_HEALTH) {
    quakeMegahealthRotTimer = window.setTimeout(runQuakeMegahealthRot, QUAKE_MEGAHEALTH_ROT_INTERVAL_MS);
  }
}

function clearQuakeMegahealthRot(): void {
  if (quakeMegahealthRotTimer === null) return;
  window.clearTimeout(quakeMegahealthRotTimer);
  quakeMegahealthRotTimer = null;
}

function startQuakePowerup(entity: QuakeEntity, powerup: QuakeInventoryPowerupBehavior): void {
  const now = performance.now();
  clearQuakePowerupTimer(powerup.finishedField);
  const state = activateQuakeInventoryPowerup(getPlayer().inventory(), powerup, now);
  if (!state) return;
  const timeoutMs = Math.max(0, state.finishedAt - now);
  quakePowerupTimers.set(
    powerup.finishedField,
    window.setTimeout(() => finishQuakePowerup(powerup.finishedField, "timer"), timeoutMs),
  );
  markQuakeTrace("pickup-powerup-start", {
    activationField: powerup.activationField,
    durationSeconds: powerup.durationSeconds,
    entityIndex: entity.index,
    finishedField: powerup.finishedField,
    itemFlag: powerup.itemFlag,
    itemFlagExpression: powerup.itemFlagExpression,
  });
  syncQuakeHud();
}

function finishQuakePowerup(finishedField: string, reason: string): void {
  clearQuakePowerupTimer(finishedField);
  if (!player) return;
  const state = clearQuakeInventoryPowerup(player.inventory(), finishedField);
  if (!state) return;
  markQuakeTrace("pickup-powerup-end", {
    activationField: state.activationField,
    finishedField,
    itemFlag: state.itemFlag,
    itemFlagExpression: state.itemFlagExpression,
    reason,
  });
  syncQuakeHud();
}

function clearQuakePowerupTimer(finishedField: string): void {
  const timer = quakePowerupTimers.get(finishedField);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  quakePowerupTimers.delete(finishedField);
}

function clearQuakePowerups(): void {
  for (const timer of quakePowerupTimers.values()) window.clearTimeout(timer);
  quakePowerupTimers = new Map();
  if (!player) return;
  const inventory = player.inventory();
  const hadPowerups = inventory.itemFlags !== 0 || Object.keys(inventory.powerups).length > 0;
  clearQuakeInventoryPowerups(inventory);
  if (hadPowerups) syncQuakeHud();
}

function quakePowerupActive(finishedField: string): boolean {
  if (!player) return false;
  const state = player.inventory().powerups[finishedField];
  if (!state) return false;
  if (state.finishedAt > performance.now()) return true;
  finishQuakePowerup(finishedField, "expired");
  return false;
}

function quakeWeaponDamageMultiplier(): number {
  return quakePowerupActive("super_damage_finished") ? QUAKE_QUAD_DAMAGE_MULTIPLIER : 1;
}

function quakePlayerInvulnerable(): boolean {
  return quakePowerupActive("invincible_finished");
}

function quakePlayerInvisible(): boolean {
  return quakePowerupActive("invisible_finished");
}

function setQuakeAudioMuted(muted: boolean): void {
  audio.setMuted(muted);
  syncQuakeAudioToggle();
  if (!muted) void ensureQuakeSoundManifestLoaded();
}

function toggleQuakeAudioMuted(): void {
  setQuakeAudioMuted(!audio.isMuted());
}

function syncQuakeAudioToggle(): void {
  const muted = audio.isMuted();
  if (disableSoundOption) disableSoundOption.checked = muted;
}

function setQuakeEnemiesDisabled(disabled: boolean): void {
  quakeEnemiesDisabled = disabled;
  if (disableEnemiesOption) disableEnemiesOption.checked = disabled;
  shootables.syncMonsterRuntime();
}

function setQuakeDamageDisabled(disabled: boolean): void {
  quakeDamageDisabled = disabled;
  if (disableDamageOption) disableDamageOption.checked = disabled;
}

function setQuakeDebugMode(enabled: boolean): void {
  quakeDebugMode = enabled;
  syncQuakeDebugRenderOptions();
  syncQuakeDebugFlyMode();
  syncQuakeDebugPanelVisibility();
  syncQuakeDebugPointerLockState();
}

function setQuakeDebugHideTextures(enabled: boolean): void {
  quakeDebugHideTextures = enabled;
  if (debugHideTexturesOption) debugHideTexturesOption.checked = enabled;
  syncQuakeDebugRenderOptions();
}

function setQuakeDebugStaticLighting(enabled: boolean): void {
  quakeDebugStaticLighting = enabled;
  if (debugStaticLightingOption) debugStaticLightingOption.checked = enabled;
  syncQuakeDebugRenderOptions();
}

function setQuakeDebugFlyMode(enabled: boolean): void {
  quakeDebugFlyMode = enabled;
  syncQuakeDebugFlyMode();
}

function setQuakeDebugShowOutlines(enabled: boolean): void {
  quakeDebugShowOutlines = enabled;
  syncQuakeDebugRenderOptions();
}

function setQuakeDebugShowLabels(enabled: boolean): void {
  quakeDebugShowLabels = enabled;
  if (debugShowLabelsOption) debugShowLabelsOption.checked = enabled;
  syncQuakeDebugRenderOptions();
}

function syncQuakeDebugRenderOptions(): void {
  const effectiveShowOutlines = quakeDebugEffectiveShowOutlines();
  if (debugHideTexturesOption) debugHideTexturesOption.checked = quakeDebugHideTextures;
  if (debugStaticLightingOption) debugStaticLightingOption.checked = quakeDebugStaticLighting;
  if (debugShowOutlinesOption) {
    debugShowOutlinesOption.checked = effectiveShowOutlines;
    debugShowOutlinesOption.disabled = quakeDebugHideTextures;
  }
  if (debugShowLabelsOption) debugShowLabelsOption.checked = quakeDebugShowLabels;
  syncQuakeRenderBundleDebugOutlines(quakeDebugMode && effectiveShowOutlines, {
    hideTextures: quakeDebugHideTextures,
  });
  document.body.classList.remove("quake-poly-debug");
  document.body.classList.toggle("quake-debug-no-textures", quakeDebugMode && quakeDebugHideTextures);
  document.body.classList.toggle("quake-debug-static-lighting", quakeDebugMode && quakeDebugStaticLighting);
  document.body.classList.toggle("quake-debug-outlines", quakeDebugMode && effectiveShowOutlines);
  document.body.classList.toggle("quake-debug-labels", quakeDebugMode && quakeDebugShowLabels);
}

function quakeDebugEffectiveShowOutlines(): boolean {
  return quakeDebugShowOutlines || quakeDebugHideTextures;
}

function syncQuakeDebugFlyMode(): void {
  if (debugFlyModeOption) debugFlyModeOption.checked = quakeDebugFlyMode;
  const requested = quakeDebugMode && quakeDebugFlyMode;
  const wasActive = quakeDebugFlyModeActive;
  quakeDebugFlyModeActive = requested;
  document.body.classList.toggle("quake-debug-fly", requested);
  if (requested) {
    clearQuakeMoveInput();
    clearQuakeCrouchInput();
    controls.update({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, gravity: 0 });
    scheduleQuakeDebugFlyFrame();
    return;
  }

  clearQuakeDebugFlyInput();
  if (wasActive) respawnQuakePlayerFromFlyMode();
  if (canUseQuakeGameplayInput()) {
    controls.update({
      moveEnabled: false,
      jumpEnabled: false,
      crouchEnabled: false,
      jumpVelocity: QUAKE_JUMP_VELOCITY,
      gravity: 0,
    });
  } else {
    controls.update({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, jumpVelocity: QUAKE_JUMP_VELOCITY, gravity: 0 });
  }
}

function respawnQuakePlayerFromFlyMode(): boolean {
  if (!currentResult || quakeAppLoading) return false;
  clearQuakeMegahealthRot();
  getPlayer().respawn();
  return true;
}

function syncQuakeDebugPointerLockState(): void {
  document.body.classList.toggle("quake-debug-pointer-free", quakeDebugMode && document.pointerLockElement !== host);
}

function syncQuakeDebugPanelVisibility(): void {
  if (!debugPanel) return;
  debugPanel.hidden = !quakeDebugMode;
  if (quakeDebugMode) {
    menu.hideMainMenu();
    syncQuakeDebugPanelStats();
    startQuakeDebugPanelStats();
    return;
  }
  stopQuakeDebugPanelStats();
}

function startQuakeDebugPanelStats(): void {
  if (quakeDebugPanelStatsTimer !== null) return;
  quakeDebugPanelStatsTimer = window.setInterval(syncQuakeDebugPanelStats, QUAKE_DEBUG_PANEL_STATS_MS);
}

function stopQuakeDebugPanelStats(): void {
  if (quakeDebugPanelStatsTimer === null) return;
  window.clearInterval(quakeDebugPanelStatsTimer);
  quakeDebugPanelStatsTimer = null;
}

function syncQuakeDebugPanelStats(): void {
  if (!quakeDebugMode || !debugPanel || debugPanel.hidden) return;
  const worldStats = world.debugStats();
  const shootableStats = shootables.debugStats();
  const origin = controls.getOrigin();
  const rotX = scene.camera.state.rotX ?? 90;
  const rotY = scene.camera.state.rotY ?? 270;
  const pickupMeshes = Array.from(document.querySelectorAll<HTMLElement>(".polycss-mesh.pickup"));
  const activePickupMeshes = pickupMeshes.filter((element) => !element.hidden);

  setQuakeDebugStat("map", `${currentMapName.toUpperCase()} leaf ${debugStatValue(worldStats.currentLeafIndex)}`);
  setQuakeDebugStat("pose", `${quakeDebugVec3(origin)} | ${rotX.toFixed(1)}/${rotY.toFixed(1)}`);
  setQuakeDebugStat(
    "visible",
    `${debugStatValue(worldStats.visibleLeafCount)} leaves, ${debugStatValue(worldStats.pvsFaceCount)} faces`,
  );
  setQuakeDebugStat("dom", quakeDebugDomLabel(worldStats));
  setQuakeDebugStat("enemies", quakeDebugEnemiesLabel(shootableStats));
  setQuakeDebugStat("pickups", `${activePickupMeshes.length}/${pickupMeshes.length} visible`);
}

function quakeDebugDomLabel(stats: QuakeWorldDebugStats): string {
  return `${stats.mountedLeaves}/${stats.totalLeaves} leaves`;
}

function quakeDebugEnemiesLabel(stats: QuakeShootablesDebugStats): string {
  const parts = [
    `${stats.liveEnemyShootables}/${stats.enemyShootables} live`,
    `${stats.visibleEnemyShootables} vis`,
  ];
  const queue = stats.prewarmQueue + stats.animationFramePrewarmQueue;
  if (queue > 0) {
    parts.push(`${queue} queued`);
  } else if (stats.prewarmedEnemyShootables > 0) {
    parts.push(`${stats.prewarmedEnemyShootables} warm`);
  }
  const churn = stats.visibilityChurn;
  const visibleChange = churn.lastVisibleShootablesAdded + churn.lastVisibleShootablesRemoved;
  if (visibleChange > 0) parts.push(`last +${churn.lastVisibleShootablesAdded}/-${churn.lastVisibleShootablesRemoved}`);
  return parts.join(", ");
}

function quakeDebugVec3(value: Vec3): string {
  return value.map((component) => component.toFixed(1)).join(", ");
}

function setQuakeDebugStat(name: string, value: string): void {
  const element = debugStatElements.get(name);
  if (element) element.textContent = value;
}

function debugStatValue(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "-";
}

function setQuakeInvertMouse(invert: boolean): void {
  quakeInvertMouse = invert;
  if (invertMouseOption) invertMouseOption.checked = invert;
  controls.update({ invertY: invert });
}

function syncQuakeOptionControls(): void {
  syncQuakeAudioToggle();
  if (disableEnemiesOption) disableEnemiesOption.checked = quakeEnemiesDisabled;
  if (disableDamageOption) disableDamageOption.checked = quakeDamageDisabled;
  setQuakeDebugMode(quakeDebugMode);
  syncQuakeDebugRenderOptions();
  syncQuakeDebugFlyMode();
  if (invertMouseOption) invertMouseOption.checked = quakeInvertMouse;
}

function clearQuakeLevelLoadTimer(): void {
  if (quakeLevelLoadTimer !== null) {
    window.clearTimeout(quakeLevelLoadTimer);
    quakeLevelLoadTimer = null;
  }
}

function clearQuakeLevelComplete(): void {
  clearQuakeAttackInput();
  clearQuakeDebugFlyInput();
  clearQuakeMoveInput();
  clearQuakeWeaponViewPunch();
  document.body.classList.remove("quake-level-complete");
  clearQuakeCenterPrint();
  controls.update({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, jumpVelocity: QUAKE_JUMP_VELOCITY, gravity: 0 });
}

function flashQuakeCrosshairHit(): void {
  if (quakeCrosshairHitTimer !== null) {
    window.clearTimeout(quakeCrosshairHitTimer);
    quakeCrosshairHitTimer = null;
  }
  document.body.classList.add("quake-crosshair-hit");
  quakeCrosshairHitTimer = window.setTimeout(clearQuakeCrosshairHit, 110);
}

function clearQuakeCrosshairHit(): void {
  if (quakeCrosshairHitTimer !== null) {
    window.clearTimeout(quakeCrosshairHitTimer);
    quakeCrosshairHitTimer = null;
  }
  document.body.classList.remove("quake-crosshair-hit");
}

function showQuakeNotifyText(message: string, duration = QUAKE_NOTIFY_TEXT_MS): void {
  const text = message.trim();
  if (!text || !quakeHud || quakePlayerDead) return;
  quakeText.notify(text, { durationMs: duration });
}

function showQuakeCenterPrint(message: string, duration = QUAKE_CENTERPRINT_MS): void {
  const text = message.trim();
  if (!text || !quakeHud || quakePlayerDead) return;
  quakeText.centerPrint(text, { durationMs: duration });
}

function showQuakeUseTargetsMessageText(_entity: QuakeEntity, text: QuakeGameLogicTextFact): void {
  if (text.lane !== "centerprint" || text.sourceCall !== "SUB_UseTargets") return;
  showQuakeCenterPrint(text.text);
}

function showQuakeDirectCenterPrintMessageText(entity: QuakeEntity): boolean {
  const text = quakeGameLogicEntityFact(currentResult?.gameLogic, entity.index)?.resolvedTrigger?.messageText;
  if (text?.lane !== "centerprint" || text.sourceCall !== "centerprint") return false;
  showQuakeCenterPrint(text.text);
  return true;
}

function showQuakeCounterGeneratedText(entity: QuakeEntity, result: QuakeCounterActivationResult): void {
  const reason = result.completed ? "counter-complete" : "counter-remaining";
  const text = quakeGeneratedCenterPrintTextForEntityIndexes(
    [entity.index],
    reason,
    (fact) => quakeCounterGeneratedTextMatches(fact, result),
  );
  if (text) showQuakeCenterPrint(text);
}

function quakeCounterGeneratedTextMatches(
  fact: QuakeGameLogicGeneratedTextFact,
  result: QuakeCounterActivationResult,
): boolean {
  const condition = fact.condition;
  if (condition?.remaining !== undefined) return condition.remaining === result.remaining;
  if (condition?.minRemaining !== undefined) return result.remaining >= condition.minRemaining;
  return true;
}

function quakeGeneratedCenterPrintTextForEntityIndexes(
  entityIndexes: readonly number[],
  reason: QuakeGameLogicGeneratedTextFact["reason"],
  matches: (fact: QuakeGameLogicGeneratedTextFact) => boolean,
): string | null {
  if (!currentResult?.gameLogic) return null;
  const seen = new Set<number>();
  for (const entityIndex of entityIndexes) {
    if (seen.has(entityIndex)) continue;
    seen.add(entityIndex);
    const entityFact = quakeGameLogicEntityFact(currentResult.gameLogic, entityIndex);
    const moverText = quakeGeneratedCenterPrintText(entityFact?.resolvedMover?.generatedText, reason, matches);
    if (moverText) return moverText;
    const triggerText = quakeGeneratedCenterPrintText(entityFact?.resolvedTrigger?.generatedText, reason, matches);
    if (triggerText) return triggerText;
  }
  return null;
}

function quakeGeneratedCenterPrintText(
  facts: readonly QuakeGameLogicGeneratedTextFact[] | undefined,
  reason: QuakeGameLogicGeneratedTextFact["reason"],
  matches: (fact: QuakeGameLogicGeneratedTextFact) => boolean,
): string | null {
  for (const fact of facts ?? []) {
    if (fact.lane === "centerprint" && fact.reason === reason && matches(fact)) return fact.text;
  }
  return null;
}

function setQuakeCenterPrint(text: string): void {
  if (!text.trim() || !quakeHud) return;
  quakeText.setCenterPrint(text);
}

function clearQuakeCenterPrint(): void {
  quakeText.clearCenterPrint();
}

function suppressQuakeMainMenuOnNextControlsEnd(): void {
  quakeDeathUnlockMenuSuppressUntil = performance.now() + QUAKE_DEATH_UNLOCK_MENU_SUPPRESS_MS;
}

function clearQuakeMainMenuControlsEndSuppression(): void {
  quakeDeathUnlockMenuSuppressUntil = 0;
}

function shouldOpenQuakeMainMenuOnControlsEnd(): boolean {
  if (quakeDebugMode) return false;
  if (quakeAppLoading || isQuakeLevelTransitionActive()) return false;
  if (quakeDeathUnlockMenuSuppressUntil > 0) {
    const suppress = performance.now() <= quakeDeathUnlockMenuSuppressUntil;
    quakeDeathUnlockMenuSuppressUntil = 0;
    if (suppress) return false;
  }
  return !quakePlayerDead;
}

function showQuakePlayerDeath(): void {
  if (quakePlayerDead) return;
  quakePlayerDead = true;
  clearQuakeMegahealthRot();
  clearQuakePowerups();
  clearQuakeMoveInput();
  clearQuakeAttackInput();
  clearQuakeDebugFlyInput();
  clearQuakeMobileMoveInput();
  clearQuakeWeaponViewPunch();
  clearQuakeBonusOverlay();
  markQuakeTrace("hud-death", { active: true });
  quakeText.clear();
  clearQuakeCrosshairHit();
  clearQuakeCrosshairTarget();
  viewmodel.clearFireAnimation();
  if (quakeHudDamageTimer !== null) {
    window.clearTimeout(quakeHudDamageTimer);
    quakeHudDamageTimer = null;
  }
  quakeHudDamageSerial += 1;
  document.body.classList.add("quake-dead");
  showQuakeDeathOverlay();
  setQuakeDamageOverlay(true);
  setQuakeHudDamageCue(true);
  controls.update({ lookEnabled: false, moveEnabled: false, jumpEnabled: false, gravity: 0 });
  suppressQuakeMainMenuOnNextControlsEnd();
  controls.unlock();
}

function clearQuakePlayerDeath(): void {
  if (!quakePlayerDead && !document.body.classList.contains("quake-dead") && !loadingOverlay?.classList.contains("quake-loading-death")) return;
  quakePlayerDead = false;
  markQuakeTrace("hud-death", { active: false });
  if (quakeHudDamageTimer !== null) {
    window.clearTimeout(quakeHudDamageTimer);
    quakeHudDamageTimer = null;
  }
  quakeHudDamageSerial += 1;
  document.body.classList.remove("quake-dead");
  clearQuakeDeathOverlay();
  setQuakeHudDamageCue(false);
  setQuakeDamageOverlay(false);
  controls.update({ lookEnabled: true, moveEnabled: false, jumpEnabled: false, crouchEnabled: false, jumpVelocity: QUAKE_JUMP_VELOCITY, gravity: 0 });
}

function showQuakeDeathOverlay(): void {
  if (!loadingOverlay) return;
  loadingOverlay.hidden = false;
  loadingOverlay.classList.add("quake-loading-death");
  loadingOverlay.setAttribute("aria-busy", "false");
  if (loadingStatus) loadingStatus.textContent = "you died";
  if (loadingProgress) loadingProgress.hidden = true;
  if (loadingAction) {
    loadingAction.textContent = "";
    loadingAction.hidden = true;
  }
  mountQuakeBitmapText(loadingStatus?.parentElement ?? loadingOverlay);
}

function clearQuakeDeathOverlay(): void {
  if (!loadingOverlay?.classList.contains("quake-loading-death")) return;
  loadingOverlay.classList.remove("quake-loading-death");
  if (loadingAction) loadingAction.hidden = true;
  if (loadingProgress) loadingProgress.hidden = false;
  if (!quakeAppLoading && !QUAKE_LOADING_PREVIEW_ENABLED) {
    loadingOverlay.hidden = true;
    loadingOverlay.removeAttribute("aria-busy");
  }
}

function respawnQuakePlayerFromDeath(): boolean {
  if (!quakePlayerDead || !currentResult) return false;
  clearQuakeMegahealthRot();
  clearQuakePowerups();
  getPlayer().respawn();
  if (!quakePlayerDead) {
    host.focus({ preventScroll: true });
    controls.lock();
  }
  return true;
}

function startQuakeNewGame(): void {
  if (!currentResult) return;
  clearQuakeMegahealthRot();
  clearQuakePowerups();
  clearQuakeMoveInput();
  clearQuakeAttackInput();
  clearQuakeMobileMoveInput();
  clearQuakeLevelComplete();
  getPlayer().respawn();
  quakeGameplayStarted = true;
}

function resumeQuakeGameplayAfterMapLoad(): void {
  if (!currentResult || quakeAppLoading || quakePlayerDead) return;
  quakeGameplayStarted = true;
  menu.hideMainMenu();
  syncPlayerCollision();
}

function isQuakeLevelTransitionActive(): boolean {
  return document.body.classList.contains("quake-level-complete");
}

function canUseQuakeGameplayInput(): boolean {
  return !quakeAppLoading &&
    !menu.isMainMenuOpen() &&
    !menu.isMenuPanelOpen() &&
    !isQuakeLevelTransitionActive() &&
    !quakePlayerDead &&
    currentCollisionWorld !== null;
}

function shouldResumeQuakeMainMenuOnEscape(): boolean {
  return quakeGameplayStarted &&
    !quakeAppLoading &&
    currentResult !== null &&
    currentCollisionWorld !== null &&
    !isQuakeLevelTransitionActive() &&
    !quakePlayerDead;
}

function isQuakeDebugFlyModeActive(): boolean {
  return quakeDebugMode && quakeDebugFlyMode && canUseQuakeGameplayInput();
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable]") !== null;
}

function shouldPreventQuakeGameplayKeyDefault(event: KeyboardEvent): boolean {
  return canUseQuakeGameplayInput() &&
    QUAKE_GAMEPLAY_KEY_CODES.has(event.code) &&
    !isEditableKeyboardTarget(event.target);
}

function isQuakeDebugPanelTarget(target: EventTarget | null): boolean {
  return debugPanel !== null &&
    target instanceof Node &&
    debugPanel.contains(target);
}

function syncQuakeCrouchInput(): void {
  if (!player) return;
  player.setCrouching(canUseQuakeGameplayInput() && quakeCrouchKeyCodesDown.size > 0);
}

function clearQuakeMoveInput(): void {
  player?.clearMoveInput();
}

function handleQuakeMoveKey(event: KeyboardEvent, pressed: boolean): boolean {
  if (quakeDebugMode && quakeDebugFlyMode) return false;
  if (!QUAKE_MOVE_KEY_CODES.has(event.code) && event.code !== "Space") return false;
  if (pressed && (!canUseQuakeGameplayInput() || isEditableKeyboardTarget(event.target))) return false;
  if (!player?.handleMoveKey(event.code, pressed)) return false;
  return true;
}

function clearQuakeCrouchInput(): void {
  if (quakeCrouchKeyCodesDown.size === 0 && !player?.isCrouching()) return;
  quakeCrouchKeyCodesDown.clear();
  player?.setCrouching(false);
}

function handleQuakeCrouchKey(event: KeyboardEvent, pressed: boolean): boolean {
  if (quakeDebugMode && quakeDebugFlyMode) return false;
  if (!QUAKE_CROUCH_KEY_CODES.has(event.code)) return false;
  if (pressed) {
    if (!canUseQuakeGameplayInput() || isEditableKeyboardTarget(event.target)) return false;
    quakeCrouchKeyCodesDown.add(event.code);
  } else {
    quakeCrouchKeyCodesDown.delete(event.code);
  }
  syncQuakeCrouchInput();
  return true;
}

function clearQuakeDebugFlyInput(): void {
  quakeDebugFlyKeyCodesDown.clear();
  quakeDebugFlyTime = 0;
  if (!quakeDebugFlyFrame) return;
  window.cancelAnimationFrame(quakeDebugFlyFrame);
  quakeDebugFlyFrame = 0;
}

function handleQuakeDebugFlyKey(event: KeyboardEvent, pressed: boolean): boolean {
  if (!quakeDebugMode || !quakeDebugFlyMode || !quakeDebugFlyKeyCode(event.code)) return false;
  if (!canUseQuakeGameplayInput() || isEditableKeyboardTarget(event.target)) return false;
  event.preventDefault();
  event.stopPropagation();
  if (pressed) {
    quakeDebugFlyKeyCodesDown.add(event.code);
    scheduleQuakeDebugFlyFrame();
  } else {
    quakeDebugFlyKeyCodesDown.delete(event.code);
  }
  return true;
}

function quakeDebugFlyKeyCode(code: string): boolean {
  return QUAKE_MOVE_KEY_CODES.has(code) ||
    QUAKE_CROUCH_KEY_CODES.has(code) ||
    code === "Space" ||
    code === "KeyC" ||
    code === "ShiftLeft" ||
    code === "ShiftRight";
}

function createQuakeLoadingProgressTracker(status = "Loading"): QuakeLoadingProgressTracker {
  let completed = 0;
  let total = 0;
  let currentStatus = status;
  let visualProgress = 0;

  const render = () => {
    const actualProgress = total > 0 ? completed / total : 0;
    visualProgress = total > 0 ? Math.max(visualProgress, actualProgress) : 0;
    updateQuakeLoadingDisplay(currentStatus, { completed, total, visualProgress });
  };

  return {
    setStatus(nextStatus) {
      currentStatus = nextStatus;
      render();
    },
    startTask() {
      let done = false;
      total++;
      render();
      return () => {
        if (done) return;
        done = true;
        completed = Math.min(total, completed + 1);
        render();
      };
    },
  };
}

function setQuakeLoading(active: boolean, status = "Loading"): void {
  quakeAppLoading = active;
  if (active) {
    clearQuakeAttackInput();
    clearQuakeDebugFlyInput();
    clearQuakeMoveInput();
    clearQuakeMobileMoveInput();
    clearQuakeCrouchInput();
    clearQuakeWeaponViewPunch();
    clearQuakeBonusOverlay();
    hideQuakeStatsOverlay();
    document.body.classList.add("quake-loading");
    updateQuakeLoadingDisplay(status, { completed: 0, total: 0 });
    if (loadingAction) {
      loadingAction.textContent = "";
      loadingAction.hidden = true;
    }
    if (loadingOverlay) {
      loadingOverlay.hidden = false;
      loadingOverlay.setAttribute("aria-busy", "true");
    }
    controls.update({ moveEnabled: false, jumpEnabled: false, gravity: 0 });
    clearQuakeCrosshairTarget();
    return;
  }

  if (QUAKE_LOADING_PREVIEW_ENABLED) {
    document.body.classList.add("quake-loading");
    if (loadingOverlay) {
      loadingOverlay.hidden = false;
      loadingOverlay.setAttribute("aria-busy", "false");
    }
  } else {
    document.body.classList.remove("quake-loading");
    if (loadingOverlay) {
      loadingOverlay.hidden = true;
      loadingOverlay.removeAttribute("aria-busy");
    }
  }
  if (loadingAction) {
    loadingAction.textContent = "";
    loadingAction.hidden = true;
  }
  if (!menu.isMainMenuOpen() && !menu.isMenuPanelOpen() && !isQuakeLevelTransitionActive()) {
    controls.update({ moveEnabled: false, jumpEnabled: false, gravity: 0 });
  }
  syncQuakeDebugFlyMode();
  syncQuakeCrosshairTarget();
  syncQuakeStatsOverlayAvailability();
}

function setQuakeLoadingError(): void {
  quakeAppLoading = true;
  clearQuakeAttackInput();
  clearQuakeDebugFlyInput();
  clearQuakeMoveInput();
  clearQuakeMobileMoveInput();
  clearQuakeCrouchInput();
  clearQuakeWeaponViewPunch();
  clearQuakeBonusOverlay();
  document.body.classList.add("quake-loading");
  updateQuakeLoadingDisplay("Load failed", { completed: 0, total: 0 });
  if (loadingAction) {
    loadingAction.textContent = "";
    loadingAction.hidden = true;
  }
  if (loadingOverlay) {
    loadingOverlay.hidden = false;
    loadingOverlay.setAttribute("aria-busy", "false");
  }
  controls.update({ moveEnabled: false, jumpEnabled: false, gravity: 0 });
  clearQuakeCrosshairTarget();
}

function setQuakeAssetsRegenerating(message = QUAKE_ASSETS_REGENERATING_ACTION): void {
  quakeAppLoading = true;
  clearQuakeAttackInput();
  clearQuakeDebugFlyInput();
  clearQuakeMoveInput();
  clearQuakeMobileMoveInput();
  clearQuakeCrouchInput();
  clearQuakeWeaponViewPunch();
  clearQuakeBonusOverlay();
  document.body.classList.add("quake-loading");
  updateQuakeLoadingDisplay(QUAKE_ASSETS_REGENERATING_STATUS, { completed: 0, total: 0 });
  if (loadingAction) {
    loadingAction.textContent = message;
    loadingAction.hidden = false;
  }
  if (loadingOverlay) {
    loadingOverlay.hidden = false;
    loadingOverlay.setAttribute("aria-busy", "true");
  }
  controls.update({ moveEnabled: false, jumpEnabled: false, gravity: 0 });
  clearQuakeCrosshairTarget();
}

function updateQuakeLoadingDisplay(status: string, progress: QuakeLoadingProgressSnapshot): void {
  const total = Math.max(0, Math.trunc(progress.total));
  const completed = Math.max(0, Math.min(total, Math.trunc(progress.completed)));
  const actualProgress = total > 0 ? completed / total : 0;
  const visualProgress = Math.max(0, Math.min(1, progress.visualProgress ?? actualProgress));
  const percent = Math.round(visualProgress * 100);
  const root = loadingStatus?.parentElement ?? document;
  const displayStatus = status === "Load failed" || status === QUAKE_ASSETS_REGENERATING_STATUS
    ? status
    : "Loading";

  if (loadingStatus) loadingStatus.textContent = displayStatus;
  if (loadingProgress) {
    loadingProgress.style.setProperty("--quake-loading-progress", String(percent / 100));
    if (total > 0) {
      loadingProgress.classList.remove("quake-loading-progress-indeterminate");
      loadingProgress.setAttribute("aria-valuenow", String(percent));
      loadingProgress.setAttribute("aria-valuetext", `${completed} of ${total}`);
    } else {
      loadingProgress.classList.add("quake-loading-progress-indeterminate");
      loadingProgress.removeAttribute("aria-valuenow");
      loadingProgress.setAttribute("aria-valuetext", "Loading");
    }
  }
  if (loadingProgressFill) loadingProgressFill.hidden = false;
  mountQuakeBitmapText(root);
}

function addQuakePickupMesh(entity: QuakeEntity, model?: QuakePickupModel, frameIndex = 0): PolyMeshHandle | null {
  if (!entity.origin) return null;
  const frameSet = model ? quakePickupModelRenderBundleFrameSet(model) : undefined;
  const handle = frameSet
    ? mountQuakeRenderBundleFrameSetMesh(sceneElement, frameSet, frameIndex)
    : model
    ? mountQuakeRenderBundleMesh(sceneElement, quakePickupModelRenderBundle(model, frameIndex))
    : addQuakeProceduralPickupMesh(entity);
  if (!handle) return null;
  handle.element.classList.add("pickup");
  stripPolyMeshMetadata(handle.element);
  if (isQuakeDebugDomMetadataEnabled()) {
    handle.element.dataset.entityIndex = String(entity.index);
    handle.element.dataset.classname = entity.classname;
  }
  const angle = entity.angle ?? quakeEntityNumber(entity, "angle", 0);
  handle.setTransform({
    position: quakePointToPoly(entity.origin),
    rotation: [0, 0, angle],
    scale: 1,
  });
  if (!model) {
    world.pixelate(handle);
    void world.schedulePresentationResync(handle);
  }
  return handle;
}

function addQuakeShootableMesh(entity: QuakeEntity, model?: QuakePickupModel, frameIndex = 0): PolyMeshHandle | null {
  const frameSet = model ? quakePickupModelRenderBundleFrameSet(model) : undefined;
  const handle = frameSet
    ? mountQuakeRenderBundleFrameSetMesh(sceneElement, frameSet, frameIndex)
    : model
    ? mountQuakeRenderBundleMesh(sceneElement, quakePickupModelRenderBundle(model, frameIndex))
    : addQuakeProceduralShootableMesh(entity);
  if (!handle) return null;
  stripPolyMeshMetadata(handle.element);
  return handle;
}

function addQuakeProceduralShootableMesh(entity: QuakeEntity): PolyMeshHandle | null {
  const polygons = quakeShootableFallbackPolygons(entity);
  if (!polygons.length) return null;
  return scene.add(makeParseResult(polygons), {
    merge: false,
    meshResolution: "lossless",
    excludeFromAutoCenter: true,
  });
}

function addQuakeProceduralPickupMesh(entity: QuakeEntity): PolyMeshHandle | null {
  const polygons = quakePickupPolygons(entity);
  if (!polygons.length) return null;
  return scene.add(makeParseResult(polygons), {
    merge: false,
    meshResolution: "lossless",
    excludeFromAutoCenter: true,
  });
}

function quakePointToPoly(point: { x: number; y: number; z: number }): Vec3 {
  return [
    (point.x - quakeModelPivot.x) * QUAKE_COLLISION_UNIT_SCALE,
    (point.y - quakeModelPivot.y) * QUAKE_COLLISION_UNIT_SCALE,
    (point.z - quakeModelPivot.z) * QUAKE_COLLISION_UNIT_SCALE,
  ];
}

function disposeCurrentScene(): void {
  clearQuakeAttackInput();
  clearQuakeDebugFlyInput();
  clearQuakeWeaponViewPunch();
  clearQuakeMegahealthRot();
  clearQuakePowerups();
  clearQuakeBonusOverlay();
  viewmodel.remove();
  world.clear();
  movers.clear();
  getPickups().clear();
  shootables.clear();
  clearQuakeLevelComplete();
  clearQuakePlayerDeath();
  quakeText.clear();
  quakeDoorMessageCooldownUntil.clear();
  clearQuakeCrosshairHit();
  clearQuakeLevelLoadTimer();
  clearQuakeCrosshairTarget();
  getPlayer().resetForSceneDispose();
  currentCollisionWorld = null;
  currentResult = null;
  triggerSystem.clear();
  entityByIndex = new Map();
  clearQuakeDamageableBrushes();
  targetSystem.clear();
  clearQuakePointHazards();
  quakeModelPivot = { x: 0, y: 0, z: 0 };
  quakeMoverCrushDamageAt = new Map();
  quakeMoverSoundModes = new Map();
  audio.syncAmbientEntities([]);
  weapons.reset();
  quakeTransitionSerial = 0;
}

function setCamera(spawn: QuakeScene["spawn"]): void {
  clearQuakeWeaponViewPunch(false);
  getPlayer().spawn(spawn);
  syncSceneCamera(spawn.rotX, spawn.rotY);
  syncQuakeCrosshairTarget();
}

function syncSceneCamera(rotX: number, rotY: number): void {
  const origin = getPlayer().currentOrigin();
  syncSceneCameraAt(origin, rotX, rotY);
}

function syncSceneCameraAt(origin: Vec3, rotX: number, rotY: number): void {
  resetQuakeCameraStepSmoothing(origin);
  applyQuakeSceneCameraAt(origin, rotX, rotY);
}

function currentQuakeCameraRenderOrigin(): Vec3 {
  return quakeCameraRenderOrigin;
}

function syncQuakeCameraOrigin(origin: [number, number, number], mode: "move" | "reset" | "smooth-step"): void {
  if (mode === "reset") {
    resetQuakeCameraStepSmoothing(origin);
    return;
  }

  const active = Math.abs(quakeCameraRenderOrigin[2] - origin[2]) > COLLISION_EPSILON || quakeCameraStepSmoothFrame !== 0;
  if (!active && mode !== "smooth-step") {
    quakeCameraRenderOrigin = [origin[0], origin[1], origin[2]];
    quakeCameraStepSmoothAt = 0;
    return;
  }

  const now = performance.now();
  if (active) advanceQuakeCameraStepSmoothing(origin[2], now);
  else quakeCameraStepSmoothAt = now;
  if (mode === "smooth-step") {
    quakeCameraRenderOrigin[2] = clampNumber(
      quakeCameraRenderOrigin[2],
      origin[2] - QUAKE_CAMERA_STEP_SMOOTH_MAX_OFFSET,
      origin[2],
    );
  }
  quakeCameraRenderOrigin[0] = origin[0];
  quakeCameraRenderOrigin[1] = origin[1];
  applyQuakeSceneCameraAt(
    quakeCameraRenderOrigin,
    scene.camera.state.rotX ?? 88,
    scene.camera.state.rotY ?? 270,
  );
  viewmodel.syncTransform();
  if (Math.abs(quakeCameraRenderOrigin[2] - origin[2]) > COLLISION_EPSILON) {
    scheduleQuakeCameraStepSmoothingFrame();
  } else {
    if (quakeCameraStepSmoothFrame) {
      window.cancelAnimationFrame(quakeCameraStepSmoothFrame);
      quakeCameraStepSmoothFrame = 0;
    }
    quakeCameraStepSmoothAt = 0;
  }
}

function scheduleQuakeCameraStepSmoothingFrame(): void {
  if (quakeAppDisposed || quakeCameraStepSmoothFrame) return;
  quakeCameraStepSmoothFrame = window.requestAnimationFrame(runQuakeCameraStepSmoothingFrame);
}

function runQuakeCameraStepSmoothingFrame(now: number): void {
  quakeCameraStepSmoothFrame = 0;
  const origin = controls.getOrigin();
  quakeCameraRenderOrigin[0] = origin[0];
  quakeCameraRenderOrigin[1] = origin[1];
  const active = advanceQuakeCameraStepSmoothing(origin[2], now);
  applyQuakeSceneCameraAt(
    quakeCameraRenderOrigin,
    scene.camera.state.rotX ?? 88,
    scene.camera.state.rotY ?? 270,
  );
  viewmodel.syncTransform();
  if (active) scheduleQuakeCameraStepSmoothingFrame();
}

function advanceQuakeCameraStepSmoothing(originZ: number, now: number): boolean {
  const dz = originZ - quakeCameraRenderOrigin[2];
  if (dz <= COLLISION_EPSILON) {
    quakeCameraRenderOrigin[2] = originZ;
    quakeCameraStepSmoothAt = 0;
    return false;
  }
  const dt = Math.min(
    QUAKE_CAMERA_STEP_SMOOTH_DT_CLAMP,
    quakeCameraStepSmoothAt ? Math.max(0, (now - quakeCameraStepSmoothAt) / 1000) : 0,
  );
  quakeCameraStepSmoothAt = now;
  const step = QUAKE_CAMERA_STEP_SMOOTH_SPEED * dt;
  if (step > 0) {
    quakeCameraRenderOrigin[2] = Math.min(originZ, quakeCameraRenderOrigin[2] + step);
  }
  if (originZ - quakeCameraRenderOrigin[2] > QUAKE_CAMERA_STEP_SMOOTH_MAX_OFFSET) {
    quakeCameraRenderOrigin[2] = originZ - QUAKE_CAMERA_STEP_SMOOTH_MAX_OFFSET;
  }
  return originZ - quakeCameraRenderOrigin[2] > COLLISION_EPSILON;
}

function resetQuakeCameraStepSmoothing(origin: Vec3): void {
  if (quakeCameraStepSmoothFrame) {
    window.cancelAnimationFrame(quakeCameraStepSmoothFrame);
    quakeCameraStepSmoothFrame = 0;
  }
  quakeCameraStepSmoothAt = 0;
  quakeCameraRenderOrigin = [origin[0], origin[1], origin[2]];
}

function applyQuakeSceneCameraAt(origin: Vec3, rotX: number, rotY: number): void {
  const forward = forwardDirection(rotX, rotY);
  const distance = lookOffset();
  scene.camera.update({
    rotX,
    rotY,
    target: [
      origin[0] + forward[0] * distance,
      origin[1] + forward[1] * distance,
      origin[2] + forward[2] * distance,
    ],
  });
  scene.applyCamera();
}

function playQuakeWeaponFireFeedback(): void {
  viewmodel.playFireAnimation();
  punchQuakeWeaponView();
}

function punchQuakeWeaponView(amount = QUAKE_WEAPON_VIEW_PUNCH_DEG, now = performance.now()): void {
  const nextOffset = Math.min(QUAKE_WEAPON_VIEW_PUNCH_MAX_DEG, quakeWeaponViewPunchOffset + Math.max(0, amount));
  syncQuakeWeaponViewPunchOffset(nextOffset);
  quakeWeaponViewPunchAt = now;
  scheduleQuakeWeaponViewPunchFrame();
}

function scheduleQuakeWeaponViewPunchFrame(): void {
  if (quakeAppDisposed || quakeWeaponViewPunchFrame || quakeWeaponViewPunchOffset <= 0) return;
  quakeWeaponViewPunchFrame = window.requestAnimationFrame(runQuakeWeaponViewPunchFrame);
}

function runQuakeWeaponViewPunchFrame(now: number): void {
  quakeWeaponViewPunchFrame = 0;
  if (quakeWeaponViewPunchOffset <= 0) return;
  if (!canUseQuakeGameplayInput()) {
    clearQuakeWeaponViewPunch();
    return;
  }

  const dt = Math.min(100, Math.max(0, now - quakeWeaponViewPunchAt || 16.7));
  quakeWeaponViewPunchAt = now;
  const nextOffset = quakeWeaponViewPunchOffset * Math.exp(-dt / QUAKE_WEAPON_VIEW_PUNCH_DECAY_MS);
  const snappedOffset = nextOffset <= QUAKE_WEAPON_VIEW_PUNCH_EPSILON_DEG ? 0 : nextOffset;
  syncQuakeWeaponViewPunchOffset(snappedOffset);
  if (quakeWeaponViewPunchOffset > 0) {
    scheduleQuakeWeaponViewPunchFrame();
  } else {
    queueQuakeCrosshairTargetSync();
  }
}

function clearQuakeWeaponViewPunch(syncCamera = true): void {
  if (quakeWeaponViewPunchFrame) {
    window.cancelAnimationFrame(quakeWeaponViewPunchFrame);
    quakeWeaponViewPunchFrame = 0;
  }
  if (syncCamera && Math.abs(quakeWeaponViewPunchOffset) > QUAKE_WEAPON_VIEW_PUNCH_EPSILON_DEG && currentResult) {
    syncQuakeWeaponViewPunchOffset(0);
  }
  quakeWeaponViewPunchOffset = 0;
  quakeWeaponViewPunchAt = 0;
  quakeWeaponViewPunchBaseRotX = null;
}

function syncQuakeWeaponViewPunchOffset(nextOffset: number): void {
  const currentRotX = clampNumber(scene.camera.state.rotX ?? 88, QUAKE_CAMERA_ROT_X_MIN, QUAKE_CAMERA_ROT_X_MAX);
  const rotY = scene.camera.state.rotY ?? 270;
  let baseRotX = quakeWeaponViewPunchBaseRotX;
  if (baseRotX === null) {
    baseRotX = currentRotX - quakeWeaponViewPunchOffset;
  } else if (Math.abs(currentRotX - (baseRotX + quakeWeaponViewPunchOffset)) > QUAKE_WEAPON_VIEW_PUNCH_EXTERNAL_EPSILON_DEG) {
    baseRotX = currentRotX;
  }

  baseRotX = clampNumber(baseRotX, QUAKE_CAMERA_ROT_X_MIN, QUAKE_CAMERA_ROT_X_MAX);
  quakeWeaponViewPunchOffset = nextOffset;
  quakeWeaponViewPunchBaseRotX = nextOffset > 0 ? baseRotX : null;
  applyQuakeSceneCameraAt(
    currentQuakeCameraRenderOrigin(),
    clampNumber(baseRotX + nextOffset, QUAKE_CAMERA_ROT_X_MIN, QUAKE_CAMERA_ROT_X_MAX),
    rotY,
  );
  viewmodel.syncTransform();
}

function playQuakeDamageViewFeedback(feedback: QuakePlayerDamageFeedback | undefined): void {
  const amount = Math.max(10, feedback?.amount ?? 10);
  punchQuakeWeaponView(Math.min(QUAKE_DAMAGE_VIEW_PITCH_MAX_DEG, amount * QUAKE_DAMAGE_VIEW_PITCH_SCALE));
}

function lookOffset(): number {
  const value = Number.parseFloat(scene.cameraEl.style.perspective || scene.camera.perspectiveStyle);
  return (Number.isFinite(value) && value > 0 ? value : 900) / BASE_TILE;
}

function forwardDirection(rotX: number, rotY: number): Vec3 {
  const rx = (rotX * Math.PI) / 180;
  const ry = (rotY * Math.PI) / 180;
  return [
    -Math.sin(rx) * Math.cos(ry),
    -Math.sin(rx) * Math.sin(ry),
    -Math.cos(rx),
  ];
}

function scheduleQuakeDebugFlyFrame(): void {
  if (quakeAppDisposed || quakeDebugFlyFrame || !quakeDebugMode || !quakeDebugFlyMode) return;
  quakeDebugFlyFrame = window.requestAnimationFrame(runQuakeDebugFlyFrame);
}

function runQuakeDebugFlyFrame(now: number): void {
  quakeDebugFlyFrame = 0;
  if (!quakeDebugMode || !quakeDebugFlyMode) {
    quakeDebugFlyTime = 0;
    return;
  }
  if (!isQuakeDebugFlyModeActive()) {
    quakeDebugFlyTime = now;
    scheduleQuakeDebugFlyFrame();
    return;
  }

  controls.update({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, gravity: 0 });
  const dt = Math.min(QUAKE_DEBUG_FLY_DT_CLAMP, quakeDebugFlyTime ? (now - quakeDebugFlyTime) / 1000 : 0.0167);
  quakeDebugFlyTime = now;
  const direction = quakeDebugFlyDirection();
  if (distanceSq3(direction, [0, 0, 0]) > 0) {
    const origin = controls.getOrigin();
    const speed = QUAKE_DEBUG_FLY_SPEED * (quakeDebugFlyFastActive() ? QUAKE_DEBUG_FLY_FAST_MULTIPLIER : 1);
    const nextOrigin: [number, number, number] = [
      origin[0] + direction[0] * speed * dt,
      origin[1] + direction[1] * speed * dt,
      origin[2] + direction[2] * speed * dt,
    ];
    getPlayer().setDebugOrigin(nextOrigin);
    controls.update({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, gravity: 0 });
    syncQuakeDebugFlyView(nextOrigin);
  }
  scheduleQuakeDebugFlyFrame();
}

function quakeDebugFlyDirection(): Vec3 {
  const rotX = scene.camera.state.rotX ?? 88;
  const rotY = scene.camera.state.rotY ?? 270;
  const forward = forwardDirection(rotX, rotY);
  const horizontalForward = forwardDirection(90, rotY);
  const right: Vec3 = [horizontalForward[1], -horizontalForward[0], 0];
  const direction: Vec3 = [0, 0, 0];

  if (quakeDebugFlyKeyCodesDown.has("KeyW") || quakeDebugFlyKeyCodesDown.has("ArrowUp")) {
    direction[0] += forward[0];
    direction[1] += forward[1];
    direction[2] += forward[2];
  }
  if (quakeDebugFlyKeyCodesDown.has("KeyS") || quakeDebugFlyKeyCodesDown.has("ArrowDown")) {
    direction[0] -= forward[0];
    direction[1] -= forward[1];
    direction[2] -= forward[2];
  }
  if (quakeDebugFlyKeyCodesDown.has("KeyD") || quakeDebugFlyKeyCodesDown.has("ArrowRight")) {
    direction[0] += right[0];
    direction[1] += right[1];
  }
  if (quakeDebugFlyKeyCodesDown.has("KeyA") || quakeDebugFlyKeyCodesDown.has("ArrowLeft")) {
    direction[0] -= right[0];
    direction[1] -= right[1];
  }
  if (quakeDebugFlyKeyCodesDown.has("Space")) direction[2] += 1;
  if (
    quakeDebugFlyKeyCodesDown.has("ControlLeft") ||
    quakeDebugFlyKeyCodesDown.has("ControlRight") ||
    quakeDebugFlyKeyCodesDown.has("KeyC")
  ) {
    direction[2] -= 1;
  }

  return distanceSq3(direction, [0, 0, 0]) > 0 ? normalizeVec3(direction) : direction;
}

function quakeDebugFlyFastActive(): boolean {
  return quakeDebugFlyKeyCodesDown.has("ShiftLeft") || quakeDebugFlyKeyCodesDown.has("ShiftRight");
}

function syncQuakeDebugFlyView(origin: [number, number, number]): void {
  shootables.syncVisibility(origin, true);
  getPickups().syncVisibility(origin);
  viewmodel.syncTransform();
  world.syncVisibility(true);
  syncQuakeCrosshairTarget();
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function quakeLineOfSight(start: Vec3, end: Vec3): boolean {
  const trace = currentCollisionWorld?.traceUse?.(start, end);
  return !trace || trace.fraction >= 0.96;
}

function isQuakePointInPlayerView(point: Vec3): boolean {
  return quakePlayerViewDot(point) >= QUAKE_MONSTER_MOUNT_VIEW_DOT_MIN;
}

function quakePlayerViewDot(point: Vec3): number {
  const origin = getPlayer().currentOrigin();
  const toPoint: Vec3 = [point[0] - origin[0], point[1] - origin[1], 0];
  const toPointLength = Math.hypot(toPoint[0], toPoint[1]);
  if (toPointLength <= COLLISION_EPSILON) return 1;

  const forward = forwardDirection(scene.camera.state.rotX ?? 90, scene.camera.state.rotY ?? 270);
  const forwardHorizontal: Vec3 = [forward[0], forward[1], 0];
  const forwardLength = Math.hypot(forwardHorizontal[0], forwardHorizontal[1]);
  if (forwardLength <= COLLISION_EPSILON) return 1;

  const toPointUnit: Vec3 = [toPoint[0] / toPointLength, toPoint[1] / toPointLength, 0];
  const forwardUnit: Vec3 = [forwardHorizontal[0] / forwardLength, forwardHorizontal[1] / forwardLength, 0];
  return dotVec3(toPointUnit, forwardUnit);
}

function mountQuakeScene(result: QuakeScene): void {
  disposeCurrentScene();
  currentResult = result;
  clearQuakeSkyBackground();
  currentCollisionWorld = result.collision ? buildQuakeClipCollisionWorld(result.collision) : null;
  if (!currentCollisionWorld) throw new Error(`Prepared Quake scene ${result.label} is missing collision data.`);
  world.mount(result);
  setupQuakeEntityActions(result);
  const runtime = result.entityManifest.runtime;
  audio.syncAmbientEntities(quakeEntitiesForIndexes(runtime.ambientEntityIndexes));
  setCamera(result.spawn);
  shootables.spawn(quakeEntitiesForIndexes(runtime.shootableEntityIndexes), currentPickupModelLibrary, currentProgramMetadata);
  getPlayer().resetInventory();
  const origin = getPlayer().currentOrigin();
  shootables.syncVisibility(origin, true);
  getPickups().spawn(quakeEntitiesForIndexes(runtime.pickupEntityIndexes), currentPickupModelLibrary, origin);
  const triggers = syncTouchedTriggers(origin);
  syncQuakeHazards(origin, triggers);
  getPickups().syncCollision(origin, getPlayer().eyeHeight(), STEP_HEIGHT);
  viewmodel.syncTransform();
  world.syncVisibility(true);
  syncQuakeCrosshairTarget();
  world.schedulePresentationResync();
  menu.focusCurrent();
}

function clearQuakeSkyBackground(): void {
  host.style.removeProperty("background-image");
  host.style.removeProperty("background-position");
  host.style.removeProperty("background-repeat");
  host.style.removeProperty("background-size");
  host.style.removeProperty("image-rendering");
}

function setupQuakeEntityActions(result: QuakeScene): void {
  entityByIndex = new Map(result.entities.map((entity) => [entity.index, entity]));
  quakeModelPivot = result.collision?.pivot ?? { x: 0, y: 0, z: 0 };
  const runtime = result.entityManifest.runtime;
  setupQuakeDamageableBrushes(runtime.damageableBrushEntityIndexes);
  setupQuakePointHazards(runtime.fireballEmitterEntityIndexes);
  targetSystem.setup(runtime, result.gameLogic);
  triggerSystem.clear();
  movers.setup(
    quakeEntitiesForIndexes([...runtime.moverEntityIndexes, ...runtime.moverSupportEntityIndexes]),
    result.models,
    quakeModelPivot,
    result.gameLogic,
  );
}

function quakeEntitiesForIndexes(indexes: readonly number[]): QuakeEntity[] {
  const out: QuakeEntity[] = [];
  const seen = new Set<number>();
  for (const index of indexes) {
    if (seen.has(index)) continue;
    seen.add(index);
    const entity = entityByIndex.get(index);
    if (entity) out.push(entity);
  }
  return out;
}

function activateQuakeTeleport(trigger: QuakeEntity): boolean {
  const destination = quakeTriggerTeleportDestination(trigger, {
    gameLogic: currentResult?.gameLogic,
    getEntity: (entityIndex) => entityByIndex.get(entityIndex),
    targetEntityIndexesFor: (targetname) => targetSystem.entityIndexesFor(targetname),
  });
  if (!destination) return false;
  teleportQuakePlayer(destination);
  return true;
}

function teleportQuakePlayer(destination: QuakeEntity): void {
  quakeTransitionSerial++;
  if (!getPlayer().teleportTo(destination)) return;
  audio.playEvent("teleport", { volume: 0.64 });
  syncSceneCamera(90, (180 + quakeEntityNumber(destination, "angle", destination.angle ?? 0) + 360) % 360);
  const origin = getPlayer().currentOrigin();
  const triggers = currentQuakeTouchedTriggers(origin);
  triggerSystem.setActive(triggers);
  getPickups().syncCollision(origin, getPlayer().eyeHeight(), STEP_HEIGHT);
  viewmodel.syncTransform();
  world.syncVisibility(true);
  syncQuakeCrosshairTarget();
}

function completeQuakeLevel(entity: QuakeEntity): void {
  quakeTransitionSerial++;
  clearQuakeAttackInput();
  clearQuakeLevelLoadTimer();
  viewmodel.clearFireAnimation();
  document.body.classList.add("quake-level-complete");
  getPlayer().clearLevelState();
  audio.playEvent("levelExit", { volume: 0.58 });
  const nextMap = quakeChangelevelMap(entity);
  if (!nextMap && quakeHud) setQuakeCenterPrint("EXIT REACHED");
  if (!nextMap || !quakeSceneUrl(nextMap)) return;
  quakeLevelLoadTimer = window.setTimeout(() => {
    quakeLevelLoadTimer = null;
    void loadQuakeMap(nextMap, { loadingStatus: "Loading", resumeGameplay: true }).catch((error) => {
      console.error(error);
      if (quakeHud) setQuakeCenterPrint(`COULD NOT LOAD ${nextMap.toUpperCase()}`);
    });
  }, QUAKE_CHANGELEVEL_DELAY_MS);
}

function quakeChangelevelMap(entity: QuakeEntity): string | null {
  return quakeTriggerChangelevelMap(entity, currentResult?.gameLogic);
}

function activateSolidTouch(touch: QuakeTouchedTrigger): void {
  const entity = entityByIndex.get(touch.entityIndex);
  if (!entity) return;
  if (targetSystem.isDisabled(entity.index)) return;
  if (activateQuakeSolidGate(entity)) return;
  if ((entity.classname === "func_door" || entity.classname === "func_door_secret") && !entity.properties.targetname) {
    activateQuakeEntity(entity.index);
  }
}

function fireQuakeTarget(targetname: string, sourceEntityIndex?: number): void {
  targetSystem.fire(targetname, sourceEntityIndex);
}

function activateQuakeEntity(entityIndex: number, sourceEntityIndex?: number): boolean {
  if (targetSystem.isDisabled(entityIndex)) return false;
  const entity = entityByIndex.get(entityIndex);
  if (!entity) return false;
  if (activateQuakeSpecialEntity(entity)) return true;
  if (entity.classname === "trigger_counter") {
    activateTriggerCounter(entity);
    return true;
  }
  if (entity.classname === "trigger_relay") {
    return targetSystem.useTargets(entity);
  }
  if (entity.classname === "trigger_once" || entity.classname === "trigger_secret") {
    const activated = targetSystem.useTargets(entity);
    if (quakeRuntimeTriggerOneShot(entity, true)) targetSystem.disableEntity(entity.index);
    return activated;
  }
  if (entity.classname === "trigger_multiple") {
    return targetSystem.useTargets(entity);
  }
  if (entity.classname === "trigger_teleport") {
    if (!triggerSystem.activateTeleporterEntity(entity)) return false;
    syncTouchedTriggers(controls.getOrigin());
    return true;
  }
  if (shootables.has(entity.index)) {
    shootables.destroy(entity.index);
    return true;
  }
  return movers.activateEntity(entity.index, sourceEntityIndex);
}

function activateTriggerCounter(entity: QuakeEntity): void {
  triggerSystem.activateCounterEntity(entity);
}

function activateQuakeSpecialEntity(entity: QuakeEntity): boolean {
  if (activateQuakeSpecialTrigger(entity)) return true;
  if (entity.classname === "trap_spikeshooter") {
    activateQuakeSpikeShooter(entity);
    return true;
  }
  return false;
}

function activateQuakeSpecialTrigger(entity: QuakeEntity): boolean {
  if (entity.classname === "trigger_secret") {
    activateQuakeSecretTrigger(entity);
    return false;
  }
  if (entity.classname === "trigger_push") {
    activateQuakePushTrigger(entity);
    return true;
  }
  if (entity.classname === "trigger_setskill") {
    quakeSkill = quakeTriggerSetSkillValue(entity, currentResult?.gameLogic) ?? 1;
    showQuakeCenterPrint(`SKILL ${quakeSkill}`);
    return true;
  }
  if (entity.classname === "trigger_onlyregistered") {
    const activation = quakeTriggerOnlyRegisteredActivation(entity, {
      fallbackMessage: "REGISTERED VERSION ONLY",
      gameLogic: currentResult?.gameLogic,
      registered: QUAKE_SHAREWARE_REGISTERED,
    });
    if (activation?.allowed) {
      targetSystem.useTargets(entity);
      return true;
    }
    if (!showQuakeDirectCenterPrintMessageText(entity)) {
      showQuakeCenterPrint(activation?.message ?? quakeEntityMessage(entity, "REGISTERED VERSION ONLY"));
    }
    return true;
  }
  return false;
}

function activateQuakePushTrigger(entity: QuakeEntity): void {
  const activation = quakeTriggerPushActivation(entity, currentResult?.gameLogic);
  if (!activation) return;
  getPlayer().push([
    activation.velocity[0] * QUAKE_COLLISION_UNIT_SCALE,
    activation.velocity[1] * QUAKE_COLLISION_UNIT_SCALE,
    activation.velocity[2] * QUAKE_COLLISION_UNIT_SCALE,
  ]);
  if (activation.oneShot) {
    targetSystem.disableEntity(entity.index);
  }
}

function activateQuakeSecretTrigger(entity: QuakeEntity): void {
  const activation = quakeTriggerSecretActivation(entity, currentResult?.gameLogic);
  if (!activation) return;
  if (!quakeHasUseTargetsMessageText(entity)) showQuakeCenterPrint(activation.message);
  audio.playSound(activation.sound, { volume: 0.58 });
}

function quakeHasUseTargetsMessageText(entity: QuakeEntity): boolean {
  const text = quakeGameLogicEntityFact(currentResult?.gameLogic, entity.index)?.resolvedTrigger?.messageText;
  return text?.lane === "centerprint" && text.sourceCall === "SUB_UseTargets" && text.text.trim().length > 0;
}

function quakeRuntimeTriggerOneShot(entity: QuakeEntity, fallback: boolean): boolean {
  return quakeTriggerOneShot(entity, currentResult?.gameLogic, fallback);
}

function quakeRuntimeTriggerWait(entity: QuakeEntity, fallback: number): number {
  return quakeTriggerWait(entity, currentResult?.gameLogic, fallback);
}

function activateQuakeSolidGate(entity: QuakeEntity): boolean {
  if (entity.classname === "func_episodegate") {
    showQuakeCenterPrint(quakeEntityMessage(entity, "THIS EPISODE IS LOCKED"));
    return true;
  }
  if (entity.classname === "func_bossgate") {
    showQuakeCenterPrint(quakeEntityMessage(entity, "YOU MUST COMPLETE THE EPISODES FIRST"));
    return true;
  }
  return false;
}

function quakeEntityMessage(entity: QuakeEntity, fallback: string): string {
  return (entity.properties.message || fallback).replace(/\\n/g, "\n");
}

function clearQuakePointHazards(): void {
  if (quakePointHazardFrame !== null) {
    window.cancelAnimationFrame(quakePointHazardFrame);
    quakePointHazardFrame = null;
  }
  quakePointHazards = [];
  quakeFireballEmitters = [];
  quakePointHazardTime = 0;
}

function setupQuakePointHazards(entityIndexes: readonly number[]): void {
  clearQuakePointHazards();
  const now = performance.now();
  for (const entityIndex of entityIndexes) {
    const entity = entityByIndex.get(entityIndex);
    if (!entity || targetSystem.isDisabled(entity.index) || !entity.origin) continue;
    const rawSpeed = quakeEntityNumber(entity, "speed", QUAKE_FIREBALL_DEFAULT_SPEED);
    quakeFireballEmitters.push({
      entityIndex: entity.index,
      origin: quakePointToPoly(entity.origin),
      speed: (rawSpeed > 0 ? rawSpeed : QUAKE_FIREBALL_DEFAULT_SPEED) * QUAKE_COLLISION_UNIT_SCALE,
      nextSpawnAt: now + Math.random() * QUAKE_FIREBALL_INITIAL_DELAY_MS,
    });
  }
  if (quakeFireballEmitters.length) startQuakePointHazards();
}

function startQuakePointHazards(): void {
  if (quakePointHazardFrame !== null) return;
  quakePointHazardTime = 0;
  quakePointHazardFrame = window.requestAnimationFrame(tickQuakePointHazards);
}

function tickQuakePointHazards(_frameNow: number): void {
  if (!currentResult || (!quakeFireballEmitters.length && !quakePointHazards.length)) {
    clearQuakePointHazards();
    return;
  }

  const now = performance.now();
  const dt = Math.min(QUAKE_POINT_HAZARD_DT_CLAMP, quakePointHazardTime ? (now - quakePointHazardTime) / 1000 : 0.0167);
  quakePointHazardTime = now;
  spawnDueQuakeFireballs(now);
  moveQuakePointHazards(dt, now);
  if (quakePointHazards.length) syncQuakeHazards(getPlayer().currentOrigin());
  quakePointHazardFrame = window.requestAnimationFrame(tickQuakePointHazards);
}

function spawnDueQuakeFireballs(now: number): void {
  for (const emitter of quakeFireballEmitters) {
    if (targetSystem.isDisabled(emitter.entityIndex)) continue;
    if (now < emitter.nextSpawnAt) continue;
    spawnQuakeFireballHazard(emitter, now);
    emitter.nextSpawnAt = now + QUAKE_FIREBALL_MIN_WAIT_MS + Math.random() * QUAKE_FIREBALL_WAIT_JITTER_MS;
  }
}

function spawnQuakeFireballHazard(emitter: QuakeFireballEmitter, now: number): void {
  quakePointHazards.push({
    entityIndex: emitter.entityIndex,
    origin: [...emitter.origin] as Vec3,
    radiusSq: QUAKE_FIREBALL_RADIUS * QUAKE_FIREBALL_RADIUS,
    damage: QUAKE_FIREBALL_DAMAGE,
    kind: "fireball",
    velocity: [
      quakeRandomRange(-QUAKE_FIREBALL_DRIFT_SPEED, QUAKE_FIREBALL_DRIFT_SPEED),
      quakeRandomRange(-QUAKE_FIREBALL_DRIFT_SPEED, QUAKE_FIREBALL_DRIFT_SPEED),
      emitter.speed + Math.random() * QUAKE_FIREBALL_SPEED_JITTER,
    ],
    expiresAt: now + QUAKE_FIREBALL_LIFETIME_MS,
  });
}

function moveQuakePointHazards(dt: number, now: number): void {
  const active: QuakePointHazard[] = [];
  for (const hazard of quakePointHazards) {
    if (targetSystem.isDisabled(hazard.entityIndex)) continue;
    if (hazard.expiresAt !== undefined && hazard.expiresAt <= now) continue;
    if (hazard.velocity) {
      hazard.velocity[2] -= QUAKE_GRAVITY * dt;
      hazard.origin = [
        hazard.origin[0] + hazard.velocity[0] * dt,
        hazard.origin[1] + hazard.velocity[1] * dt,
        hazard.origin[2] + hazard.velocity[2] * dt,
      ];
    }
    active.push(hazard);
  }
  quakePointHazards = active;
}

function quakeRandomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function quakePointHazardAt(origin: [number, number, number]): QuakeHazardDamage | null {
  let hazard: QuakeHazardDamage | null = null;
  const now = performance.now();
  for (const pointHazard of quakePointHazards) {
    if (targetSystem.isDisabled(pointHazard.entityIndex)) continue;
    if (pointHazard.expiresAt !== undefined && pointHazard.expiresAt <= now) continue;
    if (distanceSq3(origin, pointHazard.origin) > pointHazard.radiusSq) continue;
    pointHazard.expiresAt = now;
    hazard = strongerQuakeHazard(hazard, {
      amount: pointHazard.damage,
      kind: pointHazard.kind,
    });
  }
  return hazard;
}

function activateQuakeSpikeShooter(entity: QuakeEntity): boolean {
  if (!entity.origin) return false;
  const start = quakePointToPoly(entity.origin);
  const target = getPlayer().currentOrigin();
  const toPlayer = subtractVec3(target, start);
  const direction = quakeEntityDirection(entity);
  const forwardDistance = dotVec3(toPlayer, direction);
  if (forwardDistance < 0 || forwardDistance > QUAKE_TRAP_SPIKE_RANGE) return true;
  const closest: Vec3 = [
    start[0] + direction[0] * forwardDistance,
    start[1] + direction[1] * forwardDistance,
    start[2] + direction[2] * forwardDistance,
  ];
  if (distanceSq3(closest, target) > QUAKE_TRAP_SPIKE_RADIUS * QUAKE_TRAP_SPIKE_RADIUS) return true;
  const trace = currentCollisionWorld?.traceUse?.(start, target);
  if (trace && trace.fraction < 0.96) return true;
  const damage = QUAKE_TRAP_SPIKE_DAMAGE * (quakeEntitySpawnflagsCompat(entity) & 1 ? 2 : 1);
  getPlayer().damage(damage);
  return true;
}

function quakeEntityDirection(entity: QuakeEntity): Vec3 {
  const angle = quakeEntityNumber(entity, "angle", entity.angle ?? 0);
  if (angle === -1) return [0, 0, 1];
  if (angle === -2) return [0, 0, -1];
  const radians = (angle * Math.PI) / 180;
  return normalizeVec3([Math.cos(radians), Math.sin(radians), 0]);
}

function quakeEntitySpawnflagsCompat(entity: QuakeEntity): number {
  return Math.trunc(quakeEntityNumber(entity, "spawnflags", 0));
}

function setupQuakeDamageableBrushes(entityIndexes: readonly number[]): void {
  clearQuakeDamageableBrushes();
  for (const entityIndex of entityIndexes) {
    const entity = entityByIndex.get(entityIndex);
    if (!entity) continue;
    quakeDamageableBrushHealth.set(entity.index, quakeDamageableBrushMaxHealth(entity));
  }
}

function clearQuakeDamageableBrushes(): void {
  for (const timer of quakeDamageableBrushResetTimers) window.clearTimeout(timer);
  quakeDamageableBrushResetTimers = [];
  quakeDamageableBrushHealth = new Map();
}

function damageQuakeBrushEntity(entityIndex: number, amount: number): boolean {
  if (targetSystem.isDisabled(entityIndex)) return false;
  const entity = entityByIndex.get(entityIndex);
  if (!entity || !isQuakeDamageableBrushEntity(entity)) return false;
  const health = quakeDamageableBrushHealth.get(entity.index);
  if (health === undefined) return false;
  const remaining = health - Math.max(0, amount);
  if (remaining > 0) {
    quakeDamageableBrushHealth.set(entity.index, remaining);
    return true;
  }
  quakeDamageableBrushHealth.delete(entity.index);
  return activateQuakeDamageableBrush(entity);
}

function activateQuakeDamageableBrush(entity: QuakeEntity): boolean {
  if (entity.classname === "trigger_once" || entity.classname === "trigger_secret") {
    if (entity.classname === "trigger_secret") activateQuakeSecretTrigger(entity);
    const activated = targetSystem.useTargets(entity);
    if (quakeRuntimeTriggerOneShot(entity, true)) targetSystem.disableEntity(entity.index);
    return activated;
  }
  if (entity.classname === "trigger_multiple") {
    const activated = targetSystem.useTargets(entity);
    scheduleQuakeDamageableBrushReset(entity);
    return activated;
  }
  const activated = activateQuakeEntity(entity.index);
  scheduleQuakeDamageableBrushReset(entity);
  return activated;
}

function scheduleQuakeDamageableBrushReset(entity: QuakeEntity): void {
  const wait = quakeDamageableBrushResetWait(entity);
  if (wait < 0) {
    targetSystem.disableEntity(entity.index);
    return;
  }
  const timer = window.setTimeout(() => {
    quakeDamageableBrushResetTimers = quakeDamageableBrushResetTimers.filter((item) => item !== timer);
    if (!targetSystem.isDisabled(entity.index)) {
      quakeDamageableBrushHealth.set(entity.index, quakeDamageableBrushMaxHealth(entity));
    }
  }, wait * 1000);
  quakeDamageableBrushResetTimers.push(timer);
}

function quakeDamageableBrushResetWait(entity: QuakeEntity): number {
  if (entity.classname === "func_button") return quakeEntityNumber(entity, "wait", 1);
  if (entity.classname === "func_door" || entity.classname === "func_door_secret") {
    return quakeEntityNumber(entity, "wait", 3);
  }
  return quakeEntityNumber(entity, "wait", 0.2);
}

function quakeDamageableBrushMaxHealth(entity: QuakeEntity): number {
  return Math.max(1, Math.round(quakeEntityNumber(entity, "health", 1)));
}

function isQuakeDamageableBrushEntity(entity: QuakeEntity): boolean {
  if (quakeEntityNumber(entity, "health", 0) <= 0) return false;
  return entity.classname === "func_button" ||
    entity.classname === "func_door" ||
    entity.classname === "func_door_secret" ||
    entity.classname === "trigger_multiple" ||
    entity.classname === "trigger_once" ||
    entity.classname === "trigger_secret";
}

function quakeMoverGroupUnlocked(state: QuakeMoverState): boolean {
  if (state.kind !== "door" && state.kind !== "secret-door") return true;
  const entities = state.linkedEntityIndexes
    .map((entityIndex) => movers.get(entityIndex)?.entity)
    .filter((entity): entity is QuakeEntity => Boolean(entity));
  const requiredKey = quakeDoorGroupKeyRequirement(entities.length ? entities : [state.entity]);
  if (quakePlayerHasDoorKey(getPlayer().inventory(), requiredKey)) return true;
  if (requiredKey) showQuakeDoorRequirementText(state, requiredKey);
  return false;
}

function showQuakeDoorRequirementText(state: QuakeMoverState, requiredKey: QuakeDoorKey): void {
  const cooldownKey = quakeMoverGroupCooldownKey(state);
  const now = performance.now();
  if ((quakeDoorMessageCooldownUntil.get(cooldownKey) ?? 0) > now) return;
  quakeDoorMessageCooldownUntil.set(cooldownKey, now + QUAKE_DOOR_MESSAGE_COOLDOWN_MS);
  const entityIndexes = quakeMoverGroupEntityIndexes(state);
  const text = quakeGeneratedCenterPrintTextForEntityIndexes(
    entityIndexes,
    "door-key-required",
    (fact) => fact.condition?.key === requiredKey,
  );
  if (text) showQuakeCenterPrint(text);
}

function quakeMoverGroupCooldownKey(state: QuakeMoverState): number {
  let key = state.entity.index;
  for (const entityIndex of state.linkedEntityIndexes) key = Math.min(key, entityIndex);
  return key;
}

function quakeMoverGroupEntityIndexes(state: QuakeMoverState): number[] {
  const entityIndexes: number[] = [];
  const seen = new Set<number>();
  const addEntityIndex = (entityIndex: number): void => {
    if (seen.has(entityIndex)) return;
    seen.add(entityIndex);
    entityIndexes.push(entityIndex);
  };
  addEntityIndex(state.entity.index);
  for (const entityIndex of state.linkedEntityIndexes) addEntityIndex(entityIndex);
  return entityIndexes;
}

function moverBlockedByPlayer(state: QuakeMoverState, nextOffset: Vec3, delta: Vec3): boolean {
  if (isQuakeDebugFlyModeActive()) return false;
  if (state.kind === "button" || shouldCarryPlayerWithMover(state, delta)) return false;
  const origin = controls.getOrigin();
  if (!currentCollisionWorld?.playerIntersectsBrush?.(
    state.entity.index,
    nextOffset,
    origin,
    getPlayer().eyeHeight(),
  )) return false;
  if (moverPushClearsPlayer(state, nextOffset, delta, origin)) return false;
  damageQuakePlayerForMoverBlock(state);
  return true;
}

function moverPushClearsPlayer(
  state: QuakeMoverState,
  nextOffset: Vec3,
  delta: Vec3,
  origin = controls.getOrigin(),
): boolean {
  const pushedOrigin: [number, number, number] = [
    origin[0] + delta[0],
    origin[1] + delta[1],
    origin[2] + delta[2],
  ];
  return !currentCollisionWorld?.playerIntersectsBrush?.(
    state.entity.index,
    nextOffset,
    pushedOrigin,
    getPlayer().eyeHeight(),
  );
}

function damageQuakePlayerForMoverBlock(state: QuakeMoverState): void {
  const now = performance.now();
  const lastDamageAt = quakeMoverCrushDamageAt.get(state.entity.index) ?? -Infinity;
  if (now - lastDamageAt < 500) return;
  const amount = quakeMoverBlockDamage(state);
  if (amount <= 0) return;
  quakeMoverCrushDamageAt.set(state.entity.index, now);
  getPlayer().damage(amount);
}

function applyMoverState(state: QuakeMoverState, movePlayer = true): void {
  const delta = subtractVec3(state.offset, state.lastOffset);
  const carryPlayer = movePlayer && shouldCarryPlayerWithMover(state, delta);
  currentCollisionWorld?.setBrushOffset?.(state.entity.index, state.offset);
  for (const leaf of world.modelLeaves(state.model.index)) {
    applyMoverLeafTransform(leaf);
    if (state.kind === "button") applyQuakeButtonLeafVisual(leaf, quakeButtonIsPressed(state));
  }
  if (carryPlayer) carryPlayerWithMover(state, delta);
  state.lastOffset = [...state.offset] as Vec3;
  syncQuakeMoverSound(state, movePlayer);
  syncQuakeCrosshairTarget();
}

function syncQuakeMoverSound(state: QuakeMoverState, activeUpdate: boolean): void {
  const previousMode = quakeMoverSoundModes.get(state.entity.index);
  quakeMoverSoundModes.set(state.entity.index, state.mode);
  if (!activeUpdate || previousMode === undefined || previousMode === state.mode) return;

  if (state.kind === "button") {
    if (state.mode === "opening") audio.playEvent("button", { volume: 0.58 });
    return;
  }

  if (state.kind === "plat") {
    if (state.mode === "opening" || state.mode === "closing") {
      audio.playEvent("platMove", { volume: 0.52 });
    } else if (state.mode === "open" || state.mode === "closed") {
      audio.playEvent("doorStop", { volume: 0.38 });
    }
    return;
  }

  if (state.mode === "opening" || state.mode === "closing") {
    audio.playEvent("doorMove", { volume: 0.52 });
  } else if (state.mode === "open" || state.mode === "closed") {
    audio.playEvent("doorStop", { volume: 0.44 });
  }
}

function shouldCarryPlayerWithMover(state: QuakeMoverState, delta: Vec3): boolean {
  if (isQuakeDebugFlyModeActive()) return false;
  if (state.kind === "button" || distanceSq3(delta, [0, 0, 0]) <= COLLISION_EPSILON) return false;
  const origin = controls.getOrigin();
  if (
    playerStandingOnMover(state, state.lastOffset, delta, origin) ||
    playerStandingOnMover(state, state.offset, delta, origin)
  ) {
    return true;
  }
  if (
    currentCollisionWorld?.playerIntersectsBrush?.(
      state.entity.index,
      state.offset,
      origin,
      getPlayer().eyeHeight(),
    ) &&
    moverPushClearsPlayer(state, state.offset, delta, origin)
  ) {
    return true;
  }
  const footZ = origin[2] - getPlayer().eyeHeight();
  const verticalWindow = Math.abs(delta[2]) + GROUND_SNAP;
  const contact = currentCollisionWorld?.floorContactAt?.(
    origin[0],
    origin[1],
    footZ + verticalWindow,
    footZ - verticalWindow,
  );
  if (contact) return contact.entityIndex === state.entity.index;
  return getPlayer().currentGroundEntity() === state.entity.index;
}

function playerStandingOnMover(
  state: QuakeMoverState,
  offset: Vec3,
  delta: Vec3,
  origin = controls.getOrigin(),
): boolean {
  const bounds = quakeMoverBoundsAtOffset(state, offset);
  if (
    origin[0] < bounds.minX - PLAYER_RADIUS ||
    origin[0] > bounds.maxX + PLAYER_RADIUS ||
    origin[1] < bounds.minY - PLAYER_RADIUS ||
    origin[1] > bounds.maxY + PLAYER_RADIUS
  ) return false;

  const footZ = origin[2] - getPlayer().eyeHeight();
  const contactWindow = Math.abs(delta[2]) + GROUND_SNAP;
  return footZ >= bounds.maxZ - contactWindow &&
    footZ <= bounds.maxZ + contactWindow;
}

function quakeMoverBoundsAtOffset(
  state: QuakeMoverState,
  offset: Vec3,
): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  return {
    minX: (state.model.mins.x - quakeModelPivot.x) * QUAKE_COLLISION_UNIT_SCALE + offset[0],
    maxX: (state.model.maxs.x - quakeModelPivot.x) * QUAKE_COLLISION_UNIT_SCALE + offset[0],
    minY: (state.model.mins.y - quakeModelPivot.y) * QUAKE_COLLISION_UNIT_SCALE + offset[1],
    maxY: (state.model.maxs.y - quakeModelPivot.y) * QUAKE_COLLISION_UNIT_SCALE + offset[1],
    minZ: (state.model.mins.z - quakeModelPivot.z) * QUAKE_COLLISION_UNIT_SCALE + offset[2],
    maxZ: (state.model.maxs.z - quakeModelPivot.z) * QUAKE_COLLISION_UNIT_SCALE + offset[2],
  };
}

function carryPlayerWithMover(state: QuakeMoverState, delta: Vec3): void {
  getPlayer().carryWithMover(delta, state.entity.index);
}

function applyMoverLeafTransform(leaf: QuakeFaceLeaf): void {
  const state = leaf.entityIndex !== undefined ? movers.get(leaf.entityIndex) : undefined;
  if (!state || distanceSq3(state.offset, [0, 0, 0]) <= COLLISION_EPSILON) {
    leaf.element.style.transform = leaf.baseTransform;
    return;
  }
  leaf.element.style.transform = `${quakeOffsetCss(state.offset)} ${leaf.baseTransform}`;
}

function syncQuakeButtonLeafVisual(leaf: QuakeFaceLeaf): void {
  const state = leaf.entityIndex !== undefined ? movers.get(leaf.entityIndex) : undefined;
  if (state?.kind !== "button") return;
  applyQuakeButtonLeafVisual(leaf, quakeButtonIsPressed(state));
}

function applyQuakeButtonLeafVisual(leaf: QuakeFaceLeaf, pressed: boolean): void {
  const baseTexture = leaf.buttonBaseTexture;
  const pressedTexture = leaf.buttonPressedTexture;
  const texture = pressed ? pressedTexture : baseTexture;
  if (texture) {
    setQuakeTextureAnimationLeafActive(leaf.element, true);
    leaf.element.style.backgroundImage = quakeCssUrl(texture);
    leaf.element.style.backgroundPosition = "center";
    leaf.element.style.backgroundSize = "100% 100%";
    if (pressed) {
      leaf.element.style.animationName = "none";
    } else {
      setQuakeTextureAnimationLeafActive(leaf.element, false);
      leaf.element.style.removeProperty("animation-name");
      syncQuakeTextureAnimationLeafAnimationClock(leaf.element);
    }
    syncQuakeRenderBundleDebugOutlineLeaves(leaf.element, [leaf.element]);
    return;
  }
  setQuakeTextureAnimationLeafActive(leaf.element, false);
  leaf.element.style.removeProperty("animation-name");
  leaf.element.style.backgroundImage = leaf.baseBackgroundImage;
  leaf.element.style.backgroundPosition = leaf.baseBackgroundPosition;
  leaf.element.style.backgroundSize = leaf.baseBackgroundSize;
  leaf.element.style.removeProperty("background-repeat");
  syncQuakeRenderBundleDebugOutlineLeaves(leaf.element, [leaf.element]);
}

function handleQuakeUsePointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !event.isPrimary) return;
  if (quakePlayerDead) {
    event.preventDefault();
    event.stopPropagation();
    clearQuakeAttackInput();
    audio.unlock();
    respawnQuakePlayerFromDeath();
    return;
  }
  if (!canUseQuakeGameplayInput()) return;
  event.preventDefault();
  if (quakeAttackInputDown) {
    scheduleQuakeAttackFrame();
    return;
  }
  const now = performance.now();
  const actionTrace = quakePointerActionTrace();
  if (activateQuakeButtonAtCrosshair(actionTrace)) {
    clearQuakeAttackInput();
    engageQuakePointerControls(now);
    queueQuakeCrosshairTargetSync();
    return;
  }
  engageQuakePointerControls(now);
  startQuakeAttackInput(event.pointerId, now);
}

function engageQuakePointerControls(now = performance.now()): void {
  audio.unlock();
  if (document.activeElement !== host) host.focus({ preventScroll: true });
  if (document.pointerLockElement !== host && now >= quakePointerLockRetryAt) {
    quakePointerLockRetryAt = now + QUAKE_POINTER_LOCK_RETRY_MS;
    controls.lock();
  }
}

function startQuakeAttackInput(pointerId: number, now = performance.now()): void {
  quakeAttackPointerId = pointerId;
  quakeAttackInputDown = true;
  runQuakeAttackFrame(now);
}

function handleQuakeAttackPointerEnd(event: PointerEvent): void {
  if (quakeAttackPointerId !== null && event.pointerId !== quakeAttackPointerId) return;
  clearQuakeAttackInput();
}

function clearQuakeAttackInput(): void {
  quakeAttackInputDown = false;
  quakeAttackPointerId = null;
  if (!quakeAttackFrame) return;
  window.cancelAnimationFrame(quakeAttackFrame);
  quakeAttackFrame = 0;
}

function scheduleQuakeAttackFrame(): void {
  if (quakeAppDisposed || !quakeAttackInputDown || quakeAttackFrame) return;
  quakeAttackFrame = window.requestAnimationFrame(runQuakeAttackFrame);
}

function runQuakeAttackFrame(now: number): void {
  quakeAttackFrame = 0;
  if (!quakeAttackInputDown) return;
  if (!canUseQuakeGameplayInput()) {
    clearQuakeAttackInput();
    return;
  }
  weapons.fire(now);
  if (canUseQuakeGameplayInput()) scheduleQuakeAttackFrame();
}

function setupQuakeMobileControls(): void {
  if (quakeMobileControlsRoot) return;
  const root = document.createElement("div");
  root.id = "quake-mobile-controls";
  root.setAttribute("aria-hidden", "true");

  const moveZone = document.createElement("div");
  moveZone.id = "quake-mobile-move-zone";

  const fireButton = document.createElement("button");
  fireButton.id = "quake-mobile-fire";
  fireButton.type = "button";
  fireButton.setAttribute("aria-label", "Fire");

  root.append(moveZone, fireButton);
  quakeApp.append(root);

  quakeMobileControlsRoot = root;
  quakeMobileMoveZone = moveZone;
  quakeMobileFireButton = fireButton;
  quakeMobileMoveStick = nipplejs.create({
    zone: moveZone,
    mode: "static",
    position: { left: "72px", top: "72px" },
    size: 108,
    threshold: QUAKE_MOBILE_MOVE_DEADZONE,
    dynamicPage: true,
    restOpacity: 0.58,
    fadeTime: 80,
    color: {
      front: "rgba(245, 232, 200, 0.18)",
      back: "rgba(10, 9, 7, 0.34)",
    },
  });
  quakeMobileMoveStick.on("move", handleQuakeMobileMoveStickMove);
  quakeMobileMoveStick.on("end", clearQuakeMobileMoveInput);
  fireButton.addEventListener("pointerdown", handleQuakeMobileFirePointerDown);
}

function destroyQuakeMobileControls(): void {
  clearQuakeMobileMoveInput();
  quakeMobileMoveStick?.destroy();
  quakeMobileMoveStick = null;
  quakeMobileFireButton?.removeEventListener("pointerdown", handleQuakeMobileFirePointerDown);
  quakeMobileControlsRoot?.remove();
  quakeMobileControlsRoot = null;
  quakeMobileMoveZone = null;
  quakeMobileFireButton = null;
}

function syncQuakeMobileControlsAvailability(): void {
  if (quakeMobileControlsMedia.matches) {
    setupQuakeMobileControls();
  } else {
    destroyQuakeMobileControls();
  }
  syncQuakeStatsOverlayAvailability();
}

function handleQuakeMobileMoveStickMove(event: QuakeMobileMoveStickEvent): void {
  const zone = quakeMobileMoveZone;
  const rawPosition = event.data.raw?.position;
  if (zone && rawPosition && Number.isFinite(rawPosition.x) && Number.isFinite(rawPosition.y)) {
    const rect = zone.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) / 2;
    if (radius > 0) {
      const centerX = rect.left + window.scrollX + rect.width / 2;
      const centerY = rect.top + window.scrollY + rect.height / 2;
      setQuakeMobileMoveInput((rawPosition.x - centerX) / radius, (centerY - rawPosition.y) / radius);
      return;
    }
  }

  const vector = event.data.vector;
  if (!vector) {
    clearQuakeMobileMoveInput();
    return;
  }
  setQuakeMobileMoveInput(vector.x, vector.y);
}

function setQuakeMobileMoveInput(x: number, y: number): void {
  const length = Math.hypot(x, y);
  if (length < QUAKE_MOBILE_MOVE_DEADZONE) {
    clearQuakeMobileMoveInput();
    return;
  }
  const scale = length > 1 ? 1 / length : 1;
  quakeMobileMoveX = x * scale;
  quakeMobileMoveY = y * scale;
  if (isQuakeDebugFlyModeActive()) {
    scheduleQuakeMobileMoveFrame();
  } else {
    player?.setAnalogMove(quakeMobileMoveX, quakeMobileMoveY);
  }
}

function clearQuakeMobileMoveInput(): void {
  quakeMobileMoveX = 0;
  quakeMobileMoveY = 0;
  quakeMobileMoveTime = 0;
  player?.setAnalogMove(0, 0);
  if (!quakeMobileMoveFrame) return;
  window.cancelAnimationFrame(quakeMobileMoveFrame);
  quakeMobileMoveFrame = 0;
}

function scheduleQuakeMobileMoveFrame(): void {
  if (quakeAppDisposed || quakeMobileMoveFrame) return;
  if (Math.hypot(quakeMobileMoveX, quakeMobileMoveY) < QUAKE_MOBILE_MOVE_DEADZONE) return;
  quakeMobileMoveFrame = window.requestAnimationFrame(runQuakeMobileMoveFrame);
}

function runQuakeMobileMoveFrame(now: number): void {
  quakeMobileMoveFrame = 0;
  if (Math.hypot(quakeMobileMoveX, quakeMobileMoveY) < QUAKE_MOBILE_MOVE_DEADZONE) {
    quakeMobileMoveTime = 0;
    return;
  }
  if (canUseQuakeGameplayInput()) {
    const dt = Math.min(QUAKE_MOBILE_MOVE_DT_CLAMP, quakeMobileMoveTime ? (now - quakeMobileMoveTime) / 1000 : 0.0167);
    moveQuakePlayerFromMobileStick(dt);
  }
  quakeMobileMoveTime = now;
  scheduleQuakeMobileMoveFrame();
}

function moveQuakePlayerFromMobileStick(dt: number): void {
  const origin = controls.getOrigin();
  const rotX = isQuakeDebugFlyModeActive() ? scene.camera.state.rotX ?? 88 : 90;
  const rotY = scene.camera.state.rotY ?? 270;
  const forward = forwardDirection(rotX, rotY);
  const horizontalForward = forwardDirection(90, rotY);
  const right: Vec3 = [horizontalForward[1], -horizontalForward[0], 0];
  const step = QUAKE_MOBILE_MOVE_SPEED * dt;
  const nextOrigin: [number, number, number] = [
    origin[0] + (forward[0] * quakeMobileMoveY + right[0] * quakeMobileMoveX) * step,
    origin[1] + (forward[1] * quakeMobileMoveY + right[1] * quakeMobileMoveX) * step,
    origin[2] + (isQuakeDebugFlyModeActive() ? forward[2] * quakeMobileMoveY * step : 0),
  ];
  if (isQuakeDebugFlyModeActive()) {
    getPlayer().setDebugOrigin(nextOrigin);
    controls.update({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, gravity: 0 });
    syncQuakeDebugFlyView(nextOrigin);
  } else {
    getPlayer().setAnalogMove(quakeMobileMoveX, quakeMobileMoveY);
  }
}

function handleQuakeMobileFirePointerDown(event: PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
  audio.unlock();
  if (quakePlayerDead) {
    clearQuakeAttackInput();
    respawnQuakePlayerFromDeath();
    return;
  }
  if (!canUseQuakeGameplayInput()) return;
  if (document.activeElement !== host) host.focus({ preventScroll: true });
  if (quakeAttackInputDown) {
    scheduleQuakeAttackFrame();
    return;
  }
  startQuakeAttackInput(event.pointerId, performance.now());
}

function activateQuakeButtonAtCrosshair(trace: QuakeUseTrace | null): boolean {
  if (!weapons.traceIsActionable(trace) || trace.entityIndex === undefined) return false;
  activateQuakeEntity(trace.entityIndex);
  return true;
}

function quakePointerActionTrace(): QuakeUseTrace | null {
  if (isQuakeCrosshairTargetCacheFresh()) return quakeCrosshairTargetCache.actionTrace;
  const trace = weapons.viewTraceAtCrosshair(QUAKE_BUTTON_USE_RANGE);
  cacheQuakeCrosshairActionProbe(trace);
  return quakeCrosshairTargetCache.actionTrace;
}

function syncQuakeCrosshairTarget(): void {
  if (quakeCrosshairTargetSyncFrame) {
    window.cancelAnimationFrame(quakeCrosshairTargetSyncFrame);
    quakeCrosshairTargetSyncFrame = 0;
  }
  if (!canUseQuakeGameplayInput()) {
    invalidateQuakeCrosshairTarget();
    return;
  }
  const trace = weapons.viewTraceAtCrosshair(QUAKE_BUTTON_USE_RANGE);
  if (weapons.traceIsActionable(trace)) {
    cacheQuakeCrosshairTarget(trace, null);
    document.body.classList.add("quake-action");
    return;
  }
  const weaponTrace = weapons.weaponTraceAtCrosshair();
  if (weapons.traceIsShootable(weaponTrace)) {
    cacheQuakeCrosshairTarget(null, weaponTrace);
    document.body.classList.add("quake-action");
    return;
  }
  cacheQuakeCrosshairTarget(null, null);
  document.body.classList.remove("quake-action");
}

function queueQuakeCrosshairTargetSync(): void {
  if (quakeAppDisposed || quakeCrosshairTargetSyncFrame) return;
  quakeCrosshairTargetSyncFrame = window.requestAnimationFrame(() => {
    quakeCrosshairTargetSyncFrame = 0;
    syncQuakeCrosshairTarget();
  });
}

function clearQuakeCrosshairTarget(): void {
  invalidateQuakeCrosshairTarget();
}

function invalidateQuakeCrosshairTarget(): void {
  quakeCrosshairTargetCache.actionTrace = null;
  quakeCrosshairTargetCache.shootableTrace = null;
  quakeCrosshairTargetCache.origin = null;
  quakeCrosshairTargetCache.valid = false;
  document.body.classList.remove("quake-action");
}

function cacheQuakeCrosshairActionProbe(trace: QuakeUseTrace | null): void {
  const actionTrace = weapons.traceIsActionable(trace) ? trace : null;
  cacheQuakeCrosshairTarget(actionTrace, null);
  if (actionTrace) {
    document.body.classList.add("quake-action");
  } else {
    document.body.classList.remove("quake-action");
    queueQuakeCrosshairTargetSync();
  }
}

function cacheQuakeCrosshairTarget(actionTrace: QuakeUseTrace | null, shootableTrace: QuakeUseTrace | null): void {
  const origin = controls.getOrigin();
  quakeCrosshairTargetCache.actionTrace = actionTrace;
  quakeCrosshairTargetCache.shootableTrace = shootableTrace;
  quakeCrosshairTargetCache.origin = [origin[0], origin[1], origin[2]];
  quakeCrosshairTargetCache.rotX = scene.camera.state.rotX ?? 88;
  quakeCrosshairTargetCache.rotY = scene.camera.state.rotY ?? 270;
  quakeCrosshairTargetCache.mapName = currentMapName;
  quakeCrosshairTargetCache.valid = true;
}

function isQuakeCrosshairTargetCacheFresh(): boolean {
  if (!quakeCrosshairTargetCache.valid || !quakeCrosshairTargetCache.origin) return false;
  if (quakeCrosshairTargetCache.mapName !== currentMapName) return false;
  const origin = controls.getOrigin();
  if (distanceSq3(origin, quakeCrosshairTargetCache.origin) > COLLISION_EPSILON * COLLISION_EPSILON) return false;
  return Math.abs((scene.camera.state.rotX ?? 88) - quakeCrosshairTargetCache.rotX) <= COLLISION_EPSILON &&
    Math.abs((scene.camera.state.rotY ?? 270) - quakeCrosshairTargetCache.rotY) <= COLLISION_EPSILON;
}

function handleQuakeDisableSoundOptionChange(event: Event): void {
  audio.unlock();
  setQuakeAudioMuted((event.currentTarget as HTMLInputElement).checked);
}

function handleQuakeDisableEnemiesOptionChange(event: Event): void {
  setQuakeEnemiesDisabled((event.currentTarget as HTMLInputElement).checked);
}

function handleQuakeDisableDamageOptionChange(event: Event): void {
  setQuakeDamageDisabled((event.currentTarget as HTMLInputElement).checked);
}

function exitQuakeDebugToMainMenu(): void {
  setQuakeDebugMode(false);
  menu.showMainMenu();
}

function handleQuakeDebugCloseClick(): void {
  exitQuakeDebugToMainMenu();
}

function handleQuakeDebugEscape(event: KeyboardEvent): boolean {
  if (event.code !== "Escape" || !quakeDebugMode || document.pointerLockElement === host) return false;
  event.preventDefault();
  event.stopPropagation();
  exitQuakeDebugToMainMenu();
  return true;
}

function handleQuakeDebugHideTexturesOptionChange(event: Event): void {
  setQuakeDebugHideTextures((event.currentTarget as HTMLInputElement).checked);
}

function handleQuakeDebugStaticLightingOptionChange(event: Event): void {
  setQuakeDebugStaticLighting((event.currentTarget as HTMLInputElement).checked);
}

function handleQuakeDebugFlyModeOptionChange(event: Event): void {
  setQuakeDebugFlyMode((event.currentTarget as HTMLInputElement).checked);
}

function handleQuakeDebugShowOutlinesOptionChange(event: Event): void {
  setQuakeDebugShowOutlines((event.currentTarget as HTMLInputElement).checked);
}

function handleQuakeDebugShowLabelsOptionChange(event: Event): void {
  setQuakeDebugShowLabels((event.currentTarget as HTMLInputElement).checked);
}

function handleQuakeInvertMouseOptionChange(event: Event): void {
  setQuakeInvertMouse((event.currentTarget as HTMLInputElement).checked);
}

function quakeOffsetCss(offset: Vec3): string {
  const x = offset[1] * BASE_TILE;
  const y = offset[0] * BASE_TILE;
  const z = offset[2] * BASE_TILE;
  return `translate3d(${x.toFixed(3)}px, ${y.toFixed(3)}px, ${z.toFixed(3)}px)`;
}

function currentQuakeTouchedTriggers(origin: [number, number, number]): QuakeTouchedTrigger[] {
  return [
    ...(currentCollisionWorld?.touchingTriggers?.(origin, getPlayer().eyeHeight()) ?? []),
    ...movers.touchingDoorTriggerFields(origin, getPlayer().eyeHeight()),
  ].filter((trigger) => !targetSystem.isDisabled(trigger.entityIndex));
}

function quakePlayerContentsPoint(origin: [number, number, number]): Vec3 {
  return [origin[0], origin[1], origin[2] - getPlayer().eyeHeight() + QUAKE_HAZARD_FOOT_SAMPLE_Z];
}

function strongerQuakeHazard(a: QuakeHazardDamage | null, b: QuakeHazardDamage | null): QuakeHazardDamage | null {
  if (!a) return b;
  if (!b) return a;
  return b.amount > a.amount ? b : a;
}

function currentQuakeHazard(
  origin: [number, number, number],
  triggers = currentQuakeTouchedTriggers(origin),
): QuakeHazardDamage | null {
  let hazard: QuakeHazardDamage | null = null;
  for (const trigger of triggers) {
    const entity = entityByIndex.get(trigger.entityIndex);
    if (!entity) continue;
    hazard = strongerQuakeHazard(hazard, quakeTriggerHurtDamage(entity, currentResult?.gameLogic));
  }
  hazard = strongerQuakeHazard(hazard, quakePointHazardAt(origin));
  const contents = currentCollisionWorld?.contentsAt?.(quakePlayerContentsPoint(origin));
  const contentsHazard = quakeContentsDamage(contents);
  const radsuitActive = contentsHazard?.kind === "slime" && quakePowerupActive("radsuit_finished");
  const protectedContentsHazard = quakeRadsuitProtectedContentsDamage(contentsHazard, radsuitActive);
  if (contentsHazard && !protectedContentsHazard) {
    markQuakeTrace("hazard-blocked", { kind: contentsHazard.kind, reason: "radsuit" });
  }
  return strongerQuakeHazard(hazard, protectedContentsHazard);
}

function syncQuakeHazards(
  origin = controls.getOrigin(),
  triggers = currentQuakeTouchedTriggers(origin),
): boolean {
  return getPlayer().syncHazard(currentQuakeHazard(origin, triggers));
}

function syncQuakeActiveTriggerDataset(key: string): void {
  void key;
}

function syncTouchedTriggers(origin: [number, number, number]): QuakeTouchedTrigger[] {
  return triggerSystem.sync(origin);
}

function syncQuakeDebugGameplay(origin: [number, number, number]): void {
  const transitionSerial = quakeTransitionSerial;
  const triggers = syncTouchedTriggers(origin);
  if (quakeTransitionSerial !== transitionSerial) return;

  const currentOrigin = controls.getOrigin();
  if (syncQuakeHazards(currentOrigin, triggers)) return;
  getPickups().syncCollision(currentOrigin, getPlayer().eyeHeight(), STEP_HEIGHT);
  shootables.syncVisibility(currentOrigin, true);
  getPickups().syncVisibility(currentOrigin);
  viewmodel.syncTransform();
  world.syncVisibility(true);
  syncQuakeCrosshairTarget();
}

function applyQuakeUrlView(view: QuakeUrlView): void {
  clearQuakeWeaponViewPunch(false);
  getPlayer().setDebugOrigin(view.origin);
  syncSceneCameraAt(view.origin, view.rotX, view.rotY);
  shootables.syncVisibility(view.origin, true);
  getPickups().syncVisibility(view.origin);
  viewmodel.syncTransform();
  world.syncVisibility(true);
  syncQuakeCrosshairTarget();
}

function showQuakeStatsOverlay(): void {
  if (disposeStatsOverlay || quakeAppDisposed || quakeMobileControlsMedia.matches) return;
  disposeStatsOverlay = mountStatsOverlay();
}

function hideQuakeStatsOverlay(): void {
  disposeStatsOverlay?.();
  disposeStatsOverlay = null;
}

function syncQuakeStatsOverlayAvailability(): void {
  if (quakeAppDisposed || quakeAppLoading || quakeMobileControlsMedia.matches) {
    hideQuakeStatsOverlay();
    return;
  }
  showQuakeStatsOverlay();
}

function mountStatsOverlay(): () => void {
  document.querySelector(".dn-stats-overlay")?.remove();
  const statsContainer = document.createElement("div");
  statsContainer.className = "dn-stats-overlay";
  statsContainer.setAttribute("aria-hidden", "true");
  statsContainer.style.position = "fixed";
  statsContainer.style.right = "4px";
  statsContainer.style.bottom = "clamp(4px, calc(602px - 50vw), 88px)";
  statsContainer.style.zIndex = "40";
  statsContainer.style.top = "auto";
  statsContainer.style.left = "auto";
  statsContainer.style.display = "flex";
  statsContainer.style.alignItems = "flex-end";
  statsContainer.style.gap = "2px";
  statsContainer.style.background = STATS_OVERLAY_BACKGROUND;
  statsContainer.style.opacity = "1";
  statsContainer.style.pointerEvents = "none";

  const fpsPanel = createStatsPanel("FPS", STATS_FPS_FOREGROUND, STATS_FPS_BACKGROUND, 100);
  const msPanel = createStatsPanel("MS", STATS_MS_FOREGROUND, STATS_MS_BACKGROUND, 200);
  statsContainer.append(fpsPanel.element, msPanel.element);
  document.body.appendChild(statsContainer);

  let lastFrame = performance.now();
  let fpsSampleStart = lastFrame;
  let msSampleStart = lastFrame;
  let fpsFrameCount = 0;
  let maxFrameMs = 0;
  let animationFrame = 0;
  let disposed = false;

  function tick(now: number): void {
    if (disposed) return;
    const frameMs = Math.max(0, now - lastFrame);
    lastFrame = now;
    fpsFrameCount += 1;
    if (frameMs > maxFrameMs) maxFrameMs = frameMs;

    if (now - msSampleStart >= MS_SAMPLE_MS) {
      updateStatsPanel(msPanel, maxFrameMs);
      msSampleStart = now;
      maxFrameMs = 0;
    }

    const fpsElapsed = now - fpsSampleStart;
    if (fpsElapsed >= FPS_SAMPLE_MS) {
      updateStatsPanel(fpsPanel, (fpsFrameCount * 1000) / fpsElapsed);
      fpsSampleStart = now;
      fpsFrameCount = 0;
    }

    animationFrame = window.requestAnimationFrame(tick);
  }

  animationFrame = window.requestAnimationFrame(tick);

  return () => {
    disposed = true;
    window.cancelAnimationFrame(animationFrame);
    statsContainer.remove();
  };
}

function createStatsPanel(label: string, fg: string, bg: string, max: number): QuakeStatsPanel & { element: HTMLElement } {
  const element = document.createElement("div");
  element.style.width = "80px";
  element.style.height = "48px";
  element.style.padding = "2px 3px";
  element.style.background = bg;
  element.style.color = fg;
  element.style.font = "bold 9px Helvetica, Arial, sans-serif";
  element.style.lineHeight = "1";
  element.style.textAlign = "left";
  element.style.textShadow = "0 1px 0 #000";

  const value = document.createElement("div");
  value.textContent = `0 ${label}`;
  value.style.marginBottom = "2px";

  const graph = document.createElement("div");
  graph.style.position = "relative";
  graph.style.height = `${STATS_GRAPH_HEIGHT}px`;
  graph.style.background = STATS_GRAPH_BACKGROUND;
  graph.style.overflow = "hidden";

  const canvas = document.createElement("canvas");
  canvas.width = STATS_GRAPH_WIDTH;
  canvas.height = STATS_GRAPH_HEIGHT;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = `${STATS_GRAPH_HEIGHT}px`;
  canvas.style.imageRendering = "pixelated";
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Stats panel canvas context unavailable.");
  graph.appendChild(canvas);
  element.append(value, graph);
  const panel = { element, value, canvas, context, history: [], max, label, fg };
  drawStatsPanelGraph(panel);
  return panel;
}

function updateStatsPanel(panel: QuakeStatsPanel, value: number): void {
  const rounded = Math.round(value);
  panel.value.textContent = `${rounded} ${panel.label}`;
  panel.history.push(Math.max(0, Math.min(panel.max, value)));
  while (panel.history.length > STATS_GRAPH_COLUMNS) panel.history.shift();
  drawStatsPanelGraph(panel);
}

function drawStatsPanelGraph(panel: QuakeStatsPanel): void {
  const { context } = panel;
  context.clearRect(0, 0, STATS_GRAPH_WIDTH, STATS_GRAPH_HEIGHT);
  context.fillStyle = STATS_GRAPH_BACKGROUND;
  context.fillRect(0, 0, STATS_GRAPH_WIDTH, STATS_GRAPH_HEIGHT);
  context.fillStyle = panel.fg;
  const offset = STATS_GRAPH_COLUMNS - panel.history.length;
  for (let index = 0; index < panel.history.length; index++) {
    const value = panel.history[index] ?? 0;
    const height = Math.round((value / panel.max) * STATS_GRAPH_HEIGHT);
    const x = (offset + index) * STATS_GRAPH_COLUMN_WIDTH;
    const y = STATS_GRAPH_HEIGHT - height;
    context.fillRect(x, y, STATS_GRAPH_COLUMN_WIDTH, height);
  }
}

async function fetchQuakeScene(
  url: string,
  mapName?: string,
  progress?: QuakeLoadingProgressTracker,
): Promise<QuakeScene> {
  const completeSceneTask = progress?.startTask();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}.`);
  const prepared = await response.json() as QuakePreparedScene;
  if (mapName && !prepared.renderBundle) {
    throw new Error(`Prepared Quake map ${mapName.toUpperCase()} is missing its render bundle.`);
  }
  const renderBundlePreloads = [
    ...(prepared.renderBundle ? [preloadQuakeRenderBundleAssets(prepared.renderBundle, progress)] : []),
    ...(prepared.lightstyleRenderBundle ? [preloadQuakeRenderBundleAssets(prepared.lightstyleRenderBundle, progress)] : []),
  ];
  completeSceneTask?.();
  await Promise.all(renderBundlePreloads);
  return createQuakeSceneFromPreparedScene(prepared);
}

async function loadQuakeMap(mapName: string, options: QuakeMapLoadOptions = {}): Promise<void> {
  const nextMapName = mapName.trim().toLowerCase();
  const url = quakeSceneUrl(nextMapName);
  if (!url) throw new Error(`No prepared Quake map registered for ${nextMapName}.`);
  const loadingStatus = options.loadingStatus ?? `Loading ${nextMapName.toUpperCase()}`;
  const loadingModelsStatus = options.loadingStatus ? "Loading models" : `Loading ${nextMapName.toUpperCase()} models`;
  const progress = createQuakeLoadingProgressTracker(loadingStatus);
  setQuakeLoading(true, loadingStatus);
  try {
    const scenePromise = fetchQuakeScene(url, nextMapName, progress);
    const weaponPromise = preloadWeaponViewModel(progress);
    const result = await scenePromise;
    if (quakeAppDisposed) return;
    progress.setStatus(loadingModelsStatus);
    await preloadQuakeMapModelRenderBundleAssets(nextMapName, progress);
    await preloadQuakeSceneModelRenderBundleAssets(result, progress);
    if (quakeAppDisposed) return;
    currentMapName = nextMapName;
    menu.setCurrentLevel(nextMapName);
    mountQuakeScene(result);
    if (options.view) applyQuakeUrlView(options.view);
    updateQuakeUrl(nextMapName, options.urlMode ?? "push", options.view ?? null);
    if (quakeAppDisposed) return;
    progress.setStatus("Preparing view");
    await completeQuakeSceneReadiness(weaponPromise, progress);
    if (quakeAppDisposed) return;
    if (options.resumeGameplay) resumeQuakeGameplayAfterMapLoad();
    quakeGameplayStarted = true;
  } catch (error) {
    if (!quakeAppDisposed) setQuakeLoading(false);
    throw error;
  }
}

function preloadWeaponViewModel(progress?: QuakeLoadingProgressTracker): Promise<QuakeViewmodelModel> {
  weaponViewModelPromise ??= fetchWeaponViewModel(progress);
  return weaponViewModelPromise;
}

async function fetchWeaponViewModel(progress?: QuakeLoadingProgressTracker): Promise<QuakeViewmodelModel> {
  const completeWeaponTask = progress?.startTask();
  const url = quakeAssetManifest.assets.weaponModelUrl;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}.`);
  const model = await response.json() as QuakeViewmodelModel;
  const renderBundlePreload = preloadQuakeRenderBundleAssets(model.renderBundle, progress);
  completeWeaponTask?.();
  await renderBundlePreload;
  return model;
}

async function mountWeaponViewModel(modelPromise = preloadWeaponViewModel()): Promise<void> {
  const model = await modelPromise;
  if (quakeAppDisposed) return;
  viewmodel.mount(model);
}

async function completeQuakeSceneReadiness(
  modelPromise = preloadWeaponViewModel(),
  progress?: QuakeLoadingProgressTracker,
): Promise<void> {
  await mountWeaponViewModel(modelPromise);
  if (quakeAppDisposed) return;
  const completeReadinessTask = progress?.startTask();
  const readiness = await waitForQuakeLoadingReadiness();
  completeReadinessTask?.();
  if (quakeAppDisposed) return;
  markQuakeTrace("loading-ready", {
    map: currentMapName,
    elapsedMs: readiness.elapsedMs,
    frames: readiness.frames,
    maxFrameMs: readiness.maxFrameMs,
    maxIntervalMs: readiness.maxIntervalMs,
    maxPresentDelayMs: readiness.maxPresentDelayMs,
    slowFrames: readiness.slowFrames,
    stableFrames: readiness.stableFrames,
    timedOut: readiness.timedOut,
  });
  markQuakeTrace("loading-release", { map: currentMapName, timedOut: readiness.timedOut });
  setQuakeLoading(false);
}

async function waitForQuakeLoadingReadiness(): Promise<QuakeLoadingReadinessSnapshot> {
  const startedAt = performance.now();
  let frames = 0;
  let maxFrameMs = 0;
  let maxIntervalMs = 0;
  let maxPresentDelayMs = 0;
  let previousRafAt: number | null = null;
  let slowFrames = 0;
  let stableFrames = 0;

  while (true) {
    const frame = await waitForPresentedQuakeFrame();
    frames++;

    const intervalMs = previousRafAt === null ? 0 : Math.max(0, frame.rafAt - previousRafAt);
    const presentDelayMs = Math.max(0, frame.presentedAt - frame.rafAt);
    const frameMs = Math.max(intervalMs, presentDelayMs);
    previousRafAt = frame.rafAt;

    maxFrameMs = Math.max(maxFrameMs, frameMs);
    maxIntervalMs = Math.max(maxIntervalMs, intervalMs);
    maxPresentDelayMs = Math.max(maxPresentDelayMs, presentDelayMs);

    if (frameMs <= QUAKE_LOADING_READY_FRAME_BUDGET_MS) {
      stableFrames++;
    } else {
      slowFrames++;
      stableFrames = 0;
      markQuakeTrace("loading-warmup-slow-frame", {
        map: currentMapName,
        frame: frames,
        frameMs,
        intervalMs,
        presentDelayMs,
      });
    }

    const elapsedMs = performance.now() - startedAt;
    if (
      frames >= QUAKE_LOADING_READY_MIN_PRESENTED_FRAMES &&
      stableFrames >= QUAKE_LOADING_READY_STABLE_PRESENTED_FRAMES
    ) {
      return quakeLoadingReadinessSnapshot({
        elapsedMs,
        frames,
        maxFrameMs,
        maxIntervalMs,
        maxPresentDelayMs,
        slowFrames,
        stableFrames,
        timedOut: false,
      });
    }
    if (elapsedMs >= QUAKE_LOADING_READY_TIMEOUT_MS) {
      return quakeLoadingReadinessSnapshot({
        elapsedMs,
        frames,
        maxFrameMs,
        maxIntervalMs,
        maxPresentDelayMs,
        slowFrames,
        stableFrames,
        timedOut: true,
      });
    }
  }
}

function waitForPresentedQuakeFrame(): Promise<{ presentedAt: number; rafAt: number }> {
  return new Promise((resolve) => {
    window.requestAnimationFrame((rafAt) => {
      window.setTimeout(() => {
        resolve({ rafAt, presentedAt: performance.now() });
      }, 0);
    });
  });
}

function quakeLoadingReadinessSnapshot(snapshot: QuakeLoadingReadinessSnapshot): QuakeLoadingReadinessSnapshot {
  return {
    elapsedMs: roundQuakeLoadingReadinessMs(snapshot.elapsedMs),
    frames: snapshot.frames,
    maxFrameMs: roundQuakeLoadingReadinessMs(snapshot.maxFrameMs),
    maxIntervalMs: roundQuakeLoadingReadinessMs(snapshot.maxIntervalMs),
    maxPresentDelayMs: roundQuakeLoadingReadinessMs(snapshot.maxPresentDelayMs),
    slowFrames: snapshot.slowFrames,
    stableFrames: snapshot.stableFrames,
    timedOut: snapshot.timedOut,
  };
}

function roundQuakeLoadingReadinessMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function installQuakeAppDebugHooks(): void {
  installQuakeDebugHooks(isQuakeDebugHooksEnabled(), {
    cameraRotation: () => ({
      rotX: scene.camera.state.rotX ?? 88,
      rotY: scene.camera.state.rotY ?? 270,
    }),
    copyViewUrl: copyCurrentQuakeViewUrl,
    controls: {
      getOrigin: () => controls.getOrigin(),
      setOrigin: (origin) => getPlayer().setDebugOrigin(origin),
    },
    currentMapName: () => currentMapName,
    damagePlayer: (amount) => getPlayer().damage(amount),
    debugMountEntity: (entityIndex) => shootables.debugMountEntity(entityIndex),
    entities: () => entityByIndex,
    fireWeapon: () => weapons.fire(),
    fireballEmittersCount: () => quakeFireballEmitters.length,
    fireballsCount: () => quakePointHazards.length,
    floorAt: (x, y, maxZ, minZ) =>
      currentCollisionWorld?.floorAt(x, y, maxZ, minZ) ??
      currentCollisionWorld?.staticFloorAt(x, y, maxZ, minZ) ??
      null,
    forwardDirection,
    hasCurrentScene: () => currentResult !== null,
    hideMainMenu: () => menu.hideMainMenu(),
    inventory: () => getPlayer().inventory(),
    isLoading: () => quakeAppLoading,
    loadMap: loadQuakeMap,
    mapExists: (mapName) => Boolean(quakeSceneUrl(mapName)),
    moversStats: () => movers.debugStats(),
    playerEyeHeight: () => getPlayer().eyeHeight(),
    playerMoveDebug: () => getPlayer().debugMovement(),
    pointToPoly: quakePointToPoly,
    setCollisionBypassUntil: (until) => {
      quakeDebugCollisionBypassUntil = until;
    },
    shootablesStats: () => shootables.debugStats(),
    syncCrosshairTarget: syncQuakeCrosshairTarget,
    syncGameplay: syncQuakeDebugGameplay,
    syncPickupsVisibility: (origin) => getPickups().syncVisibility(origin),
    syncSceneCameraAt,
    syncShootablesVisibility: (origin, force) => shootables.syncVisibility(origin, force),
    syncViewmodel: () => viewmodel.syncTransform(),
    syncWorldVisibility: (force) => world.syncVisibility(force),
    viewUrl: currentQuakeViewUrl,
    worldStats: () => world.debugStats(),
  });
}

async function loadPickupModels(progress?: QuakeLoadingProgressTracker): Promise<void> {
  const completePickupTask = progress?.startTask();
  const url = quakeAssetManifest.assets.pickupModelsUrl;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}.`);
  const library = await response.json() as QuakePickupModelLibrary;
  if (quakeAppDisposed) return;
  currentPickupModelLibrary = library;
  completePickupTask?.();
}

async function preloadQuakeMapModelRenderBundleAssets(
  mapName: string,
  progress?: QuakeLoadingProgressTracker,
): Promise<void> {
  const library = currentPickupModelLibrary;
  if (!library) return;
  const map = quakeAssetManifest.maps.find((item) => item.mapName === mapName);
  const modelPaths = map?.modelPaths;
  if (!modelPaths) {
    return;
  }
  await preloadQuakePickupModelRenderBundleAssets(library, modelPaths, progress);
}

async function preloadQuakeSceneModelRenderBundleAssets(
  result: QuakeScene,
  progress?: QuakeLoadingProgressTracker,
): Promise<void> {
  const library = currentPickupModelLibrary;
  if (!library) return;
  const modelPaths = new Set<string>();
  const runtime = result.entityManifest.runtime;
  const entitiesByIndex = new Map(result.entities.map((entity) => [entity.index, entity]));
  const pickupEntities = quakeSceneEntitiesForIndexes(entitiesByIndex, runtime.pickupEntityIndexes);
  for (const entity of pickupEntities) {
    if (!shouldSpawnQuakeEntityForCurrentGame(entity)) continue;
    const modelPath = quakePickupModelPath(entity, currentProgramMetadata, result.gameLogic);
    if (modelPath) modelPaths.add(modelPath);
  }
  const shootableEntities = quakeSceneEntitiesForIndexes(entitiesByIndex, runtime.shootableEntityIndexes);
  for (const entity of shootableEntities) {
    if (!shouldSpawnQuakeEntityForCurrentGame(entity)) continue;
    const modelPath = quakeShootableModelPath(entity, currentProgramMetadata);
    if (modelPath) modelPaths.add(modelPath);
  }
  await preloadQuakePickupModelRenderBundleAssets(library, modelPaths, progress);
}

function quakeSceneEntitiesForIndexes(
  entitiesByIndex: ReadonlyMap<number, QuakeEntity>,
  indexes: readonly number[],
): QuakeEntity[] {
  const out: QuakeEntity[] = [];
  const seen = new Set<number>();
  for (const index of indexes) {
    if (seen.has(index)) continue;
    seen.add(index);
    const entity = entitiesByIndex.get(index);
    if (entity) out.push(entity);
  }
  return out;
}

async function preloadQuakePickupModelRenderBundleAssets(
  library: QuakePickupModelLibrary,
  modelPaths: Iterable<string>,
  progress?: QuakeLoadingProgressTracker,
): Promise<void> {
  const bundles = new Set<QuakePreparedRenderBundle>();
  for (const modelPath of modelPaths) {
    const model = library.models[modelPath];
    if (!model) continue;
    if (model.renderBundle) bundles.add(model.renderBundle);
    const frameSet = quakePickupModelRenderBundleFrameSet(model);
    if (frameSet) {
      bundles.add(frameSet.renderBundle);
    }
    for (const frame of model.animationFrames ?? []) bundles.add(frame.renderBundle);
  }
  await Promise.all([...bundles].map((renderBundle) => preloadQuakeRenderBundleAssets(renderBundle, progress)));
}

async function loadProgramMetadata(progress?: QuakeLoadingProgressTracker): Promise<void> {
  const completeMetadataTask = progress?.startTask();
  const url = quakeAssetManifest.assets.programMetadataUrl;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}.`);
  const metadata = await response.json() as QuakeProgramMetadata;
  if (quakeAppDisposed) return;
  currentProgramMetadata = metadata;
  completeMetadataTask?.();
}

async function loadSoundManifest(): Promise<void> {
  const url = quakeAssetManifest.assets.soundManifestUrl;
  if (!url) {
    audio.setManifest(null);
    return;
  }
  try {
    const response = await fetch(url);
    if (response.status === 404) {
      audio.setManifest(null);
      return;
    }
    if (!response.ok) throw new Error(`Could not load ${url}.`);
    const manifest = normalizeQuakeSoundManifest(await response.json());
    if (quakeAppDisposed) return;
    audio.setManifest(manifest);
  } catch (error) {
    console.warn(error);
    audio.setManifest(null);
  }
}

function ensureQuakeSoundManifestLoaded(): Promise<void> {
  quakeSoundManifestPromise ??= loadSoundManifest();
  return quakeSoundManifestPromise;
}

async function fetchQuakeAssetManifest(): Promise<QuakeAssetManifest> {
  const response = await fetch(QUAKE_MANIFEST_URL, { cache: "no-store" });
  if (response.status === 404) return FALLBACK_QUAKE_ASSET_MANIFEST;
  if (!response.ok) throw new Error(`Could not load ${QUAKE_MANIFEST_URL}.`);
  let rawManifest: unknown;
  try {
    rawManifest = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new QuakeAssetsRegeneratingError();
    throw error;
  }
  if (isQuakeAssetManifestRegenerating(rawManifest)) {
    const message = typeof rawManifest.message === "string"
      ? rawManifest.message
      : QUAKE_ASSETS_REGENERATING_ACTION;
    throw new QuakeAssetsRegeneratingError(message);
  }
  return normalizeQuakeAssetManifest(rawManifest);
}

function normalizeQuakeAssetManifest(value: unknown): QuakeAssetManifest {
  if (!isRecord(value)) throw new Error("Invalid Quake asset manifest.");
  const rawMaps = Array.isArray(value.maps) ? value.maps : [];
  const maps = rawMaps.map(normalizeQuakeAssetManifestMap).filter((map): map is QuakeAssetManifestMap => Boolean(map));
  if (!maps.length) throw new Error("Quake asset manifest has no maps.");
  const mapNames = new Set(maps.map((map) => map.mapName));
  const requestedStartMap = typeof value.startMap === "string" ? value.startMap.trim().toLowerCase() : "";
  const startMap = mapNames.has(requestedStartMap)
    ? requestedStartMap
    : mapNames.has(FALLBACK_QUAKE_ASSET_MANIFEST.startMap)
      ? FALLBACK_QUAKE_ASSET_MANIFEST.startMap
      : maps[0].mapName;
  return {
    version: typeof value.version === "number" ? value.version : 1,
    ...(typeof value.assetRoot === "string" ? { assetRoot: value.assetRoot } : {}),
    startMap,
    maps,
    assets: normalizeQuakeAssetManifestAssets(value.assets),
  };
}

function isQuakeAssetManifestRegenerating(value: unknown): value is { message?: unknown; status: string } {
  if (!isRecord(value) || typeof value.status !== "string") return false;
  const status = value.status.trim().toLowerCase();
  return status === "regenerating" || status === "generating";
}

function normalizeQuakeAssetManifestMap(value: unknown): QuakeAssetManifestMap | null {
  if (!isRecord(value) || typeof value.mapName !== "string" || typeof value.sceneUrl !== "string") return null;
  const mapName = value.mapName.trim().toLowerCase();
  const sceneUrl = value.sceneUrl.trim();
  if (!mapName || !sceneUrl) return null;
  return {
    mapName,
    sceneUrl,
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.pakPath === "string" ? { pakPath: value.pakPath } : {}),
    ...(typeof value.selectable === "boolean" ? { selectable: value.selectable } : {}),
    ...(Array.isArray(value.modelPaths) ? {
      modelPaths: value.modelPaths
        .filter((modelPath): modelPath is string => typeof modelPath === "string")
        .map((modelPath) => modelPath.trim().toLowerCase())
        .filter(Boolean),
    } : {}),
  };
}

function normalizeQuakeAssetManifestAssets(value: unknown): QuakeAssetManifest["assets"] {
  const fallback = FALLBACK_QUAKE_ASSET_MANIFEST.assets;
  if (!isRecord(value)) return fallback;
  return {
    weaponModelUrl: typeof value.weaponModelUrl === "string" ? value.weaponModelUrl : fallback.weaponModelUrl,
    pickupModelsUrl: typeof value.pickupModelsUrl === "string" ? value.pickupModelsUrl : fallback.pickupModelsUrl,
    programMetadataUrl: typeof value.programMetadataUrl === "string" ? value.programMetadataUrl : fallback.programMetadataUrl,
    soundManifestUrl: typeof value.soundManifestUrl === "string" ? value.soundManifestUrl : fallback.soundManifestUrl,
  };
}

function normalizeQuakeSoundManifest(value: unknown): QuakeSoundManifest {
  const sounds: Record<string, string> = {};
  if (isRecord(value) && isRecord(value.sounds)) {
    for (const [key, url] of Object.entries(value.sounds)) {
      if (typeof url === "string") sounds[key] = url;
    }
  }
  return {
    version: isRecord(value) && typeof value.version === "number" ? value.version : 1,
    sounds,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function loadQuake(): Promise<void> {
  const progress = createQuakeLoadingProgressTracker("Loading");
  setQuakeLoading(true);
  progress.setStatus("Loading manifest");
  setQuakeAssetManifest(await fetchQuakeAssetManifest());
  const startupRoute = quakeUrlRouteFromLocation();
  const startMap = startupRoute.mapName;
  const startupSceneUrl = quakeSceneUrl(startMap);
  if (!startupSceneUrl) throw new Error(`No prepared Quake start map registered for ${startMap}.`);
  progress.setStatus(`Loading ${startMap.toUpperCase()}`);
  const programMetadataPromise = loadProgramMetadata(progress);
  const pickupModelsPromise = loadPickupModels(progress);
  const startupScenePromise = fetchQuakeScene(startupSceneUrl, startMap, progress);
  const weaponPromise = preloadWeaponViewModel(progress);
  await Promise.all([programMetadataPromise, pickupModelsPromise]);
  if (quakeAppDisposed) return;
  const result = await startupScenePromise;
  if (quakeAppDisposed) return;
  progress.setStatus(`Loading ${startMap.toUpperCase()} models`);
  await preloadQuakeMapModelRenderBundleAssets(startMap, progress);
  await preloadQuakeSceneModelRenderBundleAssets(result, progress);
  if (quakeAppDisposed) return;
  currentMapName = startMap;
  menu.setCurrentLevel(currentMapName);
  mountQuakeScene(result);
  if (startupRoute.view) applyQuakeUrlView(startupRoute.view);
  if (quakeUrlRouteIsDirect(startupRoute)) updateQuakeUrl(startMap, "replace", startupRoute.view);
  if (quakeAppDisposed) return;
  progress.setStatus("Preparing view");
  await completeQuakeSceneReadiness(weaponPromise, progress);
  if (quakeAppDisposed) return;
  syncQuakeRoutePresentation(startupRoute);
}

function syncQuakeRoutePresentation(route: QuakeUrlRoute): void {
  if (QUAKE_MENU_ENABLED && !quakeUrlRouteIsDirect(route)) {
    menu.showMainMenu();
  } else {
    quakeGameplayStarted = true;
    menu.hideMainMenu();
  }
}

function handleQuakePopState(): void {
  if (quakeAppDisposed || quakeAppLoading) return;
  const route = quakeUrlRouteFromLocation();
  if (currentMapName === route.mapName && currentResult) {
    if (route.view) {
      applyQuakeUrlView(route.view);
      syncQuakeRoutePresentation(route);
      return;
    }
    if (route.mapParamPresent) {
      navigateToQuakeRoute(route);
      return;
    }
    syncQuakeRoutePresentation(route);
    return;
  }
  navigateToQuakeRoute(route);
}

function navigateToQuakeRoute(route: QuakeUrlRoute): void {
  void loadQuakeMap(route.mapName, { urlMode: "none", view: route.view })
    .then(() => {
      if (!quakeAppDisposed) syncQuakeRoutePresentation(route);
    })
    .catch((error) => {
      console.error(error);
      if (!quakeAppDisposed) {
        if (error instanceof QuakeAssetsRegeneratingError) {
          setQuakeAssetsRegenerating(error.message);
        } else {
          setQuakeLoadingError();
        }
      }
    });
}

function handleWindowKeyDown(event: KeyboardEvent): void {
  audio.unlock();
  if (event.code === "KeyM" && !isEditableKeyboardTarget(event.target)) {
    event.preventDefault();
    event.stopPropagation();
    toggleQuakeAudioMuted();
    return;
  }
  if (handleQuakeDebugEscape(event)) {
    return;
  }
  if (quakeAppLoading) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (menu.handleKeyDown(event)) {
    clearQuakeMoveInput();
    clearQuakeCrouchInput();
    clearQuakeAttackInput();
    return;
  }
  if (handleQuakeDebugFlyKey(event, true)) {
    return;
  }
  if (shouldPreventQuakeGameplayKeyDefault(event)) {
    event.preventDefault();
  }
  handleQuakeMoveKey(event, true);
  handleQuakeCrouchKey(event, true);
  if (event.code === "KeyF") {
    event.preventDefault();
    host.focus();
  }
}

function handleWindowKeyUp(event: KeyboardEvent): void {
  if (handleQuakeDebugFlyKey(event, false)) {
    return;
  }
  if (shouldPreventQuakeGameplayKeyDefault(event)) {
    event.preventDefault();
  }
  handleQuakeMoveKey(event, false);
  handleQuakeCrouchKey(event, false);
  if (QUAKE_MOVE_KEY_CODES.has(event.code) && !isEditableKeyboardTarget(event.target)) {
    viewmodel.syncTransform();
  }
}

function handleWindowBlur(): void {
  clearQuakeAttackInput();
  clearQuakeDebugFlyInput();
  clearQuakeMoveInput();
  clearQuakeMobileMoveInput();
  clearQuakeWeaponViewPunch();
  clearQuakeCrouchInput();
}

function handleViewportResize(): void {
  syncQuakeViewportProjection();
  viewmodel.queueViewportSync();
}

function syncPlayerCollision(): void {
  if (import.meta.env.DEV && performance.now() < quakeDebugCollisionBypassUntil) return;
  if (isQuakeDebugFlyModeActive()) return;
  getPlayer().syncCollision();
}

function disposeQuakeApp(): void {
  quakeAppDisposed = true;
  window.removeEventListener("keydown", handleWindowKeyDown, { capture: true });
  window.removeEventListener("keyup", handleWindowKeyUp, { capture: true });
  window.removeEventListener("blur", handleWindowBlur);
  window.removeEventListener("pointerup", handleQuakeAttackPointerEnd, { capture: true });
  window.removeEventListener("pointercancel", handleQuakeAttackPointerEnd, { capture: true });
  window.removeEventListener("popstate", handleQuakePopState);
  window.removeEventListener("resize", handleViewportResize);
  window.visualViewport?.removeEventListener("resize", handleViewportResize);
  quakeMobileControlsMedia.removeEventListener("change", syncQuakeMobileControlsAvailability);
  host.removeEventListener("pointerdown", handleQuakeUsePointerDown, { capture: true });
  clearQuakeMoveInput();
  clearQuakeAttackInput();
  clearQuakeDebugFlyInput();
  clearQuakeWeaponViewPunch(false);
  clearQuakeBonusOverlay();
  destroyQuakeMobileControls();
  if (quakeCameraStepSmoothFrame) {
    window.cancelAnimationFrame(quakeCameraStepSmoothFrame);
    quakeCameraStepSmoothFrame = 0;
  }
  if (quakeCrosshairTargetSyncFrame) {
    window.cancelAnimationFrame(quakeCrosshairTargetSyncFrame);
    quakeCrosshairTargetSyncFrame = 0;
  }
  invalidateQuakeCrosshairTarget();
  disableSoundOption?.removeEventListener("change", handleQuakeDisableSoundOptionChange);
  disableEnemiesOption?.removeEventListener("change", handleQuakeDisableEnemiesOptionChange);
  disableDamageOption?.removeEventListener("change", handleQuakeDisableDamageOptionChange);
  debugPanelClose?.removeEventListener("click", handleQuakeDebugCloseClick);
  debugHideTexturesOption?.removeEventListener("change", handleQuakeDebugHideTexturesOptionChange);
  debugStaticLightingOption?.removeEventListener("change", handleQuakeDebugStaticLightingOptionChange);
  debugFlyModeOption?.removeEventListener("change", handleQuakeDebugFlyModeOptionChange);
  debugShowOutlinesOption?.removeEventListener("change", handleQuakeDebugShowOutlinesOptionChange);
  debugShowLabelsOption?.removeEventListener("change", handleQuakeDebugShowLabelsOptionChange);
  invertMouseOption?.removeEventListener("change", handleQuakeInvertMouseOptionChange);
  stopQuakeDebugPanelStats();
  document.removeEventListener("pointerlockchange", syncQuakeDebugPointerLockState);
  controls.removeEventListener("change", syncPlayerCollision);
  controls.removeEventListener("start", clearQuakeMainMenuControlsEndSuppression);
  controls.removeEventListener("end", clearQuakeCrouchInput);
  controls.removeEventListener("end", clearQuakeAttackInput);
  menu.dispose();
  audio.dispose();
  hideQuakeStatsOverlay();
  disposeCurrentScene();
}

window.addEventListener("keydown", handleWindowKeyDown, { capture: true });
window.addEventListener("keyup", handleWindowKeyUp, { capture: true });
window.addEventListener("blur", handleWindowBlur);
window.addEventListener("pointerup", handleQuakeAttackPointerEnd, { capture: true });
window.addEventListener("pointercancel", handleQuakeAttackPointerEnd, { capture: true });
window.addEventListener("popstate", handleQuakePopState);
window.addEventListener("resize", handleViewportResize);
window.visualViewport?.addEventListener("resize", handleViewportResize);
quakeMobileControlsMedia.addEventListener("change", syncQuakeMobileControlsAvailability);
document.addEventListener("pointerlockchange", syncQuakeDebugPointerLockState);

host.addEventListener("pointerdown", handleQuakeUsePointerDown, { capture: true });
disableSoundOption?.addEventListener("change", handleQuakeDisableSoundOptionChange);
disableEnemiesOption?.addEventListener("change", handleQuakeDisableEnemiesOptionChange);
disableDamageOption?.addEventListener("change", handleQuakeDisableDamageOptionChange);
debugPanelClose?.addEventListener("click", handleQuakeDebugCloseClick);
debugHideTexturesOption?.addEventListener("change", handleQuakeDebugHideTexturesOptionChange);
debugStaticLightingOption?.addEventListener("change", handleQuakeDebugStaticLightingOptionChange);
debugFlyModeOption?.addEventListener("change", handleQuakeDebugFlyModeOptionChange);
debugShowOutlinesOption?.addEventListener("change", handleQuakeDebugShowOutlinesOptionChange);
debugShowLabelsOption?.addEventListener("change", handleQuakeDebugShowLabelsOptionChange);
invertMouseOption?.addEventListener("change", handleQuakeInvertMouseOptionChange);
controls.addEventListener("change", syncPlayerCollision);
controls.addEventListener("start", clearQuakeMainMenuControlsEndSuppression);
controls.addEventListener("end", clearQuakeCrouchInput);
controls.addEventListener("end", clearQuakeAttackInput);

syncQuakeHud();
syncQuakeOptionControls();
syncQuakeMobileControlsAvailability();
installQuakeAppDebugHooks();

void loadQuake().catch((error) => {
  console.error(error);
  if (!quakeAppDisposed) {
    if (error instanceof QuakeAssetsRegeneratingError) {
      setQuakeAssetsRegenerating(error.message);
    } else {
      setQuakeLoadingError();
    }
  }
});

const hot = import.meta as ImportMeta & { hot?: { dispose(callback: () => void): void } };
hot.hot?.dispose(disposeQuakeApp);
