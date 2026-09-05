import type { QuakeSceneStateView, QuakeSceneStateWriter } from "./sceneState";
import type { Vec3 } from "@layoutit/polycss";

import type { QuakeEntity, QuakeScene } from "../../types/quake";
import { buildQuakeClipCollisionWorld, type QuakeCollisionWorld, type QuakeTouchedTrigger } from "../collision";
import { COLLISION_EPSILON, QUAKE_COLLISION_UNIT_SCALE, STEP_HEIGHT } from "../constants";
import {
  quakeContentsDamageForWaterLevel,
  quakeRadsuitProtectedContentsDamage,
  quakeTriggerHurtDamage,
  quakePlayerWaterLevel,
  type QuakeHazardDamage,
} from "../hazards";
import { dotVec3 } from "../math";
import type { QuakeSoundController } from "../audio";
import type { QuakePickupModelLibrary, QuakeProgramMetadata, QuakePickupController } from "../pickups";
import type { QuakePlayerController } from "../player";
import type { QuakeShootablesController } from "../shootables";
import type { QuakeMoversController } from "../movers";
import type { QuakeTargetsController } from "../targets";
import type { QuakeTriggersController } from "../triggers";
import type { QuakeWorldController } from "../world";
import type { QuakeViewmodelController } from "../viewmodel";
import type { QuakeWeaponsController } from "../weapons";
import type { QuakeDamageableBrushFlow } from "./damageableBrushFlow";
import type { QuakePointHazardFlow } from "./pointHazardFlow";

export interface QuakeSceneMountFlowOptions {
  audio: QuakeSoundController;
  damageableBrushes: QuakeDamageableBrushFlow;
  host: HTMLElement;
  movers: QuakeMoversController;
  pickups: QuakePickupController;
  player: QuakePlayerController;
  pointHazards: QuakePointHazardFlow;
  shootables: QuakeShootablesController;
  state: { view: QuakeSceneStateView; writer: QuakeSceneStateWriter };
  onModelPivotChange(pivot: { x: number; y: number; z: number }): void;
  targets: QuakeTargetsController;
  triggers: QuakeTriggersController;
  viewmodel: QuakeViewmodelController;
  weapons: QuakeWeaponsController;
  world: QuakeWorldController;
  afterMountScene(): void;
  beforeDisposeScene(): void;
  clearPlayerDeath(): void;
  clearPostControllerState(): void;
  clearPreControllerState(): void;
  currentModelLibrary(): QuakePickupModelLibrary | null;
  currentProgramMetadata(): QuakeProgramMetadata | null;
  playerForward(): Vec3;
  powerupActive(finishedField: string): boolean;
  setCamera(spawn: QuakeScene["spawn"]): void;
  syncCrosshairTarget(): void;
  trace(kind: string, details?: Record<string, unknown>): void;
  focusCurrentMenu(): void;
}

export interface QuakeSceneMountFlow {
  currentTouchedTriggers(origin: [number, number, number]): QuakeTouchedTrigger[];
  disposeCurrentScene(): void;
  entitiesForIndexes(indexes: readonly number[]): QuakeEntity[];
  isPointInPlayerView(point: Vec3, minDot: number): boolean;
  lineOfSight(start: Vec3, end: Vec3): boolean;
  mountScene(scene: QuakeScene): void;
  prepareScene(scene: QuakeScene): () => void;
  playerViewDot(point: Vec3): number;
  respawnScene(scene: QuakeScene, previousOrigin: [number, number, number]): void;
  setupMonsterJumpTriggers(scene: QuakeScene): void;
  shootableRuntimeEntities(runtime: QuakeScene["entityManifest"]["runtime"]): QuakeEntity[];
  syncDebugGameplay(origin: [number, number, number]): void;
  syncHazards(origin: [number, number, number], triggers?: QuakeTouchedTrigger[]): boolean;
  syncTouchedTriggers(origin: [number, number, number]): QuakeTouchedTrigger[];
}

export function createQuakeSceneMountFlow(options: QuakeSceneMountFlowOptions): QuakeSceneMountFlow {
  const state = options.state.view;

  function disposeCurrentScene(): void {
    options.beforeDisposeScene();
    options.clearPreControllerState();
    options.viewmodel.remove();
    options.world.clear();
    options.movers.clear();
    options.pickups.clear();
    options.shootables.clear();
    options.clearPostControllerState();
    options.player.resetForSceneDispose();
    setCollisionWorld(null);
    setCurrentScene(null);
    setEntityIndex(new Map());
    options.damageableBrushes.clear();
    options.targets.clear();
    options.pointHazards.clear();
    setModelPivot({ x: 0, y: 0, z: 0 });
    options.audio.syncAmbientEntities([]);
    options.weapons.reset();
    options.state.writer.setTransitionSerial(0);
  }

  function prepareScene(scene: QuakeScene): () => void {
    const collisionWorld = scene.collision ? buildQuakeClipCollisionWorld(scene.collision) : null;
    if (!collisionWorld) throw new Error(`Prepared Quake scene ${scene.label} is missing collision data.`);
    return () => mountPreparedScene(scene, collisionWorld);
  }

  function mountPreparedScene(scene: QuakeScene, collisionWorld: QuakeCollisionWorld): void {
    disposeCurrentScene();
    setCurrentScene(scene);
    clearSkyBackground();
    setCollisionWorld(collisionWorld);
    options.world.mount(scene);
    setupEntityActions(scene);
    const runtime = scene.entityManifest.runtime;
    options.audio.syncAmbientEntities(entitiesForIndexes(runtime.ambientEntityIndexes));
    options.setCamera(scene.spawn);
    options.shootables.spawn(shootableRuntimeEntities(runtime), options.currentModelLibrary(), options.currentProgramMetadata());
    setupMonsterJumpTriggers(scene);
    options.player.resetInventory();
    const origin = options.player.currentOrigin();
    options.shootables.syncVisibility(origin, true);
    options.pickups.spawn(entitiesForIndexes(runtime.pickupEntityIndexes), options.currentModelLibrary(), origin);
    const triggers = syncTouchedTriggers(origin);
    syncHazards(origin, triggers);
    options.pickups.syncCollision(origin, options.player.eyeHeight(), STEP_HEIGHT);
    options.viewmodel.syncTransform();
    options.world.syncVisibility(true);
    options.syncCrosshairTarget();
    void options.world.schedulePresentationResync();
    options.focusCurrentMenu();
    options.afterMountScene();
  }

  function respawnScene(scene: QuakeScene, previousOrigin: [number, number, number]): void {
    options.clearPlayerDeath();
    options.triggers.resetActive();
    const runtime = scene.entityManifest.runtime;
    options.shootables.spawn(shootableRuntimeEntities(runtime), options.currentModelLibrary(), options.currentProgramMetadata());
    setupMonsterJumpTriggers(scene);
    options.pickups.spawn(entitiesForIndexes(runtime.pickupEntityIndexes), options.currentModelLibrary(), previousOrigin);
  }

  function clearSkyBackground(): void {
    options.host.style.removeProperty("background-image");
    options.host.style.removeProperty("background-position");
    options.host.style.removeProperty("background-repeat");
    options.host.style.removeProperty("background-size");
    options.host.style.removeProperty("image-rendering");
  }

  function setupEntityActions(scene: QuakeScene): void {
    setEntityIndex(new Map(scene.entities.map((entity) => [entity.index, entity])));
    setModelPivot(scene.collision?.pivot ?? { x: 0, y: 0, z: 0 });
    const runtime = scene.entityManifest.runtime;
    options.damageableBrushes.setup(runtime.damageableBrushEntityIndexes);
    options.pointHazards.setup(runtime.fireballEmitterEntityIndexes);
    options.targets.setup(runtime, scene.gameLogic);
    options.triggers.clear();
    options.movers.setup(
      entitiesForIndexes([...runtime.moverEntityIndexes, ...runtime.moverSupportEntityIndexes]),
      scene.models,
      state.modelPivot,
      scene.gameLogic,
    );
  }

  function entitiesForIndexes(indexes: readonly number[]): QuakeEntity[] {
    const out: QuakeEntity[] = [];
    const seen = new Set<number>();
    for (const index of indexes) {
      if (seen.has(index)) continue;
      seen.add(index);
      const entity = state.entities.get(index);
      if (entity) out.push(entity);
    }
    return out;
  }

  function lineOfSight(start: Vec3, end: Vec3): boolean {
    const trace = state.collisionWorld?.traceUse?.(start, end);
    return !trace || trace.fraction >= 0.96;
  }

  function isPointInPlayerView(point: Vec3, minDot: number): boolean {
    return playerViewDot(point) >= minDot;
  }

  function playerViewDot(point: Vec3): number {
    const origin = options.player.currentOrigin();
    const toPoint: Vec3 = [point[0] - origin[0], point[1] - origin[1], 0];
    const toPointLength = Math.hypot(toPoint[0], toPoint[1]);
    if (toPointLength <= COLLISION_EPSILON) return 1;

    const forward = options.playerForward();
    const forwardHorizontal: Vec3 = [forward[0], forward[1], 0];
    const forwardLength = Math.hypot(forwardHorizontal[0], forwardHorizontal[1]);
    if (forwardLength <= COLLISION_EPSILON) return 1;

    const toPointUnit: Vec3 = [toPoint[0] / toPointLength, toPoint[1] / toPointLength, 0];
    const forwardUnit: Vec3 = [forwardHorizontal[0] / forwardLength, forwardHorizontal[1] / forwardLength, 0];
    return dotVec3(toPointUnit, forwardUnit);
  }

  function syncTouchedTriggers(origin: [number, number, number]): QuakeTouchedTrigger[] {
    return options.triggers.sync(origin);
  }

  function syncHazards(
    origin: [number, number, number],
    triggers = currentTouchedTriggers(origin),
  ): boolean {
    return options.player.syncHazard(currentHazard(origin, triggers));
  }

  function syncDebugGameplay(origin: [number, number, number]): void {
    const transitionSerial = state.transitionSerial;
    const triggers = syncTouchedTriggers(origin);
    if (state.transitionSerial !== transitionSerial) return;

    const currentOrigin = options.player.currentOrigin();
    if (syncHazards(currentOrigin, triggers)) return;
    options.pickups.syncCollision(currentOrigin, options.player.eyeHeight(), STEP_HEIGHT);
    options.shootables.syncVisibility(currentOrigin, true);
    options.viewmodel.syncTransform();
    options.world.syncVisibility(true);
    options.syncCrosshairTarget();
  }

  function currentTouchedTriggers(origin: [number, number, number]): QuakeTouchedTrigger[] {
    return [
      ...(state.collisionWorld?.touchingTriggers?.(origin, options.player.eyeHeight()) ?? []),
      ...options.movers.touchingDoorTriggerFields(origin, options.player.eyeHeight()),
    ].filter((trigger) => !options.targets.isDisabled(trigger.entityIndex));
  }

  function currentHazard(
    origin: [number, number, number],
    triggers = currentTouchedTriggers(origin),
  ): QuakeHazardDamage | null {
    let hazard: QuakeHazardDamage | null = null;
    for (const trigger of triggers) {
      const entity = state.entities.get(trigger.entityIndex);
      if (!entity) continue;
      const triggerHazard = quakeTriggerHurtDamage(entity, state.scene?.gameLogic);
      hazard = strongerHazard(
        hazard,
        triggerHazard ? { ...triggerHazard, entityIndex: trigger.entityIndex } : null,
      );
    }
    hazard = strongerHazard(hazard, options.pointHazards.hazardAt(origin));
    const contents = state.collisionWorld?.contentsAt?.(playerContentsPoint(origin));
    const waterLevel = quakePlayerWaterLevel(state.collisionWorld?.contentsAt, origin, options.player.eyeHeight());
    const contentsHazard = quakeContentsDamageForWaterLevel(contents, waterLevel);
    const radsuitActive = (
      contentsHazard?.kind === "slime" ||
      contentsHazard?.kind === "lava"
    ) && options.powerupActive("radsuit_finished");
    const protectedContentsHazard = quakeRadsuitProtectedContentsDamage(contentsHazard, radsuitActive);
    if (contentsHazard && !protectedContentsHazard) {
      options.trace("hazard-blocked", { kind: contentsHazard.kind, reason: "radsuit" });
    }
    return strongerHazard(hazard, protectedContentsHazard);
  }

  function playerContentsPoint(origin: [number, number, number]): Vec3 {
    return [origin[0], origin[1], origin[2] - options.player.eyeHeight() + QUAKE_HAZARD_FOOT_SAMPLE_Z];
  }

  function shootableRuntimeEntities(runtime: QuakeScene["entityManifest"]["runtime"]): QuakeEntity[] {
    return entitiesForIndexes([
      ...runtime.shootableEntityIndexes,
      ...runtime.moverSupportEntityIndexes,
    ]);
  }

  function setupMonsterJumpTriggers(scene: QuakeScene): void {
    options.shootables.setupMonsterJumpTriggers(
      scene.entities.filter((entity) => entity.classname === "trigger_monsterjump"),
      scene.models,
      scene.collision?.pivot ?? state.modelPivot,
      scene.gameLogic,
    );
  }

  function setEntityIndex(index: Map<number, QuakeEntity>): void {
    options.state.writer.setEntityIndex(index);
  }

  function setCollisionWorld(world: QuakeCollisionWorld | null): void {
    options.state.writer.setCollisionWorld(world);
  }

  function setCurrentScene(scene: QuakeScene | null): void {
    options.state.writer.setCurrentScene(scene);
  }

  function setModelPivot(pivot: { x: number; y: number; z: number }): void {
    options.state.writer.setModelPivot(pivot);
    options.onModelPivotChange(pivot);
  }

  return {
    currentTouchedTriggers,
    disposeCurrentScene,
    entitiesForIndexes,
    isPointInPlayerView,
    lineOfSight,
    mountScene: scene => prepareScene(scene)(),
    prepareScene,
    playerViewDot,
    respawnScene,
    setupMonsterJumpTriggers,
    shootableRuntimeEntities,
    syncDebugGameplay,
    syncHazards,
    syncTouchedTriggers,
  };
}

function strongerHazard(a: QuakeHazardDamage | null, b: QuakeHazardDamage | null): QuakeHazardDamage | null {
  if (!a) return b;
  if (!b) return a;
  return b.amount > a.amount ? b : a;
}

const QUAKE_HAZARD_FOOT_SAMPLE_Z = 2 * QUAKE_COLLISION_UNIT_SCALE;
