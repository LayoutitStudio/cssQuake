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
import { QUAKE_PLAYER_WEAPON_FIRE_FACTS } from "./generated/quakeProgramFacts";
import {
  quakeGameLogicEntityFact,
  type QuakeGameLogicGeneratedTextFact,
  type QuakeGameLogicTextFact,
} from "./prepare/gameLogicFacts";
import { createQuakeSoundController, type QuakeSoundEvent, type QuakeSoundManifest } from "./runtime/audio";
import { mountQuakeBitmapText } from "./runtime/bitmapText";
import {
  COLLISION_EPSILON,
  GROUND_SNAP,
  PLAYER_RADIUS,
  QUAKE_BUTTON_USE_RANGE,
  QUAKE_COLLISION_UNIT_SCALE,
  QUAKE_PLAYER_MINS_Z,
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
  selectQuakeBestInventoryWeapon,
  syncQuakeHud as syncQuakeHudElements,
  type QuakeInventoryPowerupBehavior,
  type QuakeWeaponId,
} from "./runtime/hud";
import {
  quakeContentsDamage,
  quakePlayerWaterLevel,
  quakeRadsuitProtectedContentsDamage,
  quakeTriggerHurtDamage,
  type QuakeHazardDamage,
} from "./runtime/hazards";
import {
  QUAKE_POINT_HAZARD_DT_CLAMP,
  quakeFireballEmitterFromEntity,
  quakeMovePointHazards,
  quakeSpawnDueFireballs,
  type QuakeFireballEmitter,
  type QuakePointHazard,
} from "./runtime/fireballs";
import { crossVec3, distanceSq3, dotVec3, normalizeVec3, subtractVec3 } from "./runtime/math";
import { createQuakeMenuController } from "./runtime/menu";
import {
  createQuakeMoversController,
  quakeButtonIsPressed,
  quakeDoorTerminalState,
  quakeMoverBlockDamage,
  quakeMoverBlockDamageCooldownMs,
  type QuakeMoversProgressSnapshot,
  type QuakeMoverState,
} from "./runtime/movers";
import { createQuakeMonsterStateRunner } from "./runtime/quakeMonsterStateRunner";
import {
  createQuakeShootablesController,
  quakeShootableModelPath,
  quakeShootableFallbackPolygons,
  type QuakeShootablesDebugStats,
  type QuakeShootablesControllerOptions,
  type QuakeShootableBounds,
  type QuakeShootablesProgressSnapshot,
} from "./runtime/shootables";
import { quakeSolidGateActivation } from "./runtime/solidGates";
import {
  createQuakeTargetsController,
  type QuakeCounterActivationResult,
  type QuakeTargetsProgressSnapshot,
} from "./runtime/targets";
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
import {
  createQuakeViewmodelController,
  type QuakeViewmodelFireAnimation,
  type QuakeViewmodelModel,
} from "./runtime/viewmodel";
import {
  createQuakeWeaponsController,
  type QuakeWeaponFireSoundId,
  type QuakeWeaponLightningBeamVisual,
  type QuakeWeaponProjectileVisualHandle,
} from "./runtime/weapons";
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
  type QuakePickupProgressSnapshot,
  type QuakePickupModel,
  type QuakePickupModelLibrary,
  type QuakeProgramMetadata,
} from "./runtime/pickups";
import {
  createQuakePlayerController,
  type QuakePlayerDamageFeedback,
  type QuakePlayerProgressSnapshot,
} from "./runtime/player";
import {
  mountQuakeRenderBundleFrameSetMesh,
  mountQuakeRenderBundleMesh,
  preloadQuakeRenderBundleAssets,
  syncQuakeRenderBundleDebugLabels,
  syncQuakeRenderBundleDebugOutlineLeaves,
  syncQuakeRenderBundleDebugOutlines,
  stripPolyMeshMetadata,
} from "./runtime/renderBundleMesh";

declare const __CSSQUAKE_VERSION__: string;

const quakeApp = document.getElementById("quake-app") as HTMLElement;
const quakeUi = document.getElementById("quake-ui") as HTMLElement | null;
const viewmodelLayer = document.getElementById("quake-viewmodel-layer") as HTMLElement | null;
const mainMenu = document.getElementById("quake-main-menu") as HTMLElement | null;
const mainMenuArt = document.getElementById("quake-main-menu-art") as HTMLElement | null;
const versionLabel = document.getElementById("cssquake-version") as HTMLElement | null;
const singlePlayerPanel = document.getElementById("quake-single-player-panel") as HTMLElement | null;
const levelPanel = document.getElementById("quake-level-panel") as HTMLElement | null;
const levelList = document.getElementById("quake-level-list") as HTMLElement | null;
const aboutPanel = document.getElementById("quake-about-panel") as HTMLElement | null;
const optionsPanel = document.getElementById("quake-options-panel") as HTMLElement | null;
const debugMenuPanel = document.getElementById("quake-debug-menu-panel") as HTMLElement | null;
const disableSoundOption = document.getElementById("quake-option-disable-sound") as HTMLInputElement | null;
const disableEnemiesOption = document.getElementById("quake-option-disable-enemies") as HTMLInputElement | null;
const disableDamageOption = document.getElementById("quake-option-disable-damage") as HTMLInputElement | null;
const invertMouseOption = document.getElementById("quake-option-invert-mouse") as HTMLInputElement | null;
const alwaysRunOption = document.getElementById("quake-option-always-run") as HTMLInputElement | null;
const showGunOption = document.getElementById("quake-option-show-gun") as HTMLInputElement | null;
const dynamicLightingOption = document.getElementById("quake-option-dynamic-lighting") as HTMLInputElement | null;
const debugPanel = document.getElementById("quake-debug-panel") as HTMLElement | null;
const debugEnabledOption = document.getElementById("quake-debug-enabled") as HTMLInputElement | null;
const debugShowFpsOption = document.getElementById("quake-debug-show-fps") as HTMLInputElement | null;
const debugShowTexturesOption = document.getElementById("quake-debug-show-textures") as HTMLInputElement | null;
const debugFlyModeOption = document.getElementById("quake-debug-fly-mode") as HTMLInputElement | null;
const debugShowOutlinesOption = document.getElementById("quake-debug-show-outlines") as HTMLInputElement | null;
const debugShowLabelsOption = document.getElementById("quake-debug-show-labels") as HTMLInputElement | null;
const debugStatElements = new Map(
  Array.from(document.querySelectorAll<HTMLElement>("[data-qstat]"))
    .map((element) => [element.getAttribute("data-qstat") ?? "", element] as const)
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
const QUAKE_LOADING_CONSOLE_BOOT_LINES = [
  "Quake (C) 1996 id Software, Inc.",
  "Shareware version 1.06",
  "Host_Init",
] as const;
const QUAKE_LOADING_CONSOLE_PAK_LINE = "Assets from id1/pak0.pak";
const QUAKE_LOADING_CONSOLE_LINE_DELAY_MS = 55;
const QUAKE_LOADING_CONSOLE_MAX_LINES = 28;
const QUAKE_LOADING_ERROR_LINE_LIMIT = 10;
const QUAKE_LOADING_ERROR_LINE_MAX_CHARS = 42;
const QUAKE_LOADING_READY_MIN_PRESENTED_FRAMES = 6;
const QUAKE_LOADING_READY_STABLE_PRESENTED_FRAMES = 3;
let quakeLoadingConsoleLines: string[] = [];
let quakeLoadingConsoleLineKeys: (string | null)[] = [];
let quakeLoadingConsoleLineQueue: { key: string | null; line: string }[] = [];
let quakeLoadingConsoleLastStatus = "";
let quakeLoadingConsoleCurrentStatus = "";
let quakeLoadingConsoleLineTimer: number | null = null;

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
let quakePointerTraceSerial = 0;
let quakeMobileControlsRoot: HTMLElement | null = null;
let quakeMobileMoveZone: HTMLElement | null = null;
let quakeMobileLookZone: HTMLElement | null = null;
let quakeMobileFireButton: HTMLButtonElement | null = null;
let quakeMobileMoveStick: ReturnType<typeof nipplejs.create> | null = null;
let quakeMobileMoveFrame = 0;
let quakeMobileMoveTime = 0;
let quakeMobileMoveX = 0;
let quakeMobileMoveY = 0;
let quakeMobileLookPointerId: number | null = null;
let quakeMobileLookLastX = 0;
let quakeMobileLookLastY = 0;
let quakeDebugFlyFrame = 0;
let quakeDebugFlyTime = 0;
let quakeDebugFlyKeyCodesDown = new Set<string>();
let quakeParentRelayedKeyCodesDown = new Map<string, string>();
let quakeWeaponViewPunchFrame = 0;
let quakeWeaponViewPunchOffset = 0;
let quakeWeaponViewPunchAt = 0;
let quakeWeaponViewPunchBaseRotX: number | null = null;
let quakeBonusFlashTimer: number | null = null;
let quakeBonusFlashSerial = 0;
const QUAKE_LOADING_READY_FRAME_BUDGET_MS = 45;
const QUAKE_LOADING_READY_TIMEOUT_MS = 1500;
const QUAKE_DEATH_UNLOCK_MENU_SUPPRESS_MS = 1000;
const QUAKE_DEATH_UNLOCK_CONTROLS_END_TRACE_SUPPRESS_MS = 1000;
const QUAKE_MENU_RESUME_CONTROLS_END_SUPPRESS_MS = 350;
const QUAKE_POINTER_LOCK_RETRY_MS = 500;
const QUAKE_POINTER_TRACE_LIMIT = 200;
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
const QUAKE_URL_VIEW_PART_COUNT = 6;
const QUAKE_URL_NUMBER_SCALE = 1000;
const QUAKE_URL_VIEW_ORIGIN_LIMIT = 100000;
const QUAKE_URL_VIEW_PITCH_MIN = -90;
const QUAKE_URL_VIEW_PITCH_MAX = 90;
const QUAKE_URL_VIEW_ANGLE_LIMIT = 36000;
const QUAKE_URL_VIEW_ROLL_EPSILON = 0.001;
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
    weaponModelUrls?: Record<string, string>;
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
  startTask(status?: string): () => void;
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
  pitch: number;
  yaw: number;
  roll: number;
}

interface QuakeCssView {
  origin: [number, number, number];
  rotX: number;
  rotY: number;
}

interface QuakeUrlRoute {
  mapName: string;
  mapParamPresent: boolean;
  mapParamValid: boolean;
  view: QuakeUrlView | null;
}

interface QuakeMapLoadOptions {
  loadingStatus?: string;
  urlMode?: QuakeUrlUpdateMode;
  resumeGameplay?: boolean;
  view?: QuakeUrlView | null;
}

const CSSQUAKE_SAVE_SLOT_VERSION = 1;
const CSSQUAKE_SAVE_SLOT_KEY = "cssquake.save.v1";

interface CssQuakeProgressViewSnapshot {
  origin: [number, number, number];
  rotX: number;
  rotY: number;
}

interface CssQuakeDamageableBrushProgressEntry {
  entityIndex: number;
  health: number;
}

interface CssQuakeDamageableBrushProgressSnapshot {
  brushes: CssQuakeDamageableBrushProgressEntry[];
}

interface CssQuakeSaveSlotV1 {
  version: typeof CSSQUAKE_SAVE_SLOT_VERSION;
  savedAt: number;
  mapName: string;
  view: CssQuakeProgressViewSnapshot;
  damageableBrushes?: CssQuakeDamageableBrushProgressSnapshot;
  player: QuakePlayerProgressSnapshot;
  pickups: QuakePickupProgressSnapshot;
  shootables: QuakeShootablesProgressSnapshot;
  movers: QuakeMoversProgressSnapshot;
  targets: QuakeTargetsProgressSnapshot;
}

type QuakePointerTraceValue = string | number | boolean | null;
type QuakePointerTraceDetails = Record<string, QuakePointerTraceValue>;

interface QuakePointerTraceEntry {
  id: number;
  at: number;
  kind: string;
  details: QuakePointerTraceDetails;
}

interface QuakePointerTraceWindow {
  __cssQuakePointerTrace?: QuakePointerTraceEntry[];
  __cssQuakePointerTraceClear?: () => void;
  __cssQuakePointerTraceDump?: () => string;
}

type QuakeBossLightningAlignment = Parameters<
  NonNullable<QuakeShootablesControllerOptions["bossLightningElectrodesReady"]>
>[1];
type QuakeBossLightningDischarge = Parameters<
  NonNullable<QuakeShootablesControllerOptions["bossLightningDischarge"]>
>[1];

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
    weaponModelUrls: {
      "progs/v_shot.mdl": `${QUAKE_ASSET_ROOT}/weapon.json`,
    },
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
  "ShiftLeft",
  "ShiftRight",
  "Space",
]);
const QUAKE_PARENT_KEY_MESSAGE_TYPE = "cssquake:key";
const QUAKE_PARENT_KEY_RELAY_ENABLED = new URLSearchParams(window.location.search).get("relayKeys") === "1";
const QUAKE_PARENT_KEY_TARGET_ORIGIN = quakeParentKeyTargetOrigin();
const QUAKE_MOVE_KEY_CODES = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "KeyA", "KeyD", "KeyS", "KeyW"]);
const QUAKE_SPEED_KEY_CODES = new Set(["ShiftLeft", "ShiftRight"]);
const QUAKE_CROUCH_KEY_CODES = new Set(["ControlLeft", "ControlRight"]);
const QUAKE_JUMP_VELOCITY = 270 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_GRAVITY = 800 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MOBILE_MOVE_SPEED = 5.4 * QUAKE_RENDER_SUPERSAMPLE;
const QUAKE_MOBILE_MOVE_DEADZONE = 0.08;
const QUAKE_MOBILE_MOVE_DT_CLAMP = 0.035;
const QUAKE_MOBILE_LOOK_SENSITIVITY = 0.12;
const QUAKE_MOBILE_LOOK_EPSILON = 0.01;
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
const quakeDebugPointerTraceConsole = quakeUrlBoolean("debugPointer");
let quakeDebugShowFps = debugShowFpsOption?.checked ?? true;
let quakeDebugHideTextures = debugShowTexturesOption ? !debugShowTexturesOption.checked : false;
let quakeDebugFlyMode = quakeUrlBoolean("debugFly") || (debugFlyModeOption?.checked ?? false);
let quakeDebugFlyModeActive = false;
let quakeDebugShowOutlines = debugShowOutlinesOption?.checked ?? false;
let quakeDebugShowLabels = debugShowLabelsOption?.checked ?? false;
let quakeDebugPanelStatsTimer: number | null = null;
let quakeInvertMouse = invertMouseOption?.checked ?? false;
let quakeAlwaysRun = alwaysRunOption?.checked ?? false;
let quakeShowGun = showGunOption?.checked ?? true;
let quakeDynamicLighting = dynamicLightingOption?.checked ?? true;
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
  const mapParamPresent = params.has("map");
  const view = mapName !== null || !mapParamPresent ? quakeUrlView(params) : null;
  return {
    mapName: mapName ?? quakeAssetManifest.startMap,
    mapParamPresent,
    mapParamValid: mapName !== null,
    view,
  };
}

function quakeUrlRouteIsDirect(route: QuakeUrlRoute): boolean {
  return route.mapParamValid || route.view !== null;
}

function quakeUrlRouteShouldNormalize(route: QuakeUrlRoute): boolean {
  return !route.mapParamPresent || route.mapParamValid;
}

function quakeUrlMapName(params: URLSearchParams): string | null {
  const mapName = params.get("map")?.trim().toLowerCase();
  return mapName && quakeSceneUrl(mapName) ? mapName : null;
}

function quakeUrlView(params: URLSearchParams): QuakeUrlView | null {
  const rawValue = params.get("view");
  if (!rawValue) return null;
  const parts = quakeUrlNumberParts(rawValue);
  if (parts.length !== QUAKE_URL_VIEW_PART_COUNT || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  if (parts.slice(0, 3).some((part) => Math.abs(part) > QUAKE_URL_VIEW_ORIGIN_LIMIT)) return null;
  if (parts[3] < QUAKE_URL_VIEW_PITCH_MIN || parts[3] > QUAKE_URL_VIEW_PITCH_MAX) return null;
  if (Math.abs(parts[4]) > QUAKE_URL_VIEW_ANGLE_LIMIT) return null;
  if (parts[5] !== undefined && Math.abs(parts[5]) > QUAKE_URL_VIEW_ANGLE_LIMIT) return null;
  const roll = parts[5];
  if (Math.abs(roll) > QUAKE_URL_VIEW_ROLL_EPSILON) return null;
  return {
    origin: [parts[0], parts[1], parts[2]],
    pitch: parts[3],
    yaw: normalizeQuakeUrlAngle(parts[4]),
    roll: 0,
  };
}

function quakeUrlNumberParts(rawValue: string): number[] {
  return rawValue.trim().split(/[,\s]+/).filter(Boolean).map((part) => Number(part));
}

function normalizeQuakeUrlAngle(value: number): number {
  return (value % 360 + 360) % 360;
}

function updateQuakeUrl(mapName: string, mode: QuakeUrlUpdateMode, view: QuakeCssView | null = null): void {
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

function clearQuakeGameRoute(): void {
  const url = new URL(window.location.href);
  const hadGameRoute = url.searchParams.has("map") || url.searchParams.has("view");
  url.searchParams.delete("map");
  url.searchParams.delete("view");
  if (!hadGameRoute && url.href === window.location.href) return;
  window.history.replaceState({ cssQuake: true, mapName: null, view: null }, "", url);
}

function clearQuakeDebugUrlParams(): void {
  const url = new URL(window.location.href);
  const hadDebugParams = url.searchParams.has("debugPolys");
  if (!hadDebugParams) return;
  url.searchParams.delete("debugPolys");
  window.history.replaceState(
    { cssQuake: true, mapName: currentMapName, view: quakeUrlView(url.searchParams) },
    "",
    url,
  );
}

function quakeUrlFor(mapName: string, view: QuakeCssView | null = null): URL {
  const url = new URL(window.location.href);
  url.searchParams.set("map", mapName);
  if (view) {
    setQuakeUrlViewParam(url, quakeUrlViewValue(quakeUrlViewFromCssView(view)));
  } else {
    url.searchParams.delete("view");
  }
  return url;
}

function setQuakeUrlViewParam(url: URL, value: string): void {
  url.searchParams.set("view", value);
  url.search = url.search.replace(/([?&]view=)[^&]*/, `$1${value}`);
}

function quakeUrlViewValue(view: QuakeUrlView): string {
  return [
    ...view.origin,
    view.pitch,
    view.yaw,
    view.roll,
  ].map(formatQuakeUrlNumber).join(",");
}

function formatQuakeUrlNumber(value: number): string {
  const rounded = Math.round(value * QUAKE_URL_NUMBER_SCALE) / QUAKE_URL_NUMBER_SCALE;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function currentQuakeCssView(): QuakeCssView {
  const origin = controls.getOrigin();
  return {
    origin: [origin[0], origin[1], origin[2]],
    rotX: scene.camera.state.rotX ?? 88,
    rotY: scene.camera.state.rotY ?? 270,
  };
}

function currentQuakeViewUrl(): string {
  return quakeUrlFor(currentMapName, currentQuakeCssView()).href;
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
const scene = createPolyScene(quakeApp, {
  camera,
  ambientLight: { color: "#ffffff", intensity: Math.PI },
  directionalLight: { direction: [-0.4, -0.55, -0.65], color: "#ffffff", intensity: 0 },
  textureLighting: "baked",
  textureQuality: 1,
  autoCenter: false,
});
const host = scene.cameraEl as HTMLElement;
quakeApp.insertBefore(host, viewmodelLayer ?? quakeUi);
host.tabIndex = 0;
// PolyCSS controls read scene.host when they are created; keep that target on the inspectable camera node.
(scene as unknown as { host: HTMLElement }).host = host;
const sceneElement = scene.sceneElement;
sceneElement.removeAttribute("data-polycss-lighting");
let quakeFirstPersonControlsMounted = false;
let quakeCameraLookEnabled = true;
let quakeCameraPerspectiveStyle = scene.camera.perspectiveStyle;
function syncQuakeViewportProjection(): void {
  const { width, height } = quakeViewportSize();
  const perspective = quakeCameraPerspectiveForViewport(width, height);
  quakeCameraPerspectiveStyle = `${Number(perspective.toFixed(6))}px`;
  if (quakeFirstPersonControlsMounted) {
    host.style.setProperty("--polycss-fpv-perspective", quakeCameraPerspectiveStyle);
    host.style.removeProperty("perspective");
  } else {
    host.style.perspective = quakeCameraPerspectiveStyle;
  }
  const centerX = quakeViewportCenterCss(width);
  const centerY = quakeViewportCenterCss(height);
  scene.cameraEl.style.perspectiveOrigin = `${centerX} ${centerY}`;
  sceneElement.style.left = centerX;
  sceneElement.style.top = centerY;
  compactQuakeCameraInlineStyle();
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
quakeFirstPersonControlsMounted = true;
const updateQuakeControls = controls.update.bind(controls);
controls.update = (partial) => {
  updateQuakeControls(partial);
  if (partial.lookEnabled !== undefined) quakeCameraLookEnabled = partial.lookEnabled;
  compactQuakeCameraInlineStyle();
};
compactQuakeCameraInlineStyle();
let quakeCameraRenderOrigin: Vec3 = [0, 0, 1.72];
let quakeCameraStepSmoothFrame = 0;
let quakeCameraStepSmoothAt = 0;
let quakePlayerDead = false;
let quakeDeathUnlockMenuSuppressUntil = 0;
let quakeDeathUnlockControlsEndTraceSuppressUntil = 0;
let quakeMenuResumeControlsEndSuppressUntil = 0;

type QuakePickupControllerHandle = ReturnType<typeof createQuakePickupController>;
type QuakePlayerControllerHandle = ReturnType<typeof createQuakePlayerController>;

let pickups: QuakePickupControllerHandle | null = null;
let player: QuakePlayerControllerHandle | null = null;
let quakeRuntimePickupSerial = 0;
const weaponViewModelPromises = new Map<string, Promise<QuakeViewmodelModel>>();
let mountedWeaponViewModelPath: string | null = null;
let pendingWeaponViewModelPath: string | null = null;

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
  singlePlayerPanel,
  levelPanel,
  aboutPanel,
  optionsPanel,
  debugPanel: debugMenuPanel,
  onSelectNewGame: startQuakeNewGame,
  onLoadGame: loadCssQuakeProgress,
  onSaveGame: saveCssQuakeProgress,
  onSelectLevel: loadQuakeMap,
  onSelectDebug: handleQuakeMenuDebugToggle,
  onSelectQuit: quitQuakeToMainMenu,
  canLoadGame: canLoadCssQuakeProgress,
  canSaveGame: canSaveCssQuakeProgress,
  isQuitEnabled: () => quakeGameplayStarted,
  onMenuPauseChange: setQuakeGamePaused,
  onResumeMainMenuFromEscape: suppressQuakeMainMenuOnResumeControlsEnd,
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
  layer: viewmodelLayer,
});
const shootables = createQuakeShootablesController({
  addMesh: addQuakeShootableMesh,
  bossLightningDischarge: quakeBossLightningDischarge,
  bossLightningElectrodesReady: quakeBossLightningElectrodesReady,
  createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
  damagePlayer: (amount) => getPlayer().damage(amount),
  dropBackpack: (drop) => {
    const origin = drop.sourceEntity.origin ?? { x: 0, y: 0, z: 0 };
    const entity: QuakeEntity = {
      index: -300000 - ++quakeRuntimePickupSerial,
      classname: "item_backpack",
      origin,
      properties: {
        classname: "item_backpack",
        origin: `${origin.x} ${origin.y} ${origin.z}`,
      },
    };
    return getPickups().addRuntimePickup({
      effect: drop.ammo,
      entity,
      feedback: {
        ...(drop.message ? { message: drop.message } : {}),
        ...(drop.soundPath ? { soundPath: drop.soundPath } : {}),
      },
      ...(drop.modelPath ? { modelPath: drop.modelPath } : {}),
      origin: drop.origin,
      ...(typeof drop.removeAfterSeconds === "number" ? { removeAfterSeconds: drop.removeAfterSeconds } : {}),
      visibilityOrigin: controls.getOrigin(),
    });
  },
  contentsAt: (point) => currentCollisionWorld?.contentsAt?.(point) ?? null,
  floorAt: (x, y, maxZ, minZ) =>
    currentCollisionWorld?.floorAt(x, y, maxZ, minZ) ??
    currentCollisionWorld?.staticFloorAt(x, y, maxZ, minZ) ??
    null,
  getPlayerEyeHeight: () => getPlayer().eyeHeight(),
  getPlayerForward: () => forwardDirection(scene.camera.state.rotX ?? 90, scene.camera.state.rotY ?? 270),
  getPlayerOrigin: () => getPlayer().currentOrigin(),
  hasLineOfSight: quakeLineOfSight,
  isPlayerInvisible: quakePlayerInvisible,
  isGameplayPaused: isQuakeGamePaused,
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
  isGameplayPaused: isQuakeGamePaused,
  onCounterStateChange: showQuakeCounterGeneratedText,
  onUseTargetsMessage: showQuakeUseTargetsMessageText,
});
const movers = createQuakeMoversController({
  applyState: applyMoverState,
  fireTarget: fireQuakeTarget,
  groupUnlocked: quakeMoverGroupUnlocked,
  isGameplayPaused: isQuakeGamePaused,
  playerBlocks: moverBlockedByActor,
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
  applyEffect: (effect, entity, feedback) => {
    applyQuakeInventoryDelta(getPlayer().inventory(), effect);
    syncQuakeHud();
    flashQuakeBonusOverlay();
    const gameLogic = currentResult?.gameLogic ?? null;
    const pickupMessage = feedback?.message ?? quakePickupMessageForEntity(entity, gameLogic);
    if (pickupMessage) showQuakeNotifyText(pickupMessage);
    if (feedback?.soundPath) {
      audio.playSound(feedback.soundPath);
    } else {
      audio.playPickup(entity, gameLogic);
    }
  },
  canPickup: (effect, entity) =>
    quakeCanPickupForInventory(entity, getPlayer().inventory(), currentResult?.gameLogic ?? null, effect),
  leafIndexAt: world.leafIndexAt,
  playerForward: () => forwardDirection(scene.camera.state.rotX ?? 90, scene.camera.state.rotY ?? 270),
  playerViewDot: quakePlayerViewDot,
  pointToPoly: quakePointToPoly,
  gameLogic: () => currentResult?.gameLogic ?? null,
  isGameplayPaused: isQuakeGamePaused,
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
  addProjectileMesh: addQuakeWeaponProjectileMesh,
  canUseGameplayInput: canUseQuakeGameplayInput,
  hasViewmodel: viewmodel.hasWeapon,
  getCollisionWorld: () => currentCollisionWorld,
  getEntities: () => entityByIndex,
  getShootables: shootables.weaponTargets,
  getPlayerEyeHeight: () => getPlayer().eyeHeight(),
  getPlayerWaterLevel: () =>
    quakePlayerWaterLevel(currentCollisionWorld?.contentsAt, getPlayer().currentOrigin(), getPlayer().eyeHeight()),
  getActiveWeapon: () => getPlayer().inventory().activeWeapon,
  getAmmo: (field) => getPlayer().inventory()[field],
  consumeAmmo: (field, amount) => {
    const inventory = getPlayer().inventory();
    inventory[field] = Math.max(0, inventory[field] - amount);
  },
  selectBestWeapon: () => selectQuakeBestInventoryWeapon(getPlayer().inventory()),
  syncHud: syncQuakeHud,
  playFireSound: (weapon) => {
    audio.playEvent(quakeWeaponFireSoundEvent(weapon), { volume: 0.74 });
  },
  playFireAnimation: playQuakeWeaponFireFeedback,
  damageShootable: shootables.damage,
  damageBrushEntity: damageQuakeBrushEntity,
  damagePlayer: (amount) => getPlayer().damage(amount),
  damageMultiplier: quakeWeaponDamageMultiplier,
  onHit: flashQuakeCrosshairHit,
  showLightningBeam: showQuakeLightningBeam,
  syncCrosshairTarget: queueQuakeCrosshairTargetSync,
});

function quakeWeaponFireSoundEvent(weapon: QuakeWeaponFireSoundId): QuakeSoundEvent {
  if (weapon === "axe") return "weaponAxe";
  if (weapon === "nailgun") return "weaponNailgun";
  if (weapon === "supernailgun") return "weaponSuperNailgun";
  if (weapon === "grenadelauncher") return "weaponGrenadeLauncher";
  if (weapon === "rocketlauncher") return "weaponRocketLauncher";
  if (weapon === "lightning") return "weaponLightning";
  return weapon === "supershotgun" ? "weaponSuperShotgun" : "weaponShotgun";
}

player = createQuakePlayerController({
  activateSolidTouch,
  canUseGameplayInput: canUseQuakeGameplayInput,
  canTakeDamage: () => !quakeDamageDisabled && !quakePlayerDead,
  controls,
  getYaw: () => scene.camera.state.rotY ?? 270,
  getCollisionWorld: () => currentCollisionWorld,
  getCurrentScene: () => currentResult,
  gravity: QUAKE_GRAVITY,
  alwaysRun: () => quakeAlwaysRun,
  isGameplayPaused: isQuakeGamePaused,
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
    shootables.spawn(quakeShootableRuntimeEntities(runtime), currentPickupModelLibrary, currentProgramMetadata);
    setupQuakeMonsterJumpTriggers(result);
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
let quakeMegahealthRotDueAt: number | null = null;
let quakePowerupTimers = new Map<string, number>();
let quakeDoorMessageCooldownUntil = new Map<number, number>();
let quakeSkill = 1;
let quakeModelPivot = { x: 0, y: 0, z: 0 };
let quakeLevelLoadTimer: number | null = null;
let quakeTransitionSerial = 0;
const quakeLightningBeamHandles = new Set<PolyMeshHandle>();
const quakeLightningBeamTimers = new Map<PolyMeshHandle, number>();
let currentMapName = quakeAssetManifest.startMap;
let quakeAppDisposed = false;
let quakeAppLoading = true;
let quakeDebugCollisionBypassUntil = 0;
let disposeStatsOverlay: (() => void) | null = null;
let quakeSoundManifestPromise: Promise<void> | null = null;
let quakeGamePaused = false;
let quakeGamePausedAt = 0;

function cssQuakeProgressStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readCssQuakeSaveSlot(): CssQuakeSaveSlotV1 | null {
  const storage = cssQuakeProgressStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(CSSQUAKE_SAVE_SLOT_KEY);
    if (!raw) return null;
    const slot = JSON.parse(raw) as unknown;
    return isCssQuakeSaveSlotV1(slot) ? slot : null;
  } catch (error) {
    console.warn("Could not read cssQuake save slot.", error);
    return null;
  }
}

function isCssQuakeSaveSlotV1(value: unknown): value is CssQuakeSaveSlotV1 {
  if (!value || typeof value !== "object") return false;
  const slot = value as Partial<CssQuakeSaveSlotV1>;
  return slot.version === CSSQUAKE_SAVE_SLOT_VERSION &&
    typeof slot.mapName === "string" &&
    slot.mapName.trim().length > 0 &&
    Number.isFinite(slot.savedAt) &&
    isCssQuakeProgressViewSnapshot(slot.view) &&
    isCssQuakeObject(slot.player) &&
    isCssQuakeObject(slot.pickups) &&
    isCssQuakeObject(slot.shootables) &&
    isCssQuakeObject(slot.movers) &&
    isCssQuakeObject(slot.targets);
}

function isCssQuakeObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function isCssQuakeProgressViewSnapshot(value: unknown): value is CssQuakeProgressViewSnapshot {
  if (!value || typeof value !== "object") return false;
  const view = value as Partial<CssQuakeProgressViewSnapshot>;
  return Array.isArray(view.origin) &&
    view.origin.length === 3 &&
    view.origin.every(Number.isFinite) &&
    Number.isFinite(view.rotX) &&
    Number.isFinite(view.rotY);
}

function canLoadCssQuakeProgress(): boolean {
  const slot = readCssQuakeSaveSlot();
  return Boolean(slot && quakeSceneUrl(slot.mapName));
}

function canSaveCssQuakeProgress(): boolean {
  return Boolean(
    currentResult &&
    currentCollisionWorld &&
    quakeGameplayStarted &&
    !quakeAppLoading &&
    !quakePlayerDead &&
    !document.body.classList.contains("quake-level-complete") &&
    quakeLevelLoadTimer === null,
  );
}

function createCssQuakeSaveSlot(): CssQuakeSaveSlotV1 | null {
  if (!canSaveCssQuakeProgress()) return null;
  const origin = getPlayer().currentOrigin();
  return {
    version: CSSQUAKE_SAVE_SLOT_VERSION,
    savedAt: Date.now(),
    mapName: currentMapName,
    view: {
      origin: [...origin] as [number, number, number],
      rotX: Number.isFinite(scene.camera.state.rotX) ? scene.camera.state.rotX as number : 88,
      rotY: Number.isFinite(scene.camera.state.rotY) ? scene.camera.state.rotY as number : 270,
    },
    damageableBrushes: snapshotCssQuakeDamageableBrushProgress(),
    player: getPlayer().snapshotProgress(),
    pickups: getPickups().snapshotProgress(),
    shootables: shootables.snapshotProgress(),
    movers: movers.snapshotProgress(),
    targets: targetSystem.snapshotProgress(),
  };
}

function saveCssQuakeProgress(): void {
  const slot = createCssQuakeSaveSlot();
  if (!slot) {
    showQuakeNotifyText("Nothing to save");
    return;
  }
  const storage = cssQuakeProgressStorage();
  if (!storage) {
    showQuakeNotifyText("Could not save game");
    return;
  }
  try {
    storage.setItem(CSSQUAKE_SAVE_SLOT_KEY, JSON.stringify(slot));
    markQuakeTrace("progress-save", { mapName: slot.mapName, savedAt: slot.savedAt });
    showQuakeNotifyText("Game saved");
  } catch (error) {
    console.error("Could not save cssQuake progress.", error);
    showQuakeNotifyText("Could not save game");
  }
}

function snapshotCssQuakeDamageableBrushProgress(): CssQuakeDamageableBrushProgressSnapshot {
  return {
    brushes: [...quakeDamageableBrushHealth].map(([entityIndex, health]) => ({
      entityIndex,
      health,
    })),
  };
}

function restoreCssQuakeDamageableBrushProgress(snapshot: CssQuakeDamageableBrushProgressSnapshot | undefined): void {
  for (const timer of quakeDamageableBrushResetTimers) window.clearTimeout(timer);
  quakeDamageableBrushResetTimers = [];
  const savedHealth = new Map<number, number>();
  for (const entry of Array.isArray(snapshot?.brushes) ? snapshot.brushes : []) {
    if (!Number.isInteger(entry.entityIndex) || !Number.isFinite(entry.health)) continue;
    savedHealth.set(entry.entityIndex, Math.max(1, entry.health));
  }
  for (const entity of entityByIndex.values()) {
    if (!isQuakeDamageableBrushEntity(entity)) continue;
    if (targetSystem.isDisabled(entity.index)) {
      quakeDamageableBrushHealth.delete(entity.index);
      continue;
    }
    quakeDamageableBrushHealth.set(
      entity.index,
      savedHealth.get(entity.index) ?? quakeDamageableBrushMaxHealth(entity),
    );
  }
}

async function loadCssQuakeProgress(): Promise<void> {
  const slot = readCssQuakeSaveSlot();
  if (!slot || !quakeSceneUrl(slot.mapName)) {
    showQuakeNotifyText("No saved game");
    return;
  }
  clearQuakeAttackInput();
  clearQuakeMoveInput();
  clearQuakeMobileMoveInput();
  if (!currentResult || currentMapName !== slot.mapName) {
    await loadQuakeMap(slot.mapName, {
      loadingStatus: "Loading save",
      resumeGameplay: false,
      urlMode: "push",
    });
  }
  if (!currentResult || currentMapName !== slot.mapName) return;
  applyCssQuakeSaveSlot(slot);
  markQuakeTrace("progress-load", { mapName: slot.mapName, savedAt: slot.savedAt });
  showQuakeNotifyText("Game loaded");
}

function applyCssQuakeSaveSlot(slot: CssQuakeSaveSlotV1): void {
  clearQuakeLevelComplete();
  clearQuakePlayerDeath();
  clearQuakeAttackInput();
  clearQuakeMoveInput();
  clearQuakeMobileMoveInput();
  clearQuakeCrouchInput();
  clearQuakeWeaponViewPunch(false);
  clearQuakeCrosshairHit();
  clearQuakeCrosshairTarget();
  clearQuakeBonusOverlay();
  clearQuakeMegahealthRot();
  for (const timer of quakePowerupTimers.values()) window.clearTimeout(timer);
  quakePowerupTimers = new Map();
  triggerSystem.resetActive();
  weapons.reset();
  targetSystem.restoreProgress(slot.targets);
  restoreCssQuakeDamageableBrushProgress(slot.damageableBrushes);
  movers.restoreProgress(slot.movers);
  getPickups().restoreProgress(slot.pickups);
  shootables.restoreProgress(slot.shootables);
  getPlayer().restoreProgress(slot.player);
  syncSceneCameraAt(getPlayer().currentOrigin(), slot.view.rotX, slot.view.rotY);
  rescheduleQuakePowerupTimers();
  syncQuakeHud();
  viewmodel.syncTransform();
  world.syncVisibility(true);
  shootables.syncVisibility(getPlayer().currentOrigin(), true);
  syncQuakeCrosshairTarget();
  setQuakeGameplayStarted(true);
}

function setQuakeGameplayStarted(started: boolean): void {
  quakeGameplayStarted = started;
  document.body.classList.toggle("quake-gameplay-started", started);
  if (started && loadingOverlay?.classList.contains("quake-loading-console-persisted")) {
    document.body.classList.remove("quake-loading");
    loadingOverlay.hidden = false;
    loadingOverlay.setAttribute("aria-busy", "false");
  }
}

function hidePersistedQuakeLoadingConsole(): void {
  if (!loadingOverlay?.classList.contains("quake-loading-console-persisted")) return;
  document.body.classList.remove("quake-loading");
  loadingOverlay.hidden = true;
  loadingOverlay.removeAttribute("aria-busy");
  loadingOverlay.classList.remove("quake-loading-console-persisted");
  clearQuakeLoadingConsoleQueue();
}

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
const QUAKE_PAUSED_TIMER_POLL_MS = 100;
const QUAKE_PLAYER_DEFAULT_MAX_HEALTH = 100;
const QUAKE_MEGAHEALTH_ROT_INTERVAL_MS = 1000;
const QUAKE_SHAREWARE_REGISTERED = false;
const QUAKE_TRAP_SPIKE_RANGE = 2048 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_TRAP_SPIKE_RADIUS = 36 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_TRAP_SPIKE_DAMAGE = 10;
const QUAKE_LIGHTNING_BEAM_VISUAL_MS = 180;
const QUAKE_LIGHTNING_BEAM_INNER_RADIUS = 0.018;
const QUAKE_LIGHTNING_BEAM_OUTER_RADIUS = 0.045;
const QUAKE_QUAD_DAMAGE_MULTIPLIER = 4;
const QUAKE_DEFAULT_WEAPON_VIEWMODEL_PATH = "progs/v_shot.mdl";
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
    activeWeapon: inventory.activeWeapon,
    weapons: [...inventory.weapons],
    shells: inventory.shells,
  });
  syncQuakeHudElements(hudElements, inventory);
  syncActiveWeaponViewModel();
}

function isQuakeGamePaused(): boolean {
  return quakeGamePaused;
}

function setQuakeGamePaused(paused: boolean): void {
  if (quakeGamePaused === paused) {
    syncQuakeInteractionPresentation();
    return;
  }
  const now = performance.now();
  quakeGamePaused = paused;
  document.body.classList.toggle("quake-game-paused", paused);
  syncQuakeInteractionPresentation();
  audio.setPaused(paused);
  if (paused) {
    quakeGamePausedAt = now;
    clearQuakeAttackInput();
    clearQuakeMoveInput();
    clearQuakeMobileMoveInput();
    clearQuakeCrouchInput();
    clearQuakeWeaponViewPunch();
    controls.update({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, gravity: 0 });
    clearQuakeCrosshairTarget();
    pauseQuakeGameplayTimers();
    return;
  }

  const pausedForMs = quakeGamePausedAt ? Math.max(0, now - quakeGamePausedAt) : 0;
  quakeGamePausedAt = 0;
  resumeQuakeGameplayTimers(pausedForMs);
  if (currentResult && !quakeAppLoading && !quakePlayerDead) {
    const origin = getPlayer().currentOrigin();
    syncQuakeHazards(origin);
    getPickups().syncCollision(origin, getPlayer().eyeHeight(), STEP_HEIGHT);
    shootables.syncMonsterRuntime();
    if (quakeFireballEmitters.length || quakePointHazards.length) startQuakePointHazards();
    syncQuakeCrosshairTarget();
  }
}

function pauseQuakeGameplayTimers(): void {
  cancelQuakeMegahealthRotTimer();
  for (const timer of quakePowerupTimers.values()) window.clearTimeout(timer);
  quakePowerupTimers = new Map();
  quakePointHazardTime = 0;
}

function resumeQuakeGameplayTimers(pausedForMs: number): void {
  if (pausedForMs > 0) {
    shiftQuakePointHazardDeadlines(pausedForMs);
    shiftQuakePowerupDeadlines(pausedForMs);
    shiftQuakeMapNumberDeadlines(quakeDoorMessageCooldownUntil, pausedForMs);
    shiftQuakeMapNumberDeadlines(quakeMoverCrushDamageAt, pausedForMs);
    if (quakeMegahealthRotDueAt !== null) quakeMegahealthRotDueAt += pausedForMs;
  }
  scheduleQuakeMegahealthRotTimer();
  rescheduleQuakePowerupTimers();
}

function shiftQuakeMapNumberDeadlines(map: Map<number, number>, durationMs: number): void {
  for (const [key, value] of map) {
    if (Number.isFinite(value)) map.set(key, value + durationMs);
  }
}

function shiftQuakePointHazardDeadlines(durationMs: number): void {
  for (const emitter of quakeFireballEmitters) emitter.nextSpawnAt += durationMs;
  for (const hazard of quakePointHazards) {
    if (hazard.expiresAt !== undefined) hazard.expiresAt += durationMs;
  }
}

function shiftQuakePowerupDeadlines(durationMs: number): void {
  if (!player) return;
  for (const state of Object.values(player.inventory().powerups)) {
    state.finishedAt += durationMs;
  }
}

function rescheduleQuakePowerupTimers(): void {
  if (!player) return;
  for (const finishedField of Object.keys(player.inventory().powerups)) {
    scheduleQuakePowerupTimer(finishedField);
  }
}

function startQuakeMegahealthRot(entity: QuakeEntity, delaySeconds: number): void {
  clearQuakeMegahealthRot();
  if (!Number.isFinite(delaySeconds) || delaySeconds < 0) return;
  markQuakeTrace("pickup-megahealth-rot-start", { entityIndex: entity.index, delaySeconds });
  quakeMegahealthRotDueAt = performance.now() + delaySeconds * 1000;
  scheduleQuakeMegahealthRotTimer();
}

function runQuakeMegahealthRot(): void {
  quakeMegahealthRotTimer = null;
  quakeMegahealthRotDueAt = null;
  if (isQuakeGamePaused()) return;
  if (quakeAppDisposed || !currentResult || quakePlayerDead) return;
  const inventory = getPlayer().inventory();
  if (inventory.health <= QUAKE_PLAYER_DEFAULT_MAX_HEALTH) return;
  inventory.health = Math.max(QUAKE_PLAYER_DEFAULT_MAX_HEALTH, inventory.health - 1);
  markQuakeTrace("pickup-megahealth-rot", { health: inventory.health });
  syncQuakeHud();
  if (inventory.health > QUAKE_PLAYER_DEFAULT_MAX_HEALTH) {
    quakeMegahealthRotDueAt = performance.now() + QUAKE_MEGAHEALTH_ROT_INTERVAL_MS;
    scheduleQuakeMegahealthRotTimer();
  }
}

function scheduleQuakeMegahealthRotTimer(): void {
  cancelQuakeMegahealthRotTimer();
  if (quakeMegahealthRotDueAt === null || isQuakeGamePaused()) return;
  quakeMegahealthRotTimer = window.setTimeout(
    runQuakeMegahealthRot,
    Math.max(0, quakeMegahealthRotDueAt - performance.now()),
  );
}

function cancelQuakeMegahealthRotTimer(): void {
  if (quakeMegahealthRotTimer === null) return;
  window.clearTimeout(quakeMegahealthRotTimer);
  quakeMegahealthRotTimer = null;
}

function clearQuakeMegahealthRot(): void {
  cancelQuakeMegahealthRotTimer();
  quakeMegahealthRotDueAt = null;
}

function startQuakePowerup(entity: QuakeEntity, powerup: QuakeInventoryPowerupBehavior): void {
  const now = performance.now();
  clearQuakePowerupTimer(powerup.finishedField);
  const state = activateQuakeInventoryPowerup(getPlayer().inventory(), powerup, now);
  if (!state) return;
  scheduleQuakePowerupTimer(powerup.finishedField);
  markQuakeTrace("pickup-powerup-start", {
    activationField: powerup.activationField,
    durationSeconds: powerup.durationSeconds,
    entityIndex: entity.index,
    finishedField: powerup.finishedField,
    itemFlag: powerup.itemFlag,
    itemFlagExpression: powerup.itemFlagExpression,
    itemFlagMutationExpression: powerup.itemFlagMutation?.expression,
  });
  syncQuakeHud();
}

function finishQuakePowerup(finishedField: string, reason: string): void {
  clearQuakePowerupTimer(finishedField);
  if (isQuakeGamePaused()) return;
  if (!player) return;
  const state = clearQuakeInventoryPowerup(player.inventory(), finishedField);
  if (!state) return;
  markQuakeTrace("pickup-powerup-end", {
    activationField: state.activationField,
    finishedField,
    itemFlag: state.itemFlag,
    itemFlagExpression: state.itemFlagExpression,
    itemFlagMutationExpression: state.itemFlagMutation?.expression,
    reason,
  });
  syncQuakeHud();
}

function scheduleQuakePowerupTimer(finishedField: string): void {
  clearQuakePowerupTimer(finishedField);
  if (!player || isQuakeGamePaused()) return;
  const state = player.inventory().powerups[finishedField];
  if (!state) return;
  quakePowerupTimers.set(
    finishedField,
    window.setTimeout(
      () => finishQuakePowerup(finishedField, "timer"),
      Math.max(0, state.finishedAt - performance.now()),
    ),
  );
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
  const hadPowerups = Object.keys(inventory.powerups).length > 0;
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

function setQuakeDynamicLighting(enabled: boolean): void {
  quakeDynamicLighting = enabled;
  if (dynamicLightingOption) dynamicLightingOption.checked = enabled;
  syncQuakeDynamicLightingOption();
}

function setQuakeShowGun(enabled: boolean): void {
  quakeShowGun = enabled;
  if (showGunOption) showGunOption.checked = enabled;
  viewmodel.setVisible(enabled);
}

function syncQuakeDynamicLightingOption(): void {
  if (dynamicLightingOption) dynamicLightingOption.checked = quakeDynamicLighting;
  document.body.classList.toggle("quake-static-lighting", !quakeDynamicLighting);
}

function setQuakeDebugMode(enabled: boolean): void {
  quakeDebugMode = enabled;
  if (debugEnabledOption) debugEnabledOption.checked = enabled;
  syncQuakeInteractionPresentation();
  syncQuakePointerTraceAccessors();
  syncQuakeDebugPanelVisibility();
  if (!enabled) clearQuakeDebugUrlParams();
}

function toggleQuakeDebugMode(): void {
  setQuakeDebugMode(!quakeDebugMode);
}

function setQuakeDebugShowFps(enabled: boolean): void {
  quakeDebugShowFps = enabled;
  if (debugShowFpsOption) debugShowFpsOption.checked = enabled;
  syncQuakeStatsOverlayAvailability();
}

function syncQuakeInteractionPresentation(): void {
  const menuSurfaceOpen = menu.isMainMenuOpen() || menu.isMenuPanelOpen();
  const debugPointerUnlocked = quakeDebugMode && document.pointerLockElement !== host;
  document.body.classList.toggle("quake-debug-active", quakeDebugMode);
  document.body.classList.toggle("quake-debug-pointer-unlocked", debugPointerUnlocked);
  document.body.classList.toggle("quake-ui-unlocked", menuSurfaceOpen || debugPointerUnlocked);
}

function handleQuakeMenuDebugToggle(): void {
  toggleQuakeDebugMode();
  clearQuakeMoveInput();
  clearQuakeAttackInput();
  clearQuakeCrouchInput();
  menu.hideMainMenu();
}

function quitQuakeToMainMenu(): void {
  if (!quakeGameplayStarted) return;
  clearQuakeMoveInput();
  clearQuakeAttackInput();
  clearQuakeCrouchInput();
  clearQuakeMobileMoveInput();
  clearQuakeDebugFlyInput();
  clearQuakeWeaponViewPunch();
  clearQuakeLevelComplete();
  clearQuakeDeathOverlay();
  if (document.pointerLockElement === host) document.exitPointerLock();
  clearQuakeGameRoute();
  setQuakeGameplayStarted(false);
  setQuakeLoading(false);
  menu.showMainMenu();
}

function setQuakeDebugShowTextures(enabled: boolean): void {
  quakeDebugHideTextures = !enabled;
  if (debugShowTexturesOption) debugShowTexturesOption.checked = enabled;
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
  if (debugShowTexturesOption) debugShowTexturesOption.checked = !quakeDebugHideTextures;
  if (debugShowOutlinesOption) {
    debugShowOutlinesOption.checked = effectiveShowOutlines;
    debugShowOutlinesOption.disabled = quakeDebugHideTextures;
  }
  if (debugShowLabelsOption) debugShowLabelsOption.checked = quakeDebugShowLabels;
  syncQuakeRenderBundleDebugOutlines(effectiveShowOutlines, {
    hideTextures: quakeDebugHideTextures,
  });
  syncQuakeRenderBundleDebugLabels(quakeDebugShowLabels);
  document.body.classList.remove("quake-poly-debug");
  document.body.classList.toggle("quake-debug-no-textures", quakeDebugHideTextures);
  document.body.classList.toggle("quake-debug-outlines", effectiveShowOutlines);
  document.body.classList.toggle("quake-debug-labels", quakeDebugShowLabels);
}

function quakeDebugEffectiveShowOutlines(): boolean {
  return quakeDebugShowOutlines || quakeDebugHideTextures;
}

function syncQuakeDebugFlyMode(): void {
  if (debugFlyModeOption) debugFlyModeOption.checked = quakeDebugFlyMode;
  const requested = quakeDebugFlyMode;
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

function syncQuakeDebugPanelVisibility(): void {
  if (!debugPanel) return;
  debugPanel.hidden = !quakeDebugMode;
  if (quakeDebugMode) {
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

  setQuakeDebugStat("capture", quakeDebugCapturePose(currentMapName, origin, rotX, rotY));
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

function quakeDebugCapturePose(mapName: string, origin: Vec3, rotX: number, rotY: number): string {
  return `${mapName} | ${quakeDebugVec3(origin)} | ${rotX.toFixed(1)}/${rotY.toFixed(1)}`;
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

function setQuakeAlwaysRun(alwaysRun: boolean): void {
  quakeAlwaysRun = alwaysRun;
  if (alwaysRunOption) alwaysRunOption.checked = alwaysRun;
}

function syncQuakeOptionControls(): void {
  syncQuakeAudioToggle();
  if (disableEnemiesOption) disableEnemiesOption.checked = quakeEnemiesDisabled;
  if (disableDamageOption) disableDamageOption.checked = quakeDamageDisabled;
  setQuakeDebugMode(quakeDebugMode);
  syncQuakeDebugRenderOptions();
  syncQuakeDebugFlyMode();
  syncQuakeDynamicLightingOption();
  if (invertMouseOption) invertMouseOption.checked = quakeInvertMouse;
  if (alwaysRunOption) alwaysRunOption.checked = quakeAlwaysRun;
  setQuakeShowGun(quakeShowGun);
  setQuakeDebugShowFps(quakeDebugShowFps);
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

function setQuakeNotifyText(text: string): void {
  if (!text.trim() || !quakeHud) return;
  quakeText.setNotify(text);
}

function clearQuakeNotifyText(): void {
  quakeText.clearNotify();
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

function suppressQuakeControlsEndTraceOnDeathUnlock(): void {
  quakeDeathUnlockControlsEndTraceSuppressUntil =
    performance.now() + QUAKE_DEATH_UNLOCK_CONTROLS_END_TRACE_SUPPRESS_MS;
}

function isQuakeDeathUnlockControlsEndTraceSuppressed(now = performance.now()): boolean {
  return quakePlayerDead && now <= quakeDeathUnlockControlsEndTraceSuppressUntil;
}

function suppressQuakeMainMenuOnResumeControlsEnd(): void {
  quakeMenuResumeControlsEndSuppressUntil = performance.now() + QUAKE_MENU_RESUME_CONTROLS_END_SUPPRESS_MS;
}

function clearQuakeMainMenuControlsEndSuppression(): void {
  quakeDeathUnlockMenuSuppressUntil = 0;
  // Resume suppression must expire by time; the same Escape resume can create a rapid start/end pair.
}

function shouldOpenQuakeMainMenuOnControlsEnd(): boolean {
  if (quakeAppLoading) {
    quakePointerTrace("controls-end-menu-gate", { allow: false, reason: "loading" });
    return false;
  }
  if (isQuakeLevelTransitionActive()) {
    quakePointerTrace("controls-end-menu-gate", { allow: false, reason: "level-transition" });
    return false;
  }
  if (quakeMenuResumeControlsEndSuppressUntil > 0) {
    const suppress = performance.now() <= quakeMenuResumeControlsEndSuppressUntil;
    quakeMenuResumeControlsEndSuppressUntil = 0;
    if (suppress) {
      quakePointerTrace("controls-end-menu-gate", { allow: false, reason: "resume-suppress" });
      return false;
    }
  }
  if (quakeDeathUnlockMenuSuppressUntil > 0) {
    const suppress = performance.now() <= quakeDeathUnlockMenuSuppressUntil;
    quakeDeathUnlockMenuSuppressUntil = 0;
    if (suppress) {
      if (!isQuakeDeathUnlockControlsEndTraceSuppressed()) {
        quakePointerTrace("controls-end-menu-gate", { allow: false, reason: "death-suppress" });
      }
      return false;
    }
  }
  const allow = !quakePlayerDead;
  quakePointerTrace("controls-end-menu-gate", { allow, reason: allow ? "allow" : "dead" });
  return allow;
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
  suppressQuakeControlsEndTraceOnDeathUnlock();
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
  quakeDeathUnlockControlsEndTraceSuppressUntil = 0;
  document.body.classList.remove("quake-dead");
  clearQuakeDeathOverlay();
  setQuakeHudDamageCue(false);
  setQuakeDamageOverlay(false);
  controls.update({ lookEnabled: true, moveEnabled: false, jumpEnabled: false, crouchEnabled: false, jumpVelocity: QUAKE_JUMP_VELOCITY, gravity: 0 });
}

function showQuakeDeathOverlay(): void {
  if (!loadingOverlay) return;
  clearQuakeLoadingConsoleQueue();
  loadingOverlay.hidden = false;
  loadingOverlay.classList.add("quake-loading-death");
  loadingOverlay.setAttribute("aria-busy", "false");
  quakeLoadingConsoleLines = ["you died"];
  quakeLoadingConsoleLineKeys = [null];
  quakeLoadingConsoleLastStatus = "you died";
  quakeLoadingConsoleCurrentStatus = "you died";
  renderQuakeLoadingConsole();
  if (loadingProgress) loadingProgress.hidden = true;
  if (loadingAction) {
    loadingAction.textContent = "";
    loadingAction.hidden = true;
  }
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
  setQuakeGameplayStarted(true);
}

function resumeQuakeGameplayAfterMapLoad(): void {
  if (!currentResult || quakeAppLoading || quakePlayerDead) return;
  setQuakeGameplayStarted(true);
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
  return quakeDebugFlyMode && canUseQuakeGameplayInput();
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable]") !== null;
}

function isQuakeMobileControlsTarget(target: EventTarget | null): boolean {
  return target instanceof Node && quakeMobileControlsRoot?.contains(target) === true;
}

function shouldPreventQuakeGameplayKeyDefault(event: KeyboardEvent): boolean {
  return canUseQuakeGameplayInput() &&
    QUAKE_GAMEPLAY_KEY_CODES.has(event.code) &&
    !isEditableKeyboardTarget(event.target);
}

function quakeParentKeyTargetOrigin(): string | null {
  if (!QUAKE_PARENT_KEY_RELAY_ENABLED || window.parent === window || !document.referrer) return null;
  try {
    return new URL(document.referrer).origin;
  } catch {
    return null;
  }
}

function postQuakeParentKeyRelay(action: "down" | "up", code: string, key: string): void {
  if (QUAKE_PARENT_KEY_TARGET_ORIGIN === null) return;
  window.parent.postMessage({
    type: QUAKE_PARENT_KEY_MESSAGE_TYPE,
    action,
    code,
    key,
  }, QUAKE_PARENT_KEY_TARGET_ORIGIN);
}

function handleQuakeParentKeyRelay(event: KeyboardEvent, pressed: boolean): void {
  if (QUAKE_PARENT_KEY_TARGET_ORIGIN === null || !QUAKE_GAMEPLAY_KEY_CODES.has(event.code)) return;
  const key = quakeParentRelayedKeyCodesDown.get(event.code);
  if (!pressed) {
    if (key === undefined) return;
    quakeParentRelayedKeyCodesDown.delete(event.code);
    postQuakeParentKeyRelay("up", event.code, key);
    return;
  }
  if (event.repeat || key !== undefined || !canUseQuakeGameplayInput() || isEditableKeyboardTarget(event.target)) return;
  quakeParentRelayedKeyCodesDown.set(event.code, event.key);
  postQuakeParentKeyRelay("down", event.code, event.key);
}

function clearQuakeParentKeyRelay(): void {
  if (quakeParentRelayedKeyCodesDown.size === 0) return;
  const relayedKeys = Array.from(quakeParentRelayedKeyCodesDown);
  quakeParentRelayedKeyCodesDown.clear();
  if (window.parent === window) return;
  for (const [code, key] of relayedKeys) {
    postQuakeParentKeyRelay("up", code, key);
  }
}

function isQuakeDebugPanelTarget(target: EventTarget | null): boolean {
  return target instanceof Node &&
    debugPanel !== null &&
    debugPanel.contains(target);
}

function quakeDomNodeLabel(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes = Array.from(element.classList)
    .slice(0, 2)
    .map((className) => `.${className}`)
    .join("");
  return `${tag}${id}${classes}`;
}

function quakeEventTargetLabel(target: EventTarget | null): string | null {
  if (!target) return null;
  if (target === window) return "window";
  if (target === document) return "document";
  if (target instanceof Element) return quakeDomNodeLabel(target);
  if (target instanceof Node) return target.nodeName.toLowerCase();
  return target.constructor?.name ?? typeof target;
}

function quakePointerLockElementLabel(): string | null {
  return quakeEventTargetLabel(document.pointerLockElement);
}

function quakeUserActivationTraceDetails(): QuakePointerTraceDetails {
  const activation = (navigator as Navigator & {
    userActivation?: {
      hasBeenActive: boolean;
      isActive: boolean;
    };
  }).userActivation;
  return {
    userActivationActive: activation?.isActive ?? null,
    userActivationHasBeenActive: activation?.hasBeenActive ?? null,
  };
}

function quakePointerErrorTraceDetails(error: unknown): QuakePointerTraceDetails {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message.slice(0, 200),
    };
  }
  return {
    errorName: typeof error,
    errorMessage: String(error).slice(0, 200),
  };
}

function shouldCaptureQuakePointerTrace(): boolean {
  return quakeDebugMode || isQuakeDebugHooksEnabled();
}

function shouldLogQuakePointerTraceToConsole(): boolean {
  return quakeDebugMode || quakeDebugPointerTraceConsole;
}

function syncQuakePointerTraceAccessors(): QuakePointerTraceWindow | null {
  if (!shouldCaptureQuakePointerTrace()) return null;
  const traceWindow = window as unknown as QuakePointerTraceWindow;
  traceWindow.__cssQuakePointerTrace ??= [];
  traceWindow.__cssQuakePointerTraceDump = () => JSON.stringify(traceWindow.__cssQuakePointerTrace ?? [], null, 2);
  traceWindow.__cssQuakePointerTraceClear = () => {
    quakePointerTraceSerial = 0;
    traceWindow.__cssQuakePointerTrace = [];
    syncQuakePointerTraceDom([]);
  };
  syncQuakePointerTraceDom(traceWindow.__cssQuakePointerTrace);
  return traceWindow;
}

function syncQuakePointerTraceDom(trace: readonly QuakePointerTraceEntry[]): void {
  let element = document.getElementById("quake-pointer-trace-dump") as HTMLScriptElement | null;
  if (!element) {
    element = document.createElement("script");
    element.id = "quake-pointer-trace-dump";
    element.type = "application/json";
    document.body.appendChild(element);
  }
  element.dataset.count = String(trace.length);
  element.textContent = JSON.stringify(trace);
}

function quakePointerTrace(kind: string, details: QuakePointerTraceDetails = {}): void {
  const traceWindow = syncQuakePointerTraceAccessors();
  if (!traceWindow) return;
  const trace = traceWindow.__cssQuakePointerTrace ?? [];
  const entry: QuakePointerTraceEntry = {
    id: ++quakePointerTraceSerial,
    at: Math.round(performance.now() * 10) / 10,
      kind,
      details: {
        debug: quakeDebugMode,
        pointerLocked: document.pointerLockElement === host,
        pointerLock: quakePointerLockElementLabel(),
      active: document.activeElement === host ? "host" : quakeEventTargetLabel(document.activeElement),
      menuOpen: menu.isMainMenuOpen(),
      panelOpen: menu.isMenuPanelOpen(),
      loading: quakeAppLoading,
      canInput: canUseQuakeGameplayInput(),
      bodyClass: document.body.className,
      ...details,
    },
  };
  trace.push(entry);
  if (trace.length > QUAKE_POINTER_TRACE_LIMIT) trace.splice(0, trace.length - QUAKE_POINTER_TRACE_LIMIT);
  traceWindow.__cssQuakePointerTrace = trace;
  syncQuakePointerTraceDom(trace);
  if (shouldLogQuakePointerTraceToConsole()) {
    console.debug(`cssquake:pointer ${JSON.stringify(entry)}`);
  }
}

function syncQuakeCrouchInput(): void {
  if (!player) return;
  player.setCrouching(canUseQuakeGameplayInput() && quakeCrouchKeyCodesDown.size > 0);
}

function clearQuakeMoveInput(): void {
  clearQuakeParentKeyRelay();
  player?.clearMoveInput();
  clearQuakeMobileMoveInput();
  clearQuakeMobileLookInput();
}

function handleQuakeMoveKey(event: KeyboardEvent, pressed: boolean): boolean {
  if (quakeDebugFlyMode) return false;
  if (!QUAKE_MOVE_KEY_CODES.has(event.code) && !QUAKE_SPEED_KEY_CODES.has(event.code) && event.code !== "Space") return false;
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
  if (quakeDebugFlyMode) return false;
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
  if (!quakeDebugFlyMode || !quakeDebugFlyKeyCode(event.code)) return false;
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
  const groups = new Map<string, { completed: number; total: number }>();

  const groupForStatus = (groupStatus: string) => {
    let group = groups.get(groupStatus);
    if (!group) {
      group = { completed: 0, total: 0 };
      groups.set(groupStatus, group);
    }
    return group;
  };

  const render = () => {
    const actualProgress = total > 0 ? completed / total : 0;
    visualProgress = total > 0 ? Math.max(visualProgress, actualProgress) : 0;
    const group = groups.get(currentStatus);
    updateQuakeLoadingDisplay(currentStatus, {
      completed: group?.completed ?? completed,
      total: group?.total ?? total,
      visualProgress,
    });
  };

  return {
    setStatus(nextStatus) {
      currentStatus = nextStatus;
      render();
    },
    startTask(taskStatus = currentStatus) {
      let done = false;
      const group = groupForStatus(taskStatus);
      currentStatus = taskStatus;
      group.total++;
      total++;
      render();
      return () => {
        if (done) return;
        done = true;
        currentStatus = taskStatus;
        group.completed = Math.min(group.total, group.completed + 1);
        completed = Math.min(total, completed + 1);
        render();
      };
    },
  };
}

function quakeLoadingProgressGroup(
  progress: QuakeLoadingProgressTracker | undefined,
  status: string,
): QuakeLoadingProgressTracker | undefined {
  if (!progress) return undefined;
  return {
    setStatus(nextStatus) {
      progress.setStatus(nextStatus);
    },
    startTask(taskStatus = status) {
      return progress.startTask(taskStatus);
    },
  };
}

function resetQuakeLoadingConsole(status = "Loading"): void {
  clearQuakeLoadingConsoleQueue();
  quakeLoadingConsoleLines = [];
  quakeLoadingConsoleLineKeys = [];
  quakeLoadingConsoleLastStatus = "";
  quakeLoadingConsoleCurrentStatus = "";
  renderQuakeLoadingConsole();
  if (!currentResult && status === "Loading") {
    for (const line of QUAKE_LOADING_CONSOLE_BOOT_LINES) {
      queueQuakeLoadingConsoleLine(line);
    }
  }
  if (!currentResult && status === "Loading") return;
  updateQuakeLoadingConsoleStatus(status, 0, 0);
}

function clearQuakeLoadingConsoleQueue(): void {
  if (quakeLoadingConsoleLineTimer !== null) {
    window.clearTimeout(quakeLoadingConsoleLineTimer);
    quakeLoadingConsoleLineTimer = null;
  }
  quakeLoadingConsoleLineQueue = [];
}

function completeQuakeLoadingConsoleQueue(): void {
  if (quakeLoadingConsoleLineTimer !== null) {
    window.clearTimeout(quakeLoadingConsoleLineTimer);
    quakeLoadingConsoleLineTimer = null;
  }
  if (quakeLoadingConsoleLineQueue.length === 0) return;
  const queuedLines = quakeLoadingConsoleLineQueue;
  quakeLoadingConsoleLineQueue = [];
  for (const queued of queuedLines) {
    appendQuakeLoadingConsoleLineNow(queued.line, queued.key, { render: false });
  }
  renderQuakeLoadingConsole();
}

function appendQuakeLoadingConsoleLinesNow(lines: string[]): void {
  if (!lines.length) return;
  if (quakeLoadingConsoleLineTimer !== null) {
    window.clearTimeout(quakeLoadingConsoleLineTimer);
    quakeLoadingConsoleLineTimer = null;
  }
  quakeLoadingConsoleLineQueue = [];
  for (const line of lines) {
    appendQuakeLoadingConsoleLineNow(line, null, { render: false });
  }
  renderQuakeLoadingConsole();
}

function quakeLoadingErrorConsoleLines(error: unknown): string[] {
  if (error === undefined || error === null) return [];
  const rawLines = quakeLoadingErrorText(error)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines: string[] = [];
  for (let index = 0; index < rawLines.length && lines.length < QUAKE_LOADING_ERROR_LINE_LIMIT; index++) {
    const prefix = index === 0 ? "error: " : "";
    for (const line of wrapQuakeLoadingConsoleLine(`${prefix}${rawLines[index]}`)) {
      lines.push(line);
      if (lines.length >= QUAKE_LOADING_ERROR_LINE_LIMIT) break;
    }
  }
  return lines;
}

function quakeLoadingErrorText(error: unknown): string {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    const json = JSON.stringify(error);
    if (json) return json;
  } catch {
    // Fall through to String().
  }
  return String(error);
}

function wrapQuakeLoadingConsoleLine(line: string): string[] {
  if (line.length <= QUAKE_LOADING_ERROR_LINE_MAX_CHARS) return [line];
  const words = line.split(/\s+/).filter(Boolean);
  const wrapped: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > QUAKE_LOADING_ERROR_LINE_MAX_CHARS) {
      if (current) {
        wrapped.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += QUAKE_LOADING_ERROR_LINE_MAX_CHARS) {
        wrapped.push(word.slice(index, index + QUAKE_LOADING_ERROR_LINE_MAX_CHARS));
      }
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length <= QUAKE_LOADING_ERROR_LINE_MAX_CHARS) {
      current = next;
    } else {
      wrapped.push(current);
      current = word;
    }
  }
  if (current) wrapped.push(current);
  return wrapped.length ? wrapped : [line.slice(0, QUAKE_LOADING_ERROR_LINE_MAX_CHARS)];
}

function queueQuakeLoadingConsoleLine(status: string, key: string | null = null): void {
  if (!canQueueQuakeLoadingConsole()) return;
  const line = status.replace(/\s+/g, " ").trim();
  if (!line) return;
  if (key && (replaceDisplayedQuakeLoadingConsoleLine(key, line) || replaceQueuedQuakeLoadingConsoleLine(key, line))) return;
  const lastQueuedLine = quakeLoadingConsoleLineQueue[quakeLoadingConsoleLineQueue.length - 1]?.line;
  if (!key && (line === quakeLoadingConsoleLastStatus || lastQueuedLine === line)) return;
  quakeLoadingConsoleLineQueue.push({ key, line });
  scheduleQuakeLoadingConsoleLine();
}

function replaceDisplayedQuakeLoadingConsoleLine(key: string, line: string): boolean {
  const index = quakeLoadingConsoleLineKeys.lastIndexOf(key);
  if (index < 0) return false;
  if (quakeLoadingConsoleLines[index] === line) return true;
  quakeLoadingConsoleLines[index] = line;
  if (index === quakeLoadingConsoleLines.length - 1) {
    quakeLoadingConsoleLastStatus = line;
    quakeLoadingConsoleCurrentStatus = key;
  }
  renderQuakeLoadingConsole();
  return true;
}

function replaceQueuedQuakeLoadingConsoleLine(key: string, line: string): boolean {
  for (const queued of quakeLoadingConsoleLineQueue) {
    if (queued.key !== key) continue;
    queued.line = line;
    return true;
  }
  return false;
}

function scheduleQuakeLoadingConsoleLine(): void {
  if (quakeLoadingConsoleLineTimer !== null || quakeLoadingConsoleLineQueue.length === 0) return;
  if (!canQueueQuakeLoadingConsole()) {
    clearQuakeLoadingConsoleQueue();
    return;
  }
  const delay = quakeLoadingConsoleLines.length === 0 ? 0 : QUAKE_LOADING_CONSOLE_LINE_DELAY_MS;
  quakeLoadingConsoleLineTimer = window.setTimeout(flushQuakeLoadingConsoleLine, delay);
}

function flushQuakeLoadingConsoleLine(): void {
  quakeLoadingConsoleLineTimer = null;
  if (!canQueueQuakeLoadingConsole()) {
    clearQuakeLoadingConsoleQueue();
    return;
  }
  const queued = quakeLoadingConsoleLineQueue.shift();
  if (queued) appendQuakeLoadingConsoleLineNow(queued.line, queued.key);
  scheduleQuakeLoadingConsoleLine();
}

function appendQuakeLoadingConsoleLineNow(
  line: string,
  key: string | null,
  options: { render?: boolean } = {},
): void {
  if (key) quakeLoadingConsoleCurrentStatus = key;
  quakeLoadingConsoleLastStatus = line;
  quakeLoadingConsoleLines.push(line);
  quakeLoadingConsoleLineKeys.push(key);
  if (quakeLoadingConsoleLines.length > QUAKE_LOADING_CONSOLE_MAX_LINES) {
    quakeLoadingConsoleLines = quakeLoadingConsoleLines.slice(-QUAKE_LOADING_CONSOLE_MAX_LINES);
    quakeLoadingConsoleLineKeys = quakeLoadingConsoleLineKeys.slice(-QUAKE_LOADING_CONSOLE_MAX_LINES);
  }
  if (options.render === false) return;
  renderQuakeLoadingConsole();
}

function renderQuakeLoadingConsole(): void {
  if (!loadingStatus || !canRenderQuakeLoadingConsole()) return;
  loadingStatus.textContent = "";
  const fragment = document.createDocumentFragment();
  for (const line of quakeLoadingConsoleLines) {
    const element = document.createElement("span");
    element.className = "quake-loading-console-line quake-bm-copy";
    element.textContent = line;
    fragment.append(element);
  }
  loadingStatus.append(fragment);
  loadingStatus.setAttribute("aria-label", quakeLoadingConsoleLines.join("\n"));
  mountQuakeBitmapText(loadingStatus);
}

function canRenderQuakeLoadingConsole(): boolean {
  return Boolean(loadingOverlay && !loadingOverlay.hidden);
}

function canQueueQuakeLoadingConsole(): boolean {
  return quakeAppLoading || loadingOverlay?.classList.contains("quake-loading-death") === true;
}

function updateQuakeLoadingConsoleStatus(status: string, completed: number, total: number): void {
  if (!canQueueQuakeLoadingConsole()) return;
  const key = status.replace(/\s+/g, " ").trim() || "Loading";
  const line = formatQuakeLoadingConsoleStatus(key, completed, total);
  if (
    key === quakeLoadingConsoleCurrentStatus &&
    quakeLoadingConsoleLines.length > 0 &&
    quakeLoadingConsoleLineKeys[quakeLoadingConsoleLineKeys.length - 1] === key
  ) {
    if (quakeLoadingConsoleLines[quakeLoadingConsoleLines.length - 1] === line) return;
    quakeLoadingConsoleLines[quakeLoadingConsoleLines.length - 1] = line;
    quakeLoadingConsoleLastStatus = line;
    renderQuakeLoadingConsole();
    return;
  }
  queueQuakeLoadingConsoleLine(line, key);
}

function formatQuakeLoadingConsoleStatus(status: string, completed: number, total: number): string {
  const label = quakeLoadingConsoleStatusLabel(status);
  if (label.startsWith("error:")) return label;
  if (total <= 1) return label;
  return `${label} ${completed}/${total}`;
}

function quakeLoadingConsoleStatusLabel(status: string): string {
  const label = status.replace(/\s+/g, " ").trim() || "Loading";
  switch (label) {
    case "Loading":
      return "Loading Quake data";
    case "Manifest":
      return "Loaded manifest";
    case "Loading manifest":
      return "Loaded manifest";
    case "Game logic":
      return "Loaded progs";
    case "Pickup definitions":
      return "Loaded definitions";
    case "Weapon model":
      return "Weapon model";
    case "Pickup models":
      return "Pickup models";
    case "Monster models":
      return "Monster models";
    case "Map model assets":
      return "Brush/submodels";
    case "Loading models":
      return "Models";
    case "Preparing view":
      return "Rendered first frame";
    case "Load failed":
      return "Load failed";
    case QUAKE_ASSETS_REGENERATING_STATUS:
      return QUAKE_ASSETS_REGENERATING_STATUS;
    default:
      break;
  }
  const worldBspMatch = /^World ([a-z0-9_]+)\.bsp$/i.exec(label);
  if (worldBspMatch) return `World BSP: ${worldBspMatch[1].toLowerCase()}.bsp`;
  const mapModelsMatch = /^Loading ([a-z0-9_]+) models$/i.exec(label);
  if (mapModelsMatch) return `Precache ${mapModelsMatch[1].toLowerCase()} models`;
  const mapMatch = /^Loading ([a-z0-9_]+)$/i.exec(label);
  if (mapMatch) return `World ${mapMatch[1].toLowerCase()}.bsp`;
  return label;
}

function setQuakeLoading(active: boolean, status = "Loading"): void {
  const wasLoading = quakeAppLoading;
  quakeAppLoading = active;
  if (active) {
    if (!wasLoading) {
      markQuakeTrace("loading-start", { map: currentMapName, status });
    }
    clearQuakeAttackInput();
    clearQuakeDebugFlyInput();
    clearQuakeMoveInput();
    clearQuakeMobileMoveInput();
    clearQuakeCrouchInput();
    clearQuakeWeaponViewPunch();
    clearQuakeBonusOverlay();
    hideQuakeStatsOverlay();
    document.body.classList.add("quake-loading");
    loadingOverlay?.classList.remove("quake-loading-console-persisted");
    resetQuakeLoadingConsole(status);
    if (!(status === "Loading" && !currentResult)) {
      updateQuakeLoadingDisplay(status, { completed: 0, total: 0 });
    }
    if (loadingAction) {
      loadingAction.textContent = "";
      loadingAction.hidden = true;
    }
    if (loadingProgress) loadingProgress.hidden = false;
    if (loadingOverlay) {
      loadingOverlay.hidden = false;
      loadingOverlay.setAttribute("aria-busy", "true");
    }
    controls.update({ moveEnabled: false, jumpEnabled: false, gravity: 0 });
    clearQuakeCrosshairTarget();
    return;
  }

  if (QUAKE_LOADING_PREVIEW_ENABLED || !quakeGameplayStarted) {
    document.body.classList.add("quake-loading");
    if (loadingOverlay) {
      loadingOverlay.hidden = false;
      loadingOverlay.setAttribute("aria-busy", "false");
      loadingOverlay.classList.add("quake-loading-console-persisted");
    }
  } else {
    document.body.classList.remove("quake-loading");
    if (loadingOverlay) {
      loadingOverlay.hidden = true;
      loadingOverlay.removeAttribute("aria-busy");
      loadingOverlay.classList.remove("quake-loading-console-persisted");
    }
  }
  completeQuakeLoadingConsoleQueue();
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

function hideQuakeMainMenuForLoadingError(): void {
  document.body.classList.remove("quake-menu-open", "quake-main-menu-pending");
  document.body.classList.add("quake-main-menu-deferred");
  if (mainMenu) mainMenu.hidden = true;
  singlePlayerPanel?.setAttribute("hidden", "");
  levelPanel?.setAttribute("hidden", "");
  aboutPanel?.setAttribute("hidden", "");
  optionsPanel?.setAttribute("hidden", "");
  debugMenuPanel?.setAttribute("hidden", "");
}

function setQuakeLoadingError(error?: unknown): void {
  quakeAppLoading = true;
  clearQuakeAttackInput();
  clearQuakeDebugFlyInput();
  clearQuakeMoveInput();
  clearQuakeMobileMoveInput();
  clearQuakeCrouchInput();
  clearQuakeWeaponViewPunch();
  clearQuakeBonusOverlay();
  document.body.classList.add("quake-loading");
  hideQuakeMainMenuForLoadingError();
  if (loadingOverlay) {
    loadingOverlay.hidden = false;
    loadingOverlay.setAttribute("aria-busy", "false");
    loadingOverlay.classList.add("quake-loading-console-persisted");
  }
  resetQuakeLoadingConsole("Load failed");
  updateQuakeLoadingDisplay("Load failed", { completed: 0, total: 0 });
  completeQuakeLoadingConsoleQueue();
  appendQuakeLoadingConsoleLinesNow(quakeLoadingErrorConsoleLines(error));
  if (loadingAction) {
    loadingAction.textContent = "";
    loadingAction.hidden = true;
  }
  if (loadingProgress) loadingProgress.hidden = true;
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
  resetQuakeLoadingConsole(QUAKE_ASSETS_REGENERATING_STATUS);
  updateQuakeLoadingDisplay(QUAKE_ASSETS_REGENERATING_STATUS, { completed: 0, total: 0 });
  if (loadingAction) {
    loadingAction.textContent = message;
    loadingAction.hidden = false;
    mountQuakeBitmapText(loadingAction);
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
  updateQuakeLoadingConsoleStatus(status, completed, total);
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

function addQuakeWeaponProjectileMesh(
  modelPath: string,
  weapon: QuakeWeaponId,
): QuakeWeaponProjectileVisualHandle | null {
  const model = currentPickupModelLibrary?.models[modelPath];
  if (!model) return null;
  const frameSet = quakePickupModelRenderBundleFrameSet(model);
  const handle = frameSet
    ? mountQuakeRenderBundleFrameSetMesh(sceneElement, frameSet, 0)
    : mountQuakeRenderBundleMesh(sceneElement, quakePickupModelRenderBundle(model, 0));
  if (!handle) return null;
  handle.element.classList.add("player-projectile", `player-projectile-${weapon}`);
  stripPolyMeshMetadata(handle.element);
  return {
    handle,
    scale: model.renderScale ? 1 / model.renderScale : 1,
  };
}

function showQuakeLightningBeam(beam: QuakeWeaponLightningBeamVisual): void {
  if (beam.tempEntity !== "TE_LIGHTNING2") return;
  const polygons = quakeLightningBeamPolygons(beam.start, beam.end);
  if (!polygons.length) return;
  const handle = scene.add(makeParseResult(polygons), {
    merge: false,
    meshResolution: "lossless",
    excludeFromAutoCenter: true,
  });
  handle.element.classList.add("player-lightning-beam", `player-lightning-beam-${beam.weapon}`);
  handle.element.dataset.tempEntity = beam.tempEntity;
  stripPolyMeshMetadata(handle.element);
  quakeLightningBeamHandles.add(handle);
  const timer = window.setTimeout(() => removeQuakeLightningBeam(handle), QUAKE_LIGHTNING_BEAM_VISUAL_MS);
  quakeLightningBeamTimers.set(handle, timer);
}

function removeQuakeLightningBeam(handle: PolyMeshHandle): void {
  const timer = quakeLightningBeamTimers.get(handle);
  if (timer !== undefined) window.clearTimeout(timer);
  quakeLightningBeamTimers.delete(handle);
  if (!quakeLightningBeamHandles.delete(handle)) return;
  handle.remove();
}

function clearQuakeLightningBeams(): void {
  for (const handle of [...quakeLightningBeamHandles]) removeQuakeLightningBeam(handle);
}

function quakeLightningBeamPolygons(start: Vec3, end: Vec3): Polygon[] {
  const delta = subtractVec3(end, start);
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  if (length <= COLLISION_EPSILON) return [];
  const direction = normalizeVec3(delta);
  const reference: Vec3 = Math.abs(direction[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
  const side = scaleVec3(normalizeVec3(crossVec3(direction, reference)), QUAKE_LIGHTNING_BEAM_OUTER_RADIUS);
  const up = scaleVec3(normalizeVec3(crossVec3(side, direction)), QUAKE_LIGHTNING_BEAM_INNER_RADIUS);
  return [
    lightningBeamQuad(start, end, side, "#d9ffff"),
    lightningBeamQuad(start, end, up, "#66f8ff"),
  ];
}

function lightningBeamQuad(start: Vec3, end: Vec3, offset: Vec3, color: string): Polygon {
  return {
    color,
    vertices: [
      subtractVec3(start, offset),
      subtractVec3(end, offset),
      addVec3(end, offset),
      addVec3(start, offset),
    ],
  };
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scaleVec3(value: Vec3, scale: number): Vec3 {
  return [value[0] * scale, value[1] * scale, value[2] * scale];
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

function quakePolyToPoint(origin: Vec3): { x: number; y: number; z: number } {
  return {
    x: origin[0] / QUAKE_COLLISION_UNIT_SCALE + quakeModelPivot.x,
    y: origin[1] / QUAKE_COLLISION_UNIT_SCALE + quakeModelPivot.y,
    z: origin[2] / QUAKE_COLLISION_UNIT_SCALE + quakeModelPivot.z,
  };
}

function quakeUrlViewFromCssView(view: QuakeCssView): QuakeUrlView {
  const point = quakePolyToPoint([
    view.origin[0],
    view.origin[1],
    view.origin[2] - QUAKE_PLAYER_MINS_Z - getPlayer().eyeHeight(),
  ]);
  return {
    origin: [point.x, point.y, point.z],
    pitch: 90 - view.rotX,
    yaw: normalizeQuakeUrlAngle(view.rotY - 180),
    roll: 0,
  };
}

function quakeCssViewFromUrlView(view: QuakeUrlView): QuakeCssView {
  const origin = quakePointToPoly({
    x: view.origin[0],
    y: view.origin[1],
    z: view.origin[2],
  });
  return {
    origin: [
      origin[0],
      origin[1],
      origin[2] + QUAKE_PLAYER_MINS_Z + getPlayer().eyeHeight(),
    ],
    rotX: 90 - view.pitch,
    rotY: normalizeQuakeUrlAngle(180 + view.yaw),
  };
}

function quakeUrlRouteView(route: QuakeUrlRoute): QuakeCssView | null {
  return route.view ? quakeCssViewFromUrlView(route.view) : null;
}

function quakeMapLoadView(options: QuakeMapLoadOptions): QuakeCssView | null {
  return options.view ? quakeCssViewFromUrlView(options.view) : null;
}

function disposeCurrentScene(): void {
  clearQuakeAttackInput();
  clearQuakeDebugFlyInput();
  clearQuakeWeaponViewPunch();
  clearQuakeMegahealthRot();
  clearQuakePowerups();
  clearQuakeBonusOverlay();
  viewmodel.remove();
  mountedWeaponViewModelPath = null;
  pendingWeaponViewModelPath = null;
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
  clearQuakeLightningBeams();
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

function playQuakeWeaponFireFeedback(animation?: QuakeViewmodelFireAnimation): void {
  viewmodel.playFireAnimation(animation);
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
}

function playQuakeDamageViewFeedback(feedback: QuakePlayerDamageFeedback | undefined): void {
  const amount = Math.max(10, feedback?.amount ?? 10);
  punchQuakeWeaponView(Math.min(QUAKE_DAMAGE_VIEW_PITCH_MAX_DEG, amount * QUAKE_DAMAGE_VIEW_PITCH_SCALE));
}

function lookOffset(): number {
  const value = Number.parseFloat(quakeCameraPerspectiveStyle || scene.camera.perspectiveStyle);
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
  if (quakeAppDisposed || quakeDebugFlyFrame || !quakeDebugFlyMode) return;
  quakeDebugFlyFrame = window.requestAnimationFrame(runQuakeDebugFlyFrame);
}

function runQuakeDebugFlyFrame(now: number): void {
  quakeDebugFlyFrame = 0;
  if (!quakeDebugFlyMode) {
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
  shootables.spawn(quakeShootableRuntimeEntities(runtime), currentPickupModelLibrary, currentProgramMetadata);
  setupQuakeMonsterJumpTriggers(result);
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

function quakeShootableRuntimeEntities(runtime: QuakeScene["entityManifest"]["runtime"]): QuakeEntity[] {
  return quakeEntitiesForIndexes([
    ...runtime.shootableEntityIndexes,
    ...runtime.moverSupportEntityIndexes,
  ]);
}

function setupQuakeMonsterJumpTriggers(result: QuakeScene): void {
  shootables.setupMonsterJumpTriggers(
    result.entities.filter((entity) => entity.classname === "trigger_monsterjump"),
    result.models,
    result.collision?.pivot ?? quakeModelPivot,
    result.gameLogic,
  );
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
  if (entity.classname.startsWith("monster_")) {
    return shootables.activate(entity.index, { skill: quakeSkill });
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
  if (entity.classname === "event_lightning") {
    return shootables.triggerBossLightning({ skill: quakeSkill });
  }
  return false;
}

function quakeBossLightningElectrodesReady(
  targetName: string,
  alignment: QuakeBossLightningAlignment,
): boolean {
  if (alignment.targetField !== "target") return false;
  const states = quakeBossLightningElectrodeStates(targetName);
  if (states.length < 2) return false;
  const firstState = states[0];
  const secondState = states[1];
  if (!alignment.validStates.includes(firstState) || !alignment.validStates.includes(secondState)) return false;
  if (alignment.requiresMatchingState && firstState !== secondState) return false;
  return firstState === alignment.damageState;
}

function quakeBossLightningDischarge(targetName: string, lightning: QuakeBossLightningDischarge): void {
  const resetAfterMs = lightning.resetAfterMs;
  if (resetAfterMs === undefined || resetAfterMs <= 0) return;
  movers.forceDoorsDownAfter(targetName, resetAfterMs);
}

function quakeBossLightningElectrodeStates(targetName: string): Array<NonNullable<ReturnType<typeof quakeDoorTerminalState>>> {
  const entities = [...entityByIndex.values()]
    .filter((entity) => entity.properties.target === targetName)
    .sort((a, b) => a.index - b.index)
    .slice(0, 2);
  const states: Array<NonNullable<ReturnType<typeof quakeDoorTerminalState>>> = [];
  for (const entity of entities) {
    const terminalState = quakeDoorTerminalStateForEntity(entity.index);
    if (!terminalState) return [];
    states.push(terminalState);
  }
  return states;
}

function quakeDoorTerminalStateForEntity(entityIndex: number): ReturnType<typeof quakeDoorTerminalState> {
  const mover = movers.get(entityIndex);
  return mover ? quakeDoorTerminalState(mover) : null;
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
  const activation = quakeSolidGateActivation(entity);
  if (!activation) return false;
  showQuakeCenterPrint(activation.message);
  return true;
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
    const emitter = quakeFireballEmitterFromEntity(entity, quakePointToPoly, now);
    if (emitter) quakeFireballEmitters.push(emitter);
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
  if (isQuakeGamePaused()) {
    quakePointHazardTime = 0;
    quakePointHazardFrame = window.requestAnimationFrame(tickQuakePointHazards);
    return;
  }
  const dt = Math.min(QUAKE_POINT_HAZARD_DT_CLAMP, quakePointHazardTime ? (now - quakePointHazardTime) / 1000 : 0.0167);
  quakePointHazardTime = now;
  spawnDueQuakeFireballs(now);
  moveQuakePointHazards(dt, now);
  if (quakePointHazards.length) syncQuakeHazards(getPlayer().currentOrigin());
  quakePointHazardFrame = window.requestAnimationFrame(tickQuakePointHazards);
}

function spawnDueQuakeFireballs(now: number): void {
  quakeSpawnDueFireballs(
    quakeFireballEmitters,
    quakePointHazards,
    now,
    (entityIndex) => targetSystem.isDisabled(entityIndex),
  );
}

function moveQuakePointHazards(dt: number, now: number): void {
  quakePointHazards = quakeMovePointHazards(
    quakePointHazards,
    dt,
    now,
    QUAKE_GRAVITY,
    (entityIndex) => targetSystem.isDisabled(entityIndex),
  );
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
  let timer = 0;
  const resetBrush = (): void => {
    quakeDamageableBrushResetTimers = quakeDamageableBrushResetTimers.filter((item) => item !== timer);
    if (isQuakeGamePaused()) {
      timer = window.setTimeout(resetBrush, QUAKE_PAUSED_TIMER_POLL_MS);
      quakeDamageableBrushResetTimers.push(timer);
      return;
    }
    if (!targetSystem.isDisabled(entity.index)) {
      quakeDamageableBrushHealth.set(entity.index, quakeDamageableBrushMaxHealth(entity));
    }
  };
  timer = window.setTimeout(resetBrush, wait * 1000);
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

function moverBlockedByActor(state: QuakeMoverState, nextOffset: Vec3, delta: Vec3): boolean {
  return moverBlockedByPlayer(state, nextOffset, delta) ||
    moverBlockedByMonster(state, nextOffset, delta);
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

function moverBlockedByMonster(state: QuakeMoverState, nextOffset: Vec3, delta: Vec3): boolean {
  if (!moverCanBeBlockedByMonster(state)) return false;
  if (distanceSq3(delta, [0, 0, 0]) <= COLLISION_EPSILON) return false;
  const blockerEntityIndex = shootables.firstMonsterOverlappingBounds(quakeMoverBoundsAtOffsetBounds(state, nextOffset));
  if (blockerEntityIndex === null) return false;
  damageQuakeMonsterForMoverBlock(state, blockerEntityIndex);
  return true;
}

function moverCanBeBlockedByMonster(state: QuakeMoverState): boolean {
  return state.kind === "door" ||
    state.kind === "secret-door" ||
    state.kind === "plat" ||
    state.kind === "train";
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
  damageQuakeActorForMoverBlock(state, (amount) => getPlayer().damage(amount));
}

function damageQuakeMonsterForMoverBlock(state: QuakeMoverState, entityIndex: number): void {
  damageQuakeActorForMoverBlock(state, (amount) => shootables.damage(entityIndex, amount));
}

function damageQuakeActorForMoverBlock(state: QuakeMoverState, applyDamage: (amount: number) => boolean): void {
  const amount = quakeMoverBlockDamage(state);
  if (amount <= 0) return;
  const cooldownMs = quakeMoverBlockDamageCooldownMs(state);
  if (cooldownMs > 0) {
    const now = performance.now();
    const lastDamageAt = quakeMoverCrushDamageAt.get(state.entity.index) ?? -Infinity;
    if (now - lastDamageAt < cooldownMs) return;
    quakeMoverCrushDamageAt.set(state.entity.index, now);
  }
  applyDamage(amount);
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

function quakeMoverBoundsAtOffsetBounds(state: QuakeMoverState, offset: Vec3): QuakeShootableBounds {
  const bounds = quakeMoverBoundsAtOffset(state, offset);
  return {
    min: [bounds.minX, bounds.minY, bounds.minZ],
    max: [bounds.maxX, bounds.maxY, bounds.maxZ],
  };
}

function carryPlayerWithMover(state: QuakeMoverState, delta: Vec3): void {
  getPlayer().carryWithMover(delta, state.entity.index);
}

function applyMoverLeafTransform(leaf: QuakeFaceLeaf): void {
  const state = leaf.entityIndex !== undefined ? movers.get(leaf.entityIndex) : undefined;
  if (!state || distanceSq3(state.offset, [0, 0, 0]) <= COLLISION_EPSILON) {
    leaf.element.style.transform = leaf.baseTransform;
    compactQuakeInlineStyle(leaf.element);
    return;
  }
  leaf.element.style.transform = `${quakeOffsetCss(state.offset)} ${leaf.baseTransform}`;
  compactQuakeInlineStyle(leaf.element);
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
  quakePointerTrace("host-pointerdown", {
    button: event.button,
    primary: event.isPrimary,
    pointerId: event.pointerId,
    target: quakeEventTargetLabel(event.target),
    defaultPrevented: event.defaultPrevented,
  });
  if (isQuakeMobileControlsTarget(event.target)) {
    quakePointerTrace("host-pointerdown-ignored", { pointerId: event.pointerId, reason: "mobile-controls" });
    return;
  }
  if (event.button !== 0 || !event.isPrimary) {
    quakePointerTrace("host-pointerdown-ignored", {
      button: event.button,
      primary: event.isPrimary,
      reason: "button-or-non-primary",
    });
    return;
  }
  if (quakePlayerDead) {
    quakePointerTrace("host-pointerdown-respawn", { pointerId: event.pointerId });
    event.preventDefault();
    event.stopPropagation();
    clearQuakeAttackInput();
    audio.unlock();
    respawnQuakePlayerFromDeath();
    return;
  }
  if (!canUseQuakeGameplayInput()) {
    quakePointerTrace("host-pointerdown-ignored", { pointerId: event.pointerId, reason: "cannot-input" });
    return;
  }
  hidePersistedQuakeLoadingConsole();
  event.preventDefault();
  const now = performance.now();
  if (document.pointerLockElement !== host) {
    clearQuakeAttackInput();
    engageQuakePointerControls(now);
    queueQuakeCrosshairTargetSync();
    return;
  }
  if (quakeAttackInputDown) {
    scheduleQuakeAttackFrame();
    return;
  }
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
    quakePointerTrace("controls-lock-request", {
      retryAt: Math.round(quakePointerLockRetryAt * 10) / 10,
      ...quakeUserActivationTraceDetails(),
    });
    controls.lock();
  }
}

function handleQuakePointerLockError(event: Event): void {
  quakePointerTrace("pointerlockerror", { target: quakeEventTargetLabel(event.target) });
}

function handleQuakeControlsStart(): void {
  syncQuakeInteractionPresentation();
  quakePointerTrace("controls-start");
  clearQuakeMainMenuControlsEndSuppression();
}

function handleQuakeControlsEndTrace(): void {
  syncQuakeInteractionPresentation();
  clearQuakeParentKeyRelay();
  if (isQuakeDeathUnlockControlsEndTraceSuppressed()) {
    quakeDeathUnlockControlsEndTraceSuppressUntil = 0;
    return;
  }
  quakeDeathUnlockControlsEndTraceSuppressUntil = 0;
  quakePointerTrace("controls-end");
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
  const pointerId = quakeAttackPointerId;
  releaseQuakeMobileFirePointerCapture(pointerId);
  quakeAttackInputDown = false;
  quakeAttackPointerId = null;
  if (!quakeAttackFrame) return;
  window.cancelAnimationFrame(quakeAttackFrame);
  quakeAttackFrame = 0;
}

function releaseQuakeMobileFirePointerCapture(pointerId: number | null): void {
  if (pointerId === null || !quakeMobileFireButton?.hasPointerCapture(pointerId)) return;
  try {
    quakeMobileFireButton.releasePointerCapture(pointerId);
  } catch {
    // The browser may already have released capture on pointer cancellation.
  }
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

  const lookZone = document.createElement("div");
  lookZone.id = "quake-mobile-look-zone";

  const moveZone = document.createElement("div");
  moveZone.id = "quake-mobile-move-zone";

  const fireButton = document.createElement("button");
  fireButton.id = "quake-mobile-fire";
  fireButton.type = "button";
  fireButton.setAttribute("aria-label", "Fire");

  root.append(lookZone, moveZone, fireButton);
  quakeApp.append(root);

  quakeMobileControlsRoot = root;
  quakeMobileLookZone = lookZone;
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
  lookZone.addEventListener("pointerdown", handleQuakeMobileLookPointerDown);
  lookZone.addEventListener("pointermove", handleQuakeMobileLookPointerMove);
  lookZone.addEventListener("pointerup", handleQuakeMobileLookPointerEnd);
  lookZone.addEventListener("pointercancel", handleQuakeMobileLookPointerEnd);
  lookZone.addEventListener("lostpointercapture", handleQuakeMobileLookPointerEnd);
  fireButton.addEventListener("pointerdown", handleQuakeMobileFirePointerDown);
  fireButton.addEventListener("pointerup", handleQuakeMobileFirePointerEnd);
  fireButton.addEventListener("pointercancel", handleQuakeMobileFirePointerEnd);
  fireButton.addEventListener("lostpointercapture", handleQuakeMobileFirePointerEnd);
}

function destroyQuakeMobileControls(): void {
  clearQuakeMobileLookInput();
  clearQuakeMobileMoveInput();
  quakeMobileMoveStick?.destroy();
  quakeMobileMoveStick = null;
  quakeMobileLookZone?.removeEventListener("pointerdown", handleQuakeMobileLookPointerDown);
  quakeMobileLookZone?.removeEventListener("pointermove", handleQuakeMobileLookPointerMove);
  quakeMobileLookZone?.removeEventListener("pointerup", handleQuakeMobileLookPointerEnd);
  quakeMobileLookZone?.removeEventListener("pointercancel", handleQuakeMobileLookPointerEnd);
  quakeMobileLookZone?.removeEventListener("lostpointercapture", handleQuakeMobileLookPointerEnd);
  quakeMobileFireButton?.removeEventListener("pointerdown", handleQuakeMobileFirePointerDown);
  quakeMobileFireButton?.removeEventListener("pointerup", handleQuakeMobileFirePointerEnd);
  quakeMobileFireButton?.removeEventListener("pointercancel", handleQuakeMobileFirePointerEnd);
  quakeMobileFireButton?.removeEventListener("lostpointercapture", handleQuakeMobileFirePointerEnd);
  quakeMobileControlsRoot?.remove();
  quakeMobileControlsRoot = null;
  quakeMobileLookZone = null;
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

function handleQuakeMobileLookPointerDown(event: PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
  if (event.button !== 0 || quakeMobileLookPointerId !== null) return;
  audio.unlock();
  if (!canUseQuakeGameplayInput()) return;
  hidePersistedQuakeLoadingConsole();
  if (document.activeElement !== host) host.focus({ preventScroll: true });
  quakeMobileLookPointerId = event.pointerId;
  quakeMobileLookLastX = event.clientX;
  quakeMobileLookLastY = event.clientY;
  try {
    quakeMobileLookZone?.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture can fail if the pointer ended during the same frame.
  }
}

function handleQuakeMobileLookPointerMove(event: PointerEvent): void {
  if (event.pointerId !== quakeMobileLookPointerId) return;
  event.preventDefault();
  event.stopPropagation();
  if (!canUseQuakeGameplayInput()) {
    clearQuakeMobileLookInput();
    return;
  }
  const deltaX = event.clientX - quakeMobileLookLastX;
  const deltaY = event.clientY - quakeMobileLookLastY;
  quakeMobileLookLastX = event.clientX;
  quakeMobileLookLastY = event.clientY;
  applyQuakeMobileLookDelta(deltaX, deltaY);
}

function handleQuakeMobileLookPointerEnd(event: PointerEvent): void {
  if (event.pointerId !== quakeMobileLookPointerId) return;
  event.preventDefault();
  event.stopPropagation();
  clearQuakeMobileLookInput();
}

function clearQuakeMobileLookInput(): void {
  const pointerId = quakeMobileLookPointerId;
  if (pointerId !== null && quakeMobileLookZone?.hasPointerCapture(pointerId)) {
    try {
      quakeMobileLookZone.releasePointerCapture(pointerId);
    } catch {
      // The browser may already have released capture on pointer cancellation.
    }
  }
  quakeMobileLookPointerId = null;
  quakeMobileLookLastX = 0;
  quakeMobileLookLastY = 0;
}

function applyQuakeMobileLookDelta(deltaX: number, deltaY: number): void {
  if (Math.abs(deltaX) <= QUAKE_MOBILE_LOOK_EPSILON && Math.abs(deltaY) <= QUAKE_MOBILE_LOOK_EPSILON) return;
  const currentRotX = scene.camera.state.rotX ?? 88;
  const currentRotY = scene.camera.state.rotY ?? 270;
  const pitchDirection = quakeInvertMouse ? 1 : -1;
  const nextRotX = clampNumber(
    currentRotX + deltaY * QUAKE_MOBILE_LOOK_SENSITIVITY * pitchDirection,
    QUAKE_CAMERA_ROT_X_MIN,
    QUAKE_CAMERA_ROT_X_MAX,
  );
  const nextRotY = normalizeQuakeUrlAngle(currentRotY - deltaX * QUAKE_MOBILE_LOOK_SENSITIVITY);
  applyQuakeSceneCameraAt(currentQuakeCameraRenderOrigin(), nextRotX, nextRotY);
  viewmodel.syncTransform();
  queueQuakeCrosshairTargetSync();
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
  if (canUseQuakeGameplayInput()) hidePersistedQuakeLoadingConsole();
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
  if (event.button !== 0) return;
  audio.unlock();
  if (quakePlayerDead) {
    clearQuakeAttackInput();
    respawnQuakePlayerFromDeath();
    return;
  }
  if (!canUseQuakeGameplayInput()) return;
  hidePersistedQuakeLoadingConsole();
  if (document.activeElement !== host) host.focus({ preventScroll: true });
  try {
    quakeMobileFireButton?.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture can fail if the pointer ended during the same frame.
  }
  if (quakeAttackInputDown) {
    scheduleQuakeAttackFrame();
    return;
  }
  startQuakeAttackInput(event.pointerId, performance.now());
}

function handleQuakeMobileFirePointerEnd(event: PointerEvent): void {
  if (quakeAttackPointerId !== null && event.pointerId !== quakeAttackPointerId) return;
  event.preventDefault();
  event.stopPropagation();
  clearQuakeAttackInput();
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

function handleQuakeDynamicLightingOptionChange(event: Event): void {
  setQuakeDynamicLighting((event.currentTarget as HTMLInputElement).checked);
}

function handleQuakeAlwaysRunOptionChange(event: Event): void {
  setQuakeAlwaysRun((event.currentTarget as HTMLInputElement).checked);
}

function handleQuakeShowGunOptionChange(event: Event): void {
  setQuakeShowGun((event.currentTarget as HTMLInputElement).checked);
}

function handleQuakeDebugEnabledOptionChange(event: Event): void {
  setQuakeDebugMode((event.currentTarget as HTMLInputElement).checked);
}

function handleQuakeDebugShowFpsOptionChange(event: Event): void {
  setQuakeDebugShowFps((event.currentTarget as HTMLInputElement).checked);
}

function handleQuakeDebugShowTexturesOptionChange(event: Event): void {
  setQuakeDebugShowTextures((event.currentTarget as HTMLInputElement).checked);
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

function compactQuakeInlineStyle(element: HTMLElement): void {
  const style = element.getAttribute("style");
  if (!style) return;
  const order = new Map([
    ["transform", 0],
    ["width", 1],
    ["height", 2],
    ["background", 3],
  ]);
  const declarations = style
    .split(";")
    .map((part, index) => {
      const separator = part.indexOf(":");
      if (separator <= 0) return null;
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      return value ? { index, name, value } : null;
    })
    .filter((part): part is { index: number; name: string; value: string } => part !== null);
  const nextStyle = declarations
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
  if (nextStyle && nextStyle !== style) element.setAttribute("style", nextStyle);
}

function compactQuakeCameraInlineStyle(): void {
  document.body.classList.toggle("quake-camera-look-enabled", quakeCameraLookEnabled);
  host.style.removeProperty("cursor");
  if (quakeFirstPersonControlsMounted) {
    host.style.setProperty("--polycss-fpv-perspective", quakeCameraPerspectiveStyle);
    host.style.removeProperty("perspective");
  }
  const perspective = host.style.getPropertyValue("perspective").trim();
  const perspectiveOrigin = host.style.getPropertyValue("perspective-origin").trim();
  const fpvPerspective = host.style.getPropertyValue("--polycss-fpv-perspective").trim();
  const declarations = [
    ...(perspective ? [`perspective:${perspective}`] : []),
    ...(perspectiveOrigin ? [`perspective-origin:${perspectiveOrigin}`] : []),
    ...(fpvPerspective ? [`--polycss-fpv-perspective:${fpvPerspective}`] : []),
  ];
  if (declarations.length) {
    host.setAttribute("style", declarations.join(";"));
  } else {
    host.removeAttribute("style");
  }
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
  viewmodel.syncTransform();
  world.syncVisibility(true);
  syncQuakeCrosshairTarget();
}

function applyQuakeUrlView(view: QuakeCssView): void {
  clearQuakeWeaponViewPunch(false);
  getPlayer().setDebugOrigin(view.origin);
  syncSceneCameraAt(view.origin, view.rotX, view.rotY);
  shootables.syncVisibility(view.origin, true);
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
  if (!quakeDebugShowFps || quakeAppDisposed || quakeAppLoading || quakeMobileControlsMedia.matches) {
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
  (quakeUi ?? quakeApp).appendChild(statsContainer);

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
  const worldStatus = mapName ? `World ${mapName.toLowerCase()}.bsp` : "World BSP";
  const worldProgress = quakeLoadingProgressGroup(progress, worldStatus);
  const completeSceneTask = progress?.startTask(worldStatus);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}.`);
  const prepared = await response.json() as QuakePreparedScene;
  if (mapName && !prepared.renderBundle) {
    throw new Error(`Prepared Quake map ${mapName.toUpperCase()} is missing its render bundle.`);
  }
  const renderBundlePreloads = [
    ...(prepared.renderBundle ? [preloadQuakeRenderBundleAssets(prepared.renderBundle, worldProgress)] : []),
    ...(prepared.lightstyleRenderBundle ? [preloadQuakeRenderBundleAssets(prepared.lightstyleRenderBundle, worldProgress)] : []),
  ];
  completeSceneTask?.();
  await Promise.all(renderBundlePreloads);
  return createQuakeSceneFromPreparedScene(prepared);
}

async function loadQuakeMap(mapName: string, options: QuakeMapLoadOptions = {}): Promise<void> {
  const nextMapName = mapName.trim().toLowerCase();
  const url = quakeSceneUrl(nextMapName);
  if (!url) throw new Error(`No prepared Quake map registered for ${nextMapName}.`);
  const loadingStatus = options.loadingStatus ?? `World ${nextMapName}.bsp`;
  const progress = createQuakeLoadingProgressTracker(loadingStatus);
  setQuakeLoading(true, loadingStatus);
  try {
    const scenePromise = fetchQuakeScene(url, nextMapName, progress);
    const weaponPromise = preloadWeaponViewModel(progress);
    const result = await scenePromise;
    if (quakeAppDisposed) return;
    await preloadQuakeSceneModelRenderBundleAssets(result, progress);
    await preloadQuakeMapModelRenderBundleAssets(nextMapName, progress);
    if (quakeAppDisposed) return;
    currentMapName = nextMapName;
    menu.setCurrentLevel(nextMapName);
    mountQuakeScene(result);
    const routeView = quakeMapLoadView(options);
    if (routeView) applyQuakeUrlView(routeView);
    updateQuakeUrl(nextMapName, options.urlMode ?? "push", routeView);
    if (quakeAppDisposed) return;
    await completeQuakeSceneReadiness(weaponPromise, progress);
    if (quakeAppDisposed) return;
    if (options.resumeGameplay) resumeQuakeGameplayAfterMapLoad();
    setQuakeGameplayStarted(true);
  } catch (error) {
    if (!quakeAppDisposed) setQuakeLoading(false);
    throw error;
  }
}

function preloadWeaponViewModel(
  progress?: QuakeLoadingProgressTracker,
  modelPath = QUAKE_DEFAULT_WEAPON_VIEWMODEL_PATH,
): Promise<QuakeViewmodelModel> {
  const normalizedPath = normalizeQuakeViewModelPath(modelPath) ?? QUAKE_DEFAULT_WEAPON_VIEWMODEL_PATH;
  let promise = weaponViewModelPromises.get(normalizedPath);
  if (!promise) {
    promise = fetchWeaponViewModel(normalizedPath, progress).catch((error: unknown) => {
      weaponViewModelPromises.delete(normalizedPath);
      throw error;
    });
    weaponViewModelPromises.set(normalizedPath, promise);
  }
  return promise;
}

async function fetchWeaponViewModel(
  modelPath = QUAKE_DEFAULT_WEAPON_VIEWMODEL_PATH,
  progress?: QuakeLoadingProgressTracker,
): Promise<QuakeViewmodelModel> {
  const completeWeaponTask = progress?.startTask("Weapon model");
  const url = quakeViewModelUrl(modelPath);
  if (!url) throw new Error(`No prepared Quake weapon viewmodel registered for ${modelPath}.`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}.`);
  const model = await response.json() as QuakeViewmodelModel;
  const modelSource = normalizeQuakeViewModelPath(model.source);
  if (modelSource && modelSource !== modelPath) {
    throw new Error(`Prepared Quake weapon viewmodel ${url} is ${model.source}, expected ${modelPath}.`);
  }
  completeWeaponTask?.();
  return model;
}

async function mountWeaponViewModel(modelPromise = preloadWeaponViewModel()): Promise<void> {
  const model = await modelPromise;
  if (quakeAppDisposed) return;
  mountQuakeWeaponViewModel(model);
  syncActiveWeaponViewModel();
}

function mountQuakeWeaponViewModel(model: QuakeViewmodelModel): void {
  mountedWeaponViewModelPath = normalizeQuakeViewModelPath(model.source);
  viewmodel.mount(model);
}

function syncActiveWeaponViewModel(): void {
  if (!player || !viewmodel.hasWeapon()) return;
  const modelPath = quakeActiveWeaponViewModelPath(player.inventory().activeWeapon);
  if (!modelPath || modelPath === mountedWeaponViewModelPath || modelPath === pendingWeaponViewModelPath) return;
  if (!quakeViewModelUrl(modelPath)) return;
  pendingWeaponViewModelPath = modelPath;
  markQuakeTrace("viewmodel-switch-request", {
    from: mountedWeaponViewModelPath,
    to: modelPath,
    weapon: player.inventory().activeWeapon,
  });
  void preloadWeaponViewModel(undefined, modelPath)
    .then((model) => {
      if (quakeAppDisposed || pendingWeaponViewModelPath !== modelPath) return;
      pendingWeaponViewModelPath = null;
      if (quakeActiveWeaponViewModelPath(getPlayer().inventory().activeWeapon) !== modelPath) {
        syncActiveWeaponViewModel();
        return;
      }
      mountQuakeWeaponViewModel(model);
      markQuakeTrace("viewmodel-switch-complete", {
        source: mountedWeaponViewModelPath,
        weapon: getPlayer().inventory().activeWeapon,
      });
    })
    .catch((error: unknown) => {
      if (pendingWeaponViewModelPath === modelPath) pendingWeaponViewModelPath = null;
      console.warn(error);
    });
}

function quakeActiveWeaponViewModelPath(weapon: QuakeWeaponId): string | null {
  return normalizeQuakeViewModelPath(
    QUAKE_PLAYER_WEAPON_FIRE_FACTS.profiles[weapon]?.presentation?.viewModelPath ??
      QUAKE_DEFAULT_WEAPON_VIEWMODEL_PATH,
  );
}

function quakeViewModelUrl(modelPath: string): string | null {
  const normalizedPath = normalizeQuakeViewModelPath(modelPath);
  if (!normalizedPath) return null;
  return quakeAssetManifest.assets.weaponModelUrls?.[normalizedPath] ??
    (normalizedPath === QUAKE_DEFAULT_WEAPON_VIEWMODEL_PATH ? quakeAssetManifest.assets.weaponModelUrl : null);
}

function normalizeQuakeViewModelPath(modelPath: string | undefined): string | null {
  const normalizedPath = modelPath?.trim().toLowerCase() ?? "";
  return normalizedPath ? normalizedPath : null;
}

async function completeQuakeSceneReadiness(
  modelPromise = preloadWeaponViewModel(),
  progress?: QuakeLoadingProgressTracker,
): Promise<void> {
  await mountWeaponViewModel(modelPromise);
  if (quakeAppDisposed) return;
  const completeReadinessTask = progress?.startTask("Rendered first frame");
  const readiness = await waitForQuakeLoadingReadiness();
  completeReadinessTask?.();
  const completeFunReminderTask = progress?.startTask("Don't forget to have fun!");
  completeFunReminderTask?.();
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
    getWeaponTuning: () => viewmodel.getTuning(),
    resetWeaponTuning: () => viewmodel.resetTuning(),
    setWeaponTuning: (tuning) => viewmodel.setTuning(tuning),
    viewmodelDebug: () => viewmodel.debugSnapshot(),
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
    syncViewmodel: (options) => viewmodel.syncTransform(options),
    syncWorldVisibility: (force) => world.syncVisibility(force),
    viewUrl: currentQuakeViewUrl,
    worldStats: () => world.debugStats(),
  });
}

async function loadPickupModels(progress?: QuakeLoadingProgressTracker): Promise<void> {
  const completePickupTask = progress?.startTask("Pickup definitions");
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
  await preloadQuakePickupModelRenderBundleAssets(
    library,
    modelPaths,
    quakeLoadingProgressGroup(progress, "Map model assets"),
  );
}

async function preloadQuakeSceneModelRenderBundleAssets(
  result: QuakeScene,
  progress?: QuakeLoadingProgressTracker,
): Promise<void> {
  const library = currentPickupModelLibrary;
  if (!library) return;
  const pickupModelPaths = new Set<string>();
  const monsterModelPaths = new Set<string>();
  const runtime = result.entityManifest.runtime;
  const entitiesByIndex = new Map(result.entities.map((entity) => [entity.index, entity]));
  const pickupEntities = quakeSceneEntitiesForIndexes(entitiesByIndex, runtime.pickupEntityIndexes);
  for (const entity of pickupEntities) {
    if (!shouldSpawnQuakeEntityForCurrentGame(entity)) continue;
    const modelPath = quakePickupModelPath(entity, currentProgramMetadata, result.gameLogic);
    if (modelPath) pickupModelPaths.add(modelPath);
  }
  const shootableEntities = quakeSceneEntitiesForIndexes(entitiesByIndex, runtime.shootableEntityIndexes);
  for (const entity of shootableEntities) {
    if (!shouldSpawnQuakeEntityForCurrentGame(entity)) continue;
    const modelPath = quakeShootableModelPath(entity, currentProgramMetadata);
    if (modelPath) monsterModelPaths.add(modelPath);
  }
  await Promise.all([
    preloadQuakePickupModelRenderBundleAssets(
      library,
      pickupModelPaths,
      quakeLoadingProgressGroup(progress, "Pickup models"),
    ),
    preloadQuakePickupModelRenderBundleAssets(
      library,
      monsterModelPaths,
      quakeLoadingProgressGroup(progress, "Monster models"),
    ),
  ]);
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
  const completeMetadataTask = progress?.startTask("Game logic");
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
  const weaponModelUrl = typeof value.weaponModelUrl === "string" ? value.weaponModelUrl : fallback.weaponModelUrl;
  const weaponModelUrls: Record<string, string> = {
    ...(fallback.weaponModelUrls ?? {}),
    "progs/v_shot.mdl": weaponModelUrl,
  };
  if (isRecord(value.weaponModelUrls)) {
    for (const [modelPath, modelUrl] of Object.entries(value.weaponModelUrls)) {
      const normalizedModelPath = modelPath.trim().toLowerCase();
      if (!normalizedModelPath || typeof modelUrl !== "string") continue;
      const normalizedModelUrl = modelUrl.trim();
      if (normalizedModelUrl) weaponModelUrls[normalizedModelPath] = normalizedModelUrl;
    }
  }
  return {
    weaponModelUrl,
    weaponModelUrls,
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
  const completeManifestTask = progress.startTask("Manifest");
  let hasPakAssets = false;
  try {
    const manifest = await fetchQuakeAssetManifest();
    setQuakeAssetManifest(manifest);
    hasPakAssets = manifest.maps.some((map) => map.pakPath);
  } finally {
    completeManifestTask();
  }
  const startupRoute = quakeUrlRouteFromLocation();
  const startMap = startupRoute.mapName;
  const startupSceneUrl = quakeSceneUrl(startMap);
  if (!startupSceneUrl) throw new Error(`No prepared Quake start map registered for ${startMap}.`);
  const programMetadataPromise = loadProgramMetadata(progress);
  const pickupModelsPromise = loadPickupModels(progress);
  if (hasPakAssets) queueQuakeLoadingConsoleLine(QUAKE_LOADING_CONSOLE_PAK_LINE);
  const startupScenePromise = fetchQuakeScene(startupSceneUrl, startMap, progress);
  const weaponPromise = preloadWeaponViewModel(progress);
  await Promise.all([programMetadataPromise, pickupModelsPromise]);
  if (quakeAppDisposed) return;
  const result = await startupScenePromise;
  if (quakeAppDisposed) return;
  await preloadQuakeSceneModelRenderBundleAssets(result, progress);
  await preloadQuakeMapModelRenderBundleAssets(startMap, progress);
  if (quakeAppDisposed) return;
  currentMapName = startMap;
  menu.setCurrentLevel(currentMapName);
  mountQuakeScene(result);
  const startupView = quakeUrlRouteView(startupRoute);
  if (startupView) applyQuakeUrlView(startupView);
  if (quakeUrlRouteIsDirect(startupRoute) && quakeUrlRouteShouldNormalize(startupRoute)) {
    updateQuakeUrl(startMap, "replace", startupView);
  }
  if (quakeAppDisposed) return;
  await completeQuakeSceneReadiness(weaponPromise, progress);
  if (quakeAppDisposed) return;
  syncQuakeRoutePresentation(startupRoute);
}

function clearQuakeMainMenuStartupState(): void {
  document.body.classList.remove("quake-main-menu-pending", "quake-main-menu-deferred");
}

function syncQuakeRoutePresentation(route: QuakeUrlRoute, options: { preferMenu?: boolean } = {}): void {
  clearQuakeMainMenuStartupState();
  if (QUAKE_MENU_ENABLED && (options.preferMenu || !quakeUrlRouteIsDirect(route))) {
    menu.showMainMenu();
  } else {
    setQuakeGameplayStarted(true);
    menu.hideMainMenu();
  }
}

function handleQuakePopState(): void {
  if (quakeAppDisposed || quakeAppLoading) return;
  const route = quakeUrlRouteFromLocation();
  if (currentMapName === route.mapName && currentResult) {
    const routeView = quakeUrlRouteView(route);
    if (routeView) {
      applyQuakeUrlView(routeView);
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
          setQuakeLoadingError(error);
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
  if (quakeAppLoading) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.code === "KeyX" && !isEditableKeyboardTarget(event.target)) {
    event.preventDefault();
    event.stopPropagation();
    toggleQuakeDebugMode();
    return;
  }
  if (menu.handleKeyDown(event)) {
    clearQuakeMoveInput();
    clearQuakeCrouchInput();
    clearQuakeAttackInput();
    return;
  }
  if (
    event.code === "Escape" &&
    !isEditableKeyboardTarget(event.target) &&
    document.pointerLockElement === null &&
    !menu.isMainMenuOpen() &&
    !menu.isMenuPanelOpen()
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (shouldOpenQuakeMainMenuOnControlsEnd()) {
      clearQuakeMoveInput();
      clearQuakeCrouchInput();
      clearQuakeAttackInput();
      menu.showMainMenu();
    }
    return;
  }
  if (handleQuakeDebugFlyKey(event, true)) {
    hidePersistedQuakeLoadingConsole();
    return;
  }
  if (shouldPreventQuakeGameplayKeyDefault(event)) {
    event.preventDefault();
  }
  const handledMoveKey = handleQuakeMoveKey(event, true);
  const handledCrouchKey = handleQuakeCrouchKey(event, true);
  if (handledMoveKey || handledCrouchKey) {
    handleQuakeParentKeyRelay(event, true);
    hidePersistedQuakeLoadingConsole();
  }
  if (event.code === "KeyF") {
    event.preventDefault();
    host.focus();
  }
}

function handleWindowKeyUp(event: KeyboardEvent): void {
  handleQuakeParentKeyRelay(event, false);
  if (handleQuakeDebugFlyKey(event, false)) {
    return;
  }
  if (shouldPreventQuakeGameplayKeyDefault(event)) {
    event.preventDefault();
  }
  handleQuakeMoveKey(event, false);
  handleQuakeCrouchKey(event, false);
  if (
    (QUAKE_MOVE_KEY_CODES.has(event.code) || QUAKE_SPEED_KEY_CODES.has(event.code)) &&
    !isEditableKeyboardTarget(event.target)
  ) {
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
  dynamicLightingOption?.removeEventListener("change", handleQuakeDynamicLightingOptionChange);
  alwaysRunOption?.removeEventListener("change", handleQuakeAlwaysRunOptionChange);
  showGunOption?.removeEventListener("change", handleQuakeShowGunOptionChange);
  debugEnabledOption?.removeEventListener("change", handleQuakeDebugEnabledOptionChange);
  debugShowFpsOption?.removeEventListener("change", handleQuakeDebugShowFpsOptionChange);
  debugShowTexturesOption?.removeEventListener("change", handleQuakeDebugShowTexturesOptionChange);
  debugFlyModeOption?.removeEventListener("change", handleQuakeDebugFlyModeOptionChange);
  debugShowOutlinesOption?.removeEventListener("change", handleQuakeDebugShowOutlinesOptionChange);
  debugShowLabelsOption?.removeEventListener("change", handleQuakeDebugShowLabelsOptionChange);
  invertMouseOption?.removeEventListener("change", handleQuakeInvertMouseOptionChange);
  stopQuakeDebugPanelStats();
  document.removeEventListener("pointerlockchange", syncQuakeInteractionPresentation);
  document.removeEventListener("pointerlockerror", handleQuakePointerLockError);
  controls.removeEventListener("change", syncPlayerCollision);
  controls.removeEventListener("start", handleQuakeControlsStart);
  controls.removeEventListener("end", handleQuakeControlsEndTrace);
  controls.removeEventListener("end", clearQuakeCrouchInput);
  controls.removeEventListener("end", clearQuakeAttackInput);
  controls.destroy();
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
document.addEventListener("pointerlockchange", syncQuakeInteractionPresentation);
document.addEventListener("pointerlockerror", handleQuakePointerLockError);

host.addEventListener("pointerdown", handleQuakeUsePointerDown, { capture: true });
disableSoundOption?.addEventListener("change", handleQuakeDisableSoundOptionChange);
disableEnemiesOption?.addEventListener("change", handleQuakeDisableEnemiesOptionChange);
disableDamageOption?.addEventListener("change", handleQuakeDisableDamageOptionChange);
dynamicLightingOption?.addEventListener("change", handleQuakeDynamicLightingOptionChange);
alwaysRunOption?.addEventListener("change", handleQuakeAlwaysRunOptionChange);
showGunOption?.addEventListener("change", handleQuakeShowGunOptionChange);
debugEnabledOption?.addEventListener("change", handleQuakeDebugEnabledOptionChange);
debugShowFpsOption?.addEventListener("change", handleQuakeDebugShowFpsOptionChange);
debugShowTexturesOption?.addEventListener("change", handleQuakeDebugShowTexturesOptionChange);
debugFlyModeOption?.addEventListener("change", handleQuakeDebugFlyModeOptionChange);
debugShowOutlinesOption?.addEventListener("change", handleQuakeDebugShowOutlinesOptionChange);
debugShowLabelsOption?.addEventListener("change", handleQuakeDebugShowLabelsOptionChange);
invertMouseOption?.addEventListener("change", handleQuakeInvertMouseOptionChange);
controls.addEventListener("change", syncPlayerCollision);
controls.addEventListener("start", handleQuakeControlsStart);
controls.addEventListener("end", handleQuakeControlsEndTrace);
controls.addEventListener("end", clearQuakeCrouchInput);
controls.addEventListener("end", clearQuakeAttackInput);

syncQuakeHud();
syncQuakeOptionControls();
if (debugMenuPanel) mountQuakeBitmapText(debugMenuPanel);
if (debugPanel) mountQuakeBitmapText(debugPanel);
syncQuakeMobileControlsAvailability();
installQuakeAppDebugHooks();

(window as typeof window & { __cssQuakeShowLoadingError?: (error: unknown) => void })
  .__cssQuakeShowLoadingError = (error: unknown) => {
    if (!quakeAppDisposed && quakeAppLoading) setQuakeLoadingError(error);
  };

void loadQuake().catch((error) => {
  console.error(error);
  if (!quakeAppDisposed) {
    if (error instanceof QuakeAssetsRegeneratingError) {
      setQuakeAssetsRegenerating(error.message);
    } else {
      setQuakeLoadingError(error);
    }
  }
});

const hot = import.meta as ImportMeta & { hot?: { dispose(callback: () => void): void } };
hot.hot?.dispose(disposeQuakeApp);
