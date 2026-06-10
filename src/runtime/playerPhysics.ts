import type { Vec3 } from "@layoutit/polycss";

import { COLLISION_EPSILON, QUAKE_COLLISION_UNIT_SCALE } from "./constants";

export const QUAKE_PMOVE_DT_CLAMP = 0.05;
export const QUAKE_PMOVE_MAX_SPEED = 320 * QUAKE_COLLISION_UNIT_SCALE;
export const QUAKE_PMOVE_BACK_SPEED = 200 * QUAKE_COLLISION_UNIT_SCALE;
export const QUAKE_PMOVE_FORWARD_SPEED = 200 * QUAKE_COLLISION_UNIT_SCALE;
export const QUAKE_PMOVE_SIDE_SPEED = 350 * QUAKE_COLLISION_UNIT_SCALE;
export const QUAKE_PMOVE_SPEED_KEY_MULTIPLIER = 2;
export const QUAKE_PMOVE_EDGE_DISTANCE = 16 * QUAKE_COLLISION_UNIT_SCALE;
export const QUAKE_PMOVE_EDGE_DROP = 34 * QUAKE_COLLISION_UNIT_SCALE;
export const QUAKE_PMOVE_EDGE_FRICTION = 2;

const QUAKE_PMOVE_ACCELERATE = 10;
const QUAKE_PMOVE_AIR_ACCELERATE = 10;
const QUAKE_PMOVE_AIR_WISH_SPEED = 30 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_PMOVE_FRICTION = 4;
const QUAKE_PMOVE_STOP_SPEED = 100 * QUAKE_COLLISION_UNIT_SCALE;

export interface QuakePlayerMoveCommand {
  forwardMove: number;
  jump: boolean;
  sideMove: number;
  yawDegrees: number;
}

export function updateQuakePlayerPhysics(
  velocity: Vec3,
  command: QuakePlayerMoveCommand,
  grounded: boolean,
  dt: number,
  gravity: number,
  jumpVelocity: number,
  frictionScale = 1,
): boolean {
  const yaw = (command.yawDegrees * Math.PI) / 180;
  const forwardX = -Math.cos(yaw);
  const forwardY = -Math.sin(yaw);
  const rightX = -Math.sin(yaw);
  const rightY = Math.cos(yaw);
  let wishVelocityX = forwardX * command.forwardMove + rightX * command.sideMove;
  let wishVelocityY = forwardY * command.forwardMove + rightY * command.sideMove;
  let wishSpeed = Math.hypot(wishVelocityX, wishVelocityY);
  if (wishSpeed > QUAKE_PMOVE_MAX_SPEED) {
    const scale = QUAKE_PMOVE_MAX_SPEED / wishSpeed;
    wishVelocityX *= scale;
    wishVelocityY *= scale;
    wishSpeed = QUAKE_PMOVE_MAX_SPEED;
  }
  const wishDirectionX = wishSpeed > COLLISION_EPSILON ? wishVelocityX / wishSpeed : 0;
  const wishDirectionY = wishSpeed > COLLISION_EPSILON ? wishVelocityY / wishSpeed : 0;

  if (grounded) {
    velocity[2] = 0;
    applyQuakeFriction(velocity, dt, frictionScale);
    applyQuakeAccelerate(velocity, wishDirectionX, wishDirectionY, wishSpeed, QUAKE_PMOVE_ACCELERATE, dt);
    if (command.jump) {
      velocity[2] += jumpVelocity;
      grounded = false;
    }
  } else {
    applyQuakeAirAccelerate(velocity, wishVelocityX, wishVelocityY, wishSpeed, dt);
  }

  if (!grounded) velocity[2] -= gravity * dt;
  return grounded;
}

function applyQuakeFriction(velocity: Vec3, dt: number, frictionScale: number): void {
  const speed = Math.hypot(velocity[0], velocity[1]);
  if (speed <= COLLISION_EPSILON) return;
  const control = speed < QUAKE_PMOVE_STOP_SPEED ? QUAKE_PMOVE_STOP_SPEED : speed;
  const friction = QUAKE_PMOVE_FRICTION * Math.max(0, frictionScale);
  const newspeed = Math.max(0, speed - dt * control * friction) / speed;
  velocity[0] *= newspeed;
  velocity[1] *= newspeed;
  velocity[2] *= newspeed;
}

function applyQuakeAccelerate(
  velocity: Vec3,
  wishdirX: number,
  wishdirY: number,
  wishspeed: number,
  accel: number,
  dt: number,
): void {
  if (wishspeed <= COLLISION_EPSILON) return;
  const currentspeed = velocity[0] * wishdirX + velocity[1] * wishdirY;
  const addspeed = wishspeed - currentspeed;
  if (addspeed <= 0) return;
  const accelspeed = Math.min(addspeed, accel * dt * wishspeed);
  velocity[0] += accelspeed * wishdirX;
  velocity[1] += accelspeed * wishdirY;
}

function applyQuakeAirAccelerate(
  velocity: Vec3,
  wishVelocityX: number,
  wishVelocityY: number,
  wishspeed: number,
  dt: number,
): void {
  const speed = Math.hypot(wishVelocityX, wishVelocityY);
  if (speed <= COLLISION_EPSILON) return;
  const wishdirX = wishVelocityX / speed;
  const wishdirY = wishVelocityY / speed;
  const wishspd = Math.min(speed, QUAKE_PMOVE_AIR_WISH_SPEED);
  const currentspeed = velocity[0] * wishdirX + velocity[1] * wishdirY;
  const addspeed = wishspd - currentspeed;
  if (addspeed <= 0) return;
  const accelspeed = Math.min(addspeed, QUAKE_PMOVE_AIR_ACCELERATE * wishspeed * dt);
  velocity[0] += accelspeed * wishdirX;
  velocity[1] += accelspeed * wishdirY;
}
