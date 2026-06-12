import { QUAKE_MONSTER_LOGIC, type QuakeMonsterLogicDefinition } from "../../generated/quakeMonsterLogic";
import type { QuakeMonsterStateRunner } from "../quakeMonsterStateRunner";
import type { QuakeEnemyState, QuakeMonsterPathCorner } from "./state";

export const QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS = 100;
export const QUAKE_MONSTER_USE_FOUND_TARGET_DELAY_MS = QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;

const quakeMonsterLogicByClassname = QUAKE_MONSTER_LOGIC as Readonly<Record<string, QuakeMonsterLogicDefinition>>;

export function createEnemyState(
  entityIndex: number,
  quakecRunner: QuakeMonsterStateRunner | null,
  movetarget: QuakeMonsterPathCorner | null,
  randomSalt: number,
): QuakeEnemyState {
  return {
    animationFrameIndex: 0,
    animationLockUntil: 0,
    animationMode: "idle",
    attackVisual: null,
    deathAnimationUntil: 0,
    nextAnimationFrameAt: 0,
    quakecAnimationChain: null,
    quakecActiveTouchDamage: null,
    quakecDeathChain: null,
    quakecFiredEvents: new Set(),
    quakecGibbed: false,
    quakecIdealYaw: null,
    quakecLastState: null,
    quakecMovementCall: null,
    quakecMovementHandledStep: false,
    quakecPartialGround: false,
    quakecMovementStateName: null,
    quakecMovementUnitsRemaining: 0,
    quakecPainChain: null,
    quakecPainFinishedUntil: 0,
    quakecRunner,
    awake: false,
    burstShotsRemaining: 0,
    currentTarget: null,
    monsterJumpTouchedTriggerEntityIndex: null,
    monsterJumpVelocity: [0, 0, 0],
    movetarget,
    nextAttackAt: 0,
    oldTarget: null,
    pendingAttack: null,
    seed: quakeEnemySeed(entityIndex, randomSalt),
    zombieGibbed: false,
    zombieNonSolidAt: 0,
    zombiePainRepeatUntil: 0,
    zombieRecoverUntil: 0,
    zombieSolidAt: 0,
  };
}

export function quakeMonsterChainDurationMs(
  classname: string,
  chain: string,
  runner: QuakeMonsterStateRunner,
  chainHoldMs: (classname: string, chain: string) => number,
): number {
  return Math.max(1, runner.chainLength(chain)) * QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS +
    chainHoldMs(classname, chain);
}

export function quakeMonsterStateOffsetMs(classname: string, chain: string, stateName: string): number {
  const states = quakeMonsterLogicByClassname[classname]?.chains?.[chain]?.states ?? [];
  const index = states.findIndex((state) => state.name === stateName);
  return Math.max(0, index) * QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;
}

export function enemyRandomRange(enemy: QuakeEnemyState, min: number, max: number): number {
  if (max <= min) return min;
  return min + nextEnemyRandom(enemy) * (max - min);
}

export function nextEnemyRandom(enemy: QuakeEnemyState): number {
  enemy.seed = (Math.imul(enemy.seed, 1664525) + 1013904223) >>> 0;
  return enemy.seed / 0x100000000;
}

export function quakeEnemyRandomSaltValue(salt: number | (() => number)): number {
  return normalizeEnemyRandomSalt(typeof salt === "function" ? salt() : salt);
}

function quakeEnemySeed(entityIndex: number, salt = 0): number {
  const base = (Math.imul(entityIndex + 0x9e3779b9, 0x85ebca6b) ^ 0xc2b2ae35) >>> 0;
  const normalizedSalt = normalizeEnemyRandomSalt(salt);
  if (normalizedSalt === 0) return base;
  let mixedSalt = Math.imul(normalizedSalt ^ 0x9e3779b9, 0x27d4eb2d) >>> 0;
  mixedSalt ^= mixedSalt >>> 15;
  return (base ^ mixedSalt ^ Math.imul(entityIndex ^ normalizedSalt, 0x165667b1)) >>> 0;
}

function normalizeEnemyRandomSalt(salt: number): number {
  return Number.isFinite(salt) ? salt >>> 0 : 0;
}
