import type { createPolyFirstPersonControls, createPolyScene } from "@layoutit/polycss";

import type { QuakeEntity, QuakeScene } from "../../types/quake";
import type { QuakeCollisionWorld } from "../collision";
import type { createQuakeSoundController } from "../audio";
import type { QuakeDamageableBrushFlow } from "./damageableBrushFlow";
import type { createQuakeMenuController } from "../menu";
import type { createQuakeMoversController } from "../movers";
import type { createQuakePickupController } from "../pickups";
import type { createQuakePlayerController } from "../player";
import type { QuakeShootablesController } from "../shootables";
import type { createQuakeTargetsController } from "../targets";
import type { createQuakeTriggersController } from "../triggers";
import type { createQuakeViewmodelController } from "../viewmodel";
import type { createQuakeWeaponsController } from "../weapons";
import type { createQuakeWorldController } from "../world";

export type QuakeAppSceneHandle = ReturnType<typeof createPolyScene>;
export type QuakeAppControlsHandle = ReturnType<typeof createPolyFirstPersonControls>;
export type QuakeAppAudioController = ReturnType<typeof createQuakeSoundController>;
export type QuakeAppMenuController = ReturnType<typeof createQuakeMenuController>;
export type QuakeAppMoversController = ReturnType<typeof createQuakeMoversController>;
export type QuakeAppPickupController = ReturnType<typeof createQuakePickupController>;
export type QuakeAppPlayerController = ReturnType<typeof createQuakePlayerController>;
export type QuakeAppTargetsController = ReturnType<typeof createQuakeTargetsController>;
export type QuakeAppTriggersController = ReturnType<typeof createQuakeTriggersController>;
export type QuakeAppViewmodelController = ReturnType<typeof createQuakeViewmodelController>;
export type QuakeAppWeaponsController = ReturnType<typeof createQuakeWeaponsController>;
export type QuakeAppWorldController = ReturnType<typeof createQuakeWorldController>;

export interface QuakeAppRuntimeContext {
  readonly scene: QuakeAppSceneHandle;
  readonly controls: QuakeAppControlsHandle;
  readonly host: HTMLElement;
  readonly sceneElement: HTMLElement;
  readonly controllers: {
    readonly audio: QuakeAppAudioController;
    readonly damageableBrushes: QuakeDamageableBrushFlow;
    readonly menu: QuakeAppMenuController;
    readonly movers: QuakeAppMoversController;
    readonly pickups: () => QuakeAppPickupController;
    readonly player: () => QuakeAppPlayerController;
    readonly shootables: QuakeShootablesController;
    readonly targets: QuakeAppTargetsController;
    readonly triggers: QuakeAppTriggersController;
    readonly viewmodel: QuakeAppViewmodelController;
    readonly weapons: QuakeAppWeaponsController;
    readonly world: QuakeAppWorldController;
  };
  readonly session: {
    readonly currentMapName: () => string;
    readonly currentScene: () => QuakeScene | null;
    readonly collisionWorld: () => QuakeCollisionWorld | null;
    readonly entities: () => ReadonlyMap<number, QuakeEntity>;
    readonly isDisposed: () => boolean;
    readonly isLoading: () => boolean;
    readonly transitionSerial: () => number;
  };
  readonly gameplay: {
    readonly isPaused: () => boolean;
    readonly resumeForDebugInput: () => void;
    readonly runWithDebugInput: <T>(callback: () => T) => T;
    readonly setPaused: (paused: boolean) => void;
    readonly isPlayerDead: () => boolean;
    readonly isStarted: () => boolean;
    readonly setStarted: (started: boolean) => void;
  };
  readonly multiplayer?: {
    readonly snapshot: () => Record<string, unknown>;
  };
}

export function createQuakeAppRuntimeContext(context: QuakeAppRuntimeContext): QuakeAppRuntimeContext {
  return context;
}
