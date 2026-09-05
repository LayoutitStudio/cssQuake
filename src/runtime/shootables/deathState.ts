import type { Vec3 } from "@layoutit/polycss";

import {
  QUAKE_MONSTER_LOGIC,
  type QuakeMonsterDeathBackpackProfile,
  type QuakeMonsterDeathGibOutput,
  type QuakeMonsterLogicDefinition,
  type QuakeMonsterRandomBranch,
} from "../../generated/quakeMonsterLogic";
import type { QuakeEntity } from "../../types/quake";
import { QUAKE_COLLISION_UNIT_SCALE } from "../constants";
import type { QuakePickupEffect } from "../pickups";
import type { QuakeMonsterStateRunner, QuakeMonsterStateStep } from "../quakeMonsterStateRunner";
import { quakeShootableDefaultHealth } from "./damage";
import {
  quakeMonsterBackpackAmmoEffect,
  quakeMonsterBackpackMessage,
  quakeMonsterDeathReactionPolicy,
  shootableDeathGibOutput,
} from "./deathOutput";
import type {
  QuakeEnemyState,
  QuakeMonsterAnimationMode,
  QuakeMonsterAnimationProfile,
  QuakeMonsterAnimationRange,
  QuakeShootableDamageContext,
  QuakeShootableState,
} from "./state";

export const QUAKE_ZOMBIE_DOWN_HOLD_MS = 5000;

const QUAKE_ZOMBIE_GIB_DAMAGE = 60;
const QUAKE_ZOMBIE_IGNORE_DAMAGE = 9;
const QUAKE_ZOMBIE_DROP_DAMAGE = 25;
const QUAKE_ZOMBIE_PAIN_REPEAT_WINDOW_MS = 3000;
const QUAKE_ZOMBIE_LIGHT_PAIN_CHAINS = ["pain_light_a", "pain_light_b", "pain_light_c", "pain_light_d"];
const QUAKE_SHOOTABLE_DEATH_DELAY_MS = 180;
const quakeMonsterLogicByClassname = QUAKE_MONSTER_LOGIC as Readonly<Record<string, QuakeMonsterLogicDefinition>>;

type QuakeDeathTraceDetails = Record<string, boolean | number | string | null | undefined>;

export interface QuakeMonsterBackpackDropRuntime {
  ammo: QuakePickupEffect;
  message?: string;
  modelPath?: string;
  origin: Vec3;
  removeAfterSeconds?: number;
  soundPath?: string;
  sourceEntity: QuakeEntity;
}

export interface QuakeShootableDeathStateRuntimeOptions {
  activateAnimationFrame(shootable: QuakeShootableState, frameIndex: number): void;
  animationProfile(shootable: QuakeShootableState): QuakeMonsterAnimationProfile | undefined;
  boundedAnimationRange(range: QuakeMonsterAnimationRange, model: NonNullable<QuakeShootableState["model"]>): QuakeMonsterAnimationRange;
  chainDurationMs(classname: string, chain: string, runner: QuakeMonsterStateRunner): number;
  clearAttackState(shootable: QuakeShootableState): void;
  countHandles(shootable: QuakeShootableState): number;
  hasHandle(shootable: QuakeShootableState): boolean;
  destroyZombieGib(shootable: QuakeShootableState, context: QuakeShootableDamageContext): boolean;
  dropBackpack?: (drop: QuakeMonsterBackpackDropRuntime) => boolean | void;
  flashShootable(shootable: QuakeShootableState): void;
  isScriptedBoss(classname: string): boolean;
  markTrace(kind: string, shootable: QuakeShootableState, details?: QuakeDeathTraceDetails): void;
  nextRandom(enemy: QuakeEnemyState): number;
  playPainAnimation(shootable: QuakeShootableState, now: number, damageAmount: number): boolean;
  playQuakecSound(
    soundPath: string,
    shootable: QuakeShootableState,
    mode: QuakeMonsterAnimationMode,
    now: number,
  ): boolean;
  spawnDeathOutputVisuals(shootable: QuakeShootableState, gib: QuakeMonsterDeathGibOutput): void;
  startQuakecNamedChain(
    shootable: QuakeShootableState,
    chain: string,
    mode: QuakeMonsterAnimationMode,
    now: number,
  ): number | null;
  startQuakecOneShotDeath(shootable: QuakeShootableState, now: number): number | null;
  stateOffsetMs(classname: string, chain: string, stateName: string): number;
  syncLifecycleClasses(shootable: QuakeShootableState): void;
}

export interface QuakeShootableDeathStateRuntime {
  damageZombie(shootable: QuakeShootableState, amount: number, now: number): boolean;
  finalizeCorpse(shootable: QuakeShootableState): void;
  isDeathAnimating(shootable: QuakeShootableState, now?: number): boolean;
  isGibbed(shootable: QuakeShootableState): boolean;
  isPersistentCorpse(shootable: QuakeShootableState): boolean;
  isZombieNonSolid(shootable: QuakeShootableState, now?: number): boolean;
  isZombieRecovering(shootable: QuakeShootableState, now?: number): boolean;
  playDeathAnimation(shootable: QuakeShootableState, now: number): number | null;
  runFrameDeathOutputEvents(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    mode: QuakeMonsterAnimationMode,
    now: number,
  ): void;
  syncCorpseAnimationFrame(shootable: QuakeShootableState): void;
  syncZombiePainDownStep(shootable: QuakeShootableState, step: QuakeMonsterStateStep, enemy: QuakeEnemyState): void;
}

export function createQuakeShootableDeathStateRuntime(
  options: QuakeShootableDeathStateRuntimeOptions,
): QuakeShootableDeathStateRuntime {
  return {
    damageZombie,
    finalizeCorpse,
    isDeathAnimating,
    isGibbed,
    isPersistentCorpse,
    isZombieNonSolid,
    isZombieRecovering,
    playDeathAnimation,
    runFrameDeathOutputEvents,
    syncCorpseAnimationFrame,
    syncZombiePainDownStep,
  };

  function damageZombie(shootable: QuakeShootableState, amount: number, now: number): boolean {
    const enemy = shootable.enemy;
    if (!enemy) return false;
    const baseHealth = quakeShootableDefaultHealth("monster_zombie") ?? 60;
    if (amount >= QUAKE_ZOMBIE_GIB_DAMAGE) {
      shootable.health = 0;
      enemy.zombieGibbed = true;
      enemy.quakecGibbed = true;
      clearZombieDownedState(enemy);
      options.markTrace("shootable-damage", shootable, {
        amount,
        health: shootable.health,
        killed: true,
        zombiePolicy: "gib",
      });
      return options.destroyZombieGib(shootable, { radiusVisited: new Set([shootable.entity.index]) });
    }

    shootable.health = baseHealth;
    if (isZombieRecovering(shootable, now)) {
      options.markTrace("shootable-damage", shootable, {
        amount,
        health: shootable.health,
        killed: false,
        zombiePolicy: "downed-ignored",
      });
      return true;
    }
    const ignored = amount < QUAKE_ZOMBIE_IGNORE_DAMAGE;
    options.markTrace("shootable-damage", shootable, {
      amount,
      health: shootable.health,
      killed: false,
      zombiePolicy: ignored ? "ignored" : "pain",
    });
    if (ignored) return true;

    const repeatedPain = enemy.zombiePainRepeatUntil > now;
    const drop = amount >= QUAKE_ZOMBIE_DROP_DAMAGE || repeatedPain;
    enemy.zombiePainRepeatUntil = now + QUAKE_ZOMBIE_PAIN_REPEAT_WINDOW_MS;
    enemy.quakecPainChain = selectZombiePainChain(enemy, drop);
    if (enemy.quakecPainChain === "pain_down") startZombieDownedState(shootable, enemy, now);
    options.playPainAnimation(shootable, now, amount);
    options.flashShootable(shootable);
    return true;
  }

  function playDeathAnimation(shootable: QuakeShootableState, now: number): number | null {
    const enemy = shootable.enemy;
    const gib = shootableDeathGibOutput(shootable);
    if (gib) {
      if (enemy) {
        enemy.quakecDeathChain = null;
        enemy.quakecGibbed = true;
      }
      options.playQuakecSound(gib.soundPath ?? "player/udeath.wav", shootable, "death", now);
      options.spawnDeathOutputVisuals(shootable, gib);
      options.markTrace("monster-death-output", shootable, {
        gibModels: gib.gibModelPaths.length,
        health: shootable.health,
      });
      return null;
    }
    if (enemy?.zombieGibbed) return null;
    if (enemy) {
      enemy.quakecDeathChain = selectEnemyDeathReactionChain(shootable, enemy);
      enemy.quakecFiredEvents.clear();
    }
    const quakecDuration = options.startQuakecOneShotDeath(shootable, now);
    if (quakecDuration !== null) {
      if (enemy) enemy.deathAnimationUntil = now + quakecDuration;
      return Math.max(QUAKE_SHOOTABLE_DEATH_DELAY_MS, quakecDuration);
    }
    return null;
  }

  function finalizeCorpse(shootable: QuakeShootableState): void {
    syncCorpseAnimationFrame(shootable);
    options.syncLifecycleClasses(shootable);
    options.markTrace("shootable-corpse", shootable, {
      handles: options.countHandles(shootable),
    });
  }

  function syncCorpseAnimationFrame(shootable: QuakeShootableState): void {
    const enemy = shootable.enemy;
    if (!enemy) return;
    const corpseFrameIndex = enemyCorpseFrameIndex(shootable);
    enemy.animationMode = "death";
    enemy.animationLockUntil = 0;
    enemy.deathAnimationUntil = 0;
    enemy.nextAnimationFrameAt = Infinity;
    if (corpseFrameIndex === undefined) return;
    enemy.animationFrameIndex = corpseFrameIndex;
    if (options.hasHandle(shootable)) options.activateAnimationFrame(shootable, corpseFrameIndex);
  }

  function syncZombiePainDownStep(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    enemy: QuakeEnemyState,
  ): void {
    if (shootable.entity.classname !== "monster_zombie" || step.chain !== "pain_down") return;
    const baseHealth = quakeShootableDefaultHealth("monster_zombie") ?? 60;
    if (step.stateName === "zombie_paine1" || step.stateName === "zombie_paine11" || step.stateName === "zombie_paine12") {
      shootable.health = baseHealth;
    }
    if (step.stateName === "zombie_paine11") {
      enemy.nextAnimationFrameAt += QUAKE_ZOMBIE_DOWN_HOLD_MS;
    }
    if (step.stateName === "zombie_paine30") clearZombieDownedState(enemy);
  }

  function runFrameDeathOutputEvents(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    mode: QuakeMonsterAnimationMode,
    now: number,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy || mode !== "death" || isGibbed(shootable)) return;
    const deathOutput = quakeMonsterLogicByClassname[shootable.entity.classname]?.deathOutput;
    const drop = deathOutput?.backpackDrops?.find((candidate) =>
      candidate.chain === step.chain && candidate.stateName === step.stateName
    );
    if (!drop) return;
    const eventKey = `death-output:${step.chain}:${step.stateName}:DropBackpack`;
    if (enemy.quakecFiredEvents.has(eventKey)) return;
    const ammo = quakeMonsterBackpackAmmoEffect(drop);
    if (Object.keys(ammo).length === 0) return;
    enemy.quakecFiredEvents.add(eventKey);
    const backpack = deathOutput?.backpack;
    const emitted = options.dropBackpack?.({
      ammo,
      ...(backpack?.modelPath ? { modelPath: backpack.modelPath } : {}),
      origin: quakeMonsterBackpackDropOrigin(shootable, backpack),
      ...(typeof backpack?.removeAfterSeconds === "number" ? { removeAfterSeconds: backpack.removeAfterSeconds } : {}),
      ...(backpack?.pickupSoundPath ? { soundPath: backpack.pickupSoundPath } : {}),
      message: quakeMonsterBackpackMessage(ammo),
      sourceEntity: shootable.entity,
    }) ?? false;
    options.markTrace("monster-backpack-drop", shootable, {
      chain: step.chain,
      emitted: emitted !== false,
      state: step.stateName,
      time: now,
    });
  }

  function startZombieDownedState(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    now: number,
  ): void {
    const chain = "pain_down";
    const runner = enemy.quakecRunner;
    const nonSolidOffset = options.stateOffsetMs(shootable.entity.classname, chain, "zombie_paine10");
    const solidOffset = options.stateOffsetMs(shootable.entity.classname, chain, "zombie_paine12");
    const duration = runner ? options.chainDurationMs(shootable.entity.classname, chain, runner) : 0;
    enemy.zombieNonSolidAt = now + Math.max(0, nonSolidOffset);
    enemy.zombieSolidAt = now + Math.max(enemy.zombieNonSolidAt - now, solidOffset + QUAKE_ZOMBIE_DOWN_HOLD_MS);
    enemy.zombieRecoverUntil = now + Math.max(enemy.zombieSolidAt - now, duration);
    options.clearAttackState(shootable);
    options.markTrace("zombie-downed", shootable, {
      nonSolidInMs: enemy.zombieNonSolidAt - now,
      recoverInMs: enemy.zombieRecoverUntil - now,
      solidInMs: enemy.zombieSolidAt - now,
    });
  }

  function selectZombiePainChain(enemy: QuakeEnemyState, drop: boolean): string {
    const runner = enemy.quakecRunner;
    if (drop && runner?.hasChain("pain_down")) return "pain_down";
    const lightChains = QUAKE_ZOMBIE_LIGHT_PAIN_CHAINS.filter((chain) => runner?.hasChain(chain));
    if (lightChains.length > 0) {
      return lightChains[Math.floor(options.nextRandom(enemy) * lightChains.length)] ?? lightChains[0];
    }
    return runner?.hasChain("pain_a") ? "pain_a" : "pain";
  }

  function selectEnemyDeathReactionChain(shootable: QuakeShootableState, enemy: QuakeEnemyState): string {
    const policy = quakeMonsterDeathReactionPolicy(shootable.entity.classname);
    const branch = selectQuakeMonsterReactionBranch(policy?.regularBranches ?? [], enemy);
    return quakeMonsterChainOrFallback(shootable.entity.classname, branch?.chain ?? "death_a", "death_a");
  }

  function selectQuakeMonsterReactionBranch(
    branches: readonly QuakeMonsterRandomBranch[],
    enemy: QuakeEnemyState,
  ): QuakeMonsterRandomBranch | undefined {
    if (branches.length <= 1) return branches[0];
    const roll = options.nextRandom(enemy);
    return branches.find((branch) => quakeMonsterReactionBranchMatches(branch, roll)) ?? branches[branches.length - 1];
  }

  function enemyCorpseFrameIndex(shootable: QuakeShootableState): number | undefined {
    const enemy = shootable.enemy;
    const quakecDeathFrame = enemy?.quakecLastState &&
      (enemy.quakecLastState.chain === enemy.quakecDeathChain || enemy.quakecLastState.chain.startsWith("death"))
      ? enemy.quakecLastState.frameIndex
      : undefined;
    if (quakecDeathFrame !== undefined) return quakecDeathFrame;
    const profile = options.animationProfile(shootable);
    const model = shootable.model;
    if (!profile?.death || !model?.animationFrames?.length) return undefined;
    return options.boundedAnimationRange(profile.death, model).end;
  }

  function isPersistentCorpse(shootable: QuakeShootableState): boolean {
    if (options.isScriptedBoss(shootable.entity.classname)) return false;
    return shootable.dead && Boolean(shootable.enemy) && !isGibbed(shootable);
  }
}

export function clearZombieDownedState(enemy: QuakeEnemyState): void {
  enemy.zombieNonSolidAt = 0;
  enemy.zombieSolidAt = 0;
  enemy.zombieRecoverUntil = 0;
}

function isGibbed(shootable: QuakeShootableState): boolean {
  return Boolean(shootable.enemy?.quakecGibbed || shootable.enemy?.zombieGibbed);
}

function isPersistentCorpse(shootable: QuakeShootableState): boolean {
  return shootable.dead && Boolean(shootable.enemy) && !isGibbed(shootable);
}

function isDeathAnimating(shootable: QuakeShootableState, now = performance.now()): boolean {
  return shootable.dead && Boolean(shootable.enemy?.deathAnimationUntil && shootable.enemy.deathAnimationUntil > now);
}

function isZombieRecovering(shootable: QuakeShootableState, now = performance.now()): boolean {
  return shootable.entity.classname === "monster_zombie" &&
    Boolean(shootable.enemy?.zombieRecoverUntil && shootable.enemy.zombieRecoverUntil > now);
}

function isZombieNonSolid(shootable: QuakeShootableState, now = performance.now()): boolean {
  const enemy = shootable.enemy;
  return shootable.entity.classname === "monster_zombie" &&
    Boolean(
      enemy?.zombieNonSolidAt &&
      enemy.zombieSolidAt &&
      now >= enemy.zombieNonSolidAt &&
      now < enemy.zombieSolidAt,
    );
}

function quakeMonsterBackpackDropOrigin(
  shootable: QuakeShootableState,
  backpack: QuakeMonsterDeathBackpackProfile | undefined,
): Vec3 {
  const offset = backpack?.originOffsetUnits ?? [0, 0, -24];
  return [
    shootable.origin[0] + quakecScaleUnits(offset[0]),
    shootable.origin[1] + quakecScaleUnits(offset[1]),
    shootable.origin[2] + quakecScaleUnits(offset[2]),
  ];
}

function quakeMonsterChainOrFallback(classname: string, chain: string, fallback: string): string {
  const chains = quakeMonsterLogicByClassname[classname]?.chains;
  if (chains?.[chain]?.states.length) return chain;
  if (chains?.[fallback]?.states.length) return fallback;
  return chain;
}

function quakeMonsterReactionBranchMatches(branch: QuakeMonsterRandomBranch, roll: number): boolean {
  if (branch.otherwise) return true;
  if (typeof branch.randomLessThan === "number" && roll < branch.randomLessThan) return true;
  if (typeof branch.randomGreaterThan === "number" && roll > branch.randomGreaterThan) return true;
  return branch.randomLessThan === undefined && branch.randomGreaterThan === undefined;
}

function quakecScaleUnits(value: number): number {
  return value * QUAKE_COLLISION_UNIT_SCALE;
}
