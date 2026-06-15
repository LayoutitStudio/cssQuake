import type { Vec3 } from "@layoutit/polycss";

const QUAKE_IMPACT_PARTICLE_DEFAULT_MAX = 24;
const QUAKE_IMPACT_PARTICLE_MAX_SPAWN = 5;
const QUAKE_IMPACT_PARTICLE_WALL_MAX_SPAWN = 7;
const QUAKE_IMPACT_PARTICLE_EXPLOSION_MAX_SPAWN = 8;
const QUAKE_IMPACT_PARTICLE_BASE_COUNT = 3;
const QUAKE_IMPACT_PARTICLE_WALL_BASE_COUNT = 5;
const QUAKE_IMPACT_PARTICLE_EXPLOSION_BASE_COUNT = 7;
const QUAKE_IMPACT_PARTICLE_SOURCE_BLOOD_MULTIPLIER = 2;
const QUAKE_IMPACT_PARTICLE_SOURCE_COUNT_SCALE = 0.55;
const QUAKE_IMPACT_PARTICLE_DIRECTION_SPREAD_RADIANS = Math.PI * 0.82;
const QUAKE_IMPACT_PARTICLE_NEAR_DISTANCE = 4;
const QUAKE_IMPACT_PARTICLE_FAR_DISTANCE = 28;
const QUAKE_IMPACT_PARTICLE_NEAR_SCALE = 2;
const QUAKE_IMPACT_PARTICLE_FAR_SCALE = 0.58;
const QUAKE_IMPACT_PARTICLE_WALL_NEAR_SCALE = 1.78;
const QUAKE_IMPACT_PARTICLE_WALL_FAR_SCALE = 0.44;
const QUAKE_IMPACT_PARTICLE_EXPLOSION_NEAR_SCALE = 28;
const QUAKE_IMPACT_PARTICLE_EXPLOSION_FAR_SCALE = 10;
const QUAKE_IMPACT_PARTICLE_DIRECTION_EPSILON = 0.08;
const QUAKE_IMPACT_PARTICLE_CLASS = "quake-impact-particle";
const QUAKE_IMPACT_PARTICLE_BLOOD_COLORS = [
  "quake-impact-particle-red-a",
  "quake-impact-particle-red-b",
  "quake-impact-particle-red-c",
] as const;
const QUAKE_IMPACT_PARTICLE_WALL_COLORS = [
  "quake-impact-particle-dust-a",
  "quake-impact-particle-dust-b",
  "quake-impact-particle-dust-c",
] as const;
const QUAKE_IMPACT_PARTICLE_WALL_SLOTS = [
  [-0.9, -0.35],
  [0, -0.95],
  [0.9, -0.35],
  [-0.65, 0.25],
  [0.65, 0.25],
  [-0.35, 0.9],
  [0.35, 0.9],
] as const;

type QuakeExplosionParticleFlavor = "explobox" | "grenade" | "lava" | "rocket";
type ImpactParticleKind = "blood" | "explosion" | "wall";
type ExplosionParticleRole = "debris" | "fire" | "flash";

export interface QuakeImpactParticleSpawn {
  count?: number;
  damage?: number;
  directionHint?: Vec3;
  origin?: Vec3;
}

export interface QuakeExplosionParticleSpawn extends QuakeImpactParticleSpawn {
  flavor?: QuakeExplosionParticleFlavor;
  radiusUnits?: number;
}

export interface QuakeImpactParticleFlow {
  clear(): void;
  dispose(): void;
  setEnabled(enabled: boolean): void;
  spawnBlood(input?: QuakeImpactParticleSpawn): void;
  spawnExplosion(input?: QuakeExplosionParticleSpawn): void;
  spawnWallImpact(input?: QuakeImpactParticleSpawn): void;
}

export interface QuakeImpactParticleFlowOptions {
  canShow(): boolean;
  isGameplayPaused(): boolean;
  layer: HTMLElement;
  maxParticles?: number;
  now?: () => number;
  viewOrigin?: () => Vec3 | null;
  viewRotation?: () => { rotX: number; rotY: number } | null;
}

interface ImpactParticle {
  active: boolean;
  dx: number;
  dy: number;
  durationMs: number;
  element: HTMLElement;
  fallY: number;
  rotationDeg: number;
  scaleEnd: number;
  scaleStart: number;
  shapeX: number;
  shapeY: number;
  size: number;
  startedAt: number;
  x: number;
  y: number;
}

export function createQuakeImpactParticleFlow(options: QuakeImpactParticleFlowOptions): QuakeImpactParticleFlow {
  const maxParticles = Math.max(1, Math.floor(options.maxParticles ?? QUAKE_IMPACT_PARTICLE_DEFAULT_MAX));
  const now = options.now ?? (() => performance.now());
  const particles: ImpactParticle[] = [];
  let enabled = true;
  let frameId: number | null = null;
  let nextParticleIndex = 0;
  let disposed = false;

  for (let index = 0; index < maxParticles; index++) {
    const element = document.createElement("b");
    element.className =
      `${QUAKE_IMPACT_PARTICLE_CLASS} ${QUAKE_IMPACT_PARTICLE_BLOOD_COLORS[index % QUAKE_IMPACT_PARTICLE_BLOOD_COLORS.length]}`;
    element.setAttribute("aria-hidden", "true");
    options.layer.appendChild(element);
    particles.push({
      active: false,
      dx: 0,
      dy: 0,
      durationMs: 0,
      element,
      fallY: 0,
      rotationDeg: 0,
      scaleEnd: 0.65,
      scaleStart: 1,
      shapeX: 1,
      shapeY: 1,
      size: 1,
      startedAt: 0,
      x: 0,
      y: 0,
    });
  }

  function setEnabled(nextEnabled: boolean): void {
    enabled = nextEnabled;
    if (!enabled) clear();
  }

  function spawnBlood(input: QuakeImpactParticleSpawn = {}): void {
    spawnParticles("blood", input, resolveBloodParticleCount(input));
  }

  function spawnExplosion(input: QuakeExplosionParticleSpawn = {}): void {
    spawnParticles("explosion", input, resolveExplosionParticleCount(input));
  }

  function spawnWallImpact(input: QuakeImpactParticleSpawn = {}): void {
    spawnParticles("wall", input, resolveWallParticleCount(input));
  }

  function spawnParticles(kind: ImpactParticleKind, input: QuakeImpactParticleSpawn, count: number): void {
    if (!enabled || disposed || options.isGameplayPaused() || !options.canShow()) return;
    if (count <= 0) return;
    const startedAt = now();
    const distanceScale = particleDistanceScale(kind, input.origin);
    const damagePressure = particleDamagePressure(input.damage);
    const explosionScale = kind === "explosion"
      ? explosionFlavorScale((input as QuakeExplosionParticleSpawn).flavor)
      : 1;
    const spreadScale = particleSpreadScale(distanceScale, damagePressure);
    const baseAngle = particleScreenAngle(input.directionHint);
    for (let index = 0; index < count; index++) {
      const particle = nextParticle();
      const angle = particleAngle(baseAngle);
      const explosionRole = kind === "explosion" ? explosionParticleRole(index, count) : null;
      const motion = particleMotion(kind, angle, spreadScale, index, count, explosionRole);
      const colorClass = particleColorClass(kind, explosionRole);
      const shape = particleShape(kind, damagePressure, explosionRole);
      const scale = particleScaleEnvelope(kind, explosionRole);
      particle.active = true;
      particle.startedAt = startedAt;
      particle.durationMs = particleDuration(kind, damagePressure, explosionRole);
      particle.x = motion.x;
      particle.y = motion.y;
      particle.dx = motion.dx;
      particle.dy = motion.dy;
      particle.fallY = motion.fallY;
      particle.rotationDeg = shape.rotationDeg;
      particle.scaleEnd = scale.end;
      particle.scaleStart = scale.start;
      particle.shapeX = shape.x;
      particle.shapeY = shape.y;
      particle.size = particleSize(kind, distanceScale, explosionRole, explosionScale);
      particle.element.className = `${QUAKE_IMPACT_PARTICLE_CLASS} ${colorClass}`;
      particle.element.style.transform = particleTransform(particle, 0);
      particle.element.style.opacity = "1";
    }
    ensureFrame();
  }

  function clear(): void {
    for (const particle of particles) {
      particle.active = false;
      particle.element.style.opacity = "0";
      particle.element.style.transform = "translate3d(0, 0, 0) scale(1, 1)";
      particle.scaleEnd = 0.65;
      particle.scaleStart = 1;
    }
    cancelFrame();
  }

  function dispose(): void {
    disposed = true;
    clear();
    for (const particle of particles) particle.element.remove();
  }

  function nextParticle(): ImpactParticle {
    const inactive = particles.find((particle) => !particle.active);
    if (inactive) return inactive;
    const particle = particles[nextParticleIndex];
    nextParticleIndex = (nextParticleIndex + 1) % particles.length;
    return particle;
  }

  function resolveBloodParticleCount(input: QuakeImpactParticleSpawn): number {
    if (input.count !== undefined) return clampParticleCount(Math.floor(input.count));
    if (input.damage !== undefined) return bloodParticleCountForDamage(input.damage);
    return clampParticleCount(QUAKE_IMPACT_PARTICLE_BASE_COUNT);
  }

  function resolveWallParticleCount(input: QuakeImpactParticleSpawn): number {
    if (input.count !== undefined) return clampParticleCount(Math.floor(input.count), QUAKE_IMPACT_PARTICLE_WALL_MAX_SPAWN);
    return clampParticleCount(QUAKE_IMPACT_PARTICLE_WALL_BASE_COUNT, QUAKE_IMPACT_PARTICLE_WALL_MAX_SPAWN);
  }

  function resolveExplosionParticleCount(input: QuakeExplosionParticleSpawn): number {
    if (input.count !== undefined) {
      return clampParticleCount(Math.floor(input.count), QUAKE_IMPACT_PARTICLE_EXPLOSION_MAX_SPAWN);
    }
    const flavorBoost = input.flavor === "explobox" || input.flavor === "lava" ? 1 : 0;
    const radiusBoost = input.radiusUnits !== undefined && input.radiusUnits >= 120 ? 1 : 0;
    return clampParticleCount(
      QUAKE_IMPACT_PARTICLE_EXPLOSION_BASE_COUNT + flavorBoost + radiusBoost,
      QUAKE_IMPACT_PARTICLE_EXPLOSION_MAX_SPAWN,
    );
  }

  function bloodParticleCountForDamage(damage: number): number {
    if (!Number.isFinite(damage) || damage <= 0) return 0;
    // QuakeC blood emits damage * 2 particles; compress that into the fixed DOM pool.
    const sourceCount = damage * QUAKE_IMPACT_PARTICLE_SOURCE_BLOOD_MULTIPLIER;
    const scaledCount = Math.sqrt(sourceCount) * QUAKE_IMPACT_PARTICLE_SOURCE_COUNT_SCALE;
    const baseCount = Math.floor(scaledCount);
    const roundedCount = baseCount + (Math.random() < scaledCount - baseCount ? 1 : 0);
    return clampParticleCount(Math.max(1, roundedCount));
  }

  function clampParticleCount(count: number, maxSpawn = QUAKE_IMPACT_PARTICLE_MAX_SPAWN): number {
    if (!Number.isFinite(count)) return 0;
    return Math.min(maxSpawn, Math.max(0, count));
  }

  function particleAngle(baseAngle: number | null): number {
    if (baseAngle === null) return Math.random() * Math.PI * 2;
    return baseAngle + (Math.random() - 0.5) * QUAKE_IMPACT_PARTICLE_DIRECTION_SPREAD_RADIANS;
  }

  function particleScreenAngle(directionHint?: Vec3): number | null {
    const viewRotation = options.viewRotation?.();
    if (!directionHint || !viewRotation) return null;
    const hintLength = Math.hypot(directionHint[0], directionHint[1], directionHint[2]);
    if (hintLength <= QUAKE_IMPACT_PARTICLE_DIRECTION_EPSILON) return null;
    const direction: Vec3 = [
      directionHint[0] / hintLength,
      directionHint[1] / hintLength,
      directionHint[2] / hintLength,
    ];
    const { right, up } = particleViewAxes(viewRotation.rotX, viewRotation.rotY);
    const x = dotVec3(direction, right);
    const y = -dotVec3(direction, up);
    if (Math.hypot(x, y) <= QUAKE_IMPACT_PARTICLE_DIRECTION_EPSILON) return null;
    return Math.atan2(y, x);
  }

  function particleSpreadScale(distanceScale: number, damagePressure: number): number {
    return (0.82 + distanceScale * 0.18) * (1 + damagePressure * 0.18);
  }

  function particleDamagePressure(damage?: number): number {
    if (!Number.isFinite(damage)) return 0;
    return clamp01(((damage as number) - 4) / 28);
  }

  function particleMotion(
    kind: ImpactParticleKind,
    angle: number,
    spreadScale: number,
    index: number,
    count: number,
    explosionRole: ExplosionParticleRole | null,
  ): {
    dx: number;
    dy: number;
    fallY: number;
    x: number;
    y: number;
  } {
    if (kind === "wall") {
      const slot = QUAKE_IMPACT_PARTICLE_WALL_SLOTS[index % QUAKE_IMPACT_PARTICLE_WALL_SLOTS.length];
      return {
        x: (slot[0] * 16 + (Math.random() - 0.5) * 3) * spreadScale,
        y: (slot[1] * 18 + (Math.random() - 0.5) * 3) * spreadScale,
        dx: (Math.random() - 0.5) * 0.5 * spreadScale,
        dy: Math.random() * 2 * spreadScale,
        fallY: (8 + Math.random() * 18) * spreadScale,
      };
    }
    if (kind === "explosion") {
      const jitterX = (Math.random() - 0.5) * 2 * spreadScale;
      const jitterY = (Math.random() - 0.5) * 2 * spreadScale;
      if (explosionRole === "flash") {
        return {
          x: jitterX * 0.25,
          y: jitterY * 0.25,
          dx: 0,
          dy: -1.5 * spreadScale,
          fallY: 0,
        };
      }
      if (explosionRole === "fire") {
        return {
          x: jitterX * 0.45,
          y: jitterY * 0.45,
          dx: (Math.random() - 0.5) * 1.5 * spreadScale,
          dy: -2 * spreadScale,
          fallY: 0,
        };
      }
      return {
        x: jitterX,
        y: jitterY,
        dx: (Math.random() - 0.5) * 1.5 * spreadScale,
        dy: 1 * spreadScale,
        fallY: 0,
      };
    }
    const radius = (3 + Math.random() * 12) * spreadScale;
    const speed = (20 + Math.random() * 28) * spreadScale;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      fallY: 0,
    };
  }

  function particleDuration(
    kind: ImpactParticleKind,
    damagePressure: number,
    explosionRole: ExplosionParticleRole | null,
  ): number {
    if (kind === "wall") return 260 + Math.random() * 160;
    if (kind === "explosion") {
      if (explosionRole === "flash") return 150 + damagePressure * 25 + Math.random() * 45;
      if (explosionRole === "fire") return 190 + damagePressure * 35 + Math.random() * 55;
      return 230 + damagePressure * 35 + Math.random() * 70;
    }
    return 170 + damagePressure * 35 + Math.random() * (80 + damagePressure * 35);
  }

  function particleColorClass(kind: ImpactParticleKind, explosionRole: ExplosionParticleRole | null): string {
    if (kind === "explosion") {
      if (explosionRole === "flash") return "quake-impact-particle-explosion-a";
      if (explosionRole === "fire") return "quake-impact-particle-explosion-b";
      return "quake-impact-particle-explosion-b";
    }
    const colors = kind === "wall"
      ? QUAKE_IMPACT_PARTICLE_WALL_COLORS
      : QUAKE_IMPACT_PARTICLE_BLOOD_COLORS;
    return colors[Math.floor(Math.random() * colors.length) % colors.length];
  }

  function particleSize(
    kind: ImpactParticleKind,
    distanceScale: number,
    explosionRole: ExplosionParticleRole | null,
    explosionScale: number,
  ): number {
    if (kind === "explosion") {
      const roleScale = explosionRole === "flash"
        ? 0.7
        : explosionRole === "fire"
          ? 1.15
          : 1.55;
      return distanceScale * explosionScale * roleScale * (1 + Math.random() * 0.08);
    }
    const variance = kind === "explosion" ? 0.42 : kind === "wall" ? 0.28 : 0.35;
    return distanceScale * (1 + Math.random() * variance);
  }

  function explosionFlavorScale(flavor: QuakeExplosionParticleFlavor | undefined): number {
    if (flavor === "explobox") return 1.28;
    if (flavor === "lava") return 1.12;
    if (flavor === "grenade") return 0.78;
    return 1;
  }

  function particleShape(
    kind: ImpactParticleKind,
    damagePressure: number,
    explosionRole: ExplosionParticleRole | null,
  ): { rotationDeg: number; x: number; y: number } {
    if (kind === "wall") return { rotationDeg: 0, x: 1, y: 1 };
    if (kind === "explosion") {
      if (explosionRole === "flash") return { rotationDeg: 0, x: 1, y: 1 };
      return { rotationDeg: Math.random() * 360, x: 1, y: 1 };
    }
    if (Math.random() <= 0.62) return { rotationDeg: 0, x: 1, y: 1 };
    const stretch = 1.08 + Math.random() * (0.16 + damagePressure * 0.12);
    return {
      rotationDeg: Math.random() * 360,
      x: stretch,
      y: Math.max(0.74, 1 / stretch),
    };
  }

  function particleScaleEnvelope(
    kind: ImpactParticleKind,
    explosionRole: ExplosionParticleRole | null,
  ): { end: number; start: number } {
    if (kind !== "explosion") return { end: 0.65, start: 1 };
    if (explosionRole === "flash") return { end: 1.55, start: 0.42 };
    if (explosionRole === "fire") return { end: 1.42, start: 0.5 };
    return { end: 1.28, start: 0.58 };
  }

  function explosionParticleRole(index: number, count: number): ExplosionParticleRole {
    if (index < Math.max(1, count - 3)) return "debris";
    if (index < count - 1) return "fire";
    if (index === count - 1) return "flash";
    return "debris";
  }

  function ensureFrame(): void {
    if (frameId !== null) return;
    frameId = requestQuakeAnimationFrame(tick);
  }

  function cancelFrame(): void {
    if (frameId === null) return;
    cancelQuakeAnimationFrame(frameId);
    frameId = null;
  }

  function particleDistanceScale(kind: ImpactParticleKind, origin?: Vec3): number {
    const viewOrigin = options.viewOrigin?.();
    if (!origin || !viewOrigin) return 1;
    const distance = Math.hypot(
      origin[0] - viewOrigin[0],
      origin[1] - viewOrigin[1],
      origin[2] - viewOrigin[2],
    );
    const t = clamp01(
      (distance - QUAKE_IMPACT_PARTICLE_NEAR_DISTANCE) /
        (QUAKE_IMPACT_PARTICLE_FAR_DISTANCE - QUAKE_IMPACT_PARTICLE_NEAR_DISTANCE),
    );
    const nearScale = kind === "explosion"
      ? QUAKE_IMPACT_PARTICLE_EXPLOSION_NEAR_SCALE
      : kind === "wall"
        ? QUAKE_IMPACT_PARTICLE_WALL_NEAR_SCALE
        : QUAKE_IMPACT_PARTICLE_NEAR_SCALE;
    const farScale = kind === "explosion"
      ? QUAKE_IMPACT_PARTICLE_EXPLOSION_FAR_SCALE
      : kind === "wall"
        ? QUAKE_IMPACT_PARTICLE_WALL_FAR_SCALE
        : QUAKE_IMPACT_PARTICLE_FAR_SCALE;
    return nearScale + (farScale - nearScale) * t;
  }

  function tick(at: number): void {
    frameId = null;
    if (disposed || !enabled || options.isGameplayPaused() || !options.canShow()) {
      clear();
      return;
    }
    let activeCount = 0;
    for (const particle of particles) {
      if (!particle.active) continue;
      const t = Math.min(1, Math.max(0, (at - particle.startedAt) / particle.durationMs));
      if (t >= 1) {
        particle.active = false;
        particle.element.style.opacity = "0";
        particle.element.style.transform = particleTransform(particle, 1);
        continue;
      }
      activeCount++;
      particle.element.style.transform = particleTransform(particle, t);
      particle.element.style.opacity = String(1 - t);
    }
    if (activeCount > 0) ensureFrame();
  }

  return {
    clear,
    dispose,
    setEnabled,
    spawnBlood,
    spawnExplosion,
    spawnWallImpact,
  };
}

function particleTransform(particle: ImpactParticle, t: number): string {
  const x = particle.x + particle.dx * t;
  const y = particle.y + particle.dy * t + particle.fallY * t * t;
  const scale = particle.size * (particle.scaleStart + (particle.scaleEnd - particle.scaleStart) * t);
  const scaleX = scale * particle.shapeX;
  const scaleY = scale * particle.shapeY;
  return `translate3d(${x.toFixed(3)}px, ${y.toFixed(3)}px, 0) ` +
    `rotate(${particle.rotationDeg.toFixed(3)}deg) scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`;
}

function particleViewAxes(rotX: number, rotY: number): { right: Vec3; up: Vec3 } {
  const rx = (rotX * Math.PI) / 180;
  const ry = (rotY * Math.PI) / 180;
  const forward: Vec3 = [
    -Math.sin(rx) * Math.cos(ry),
    -Math.sin(rx) * Math.sin(ry),
    -Math.cos(rx),
  ];
  const right = normalizeVec3([-Math.sin(ry), Math.cos(ry), 0]);
  return {
    right,
    up: normalizeVec3(crossVec3(right, forward)),
  };
}

function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalizeVec3(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= QUAKE_IMPACT_PARTICLE_DIRECTION_EPSILON) return [0, 0, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function requestQuakeAnimationFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelQuakeAnimationFrame(frameId: number): void {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(frameId);
    return;
  }
  window.clearTimeout(frameId);
}
