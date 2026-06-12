import type { Vec3 } from "@layoutit/polycss";

import {
  QUAKE_MONSTER_COMBAT_POLICIES,
  type QuakeMonsterAttackBranchPolicy,
  type QuakeMonsterAttackPolicy,
  type QuakeMonsterFireBulletsFrameEvent,
  type QuakeMonsterFrameEvent,
  type QuakeMonsterLightningDamageFrameEvent,
  type QuakeMonsterMeleeDamageFrameEvent,
  type QuakeMonsterProjectileFrameEvent,
  type QuakeMonsterProjectileOffsetUnits,
  type QuakeMonsterTouchDamageFrameEvent,
} from "../../generated/quakeMonsterLogic";
import { COLLISION_EPSILON, QUAKE_COLLISION_UNIT_SCALE, QUAKE_PLAYER_MINS_Z } from "../constants";
import { normalizeVec3, subtractVec3 } from "../math";
import type { QuakeMonsterStateStep } from "../quakeMonsterStateRunner";
import {
  aabbDistanceSq,
  aabbsOverlap,
  inflateBounds,
  pointToAabbDistanceSq,
  segmentAabbIntersectionDistance,
  type QuakeBounds,
} from "./bounds";
import {
  quakeMonsterCombatProfile,
  type QuakeMonsterCombatProfile,
  type QuakeMonsterProjectileOffset,
} from "./combatFacts";
import {
  quakecCanDamageAnyTracePointClear,
  quakecCanDamageTracePointsForRuntimeOrigin,
  quakecRandomDamage,
} from "./damage";
import { quakecProjectileCombatProfile } from "./enemyProjectiles";
import type {
  QuakeDamageTraceResult,
  QuakeEnemyAnimationContext,
  QuakeEnemyAttackTarget,
  QuakeEnemyState,
  QuakeMonsterAnimationMode,
  QuakeShootableState,
} from "./state";

const QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS = 100;
const QUAKE_MONSTER_ATTACK_DELAY_MS = 600;
const QUAKE_PAUSED_TIMER_POLL_MS = 100;
const QUAKE_SHOOTABLE_COLLISION_EPSILON = 0.5 * QUAKE_COLLISION_UNIT_SCALE;

type QuakeEnemyCombatTraceDetails = Record<string, boolean | number | string | null | undefined>;

interface QuakeEnemyCombatSoundOptions {
  volume?: number;
}

export interface QuakeEnemyCombatContext {
  hasLineOfSight(start: Vec3, end: Vec3): boolean;
  nextRandom(enemy: QuakeEnemyState): number;
  playerDamageBounds(origin: [number, number, number] | Vec3): QuakeBounds;
  randomRange(enemy: QuakeEnemyState, min: number, max: number): number;
  shootableEyeOrigin(shootable: QuakeShootableState): Vec3;
}

export interface QuakeEnemyCombatRuntimeOptions extends QuakeEnemyCombatContext {
  damagePlayer(amount: number): boolean;
  getPlayerOrigin(): [number, number, number];
  isGameplayPaused?: () => boolean;
  markTrace(kind: string, shootable: QuakeShootableState, details?: QuakeEnemyCombatTraceDetails): void;
  playSound?(soundPath: string, options?: QuakeEnemyCombatSoundOptions): boolean;
  shootableBoundsForDamage(shootable: QuakeShootableState): QuakeBounds;
  spawnProjectile(
    shootable: QuakeShootableState,
    enemy: QuakeEnemyState,
    origin: Vec3,
    target: Vec3,
    profile: QuakeMonsterCombatProfile,
    now: number,
  ): void;
  syncEnemyDatasets(shootable: QuakeShootableState): void;
}

export interface QuakeEnemyCombatRuntime extends QuakeEnemyCombatContext {
  clear(): void;
  finishAttack(
    shootable: QuakeShootableState,
    profile: QuakeMonsterCombatProfile | undefined,
    now: number,
  ): void;
  playQuakecSound(
    soundPath: string,
    shootable: QuakeShootableState,
    mode: QuakeMonsterAnimationMode,
    now: number,
  ): boolean;
  runActiveTouchDamage(
    shootable: QuakeShootableState,
    playerOrigin: [number, number, number],
    profile: QuakeMonsterCombatProfile,
    now: number,
    target?: QuakeEnemyAttackTarget,
  ): void;
  runFrameEvents(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    mode: QuakeMonsterAnimationMode,
    now: number,
    context?: QuakeEnemyAnimationContext,
  ): void;
  runFrameSounds(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    mode: QuakeMonsterAnimationMode,
    now: number,
  ): void;
}

export function createQuakeEnemyCombatRuntime(options: QuakeEnemyCombatRuntimeOptions): QuakeEnemyCombatRuntime {
  let projectileTimers: number[] = [];

  const runtime: QuakeEnemyCombatRuntime = {
    clear,
    finishAttack,
    hasLineOfSight: options.hasLineOfSight,
    nextRandom: options.nextRandom,
    playerDamageBounds: options.playerDamageBounds,
    playQuakecSound,
    randomRange: options.randomRange,
    runActiveTouchDamage,
    runFrameEvents,
    runFrameSounds,
    shootableEyeOrigin: options.shootableEyeOrigin,
  };

  return runtime;

  function clear(): void {
    for (const timer of projectileTimers) window.clearTimeout(timer);
    projectileTimers = [];
  }

  function runFrameSounds(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    mode: QuakeMonsterAnimationMode,
    now: number,
  ): void {
    for (const soundPath of step.sounds) {
      playQuakecSound(soundPath, shootable, mode, now);
    }
  }

  function playQuakecSound(
    soundPath: string,
    shootable: QuakeShootableState,
    mode: QuakeMonsterAnimationMode,
    now: number,
  ): boolean {
    const played = options.playSound?.(soundPath, { volume: quakecSoundVolumeForMode(mode) }) ?? false;
    options.markTrace("enemy-quakec-sound", shootable, {
      mode,
      played,
      sound: soundPath,
      time: now,
    });
    return played;
  }

  function runFrameEvents(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    mode: QuakeMonsterAnimationMode,
    now: number,
    context?: QuakeEnemyAnimationContext,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy || mode !== "attack" || !context) return;
    step.events.forEach((event, index) => {
      const eventKey = `${step.stateName}:${index}:${event.call}:${event.type}`;
      if (enemy.quakecFiredEvents.has(eventKey)) return;
      enemy.quakecFiredEvents.add(eventKey);
      runFrameEvent(shootable, step, event, now, context);
    });
  }

  function runFrameEvent(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    event: QuakeMonsterFrameEvent,
    now: number,
    context: QuakeEnemyAnimationContext,
  ): void {
    if (event.type === "fire_bullets") {
      runFireBulletsEvent(shootable, step, event, now, context);
      return;
    }
    if (event.type === "lightning_damage") {
      runLightningDamageEvent(shootable, step, event, now, context);
      return;
    }
    if (event.type === "melee_damage") {
      runMeleeDamageEvent(shootable, step, event, now, context);
      return;
    }
    if (event.type === "projectile") {
      runProjectileEvent(shootable, step, event, now, context);
      return;
    }
    if (event.type === "touch_damage") {
      armTouchDamageEvent(shootable, step, event, now);
    }
  }

  function runFireBulletsEvent(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    event: QuakeMonsterFireBulletsFrameEvent,
    now: number,
    context: QuakeEnemyAnimationContext,
  ): void {
    const traceRange = quakecScaleUnits(event.traceRangeUnits);
    const enemy = shootable.enemy;
    if (!enemy) return;
    const target = quakeEnemyCombatTarget(options, context);
    let hitPellets = 0;
    let blockedPellets = 0;
    let missedPellets = 0;
    let rangedOutPellets = 0;
    for (let pellet = 0; pellet < event.pellets; pellet += 1) {
      const traceTarget = quakecSpreadTraceTarget(
        options,
        context.enemyEye,
        target.origin,
        traceRange,
        event.spread,
        enemy,
      );
      const trace = quakecTraceHitsBounds(
        options,
        context.enemyEye,
        traceTarget,
        traceRange,
        target.bounds,
      );
      if (trace.hit) {
        hitPellets += 1;
      } else if (trace.reason === "blocked") {
        blockedPellets += 1;
      } else if (trace.reason === "range") {
        rangedOutPellets += 1;
      } else {
        missedPellets += 1;
      }
    }
    const damage = hitPellets * event.pelletDamage;
    const hit = hitPellets > 0;
    options.markTrace("enemy-quakec-event", shootable, {
      blockedPellets,
      damage,
      event: event.call,
      frame: step.frame,
      frameIndex: step.frameIndex,
      hit,
      hitPellets,
      missedPellets,
      pelletDamage: event.pelletDamage,
      pellets: event.pellets,
      rangedOutPellets,
      spread: event.spread.join(" "),
      state: step.stateName,
      time: now,
      type: event.type,
    });
    if (damage > 0) damageQuakeEnemyCombatTarget(target, damage, shootable);
  }

  function runLightningDamageEvent(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    event: QuakeMonsterLightningDamageFrameEvent,
    now: number,
    context: QuakeEnemyAnimationContext,
  ): void {
    const origin = quakecOffsetPoint(
      shootable.origin,
      shootable.origin,
      quakeEnemyCombatTarget(options, context).origin,
      event.originOffsetUnits,
    );
    const combatTarget = quakeEnemyCombatTarget(options, context);
    const target = quakecOffsetPoint(
      combatTarget.origin,
      shootable.origin,
      combatTarget.origin,
      event.targetOffsetUnits,
    );
    const range = quakecScaleUnits(event.rangeUnits);
    const trace = quakecTraceHitsBounds(options, origin, target, range, combatTarget.bounds);
    options.markTrace("enemy-quakec-event", shootable, {
      call: event.call,
      damage: event.damage,
      frame: step.frame,
      frameIndex: step.frameIndex,
      hit: trace.hit,
      rangeUnits: event.rangeUnits,
      reason: trace.reason,
      state: step.stateName,
      target: event.target,
      time: now,
      type: event.type,
    });
    if (trace.hit) damageQuakeEnemyCombatTarget(combatTarget, event.damage, shootable);
  }

  function runMeleeDamageEvent(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    event: QuakeMonsterMeleeDamageFrameEvent,
    now: number,
    context: QuakeEnemyAnimationContext,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy) return;
    const target = quakeEnemyCombatTarget(options, context);
    const range = quakecScaleUnits(event.rangeUnits ?? context.profile.range / QUAKE_COLLISION_UNIT_SCALE);
    const distanceSq = pointToAabbDistanceSq(shootable.origin, target.bounds);
    const inRange = distanceSq <= range * range;
    const canDamage = !event.requiresCanDamage ||
      quakecCanDamageTarget(options, options.shootableEyeOrigin(shootable), target);
    const damage = quakecRandomDamage(event.damageBase, event.damageRandomTerms, () => options.nextRandom(enemy));
    const hit = inRange && canDamage;
    options.markTrace("enemy-quakec-event", shootable, {
      call: event.call,
      damage,
      damageBase: event.damageBase,
      damageRandomTerms: event.damageRandomTerms.join(" "),
      frame: step.frame,
      frameIndex: step.frameIndex,
      hit,
      rangeUnits: event.rangeUnits,
      reason: !inRange ? "range" : canDamage ? "hit" : "blocked",
      requiresCanDamage: event.requiresCanDamage ? "true" : undefined,
      state: step.stateName,
      target: event.target,
      time: now,
      type: event.type,
    });
    if (hit) damageQuakeEnemyCombatTarget(target, damage, shootable);
  }

  function runProjectileEvent(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    event: QuakeMonsterProjectileFrameEvent,
    now: number,
    context: QuakeEnemyAnimationContext,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy) return;
    const profile = quakecProjectileCombatProfile(event, context.profile);
    const start = quakecOffsetPoint(
      shootable.origin,
      shootable.origin,
      context.playerOrigin,
      event.originOffsetUnits,
    );
    const fireProjectile = (fireNow: number, target: Vec3): void => {
      if (shootable.dead || !shootable.enemy || !shootable.visible) return;
      options.spawnProjectile(shootable, enemy, start, target, profile, fireNow);
      options.markTrace("enemy-quakec-event", shootable, {
        call: event.call,
        damage: event.damage,
        delayMs: event.delayMs,
        frame: step.frame,
        frameIndex: step.frameIndex,
        modelPath: event.modelPath,
        speedUnits: event.speedUnits,
        state: step.stateName,
        target: event.target,
        time: fireNow,
        type: event.type,
      });
    };
    const delayMs = Math.max(0, event.delayMs ?? 0);
    if (delayMs <= 0) {
      fireProjectile(now, context.playerOrigin);
      return;
    }
    let timer = 0;
    const fireDelayedProjectile = (): void => {
      projectileTimers = projectileTimers.filter((entry) => entry !== timer);
      if (options.isGameplayPaused?.()) {
        timer = window.setTimeout(fireDelayedProjectile, QUAKE_PAUSED_TIMER_POLL_MS);
        projectileTimers.push(timer);
        return;
      }
      fireProjectile(performance.now(), options.getPlayerOrigin());
    };
    timer = window.setTimeout(fireDelayedProjectile, delayMs);
    projectileTimers.push(timer);
    options.markTrace("enemy-quakec-projectile-schedule", shootable, {
      call: event.call,
      delayMs,
      frame: step.frame,
      frameIndex: step.frameIndex,
      state: step.stateName,
      type: event.type,
    });
  }

  function armTouchDamageEvent(
    shootable: QuakeShootableState,
    step: QuakeMonsterStateStep,
    event: QuakeMonsterTouchDamageFrameEvent,
    now: number,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy) return;
    enemy.quakecActiveTouchDamage = {
      event,
      expiresAt: now + event.durationMs,
      frame: step.frame,
      frameIndex: step.frameIndex,
      stateName: step.stateName,
    };
    options.markTrace("enemy-quakec-touch-arm", shootable, {
      durationMs: event.durationMs,
      event: event.call,
      frame: step.frame,
      frameIndex: step.frameIndex,
      minVelocityUnits: event.minVelocityUnits,
      rangeUnits: event.rangeUnits,
      state: step.stateName,
      type: event.type,
    });
  }

  function runActiveTouchDamage(
    shootable: QuakeShootableState,
    playerOrigin: [number, number, number],
    profile: QuakeMonsterCombatProfile,
    now: number,
    target?: QuakeEnemyAttackTarget,
  ): void {
    const enemy = shootable.enemy;
    const active = enemy?.quakecActiveTouchDamage;
    if (!enemy || !active) return;
    if (now > active.expiresAt) {
      enemy.quakecActiveTouchDamage = null;
      options.markTrace("enemy-quakec-touch-expire", shootable, {
        event: active.event.call,
        state: active.stateName,
        type: active.event.type,
      });
      finishAttack(shootable, profile, now);
      return;
    }
    const combatTarget = target ?? quakeEnemyCombatTarget(options, {
      enemyEye: options.shootableEyeOrigin(shootable),
      playerOrigin,
      profile,
    });
    const hit = quakecTouchDamageHits(options, shootable, combatTarget, active.event);
    if (!hit) return;
    const damage = quakecRandomDamage(active.event.damageBase, active.event.damageRandomTerms, () => options.nextRandom(enemy));
    options.markTrace("enemy-quakec-event", shootable, {
      call: active.event.call,
      damage,
      damageBase: active.event.damageBase,
      damageRandomTerms: active.event.damageRandomTerms.join(" "),
      frame: active.frame,
      frameIndex: active.frameIndex,
      hit,
      minVelocityUnits: active.event.minVelocityUnits,
      rangeUnits: active.event.rangeUnits,
      reason: "hit",
      state: active.stateName,
      target: active.event.target,
      time: now,
      type: active.event.type,
    });
    damageQuakeEnemyCombatTarget(combatTarget, damage, shootable);
    enemy.quakecActiveTouchDamage = null;
    finishAttack(shootable, profile, now);
  }

  function finishAttack(
    shootable: QuakeShootableState,
    profile: QuakeMonsterCombatProfile | undefined,
    now: number,
  ): void {
    const enemy = shootable.enemy;
    if (!enemy || !enemy.pendingAttack || !profile) return;
    enemy.pendingAttack = null;
    enemy.attackVisual = "cooldown";
    enemy.burstShotsRemaining = 0;
    enemy.quakecActiveTouchDamage = null;
    if (!quakecAttackCooldownStartsOnSelection(shootable)) {
      enemy.nextAttackAt = now + quakeEnemyCooldownMs(options, profile, enemy);
    }
    enemy.quakecAnimationChain = null;
    enemy.quakecFiredEvents.clear();
    options.syncEnemyDatasets(shootable);
    options.markTrace("enemy-quakec-attack-complete", shootable, {
      cooldownMs: enemy.nextAttackAt - now,
    });
  }
}

export function selectQuakeEnemyAttackChain(
  context: QuakeEnemyCombatContext,
  shootable: QuakeShootableState,
  enemy: QuakeEnemyState,
  distance: number,
  playerOrigin: [number, number, number],
  now: number,
): string | null | undefined {
  const attackPolicy = quakeEnemyAttackPolicy(shootable);
  if (!attackPolicy?.usesFrameEvents) return undefined;
  const branchChain = selectQuakecAttackBranch(context, shootable, enemy, attackPolicy, distance, playerOrigin);
  if (attackPolicy.branches?.length) {
    if (branchChain) return branchChain;
    enemy.nextAttackAt = now + QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;
    return null;
  }
  const chance = quakecAttackPolicyChance(attackPolicy, distance);
  if (chance <= 0 || (chance < 1 && context.nextRandom(enemy) >= chance)) {
    enemy.nextAttackAt = now + QUAKE_MONSTER_QUAKEC_STATE_FRAME_MS;
    return null;
  }
  if (quakecAttackCooldownStartsOnSelection(shootable)) {
    enemy.nextAttackAt = now + quakecAttackPolicyCooldownMs(context, attackPolicy, enemy);
    consumeQuakecAttackSideEffectRandomChecks(context, attackPolicy, enemy);
  }
  return attackPolicy.chain;
}

export function quakeShootableUsesQuakecAttackEvents(shootable: QuakeShootableState): boolean {
  return Boolean(quakeEnemyAttackPolicy(shootable)?.usesFrameEvents);
}

export function quakeShootableAttackChain(shootable: QuakeShootableState): string | undefined {
  return quakeEnemyAttackPolicy(shootable)?.chain;
}

export function quakecAttackCooldownStartsOnSelection(shootable: QuakeShootableState): boolean {
  return shootable.entity.classname === "monster_army";
}

export function quakeEnemyWakeDelayMs(
  context: QuakeEnemyCombatContext,
  profile: QuakeMonsterCombatProfile,
  enemy: QuakeEnemyState,
): number {
  return Math.max(0, (profile.wakeDelayMs ?? QUAKE_MONSTER_ATTACK_DELAY_MS) +
    context.randomRange(enemy, 0, profile.wakeDelayJitterMs ?? 0));
}

export function quakeEnemyCooldownMs(
  context: QuakeEnemyCombatContext,
  profile: QuakeMonsterCombatProfile,
  enemy: QuakeEnemyState,
): number {
  const jitter = Math.max(0, profile.cooldownJitterMs ?? 0);
  const randomAdd = Math.max(0, profile.cooldownRandomAddMs ?? 0);
  const variance = randomAdd > 0
    ? context.randomRange(enemy, 0, randomAdd)
    : context.randomRange(enemy, -jitter, jitter);
  return Math.max(80, profile.cooldownMs + variance);
}

function quakecSoundVolumeForMode(mode: QuakeMonsterAnimationMode): number {
  if (mode === "attack") return 0.62;
  if (mode === "death") return 0.72;
  if (mode === "pain") return 0.66;
  return 0.46;
}

function quakecSpreadTraceTarget(
  context: QuakeEnemyCombatContext,
  start: Vec3,
  playerOrigin: Vec3,
  range: number,
  spread: readonly [number, number, number],
  enemy: QuakeEnemyState,
): Vec3 {
  const baseDirection = normalizeVec3(subtractVec3(playerOrigin, start));
  const right = quakecHorizontalRight(baseDirection);
  const up: Vec3 = [0, 0, 1];
  const spreadX = context.randomRange(enemy, -1, 1) * spread[0];
  const spreadY = context.randomRange(enemy, -1, 1) * spread[1];
  const direction = normalizeVec3([
    baseDirection[0] + right[0] * spreadX + up[0] * spreadY,
    baseDirection[1] + right[1] * spreadX + up[1] * spreadY,
    baseDirection[2] + right[2] * spreadX + up[2] * spreadY,
  ]);
  return [
    start[0] + direction[0] * range,
    start[1] + direction[1] * range,
    start[2] + direction[2] * range,
  ];
}

function quakecHorizontalRight(direction: Vec3): Vec3 {
  const horizontal = Math.hypot(direction[0], direction[1]);
  if (horizontal <= COLLISION_EPSILON) return [1, 0, 0];
  return [-direction[1] / horizontal, direction[0] / horizontal, 0];
}

function quakecTraceHitsBounds(
  context: QuakeEnemyCombatContext,
  start: Vec3,
  target: Vec3,
  range: number,
  bounds: QuakeBounds,
): QuakeDamageTraceResult {
  const delta = subtractVec3(target, start);
  const targetDistance = Math.hypot(delta[0], delta[1], delta[2]);
  if (targetDistance <= COLLISION_EPSILON) {
    return { distance: 0, hit: false, hitPoint: [...start] as Vec3, reason: "miss" };
  }
  const traceDistance = Math.min(range, targetDistance);
  const direction: Vec3 = [delta[0] / targetDistance, delta[1] / targetDistance, delta[2] / targetDistance];
  const end: Vec3 = [
    start[0] + direction[0] * traceDistance,
    start[1] + direction[1] * traceDistance,
    start[2] + direction[2] * traceDistance,
  ];
  const hitDistance = segmentAabbIntersectionDistance(start, end, bounds);
  if (hitDistance === null) {
    const reason = targetDistance > range ? "range" : "miss";
    return { distance: traceDistance, hit: false, hitPoint: end, reason };
  }
  const hitPoint: Vec3 = [
    start[0] + direction[0] * hitDistance,
    start[1] + direction[1] * hitDistance,
    start[2] + direction[2] * hitDistance,
  ];
  if (!context.hasLineOfSight(start, hitPoint)) {
    return { distance: hitDistance, hit: false, hitPoint, reason: "blocked" };
  }
  return { distance: hitDistance, hit: true, hitPoint, reason: "hit" };
}

function quakecCanDamageTarget(
  context: QuakeEnemyCombatContext,
  start: Vec3,
  target: QuakeEnemyAttackTarget,
): boolean {
  const targetOrigin = target.kind === "player"
    ? [target.origin[0], target.origin[1], target.bounds.min[2] - QUAKE_PLAYER_MINS_Z] as Vec3
    : target.origin;
  return quakecCanDamageAnyTracePointClear(
    start,
    quakecCanDamageTracePointsForRuntimeOrigin(targetOrigin),
    context.hasLineOfSight,
  );
}

function quakecBoundsCenter(bounds: QuakeBounds): Vec3 {
  return [
    (bounds.min[0] + bounds.max[0]) * 0.5,
    (bounds.min[1] + bounds.max[1]) * 0.5,
    (bounds.min[2] + bounds.max[2]) * 0.5,
  ];
}

function quakecTouchDamageHits(
  context: QuakeEnemyCombatRuntimeOptions,
  shootable: QuakeShootableState,
  target: QuakeEnemyAttackTarget,
  event: QuakeMonsterTouchDamageFrameEvent,
): boolean {
  const range = quakecScaleUnits(event.rangeUnits);
  const shootableBounds = inflateBounds(context.shootableBoundsForDamage(shootable), QUAKE_SHOOTABLE_COLLISION_EPSILON);
  return aabbsOverlap(target.bounds, shootableBounds) ||
    aabbDistanceSq(target.bounds, shootableBounds) <= range * range;
}

function quakeEnemyCombatTarget(
  options: QuakeEnemyCombatRuntimeOptions,
  context: QuakeEnemyAnimationContext,
): QuakeEnemyAttackTarget {
  if (context.target) return context.target;
  return {
    bounds: options.playerDamageBounds(context.playerOrigin),
    classname: "player",
    damage: (amount) => options.damagePlayer(amount),
    id: "player",
    kind: "player",
    origin: context.playerOrigin,
  };
}

function damageQuakeEnemyCombatTarget(
  target: QuakeEnemyAttackTarget,
  amount: number,
  attacker: QuakeShootableState,
): boolean {
  return target.damage?.(amount, {
    attacker: {
      classname: attacker.entity.classname,
      entityIndex: attacker.entity.index,
      id: attacker.entity.index,
      kind: "shootable",
      origin: attacker.origin,
    },
    inflictor: {
      classname: attacker.entity.classname,
      entityIndex: attacker.entity.index,
      id: attacker.entity.index,
      kind: "shootable",
      origin: attacker.origin,
    },
  }) ?? false;
}

function quakecOffsetPoint(
  origin: Vec3,
  basisOrigin: Vec3,
  basisTarget: Vec3,
  offset: QuakeMonsterProjectileOffsetUnits | QuakeMonsterProjectileOffset | undefined,
): Vec3 {
  if (!offset) return [...origin] as Vec3;
  const scaledOffset = isQuakecOffsetUnits(offset) ? quakecScaleOffset(offset) : offset;
  if (!scaledOffset) return [...origin] as Vec3;
  const dx = basisTarget[0] - basisOrigin[0];
  const dy = basisTarget[1] - basisOrigin[1];
  const length = Math.hypot(dx, dy) || 1;
  const forward: Vec3 = [dx / length, dy / length, 0];
  const right: Vec3 = [-forward[1], forward[0], 0];
  return [
    origin[0] + forward[0] * (scaledOffset.forward ?? 0) + right[0] * (scaledOffset.right ?? 0),
    origin[1] + forward[1] * (scaledOffset.forward ?? 0) + right[1] * (scaledOffset.right ?? 0),
    origin[2] + (scaledOffset.up ?? 0),
  ];
}

function quakecScaleOffset(
  offset: QuakeMonsterProjectileOffsetUnits | undefined,
): QuakeMonsterProjectileOffset | undefined {
  if (!offset) return undefined;
  return {
    ...(offset.forward !== undefined ? { forward: quakecScaleUnits(offset.forward) } : {}),
    ...(offset.right !== undefined ? { right: quakecScaleUnits(offset.right) } : {}),
    ...(offset.up !== undefined ? { up: quakecScaleUnits(offset.up) } : {}),
  };
}

function isQuakecOffsetUnits(
  offset: QuakeMonsterProjectileOffsetUnits | QuakeMonsterProjectileOffset,
): offset is QuakeMonsterProjectileOffsetUnits {
  const maxAbs = Math.max(
    Math.abs(offset.forward ?? 0),
    Math.abs(offset.right ?? 0),
    Math.abs(offset.up ?? 0),
  );
  return maxAbs > 1;
}

function selectQuakecAttackBranch(
  context: QuakeEnemyCombatContext,
  shootable: QuakeShootableState,
  enemy: QuakeEnemyState,
  policy: QuakeMonsterAttackPolicy,
  distance: number,
  playerOrigin: [number, number, number],
): string | null {
  for (const branch of policy.branches ?? []) {
    if (!quakecAttackBranchRangeMatches(branch, distance)) continue;
    if (!quakecAttackBranchSightMatches(context, shootable, branch, playerOrigin)) continue;
    const chance = quakecAttackBranchChance(branch, policy, distance);
    if (chance <= 0 || (chance < 1 && context.nextRandom(enemy) >= chance)) continue;
    return branch.chain;
  }
  return null;
}

function quakecAttackBranchRangeMatches(
  branch: QuakeMonsterAttackBranchPolicy,
  distance: number,
): boolean {
  if (branch.minRangeUnits !== undefined && distance < quakecScaleUnits(branch.minRangeUnits)) return false;
  if (branch.maxRangeUnits !== undefined && distance >= quakecScaleUnits(branch.maxRangeUnits)) return false;
  if (branch.maxDistanceUnits !== undefined && distance > quakecScaleUnits(branch.maxDistanceUnits)) return false;
  return true;
}

function quakecAttackBranchSightMatches(
  context: QuakeEnemyCombatContext,
  shootable: QuakeShootableState,
  branch: QuakeMonsterAttackBranchPolicy,
  playerOrigin: [number, number, number],
): boolean {
  if (branch.requiresVerticalOverlap && !quakecAttackBranchVerticalMatches(context, shootable, playerOrigin)) {
    return false;
  }
  if (!branch.requiresCanDamage && !branch.requiresClearShot) return true;
  return context.hasLineOfSight(context.shootableEyeOrigin(shootable), playerOrigin);
}

function quakecAttackBranchVerticalMatches(
  context: QuakeEnemyCombatContext,
  shootable: QuakeShootableState,
  playerOrigin: [number, number, number],
): boolean {
  const shootableMinZ = shootable.origin[2] + shootable.collisionBounds.min[2];
  const shootableMaxZ = shootable.origin[2] + shootable.collisionBounds.max[2];
  const playerBounds = context.playerDamageBounds(playerOrigin);
  const playerMinZ = playerBounds.min[2];
  const playerMaxZ = playerBounds.max[2];
  return shootableMaxZ >= playerMinZ && shootableMinZ <= playerMaxZ;
}

function quakecAttackBranchChance(
  branch: QuakeMonsterAttackBranchPolicy,
  policy: QuakeMonsterAttackPolicy,
  distance: number,
): number {
  if (branch.chanceBeyondMaxRange !== undefined &&
    branch.chanceRangeUnits !== undefined &&
    distance > quakecScaleUnits(branch.chanceRangeUnits)
  ) {
    return branch.chanceBeyondMaxRange;
  }
  if (branch.rangeChances) {
    return quakecAttackPolicyChance({
      ...policy,
      rangeChances: branch.rangeChances,
    }, distance);
  }
  return 1;
}

function quakeEnemyAttackPolicy(shootable: QuakeShootableState): QuakeMonsterAttackPolicy | undefined {
  if (!shootable.enemy?.quakecRunner) return undefined;
  if (!quakeMonsterCombatProfile(shootable.entity.classname)) return undefined;
  return QUAKE_MONSTER_COMBAT_POLICIES[shootable.entity.classname]?.attack;
}

function quakecAttackPolicyChance(policy: QuakeMonsterAttackPolicy, distance: number): number {
  if (distance < quakecScaleUnits(policy.rangeUnits.melee)) return policy.rangeChances.melee;
  if (distance < quakecScaleUnits(policy.rangeUnits.near)) return policy.rangeChances.near;
  if (distance < quakecScaleUnits(policy.rangeUnits.mid)) return policy.rangeChances.mid;
  return policy.rangeChances.far;
}

function quakecAttackPolicyCooldownMs(
  context: QuakeEnemyCombatContext,
  policy: QuakeMonsterAttackPolicy,
  enemy: QuakeEnemyState,
): number {
  const cooldownMs = Math.max(0, policy.cooldownMs);
  const randomAddMs = Math.max(0, policy.cooldownRandomAddMs ?? 0);
  return cooldownMs + (randomAddMs > 0 ? context.randomRange(enemy, 0, randomAddMs) : 0);
}

function consumeQuakecAttackSideEffectRandomChecks(
  context: QuakeEnemyCombatContext,
  policy: QuakeMonsterAttackPolicy,
  enemy: QuakeEnemyState,
): void {
  for (const check of policy.sideEffectRandomChecks ?? []) {
    if (context.nextRandom(enemy) < check.chance) {
      // The source-side state, such as monster_army.lefty, has no rendered
      // effect yet, but the live RNG draw is part of the rule flow.
    }
  }
}

function quakecScaleUnits(value: number): number {
  return value * QUAKE_COLLISION_UNIT_SCALE;
}
