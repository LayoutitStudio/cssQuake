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
  createQuakePocFromPreparedScene,
  type QuakeEntity,
  type QuakePocPreparedScene,
  type QuakePocScene,
} from "./prepared/preparedScene";
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
import { distanceSq3, subtractVec3 } from "./runtime/math";
import { createQuakeMenuController } from "./runtime/menu";
import {
  createQuakeMoversController,
  quakeButtonIsPressed,
  type QuakeMoverState,
} from "./runtime/movers";
import { createQuakeShootablesController } from "./runtime/shootables";
import { createQuakeTargetsController } from "./runtime/targets";
import { createQuakeTriggersController } from "./runtime/triggers";
import { createQuakeViewmodelController } from "./runtime/viewmodel";
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
  quakePickupModelPolygons,
  quakePickupPolygons,
  type QuakePickupModel,
  type QuakePickupModelLibrary,
  type QuakeProgramMetadata,
} from "./runtime/pickups";
import { createQuakePlayerController } from "./runtime/player";

const host = document.getElementById("quake-host") as HTMLElement;
const viewmodelLayer = document.getElementById("quake-viewmodel-layer") as HTMLElement | null;
const mainMenu = document.getElementById("quake-main-menu") as HTMLButtonElement | null;
const mainMenuArt = document.getElementById("quake-main-menu-art") as HTMLElement | null;
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
const LOCAL_START_MAP = "e1m1";
const LOCAL_MAP_URLS: Record<string, string> = {
  start: "/local/quake/start.preparsed.json",
  e1m1: "/local/quake/e1m1.preparsed.json",
  e1m2: "/local/quake/e1m2.preparsed.json",
  e1m3: "/local/quake/e1m3.preparsed.json",
  e1m4: "/local/quake/e1m4.preparsed.json",
  e1m5: "/local/quake/e1m5.preparsed.json",
  e1m6: "/local/quake/e1m6.preparsed.json",
  e1m7: "/local/quake/e1m7.preparsed.json",
  e1m8: "/local/quake/e1m8.preparsed.json",
};
const LOCAL_LEVELS = [
  { mapName: "e1m1", title: "the Slipgate Complex" },
  { mapName: "e1m2", title: "Castle of the Damned" },
  { mapName: "e1m3", title: "the Necropolis" },
  { mapName: "e1m4", title: "the Grisly Grotto" },
  { mapName: "e1m5", title: "Gloom Keep" },
  { mapName: "e1m6", title: "The Door To Chthon" },
  { mapName: "e1m7", title: "The House of Chthon" },
  { mapName: "e1m8", title: "Ziggurat Vertigo" },
] as const;
const LOCAL_WEAPON_URL = "/local/quake/weapon-shotgun.preparsed.json";
const LOCAL_PICKUP_MODELS_URL = "/local/quake/pickups.preparsed.json";
const LOCAL_PROGRAM_METADATA_URL = "/local/quake/progs.preparsed.json";
const QUAKE_JUMP_VELOCITY = (270 / 48) * QUAKE_RENDER_SUPERSAMPLE;
const QUAKE_GRAVITY = (800 / 48) * QUAKE_RENDER_SUPERSAMPLE;
const QUAKE_CAMERA_ZOOM = (BASE_TILE * 0.65) / QUAKE_RENDER_SUPERSAMPLE;
const QUAKE_MENU_ENABLED = true;

function mountQuakeLevelSelector(): void {
  if (!levelList) return;
  levelList.replaceChildren();
  for (const level of LOCAL_LEVELS) {
    const button = document.createElement("button");
    button.className = "quake-level-button";
    button.type = "button";
    button.dataset.quakeMap = level.mapName;
    button.setAttribute("aria-label", `${level.mapName.toUpperCase()} ${level.title}`);

    const code = document.createElement("span");
    code.className = "quake-level-code";
    code.dataset.quakeBitmapText = "";
    code.dataset.quakeBitmapSize = "label";
    code.dataset.quakeBitmapAlt = "true";
    code.textContent = level.mapName.toUpperCase();

    const title = document.createElement("span");
    title.className = "quake-level-name";
    title.dataset.quakeBitmapText = "";
    title.dataset.quakeBitmapSize = "label";
    title.textContent = level.title;

    button.append(code, title);
    levelList.append(button);
  }
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
let weaponViewModelPolygonsPromise: Promise<Polygon[]> | null = null;

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
menu.setCurrentLevel(LOCAL_START_MAP);
const viewmodel = createQuakeViewmodelController({
  scene,
  controls,
  host,
  hud: classicHud,
  layer: viewmodelLayer,
  onMount: world.pixelate,
});
const shootables = createQuakeShootablesController({
  scene,
  pointToPoly: quakePointToPoly,
  shouldSpawn: shouldSpawnQuakeEntityForCurrentGame,
  pixelate: world.pixelate,
  schedulePresentationResync: world.schedulePresentationResync,
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
  fireTarget: fireQuakeTarget,
  getEntity: (entityIndex) => entityByIndex.get(entityIndex),
  getOrigin: () => controls.getOrigin(),
  getTouchedTriggers: currentQuakeTouchedTriggers,
  onActiveKeyChange: syncQuakeActiveTriggerDataset,
  transitionSerial: () => quakeTransitionSerial,
});
pickups = createQuakePickupController({
  addMesh: addQuakePickupMesh,
  applyEffect: (effect) => {
    applyQuakeInventoryDelta(getPlayer().inventory(), effect);
    syncQuakeHud();
  },
  leafIndexAt: world.leafIndexAt,
  pixelate: world.pixelate,
  pointToPoly: quakePointToPoly,
  programMetadata: () => currentProgramMetadata,
  schedulePresentationResync: world.schedulePresentationResync,
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
  playFireAnimation: viewmodel.playFireAnimation,
  destroyShootable: shootables.destroy,
  activateEntity: activateQuakeEntity,
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
      delete document.body.dataset.quakeDamageFlash;
      return;
    }
    void host.offsetWidth;
    document.body.dataset.quakeDamageFlash = "true";
  },
  onHazardState: (kind) => {
    if (kind) {
      document.body.dataset.quakeHazard = kind;
    } else {
      delete document.body.dataset.quakeHazard;
    }
  },
  onInventoryChanged: syncQuakeHud,
  onRespawn: (result, previousOrigin) => {
    triggerSystem.resetActive();
    shootables.spawn(result.entities, currentPickupModelLibrary);
    getPickups().spawn(result.entities, currentPickupModelLibrary, previousOrigin);
  },
  pointToPoly: quakePointToPoly,
  resolveShootablesCollision: shootables.resolvePlayerCollision,
  syncCrosshairTarget: syncQuakeCrosshairTarget,
  syncHazards: syncQuakeHazards,
  syncPickups: (origin, eyeHeight) => getPickups().syncCollision(origin, eyeHeight, STEP_HEIGHT),
  syncTouchedTriggers,
  syncViewmodel: () => viewmodel.syncTransform(),
  syncWorldVisibility: (force) => world.syncVisibility(force),
  transitionSerial: () => quakeTransitionSerial,
});

let currentPickupModelLibrary: QuakePickupModelLibrary | null = null;
let currentProgramMetadata: QuakeProgramMetadata | null = null;
let currentCollisionWorld: QuakeCollisionWorld | null = null;
let currentResult: QuakePocScene | null = null;
let entityByIndex = new Map<number, QuakeEntity>();
let quakeModelPivot = { x: 0, y: 0, z: 0 };
let quakeLevelLoadTimer: number | null = null;
let quakeTransitionSerial = 0;
let currentMapName = LOCAL_START_MAP;
let quakeAppDisposed = false;
let quakeAppLoading = true;

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

function makeParseResult(polygons: Polygon[]): ParseResult {
  return { polygons, objectUrls: [], warnings: [], dispose: () => undefined };
}

function syncQuakeHud(): void {
  syncQuakeHudElements(hudElements, getPlayer().inventory());
}

function clearQuakeLevelLoadTimer(): void {
  if (quakeLevelLoadTimer !== null) {
    window.clearTimeout(quakeLevelLoadTimer);
    quakeLevelLoadTimer = null;
  }
}

function clearQuakeLevelComplete(): void {
  delete document.body.dataset.quakeLevelComplete;
  delete quakeHud?.dataset.quakeLevelComplete;
  controls.update({ moveEnabled: true, jumpEnabled: true, jumpVelocity: QUAKE_JUMP_VELOCITY, gravity: QUAKE_GRAVITY });
}

function isQuakeLevelTransitionActive(): boolean {
  return document.body.dataset.quakeLevelComplete !== undefined;
}

function canUseQuakeGameplayInput(): boolean {
  return !quakeAppLoading &&
    !menu.isMainMenuOpen() &&
    !menu.isMenuPanelOpen() &&
    !isQuakeLevelTransitionActive() &&
    currentCollisionWorld !== null;
}

function setQuakeLoading(active: boolean, status = "Loading"): void {
  quakeAppLoading = active;
  if (active) {
    document.body.dataset.quakeLoading = "true";
    updateQuakeLoadingStatus(status);
    if (loadingOverlay) {
      loadingOverlay.hidden = false;
      loadingOverlay.setAttribute("aria-busy", "true");
    }
    controls.update({ moveEnabled: false });
    clearQuakeCrosshairTarget();
    return;
  }

  delete document.body.dataset.quakeLoading;
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
  document.body.dataset.quakeLoading = "true";
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

function addQuakePickupMesh(entity: QuakeEntity, model?: QuakePickupModel): PolyMeshHandle | null {
  const polygons = model
    ? quakePickupModelPolygons(entity, model)
    : quakePickupPolygons(entity, currentPickupModelLibrary, currentProgramMetadata);
  if (!polygons.length || !entity.origin) return null;
  const animated = Boolean(model?.animationFrames && model.animationFrames.length > 1 && model.source.startsWith("progs/"));
  const handle = scene.add(makeParseResult(polygons), {
    id: `quake-pickup-${entity.index}`,
    merge: false,
    meshResolution: "lossless",
    stableDom: animated,
    excludeFromAutoCenter: true,
  });
  const angle = entity.angle ?? quakeEntityNumber(entity, "angle", 0);
  handle.setTransform({
    position: quakePointToPoly(entity.origin),
    rotation: [0, 0, angle],
    scale: 1,
  });
  world.pixelate(handle);
  world.schedulePresentationResync(handle);
  return handle;
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
  clearQuakeLevelLoadTimer();
  clearQuakeCrosshairTarget();
  getPlayer().resetForSceneDispose();
  currentCollisionWorld = null;
  currentResult = null;
  triggerSystem.clear();
  entityByIndex = new Map();
  targetSystem.clear();
  quakeModelPivot = { x: 0, y: 0, z: 0 };
  weapons.reset();
  quakeTransitionSerial = 0;
  delete document.body.dataset.quakeTriggers;
}

function setCamera(spawn: QuakePocScene["spawn"]): void {
  getPlayer().spawn(spawn);
  syncSceneCamera(spawn.rotX, spawn.rotY);
  syncQuakeCrosshairTarget();
}

function syncSceneCamera(rotX: number, rotY: number): void {
  const origin = getPlayer().currentOrigin();
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

function mountQuakeScene(result: QuakePocScene): void {
  disposeCurrentScene();
  currentResult = result;
  currentCollisionWorld = result.collision
    ? buildQuakeClipCollisionWorld(result.collision) ?? buildQuakeCollisionWorld(result.polygons)
    : buildQuakeCollisionWorld(result.polygons);
  world.mount(result);
  setupQuakeEntityActions(result);
  setCamera(result.spawn);
  shootables.spawn(result.entities, currentPickupModelLibrary);
  getPlayer().resetInventory();
  const origin = getPlayer().currentOrigin();
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

function setupQuakeEntityActions(result: QuakePocScene): void {
  entityByIndex = new Map(result.entities.map((entity) => [entity.index, entity]));
  targetSystem.setup(result.entities);
  triggerSystem.clear();
  quakeModelPivot = result.collision?.pivot ?? { x: 0, y: 0, z: 0 };
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
  document.body.dataset.quakeLevelComplete = "true";
  const nextMap = quakeChangelevelMap(entity);
  if (quakeHud) {
    quakeHud.dataset.quakeLevelComplete = nextMap ? `EXIT TO ${nextMap.toUpperCase()}` : "EXIT REACHED";
  }
  if (!nextMap || !LOCAL_MAP_URLS[nextMap]) return;
  quakeLevelLoadTimer = window.setTimeout(() => {
    quakeLevelLoadTimer = null;
    void loadQuakeMap(nextMap).catch((error) => {
      console.error(error);
      if (quakeHud) quakeHud.dataset.quakeLevelComplete = `COULD NOT LOAD ${nextMap.toUpperCase()}`;
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

function activateQuakeEntity(entityIndex: number, sourceEntityIndex?: number): void {
  const entity = entityByIndex.get(entityIndex);
  if (!entity) return;
  if (entity.classname === "trigger_counter") {
    activateTriggerCounter(entity);
    return;
  }
  if (shootables.has(entity.index)) {
    shootables.destroy(entity.index);
    return;
  }
  movers.activateEntity(entity.index, sourceEntityIndex);
}

function activateTriggerCounter(entity: QuakeEntity): void {
  triggerSystem.activateCounterEntity(entity);
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
  return true;
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
  syncQuakeCrosshairTarget();
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
  const baseTexture = leaf.element.dataset.quakeButtonBaseTexture;
  const pressedTexture = leaf.element.dataset.quakeButtonPressedTexture;
  const texture = pressed ? pressedTexture : baseTexture;
  if (texture) {
    leaf.element.dataset.quakeButtonActive = "true";
    leaf.element.style.backgroundImage = quakeCssUrl(texture);
    leaf.element.style.backgroundPosition = "center";
    leaf.element.style.backgroundSize = "100% 100%";
    leaf.element.style.backgroundRepeat = "no-repeat";
    if (pressed) {
      leaf.element.style.animationName = "none";
    } else {
      delete leaf.element.dataset.quakeButtonActive;
      leaf.element.style.removeProperty("animation-name");
      syncQuakeTextureAnimationLeafAnimationClock(leaf.element);
    }
    return;
  }
  delete leaf.element.dataset.quakeButtonActive;
  leaf.element.style.removeProperty("animation-name");
  leaf.element.style.backgroundImage = leaf.baseBackgroundImage;
  leaf.element.style.backgroundPosition = leaf.baseBackgroundPosition;
  leaf.element.style.backgroundSize = leaf.baseBackgroundSize;
  leaf.element.style.backgroundRepeat = leaf.baseBackgroundRepeat;
}

function handleQuakeUsePointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !event.isPrimary || !canUseQuakeGameplayInput()) return;
  event.preventDefault();
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
    document.body.dataset.quakeCrosshairAction = trace.classname ?? "action";
    return;
  }
  const weaponTrace = weapons.weaponTraceAtCrosshair();
  if (weapons.traceIsShootable(weaponTrace)) {
    document.body.dataset.quakeCrosshairAction = weaponTrace.classname ?? "action";
    return;
  }
  clearQuakeCrosshairTarget();
}

function clearQuakeCrosshairTarget(): void {
  delete document.body.dataset.quakeCrosshairAction;
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
  ];
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
  if (key) {
    document.body.dataset.quakeTriggers = key;
  } else {
    delete document.body.dataset.quakeTriggers;
  }
}

function syncTouchedTriggers(origin: [number, number, number]): QuakeTouchedTrigger[] {
  return triggerSystem.sync(origin);
}


function mountStatsOverlay(): () => void {
  document.querySelector(".dn-stats-overlay[data-quake-poc-stats]")?.remove();
  const statsContainer = document.createElement("div");
  statsContainer.className = "dn-stats-overlay";
  statsContainer.dataset.quakePocStats = "true";
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

async function fetchQuakeScene(url: string, mapName?: string): Promise<QuakePocScene> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}.`);
  const prepared = await response.json() as QuakePocPreparedScene;
  if (mapName && isQuakeRenderBundleRequired(mapName) && !prepared.renderBundle) {
    throw new Error(`Prepared Quake map ${mapName.toUpperCase()} is missing its render bundle.`);
  }
  return createQuakePocFromPreparedScene(prepared);
}

function isQuakeRenderBundleRequired(mapName: string): boolean {
  return /^e1m[1-8]$/.test(mapName);
}

async function loadQuakeMap(mapName: string): Promise<void> {
  const url = LOCAL_MAP_URLS[mapName];
  if (!url) throw new Error(`No prepared Quake map registered for ${mapName}.`);
  setQuakeLoading(true, `Loading ${mapName.toUpperCase()}`);
  try {
    const scenePromise = fetchQuakeScene(url, mapName);
    const weaponPromise = preloadWeaponViewModelPolygons();
    const result = await scenePromise;
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

function preloadWeaponViewModelPolygons(): Promise<Polygon[]> {
  weaponViewModelPolygonsPromise ??= fetchWeaponViewModelPolygons();
  return weaponViewModelPolygonsPromise;
}

async function fetchWeaponViewModelPolygons(): Promise<Polygon[]> {
  const response = await fetch(LOCAL_WEAPON_URL);
  if (!response.ok) throw new Error(`Could not load ${LOCAL_WEAPON_URL}.`);
  const prepared = await response.json() as { polygons: Polygon[] };
  return prepared.polygons;
}

async function mountWeaponViewModel(polygonsPromise = preloadWeaponViewModelPolygons()): Promise<void> {
  const polygons = await polygonsPromise;
  if (quakeAppDisposed) return;
  viewmodel.mount(polygons);
}

async function completeQuakeSceneReadiness(polygonsPromise = preloadWeaponViewModelPolygons()): Promise<void> {
  await mountWeaponViewModel(polygonsPromise);
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

async function loadPickupModels(): Promise<void> {
  const response = await fetch(LOCAL_PICKUP_MODELS_URL);
  if (!response.ok) throw new Error(`Could not load ${LOCAL_PICKUP_MODELS_URL}.`);
  const library = await response.json() as QuakePickupModelLibrary;
  if (quakeAppDisposed) return;
  currentPickupModelLibrary = library;
}

async function loadProgramMetadata(): Promise<void> {
  const response = await fetch(LOCAL_PROGRAM_METADATA_URL);
  if (!response.ok) throw new Error(`Could not load ${LOCAL_PROGRAM_METADATA_URL}.`);
  const metadata = await response.json() as QuakeProgramMetadata;
  if (quakeAppDisposed) return;
  currentProgramMetadata = metadata;
}

async function loadQuakePoc(): Promise<void> {
  setQuakeLoading(true);
  const programMetadataPromise = loadProgramMetadata();
  const pickupModelsPromise = loadPickupModels();
  const startupScenePromise = fetchQuakeScene(LOCAL_MAP_URLS[LOCAL_START_MAP], LOCAL_START_MAP);
  const weaponPromise = preloadWeaponViewModelPolygons();
  await Promise.all([programMetadataPromise, pickupModelsPromise]);
  if (quakeAppDisposed) return;
  const result = await startupScenePromise;
  if (quakeAppDisposed) return;
  currentMapName = LOCAL_START_MAP;
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
  if (quakeAppLoading) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (menu.handleKeyDown(event)) return;
  if (event.code === "KeyF") {
    event.preventDefault();
    host.focus();
  }
}

function handleViewportResize(): void {
  viewmodel.queueViewportSync();
}

function syncPlayerCollision(): void {
  getPlayer().syncCollision();
}

function disposeQuakeApp(): void {
  quakeAppDisposed = true;
  window.removeEventListener("keydown", handleWindowKeyDown, { capture: true });
  window.removeEventListener("resize", handleViewportResize);
  window.visualViewport?.removeEventListener("resize", handleViewportResize);
  host.removeEventListener("pointerdown", handleQuakeUsePointerDown, { capture: true });
  controls.removeEventListener("change", syncPlayerCollision);
  menu.dispose();
  disposeStatsOverlay();
  disposeCurrentScene();
}

window.addEventListener("keydown", handleWindowKeyDown, { capture: true });
window.addEventListener("resize", handleViewportResize);
window.visualViewport?.addEventListener("resize", handleViewportResize);

host.addEventListener("pointerdown", handleQuakeUsePointerDown, { capture: true });
controls.addEventListener("change", syncPlayerCollision);

const disposeStatsOverlay = mountStatsOverlay();
syncQuakeHud();

void loadQuakePoc().catch((error) => {
  console.error(error);
  if (!quakeAppDisposed) setQuakeLoadingError();
});

const hot = import.meta as ImportMeta & { hot?: { dispose(callback: () => void): void } };
hot.hot?.dispose(disposeQuakeApp);
