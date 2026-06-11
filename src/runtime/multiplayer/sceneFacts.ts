import type {
  QuakeGameLogicFacts,
  QuakeGameLogicResolvedPickupFact,
  QuakeGameLogicResolvedPickupRespawnRuleFact,
} from "../../prepare/gameLogicFacts";
import type { QuakeEntity, QuakeVertex } from "../../types/quake";
import { QUAKE_COLLISION_UNIT_SCALE, QUAKE_PLAYER_MINS_Z } from "../constants";
import { createQuakeMultiplayerGameplayDefinitions } from "./facts";
import type {
  QuakeMultiplayerGameplayDefinitions,
  QuakeMultiplayerPickupDefinition,
  QuakeMultiplayerPickupEffect,
  QuakeMultiplayerPickupLifecycle,
  QuakeMultiplayerSpawnPoint,
  QuakeMultiplayerVec3,
} from "./protocol";

export interface QuakeMultiplayerSceneGameplaySource {
  entities: readonly QuakeEntity[];
  entityManifest: {
    runtime: {
      pickupEntityIndexes: readonly number[];
      targetEntities?: Record<string, readonly number[]>;
    };
  };
  gameLogic?: QuakeGameLogicFacts;
  collision?: {
    pivot?: QuakeVertex;
  };
  spawn: {
    origin: QuakeMultiplayerVec3;
    eyeHeight?: number;
    rotX: number;
    rotY: number;
  };
}

export interface QuakeMultiplayerSceneGameplayOptions {
  pointToRoom?(point: { x: number; y: number; z: number }): QuakeMultiplayerVec3;
  playerEyeHeight?: number;
  playerMinsZ?: number;
  deathmatch?: number;
  coop?: boolean;
  singleplayer?: boolean;
}

export function quakeMultiplayerGameplayDefinitionsFromScene(
  scene: QuakeMultiplayerSceneGameplaySource,
  options: QuakeMultiplayerSceneGameplayOptions,
): QuakeMultiplayerGameplayDefinitions {
  const sceneOptions = quakeMultiplayerSceneGameplayOptions(scene, options);
  const deathmatchSpawns = quakeMultiplayerDeathmatchSpawnsFromSceneFacts(scene, sceneOptions);
  const pickupDefinitions = quakeMultiplayerPickupDefinitionsFromSceneFacts(scene, sceneOptions);
  return createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns,
    pickupDefinitions,
  });
}

function quakeMultiplayerSceneGameplayOptions(
  scene: QuakeMultiplayerSceneGameplaySource,
  options: QuakeMultiplayerSceneGameplayOptions,
): QuakeMultiplayerSceneGameplayOptions & { pivot?: QuakeVertex } {
  return {
    ...options,
    ...(options.playerEyeHeight === undefined && scene.spawn.eyeHeight !== undefined
      ? { playerEyeHeight: scene.spawn.eyeHeight }
      : {}),
    ...(scene.collision?.pivot ? { pivot: scene.collision.pivot } : {}),
  };
}

export function quakeMultiplayerDeathmatchSpawnsFromSceneFacts(
  scene: QuakeMultiplayerSceneGameplaySource,
  options: QuakeMultiplayerSceneGameplayOptions,
): QuakeMultiplayerSpawnPoint[] {
  const sceneOptions = quakeMultiplayerSceneGameplayOptions(scene, options);
  const deathmatchSpawns = scene.entities
    .filter((entity) => entity.classname === "info_player_deathmatch")
    .map((entity) => quakeMultiplayerSpawnPointFromEntity(entity, sceneOptions))
    .filter((spawn): spawn is QuakeMultiplayerSpawnPoint => Boolean(spawn));
  if (deathmatchSpawns.length) return deathmatchSpawns;
  return [{
    spawnId: "spawn:singleplayer:start",
    classname: "info_player_start",
    origin: scene.spawn.origin,
    rotX: scene.spawn.rotX,
    rotY: scene.spawn.rotY,
  }];
}

export function quakeMultiplayerPickupDefinitionsFromSceneFacts(
  scene: QuakeMultiplayerSceneGameplaySource,
  options: QuakeMultiplayerSceneGameplayOptions,
): QuakeMultiplayerPickupDefinition[] {
  const sceneOptions = quakeMultiplayerSceneGameplayOptions(scene, options);
  const gameLogic = scene.gameLogic ?? null;
  const logicEntityByIndex = quakeGameLogicEntityMap(gameLogic);
  const pickupEntityIndexes = new Set(scene.entityManifest.runtime.pickupEntityIndexes);
  return scene.entities
    .filter((entity) => pickupEntityIndexes.has(entity.index) || Boolean(logicEntityByIndex.get(entity.index)?.resolvedPickup))
    .map((entity) => quakeMultiplayerPickupDefinitionFromSceneEntity(entity, scene, gameLogic, logicEntityByIndex, sceneOptions))
    .filter((definition): definition is QuakeMultiplayerPickupDefinition => Boolean(definition));
}

function quakeMultiplayerSpawnPointFromEntity(
  entity: QuakeEntity,
  options: QuakeMultiplayerSceneGameplayOptions,
): QuakeMultiplayerSpawnPoint | null {
  if (!entity.origin) return null;
  const origin = quakeMultiplayerPointToRoom(entity.origin, options);
  return {
    spawnId: `entity:${entity.index}`,
    classname: entity.classname as QuakeMultiplayerSpawnPoint["classname"],
    origin: [
      origin[0],
      origin[1],
      origin[2] + (options.playerMinsZ ?? QUAKE_PLAYER_MINS_Z) + (options.playerEyeHeight ?? 0),
    ],
    rotX: 90,
    rotY: quakeMultiplayerEntityYaw(entity),
    sourceEntityIndex: entity.index,
  };
}

function quakeMultiplayerPickupDefinitionFromSceneEntity(
  entity: QuakeEntity,
  scene: QuakeMultiplayerSceneGameplaySource,
  gameLogic: QuakeGameLogicFacts | null,
  logicEntityByIndex: ReadonlyMap<number, QuakeGameLogicEntityLike>,
  options: QuakeMultiplayerSceneGameplayOptions,
): QuakeMultiplayerPickupDefinition | null {
  const logicEntity = logicEntityByIndex.get(entity.index);
  const resolvedPickup = logicEntity?.resolvedPickup ?? quakeGameLogicResolvedPickupFact(gameLogic, entity.index);
  const sourceOrigin = entity.origin ?? logicEntity?.origin;
  if (!sourceOrigin || !resolvedPickup) return null;
  const effect = quakeMultiplayerPickupEffectFromResolvedFact(entity.classname, resolvedPickup);
  if (!effect) return null;
  const lifecycle = quakeMultiplayerPickupLifecycleFromResolvedFact(resolvedPickup, options);
  const feedbackMessage = resolvedPickup.feedback?.message;
  const targetUse = quakeMultiplayerPickupTargetUseFromEntity(entity, scene);
  return {
    pickupId: `entity:${entity.index}`,
    entityIndex: entity.index,
    classname: entity.classname,
    origin: quakeMultiplayerPointToRoom(sourceOrigin, options),
    effect,
    ...(lifecycle ? { lifecycle } : {}),
    ...(feedbackMessage ? { feedback: { message: feedbackMessage } } : {}),
    ...targetUse,
  };
}

function quakeMultiplayerPickupTargetUseFromEntity(
  entity: QuakeEntity,
  scene: QuakeMultiplayerSceneGameplaySource,
): Partial<Pick<
  QuakeMultiplayerPickupDefinition,
  "targetEntityIndexes" | "killtargetEntityIndexes" | "delayMs" | "message"
>> {
  const target = entity.properties.target?.trim();
  const killtarget = entity.properties.killtarget?.trim();
  const delay = quakeMultiplayerSecondsToMs(entity.properties.delay);
  const message = entity.properties.message?.trim();
  return {
    ...(target
      ? { targetEntityIndexes: [...(scene.entityManifest.runtime.targetEntities?.[target] ?? [])] }
      : {}),
    ...(killtarget
      ? { killtargetEntityIndexes: [...(scene.entityManifest.runtime.targetEntities?.[killtarget] ?? [])] }
      : {}),
    ...(delay > 0 ? { delayMs: delay } : {}),
    ...(message ? { message } : {}),
  };
}

function quakeMultiplayerPickupEffectFromResolvedFact(
  classname: string,
  fact: QuakeGameLogicResolvedPickupFact,
): QuakeMultiplayerPickupEffect | null {
  const ammoEffect = quakeMultiplayerAmmoPickupEffect(fact.behavior?.ammo);
  if (ammoEffect) return ammoEffect;
  const weaponEffect = quakeMultiplayerWeaponPickupEffect(classname, fact.behavior?.weapon);
  if (weaponEffect) return weaponEffect;
  const key = fact.behavior?.key;
  if (key) return { key: key.key };
  const effect: QuakeMultiplayerPickupEffect = { ...fact.inventoryDelta };
  const armor = fact.behavior?.armor;
  if (armor && effect.armor !== undefined) effect.armorType = armor.armorType;
  const powerup = fact.behavior?.powerup;
  if (powerup) {
    effect.powerup = {
      activationField: powerup.activationField,
      durationMs: powerup.durationSeconds * 1000,
      finishedField: powerup.finishedField,
      itemFlag: powerup.itemFlag,
      itemFlagExpression: powerup.itemFlagExpression,
    };
  }
  return Object.keys(effect).length ? effect : null;
}

function quakeMultiplayerAmmoPickupEffect(
  ammoGrant: { inventoryField: "shells" | "nails" | "rockets" | "cells"; amount: number } | undefined,
): QuakeMultiplayerPickupEffect | null {
  if (!ammoGrant) return null;
  return {
    [ammoGrant.inventoryField]: ammoGrant.amount,
  };
}

function quakeMultiplayerWeaponPickupEffect(
  classname: string,
  weapon: {
    itemFlag: number;
    itemFlagExpression: string;
    ammoGrant: { inventoryField: "shells" | "nails" | "rockets" | "cells"; amount: number };
  } | undefined,
): QuakeMultiplayerPickupEffect | null {
  if (!weapon) return null;
  const ammo = quakeMultiplayerAmmoPickupEffect(weapon.ammoGrant) ?? {};
  const id = quakeMultiplayerWeaponIdForPickupClassname(classname);
  if (!id) return ammo;
  return {
    ...ammo,
    weapon: {
      id,
      itemFlag: weapon.itemFlag,
      select: true,
    },
  };
}

function quakeMultiplayerWeaponIdForPickupClassname(classname: string): string | undefined {
  if (classname === "weapon_supershotgun") return "supershotgun";
  if (classname === "weapon_nailgun") return "nailgun";
  if (classname === "weapon_supernailgun") return "supernailgun";
  if (classname === "weapon_grenadelauncher") return "grenadelauncher";
  if (classname === "weapon_rocketlauncher") return "rocketlauncher";
  if (classname === "weapon_lightning") return "lightning";
  return undefined;
}

function quakeMultiplayerPickupLifecycleFromResolvedFact(
  fact: QuakeGameLogicResolvedPickupFact,
  options: QuakeMultiplayerSceneGameplayOptions,
): QuakeMultiplayerPickupLifecycle | undefined {
  const rules = fact.lifecycle?.respawn.rules ?? [];
  for (const rule of rules) {
    if (rule.action === "rot") continue;
    if (!quakeMultiplayerPickupLifecycleConditionMatches(rule.condition, options)) continue;
    return quakeMultiplayerPickupLifecycleFromRule(rule);
  }
  return undefined;
}

function quakeMultiplayerPickupLifecycleFromRule(
  rule: QuakeGameLogicResolvedPickupRespawnRuleFact,
): QuakeMultiplayerPickupLifecycle | undefined {
  if (rule.action === "rot") return undefined;
  if (rule.action === "respawn") {
    if (typeof rule.delaySeconds !== "number" || !Number.isFinite(rule.delaySeconds)) return undefined;
    return {
      action: "respawn",
      condition: rule.condition,
      delayMs: rule.delaySeconds * 1000,
    };
  }
  return {
    action: rule.action,
    condition: rule.condition,
  };
}

function quakeMultiplayerSecondsToMs(value: string | number | undefined): number {
  const seconds = typeof value === "number" ? value : value !== undefined ? Number.parseFloat(value) : 0;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function quakeMultiplayerPickupLifecycleConditionMatches(
  condition: string,
  options: QuakeMultiplayerSceneGameplayOptions,
): boolean {
  const deathmatch = Math.max(0, Math.round(options.deathmatch ?? 1));
  const coop = options.coop === true;
  const singleplayer = options.singleplayer ?? (deathmatch === 0 && !coop);
  switch (condition) {
    case "pickup":
      return true;
    case "singleplayer":
      return singleplayer;
    case "coop":
      return coop;
    case "!coop":
      return !coop;
    case "deathmatch":
      return deathmatch !== 0;
    case "!deathmatch":
      return deathmatch === 0;
    case "deathmatch == 1":
      return deathmatch === 1;
    case "deathmatch == 2":
      return deathmatch === 2;
    case "deathmatch != 1":
      return deathmatch !== 1;
    case "deathmatch != 2":
      return deathmatch !== 2;
    case "deathmatch && deathmatch != 2":
      return deathmatch !== 0 && deathmatch !== 2;
    case "deathmatch == 2 || coop":
      return deathmatch === 2 || coop;
    case "singleplayer || deathmatch != 1":
      return singleplayer || deathmatch !== 1;
    case "singleplayer || deathmatch == 2":
      return singleplayer || deathmatch === 2;
    case "!(deathmatch == 2 || coop)":
      return deathmatch !== 2 && !coop;
    default:
      return false;
  }
}

function quakeGameLogicEntityMap(gameLogic: QuakeGameLogicFacts | null): ReadonlyMap<number, QuakeGameLogicEntityLike> {
  return new Map((gameLogic?.entities ?? []).map((entity) => [entity.entityIndex, entity]));
}

function quakeGameLogicResolvedPickupFact(
  gameLogic: QuakeGameLogicFacts | null,
  entityIndex: number,
): QuakeGameLogicResolvedPickupFact | undefined {
  return gameLogic?.entities.find((entity) => entity.entityIndex === entityIndex)?.resolvedPickup;
}

function quakeMultiplayerEntityYaw(entity: QuakeEntity): number {
  const value = typeof entity.angle === "number"
    ? entity.angle
    : Number(entity.properties.angle);
  const angle = Number.isFinite(value) ? value : 0;
  return (180 + angle + 360) % 360;
}

export function quakeMultiplayerPointToRoom(
  point: { x: number; y: number; z: number },
  options: QuakeMultiplayerSceneGameplayOptions & { pivot?: QuakeVertex },
): QuakeMultiplayerVec3 {
  if (options.pointToRoom) return options.pointToRoom(point);
  const pivot = options.pivot ?? { x: 0, y: 0, z: 0 };
  return [
    (point.x - pivot.x) * QUAKE_COLLISION_UNIT_SCALE,
    (point.y - pivot.y) * QUAKE_COLLISION_UNIT_SCALE,
    (point.z - pivot.z) * QUAKE_COLLISION_UNIT_SCALE,
  ];
}

type QuakeGameLogicEntityLike = {
  entityIndex: number;
  origin?: QuakeVertex;
  resolvedPickup?: QuakeGameLogicResolvedPickupFact;
};
