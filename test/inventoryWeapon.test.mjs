import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "./importTsModule.mjs";

const {
  QUAKE_WEAPON_ITEM_FLAGS,
  applyQuakeInventoryDelta,
  changeQuakeInventoryWeapon,
  changeQuakeInventoryWeaponByImpulse,
  createInitialInventory,
  quakeBestInventoryWeapon,
  quakeInventoryAmmoForWeapon,
  quakeInventoryHasWeapon,
  quakeWeaponForImpulse,
  selectQuakeBestInventoryWeapon,
} = await importTsModule("src/runtime/hud.ts");

test("initial inventory matches Quake's shotgun start contract", () => {
  const inventory = createInitialInventory();

  assert.equal(inventory.health, 100);
  assert.equal(inventory.activeWeapon, "shotgun");
  assert.deepEqual([...inventory.weapons].sort(), ["axe", "shotgun"]);
  assert.equal(inventory.shells, 25);
  assert.equal(quakeInventoryAmmoForWeapon(inventory, "shotgun"), 25);
  assert.equal(quakeInventoryAmmoForWeapon(inventory, "axe"), 0);
  assert.equal(quakeInventoryHasWeapon(inventory, "axe"), true);
  assert.equal(quakeInventoryHasWeapon(inventory, "rocketlauncher"), false);
});

test("weapon impulse mapping and ammo gates reject unavailable changes", () => {
  const inventory = createInitialInventory();

  assert.equal(quakeWeaponForImpulse(1), "axe");
  assert.equal(quakeWeaponForImpulse(8), "lightning");
  assert.equal(quakeWeaponForImpulse(9), null);

  assert.deepEqual(changeQuakeInventoryWeaponByImpulse(inventory, 7), {
    changed: false,
    message: "no weapon.",
    weapon: "rocketlauncher",
  });

  inventory.weapons.add("rocketlauncher");
  inventory.itemFlags |= QUAKE_WEAPON_ITEM_FLAGS.rocketlauncher;
  assert.deepEqual(changeQuakeInventoryWeapon(inventory, "rocketlauncher"), {
    changed: false,
    message: "not enough ammo.",
    weapon: "rocketlauncher",
  });

  inventory.rockets = 1;
  assert.deepEqual(changeQuakeInventoryWeaponByImpulse(inventory, 7), {
    changed: true,
    weapon: "rocketlauncher",
  });
  assert.equal(inventory.activeWeapon, "rocketlauncher");
});

test("best weapon selection follows the source-backed priority and ammo thresholds", () => {
  const inventory = createInitialInventory();

  inventory.weapons = new Set([
    "axe",
    "shotgun",
    "supershotgun",
    "nailgun",
    "supernailgun",
    "grenadelauncher",
    "rocketlauncher",
    "lightning",
  ]);
  inventory.itemFlags = [...inventory.weapons]
    .reduce((flags, weapon) => flags | QUAKE_WEAPON_ITEM_FLAGS[weapon], 0);

  inventory.shells = 1;
  inventory.nails = 1;
  inventory.rockets = 100;
  inventory.cells = 0;
  assert.equal(quakeBestInventoryWeapon(inventory), "nailgun");

  inventory.shells = 2;
  assert.equal(quakeBestInventoryWeapon(inventory), "supershotgun");

  inventory.nails = 2;
  assert.equal(quakeBestInventoryWeapon(inventory), "supernailgun");

  inventory.cells = 1;
  assert.equal(selectQuakeBestInventoryWeapon(inventory), "lightning");
  assert.equal(inventory.activeWeapon, "lightning");
});

test("inventory deltas cap resources and keep ownership flags in sync", () => {
  const inventory = createInitialInventory();

  applyQuakeInventoryDelta(inventory, {
    armor: 150,
    armorType: 0.8,
    cells: 999,
    health: 200,
    healthMax: 250,
    key: "gold",
    nails: 999,
    rockets: 999,
    shells: 999,
    weapon: {
      id: "lightning",
      itemFlag: QUAKE_WEAPON_ITEM_FLAGS.lightning,
      select: true,
    },
  });

  assert.equal(inventory.health, 250);
  assert.equal(inventory.armor, 150);
  assert.equal(inventory.armorType, 0.8);
  assert.equal(inventory.shells, 100);
  assert.equal(inventory.nails, 200);
  assert.equal(inventory.rockets, 100);
  assert.equal(inventory.cells, 100);
  assert.equal(inventory.keys.has("gold"), true);
  assert.equal(inventory.weapons.has("lightning"), true);
  assert.equal(quakeInventoryHasWeapon(inventory, "lightning"), true);
  assert.equal(inventory.activeWeapon, "lightning");
});
