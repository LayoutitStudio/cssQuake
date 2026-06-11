import type { Vec3 } from "@layoutit/polycss";

import type { QuakeEntity } from "../../types/quake";
import {
  COLLISION_EPSILON,
  GROUND_SNAP,
  PLAYER_RADIUS,
  QUAKE_COLLISION_UNIT_SCALE,
  STEP_HEIGHT,
} from "../constants";
import { distanceSq3 } from "../math";
import type { QuakeMonsterStateStep } from "../quakeMonsterStateRunner";
import { quakeMonsterSpawnProfileForEntity, type QuakeBounds } from "./bounds";
import { quakecMonsterHasMovement } from "./combatFacts";
import type { QuakeMonsterCombatProfile } from "./combatFacts";
import { groundedQuakeMonsterOrigin } from "./enemySpawn";
import type {
  QuakeEnemyState,
  QuakeMonsterAnimationMode,
  QuakeMoveGoalAttempt,
  QuakeMoveGoalCandidate,
  QuakeMoveGoalOptions,
  QuakeShootableState,
} from "./state";

const QUAKE_MONSTER_WALK_YAW_SPEED = 20;
const QUAKE_MONSTER_FLY_SWIM_YAW_SPEED = 10;

export interface QuakeEnemyMovementRuntimeOptions {
  collisionEpsilon: number;
  contentsAt?(point: Vec3): number | null;
  contentsSolid: number;
  enemyTickMs: number;
  floorAt(x: number, y: number, maxZ?: number, minZ?: number): number | null;
  hasLineOfSight(start: Vec3, end: Vec3): boolean;
  leafIndexAt(origin: Vec3): number | undefined;
  markTrace(kind: string, shootable: QuakeShootableState, details?: Record<string, unknown>): void;
  nextRandom(enemy: QuakeEnemyState): number;
  playerMovementBounds(origin: Vec3): QuakeBounds;
  shootableCollisionWorldBounds(shootable: QuakeShootableState): QuakeBounds;
  shootableEyeOrigin(shootable: QuakeShootableState): Vec3;
  syncShootableTransform(shootable: QuakeShootableState, yaw?: number): void;
}

export interface QuakeEnemyMovementRuntime {
  faceShootableAtOrigin(shootable: QuakeShootableState, targetOrigin: Vec3): void;
  moveChasingEnemy(
    shootable: QuakeShootableState,
    playerOrigin: Vec3,
    profile: QuakeMonsterCombatProfile,
    dt: number,
    now: number,
    canSeePlayer: boolean,
  ): boolean;
  moveEnemyTowardOrigin(
    shootable: QuakeShootableState,
    targetOrigin: Vec3,
    profile: QuakeMonsterCombatProfile,
    dt: number,
    now: number,
    options: QuakeMoveGoalOptions,
  ): boolean;
  shouldAnimateChasingEnemy(
    shootable: QuakeShootableState,
    playerOrigin: Vec3,
    profile: QuakeMonsterCombatProfile,
    canSeePlayer: boolean,
  ): boolean;
  shouldAnimateMovingEnemy(
    shootable: QuakeShootableState,
    targetOrigin: Vec3,
    stopDistance: number,
    epsilon?: number,
  ): boolean;
}

export function createQuakeEnemyMovementRuntime(
  options: QuakeEnemyMovementRuntimeOptions,
): QuakeEnemyMovementRuntime {
  function moveChasingEnemy(
    shootable: QuakeShootableState,
    playerOrigin: Vec3,
    profile: QuakeMonsterCombatProfile,
    dt: number,
    now: number,
    canSeePlayer: boolean,
  ): boolean {
    const stopDistance = canSeePlayer
      ? Math.max(profile.chaseStopDistance ?? profile.range * 0.72, PLAYER_RADIUS * 1.45)
      : 0;
    return moveEnemyTowardOrigin(shootable, playerOrigin, profile, dt, now, {
      allowWallFollow: true,
      goalBounds: options.playerMovementBounds(playerOrigin),
      movementCall: "ai_run",
      stopDistance,
    });
  }

  function moveEnemyTowardOrigin(
    shootable: QuakeShootableState,
    targetOrigin: Vec3,
    profile: QuakeMonsterCombatProfile,
    dt: number,
    now: number,
    moveOptions: QuakeMoveGoalOptions,
  ): boolean {
    const chaseSpeed = profile.chaseSpeed ?? 0;
    if (chaseSpeed <= 0 || dt <= 0) return false;
    const sourceMovementBudget = quakecMovementBudget(shootable, moveOptions.movementCall);
    const stepBudget = quakecMovementStepBudget(
      shootable.enemy,
      sourceMovementBudget,
      chaseSpeed,
      dt,
      now,
      options.enemyTickMs,
    );
    const usesQuakecMovementBudget = sourceMovementBudget !== null;
    if (shootable.enemy) shootable.enemy.quakecMovementHandledStep = false;
    const movementEpsilon = usesQuakecMovementBudget ? COLLISION_EPSILON : options.collisionEpsilon;
    if (stepBudget <= movementEpsilon) return false;
    if (usesQuakecMovementBudget && moveOptions.goalBounds && quakeMoveGoalBoundsCloseEnough(
      options.shootableCollisionWorldBounds(shootable),
      moveOptions.goalBounds,
      stepBudget,
    )) {
      clearQuakecMovementBudget(shootable.enemy);
      options.markTrace("enemy-move-close-enough", shootable, { step: stepBudget });
      return false;
    }
    const dx = targetOrigin[0] - shootable.origin[0];
    const dy = targetOrigin[1] - shootable.origin[1];
    const distance = Math.hypot(dx, dy);
    const remainingDistance = distance - moveOptions.stopDistance;
    if (!Number.isFinite(distance) || remainingDistance <= options.collisionEpsilon) {
      if (sourceMovementBudget !== null) clearQuakecMovementBudget(shootable.enemy);
      return false;
    }
    const step = Math.min(stepBudget, remainingDistance);
    if (step <= movementEpsilon) return false;
    const directYaw = quakeYawFromDirection(dx / distance, dy / distance);
    const candidates = usesQuakecMovementBudget
      ? quakeEnemyMoveGoalCandidates(
        shootable.enemy,
        shootable.origin,
        targetOrigin,
        moveOptions.allowWallFollow,
        directYaw,
        options.nextRandom,
      )
      : [quakeMoveGoalCandidate(directYaw, "direct")];
    for (const candidate of candidates) {
      const attempt = tryMoveChasingEnemy(shootable, candidate, step, usesQuakecMovementBudget, movementEpsilon);
      if (!attempt.handled) continue;
      if (!attempt.moved && sourceMovementBudget !== null) clearQuakecMovementBudget(shootable.enemy);
      return attempt.moved;
    }
    if (usesQuakecMovementBudget && shootable.enemy) {
      shootable.enemy.quakecIdealYaw = quakeMoveGoalOlddir(shootable.enemy.quakecIdealYaw ?? directYaw);
      if (!quakeMonsterMoveBottomSupported(shootable, shootable.origin)) {
        shootable.enemy.quakecPartialGround = true;
        options.markTrace("enemy-move-partial-ground", shootable, { reason: "current-bottom-unsupported" });
      }
    }
    if (sourceMovementBudget !== null) clearQuakecMovementBudget(shootable.enemy);
    return false;
  }

  function tryMoveChasingEnemy(
    shootable: QuakeShootableState,
    candidate: QuakeMoveGoalCandidate,
    step: number,
    usesQuakecMovementBudget: boolean,
    movementEpsilon: number,
  ): QuakeMoveGoalAttempt {
    const horizontalNextOrigin: Vec3 = [
      shootable.origin[0] + candidate.dx * step,
      shootable.origin[1] + candidate.dy * step,
      shootable.origin[2],
    ];
    const nextOrigin = groundedQuakeMonsterOrigin({
      bounds: shootable.collisionBounds,
      entity: shootable.entity,
      floorAt: options.floorAt,
      mode: "move",
      origin: horizontalNextOrigin,
    });
    if (distanceSq3(nextOrigin, shootable.origin) <= movementEpsilon * movementEpsilon) {
      return { handled: false, moved: false };
    }
    const from = options.shootableEyeOrigin(shootable);
    const to: Vec3 = [nextOrigin[0], nextOrigin[1], from[2]];
    if (!options.hasLineOfSight(from, to)) return { handled: false, moved: false };
    const bottomSupported = !usesQuakecMovementBudget || quakeMonsterMoveBottomSupported(shootable, nextOrigin);
    if (usesQuakecMovementBudget && !bottomSupported && !shootable.enemy?.quakecPartialGround) {
      return { handled: false, moved: false };
    }
    let facingIdeal = true;
    if (usesQuakecMovementBudget && shootable.enemy) {
      shootable.yaw = quakecChangeYaw(shootable.yaw, candidate.yaw, quakeMonsterYawSpeed(shootable.entity));
      shootable.enemy.quakecIdealYaw = candidate.yaw;
      shootable.enemy.quakecMovementHandledStep = true;
      facingIdeal = quakecFacingIdeal(shootable.yaw, candidate.yaw);
    }
    if (!facingIdeal) {
      options.markTrace("enemy-move-yaw-gated", shootable, {
        targetYaw: candidate.yaw,
        yaw: shootable.yaw,
      });
      return { handled: true, moved: false };
    }
    shootable.origin = nextOrigin;
    shootable.leafIndex = options.leafIndexAt(nextOrigin);
    if (usesQuakecMovementBudget) {
      consumeQuakecMovementBudget(shootable.enemy, step);
      if (shootable.enemy) {
        if (bottomSupported) shootable.enemy.quakecPartialGround = false;
      }
    }
    options.markTrace("enemy-move", shootable, {
      partialGround: usesQuakecMovementBudget && !bottomSupported,
      sourceStep: usesQuakecMovementBudget,
      step,
      x: nextOrigin[0],
      y: nextOrigin[1],
      z: nextOrigin[2],
      groundDz: nextOrigin[2] - horizontalNextOrigin[2],
      moveType: candidate.type,
      yaw: candidate.yaw,
    });
    return { handled: true, moved: true };
  }

  function quakeMonsterMoveBottomSupported(shootable: QuakeShootableState, origin: Vec3): boolean {
    const spawnProfile = quakeMonsterSpawnProfileForEntity(shootable.entity);
    if (!shootable.entity.classname.startsWith("monster_") || !spawnProfile?.dropToFloor) return true;
    const bounds = shootable.collisionBounds;
    const mins: Vec3 = [
      origin[0] + bounds.min[0],
      origin[1] + bounds.min[1],
      origin[2] + bounds.min[2],
    ];
    const maxs: Vec3 = [
      origin[0] + bounds.max[0],
      origin[1] + bounds.max[1],
      origin[2] + bounds.max[2],
    ];
    const footZ = mins[2];
    const traceMaxZ = footZ + GROUND_SNAP;
    const traceMinZ = footZ - STEP_HEIGHT * 2 - GROUND_SNAP;
    if (quakeMonsterBottomCornersSolid(mins, maxs)) return true;
    const centerX = (mins[0] + maxs[0]) * 0.5;
    const centerY = (mins[1] + maxs[1]) * 0.5;
    const midFloor = options.floorAt(centerX, centerY, traceMaxZ, traceMinZ);
    if (midFloor === null) {
      options.markTrace("enemy-move-check-bottom", shootable, { reason: "midpoint-unsupported" });
      return false;
    }
    const corners: Array<[number, number]> = [
      [mins[0], mins[1]],
      [mins[0], maxs[1]],
      [maxs[0], mins[1]],
      [maxs[0], maxs[1]],
    ];
    for (const [x, y] of corners) {
      const cornerFloor = options.floorAt(x, y, traceMaxZ, traceMinZ);
      if (cornerFloor === null || midFloor - cornerFloor > STEP_HEIGHT + options.collisionEpsilon) {
        options.markTrace("enemy-move-check-bottom", shootable, {
          cornerFloor,
          midFloor,
          reason: cornerFloor === null ? "unsupported" : "step",
          x,
          y,
        });
        return false;
      }
    }
    return true;
  }

  function quakeMonsterBottomCornersSolid(mins: Vec3, maxs: Vec3): boolean {
    if (!options.contentsAt) return false;
    const z = mins[2] - QUAKE_COLLISION_UNIT_SCALE;
    const corners: Array<[number, number]> = [
      [mins[0], mins[1]],
      [mins[0], maxs[1]],
      [maxs[0], mins[1]],
      [maxs[0], maxs[1]],
    ];
    return corners.every(([x, y]) => options.contentsAt?.([x, y, z]) === options.contentsSolid);
  }

  function shouldAnimateChasingEnemy(
    shootable: QuakeShootableState,
    playerOrigin: Vec3,
    profile: QuakeMonsterCombatProfile,
    canSeePlayer: boolean,
  ): boolean {
    const stopDistance = canSeePlayer
      ? Math.max(profile.chaseStopDistance ?? profile.range * 0.72, PLAYER_RADIUS * 1.45)
      : 0;
    return shouldAnimateMovingEnemy(shootable, playerOrigin, stopDistance);
  }

  function shouldAnimateMovingEnemy(
    shootable: QuakeShootableState,
    targetOrigin: Vec3,
    stopDistance: number,
    epsilon = options.collisionEpsilon,
  ): boolean {
    const enemy = shootable.enemy;
    if (!enemy?.quakecRunner) return false;
    const dx = targetOrigin[0] - shootable.origin[0];
    const dy = targetOrigin[1] - shootable.origin[1];
    const distance = Math.hypot(dx, dy);
    return Number.isFinite(distance) && distance - stopDistance > epsilon;
  }

  function faceShootableAtOrigin(
    shootable: QuakeShootableState,
    targetOrigin: Vec3,
  ): void {
    const dx = targetOrigin[0] - shootable.origin[0];
    const dy = targetOrigin[1] - shootable.origin[1];
    const yaw = (Math.atan2(dy, dx) * 180) / Math.PI;
    options.syncShootableTransform(shootable, yaw);
  }

  return {
    faceShootableAtOrigin,
    moveChasingEnemy,
    moveEnemyTowardOrigin,
    shouldAnimateChasingEnemy,
    shouldAnimateMovingEnemy,
  };
}

export function quakeEnemyMoveGoalCandidates(
  enemy: QuakeEnemyState | undefined,
  origin: Vec3,
  targetOrigin: Vec3,
  allowWallFollow: boolean,
  directYaw: number,
  nextEnemyRandom: (enemy: QuakeEnemyState) => number,
): QuakeMoveGoalCandidate[] {
  if (!allowWallFollow) return [quakeMoveGoalCandidate(directYaw, "direct")];

  const idealYaw = enemy?.quakecIdealYaw ?? directYaw;
  const olddir = quakeMoveGoalOlddir(idealYaw);
  const turnaround = quakeAngleMod(olddir - 180);
  const out: QuakeMoveGoalCandidate[] = [];

  const deltaX = targetOrigin[0] - origin[0];
  const deltaY = targetOrigin[1] - origin[1];
  const xDir = deltaX > 10 * QUAKE_COLLISION_UNIT_SCALE
    ? 0
    : deltaX < -10 * QUAKE_COLLISION_UNIT_SCALE
      ? 180
      : null;
  const yDir = deltaY < -10 * QUAKE_COLLISION_UNIT_SCALE
    ? 270
    : deltaY > 10 * QUAKE_COLLISION_UNIT_SCALE
      ? 90
      : null;

  if (xDir !== null && yDir !== null) {
    const diagonal = xDir === 0 ? (yDir === 90 ? 45 : 315) : (yDir === 90 ? 135 : 215);
    if (diagonal !== turnaround) out.push(quakeMoveGoalCandidate(diagonal, "direct"));
  }

  let firstDir = xDir;
  let secondDir = yDir;
  if ((enemy && nextEnemyRandom(enemy) < 0.5) || Math.abs(deltaY) > Math.abs(deltaX)) {
    firstDir = yDir;
    secondDir = xDir;
  }
  if (firstDir !== null && firstDir !== turnaround) out.push(quakeMoveGoalCandidate(firstDir, "direct"));
  if (secondDir !== null && secondDir !== turnaround) out.push(quakeMoveGoalCandidate(secondDir, "direct"));
  out.push(quakeMoveGoalCandidate(olddir, "ideal"));

  const sweepAscending = !enemy || nextEnemyRandom(enemy) < 0.5;
  const sweep = sweepAscending
    ? [0, 45, 90, 135, 180, 225, 270, 315]
    : [315, 270, 225, 180, 135, 90, 45, 0];
  for (const yaw of sweep) {
    if (yaw !== turnaround) out.push(quakeMoveGoalCandidate(yaw, "sweep"));
  }
  out.push(quakeMoveGoalCandidate(turnaround, "turnaround"));
  return uniqueMoveGoalCandidates(out);
}

export function quakeMoveGoalBoundsCloseEnough(actorBounds: QuakeBounds, goalBounds: QuakeBounds, dist: number): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    if ((goalBounds.min[axis] ?? 0) > (actorBounds.max[axis] ?? 0) + dist) return false;
    if ((goalBounds.max[axis] ?? 0) < (actorBounds.min[axis] ?? 0) - dist) return false;
  }
  return true;
}

export function quakeMoveGoalCandidate(yaw: number, type: QuakeMoveGoalCandidate["type"]): QuakeMoveGoalCandidate {
  const radians = (quakeAngleMod(yaw) * Math.PI) / 180;
  return {
    dx: Math.cos(radians),
    dy: Math.sin(radians),
    type,
    yaw: quakeAngleMod(yaw),
  };
}

export function quakeMoveGoalOlddir(idealYaw: number): number {
  return quakeAngleMod(Math.trunc(quakeAngleMod(idealYaw) / 45) * 45);
}

export function quakecChangeYaw(currentYaw: number, idealYaw: number, speed: number): number {
  const current = quakeAngleMod(currentYaw);
  const ideal = quakeAngleMod(idealYaw);
  if (Math.abs(current - ideal) <= Number.EPSILON) return current;
  let move = ideal - current;
  if (ideal > current) {
    if (move >= 180) move -= 360;
  } else if (move <= -180) {
    move += 360;
  }
  const clampedMove = Math.max(-speed, Math.min(speed, move));
  return quakeAngleMod(current + clampedMove);
}

export function quakecFacingIdeal(currentYaw: number, idealYaw: number): boolean {
  const delta = quakeAngleMod(currentYaw - idealYaw);
  return !(delta > 45 && delta < 315);
}

export function quakeMonsterYawSpeed(entity: QuakeEntity): number {
  const startKind = quakeMonsterSpawnProfileForEntity(entity)?.startKind;
  return startKind === "fly" || startKind === "swim"
    ? QUAKE_MONSTER_FLY_SWIM_YAW_SPEED
    : QUAKE_MONSTER_WALK_YAW_SPEED;
}

export function quakeYawToOrigin(origin: Vec3, targetOrigin: Vec3): number {
  return quakeYawFromDirection(targetOrigin[0] - origin[0], targetOrigin[1] - origin[1]);
}

export function quakeYawFromDirection(dx: number, dy: number): number {
  if (Math.abs(dx) <= Number.EPSILON && Math.abs(dy) <= Number.EPSILON) return 0;
  return quakeAngleMod((Math.atan2(dy, dx) * 180) / Math.PI);
}

export function quakecMovementBudget(
  shootable: QuakeShootableState,
  movementCall: "ai_run" | "ai_walk",
): number | null {
  const enemy = shootable.enemy;
  if (!enemy || !enemy.quakecRunner || !quakecMonsterHasMovement(shootable.entity.classname, movementCall)) return null;
  if (enemy.quakecMovementCall !== movementCall) return 0;
  return enemy.quakecMovementStateName && enemy.quakecMovementUnitsRemaining > 0
    ? enemy.quakecMovementUnitsRemaining
    : 0;
}

export function quakecMovementStepBudget(
  enemy: QuakeEnemyState | undefined,
  sourceMovementBudget: number | null,
  fallbackSpeed: number,
  dt: number,
  now: number,
  enemyTickMs: number,
): number {
  if (sourceMovementBudget === null) return fallbackSpeed * dt;
  const sourceFrameRemainingMs = Math.max(enemyTickMs, (enemy?.nextAnimationFrameAt ?? 0) - now);
  const sourceSpeed = sourceMovementBudget / (sourceFrameRemainingMs / 1000);
  return Math.min(sourceSpeed * dt, sourceMovementBudget);
}

export function syncEnemyQuakecMovementBudget(
  enemy: QuakeEnemyState,
  classname: string,
  step: QuakeMonsterStateStep,
  mode: QuakeMonsterAnimationMode,
): void {
  const movementCall = mode === "walk" ? "ai_run" : mode === "path" ? "ai_walk" : null;
  if (!movementCall || !quakecMonsterHasMovement(classname, movementCall)) {
    clearQuakecMovementBudget(enemy);
    return;
  }
  const distanceUnits = quakecStepMovementDistanceUnits(step, movementCall);
  if (distanceUnits === null) {
    clearQuakecMovementBudget(enemy);
    return;
  }
  enemy.quakecMovementCall = movementCall;
  enemy.quakecMovementStateName = step.stateName;
  enemy.quakecMovementUnitsRemaining = distanceUnits * QUAKE_COLLISION_UNIT_SCALE;
}

export function consumeQuakecMovementBudget(enemy: QuakeEnemyState | undefined, amount: number): void {
  if (!enemy) return;
  enemy.quakecMovementUnitsRemaining = Math.max(0, enemy.quakecMovementUnitsRemaining - amount);
  if (enemy.quakecMovementUnitsRemaining <= COLLISION_EPSILON) {
    clearQuakecMovementBudget(enemy);
  }
}

export function clearQuakecMovementBudget(enemy: QuakeEnemyState | undefined): void {
  if (!enemy) return;
  enemy.quakecMovementCall = null;
  enemy.quakecMovementStateName = null;
  enemy.quakecMovementUnitsRemaining = 0;
}

function uniqueMoveGoalCandidates(candidates: QuakeMoveGoalCandidate[]): QuakeMoveGoalCandidate[] {
  const seen = new Set<number>();
  const out: QuakeMoveGoalCandidate[] = [];
  for (const candidate of candidates) {
    const yawKey = Math.round(quakeAngleMod(candidate.yaw) * 1000);
    if (seen.has(yawKey)) continue;
    seen.add(yawKey);
    out.push(candidate);
  }
  return out;
}

function quakeAngleMod(yaw: number): number {
  return ((yaw % 360) + 360) % 360;
}

function quakecStepMovementDistanceUnits(
  step: QuakeMonsterStateStep,
  callName: string,
): number | null {
  for (const movement of step.movement) {
    if (movement.call === callName && typeof movement.distanceUnits === "number") {
      return movement.distanceUnits;
    }
  }
  return null;
}
