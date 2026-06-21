import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const {
  createQuakeWeaponsController,
} = await importTsModule("src/runtime/weapons.ts");
const {
  createQuakeShootablesController,
} = await importTsModule("src/runtime/shootables.ts");
const {
  QUAKE_COLLISION_UNIT_SCALE,
} = await importTsModule("src/runtime/constants.ts");

function createShootable(index, origin = [0, 0, 0]) {
  return {
    bounds: {
      min: [origin[0] - 0.5, origin[1] - 0.5, origin[2] - 0.5],
      max: [origin[0] + 0.5, origin[1] + 0.5, origin[2] + 0.5],
    },
    dead: false,
    entity: {
      classname: "monster_grunt",
      index,
      properties: { classname: "monster_grunt" },
    },
    origin,
  };
}

function createWeaponsHarness({
  activeWeapon = "rocketlauncher",
  collisionWorld = null,
  damageShootable = null,
  entities = null,
  shootables,
}) {
  const damageCalls = [];
  const explosionImpacts = [];
  const impacts = [];
  const wallImpacts = [];
  let hits = 0;
  const entitiesByIndex = entities ?? new Map(shootables.map((shootable) => [shootable.entity.index, shootable.entity]));
  const weapons = createQuakeWeaponsController({
    addProjectileMesh: () => null,
    canUseGameplayInput: () => true,
    consumeAmmo: () => undefined,
    controls: {
      getOrigin: () => [100, 100, 100],
    },
    damageBrushEntity: () => true,
    damageMultiplier: () => 1,
    damagePlayer: () => false,
    damageShootable: (entityIndex, amount, context) => {
      damageCalls.push({ amount, entityIndex });
      return damageShootable?.(entityIndex, amount, context) ?? true;
    },
    getActiveWeapon: () => activeWeapon,
    getAmmo: () => 999,
    getCollisionWorld: () => collisionWorld,
    getEntities: () => entitiesByIndex,
    getPlayerEyeHeight: () => 1.7,
    getPlayerWaterLevel: () => 0,
    getShootables: () => shootables,
    hasViewmodel: () => true,
    onDamageImpact: (event) => { impacts.push(event); },
    onExplosionImpact: (event) => { explosionImpacts.push(event); },
    onHit: () => { hits += 1; },
    onWallImpact: (event) => { wallImpacts.push(event); },
    playFireAnimation: () => undefined,
    playFireSound: () => undefined,
    random: () => 0,
    scene: {
      camera: {
        state: {
          rotX: 90,
          rotY: 270,
        },
      },
    },
    selectBestWeapon: () => "axe",
    syncCrosshairTarget: () => undefined,
    syncHud: () => undefined,
  });
  return { damageCalls, explosionImpacts, impacts, hits: () => hits, wallImpacts, weapons };
}

function createExploboxEntity(index) {
  return {
    angle: 0,
    classname: "misc_explobox",
    index,
    origin: { x: 0, y: 0, z: 0 },
    properties: {
      classname: "misc_explobox",
      origin: "0 0 0",
    },
  };
}

function createExploboxShootablesHarness(entity) {
  const explosions = [];
  const shootables = createQuakeShootablesController({
    addMesh: () => null,
    damagePlayer: () => false,
    fireTarget: () => undefined,
    floorAt: (_x, _y, maxZ = 0) => maxZ,
    getPlayerEyeHeight: () => 1,
    getPlayerForward: () => [1, 0, 0],
    getPlayerOrigin: () => [100, 100, 100],
    hasLineOfSight: () => true,
    isInPlayerView: () => true,
    leafIndexAt: () => 0,
    monsterRuntimeEnabled: () => false,
    onExplosion: (event) => { explosions.push(event); },
    pixelate: () => undefined,
    pointToPoly: (point) => [point.x, point.y, point.z],
    schedulePresentationResync: () => undefined,
    shouldSpawn: () => true,
    visibleLeavesAt: () => new Set([0]),
  });
  shootables.spawn([entity], {
    models: {
      "maps/b_explob.bsp": {
        animationFrames: [],
        bounds: { min: [-0.42, -0.42, 0], max: [0.42, 0.42, 0.72] },
      },
    },
  });
  return { explosions, shootables };
}

test("projectile direct shootable damage emits one damage-impact event", () => {
  const { damageCalls, impacts, hits, weapons } = createWeaponsHarness({
    shootables: [createShootable(1)],
  });

  const result = weapons.debugProjectileImpact("nailgun", 1, [0, 0, 0], 9);

  assert.equal(result?.impactResult, "remove");
  assert.equal(hits(), 1);
  assert.deepEqual(damageCalls.map((call) => call.entityIndex), [1]);
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].damage, 9);
  assert.deepEqual(impacts[0].direction, [0, -1, 0]);
  assert.equal(impacts[0].entityIndex, 1);
  assert.equal(impacts[0].fireKind, "projectile");
  assert.deepEqual(impacts[0].origin, [0, 0, 0]);
  assert.equal(impacts[0].targetKind, "shootable");
  assert.equal(impacts[0].weapon, "nailgun");
});

test("projectile direct hit on explobox emits explobox explosion through shootables", () => {
  const explobox = createExploboxEntity(7);
  const shootablesHarness = createExploboxShootablesHarness(explobox);
  const { damageCalls, explosionImpacts, impacts, hits, weapons } = createWeaponsHarness({
    activeWeapon: "nailgun",
    damageShootable: (entityIndex, amount, context) =>
      shootablesHarness.shootables.damage(entityIndex, amount, context),
    entities: new Map([[explobox.index, explobox]]),
    shootables: [{
      bounds: { min: [-0.42, -0.42, 0], max: [0.42, 0.42, 0.72] },
      dead: false,
      entity: explobox,
      origin: [0, 0, 0],
    }],
  });

  const result = weapons.debugProjectileImpact("nailgun", explobox.index, [0, 0, 0], 20);

  assert.equal(result?.impactResult, "remove");
  assert.equal(hits(), 1);
  assert.deepEqual(damageCalls.map((call) => call.entityIndex), [explobox.index]);
  assert.equal(impacts.length, 1);
  assert.equal(explosionImpacts.length, 0);
  assert.equal(shootablesHarness.explosions.length, 1);
  assert.equal(shootablesHarness.explosions[0].classname, "misc_explobox");
  assert.equal(shootablesHarness.explosions[0].entityIndex, explobox.index);
  assert.equal(shootablesHarness.explosions[0].flavor, "explobox");
  assert.deepEqual(shootablesHarness.explosions[0].origin, [0, 0, 32 * QUAKE_COLLISION_UNIT_SCALE]);
  assert.equal(shootablesHarness.explosions[0].radiusUnits, 200);
});

test("projectile world impact emits one spike wall-impact event", () => {
  const { damageCalls, explosionImpacts, impacts, hits, wallImpacts, weapons } = createWeaponsHarness({
    shootables: [],
  });

  const result = weapons.debugProjectileImpact("nailgun", null, [0, 0, 0], 9);

  assert.equal(result?.impactResult, "remove");
  assert.equal(result?.directEntityIndex, null);
  assert.equal(hits(), 0);
  assert.equal(damageCalls.length, 0);
  assert.equal(explosionImpacts.length, 0);
  assert.equal(impacts.length, 0);
  assert.equal(wallImpacts.length, 1);
  assert.deepEqual(wallImpacts[0].direction, [0, -1, 0]);
  assert.equal(wallImpacts[0].effect, "spike");
  assert.equal(wallImpacts[0].fireKind, "projectile");
  assert.deepEqual(wallImpacts[0].origin, [0, 0, 0]);
  assert.equal(wallImpacts[0].targetKind, "world");
  assert.equal(wallImpacts[0].weapon, "nailgun");
});

test("hitscan wall traces emit one aggregated gunshot wall-impact event", () => {
  const wallTrace = {
    end: [1, 2, 3],
    fraction: 0.25,
    planeNormal: [0, 1, 0],
  };
  const { impacts, wallImpacts, weapons } = createWeaponsHarness({
    activeWeapon: "shotgun",
    collisionWorld: {
      traceUse: () => wallTrace,
    },
    shootables: [],
  });

  assert.equal(weapons.fire(1000), true);

  assert.equal(impacts.length, 0);
  assert.equal(wallImpacts.length, 1);
  assert.equal(wallImpacts[0].effect, "gunshot");
  assert.equal(wallImpacts[0].fireKind, "hitscan");
  assert.deepEqual(wallImpacts[0].origin, [1, 2, 3]);
  assert.equal(wallImpacts[0].targetKind, "world");
  assert.equal(wallImpacts[0].weapon, "shotgun");
});

test("projectile splash-only damage emits explosion but not damage-impact events", () => {
  const { damageCalls, explosionImpacts, impacts, hits, wallImpacts, weapons } = createWeaponsHarness({
    shootables: [
      createShootable(1, [0, 0, 0]),
      createShootable(2, [1, 0, 0]),
    ],
  });

  const result = weapons.debugProjectileImpact("rocketlauncher", 1, [0, 0, 0], 0);

  assert.equal(result?.impactResult, "remove");
  assert.equal(hits(), 1);
  assert.equal(damageCalls.length > 0, true);
  assert.equal(impacts.length, 0);
  assert.equal(explosionImpacts.length, 1);
  assert.equal(explosionImpacts[0].flavor, "rocket");
  assert.deepEqual(explosionImpacts[0].origin, [0, 0.16, 0]);
  assert.equal(explosionImpacts[0].radiusUnits, 160);
  assert.equal(explosionImpacts[0].weapon, "rocketlauncher");
  assert.equal(wallImpacts.length, 0);
});
