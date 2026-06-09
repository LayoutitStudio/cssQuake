export type QuakeKey = "silver" | "gold";

const QUAKE_MAX_SHELLS = 100;
const QUAKE_MAX_NAILS = 200;
const QUAKE_MAX_ROCKETS = 100;
const QUAKE_MAX_CELLS = 100;

export interface QuakePlayerInventory {
  health: number;
  armor: number;
  armorType: number;
  itemFlags: number;
  shells: number;
  nails: number;
  rockets: number;
  cells: number;
  keys: Set<QuakeKey>;
  powerups: Record<string, QuakeInventoryPowerupState>;
}

export interface QuakeInventoryDelta {
  health?: number;
  healthMax?: number;
  armor?: number;
  armorType?: number;
  shells?: number;
  nails?: number;
  rockets?: number;
  cells?: number;
  key?: QuakeKey;
}

export interface QuakeInventoryPowerupBehavior {
  activationField: string;
  activationValue?: 1;
  durationSeconds: number;
  finishedExpression?: string;
  finishedField: string;
  itemFlag: number;
  itemFlagExpression: string;
  itemFlagMutation?: {
    expression: string;
    sourceField: "self.items";
    targetField: "other.items";
  };
}

export interface QuakeInventoryPowerupState {
  active: true;
  activationField: string;
  finishedAt: number;
  itemFlag: number;
  itemFlagExpression: string;
  itemFlagMutation?: QuakeInventoryPowerupBehavior["itemFlagMutation"];
}

export interface QuakeInventoryDamageResult {
  armorDamage: number;
  changed: boolean;
  healthDamage: number;
  rawDamage: number;
}

export interface QuakeInventoryDamageOptions {
  applyHealth?: boolean;
}

export type QuakeHudNumberReadoutId = "armor" | "health" | "healthDamage" | "ammo";

export type QuakeHudSlotId =
  | "armor-green"
  | "armor-yellow"
  | "armor-red"
  | "face-normal"
  | "face-invisibility"
  | "face-invulnerability"
  | "face-invisibility-invulnerability"
  | "face-quad"
  | "ammo-shells"
  | "ammo-nails"
  | "ammo-rockets"
  | "ammo-cells"
  | "key-silver"
  | "key-gold"
  | "powerup-invisibility"
  | "powerup-invulnerability"
  | "powerup-biosuit"
  | "powerup-quad";

export interface QuakeHudSlotDefinition {
  id: QuakeHudSlotId;
  qpic: string;
  row: "inventory" | "status";
  sourceX: number;
  sourceY: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface QuakeHudReadout {
  element: HTMLElement;
  digits: HTMLElement[];
  value: string;
}

export interface QuakeHudElementSources {
  root: HTMLElement | null;
  armor: HTMLElement | null;
  health: HTMLElement | null;
  healthDamage: HTMLElement | null;
  ammo: HTMLElement | null;
}

export interface QuakeHudElements {
  root: HTMLElement | null;
  readouts: Record<QuakeHudNumberReadoutId, QuakeHudReadout | null>;
  slots: Partial<Record<QuakeHudSlotId, HTMLElement>>;
}

const QUAKE_HUD_STATUS_ROW_Y = 24;
const QUAKE_HUD_ICON_SLOT_SIZE = 24;
const QUAKE_HUD_POWERUP_FIELDS = {
  biosuit: "radsuit_finished",
  invisibility: "invisible_finished",
  invulnerability: "invincible_finished",
  quad: "super_damage_finished",
} as const;

export const QUAKE_HUD_ICON_SHEET_URL = "/q/hud-icons.png";
export const QUAKE_HUD_INVENTORY_URL = "/q/hud-inventory.png";
export const QUAKE_HUD_ICON_SHEET_WIDTH = QUAKE_HUD_ICON_SLOT_SIZE * 18;
export const QUAKE_HUD_SLOT_DEFINITIONS: readonly QuakeHudSlotDefinition[] = [
  quakeStatusHudSlot("armor-green", "sb_armor1", 0, 24, 24, 0, 0),
  quakeStatusHudSlot("armor-yellow", "sb_armor2", 1, 24, 24, 0, 0),
  quakeStatusHudSlot("armor-red", "sb_armor3", 2, 24, 24, 0, 0),
  quakeStatusHudSlot("face-normal", "face1", 3, 24, 24, 112, 0),
  quakeStatusHudSlot("face-invisibility", "face_invis", 4, 24, 24, 112, 0),
  quakeStatusHudSlot("face-invulnerability", "face_invul2", 5, 24, 24, 112, 0),
  quakeStatusHudSlot("face-invisibility-invulnerability", "face_inv2", 6, 24, 24, 112, 0),
  quakeStatusHudSlot("face-quad", "face_quad", 7, 24, 24, 112, 0),
  quakeStatusHudSlot("ammo-shells", "sb_shells", 8, 24, 24, 224, 0),
  quakeStatusHudSlot("ammo-nails", "sb_nails", 9, 24, 24, 224, 0),
  quakeStatusHudSlot("ammo-rockets", "sb_rocket", 10, 24, 24, 224, 0),
  quakeStatusHudSlot("ammo-cells", "sb_cells", 11, 24, 24, 224, 0),
  quakeInventoryHudSlot("key-silver", "sb_key1", 12, 16, 16, 192, 8),
  quakeInventoryHudSlot("key-gold", "sb_key2", 13, 16, 16, 208, 8),
  quakeInventoryHudSlot("powerup-invisibility", "sb_invis", 14, 16, 16, 224, 8),
  quakeInventoryHudSlot("powerup-invulnerability", "sb_invuln", 15, 16, 16, 240, 8),
  quakeInventoryHudSlot("powerup-biosuit", "sb_suit", 16, 16, 16, 256, 8),
  quakeInventoryHudSlot("powerup-quad", "sb_quad", 17, 16, 16, 272, 8),
];

export function createInitialInventory(): QuakePlayerInventory {
  return {
    health: 100,
    armor: 0,
    armorType: 0,
    itemFlags: 0,
    shells: 25,
    nails: 0,
    rockets: 0,
    cells: 0,
    keys: new Set(),
    powerups: {},
  };
}

export function createQuakeHudElements(sources: QuakeHudElementSources): QuakeHudElements {
  const elements: QuakeHudElements = {
    root: sources.root,
    readouts: {
      armor: createQuakeHudReadout(sources.armor),
      health: createQuakeHudReadout(sources.health),
      healthDamage: createQuakeHudReadout(sources.healthDamage),
      ammo: createQuakeHudReadout(sources.ammo),
    },
    slots: {},
  };
  cacheQuakeHudSlots(elements);
  return elements;
}

export function syncQuakeHud(elements: QuakeHudElements, inventory: QuakePlayerInventory): void {
  const armor = formatHudNumber(inventory.armor);
  const health = formatHudNumber(inventory.health);
  const ammo = formatHudNumber(inventory.shells);
  setHudValue(elements.readouts.armor, armor);
  setHudValue(elements.readouts.health, health);
  setHudValue(elements.readouts.healthDamage, health);
  setHudValue(elements.readouts.ammo, ammo);
  syncQuakeHudArmorSlot(elements, inventory);
  syncQuakeHudFaceSlot(elements, inventory);
  syncQuakeHudAmmoSlot(elements, "ammo-shells");
  setHudSlotActive(elements.slots["key-silver"], inventory.keys.has("silver"));
  setHudSlotActive(elements.slots["key-gold"], inventory.keys.has("gold"));
  setHudSlotActive(elements.slots["powerup-invisibility"], quakeHudPowerupActive(inventory, QUAKE_HUD_POWERUP_FIELDS.invisibility));
  setHudSlotActive(elements.slots["powerup-invulnerability"], quakeHudPowerupActive(inventory, QUAKE_HUD_POWERUP_FIELDS.invulnerability));
  setHudSlotActive(elements.slots["powerup-biosuit"], quakeHudPowerupActive(inventory, QUAKE_HUD_POWERUP_FIELDS.biosuit));
  setHudSlotActive(elements.slots["powerup-quad"], quakeHudPowerupActive(inventory, QUAKE_HUD_POWERUP_FIELDS.quad));
  if (elements.root) {
    const label = `Quake status: armor ${Math.max(0, Math.round(inventory.armor))}, health ${Math.max(0, Math.round(inventory.health))}, shells ${Math.max(0, Math.round(inventory.shells))}`;
    if (elements.root.getAttribute("aria-label") !== label) elements.root.setAttribute("aria-label", label);
  }
}

export function applyQuakeInventoryDelta(inventory: QuakePlayerInventory, delta: QuakeInventoryDelta): void {
  if (delta.health !== undefined) {
    inventory.health = Math.min(delta.healthMax ?? 100, inventory.health + delta.health);
  }
  if (delta.armor !== undefined) {
    if (delta.armorType !== undefined) {
      inventory.armor = delta.armor;
      inventory.armorType = delta.armorType;
    } else {
      inventory.armor = Math.max(inventory.armor, delta.armor);
    }
  }
  inventory.shells = Math.min(QUAKE_MAX_SHELLS, inventory.shells + (delta.shells ?? 0));
  inventory.nails = Math.min(QUAKE_MAX_NAILS, inventory.nails + (delta.nails ?? 0));
  inventory.rockets = Math.min(QUAKE_MAX_ROCKETS, inventory.rockets + (delta.rockets ?? 0));
  inventory.cells = Math.min(QUAKE_MAX_CELLS, inventory.cells + (delta.cells ?? 0));
  if (delta.key) inventory.keys.add(delta.key);
}

export function applyQuakeDamageToInventory(
  inventory: QuakePlayerInventory,
  amount: number,
  options: QuakeInventoryDamageOptions = {},
): QuakeInventoryDamageResult {
  const rawDamage = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  if (rawDamage <= 0) {
    return {
      armorDamage: 0,
      changed: false,
      healthDamage: 0,
      rawDamage: 0,
    };
  }

  let armorDamage = 0;
  if (inventory.armor > 0 && inventory.armorType > 0) {
    armorDamage = Math.ceil(inventory.armorType * rawDamage);
    if (armorDamage >= inventory.armor) {
      armorDamage = inventory.armor;
      inventory.armorType = 0;
    }
    inventory.armor = Math.max(0, inventory.armor - armorDamage);
    if (inventory.armor <= 0) inventory.armorType = 0;
  }

  const healthDamage = options.applyHealth === false
    ? 0
    : Math.max(0, Math.ceil(rawDamage - armorDamage));
  if (healthDamage > 0) inventory.health = Math.max(0, inventory.health - healthDamage);

  return {
    armorDamage,
    changed: armorDamage > 0 || healthDamage > 0,
    healthDamage,
    rawDamage,
  };
}

export function activateQuakeInventoryPowerup(
  inventory: QuakePlayerInventory,
  powerup: QuakeInventoryPowerupBehavior,
  now = performance.now(),
): QuakeInventoryPowerupState | null {
  if (!Number.isFinite(powerup.durationSeconds) || powerup.durationSeconds <= 0) return null;
  if (
    powerup.itemFlagMutation &&
    (
      powerup.itemFlagMutation.expression !== "other.items | self.items" ||
      powerup.itemFlagMutation.sourceField !== "self.items" ||
      powerup.itemFlagMutation.targetField !== "other.items"
    )
  ) {
    return null;
  }
  const state: QuakeInventoryPowerupState = {
    active: true,
    activationField: powerup.activationField,
    finishedAt: now + powerup.durationSeconds * 1000,
    itemFlag: powerup.itemFlag,
    itemFlagExpression: powerup.itemFlagExpression,
    ...(powerup.itemFlagMutation ? { itemFlagMutation: powerup.itemFlagMutation } : {}),
  };
  inventory.itemFlags |= powerup.itemFlag;
  inventory.powerups[powerup.finishedField] = state;
  return state;
}

export function clearQuakeInventoryPowerup(
  inventory: QuakePlayerInventory,
  finishedField: string,
): QuakeInventoryPowerupState | null {
  const state = inventory.powerups[finishedField];
  if (!state) return null;
  delete inventory.powerups[finishedField];
  inventory.itemFlags &= ~state.itemFlag;
  return state;
}

export function clearQuakeInventoryPowerups(inventory: QuakePlayerInventory): void {
  inventory.powerups = {};
  inventory.itemFlags = 0;
}

function formatHudNumber(value: number): string {
  return String(Math.max(0, Math.min(999, Math.round(value)))).padStart(3, " ");
}

function createQuakeHudReadout(element: HTMLElement | null): QuakeHudReadout | null {
  if (!element) return null;
  return {
    element,
    digits: Array.from(element.querySelectorAll<HTMLElement>(".quake-hud-digit")),
    value: "",
  };
}

function cacheQuakeHudSlots(elements: QuakeHudElements): void {
  const root = elements.root;
  if (!root) return;
  root.style.setProperty("--quake-hud-icons-width", String(QUAKE_HUD_ICON_SHEET_WIDTH));
  for (const definition of QUAKE_HUD_SLOT_DEFINITIONS) {
    const slot = root.querySelector<HTMLElement>(`[data-quake-hud-slot="${definition.id}"]`);
    if (!slot) continue;
    slot.style.setProperty("--quake-hud-slot-source-x", String(definition.sourceX));
    slot.style.setProperty("--quake-hud-slot-source-y", String(definition.sourceY));
    slot.style.setProperty("--quake-hud-slot-x", String(definition.x));
    slot.style.setProperty("--quake-hud-slot-y", String(definition.y));
    slot.style.setProperty("--quake-hud-slot-width", String(definition.width));
    slot.style.setProperty("--quake-hud-slot-height", String(definition.height));
    slot.dataset.quakeHudQpic = definition.qpic;
    elements.slots[definition.id] = slot;
  }
}

function setHudValue(readout: QuakeHudReadout | null, value: string): void {
  if (!readout || readout.value === value) return;
  readout.value = value;
  const digits = readout.digits;
  for (let i = 0; i < digits.length; i++) {
    const digit = value[i] ?? " ";
    if (digit >= "0" && digit <= "9") {
      digits[i]?.style.setProperty("--quake-hud-digit-index", digit);
      if (digits[i]) digits[i].style.opacity = "1";
    } else {
      digits[i]?.style.removeProperty("--quake-hud-digit-index");
      if (digits[i]) digits[i].style.opacity = "0";
    }
  }
}

function syncQuakeHudArmorSlot(elements: QuakeHudElements, inventory: QuakePlayerInventory): void {
  const activeSlot = inventory.armor > 0 ? quakeHudArmorSlot(inventory.armorType) : null;
  setExclusiveHudSlot(elements, ["armor-green", "armor-yellow", "armor-red"], activeSlot);
}

function syncQuakeHudFaceSlot(elements: QuakeHudElements, inventory: QuakePlayerInventory): void {
  const invisible = quakeHudPowerupActive(inventory, QUAKE_HUD_POWERUP_FIELDS.invisibility);
  const invulnerable = quakeHudPowerupActive(inventory, QUAKE_HUD_POWERUP_FIELDS.invulnerability);
  const activeSlot = invisible && invulnerable
    ? "face-invisibility-invulnerability"
    : quakeHudPowerupActive(inventory, QUAKE_HUD_POWERUP_FIELDS.quad)
      ? "face-quad"
      : invulnerable
        ? "face-invulnerability"
        : invisible
          ? "face-invisibility"
          : "face-normal";
  setExclusiveHudSlot(
    elements,
    ["face-normal", "face-invisibility", "face-invulnerability", "face-invisibility-invulnerability", "face-quad"],
    activeSlot,
  );
}

function syncQuakeHudAmmoSlot(elements: QuakeHudElements, activeSlot: QuakeHudSlotId): void {
  setExclusiveHudSlot(elements, ["ammo-shells", "ammo-nails", "ammo-rockets", "ammo-cells"], activeSlot);
}

function setExclusiveHudSlot(
  elements: QuakeHudElements,
  slotIds: readonly QuakeHudSlotId[],
  activeSlot: QuakeHudSlotId | null,
): void {
  for (const slotId of slotIds) {
    setHudSlotActive(elements.slots[slotId], slotId === activeSlot);
  }
}

function setHudSlotActive(element: HTMLElement | undefined, active: boolean): void {
  if (!element || element.hidden === !active) return;
  element.hidden = !active;
}

function quakeHudArmorSlot(armorType: number): QuakeHudSlotId {
  if (armorType >= 0.8) return "armor-red";
  if (armorType >= 0.6) return "armor-yellow";
  return "armor-green";
}

function quakeHudPowerupActive(inventory: QuakePlayerInventory, finishedField: string): boolean {
  return Boolean(inventory.powerups[finishedField]);
}

function quakeStatusHudSlot(
  id: QuakeHudSlotId,
  qpic: string,
  sheetIndex: number,
  width: number,
  height: number,
  x: number,
  y: number,
): QuakeHudSlotDefinition {
  return quakeHudSlot(id, qpic, "status", sheetIndex, width, height, x, y + QUAKE_HUD_STATUS_ROW_Y);
}

function quakeInventoryHudSlot(
  id: QuakeHudSlotId,
  qpic: string,
  sheetIndex: number,
  width: number,
  height: number,
  x: number,
  y: number,
): QuakeHudSlotDefinition {
  return quakeHudSlot(id, qpic, "inventory", sheetIndex, width, height, x, y);
}

function quakeHudSlot(
  id: QuakeHudSlotId,
  qpic: string,
  row: "inventory" | "status",
  sheetIndex: number,
  width: number,
  height: number,
  x: number,
  y: number,
): QuakeHudSlotDefinition {
  return {
    id,
    qpic,
    row,
    sourceX: sheetIndex * QUAKE_HUD_ICON_SLOT_SIZE,
    sourceY: 0,
    width,
    height,
    x,
    y,
  };
}
