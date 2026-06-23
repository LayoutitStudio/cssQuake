import assert from "node:assert/strict";
import test from "node:test";

import {
  createPlayer,
  fireEnvelope,
  projectileAuthority,
  DUEL_FORWARD_DIRECTION,
  latestConnectionMessage,
  roomEvents,
  latestSnapshotPlayerForClient,
  connectDuelRoom,
  connectTripleRoom,
  cleanupDuelRoom,
  cleanupPartyRoomConnections,
  setPartyRoomPlayerWeapon,
  setPartyRoomPlayerQuad,
  setPartyRoomPlayerInvulnerable,
} from "./partyRoomHarness.mjs";

test("party room blocks indirect projectile splash through walls", () => {
  const collisionWorld = {
    traceUse: (_origin, point) => point[1] > 1
      ? {
          fraction: 0.4,
          end: [point[0], 1, point[2]],
          planeNormal: [0, -1, 0],
          entityIndex: 45,
          modelIndex: 3,
          classname: "func_wall",
        }
      : null,
  };
  const { alice, bob, cara, partyRoom } = connectTripleRoom({
    id: "projectile-splash-wall",
    roomOptions: {
      trustedSceneMovement: {
        collisionWorld,
        playerEyeHeight: 1.0,
      },
    },
    spawns: [
      { spawnId: "spawn-a", classname: "info_player_deathmatch", origin: [0, 0, 0], rotX: -78, rotY: 0 },
      { spawnId: "spawn-b", classname: "info_player_deathmatch", origin: [3, 0, 0], rotX: -78, rotY: 180 },
      { spawnId: "spawn-c", classname: "info_player_deathmatch", origin: [3, 2, 0], rotX: -78, rotY: 180 },
    ],
  });
  try {
    setPartyRoomPlayerWeapon(partyRoom, "client-a", "rocketlauncher");
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-splash-wall",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
    })), alice);
    partyRoom.advanceRoomSimulation(Date.now() + 400);

    const damagedEvents = roomEvents(alice, "player.damaged");
    const killedEvents = roomEvents(alice, "player.killed");
    assert.ok(killedEvents.some((event) => event.victimPlayerId === "party:client-b"));
    assert.equal(damagedEvents.some((event) => event.victimPlayerId === "party:client-c"), false);
    assert.equal(killedEvents.some((event) => event.victimPlayerId === "party:client-c"), false);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-c").health, 100);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-c").alive, true);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupPartyRoomConnections(partyRoom, alice, bob, cara);
  }
});

test("party room applies projectile wall-impact splash without a direct player hit", () => {
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
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "projectile-wall-splash",
    roomOptions: {
      trustedSceneMovement: {
        collisionWorld,
        playerEyeHeight: 1.0,
      },
    },
  });
  try {
    setPartyRoomPlayerWeapon(partyRoom, "client-a", "rocketlauncher");
    const bobPlayer = partyRoom.players.get("party:client-b");
    assert.ok(bobPlayer, "expected bob player");
    partyRoom.players.set("party:client-b", {
      ...bobPlayer,
      origin: [3, 2, 0],
      updatedAt: Date.now(),
    });

    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-wall-splash",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
      fire: {
        direction: [1, 0, 0],
      },
    })), alice);
    partyRoom.advanceRoomSimulation(Date.now() + 2_000);

    const damagedEvents = roomEvents(alice, "player.damaged");
    const bobDamage = damagedEvents.find((event) => event.victimPlayerId === "party:client-b");
    const aliceDamage = damagedEvents.find((event) => event.victimPlayerId === "party:client-a");
    assert.ok(bobDamage, "expected wall splash to damage nearby non-direct target");
    assert.equal(bobDamage.damage, 69);
    assert.equal(bobDamage.health, 31);
    assert.ok(aliceDamage, "expected wall splash to apply half self damage");
    assert.equal(aliceDamage.damage, 22);
    assert.equal(aliceDamage.health, 78);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-b").health, 31);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-a").health, 78);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room applies projectile quad damage from impact-time attacker state", () => {
  const originalNow = Date.now;
  let now = 3_000_000;
  Date.now = () => now;
  const cases = [
    {
      id: "quad-expired-before-impact",
      setup: (partyRoom) => setPartyRoomPlayerQuad(partyRoom, "client-a", now + 50),
      expectedDamage: 9,
      expectedHealth: 91,
    },
    {
      id: "quad-picked-up-before-impact",
      setup: () => {},
      beforeImpact: (partyRoom) => setPartyRoomPlayerQuad(partyRoom, "client-a", now + 10_000),
      expectedDamage: 36,
      expectedHealth: 64,
    },
  ];

  try {
    for (const spec of cases) {
      const { alice, bob, partyRoom } = connectDuelRoom({
        id: spec.id,
        spawnDistance: 4,
      });
      try {
        setPartyRoomPlayerWeapon(partyRoom, "client-a", "nailgun");
        spec.setup(partyRoom);
        partyRoom.onMessage(JSON.stringify(fireEnvelope({
          clientId: "client-a",
          messageId: `fire-${spec.id}`,
          sequence: 2,
          fireSequence: 1,
          sentAt: now,
        })), alice);

        assert.equal(
          roomEvents(alice, "player.damaged")
            .some((candidate) => candidate.damageSource === "nailgun"),
          false,
          "nail projectile should not damage on the fire tick",
        );
        spec.beforeImpact?.(partyRoom);
        now += 400;
        partyRoom.advanceRoomSimulation(now);

        const event = roomEvents(alice, "player.damaged")
          .find((candidate) =>
            candidate.attackerPlayerId === "party:client-a" &&
            candidate.victimPlayerId === "party:client-b" &&
            candidate.damageSource === "nailgun"
          );
        assert.ok(event, `expected nailgun damage for ${spec.id}`);
        assert.equal(event.damage, spec.expectedDamage, spec.id);
        assert.equal(event.health, spec.expectedHealth, spec.id);
        assert.equal(event.roomTime, 400, spec.id);
        const impact = roomEvents(alice, "projectile.impacted")
          .find((candidate) => candidate.weapon === "nailgun");
        assert.equal(impact?.roomTime, 400, spec.id);
        assert.equal(latestSnapshotPlayerForClient(alice, "client-b").health, spec.expectedHealth);
        assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
        assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
      } finally {
        cleanupDuelRoom(partyRoom, alice, bob);
      }
      now += 1_000;
    }
  } finally {
    Date.now = originalNow;
  }
});

test("party room applies delayed projectile victim powerups at simulation impact time", () => {
  const originalNow = Date.now;
  const fireNow = 3_100_000;
  Date.now = () => fireNow;
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "projectile-victim-powerup-impact-time",
    spawnDistance: 4,
  });
  try {
    setPartyRoomPlayerWeapon(partyRoom, "client-a", "nailgun");
    setPartyRoomPlayerInvulnerable(partyRoom, "client-b", fireNow + 50);
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-projectile-victim-powerup-impact-time",
      sequence: 2,
      fireSequence: 1,
      sentAt: fireNow,
      fire: {
        weapon: "nailgun",
        fireKind: "projectile",
      },
    })), alice);

    partyRoom.advanceRoomSimulation(fireNow + 400);

    const event = roomEvents(alice, "player.damaged")
      .find((candidate) =>
        candidate.attackerPlayerId === "party:client-a" &&
        candidate.victimPlayerId === "party:client-b" &&
        candidate.damageSource === "nailgun"
      );
    assert.ok(event, "expected expired victim invulnerability not to block delayed projectile damage");
    assert.equal(event.damage, 9);
    assert.equal(event.health, 91);
    assert.equal(event.roomTime, 400);
    const impact = roomEvents(alice, "projectile.impacted")
      .find((candidate) => candidate.weapon === "nailgun");
    assert.equal(impact?.roomTime, 400);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-b").health, 91);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
    Date.now = originalNow;
  }
});

test("server grenade projectile advances through delayed arc impact damage", () => {
  const projectile = projectileAuthority.createQuakeMultiplayerServerProjectile({
    fire: {
      fireSequence: 1,
      firedAt: 100,
      fireKind: "projectile",
      weapon: "grenadelauncher",
      origin: [0, 0, 0],
      direction: DUEL_FORWARD_DIRECTION,
      range: 1024,
    },
    now: 100,
    ownerPlayerId: "party:client-a",
    projectileId: "grenade-arc-1",
  });
  assert.ok(projectile, "expected grenade launcher to create a server projectile");
  assert.equal(projectile.weapon, "grenadelauncher");
  assert.equal(projectileAuthority.quakeMultiplayerServerProjectileWeaponSupported("grenadelauncher"), true);
  assert.ok(projectile.gravity > 0, "expected grenade projectile to carry gravity");
  assert.ok(projectile.velocity[2] > projectile.direction[2] * projectile.speed, "expected grenade launch kick");

  const target = createPlayer({
    playerId: "party:client-b",
    clientId: "client-b",
    displayName: "Bob",
    origin: [4, 0, 0],
    rotX: -78,
    rotY: 180,
    updatedAt: 100,
  });
  const immediate = projectileAuthority.advanceQuakeMultiplayerServerProjectile(projectile, {
    collisionWorld: null,
    now: 100,
    players: [target],
  });
  assert.equal(immediate.type, "active", "grenade should not damage on the fire tick");

  const delayed = projectileAuthority.advanceQuakeMultiplayerServerProjectile(projectile, {
    collisionWorld: null,
    now: 500,
    players: [target],
  });
  assert.equal(delayed.type, "impact");
  assert.equal(delayed.impact.kind, "player");
  assert.equal(delayed.impact.targetPlayerId, "party:client-b");
  const hit = delayed.impact.damageHits.find((candidate) => candidate.target.playerId === "party:client-b");
  assert.ok(hit, "expected delayed grenade impact to damage target");
  assert.equal(hit.damage, 87);
  assert.equal(hit.direct, false);
});

test("server grenade projectile bounces on world impact and explodes on fuse expiry", () => {
  const projectile = projectileAuthority.createQuakeMultiplayerServerProjectile({
    fire: {
      fireSequence: 1,
      firedAt: 100,
      fireKind: "projectile",
      weapon: "grenadelauncher",
      origin: [0, 0, 1],
      direction: [1, 0, 0],
      range: 1024,
    },
    now: 100,
    ownerPlayerId: "party:client-a",
    projectileId: "grenade-bounce-1",
  });
  assert.ok(projectile, "expected grenade launcher to create a server projectile");
  const fallingProjectile = {
    ...projectile,
    direction: [0.24253562503633297, 0, -0.9701425001453319],
    gravity: 0,
    speed: Math.hypot(2, 0, -8),
    velocity: [2, 0, -8],
  };
  const collisionWorld = {
    traceUse: (origin, end) => {
      if (origin[2] <= 0 || end[2] > 0) return null;
      const fraction = origin[2] / (origin[2] - end[2]);
      return {
        fraction,
        end: [
          origin[0] + (end[0] - origin[0]) * fraction,
          origin[1] + (end[1] - origin[1]) * fraction,
          0,
        ],
        planeNormal: [0, 0, 1],
        entityIndex: 44,
        modelIndex: 3,
        classname: "func_floor",
      };
    },
  };

  const bounced = projectileAuthority.advanceQuakeMultiplayerServerProjectile(fallingProjectile, {
    collisionWorld,
    now: 300,
    players: [],
  });
  assert.equal(bounced.type, "active");
  assert.ok(bounced.projectile.origin[2] > 0, "expected bounced grenade to be offset off the impact plane");
  assert.ok(bounced.projectile.velocity[2] > 0, "expected bounced grenade to reflect upward");

  const target = createPlayer({
    playerId: "party:client-b",
    clientId: "client-b",
    displayName: "Bob",
    origin: [bounced.projectile.origin[0], bounced.projectile.origin[1], 0],
    updatedAt: 300,
  });
  const expired = projectileAuthority.advanceQuakeMultiplayerServerProjectile(bounced.projectile, {
    collisionWorld: null,
    now: bounced.projectile.expiresAt + 1,
    players: [target],
  });
  assert.equal(expired.type, "impact");
  assert.equal(expired.impact.kind, "world");
  const hit = expired.impact.damageHits.find((candidate) => candidate.target.playerId === "party:client-b");
  assert.ok(hit, "expected grenade fuse explosion to apply splash damage");
  assert.equal(hit.direct, false);
  assert.ok(hit.damage > 0);
});

test("party room snapshots active server projectile positions", () => {
  const originalNow = Date.now;
  let now = 2_500_000;
  Date.now = () => now;
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "projectile-snapshot-position",
    spawnDistance: 20,
  });
  try {
    setPartyRoomPlayerWeapon(partyRoom, "client-a", "rocketlauncher");
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-projectile-snapshot-position",
      sequence: 2,
      fireSequence: 1,
      sentAt: now,
      fire: {
        weapon: "rocketlauncher",
      },
    })), alice);

    const spawned = roomEvents(alice, "projectile.spawned")
      .find((candidate) => candidate.projectile.weapon === "rocketlauncher");
    assert.ok(spawned, "expected projectile.spawned event");
    const initialSnapshot = latestConnectionMessage(alice, "room.snapshot");
    const initialProjectile = initialSnapshot.payload.projectiles
      ?.find((candidate) => candidate.projectileId === spawned.projectile.projectileId);
    assert.ok(initialProjectile, "expected initial snapshot to carry active projectile");
    assert.deepEqual(initialProjectile.origin, spawned.projectile.origin);

    now += 100;
    partyRoom.advanceRoomSimulation(now);
    partyRoom.broadcastSnapshot();
    const movedSnapshot = latestConnectionMessage(alice, "room.snapshot");
    const movedProjectile = movedSnapshot.payload.projectiles
      ?.find((candidate) => candidate.projectileId === spawned.projectile.projectileId);
    assert.ok(movedProjectile, "expected later snapshot to keep active projectile");
    assert.equal(movedProjectile.updatedAt, now);
    assert.ok(
      movedProjectile.origin[0] > initialProjectile.origin[0],
      "expected active projectile snapshot origin to advance",
    );
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    Date.now = originalNow;
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});
