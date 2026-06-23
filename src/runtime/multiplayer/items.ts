import type {
  QuakeMultiplayerAuthoritativePickupState,
  QuakeMultiplayerAuthoritativePlayerState,
  QuakeMultiplayerInventoryState,
  QuakeMultiplayerPickupEffect,
  QuakeMultiplayerPickupDefinition,
  QuakeMultiplayerVec3,
} from "./protocol";
import { QUAKE_PLAYER_MINS_Z } from "../constants";

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
const QUAKE_MULTIPLAYER_PICKUP_ORIGIN_HINT_MAX_HORIZONTAL_DRIFT = 3;
const QUAKE_MULTIPLAYER_PICKUP_ORIGIN_HINT_MAX_VERTICAL_DRIFT = 8;
const QUAKE_MULTIPLAYER_MIN_DEATH_HEALTH = -99;
const QUAKE_MULTIPLAYER_DROPPED_BACKPACK_LIFETIME_MS = 120_000;
const QUAKE_MULTIPLAYER_DROPPED_BACKPACK_MODEL_PATH = "progs/backpack.mdl";
const QUAKE_MULTIPLAYER_DEATH_CLEARED_ARTIFACT_FLAGS = [
  524_288, // IT_INVISIBILITY
  1_048_576, // IT_INVULNERABILITY
  2_097_152, // IT_SUIT
  4_194_304, // IT_QUAD
] as const;

const QUAKE_MULTIPLAYER_WEAPON_ITEM_FLAGS: Record<string, number> = {
  shotgun: 1,
  supershotgun: 2,
  nailgun: 4,
  supernailgun: 8,
  grenadelauncher: 16,
  rocketlauncher: 32,
  lightning: 64,
  axe: 4096,
};

const QUAKE_MULTIPLAYER_WEAPON_PICKUP_SWITCH_RANK: Record<string, number> = {
  lightning: 1,
  rocketlauncher: 2,
  supernailgun: 3,
  grenadelauncher: 4,
  supershotgun: 5,
  nailgun: 6,
  shotgun: 7,
  axe: 7,
};

export interface QuakeMultiplayerDamageOptions {
  applyHealth?: boolean;
}

export interface QuakeMultiplayerBestWeaponOptions {
  allowLightning?: boolean;
}

export interface QuakeMultiplayerDroppedBackpackOptions {
  entityIndex: number;
  now?: number;
  player: QuakeMultiplayerAuthoritativePlayerState;
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
  now = Date.now(),
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
      powerup.finishedAt > now
    )
  ) {
    return true;
  }
  return false;
}

export function quakeMultiplayerPickupAlwaysAcceptsTouch(
  pickup: Pick<QuakeMultiplayerPickupDefinition, "classname" | "lifecycle">,
): boolean {
  if (pickup.classname === "item_backpack") return true;
  return pickup.classname.startsWith("weapon_") && pickup.lifecycle?.action !== "leave";
}

export function quakeMultiplayerPlayerCanReachPickup(
  player: QuakeMultiplayerAuthoritativePlayerState,
  pickup: QuakeMultiplayerPickupDefinition,
  maxDistance = QUAKE_MULTIPLAYER_PICKUP_REACH_DISTANCE,
  originHint?: QuakeMultiplayerVec3,
): boolean {
  if (!player.alive) return false;
  if (quakeMultiplayerOriginCanReachPickup(player.origin, pickup, maxDistance)) return true;
  return Boolean(
    originHint &&
      quakeMultiplayerPickupOriginHintWithinDrift(player.origin, originHint) &&
      quakeMultiplayerOriginCanReachPickup(originHint, pickup, maxDistance)
  );
}

function quakeMultiplayerOriginCanReachPickup(
  origin: QuakeMultiplayerVec3,
  pickup: QuakeMultiplayerPickupDefinition,
  maxDistance: number,
): boolean {
  const dx = origin[0] - pickup.origin[0];
  const dy = origin[1] - pickup.origin[1];
  const dz = origin[2] - pickup.origin[2];
  return Math.hypot(dx, dy, dz) <= maxDistance;
}

function quakeMultiplayerPickupOriginHintWithinDrift(
  authoritativeOrigin: QuakeMultiplayerVec3,
  hintOrigin: QuakeMultiplayerVec3,
): boolean {
  const horizontalDrift = Math.hypot(
    authoritativeOrigin[0] - hintOrigin[0],
    authoritativeOrigin[1] - hintOrigin[1],
  );
  const verticalDrift = Math.abs(authoritativeOrigin[2] - hintOrigin[2]);
  return horizontalDrift <= QUAKE_MULTIPLAYER_PICKUP_ORIGIN_HINT_MAX_HORIZONTAL_DRIFT &&
    verticalDrift <= QUAKE_MULTIPLAYER_PICKUP_ORIGIN_HINT_MAX_VERTICAL_DRIFT;
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

export function quakeMultiplayerDroppedBackpackDefinition(
  options: QuakeMultiplayerDroppedBackpackOptions,
): QuakeMultiplayerPickupDefinition | null {
  const now = options.now ?? Date.now();
  const inventory = quakeMultiplayerPlayerInventory(options.player);
  const totalAmmo = inventory.shells + inventory.nails + inventory.rockets + inventory.cells;
  if (totalAmmo <= 0) return null;
  const effect: QuakeMultiplayerPickupEffect = {};
  if (inventory.shells > 0) effect.shells = inventory.shells;
  if (inventory.nails > 0) effect.nails = inventory.nails;
  if (inventory.rockets > 0) effect.rockets = inventory.rockets;
  if (inventory.cells > 0) effect.cells = inventory.cells;
  const activeWeapon = inventory.activeWeapon.trim().toLowerCase();
  const activeWeaponFlag = QUAKE_MULTIPLAYER_WEAPON_ITEM_FLAGS[activeWeapon];
  if (activeWeaponFlag !== undefined && inventory.weapons.includes(activeWeapon)) {
    effect.weapon = {
      id: activeWeapon,
      itemFlag: activeWeaponFlag,
      select: true,
    };
  }
  const origin: QuakeMultiplayerVec3 = [
    options.player.origin[0],
    options.player.origin[1],
    options.player.origin[2] + QUAKE_PLAYER_MINS_Z,
  ];
  return {
    pickupId: `dropped-backpack:${options.player.playerId}:${options.entityIndex}:${now}`,
    entityIndex: options.entityIndex,
    classname: "item_backpack",
    origin,
    effect,
    feedback: {
      message: "You get the backpack",
      soundPath: "weapons/lock4.wav",
    },
    lifecycle: {
      action: "remove",
      condition: "pickup",
    },
    modelPath: QUAKE_MULTIPLAYER_DROPPED_BACKPACK_MODEL_PATH,
    removeAt: now + QUAKE_MULTIPLAYER_DROPPED_BACKPACK_LIFETIME_MS,
    runtime: true,
  };
}

export function quakeMultiplayerApplyPickupEffect(
  inventory: QuakeMultiplayerInventoryState,
  effect: QuakeMultiplayerPickupEffect,
  now = Date.now(),
): QuakeMultiplayerInventoryState {
  const next = quakeMultiplayerPruneExpiredPowerups(inventory, now);
  const previousBestWeapon = quakeMultiplayerInventoryBestWeapon(next);
  const activeWeaponWasBest = next.activeWeapon === previousBestWeapon;
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
  let switchedByPickupWeapon = false;
  if (effect.weapon) {
    const weaponId = effect.weapon.id.trim().toLowerCase();
    if (!next.weapons.includes(weaponId)) next.weapons = [...next.weapons, weaponId];
    if (effect.weapon.itemFlag !== undefined) next.itemFlags |= effect.weapon.itemFlag;
    if (effect.weapon.select && quakeMultiplayerPickupWeaponOutranksActive(next, weaponId)) {
      next.activeWeapon = weaponId;
      switchedByPickupWeapon = true;
    }
  }
  if (!switchedByPickupWeapon && !effect.weapon?.select && activeWeaponWasBest) {
    next.activeWeapon = quakeMultiplayerInventoryBestWeapon(next);
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
    next.health = Math.max(
      QUAKE_MULTIPLAYER_MIN_DEATH_HEALTH,
      next.health - Math.max(0, Math.ceil(rawDamage - armorDamage)),
    );
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

export function quakeMultiplayerInventoryWithoutPowerup(
  inventory: QuakeMultiplayerInventoryState,
  finishedField: string,
): QuakeMultiplayerInventoryState {
  const next = cloneQuakeMultiplayerInventory(inventory);
  const removed = next.powerups.filter((powerup) => powerup.finishedField === finishedField);
  if (!removed.length) return next;
  next.powerups = next.powerups.filter((powerup) => powerup.finishedField !== finishedField);
  const activeFlags = new Set(next.powerups.map((powerup) => powerup.itemFlag));
  for (const powerup of removed) {
    if (!activeFlags.has(powerup.itemFlag)) next.itemFlags &= ~powerup.itemFlag;
  }
  return next;
}

export function quakeMultiplayerInventoryWithoutDeathPowerups(
  inventory: QuakeMultiplayerInventoryState,
): QuakeMultiplayerInventoryState {
  const next = cloneQuakeMultiplayerInventory(inventory);
  const removedFlags = new Set([
    ...QUAKE_MULTIPLAYER_DEATH_CLEARED_ARTIFACT_FLAGS,
    ...next.powerups.map((powerup) => powerup.itemFlag),
  ]);
  next.powerups = [];
  for (const itemFlag of removedFlags) next.itemFlags &= ~itemFlag;
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

export function quakeMultiplayerInventoryBestWeapon(
  inventory: QuakeMultiplayerInventoryState,
  options: QuakeMultiplayerBestWeaponOptions = {},
): string {
  const allowLightning = options.allowLightning ?? true;
  const priority = [
    ...(allowLightning ? ["lightning"] : []),
    "supernailgun",
    "supershotgun",
    "nailgun",
    "shotgun",
    "axe",
  ];
  return priority.find((weapon) => quakeMultiplayerInventoryCanSelectWeapon(inventory, weapon)) ?? "axe";
}

export function quakeMultiplayerInventoryWithBestWeaponIfCurrentAmmoEmpty(
  inventory: QuakeMultiplayerInventoryState,
  options: QuakeMultiplayerBestWeaponOptions = {},
): QuakeMultiplayerInventoryState {
  const next = cloneQuakeMultiplayerInventory(inventory);
  if (quakeMultiplayerInventoryCanSelectWeapon(next, next.activeWeapon)) return next;
  return {
    ...next,
    activeWeapon: quakeMultiplayerInventoryBestWeapon(next, options),
  };
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

function quakeMultiplayerPickupWeaponOutranksActive(
  inventory: QuakeMultiplayerInventoryState,
  weapon: string,
): boolean {
  if (!quakeMultiplayerInventoryCanSelectWeapon(inventory, weapon)) return false;
  return quakeMultiplayerWeaponPickupSwitchRank(weapon) <
    quakeMultiplayerWeaponPickupSwitchRank(inventory.activeWeapon);
}

function quakeMultiplayerWeaponPickupSwitchRank(weapon: string): number {
  return QUAKE_MULTIPLAYER_WEAPON_PICKUP_SWITCH_RANK[weapon.trim().toLowerCase()] ?? 7;
}

function clampAmmo(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}
