import type { QuakeMapLoadResult } from "./mapLoadOwnership";
import {
  createCssQuakeSaveSlot as createCssQuakeSaveSlotV1,
  readCssQuakeSaveSlot,
  writeCssQuakeSaveSlot,
  type CssQuakeSaveSlotV1,
} from "../saveLoad";
import type { QuakeMapLoadOptions } from "./session";

type CssQuakeSaveSlotInput = Parameters<typeof createCssQuakeSaveSlotV1>[0];

export interface CssQuakeSaveSessionController {
  canLoad(): boolean;
  canSave(): boolean;
  load(): Promise<QuakeMapLoadResult>;
  save(): void;
}

export interface CssQuakeSaveSessionOptions {
  activeWeaponView(): { rotX: number | undefined; rotY: number | undefined };
  canSaveNow(): boolean;
  clearAttackInput(): void;
  clearBonusOverlay(): void;
  clearCrouchInput(): void;
  clearCrosshairHit(): void;
  clearCrosshairTarget(): void;
  clearLevelComplete(): void;
  clearMegahealthRot(): void;
  clearMobileMoveInput(): void;
  clearMoveInput(): void;
  clearPlayerDeath(): void;
  clearPowerupTimers(): void;
  clearWeaponViewPunch(): void;
  currentMapName(): string;
  currentLoad(): QuakeMapLoadResult;
  currentOrigin(): [number, number, number];
  hasCurrentScene(mapName?: string): boolean;
  loadMap(mapName: string, options?: QuakeMapLoadOptions): Promise<QuakeMapLoadResult>;
  mapExists(mapName: string): boolean;
  notify(message: string): void;
  resetActiveTriggers(): void;
  resetWeapons(): void;
  reschedulePowerupTimers(): void;
  restoreDamageableBrushes(snapshot: CssQuakeSaveSlotV1["damageableBrushes"]): void;
  restoreMovers(snapshot: CssQuakeSaveSlotV1["movers"]): void;
  restorePickups(snapshot: CssQuakeSaveSlotV1["pickups"]): void;
  restorePlayer(snapshot: CssQuakeSaveSlotV1["player"]): void;
  restoreShootables(snapshot: CssQuakeSaveSlotV1["shootables"]): void;
  restoreTargets(snapshot: CssQuakeSaveSlotV1["targets"]): void;
  setGameplayStarted(started: boolean): void;
  snapshotDamageableBrushes(): CssQuakeSaveSlotInput["damageableBrushes"];
  snapshotMovers(): CssQuakeSaveSlotInput["movers"];
  snapshotPickups(): CssQuakeSaveSlotInput["pickups"];
  snapshotPlayer(): CssQuakeSaveSlotInput["player"];
  snapshotShootables(): CssQuakeSaveSlotInput["shootables"];
  snapshotTargets(): CssQuakeSaveSlotInput["targets"];
  syncCrosshairTarget(): void;
  syncHud(): void;
  syncSceneCameraAt(origin: [number, number, number], rotX: number, rotY: number): void;
  syncShootablesVisibility(origin: [number, number, number], force: boolean): void;
  syncViewmodel(): void;
  syncWorldVisibility(force: boolean): void;
  trace(name: string, details: Record<string, unknown>): void;
}

export function createCssQuakeSaveSession(options: CssQuakeSaveSessionOptions): CssQuakeSaveSessionController {
  function canLoad(): boolean {
    const slot = readCssQuakeSaveSlot();
    return Boolean(slot && options.mapExists(slot.mapName));
  }

  function canSave(): boolean {
    return options.canSaveNow();
  }

  function createSaveSlot(): CssQuakeSaveSlotV1 | null {
    if (!canSave()) return null;
    const origin = options.currentOrigin();
    const view = options.activeWeaponView();
    return createCssQuakeSaveSlotV1({
      mapName: options.currentMapName(),
      view: {
        origin: [...origin] as [number, number, number],
        rotX: Number.isFinite(view.rotX) ? view.rotX as number : 88,
        rotY: Number.isFinite(view.rotY) ? view.rotY as number : 270,
      },
      damageableBrushes: options.snapshotDamageableBrushes(),
      player: options.snapshotPlayer(),
      pickups: options.snapshotPickups(),
      shootables: options.snapshotShootables(),
      movers: options.snapshotMovers(),
      targets: options.snapshotTargets(),
    });
  }

  function save(): void {
    const slot = createSaveSlot();
    if (!slot) {
      options.notify("Nothing to save");
      return;
    }
    try {
      writeCssQuakeSaveSlot(slot);
      options.trace("progress-save", { mapName: slot.mapName, savedAt: slot.savedAt });
      options.notify("Game saved");
    } catch (error) {
      console.error("Could not save cssQuake progress.", error);
      options.notify("Could not save game");
    }
  }

  async function load(): Promise<QuakeMapLoadResult> {
    const slot = readCssQuakeSaveSlot();
    if (!slot || !options.mapExists(slot.mapName)) {
      options.notify("No saved game");
      return false;
    }
    options.clearAttackInput();
    options.clearMoveInput();
    options.clearMobileMoveInput();
    let loaded = options.currentLoad();
    if (!loaded || !options.hasCurrentScene(slot.mapName)) {
      loaded = await options.loadMap(slot.mapName, {
        loadingStatus: "Loading save",
        resumeGameplay: false,
        urlMode: "push",
      });
    }
    if (!loaded || !loaded.isCurrent() || !options.hasCurrentScene(slot.mapName)) return false;
    applySaveSlot(slot);
    options.trace("progress-load", { mapName: slot.mapName, savedAt: slot.savedAt });
    options.notify("Game loaded");
    return loaded;
  }

  function applySaveSlot(slot: CssQuakeSaveSlotV1): void {
    options.clearLevelComplete();
    options.clearPlayerDeath();
    options.clearAttackInput();
    options.clearMoveInput();
    options.clearMobileMoveInput();
    options.clearCrouchInput();
    options.clearWeaponViewPunch();
    options.clearCrosshairHit();
    options.clearCrosshairTarget();
    options.clearBonusOverlay();
    options.clearMegahealthRot();
    options.clearPowerupTimers();
    options.resetActiveTriggers();
    options.resetWeapons();
    options.restoreTargets(slot.targets);
    options.restoreDamageableBrushes(slot.damageableBrushes);
    options.restoreMovers(slot.movers);
    options.restorePickups(slot.pickups);
    options.restoreShootables(slot.shootables);
    options.restorePlayer(slot.player);
    options.syncSceneCameraAt(options.currentOrigin(), slot.view.rotX, slot.view.rotY);
    options.reschedulePowerupTimers();
    options.syncHud();
    options.syncViewmodel();
    options.syncWorldVisibility(true);
    options.syncShootablesVisibility(options.currentOrigin(), true);
    options.syncCrosshairTarget();
    options.setGameplayStarted(true);
  }

  return {
    canLoad,
    canSave,
    load,
    save,
  };
}
