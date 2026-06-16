import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const {
  createQuakeEnemyProjectileRuntime,
} = await importTsModule("src/runtime/shootables/enemyProjectiles.ts");

function createRuntime({
  consumePlayerPainRandom = () => null,
  damagePlayer = () => true,
  floorAt,
  hasLineOfSight = () => true,
  traceLine = true,
  traceNormal = [-1, 0, 0],
} = {}) {
  const explosions = [];
  const sounds = [];
  let traceCount = 0;
  const runtime = createQuakeEnemyProjectileRuntime({
    addMesh: () => ({
      element: { classList: { add: () => undefined } },
      remove: () => undefined,
      setTransform: () => undefined,
    }),
    boundsCenter: (bounds) => [
      (bounds.min[0] + bounds.max[0]) * 0.5,
      (bounds.min[1] + bounds.max[1]) * 0.5,
      (bounds.min[2] + bounds.max[2]) * 0.5,
    ],
    currentModelLibrary: () => null,
    consumePlayerPainRandom,
    damagePlayer,
    ...(floorAt ? { floorAt } : {}),
    hasLineOfSight,
    markTrace: () => undefined,
    onExplosion: (event) => { explosions.push(event); },
    offsetPoint: (origin) => [...origin],
    pixelate: () => undefined,
    playerDamageBounds: (origin) => ({
      min: [origin[0] - 0.5, origin[1] - 0.5, origin[2] - 0.5],
      max: [origin[0] + 0.5, origin[1] + 0.5, origin[2] + 0.5],
    }),
    playerDamageOrigin: (origin) => [...origin],
    playSound: (soundPath, options) => {
      sounds.push({ soundPath, options });
      return true;
    },
    randomRange: () => 0,
    schedulePresentationResync: () => undefined,
    traceLine: typeof traceLine === "function"
      ? traceLine
      : traceLine ? (_start, _end) => {
        traceCount += 1;
        if (traceCount > 1) return null;
        return {
          classname: "worldspawn",
          end: [0.5, 0, 0],
          fraction: 0.5,
          planeNormal: traceNormal,
        };
      } : undefined,
  });

  return { explosions, runtime, sounds };
}

function spawnProjectile(runtime, profile) {
  runtime.spawn(
    { entity: { index: 1, classname: "monster_ogre" } },
    {},
    [0, 0, 0],
    [10, 0, 0],
    {
      cooldownMs: 0,
      damage: 40,
      kind: "projectile",
      projectileAimDrop: 0,
      projectileAimError: 0,
      projectileLifetimeMs: 10000,
      projectileRadius: 0.1,
      projectileSpeed: 10,
      projectileVerticalAimError: 0,
      range: 100,
      ...profile,
    },
    0,
  );
}

test("ogre grenades play source launch and bounce sounds", () => {
  const { explosions, runtime, sounds } = createRuntime();

  spawnProjectile(runtime, {
    projectileClassname: "enemy_projectile_grenade",
    projectileWorldTouch: "bounce",
  });
  runtime.update([100, 100, 100], 0.1, 100);

  assert.deepEqual(sounds.map((sound) => sound.soundPath), [
    "weapons/grenade.wav",
    "weapons/bounce.wav",
  ]);
  assert.deepEqual(explosions, []);
});

test("ogre grenades play source explosion sound on player splash hit", () => {
  const { explosions, runtime, sounds } = createRuntime({ traceLine: false });

  spawnProjectile(runtime, {
    projectileClassname: "enemy_projectile_grenade",
    projectileSplashDamage: 40,
    projectileSplashRadius: 40,
  });
  runtime.update([1, 0, 0], 0.1, 100);

  assert.deepEqual(sounds.map((sound) => sound.soundPath), [
    "weapons/grenade.wav",
    "weapons/r_exp3.wav",
  ]);
  assert.equal(explosions.length, 1);
  assert.equal(explosions[0].flavor, "grenade");
  assert.deepEqual(explosions[0].origin, [0.4, 0, 0]);
  assert.equal(explosions[0].projectile, "enemy_projectile_grenade");
  assert.equal(explosions[0].radiusUnits > 0, true);
  assert.equal(explosions[0].sourceEntityIndex, 1);
});

test("ogre grenades play source explosion sound on timeout", () => {
  const { explosions, runtime, sounds } = createRuntime({ traceLine: false });

  spawnProjectile(runtime, {
    projectileClassname: "enemy_projectile_grenade",
    projectileLifetimeMs: 50,
    projectileSplashDamage: 40,
    projectileSplashOnExpire: true,
    projectileSplashRadius: 40,
  });
  runtime.update([100, 100, 100], 0.1, 100);

  assert.deepEqual(sounds.map((sound) => sound.soundPath), [
    "weapons/grenade.wav",
    "weapons/r_exp3.wav",
  ]);
  assert.equal(explosions.length, 1);
  assert.equal(explosions[0].flavor, "grenade");
  assert.deepEqual(explosions[0].origin, [0, 0, 0]);
  assert.equal(explosions[0].projectile, "enemy_projectile_grenade");
});

test("ogre grenade timeout records expire, explode, and remove debug events", () => {
  const { runtime } = createRuntime({ traceLine: false });

  spawnProjectile(runtime, {
    projectileClassname: "enemy_projectile_grenade",
    projectileLifetimeMs: 50,
    projectileSplashDamage: 40,
    projectileSplashOnExpire: true,
    projectileSplashRadius: 40,
  });
  runtime.debugSetProjectileCaptureEnabled(true);
  runtime.update([100, 100, 100], 0.1, 100);

  assert.deepEqual(
    runtime.debugProjectileCapture().events.map((event) => event.type),
    ["expire", "explode", "remove"],
  );
});

test("zombie projectiles play source launch and miss sounds on world stop", () => {
  const { runtime, sounds } = createRuntime();

  spawnProjectile(runtime, {
    projectileClassname: "enemy_projectile_zombie_grenade",
    projectileWorldTouch: "stop",
  });
  runtime.update([100, 100, 100], 0.1, 100);

  assert.deepEqual(sounds.map((sound) => sound.soundPath), [
    "zombie/z_shot1.wav",
    "zombie/z_miss.wav",
  ]);
});

test("zombie projectiles stop on floor fallback when line trace misses", () => {
  const { runtime } = createRuntime({
    floorAt: (_x, _y, maxZ, minZ) => (maxZ >= 0 && minZ <= 0 ? 0 : null),
    traceLine: (_start, _end) => null,
  });

  spawnProjectile(runtime, {
    projectileClassname: "enemy_projectile_zombie_grenade",
    projectileGravity: 800,
    projectileVerticalVelocity: -10,
    projectileWorldTouch: "stop",
  });
  runtime.debugSetProjectileCaptureEnabled(true);
  runtime.update([100, 100, 100], 0.1, 100);

  const impact = runtime.debugProjectileCapture().events.find((event) => event.type === "impact");
  assert.equal(impact?.impactResult, "stop");
  assert.deepEqual(impact?.velocity, [0, 0, 0]);
  assert.equal(impact?.trace?.classname, "worldspawn");
});

test("ogre grenades bounce on floor fallback when line trace misses", () => {
  const { runtime } = createRuntime({
    floorAt: (_x, _y, maxZ, minZ) => (maxZ >= 0 && minZ <= 0 ? 0 : null),
    traceLine: (_start, _end) => null,
  });

  spawnProjectile(runtime, {
    projectileClassname: "enemy_projectile_grenade",
    projectileGravity: 800,
    projectileVerticalVelocity: -10,
    projectileWorldTouch: "bounce",
  });
  runtime.debugSetProjectileCaptureEnabled(true);
  runtime.update([100, 100, 100], 0.1, 100);

  const impact = runtime.debugProjectileCapture().events.find((event) => event.type === "impact");
  assert.equal(impact?.impactResult, "keep");
  assert.equal(impact?.trace?.classname, "worldspawn");
  assert.equal((impact?.velocity?.[2] ?? 0) > 0, true);
});

test("ogre grenades ignore no-normal obstruction traces instead of exploding", () => {
  const { runtime } = createRuntime({
    hasLineOfSight: () => false,
    traceLine: (_start, end) => ({
      classname: null,
      end,
      fraction: 0,
      planeNormal: null,
    }),
  });

  spawnProjectile(runtime, {
    projectileClassname: "enemy_projectile_grenade",
    projectileWorldTouch: "bounce",
  });
  runtime.debugSetProjectileCaptureEnabled(true);
  runtime.update([100, 100, 100], 0.1, 100);

  const capture = runtime.debugProjectileCapture();
  assert.equal(capture.events.some((event) => event.type === "impact"), false);
  assert.equal(capture.events.some((event) => event.type === "remove"), false);
  assert.equal(capture.activeCount, 1);
});

test("wizard spikes play the source launch sound when fired", () => {
  const { runtime, sounds } = createRuntime();

  spawnProjectile(runtime, {
    projectileClassname: "enemy_projectile_spike",
    projectileModelPath: "progs/w_spike.mdl",
  });

  assert.deepEqual(sounds.map((sound) => sound.soundPath), [
    "wizard/wattack.wav",
  ]);
});

test("boss lavaballs play the source launch sound when fired", () => {
  const { runtime, sounds } = createRuntime();

  spawnProjectile(runtime, {
    projectileClassname: "enemy_projectile_lavaball",
    projectileModelPath: "progs/lavaball.mdl",
  });

  assert.deepEqual(sounds.map((sound) => sound.soundPath), [
    "boss1/throw.wav",
  ]);
});

test("nonfatal player projectile damage consumes QuakeC PainSound random", () => {
  const painRandoms = [];
  const damages = [];
  const { runtime } = createRuntime({
    consumePlayerPainRandom: (details) => {
      painRandoms.push(details);
      return 0.25;
    },
    damagePlayer: (amount) => {
      damages.push(amount);
      return false;
    },
    traceLine: false,
  });

  spawnProjectile(runtime, {
    projectileClassname: "enemy_projectile_spike",
  });
  runtime.update([1, 0, 0], 0.1, 100);

  assert.deepEqual(damages, [40]);
  assert.equal(painRandoms.length, 1);
  assert.equal(painRandoms[0].damage, 40);
  assert.equal(painRandoms[0].projectile, "enemy_projectile_spike");
  assert.equal(painRandoms[0].reason, "hit");
  assert.equal(painRandoms[0].sourceEntityIndex, 1);
});

test("lethal player projectile damage does not consume PainSound random", () => {
  const painRandoms = [];
  const { runtime } = createRuntime({
    consumePlayerPainRandom: (details) => {
      painRandoms.push(details);
      return 0.25;
    },
    damagePlayer: () => true,
    traceLine: false,
  });

  spawnProjectile(runtime, {
    projectileClassname: "enemy_projectile_spike",
  });
  runtime.update([1, 0, 0], 0.1, 100);

  assert.deepEqual(painRandoms, []);
});
