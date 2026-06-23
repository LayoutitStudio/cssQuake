import assert from "node:assert/strict";
import test from "node:test";

import { createPlayer } from "./harness.mjs";
import { importTsModule } from "../importTsModule.mjs";

const items = await importTsModule("src/runtime/multiplayer/items.ts");

function pickupDefinition(overrides = {}) {
  return {
    pickupId: "item-shells",
    entityIndex: 20,
    classname: "item_shells",
    origin: [2, 0, 1],
    effect: { shells: 20 },
    ...overrides,
  };
}

test("pickup reach accepts the authoritative player position", () => {
  assert.equal(
    items.quakeMultiplayerPlayerCanReachPickup(
      createPlayer({ origin: [2.2, 0, 1] }),
      pickupDefinition(),
    ),
    true,
  );
});

test("pickup reach accepts a bounded local origin hint during vertical server prediction drift", () => {
  assert.equal(
    items.quakeMultiplayerPlayerCanReachPickup(
      createPlayer({ origin: [2.2, 0, 6] }),
      pickupDefinition(),
      undefined,
      [2.2, 0, 1],
    ),
    true,
  );
});

test("pickup reach rejects a forged origin hint far from the authoritative player", () => {
  assert.equal(
    items.quakeMultiplayerPlayerCanReachPickup(
      createPlayer({ origin: [0, 0, 1] }),
      pickupDefinition({ origin: [20, 0, 1] }),
      undefined,
      [20, 0, 1],
    ),
    false,
  );
});

test("damage applies armor save even when invulnerability blocks health damage", () => {
  const inventory = items.quakeMultiplayerApplyDamageToInventory({
    ...items.createQuakeMultiplayerInitialInventory(),
    health: 100,
    armor: 50,
    armorType: 0.8,
  }, 24, { applyHealth: false });

  assert.equal(inventory.health, 100);
  assert.equal(inventory.armor, 30);
  assert.equal(inventory.armorType, 0.8);
});

test("powerup pickup acceptance uses caller simulation time", () => {
  const inventory = {
    ...items.createQuakeMultiplayerInitialInventory(),
    powerups: [{
      active: true,
      activationField: "super_time",
      finishedAt: 2_000,
      finishedField: "super_damage_finished",
      itemFlag: 524_288,
    }],
  };
  const effect = {
    powerup: {
      activationField: "super_time",
      durationMs: 30_000,
      finishedField: "super_damage_finished",
      itemFlag: 524_288,
    },
  };

  assert.equal(items.quakeMultiplayerInventoryCanAcceptPickupEffect(inventory, effect, 1_999), false);
  assert.equal(items.quakeMultiplayerInventoryCanAcceptPickupEffect(inventory, effect, 2_001), true);
});

test("removing a powerup clears only its item flag when no remaining powerup uses it", () => {
  const inventory = {
    ...items.createQuakeMultiplayerInitialInventory(),
    itemFlags: 524_288 | 1_048_576 | 2_097_152 | 4_194_304,
    powerups: [
      {
        active: true,
        activationField: "invincible_time",
        finishedAt: 10_000,
        finishedField: "invincible_finished",
        itemFlag: 1_048_576,
      },
      {
        active: true,
        activationField: "super_damage_time",
        finishedAt: 10_000,
        finishedField: "super_damage_finished",
        itemFlag: 4_194_304,
      },
    ],
  };

  const next = items.quakeMultiplayerInventoryWithoutPowerup(inventory, "invincible_finished");

  assert.equal(next.itemFlags & 1_048_576, 0);
  assert.equal(next.itemFlags & 4_194_304, 4_194_304);
  assert.deepEqual(next.powerups.map((powerup) => powerup.finishedField), ["super_damage_finished"]);
});

test("death clears active artifact powerups and their item flags", () => {
  const inventory = {
    ...items.createQuakeMultiplayerInitialInventory(),
    itemFlags: 1_048_576 | 4_194_304,
    powerups: [
      {
        active: true,
        activationField: "invincible_time",
        finishedAt: 10_000,
        finishedField: "invincible_finished",
        itemFlag: 1_048_576,
      },
      {
        active: true,
        activationField: "super_damage_time",
        finishedAt: 10_000,
        finishedField: "super_damage_finished",
        itemFlag: 4_194_304,
      },
    ],
  };

  const next = items.quakeMultiplayerInventoryWithoutDeathPowerups(inventory);

  assert.equal(next.itemFlags & 1_048_576, 0);
  assert.equal(next.itemFlags & 2_097_152, 0);
  assert.equal(next.itemFlags & 4_194_304, 0);
  assert.equal(next.itemFlags & 524_288, 0);
  assert.deepEqual(next.powerups, []);
});

test("best weapon follows Quake source priority when the current weapon has no ammo", () => {
  const inventory = {
    ...items.createQuakeMultiplayerInitialInventory(),
    activeWeapon: "shotgun",
    weapons: ["axe", "shotgun", "supershotgun", "nailgun", "supernailgun", "rocketlauncher"],
    shells: 0,
    nails: 2,
    rockets: 4,
    cells: 0,
  };

  assert.equal(items.quakeMultiplayerInventoryBestWeapon(inventory), "supernailgun");

  const next = items.quakeMultiplayerInventoryWithBestWeaponIfCurrentAmmoEmpty(inventory);
  assert.equal(next.activeWeapon, "supernailgun");
  assert.deepEqual(next.weapons, inventory.weapons);
});

test("best weapon falls back to axe when no carried weapon has ammo", () => {
  const inventory = {
    ...items.createQuakeMultiplayerInitialInventory(),
    activeWeapon: "shotgun",
    weapons: ["axe", "shotgun", "rocketlauncher"],
    shells: 0,
    rockets: 0,
  };

  assert.equal(items.quakeMultiplayerInventoryBestWeapon(inventory), "axe");
  assert.equal(items.quakeMultiplayerInventoryWithBestWeaponIfCurrentAmmoEmpty(inventory).activeWeapon, "axe");
});

test("best weapon follows Quake W_BestWeapon by not auto-selecting explosive weapons", () => {
  const inventory = {
    ...items.createQuakeMultiplayerInitialInventory(),
    activeWeapon: "shotgun",
    weapons: ["axe", "shotgun", "grenadelauncher", "rocketlauncher"],
    shells: 0,
    rockets: 5,
  };

  assert.equal(items.quakeMultiplayerInventoryBestWeapon(inventory), "axe");
  assert.equal(items.quakeMultiplayerInventoryWithBestWeaponIfCurrentAmmoEmpty(inventory).activeWeapon, "axe");
});

test("ammo pickup switches to a newly usable best weapon only when the active weapon was already best", () => {
  const inventory = {
    ...items.createQuakeMultiplayerInitialInventory(),
    activeWeapon: "shotgun",
    weapons: ["axe", "shotgun", "supernailgun"],
    shells: 25,
    nails: 0,
  };

  const switched = items.quakeMultiplayerApplyPickupEffect(inventory, { nails: 25 }, 1_000);
  assert.equal(switched.nails, 25);
  assert.equal(switched.activeWeapon, "supernailgun");

  const manualWeapon = items.quakeMultiplayerApplyPickupEffect({
    ...inventory,
    activeWeapon: "axe",
  }, { nails: 25 }, 1_000);
  assert.equal(manualWeapon.nails, 25);
  assert.equal(manualWeapon.activeWeapon, "axe");
});

test("weapon pickup uses Quake deathmatch rank instead of always forcing the new weapon active", () => {
  const inventory = {
    ...items.createQuakeMultiplayerInitialInventory(),
    activeWeapon: "rocketlauncher",
    weapons: ["axe", "shotgun", "rocketlauncher"],
    shells: 10,
    nails: 0,
    rockets: 5,
  };

  const worsePickup = items.quakeMultiplayerApplyPickupEffect(inventory, {
    nails: 30,
    weapon: { id: "nailgun", itemFlag: 4, select: true },
  }, 1_000);
  assert.equal(worsePickup.nails, 30);
  assert.equal(worsePickup.weapons.includes("nailgun"), true);
  assert.equal(worsePickup.activeWeapon, "rocketlauncher");

  const betterPickup = items.quakeMultiplayerApplyPickupEffect(worsePickup, {
    cells: 15,
    weapon: { id: "lightning", itemFlag: 64, select: true },
  }, 1_000);
  assert.equal(betterPickup.cells, 15);
  assert.equal(betterPickup.weapons.includes("lightning"), true);
  assert.equal(betterPickup.activeWeapon, "lightning");
});

test("source touch acceptance only bypasses not-needed for backpacks and non-leave weapon pickups", () => {
  assert.equal(items.quakeMultiplayerPickupAlwaysAcceptsTouch({
    classname: "item_backpack",
  }), true);
  assert.equal(items.quakeMultiplayerPickupAlwaysAcceptsTouch({
    classname: "weapon_rocketlauncher",
    lifecycle: { action: "respawn", condition: "deathmatch", delayMs: 30_000 },
  }), true);
  assert.equal(items.quakeMultiplayerPickupAlwaysAcceptsTouch({
    classname: "weapon_rocketlauncher",
    lifecycle: { action: "leave", condition: "deathmatch == 2" },
  }), false);
  assert.equal(items.quakeMultiplayerPickupAlwaysAcceptsTouch({
    classname: "item_rockets",
    lifecycle: { action: "respawn", condition: "deathmatch", delayMs: 30_000 },
  }), false);
});

test("dropped backpack definition carries source deathmatch ammo and current weapon", () => {
  const player = createPlayer({
    playerId: "party:client-b",
    origin: [4, 0, 1],
    inventory: {
      ...items.createQuakeMultiplayerInitialInventory(),
      activeWeapon: "rocketlauncher",
      weapons: ["axe", "shotgun", "rocketlauncher"],
      shells: 3,
      rockets: 7,
    },
  });

  const definition = items.quakeMultiplayerDroppedBackpackDefinition({
    player,
    entityIndex: 1_000_000,
    now: 12_000,
  });

  assert.ok(definition, "expected backpack definition");
  assert.equal(definition.classname, "item_backpack");
  assert.equal(definition.runtime, true);
  assert.equal(definition.modelPath, "progs/backpack.mdl");
  assert.equal(definition.removeAt, 132_000);
  assert.equal(definition.effect.shells, 3);
  assert.equal(definition.effect.rockets, 7);
  assert.deepEqual(definition.effect.weapon, {
    id: "rocketlauncher",
    itemFlag: 32,
    select: true,
  });
});

test("dropped backpack definition is omitted when the victim carries no ammo", () => {
  const player = createPlayer({
    inventory: {
      ...items.createQuakeMultiplayerInitialInventory(),
      shells: 0,
    },
  });

  assert.equal(
    items.quakeMultiplayerDroppedBackpackDefinition({
      player,
      entityIndex: 1_000_001,
      now: 12_000,
    }),
    null,
  );
});
