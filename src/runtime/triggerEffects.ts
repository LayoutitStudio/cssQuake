import type { QuakeGameLogicFacts } from "../prepare/gameLogicFacts";
import { quakeGameLogicResolvedTriggerFact } from "../prepare/gameLogicFacts";
import type { QuakeEntity } from "../types/quake";

export interface QuakeTriggerSecretActivation {
  message: string;
  oneShot: boolean;
  sound: string;
}

export interface QuakeTriggerTeleportDestinationOptions {
  gameLogic?: QuakeGameLogicFacts | null;
  getEntity: (entityIndex: number) => QuakeEntity | undefined;
  targetEntityIndexesFor: (targetname: string) => readonly number[];
}

export interface QuakeTriggerOnlyRegisteredActivationOptions {
  fallbackMessage: string;
  gameLogic?: QuakeGameLogicFacts | null;
  registered: boolean;
}

export interface QuakeTriggerOnlyRegisteredActivation {
  allowed: boolean;
  message?: string;
  registeredOnly: boolean;
}

export interface QuakeTriggerPushActivation {
  direction: [number, number, number];
  multiplier: number;
  oneShot: boolean;
  speed: number;
  velocity: [number, number, number];
}

export interface QuakeTriggerMonsterJumpRule {
  direction: [number, number, number];
  height: number;
  speed: number;
}

export interface QuakeTriggerMonsterJumpActivation extends QuakeTriggerMonsterJumpRule {
  horizontalApplied: boolean;
  verticalApplied: boolean;
  velocity: [number, number, number];
}

export interface QuakeTriggerMonsterJumpActorState {
  isFlying: boolean;
  isMonster: boolean;
  isSwimming: boolean;
  onGround: boolean;
}

const QUAKE_TRIGGER_SECRET_DEFAULT_MESSAGE = "You found a secret area!";
const QUAKE_TRIGGER_SECRET_DEFAULT_SOUND = "misc/secret.wav";
const QUAKE_TRIGGER_HURT_DEFAULT_DMG = 5;
const QUAKE_TRIGGER_PUSH_DEFAULT_SPEED = 1000;
const QUAKE_TRIGGER_PUSH_ONCE = 1;
const QUAKE_TRIGGER_PUSH_VELOCITY_MULTIPLIER = 10;
const QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_SPEED = 200;
const QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_HEIGHT = 200;

export function quakeTriggerSecretActivation(
  entity: QuakeEntity,
  gameLogic?: QuakeGameLogicFacts | null,
): QuakeTriggerSecretActivation | null {
  if (entity.classname !== "trigger_secret") return null;
  const fact = quakeGameLogicResolvedTriggerFact(gameLogic, entity.index);
  if (fact?.kind === "trigger_secret") {
    return {
      message: fact.message ?? QUAKE_TRIGGER_SECRET_DEFAULT_MESSAGE,
      oneShot: fact.oneShot,
      sound: fact.activationSound ?? QUAKE_TRIGGER_SECRET_DEFAULT_SOUND,
    };
  }
  return {
    message: quakeTriggerMessage(entity, QUAKE_TRIGGER_SECRET_DEFAULT_MESSAGE),
    oneShot: true,
    sound: QUAKE_TRIGGER_SECRET_DEFAULT_SOUND,
  };
}

export function quakeTriggerOneShot(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null | undefined,
  fallback: boolean,
): boolean {
  const fact = quakeGameLogicResolvedTriggerFact(gameLogic, entity.index);
  if (fact) return fact.oneShot;
  return fallback;
}

export function quakeTriggerWait(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null | undefined,
  fallback: number,
): number {
  const fact = quakeGameLogicResolvedTriggerFact(gameLogic, entity.index);
  if (fact?.wait !== undefined) return quakeFiniteNumber(fact.wait, fallback);
  return quakeDefaultedNumber(entity.properties.wait, fallback);
}

export function quakeTriggerTeleportDestination(
  entity: QuakeEntity,
  options: QuakeTriggerTeleportDestinationOptions,
): QuakeEntity | null {
  if (entity.classname !== "trigger_teleport") return null;
  const fact = quakeGameLogicResolvedTriggerFact(options.gameLogic, entity.index);
  if (fact?.kind === "trigger_teleport" && fact.destinationEntityIndexes?.length) {
    const destination = quakeFirstTeleportDestination(fact.destinationEntityIndexes, options.getEntity);
    if (destination) return destination;
  }
  const target = entity.properties.target;
  if (!target) return null;
  return quakeFirstTeleportDestination(options.targetEntityIndexesFor(target), options.getEntity);
}

export function quakeTriggerChangelevelMap(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null | undefined,
): string | null {
  if (entity.classname !== "trigger_changelevel") return null;
  const fact = quakeGameLogicResolvedTriggerFact(gameLogic, entity.index);
  const factMap = fact?.kind === "trigger_changelevel" ? quakeNormalizedMapName(fact.changelevelMap) : null;
  return factMap ?? quakeNormalizedMapName(entity.properties.map);
}

export function quakeTriggerSetSkillValue(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null | undefined,
): number | null {
  if (entity.classname !== "trigger_setskill") return null;
  const fact = quakeGameLogicResolvedTriggerFact(gameLogic, entity.index);
  if (fact?.kind === "trigger_setskill") return quakeNormalizedSkillValue(fact.skillValue ?? 1);
  return quakeNormalizedSkillValue(Number.parseFloat(entity.properties.message ?? "1"));
}

export function quakeTriggerHurtDamageAmount(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null | undefined,
): number | null {
  if (entity.classname !== "trigger_hurt") return null;
  const fact = quakeGameLogicResolvedTriggerFact(gameLogic, entity.index);
  const amount = fact?.kind === "trigger_hurt"
    ? quakeNonNegativeNumber(fact.dmg ?? QUAKE_TRIGGER_HURT_DEFAULT_DMG)
    : quakeNonNegativeNumber(quakeDefaultedNumber(entity.properties.dmg, QUAKE_TRIGGER_HURT_DEFAULT_DMG));
  return amount > 0 ? amount : null;
}

export function quakeTriggerPushActivation(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null | undefined,
): QuakeTriggerPushActivation | null {
  if (entity.classname !== "trigger_push") return null;
  const fact = quakeGameLogicResolvedTriggerFact(gameLogic, entity.index);
  const direction = fact?.kind === "trigger_push" && fact.moveDirection
    ? quakeVectorTuple(fact.moveDirection)
    : quakeTriggerMoveDirection(entity);
  const speed = fact?.kind === "trigger_push"
    ? quakeFiniteNumber(fact.speed ?? QUAKE_TRIGGER_PUSH_DEFAULT_SPEED, QUAKE_TRIGGER_PUSH_DEFAULT_SPEED)
    : quakePositiveDefaultedNumber(entity.properties.speed, QUAKE_TRIGGER_PUSH_DEFAULT_SPEED);
  const multiplier = fact?.kind === "trigger_push"
    ? quakeFiniteNumber(fact.pushVelocityMultiplier ?? QUAKE_TRIGGER_PUSH_VELOCITY_MULTIPLIER, QUAKE_TRIGGER_PUSH_VELOCITY_MULTIPLIER)
    : QUAKE_TRIGGER_PUSH_VELOCITY_MULTIPLIER;
  const velocity: [number, number, number] = [
    direction[0] * speed * multiplier,
    direction[1] * speed * multiplier,
    direction[2] * speed * multiplier,
  ];
  return {
    direction,
    multiplier,
    oneShot: fact?.kind === "trigger_push" ? fact.oneShot : (quakeEntitySpawnflags(entity) & QUAKE_TRIGGER_PUSH_ONCE) !== 0,
    speed,
    velocity,
  };
}

export function quakeTriggerMonsterJumpActivation(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null | undefined,
  actor: QuakeTriggerMonsterJumpActorState,
): QuakeTriggerMonsterJumpActivation | null {
  const rule = quakeTriggerMonsterJumpRule(entity, gameLogic);
  return rule ? quakeTriggerMonsterJumpActivationFromRule(rule, actor) : null;
}

export function quakeTriggerMonsterJumpRule(
  entity: QuakeEntity,
  gameLogic: QuakeGameLogicFacts | null | undefined,
): QuakeTriggerMonsterJumpRule | null {
  if (entity.classname !== "trigger_monsterjump") return null;
  const fact = quakeGameLogicResolvedTriggerFact(gameLogic, entity.index);
  const monsterJump = fact?.kind === "trigger_monsterjump" ? fact.monsterJump : undefined;
  let direction = quakeTriggerMoveDirection(entity);
  if (fact?.kind === "trigger_monsterjump" && fact.moveDirection) {
    direction = quakeVectorTuple(fact.moveDirection);
  }
  if (monsterJump?.horizontal.moveDirection) {
    direction = quakeVectorTuple(monsterJump.horizontal.moveDirection);
  }

  let speed = fact?.kind === "trigger_monsterjump"
    ? quakeFiniteNumber(fact.speed ?? QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_SPEED, QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_SPEED)
    : quakeDefaultedNumber(entity.properties.speed, QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_SPEED);
  if (monsterJump) speed = quakeFiniteNumber(monsterJump.horizontal.speed, QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_SPEED);

  let height = fact?.kind === "trigger_monsterjump"
    ? quakeFiniteNumber(fact.height ?? QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_HEIGHT, QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_HEIGHT)
    : quakeDefaultedNumber(entity.properties.height, QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_HEIGHT);
  if (monsterJump) height = quakeFiniteNumber(monsterJump.vertical.height, QUAKE_TRIGGER_MONSTERJUMP_DEFAULT_HEIGHT);

  return { direction, height, speed };
}

export function quakeTriggerMonsterJumpActivationFromRule(
  rule: QuakeTriggerMonsterJumpRule,
  actor: QuakeTriggerMonsterJumpActorState,
): QuakeTriggerMonsterJumpActivation | null {
  if (!actor.isMonster || actor.isFlying || actor.isSwimming) return null;
  const verticalApplied = actor.onGround;
  return {
    direction: rule.direction,
    height: rule.height,
    horizontalApplied: true,
    speed: rule.speed,
    verticalApplied,
    velocity: [
      rule.direction[0] * rule.speed,
      rule.direction[1] * rule.speed,
      verticalApplied ? rule.height : 0,
    ],
  };
}

export function quakeTriggerOnlyRegisteredActivation(
  entity: QuakeEntity,
  options: QuakeTriggerOnlyRegisteredActivationOptions,
): QuakeTriggerOnlyRegisteredActivation | null {
  if (entity.classname !== "trigger_onlyregistered") return null;
  const fact = quakeGameLogicResolvedTriggerFact(options.gameLogic, entity.index);
  const registeredOnly = fact?.kind === "trigger_onlyregistered"
    ? fact.registeredOnly === true
    : true;
  if (options.registered || !registeredOnly) {
    return { allowed: true, registeredOnly };
  }
  return {
    allowed: false,
    message: fact?.kind === "trigger_onlyregistered"
      ? quakeTriggerFactMessage(fact.message, options.fallbackMessage)
      : quakeTriggerMessage(entity, options.fallbackMessage),
    registeredOnly,
  };
}

function quakeTriggerMessage(entity: QuakeEntity, fallback: string): string {
  return (entity.properties.message || fallback).replace(/\\n/g, "\n");
}

function quakeTriggerFactMessage(message: string | undefined, fallback: string): string {
  return (message || fallback).replace(/\\n/g, "\n");
}

function quakeNormalizedMapName(map: string | undefined): string | null {
  const normalized = map?.trim().toLowerCase();
  return normalized || null;
}

function quakeDefaultedNumber(raw: string | undefined, fallback: number): number {
  const value = Number.parseFloat(raw ?? "");
  return Number.isFinite(value) && value !== 0 ? value : fallback;
}

function quakePositiveDefaultedNumber(raw: string | undefined, fallback: number): number {
  const value = Number.parseFloat(raw ?? "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function quakeFiniteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function quakeNonNegativeNumber(value: number): number {
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

function quakeNormalizedSkillValue(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 1));
}

function quakeEntitySpawnflags(entity: QuakeEntity): number {
  return Math.trunc(quakeDefaultedNumber(entity.properties.spawnflags, 0));
}

function quakeTriggerMoveDirection(entity: QuakeEntity): [number, number, number] {
  const angle = Number.parseFloat(entity.properties.angle ?? String(entity.angle ?? 0));
  if (angle === -1) return [0, 0, 1];
  if (angle === -2) return [0, 0, -1];
  const radians = ((Number.isFinite(angle) ? angle : 0) * Math.PI) / 180;
  return [Math.cos(radians), Math.sin(radians), 0];
}

function quakeVectorTuple(vector: { x: number; y: number; z: number }): [number, number, number] {
  return [
    quakeFiniteNumber(vector.x, 0),
    quakeFiniteNumber(vector.y, 0),
    quakeFiniteNumber(vector.z, 0),
  ];
}

function quakeFirstTeleportDestination(
  entityIndexes: readonly number[],
  getEntity: (entityIndex: number) => QuakeEntity | undefined,
): QuakeEntity | null {
  for (const entityIndex of entityIndexes) {
    const entity = getEntity(entityIndex);
    if (entity?.classname === "info_teleport_destination" && entity.origin) return entity;
  }
  return null;
}
