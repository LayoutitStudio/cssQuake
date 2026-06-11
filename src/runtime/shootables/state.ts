import type { PolyMeshHandle, Vec3 } from "@layoutit/polycss";

import type { QuakeMonsterTouchDamageFrameEvent } from "../../generated/quakeMonsterLogic";
import type { QuakeEntity } from "../../types/quake";
import type { QuakeMonsterStateRunner, QuakeMonsterStateStep } from "../quakeMonsterStateRunner";
import type { QuakeTriggerMonsterJumpRule } from "../triggerEffects";
import type { QuakePickupModel } from "../pickups";
import type { QuakeBounds } from "./bounds";
import type { QuakeMonsterCombatProfile } from "./combatFacts";

export interface QuakeShootableState {
  entity: QuakeEntity;
  origin: Vec3;
  leafIndex: number | undefined;
  model: QuakePickupModel | undefined;
  collisionBounds: {
    min: Vec3;
    max: Vec3;
  };
  bounds: {
    min: Vec3;
    max: Vec3;
  };
  handle: PolyMeshHandle | null;
  frameHandles: Map<number, PolyMeshHandle>;
  visible: boolean;
  lastMountCandidateAt: number;
  yaw: number;
  health: number;
  dead: boolean;
  enemy?: QuakeEnemyState;
}

export type QuakeShootableStateMap = Map<number, QuakeShootableState>;

export function createQuakeShootableStateMap(): QuakeShootableStateMap {
  return new Map<number, QuakeShootableState>();
}

export interface QuakeShootableTransformSnapshot {
  scale: number;
  x: number;
  y: number;
  yaw: number;
  z: number;
}

export interface QuakeEnemyState {
  animationFrameIndex: number;
  animationLockUntil: number;
  animationMode: QuakeMonsterAnimationMode;
  deathAnimationUntil: number;
  nextAnimationFrameAt: number;
  quakecAnimationChain: string | null;
  quakecDeathChain: string | null;
  quakecFiredEvents: Set<string>;
  quakecGibbed: boolean;
  quakecActiveTouchDamage: QuakeEnemyActiveTouchDamage | null;
  quakecIdealYaw: number | null;
  quakecLastState: QuakeMonsterStateStep | null;
  quakecMovementCall: "ai_run" | "ai_walk" | null;
  quakecMovementHandledStep: boolean;
  quakecPartialGround: boolean;
  quakecMovementStateName: string | null;
  quakecMovementUnitsRemaining: number;
  quakecPainChain: string | null;
  quakecPainFinishedUntil: number;
  quakecRunner: QuakeMonsterStateRunner | null;
  attackVisual: "cooldown" | "windup" | null;
  awake: boolean;
  burstShotsRemaining: number;
  nextAttackAt: number;
  pendingAttack: QuakeEnemyPendingAttack | null;
  movetarget: QuakeMonsterPathCorner | null;
  monsterJumpVelocity: Vec3;
  monsterJumpTouchedTriggerEntityIndex: number | null;
  seed: number;
  zombieGibbed: boolean;
  zombieNonSolidAt: number;
  zombiePainRepeatUntil: number;
  zombieRecoverUntil: number;
  zombieSolidAt: number;
}

export interface QuakeMonsterPathCorner {
  entity: QuakeEntity;
  origin: Vec3;
  target?: string;
  targetname: string;
}

export interface QuakeMonsterJumpTrigger {
  bounds: QuakeBounds;
  entityIndex: number;
  rule: QuakeTriggerMonsterJumpRule;
}

export interface QuakeMoveGoalCandidate {
  dx: number;
  dy: number;
  type: "direct" | "ideal" | "sweep" | "turnaround";
  yaw: number;
}

export interface QuakeMoveGoalAttempt {
  handled: boolean;
  moved: boolean;
}

export interface QuakeMoveGoalOptions {
  allowWallFollow: boolean;
  goalBounds?: QuakeBounds;
  movementCall: "ai_run" | "ai_walk";
  stopDistance: number;
}

export interface QuakeEnemyPendingAttack {
  fireAt: number;
  quakecChain?: string;
  target: Vec3;
}

export interface QuakeEnemyActiveTouchDamage {
  event: QuakeMonsterTouchDamageFrameEvent;
  expiresAt: number;
  frame: string;
  frameIndex: number;
  stateName: string;
}

export interface QuakeEnemyAnimationContext {
  enemyEye: Vec3;
  playerOrigin: [number, number, number];
  profile: QuakeMonsterCombatProfile;
}

export type QuakeMonsterAnimationMode = "attack" | "death" | "idle" | "pain" | "path" | "walk";

export interface QuakeMonsterAnimationProfile {
  attack?: QuakeMonsterAnimationRange;
  attackFps?: number;
  death?: QuakeMonsterAnimationRange;
  deathFps?: number;
  fps?: number;
  idle: QuakeMonsterAnimationRange;
  idleFps?: number;
  pain?: QuakeMonsterAnimationRange;
  painFps?: number;
  walk?: QuakeMonsterAnimationRange;
  walkFps?: number;
}

export interface QuakeMonsterAnimationRange {
  end: number;
  start: number;
}

export interface QuakeEnemyProjectile {
  damage: number;
  expiresAt: number;
  handle?: PolyMeshHandle | null;
  origin: Vec3;
  profile: QuakeMonsterCombatProfile;
  radius: number;
  radiusSq: number;
  sourceEntityIndex: number;
  velocity: Vec3;
}

export interface QuakeMonsterDeathOutputVisualHandle {
  handle: PolyMeshHandle;
  timer: number;
}

export interface QuakeDamageTraceResult {
  distance: number;
  hit: boolean;
  hitPoint: Vec3;
  reason: "blocked" | "hit" | "miss" | "range";
}

export interface QuakeShootableDamageContext {
  radiusVisited?: Set<number>;
}

export interface QuakeIdleDeadline {
  didTimeout: boolean;
  timeRemaining(): number;
}

export type QuakeWindowWithIdle = Window & {
  requestIdleCallback?: (callback: (deadline: QuakeIdleDeadline) => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};
