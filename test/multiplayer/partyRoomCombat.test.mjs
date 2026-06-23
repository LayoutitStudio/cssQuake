import assert from "node:assert/strict";
import test from "node:test";

import {
  fireEnvelope,
  helloEnvelope,
  partyRoomModule,
  pickupEnvelope,
  projectileAuthority,
  facts,
  items,
  DUEL_FORWARD_DIRECTION,
  QUAD_ITEM_FLAG,
  INVULNERABILITY_ITEM_FLAG,
  createFakePartyRoom,
  latestConnectionMessage,
  roomEvents,
  latestSnapshotPlayerForClient,
  weaponPickupDefinition,
  connectDuelRoom,
  connectTripleRoom,
  cleanupDuelRoom,
  cleanupPartyRoomConnections,
  setPartyRoomPlayerWeapon,
  setPartyRoomPlayerQuad,
  setPartyRoomPlayerInvulnerable,
  pickupWeapon,
} from "./partyRoomHarness.mjs";

test("party room applies authoritative fire damage in both player directions", () => {
  const deathmatchSpawns = [
    {
      spawnId: "spawn-a",
      classname: "info_player_deathmatch",
      origin: [0, 0, 0],
      rotX: -78,
      rotY: 0,
    },
    {
      spawnId: "spawn-b",
      classname: "info_player_deathmatch",
      origin: [4, 0, 0],
      rotX: -78,
      rotY: 180,
    },
  ];
  const gameplayDefinitions = facts.createQuakeMultiplayerGameplayDefinitions({
    deathmatchSpawns,
    pickupDefinitions: [],
  });
  const { room, createConnection } = createFakePartyRoom("fire-damage-room");
  const RoomClass = partyRoomModule.default;
  const partyRoom = new RoomClass(room, {
    random: () => 0.999999,
    trustedGameplayDefinitions: gameplayDefinitions,
  });
  const alice = createConnection("alice");
  const bob = createConnection("bob");
  partyRoom.onConnect(alice);
  partyRoom.onConnect(bob);

  partyRoom.onMessage(JSON.stringify(helloEnvelope({
    clientId: "client-a",
    displayName: "Alice",
    messageId: "hello-a",
    sequence: 1,
    sentAt: Date.now(),
  })), alice);
  partyRoom.onMessage(JSON.stringify(helloEnvelope({
    clientId: "client-b",
    displayName: "Bob",
    messageId: "hello-b",
    sequence: 1,
    sentAt: Date.now(),
  })), bob);

  partyRoom.onMessage(JSON.stringify(fireEnvelope({
    clientId: "client-a",
    messageId: "fire-a",
    sequence: 2,
    fireSequence: 1,
    sentAt: Date.now(),
  })), alice);
  const damageAtoB = roomEvents(alice, "player.damaged")
    .find((event) => event.attackerPlayerId === "party:client-a" && event.victimPlayerId === "party:client-b");
  assert.ok(damageAtoB, "expected client-a to damage client-b");
  assert.equal(damageAtoB.damage, 24);
  assert.equal(damageAtoB.health, 76);
  assert.equal(damageAtoB.damageSource, "shotgun");
  const firedAtoB = roomEvents(alice, "player.fired").find((event) => event.eventId === "fire-fire-a");
  assert.equal(firedAtoB?.decision?.outcome, "hit-player");
  assert.equal(firedAtoB?.decision?.reason, "player-direct");
  assert.equal(firedAtoB?.decision?.targetPlayerId, "party:client-b");
  assert.equal(firedAtoB?.decision?.candidateCount, 1);
  assert.equal(firedAtoB?.decision?.blockedCandidateCount, 0);
  assert.equal(firedAtoB?.decision?.playerDamageCount, 1);

  partyRoom.onMessage(JSON.stringify(fireEnvelope({
    clientId: "client-b",
    messageId: "fire-b",
    sequence: 2,
    fireSequence: 1,
    sentAt: Date.now(),
  })), bob);
  const damageBtoA = roomEvents(alice, "player.damaged")
    .find((event) => event.attackerPlayerId === "party:client-b" && event.victimPlayerId === "party:client-a");
  assert.ok(damageBtoA, "expected client-b to damage client-a");
  assert.equal(damageBtoA.damage, 24);
  assert.equal(damageBtoA.health, 76);
  assert.equal(damageBtoA.damageSource, "shotgun");
  const firedBtoA = roomEvents(alice, "player.fired").find((event) => event.eventId === "fire-fire-b");
  assert.equal(firedBtoA?.decision?.outcome, "hit-player");
  assert.equal(firedBtoA?.decision?.reason, "player-direct");
  assert.equal(firedBtoA?.decision?.targetPlayerId, "party:client-a");
  assert.equal(firedBtoA?.decision?.candidateCount, 1);
  assert.equal(firedBtoA?.decision?.blockedCandidateCount, 0);
  assert.equal(firedBtoA?.decision?.playerDamageCount, 1);
  assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
  assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
});

test("party room applies source-order armor save but suppresses health damage while the victim is invulnerable", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({ id: "invulnerable-victim" });
  try {
    const bobPlayer = partyRoom.players.get("party:client-b");
    assert.ok(bobPlayer, "expected bob player");
    const inventory = items.quakeMultiplayerPlayerInventory(bobPlayer);
    inventory.health = 100;
    inventory.armor = 50;
    inventory.armorType = 0.8;
    inventory.powerups = [{
      active: true,
      activationField: "invincible_time",
      finishedAt: Date.now() + 10_000,
      finishedField: "invincible_finished",
      itemFlag: INVULNERABILITY_ITEM_FLAG,
    }];
    partyRoom.players.set("party:client-b", items.quakeMultiplayerPlayerWithInventory(bobPlayer, inventory));

    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-invulnerable-victim",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
    })), alice);

    assert.equal(
      roomEvents(alice, "player.damaged").some((event) => event.victimPlayerId === "party:client-b"),
      false,
    );
    assert.equal(
      roomEvents(alice, "player.killed").some((event) => event.victimPlayerId === "party:client-b"),
      false,
    );
    const victim = latestSnapshotPlayerForClient(alice, "client-b");
    assert.equal(victim.health, 100);
    assert.equal(victim.armor, 30);
    assert.equal(victim.alive, true);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room double-invulnerable telefrag clears protection and kills both players like Quake teledeath3", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({ id: "double-invulnerable-telefrag" });
  try {
    const now = Date.now();
    const victim = partyRoom.players.get("party:client-b");
    assert.ok(victim, "expected victim");
    setPartyRoomPlayerInvulnerable(partyRoom, "client-a", now + 10_000);
    setPartyRoomPlayerInvulnerable(partyRoom, "client-b", now + 10_000);

    partyRoom.applyTeleportDeath("party:client-a", victim.origin, "double-invulnerable-telefrag");

    const kills = roomEvents(alice, "player.killed")
      .filter((event) => event.damageSource === "teledeath3");
    assert.equal(kills.length, 2);
    assert.equal(kills.some((event) => event.victimPlayerId === "party:client-a"), true);
    assert.equal(kills.some((event) => event.victimPlayerId === "party:client-b"), true);

    const aliceSnapshot = latestSnapshotPlayerForClient(alice, "client-a");
    const bobSnapshot = latestSnapshotPlayerForClient(alice, "client-b");
    assert.equal(aliceSnapshot.alive, false);
    assert.equal(bobSnapshot.alive, false);
    assert.equal(aliceSnapshot.frags, -1);
    assert.equal(bobSnapshot.frags, -1);
    assert.equal(aliceSnapshot.deaths, 1);
    assert.equal(bobSnapshot.deaths, 1);
    assert.equal(
      aliceSnapshot.inventory.powerups.some((powerup) => powerup.finishedField === "invincible_finished"),
      false,
    );
    assert.equal(
      bobSnapshot.inventory.powerups.some((powerup) => powerup.finishedField === "invincible_finished"),
      false,
    );
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room subtracts a victim frag for world/environment kills", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({ id: "world-kill-frag-penalty" });
  try {
    partyRoom.applyPlayerDamage({
      victimPlayerId: "party:client-b",
      damage: 150,
      source: "trigger_hurt",
      eventId: "world-kill-frag-penalty",
      now: Date.now(),
    });

    const kill = roomEvents(alice, "player.killed")
      .find((event) => event.victimPlayerId === "party:client-b");
    assert.ok(kill, "expected environment kill event");
    assert.equal(kill.attackerPlayerId, undefined);
    assert.equal(kill.damageSource, "trigger_hurt");
    const victim = latestSnapshotPlayerForClient(alice, "client-b");
    assert.equal(victim.alive, false);
    assert.equal(victim.frags, -1);
    assert.equal(victim.deaths, 1);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room clears active artifact powerups immediately on player death", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "death-clears-powerups",
    matchSettings: { fragLimit: 99 },
  });
  try {
    const now = Date.now();
    setPartyRoomPlayerQuad(partyRoom, "client-b", now + 10_000);
    const bobPlayer = partyRoom.players.get("party:client-b");
    assert.ok(bobPlayer, "expected bob player");
    const inventory = items.quakeMultiplayerPlayerInventory(bobPlayer);
    inventory.health = 10;
    partyRoom.players.set("party:client-b", items.quakeMultiplayerPlayerWithInventory(bobPlayer, inventory));

    partyRoom.applyPlayerDamage({
      attackerPlayerId: "party:client-a",
      victimPlayerId: "party:client-b",
      damage: 24,
      source: "shotgun",
      eventId: "death-clears-powerups",
      now,
    });

    const victim = latestSnapshotPlayerForClient(alice, "client-b");
    assert.equal(victim.alive, false);
    assert.equal(victim.inventory.itemFlags & QUAD_ITEM_FLAG, 0);
    assert.equal(
      victim.inventory.powerups.some((powerup) => powerup.finishedField === "super_damage_finished"),
      false,
    );
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room respawns at a clear deathmatch spawn instead of the occupied cursor spawn", () => {
  const deathmatchSpawns = [
    { spawnId: "spawn-a", classname: "info_player_deathmatch", origin: [0, 0, 0], rotX: -78, rotY: 0 },
    { spawnId: "spawn-b", classname: "info_player_deathmatch", origin: [8, 0, 0], rotX: -78, rotY: 180 },
    { spawnId: "spawn-c-occupied", classname: "info_player_deathmatch", origin: [0.5, 0, 0], rotX: -78, rotY: 90 },
    { spawnId: "spawn-d-clear", classname: "info_player_deathmatch", origin: [16, 0, 0], rotX: -78, rotY: 270 },
  ];
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "respawn-clear-spawn",
    deathmatchSpawns,
    matchSettings: { fragLimit: 99 },
  });
  try {
    partyRoom.applyPlayerDamage({
      attackerPlayerId: "party:client-a",
      victimPlayerId: "party:client-b",
      damage: 150,
      source: "shotgun",
      eventId: "respawn-clear-spawn-kill",
      now: Date.now(),
    });
    partyRoom.respawnPlayer("party:client-b");

    const respawn = roomEvents(alice, "player.respawned")
      .find((event) => event.player?.playerId === "party:client-b");
    assert.ok(respawn, "expected respawn event");
    assert.equal(respawn.player.spawnId, "spawn-d-clear");
    assert.deepEqual(respawn.player.origin, [16, 0, 0]);
    const bobSnapshot = latestSnapshotPlayerForClient(alice, "client-b");
    assert.equal(bobSnapshot.spawnId, "spawn-d-clear");
    assert.deepEqual(bobSnapshot.origin, [16, 0, 0]);
    assert.equal(bobSnapshot.alive, true);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room applies authoritative weapon damage after weapon pickups", () => {
  const cases = [
    { weapon: "axe", damage: 20, pickup: false, spawnDistance: 1.2, eventType: "player.damaged", health: 80 },
    { weapon: "shotgun", damage: 24, pickup: false, spawnDistance: 4, eventType: "player.damaged", health: 76 },
    { weapon: "supershotgun", damage: 56, pickup: true, spawnDistance: 4, eventType: "player.damaged", health: 44 },
    { weapon: "nailgun", damage: 9, pickup: true, spawnDistance: 4, eventType: "player.damaged", health: 91 },
    { weapon: "supernailgun", damage: 18, pickup: true, spawnDistance: 4, eventType: "player.damaged", health: 82 },
    { weapon: "lightning", damage: 30, pickup: true, spawnDistance: 4, eventType: "player.damaged", health: 70 },
    { weapon: "grenadelauncher", damage: 87, pickup: true, spawnDistance: 4, eventType: "player.damaged", health: 13 },
    { weapon: "rocketlauncher", pickup: true, spawnDistance: 4, eventType: "player.killed", health: -5 },
  ];

  for (const spec of cases) {
    const pickupDefinitions = spec.pickup ? [weaponPickupDefinition(spec.weapon)] : [];
    const { alice, bob, partyRoom } = connectDuelRoom({
      id: `weapon-${spec.weapon}`,
      pickupDefinitions,
      spawnDistance: spec.spawnDistance,
    });
    try {
      if (spec.pickup) {
        pickupWeapon(partyRoom, alice, {
          clientId: "client-a",
          sequence: 2,
          weapon: spec.weapon,
        });
        const player = latestSnapshotPlayerForClient(alice, "client-a");
        assert.equal(player.inventory.activeWeapon, spec.weapon, `${spec.weapon} should become active after pickup`);
        assert.ok(player.inventory.weapons.includes(spec.weapon), `${spec.weapon} should be in authoritative inventory`);
      } else {
        setPartyRoomPlayerWeapon(partyRoom, "client-a", spec.weapon);
      }

      partyRoom.onMessage(JSON.stringify(fireEnvelope({
        clientId: "client-a",
        messageId: `fire-${spec.weapon}`,
        sequence: 3,
        fireSequence: 1,
        sentAt: Date.now(),
        fire: { weapon: spec.weapon },
      })), alice);

      const serverProjectile = projectileAuthority.quakeMultiplayerServerProjectileWeaponSupported(spec.weapon);
      if (serverProjectile) {
        const fired = roomEvents(alice, "player.fired")
          .find((candidate) => candidate.eventId === `fire-fire-${spec.weapon}`);
        assert.equal(fired?.decision?.outcome, "projectile-spawned", `${spec.weapon} should spawn a server projectile`);
        const spawned = roomEvents(alice, "projectile.spawned")
          .find((candidate) => candidate.projectile.weapon === spec.weapon);
        assert.ok(spawned, `expected projectile.spawned for ${spec.weapon}`);
        assert.equal(
          roomEvents(alice, spec.eventType)
            .some((candidate) =>
              candidate.attackerPlayerId === "party:client-a" &&
              candidate.victimPlayerId === "party:client-b" &&
              candidate.damageSource === spec.weapon
            ),
          false,
          `${spec.weapon} should not apply damage in the same tick as fire`,
        );
        partyRoom.advanceRoomSimulation(Date.now() + 400);
        const impact = roomEvents(alice, "projectile.impacted")
          .find((candidate) => candidate.weapon === spec.weapon);
        assert.ok(impact, `expected projectile.impacted for ${spec.weapon}`);
        assert.equal(impact.impactKind, "player", `${spec.weapon} should impact the player`);
        assert.equal(impact.targetPlayerId, "party:client-b", `${spec.weapon} impact target`);
      }

      const event = roomEvents(alice, spec.eventType)
        .find((candidate) =>
          candidate.attackerPlayerId === "party:client-a" &&
          candidate.victimPlayerId === "party:client-b" &&
          candidate.damageSource === spec.weapon
        );
      assert.ok(event, `expected ${spec.eventType} for ${spec.weapon}`);
      if (spec.eventType === "player.damaged") {
        assert.equal(event.damage, spec.damage, `${spec.weapon} damage`);
        assert.equal(event.health, spec.health, `${spec.weapon} victim health`);
      }
      if (spec.eventType === "player.killed") {
        const victim = latestSnapshotPlayerForClient(alice, "client-b");
        assert.equal(victim.alive, false, `${spec.weapon} should kill the victim`);
        assert.equal(victim.health, spec.health, `${spec.weapon} death health`);
      }
      assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0, `${spec.weapon} alice rejects`);
      assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0, `${spec.weapon} bob rejects`);
    } finally {
      cleanupDuelRoom(partyRoom, alice, bob);
    }
  }
});

test("party room weapon pickup keeps a better current weapon by Quake deathmatch rank", () => {
  const nailgunPickup = weaponPickupDefinition("nailgun");
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "weapon-pickup-rank-switch",
    pickupDefinitions: [nailgunPickup],
  });
  try {
    const player = partyRoom.players.get("party:client-a");
    assert.ok(player, "expected player");
    const inventory = items.quakeMultiplayerPlayerInventory(player);
    inventory.activeWeapon = "rocketlauncher";
    inventory.weapons = ["axe", "shotgun", "rocketlauncher"];
    inventory.rockets = 5;
    inventory.nails = 0;
    partyRoom.players.set("party:client-a", items.quakeMultiplayerPlayerWithInventory(player, inventory));

    partyRoom.onMessage(JSON.stringify(pickupEnvelope({
      clientId: "client-a",
      messageId: "pickup-nailgun-rank-switch",
      sequence: 2,
      pickupSequence: 1,
      sentAt: Date.now(),
      pickup: {
        entityIndex: nailgunPickup.entityIndex,
        origin: [0, 0, 0],
      },
    })), alice);

    const pickup = roomEvents(alice, "pickup.taken")
      .find((event) => event.entityIndex === nailgunPickup.entityIndex);
    assert.ok(pickup, "expected nailgun pickup");
    const snapshot = latestSnapshotPlayerForClient(alice, "client-a");
    assert.equal(snapshot.inventory.weapons.includes("nailgun"), true);
    assert.equal(snapshot.inventory.nails, 25);
    assert.equal(snapshot.inventory.activeWeapon, "rocketlauncher");
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room accepts already-owned respawning weapon pickup at full ammo like Quake deathmatch", () => {
  const nailgunPickup = {
    ...weaponPickupDefinition("nailgun"),
    lifecycle: { action: "respawn", condition: "deathmatch", delayMs: 30_000 },
  };
  const originalNow = Date.now;
  let now = 4_500_000;
  Date.now = () => now;
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "weapon-pickup-full-ammo-respawn",
    pickupDefinitions: [nailgunPickup],
  });
  try {
    const player = partyRoom.players.get("party:client-a");
    assert.ok(player, "expected player");
    const inventory = items.quakeMultiplayerPlayerInventory(player);
    inventory.activeWeapon = "rocketlauncher";
    inventory.weapons = ["axe", "shotgun", "nailgun", "rocketlauncher"];
    inventory.nails = 200;
    inventory.rockets = 5;
    partyRoom.players.set("party:client-a", items.quakeMultiplayerPlayerWithInventory(player, inventory));

    partyRoom.onMessage(JSON.stringify(pickupEnvelope({
      clientId: "client-a",
      messageId: "pickup-owned-full-nailgun",
      sequence: 2,
      pickupSequence: 1,
      sentAt: now,
      pickup: {
        entityIndex: nailgunPickup.entityIndex,
        origin: [0, 0, 0],
      },
    })), alice);

    const pickup = roomEvents(alice, "pickup.taken")
      .find((event) => event.entityIndex === nailgunPickup.entityIndex);
    assert.ok(pickup, "expected already-owned full-ammo weapon pickup to be taken");
    assert.equal(pickup.leaveInPlace, false);
    const snapshot = latestConnectionMessage(alice, "room.snapshot");
    const pickupState = snapshot.payload.pickups.find((candidate) =>
      candidate.entityIndex === nailgunPickup.entityIndex
    );
    assert.equal(pickupState?.available, false);
    assert.equal(pickupState?.respawnAt, now + 30_000);
    const playerSnapshot = latestSnapshotPlayerForClient(alice, "client-a");
    assert.equal(playerSnapshot.inventory.nails, 200);
    assert.equal(playerSnapshot.inventory.activeWeapon, "rocketlauncher");
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
    Date.now = originalNow;
  }
});

test("party room ammo pickup selects a newly usable best weapon when the active weapon was best", () => {
  const nailsPickup = {
    pickupId: "item-spikes-auto-best",
    entityIndex: 4010,
    classname: "item_spikes",
    origin: [0, 0, 0],
    effect: { nails: 25 },
  };
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "ammo-pickup-auto-best-weapon",
    pickupDefinitions: [nailsPickup],
  });
  try {
    const attacker = partyRoom.players.get("party:client-a");
    assert.ok(attacker, "expected attacker");
    const inventory = items.quakeMultiplayerPlayerInventory(attacker);
    inventory.activeWeapon = "shotgun";
    inventory.weapons = ["axe", "shotgun", "supernailgun"];
    inventory.shells = 25;
    inventory.nails = 0;
    partyRoom.players.set("party:client-a", items.quakeMultiplayerPlayerWithInventory(attacker, inventory));

    partyRoom.onMessage(JSON.stringify(pickupEnvelope({
      clientId: "client-a",
      messageId: "pickup-nails-auto-best",
      sequence: 2,
      pickupSequence: 1,
      sentAt: Date.now(),
      pickup: {
        entityIndex: nailsPickup.entityIndex,
        origin: [0, 0, 0],
      },
    })), alice);

    const pickup = roomEvents(alice, "pickup.taken")
      .find((event) => event.entityIndex === nailsPickup.entityIndex);
    assert.ok(pickup, "expected nails pickup");
    const player = latestSnapshotPlayerForClient(alice, "client-a");
    assert.equal(player.inventory.nails, 25);
    assert.equal(player.inventory.activeWeapon, "supernailgun");
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room auto-selects the source best weapon when the active weapon has no ammo before fire", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "auto-best-weapon-before-fire",
    spawnDistance: 4,
  });
  try {
    const attacker = partyRoom.players.get("party:client-a");
    assert.ok(attacker, "expected attacker");
    const inventory = items.quakeMultiplayerPlayerInventory(attacker);
    inventory.activeWeapon = "nailgun";
    inventory.weapons = ["axe", "shotgun", "nailgun"];
    inventory.shells = 25;
    inventory.nails = 0;
    partyRoom.players.set("party:client-a", items.quakeMultiplayerPlayerWithInventory(attacker, inventory));

    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-auto-best-before",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
      fire: { weapon: "nailgun" },
    })), alice);

    const fired = roomEvents(alice, "player.fired")
      .find((event) => event.eventId === "fire-fire-auto-best-before");
    assert.equal(fired?.weapon, "shotgun");
    assert.equal(fired?.decision?.outcome, "hit-player");
    const damage = roomEvents(alice, "player.damaged")
      .find((event) => event.victimPlayerId === "party:client-b");
    assert.ok(damage, "expected auto-selected shotgun to damage Bob");
    assert.equal(damage.damage, 24);
    assert.equal(damage.health, 76);
    const attackerSnapshot = latestSnapshotPlayerForClient(alice, "client-a");
    assert.equal(attackerSnapshot.inventory.activeWeapon, "shotgun");
    assert.equal(attackerSnapshot.inventory.nails, 0);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room switches to axe after consuming the last shell instead of getting stuck on an empty shotgun", () => {
  const originalNow = Date.now;
  let now = 3_000_000;
  Date.now = () => now;
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "auto-best-weapon-after-last-shell",
    spawnDistance: 1.2,
  });
  try {
    const attacker = partyRoom.players.get("party:client-a");
    assert.ok(attacker, "expected attacker");
    const inventory = items.quakeMultiplayerPlayerInventory(attacker);
    inventory.activeWeapon = "shotgun";
    inventory.weapons = ["axe", "shotgun"];
    inventory.shells = 1;
    partyRoom.players.set("party:client-a", items.quakeMultiplayerPlayerWithInventory(attacker, inventory));

    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-last-shell",
      sequence: 2,
      fireSequence: 1,
      sentAt: now,
    })), alice);

    const firstFired = roomEvents(alice, "player.fired")
      .find((event) => event.eventId === "fire-fire-last-shell");
    assert.equal(firstFired?.weapon, "shotgun");
    const afterLastShell = latestSnapshotPlayerForClient(alice, "client-a");
    assert.equal(afterLastShell.inventory.shells, 0);
    assert.equal(afterLastShell.inventory.activeWeapon, "axe");

    now += 500;
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-after-last-shell",
      sequence: 3,
      fireSequence: 2,
      sentAt: now,
    })), alice);

    const secondFired = roomEvents(alice, "player.fired")
      .find((event) => event.eventId === "fire-fire-after-last-shell");
    assert.equal(secondFired?.weapon, "axe");
    const axeDamage = roomEvents(alice, "player.damaged")
      .find((event) =>
        event.eventId === "damage-fire-after-last-shell" &&
        event.damageSource === "axe"
      );
    assert.ok(axeDamage, "expected axe fire after empty shotgun");
    assert.equal(axeDamage.damage, 20);
    assert.equal(axeDamage.health, 56);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
    Date.now = originalNow;
  }
});

test("party room drops and removes a source-style backpack on player death", () => {
  const originalNow = Date.now;
  let now = 4_000_000;
  Date.now = () => now;
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "player-death-dropped-backpack",
    matchSettings: { fragLimit: 99 },
    spawnDistance: 4,
  });
  try {
    const victim = partyRoom.players.get("party:client-b");
    assert.ok(victim, "expected victim");
    const victimInventory = items.quakeMultiplayerPlayerInventory(victim);
    victimInventory.activeWeapon = "rocketlauncher";
    victimInventory.weapons = ["axe", "shotgun", "rocketlauncher"];
    victimInventory.shells = 4;
    victimInventory.rockets = 7;
    partyRoom.players.set("party:client-b", items.quakeMultiplayerPlayerWithInventory(victim, victimInventory));

    partyRoom.applyPlayerDamage({
      attackerPlayerId: "party:client-a",
      victimPlayerId: "party:client-b",
      damage: 150,
      source: "rocketlauncher",
      eventId: "death-backpack",
      now,
    });

    const dropped = roomEvents(alice, "pickup.dropped").find((event) =>
      event.sourcePlayerId === "party:client-b"
    );
    assert.ok(dropped, "expected dropped backpack event");
    assert.equal(dropped.definition.classname, "item_backpack");
    assert.equal(dropped.definition.runtime, true);
    assert.equal(dropped.definition.effect.shells, 4);
    assert.equal(dropped.definition.effect.rockets, 7);
    assert.equal(dropped.definition.effect.weapon.id, "rocketlauncher");
    assert.equal(dropped.pickup.available, true);

    const dropSnapshot = latestConnectionMessage(alice, "room.snapshot");
    assert.equal(
      dropSnapshot.payload.dynamicPickups.some((definition) =>
        definition.entityIndex === dropped.definition.entityIndex
      ),
      true,
    );
    assert.equal(
      dropSnapshot.payload.pickups.some((pickup) =>
        pickup.entityIndex === dropped.definition.entityIndex && pickup.available
      ),
      true,
    );

    const taker = partyRoom.players.get("party:client-a");
    assert.ok(taker, "expected taker");
    const takerInventory = items.quakeMultiplayerPlayerInventory(taker);
    takerInventory.shells = 0;
    takerInventory.rockets = 0;
    takerInventory.weapons = ["axe", "shotgun"];
    partyRoom.players.set("party:client-a", items.quakeMultiplayerPlayerWithInventory({
      ...taker,
      origin: dropped.definition.origin,
    }, takerInventory));

    now += 100;
    partyRoom.onMessage(JSON.stringify(pickupEnvelope({
      clientId: "client-a",
      messageId: "pickup-dropped-backpack",
      sequence: 2,
      pickupSequence: 1,
      sentAt: now,
      pickup: {
        entityIndex: dropped.definition.entityIndex,
        origin: dropped.definition.origin,
      },
    })), alice);

    const taken = roomEvents(alice, "pickup.taken").find((event) =>
      event.entityIndex === dropped.definition.entityIndex
    );
    assert.ok(taken, "expected dynamic backpack pickup event");
    assert.equal(taken.leaveInPlace, false);
    const afterPickup = latestSnapshotPlayerForClient(alice, "client-a");
    assert.equal(afterPickup.inventory.shells, 4);
    assert.equal(afterPickup.inventory.rockets, 7);
    assert.equal(afterPickup.inventory.weapons.includes("rocketlauncher"), true);
    assert.equal(afterPickup.inventory.activeWeapon, "rocketlauncher");

    const pickupSnapshot = latestConnectionMessage(alice, "room.snapshot");
    assert.equal(
      pickupSnapshot.payload.dynamicPickups.some((definition) =>
        definition.entityIndex === dropped.definition.entityIndex
      ),
      false,
    );
    assert.equal(
      pickupSnapshot.payload.pickups.some((pickup) =>
        pickup.entityIndex === dropped.definition.entityIndex
      ),
      false,
    );
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
    Date.now = originalNow;
  }
});

test("party room accepts grenade refire at the source 600ms cooldown", () => {
  const originalNow = Date.now;
  let now = 2_000_000;
  Date.now = () => now;
  const { alice, bob, partyRoom } = connectDuelRoom({ id: "grenade-source-cooldown" });
  try {
    setPartyRoomPlayerWeapon(partyRoom, "client-a", "grenadelauncher");
    for (let index = 0; index < 2; index += 1) {
      partyRoom.onMessage(JSON.stringify(fireEnvelope({
        clientId: "client-a",
        messageId: `fire-grenade-cooldown-${index}`,
        sequence: 2 + index,
        fireSequence: 1 + index,
        sentAt: now,
        fire: { direction: [-1, 0, 0] },
      })), alice);
      now += 600;
    }

    const fired = roomEvents(alice, "player.fired")
      .filter((event) =>
        event.playerId === "party:client-a" &&
        event.weapon === "grenadelauncher"
      );
    assert.equal(fired.length, 2);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
    Date.now = originalNow;
  }
});

test("party room applies repeated authoritative damage until death across sustained-fire weapons", () => {
  const cases = [
    { weapon: "axe", spawnDistance: 1.2, stepMs: 500, damagedHealths: [80, 60, 40, 20], killHealth: 0 },
    { weapon: "shotgun", spawnDistance: 4, stepMs: 500, damagedHealths: [76, 52, 28, 4], killHealth: -20 },
    { weapon: "supershotgun", spawnDistance: 4, stepMs: 700, damagedHealths: [44], killHealth: -12 },
    { weapon: "nailgun", spawnDistance: 4, stepMs: 200, damagedHealths: [91, 82, 73, 64, 55, 46, 37, 28, 19, 10, 1], killHealth: -8 },
    { weapon: "supernailgun", spawnDistance: 4, stepMs: 200, damagedHealths: [82, 64, 46, 28, 10], killHealth: -8 },
    { weapon: "lightning", spawnDistance: 4, stepMs: 200, damagedHealths: [70, 40, 10], killHealth: -20 },
  ];
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    for (const spec of cases) {
      const { alice, bob, partyRoom } = connectDuelRoom({
        id: `repeated-${spec.weapon}`,
        spawnDistance: spec.spawnDistance,
      });
      try {
        setPartyRoomPlayerWeapon(partyRoom, "client-a", spec.weapon);
        for (let index = 0; index <= spec.damagedHealths.length; index += 1) {
          now += spec.stepMs;
          partyRoom.onMessage(JSON.stringify(fireEnvelope({
            clientId: "client-a",
            messageId: `fire-repeated-${spec.weapon}-${index}`,
            sequence: 2 + index,
            fireSequence: 1 + index,
            sentAt: now,
            fire: { weapon: spec.weapon },
          })), alice);
          if (projectileAuthority.quakeMultiplayerServerProjectileWeaponSupported(spec.weapon)) {
            now += 400;
            partyRoom.advanceRoomSimulation(now);
          }
          const expectedHealth = spec.damagedHealths[index];
          if (expectedHealth !== undefined) {
            const event = roomEvents(alice, "player.damaged")
              .find((candidate) =>
                candidate.victimPlayerId === "party:client-b" &&
                candidate.damageSource === spec.weapon &&
                candidate.health === expectedHealth
              );
            assert.ok(event, `expected repeated ${spec.weapon} damage ${index + 1}`);
            assert.equal(event.health, expectedHealth, `${spec.weapon} health after shot ${index + 1}`);
            assert.equal(latestSnapshotPlayerForClient(alice, "client-b").health, expectedHealth);
          } else {
            const event = roomEvents(alice, "player.killed")
              .find((candidate) =>
                candidate.victimPlayerId === "party:client-b" &&
                candidate.damageSource === spec.weapon
              );
            assert.ok(event, `expected repeated ${spec.weapon} kill`);
            const victim = latestSnapshotPlayerForClient(alice, "client-b");
            assert.equal(victim.alive, false, `${spec.weapon} victim alive after kill`);
            assert.equal(victim.health, spec.killHealth, `${spec.weapon} victim health after kill`);
          }
        }
        assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0, `${spec.weapon} alice rejects`);
        assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0, `${spec.weapon} bob rejects`);
      } finally {
        cleanupDuelRoom(partyRoom, alice, bob);
        now += 10_000;
      }
    }
  } finally {
    Date.now = originalNow;
  }
});

test("party room applies damage when LOS trace only clips the target skin", () => {
  const collisionWorld = {
    traceUse: () => ({
      fraction: 0.9856583826296409,
      end: [3.92, 0, -0.82],
      planeNormal: [0, 0, 1],
      entityIndex: 84,
      modelIndex: 3,
      classname: "func_wall",
    }),
  };
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "late-target-skin-los",
    roomOptions: {
      trustedSceneMovement: {
        collisionWorld,
        playerEyeHeight: 1.0,
      },
    },
    spawnDistance: 4,
  });
  try {
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-late-target-skin-los",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
    })), alice);

    const event = roomEvents(alice, "player.damaged")
      .find((candidate) =>
        candidate.attackerPlayerId === "party:client-a" &&
        candidate.victimPlayerId === "party:client-b" &&
        candidate.damageSource === "shotgun"
      );
    assert.ok(event, "expected late target-skin LOS trace to allow damage");
    assert.equal(event.damage, 24);
    assert.equal(event.health, 76);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room uses fire payload aim when the authoritative pose is one input behind", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "fresh-fire-aim-stale-pose",
    spawnDistance: 4,
  });
  try {
    const attacker = partyRoom.players.get("party:client-a");
    assert.ok(attacker, "expected attacker");
    partyRoom.players.set("party:client-a", {
      ...attacker,
      rotX: -78,
      rotY: 180,
    });

    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-fresh-aim-stale-pose",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
      fire: { direction: DUEL_FORWARD_DIRECTION },
    })), alice);

    const event = roomEvents(alice, "player.damaged")
      .find((candidate) =>
        candidate.attackerPlayerId === "party:client-a" &&
        candidate.victimPlayerId === "party:client-b"
      );
    assert.ok(event, "expected fresh fire aim to damage despite stale authoritative yaw");
    assert.equal(event.damage, 24);
    assert.equal(event.health, 76);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room uses a bounded fire origin hint when the authoritative origin is one input behind", () => {
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "fresh-fire-origin-stale-pose",
    spawnDistance: 4,
  });
  try {
    const victim = partyRoom.players.get("party:client-b");
    assert.ok(victim, "expected victim");
    partyRoom.players.set("party:client-b", {
      ...victim,
      origin: [victim.origin[0], 0.9, victim.origin[2]],
    });

    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-fresh-origin-stale-pose",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
      fire: { origin: [0, 0.4, 0] },
    })), alice);

    const event = roomEvents(alice, "player.damaged")
      .find((candidate) =>
        candidate.attackerPlayerId === "party:client-a" &&
        candidate.victimPlayerId === "party:client-b"
      );
    assert.ok(event, "expected bounded fire origin hint to damage despite stale authoritative origin");
    assert.equal(event.damage, 24);
    assert.equal(event.health, 76);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room rewinds hit tests from authoritative snapshot history instead of current velocity", () => {
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "historical-hit-stopped-target",
    spawnDistance: 4,
  });
  try {
    const attacker = partyRoom.players.get("party:client-a");
    const target = partyRoom.players.get("party:client-b");
    assert.ok(attacker, "expected attacker");
    assert.ok(target, "expected target");
    partyRoom.players.set("party:client-a", {
      ...attacker,
      origin: [0, 0, 0],
      velocity: [0, 0, 0],
      updatedAt: now,
    });
    partyRoom.players.set("party:client-b", {
      ...target,
      origin: [4, 0, 0],
      velocity: [0, 0, 0],
      updatedAt: now,
    });
    partyRoom.broadcastSnapshot();

    now += 100;
    partyRoom.players.set("party:client-b", {
      ...partyRoom.players.get("party:client-b"),
      origin: [4, 1.4, 0],
      velocity: [0, 0, 0],
      updatedAt: now,
    });
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-historical-stopped-target",
      sequence: 2,
      fireSequence: 1,
      sentAt: now,
      fire: {
        origin: [0, 0, -0.36],
        direction: [1, 0, 0],
      },
    })), alice);

    const event = roomEvents(alice, "player.damaged")
      .find((candidate) =>
        candidate.attackerPlayerId === "party:client-a" &&
        candidate.victimPlayerId === "party:client-b" &&
        candidate.damageSource === "shotgun"
      );
    assert.ok(event, "expected historical target sample to receive damage");
    assert.equal(event.damage, 24);
    assert.equal(event.health, 76);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-b").health, 76);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
    Date.now = originalNow;
  }
});

test("party room still blocks damage when LOS trace hits a real wall", () => {
  const collisionWorld = {
    traceUse: () => ({
      fraction: 0.5,
      end: [2, 0, -0.5],
      planeNormal: [1, 0, 0],
      entityIndex: 900,
      modelIndex: 9,
      classname: "func_wall",
    }),
  };
  const { alice, bob, partyRoom } = connectDuelRoom({
    id: "mid-wall-los",
    roomOptions: {
      trustedSceneMovement: {
        collisionWorld,
        playerEyeHeight: 1.0,
      },
    },
    spawnDistance: 4,
  });
  try {
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-mid-wall-los",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
    })), alice);

    const event = roomEvents(alice, "player.damaged")
      .find((candidate) =>
        candidate.attackerPlayerId === "party:client-a" &&
        candidate.victimPlayerId === "party:client-b"
      );
    assert.equal(event, undefined);
    const bobPlayer = latestSnapshotPlayerForClient(alice, "client-b");
    assert.equal(bobPlayer.health, 100);
    const fired = roomEvents(alice, "player.fired").find((candidate) =>
      candidate.eventId === "fire-fire-mid-wall-los"
    );
    assert.equal(fired?.decision?.outcome, "miss");
    assert.equal(fired?.decision?.reason, "line-of-sight-blocked");
    assert.equal(fired?.decision?.candidateCount, 1);
    assert.equal(fired?.decision?.blockedCandidateCount, 1);
    assert.equal(fired?.decision?.playerDamageCount, 0);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
    assert.equal(bob.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupDuelRoom(partyRoom, alice, bob);
  }
});

test("party room damages a farther visible player when a nearer candidate is blocked", () => {
  const collisionWorld = {
    traceUse: (_origin, impact) => impact[0] < 3
      ? {
          fraction: 0.5,
          end: [1, 0, -0.5],
          planeNormal: [1, 0, 0],
          entityIndex: 44,
          modelIndex: 2,
          classname: "func_wall",
        }
      : null,
  };
  const { alice, bob, cara, partyRoom } = connectTripleRoom({
    id: "blocked-nearer-visible-farther",
    roomOptions: {
      trustedSceneMovement: {
        collisionWorld,
        playerEyeHeight: 1.0,
      },
    },
    spawns: [
      { spawnId: "spawn-a", classname: "info_player_deathmatch", origin: [0, 0, 0], rotX: -78, rotY: 0 },
      { spawnId: "spawn-b", classname: "info_player_deathmatch", origin: [2, 0, 0], rotX: -78, rotY: 180 },
      { spawnId: "spawn-c", classname: "info_player_deathmatch", origin: [4, 0, 0], rotX: -78, rotY: 180 },
    ],
  });
  try {
    partyRoom.onMessage(JSON.stringify(fireEnvelope({
      clientId: "client-a",
      messageId: "fire-blocked-near-visible-far",
      sequence: 2,
      fireSequence: 1,
      sentAt: Date.now(),
    })), alice);

    const damagedEvents = roomEvents(alice, "player.damaged");
    assert.equal(damagedEvents.some((event) => event.victimPlayerId === "party:client-b"), false);
    const farEvent = damagedEvents.find((event) => event.victimPlayerId === "party:client-c");
    assert.ok(farEvent, "expected farther visible player to take damage");
    assert.equal(farEvent.damage, 24);
    assert.equal(farEvent.health, 76);
    const fired = roomEvents(alice, "player.fired").find((candidate) =>
      candidate.eventId === "fire-fire-blocked-near-visible-far"
    );
    assert.equal(fired?.decision?.outcome, "hit-player");
    assert.equal(fired?.decision?.reason, "player-direct");
    assert.equal(fired?.decision?.targetPlayerId, "party:client-c");
    assert.equal(fired?.decision?.candidateCount, 2);
    assert.equal(fired?.decision?.blockedCandidateCount, 1);
    assert.equal(fired?.decision?.playerDamageCount, 1);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-b").health, 100);
    assert.equal(latestSnapshotPlayerForClient(alice, "client-c").health, 76);
    assert.equal(alice.messages.filter((message) => message.type === "room.reject").length, 0);
  } finally {
    cleanupPartyRoomConnections(partyRoom, alice, bob, cara);
  }
});
