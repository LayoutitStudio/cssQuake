export type QuakeKey = "silver" | "gold";

export interface QuakePlayerInventory {
  health: number;
  armor: number;
  shells: number;
  nails: number;
  rockets: number;
  cells: number;
  keys: Set<QuakeKey>;
}

export interface QuakeInventoryDelta {
  health?: number;
  healthMax?: number;
  armor?: number;
  shells?: number;
  nails?: number;
  rockets?: number;
  cells?: number;
  key?: QuakeKey;
}

export interface QuakeHudElements {
  root: HTMLElement | null;
  armor: HTMLElement | null;
  health: HTMLElement | null;
  healthDamage: HTMLElement | null;
  ammo: HTMLElement | null;
  keys: HTMLElement | null;
}

export function createInitialInventory(): QuakePlayerInventory {
  return {
    health: 100,
    armor: 0,
    shells: 25,
    nails: 0,
    rockets: 0,
    cells: 0,
    keys: new Set(),
  };
}

export function syncQuakeHud(elements: QuakeHudElements, inventory: QuakePlayerInventory): void {
  const armor = formatHudNumber(inventory.armor);
  const health = formatHudNumber(inventory.health);
  const ammo = formatHudNumber(inventory.shells);
  setHudValue(elements.armor, armor);
  setHudValue(elements.health, health);
  setHudValue(elements.healthDamage, health);
  setHudValue(elements.ammo, ammo);
  if (elements.root) {
    setHudDatasetValue(elements.root, "state", inventory.health <= 25 ? "critical" : inventory.health <= 50 ? "hurt" : "ok");
    setHudFlag(elements.root, "silver", inventory.keys.has("silver"));
    setHudFlag(elements.root, "gold", inventory.keys.has("gold"));
    const label = `Quake status: armor ${Math.max(0, Math.round(inventory.armor))}, health ${Math.max(0, Math.round(inventory.health))}, shells ${Math.max(0, Math.round(inventory.shells))}`;
    if (elements.root.getAttribute("aria-label") !== label) elements.root.setAttribute("aria-label", label);
  }
}

export function applyQuakeInventoryDelta(inventory: QuakePlayerInventory, delta: QuakeInventoryDelta): void {
  if (delta.health !== undefined) {
    inventory.health = Math.min(delta.healthMax ?? 100, inventory.health + delta.health);
  }
  if (delta.armor !== undefined) {
    inventory.armor = Math.max(inventory.armor, delta.armor);
  }
  inventory.shells = Math.min(999, inventory.shells + (delta.shells ?? 0));
  inventory.nails = Math.min(999, inventory.nails + (delta.nails ?? 0));
  inventory.rockets = Math.min(999, inventory.rockets + (delta.rockets ?? 0));
  inventory.cells = Math.min(999, inventory.cells + (delta.cells ?? 0));
  if (delta.key) inventory.keys.add(delta.key);
}

function formatHudNumber(value: number): string {
  return String(Math.max(0, Math.min(999, Math.round(value)))).padStart(3, " ");
}

function setHudValue(element: HTMLElement | null, value: string): void {
  if (!element) return;
  const digits = element.querySelectorAll<HTMLElement>(".quake-hud-digit");
  for (let i = 0; i < digits.length; i++) {
    const digit = value[i] ?? " ";
    if (digit >= "0" && digit <= "9") {
      setHudDatasetValue(digits[i], "digit", digit);
    } else {
      removeHudDatasetValue(digits[i], "digit");
    }
  }
}

function setHudFlag(element: HTMLElement, flag: string, enabled: boolean): void {
  if (enabled) {
    setHudDatasetValue(element, flag, "true");
  } else {
    removeHudDatasetValue(element, flag);
  }
}

function setHudDatasetValue(element: HTMLElement, key: string, value: string): void {
  if (element.dataset[key] === value) return;
  element.dataset[key] = value;
}

function removeHudDatasetValue(element: HTMLElement, key: string): void {
  if (element.dataset[key] === undefined) return;
  delete element.dataset[key];
}
