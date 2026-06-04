import type { Vec3 } from "@layoutit/polycss";

import { COLLISION_EPSILON, QUAKE_COLLISION_UNIT_SCALE } from "./constants";

export function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subtractVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function quakeDeltaToPoly(point: { x: number; y: number; z: number }): Vec3 {
  return [
    point.x * QUAKE_COLLISION_UNIT_SCALE,
    point.y * QUAKE_COLLISION_UNIT_SCALE,
    point.z * QUAKE_COLLISION_UNIT_SCALE,
  ];
}

export function normalizeVec3(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return length > COLLISION_EPSILON
    ? [vector[0] / length, vector[1] / length, vector[2] / length]
    : [0, 0, 1];
}

export function polygonNormal(vertices: Vec3[]): Vec3 {
  for (let i = 0; i < vertices.length - 2; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const c = vertices[i + 2];
    if (!a || !b || !c) continue;
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal: Vec3 = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const length = Math.hypot(normal[0], normal[1], normal[2]);
    if (length > COLLISION_EPSILON) return [normal[0] / length, normal[1] / length, normal[2] / length];
  }
  return [0, 0, 0];
}

export function distSq2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function distanceSq2(a: Vec3, b: Vec3): number {
  return distSq2(a[0], a[1], b[0], b[1]);
}

export function distanceSq3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

