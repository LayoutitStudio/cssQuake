import type { QuakeMoversProgressSnapshot } from "./movers";
import type { QuakePickupProgressSnapshot } from "./pickups";
import type { QuakePlayerProgressSnapshot } from "./player";
import type { QuakeShootablesProgressSnapshot } from "./shootables";
import type { QuakeTargetsProgressSnapshot } from "./targets";

const CSSQUAKE_SAVE_SLOT_VERSION = 1;
const CSSQUAKE_SAVE_SLOT_KEY = "cssquake.save.v1";

export interface CssQuakeProgressViewSnapshot {
  origin: [number, number, number];
  rotX: number;
  rotY: number;
}

export interface CssQuakeDamageableBrushProgressEntry {
  entityIndex: number;
  health: number;
}

export interface CssQuakeDamageableBrushProgressSnapshot {
  brushes: CssQuakeDamageableBrushProgressEntry[];
}

export interface CssQuakeSaveSlotV1 {
  version: typeof CSSQUAKE_SAVE_SLOT_VERSION;
  savedAt: number;
  mapName: string;
  view: CssQuakeProgressViewSnapshot;
  damageableBrushes?: CssQuakeDamageableBrushProgressSnapshot;
  player: QuakePlayerProgressSnapshot;
  pickups: QuakePickupProgressSnapshot;
  shootables: QuakeShootablesProgressSnapshot;
  movers: QuakeMoversProgressSnapshot;
  targets: QuakeTargetsProgressSnapshot;
}

type CssQuakeSaveSlotInput = Omit<CssQuakeSaveSlotV1, "version" | "savedAt">;

export function createCssQuakeSaveSlot(input: CssQuakeSaveSlotInput): CssQuakeSaveSlotV1 {
  return {
    version: CSSQUAKE_SAVE_SLOT_VERSION,
    savedAt: Date.now(),
    ...input,
  };
}

export function readCssQuakeSaveSlot(): CssQuakeSaveSlotV1 | null {
  const storage = cssQuakeProgressStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(CSSQUAKE_SAVE_SLOT_KEY);
    if (!raw) return null;
    const slot = JSON.parse(raw) as unknown;
    return isCssQuakeSaveSlotV1(slot) ? slot : null;
  } catch (error) {
    console.warn("Could not read cssQuake save slot.", error);
    return null;
  }
}

export function writeCssQuakeSaveSlot(slot: CssQuakeSaveSlotV1): void {
  const storage = cssQuakeProgressStorage();
  if (!storage) throw new Error("cssQuake progress storage is unavailable.");
  storage.setItem(CSSQUAKE_SAVE_SLOT_KEY, JSON.stringify(slot));
}

function cssQuakeProgressStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isCssQuakeSaveSlotV1(value: unknown): value is CssQuakeSaveSlotV1 {
  if (!value || typeof value !== "object") return false;
  const slot = value as Partial<CssQuakeSaveSlotV1>;
  return slot.version === CSSQUAKE_SAVE_SLOT_VERSION &&
    typeof slot.mapName === "string" &&
    slot.mapName.trim().length > 0 &&
    Number.isFinite(slot.savedAt) &&
    isCssQuakeProgressViewSnapshot(slot.view) &&
    isCssQuakeObject(slot.player) &&
    isCssQuakeObject(slot.pickups) &&
    isCssQuakeObject(slot.shootables) &&
    isCssQuakeObject(slot.movers) &&
    isCssQuakeObject(slot.targets);
}

function isCssQuakeObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function isCssQuakeProgressViewSnapshot(value: unknown): value is CssQuakeProgressViewSnapshot {
  if (!value || typeof value !== "object") return false;
  const view = value as Partial<CssQuakeProgressViewSnapshot>;
  return Array.isArray(view.origin) &&
    view.origin.length === 3 &&
    view.origin.every(Number.isFinite) &&
    Number.isFinite(view.rotX) &&
    Number.isFinite(view.rotY);
}
