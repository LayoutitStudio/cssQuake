import { QUAKE_MONSTER_LOGIC, type QuakeMonsterLogicDefinition } from "../../generated/quakeMonsterLogic";
import type { QuakeMonsterStateRunner } from "../quakeMonsterStateRunner";
import type { QuakeEnemyState, QuakeMonsterPathCorner } from "./state";

export const QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS = 100;
// ai.qc HuntTarget calls SUB_AttackFinished(1) when a monster first finds a target.
export const QUAKE_MONSTER_HUNT_TARGET_ATTACK_DELAY_MS = 10 * QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;
export const QUAKE_MONSTER_USE_FOUND_TARGET_DELAY_MS = QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;
export const QUAKE_MONSTER_USE_ATTACK_DELAY_MS =
  QUAKE_MONSTER_USE_FOUND_TARGET_DELAY_MS + QUAKE_MONSTER_HUNT_TARGET_ATTACK_DELAY_MS;

const quakeMonsterLogicByClassname = QUAKE_MONSTER_LOGIC as Readonly<Record<string, QuakeMonsterLogicDefinition>>;
const QUAKE_RANDOM_UINT64_MASK = (1n << 64n) - 1n;
const QUAKE_RANDOM_UINT32_MASK = 0xffffffffn;
const QUAKE_RANDOM_FLOAT_DENOMINATOR = 0x08000;
const QUAKE_RANDOM_FLOAT_MASK = 0x7fff;

export interface QuakeRandomStream {
  next(): number;
  range(min: number, max: number): number;
}

export function createEnemyState(
  entityIndex: number,
  quakecRunner: QuakeMonsterStateRunner | null,
  movetarget: QuakeMonsterPathCorner | null,
  randomSalt: number,
  initialIdealYaw: number | null = null,
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
    quakecIdealYaw: initialIdealYaw,
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

export function createQuakeRandomStream(seed: number): QuakeRandomStream {
  let state = quakeRandomSeed(seed);

  function nextComRand(): number {
    const s0 = state[0];
    const s1 = state[1] ^ s0;
    const result = Math.imul(rotl32(Math.imul(s0, 0x9e3779bb), 5), 5) >>> 0;
    state = [
      (rotl32(s0, 26) ^ s1 ^ ((s1 << 9) >>> 0)) >>> 0,
      rotl32(s1, 13),
    ];
    return result & 0xffffff;
  }

  function next(): number {
    return ((nextComRand() & QUAKE_RANDOM_FLOAT_MASK) / QUAKE_RANDOM_FLOAT_DENOMINATOR) +
      (0.5 / QUAKE_RANDOM_FLOAT_DENOMINATOR);
  }

  return {
    next,
    range(min: number, max: number): number {
      if (max <= min) return min;
      return min + next() * (max - min);
    },
  };
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

function quakeRandomSeed(seed: number): [number, number] {
  let z = (BigInt(normalizeEnemyRandomSalt(seed)) + 0x9e3779b97f4a7c15n) & QUAKE_RANDOM_UINT64_MASK;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & QUAKE_RANDOM_UINT64_MASK;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & QUAKE_RANDOM_UINT64_MASK;
  const state = (z ^ (z >> 31n)) & QUAKE_RANDOM_UINT64_MASK;
  return [
    Number(state & QUAKE_RANDOM_UINT32_MASK) >>> 0,
    Number((state >> 32n) & QUAKE_RANDOM_UINT32_MASK) >>> 0,
  ];
}

function rotl32(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}
