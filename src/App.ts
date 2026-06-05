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
import {
  QUAKE_RENDER_SUPERSAMPLE,
  createQuakeSceneFromPreparedScene,
  type QuakeEntity,
  type QuakePreparedScene,
  type QuakePreparedRenderBundle,
  type QuakeScene,
} from "./prepare/scene";
import { createQuakeSoundController, type QuakeSoundManifest } from "./runtime/audio";
import { mountQuakeBitmapText } from "./runtime/bitmapText";
import {
  COLLISION_EPSILON,
  GROUND_SNAP,
  QUAKE_BUTTON_USE_RANGE,
  QUAKE_COLLISION_UNIT_SCALE,
  STEP_HEIGHT,
} from "./runtime/constants";
import {
  buildQuakeClipCollisionWorld,
  buildQuakeCollisionWorld,
  type QuakeCollisionWorld,
  type QuakeTouchedTrigger,
} from "./runtime/collision";
import { installQuakeDebugHooks } from "./runtime/debug/quakeDebug";
import { quakeDoorGroupKeyRequirement, quakePlayerHasDoorKey } from "./runtime/doors";
import {
  quakeEntityNumber,
  shouldSpawnQuakeEntityForCurrentGame,
} from "./runtime/entities";
import {
  applyQuakeInventoryDelta,
  syncQuakeHud as syncQuakeHudElements,
  type QuakeHudElements,
} from "./runtime/hud";
import { quakeContentsDamage, quakeTriggerHurtDamage, type QuakeHazardDamage } from "./runtime/hazards";
import { distanceSq3, dotVec3, normalizeVec3, subtractVec3 } from "./runtime/math";
import { createQuakeMenuController } from "./runtime/menu";
import {
  createQuakeMoversController,
  quakeButtonIsPressed,
  type QuakeMoverState,
} from "./runtime/movers";
import { createQuakeShootablesController, quakeShootableFallbackPolygons } from "./runtime/shootables";
import { createQuakeTargetsController } from "./runtime/targets";
import { createQuakeTriggersController } from "./runtime/triggers";
import { createQuakeViewmodelController, type QuakeViewmodelModel } from "./runtime/viewmodel";
import { createQuakeWeaponsController } from "./runtime/weapons";
import {
  createQuakeWorldController,
  injectQuakeWorldAnimations,
  quakeCssUrl,
  syncQuakeTextureAnimationLeafAnimationClock,
  type QuakeFaceLeaf,
} from "./runtime/world";
import {
  createQuakePickupController,
  quakePickupModelRenderBundleFrameSet,
  quakePickupModelRenderBundle,
  quakePickupPolygons,
  type QuakePickupModel,
  type QuakePickupModelLibrary,
  type QuakeProgramMetadata,
} from "./runtime/pickups";
import { createQuakePlayerController } from "./runtime/player";
import {
  mountQuakeRenderBundleFrameSetMesh,
  mountQuakeRenderBundleMesh,
  preloadQuakeRenderBundleAssets,
  stripPolyMeshMetadata,
} from "./runtime/renderBundleMesh";

const host = document.getElementById("quake-host") as HTMLElement;
const viewmodelLayer = document.getElementById("quake-viewmodel-layer") as HTMLElement | null;
const mainMenu = document.getElementById("quake-main-menu") as HTMLButtonElement | null;
const mainMenuArt = document.getElementById("quake-main-menu-art") as HTMLElement | null;
const audioToggle = document.getElementById("quake-audio-toggle") as HTMLButtonElement | null;
const levelPanel = document.getElementById("quake-level-panel") as HTMLElement | null;
const levelList = document.getElementById("quake-level-list") as HTMLElement | null;
const aboutPanel = document.getElementById("quake-about-panel") as HTMLElement | null;
const optionsPanel = document.getElementById("quake-options-panel") as HTMLElement | null;
const loadingOverlay = document.getElementById("quake-loading-overlay") as HTMLElement | null;
const loadingStatus = document.getElementById("quake-loading-status") as HTMLElement | null;
const hudArmorValue = document.getElementById("quake-hud-armor-value") as HTMLElement | null;
const hudHealthValue = document.getElementById("quake-hud-health-value") as HTMLElement | null;
const hudAmmoValue = document.getElementById("quake-hud-ammo-value") as HTMLElement | null;
const hudKeysValue = document.getElementById("quake-hud-keys-value") as HTMLElement | null;
const classicHud = document.getElementById("quake-classic-hud") as HTMLElement | null;
const quakeHud = document.getElementById("quake-hud") as HTMLElement | null;
const hudElements: QuakeHudElements = {
  root: classicHud,
  armor: hudArmorValue,
  health: hudHealthValue,
  ammo: hudAmmoValue,
  keys: hudKeysValue,
};
const QUAKE_ASSET_ROOT = "/q";
const QUAKE_MANIFEST_URL = `${QUAKE_ASSET_ROOT}/manifest.json`;

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
const QUAKE_JUMP_VELOCITY = (270 / 48) * QUAKE_RENDER_SUPERSAMPLE;
const QUAKE_GRAVITY = (800 / 48) * QUAKE_RENDER_SUPERSAMPLE;
const QUAKE_CAMERA_ZOOM = (BASE_TILE * 0.65) / QUAKE_RENDER_SUPERSAMPLE;
const QUAKE_MENU_ENABLED = true;
const QUAKE_MONSTER_RUNTIME_ENABLED = true;
const QUAKE_MONSTER_MOUNT_VIEW_DOT_MIN = -0.1;
let quakeAssetManifest = FALLBACK_QUAKE_ASSET_MANIFEST;
let quakeMapUrls = quakeSceneUrlMap(quakeAssetManifest);

function mountQuakeLevelSelector(renderBitmapText = false): void {
  if (!levelList) return;
  levelList.replaceChildren();
  for (const level of quakeSelectableLevels()) {
    const button = document.createElement("button");
    button.className = "quake-level-button";
    button.type = "button";
    button.dataset.map = level.mapName;
    button.setAttribute("aria-label", `${level.mapName.toUpperCase()} ${quakeMapTitle(level)}`);

    const code = document.createElement("span");
    code.className = "quake-level-code";
    code.dataset.bm = "label alt";
    code.textContent = level.mapName.toUpperCase();

    const title = document.createElement("span");
    title.className = "quake-level-name";
    title.dataset.bm = "label";
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

function setQuakeAssetManifest(manifest: QuakeAssetManifest): void {
  quakeAssetManifest = manifest;
  quakeMapUrls = quakeSceneUrlMap(manifest);
  mountQuakeLevelSelector(true);
  menu.setCurrentLevel(currentMapName);
}

injectQuakeWorldAnimations();
mountQuakeLevelSelector();

const camera = createPolyPerspectiveCamera({
  perspective: 900,
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
const controls = createPolyFirstPersonControls(scene, {
  eyeHeight: 1.72,
  groundZ: 0,
  moveSpeed: 5.4 * QUAKE_RENDER_SUPERSAMPLE,
  lookSensitivity: 0.12,
  jumpEnabled: true,
  crouchEnabled: false,
  jumpVelocity: QUAKE_JUMP_VELOCITY,
  gravity: QUAKE_GRAVITY,
});

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
  makeParseResult,
  scene,
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
  onSelectLevel: loadQuakeMap,
  clearCrosshairTarget: clearQuakeCrosshairTarget,
  syncCrosshairTarget: syncQuakeCrosshairTarget,
});
menu.setCurrentLevel(quakeAssetManifest.startMap);
const audio = createQuakeSoundController();
syncQuakeAudioToggle();
const viewmodel = createQuakeViewmodelController({
  scene,
  controls,
  host,
  hud: classicHud,
  layer: viewmodelLayer,
});
const shootables = createQuakeShootablesController({
  addMesh: addQuakeShootableMesh,
  damagePlayer: (amount) => getPlayer().damage(amount),
  getPlayerOrigin: () => getPlayer().currentOrigin(),
  hasLineOfSight: quakeLineOfSight,
  isInPlayerView: isQuakePointInPlayerView,
  leafIndexAt: world.leafIndexAt,
  monsterRuntimeEnabled: () => QUAKE_MONSTER_RUNTIME_ENABLED,
  pointToPoly: quakePointToPoly,
  shouldSpawn: shouldSpawnQuakeEntityForCurrentGame,
  pixelate: world.pixelate,
  schedulePresentationResync: world.schedulePresentationResync,
  visibleLeavesAt: world.visibleLeavesAt,
  fireTarget: fireQuakeTarget,
});
const targetSystem = createQuakeTargetsController({
  activateEntity: activateQuakeEntity,
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
  onActiveKeyChange: syncQuakeActiveTriggerDataset,
  triggerSpecial: activateQuakeSpecialTrigger,
  transitionSerial: () => quakeTransitionSerial,
  useTargets: targetSystem.useTargets,
});
pickups = createQuakePickupController({
  addMesh: addQuakePickupMesh,
  applyEffect: (effect, entity) => {
    applyQuakeInventoryDelta(getPlayer().inventory(), effect);
    syncQuakeHud();
    audio.playPickup(entity);
  },
  leafIndexAt: world.leafIndexAt,
  pointToPoly: quakePointToPoly,
  programMetadata: () => currentProgramMetadata,
  shouldSpawn: shouldSpawnQuakeEntityForCurrentGame,
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
  playFireAnimation: viewmodel.playFireAnimation,
  damageShootable: shootables.damage,
  damageBrushEntity: damageQuakeBrushEntity,
  onHit: flashQuakeCrosshairHit,
  syncCrosshairTarget: syncQuakeCrosshairTarget,
});
player = createQuakePlayerController({
  activateSolidTouch,
  controls,
  getCollisionWorld: () => currentCollisionWorld,
  getCurrentScene: () => currentResult,
  gravity: QUAKE_GRAVITY,
  jumpVelocity: QUAKE_JUMP_VELOCITY,
  onDamageFlash: (active) => {
    if (!active) {
      delete document.body.dataset.damage;
      return;
    }
    void host.offsetWidth;
    document.body.dataset.damage = "true";
    audio.playEvent("pain", { volume: 0.58 });
  },
  onHazardState: () => undefined,
  onInventoryChanged: syncQuakeHud,
  onRespawn: (result, previousOrigin) => {
    triggerSystem.resetActive();
    shootables.spawn(result.entities, currentPickupModelLibrary, currentProgramMetadata);
    getPickups().spawn(result.entities, currentPickupModelLibrary, previousOrigin);
  },
  pointToPoly: quakePointToPoly,
  resolveShootablesCollision: shootables.resolvePlayerCollision,
  syncCrosshairTarget: syncQuakeCrosshairTarget,
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
let entityByIndex = new Map<number, QuakeEntity>();
let quakeDamageableBrushHealth = new Map<number, number>();
let quakeDamageableBrushResetTimers: number[] = [];
let quakeMoverCrushDamageAt = new Map<number, number>();
let quakeMoverSoundModes = new Map<number, QuakeMoverState["mode"]>();
let quakePointHazards: QuakePointHazard[] = [];
let quakeFireballEmitters: QuakeFireballEmitter[] = [];
let quakePointHazardFrame: number | null = null;
let quakePointHazardTime = 0;
let quakeHudMessageTimer: number | null = null;
let quakeCrosshairHitTimer: number | null = null;
let quakeSkill = 1;
let quakeModelPivot = { x: 0, y: 0, z: 0 };
let quakeLevelLoadTimer: number | null = null;
let quakeTransitionSerial = 0;
let currentMapName = quakeAssetManifest.startMap;
let quakeAppDisposed = false;
let quakeAppLoading = true;
let quakeDebugCollisionBypassUntil = 0;

interface QuakeStatsPanel {
  value: HTMLElement;
  bar: HTMLElement;
  max: number;
  label: string;
}

const FPS_SAMPLE_MS = 1000;
const MS_SAMPLE_MS = 500;
const QUAKE_HAZARD_FOOT_SAMPLE_Z = 2 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_CHANGELEVEL_DELAY_MS = 850;
const QUAKE_HUD_MESSAGE_MS = 2600;
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
const QUAKE_TRIGGER_PUSH_DEFAULT_SPEED = 1000;
const QUAKE_TRIGGER_PUSH_ONCE = 1;
const QUAKE_TRIGGER_PUSH_VELOCITY_MULTIPLIER = 10;

function makeParseResult(polygons: Polygon[]): ParseResult {
  return { polygons, objectUrls: [], warnings: [], dispose: () => undefined };
}

function syncQuakeHud(): void {
  syncQuakeHudElements(hudElements, getPlayer().inventory());
}

function toggleQuakeAudioMuted(): void {
  audio.toggleMuted();
  syncQuakeAudioToggle();
}

function syncQuakeAudioToggle(): void {
  if (!audioToggle) return;
  const muted = audio.isMuted();
  audioToggle.dataset.muted = String(muted);
  audioToggle.setAttribute("aria-pressed", String(muted));
  audioToggle.setAttribute("aria-label", muted ? "Unmute audio" : "Mute audio");
  audioToggle.title = muted ? "Unmute audio (M)" : "Mute audio (M)";
}

function clearQuakeLevelLoadTimer(): void {
  if (quakeLevelLoadTimer !== null) {
    window.clearTimeout(quakeLevelLoadTimer);
    quakeLevelLoadTimer = null;
  }
}

function clearQuakeLevelComplete(): void {
  delete document.body.dataset.complete;
  delete quakeHud?.dataset.complete;
  controls.update({ moveEnabled: true, jumpEnabled: true, jumpVelocity: QUAKE_JUMP_VELOCITY, gravity: QUAKE_GRAVITY });
}

function flashQuakeCrosshairHit(): void {
  if (quakeCrosshairHitTimer !== null) {
    window.clearTimeout(quakeCrosshairHitTimer);
    quakeCrosshairHitTimer = null;
  }
  document.body.dataset.hit = "true";
  quakeCrosshairHitTimer = window.setTimeout(clearQuakeCrosshairHit, 110);
}

function clearQuakeCrosshairHit(): void {
  if (quakeCrosshairHitTimer !== null) {
    window.clearTimeout(quakeCrosshairHitTimer);
    quakeCrosshairHitTimer = null;
  }
  delete document.body.dataset.hit;
}

function showQuakeHudMessage(message: string, duration = QUAKE_HUD_MESSAGE_MS): void {
  const text = message.trim();
  if (!text || !quakeHud) return;
  if (quakeHudMessageTimer !== null) {
    window.clearTimeout(quakeHudMessageTimer);
    quakeHudMessageTimer = null;
  }
  document.body.dataset.message = "true";
  quakeHud.dataset.message = text;
  quakeHudMessageTimer = window.setTimeout(clearQuakeHudMessage, duration);
}

function clearQuakeHudMessage(): void {
  if (quakeHudMessageTimer !== null) {
    window.clearTimeout(quakeHudMessageTimer);
    quakeHudMessageTimer = null;
  }
  delete document.body.dataset.message;
  delete quakeHud?.dataset.message;
}

function isQuakeLevelTransitionActive(): boolean {
  return document.body.dataset.complete !== undefined;
}

function canUseQuakeGameplayInput(): boolean {
  return !quakeAppLoading &&
    !menu.isMainMenuOpen() &&
    !menu.isMenuPanelOpen() &&
    !isQuakeLevelTransitionActive() &&
    currentCollisionWorld !== null;
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

function setQuakeLoading(active: boolean, status = "Loading"): void {
  quakeAppLoading = active;
  if (active) {
    document.body.dataset.loading = "true";
    updateQuakeLoadingStatus(status);
    if (loadingOverlay) {
      loadingOverlay.hidden = false;
      loadingOverlay.setAttribute("aria-busy", "true");
    }
    controls.update({ moveEnabled: false });
    clearQuakeCrosshairTarget();
    return;
  }

  delete document.body.dataset.loading;
  if (loadingOverlay) {
    loadingOverlay.hidden = true;
    loadingOverlay.removeAttribute("aria-busy");
  }
  if (!menu.isMainMenuOpen() && !menu.isMenuPanelOpen() && !isQuakeLevelTransitionActive()) {
    controls.update({ moveEnabled: true });
  }
  syncQuakeCrosshairTarget();
}

function setQuakeLoadingError(): void {
  quakeAppLoading = true;
  document.body.dataset.loading = "true";
  updateQuakeLoadingStatus("Load failed");
  if (loadingOverlay) {
    loadingOverlay.hidden = false;
    loadingOverlay.setAttribute("aria-busy", "false");
  }
  controls.update({ moveEnabled: false });
  clearQuakeCrosshairTarget();
}

function updateQuakeLoadingStatus(status: string): void {
  if (!loadingStatus) return;
  loadingStatus.textContent = status;
  mountQuakeBitmapText(loadingStatus.parentElement ?? document);
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
  viewmodel.remove();
  world.clear();
  movers.clear();
  getPickups().clear();
  shootables.clear();
  clearQuakeLevelComplete();
  clearQuakeHudMessage();
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
  getPlayer().spawn(spawn);
  syncSceneCamera(spawn.rotX, spawn.rotY);
  syncQuakeCrosshairTarget();
}

function syncSceneCamera(rotX: number, rotY: number): void {
  const origin = getPlayer().currentOrigin();
  syncSceneCameraAt(origin, rotX, rotY);
}

function syncSceneCameraAt(origin: Vec3, rotX: number, rotY: number): void {
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

function lookOffset(): number {
  const value = Number.parseFloat(scene.camera.perspectiveStyle);
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

function quakeLineOfSight(start: Vec3, end: Vec3): boolean {
  const trace = currentCollisionWorld?.traceUse?.(start, end);
  return !trace || trace.fraction >= 0.96;
}

function isQuakePointInPlayerView(point: Vec3): boolean {
  const origin = getPlayer().currentOrigin();
  const toPoint: Vec3 = [point[0] - origin[0], point[1] - origin[1], 0];
  const toPointLength = Math.hypot(toPoint[0], toPoint[1]);
  if (toPointLength <= COLLISION_EPSILON) return true;

  const forward = forwardDirection(scene.camera.state.rotX ?? 90, scene.camera.state.rotY ?? 270);
  const forwardHorizontal: Vec3 = [forward[0], forward[1], 0];
  const forwardLength = Math.hypot(forwardHorizontal[0], forwardHorizontal[1]);
  if (forwardLength <= COLLISION_EPSILON) return true;

  const toPointUnit: Vec3 = [toPoint[0] / toPointLength, toPoint[1] / toPointLength, 0];
  const forwardUnit: Vec3 = [forwardHorizontal[0] / forwardLength, forwardHorizontal[1] / forwardLength, 0];
  return dotVec3(toPointUnit, forwardUnit) >= QUAKE_MONSTER_MOUNT_VIEW_DOT_MIN;
}

function mountQuakeScene(result: QuakeScene): void {
  disposeCurrentScene();
  currentResult = result;
  clearQuakeSkyBackground();
  currentCollisionWorld = result.collision
    ? buildQuakeClipCollisionWorld(result.collision) ?? buildQuakeCollisionWorld(result.polygons)
    : buildQuakeCollisionWorld(result.polygons);
  world.mount(result);
  setupQuakeEntityActions(result);
  audio.syncAmbientEntities(result.entities);
  setCamera(result.spawn);
  shootables.spawn(result.entities, currentPickupModelLibrary, currentProgramMetadata);
  getPlayer().resetInventory();
  const origin = getPlayer().currentOrigin();
  shootables.syncVisibility(origin, true);
  getPickups().spawn(result.entities, currentPickupModelLibrary, origin);
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
  setupQuakeDamageableBrushes(result.entities);
  setupQuakePointHazards(result.entities);
  targetSystem.setup(result.entities);
  triggerSystem.clear();
  movers.setup(result.entities, result.models, quakeModelPivot);
}

function activateQuakeTeleport(trigger: QuakeEntity): boolean {
  const target = trigger.properties.target;
  if (!target) return false;
  const destination = quakeTeleportDestination(target);
  if (!destination) return false;
  teleportQuakePlayer(destination);
  return true;
}

function quakeTeleportDestination(targetname: string): QuakeEntity | null {
  for (const entityIndex of targetSystem.entityIndexesFor(targetname)) {
    const entity = entityByIndex.get(entityIndex);
    if (entity?.classname === "info_teleport_destination" && entity.origin) return entity;
  }
  return null;
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
  clearQuakeLevelLoadTimer();
  viewmodel.clearFireAnimation();
  getPlayer().clearLevelState();
  audio.playEvent("levelExit", { volume: 0.58 });
  document.body.dataset.complete = "true";
  const nextMap = quakeChangelevelMap(entity);
  if (quakeHud) {
    quakeHud.dataset.complete = nextMap ? `EXIT TO ${nextMap.toUpperCase()}` : "EXIT REACHED";
  }
  if (!nextMap || !quakeSceneUrl(nextMap)) return;
  quakeLevelLoadTimer = window.setTimeout(() => {
    quakeLevelLoadTimer = null;
    void loadQuakeMap(nextMap).catch((error) => {
      console.error(error);
      if (quakeHud) quakeHud.dataset.complete = `COULD NOT LOAD ${nextMap.toUpperCase()}`;
    });
  }, QUAKE_CHANGELEVEL_DELAY_MS);
}

function quakeChangelevelMap(entity: QuakeEntity): string | null {
  const map = entity.properties.map?.trim().toLowerCase();
  return map || null;
}

function activateSolidTouch(touch: QuakeTouchedTrigger): void {
  const entity = entityByIndex.get(touch.entityIndex);
  if (!entity) return;
  if (targetSystem.isDisabled(entity.index)) return;
  if (activateQuakeSolidGate(entity)) return;
  if (entity.classname === "func_plat") {
    activateQuakeEntity(entity.index);
    return;
  }
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
    targetSystem.disableEntity(entity.index);
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
  if (entity.classname === "trigger_push") {
    activateQuakePushTrigger(entity);
    return true;
  }
  if (entity.classname === "trigger_setskill") {
    quakeSkill = Math.max(0, Math.round(quakeEntityNumber(entity, "message", 1)));
    showQuakeHudMessage(`SKILL ${quakeSkill}`);
    return true;
  }
  if (entity.classname === "trigger_onlyregistered") {
    if (QUAKE_SHAREWARE_REGISTERED) {
      targetSystem.useTargets(entity);
      return true;
    }
    showQuakeHudMessage(quakeEntityMessage(entity, "REGISTERED VERSION ONLY"));
    return true;
  }
  return false;
}

function activateQuakePushTrigger(entity: QuakeEntity): void {
  const rawSpeed = quakeEntityNumber(entity, "speed", QUAKE_TRIGGER_PUSH_DEFAULT_SPEED);
  const speed = (rawSpeed > 0 ? rawSpeed : QUAKE_TRIGGER_PUSH_DEFAULT_SPEED) *
    QUAKE_TRIGGER_PUSH_VELOCITY_MULTIPLIER *
    QUAKE_COLLISION_UNIT_SCALE;
  const direction = quakeEntityDirection(entity);
  getPlayer().push([direction[0] * speed, direction[1] * speed, direction[2] * speed]);
  if (quakeEntitySpawnflagsCompat(entity) & QUAKE_TRIGGER_PUSH_ONCE) {
    targetSystem.disableEntity(entity.index);
  }
}

function activateQuakeSolidGate(entity: QuakeEntity): boolean {
  if (entity.classname === "func_episodegate") {
    showQuakeHudMessage(quakeEntityMessage(entity, "THIS EPISODE IS LOCKED"));
    return true;
  }
  if (entity.classname === "func_bossgate") {
    showQuakeHudMessage(quakeEntityMessage(entity, "YOU MUST COMPLETE THE EPISODES FIRST"));
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

function setupQuakePointHazards(entities: QuakeEntity[]): void {
  clearQuakePointHazards();
  const now = performance.now();
  for (const entity of entities) {
    if (targetSystem.isDisabled(entity.index) || entity.classname !== "misc_fireball" || !entity.origin) continue;
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

function tickQuakePointHazards(now: number): void {
  if (!currentResult || (!quakeFireballEmitters.length && !quakePointHazards.length)) {
    clearQuakePointHazards();
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

function setupQuakeDamageableBrushes(entities: QuakeEntity[]): void {
  clearQuakeDamageableBrushes();
  for (const entity of entities) {
    if (!isQuakeDamageableBrushEntity(entity)) continue;
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
    const activated = targetSystem.useTargets(entity);
    targetSystem.disableEntity(entity.index);
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
  return quakePlayerHasDoorKey(getPlayer().inventory(), requiredKey);
}

function moverBlockedByPlayer(state: QuakeMoverState, nextOffset: Vec3, delta: Vec3): boolean {
  if (state.kind === "button" || shouldCarryPlayerWithMover(state, delta)) return false;
  const origin = controls.getOrigin();
  if (!currentCollisionWorld?.playerIntersectsBrush?.(state.entity.index, nextOffset, origin)) return false;
  damageQuakePlayerForMoverBlock(state);
  return true;
}

function damageQuakePlayerForMoverBlock(state: QuakeMoverState): void {
  const now = performance.now();
  const lastDamageAt = quakeMoverCrushDamageAt.get(state.entity.index) ?? -Infinity;
  if (now - lastDamageAt < 500) return;
  const amount = quakeEntityNumber(state.entity, "dmg", state.kind === "plat" ? 1 : 2);
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
  if (state.kind === "button" || distanceSq3(delta, [0, 0, 0]) <= COLLISION_EPSILON) return false;
  const origin = controls.getOrigin();
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
  const baseTexture = leaf.element.dataset.base;
  const pressedTexture = leaf.element.dataset.pressed;
  const texture = pressed ? pressedTexture : baseTexture;
  if (texture) {
    leaf.element.dataset.active = "true";
    leaf.element.style.backgroundImage = quakeCssUrl(texture);
    leaf.element.style.backgroundPosition = "center";
    leaf.element.style.backgroundSize = "100% 100%";
    if (pressed) {
      leaf.element.style.animationName = "none";
    } else {
      delete leaf.element.dataset.active;
      leaf.element.style.removeProperty("animation-name");
      syncQuakeTextureAnimationLeafAnimationClock(leaf.element);
    }
    return;
  }
  delete leaf.element.dataset.active;
  leaf.element.style.removeProperty("animation-name");
  leaf.element.style.backgroundImage = leaf.baseBackgroundImage;
  leaf.element.style.backgroundPosition = leaf.baseBackgroundPosition;
  leaf.element.style.backgroundSize = leaf.baseBackgroundSize;
  leaf.element.style.removeProperty("background-repeat");
}

function handleQuakeUsePointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !event.isPrimary || !canUseQuakeGameplayInput()) return;
  event.preventDefault();
  audio.unlock();
  host.focus({ preventScroll: true });
  controls.lock();
  if (activateQuakeButtonAtCrosshair()) {
    syncQuakeCrosshairTarget();
    return;
  }
  weapons.fire();
}

function activateQuakeButtonAtCrosshair(): boolean {
  const trace = weapons.viewTraceAtCrosshair(QUAKE_BUTTON_USE_RANGE);
  if (!weapons.traceIsActionable(trace) || trace.entityIndex === undefined) return false;
  activateQuakeEntity(trace.entityIndex);
  return true;
}

function syncQuakeCrosshairTarget(): void {
  if (!canUseQuakeGameplayInput()) {
    clearQuakeCrosshairTarget();
    return;
  }
  const trace = weapons.viewTraceAtCrosshair(QUAKE_BUTTON_USE_RANGE);
  if (weapons.traceIsActionable(trace)) {
    document.body.dataset.action = trace.classname ?? "action";
    return;
  }
  const weaponTrace = weapons.weaponTraceAtCrosshair();
  if (weapons.traceIsShootable(weaponTrace)) {
    document.body.dataset.action = weaponTrace.classname ?? "action";
    return;
  }
  clearQuakeCrosshairTarget();
}

function clearQuakeCrosshairTarget(): void {
  delete document.body.dataset.action;
}

function handleQuakeAudioToggleClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  audio.unlock();
  toggleQuakeAudioMuted();
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
    hazard = strongerQuakeHazard(hazard, quakeTriggerHurtDamage(entity));
  }
  hazard = strongerQuakeHazard(hazard, quakePointHazardAt(origin));
  const contents = currentCollisionWorld?.contentsAt?.(quakePlayerContentsPoint(origin));
  return strongerQuakeHazard(hazard, quakeContentsDamage(contents));
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


function mountStatsOverlay(): () => void {
  document.querySelector(".dn-stats-overlay[data-stats]")?.remove();
  const statsContainer = document.createElement("div");
  statsContainer.className = "dn-stats-overlay";
  statsContainer.dataset.stats = "true";
  statsContainer.setAttribute("aria-hidden", "true");
  statsContainer.style.position = "fixed";
  statsContainer.style.right = "12px";
  statsContainer.style.bottom = "clamp(12px, calc(602px - 50vw), 88px)";
  statsContainer.style.zIndex = "40";
  statsContainer.style.top = "auto";
  statsContainer.style.left = "auto";
  statsContainer.style.display = "flex";
  statsContainer.style.alignItems = "flex-end";
  statsContainer.style.gap = "2px";
  statsContainer.style.background = "#000";
  statsContainer.style.opacity = "1";
  statsContainer.style.pointerEvents = "none";

  const fpsPanel = createStatsPanel("FPS", "#0ff", "#002", 100);
  const msPanel = createStatsPanel("MS", "#0f0", "#020", 200);
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

  const value = document.createElement("div");
  value.textContent = `0 ${label}`;
  value.style.marginBottom = "2px";

  const graph = document.createElement("div");
  graph.style.position = "relative";
  graph.style.height = "30px";
  graph.style.background = "#000";
  graph.style.overflow = "hidden";

  const bar = document.createElement("div");
  bar.style.position = "absolute";
  bar.style.left = "0";
  bar.style.bottom = "0";
  bar.style.width = "100%";
  bar.style.height = "0";
  bar.style.background = fg;
  graph.appendChild(bar);
  element.append(value, graph);
  return { element, value, bar, max, label };
}

function updateStatsPanel(panel: QuakeStatsPanel, value: number): void {
  const rounded = Math.round(value);
  panel.value.textContent = `${rounded} ${panel.label}`;
  const height = Math.max(0, Math.min(100, (value / panel.max) * 100));
  panel.bar.style.height = `${height}%`;
}

async function fetchQuakeScene(url: string, mapName?: string): Promise<QuakeScene> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}.`);
  const prepared = await response.json() as QuakePreparedScene;
  if (mapName && !prepared.renderBundle) {
    throw new Error(`Prepared Quake map ${mapName.toUpperCase()} is missing its render bundle.`);
  }
  if (prepared.renderBundle) await preloadQuakeRenderBundleAssets(prepared.renderBundle);
  return createQuakeSceneFromPreparedScene(prepared);
}

async function loadQuakeMap(mapName: string): Promise<void> {
  const url = quakeSceneUrl(mapName);
  if (!url) throw new Error(`No prepared Quake map registered for ${mapName}.`);
  setQuakeLoading(true, `Loading ${mapName.toUpperCase()}`);
  try {
    const scenePromise = fetchQuakeScene(url, mapName);
    const weaponPromise = preloadWeaponViewModel();
    const result = await scenePromise;
    if (quakeAppDisposed) return;
    await preloadQuakeMapModelRenderBundleAssets(mapName);
    if (quakeAppDisposed) return;
    currentMapName = mapName;
    menu.setCurrentLevel(mapName);
    mountQuakeScene(result);
    if (quakeAppDisposed) return;
    await completeQuakeSceneReadiness(weaponPromise);
  } catch (error) {
    if (!quakeAppDisposed) setQuakeLoading(false);
    throw error;
  }
}

function preloadWeaponViewModel(): Promise<QuakeViewmodelModel> {
  weaponViewModelPromise ??= fetchWeaponViewModel();
  return weaponViewModelPromise;
}

async function fetchWeaponViewModel(): Promise<QuakeViewmodelModel> {
  const url = quakeAssetManifest.assets.weaponModelUrl;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}.`);
  const model = await response.json() as QuakeViewmodelModel;
  await preloadQuakeRenderBundleAssets(model.renderBundle);
  return model;
}

async function mountWeaponViewModel(modelPromise = preloadWeaponViewModel()): Promise<void> {
  const model = await modelPromise;
  if (quakeAppDisposed) return;
  viewmodel.mount(model);
}

async function completeQuakeSceneReadiness(modelPromise = preloadWeaponViewModel()): Promise<void> {
  await mountWeaponViewModel(modelPromise);
  if (quakeAppDisposed) return;
  await world.waitForPresentationResyncs();
  if (quakeAppDisposed) return;
  await waitForQuakePaintFrames(2);
  if (quakeAppDisposed) return;
  setQuakeLoading(false);
}

async function waitForQuakePaintFrames(count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
}

function installQuakeAppDebugHooks(): void {
  installQuakeDebugHooks(import.meta.env.DEV, {
    controls: {
      getOrigin: () => controls.getOrigin(),
      setOrigin: (origin) => controls.setOrigin(origin),
    },
    currentMapName: () => currentMapName,
    entities: () => entityByIndex,
    fireWeapon: () => weapons.fire(),
    fireballEmittersCount: () => quakeFireballEmitters.length,
    fireballsCount: () => quakePointHazards.length,
    forwardDirection,
    hasCurrentScene: () => currentResult !== null,
    hideMainMenu: () => menu.hideMainMenu(),
    inventory: () => getPlayer().inventory(),
    isLoading: () => quakeAppLoading,
    loadMap: loadQuakeMap,
    mapExists: (mapName) => Boolean(quakeSceneUrl(mapName)),
    playerEyeHeight: () => getPlayer().eyeHeight(),
    pointToPoly: quakePointToPoly,
    setCollisionBypassUntil: (until) => {
      quakeDebugCollisionBypassUntil = until;
    },
    shootablesStats: () => shootables.debugStats(),
    syncCrosshairTarget: syncQuakeCrosshairTarget,
    syncPickupsVisibility: (origin) => getPickups().syncVisibility(origin),
    syncSceneCameraAt,
    syncShootablesVisibility: (origin, force) => shootables.syncVisibility(origin, force),
    syncViewmodel: () => viewmodel.syncTransform(),
    syncWorldVisibility: (force) => world.syncVisibility(force),
    worldStats: () => world.debugStats(),
  });
}

async function loadPickupModels(): Promise<void> {
  const url = quakeAssetManifest.assets.pickupModelsUrl;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}.`);
  const library = await response.json() as QuakePickupModelLibrary;
  if (quakeAppDisposed) return;
  currentPickupModelLibrary = library;
}

async function preloadQuakeMapModelRenderBundleAssets(mapName: string): Promise<void> {
  const library = currentPickupModelLibrary;
  if (!library) return;
  const map = quakeAssetManifest.maps.find((item) => item.mapName === mapName);
  const modelPaths = map?.modelPaths;
  if (!modelPaths) {
    await preloadQuakePickupModelRenderBundleAssets(library, Object.keys(library.models));
    return;
  }
  await preloadQuakePickupModelRenderBundleAssets(library, modelPaths);
}

async function preloadQuakePickupModelRenderBundleAssets(
  library: QuakePickupModelLibrary,
  modelPaths: Iterable<string>,
): Promise<void> {
  const bundles = new Set<QuakePreparedRenderBundle>();
  for (const modelPath of modelPaths) {
    const model = library.models[modelPath];
    if (!model) continue;
    if (model.renderBundle) bundles.add(model.renderBundle);
    if (model.animationFrameSet) bundles.add(model.animationFrameSet.renderBundle);
    for (const frame of model.animationFrames ?? []) bundles.add(frame.renderBundle);
  }
  await Promise.all([...bundles].map(preloadQuakeRenderBundleAssets));
}

async function loadProgramMetadata(): Promise<void> {
  const url = quakeAssetManifest.assets.programMetadataUrl;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}.`);
  const metadata = await response.json() as QuakeProgramMetadata;
  if (quakeAppDisposed) return;
  currentProgramMetadata = metadata;
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

async function fetchQuakeAssetManifest(): Promise<QuakeAssetManifest> {
  const response = await fetch(QUAKE_MANIFEST_URL);
  if (response.status === 404) return FALLBACK_QUAKE_ASSET_MANIFEST;
  if (!response.ok) throw new Error(`Could not load ${QUAKE_MANIFEST_URL}.`);
  return normalizeQuakeAssetManifest(await response.json());
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
  setQuakeLoading(true);
  setQuakeAssetManifest(await fetchQuakeAssetManifest());
  const startMap = quakeAssetManifest.startMap;
  const startupSceneUrl = quakeSceneUrl(startMap);
  if (!startupSceneUrl) throw new Error(`No prepared Quake start map registered for ${startMap}.`);
  const programMetadataPromise = loadProgramMetadata();
  const pickupModelsPromise = loadPickupModels();
  const soundManifestPromise = loadSoundManifest();
  const startupScenePromise = fetchQuakeScene(startupSceneUrl, startMap);
  const weaponPromise = preloadWeaponViewModel();
  await Promise.all([programMetadataPromise, pickupModelsPromise, soundManifestPromise]);
  if (quakeAppDisposed) return;
  const result = await startupScenePromise;
  if (quakeAppDisposed) return;
  await preloadQuakeMapModelRenderBundleAssets(startMap);
  if (quakeAppDisposed) return;
  currentMapName = startMap;
  menu.setCurrentLevel(currentMapName);
  mountQuakeScene(result);
  if (quakeAppDisposed) return;
  await completeQuakeSceneReadiness(weaponPromise);
  if (quakeAppDisposed) return;
  if (QUAKE_MENU_ENABLED) {
    menu.showMainMenu();
  } else {
    menu.hideMainMenu();
  }
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
  if (menu.handleKeyDown(event)) return;
  if (shouldPreventQuakeGameplayKeyDefault(event)) {
    event.preventDefault();
  }
  if (event.code === "KeyF") {
    event.preventDefault();
    host.focus();
  }
}

function handleViewportResize(): void {
  viewmodel.queueViewportSync();
}

function syncPlayerCollision(): void {
  if (import.meta.env.DEV && performance.now() < quakeDebugCollisionBypassUntil) return;
  getPlayer().syncCollision();
}

function disposeQuakeApp(): void {
  quakeAppDisposed = true;
  window.removeEventListener("keydown", handleWindowKeyDown, { capture: true });
  window.removeEventListener("resize", handleViewportResize);
  window.visualViewport?.removeEventListener("resize", handleViewportResize);
  host.removeEventListener("pointerdown", handleQuakeUsePointerDown, { capture: true });
  audioToggle?.removeEventListener("click", handleQuakeAudioToggleClick);
  controls.removeEventListener("change", syncPlayerCollision);
  menu.dispose();
  audio.dispose();
  disposeStatsOverlay();
  disposeCurrentScene();
}

window.addEventListener("keydown", handleWindowKeyDown, { capture: true });
window.addEventListener("resize", handleViewportResize);
window.visualViewport?.addEventListener("resize", handleViewportResize);

host.addEventListener("pointerdown", handleQuakeUsePointerDown, { capture: true });
audioToggle?.addEventListener("click", handleQuakeAudioToggleClick);
controls.addEventListener("change", syncPlayerCollision);

const disposeStatsOverlay = mountStatsOverlay();
syncQuakeHud();
installQuakeAppDebugHooks();

void loadQuake().catch((error) => {
  console.error(error);
  if (!quakeAppDisposed) setQuakeLoadingError();
});

const hot = import.meta as ImportMeta & { hot?: { dispose(callback: () => void): void } };
hot.hot?.dispose(disposeQuakeApp);
