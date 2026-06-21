import {
  createPolyPerspectiveCamera,
  createPolyFirstPersonControls,
  createPolyScene,
  type ParseResult,
  type Polygon,
  type PolyMeshHandle,
  type Vec3,
} from "@layoutit/polycss";
import { QUAKE_RENDER_SUPERSAMPLE } from "./prepare/scene";
import type {
  QuakeEntity,
  QuakeEntityManifestPoint,
  QuakeScene,
  QuakeVertex,
} from "./types/quake";
import { QUAKE_PLAYER_WEAPON_FIRE_FACTS } from "./generated/quakeProgramFacts";
import { createQuakeSoundController, type QuakeSoundEvent } from "./runtime/audio";
import { QUAKE_ALIAS_MODEL_RENDER_YAW_OFFSET } from "./runtime/aliasModelOrientation";
import { mountQuakeBitmapText } from "./runtime/bitmapText";
import {
  QUAKE_COLLISION_UNIT_SCALE,
  QUAKE_PLAYER_MINS_Z,
  QUAKE_PLAYER_VIEW_Z,
  STEP_HEIGHT,
} from "./runtime/constants";
import {
  QUAKE_PMOVE_BACK_SPEED,
  QUAKE_PMOVE_DT_CLAMP,
  QUAKE_PMOVE_FORWARD_SPEED,
  QUAKE_PMOVE_SIDE_SPEED,
  QUAKE_PMOVE_SPEED_KEY_MULTIPLIER,
} from "./runtime/playerPhysics";
import {
  type QuakeCollisionWorld,
  type QuakeTouchedTrigger,
} from "./runtime/collision";
import { isQuakeDebugHooksEnabled } from "./runtime/debug/quakeDebug";
import { createQuakeDebugRecorder } from "./runtime/debug/recording";
import { markQuakeTrace } from "./runtime/debug/traceMarks";
import { shouldSpawnQuakeEntityForCurrentGame } from "./runtime/entities";
import {
  applyQuakeInventoryDelta,
  createQuakeHudElements,
  selectQuakeBestInventoryWeapon,
  type QuakeKey,
  type QuakeWeaponId,
} from "./runtime/hud";
import {
  quakeContentsDamageForWaterLevel,
  quakeContentsIsLiquid,
  quakePlayerWaterLevel,
  type QuakeHazardDamage,
} from "./runtime/hazards";
import {
  QUAKE_LOADING_CONSOLE_PAK_LINE,
  type QuakeLoadingProgressTracker,
} from "./runtime/loadingConsole";
import { createQuakeAppRuntimeContext } from "./runtime/app/context";
import {
  addQuakeBodyClasses,
  hasQuakeBodyClass,
  queryQuakeAppDom,
  removeQuakeBodyClasses,
  setQuakeBodyClass,
} from "./runtime/app/dom";
import {
  createQuakeCameraFeedbackFlow,
  quakeCameraForwardDirection as forwardDirection,
  type QuakeCameraFeedbackFlow,
  type QuakeRenderCameraOriginPolicy,
} from "./runtime/app/cameraFeedbackFlow";
import {
  createQuakeCameraViewFlow,
  quakeInitialCameraViewConfig,
} from "./runtime/app/cameraViewFlow";
import { createQuakeDebugFlyController } from "./runtime/app/debugFly";
import { installQuakeAppDebugApi } from "./runtime/app/debugApi";
import { createQuakeDebugPanelFlow } from "./runtime/app/debugPanelFlow";
import { createQuakeDebugRecordingSnapshotFlow } from "./runtime/app/debugRecordingSnapshotFlow";
import { createQuakeEntityMeshMountFlow } from "./runtime/app/entityMeshMountFlow";
import { createQuakeHudFlow } from "./runtime/app/hudFlow";
import { createQuakeIntermissionFlow } from "./runtime/app/intermissionFlow";
import {
  createQuakeLevelStatsFlow,
  quakeLevelStatsTotalsForEntities,
} from "./runtime/app/levelStatsFlow";
import { createQuakeAppInputController } from "./runtime/app/input";
import { createQuakeGameplayInputFlow } from "./runtime/app/gameplayInputFlow";
import {
  createQuakeEffectSpriteFlow,
  type QuakeEffectSpriteFlow,
} from "./runtime/app/effectSpriteFlow";
import {
  createQuakeImpactParticleFlow,
  type QuakeImpactParticleFlow,
} from "./runtime/app/impactParticleFlow";
import { createQuakeDamageableBrushFlow } from "./runtime/app/damageableBrushFlow";
import { createQuakePowerupFlow } from "./runtime/app/powerupFlow";
import { createQuakeRouteFlow, type QuakeCssView } from "./runtime/app/routeFlow";
import { createQuakeOptionsFlow } from "./runtime/app/optionsFlow";
import { createQuakeLoadingFlow } from "./runtime/app/loadingFlow";
import { createQuakeAssetWarmupFlow } from "./runtime/app/assetWarmupFlow";
import { createQuakeAssetCatalogFlow } from "./runtime/app/assetCatalogFlow";
import { createQuakeStatsOverlayFlow, type QuakeStatsOverlayFlow } from "./runtime/app/statsOverlayFlow";
import { createQuakeSceneMountFlow } from "./runtime/app/sceneMountFlow";
import {
  createQuakeMoverInteractionFlow,
  type QuakeMoverInteractionFlow,
} from "./runtime/app/moverInteractionFlow";
import {
  createQuakeTextPresentationFlow,
  type QuakeTextPresentationFlow,
} from "./runtime/app/textPresentationFlow";
import { createQuakeViewmodelAssetFlow } from "./runtime/app/viewmodelAssetFlow";
import {
  createQuakeWeaponPresentationFlow,
  type QuakeWeaponPresentationFlow,
} from "./runtime/app/weaponPresentationFlow";
import { createQuakeSoundManifestFlow } from "./runtime/app/soundManifestFlow";
import {
  createQuakeCrosshairInteractionFlow,
  type QuakeCrosshairInteractionFlow,
} from "./runtime/app/crosshairInteractionFlow";
import {
  createQuakeEntityActivationFlow,
  type QuakeEntityActivationFlow,
} from "./runtime/app/entityActivationFlow";
import {
  createQuakePlayerLifecycleFlow,
  type QuakePlayerLifecycleFlow,
} from "./runtime/app/playerLifecycleFlow";
import { createQuakePointerGameplayFlow } from "./runtime/app/pointerGameplayFlow";
import {
  QUAKE_ASSET_ROOT,
  QuakeAssetsRegeneratingError,
  createQuakeAppMapLoader,
  fetchQuakeAssetManifest,
  fetchQuakeScene,
  type QuakeAssetManifest,
  type QuakeMapLoadOptions,
} from "./runtime/app/session";
import { createQuakePointHazardFlow } from "./runtime/app/pointHazardFlow";
import {
  createQuakeLoopbackMultiplayerSession,
  createQuakeMultiplayerCompactInviteValue,
  createQuakeMultiplayerEnvelope,
  createQuakePartySocketMultiplayerSession,
  createQuakeMultiplayerRoomIdFromToken,
  createQuakeMultiplayerRemotePlayerPresenter,
  createQuakeNoopMultiplayerSession,
  decideQuakeMultiplayerLocalCorrection,
  normalizeQuakeMultiplayerRegion,
  normalizeQuakePartySocketHost,
  parseQuakeMultiplayerCompactInviteParts,
  QUAKE_MULTIPLAYER_COMPACT_MAP_CODE_CAPACITY,
  QUAKE_MULTIPLAYER_COMPACT_MAP_CODE_LENGTH,
  QUAKE_MULTIPLAYER_REGIONS,
  QUAKE_MULTIPLAYER_ROOM_TOKEN_ALPHABET,
  QUAKE_MULTIPLAYER_ROOM_TOKEN_LENGTH,
  QUAKE_MULTIPLAYER_ROOM_TOKEN_PATTERN,
  QUAKE_MULTIPLAYER_MAX_PLAYERS_CAP,
  quakeMultiplayerDeathmatchSpawnOrder,
  quakeMultiplayerGameplayDefinitionsFromScene,
  quakeMultiplayerRegionInviteCode,
  quakeMultiplayerRegionLabel,
  quakeMultiplayerWorldDefinitionsFromScene,
  type QuakeMultiplayerAuthoritativePickupState,
  type QuakeMultiplayerAuthoritativePlayerState,
  type QuakeMultiplayerInventoryState,
  type QuakeMultiplayerLocalInputIntent,
  type QuakeMultiplayerPlayerPresenceStatus,
  type QuakeMultiplayerRemoteInterpolationState,
  type QuakeMultiplayerRemoteVisualHandle,
  type QuakeMultiplayerRoomCompatibilityKey,
  type QuakeMultiplayerRoomErrorPayload,
  type QuakeMultiplayerRoomEnvelope,
  type QuakeMultiplayerRoomMatchState,
  type QuakeMultiplayerRoomRejectPayload,
  type QuakeMultiplayerRegionId,
  type QuakeMultiplayerSharedWorldEvent,
  type QuakeMultiplayerWorldIntent,
} from "./runtime/multiplayer";
import { createQuakeMenuController } from "./runtime/menu";
import { createQuakeMoversController } from "./runtime/movers";
import { requestQuakeLandscapeOnMobile } from "./runtime/orientation";
import { createQuakeMonsterStateRunner } from "./runtime/quakeMonsterStateRunner";
import {
  normalizeQuakeUrlAngle,
  quakeUrlRouteIsDirect,
  quakeUrlRouteShouldNormalize,
  type QuakeUrlRoute,
  type QuakeUrlUpdateMode,
  type QuakeUrlView,
} from "./runtime/routeState";
import {
  createQuakePointerTracer,
  quakePointerEventTargetLabel as quakeEventTargetLabel,
  quakePointerUserActivationDetails as quakeUserActivationTraceDetails,
  type QuakePointerTraceDetails,
} from "./runtime/pointerTrace";
import {
  createQuakeShootablesController,
  type QuakeShootablesDebugStats,
  type QuakeShootablesPlayerClearanceOptions,
} from "./runtime/shootables";
import type { QuakeRenderBundleFrameSetMotionMaterialOptions } from "./runtime/renderBundleMesh";
import { createCssQuakeSaveSession } from "./runtime/app/saveSession";
import { createQuakeTargetsController } from "./runtime/targets";
import { createQuakeTextController } from "./runtime/text";
import { createQuakeTriggersController } from "./runtime/triggers";
import {
  createQuakeViewmodelController,
  type QuakeViewmodelModel,
} from "./runtime/viewmodel";
import {
  createQuakeWeaponsController,
  type QuakeWeaponFireEvent,
  type QuakeWeaponFireSoundId,
  type QuakeWeaponWallImpactEffect,
} from "./runtime/weapons";
import {
  createQuakeWorldController,
  injectQuakeWorldAnimations,
  quakeCssUrl,
  setQuakeTextureAnimationLeafActive,
  syncQuakeTextureAnimationLeafAnimationClock,
  type QuakeFaceLeaf,
} from "./runtime/world";
import {
  createQuakePickupController,
  quakeCanPickupForInventory,
  quakePickupEffectForEntity,
  quakePickupMessageForEntity,
  quakePickupModelRenderBundleFrameSet,
  quakePickupModelRenderBundle,
  type QuakePickupModel,
  type QuakePickupModelLibrary,
  type QuakeProgramMetadata,
} from "./runtime/pickups";
import {
  createQuakePlayerController,
  type QuakePlayerDeathDetails,
} from "./runtime/player";
import {
  mountQuakeRenderBundleFrameSetMesh,
  mountQuakeRenderBundleMesh,
  setQuakeRenderBundleFrameSetHandleFrame,
  syncQuakeRenderBundleDebugOutlineLeaves,
  stripPolyMeshMetadata,
  type QuakeRenderBundleFrameSet,
} from "./runtime/renderBundleMesh";

declare const __CSSQUAKE_VERSION__: string;

const QUAKE_DEBUG_PANEL_STATS_MS = 250;
const QUAKE_DOOR_MESSAGE_COOLDOWN_MS = 2000;
const quakeDom = queryQuakeAppDom();
const {
  app: quakeApp,
  scene: quakeSceneRoot,
  menu: quakeMenu,
  weapon,
  mainMenu,
  mainMenuArt,
  versionLabel,
  singlePlayerPanel,
  multiplayerPanel,
  multiplayerForm,
  multiplayerNameInput,
  multiplayerColorInput,
  multiplayerMapSelect,
  multiplayerRegionSelect,
  multiplayerFragLimitInput,
  multiplayerMaxPlayersInput,
  levelPanel,
  levelList,
  aboutPanel,
  optionsPanel,
  disableSoundOption,
  disableEnemiesOption,
  disableDamageOption,
  invertMouseOption,
  alwaysRunOption,
  showGunOption,
  dynamicLightingOption,
  impactParticlesOption,
  impactParticlesLayer,
  crosshair,
  crosshairOption,
  crosshairOptionValue,
  debugStack,
  debugPanel,
  debugShowMenuOption,
  debugEnabledOption,
  debugShowFpsOption,
  debugEnableAnimationsOption,
  debugFreezeEnemiesOption,
  debugDisableAttacksOption,
  debugShowTexturesOption,
  debugFlyModeOption,
  debugShowOutlinesOption,
  debugShowLabelsOption,
  debugRecordingRow,
  debugRecordingButton,
  debugStatElements,
  loadingOverlay,
  loadingStatus,
  loadingProgress,
  loadingProgressFill,
  loadingAction,
  hudArmorValue,
  hudHealthValue,
  hudHealthDamageValue,
  hudAmmoValue,
  classicHud,
  hud: quakeHud,
  bonusOverlay,
  damageOverlay,
  notify: quakeNotify,
  centerPrint: quakeCenterPrint,
  intermission: quakeIntermissionRoot,
} = quakeDom;
const quakeText = createQuakeTextController({
  centerPrintRoot: quakeCenterPrint,
  notifyRoot: quakeNotify,
});
const quakeIntermission = createQuakeIntermissionFlow({
  renderBitmapText: mountQuakeBitmapText,
  root: quakeIntermissionRoot,
});
const quakeLevelStats = createQuakeLevelStatsFlow();
const hudElements = createQuakeHudElements({
  root: classicHud,
  armor: hudArmorValue,
  health: hudHealthValue,
  healthDamage: hudHealthDamageValue,
  ammo: hudAmmoValue,
});
const QUAKE_LOADING_PREVIEW_ENABLED = import.meta.env.DEV && new URLSearchParams(window.location.search).has("loading");

const QUAKE_PAUSED_TIMER_POLL_MS = 100;

function createQuakeRuntimeRandomSalt(): number {
  const seedOverride = new URLSearchParams(window.location.search).get("rngSeed")?.trim();
  if (seedOverride) {
    const parsed = Number(seedOverride);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff) return parsed >>> 0;
  }
  try {
    const values = new Uint32Array(1);
    globalThis.crypto?.getRandomValues(values);
    if (values[0] !== 0) return values[0] >>> 0;
  } catch (error) {
    markQuakeTrace("runtime-random-salt-fallback", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  const fallback = Math.floor(Math.random() * 0x100000000) >>> 0;
  return fallback === 0 ? 0x9e3779b9 : fallback;
}

function quakeUrlBoolean(name: string): boolean {
  const rawValue = new URLSearchParams(window.location.search).get(name);
  if (rawValue === null) return false;
  return quakeFeatureFlagEnabled(rawValue, true);
}

function quakeFeatureFlagEnabled(rawValue: string | undefined, emptyEnabled = false): boolean {
  if (rawValue === undefined) return false;
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "") return emptyEnabled;
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
}

function quakeUrlNumberParam(
  params: URLSearchParams,
  name: string,
  min: number,
  max: number,
): number | null {
  const rawValue = params.get(name);
  if (rawValue === null) return null;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, value));
}

function quakeDebugMonsterMotionMaterialPolicy(
  params: URLSearchParams,
): QuakeRenderBundleFrameSetMotionMaterialOptions | null {
  if (!import.meta.env.DEV) return null;
  const mode = params.get("debugMonsterMaterial")?.trim().toLowerCase();
  if (!mode || mode === "0" || mode === "false" || mode === "off") return null;
  const policy: QuakeRenderBundleFrameSetMotionMaterialOptions = {};
  const ratioOverride = quakeUrlNumberParam(params, "debugMonsterMaterialTextureRatio", 0, 1);
  if (ratioOverride !== null) {
    policy.texturedAreaRatio = ratioOverride;
  } else if (mode === "tail50") {
    policy.texturedAreaRatio = 0.5;
  } else if (mode === "solid") {
    policy.texturedAreaRatio = 0;
  } else {
    policy.texturedAreaRatio = 0.25;
  }
  const restoreDelayMs = quakeUrlNumberParam(params, "debugMonsterMaterialDelayMs", 0, 5000);
  if (restoreDelayMs !== null) policy.restoreDelayMs = restoreDelayMs;
  const restoreChunkIntervalMs = quakeUrlNumberParam(params, "debugMonsterMaterialChunkMs", 0, 1000);
  if (restoreChunkIntervalMs !== null) policy.restoreChunkIntervalMs = restoreChunkIntervalMs;
  return policy;
}

function quakeDebugMonsterPlayerClearancePolicy(
  params: URLSearchParams,
): QuakeShootablesPlayerClearanceOptions | null {
  if (!import.meta.env.DEV) return null;
  const mode = params.get("debugMonsterClearance")?.trim().toLowerCase();
  if (!mode || mode === "0" || mode === "false" || mode === "off") return null;
  const classnames = quakeDebugMonsterPlayerClearanceClassnames(params, mode);
  if (!classnames.length) return null;
  const extraUnits = quakeUrlNumberParam(params, "debugMonsterClearanceUnits", 0, 256) ?? 64;
  return {
    enemyClassnames: classnames,
    extraRadius: extraUnits * QUAKE_COLLISION_UNIT_SCALE,
    useBossAwakeBounds: mode !== "model" && mode !== "boss-model",
  };
}

function quakeDebugMonsterPlayerClearanceClassnames(params: URLSearchParams, mode: string): string[] {
  const explicit = params.get("debugMonsterClearanceClassnames") ??
    params.get("debugMonsterClearanceClasses") ??
    "";
  const explicitClassnames = explicit
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^monster_[a-z0-9_]+$/i.test(value));
  if (explicitClassnames.length) return [...new Set(explicitClassnames)];
  if (mode === "boss" || mode.startsWith("boss-")) return ["monster_boss"];
  if (mode === "large" || mode === "hull2") return ["monster_ogre", "monster_demon1", "monster_shambler"];
  const aliases: Record<string, string> = {
    demon: "monster_demon1",
    dog: "monster_dog",
    knight: "monster_knight",
    ogre: "monster_ogre",
    shambler: "monster_shambler",
    soldier: "monster_army",
    wizard: "monster_wizard",
    zombie: "monster_zombie",
  };
  if (aliases[mode]) return [aliases[mode]];
  return /^monster_[a-z0-9_]+$/i.test(mode) ? [mode] : [];
}

function quakeDebugMonsterCameraStandoffPolicy(
  params: URLSearchParams,
): QuakeRenderCameraOriginPolicy | null {
  if (!import.meta.env.DEV) return null;
  const mode = params.get("debugMonsterCameraStandoff")?.trim().toLowerCase();
  if (!mode || mode === "0" || mode === "false" || mode === "off") return null;
  const classnames = quakeDebugMonsterClassnamesForMode(
    params,
    mode,
    "debugMonsterCameraStandoffClassnames",
    "debugMonsterCameraStandoffClasses",
  );
  if (!classnames.length) return null;
  const extraUnits = quakeUrlNumberParam(params, "debugMonsterCameraStandoffUnits", 0, 256) ?? 64;
  window.__cssQuakeDebugDomMetadata = true;
  return (origin, rotX, rotY) => quakeDebugMonsterCameraStandoffOrigin(
    origin,
    rotX,
    rotY,
    classnames,
    extraUnits,
  );
}

function quakeDebugMonsterClassnamesForMode(
  params: URLSearchParams,
  mode: string,
  explicitClassnamesKey: string,
  explicitClassesKey: string,
): string[] {
  const explicit = params.get(explicitClassnamesKey) ?? params.get(explicitClassesKey) ?? "";
  const explicitClassnames = explicit
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^monster_[a-z0-9_]+$/i.test(value));
  if (explicitClassnames.length) return [...new Set(explicitClassnames)];
  if (mode === "boss" || mode.startsWith("boss-")) return ["monster_boss"];
  if (mode === "large" || mode === "hull2") return ["monster_ogre", "monster_demon1", "monster_shambler"];
  const aliases: Record<string, string> = {
    demon: "monster_demon1",
    dog: "monster_dog",
    knight: "monster_knight",
    ogre: "monster_ogre",
    shambler: "monster_shambler",
    soldier: "monster_army",
    wizard: "monster_wizard",
    zombie: "monster_zombie",
  };
  if (aliases[mode]) return [aliases[mode]];
  return /^monster_[a-z0-9_]+$/i.test(mode) ? [mode] : [];
}

function quakeDebugMonsterCameraStandoffOrigin(
  origin: Vec3,
  rotX: number,
  rotY: number,
  classnames: readonly string[],
  extraUnits: number,
): Vec3 {
  const candidate = quakeDebugMonsterCameraStandoffCandidate(origin, rotX, rotY, classnames, extraUnits);
  if (!candidate) return origin;
  if (!quakeDebugMonsterCameraStandoffCandidateValid(origin, candidate.origin)) {
    markQuakeTrace("camera-standoff-blocked", {
      class: candidate.classname,
      distance: candidate.distance,
      entity: candidate.entityIndex,
      target: candidate.targetDistance,
    });
    return origin;
  }
  markQuakeTrace("camera-standoff-apply", {
    class: candidate.classname,
    distance: candidate.distance,
    dx: candidate.origin[0] - origin[0],
    dy: candidate.origin[1] - origin[1],
    entity: candidate.entityIndex,
    target: candidate.targetDistance,
  });
  return candidate.origin;
}

function quakeDebugMonsterCameraStandoffCandidate(
  origin: Vec3,
  rotX: number,
  rotY: number,
  classnames: readonly string[],
  extraUnits: number,
): {
  classname: string;
  distance: number;
  entityIndex: number | null;
  origin: Vec3;
  targetDistance: number;
} | null {
  let best: {
    classname: string;
    distance: number;
    entityIndex: number | null;
    origin: Vec3;
    pressure: number;
    targetDistance: number;
  } | null = null;
  const classSet = new Set(classnames);
  for (const element of document.querySelectorAll<HTMLElement>(".polycss-mesh.shootable.enemy")) {
    if (
      element.classList.contains("quake-shootable-prewarmed") ||
      element.classList.contains("quake-frame-hidden")
    ) {
      continue;
    }
    const classname = element.dataset.classname ?? "";
    if (!classSet.has(classname)) continue;
    const enemyOrigin = quakeDebugMonsterCameraStandoffMeshOrigin(element);
    if (!enemyOrigin) continue;
    const targetDistance = quakeDebugMonsterCameraStandoffDistance(classname, extraUnits);
    const dx = origin[0] - enemyOrigin[0];
    const dy = origin[1] - enemyOrigin[1];
    const distance = Math.hypot(dx, dy);
    const pressure = targetDistance - distance;
    if (pressure <= 0.001) continue;
    const away = distance > 0.0001
      ? [dx / distance, dy / distance]
      : quakeDebugMonsterCameraStandoffFallbackAway(rotX, rotY);
    const candidate: Vec3 = [
      enemyOrigin[0] + away[0] * targetDistance,
      enemyOrigin[1] + away[1] * targetDistance,
      origin[2],
    ];
    if (!best || pressure > best.pressure) {
      best = {
        classname,
        distance,
        entityIndex: quakeDebugMonsterCameraStandoffEntityIndex(element),
        origin: candidate,
        pressure,
        targetDistance,
      };
    }
  }
  return best;
}

function quakeDebugMonsterCameraStandoffMeshOrigin(element: HTMLElement): Vec3 | null {
  const x = Number(element.dataset.originX);
  const y = Number(element.dataset.originY);
  const z = Number(element.dataset.originZ);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? [x, y, z] : null;
}

function quakeDebugMonsterCameraStandoffEntityIndex(element: HTMLElement): number | null {
  const entityIndex = Number(element.dataset.entityIndex);
  return Number.isFinite(entityIndex) ? entityIndex : null;
}

function quakeDebugMonsterCameraStandoffDistance(classname: string, extraUnits: number): number {
  return (quakeDebugMonsterCameraStandoffBaseUnits(classname) + extraUnits) * QUAKE_COLLISION_UNIT_SCALE;
}

function quakeDebugMonsterCameraStandoffBaseUnits(classname: string): number {
  if (classname === "monster_boss") return 144;
  if (
    classname === "monster_ogre" ||
    classname === "monster_demon1" ||
    classname === "monster_shambler" ||
    classname === "monster_dog"
  ) {
    return 48;
  }
  return 32;
}

function quakeDebugMonsterCameraStandoffFallbackAway(rotX: number, rotY: number): [number, number] {
  const forward = forwardDirection(rotX, rotY);
  const length = Math.hypot(forward[0], forward[1]);
  return length > 0.0001 ? [-forward[0] / length, -forward[1] / length] : [1, 0];
}

function quakeDebugMonsterCameraStandoffCandidateValid(origin: Vec3, candidate: Vec3): boolean {
  if (!currentCollisionWorld) return false;
  if (currentCollisionWorld.contentsAt?.(candidate) === QUAKE_CONTENTS_SOLID) return false;
  const trace = currentCollisionWorld.traceUse?.(origin, candidate);
  if (trace && trace.fraction < 0.999) return false;
  const originLeaf = world.leafIndexAt(origin);
  const candidateLeaf = world.leafIndexAt(candidate);
  return originLeaf === null || candidateLeaf === null || originLeaf === candidateLeaf;
}

function createQuakeMultiplayerLocalClientId(): string {
  const override = new URLSearchParams(window.location.search).get("clientId")?.trim();
  if (override) return `client-${override.replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "debug"}`;
  const key = "cssquake.multiplayer.clientId";
  try {
    const existing = window.sessionStorage.getItem(key)?.trim();
    if (existing) return existing;
    const next = createQuakeMultiplayerClientId();
    window.sessionStorage.setItem(key, next);
    return next;
  } catch {
    return createQuakeMultiplayerClientId();
  }
}

function createQuakeMultiplayerClientId(): string {
  try {
    const values = new Uint32Array(2);
    globalThis.crypto?.getRandomValues(values);
    if (values[0] || values[1]) {
      return `client-${values[0].toString(36)}${values[1].toString(36)}`;
    }
  } catch {
    // Fall through to Math.random for debug-only transport identity.
  }
  return `client-${Math.random().toString(36).slice(2, 12)}`;
}

function quakeStorageValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setQuakeStorageValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage is optional; URL state still carries multiplayer identity.
  }
}

function sanitizeQuakeMultiplayerDisplayName(value: string | null | undefined): string {
  const name = (value ?? "").trim().replace(/\s+/g, " ").slice(0, 16);
  return name || "Player";
}

function defaultQuakeMultiplayerDisplayName(clientId: string): string {
  const suffix = clientId.replace(/^client-/i, "").replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase();
  return suffix ? `Player ${suffix}` : "Player";
}

function sanitizeQuakeMultiplayerRoomId(value: string | null | undefined): string {
  const roomId = (value ?? "").trim().replace(/[^a-z0-9_-]/gi, "").slice(0, 32);
  return /^cssquake-[a-z0-9]+$/i.test(roomId) ? "" : roomId;
}

function sanitizeQuakeMultiplayerColor(value: string | null | undefined): string {
  const color = (value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#d8893f";
}

function sanitizeQuakeMultiplayerInteger(
  value: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function defaultQuakeMultiplayerPartyHost(): string {
  const configuredHost = normalizeQuakePartySocketHost(
    (import.meta.env as { VITE_CSSQUAKE_PARTY_HOST?: string }).VITE_CSSQUAKE_PARTY_HOST,
  );
  if (configuredHost) return configuredHost;
  return normalizeQuakePartySocketHost(import.meta.env.DEV ? "localhost:1999" : window.location.host) ??
    window.location.host;
}

const cssQuakeVersionLabel = `v${__CSSQUAKE_VERSION__}`;
const QUAKE_LOADING_CONSOLE_INITIALIZED_LINE = `=== cssQuake ${cssQuakeVersionLabel} initialized ===`;

if (versionLabel) versionLabel.textContent = cssQuakeVersionLabel;

const QUAKE_JUMP_VELOCITY = 270 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_GRAVITY = 800 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_CONTENTS_SOLID = -2;
const QUAKE_MOBILE_MOVE_SPEED = 5.4 * QUAKE_RENDER_SUPERSAMPLE;
const QUAKE_DEBUG_FLY_SPEED = 10.8 * QUAKE_RENDER_SUPERSAMPLE;
const QUAKE_DEBUG_FLY_FAST_MULTIPLIER = 3;
const QUAKE_DEBUG_FLY_DT_CLAMP = 0.05;
const quakeCameraViewConfig = quakeInitialCameraViewConfig(QUAKE_RENDER_SUPERSAMPLE);
const QUAKE_MENU_ENABLED = true;
const QUAKE_MONSTER_RUNTIME_ENABLED = true;
const QUAKE_MONSTER_MOUNT_VIEW_DOT_MIN = -0.1;
const quakeStartupUrlParams = new URLSearchParams(window.location.search);
const quakeDebugMonsterMotionMaterial = quakeDebugMonsterMotionMaterialPolicy(quakeStartupUrlParams);
const quakeDebugMonsterPlayerClearance = quakeDebugMonsterPlayerClearancePolicy(quakeStartupUrlParams);
const quakeDebugMonsterCameraStandoff = quakeDebugMonsterCameraStandoffPolicy(quakeStartupUrlParams);
const quakeAssetCatalog = createQuakeAssetCatalogFlow({
  levelList,
  mountBitmapText: mountQuakeBitmapText,
});
let quakeEnemiesDisabled = quakeUrlBoolean("disableEnemies") || (disableEnemiesOption?.checked ?? false);
let quakeDamageDisabled = quakeUrlBoolean("disableDamage") || (disableDamageOption?.checked ?? false);
let quakeEnemiesFrozen = quakeUrlBoolean("freezeEnemies") || (debugFreezeEnemiesOption?.checked ?? false);
let quakeAttacksDisabled = quakeUrlBoolean("disableAttacks") || (debugDisableAttacksOption?.checked ?? false);
const quakeDebugPointerTraceConsole = quakeUrlBoolean("debugPointer");
const quakeDebugRecordingPanelEnabled = quakeUrlBoolean("debugRecording");
const quakeInitialDebugFlyMode = quakeUrlBoolean("debugFly") || (debugFlyModeOption?.checked ?? false);
if (debugRecordingRow) debugRecordingRow.hidden = !quakeDebugRecordingPanelEnabled;
const quakeMultiplayerCompactInvite = parseQuakeMultiplayerCompactInvite(
  quakeStartupUrlParams.get("room"),
  quakeMultiplayerMapNameForCompactMapCode,
);
const quakeDebugMultiplayerMode = quakeStartupUrlParams.get("debugMultiplayer");
const quakeMultiplayerMode = quakeStartupUrlParams.get("multiplayer") ?? (quakeMultiplayerCompactInvite ? "party" : null);
const QUAKE_MULTIPLAYER_DEBUG_REQUESTED = import.meta.env.DEV && quakeDebugMultiplayerMode !== null;
const QUAKE_MULTIPLAYER_ENABLED = quakeMultiplayerMode !== null || QUAKE_MULTIPLAYER_DEBUG_REQUESTED;
const QUAKE_MULTIPLAYER_MENU_ENABLED = true;
const QUAKE_MULTIPLAYER_DEBUG_POSE_ONLY = QUAKE_MULTIPLAYER_DEBUG_REQUESTED &&
  quakeUrlBoolean("debugMultiplayerPoseOnly");
const QUAKE_MULTIPLAYER_DEBUG_INPUT_PAUSED = QUAKE_MULTIPLAYER_DEBUG_REQUESTED &&
  quakeUrlBoolean("debugMultiplayerInputPaused");
const QUAKE_MULTIPLAYER_DEFAULT_FRAG_LIMIT = 20;
const QUAKE_MULTIPLAYER_DEFAULT_MAX_PLAYERS = QUAKE_MULTIPLAYER_MAX_PLAYERS_CAP;
const QUAKE_MULTIPLAYER_TRANSPORT =
  quakeMultiplayerMode === "loopback" ||
    (quakeMultiplayerMode === null && QUAKE_MULTIPLAYER_DEBUG_REQUESTED && quakeDebugMultiplayerMode !== "party")
    ? "loopback"
    : "party";
const quakeMultiplayerPartyHostOverride = normalizeQuakePartySocketHost(quakeStartupUrlParams.get("partyHost"));
const QUAKE_MULTIPLAYER_PARTY_HOST = quakeMultiplayerPartyHostOverride ?? defaultQuakeMultiplayerPartyHost();
const QUAKE_MULTIPLAYER_REGION = quakeMultiplayerCompactInvite?.region ??
  normalizeQuakeMultiplayerRegion(quakeStorageValue("cssquake.multiplayer.region"));
const QUAKE_MULTIPLAYER_ROOM_ID = quakeMultiplayerCompactInvite?.roomId ??
  (QUAKE_MULTIPLAYER_DEBUG_REQUESTED ? sanitizeQuakeMultiplayerRoomId(quakeStartupUrlParams.get("room")) : "");
const QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID = QUAKE_MULTIPLAYER_ENABLED
  ? createQuakeMultiplayerLocalClientId()
  : "local";
const QUAKE_MULTIPLAYER_LOCAL_DISPLAY_NAME = sanitizeQuakeMultiplayerDisplayName(
  quakeStartupUrlParams.get("player") ??
    quakeStorageValue("cssquake.multiplayer.name") ??
    defaultQuakeMultiplayerDisplayName(QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID),
);
const QUAKE_MULTIPLAYER_LOCAL_COLOR = sanitizeQuakeMultiplayerColor(
  quakeStartupUrlParams.get("color") ?? quakeStorageValue("cssquake.multiplayer.color"),
);
const QUAKE_MULTIPLAYER_FRAG_LIMIT = sanitizeQuakeMultiplayerInteger(
  quakeStartupUrlParams.get("fraglimit"),
  QUAKE_MULTIPLAYER_DEFAULT_FRAG_LIMIT,
  1,
  100,
);
const QUAKE_MULTIPLAYER_MAX_PLAYERS = sanitizeQuakeMultiplayerInteger(
  quakeStartupUrlParams.get("maxPlayers"),
  QUAKE_MULTIPLAYER_DEFAULT_MAX_PLAYERS,
  2,
  QUAKE_MULTIPLAYER_MAX_PLAYERS_CAP,
);
const QUAKE_MULTIPLAYER_LOOPBACK_REMOTE_CLIENT_ID = "loopback-remote";
const QUAKE_MULTIPLAYER_LOOPBACK_REMOTE_PLAYER_ID = "loopback:remote";
const QUAKE_MULTIPLAYER_INPUT_SAMPLE_MS = 50;
const QUAKE_MULTIPLAYER_POSE_SAMPLE_MS = 50;
const QUAKE_MULTIPLAYER_HARD_CORRECTION_DISTANCE = 4096 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_SOFT_CORRECTION_DISTANCE = 2048 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_MAX_BLEND_CORRECTION_DISTANCE = 64 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_MULTIPLAYER_REMOTE_MODEL_PATHS = ["progs/player.mdl"] as const;
const QUAKE_MULTIPLAYER_REMOTE_DEFAULT_FRAME = "stand1";
const QUAKE_MULTIPLAYER_REMOTE_RUN_FRAME_PREFIX = "rockrun";
const QUAKE_MULTIPLAYER_REMOTE_PAIN_FRAME_PREFIX = "pain";
const QUAKE_MULTIPLAYER_REMOTE_DEATH_FRAME_PREFIX = "deatha";
const QUAKE_MULTIPLAYER_REMOTE_RUN_FPS = 10;
const QUAKE_MULTIPLAYER_REMOTE_PAIN_FPS = 10;
const QUAKE_MULTIPLAYER_REMOTE_DEATH_FPS = 10;
const QUAKE_MULTIPLAYER_REMOTE_RUN_SPEED_THRESHOLD = QUAKE_PMOVE_FORWARD_SPEED * 0.1;
const QUAKE_MULTIPLAYER_REMOTE_PLAYER_EYE_HEIGHT = QUAKE_PLAYER_VIEW_Z - QUAKE_PLAYER_MINS_Z;
const QUAKE_MULTIPLAYER_REMOTE_FALLBACK_ROT_Y_OFFSET = 45;
const quakeMultiplayerScoreboard = QUAKE_MULTIPLAYER_ENABLED && quakeHud
  ? mountQuakeMultiplayerScoreboard(quakeHud)
  : null;
let quakeInvertMouse = invertMouseOption?.checked ?? false;
let quakeAlwaysRun = alwaysRunOption?.checked ?? true;
let quakeShowGun = showGunOption?.checked ?? true;
let quakeDynamicLighting = dynamicLightingOption?.checked ?? true;
let quakeImpactParticles = impactParticlesOption?.checked ?? true;
let quakeMultiplayerSpectating = false;
let quakeMultiplayerSpectatorFollowedPlayerId: string | null = null;
let quakeMultiplayerSpectatorCenterPrint = "";
let quakeMultiplayerSpectatorCount = 0;

function installInspectableQuakePolycssCamera(
  sceneHandle: { applyCamera(): void },
  cameraElement: HTMLElement,
): void {
  const applyCamera = sceneHandle.applyCamera.bind(sceneHandle);
  sceneHandle.applyCamera = () => {
    applyCamera();
    stripQuakePolycssCameraDataAttributes(cameraElement);
  };
  stripQuakePolycssCameraDataAttributes(cameraElement);
}

function stripQuakePolycssCameraDataAttributes(cameraElement: HTMLElement): void {
  for (const attribute of Array.from(cameraElement.attributes)) {
    if (attribute.name.startsWith("data-polycss-camera-")) {
      cameraElement.removeAttribute(attribute.name);
    }
  }
}

function quakeUrlRouteFromLocation(): QuakeUrlRoute {
  return quakeRoute.routeFromLocation();
}

function updateQuakeUrl(mapName: string, mode: QuakeUrlUpdateMode, view: QuakeCssView | null = null): void {
  quakeRoute.updateUrl(mapName, mode, view);
}

function clearQuakeGameRoute(): void {
  quakeRoute.clearGameRoute();
}

function clearQuakeDebugUrlParams(): void {
  quakeRoute.clearDebugUrlParams();
}

function quakeUrlFor(mapName: string, view: QuakeCssView | null = null): URL {
  return quakeRoute.urlFor(mapName, view);
}

function currentQuakeCssView(): QuakeCssView {
  const origin = controls.getOrigin();
  return {
    origin: [origin[0], origin[1], origin[2]],
    rotX: scene.camera.state.rotX ?? 88,
    rotY: scene.camera.state.rotY ?? 270,
  };
}

function shouldSpawnQuakeShootableForCurrentMode(entity: QuakeEntity): boolean {
  if (QUAKE_MULTIPLAYER_ENABLED && entity.classname.startsWith("monster_")) return false;
  return shouldSpawnQuakeEntityForCurrentGame(entity);
}

function currentQuakeViewUrl(): string {
  return quakeRoute.currentViewUrl();
}

async function copyCurrentQuakeViewUrl(): Promise<string> {
  const url = currentQuakeViewUrl();
  await navigator.clipboard?.writeText(url);
  return url;
}

function setQuakeAssetManifest(manifest: QuakeAssetManifest): void {
  quakeAssetCatalog.setManifest(manifest, { renderBitmapText: true });
  mountQuakeMultiplayerMapSelector();
  mountQuakeMultiplayerRegionSelector();
  syncQuakeMultiplayerControlGlyph(multiplayerMapSelect);
  syncQuakeMultiplayerControlGlyph(multiplayerRegionSelect);
  menu.setCurrentLevel(currentMapName);
}

interface QuakeMultiplayerMenuState {
  mapName: string;
  region: QuakeMultiplayerRegionId;
  roomId: string;
  displayName: string;
  color: string;
  fragLimit: number;
  maxPlayers: number;
}

interface QuakeMultiplayerRoomRejectRecord {
  code: QuakeMultiplayerRoomRejectPayload["code"];
  message: string;
  recoverable: boolean;
  rejectedMessageId?: string;
  retryAfterMs?: number;
  details?: Record<string, unknown>;
}

interface QuakeMultiplayerRoomErrorRecord {
  code: string;
  message: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
}

function mountQuakeMultiplayerMapSelector(): void {
  if (!multiplayerMapSelect) return;
  const selectedMapName = multiplayerMapSelect.value || currentMapName;
  multiplayerMapSelect.replaceChildren();
  for (const level of quakeAssetCatalog.selectableLevels()) {
    const option = document.createElement("option");
    option.value = level.mapName;
    option.textContent = `${level.mapName.toUpperCase()} ${quakeAssetCatalog.mapTitle(level)}`;
    multiplayerMapSelect.append(option);
  }
  multiplayerMapSelect.value = quakeAssetCatalog.sceneUrl(selectedMapName) ? selectedMapName : currentMapName;
}

function mountQuakeMultiplayerRegionSelector(): void {
  if (!multiplayerRegionSelect) return;
  const selectedRegion = normalizeQuakeMultiplayerRegion(multiplayerRegionSelect.value || QUAKE_MULTIPLAYER_REGION);
  multiplayerRegionSelect.replaceChildren();
  for (const region of QUAKE_MULTIPLAYER_REGIONS) {
    const option = document.createElement("option");
    option.value = region.id;
    option.textContent = region.label;
    multiplayerRegionSelect.append(option);
  }
  multiplayerRegionSelect.value = selectedRegion;
}

function syncQuakeMultiplayerMenu(): void {
  mountQuakeMultiplayerMapSelector();
  mountQuakeMultiplayerRegionSelector();
  if (multiplayerNameInput) multiplayerNameInput.value = QUAKE_MULTIPLAYER_LOCAL_DISPLAY_NAME;
  if (multiplayerColorInput) multiplayerColorInput.value = QUAKE_MULTIPLAYER_LOCAL_COLOR;
  if (multiplayerMapSelect) multiplayerMapSelect.value = currentMapName;
  if (multiplayerRegionSelect) multiplayerRegionSelect.value = QUAKE_MULTIPLAYER_REGION;
  if (multiplayerFragLimitInput) multiplayerFragLimitInput.value = String(QUAKE_MULTIPLAYER_FRAG_LIMIT);
  if (multiplayerMaxPlayersInput) multiplayerMaxPlayersInput.value = String(QUAKE_MULTIPLAYER_MAX_PLAYERS);
  syncQuakeMultiplayerControlGlyphs();
}

let quakeMultiplayerGeneratedMenuRoom: {
  mapName: string;
  region: QuakeMultiplayerRegionId;
  roomId: string;
} | null = null;

function quakeMultiplayerMenuRoomId(
  mapName: string,
  region: QuakeMultiplayerRegionId,
  forceNew: boolean,
): string {
  if (
    !forceNew &&
    QUAKE_MULTIPLAYER_ROOM_ID &&
    mapName === currentMapName &&
    region === QUAKE_MULTIPLAYER_REGION
  ) {
    return QUAKE_MULTIPLAYER_ROOM_ID;
  }
  if (
    !forceNew &&
    quakeMultiplayerGeneratedMenuRoom?.mapName === mapName &&
    quakeMultiplayerGeneratedMenuRoom.region === region
  ) {
    return quakeMultiplayerGeneratedMenuRoom.roomId;
  }
  const roomId = createQuakeMultiplayerRoomSlug(mapName, region);
  quakeMultiplayerGeneratedMenuRoom = { mapName, region, roomId };
  return roomId;
}

function readQuakeMultiplayerMenuState(createRoom: boolean): QuakeMultiplayerMenuState {
  const selectedMapName = multiplayerMapSelect?.value.trim().toLowerCase() ?? "";
  const mapName = selectedMapName && quakeAssetCatalog.mapExists(selectedMapName) ? selectedMapName : currentMapName;
  const region = normalizeQuakeMultiplayerRegion(multiplayerRegionSelect?.value ?? QUAKE_MULTIPLAYER_REGION);
  const roomId = quakeMultiplayerMenuRoomId(mapName, region, createRoom);
  return {
    mapName,
    region,
    roomId,
    displayName: sanitizeQuakeMultiplayerDisplayName(multiplayerNameInput?.value),
    color: sanitizeQuakeMultiplayerColor(multiplayerColorInput?.value),
    fragLimit: sanitizeQuakeMultiplayerInteger(
      multiplayerFragLimitInput?.value,
      QUAKE_MULTIPLAYER_DEFAULT_FRAG_LIMIT,
      1,
      100,
    ),
    maxPlayers: sanitizeQuakeMultiplayerInteger(
      multiplayerMaxPlayersInput?.value,
      QUAKE_MULTIPLAYER_DEFAULT_MAX_PLAYERS,
      2,
      QUAKE_MULTIPLAYER_MAX_PLAYERS_CAP,
    ),
  };
}

function createQuakeMultiplayerRoomSlug(
  mapName: string,
  region: QuakeMultiplayerRegionId = QUAKE_MULTIPLAYER_REGION,
): string {
  const suffix = createQuakeMultiplayerRoomToken(QUAKE_MULTIPLAYER_ROOM_TOKEN_LENGTH);
  return sanitizeQuakeMultiplayerRoomId(createQuakeMultiplayerRoomIdFromToken(mapName, suffix, region)) ||
    `cssquake-${createQuakeMultiplayerRoomToken(QUAKE_MULTIPLAYER_ROOM_TOKEN_LENGTH + 2)}`;
}

function createQuakeMultiplayerRoomToken(length: number): string {
  try {
    const values = new Uint8Array(length);
    globalThis.crypto?.getRandomValues(values);
    if (values.some((value) => value !== 0)) {
      return Array.from(
        values,
        (value) => QUAKE_MULTIPLAYER_ROOM_TOKEN_ALPHABET[value % QUAKE_MULTIPLAYER_ROOM_TOKEN_ALPHABET.length],
      ).join("");
    }
  } catch {
    // Fall through to Math.random for menu-only invite token generation.
  }
  let token = "";
  for (let index = 0; index < length; index++) {
    token += QUAKE_MULTIPLAYER_ROOM_TOKEN_ALPHABET[
      Math.floor(Math.random() * QUAKE_MULTIPLAYER_ROOM_TOKEN_ALPHABET.length)
    ] ?? "q";
  }
  return token;
}

const quakeMultiplayerFallbackRoomIds = new Map<string, string>();

function quakeMultiplayerFallbackRoomId(
  mapName: string,
  region: QuakeMultiplayerRegionId = QUAKE_MULTIPLAYER_REGION,
): string {
  const key = `${region}:${mapName}`;
  const cached = quakeMultiplayerFallbackRoomIds.get(key);
  if (cached) return cached;
  const roomId = createQuakeMultiplayerRoomSlug(mapName, region);
  quakeMultiplayerFallbackRoomIds.set(key, roomId);
  return roomId;
}

interface QuakeMultiplayerCompactInvite {
  mapName: string;
  region: QuakeMultiplayerRegionId;
  roomId: string;
  token: string;
}

function parseQuakeMultiplayerCompactInvite(
  value: string | null | undefined,
  mapNameForInvite: (mapCode: string) => string | null,
): QuakeMultiplayerCompactInvite | null {
  const invite = parseQuakeMultiplayerCompactInviteParts(value);
  if (!invite) return null;
  const mapName = mapNameForInvite(invite.mapCode);
  if (!mapName || !quakeAssetCatalog.mapExists(mapName)) return null;
  const roomId = createQuakeMultiplayerRoomIdFromToken(mapName, invite.token, invite.region);
  if (!roomId) return null;
  return {
    mapName,
    region: invite.region,
    roomId,
    token: invite.token,
  };
}

function quakeMultiplayerCompactMapNames(): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const level of quakeAssetCatalog.selectableLevels()) {
    const mapName = level.mapName.trim().toLowerCase();
    if (!mapName || seen.has(mapName)) continue;
    seen.add(mapName);
    names.push(mapName);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

function quakeMultiplayerMapCodeForMapName(mapName: string): string | null {
  const normalizedMapName = mapName.trim().toLowerCase();
  const mapIndex = quakeMultiplayerCompactMapNames().indexOf(normalizedMapName);
  if (mapIndex < 0 || mapIndex >= QUAKE_MULTIPLAYER_COMPACT_MAP_CODE_CAPACITY) return null;
  return mapIndex.toString(36).padStart(QUAKE_MULTIPLAYER_COMPACT_MAP_CODE_LENGTH, "0");
}

function quakeMultiplayerMapNameForCompactMapCode(mapCode: string): string | null {
  const mapIndex = Number.parseInt(mapCode, 36);
  if (!Number.isInteger(mapIndex) || mapIndex < 0 || mapIndex >= QUAKE_MULTIPLAYER_COMPACT_MAP_CODE_CAPACITY) {
    return null;
  }
  return quakeMultiplayerCompactMapNames()[mapIndex] ?? null;
}

function quakeMultiplayerMapNameForCompactInvite(inviteId: string): string | null {
  const invite = parseQuakeMultiplayerCompactInviteParts(inviteId);
  return invite ? quakeMultiplayerMapNameForCompactMapCode(invite.mapCode) : null;
}

function quakeMultiplayerCompactInviteForMenuState(state: QuakeMultiplayerMenuState): string {
  const mapCode = quakeMultiplayerMapCodeForMapName(state.mapName) ?? "00";
  const prefix = `cssquake-${state.region}-${state.mapName}-`;
  const token = state.roomId.startsWith(prefix) ? state.roomId.slice(prefix.length) : state.roomId;
  const safeToken = QUAKE_MULTIPLAYER_ROOM_TOKEN_PATTERN.test(token)
    ? token.toLowerCase()
    : createQuakeMultiplayerRoomToken(QUAKE_MULTIPLAYER_ROOM_TOKEN_LENGTH);
  return createQuakeMultiplayerCompactInviteValue(mapCode, safeToken, state.region) ??
    `${mapCode}${safeToken}${quakeMultiplayerRegionInviteCode(state.region)}`;
}

function quakeMultiplayerUrlForMenuState(state: QuakeMultiplayerMenuState): URL {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", quakeMultiplayerCompactInviteForMenuState(state));
  return url;
}

function persistQuakeMultiplayerMenuState(state: QuakeMultiplayerMenuState): void {
  setQuakeStorageValue("cssquake.multiplayer.name", state.displayName);
  setQuakeStorageValue("cssquake.multiplayer.color", state.color);
  setQuakeStorageValue("cssquake.multiplayer.region", state.region);
}

function startQuakeMultiplayerFromMenu(): void {
  if (!QUAKE_MULTIPLAYER_MENU_ENABLED) return;
  const state = readQuakeMultiplayerMenuState(true);
  persistQuakeMultiplayerMenuState(state);
  const url = quakeMultiplayerUrlForMenuState(state);
  window.location.assign(url.toString());
}

type QuakeMultiplayerGlyphControl = HTMLInputElement | HTMLSelectElement;

function quakeMultiplayerGlyphControls(): QuakeMultiplayerGlyphControl[] {
  return [
    multiplayerNameInput,
    multiplayerMapSelect,
    multiplayerRegionSelect,
    multiplayerFragLimitInput,
    multiplayerMaxPlayersInput,
  ].filter((control): control is QuakeMultiplayerGlyphControl => Boolean(control));
}

function syncQuakeMultiplayerControlGlyphs(): void {
  for (const control of quakeMultiplayerGlyphControls()) syncQuakeMultiplayerControlGlyph(control);
}

function syncQuakeMultiplayerControlGlyph(control: QuakeMultiplayerGlyphControl | null): void {
  if (!control) return;
  const glyph = control.parentElement?.querySelector<HTMLElement>(".quake-multiplayer-control-glyph");
  if (!glyph) return;
  glyph.textContent = quakeMultiplayerControlGlyphText(control);
  glyph.classList.add("quake-bm-label", "quake-bm-alt");
  mountQuakeBitmapText(glyph);
}

function quakeMultiplayerControlGlyphText(control: QuakeMultiplayerGlyphControl): string {
  if (control instanceof HTMLSelectElement) {
    return control.selectedOptions[0]?.textContent?.trim() || control.value;
  }
  return control.value;
}

function handleQuakeMultiplayerControlGlyphInput(event: Event): void {
  const control = event.currentTarget;
  if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
    syncQuakeMultiplayerControlGlyph(control);
  }
}

function attachQuakeMultiplayerControlGlyphs(): void {
  for (const control of quakeMultiplayerGlyphControls()) {
    control.addEventListener("input", handleQuakeMultiplayerControlGlyphInput);
    control.addEventListener("change", handleQuakeMultiplayerControlGlyphInput);
  }
}

function disposeQuakeMultiplayerControlGlyphs(): void {
  for (const control of quakeMultiplayerGlyphControls()) {
    control.removeEventListener("input", handleQuakeMultiplayerControlGlyphInput);
    control.removeEventListener("change", handleQuakeMultiplayerControlGlyphInput);
  }
}

function handleQuakeMultiplayerFormSubmit(event: SubmitEvent): void {
  event.preventDefault();
  event.stopPropagation();
  startQuakeMultiplayerFromMenu();
}

injectQuakeWorldAnimations();
quakeAssetCatalog.mountLevelSelector();

const camera = createPolyPerspectiveCamera({
  perspective: quakeCameraViewConfig.perspective,
  zoom: quakeCameraViewConfig.zoom,
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
  textureLeafSizing: "raster",
  textureBackend: "atlas",
  textureProjection: "affine",
  autoCenter: false,
});
const host = scene.cameraEl as HTMLElement;
if (quakeSceneRoot) {
  quakeSceneRoot.appendChild(host);
} else {
  quakeApp.insertBefore(host, weapon ?? quakeMenu);
}
host.tabIndex = 0;
installInspectableQuakePolycssCamera(scene, host);
// PolyCSS controls read scene.host when they are created; keep that target on the inspectable camera node.
(scene as unknown as { host: HTMLElement }).host = host;
const sceneElement = scene.sceneElement;
sceneElement.removeAttribute("data-polycss-lighting");
let quakeCameraFeedback!: QuakeCameraFeedbackFlow;
const quakeCameraView = createQuakeCameraViewFlow({
  cameraFeedback: () => quakeCameraFeedback,
  getPlayerOrigin: () => getPlayer().currentOrigin(),
  host,
  modelPivot: () => quakeModelPivot,
  playerEyeHeight: () => getPlayer().eyeHeight(),
  playerSpawn: (spawn) => getPlayer().spawn(spawn),
  renderSupersample: QUAKE_RENDER_SUPERSAMPLE,
  scene,
  sceneElement,
  setCameraLookEnabledBodyClass: (enabled) => setQuakeBodyClass("quake-camera-look-enabled", enabled),
  syncCrosshairTarget: syncQuakeCrosshairTarget,
  syncShootablesVisibility: (origin, force) => shootables.syncVisibility(origin, force),
  syncViewmodelTransform: () => viewmodel.syncTransform(),
  syncWorldVisibility: (force) => world.syncVisibility(force),
});
const quakeRemotePlayers = createQuakeMultiplayerRemotePlayerPresenter({
  localClientId: QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID,
  createVisual: createQuakeRemotePlayerVisual,
  shouldRenderPlayer: (playerState) => playerState.playerId !== quakeMultiplayerSpectatorFollowedPlayerId,
  now: () => Date.now(),
});
const quakeLoopbackTrustedSceneMovement = {
  collisionWorld: {
    contentsAt: (point: Vec3) => currentCollisionWorld?.contentsAt?.(point) ?? null,
    floorAt: (x: number, y: number, maxZ?: number, minZ?: number) =>
      currentCollisionWorld?.floorAt(x, y, maxZ, minZ) ?? null,
    resolve: (
      origin: [number, number, number],
      previous: [number, number, number],
      eyeHeight: number,
      currentGroundZ: number,
      forceAir?: boolean,
    ) =>
      currentCollisionWorld?.resolve(origin, previous, eyeHeight, currentGroundZ, forceAir) ?? {
        origin,
        groundZ: currentGroundZ,
        grounded: false,
        touches: [],
      },
    traceUse: (start: Vec3, end: Vec3) => currentCollisionWorld?.traceUse?.(start, end) ?? null,
  },
  playerEyeHeight: QUAKE_PLAYER_VIEW_Z,
};
const quakeMultiplayerSession = QUAKE_MULTIPLAYER_ENABLED
  ? QUAKE_MULTIPLAYER_TRANSPORT === "party"
    ? createQuakePartySocketMultiplayerSession({
      host: QUAKE_MULTIPLAYER_PARTY_HOST,
      roomId: ({ roomKey }) => quakeMultiplayerRoomId(roomKey),
      now: () => Date.now(),
      query: {
        region: QUAKE_MULTIPLAYER_REGION,
      },
    })
    : createQuakeLoopbackMultiplayerSession({
        now: () => Date.now(),
        includeDefaultSimulatedPlayer: true,
        simulatedPlayers: quakeLoopbackSimulatedPlayers,
        trustedSceneMovement: quakeLoopbackTrustedSceneMovement,
        trustedWorldDefinitions: quakeLoopbackTrustedWorldDefinitions,
      })
  : createQuakeNoopMultiplayerSession();
const disposeQuakeMultiplayerMessages = quakeMultiplayerSession.subscribe((message) => {
  handleQuakeMultiplayerRoomMessage(message);
});
quakeCameraView.syncViewportProjection();
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
quakeCameraView.setFirstPersonControlsMounted(true);
const updateQuakeControls = controls.update.bind(controls);
controls.update = (partial) => {
  updateQuakeControls(partial);
  if (partial.lookEnabled !== undefined) quakeCameraView.setLookEnabled(partial.lookEnabled);
  quakeCameraView.compactCameraInlineStyle();
};
quakeCameraView.compactCameraInlineStyle();
let quakePlayerDead = false;

type QuakePickupControllerHandle = ReturnType<typeof createQuakePickupController>;
type QuakePlayerControllerHandle = ReturnType<typeof createQuakePlayerController>;

let pickups: QuakePickupControllerHandle | null = null;
let player: QuakePlayerControllerHandle | null = null;
let quakeRuntimePickupSerial = 0;

function getPickups(): QuakePickupControllerHandle {
  if (!pickups) throw new Error("Quake pickup controller is not initialized.");
  return pickups;
}

function getPlayer(): QuakePlayerControllerHandle {
  if (!player) throw new Error("Quake player controller is not initialized.");
  return player;
}

let quakeMoverInteractions!: QuakeMoverInteractionFlow;
let quakeTextPresentation!: QuakeTextPresentationFlow;
let quakeWeaponPresentation!: QuakeWeaponPresentationFlow;
let quakeCrosshairInteraction: QuakeCrosshairInteractionFlow | null = null;
let quakeEntityActivation!: QuakeEntityActivationFlow;
let quakePlayerLifecycle!: QuakePlayerLifecycleFlow;
let quakePointerGameplay!: ReturnType<typeof createQuakePointerGameplayFlow>;
const quakeGameplayInput = createQuakeGameplayInputFlow({
  canUseGameplayInput: canUseQuakeGameplayInput,
  clearMobileLookInput: () => quakePointerGameplay.clearMobileLookInput(),
  clearMobileMoveInput: () => quakePointerGameplay.clearMobileMoveInput(),
  debugFlyEnabled: () => quakeDebugFly.isEnabled(),
  player: () => player,
});

const quakeDebugFly = createQuakeDebugFlyController({
  canUseInput: canUseQuakeGameplayInput,
  cameraRotation: () => ({
    rotX: scene.camera.state.rotX ?? 88,
    rotY: scene.camera.state.rotY ?? 270,
  }),
  clearCrouchInput: quakeGameplayInput.clearCrouchInput,
  clearMoveInput: quakeGameplayInput.clearMoveInput,
  controlsOrigin: () => controls.getOrigin(),
  crouchKeyCodes: quakeGameplayInput.crouchKeyCodes,
  dtClamp: QUAKE_DEBUG_FLY_DT_CLAMP,
  fastMultiplier: QUAKE_DEBUG_FLY_FAST_MULTIPLIER,
  initialEnabled: quakeInitialDebugFlyMode,
  isDisposed: () => quakeAppDisposed,
  isEditableTarget: quakeGameplayInput.isEditableTarget,
  jumpVelocity: QUAKE_JUMP_VELOCITY,
  moveKeyCodes: quakeGameplayInput.moveKeyCodes,
  onDisabledAfterActive: respawnQuakePlayerFromFlyMode,
  setBodyClass: setQuakeBodyClass,
  setDebugOrigin: (origin) => getPlayer().setDebugOrigin(origin),
  speed: QUAKE_DEBUG_FLY_SPEED,
  syncOption: (enabled) => {
    if (debugFlyModeOption) debugFlyModeOption.checked = enabled;
  },
  syncView: quakeCameraView.syncDebugFlyView,
  updateControls: (partial) => controls.update(partial),
  viewForward: forwardDirection,
});

const world = createQuakeWorldController({
  applyMoverLeafTransform: (leaf) => quakeMoverInteractions.applyLeafTransform(leaf),
  getOrigin: () => controls.getOrigin(),
  sceneElement,
  syncButtonLeafVisual: (leaf) => quakeMoverInteractions.syncButtonLeafVisual(leaf),
  syncPickupsVisibility: (origin) => getPickups().syncVisibility(origin),
});
const quakeEntityMeshes = createQuakeEntityMeshMountFlow({
  pixelate: (handle) => world.pixelate(handle),
  pointToPoly: quakeCameraView.pointToPoly,
  scene,
  sceneElement,
  schedulePresentationResync: (handle) => world.schedulePresentationResync(handle),
});

function quakeShootablePrewarmLeavesAt(origin: [number, number, number]): Set<number> | null {
  const visibility = currentResult?.visibility;
  const visibleLeaves = visibility?.visibleLeavesAt(origin) ?? null;
  const metadata = visibility?.metadata;
  if (!visibility || !metadata || !visibleLeaves) return visibleLeaves;
  const leafIndex = visibility.leafIndexAt(origin);
  const leaf = metadata.leaves[leafIndex];
  if (!leaf) return visibleLeaves;
  const prewarmLeaves = new Set(visibleLeaves);
  for (const adjacentLeafIndex of leaf.adjacentLeafIndexes) {
    const adjacentLeaf = metadata.leaves[adjacentLeafIndex];
    if (!adjacentLeaf) continue;
    prewarmLeaves.add(adjacentLeafIndex);
    for (const visibleLeafIndex of adjacentLeaf.visibleLeafIndexes ?? []) {
      prewarmLeaves.add(visibleLeafIndex);
    }
  }
  for (const mover of movers.debugStats().movers) {
    if (mover.kind === "button" || mover.mode === "closed") continue;
    const modelIndex = entityByIndex.get(mover.entityIndex)?.modelIndex;
    if (modelIndex === undefined) continue;
    for (const moverLeaf of world.modelLeaves(modelIndex)) {
      const leaf = metadata.leaves[moverLeaf.leafIndex];
      if (!leaf) continue;
      prewarmLeaves.add(moverLeaf.leafIndex);
      for (const visibleLeafIndex of leaf.visibleLeafIndexes ?? []) {
        prewarmLeaves.add(visibleLeafIndex);
      }
    }
  }
  return prewarmLeaves;
}

const menu = createQuakeMenuController({
  enabled: QUAKE_MENU_ENABLED,
  host,
  controls,
  mainMenu,
  mainMenuArt,
  singlePlayerPanel,
  multiplayerPanel,
  levelPanel,
  aboutPanel,
  optionsPanel,
  onSelectNewGame: startQuakeNewGame,
  onShowMultiplayer: syncQuakeMultiplayerMenu,
  onLoadGame: () => quakeSaveSession.load(),
  onSaveGame: () => quakeSaveSession.save(),
  onSelectLevel: loadQuakeMap,
  onSelectQuit: quitQuakeToMainMenu,
  canLoadGame: () => quakeSaveSession.canLoad(),
  canSaveGame: () => quakeSaveSession.canSave(),
  isMultiplayerEnabled: () => QUAKE_MULTIPLAYER_MENU_ENABLED,
  isQuitEnabled: () => quakeGameplayStarted,
  onMenuVisibilityChange: handleQuakeMenuVisibilityChange,
  onMenuPauseChange: setQuakeMenuPauseState,
  onResumeMainMenuFromEscape: suppressQuakeMainMenuOnResumeControlsEnd,
  shouldResumeMainMenuOnEscape: shouldResumeQuakeMainMenuOnEscape,
  shouldOpenMainMenuOnControlsEnd: shouldOpenQuakeMainMenuOnControlsEnd,
  clearCrosshairTarget: clearQuakeCrosshairTarget,
  syncCrosshairTarget: syncQuakeCrosshairTarget,
});
const quakeRoute = createQuakeRouteFlow<QuakeCssView>({
  applyView: applyQuakeUrlView,
  clearStartupState: clearQuakeMainMenuStartupState,
  currentMapName: () => currentMapName,
  currentView: currentQuakeCssView,
  hasCurrentScene: () => currentResult !== null,
  hideMainMenu: () => menu.hideMainMenu(),
  isDisposed: () => quakeAppDisposed,
  isLoading: () => quakeAppLoading,
  loadMap: loadQuakeMap,
  mapExists: quakeAssetCatalog.mapExists,
  menuEnabled: QUAKE_MENU_ENABLED,
  compactMultiplayerInviteMapName: quakeMultiplayerMapNameForCompactInvite,
  setAssetsRegenerating: setQuakeAssetsRegenerating,
  setGameplayStarted: setQuakeGameplayStarted,
  setLoadingError: setQuakeLoadingError,
  showMainMenu: () => menu.showMainMenu(),
  startMap: quakeAssetCatalog.startMap,
  viewFromUrlView: quakeCameraView.cssViewFromUrlView,
  viewToUrlView: quakeCameraView.urlViewFromCssView,
});
let quakeStatsOverlay!: QuakeStatsOverlayFlow;
let quakeEnemyAnimationsEnabled = debugEnableAnimationsOption?.checked ?? true;
const quakeDebugPanelFlow = createQuakeDebugPanelFlow({
  clearDebugUrlParams: clearQuakeDebugUrlParams,
  currentMapName: () => currentMapName,
  currentView: () => ({
    origin: controls.getOrigin(),
    rotX: scene.camera.state.rotX ?? 90,
    rotY: scene.camera.state.rotY ?? 270,
  }),
  debugEnabledOption,
  debugEnableAnimationsOption,
  debugPanel,
  debugShowFpsOption,
  debugShowLabelsOption,
  debugShowMenuOption,
  debugShowOutlinesOption,
  debugStack,
  debugShowTexturesOption,
  debugStatElements,
  hideMainMenu: () => menu.hideMainMenu(),
  initialHideTextures: debugShowTexturesOption ? !debugShowTexturesOption.checked : false,
  initialAnimationsEnabled: quakeEnemyAnimationsEnabled,
  initialMode: quakeUrlBoolean("debugPolys"),
  initialShowFps: debugShowFpsOption?.checked ?? false,
  initialShowLabels: debugShowLabelsOption?.checked ?? false,
  initialShowMenu: debugShowMenuOption?.checked ?? true,
  initialShowOutlines: debugShowOutlinesOption?.checked ?? false,
  pickupMeshCounts: () => {
    const pickupMeshes = Array.from(document.querySelectorAll<HTMLElement>(".polycss-mesh.pickup"));
    return {
      active: pickupMeshes.filter((element) => !element.hidden).length,
      total: pickupMeshes.length,
    };
  },
  removeBodyClasses: removeQuakeBodyClasses,
  setBodyClass: setQuakeBodyClass,
  setEnemyAnimationsEnabled: (enabled) => {
    quakeEnemyAnimationsEnabled = enabled;
    shootables.syncAnimationPresentation();
  },
  shootablesStats: () => shootables.debugStats(),
  showMainMenu: () => menu.showMainMenu(),
  syncInteractionPresentation: syncQuakeInteractionPresentation,
  syncPointerTraceAccessors: syncQuakePointerTraceAccessors,
  syncStatsOverlayAvailability: () => quakeStatsOverlay.syncAvailability(),
  viewUrlFor: quakeUrlFor,
  worldStats: () => world.debugStats(),
});
const quakeDebugRecordingSnapshot = createQuakeDebugRecordingSnapshotFlow({
  currentMapName: () => currentMapName,
  currentView: () => ({
    origin: controls.getOrigin(),
    rotX: scene.camera.state.rotX ?? 90,
    rotY: scene.camera.state.rotY ?? 270,
  }),
  flags: () => ({
    debugMode: quakeDebugPanelFlow.isModeEnabled(),
    showFps: quakeDebugPanelFlow.showFpsEnabled(),
    debugHooks: isQuakeDebugHooksEnabled(),
    menuOpen: menu.isMainMenuOpen(),
    panelOpen: menu.isMenuPanelOpen(),
    gameplayStarted: quakeGameplayStarted,
    playerDead: quakePlayerDead,
    enemiesDisabled: quakeEnemiesDisabled,
    damageDisabled: quakeDamageDisabled,
    enemiesFrozen: quakeEnemiesFrozen,
    attacksDisabled: quakeAttacksDisabled,
    dynamicLighting: quakeDynamicLighting,
    showGun: quakeShowGun,
  }),
  gameplay: () => ({
    appDisposed: quakeAppDisposed,
    collisionReady: currentCollisionWorld !== null,
    currentScene: currentResult !== null,
    loading: quakeAppLoading,
    mapName: currentMapName,
    multiplayerEnabled: QUAKE_MULTIPLAYER_ENABLED,
    multiplayerInputPaused: quakeMultiplayerInputPaused,
    paused: isQuakeGamePaused(),
    playerDead: quakePlayerDead,
    transitionSerial: quakeTransitionSerial,
  }),
  hazards: () => {
    const origin = getPlayer().currentOrigin();
    const eyeHeight = getPlayer().eyeHeight();
    const contentsPoint: Vec3 = [
      origin[0],
      origin[1],
      origin[2] - eyeHeight + 2 * QUAKE_COLLISION_UNIT_SCALE,
    ];
    const playerContents = currentCollisionWorld?.contentsAt?.(contentsPoint) ?? null;
    const playerWaterLevel = quakePlayerWaterLevel(currentCollisionWorld?.contentsAt, origin, eyeHeight);
    const contentsHazard = quakeContentsDamageForWaterLevel(playerContents, playerWaterLevel);
    return {
      ...quakePointHazards.counts(),
      playerContents,
      playerContentsHazard: contentsHazard?.kind ?? null,
      playerLiquid: quakeContentsIsLiquid(playerContents),
      playerWaterLevel,
    };
  },
  input: () => ({
    alwaysRun: quakeAlwaysRun,
    animationsEnabled: quakeEnemyAnimationsEnabled,
    attackDown: quakePointerGameplay.isAttackDown(),
    crosshair: crosshairOption?.checked ?? true,
    debugFly: document.body.classList.contains("quake-debug-fly"),
    invertMouse: quakeInvertMouse,
    mobileControls: quakePointerGameplay.isMobileAvailable(),
    pointerLocked: document.pointerLockElement === host,
  }),
  isLoading: () => quakeAppLoading,
  isPaused: isQuakeGamePaused,
  isPointerLocked: () => document.pointerLockElement === host,
  multiplayer: quakeMultiplayerDebugSnapshot,
  moversStats: () => movers.debugStats(),
  pickupsStats: () => getPickups().debugStats(),
  playerMovement: () => getPlayer().debugMovement(),
  playerProgress: () => getPlayer().snapshotProgress(),
  shootableCulling: (origin) => shootables.debugCullingSnapshot(origin),
  shootablesStats: () => shootables.debugStats(),
  targets: () => targetSystem.snapshotProgress(),
  touchedTriggers: (origin) => quakeSceneMount.currentTouchedTriggers(origin),
  triggersStats: () => triggerSystem.debugStats(),
  viewUrl: (view) => quakeUrlFor(currentMapName, view).toString(),
  viewmodel: () => viewmodel.debugSnapshot(),
  worldStats: () => world.debugStats(),
});
const quakeDebugRecorder = createQuakeDebugRecorder({
  appVersion: __CSSQUAKE_VERSION__,
  currentMapName: () => currentMapName,
  entityManifest: () => currentResult?.entityManifest ?? null,
  onStateChange: quakeDebugRecordingPanelEnabled ? syncQuakeDebugRecordingButton : undefined,
  snapshot: () => quakeDebugRecordingSnapshot.capture(),
  statusElement: quakeDebugRecordingPanelEnabled ? debugStatElements.get("recording") ?? null : null,
});
const quakePointerTracer = createQuakePointerTracer({
  enabled: () => quakeDebugPanelFlow.isModeEnabled() || isQuakeDebugHooksEnabled(),
  logToConsole: () => quakeDebugPanelFlow.isModeEnabled() || quakeDebugPointerTraceConsole,
  baseDetails: () => ({
    debug: quakeDebugPanelFlow.isModeEnabled(),
    pointerLocked: document.pointerLockElement === host,
    pointerLock: quakeEventTargetLabel(document.pointerLockElement),
    active: document.activeElement === host ? "host" : quakeEventTargetLabel(document.activeElement),
    menuOpen: menu.isMainMenuOpen(),
    panelOpen: menu.isMenuPanelOpen(),
    loading: quakeAppLoading,
    canInput: canUseQuakeGameplayInput(),
    bodyClass: document.body.className,
  }),
});
menu.setCurrentLevel(quakeAssetCatalog.startMap());
const audio = createQuakeSoundController();
const quakeSoundManifest = createQuakeSoundManifestFlow({
  assetManifest: quakeAssetCatalog.manifest,
  audio,
  isDisposed: () => quakeAppDisposed,
});
let viewmodel: ReturnType<typeof createQuakeViewmodelController>;
quakeCameraFeedback = createQuakeCameraFeedbackFlow({
  cameraPerspectiveStyle: () => quakeCameraView.cameraPerspectiveStyle(),
  canUseGameplayInput: canUseQuakeGameplayInput,
  controls,
  hasCurrentScene: () => currentResult !== null,
  isDisposed: () => quakeAppDisposed,
  queueCrosshairTargetSync: queueQuakeCrosshairTargetSync,
  renderOriginPolicy: quakeDebugMonsterCameraStandoff,
  scene,
  viewmodel: {
    playFireAnimation: (animation) => viewmodel.playFireAnimation(animation),
    syncTransform: () => viewmodel.syncTransform(),
  },
});
viewmodel = createQuakeViewmodelController({
  scene,
  controls,
  getRenderOrigin: quakeCameraView.currentRenderOrigin,
  host,
  layer: weapon,
});
const quakeViewmodelAssets = createQuakeViewmodelAssetFlow({
  activeWeapon: () => player?.inventory().activeWeapon ?? null,
  assetManifest: quakeAssetCatalog.manifest,
  isDisposed: () => quakeAppDisposed,
  trace: markQuakeTrace,
  viewmodel,
});
const quakeImpactParticleFlow: QuakeImpactParticleFlow = impactParticlesLayer
  ? createQuakeImpactParticleFlow({
      canShow: canShowQuakeImpactParticles,
      isGameplayPaused: isQuakeGamePaused,
      layer: impactParticlesLayer,
      viewOrigin: () => controls.getOrigin(),
      viewRotation: () => ({
        rotX: scene.camera.state.rotX ?? 90,
        rotY: scene.camera.state.rotY ?? 270,
      }),
    })
  : createNoopQuakeImpactParticleFlow();
const quakeEffectSpriteFlow: QuakeEffectSpriteFlow = impactParticlesLayer
  ? createQuakeEffectSpriteFlow({
      cameraPerspectiveStyle: () => quakeCameraView.cameraPerspectiveStyle(),
      canShow: canShowQuakeImpactParticles,
      effectSpritesUrl: () => quakeAssetCatalog.manifest().assets.effectSpritesUrl,
      isGameplayPaused: isQuakeGamePaused,
      layer: impactParticlesLayer,
      viewOrigin: () => controls.getOrigin(),
      viewRotation: () => ({
        rotX: scene.camera.state.rotX ?? 90,
        rotY: scene.camera.state.rotY ?? 270,
      }),
    })
  : createNoopQuakeEffectSpriteFlow();
quakeImpactParticleFlow.setEnabled(quakeImpactParticles);
quakeEffectSpriteFlow.setEnabled(quakeImpactParticles);
const quakeOptions = createQuakeOptionsFlow({
  alwaysRun: () => quakeAlwaysRun,
  alwaysRunOption,
  audioMuted: () => audio.isMuted(),
  crosshair,
  crosshairOption,
  crosshairOptionValue,
  damageDisabled: () => quakeDamageDisabled,
  disableDamageOption,
  disableEnemiesOption,
  disableSoundOption,
  dynamicLightingEnabled: () => quakeDynamicLighting,
  dynamicLightingOption,
  enemiesDisabled: () => quakeEnemiesDisabled,
  impactParticlesEnabled: () => quakeImpactParticles,
  impactParticlesOption,
  invertMouse: () => quakeInvertMouse,
  invertMouseOption,
  mountBitmapText: mountQuakeBitmapText,
  setAlwaysRun: setQuakeAlwaysRun,
  setAudioMuted: setQuakeAudioMuted,
  setDamageDisabled: setQuakeDamageDisabled,
  setDynamicLighting: setQuakeDynamicLighting,
  setEnemiesDisabled: setQuakeEnemiesDisabled,
  setImpactParticles: setQuakeImpactParticles,
  setInvertMouse: setQuakeInvertMouse,
  setShowGun: setQuakeShowGun,
  setStaticLightingClass: (staticLighting) => setQuakeBodyClass("quake-static-lighting", staticLighting),
  showGun: () => quakeShowGun,
  showGunOption,
  syncDebugControls: () => quakeDebugPanelFlow.syncControls(),
  syncDebugFlyMode: syncQuakeDebugFlyMode,
  unlockAudio: () => audio.unlock(),
});
const quakeHudFlow = createQuakeHudFlow({
  bonusOverlay,
  classicHud,
  damageOverlay,
  hudElements,
  inventory: () => getPlayer().inventory(),
  isPlayerDead: () => quakePlayerDead,
  playDamageViewFeedback: quakeCameraView.playDamageViewFeedback,
  playPainSound: () => audio.playEvent("pain", { volume: 0.58 }),
  syncActiveWeaponViewModel: () => quakeViewmodelAssets.syncActiveWeaponViewModel(),
  trace: markQuakeTrace,
});
const quakePowerups = createQuakePowerupFlow({
  getInventory: () => player?.inventory() ?? null,
  hasCurrentScene: () => currentResult !== null,
  isDisposed: () => quakeAppDisposed,
  isPaused: isQuakeGamePaused,
  isPlayerDead: () => quakePlayerDead,
  syncHud: syncQuakeHud,
  trace: markQuakeTrace,
});
const shootables = createQuakeShootablesController({
  addMesh: (entity, model, frameIndex, options) =>
    quakeEntityMeshes.addShootableMesh(entity, model, frameIndex, options),
  bossLightningDischarge: quakeBossLightningDischarge,
  bossLightningElectrodesReady: quakeBossLightningElectrodesReady,
  createMonsterStateRunner: (classname) => createQuakeMonsterStateRunner(classname, { enabled: true }),
  damagePlayer: (amount, context) => getPlayer().damage(amount, context),
  enemyAnimationsEnabled: () => quakeEnemyAnimationsEnabled,
  enemiesFrozen: () => quakeEnemiesFrozen,
  enemyAttacksEnabled: () => !quakeAttacksDisabled,
  enemyMotionMaterial: quakeDebugMonsterMotionMaterial,
  enemyRandomSalt: createQuakeRuntimeRandomSalt,
  playerClearance: quakeDebugMonsterPlayerClearance,
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
  hasLineOfSight: (start, end) => quakeSceneMount.lineOfSight(start, end),
  traceLine: (start, end) => currentCollisionWorld?.traceUse?.(start, end) ?? null,
  isPlayerInvisible: () => quakePowerups.isInvisible(),
  isGameplayPaused: isQuakeGamePaused,
  isInPlayerView: (point) => quakeSceneMount.isPointInPlayerView(point, QUAKE_MONSTER_MOUNT_VIEW_DOT_MIN),
  leafIndexAt: world.leafIndexAt,
  monsterRuntimeEnabled: () => QUAKE_MONSTER_RUNTIME_ENABLED && !QUAKE_MULTIPLAYER_ENABLED && !quakeEnemiesDisabled,
  onDestroyed: (entity) => {
    if (entity.classname.startsWith("monster_")) quakeLevelStats.markMonsterKilled(entity.index);
  },
  onExplosion: (event) => {
    quakeEffectSpriteFlow.spawnExplosion({
      origin: event.origin,
      radiusUnits: event.radiusUnits,
    });
  },
  pointToPoly: quakeCameraView.pointToPoly,
  shouldSpawn: shouldSpawnQuakeShootableForCurrentMode,
  pixelate: world.pixelate,
  schedulePresentationResync: world.schedulePresentationResync,
  visibleLeavesAt: world.visibleLeavesAt,
  prewarmLeavesAt: quakeShootablePrewarmLeavesAt,
  fireTarget: fireQuakeTarget,
  playSound: (soundPath, options) => audio.playSound(soundPath, options),
});
const targetSystem = createQuakeTargetsController({
  activateEntity: activateQuakeEntity,
  isGameplayPaused: isQuakeGamePaused,
  onCounterStateChange: (entity, result) => quakeTextPresentation.showCounterGeneratedText(entity, result),
  onUseTargetsMessage: (entity, text) => quakeTextPresentation.showUseTargetsMessageText(entity, text),
});
const quakeDamageableBrushes = createQuakeDamageableBrushFlow({
  activateEntity: activateQuakeEntity,
  activateSecretTrigger: activateQuakeSecretTrigger,
  disableEntity: (entityIndex) => targetSystem.disableEntity(entityIndex),
  getEntity: (entityIndex) => entityByIndex.get(entityIndex),
  isEntityDisabled: (entityIndex) => targetSystem.isDisabled(entityIndex),
  isPaused: isQuakeGamePaused,
  pausedTimerPollMs: QUAKE_PAUSED_TIMER_POLL_MS,
  triggerOneShot: quakeRuntimeTriggerOneShot,
  useTargets: (entity) => targetSystem.useTargets(entity),
});
const quakePointHazards = createQuakePointHazardFlow({
  getEntity: (entityIndex) => entityByIndex.get(entityIndex),
  gravity: QUAKE_GRAVITY,
  hasCurrentScene: () => currentResult !== null,
  isEntityDisabled: (entityIndex) => targetSystem.isDisabled(entityIndex),
  isPaused: isQuakeGamePaused,
  onHazardsChanged: () => syncQuakeHazards(getPlayer().currentOrigin()),
  pointToPoly: quakeCameraView.pointToPoly,
});
const movers = createQuakeMoversController({
  applyState: (state, movePlayer) => quakeMoverInteractions.applyState(state, movePlayer),
  fireTarget: fireQuakeTarget,
  groupUnlocked: (state) => quakeMoverInteractions.groupUnlocked(state),
  isGameplayPaused: isQuakeGamePaused,
  playerBlocks: (state, nextOffset, delta) => quakeMoverInteractions.playerBlocks(state, nextOffset, delta),
});
const triggerSystem = createQuakeTriggersController({
  activateCounter: targetSystem.activateCounter,
  activateEntity: activateQuakeEntity,
  activateTeleport: activateQuakeTeleport,
  completeLevel: completeQuakeLevel,
  disableEntity: targetSystem.disableEntity,
  getEntity: (entityIndex) => entityByIndex.get(entityIndex),
  getOrigin: () => controls.getOrigin(),
  getTouchedTriggers: (origin) => quakeSceneMount.currentTouchedTriggers(origin),
  isEntityDisabled: targetSystem.isDisabled,
  isOneShotTrigger: quakeRuntimeTriggerOneShot,
  onActiveKeyChange: syncQuakeActiveTriggerDataset,
  requestTouch: requestQuakeMultiplayerTriggerTouch,
  triggerSpecial: activateQuakeSpecialTrigger,
  triggerWait: quakeRuntimeTriggerWait,
  transitionSerial: () => quakeTransitionSerial,
  useTargets: targetSystem.useTargets,
});
pickups = createQuakePickupController({
  addMesh: (entity, model, frameIndex) => quakeEntityMeshes.addPickupMesh(entity, model, frameIndex),
  applyEffect: (effect, entity, feedback) => {
    applyQuakeInventoryDelta(getPlayer().inventory(), effect);
    syncQuakeHud();
    flashQuakeBonusOverlay();
    const gameLogic = currentResult?.gameLogic ?? null;
    const pickupMessage = feedback?.message ?? quakePickupMessageForEntity(entity, gameLogic);
    if (pickupMessage) quakeTextPresentation.notify(pickupMessage);
    if (feedback?.soundPath) {
      audio.playSound(feedback.soundPath);
    } else {
      audio.playPickup(entity, gameLogic);
    }
  },
  canPickup: (effect, entity) => {
    const canPickup = quakeCanPickupForInventory(entity, getPlayer().inventory(), currentResult?.gameLogic ?? null, effect);
    if (!canPickup) return false;
    if (QUAKE_MULTIPLAYER_ENABLED && quakeMultiplayerSession.status().state === "connected") {
      requestQuakeMultiplayerPickup(entity.index);
      return false;
    }
    return true;
  },
  leafIndexAt: world.leafIndexAt,
  playerForward: () => forwardDirection(scene.camera.state.rotX ?? 90, scene.camera.state.rotY ?? 270),
  playerViewDot: (point) => quakeSceneMount.playerViewDot(point),
  pointToPoly: quakeCameraView.pointToPoly,
  gameLogic: () => currentResult?.gameLogic ?? null,
  isGameplayPaused: isQuakeGamePaused,
  programMetadata: () => currentProgramMetadata,
  shouldSpawn: shouldSpawnQuakeEntityForCurrentGame,
  startMegahealthRot: (entity, delaySeconds) => quakePowerups.startMegahealthRot(entity, delaySeconds),
  startPowerup: (entity, powerup) => quakePowerups.startPowerup(entity, powerup),
  useTargets: targetSystem.useTargets,
  visibleLeavesAt: world.visibleLeavesAt,
});
const weapons = createQuakeWeaponsController({
  scene,
  controls,
  addProjectileMesh: (modelPath, weapon) => quakeWeaponPresentation.addProjectileMesh(modelPath, weapon),
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
  playFireAnimation: (animation) => quakeWeaponPresentation.playFireAnimation(animation),
  damageShootable: shootables.damage,
  damageBrushEntity: (entityIndex, amount) => quakeDamageableBrushes.damage(entityIndex, amount),
  damagePlayer: (amount, context) => getPlayer().damage(amount, context),
  canDamageTargetOrigin: (start, targetOrigin) => shootables.canDamageTargetOrigin(start, targetOrigin),
  damageMultiplier: () => quakePowerups.damageMultiplier(),
  onFire: sendQuakeMultiplayerFireIntent,
  onDamageImpact: (event) => {
    quakeImpactParticleFlow.spawnBlood({
      damage: event.damage,
      directionHint: event.direction,
      origin: event.origin,
    });
  },
  onExplosionImpact: (event) => {
    quakeEffectSpriteFlow.spawnExplosion({
      origin: event.origin,
      radiusUnits: event.radiusUnits,
    });
  },
  onHit: () => quakeWeaponPresentation.flashCrosshairHit(),
  onWallImpact: (event) => {
    quakeImpactParticleFlow.spawnWallImpact({
      count: quakeWallImpactParticleCount(event.effect),
      origin: event.origin,
    });
  },
  showLightningBeam: (beam) => quakeWeaponPresentation.showLightningBeam(beam),
  syncCrosshairTarget: queueQuakeCrosshairTargetSync,
});
quakeCrosshairInteraction = createQuakeCrosshairInteractionFlow({
  activateEntity: activateQuakeEntity,
  addBodyClasses: addQuakeBodyClasses,
  canUseInput: canUseQuakeGameplayInput,
  currentMapName: () => currentMapName,
  getOrigin: () => controls.getOrigin(),
  isDisposed: () => quakeAppDisposed,
  removeBodyClasses: removeQuakeBodyClasses,
  rotation: () => ({
    rotX: scene.camera.state.rotX ?? 88,
    rotY: scene.camera.state.rotY ?? 270,
  }),
  weapons: {
    traceIsActionable: (trace) => weapons.traceIsActionable(trace),
    traceIsShootable: (trace) => weapons.traceIsShootable(trace),
    viewTraceAtCrosshair: (range) => weapons.viewTraceAtCrosshair(range),
    weaponTraceAtCrosshair: () => weapons.weaponTraceAtCrosshair(),
  },
});
quakePointerGameplay = createQuakePointerGameplayFlow({
  activeElement: () => document.activeElement,
  applyCameraAt: quakeCameraView.applySceneCameraAt,
  audioUnlock: () => audio.unlock(),
  canUseGameplayInput: canUseQuakeGameplayInput,
  clearDeathUnlockControlsEndTraceSuppression: () => quakePlayerLifecycle.clearDeathUnlockControlsEndTraceSuppression(),
  clearMainMenuControlsEndSuppression: clearQuakeMainMenuControlsEndSuppression,
  clearParentKeyRelay: quakeGameplayInput.clearParentKeyRelay,
  controls,
  currentCameraRenderOrigin: quakeCameraView.currentRenderOrigin,
  eventTargetLabel: quakeEventTargetLabel,
  fireWeapon: (now) => weapons.fire(now),
  focusHost: () => host.focus({ preventScroll: true }),
  forwardDirection,
  hidePersistedLoadingConsole: hidePersistedQuakeLoadingConsole,
  host,
  invertMouse: () => quakeInvertMouse,
  isDebugFlyModeActive: isQuakeDebugFlyModeActive,
  isDeathUnlockControlsEndTraceSuppressed: isQuakeDeathUnlockControlsEndTraceSuppressed,
  isDisposed: () => quakeAppDisposed,
  isInteractiveOverlayTarget: (target) => target instanceof Node && debugPanel?.contains(target) === true,
  isPlayerDead: () => quakePlayerDead,
  mobileRoot: quakeApp,
  onAvailabilityChange: () => quakeStatsOverlay.syncAvailability(),
  pointerLockElement: () => document.pointerLockElement,
  queueCrosshairTargetSync: queueQuakeCrosshairTargetSync,
  renderSupersample: QUAKE_RENDER_SUPERSAMPLE,
  requestIntermissionAdvance: requestQuakeIntermissionAdvance,
  respawnPlayerFromDeath: respawnQuakePlayerFromDeath,
  rotation: () => ({
    rotX: scene.camera.state.rotX ?? 88,
    rotY: scene.camera.state.rotY ?? 270,
  }),
  setAnalogMove: (x, y) => player?.setAnalogMove(x, y),
  setDebugOrigin: (origin) => getPlayer().setDebugOrigin(origin),
  syncDebugFlyView: quakeCameraView.syncDebugFlyView,
  syncInteractionPresentation: syncQuakeInteractionPresentation,
  trace: quakePointerTrace,
  traceActionAtCrosshair: () => quakeCrosshairInteraction?.pointerActionTrace() ?? null,
  traceUserActivationDetails: quakeUserActivationTraceDetails,
  tryActivateCrosshairAction: (trace) => quakeCrosshairInteraction?.activateButtonAtTrace(trace) ?? false,
  viewmodelSyncTransform: () => viewmodel.syncTransform(),
});
quakeStatsOverlay = createQuakeStatsOverlayFlow({
  isDisposed: () => quakeAppDisposed,
  isLoading: () => quakeAppLoading,
  isMobileAvailable: quakePointerGameplay.isMobileAvailable,
  root: quakeMenu ?? quakeApp,
  showFpsEnabled: () => quakeDebugPanelFlow.showFpsEnabled(),
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
  isInvulnerable: () => quakePowerups.isInvulnerable(),
  jumpVelocity: QUAKE_JUMP_VELOCITY,
  onHazardDamage: sendQuakeMultiplayerHazardDamageIntent,
  onDamageFlash: quakeHudFlow.onDamageFlash,
  onDeath: (details) => showQuakePlayerDeath(details),
  onHazardState: () => undefined,
  onInventoryChanged: syncQuakeHud,
  onRespawn: (result, previousOrigin) => quakeSceneMount.respawnScene(result, previousOrigin),
  pointToPoly: quakeCameraView.pointToPoly,
  resolveShootablesCollision: shootables.resolvePlayerCollision,
  syncCrosshairTarget: syncQuakeCrosshairTarget,
  syncCamera: quakeCameraView.syncCameraOrigin,
  syncHazards: syncQuakeHazards,
  syncPickups: (origin, eyeHeight) => getPickups().syncCollision(origin, eyeHeight, STEP_HEIGHT),
  syncTouchedTriggers,
  syncViewmodel: () => viewmodel.syncTransform(),
  syncWorldVisibility: (force) => {
    world.syncVisibility(force);
    shootables.syncVisibility(controls.getOrigin(), force);
  },
  transitionSerial: () => quakeTransitionSerial,
  quakecRandom: (label) => shootables.nextPlayerQuakecRandom({
    functionName: label,
    reason: "player-death",
  }),
});

let currentPickupModelLibrary: QuakePickupModelLibrary | null = null;
let currentProgramMetadata: QuakeProgramMetadata | null = null;
let currentCollisionWorld: QuakeCollisionWorld | null = null;
let currentResult: QuakeScene | null = null;
let quakeGameplayStarted = false;
let quakeClickToPlayCenterPrintVisible = false;
let entityByIndex = new Map<number, QuakeEntity>();
let quakeModelPivot = { x: 0, y: 0, z: 0 };
let quakeTransitionSerial = 0;
let quakeMultiplayerSceneSerial = 0;
let quakeMultiplayerClientSequence = 0;
let quakeMultiplayerFireSequence = 0;
let quakeMultiplayerPickupSequence = 0;
let quakeMultiplayerWorldSequence = 0;
let quakeMultiplayerInputSequence = 0;
let quakeMultiplayerPoseSequence = 0;
let quakeMultiplayerPoseFrame = 0;
let quakeMultiplayerLastInputAt = 0;
let quakeMultiplayerLastPoseAt = 0;
let quakeMultiplayerHelloAccepted = false;
let quakeMultiplayerLocalSpawnId: string | null = null;
let quakeMultiplayerLocalPingMs: number | null = null;
let quakeMultiplayerLastReconciledInputSequence = 0;
let quakeMultiplayerLastInventoryFingerprint: string | null = null;
let quakeMultiplayerApplyingWorldEvent = false;
const quakeMultiplayerPickupRequestAt = new Map<number, number>();
const quakeMultiplayerWorldRequestAt = new Map<string, number>();
let quakeMultiplayerLastRoomEvent: Record<string, unknown> | null = null;
let quakeMultiplayerRecentRoomEvents: Record<string, unknown>[] = [];
let quakeMultiplayerLastWorldEvent: Record<string, unknown> | null = null;
let quakeMultiplayerRecentWorldEvents: Record<string, unknown>[] = [];
let quakeMultiplayerLastPlayerEvent: Record<string, unknown> | null = null;
let quakeMultiplayerRecentPlayerEvents: Record<string, unknown>[] = [];
let quakeMultiplayerLastPickupEvent: Record<string, unknown> | null = null;
let quakeMultiplayerLastMatchState: QuakeMultiplayerRoomMatchState | null = null;
let quakeMultiplayerLastMatchEvent: Record<string, unknown> | null = null;
let quakeMultiplayerLastReject: QuakeMultiplayerRoomRejectRecord | null = null;
let quakeMultiplayerLastError: QuakeMultiplayerRoomErrorRecord | null = null;
let currentMapName = quakeAssetCatalog.startMap();
let quakeAppDisposed = false;
let quakeAppLoading = true;
quakeWeaponPresentation = createQuakeWeaponPresentationFlow({
  addBodyClasses: addQuakeBodyClasses,
  currentModelLibrary: () => currentPickupModelLibrary,
  playWeaponFireFeedback: (animation) => quakeCameraFeedback.playWeaponFireFeedback(animation),
  removeBodyClasses: removeQuakeBodyClasses,
  scene,
  sceneElement,
});
quakeTextPresentation = createQuakeTextPresentationFlow({
  currentGameLogic: () => currentResult?.gameLogic ?? null,
  hudAvailable: () => Boolean(quakeHud),
  isPlayerDead: () => quakePlayerDead,
  text: quakeText,
});
quakeMoverInteractions = createQuakeMoverInteractionFlow({
  audio,
  applyButtonLeafVisual: applyQuakeButtonLeafVisual,
  compactInlineStyle: quakeCameraView.compactInlineStyle,
  currentCollisionWorld: () => currentCollisionWorld,
  currentGroundEntity: () => getPlayer().currentGroundEntity(),
  doorMessageCooldownMs: QUAKE_DOOR_MESSAGE_COOLDOWN_MS,
  getMover: (entityIndex) => movers.get(entityIndex),
  isDebugFlyModeActive: isQuakeDebugFlyModeActive,
  modelLeaves: (modelIndex) => world.modelLeaves(modelIndex),
  playerCarryWithMover: (delta, entityIndex) => getPlayer().carryWithMover(delta, entityIndex),
  playerDamage: (amount) => getPlayer().damage(amount),
  playerEyeHeight: () => getPlayer().eyeHeight(),
  playerInventory: () => getPlayer().inventory(),
  playerOrigin: () => controls.getOrigin(),
  requiredDoorText: (entityIndexes, requiredKey) =>
    quakeTextPresentation.generatedCenterPrintTextForEntityIndexes(
      entityIndexes,
      "door-key-required",
      (fact) => fact.condition?.key === requiredKey,
    ),
  shootables,
  showCenterPrint: (text) => quakeTextPresentation.centerPrint(text),
  syncShootablesVisibility: (origin, force) => shootables.syncVisibility(origin, force),
  syncCrosshairTarget: syncQuakeCrosshairTarget,
});
const quakeAssetWarmup = createQuakeAssetWarmupFlow({
  assetManifest: quakeAssetCatalog.manifest,
  isDisposed: () => quakeAppDisposed,
  onPickupModelLibrary: (library) => {
    currentPickupModelLibrary = library;
  },
  onProgramMetadata: (metadata) => {
    currentProgramMetadata = metadata;
  },
});
const quakeLoading = createQuakeLoadingFlow({
  clearAttackInput: quakePointerGameplay.clearAttackInput,
  clearBonusOverlay: clearQuakeBonusOverlay,
  clearCrosshairTarget: clearQuakeCrosshairTarget,
  clearCrouchInput: quakeGameplayInput.clearCrouchInput,
  clearDebugFlyInput: quakeDebugFly.clearInput,
  clearMobileMoveInput: quakePointerGameplay.clearMobileMoveInput,
  clearMoveInput: quakeGameplayInput.clearMoveInput,
  clearWeaponViewPunch: quakeCameraView.clearWeaponViewPunch,
  currentMapName: () => currentMapName,
  dom: quakeDom,
  hasCurrentResult: () => currentResult !== null,
  hideStatsOverlay: quakeStatsOverlay.hide,
  initialLoading: quakeAppLoading,
  isDisposed: () => quakeAppDisposed,
  isGameplayStarted: () => quakeGameplayStarted,
  isLevelTransitionActive: isQuakeLevelTransitionActive,
  isMainMenuOpen: () => menu.isMainMenuOpen(),
  isMenuPanelOpen: () => menu.isMenuPanelOpen(),
  onLoadingChange: (loading) => {
    quakeAppLoading = loading;
  },
  previewEnabled: QUAKE_LOADING_PREVIEW_ENABLED,
  renderBitmapText: mountQuakeBitmapText,
  setControlsLoading: () => controls.update({ moveEnabled: false, jumpEnabled: false, gravity: 0 }),
  syncCrosshairTarget: syncQuakeCrosshairTarget,
  syncDebugFlyMode: syncQuakeDebugFlyMode,
  syncStatsOverlayAvailability: () => quakeStatsOverlay.syncAvailability(),
  trace: markQuakeTrace,
});
const quakeSceneMount = createQuakeSceneMountFlow({
  afterMountScene: () => {
    resetQuakeLevelStatsForCurrentScene();
    startQuakeMultiplayerScene();
  },
  audio,
  beforeDisposeScene: () => stopQuakeMultiplayerScene("scene-dispose"),
  clearPlayerDeath: clearQuakePlayerDeath,
  clearPostControllerState: () => {
    clearQuakeLevelComplete();
    clearQuakePlayerDeath();
    quakeTextPresentation.clear();
    quakeMoverInteractions.clear();
    quakeWeaponPresentation.clearCrosshairHit();
    clearQuakeLevelLoadTimer();
    clearQuakeCrosshairTarget();
    quakeWeaponPresentation.clearLightningBeams();
  },
  clearPreControllerState: () => {
    quakePointerGameplay.clearAttackInput();
    quakeDebugFly.clearInput();
    quakeCameraView.clearWeaponViewPunch();
    quakePowerups.clearMegahealthRot();
    quakePowerups.clearPowerups();
    clearQuakeBonusOverlay();
    quakeViewmodelAssets.clearMountedState();
  },
  currentModelLibrary: () => currentPickupModelLibrary,
  currentProgramMetadata: () => currentProgramMetadata,
  damageableBrushes: quakeDamageableBrushes,
  focusCurrentMenu: () => menu.focusCurrent(),
  host,
  movers,
  pickups: getPickups(),
  player: getPlayer(),
  playerForward: () => forwardDirection(scene.camera.state.rotX ?? 90, scene.camera.state.rotY ?? 270),
  pointHazards: quakePointHazards,
  powerupActive: (finishedField) => quakePowerups.powerupActive(finishedField),
  setCamera: quakeCameraView.setCamera,
  shootables,
  state: {
    setCollisionWorld: (world) => { currentCollisionWorld = world; },
    setCurrentScene: (nextScene) => { currentResult = nextScene; },
    setEntityIndex: (index) => { entityByIndex = index; },
    setModelPivot: (pivot) => {
      quakeModelPivot = pivot;
      quakeMoverInteractions.setModelPivot(pivot);
    },
    setTransitionSerial: (value) => { quakeTransitionSerial = value; },
  },
  syncCrosshairTarget: syncQuakeCrosshairTarget,
  targets: targetSystem,
  trace: markQuakeTrace,
  transitionSerial: () => quakeTransitionSerial,
  triggers: triggerSystem,
  viewmodel,
  weapons,
  world,
});
quakeEntityActivation = createQuakeEntityActivationFlow({
  addBodyClasses: addQuakeBodyClasses,
  audio,
  clearAttackInput: quakePointerGameplay.clearAttackInput,
  currentCollisionWorld: () => currentCollisionWorld,
  currentGameLogic: () => currentResult?.gameLogic,
  entities: () => entityByIndex,
  getOrigin: () => controls.getOrigin(),
  intermission: {
    show: () => {
      quakeIntermission.show(quakeLevelStats.freeze());
      syncQuakeInteractionPresentation();
    },
    syncCamera: syncQuakeIntermissionCamera,
  },
  loadMap: loadQuakeMap,
  mapExists: quakeAssetCatalog.mapExists,
  movers,
  onSecretActivated: (entity) => quakeLevelStats.markSecret(entity.index),
  pickups: getPickups(),
  player: getPlayer,
  pointToPoly: quakeCameraView.pointToPoly,
  publishWorldChanged: sendQuakeMultiplayerWorldChanged,
  shootables,
  syncCrosshairTarget: syncQuakeCrosshairTarget,
  syncSceneCamera: quakeCameraView.syncSceneCamera,
  syncTouchedTriggers,
  targets: targetSystem,
  text: {
    centerPrint: (message) => quakeTextPresentation.centerPrint(message),
    clearCenterPrint: () => quakeTextPresentation.clearCenterPrint(),
    hasUseTargetsMessageText: (entity) => quakeTextPresentation.hasUseTargetsMessageText(entity),
    setCenterPrint: (message) => quakeTextPresentation.setCenterPrint(message),
    showDirectCenterPrintMessageText: (entity) => quakeTextPresentation.showDirectCenterPrintMessageText(entity),
  },
  transitionSerialIncrement: () => { quakeTransitionSerial++; },
  triggers: triggerSystem,
  viewmodel,
  world,
});
quakePlayerLifecycle = createQuakePlayerLifecycleFlow({
  addBodyClasses: addQuakeBodyClasses,
  appLoading: () => quakeAppLoading,
  clearAttackInput: quakePointerGameplay.clearAttackInput,
  clearBonusOverlay: clearQuakeBonusOverlay,
  clearCrosshairHit: () => quakeWeaponPresentation.clearCrosshairHit(),
  clearCrosshairTarget: clearQuakeCrosshairTarget,
  clearCrouchInput: quakeGameplayInput.clearCrouchInput,
  clearDeathDamageFeedback: () => quakeHudFlow.clearDeathDamageFeedback(),
  clearDeathOverlay: () => quakeLoading.clearDeathOverlay(),
  clearDebugFlyInput: quakeDebugFly.clearInput,
  clearGameRoute: clearQuakeGameRoute,
  clearLevelLoadTimer: clearQuakeLevelLoadTimer,
  clearMegahealthRot: () => quakePowerups.clearMegahealthRot(),
  clearMobileMoveInput: quakePointerGameplay.clearMobileMoveInput,
  clearMoveInput: quakeGameplayInput.clearMoveInput,
  clearPowerups: () => quakePowerups.clearPowerups(),
  clearText: () => quakeTextPresentation.clear(),
  clearTextCenterPrint: () => quakeTextPresentation.clearCenterPrint(),
  clearWeaponViewPunch: quakeCameraView.clearWeaponViewPunch,
  controls,
  currentCollisionWorld: () => currentCollisionWorld,
  currentMapName: () => currentMapName,
  currentResult: () => currentResult,
  exitPointerLockIfHost: () => {
    if (document.pointerLockElement === host) document.exitPointerLock();
  },
  focusHost: () => host.focus({ preventScroll: true }),
  gameplayStarted: () => quakeGameplayStarted,
  hasBodyClass: hasQuakeBodyClass,
  hasDeathOverlay: () => quakeLoading.hasDeathOverlay(),
  hideMainMenu: () => menu.hideMainMenu(),
  isMainMenuOpen: () => menu.isMainMenuOpen(),
  isMenuPanelOpen: () => menu.isMenuPanelOpen(),
  jumpVelocity: QUAKE_JUMP_VELOCITY,
  loadMap: loadQuakeMap,
  player: getPlayer,
  playDeathSound: (soundPath) => audio.playSound(soundPath, { volume: 0.78 }),
  pointerTrace: quakePointerTrace,
  removeBodyClasses: removeQuakeBodyClasses,
  setGameplayStarted: setQuakeGameplayStarted,
  setLoading: setQuakeLoading,
  setPlayerDead: (dead) => { quakePlayerDead = dead; },
  showDeathDamageFeedback: () => quakeHudFlow.showDeathDamageFeedback(),
  showDeathOverlay: () => quakeLoading.showDeathOverlay(),
  showMainMenu: () => menu.showMainMenu(),
  startMap: quakeAssetCatalog.startMap,
  syncPlayerCollision,
  trace: markQuakeTrace,
  viewmodel,
});
let quakeDebugCollisionBypassUntil = 0;
let quakeDebugGameplaySyncActive = false;
let quakeGamePaused = false;
let quakeGamePausedAt = 0;
let quakeMenuPauseActive = false;
let quakeClickToPlayPauseActive = false;
let quakeMultiplayerInputPaused = QUAKE_MULTIPLAYER_DEBUG_INPUT_PAUSED;
let quakeMultiplayerLastPresenceStatusSent: QuakeMultiplayerPlayerPresenceStatus | null = null;

function setQuakeGameplayStarted(started: boolean): void {
  quakeGameplayStarted = started;
  setQuakeBodyClass("quake-gameplay-started", started);
  quakeLoading.handleGameplayStarted(started);
  syncQuakeInteractionPresentation();
}

function hidePersistedQuakeLoadingConsole(): void {
  quakeLoading.hidePersistedConsole();
}

function makeParseResult(polygons: Polygon[]): ParseResult {
  return { polygons, objectUrls: [], warnings: [], dispose: () => undefined };
}

function syncQuakeHud(): void {
  quakeHudFlow.sync();
}

function flashQuakeBonusOverlay(): void {
  quakeHudFlow.flashBonusOverlay();
}

function clearQuakeBonusOverlay(): void {
  quakeHudFlow.clearBonusOverlay();
}

function isQuakeWeaponId(value: string): value is QuakeWeaponId {
  return Object.prototype.hasOwnProperty.call(QUAKE_PLAYER_WEAPON_FIRE_FACTS.profiles, value);
}

function isQuakeKey(value: string): value is QuakeKey {
  return value === "silver" || value === "gold";
}

function isQuakeGamePaused(): boolean {
  return !quakeDebugGameplaySyncActive && quakeGamePaused;
}

function setQuakeMenuPauseState(paused: boolean): void {
  quakeMenuPauseActive = paused;
  syncQuakePauseState();
}

function setQuakeClickToPlayPauseState(paused: boolean): void {
  if (quakeClickToPlayPauseActive === paused) return;
  quakeClickToPlayPauseActive = paused;
  syncQuakePauseState();
}

function shouldForceQuakeGamePaused(): boolean {
  return quakeMenuPauseActive ||
    quakeClickToPlayPauseActive ||
    menu.isMainMenuOpen() ||
    menu.isMenuPanelOpen();
}

function syncQuakePauseState(): void {
  const paused = shouldForceQuakeGamePaused();
  if (QUAKE_MULTIPLAYER_ENABLED) {
    if (QUAKE_MULTIPLAYER_DEBUG_INPUT_PAUSED && !paused) return;
    setQuakeMultiplayerInputPaused(paused);
    return;
  }
  applyQuakeGamePaused(paused);
}

function setQuakeMultiplayerInputPaused(paused: boolean): void {
  if (quakeMultiplayerInputPaused === paused) {
    syncQuakeMultiplayerPresenceStatus(paused);
    syncQuakeInteractionPresentation();
    return;
  }
  quakeMultiplayerInputPaused = paused;
  setQuakeBodyClass("quake-multiplayer-input-paused", paused);
  syncQuakeInteractionPresentation();
  if (paused) {
    quakePointerGameplay.clearAttackInput();
    quakeGameplayInput.clearMoveInput();
    quakePointerGameplay.clearMobileMoveInput();
    quakeGameplayInput.clearCrouchInput();
    quakeCameraView.clearWeaponViewPunch();
    controls.update({ moveEnabled: false, jumpEnabled: false, crouchEnabled: false, gravity: 0 });
    clearQuakeCrosshairTarget();
  } else if (!quakeAppLoading && currentCollisionWorld !== null) {
    controls.update({ moveEnabled: true });
    syncQuakeCrosshairTarget();
  }
  syncQuakeMultiplayerPresenceStatus(paused);
}

function syncQuakeMultiplayerPresenceStatus(paused: boolean): void {
  const status = paused ? "input-paused" : "active";
  if (quakeMultiplayerLastPresenceStatusSent === status) return;
  if (sendQuakeMultiplayerPresence(status)) {
    quakeMultiplayerLastPresenceStatusSent = status;
  }
}

function setQuakeGamePaused(paused: boolean): void {
  applyQuakeGamePaused(paused || shouldForceQuakeGamePaused());
}

function applyQuakeGamePaused(paused: boolean): void {
  if (quakeGamePaused === paused) {
    syncQuakeInteractionPresentation();
    return;
  }
  const now = performance.now();
  quakeGamePaused = paused;
  setQuakeBodyClass("quake-game-paused", paused);
  syncQuakeInteractionPresentation();
  audio.setPaused(paused);
  if (paused) {
    quakeGamePausedAt = now;
    quakePointerGameplay.clearAttackInput();
    quakeGameplayInput.clearMoveInput();
    quakePointerGameplay.clearMobileMoveInput();
    quakeGameplayInput.clearCrouchInput();
    quakeCameraView.clearWeaponViewPunch();
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
    syncQuakeCrosshairTarget();
  }
}

function pauseQuakeGameplayTimers(): void {
  quakePowerups.pauseTimers();
}

function resumeQuakeGameplayTimers(pausedForMs: number): void {
  if (pausedForMs > 0) {
    quakePointHazards.resumeAfterPause(pausedForMs);
    quakeMoverInteractions.resumeAfterPause(pausedForMs);
  }
  quakePowerups.resumeAfterPause(pausedForMs);
}

function setQuakeAudioMuted(muted: boolean): void {
  audio.setMuted(muted);
  quakeOptions.syncAudioToggle();
  if (!muted) void quakeSoundManifest.ensureLoaded();
}

function toggleQuakeAudioMuted(): void {
  setQuakeAudioMuted(!audio.isMuted());
}

function showQuakeShortcutState(label: string, enabled: boolean): void {
  quakeTextPresentation.centerPrint(`${label} ${enabled ? "ON" : "OFF"}`);
}

function toggleQuakeAudioMutedShortcut(): void {
  toggleQuakeAudioMuted();
  showQuakeShortcutState("Sound", !audio.isMuted());
}

function setQuakeEnemiesDisabled(disabled: boolean): void {
  quakeEnemiesDisabled = disabled;
  shootables.syncMonsterRuntime();
  quakeOptions.syncControls();
}

function setQuakeDamageDisabled(disabled: boolean): void {
  quakeDamageDisabled = disabled;
  quakeOptions.syncControls();
}

function setQuakeAttacksDisabled(disabled: boolean): void {
  quakeAttacksDisabled = disabled;
  shootables.syncMonsterRuntime();
  syncQuakeDebugDisableAttacksOption();
}

function setQuakeEnemiesFrozen(frozen: boolean): void {
  quakeEnemiesFrozen = frozen;
  shootables.syncMonsterRuntime();
  syncQuakeDebugFreezeEnemiesOption();
}

function syncQuakeDebugFreezeEnemiesOption(): void {
  if (debugFreezeEnemiesOption) debugFreezeEnemiesOption.checked = quakeEnemiesFrozen;
}

function syncQuakeDebugDisableAttacksOption(): void {
  if (debugDisableAttacksOption) debugDisableAttacksOption.checked = quakeAttacksDisabled;
}

function setQuakeDynamicLighting(enabled: boolean): void {
  quakeDynamicLighting = enabled;
  quakeOptions.syncDynamicLightingOption();
}

function setQuakeImpactParticles(enabled: boolean): void {
  quakeImpactParticles = enabled;
  quakeImpactParticleFlow.setEnabled(enabled);
  quakeEffectSpriteFlow.setEnabled(enabled);
  quakeOptions.syncImpactParticlesOption();
}

function setQuakeShowGun(enabled: boolean): void {
  quakeShowGun = enabled;
  syncQuakeViewmodelVisibility();
  quakeOptions.syncControls();
}

function syncQuakeViewmodelVisibility(): void {
  viewmodel.setVisible(quakeShowGun && !quakeMultiplayerSpectating);
}

function canShowQuakeImpactParticles(): boolean {
  return (
    !quakeAppLoading &&
    currentResult !== null &&
    !quakePlayerDead &&
    !hasQuakeBodyClass("quake-level-complete") &&
    !hasQuakeBodyClass("quake-menu-unlocked") &&
    !menu.isMainMenuOpen() &&
    !menu.isMenuPanelOpen()
  );
}

function createNoopQuakeImpactParticleFlow(): QuakeImpactParticleFlow {
  return {
    clear: () => undefined,
    dispose: () => undefined,
    setEnabled: () => undefined,
    spawnBlood: () => undefined,
    spawnExplosion: () => undefined,
    spawnWallImpact: () => undefined,
  };
}

function createNoopQuakeEffectSpriteFlow(): QuakeEffectSpriteFlow {
  return {
    clear: () => undefined,
    dispose: () => undefined,
    preload: async () => false,
    setEnabled: () => undefined,
    spawnExplosion: () => undefined,
  };
}

function quakeWallImpactParticleCount(effect: QuakeWeaponWallImpactEffect): number {
  if (effect === "spike") return 4;
  if (effect === "superspike") return 6;
  return 5;
}

function setQuakeDebugShowMenuOption(visible: boolean): void {
  quakeDebugPanelFlow.setShowMenuOption(visible);
}

function handleQuakeMenuVisibilityChange(visible: boolean): void {
  setQuakeDebugShowMenuOption(visible);
  if (visible && quakeGameplayStarted && document.pointerLockElement === host) {
    document.exitPointerLock();
  }
  syncQuakeInteractionPresentation();
}

function toggleQuakeDebugModeShortcut(): void {
  showQuakeShortcutState("Debug", quakeDebugPanelFlow.toggleMode());
}

function toggleQuakeOutlineTextureModeShortcut(): void {
  showQuakeShortcutState("Outlines", quakeDebugPanelFlow.toggleOutlineTextureMode());
}

function syncQuakeDebugRecordingButton(recording: boolean): void {
  if (!quakeDebugRecordingPanelEnabled || !debugRecordingButton) return;
  debugRecordingButton.textContent = recording ? "STOP" : "RECORD";
  debugRecordingButton.setAttribute("aria-pressed", String(recording));
  debugRecordingButton.setAttribute("aria-label", recording ? "Stop debug recording" : "Start debug recording");
}

function handleQuakeDebugRecordingButtonClick(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  if (!quakeDebugRecordingPanelEnabled) return;
  if (quakeDebugRecorder.isRecording()) {
    quakeDebugRecorder.stop("stop");
    return;
  }
  if (quakeAppLoading || currentResult === null) {
    const recordingStatus = debugStatElements.get("recording");
    if (recordingStatus) recordingStatus.textContent = "load first";
    return;
  }
  quakeDebugRecorder.start();
}

function syncQuakeInteractionPresentation(): void {
  const menuSurfaceOpen = menu.isMainMenuOpen() || menu.isMenuPanelOpen();
  const pointerUnlocked = document.pointerLockElement !== host;
  const mobileControlsAvailable = quakePointerGameplay.isMobileAvailable();
  const intermissionActive = quakeIntermission.active();
  const gameplayPointerUnlocked = quakeGameplayStarted &&
    pointerUnlocked &&
    !mobileControlsAvailable &&
    !intermissionActive;
  const debugPointerUnlocked = quakeDebugPanelFlow.isModeEnabled() && pointerUnlocked;
  const clickToPlayVisible = gameplayPointerUnlocked && !menuSurfaceOpen && !quakeMultiplayerSpectating;
  setQuakeClickToPlayPauseState(clickToPlayVisible);
  setQuakeBodyClass("quake-debug-active", quakeDebugPanelFlow.isModeEnabled());
  setQuakeBodyClass("quake-debug-pointer-unlocked", debugPointerUnlocked);
  setQuakeBodyClass("quake-menu-unlocked", menuSurfaceOpen || gameplayPointerUnlocked || debugPointerUnlocked);
  syncQuakeClickToPlayCenterPrint(clickToPlayVisible);
}

function syncQuakeClickToPlayCenterPrint(visible: boolean): void {
  if (visible) {
    if (!quakeClickToPlayCenterPrintVisible) {
      quakeTextPresentation.setCenterPrint("CLICK TO PLAY");
      quakeClickToPlayCenterPrintVisible = true;
    }
    return;
  }
  if (!quakeClickToPlayCenterPrintVisible) return;
  quakeClickToPlayCenterPrintVisible = false;
  if (!quakeMultiplayerSpectating) quakeTextPresentation.clearCenterPrint();
}

function handleQuakeDebugDisableAttacksOptionChange(event: Event): void {
  setQuakeAttacksDisabled((event.currentTarget as HTMLInputElement).checked);
}

function handleQuakeDebugFreezeEnemiesOptionChange(event: Event): void {
  setQuakeEnemiesFrozen((event.currentTarget as HTMLInputElement).checked);
}

function quitQuakeToMainMenu(): void {
  quakePlayerLifecycle.quitToMainMenu();
}

function setQuakeDebugFlyMode(enabled: boolean): void {
  quakeDebugFly.setEnabled(enabled);
  world.setDebugShellVisible(enabled);
  world.syncVisibility(true);
}

function syncQuakeDebugFlyMode(): void {
  quakeDebugFly.syncMode();
  world.setDebugShellVisible(quakeDebugFly.isEnabled());
  world.syncVisibility(true);
}

function respawnQuakePlayerFromFlyMode(): boolean {
  return quakePlayerLifecycle.respawnFromFlyMode();
}

function setQuakeInvertMouse(invert: boolean): void {
  quakeInvertMouse = invert;
  controls.update({ invertY: invert });
  quakeOptions.syncControls();
}

function setQuakeAlwaysRun(alwaysRun: boolean): void {
  quakeAlwaysRun = alwaysRun;
  quakeOptions.syncControls();
}

function syncQuakeOptionControls(): void {
  quakeOptions.syncControls();
  syncQuakeDebugFreezeEnemiesOption();
  syncQuakeDebugDisableAttacksOption();
}

function clearQuakeLevelLoadTimer(): void {
  quakeEntityActivation.clearLevelLoadTimer();
}

function clearQuakeLevelComplete(): void {
  quakeIntermission.clear();
  quakePlayerLifecycle.clearLevelComplete();
  syncQuakeInteractionPresentation();
}

function requestQuakeIntermissionAdvance(): boolean {
  return quakeEntityActivation.requestIntermissionAdvance();
}

function requestQuakeIntermissionAdvanceFromKey(event: KeyboardEvent): boolean {
  if (event.code !== "Space" || quakeGameplayInput.isEditableTarget(event.target)) return false;
  return requestQuakeIntermissionAdvance();
}

function isQuakeDeathUnlockControlsEndTraceSuppressed(now = performance.now()): boolean {
  return quakePlayerLifecycle.isDeathUnlockControlsEndTraceSuppressed(now);
}

function suppressQuakeMainMenuOnResumeControlsEnd(): void {
  quakePlayerLifecycle.suppressMainMenuOnResumeControlsEnd();
}

function clearQuakeMainMenuControlsEndSuppression(): void {
  quakePlayerLifecycle.clearMainMenuControlsEndSuppression();
}

function shouldOpenQuakeMainMenuOnControlsEnd(): boolean {
  return quakePlayerLifecycle.shouldOpenMainMenuOnControlsEnd();
}

function showQuakePlayerDeath(details?: QuakePlayerDeathDetails): void {
  quakePlayerLifecycle.showPlayerDeath(details);
}

function clearQuakePlayerDeath(): void {
  quakePlayerLifecycle.clearPlayerDeath();
}

function respawnQuakePlayerFromDeath(): boolean {
  return quakePlayerLifecycle.respawnFromDeath();
}

async function startQuakeNewGame(): Promise<void> {
  requestQuakeLandscapeOnMobile(quakeApp).then((result) => {
    markQuakeTrace("landscape-lock-request", result);
  }).catch((error: unknown) => {
    markQuakeTrace("landscape-lock-request", {
      reason: "unexpected-error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
  await quakePlayerLifecycle.startNewGame();
}

function resumeQuakeGameplayAfterMapLoad(): void {
  quakePlayerLifecycle.resumeGameplayAfterMapLoad();
}

function isQuakeLevelTransitionActive(): boolean {
  return quakePlayerLifecycle.isLevelTransitionActive();
}

function canUseQuakeGameplayInput(): boolean {
  return !quakeMultiplayerSpectating && !isQuakeGamePaused() && quakePlayerLifecycle.canUseGameplayInput();
}

function shouldResumeQuakeMainMenuOnEscape(): boolean {
  return quakePlayerLifecycle.shouldResumeMainMenuOnEscape();
}

function isQuakeDebugFlyModeActive(): boolean {
  return quakeDebugFly.isActive();
}

function quakePointerTrace(kind: string, details: QuakePointerTraceDetails = {}): void {
  quakePointerTracer.trace(kind, details);
}

function syncQuakePointerTraceAccessors(): void {
  quakePointerTracer.syncAccessors();
}

function setQuakeLoading(
  active: boolean,
  status = "Loading",
  options: { preserveConsole?: boolean } = {},
): void {
  quakeLoading.setLoading(active, status, options);
}

function setQuakeLoadingError(error?: unknown): void {
  quakeLoading.setError(error);
}

function setQuakeAssetsRegenerating(message?: string): void {
  quakeLoading.setAssetsRegenerating(message);
}

function createQuakeRemotePlayerVisual(
  playerState: QuakeMultiplayerAuthoritativePlayerState,
): QuakeMultiplayerRemoteVisualHandle | null {
  const remote = addQuakeRemotePlayerMesh();
  if (!remote) return null;
  remote.handle.element.classList.add("remote-player", "remote-player-prototype");
  remote.handle.element.dataset.playerId = playerState.playerId;
  remote.handle.element.dataset.clientId = playerState.clientId;
  if (playerState.color) {
    remote.handle.element.dataset.playerColor = playerState.color;
    remote.handle.element.style.setProperty("--quake-multiplayer-player-color", playerState.color);
  }
  stripPolyMeshMetadata(remote.handle.element);
  return {
    element: remote.handle.element,
    setState: (state) => syncQuakeRemotePlayerVisual(remote, state),
    remove: () => remote.handle.remove(),
  };
}

interface QuakeRemotePlayerMeshMount {
  handle: PolyMeshHandle;
  deathFrameIndexes: readonly number[];
  painFrameIndexes: readonly number[];
  runFrameIndexes: readonly number[];
  scale: number;
  standFrameIndex: number;
  zOffset: number;
}

function addQuakeRemotePlayerMesh(): QuakeRemotePlayerMeshMount | null {
  const model = quakeRemotePlayerModel();
  const frameSet = model ? quakePickupModelRenderBundleFrameSet(model) : undefined;
  const handle = frameSet
    ? mountQuakeRenderBundleFrameSetMesh(sceneElement, frameSet, quakeRemotePlayerDefaultFrameIndex(frameSet))
    : model
    ? mountQuakeRenderBundleMesh(sceneElement, quakePickupModelRenderBundle(model, 0))
    : addQuakeProceduralRemotePlayerMesh();
  if (!handle) return null;
  const standFrameIndex = frameSet ? quakeRemotePlayerDefaultFrameIndex(frameSet) : 0;
  world.pixelate(handle);
  void world.schedulePresentationResync(handle);
  return {
    handle,
    deathFrameIndexes: frameSet ? quakeRemotePlayerFrameIndexes(frameSet, QUAKE_MULTIPLAYER_REMOTE_DEATH_FRAME_PREFIX) : [],
    painFrameIndexes: frameSet ? quakeRemotePlayerFrameIndexes(frameSet, QUAKE_MULTIPLAYER_REMOTE_PAIN_FRAME_PREFIX) : [],
    runFrameIndexes: frameSet ? quakeRemotePlayerFrameIndexes(frameSet, QUAKE_MULTIPLAYER_REMOTE_RUN_FRAME_PREFIX) : [],
    scale: model?.renderScale ? 1 / model.renderScale : 1,
    standFrameIndex,
    zOffset: model ? quakeRemotePlayerModelZOffset(model) : -QUAKE_MULTIPLAYER_REMOTE_PLAYER_EYE_HEIGHT,
  };
}

function quakeRemotePlayerModel(): QuakePickupModel | null {
  const library = currentPickupModelLibrary;
  if (!library) return null;
  for (const modelPath of QUAKE_MULTIPLAYER_REMOTE_MODEL_PATHS) {
    const model = library.models[modelPath];
    if (model) return model;
  }
  return null;
}

function syncQuakeRemotePlayerVisual(
  remote: QuakeRemotePlayerMeshMount,
  state: QuakeMultiplayerRemoteInterpolationState,
): void {
  const { handle } = remote;
  handle.element.hidden = state.stale;
  setQuakeRenderBundleFrameSetHandleFrame(handle, quakeRemotePlayerVisualFrameIndex(remote, state));
  const rotY = quakeRemotePlayerVisualRotY(state);
  handle.setTransform({
    position: quakeRemotePlayerVisualOrigin(state.renderOrigin, remote.zOffset),
    rotation: [0, 0, rotY + quakeRemotePlayerVisualRotYOffset(handle.element)],
    scale: remote.scale,
  });
}

function quakeRemotePlayerDefaultFrameIndex(frameSet: QuakeRenderBundleFrameSet): number {
  const frameIndex = frameSet.frames.findIndex((frame) => frame.name === QUAKE_MULTIPLAYER_REMOTE_DEFAULT_FRAME);
  return frameIndex >= 0 ? frameIndex : 0;
}

function quakeRemotePlayerFrameIndexes(
  frameSet: QuakeRenderBundleFrameSet,
  prefix: string,
): readonly number[] {
  return frameSet.frames
    .map((frame, index) => ({ frame, index }))
    .filter(({ frame }) => frame.name.startsWith(prefix))
    .map(({ index }) => index);
}

function quakeRemotePlayerVisualFrameIndex(
  remote: QuakeRemotePlayerMeshMount,
  state: QuakeMultiplayerRemoteInterpolationState,
): number {
  if (!state.alive) {
    return quakeRemotePlayerVisualTimelineFrameIndex(
      remote.deathFrameIndexes,
      state.deathAt ?? state.renderAt,
      state.renderAt,
      QUAKE_MULTIPLAYER_REMOTE_DEATH_FPS,
      false,
      remote.standFrameIndex,
    );
  }
  if (state.lastPainAt !== undefined) {
    const painFrameIndex = quakeRemotePlayerVisualTransientFrameIndex(
      remote.painFrameIndexes,
      state.lastPainAt,
      state.renderAt,
      QUAKE_MULTIPLAYER_REMOTE_PAIN_FPS,
    );
    if (painFrameIndex !== null) return painFrameIndex;
  }
  const speed = quakeRemotePlayerHorizontalSpeed(state);
  if (speed < QUAKE_MULTIPLAYER_REMOTE_RUN_SPEED_THRESHOLD || !remote.runFrameIndexes.length) {
    return remote.standFrameIndex;
  }
  const runFrame = Math.floor(state.renderAt / (1000 / QUAKE_MULTIPLAYER_REMOTE_RUN_FPS));
  return remote.runFrameIndexes[runFrame % remote.runFrameIndexes.length] ?? remote.standFrameIndex;
}

function quakeRemotePlayerVisualTransientFrameIndex(
  frameIndexes: readonly number[],
  startedAt: number,
  renderAt: number,
  fps: number,
): number | null {
  if (!frameIndexes.length || fps <= 0) return null;
  const frameMs = 1000 / fps;
  const elapsedMs = renderAt - startedAt;
  if (elapsedMs >= frameIndexes.length * frameMs) return null;
  const frame = Math.floor(Math.max(0, elapsedMs) / frameMs);
  return frameIndexes[Math.min(frame, frameIndexes.length - 1)] ?? null;
}

function quakeRemotePlayerVisualTimelineFrameIndex(
  frameIndexes: readonly number[],
  startedAt: number,
  renderAt: number,
  fps: number,
  loop: boolean,
  fallbackFrameIndex: number,
): number {
  if (!frameIndexes.length || fps <= 0) return fallbackFrameIndex;
  const frame = Math.floor(Math.max(0, renderAt - startedAt) / (1000 / fps));
  const index = loop ? frame % frameIndexes.length : Math.min(frame, frameIndexes.length - 1);
  return frameIndexes[index] ?? fallbackFrameIndex;
}

function quakeRemotePlayerModelZOffset(model: QuakePickupModel): number {
  return -QUAKE_MULTIPLAYER_REMOTE_PLAYER_EYE_HEIGHT - (model.bounds?.min[2] ?? 0);
}

function quakeRemotePlayerVisualOrigin(origin: Vec3, zOffset: number): Vec3 {
  return [
    origin[0],
    origin[1],
    origin[2] + zOffset,
  ];
}

function quakeRemotePlayerVisualRotY(state: QuakeMultiplayerRemoteInterpolationState): number {
  const speed = quakeRemotePlayerHorizontalSpeed(state);
  if (speed < QUAKE_MULTIPLAYER_REMOTE_RUN_SPEED_THRESHOLD) return state.renderRotY;
  return normalizeQuakeUrlAngle((Math.atan2(state.renderVelocity[1], state.renderVelocity[0]) * 180) / Math.PI);
}

function quakeRemotePlayerHorizontalSpeed(state: QuakeMultiplayerRemoteInterpolationState): number {
  return Math.hypot(state.renderVelocity[0], state.renderVelocity[1]);
}

function quakeRemotePlayerVisualRotYOffset(element: HTMLElement): number {
  return element.classList.contains("remote-player-fallback")
    ? QUAKE_MULTIPLAYER_REMOTE_FALLBACK_ROT_Y_OFFSET
    : QUAKE_ALIAS_MODEL_RENDER_YAW_OFFSET;
}

function addQuakeProceduralRemotePlayerMesh(): PolyMeshHandle | null {
  const polygons = quakeRemotePlayerFallbackPolygons();
  if (!polygons.length) return null;
  const handle = scene.add(makeParseResult(polygons), {
    merge: false,
    meshResolution: "lossless",
    excludeFromAutoCenter: true,
  });
  handle.element.classList.add("remote-player-fallback");
  return handle;
}

function quakeRemotePlayerFallbackPolygons(): Polygon[] {
  const halfWidth = 0.22;
  const halfDepth = 0.14;
  const height = 1.58;
  const shoulder = 1.2;
  const head = 1.72;
  const minX = -halfWidth;
  const maxX = halfWidth;
  const minY = -halfDepth;
  const maxY = halfDepth;
  return [
    quakeRemotePlayerQuad([minX, minY, 0], [maxX, minY, 0], [maxX, minY, shoulder], [minX, minY, shoulder], "#49656f"),
    quakeRemotePlayerQuad([maxX, maxY, 0], [minX, maxY, 0], [minX, maxY, shoulder], [maxX, maxY, shoulder], "#314b53"),
    quakeRemotePlayerQuad([minX, maxY, 0], [minX, minY, 0], [minX, minY, shoulder], [minX, maxY, shoulder], "#253940"),
    quakeRemotePlayerQuad([maxX, minY, 0], [maxX, maxY, 0], [maxX, maxY, shoulder], [maxX, minY, shoulder], "#38555e"),
    quakeRemotePlayerQuad([-0.16, -0.1, shoulder], [0.16, -0.1, shoulder], [0.16, -0.1, head], [-0.16, -0.1, head], "#b59162"),
    quakeRemotePlayerQuad([-0.12, -0.12, height], [0.12, -0.12, height], [0.12, 0.12, height], [-0.12, 0.12, height], "#6c3f2a"),
  ];
}

function quakeRemotePlayerQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: string): Polygon {
  return {
    color,
    vertices: [a, b, c, d],
  };
}

function quakeUrlRouteView(route: QuakeUrlRoute): QuakeCssView | null {
  return quakeRoute.routeView(route);
}

function quakeMapLoadView(options: QuakeMapLoadOptions): QuakeCssView | null {
  return quakeRoute.mapLoadView(options);
}

function currentQuakeMultiplayerRoomKey(): QuakeMultiplayerRoomCompatibilityKey | null {
  if (!currentResult) return null;
  const sceneUrl = quakeAssetCatalog.sceneUrl(currentMapName);
  if (!sceneUrl) return null;
  return {
    mapName: currentMapName,
    assetManifestVersion: quakeAssetCatalog.version(),
    assetRoot: quakeAssetCatalog.assetRoot() ?? QUAKE_ASSET_ROOT,
    sceneUrl: new URL(sceneUrl, window.location.href).href,
  };
}

function applyQuakeMultiplayerInitialSpawnHint(): void {
  if (!QUAKE_MULTIPLAYER_ENABLED || !currentResult || quakeMultiplayerLocalSpawnId) return;
  const gameplayDefinitions = quakeMultiplayerGameplayDefinitionsFromScene(currentResult, {
    pointToRoom: quakeCameraView.pointToPoly,
    playerEyeHeight: getPlayer().eyeHeight(),
    playerMinsZ: QUAKE_PLAYER_MINS_Z,
  });
  const spawn = quakeMultiplayerDeathmatchSpawnOrder(gameplayDefinitions.deathmatchSpawns)[0];
  if (!spawn) return;
  quakeMultiplayerLocalSpawnId = spawn.spawnId;
  applyQuakeMultiplayerView(spawn.origin, spawn.rotX, spawn.rotY);
}

function quakeMultiplayerRoomId(roomKey: QuakeMultiplayerRoomCompatibilityKey): string {
  return QUAKE_MULTIPLAYER_ROOM_ID || quakeMultiplayerFallbackRoomId(roomKey.mapName);
}

function quakeMultiplayerMatchSettings(): { fragLimit: number; maxPlayers: number } {
  return {
    fragLimit: QUAKE_MULTIPLAYER_FRAG_LIMIT,
    maxPlayers: QUAKE_MULTIPLAYER_MAX_PLAYERS,
  };
}

function mountQuakeMultiplayerScoreboard(root: HTMLElement): HTMLElement {
  const scoreboard = document.createElement("section");
  scoreboard.id = "quake-multiplayer-scoreboard";
  scoreboard.className = "quake-multiplayer-scoreboard";
  scoreboard.setAttribute("aria-label", "Deathmatch scoreboard");
  scoreboard.hidden = true;
  root.append(scoreboard);
  return scoreboard;
}

function syncQuakeMultiplayerScoreboard(
  players: readonly QuakeMultiplayerAuthoritativePlayerState[],
  spectatorCount = 0,
): void {
  if (!quakeMultiplayerScoreboard) return;
  if (!players.length) {
    quakeMultiplayerScoreboard.hidden = true;
    quakeMultiplayerScoreboard.replaceChildren();
    return;
  }
  quakeMultiplayerScoreboard.hidden = false;
  const rows = [...players].sort((a, b) =>
    b.frags - a.frags ||
    a.deaths - b.deaths ||
    a.displayName.localeCompare(b.displayName)
  );
  const table = document.createElement("table");
  table.className = "quake-multiplayer-scoreboard-table";
  const body = document.createElement("tbody");
  for (const playerState of rows) {
    const row = document.createElement("tr");
    row.className = playerState.clientId === QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID
      ? "quake-multiplayer-scoreboard-local"
      : "";
    if (playerState.color) row.style.setProperty("--quake-multiplayer-player-color", playerState.color);
    row.append(
      quakeScoreboardCell(playerState.displayName),
      quakeScoreboardCell(String(playerState.frags), "number"),
      quakeScoreboardCell(String(playerState.deaths), "number"),
      quakeScoreboardCell(playerState.pingMs === undefined ? "-" : String(Math.round(playerState.pingMs)), "number"),
    );
    body.append(row);
  }
  table.append(body);
  const children: HTMLElement[] = [table];
  if (spectatorCount > 0) {
    const spectators = document.createElement("div");
    spectators.className = "quake-multiplayer-scoreboard-spectators quake-bm-label";
    spectators.textContent = quakeMultiplayerSpectatorCountLabel(spectatorCount);
    mountQuakeBitmapText(spectators);
    children.push(spectators);
  }
  quakeMultiplayerScoreboard.replaceChildren(...children);
}

function quakeScoreboardCell(text: string, kind?: "number"): HTMLTableCellElement {
  const cell = document.createElement("td");
  if (kind) cell.className = `quake-multiplayer-scoreboard-${kind}`;
  cell.textContent = text;
  cell.classList.add("quake-bm-label");
  mountQuakeBitmapText(cell);
  return cell;
}

function quakeMultiplayerSpectatorCountLabel(count: number): string {
  return count === 1 ? "1 SPECTATOR" : `${count} SPECTATORS`;
}

function quakeMultiplayerDebugSnapshot(): Record<string, unknown> {
  const status = quakeMultiplayerSession.status();
  return {
    enabled: QUAKE_MULTIPLAYER_ENABLED,
    transport: QUAKE_MULTIPLAYER_TRANSPORT,
    partyHost: QUAKE_MULTIPLAYER_TRANSPORT === "party" ? QUAKE_MULTIPLAYER_PARTY_HOST : null,
    region: QUAKE_MULTIPLAYER_REGION,
    regionLabel: quakeMultiplayerRegionLabel(QUAKE_MULTIPLAYER_REGION),
    clientId: QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID,
    roomId: QUAKE_MULTIPLAYER_ROOM_ID || quakeMultiplayerFallbackRoomId(currentMapName),
    localPingMs: quakeMultiplayerLocalPingMs,
    sessionState: status.state,
    sessionMode: status.mode,
    roomKey: status.roomKey ?? null,
    helloAccepted: quakeMultiplayerHelloAccepted,
    spectating: quakeMultiplayerSpectating,
    spectatorCount: quakeMultiplayerSpectatorCount,
    spectatorFollowedPlayerId: quakeMultiplayerSpectatorFollowedPlayerId,
    inputPaused: quakeMultiplayerInputPaused,
    inputSequence: quakeMultiplayerInputSequence,
    poseSequence: quakeMultiplayerPoseSequence,
    worldSequence: quakeMultiplayerWorldSequence,
    poseOnly: QUAKE_MULTIPLAYER_DEBUG_POSE_ONLY,
    match: quakeMultiplayerLastMatchState,
    lastRoomEvent: quakeMultiplayerLastRoomEvent,
    recentRoomEvents: quakeMultiplayerRecentRoomEvents,
    lastWorldEvent: quakeMultiplayerLastWorldEvent,
    recentWorldEvents: quakeMultiplayerRecentWorldEvents,
    lastPlayerEvent: quakeMultiplayerLastPlayerEvent,
    recentPlayerEvents: quakeMultiplayerRecentPlayerEvents,
    lastPickupEvent: quakeMultiplayerLastPickupEvent,
    lastMatchEvent: quakeMultiplayerLastMatchEvent,
    lastReject: quakeMultiplayerLastReject,
    lastError: quakeMultiplayerLastError,
    remotePresenterCount: quakeRemotePlayers.count(),
    remoteDomCount: document.querySelectorAll(".remote-player").length,
    remoteVisibleDomCount: Array.from(document.querySelectorAll<HTMLElement>(".remote-player"))
      .filter((element) => !element.hidden).length,
    scoreboardRows: quakeMultiplayerScoreboard?.querySelectorAll("tbody tr").length ?? 0,
  };
}

function startQuakeMultiplayerScene(): void {
  stopQuakeMultiplayerScene("scene-restart");
  if (!QUAKE_MULTIPLAYER_ENABLED || quakeAppDisposed) return;
  const roomKey = currentQuakeMultiplayerRoomKey();
  if (!roomKey) return;
  applyQuakeMultiplayerInitialSpawnHint();
  const sceneSerial = ++quakeMultiplayerSceneSerial;
  void quakeMultiplayerSession.connect({
    roomKey,
    clientId: QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID,
    displayName: QUAKE_MULTIPLAYER_LOCAL_DISPLAY_NAME,
    color: QUAKE_MULTIPLAYER_LOCAL_COLOR,
  }).then((status) => {
    if (
      quakeAppDisposed ||
      sceneSerial !== quakeMultiplayerSceneSerial ||
      status.state !== "connected"
    ) {
      return;
    }
    sendQuakeMultiplayerHello(roomKey);
    scheduleQuakeMultiplayerPoseFrame();
  }).catch((error: unknown) => {
    console.warn("[cssQuake] Multiplayer session failed.", error);
  });
}

function stopQuakeMultiplayerScene(
  reason: string,
  options: { preserveLastReject?: boolean } = {},
): void {
  quakeMultiplayerSceneSerial++;
  if (quakeMultiplayerPoseFrame) {
    window.cancelAnimationFrame(quakeMultiplayerPoseFrame);
    quakeMultiplayerPoseFrame = 0;
  }
  quakeMultiplayerLastInputAt = 0;
  quakeMultiplayerLastPoseAt = 0;
  quakeMultiplayerLastPresenceStatusSent = null;
  quakeMultiplayerHelloAccepted = false;
  quakeMultiplayerSpectatorCount = 0;
  setQuakeMultiplayerSpectating(false);
  quakeMultiplayerLocalSpawnId = null;
  quakeMultiplayerLocalPingMs = null;
  quakeMultiplayerLastReconciledInputSequence = 0;
  quakeMultiplayerLastInventoryFingerprint = null;
  quakeMultiplayerPickupRequestAt.clear();
  quakeMultiplayerWorldRequestAt.clear();
  quakeMultiplayerLastRoomEvent = null;
  quakeMultiplayerRecentRoomEvents = [];
  quakeMultiplayerLastWorldEvent = null;
  quakeMultiplayerRecentWorldEvents = [];
  quakeMultiplayerLastPlayerEvent = null;
  quakeMultiplayerRecentPlayerEvents = [];
  quakeMultiplayerLastPickupEvent = null;
  quakeMultiplayerLastMatchState = null;
  quakeMultiplayerLastMatchEvent = null;
  if (!options.preserveLastReject) quakeMultiplayerLastReject = null;
  quakeMultiplayerLastError = null;
  quakeMultiplayerSession.disconnect(reason);
  quakeRemotePlayers.clear();
  syncQuakeMultiplayerScoreboard([]);
}

function setQuakeMultiplayerSpectating(
  spectating: boolean,
  followedPlayer?: QuakeMultiplayerAuthoritativePlayerState | null,
): void {
  const previousSpectating = quakeMultiplayerSpectating;
  quakeMultiplayerSpectating = spectating;
  quakeMultiplayerSpectatorFollowedPlayerId = spectating && followedPlayer ? followedPlayer.playerId : null;
  if (spectating && quakeMultiplayerPoseFrame) {
    window.cancelAnimationFrame(quakeMultiplayerPoseFrame);
    quakeMultiplayerPoseFrame = 0;
  }
  if (spectating && quakeClickToPlayCenterPrintVisible) {
    quakeClickToPlayCenterPrintVisible = false;
  }
  syncQuakeViewmodelVisibility();
  if (!spectating) {
    quakeMultiplayerSpectatorCenterPrint = "";
    if (previousSpectating) quakeTextPresentation.clearCenterPrint();
    return;
  }
  const nextText = followedPlayer
    ? `SPECTATING\n${followedPlayer.displayName}\n${quakeMultiplayerSpectatorCountLabel(quakeMultiplayerSpectatorCount)}`
    : `SPECTATING\n${quakeMultiplayerSpectatorCountLabel(quakeMultiplayerSpectatorCount)}`;
  if (nextText === quakeMultiplayerSpectatorCenterPrint) return;
  quakeMultiplayerSpectatorCenterPrint = nextText;
  quakeTextPresentation.setCenterPrint(nextText);
}

function handleQuakeMultiplayerRoomMessage(message: QuakeMultiplayerRoomEnvelope): void {
  if (!QUAKE_MULTIPLAYER_ENABLED) return;
  if (message.type === "room.snapshot") {
    quakeMultiplayerLastMatchState = message.payload.match;
    quakeMultiplayerSpectatorCount = message.payload.spectators?.length ?? 0;
    syncQuakeMultiplayerScoreboard(message.payload.players, quakeMultiplayerSpectatorCount);
    if (message.payload.pickups) syncQuakeMultiplayerPickupStates(message.payload.pickups);
    const localPlayer = message.payload.players.find((candidate) =>
      candidate.clientId === QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID
    );
    quakeMultiplayerLocalPingMs = localPlayer?.pingMs ?? null;
    if (localPlayer) {
      setQuakeMultiplayerSpectating(false);
      quakeMultiplayerHelloAccepted = true;
      applyQuakeMultiplayerAuthoritativePlayerState(localPlayer);
    } else if (message.payload.spectators?.some((spectator) =>
      spectator.clientId === QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID
    )) {
      quakeMultiplayerHelloAccepted = true;
      applyQuakeMultiplayerSpectatorSnapshot(message.payload.players);
    }
    quakeRemotePlayers.handleRoomMessage(message);
  } else if (message.type === "room.event") {
    quakeRemotePlayers.handleRoomMessage(message);
    const event = message.payload.event;
    noteQuakeMultiplayerRoomEvent(event);
    noteQuakeMultiplayerWorldEvent(event);
    noteQuakeMultiplayerMatchEvent(event);
    noteQuakeMultiplayerPickupEvent(event);
    if (event.eventType === "player.respawned") {
      const playerState = event.player;
      if (playerState.clientId === QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID) {
        quakeMultiplayerLocalSpawnId = null;
        applyQuakeMultiplayerAuthoritativePlayerState(playerState);
      }
    } else if (event.eventType === "pickup.taken") {
      const localPlayerId = quakeMultiplayerPlayerIdForClient(QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID);
      getPickups().applyAuthoritativePickup(event.entityIndex, {
        applyEffect: event.playerId === localPlayerId,
        feedback: event.feedback,
        hide: !event.leaveInPlace,
      });
    } else if (event.eventType === "pickup.respawned") {
      getPickups().applyAuthoritativeRespawn(event.pickup.entityIndex);
    } else if (event.eventType === "player.damaged") {
      handleQuakeMultiplayerPlayerDamaged(event);
    } else if (event.eventType === "player.killed") {
      handleQuakeMultiplayerPlayerKilled(event);
    } else if (event.eventType === "world.changed") {
      handleQuakeMultiplayerWorldChanged(event);
    } else if (event.eventType === "world.teleport") {
      handleQuakeMultiplayerWorldTeleport(event);
    } else if (event.eventType === "world.push") {
      handleQuakeMultiplayerWorldPush(event);
    } else if (event.eventType === "world.trigger") {
      handleQuakeMultiplayerWorldTrigger(event);
    } else if (event.eventType === "world.mover") {
      handleQuakeMultiplayerWorldMover(event);
    } else if (event.eventType === "world.targets") {
      handleQuakeMultiplayerWorldTargets(event);
    }
  } else if (message.type === "room.ping") {
    sendQuakeMultiplayerPong(message.payload);
  } else if (message.type === "room.reject") {
    handleQuakeMultiplayerRoomReject(message.payload);
  } else if (message.type === "room.error") {
    handleQuakeMultiplayerRoomError(message.payload);
  }
}

function handleQuakeMultiplayerRoomReject(payload: QuakeMultiplayerRoomRejectPayload): void {
  quakeMultiplayerLastReject = {
    code: payload.code,
    message: payload.message,
    recoverable: payload.recoverable,
    ...(payload.rejectedMessageId ? { rejectedMessageId: payload.rejectedMessageId } : {}),
    ...(payload.retryAfterMs !== undefined ? { retryAfterMs: payload.retryAfterMs } : {}),
    ...(payload.details ? { details: payload.details } : {}),
  };
  const label = quakeMultiplayerRejectLabel(payload.code);
  const fatalTitle = payload.recoverable ? null : quakeMultiplayerFatalRejectTitle(payload.code);
  if (fatalTitle) {
    stopQuakeMultiplayerScene(`reject:${payload.code}`, { preserveLastReject: true });
    quakeTextPresentation.clear();
    menu.showMultiplayerFailure(fatalTitle);
    return;
  }
  if (!payload.recoverable && payload.code !== "unsupported") {
    quakeTextPresentation.notify(`Multiplayer rejected: ${label}`);
  }
}

function handleQuakeMultiplayerRoomError(payload: QuakeMultiplayerRoomErrorPayload): void {
  quakeMultiplayerLastError = {
    code: payload.code,
    message: payload.message,
    recoverable: payload.recoverable,
    ...(payload.details ? { details: payload.details } : {}),
  };
  if (!payload.recoverable) {
    quakeTextPresentation.notify(`Multiplayer error: ${payload.code}`);
  }
}

function quakeMultiplayerRejectLabel(code: QuakeMultiplayerRoomRejectPayload["code"]): string {
  switch (code) {
    case "wrong-map":
      return "wrong map";
    case "wrong-protocol":
      return "wrong protocol";
    case "room-full":
      return "room full";
    case "not-authorized":
      return "not authorized";
    default:
      return code;
  }
}

function quakeMultiplayerFatalRejectTitle(code: QuakeMultiplayerRoomRejectPayload["code"]): string | null {
  switch (code) {
    case "room-full":
      return "ROOM FULL";
    case "wrong-map":
      return "WRONG MAP";
    case "wrong-protocol":
      return "WRONG VERSION";
    case "not-authorized":
      return "NOT AUTHORIZED";
    default:
      return null;
  }
}

function noteQuakeMultiplayerMatchEvent(event: QuakeMultiplayerSharedWorldEvent): void {
  if (event.eventType !== "match.notice") return;
  quakeMultiplayerLastMatchEvent = {
    eventType: event.eventType,
    eventId: event.eventId,
    roomTime: event.roomTime,
    code: event.code,
    ...(event.message ? { message: event.message } : {}),
  };
}

function noteQuakeMultiplayerRoomEvent(event: QuakeMultiplayerSharedWorldEvent): void {
  const snapshot = {
    eventType: event.eventType,
    eventId: event.eventId,
    roomTime: event.roomTime,
    ...("playerId" in event && event.playerId !== undefined ? { playerId: event.playerId } : {}),
    ...("status" in event && event.status !== undefined ? { status: event.status } : {}),
    ...("entityIndex" in event && event.entityIndex !== undefined ? { entityIndex: event.entityIndex } : {}),
    ...("classname" in event && event.classname !== undefined ? { classname: event.classname } : {}),
    ...("activation" in event && event.activation !== undefined ? { activation: event.activation } : {}),
    ...("code" in event && event.code !== undefined ? { code: event.code } : {}),
  };
  quakeMultiplayerLastRoomEvent = snapshot;
  quakeMultiplayerRecentRoomEvents = [...quakeMultiplayerRecentRoomEvents.slice(-15), snapshot];
}

function noteQuakeMultiplayerWorldEvent(event: QuakeMultiplayerSharedWorldEvent): void {
  if (!event.eventType.startsWith("world.") && event.eventType !== "level.transition") return;
  const snapshot = {
    eventType: event.eventType,
    eventId: event.eventId,
    roomTime: event.roomTime,
    ...("entityIndex" in event && event.entityIndex !== undefined ? { entityIndex: event.entityIndex } : {}),
    ...("classname" in event ? { classname: event.classname } : {}),
    ...("activation" in event ? { activation: event.activation } : {}),
    ...("origin" in event ? { origin: event.origin } : {}),
    ...("velocity" in event ? { velocity: event.velocity } : {}),
    ...("state" in event ? { state: event.state } : {}),
    ...("destinationEntityIndex" in event && event.destinationEntityIndex !== undefined
      ? { destinationEntityIndex: event.destinationEntityIndex }
      : {}),
    ...("fromOrigin" in event ? { fromOrigin: event.fromOrigin } : {}),
    ...("toOrigin" in event ? { toOrigin: event.toOrigin } : {}),
    ...("speed" in event ? { speed: event.speed } : {}),
    ...("moveMs" in event ? { moveMs: event.moveMs } : {}),
    ...("returnDelayMs" in event && event.returnDelayMs !== undefined
      ? { returnDelayMs: event.returnDelayMs }
      : {}),
    ...("targetEntityIndexes" in event ? { targetEntityIndexes: event.targetEntityIndexes } : {}),
    ...("killtargetEntityIndexes" in event && event.killtargetEntityIndexes !== undefined
      ? { killtargetEntityIndexes: event.killtargetEntityIndexes }
      : {}),
    ...("delayMs" in event ? { delayMs: event.delayMs } : {}),
    ...("waitMs" in event ? { waitMs: event.waitMs } : {}),
    ...("oneShot" in event ? { oneShot: event.oneShot } : {}),
    ...("soundPath" in event && event.soundPath ? { soundPath: event.soundPath } : {}),
    ...("playerId" in event && event.playerId !== undefined ? { playerId: event.playerId } : {}),
  };
  quakeMultiplayerLastWorldEvent = snapshot;
  quakeMultiplayerRecentWorldEvents = [...quakeMultiplayerRecentWorldEvents.slice(-15), snapshot];
}

function noteQuakeMultiplayerPickupEvent(event: QuakeMultiplayerSharedWorldEvent): void {
  if (!event.eventType.startsWith("pickup.")) return;
  quakeMultiplayerLastPickupEvent = {
    eventType: event.eventType,
    eventId: event.eventId,
    roomTime: event.roomTime,
    ...("playerId" in event ? { playerId: event.playerId } : {}),
    ...("pickupId" in event && event.pickupId !== undefined ? { pickupId: event.pickupId } : {}),
    ...("entityIndex" in event ? { entityIndex: event.entityIndex } : {}),
    ...("effect" in event ? { effect: event.effect } : {}),
    ...("leaveInPlace" in event ? { leaveInPlace: event.leaveInPlace } : {}),
    ...("respawnAt" in event && event.respawnAt !== undefined ? { respawnAt: event.respawnAt } : {}),
    ...("feedback" in event && event.feedback !== undefined ? { feedback: event.feedback } : {}),
    ...("reason" in event ? { reason: event.reason } : {}),
    ...("pickup" in event ? {
      pickup: event.pickup,
      entityIndex: event.pickup.entityIndex,
      pickupId: event.pickup.pickupId,
    } : {}),
  };
}

function noteQuakeMultiplayerPlayerEvent(
  event: Extract<QuakeMultiplayerSharedWorldEvent, { eventType: "player.damaged" | "player.killed" }>,
): void {
  const snapshot = {
    eventType: event.eventType,
    eventId: event.eventId,
    roomTime: event.roomTime,
    victimPlayerId: event.victimPlayerId,
    ...("attackerPlayerId" in event && event.attackerPlayerId ? { attackerPlayerId: event.attackerPlayerId } : {}),
    ...("damage" in event ? { damage: event.damage } : {}),
    ...("health" in event ? { health: event.health } : {}),
    ...("armor" in event ? { armor: event.armor } : {}),
    ...(event.damageSource ? { damageSource: event.damageSource } : {}),
  };
  quakeMultiplayerLastPlayerEvent = snapshot;
  quakeMultiplayerRecentPlayerEvents = [...quakeMultiplayerRecentPlayerEvents.slice(-15), snapshot];
}

function applyQuakeMultiplayerSpectatorSnapshot(
  players: readonly QuakeMultiplayerAuthoritativePlayerState[],
): void {
  const followed = chooseQuakeMultiplayerSpectatorPlayer(players);
  setQuakeMultiplayerSpectating(true, followed);
  if (!followed) return;
  applyQuakeMultiplayerAuthoritativeView(followed);
}

function chooseQuakeMultiplayerSpectatorPlayer(
  players: readonly QuakeMultiplayerAuthoritativePlayerState[],
): QuakeMultiplayerAuthoritativePlayerState | null {
  const current = quakeMultiplayerSpectatorFollowedPlayerId
    ? players.find((candidate) =>
      candidate.playerId === quakeMultiplayerSpectatorFollowedPlayerId && candidate.alive
    )
    : null;
  return current ?? players.find((candidate) => candidate.alive) ?? players[0] ?? null;
}

function applyQuakeMultiplayerAuthoritativePlayerState(
  playerState: QuakeMultiplayerAuthoritativePlayerState,
): void {
  if (!player || !currentResult) return;
  const inventory = getPlayer().inventory();
  const inventoryFingerprint = quakeMultiplayerAuthoritativeInventoryFingerprint(playerState);
  const inventoryChanged = inventoryFingerprint !== quakeMultiplayerLastInventoryFingerprint;
  if (playerState.inventory) {
    if (inventoryChanged) applyQuakeMultiplayerInventoryState(playerState.inventory);
  } else {
    if (inventoryChanged) {
      inventory.health = playerState.health;
      inventory.armor = playerState.armor;
      if (isQuakeWeaponId(playerState.activeWeapon)) inventory.activeWeapon = playerState.activeWeapon;
    }
  }
  if (inventoryChanged) {
    quakeMultiplayerLastInventoryFingerprint = inventoryFingerprint;
    syncQuakeHud();
  }
  if (playerState.spawnId && playerState.spawnId !== quakeMultiplayerLocalSpawnId) {
    quakeMultiplayerLocalSpawnId = playerState.spawnId;
    quakeMultiplayerLastReconciledInputSequence = playerState.lastInputSequence;
    applyQuakeMultiplayerAuthoritativeView(playerState);
  }
  if (!playerState.alive && !quakePlayerDead) {
    quakeMultiplayerLastReconciledInputSequence = playerState.lastInputSequence;
    showQuakePlayerDeath();
  } else if (playerState.alive && quakePlayerDead) {
    clearQuakePlayerDeath();
    quakeMultiplayerLastReconciledInputSequence = playerState.lastInputSequence;
    applyQuakeMultiplayerAuthoritativeView(playerState);
  } else if (playerState.alive) {
    applyQuakeMultiplayerLocalCorrection(playerState);
  }
}

function applyQuakeMultiplayerLocalCorrection(
  playerState: QuakeMultiplayerAuthoritativePlayerState,
): void {
  const decision = decideQuakeMultiplayerLocalCorrection(
    getPlayer().currentOrigin(),
    playerState,
    quakeMultiplayerLastReconciledInputSequence,
    {
      hardSnapDistance: QUAKE_MULTIPLAYER_HARD_CORRECTION_DISTANCE,
      softCorrectionDistance: QUAKE_MULTIPLAYER_SOFT_CORRECTION_DISTANCE,
      maxBlendDistance: QUAKE_MULTIPLAYER_MAX_BLEND_CORRECTION_DISTANCE,
      blendFraction: 0.35,
    },
  );
  if (decision.reason === "within-threshold" || decision.action === "snap") {
    quakeMultiplayerLastReconciledInputSequence = Math.max(
      quakeMultiplayerLastReconciledInputSequence,
      decision.inputSequence,
    );
  }
  if (decision.action !== "snap" && decision.action !== "blend") return;
  const origin: [number, number, number] = [
    decision.origin[0],
    decision.origin[1],
    decision.origin[2],
  ];
  getPlayer().setAuthoritativeOrigin(origin);
  shootables.syncVisibility(origin, true);
  viewmodel.syncTransform();
  world.syncVisibility(true);
  syncQuakeCrosshairTarget();
  markQuakeTrace("multiplayer-correction", {
    action: decision.action,
    drift: decision.drift,
    inputSequence: decision.inputSequence,
    x: origin[0],
    y: origin[1],
    z: origin[2],
  });
}

function syncQuakeMultiplayerPickupStates(pickups: readonly QuakeMultiplayerAuthoritativePickupState[]): void {
  for (const pickup of pickups) {
    if (pickup.available) {
      getPickups().applyAuthoritativeRespawn(pickup.entityIndex);
    } else {
      getPickups().applyAuthoritativePickup(pickup.entityIndex, {
        applyEffect: false,
        hide: true,
      });
    }
  }
}

function applyQuakeMultiplayerInventoryState(state: QuakeMultiplayerInventoryState): void {
  const inventory = getPlayer().inventory();
  inventory.health = state.health;
  inventory.armor = state.armor;
  inventory.armorType = state.armorType;
  inventory.itemFlags = state.itemFlags;
  inventory.shells = state.shells;
  inventory.nails = state.nails;
  inventory.rockets = state.rockets;
  inventory.cells = state.cells;
  inventory.weapons = new Set(state.weapons.filter(isQuakeWeaponId));
  inventory.keys = new Set(state.keys.filter(isQuakeKey));
  const serverNow = Date.now();
  const localNow = performance.now();
  inventory.powerups = {};
  for (const powerup of state.powerups) {
    if (powerup.finishedAt <= serverNow) continue;
    inventory.powerups[powerup.finishedField] = {
      active: true,
      activationField: powerup.activationField,
      finishedAt: localNow + Math.max(0, powerup.finishedAt - serverNow),
      itemFlag: powerup.itemFlag,
      itemFlagExpression: powerup.itemFlagExpression ?? "",
    };
  }
  if (isQuakeWeaponId(state.activeWeapon)) inventory.activeWeapon = state.activeWeapon;
}

function quakeMultiplayerAuthoritativeInventoryFingerprint(
  playerState: QuakeMultiplayerAuthoritativePlayerState,
): string {
  return playerState.inventory
    ? quakeMultiplayerInventoryStateFingerprint(playerState.inventory)
    : [
        playerState.health,
        playerState.armor,
        playerState.activeWeapon,
      ].join(":");
}

function quakeMultiplayerInventoryStateFingerprint(state: QuakeMultiplayerInventoryState): string {
  return JSON.stringify({
    health: state.health,
    armor: state.armor,
    armorType: state.armorType,
    itemFlags: state.itemFlags,
    shells: state.shells,
    nails: state.nails,
    rockets: state.rockets,
    cells: state.cells,
    activeWeapon: state.activeWeapon,
    weapons: [...state.weapons].sort(),
    keys: [...state.keys].sort(),
    powerups: [...state.powerups]
      .map((powerup) => ({
        finishedField: powerup.finishedField,
        activationField: powerup.activationField,
        finishedAt: powerup.finishedAt,
        itemFlag: powerup.itemFlag,
        itemFlagExpression: powerup.itemFlagExpression ?? "",
      }))
      .sort((left, right) => left.finishedField.localeCompare(right.finishedField)),
  });
}

function quakeMultiplayerPlayerIdForClient(clientId: string): string {
  return QUAKE_MULTIPLAYER_TRANSPORT === "party" ? `party:${clientId}` : `loopback:${clientId}`;
}

function handleQuakeMultiplayerPlayerDamaged(
  event: Extract<QuakeMultiplayerSharedWorldEvent, { eventType: "player.damaged" }>,
): void {
  if (event.victimPlayerId !== quakeMultiplayerPlayerIdForClient(QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID)) return;
  noteQuakeMultiplayerPlayerEvent(event);
  const inventory = getPlayer().inventory();
  inventory.health = event.health;
  inventory.armor = event.armor;
  syncQuakeHud();
  quakeHudFlow.flashDamageFeedback({ amount: event.damage });
  if (event.health <= 0 && !quakePlayerDead) showQuakePlayerDeath();
}

function handleQuakeMultiplayerPlayerKilled(
  event: Extract<QuakeMultiplayerSharedWorldEvent, { eventType: "player.killed" }>,
): void {
  if (event.victimPlayerId !== quakeMultiplayerPlayerIdForClient(QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID)) return;
  noteQuakeMultiplayerPlayerEvent(event);
  if (!quakePlayerDead) showQuakePlayerDeath();
}

function handleQuakeMultiplayerWorldTeleport(
  event: Extract<QuakeMultiplayerSharedWorldEvent, { eventType: "world.teleport" }>,
): void {
  if (event.playerId !== quakeMultiplayerPlayerIdForClient(QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID)) return;
  const origin: [number, number, number] = [event.origin[0], event.origin[1], event.origin[2]];
  quakeMultiplayerApplyingWorldEvent = true;
  try {
    getPlayer().setAuthoritativeOrigin(origin);
    shootables.syncVisibility(origin, true);
    viewmodel.syncTransform();
    world.syncVisibility(true);
    syncQuakeCrosshairTarget();
  } finally {
    quakeMultiplayerApplyingWorldEvent = false;
  }
}

function handleQuakeMultiplayerWorldPush(
  event: Extract<QuakeMultiplayerSharedWorldEvent, { eventType: "world.push" }>,
): void {
  if (event.playerId !== quakeMultiplayerPlayerIdForClient(QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID)) return;
  quakeMultiplayerApplyingWorldEvent = true;
  try {
    getPlayer().push([event.velocity[0], event.velocity[1], event.velocity[2]]);
    if (event.oneShot) targetSystem.disableEntity(event.entityIndex);
  } finally {
    quakeMultiplayerApplyingWorldEvent = false;
  }
}

function handleQuakeMultiplayerWorldTrigger(
  event: Extract<QuakeMultiplayerSharedWorldEvent, { eventType: "world.trigger" }>,
): void {
  quakeMultiplayerApplyingWorldEvent = true;
  try {
    if (event.oneShot) targetSystem.disableEntity(event.entityIndex);
    applyQuakeMultiplayerKilltargets(event.killtargetEntityIndexes);
  } finally {
    quakeMultiplayerApplyingWorldEvent = false;
  }
}

function handleQuakeMultiplayerWorldMover(
  event: Extract<QuakeMultiplayerSharedWorldEvent, { eventType: "world.mover" }>,
): void {
  const mover = movers.get(event.entityIndex);
  if (!mover) return;
  quakeMultiplayerApplyingWorldEvent = true;
  try {
    if ((event.state === "moving-up" || event.state === "top") && mover.mode === "closed") {
      movers.activateEntity(event.entityIndex);
    }
    applyQuakeMultiplayerKilltargets(event.killtargetEntityIndexes);
  } finally {
    quakeMultiplayerApplyingWorldEvent = false;
  }
}

function handleQuakeMultiplayerWorldTargets(
  event: Extract<QuakeMultiplayerSharedWorldEvent, { eventType: "world.targets" }>,
): void {
  quakeMultiplayerApplyingWorldEvent = true;
  try {
    applyQuakeMultiplayerKilltargets(event.killtargetEntityIndexes);
  } finally {
    quakeMultiplayerApplyingWorldEvent = false;
  }
}

function applyQuakeMultiplayerKilltargets(entityIndexes: readonly number[] | undefined): void {
  for (const entityIndex of entityIndexes ?? []) {
    targetSystem.disableEntity(entityIndex);
    getPickups().applyAuthoritativePickup(entityIndex, {
      applyEffect: false,
      hide: true,
    });
  }
}

function handleQuakeMultiplayerWorldChanged(
  event: Extract<QuakeMultiplayerSharedWorldEvent, { eventType: "world.changed" }>,
): void {
  if (event.data?.clientId === QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID) return;
  if (event.entityIndex === undefined) return;
  const entity = entityByIndex.get(event.entityIndex);
  if (!entity) return;
  quakeMultiplayerApplyingWorldEvent = true;
  try {
    if (event.change === "entity.activate") {
      const sourceEntityIndex = typeof event.data?.sourceEntityIndex === "number"
        ? event.data.sourceEntityIndex
        : undefined;
      activateQuakeEntity(event.entityIndex, sourceEntityIndex);
    } else if (event.change === "level.complete") {
      completeQuakeLevel(entity);
    }
  } finally {
    quakeMultiplayerApplyingWorldEvent = false;
  }
}

function sendQuakeMultiplayerWorldChanged(
  change: string,
  entityIndex: number,
  data: Record<string, string | number | boolean> = {},
): void {
  // Legacy world.changed events are room-to-client only. Client-originated
  // world changes must go through structured authoritative intents.
  if (QUAKE_MULTIPLAYER_ENABLED) return;
  if (
    quakeMultiplayerApplyingWorldEvent ||
    !QUAKE_MULTIPLAYER_ENABLED ||
    quakeMultiplayerSession.status().state !== "connected"
  ) {
    return;
  }
  const roomKey = currentQuakeMultiplayerRoomKey();
  if (!roomKey) return;
  quakeMultiplayerSession.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.world",
    roomKey,
    sequence: ++quakeMultiplayerClientSequence,
    sentAt: Date.now(),
    payload: {
      clientId: QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID,
      event: {
        eventType: "world.changed",
        eventId: `world-local-${quakeMultiplayerClientSequence}`,
        roomTime: 0,
        entityIndex,
        change,
        data: {
          ...data,
          clientId: QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID,
        },
      },
    },
  }));
}

function currentQuakeMultiplayerWorldIntentRoomKey(): QuakeMultiplayerRoomCompatibilityKey | null {
  if (
    quakeMultiplayerApplyingWorldEvent ||
    quakeMultiplayerSpectating ||
    !QUAKE_MULTIPLAYER_ENABLED ||
    quakeMultiplayerSession.status().state !== "connected"
  ) {
    return null;
  }
  return currentQuakeMultiplayerRoomKey();
}

function sendQuakeMultiplayerWorldIntent(
  roomKey: QuakeMultiplayerRoomCompatibilityKey,
  intent: QuakeMultiplayerWorldIntent,
  sentAt = Date.now(),
): void {
  quakeMultiplayerSession.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.world",
    roomKey,
    sequence: ++quakeMultiplayerClientSequence,
    sentAt,
    payload: {
      clientId: QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID,
      intent,
    },
  }));
}

function requestQuakeMultiplayerTouchIntent(entityIndex: number, intentType: "touch" | "teleport"): boolean {
  const roomKey = currentQuakeMultiplayerWorldIntentRoomKey();
  if (!roomKey) return false;
  const sentAt = Date.now();
  const requestKey = `${intentType}:${entityIndex}`;
  const lastRequestedAt = quakeMultiplayerWorldRequestAt.get(requestKey) ?? -Infinity;
  if (sentAt - lastRequestedAt < 250) return true;
  quakeMultiplayerWorldRequestAt.set(requestKey, sentAt);
  const origin = getPlayer().currentOrigin();
  if (intentType === "teleport") {
    sendQuakeMultiplayerWorldIntent(roomKey, {
      intentType: "teleport",
      worldSequence: ++quakeMultiplayerWorldSequence,
      requestedAt: sentAt,
      entityIndex,
      origin,
      velocity: [0, 0, 0],
    }, sentAt);
    return true;
  }
  sendQuakeMultiplayerWorldIntent(roomKey, {
    intentType: "touch",
    worldSequence: ++quakeMultiplayerWorldSequence,
    requestedAt: sentAt,
    entityIndex,
    origin,
  }, sentAt);
  return true;
}

function requestQuakeMultiplayerTriggerTouch(entity: QuakeEntity): boolean {
  if (
    entity.classname !== "trigger_once" &&
    entity.classname !== "trigger_multiple" &&
    entity.classname !== "trigger_secret"
  ) return false;
  return requestQuakeMultiplayerTouchIntent(entity.index, "touch");
}

function requestQuakeMultiplayerLevelTransitionIntent(entity: QuakeEntity): boolean {
  const roomKey = currentQuakeMultiplayerWorldIntentRoomKey();
  if (!roomKey) return false;
  const sentAt = Date.now();
  const requestKey = `level-transition:${entity.index}`;
  const lastRequestedAt = quakeMultiplayerWorldRequestAt.get(requestKey) ?? -Infinity;
  if (sentAt - lastRequestedAt < 250) return true;
  quakeMultiplayerWorldRequestAt.set(requestKey, sentAt);
  sendQuakeMultiplayerWorldIntent(roomKey, {
    intentType: "level-transition",
    worldSequence: ++quakeMultiplayerWorldSequence,
    requestedAt: sentAt,
    entityIndex: entity.index,
    origin: getPlayer().currentOrigin(),
  }, sentAt);
  return true;
}

function sendQuakeMultiplayerPresence(status: QuakeMultiplayerPlayerPresenceStatus): boolean {
  if (
    !QUAKE_MULTIPLAYER_ENABLED ||
    quakeMultiplayerSpectating ||
    quakeMultiplayerSession.status().state !== "connected"
  ) {
    return false;
  }
  const roomKey = currentQuakeMultiplayerRoomKey();
  if (!roomKey) return false;
  quakeMultiplayerSession.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.presence",
    roomKey,
    sequence: ++quakeMultiplayerClientSequence,
    sentAt: Date.now(),
    payload: {
      clientId: QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID,
      status,
    },
  }));
  return true;
}

function sendQuakeMultiplayerPong(payload: Extract<QuakeMultiplayerRoomEnvelope, { type: "room.ping" }>["payload"]): void {
  if (
    !QUAKE_MULTIPLAYER_ENABLED ||
    quakeMultiplayerSession.status().state !== "connected"
  ) {
    return;
  }
  const roomKey = currentQuakeMultiplayerRoomKey();
  if (!roomKey) return;
  const sentAt = Date.now();
  quakeMultiplayerSession.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.pong",
    roomKey,
    sequence: ++quakeMultiplayerClientSequence,
    sentAt,
    payload: {
      pingId: payload.pingId,
      sentAt,
      echoedSentAt: payload.sentAt,
      responderTime: sentAt,
    },
  }));
}

function applyQuakeMultiplayerAuthoritativeView(playerState: QuakeMultiplayerAuthoritativePlayerState): void {
  applyQuakeMultiplayerView(playerState.origin, playerState.rotX, playerState.rotY);
}

function applyQuakeMultiplayerView(originValue: readonly [number, number, number], rotX: number, rotY: number): void {
  const origin: Vec3 = [
    originValue[0],
    originValue[1],
    originValue[2],
  ];
  quakeCameraView.clearWeaponViewPunch(false);
  getPlayer().setDebugOrigin(origin);
  quakeCameraView.syncSceneCameraAt(origin, rotX, rotY);
  shootables.syncVisibility(origin, true);
  viewmodel.syncTransform();
  world.syncVisibility(true);
  syncQuakeCrosshairTarget();
}

function sendQuakeMultiplayerHello(roomKey: QuakeMultiplayerRoomCompatibilityKey): void {
  const gameplayDefinitions = currentResult
    ? quakeMultiplayerGameplayDefinitionsFromScene(currentResult, {
        pointToRoom: quakeCameraView.pointToPoly,
        playerEyeHeight: getPlayer().eyeHeight(),
        playerMinsZ: QUAKE_PLAYER_MINS_Z,
      })
    : undefined;
  const deathmatchSpawns = gameplayDefinitions?.deathmatchSpawns;
  const pickupDefinitions = gameplayDefinitions?.pickupDefinitions;
  const gameplayFacts = gameplayDefinitions?.gameplayFacts;
  quakeMultiplayerSession.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.hello",
    roomKey,
    sequence: ++quakeMultiplayerClientSequence,
    sentAt: Date.now(),
    payload: {
      clientId: QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID,
      displayName: QUAKE_MULTIPLAYER_LOCAL_DISPLAY_NAME,
      color: QUAKE_MULTIPLAYER_LOCAL_COLOR,
      matchSettings: quakeMultiplayerMatchSettings(),
      capabilities: [QUAKE_MULTIPLAYER_TRANSPORT, "pose-sample", "gameplay-facts-v1"],
      ...(gameplayFacts ? { gameplayFacts } : {}),
      deathmatchSpawns,
      pickupDefinitions,
    },
  }));
}

function requestQuakeMultiplayerPickup(entityIndex: number): boolean {
  if (quakeMultiplayerSpectating) return false;
  if (!Number.isInteger(entityIndex) || entityIndex < 0) return false;
  const now = Date.now();
  const lastRequestedAt = quakeMultiplayerPickupRequestAt.get(entityIndex) ?? -Infinity;
  if (now - lastRequestedAt < 250) return true;
  const roomKey = currentQuakeMultiplayerRoomKey();
  if (!roomKey) return false;
  quakeMultiplayerPickupRequestAt.set(entityIndex, now);
  quakeMultiplayerSession.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.pickup",
    roomKey,
    sequence: ++quakeMultiplayerClientSequence,
    sentAt: now,
    payload: {
      clientId: QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID,
      pickup: {
        pickupSequence: ++quakeMultiplayerPickupSequence,
        requestedAt: now,
        entityIndex,
      },
    },
  }));
  return true;
}

function sendQuakeMultiplayerHazardDamageIntent(hazard: QuakeHazardDamage): boolean {
  if (hazard.kind === "trigger" && hazard.entityIndex !== undefined) {
    return requestQuakeMultiplayerTouchIntent(hazard.entityIndex, "touch");
  }
  return false;
}

function sendQuakeMultiplayerFireIntent(event: QuakeWeaponFireEvent): void {
  if (
    !QUAKE_MULTIPLAYER_ENABLED ||
    quakeMultiplayerSpectating ||
    quakeMultiplayerSession.status().state !== "connected"
  ) {
    return;
  }
  const roomKey = currentQuakeMultiplayerRoomKey();
  if (!roomKey) return;
  quakeMultiplayerSession.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.fire",
    roomKey,
    sequence: ++quakeMultiplayerClientSequence,
    sentAt: Date.now(),
    payload: {
      clientId: QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID,
      fire: {
        fireSequence: ++quakeMultiplayerFireSequence,
        firedAt: Date.now(),
        weapon: event.weapon,
        fireKind: event.fireKind,
        origin: event.origin,
        direction: event.direction,
        range: event.range,
      },
    },
  }));
}

function sendQuakeMultiplayerInput(roomKey: QuakeMultiplayerRoomCompatibilityKey, sampleNow: number): void {
  if (
    !QUAKE_MULTIPLAYER_ENABLED ||
    quakeMultiplayerSession.status().state !== "connected" ||
    quakeMultiplayerSpectating ||
    quakePlayerDead
  ) {
    return;
  }
  const sentAt = Date.now();
  const input = quakeMultiplayerLocalInputIntent(sampleNow, sentAt);
  quakeMultiplayerLastInputAt = sampleNow;
  quakeMultiplayerSession.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.input",
    roomKey,
    sequence: ++quakeMultiplayerClientSequence,
    sentAt,
    payload: {
      clientId: QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID,
      input,
    },
  }));
}

function quakeMultiplayerLocalInputIntent(sampleNow: number, sampledAt: number): QuakeMultiplayerLocalInputIntent {
  const movement = getPlayer().debugMovement();
  const keyCodes = new Set(movement.keys);
  let forward = 0;
  let side = 0;
  if (keyCodes.has("ArrowUp") || keyCodes.has("KeyW")) forward += QUAKE_PMOVE_FORWARD_SPEED;
  if (keyCodes.has("ArrowDown") || keyCodes.has("KeyS")) forward -= QUAKE_PMOVE_BACK_SPEED;
  if (keyCodes.has("ArrowRight") || keyCodes.has("KeyD")) side += QUAKE_PMOVE_SIDE_SPEED;
  if (keyCodes.has("ArrowLeft") || keyCodes.has("KeyA")) side -= QUAKE_PMOVE_SIDE_SPEED;
  const analogX = clampQuakeMultiplayerAnalogInput(movement.analogX);
  const analogY = clampQuakeMultiplayerAnalogInput(movement.analogY);
  forward += analogY >= 0
    ? analogY * QUAKE_PMOVE_FORWARD_SPEED
    : analogY * QUAKE_PMOVE_BACK_SPEED;
  side += analogX * QUAKE_PMOVE_SIDE_SPEED;
  const speedKeyDown = [...quakeGameplayInput.speedKeyCodes].some((code) => keyCodes.has(code));
  if (speedKeyDown !== quakeAlwaysRun) {
    forward *= QUAKE_PMOVE_SPEED_KEY_MULTIPLIER;
    side *= QUAKE_PMOVE_SPEED_KEY_MULTIPLIER;
  }
  const dt = quakeMultiplayerLastInputAt > 0
    ? Math.min(QUAKE_PMOVE_DT_CLAMP, Math.max(0, (sampleNow - quakeMultiplayerLastInputAt) / 1000))
    : QUAKE_MULTIPLAYER_INPUT_SAMPLE_MS / 1000;
  return {
    inputSequence: ++quakeMultiplayerInputSequence,
    sampledAt,
    dt,
    move: { forward, side, up: 0 },
    buttons: {
      attack: quakePointerGameplay.isAttackDown(),
      jump: keyCodes.has("Space") || movement.jumpQueued,
      use: false,
    },
    rotX: scene.camera.state.rotX ?? 88,
    rotY: normalizeQuakeUrlAngle(scene.camera.state.rotY ?? 270),
    activeWeapon: getPlayer().inventory().activeWeapon,
  };
}

function clampQuakeMultiplayerAnalogInput(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function scheduleQuakeMultiplayerPoseFrame(): void {
  if (!QUAKE_MULTIPLAYER_ENABLED || quakeAppDisposed || quakeMultiplayerPoseFrame) return;
  quakeMultiplayerPoseFrame = window.requestAnimationFrame(tickQuakeMultiplayerPose);
}

function tickQuakeMultiplayerPose(now: number): void {
  quakeMultiplayerPoseFrame = 0;
  if (
    !QUAKE_MULTIPLAYER_ENABLED ||
    quakeAppDisposed ||
    quakeMultiplayerSession.status().state !== "connected" ||
    !currentResult
  ) {
    return;
  }
  const roomKey = currentQuakeMultiplayerRoomKey();
  if (!roomKey) return;
  if (!quakeMultiplayerHelloAccepted) {
    scheduleQuakeMultiplayerPoseFrame();
    return;
  }
  if (quakeMultiplayerSpectating) {
    return;
  }
  if (
    !QUAKE_MULTIPLAYER_DEBUG_POSE_ONLY &&
    !quakeMultiplayerInputPaused &&
    now - quakeMultiplayerLastInputAt >= QUAKE_MULTIPLAYER_INPUT_SAMPLE_MS
  ) {
    sendQuakeMultiplayerInput(roomKey, now);
  }
  if (QUAKE_MULTIPLAYER_DEBUG_POSE_ONLY && now - quakeMultiplayerLastPoseAt >= QUAKE_MULTIPLAYER_POSE_SAMPLE_MS) {
    quakeMultiplayerLastPoseAt = now;
    sendQuakeMultiplayerPose(roomKey);
  }
  scheduleQuakeMultiplayerPoseFrame();
}

function sendQuakeMultiplayerPose(roomKey: QuakeMultiplayerRoomCompatibilityKey): void {
  const sentAt = Date.now();
  const origin = getPlayer().currentOrigin();
  quakeMultiplayerSession.send(createQuakeMultiplayerEnvelope({
    direction: "client",
    type: "client.pose",
    roomKey,
    sequence: ++quakeMultiplayerClientSequence,
    sentAt,
    payload: {
      clientId: QUAKE_MULTIPLAYER_LOCAL_CLIENT_ID,
      prototypeOnly: true,
      pose: {
        poseSequence: ++quakeMultiplayerPoseSequence,
        sampledAt: sentAt,
        origin,
        velocity: [0, 0, 0],
        rotX: scene.camera.state.rotX ?? 88,
        rotY: scene.camera.state.rotY ?? 270,
        grounded: true,
        alive: !quakePlayerDead,
      },
    },
  }));
}

function sendQuakeMultiplayerDebugPose(): boolean {
  if (
    !QUAKE_MULTIPLAYER_ENABLED ||
    quakeMultiplayerSession.status().state !== "connected"
  ) {
    return false;
  }
  const roomKey = currentQuakeMultiplayerRoomKey();
  if (!roomKey) return false;
  sendQuakeMultiplayerPose(roomKey);
  return true;
}

function setQuakeMultiplayerDebugInputPaused(paused: boolean): boolean {
  if (!QUAKE_MULTIPLAYER_ENABLED || !QUAKE_MULTIPLAYER_DEBUG_REQUESTED) return false;
  setQuakeMultiplayerInputPaused(paused);
  if (!paused) scheduleQuakeMultiplayerPoseFrame();
  return true;
}

function quakeLoopbackSimulatedPlayers(): readonly QuakeMultiplayerAuthoritativePlayerState[] {
  const roomKey = currentQuakeMultiplayerRoomKey();
  if (!roomKey || !player) return [];
  const localOrigin = getPlayer().currentOrigin();
  const t = performance.now() / 1000;
  const orbitRadius = 96 * QUAKE_COLLISION_UNIT_SCALE;
  const angularSpeed = 0.8;
  const x = localOrigin[0] + Math.cos(t * angularSpeed) * orbitRadius;
  const y = localOrigin[1] + Math.sin(t * angularSpeed) * orbitRadius;
  return [{
    playerId: QUAKE_MULTIPLAYER_LOOPBACK_REMOTE_PLAYER_ID,
    clientId: QUAKE_MULTIPLAYER_LOOPBACK_REMOTE_CLIENT_ID,
    displayName: "Loopback",
    color: "#6fb7d8",
    mapName: roomKey.mapName,
    origin: [x, y, localOrigin[2]],
    velocity: [
      -Math.sin(t * angularSpeed) * orbitRadius * angularSpeed,
      Math.cos(t * angularSpeed) * orbitRadius * angularSpeed,
      0,
    ],
    rotX: 90,
    rotY: normalizeQuakeUrlAngle(180 + (t * angularSpeed * 180) / Math.PI),
    health: 100,
    armor: 0,
    activeWeapon: "shotgun",
    alive: true,
    frags: 0,
    deaths: 0,
    lastInputSequence: 0,
    updatedAt: Date.now(),
  }];
}

function quakeLoopbackTrustedWorldDefinitions(roomKey: QuakeMultiplayerRoomCompatibilityKey) {
  if (!currentResult || currentMapName !== roomKey.mapName || !player) return null;
  return quakeMultiplayerWorldDefinitionsFromScene(currentResult, {
    pointToRoom: quakeCameraView.pointToPoly,
    playerEyeHeight: getPlayer().eyeHeight(),
  });
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function activateQuakeTeleport(trigger: QuakeEntity): boolean {
  if (requestQuakeMultiplayerTouchIntent(trigger.index, "teleport")) return true;
  return quakeEntityActivation.activateTeleport(trigger);
}

function completeQuakeLevel(entity: QuakeEntity): void {
  if (requestQuakeMultiplayerLevelTransitionIntent(entity)) return;
  quakeEntityActivation.completeLevel(entity);
}

function resetQuakeLevelStatsForCurrentScene(): void {
  quakeLevelStats.reset(currentMapName, quakeLevelStatsTotalsForEntities(currentResult?.entities ?? []));
}

function syncQuakeIntermissionCamera(): void {
  const point = quakeIntermissionPointForCurrentScene();
  if (!point) return;
  const origin = quakeCameraView.pointToPoly(point.origin);
  const { rotX, rotY } = quakeIntermissionCameraRotation(point);
  quakeCameraView.syncSceneCameraAt(origin, rotX, rotY);
  shootables.syncVisibility(origin as [number, number, number], true);
  world.syncVisibilityAt(origin as [number, number, number], true);
  syncQuakeCrosshairTarget();
}

function quakeIntermissionPointForCurrentScene(): QuakeEntityManifestPoint | null {
  const manifestPoint = currentResult?.entityManifest.intermissions?.[0];
  if (manifestPoint) return manifestPoint;
  const entity = currentResult?.entities
    .filter((candidate) => candidate.classname.startsWith("info_intermission") && candidate.origin)
    .sort((a, b) => a.index - b.index)[0];
  if (!entity?.origin) return null;
  return {
    entityIndex: entity.index,
    classname: entity.classname,
    origin: entity.origin,
    spawnflags: 0,
    ...(entity.angle !== undefined ? { angle: entity.angle } : {}),
    ...quakeEntityMangleProperties(entity),
    ...(entity.properties.targetname ? { targetname: entity.properties.targetname } : {}),
  };
}

function quakeIntermissionCameraRotation(point: QuakeEntityManifestPoint): { rotX: number; rotY: number } {
  if (point.mangle) {
    return {
      rotX: 90 - point.mangle.x,
      rotY: (180 + point.mangle.y + 360) % 360,
    };
  }
  return {
    rotX: 90,
    rotY: (180 + (point.angle ?? 0) + 360) % 360,
  };
}

function quakeEntityMangleProperties(entity: QuakeEntity): { mangle?: QuakeVertex } {
  const mangle = quakeParseEntityVector(entity.properties.mangle);
  return mangle ? { mangle } : {};
}

function quakeParseEntityVector(value: string | undefined): QuakeVertex | null {
  if (!value) return null;
  const parts = value.trim().split(/\s+/).map((part) => Number.parseFloat(part));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return { x: parts[0], y: parts[1], z: parts[2] };
}

function activateSolidTouch(touch: QuakeTouchedTrigger): void {
  const entity = entityByIndex.get(touch.entityIndex);
  if (entity?.classname === "func_button" && requestQuakeMultiplayerTouchIntent(entity.index, "touch")) return;
  quakeEntityActivation.activateSolidTouch(touch);
}

function touchQuakeEntity(entityIndex: number): boolean {
  const entity = entityByIndex.get(entityIndex);
  if (!entity || entity.modelIndex === undefined) return false;
  activateSolidTouch({
    entityIndex,
    modelIndex: entity.modelIndex,
    classname: entity.classname,
    contact: "solid",
    ...(entity.properties.target ? { target: entity.properties.target } : {}),
    ...(entity.properties.targetname ? { targetname: entity.properties.targetname } : {}),
  });
  return true;
}

function fireQuakeTarget(targetname: string, sourceEntityIndex?: number): void {
  quakeEntityActivation.fireTarget(targetname, sourceEntityIndex);
}

function activateQuakeEntity(entityIndex: number, sourceEntityIndex?: number): boolean {
  return quakeEntityActivation.activateEntity(entityIndex, sourceEntityIndex);
}

function activateTriggerCounter(entity: QuakeEntity): void {
  quakeEntityActivation.triggerCounter(entity);
}

function quakeBossLightningElectrodesReady(
  targetName: string,
  alignment: Parameters<QuakeEntityActivationFlow["bossLightningElectrodesReady"]>[1],
): boolean {
  return quakeEntityActivation.bossLightningElectrodesReady(targetName, alignment);
}

function quakeBossLightningDischarge(
  targetName: string,
  lightning: Parameters<QuakeEntityActivationFlow["bossLightningDischarge"]>[1],
): void {
  quakeEntityActivation.bossLightningDischarge(targetName, lightning);
}

function activateQuakeSpecialTrigger(entity: QuakeEntity): boolean {
  return quakeEntityActivation.activateSpecialTrigger(entity);
}

function activateQuakeSecretTrigger(entity: QuakeEntity): void {
  quakeEntityActivation.activateSecretTrigger(entity);
}

function quakeRuntimeTriggerOneShot(entity: QuakeEntity, fallback: boolean): boolean {
  return quakeEntityActivation.triggerOneShot(entity, fallback);
}

function quakeRuntimeTriggerWait(entity: QuakeEntity, fallback: number): number {
  return quakeEntityActivation.triggerWait(entity, fallback);
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

function syncQuakeCrosshairTarget(): void {
  quakeCrosshairInteraction?.sync();
}

function queueQuakeCrosshairTargetSync(): void {
  quakeCrosshairInteraction?.queueSync();
}

function clearQuakeCrosshairTarget(): void {
  quakeCrosshairInteraction?.clear();
}

function handleQuakeDebugFlyModeOptionChange(event: Event): void {
  setQuakeDebugFlyMode((event.currentTarget as HTMLInputElement).checked);
}

function syncQuakeHazards(
  origin = controls.getOrigin(),
  triggers?: QuakeTouchedTrigger[],
): boolean {
  return quakeSceneMount.syncHazards(origin, triggers);
}

function syncQuakeActiveTriggerDataset(key: string): void {
  void key;
}

function syncTouchedTriggers(origin: [number, number, number]): QuakeTouchedTrigger[] {
  return quakeSceneMount.syncTouchedTriggers(origin);
}

function syncQuakeDebugGameplay(origin: [number, number, number]): void {
  getPlayer().setDebugOrigin(origin);
  const previousDebugGameplaySyncActive = quakeDebugGameplaySyncActive;
  quakeDebugGameplaySyncActive = true;
  try {
    quakeSceneMount.syncDebugGameplay(origin);
  } finally {
    quakeDebugGameplaySyncActive = previousDebugGameplaySyncActive;
  }
}

function applyQuakeUrlView(view: QuakeCssView): void {
  quakeCameraView.clearWeaponViewPunch(false);
  getPlayer().setDebugOrigin(view.origin);
  quakeCameraView.syncSceneCameraAt(view.origin, view.rotX, view.rotY);
  shootables.syncVisibility(view.origin, true);
  viewmodel.syncTransform();
  world.syncVisibility(true);
  syncQuakeCrosshairTarget();
}

async function loadQuakeMap(mapName: string, options: QuakeMapLoadOptions = {}): Promise<void> {
  await quakeMapLoader.loadMap(mapName, options);
}

async function completeQuakeSceneReadiness(
  modelPromise = quakeViewmodelAssets.preload(),
  progress?: QuakeLoadingProgressTracker,
): Promise<void> {
  const completeEffectSpritesTask = progress?.startTask("Effect sprites");
  try {
    await quakeEffectSpriteFlow.preload();
  } finally {
    completeEffectSpritesTask?.();
  }
  const completeWorldTexturesTask = progress?.startTask("World textures");
  try {
    await world.waitForVisibleTextures();
  } finally {
    completeWorldTexturesTask?.();
  }
  await quakeLoading.completeSceneReadiness(modelPromise, quakeViewmodelAssets.mount, progress);
}

function installQuakeAppDebugHooks(): void {
  installQuakeAppDebugApi({
    runtime: quakeAppRuntime,
    activateEntity: activateQuakeEntity,
    copyViewUrl: copyCurrentQuakeViewUrl,
    debugRecorder: () => quakeDebugRecorder,
    fireballEmittersCount: () => quakePointHazards.counts().emitters,
    fireballsCount: () => quakePointHazards.counts().hazards,
    forwardDirection,
    loadMap: loadQuakeMap,
    mapExists: quakeAssetCatalog.mapExists,
    pointToPoly: quakeCameraView.pointToPoly,
    renderOrigin: quakeCameraView.currentRenderOrigin,
    setCollisionBypassUntil: (until) => {
      quakeDebugCollisionBypassUntil = until;
    },
    syncHud: syncQuakeHud,
    syncCrosshairTarget: syncQuakeCrosshairTarget,
    syncGameplay: syncQuakeDebugGameplay,
    setMultiplayerInputPaused: setQuakeMultiplayerDebugInputPaused,
    syncSceneCameraAt: quakeCameraView.syncSceneCameraAt,
    syncMultiplayerPose: sendQuakeMultiplayerDebugPose,
    touchEntity: touchQuakeEntity,
    viewUrl: currentQuakeViewUrl,
  });
}

async function loadPickupModels(progress?: QuakeLoadingProgressTracker): Promise<void> {
  await quakeAssetWarmup.loadPickupModels(progress);
}

async function preloadQuakeMapModelRenderBundleAssets(
  mapName: string,
  progress?: QuakeLoadingProgressTracker,
): Promise<void> {
  await quakeAssetWarmup.preloadMapModelAssets(mapName, progress);
}

async function preloadQuakeSceneModelRenderBundleAssets(
  result: QuakeScene,
  progress?: QuakeLoadingProgressTracker,
): Promise<void> {
  await quakeAssetWarmup.preloadSceneModelAssets(result, progress);
}

async function loadProgramMetadata(progress?: QuakeLoadingProgressTracker): Promise<void> {
  await quakeAssetWarmup.loadProgramMetadata(progress);
}

async function loadQuake(): Promise<void> {
  await quakeLoading.loadStartup({
    fetchManifest: fetchQuakeAssetManifest,
    initializedLine: QUAKE_LOADING_CONSOLE_INITIALIZED_LINE,
    loadMap: loadQuakeMap,
    loadPickupModels,
    loadProgramMetadata,
    pakLine: QUAKE_LOADING_CONSOLE_PAK_LINE,
    preloadWeapon: (progress) => quakeViewmodelAssets.preload(progress),
    routeFromLocation: quakeUrlRouteFromLocation,
    routeIsDirect: quakeUrlRouteIsDirect,
    routeShouldNormalize: quakeUrlRouteShouldNormalize,
    sceneUrl: quakeAssetCatalog.sceneUrl,
    setAssetManifest: setQuakeAssetManifest,
    setCurrentMapName: (mapName) => {
      currentMapName = mapName;
    },
    setMenuCurrentLevel: (mapName) => menu.setCurrentLevel(mapName),
    syncRoutePresentation: syncQuakeRoutePresentation,
  });
}

function clearQuakeMainMenuStartupState(): void {
  removeQuakeBodyClasses("quake-main-menu-pending", "quake-main-menu-deferred");
}

function syncQuakeRoutePresentation(route: QuakeUrlRoute, options: { preferMenu?: boolean } = {}): void {
  quakeRoute.syncPresentation(route, options);
}

function handleQuakePopState(): void {
  quakeRoute.handlePopState();
}

function handleViewportResize(): void {
  quakeCameraView.syncViewportProjection();
  viewmodel.queueViewportSync();
}

function syncPlayerCollision(): void {
  if (import.meta.env.DEV && performance.now() < quakeDebugCollisionBypassUntil) return;
  if (isQuakeDebugFlyModeActive()) return;
  getPlayer().syncCollision();
}

function handleQuakeControlsChange(): void {
  syncPlayerCollision();
  shootables.syncVisibility(controls.getOrigin());
}

function disposeQuakeApp(): void {
  quakeAppDisposed = true;
  stopQuakeMultiplayerScene("app-dispose");
  disposeQuakeMultiplayerMessages();
  quakeRemotePlayers.dispose();
  quakeInput.dispose();
  window.removeEventListener("popstate", handleQuakePopState);
  window.removeEventListener("resize", handleViewportResize);
  window.visualViewport?.removeEventListener("resize", handleViewportResize);
  quakePointerGameplay.dispose();
  quakeGameplayInput.clearMoveInput();
  quakePointerGameplay.clearAttackInput();
  quakeDebugFly.dispose();
  quakeCameraFeedback.dispose();
  quakeEffectSpriteFlow.dispose();
  quakeImpactParticleFlow.dispose();
  quakeHudFlow.dispose();
  quakeCrosshairInteraction?.dispose();
  quakeOptions.dispose();
  disposeQuakeMultiplayerControlGlyphs();
  multiplayerForm?.removeEventListener("submit", handleQuakeMultiplayerFormSubmit);
  debugShowMenuOption?.removeEventListener("change", quakeDebugPanelFlow.handleShowMenuOptionChange);
  debugEnabledOption?.removeEventListener("change", quakeDebugPanelFlow.handleEnabledOptionChange);
  debugEnableAnimationsOption?.removeEventListener("change", quakeDebugPanelFlow.handleEnableAnimationsOptionChange);
  debugFreezeEnemiesOption?.removeEventListener("change", handleQuakeDebugFreezeEnemiesOptionChange);
  debugDisableAttacksOption?.removeEventListener("change", handleQuakeDebugDisableAttacksOptionChange);
  debugShowFpsOption?.removeEventListener("change", quakeDebugPanelFlow.handleShowFpsOptionChange);
  debugShowTexturesOption?.removeEventListener("change", quakeDebugPanelFlow.handleShowTexturesOptionChange);
  debugFlyModeOption?.removeEventListener("change", handleQuakeDebugFlyModeOptionChange);
  debugShowOutlinesOption?.removeEventListener("change", quakeDebugPanelFlow.handleShowOutlinesOptionChange);
  debugShowLabelsOption?.removeEventListener("change", quakeDebugPanelFlow.handleShowLabelsOptionChange);
  if (quakeDebugRecordingPanelEnabled) {
    debugRecordingButton?.removeEventListener("click", handleQuakeDebugRecordingButtonClick);
  }
  quakeDebugRecorder.dispose();
  quakeDebugPanelFlow.stopStats();
  controls.removeEventListener("change", handleQuakeControlsChange);
  controls.removeEventListener("end", quakeGameplayInput.clearCrouchInput);
  controls.destroy();
  menu.dispose();
  audio.dispose();
  quakeStatsOverlay.hide();
  quakeSceneMount.disposeCurrentScene();
}

const quakeSaveSession = createCssQuakeSaveSession({
  activeWeaponView: () => ({
    rotX: scene.camera.state.rotX,
    rotY: scene.camera.state.rotY,
  }),
  canSaveNow: () => Boolean(
    currentResult &&
    currentCollisionWorld &&
    quakeGameplayStarted &&
    !quakeAppLoading &&
    !quakePlayerDead &&
    !hasQuakeBodyClass("quake-level-complete") &&
    !quakeEntityActivation.isLevelLoadPending(),
  ),
  clearAttackInput: quakePointerGameplay.clearAttackInput,
  clearBonusOverlay: clearQuakeBonusOverlay,
  clearCrouchInput: quakeGameplayInput.clearCrouchInput,
  clearCrosshairHit: () => quakeWeaponPresentation.clearCrosshairHit(),
  clearCrosshairTarget: clearQuakeCrosshairTarget,
  clearLevelComplete: clearQuakeLevelComplete,
  clearMegahealthRot: () => quakePowerups.clearMegahealthRot(),
  clearMobileMoveInput: quakePointerGameplay.clearMobileMoveInput,
  clearMoveInput: quakeGameplayInput.clearMoveInput,
  clearPlayerDeath: clearQuakePlayerDeath,
  clearPowerupTimers: quakePowerups.clearPowerupTimers,
  clearWeaponViewPunch: () => quakeCameraView.clearWeaponViewPunch(false),
  currentMapName: () => currentMapName,
  currentOrigin: () => getPlayer().currentOrigin(),
  hasCurrentScene: (mapName) => Boolean(currentResult && (!mapName || currentMapName === mapName)),
  loadMap: loadQuakeMap,
  mapExists: quakeAssetCatalog.mapExists,
  notify: (message) => quakeTextPresentation.notify(message),
  resetActiveTriggers: () => triggerSystem.resetActive(),
  resetWeapons: () => weapons.reset(),
  reschedulePowerupTimers: quakePowerups.reschedulePowerupTimers,
  restoreDamageableBrushes: (snapshot) => quakeDamageableBrushes.restore(snapshot),
  restoreMovers: (snapshot) => movers.restoreProgress(snapshot),
  restorePickups: (snapshot) => getPickups().restoreProgress(snapshot),
  restorePlayer: (snapshot) => getPlayer().restoreProgress(snapshot),
  restoreShootables: (snapshot) => shootables.restoreProgress(snapshot),
  restoreTargets: (snapshot) => targetSystem.restoreProgress(snapshot),
  setGameplayStarted: setQuakeGameplayStarted,
  snapshotDamageableBrushes: () => quakeDamageableBrushes.snapshot(),
  snapshotMovers: () => movers.snapshotProgress(),
  snapshotPickups: () => getPickups().snapshotProgress(),
  snapshotPlayer: () => getPlayer().snapshotProgress(),
  snapshotShootables: () => shootables.snapshotProgress(),
  snapshotTargets: () => targetSystem.snapshotProgress(),
  syncCrosshairTarget: syncQuakeCrosshairTarget,
  syncHud: syncQuakeHud,
  syncSceneCameraAt: quakeCameraView.syncSceneCameraAt,
  syncShootablesVisibility: (origin, force) => shootables.syncVisibility(origin, force),
  syncViewmodel: () => viewmodel.syncTransform(),
  syncWorldVisibility: (force) => world.syncVisibility(force),
  trace: markQuakeTrace,
});

const quakeMapLoader = createQuakeAppMapLoader<QuakeCssView, QuakeViewmodelModel>({
  completeSceneReadiness: completeQuakeSceneReadiness,
  createProgressTracker: (status) => quakeLoading.createProgressTracker(status),
  fetchScene: fetchQuakeScene,
  isDisposed: () => quakeAppDisposed,
  mapLoadView: quakeMapLoadView,
  mountScene: quakeSceneMount.mountScene,
  onCurrentMapChange: (mapName) => {
    currentMapName = mapName;
    menu.setCurrentLevel(mapName);
    if (multiplayerMapSelect) multiplayerMapSelect.value = mapName;
    syncQuakeMultiplayerControlGlyph(multiplayerMapSelect);
  },
  preloadMapAssets: preloadQuakeMapModelRenderBundleAssets,
  preloadSceneAssets: preloadQuakeSceneModelRenderBundleAssets,
  preloadWeapon: (progress) => quakeViewmodelAssets.preload(progress),
  resumeGameplayAfterMapLoad: resumeQuakeGameplayAfterMapLoad,
  sceneUrl: quakeAssetCatalog.sceneUrl,
  setGameplayStarted: setQuakeGameplayStarted,
  setLoading: setQuakeLoading,
  syncUrlView: applyQuakeUrlView,
  updateUrl: updateQuakeUrl,
});

const quakeInput = createQuakeAppInputController({
  audioUnlock: () => audio.unlock(),
  clearAttackInput: quakePointerGameplay.clearAttackInput,
  clearCrouchInput: quakeGameplayInput.clearCrouchInput,
  clearDebugFlyInput: quakeDebugFly.clearInput,
  clearMobileMoveInput: quakePointerGameplay.clearMobileMoveInput,
  clearMoveInput: quakeGameplayInput.clearMoveInput,
  clearWeaponViewPunch: quakeCameraView.clearWeaponViewPunch,
  focusHost: () => host.focus(),
  gameplayMoveKeyCodes: quakeGameplayInput.moveKeyCodes,
  gameplaySpeedKeyCodes: quakeGameplayInput.speedKeyCodes,
  handleCrouchKey: quakeGameplayInput.handleCrouchKey,
  handleDebugFlyKey: quakeDebugFly.handleKey,
  handleMenuKeyDown: (event) => menu.handleKeyDown(event),
  handleMoveKey: quakeGameplayInput.handleMoveKey,
  hidePersistedLoadingConsole: hidePersistedQuakeLoadingConsole,
  isEditableTarget: quakeGameplayInput.isEditableTarget,
  isLoading: () => quakeAppLoading,
  isPointerUnlocked: () => document.pointerLockElement === null,
  menuIsMainOpen: () => menu.isMainMenuOpen(),
  menuIsPanelOpen: () => menu.isMenuPanelOpen(),
  parentKeyRelay: quakeGameplayInput.parentKeyRelay,
  requestIntermissionAdvance: requestQuakeIntermissionAdvanceFromKey,
  shouldOpenMainMenuOnEscape: shouldOpenQuakeMainMenuOnControlsEnd,
  shouldPreventGameplayKeyDefault: quakeGameplayInput.shouldPreventGameplayKeyDefault,
  showMainMenu: () => menu.showMainMenu(),
  syncViewmodelTransform: () => viewmodel.syncTransform(),
  toggleAudioMuted: toggleQuakeAudioMutedShortcut,
  toggleDebugMode: toggleQuakeDebugModeShortcut,
  toggleOutlineTextureMode: toggleQuakeOutlineTextureModeShortcut,
});

const quakeAppRuntime = createQuakeAppRuntimeContext({
  scene,
  controls,
  host,
  sceneElement,
  controllers: {
    audio,
    menu,
    movers,
    pickups: getPickups,
    player: getPlayer,
    shootables,
    targets: targetSystem,
    triggers: triggerSystem,
    viewmodel,
    weapons,
    world,
  },
  session: {
    currentMapName: () => currentMapName,
    currentScene: () => currentResult,
    collisionWorld: () => currentCollisionWorld,
    entities: () => entityByIndex,
    isDisposed: () => quakeAppDisposed,
    isLoading: () => quakeAppLoading,
    transitionSerial: () => quakeTransitionSerial,
  },
  gameplay: {
    isPaused: isQuakeGamePaused,
    setPaused: setQuakeGamePaused,
    isPlayerDead: () => quakePlayerDead,
    isStarted: () => quakeGameplayStarted,
    setStarted: setQuakeGameplayStarted,
  },
  multiplayer: {
    snapshot: quakeMultiplayerDebugSnapshot,
  },
});

quakeInput.attach();
window.addEventListener("popstate", handleQuakePopState);
window.addEventListener("resize", handleViewportResize);
window.visualViewport?.addEventListener("resize", handleViewportResize);
quakePointerGameplay.attach();
quakeOptions.attach();
attachQuakeMultiplayerControlGlyphs();
multiplayerForm?.addEventListener("submit", handleQuakeMultiplayerFormSubmit);
debugShowMenuOption?.addEventListener("change", quakeDebugPanelFlow.handleShowMenuOptionChange);
debugEnabledOption?.addEventListener("change", quakeDebugPanelFlow.handleEnabledOptionChange);
debugEnableAnimationsOption?.addEventListener("change", quakeDebugPanelFlow.handleEnableAnimationsOptionChange);
debugFreezeEnemiesOption?.addEventListener("change", handleQuakeDebugFreezeEnemiesOptionChange);
debugDisableAttacksOption?.addEventListener("change", handleQuakeDebugDisableAttacksOptionChange);
debugShowFpsOption?.addEventListener("change", quakeDebugPanelFlow.handleShowFpsOptionChange);
debugShowTexturesOption?.addEventListener("change", quakeDebugPanelFlow.handleShowTexturesOptionChange);
debugFlyModeOption?.addEventListener("change", handleQuakeDebugFlyModeOptionChange);
debugShowOutlinesOption?.addEventListener("change", quakeDebugPanelFlow.handleShowOutlinesOptionChange);
debugShowLabelsOption?.addEventListener("change", quakeDebugPanelFlow.handleShowLabelsOptionChange);
if (quakeDebugRecordingPanelEnabled) {
  debugRecordingButton?.addEventListener("click", handleQuakeDebugRecordingButtonClick);
}
controls.addEventListener("change", handleQuakeControlsChange);
controls.addEventListener("end", quakeGameplayInput.clearCrouchInput);

syncQuakeHud();
syncQuakeOptionControls();
if (multiplayerPanel) mountQuakeBitmapText(multiplayerPanel);
if (debugPanel) mountQuakeBitmapText(debugPanel);
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
