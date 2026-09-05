import type { QuakeEntity, QuakeScene } from "../../types/quake";
import type { QuakeCollisionWorld } from "../collision";

/** Live reads shared by gameplay, presentation and debug; consumers cannot publish state. */
export interface QuakeSceneStateView {
  readonly scene: QuakeScene | null;
  readonly collisionWorld: QuakeCollisionWorld | null;
  readonly entities: ReadonlyMap<number, QuakeEntity>;
  readonly modelPivot: Readonly<{ x: number; y: number; z: number }>;
  readonly transitionSerial: number;
}

/** Publication belongs to the scene lifecycle, not to application callbacks. */
export interface QuakeSceneStateWriter {
  setCollisionWorld(world: QuakeCollisionWorld | null): void;
  setCurrentScene(scene: QuakeScene | null): void;
  setEntityIndex(index: Map<number, QuakeEntity>): void;
  setModelPivot(pivot: { x: number; y: number; z: number }): void;
  setTransitionSerial(value: number): void;
}

export function createQuakeSceneState(): {
  view: QuakeSceneStateView;
  writer: QuakeSceneStateWriter;
  advanceTransition(): void;
} {
  let scene: QuakeScene | null = null;
  let collisionWorld: QuakeCollisionWorld | null = null;
  let entities = new Map<number, QuakeEntity>();
  let modelPivot = { x: 0, y: 0, z: 0 };
  let transitionSerial = 0;
  return {
    view: {
      get scene() { return scene; },
      get collisionWorld() { return collisionWorld; },
      get entities() { return entities; },
      get modelPivot() { return modelPivot; },
      get transitionSerial() { return transitionSerial; },
    },
    writer: {
      setCollisionWorld: value => { collisionWorld = value; },
      setCurrentScene: value => { scene = value; },
      setEntityIndex: value => { entities = value; },
      setModelPivot: value => { modelPivot = value; },
      setTransitionSerial: value => { transitionSerial = value; },
    },
    advanceTransition: () => { transitionSerial++; },
  };
}
