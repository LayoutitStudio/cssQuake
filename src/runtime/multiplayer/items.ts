import type {
  QuakeMultiplayerAuthoritativePickupState,
  QuakeMultiplayerAuthoritativePlayerState,
  QuakeMultiplayerInventoryState,
  QuakeMultiplayerPickupEffect,
  QuakeMultiplayerPickupDefinition,
} from "./protocol";

const QUAKE_MULTIPLAYER_MAX_AMMO = {
  shells: 100,
  nails: 200,
  rockets: 100,
  cells: 100,
} as const;

const QUAKE_MULTIPLAYER_DEFAULT_WEAPON_FLAGS = {
  shotgun: 1,
  axe: 4096,
} as const;

const QUAKE_MULTIPLAYER_ARMOR_FLAGS = 8192 | 16384 | 32768;
const QUAKE_MULTIPLAYER_PICKUP_REACH_DISTANCE = 3.5;

export interface QuakeMultiplayerDamageOptions {
  applyHealth?: boolean;
}

export function createQuakeMultiplayerInitialInventory(): QuakeMultiplayerInventoryState {
  return {
    health: 100,
    armor: 0,
    armorType: 0,
    activeWeapon: "shotgun",
    itemFlags: QUAKE_MULTIPLAYER_DEFAULT_WEAPON_FLAGS.shotgun | QUAKE_MULTIPLAYER_DEFAULT_WEAPON_FLAGS.axe,
    weapons: ["axe", "shotgun"],
    shells: 25,
    nails: 0,
    rockets: 0,
    cells: 0,
    keys: [],
    powerups: [],
  };
}

export function quakeMultiplayerInventoryCanAcceptPickupEffect(
  inventory: QuakeMultiplayerInventoryState,
  effect: QuakeMultiplayerPickupEffect,
): boolean {
  if (inventory.health <= 0) return false;
  if (effect.health !== undefined && inventory.health < (effect.healthMax ?? 100)) return true;
  if (effect.armor !== undefined) {
    const currentScore = inventory.armorType * inventory.armor;
    const nextScore = (effect.armorType ?? inventory.armorType) * effect.armor;
    if (nextScore > currentScore) return true;
  }
  if (effect.shells !== undefined && inventory.shells < QUAKE_MULTIPLAYER_MAX_AMMO.shells) return true;
  if (effect.nails !== undefined && inventory.nails < QUAKE_MULTIPLAYER_MAX_AMMO.nails) return true;
  if (effect.rockets !== undefined && inventory.rockets < QUAKE_MULTIPLAYER_MAX_AMMO.rockets) return true;
  if (effect.cells !== undefined && inventory.cells < QUAKE_MULTIPLAYER_MAX_AMMO.cells) return true;
  if (effect.weapon && !inventory.weapons.includes(effect.weapon.id)) return true;
  if (effect.key && !inventory.keys.includes(effect.key)) return true;
  if (
    effect.powerup &&
    !inventory.powerups.some((powerup) =>
      powerup.finishedField === effect.powerup?.finishedField &&
      powerup.finishedAt > Date.now()
    )
  ) {
    return true;
  }
  return false;
}

export function quakeMultiplayerPlayerCanReachPickup(
  player: QuakeMultiplayerAuthoritativePlayerState,
  pickup: QuakeMultiplayerPickupDefinition,
  maxDistance = QUAKE_MULTIPLAYER_PICKUP_REACH_DISTANCE,
): boolean {
  if (!player.alive) return false;
  const dx = player.origin[0] - pickup.origin[0];
  const dy = player.origin[1] - pickup.origin[1];
  const dz = player.origin[2] - pickup.origin[2];
  return Math.hypot(dx, dy, dz) <= maxDistance;
}

export function quakeMultiplayerPickupStateWithoutOwner(
  state: QuakeMultiplayerAuthoritativePickupState,
  playerId: string,
  updatedAt = Date.now(),
): QuakeMultiplayerAuthoritativePickupState {
  if (!state.ownerPlayerIds?.includes(playerId)) return state;
  return {
    ...state,
    ownerPlayerIds: state.ownerPlayerIds.filter((candidate) => candidate !== playerId),
    updatedAt,
  };
}

export function quakeMultiplayerPickupStateRespawned(
  state: QuakeMultiplayerAuthoritativePickupState,
  updatedAt = Date.now(),
): QuakeMultiplayerAuthoritativePickupState {
  return {
    ...state,
    available: true,
    respawnAt: undefined,
    ownerPlayerIds: [],
    updatedAt,
  };
}

export function quakeMultiplayerApplyPickupEffect(
  inventory: QuakeMultiplayerInventoryState,
  effect: QuakeMultiplayerPickupEffect,
  now = Date.now(),
): QuakeMultiplayerInventoryState {
  const next = quakeMultiplayerPruneExpiredPowerups(inventory, now);
  if (effect.health !== undefined) {
    next.health = Math.min(effect.healthMax ?? 100, next.health + effect.health);
  }
  if (effect.armor !== undefined) {
    if (effect.armorType !== undefined) {
      next.armor = effect.armor;
      next.armorType = effect.armorType;
    } else {
      next.armor = Math.max(next.armor, effect.armor);
    }
  }
  next.shells = clampAmmo(next.shells + (effect.shells ?? 0), QUAKE_MULTIPLAYER_MAX_AMMO.shells);
  next.nails = clampAmmo(next.nails + (effect.nails ?? 0), QUAKE_MULTIPLAYER_MAX_AMMO.nails);
  next.rockets = clampAmmo(next.rockets + (effect.rockets ?? 0), QUAKE_MULTIPLAYER_MAX_AMMO.rockets);
  next.cells = clampAmmo(next.cells + (effect.cells ?? 0), QUAKE_MULTIPLAYER_MAX_AMMO.cells);
  if (effect.weapon) {
    if (!next.weapons.includes(effect.weapon.id)) next.weapons = [...next.weapons, effect.weapon.id];
    if (effect.weapon.itemFlag !== undefined) next.itemFlags |= effect.weapon.itemFlag;
    if (effect.weapon.select) next.activeWeapon = effect.weapon.id;
  }
  if (effect.key && !next.keys.includes(effect.key)) next.keys = [...next.keys, effect.key];
  if (effect.powerup) {
    next.itemFlags |= effect.powerup.itemFlag;
    next.powerups = [
      ...next.powerups.filter((powerup) => powerup.finishedField !== effect.powerup?.finishedField),
      {
        active: true,
        activationField: effect.powerup.activationField,
        finishedAt: now + effect.powerup.durationMs,
        finishedField: effect.powerup.finishedField,
        itemFlag: effect.powerup.itemFlag,
        ...(effect.powerup.itemFlagExpression ? { itemFlagExpression: effect.powerup.itemFlagExpression } : {}),
      },
    ];
  }
  return next;
}

export function quakeMultiplayerApplyDamageToInventory(
  inventory: QuakeMultiplayerInventoryState,
  damage: number,
  options: QuakeMultiplayerDamageOptions = {},
): QuakeMultiplayerInventoryState {
  const next = cloneQuakeMultiplayerInventory(inventory);
  const rawDamage = Number.isFinite(damage) ? Math.max(0, damage) : 0;
  if (rawDamage <= 0) return next;
  let armorDamage = 0;
  if (next.armor > 0 && next.armorType > 0) {
    armorDamage = Math.ceil(next.armorType * rawDamage);
    if (armorDamage >= next.armor) {
      armorDamage = next.armor;
      next.armorType = 0;
      next.itemFlags &= ~QUAKE_MULTIPLAYER_ARMOR_FLAGS;
    }
    next.armor = Math.max(0, next.armor - armorDamage);
    if (next.armor <= 0) {
      next.armorType = 0;
      next.itemFlags &= ~QUAKE_MULTIPLAYER_ARMOR_FLAGS;
    }
  }
  if (options.applyHealth !== false) {
    next.health = Math.max(0, next.health - Math.max(0, Math.ceil(rawDamage - armorDamage)));
  }
  return next;
}

export function quakeMultiplayerDamageMultiplierForInventory(
  inventory: QuakeMultiplayerInventoryState,
  now = Date.now(),
): number {
  return quakeMultiplayerInventoryPowerupActive(inventory, "super_damage_finished", now)
    ? 4
    : 1;
}

export function quakeMultiplayerInventoryPowerupActive(
  inventory: QuakeMultiplayerInventoryState,
  finishedField: string,
  now = Date.now(),
): boolean {
  return inventory.powerups.some((powerup) =>
    powerup.finishedField === finishedField &&
    powerup.finishedAt > now
  );
}

export function quakeMultiplayerPlayerPowerupActive(
  player: QuakeMultiplayerAuthoritativePlayerState,
  finishedField: string,
  now = Date.now(),
): boolean {
  return quakeMultiplayerInventoryPowerupActive(
    quakeMultiplayerPlayerInventory(player),
    finishedField,
    now,
  );
}

export function quakeMultiplayerPruneExpiredPowerups(
  inventory: QuakeMultiplayerInventoryState,
  now = Date.now(),
): QuakeMultiplayerInventoryState {
  const next = cloneQuakeMultiplayerInventory(inventory);
  const activePowerups = next.powerups.filter((powerup) => powerup.finishedAt > now);
  if (activePowerups.length !== next.powerups.length) {
    const activeFlags = new Set(activePowerups.map((powerup) => powerup.itemFlag));
    for (const powerup of next.powerups) {
      if (!activeFlags.has(powerup.itemFlag)) next.itemFlags &= ~powerup.itemFlag;
    }
  }
  next.powerups = activePowerups;
  return next;
}

export function quakeMultiplayerConsumeWeaponAmmo(
  inventory: QuakeMultiplayerInventoryState,
  weapon: string,
): QuakeMultiplayerInventoryState | null {
  const next = cloneQuakeMultiplayerInventory(inventory);
  const normalized = weapon.trim().toLowerCase();
  if (normalized === "shotgun") {
    if (next.shells < 1) return null;
    next.shells -= 1;
    next.activeWeapon = "shotgun";
    return next;
  }
  if (normalized === "supershotgun") {
    if (next.shells < 2) return null;
    next.shells -= 2;
    next.activeWeapon = "supershotgun";
    return next;
  }
  if (normalized === "nailgun") {
    if (next.nails < 1) return null;
    next.nails -= 1;
    next.activeWeapon = "nailgun";
    return next;
  }
  if (normalized === "supernailgun") {
    if (next.nails < 2) return null;
    next.nails -= 2;
    next.activeWeapon = "supernailgun";
    return next;
  }
  if (normalized === "grenadelauncher") {
    if (next.rockets < 1) return null;
    next.rockets -= 1;
    next.activeWeapon = "grenadelauncher";
    return next;
  }
  if (normalized === "rocketlauncher") {
    if (next.rockets < 1) return null;
    next.rockets -= 1;
    next.activeWeapon = "rocketlauncher";
    return next;
  }
  if (normalized === "lightning") {
    if (next.cells < 1) return null;
    next.cells -= 1;
    next.activeWeapon = "lightning";
    return next;
  }
  if (normalized === "axe") {
    next.activeWeapon = "axe";
    return next;
  }
  return next;
}

export function quakeMultiplayerConsumeLightningDischargeCells(
  inventory: QuakeMultiplayerInventoryState,
): QuakeMultiplayerInventoryState | null {
  const next = cloneQuakeMultiplayerInventory(inventory);
  if (next.cells < 1) return null;
  next.cells = 0;
  next.activeWeapon = "lightning";
  return next;
}

export function quakeMultiplayerInventoryCanSelectWeapon(
  inventory: QuakeMultiplayerInventoryState,
  weapon: string,
): boolean {
  const normalized = weapon.trim().toLowerCase();
  if (!inventory.weapons.includes(normalized)) return false;
  if (normalized === "axe") return true;
  if (normalized === "shotgun") return inventory.shells >= 1;
  if (normalized === "supershotgun") return inventory.shells >= 2;
  if (normalized === "nailgun") return inventory.nails >= 1;
  if (normalized === "supernailgun") return inventory.nails >= 2;
  if (normalized === "grenadelauncher" || normalized === "rocketlauncher") return inventory.rockets >= 1;
  if (normalized === "lightning") return inventory.cells >= 1;
  return false;
}

export function quakeMultiplayerInventoryWithSelectedWeapon(
  inventory: QuakeMultiplayerInventoryState,
  weapon: string,
): QuakeMultiplayerInventoryState | null {
  if (!quakeMultiplayerInventoryCanSelectWeapon(inventory, weapon)) return null;
  return {
    ...cloneQuakeMultiplayerInventory(inventory),
    activeWeapon: weapon.trim().toLowerCase(),
  };
}

export function quakeMultiplayerPlayerWithInventory(
  player: QuakeMultiplayerAuthoritativePlayerState,
  inventory: QuakeMultiplayerInventoryState,
): QuakeMultiplayerAuthoritativePlayerState {
  return {
    ...player,
    health: inventory.health,
    armor: inventory.armor,
    activeWeapon: inventory.activeWeapon,
    inventory: cloneQuakeMultiplayerInventory(inventory),
  };
}

export function quakeMultiplayerPlayerInventory(
  player: QuakeMultiplayerAuthoritativePlayerState,
): QuakeMultiplayerInventoryState {
  return cloneQuakeMultiplayerInventory(player.inventory ?? {
    ...createQuakeMultiplayerInitialInventory(),
    health: player.health,
    armor: player.armor,
    activeWeapon: player.activeWeapon,
    powerups: [],
  });
}

function cloneQuakeMultiplayerInventory(
  inventory: QuakeMultiplayerInventoryState,
): QuakeMultiplayerInventoryState {
  return {
    ...inventory,
    weapons: [...inventory.weapons],
    keys: [...inventory.keys],
    powerups: [...(inventory.powerups ?? [])],
  };
}

function clampAmmo(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}
