import { quakeMapLoadFailureIsCurrent, type QuakeMapLoadResult } from "./mapLoadOwnership";
import type { Vec3 } from "@layoutit/polycss";

import type { QuakeGameLogicFacts } from "../../prepare/gameLogicFacts";
import type { QuakeEntity } from "../../types/quake";
import type { QuakeSoundController } from "../audio";
import { QUAKE_COLLISION_UNIT_SCALE, STEP_HEIGHT } from "../constants";
import type { QuakeCollisionWorld, QuakeTouchedTrigger } from "../collision";
import { quakeEntityNumber } from "../entities";
import { distanceSq3, dotVec3, normalizeVec3, subtractVec3 } from "../math";
import { quakeDoorTerminalState, type QuakeMoversController } from "../movers";
import type { QuakePlayerController } from "../player";
import { quakeSolidGateActivation } from "../solidGates";
import type { QuakeShootablesController, QuakeShootablesControllerOptions } from "../shootables";
import type { QuakeTargetsController } from "../targets";
import {
  quakeTriggerChangelevelMap,
  quakeTriggerOnlyRegisteredActivation,
  quakeTriggerOneShot,
  quakeTriggerPushActivation,
  quakeTriggerSecretActivation,
  quakeTriggerSetSkillValue,
  quakeTriggerTeleportDestination,
  quakeTriggerWait,
} from "../triggerEffects";
import type { QuakeTriggersController } from "../triggers";
import type { QuakeViewmodelController } from "../viewmodel";
import type { QuakeWorldController } from "../world";

const QUAKE_INTERMISSION_AUTO_ADVANCE_MS = 5000;
const QUAKE_INTERMISSION_MIN_ADVANCE_MS = 1000;
const QUAKE_SHAREWARE_REGISTERED = false;
const QUAKE_TRAP_SPIKE_RANGE = 2048 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_TRAP_SPIKE_RADIUS = 36 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_TRAP_SPIKE_DAMAGE = 10;

type QuakeBossLightningAlignment = Parameters<
  NonNullable<QuakeShootablesControllerOptions["bossLightningElectrodesReady"]>
>[1];
type QuakeBossLightningDischarge = Parameters<
  NonNullable<QuakeShootablesControllerOptions["bossLightningDischarge"]>
>[1];
type QuakeDoorTerminalState = NonNullable<ReturnType<typeof quakeDoorTerminalState>>;

export interface QuakeEntityActivationFlowOptions {
  addBodyClasses(...classNames: string[]): void;
  audio: Pick<QuakeSoundController, "playEvent" | "playSound">;
  clearAttackInput(): void;
  currentCollisionWorld(): Pick<QuakeCollisionWorld, "traceUse"> | null;
  currentGameLogic(): QuakeGameLogicFacts | null | undefined;
  entities(): ReadonlyMap<number, QuakeEntity>;
  getOrigin(): [number, number, number];
  loadMap(mapName: string, options: { loadingStatus: string; resumeGameplay: boolean }): Promise<QuakeMapLoadResult>;
  mapExists(mapName: string): boolean;
  intermission: QuakeEntityActivationIntermission;
  movers: Pick<QuakeMoversController, "activateEntity" | "forceDoorsDownAfter" | "get">;
  onSecretActivated?(entity: QuakeEntity): void;
  pickups: Pick<QuakeEntityActivationPickups, "syncCollision">;
  player(): Pick<QuakePlayerController, "clearLevelState" | "currentOrigin" | "damage" | "eyeHeight" | "push" | "teleportTo">;
  pointToPoly(point: { x: number; y: number; z: number }): Vec3;
  publishWorldChanged(eventType: "entity.activate" | "level.complete", entityIndex: number, payload?: Record<string, unknown>): void;
  shootables: Pick<QuakeShootablesController, "activate" | "destroy" | "has" | "triggerBossLightning">;
  syncCrosshairTarget(): void;
  syncSceneCamera(rotX: number, rotY: number): void;
  syncTouchedTriggers(origin: [number, number, number]): QuakeTouchedTrigger[];
  targets: Pick<QuakeTargetsController, "disableEntity" | "entityIndexesFor" | "fire" | "isDisabled" | "useTargets">;
  text: QuakeEntityActivationText;
  transitionSerialIncrement(): void;
  triggers: Pick<QuakeTriggersController, "activateCounterEntity" | "activateTeleporterEntity" | "setActive">;
  viewmodel: Pick<QuakeViewmodelController, "clearFireAnimation" | "syncTransform">;
  world: Pick<QuakeWorldController, "syncVisibility">;
}

interface QuakeEntityActivationPickups {
  syncCollision(origin: [number, number, number], eyeHeight: number, stepHeight: number): void;
}

interface QuakeEntityActivationIntermission {
  show(): void;
  syncCamera(): void;
}

interface QuakeEntityActivationText {
  centerPrint(message: string): void;
  clearCenterPrint(): void;
  hasUseTargetsMessageText(entity: QuakeEntity): boolean;
  setCenterPrint(message: string): void;
  showDirectCenterPrintMessageText(entity: QuakeEntity): boolean;
}

export interface QuakeEntityActivationFlow {
  activateEntity(entityIndex: number, sourceEntityIndex?: number): boolean;
  activateSecretTrigger(entity: QuakeEntity): boolean;
  activateSolidTouch(touch: QuakeTouchedTrigger): void;
  activateSpecialTrigger(entity: QuakeEntity): boolean;
  activateTeleport(trigger: QuakeEntity): boolean;
  bossLightningDischarge(targetName: string, lightning: QuakeBossLightningDischarge): void;
  bossLightningElectrodesReady(targetName: string, alignment: QuakeBossLightningAlignment): boolean;
  clearLevelLoadTimer(): void;
  completeLevel(entity: QuakeEntity): void;
  fireTarget(targetname: string, sourceEntityIndex?: number): void;
  isLevelLoadPending(): boolean;
  requestIntermissionAdvance(): boolean;
  triggerCounter(entity: QuakeEntity): void;
  triggerOneShot(entity: QuakeEntity, fallback: boolean): boolean;
  triggerWait(entity: QuakeEntity, fallback: number): number;
}

export function createQuakeEntityActivationFlow(
  options: QuakeEntityActivationFlowOptions,
): QuakeEntityActivationFlow {
  let skill = 1;
  let levelLoadTimer: number | null = null;
  let intermissionActive = false;
  let intermissionAdvanceAt = Infinity;
  let intermissionNextMap: string | null = null;

  function activateTeleport(trigger: QuakeEntity): boolean {
    const destination = quakeTriggerTeleportDestination(trigger, {
      gameLogic: options.currentGameLogic(),
      getEntity,
      targetEntityIndexesFor: options.targets.entityIndexesFor,
    });
    if (!destination) return false;
    teleportPlayer(destination);
    return true;
  }

  function teleportPlayer(destination: QuakeEntity): void {
    options.transitionSerialIncrement();
    const player = options.player();
    if (!player.teleportTo(destination)) return;
    options.audio.playEvent("teleport", { volume: 0.64 });
    options.syncSceneCamera(90, (180 + quakeEntityNumber(destination, "angle", destination.angle ?? 0) + 360) % 360);
    const origin = player.currentOrigin();
    const triggers = options.syncTouchedTriggers(origin);
    options.triggers.setActive(triggers);
    options.pickups.syncCollision(origin, player.eyeHeight(), STEP_HEIGHT);
    options.viewmodel.syncTransform();
    options.world.syncVisibility(true);
    options.syncCrosshairTarget();
  }

  function completeLevel(entity: QuakeEntity): void {
    options.publishWorldChanged("level.complete", entity.index);
    options.transitionSerialIncrement();
    options.clearAttackInput();
    clearLevelLoadTimer();
    options.viewmodel.clearFireAnimation();
    options.addBodyClasses("quake-level-complete");
    options.player().clearLevelState();
    options.audio.playEvent("levelExit", { volume: 0.58 });
    const nextMap = quakeTriggerChangelevelMap(entity, options.currentGameLogic());
    if (!nextMap) options.text.setCenterPrint("EXIT REACHED");
    if (!nextMap) return;
    options.text.clearCenterPrint();
    intermissionActive = true;
    intermissionAdvanceAt = performance.now() + QUAKE_INTERMISSION_MIN_ADVANCE_MS;
    syncIntermissionCamera();
    options.intermission.show();
    if (!options.mapExists(nextMap)) return;
    intermissionNextMap = nextMap;
    levelLoadTimer = window.setTimeout(() => {
      void advanceIntermission("auto");
    }, QUAKE_INTERMISSION_AUTO_ADVANCE_MS);
  }

  function syncIntermissionCamera(): void {
    options.intermission.syncCamera();
    queueMicrotask(() => {
      if (intermissionActive) options.intermission.syncCamera();
    });
  }

  function activateSolidTouch(touch: QuakeTouchedTrigger): void {
    const entity = getEntity(touch.entityIndex);
    if (!entity) return;
    if (options.targets.isDisabled(entity.index)) return;
    if (activateSolidGate(entity)) return;
    if (solidTouchActivatesMover(entity, touch)) {
      activateEntity(entity.index);
    }
  }

  function solidTouchActivatesMover(entity: QuakeEntity, touch: QuakeTouchedTrigger): boolean {
    const mover = options.movers.get(entity.index);
    if (!mover) return false;
    if (mover.kind === "button") {
      return mover.prebakedButton
        ? Boolean(mover.prebakedButton.callbacks.touch)
        : quakeEntityNumber(entity, "health", 0) <= 0;
    }
    if (mover.kind === "door") {
      return mover.prebakedDoor
        ? mover.prebakedDoor.spawnDoorTrigger
        : !entity.properties.targetname && quakeEntityNumber(entity, "health", 0) <= 0;
    }
    if (mover.kind === "secret-door") {
      return Boolean(mover.prebakedSecretDoor?.callbacks.touch);
    }
    if (mover.kind === "plat") {
      return touch.contact === "plat-trigger" && Boolean(mover.prebakedPlat?.callbacks.centerTouch);
    }
    return false;
  }

  function fireTarget(targetname: string, sourceEntityIndex?: number): void {
    options.targets.fire(targetname, sourceEntityIndex);
  }

  function activateEntity(entityIndex: number, sourceEntityIndex?: number): boolean {
    if (options.targets.isDisabled(entityIndex)) return false;
    const entity = getEntity(entityIndex);
    if (!entity) return false;
    if (activateSpecialEntity(entity)) {
      return entity.classname === "trigger_push"
        ? true
        : publishEntityActivation(true, entity.index, sourceEntityIndex);
    }
    if (entity.classname === "trigger_counter") {
      triggerCounter(entity);
      return publishEntityActivation(true, entity.index, sourceEntityIndex);
    }
    if (entity.classname === "trigger_relay") {
      return publishEntityActivation(options.targets.useTargets(entity), entity.index, sourceEntityIndex);
    }
    if (entity.classname === "trigger_once" || entity.classname === "trigger_secret") {
      const activated = options.targets.useTargets(entity);
      if (triggerOneShot(entity, true)) options.targets.disableEntity(entity.index);
      return publishEntityActivation(activated, entity.index, sourceEntityIndex);
    }
    if (entity.classname === "trigger_multiple") {
      return publishEntityActivation(options.targets.useTargets(entity), entity.index, sourceEntityIndex);
    }
    if (entity.classname === "trigger_teleport") {
      if (!options.triggers.activateTeleporterEntity(entity)) return false;
      options.syncTouchedTriggers(options.getOrigin());
      return true;
    }
    if (entity.classname.startsWith("monster_")) {
      return publishEntityActivation(options.shootables.activate(entity.index, { skill }), entity.index, sourceEntityIndex);
    }
    if (options.shootables.has(entity.index)) {
      options.shootables.destroy(entity.index);
      return publishEntityActivation(true, entity.index, sourceEntityIndex);
    }
    return publishEntityActivation(
      options.movers.activateEntity(entity.index, sourceEntityIndex),
      entity.index,
      sourceEntityIndex,
    );
  }

  function publishEntityActivation(activated: boolean, entityIndex: number, sourceEntityIndex?: number): boolean {
    if (activated) {
      options.publishWorldChanged("entity.activate", entityIndex, {
        ...(sourceEntityIndex !== undefined ? { sourceEntityIndex } : {}),
      });
    }
    return activated;
  }

  function triggerCounter(entity: QuakeEntity): void {
    options.triggers.activateCounterEntity(entity);
  }

  function activateSpecialEntity(entity: QuakeEntity): boolean {
    if (activateSpecialTrigger(entity)) return true;
    if (entity.classname === "trap_spikeshooter") {
      activateSpikeShooter(entity);
      return true;
    }
    if (entity.classname === "event_lightning") {
      return options.shootables.triggerBossLightning({ skill });
    }
    return false;
  }

  function bossLightningElectrodesReady(
    targetName: string,
    alignment: QuakeBossLightningAlignment,
  ): boolean {
    if (alignment.targetField !== "target") return false;
    const states = bossLightningElectrodeStates(targetName);
    if (states.length < 2) return false;
    const firstState = states[0];
    const secondState = states[1];
    if (!alignment.validStates.includes(firstState) || !alignment.validStates.includes(secondState)) return false;
    if (alignment.requiresMatchingState && firstState !== secondState) return false;
    return firstState === alignment.damageState;
  }

  function bossLightningDischarge(targetName: string, lightning: QuakeBossLightningDischarge): void {
    const resetAfterMs = lightning.resetAfterMs;
    if (resetAfterMs === undefined || resetAfterMs <= 0) return;
    options.movers.forceDoorsDownAfter(targetName, resetAfterMs);
  }

  function bossLightningElectrodeStates(targetName: string): QuakeDoorTerminalState[] {
    const entities = [...options.entities().values()]
      .filter((entity) => entity.properties.target === targetName)
      .sort((a, b) => a.index - b.index)
      .slice(0, 2);
    const states: QuakeDoorTerminalState[] = [];
    for (const entity of entities) {
      const terminalState = doorTerminalStateForEntity(entity.index);
      if (!terminalState) return [];
      states.push(terminalState);
    }
    return states;
  }

  function doorTerminalStateForEntity(entityIndex: number): ReturnType<typeof quakeDoorTerminalState> {
    const mover = options.movers.get(entityIndex);
    return mover ? quakeDoorTerminalState(mover) : null;
  }

  function activateSpecialTrigger(entity: QuakeEntity): boolean {
    if (entity.classname === "trigger_secret") {
      activateSecretTrigger(entity);
      return false;
    }
    if (entity.classname === "trigger_push") {
      activatePushTrigger(entity);
      return true;
    }
    if (entity.classname === "trigger_setskill") {
      skill = quakeTriggerSetSkillValue(entity, options.currentGameLogic()) ?? 1;
      options.text.centerPrint(`SKILL ${skill}`);
      return true;
    }
    if (entity.classname === "trigger_onlyregistered") {
      const activation = quakeTriggerOnlyRegisteredActivation(entity, {
        fallbackMessage: "REGISTERED VERSION ONLY",
        gameLogic: options.currentGameLogic(),
        registered: QUAKE_SHAREWARE_REGISTERED,
      });
      if (activation?.allowed) {
        options.targets.useTargets(entity);
        return true;
      }
      if (!options.text.showDirectCenterPrintMessageText(entity)) {
        options.text.centerPrint(activation?.message ?? entityMessage(entity, "REGISTERED VERSION ONLY"));
      }
      return true;
    }
    return false;
  }

  function activatePushTrigger(entity: QuakeEntity): void {
    const activation = quakeTriggerPushActivation(entity, options.currentGameLogic());
    if (!activation) return;
    options.player().push([
      activation.velocity[0] * QUAKE_COLLISION_UNIT_SCALE,
      activation.velocity[1] * QUAKE_COLLISION_UNIT_SCALE,
      activation.velocity[2] * QUAKE_COLLISION_UNIT_SCALE,
    ]);
    if (activation.oneShot) {
      options.targets.disableEntity(entity.index);
    }
  }

  function activateSecretTrigger(entity: QuakeEntity): boolean {
    const activation = quakeTriggerSecretActivation(entity, options.currentGameLogic());
    if (!activation) return false;
    if (!options.text.hasUseTargetsMessageText(entity)) options.text.centerPrint(activation.message);
    options.audio.playSound(activation.sound, { volume: 0.58 });
    options.onSecretActivated?.(entity);
    return true;
  }

  function triggerOneShot(entity: QuakeEntity, fallback: boolean): boolean {
    return quakeTriggerOneShot(entity, options.currentGameLogic(), fallback);
  }

  function triggerWait(entity: QuakeEntity, fallback: number): number {
    return quakeTriggerWait(entity, options.currentGameLogic(), fallback);
  }

  function activateSolidGate(entity: QuakeEntity): boolean {
    const activation = quakeSolidGateActivation(entity);
    if (!activation) return false;
    options.text.centerPrint(activation.message);
    return true;
  }

  function entityMessage(entity: QuakeEntity, fallback: string): string {
    return (entity.properties.message || fallback).replace(/\\n/g, "\n");
  }

  function activateSpikeShooter(entity: QuakeEntity): boolean {
    if (!entity.origin) return false;
    const start = options.pointToPoly(entity.origin);
    const target = options.player().currentOrigin();
    const toPlayer = subtractVec3(target, start);
    const direction = entityDirection(entity);
    const forwardDistance = dotVec3(toPlayer, direction);
    if (forwardDistance < 0 || forwardDistance > QUAKE_TRAP_SPIKE_RANGE) return true;
    const closest: Vec3 = [
      start[0] + direction[0] * forwardDistance,
      start[1] + direction[1] * forwardDistance,
      start[2] + direction[2] * forwardDistance,
    ];
    if (distanceSq3(closest, target) > QUAKE_TRAP_SPIKE_RADIUS * QUAKE_TRAP_SPIKE_RADIUS) return true;
    const trace = options.currentCollisionWorld()?.traceUse?.(start, target);
    if (trace && trace.fraction < 0.96) return true;
    const damage = QUAKE_TRAP_SPIKE_DAMAGE * (entitySpawnflagsCompat(entity) & 1 ? 2 : 1);
    options.player().damage(damage);
    return true;
  }

  function clearLevelLoadTimer(): void {
    if (levelLoadTimer !== null) {
      window.clearTimeout(levelLoadTimer);
      levelLoadTimer = null;
    }
    intermissionActive = false;
    intermissionNextMap = null;
    intermissionAdvanceAt = Infinity;
  }

  function isLevelLoadPending(): boolean {
    return levelLoadTimer !== null || intermissionActive || intermissionNextMap !== null;
  }

  function requestIntermissionAdvance(): boolean {
    if (!intermissionActive) return false;
    if (!intermissionNextMap) return true;
    if (performance.now() < intermissionAdvanceAt) return true;
    void advanceIntermission("input");
    return true;
  }

  async function advanceIntermission(reason: "auto" | "input"): Promise<boolean> {
    const nextMap = intermissionNextMap;
    if (!nextMap) return false;
    if (reason === "input" && performance.now() < intermissionAdvanceAt) return true;
    if (levelLoadTimer !== null) {
      window.clearTimeout(levelLoadTimer);
      levelLoadTimer = null;
    }
    intermissionNextMap = null;
    intermissionAdvanceAt = Infinity;
    intermissionActive = false;
    try {
      await options.loadMap(nextMap, { loadingStatus: "Loading", resumeGameplay: true });
    } catch (error) {
      if (!quakeMapLoadFailureIsCurrent(error)) return true;
      console.error(error);
      options.text.setCenterPrint(`COULD NOT LOAD ${nextMap.toUpperCase()}`);
    }
    return true;
  }

  function getEntity(entityIndex: number): QuakeEntity | undefined {
    return options.entities().get(entityIndex);
  }

  return {
    activateEntity,
    activateSecretTrigger,
    activateSolidTouch,
    activateSpecialTrigger,
    activateTeleport,
    bossLightningDischarge,
    bossLightningElectrodesReady,
    clearLevelLoadTimer,
    completeLevel,
    fireTarget,
    isLevelLoadPending,
    requestIntermissionAdvance,
    triggerCounter,
    triggerOneShot,
    triggerWait,
  };
}

function entityDirection(entity: QuakeEntity): Vec3 {
  const angle = quakeEntityNumber(entity, "angle", entity.angle ?? 0);
  if (angle === -1) return [0, 0, 1];
  if (angle === -2) return [0, 0, -1];
  const radians = (angle * Math.PI) / 180;
  return normalizeVec3([Math.cos(radians), Math.sin(radians), 0]);
}

function entitySpawnflagsCompat(entity: QuakeEntity): number {
  return Math.trunc(quakeEntityNumber(entity, "spawnflags", 0));
}
