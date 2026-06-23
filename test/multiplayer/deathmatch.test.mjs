import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const deathmatch = await importTsModule("src/runtime/multiplayer/deathmatch.ts");
const constants = await importTsModule("src/runtime/constants.ts");

const liveE1m7FollowupFire = {
  weapon: "shotgun",
  fireKind: "hitscan",
  origin: [23.04, -8.48, 5.400625],
  direction: [-0.9972888515115433, 0, -0.07358632108474347],
  range: 64,
};

const liveE1m7FollowupHit = {
  target: {
    playerId: "party:client-prod-dyn-2",
    clientId: "client-prod-dyn-2",
    displayName: "Prod Dyn 2",
    mapName: "e1m7",
    origin: [10.383999999999983, -8.48, 5.400625],
    velocity: [0, 0, 0],
    rotX: 90,
    rotY: 270,
    health: 52,
    armor: 0,
    activeWeapon: "shotgun",
    alive: true,
    frags: 0,
    deaths: 0,
    lastInputSequence: 156,
    updatedAt: 1782175462970,
  },
  damage: 24,
  distance: 12.684236077652141,
  impact: [10.390152769817012, -8.48, 4.467238731275202],
  lateralMiss: 0.08361295586370313,
};

const duelForwardDirection = [0.9781476007338057, 0, -0.20791169081775934];

test("frag delta matches Quake obituary scoring for player and world kills", () => {
  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchFragDeltaForKill({
      attackerPlayerId: "attacker",
      victimPlayerId: "victim",
    }),
    1,
  );
  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchFragDeltaForKill({
      attackerPlayerId: "victim",
      victimPlayerId: "victim",
    }),
    -1,
  );
  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchFragDeltaForKill({
      victimPlayerId: "victim",
    }),
    -1,
  );
});

test("deathmatch spawn selection skips spawn points with nearby players", () => {
  const spawns = [
    { spawnId: "spawn-a", classname: "info_player_deathmatch", origin: [0, 0, 0], rotX: 90, rotY: 0 },
    { spawnId: "spawn-b", classname: "info_player_deathmatch", origin: [0.5, 0, 0], rotX: 90, rotY: 90 },
    { spawnId: "spawn-c", classname: "info_player_deathmatch", origin: [8, 0, 0], rotX: 90, rotY: 180 },
  ];

  const selection = deathmatch.quakeMultiplayerDeathmatchSelectSpawnPoint(
    spawns,
    [playerFixture({ origin: [0, 0, 0] })],
    { random: () => 0 },
  );

  assert.equal(selection?.spawn.spawnId, "spawn-c");
  assert.equal(selection?.nextCursor, 3);
});

test("deathmatch spawn selection randomly chooses among source-reversed clear spots", () => {
  const spawns = [
    { spawnId: "spawn-a-occupied", classname: "info_player_deathmatch", origin: [0, 0, 0], rotX: 90, rotY: 0 },
    { spawnId: "spawn-b-clear", classname: "info_player_deathmatch", origin: [8, 0, 0], rotX: 90, rotY: 90 },
    { spawnId: "spawn-c-clear", classname: "info_player_deathmatch", origin: [16, 0, 0], rotX: 90, rotY: 180 },
  ];

  const firstClear = deathmatch.quakeMultiplayerDeathmatchSelectSpawnPoint(
    spawns,
    [playerFixture({ origin: [0, 0, 0] })],
    { random: () => 0 },
  );
  const lastClear = deathmatch.quakeMultiplayerDeathmatchSelectSpawnPoint(
    spawns,
    [playerFixture({ origin: [0, 0, 0] })],
    { random: () => 0.999999 },
  );

  assert.equal(firstClear?.spawn.spawnId, "spawn-c-clear");
  assert.equal(firstClear?.nextCursor, 3);
  assert.equal(lastClear?.spawn.spawnId, "spawn-b-clear");
  assert.equal(lastClear?.nextCursor, 2);
});

test("deathmatch spawn selection falls back to a random occupied spot when all points are occupied", () => {
  const spawns = [
    { spawnId: "spawn-a", classname: "info_player_deathmatch", origin: [0, 0, 0], rotX: 90, rotY: 0 },
    { spawnId: "spawn-b", classname: "info_player_deathmatch", origin: [0.5, 0, 0], rotX: 90, rotY: 90 },
  ];

  const selection = deathmatch.quakeMultiplayerDeathmatchSelectSpawnPoint(
    spawns,
    [playerFixture({ origin: [0, 0, 0] }), playerFixture({ origin: [2, 0, 0] })],
    { random: () => 0.999999 },
  );

  assert.equal(selection?.spawn.spawnId, "spawn-b");
  assert.equal(selection?.nextCursor, 2);
});

test("direct player hit accepts a late brush trace inside the target hit skin", () => {
  const collisionWorld = {
    traceUse: () => ({
      fraction: 0.9856583826296409,
      end: [10.571572038585794, -8.48, 4.480625000000001],
      planeNormal: [0, 0, 1],
      entityIndex: 84,
      modelIndex: 3,
      classname: "func_wall",
    }),
  };

  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchHitHasLineOfSight(
      liveE1m7FollowupFire,
      liveE1m7FollowupHit,
      collisionWorld,
    ),
    true,
  );
});

test("direct player hit still rejects a wall trace before the target skin", () => {
  const collisionWorld = {
    traceUse: () => ({
      fraction: 0.5,
      end: [16.7, -8.48, 4.93],
      planeNormal: [1, 0, 0],
      entityIndex: 900,
      modelIndex: 9,
      classname: "func_wall",
    }),
  };

  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchHitHasLineOfSight(
      liveE1m7FollowupFire,
      liveE1m7FollowupHit,
      collisionWorld,
    ),
    false,
  );
});

test("projectile direct player hit uses projectile target skin for late LOS traces", () => {
  const collisionWorld = {
    traceUse: () => ({
      fraction: 0.99,
      end: [11.25, -8.48, 4.467238731275202],
      planeNormal: [0, 0, 1],
      entityIndex: 84,
      modelIndex: 3,
      classname: "func_wall",
    }),
  };

  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchHitHasLineOfSight(
      { ...liveE1m7FollowupFire, weapon: "rocketlauncher", fireKind: "projectile" },
      liveE1m7FollowupHit,
      collisionWorld,
    ),
    true,
  );
});

test("projectile direct player hit still rejects traces outside projectile target skin", () => {
  const collisionWorld = {
    traceUse: () => ({
      fraction: 0.99,
      end: [11.6, -8.48, 4.467238731275202],
      planeNormal: [0, 0, 1],
      entityIndex: 84,
      modelIndex: 3,
      classname: "func_wall",
    }),
  };

  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchHitHasLineOfSight(
      { ...liveE1m7FollowupFire, weapon: "rocketlauncher", fireKind: "projectile" },
      liveE1m7FollowupHit,
      collisionWorld,
    ),
    false,
  );
});

function playerFixture(overrides = {}) {
  return {
    playerId: "player",
    clientId: "client",
    displayName: "Player",
    mapName: "e1m7",
    origin: [0, 0, 0],
    velocity: [0, 0, 0],
    rotX: 90,
    rotY: 270,
    health: 100,
    armor: 0,
    activeWeapon: "shotgun",
    alive: true,
    frags: 0,
    deaths: 0,
    lastInputSequence: 0,
    updatedAt: 0,
    ...overrides,
  };
}

test("authoritative fire keeps server weapon and uses bounded submitted aim/origin hints", () => {
  const player = playerFixture({
    activeWeapon: "shotgun",
    origin: [5, 1, 2],
    rotX: -78,
    rotY: 180,
  });
  const fire = deathmatch.quakeMultiplayerDeathmatchFireFromPlayer(player, {
    weapon: "rocketlauncher",
    fireKind: "projectile",
    origin: [5.5, 1.25, 2],
    direction: duelForwardDirection,
    range: 1,
  });

  assert.equal(fire.weapon, "shotgun");
  assert.equal(fire.fireKind, "hitscan");
  assert.deepEqual(fire.origin, [5.5, 1.25, 2]);
  assert.deepEqual(fire.direction, duelForwardDirection);
  assert.equal(fire.range, 2048 * constants.QUAKE_COLLISION_UNIT_SCALE);
});

test("authoritative fire rejects a forged far submitted origin", () => {
  const player = playerFixture({
    activeWeapon: "shotgun",
    origin: [5, 1, 2],
    rotX: -78,
    rotY: 180,
  });
  const fire = deathmatch.quakeMultiplayerDeathmatchFireFromPlayer(player, {
    weapon: "shotgun",
    fireKind: "hitscan",
    origin: [20, 1, 2],
    direction: duelForwardDirection,
    range: 64,
  });

  assert.deepEqual(fire.origin, [5, 1, 2]);
  assert.deepEqual(fire.direction, duelForwardDirection);
});

test("weapon cooldowns keep source timings distinct", () => {
  assert.equal(deathmatch.quakeMultiplayerDeathmatchWeaponCooldownMs("nailgun"), 200);
  assert.equal(deathmatch.quakeMultiplayerDeathmatchWeaponCooldownMs("supernailgun"), 200);
  assert.equal(deathmatch.quakeMultiplayerDeathmatchWeaponCooldownMs("grenadelauncher"), 600);
  assert.equal(deathmatch.quakeMultiplayerDeathmatchWeaponCooldownMs("rocketlauncher"), 800);
  assert.equal(deathmatch.quakeMultiplayerDeathmatchWeaponCooldownMs("lightning"), 200);
});

test("authoritative fire kinds and ranges stay source-shaped per weapon", () => {
  assert.equal(deathmatch.quakeMultiplayerDeathmatchFireKindForWeapon("shotgun"), "hitscan");
  assert.equal(deathmatch.quakeMultiplayerDeathmatchFireKindForWeapon("nailgun"), "projectile");
  assert.equal(deathmatch.quakeMultiplayerDeathmatchFireKindForWeapon("supernailgun"), "projectile");
  assert.equal(deathmatch.quakeMultiplayerDeathmatchFireKindForWeapon("grenadelauncher"), "projectile");
  assert.equal(deathmatch.quakeMultiplayerDeathmatchFireKindForWeapon("rocketlauncher"), "projectile");
  assert.equal(deathmatch.quakeMultiplayerDeathmatchFireKindForWeapon("lightning"), "beam");
  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchFireRangeForWeapon("shotgun"),
    2048 * constants.QUAKE_COLLISION_UNIT_SCALE,
  );
  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchFireRangeForWeapon("nailgun"),
    1000 * 6 * constants.QUAKE_COLLISION_UNIT_SCALE,
  );
  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchFireRangeForWeapon("grenadelauncher"),
    600 * 2.5 * constants.QUAKE_COLLISION_UNIT_SCALE,
  );
  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchFireRangeForWeapon("rocketlauncher"),
    1000 * 5 * constants.QUAKE_COLLISION_UNIT_SCALE,
  );
  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchFireRangeForWeapon("lightning"),
    600 * constants.QUAKE_COLLISION_UNIT_SCALE,
  );
});

test("visible hit selection skips a blocked nearer player and hits a farther visible player", () => {
  const fire = {
    weapon: "shotgun",
    fireKind: "hitscan",
    origin: [0, 0, -0.85],
    direction: [1, 0, 0],
    range: 64,
  };
  const near = playerFixture({ playerId: "near", clientId: "near-client", origin: [2, 0, 0] });
  const far = playerFixture({ playerId: "far", clientId: "far-client", origin: [4, 0, 0] });
  const collisionWorld = {
    traceUse: (_origin, impact) => impact[0] < 3
      ? {
          fraction: 0.5,
          end: [1, 0, -0.85],
          planeNormal: [1, 0, 0],
          entityIndex: 33,
          modelIndex: 2,
          classname: "func_wall",
        }
      : null,
  };

  const hit = deathmatch.quakeMultiplayerDeathmatchVisibleHit(
    fire,
    [near, far],
    "attacker",
    collisionWorld,
  );

  assert.equal(hit?.target.playerId, "far");
});

test("player hit detection accepts upper-body aim against the Quake player hull", () => {
  const fire = {
    weapon: "shotgun",
    fireKind: "hitscan",
    origin: [0, 0, 0],
    direction: [1, 0, 0],
    range: 64,
  };
  const target = playerFixture({ playerId: "target", clientId: "target-client", origin: [4, 0, 0] });

  const hit = deathmatch.quakeMultiplayerDeathmatchVisibleHit(
    fire,
    [target],
    "attacker",
    null,
  );

  assert.equal(hit?.target.playerId, "target");
});

test("player hit detection rewinds moving targets to match delayed remote rendering", () => {
  const fire = {
    weapon: "shotgun",
    fireKind: "hitscan",
    origin: [0, 0, -0.36],
    direction: [1, 0, 0],
    range: 64,
  };
  const target = playerFixture({
    playerId: "moving",
    clientId: "moving-client",
    origin: [4, 1.4, 0],
    velocity: [0, 14, 0],
  });

  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchVisibleHit(
      fire,
      [target],
      "attacker",
      null,
    ),
    null,
  );
  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchVisibleHit(
      fire,
      [target],
      "attacker",
      null,
      { targetRewindMs: 100 },
    )?.target.playerId,
    "moving",
  );
});

test("projectile splash uses the impact point for indirect damage and momentum origin", () => {
  const fire = {
    weapon: "rocketlauncher",
    fireKind: "projectile",
    origin: [0, 0, 0],
    direction: [1, 0, 0],
    range: 64,
  };
  const directTarget = playerFixture({ playerId: "direct", clientId: "direct-client", origin: [3, 0, 0] });
  const indirectTarget = playerFixture({ playerId: "indirect", clientId: "indirect-client", origin: [5, 0, 0] });
  const directHit = {
    target: directTarget,
    damage: 120,
    distance: 2,
    impact: [2, 0, 0],
    lateralMiss: 0,
  };

  const hits = deathmatch.quakeMultiplayerDeathmatchSplashHits(
    fire,
    directHit,
    [directTarget, indirectTarget],
    "attacker",
  );
  const indirect = hits.find((hit) => hit.target.playerId === "indirect");

  assert.equal(indirect?.damage, 44);
  assert.deepEqual(indirect?.impact, [2, 0, 0]);
});

test("grenade direct player impact uses radius damage, not fake direct rocket damage", () => {
  const fire = {
    weapon: "grenadelauncher",
    fireKind: "projectile",
    origin: [0, 0, 0],
    direction: [1, 0, 0],
    range: 64,
  };
  const target = playerFixture({ playerId: "target", clientId: "target-client", origin: [3, 0, 0] });
  const directHit = {
    target,
    damage: 120,
    distance: 3,
    impact: [3, 0, -0.36],
    lateralMiss: 0,
  };

  const hits = deathmatch.quakeMultiplayerDeathmatchSplashHits(
    fire,
    directHit,
    [target],
    "attacker",
  );

  assert.equal(hits.length, 1);
  assert.equal(hits[0].target.playerId, "target");
  assert.equal(hits[0].direct, false);
  assert.equal(hits[0].damage, 120);
});

test("projectile splash halves attacker self damage", () => {
  const fire = {
    weapon: "rocketlauncher",
    fireKind: "projectile",
    origin: [0, 0, 0],
    direction: [1, 0, 0],
    range: 64,
  };
  const directTarget = playerFixture({ playerId: "direct", clientId: "direct-client", origin: [3, 0, 0] });
  const attacker = playerFixture({ playerId: "attacker", clientId: "attacker-client", origin: [0, 0, 0] });
  const directHit = {
    target: directTarget,
    damage: 120,
    distance: 2,
    impact: [2, 0, 0],
    lateralMiss: 0,
  };

  const hits = deathmatch.quakeMultiplayerDeathmatchSplashHits(
    fire,
    directHit,
    [directTarget, attacker],
    "attacker",
  );
  const selfSplash = hits.find((hit) => hit.target.playerId === "attacker");

  assert.equal(selfSplash?.damage, 35);
  assert.equal(selfSplash?.direct, false);
  assert.deepEqual(selfSplash?.impact, [2, 0, 0]);
});

test("projectile wall impact splash damages nearby players without a direct hit", () => {
  const fire = {
    weapon: "rocketlauncher",
    fireKind: "projectile",
    origin: [0, 0, 0],
    direction: [1, 0, 0],
    range: 64,
  };
  const nearMissTarget = playerFixture({
    playerId: "near-miss",
    clientId: "near-miss-client",
    origin: [3, 2, 0],
  });
  const collisionWorld = {
    traceUse: (origin, point) => origin[0] === 0 && point[0] > 10
      ? {
          fraction: 3 / 64,
          end: [3, 0, 0],
          planeNormal: [-1, 0, 0],
          entityIndex: 44,
          modelIndex: 3,
          classname: "func_wall",
        }
      : null,
  };

  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchVisibleHit(
      fire,
      [nearMissTarget],
      "attacker",
      collisionWorld,
    ),
    null,
  );

  const hits = deathmatch.quakeMultiplayerDeathmatchProjectileWorldSplashHits(
    fire,
    [nearMissTarget],
    "attacker",
    collisionWorld,
  );

  assert.equal(hits.length, 1);
  assert.equal(hits[0].target.playerId, "near-miss");
  assert.equal(hits[0].damage, 69);
  assert.deepEqual(hits[0].impact, [3, 0, 0]);
});

test("projectile wall splash rewinds moving targets to match delayed remote rendering", () => {
  const fire = {
    weapon: "rocketlauncher",
    fireKind: "projectile",
    origin: [0, 0, 0],
    direction: [1, 0, 0],
    range: 64,
  };
  const movingTarget = playerFixture({
    playerId: "moving",
    clientId: "moving-client",
    origin: [3, 5, 0],
    velocity: [0, 30, 0],
  });
  const collisionWorld = {
    traceUse: (origin, point) => origin[0] === 0 && point[0] > 10
      ? {
          fraction: 3 / 64,
          end: [3, 0, 0],
          planeNormal: [-1, 0, 0],
          entityIndex: 44,
          modelIndex: 3,
          classname: "func_wall",
        }
      : null,
  };

  assert.equal(
    deathmatch.quakeMultiplayerDeathmatchProjectileWorldSplashHits(
      fire,
      [movingTarget],
      "attacker",
      collisionWorld,
    ).length,
    0,
  );

  const hits = deathmatch.quakeMultiplayerDeathmatchProjectileWorldSplashHits(
    fire,
    [movingTarget],
    "attacker",
    collisionWorld,
    { targetRewindMs: 100 },
  );

  assert.equal(hits.length, 1);
  assert.equal(hits[0].target.playerId, "moving");
  assert.equal(hits[0].damage, 69);
});

test("projectile splash keeps Quake radius damage above zero near the radius edge", () => {
  const fire = {
    weapon: "rocketlauncher",
    fireKind: "projectile",
    origin: [0, 0, 0],
    direction: [1, 0, 0],
    range: 64,
  };
  const edgeTarget = playerFixture({
    playerId: "edge",
    clientId: "edge-client",
    origin: [3.2, 0, 0.36],
  });
  const directHit = {
    target: playerFixture({ playerId: "direct", clientId: "direct-client", origin: [0, 0, 0] }),
    damage: 120,
    distance: 0,
    impact: [0, 0, 0],
    lateralMiss: 0,
  };

  const hits = deathmatch.quakeMultiplayerDeathmatchSplashHits(
    fire,
    directHit,
    [edgeTarget],
    "attacker",
  );

  assert.equal(hits[0].target.playerId, "direct");
  assert.equal(hits[1].target.playerId, "edge");
  assert.equal(hits[1].damage, 40);
});

test("projectile splash rejects indirect targets without radius line of sight", () => {
  const fire = {
    weapon: "rocketlauncher",
    fireKind: "projectile",
    origin: [0, 0, 0],
    direction: [1, 0, 0],
    range: 64,
  };
  const directTarget = playerFixture({ playerId: "direct", clientId: "direct-client", origin: [2, 0, 0] });
  const blockedTarget = playerFixture({ playerId: "blocked", clientId: "blocked-client", origin: [2, 3, 0] });
  const directHit = {
    target: directTarget,
    damage: 120,
    distance: 2,
    impact: [2, 0, 0],
    lateralMiss: 0,
  };
  const collisionWorld = {
    traceUse: (_origin, point) => point[1] > 1
      ? {
          fraction: 0.4,
          end: [point[0], 1, point[2]],
          planeNormal: [0, -1, 0],
          entityIndex: 41,
          modelIndex: 3,
          classname: "func_wall",
        }
      : null,
  };

  const hits = deathmatch.quakeMultiplayerDeathmatchSplashHits(
    fire,
    directHit,
    [directTarget, blockedTarget],
    "attacker",
    collisionWorld,
  );

  assert.equal(hits.some((hit) => hit.target.playerId === "blocked"), false);
});
