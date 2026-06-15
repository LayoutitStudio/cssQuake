import type { Vec3 } from "@layoutit/polycss";

const QUAKE_IMPACT_PARTICLE_DEFAULT_MAX = 24;
const QUAKE_IMPACT_PARTICLE_MAX_SPAWN = 5;
const QUAKE_IMPACT_PARTICLE_WALL_MAX_SPAWN = 4;
const QUAKE_IMPACT_PARTICLE_BASE_COUNT = 3;
const QUAKE_IMPACT_PARTICLE_WALL_BASE_COUNT = 3;
const QUAKE_IMPACT_PARTICLE_SOURCE_BLOOD_MULTIPLIER = 2;
const QUAKE_IMPACT_PARTICLE_SOURCE_COUNT_SCALE = 0.55;
const QUAKE_IMPACT_PARTICLE_DIRECTION_SPREAD_RADIANS = Math.PI * 0.82;
const QUAKE_IMPACT_PARTICLE_NEAR_DISTANCE = 4;
const QUAKE_IMPACT_PARTICLE_FAR_DISTANCE = 28;
const QUAKE_IMPACT_PARTICLE_NEAR_SCALE = 2;
const QUAKE_IMPACT_PARTICLE_FAR_SCALE = 0.58;
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

type ImpactParticleKind = "blood" | "wall";

export interface QuakeImpactParticleSpawn {
  count?: number;
  damage?: number;
  directionHint?: Vec3;
  origin?: Vec3;
}

export interface QuakeImpactParticleFlow {
  clear(): void;
  dispose(): void;
  setEnabled(enabled: boolean): void;
  spawnBlood(input?: QuakeImpactParticleSpawn): void;
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
  rotationDeg: number;
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
      rotationDeg: 0,
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

  function spawnWallImpact(input: QuakeImpactParticleSpawn = {}): void {
    spawnParticles("wall", input, resolveWallParticleCount(input));
  }

  function spawnParticles(kind: ImpactParticleKind, input: QuakeImpactParticleSpawn, count: number): void {
    if (!enabled || disposed || options.isGameplayPaused() || !options.canShow()) return;
    if (count <= 0) return;
    const startedAt = now();
    const distanceScale = particleDistanceScale(input.origin);
    const damagePressure = particleDamagePressure(input.damage);
    const spreadScale = particleSpreadScale(distanceScale, damagePressure);
    const baseAngle = particleScreenAngle(input.directionHint);
    for (let index = 0; index < count; index++) {
      const particle = nextParticle();
      const angle = particleAngle(baseAngle);
      const radius = particleRadius(kind, spreadScale);
      const speed = particleSpeed(kind, spreadScale);
      const colorClass = particleColorClass(kind);
      const shape = particleShape(kind, damagePressure);
      particle.active = true;
      particle.startedAt = startedAt;
      particle.durationMs = particleDuration(kind, damagePressure);
      particle.x = Math.cos(angle) * radius;
      particle.y = Math.sin(angle) * radius;
      particle.dx = Math.cos(angle) * speed;
      particle.dy = Math.sin(angle) * speed;
      particle.rotationDeg = shape.rotationDeg;
      particle.shapeX = shape.x;
      particle.shapeY = shape.y;
      particle.size = particleSize(kind, distanceScale);
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

  function particleRadius(kind: ImpactParticleKind, spreadScale: number): number {
    if (kind === "wall") return (2 + Math.random() * 8) * spreadScale;
    return (3 + Math.random() * 12) * spreadScale;
  }

  function particleSpeed(kind: ImpactParticleKind, spreadScale: number): number {
    if (kind === "wall") return (12 + Math.random() * 22) * spreadScale;
    return (20 + Math.random() * 28) * spreadScale;
  }

  function particleDuration(kind: ImpactParticleKind, damagePressure: number): number {
    if (kind === "wall") return 120 + Math.random() * 100;
    return 170 + damagePressure * 35 + Math.random() * (80 + damagePressure * 35);
  }

  function particleColorClass(kind: ImpactParticleKind): string {
    const colors = kind === "wall" ? QUAKE_IMPACT_PARTICLE_WALL_COLORS : QUAKE_IMPACT_PARTICLE_BLOOD_COLORS;
    return colors[Math.floor(Math.random() * colors.length) % colors.length];
  }

  function particleSize(kind: ImpactParticleKind, distanceScale: number): number {
    const styleScale = kind === "wall" ? 1.12 : 1;
    const variance = kind === "wall" ? 0.28 : 0.35;
    const nearBoost = kind === "wall" ? 1 + Math.max(0, distanceScale - 1) * 0.35 : 1;
    return distanceScale * styleScale * nearBoost * (1 + Math.random() * variance);
  }

  function particleShape(kind: ImpactParticleKind, damagePressure: number): { rotationDeg: number; x: number; y: number } {
    const roundChance = kind === "wall" ? 0.74 : 0.62;
    if (Math.random() <= roundChance) return { rotationDeg: 0, x: 1, y: 1 };
    const stretch = 1.08 + Math.random() * (0.16 + damagePressure * 0.12);
    return {
      rotationDeg: Math.random() * 360,
      x: stretch,
      y: Math.max(0.74, 1 / stretch),
    };
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

  function particleDistanceScale(origin?: Vec3): number {
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
    return QUAKE_IMPACT_PARTICLE_NEAR_SCALE +
      (QUAKE_IMPACT_PARTICLE_FAR_SCALE - QUAKE_IMPACT_PARTICLE_NEAR_SCALE) * t;
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
    spawnWallImpact,
  };
}

function particleTransform(particle: ImpactParticle, t: number): string {
  const x = particle.x + particle.dx * t;
  const y = particle.y + particle.dy * t;
  const scale = particle.size * (1 - t * 0.35);
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
