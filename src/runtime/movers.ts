import type { Vec3 } from "@layoutit/polycss";

import type { QuakeEntity, QuakePreparedModel } from "../prepare/scene";
import type { QuakeTouchedTrigger } from "./collision";
import {
  COLLISION_EPSILON,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  QUAKE_COLLISION_UNIT_SCALE,
  QUAKE_DOOR_DONT_LINK,
  QUAKE_DOOR_START_OPEN,
  QUAKE_DOOR_TOGGLE,
  QUAKE_DOOR_TRIGGER_XY,
  QUAKE_DOOR_TRIGGER_Z,
  QUAKE_SECRET_OPEN_ONCE,
} from "./constants";
import { quakeEntityNumber, quakeEntitySpawnflags } from "./entities";
import { distanceSq3, normalizeVec3, subtractVec3 } from "./math";

export type QuakeMoverMode = "closed" | "opening" | "open" | "closing";
export type QuakeMoverKind = "door" | "secret-door" | "button" | "plat";

export interface QuakeMoverState {
  entity: QuakeEntity;
  model: QuakePreparedModel;
  kind: QuakeMoverKind;
  offset: Vec3;
  lastOffset: Vec3;
  closedOffset: Vec3;
  openOffset: Vec3;
  mode: QuakeMoverMode;
  speed: number;
  wait: number;
  waitUntil: number;
  once: boolean;
  toggle: boolean;
  linkedEntityIndexes: number[];
  targetedPlatPrimed: boolean;
  targetFired: boolean;
}

interface QuakeDoorTriggerField {
  entityIndex: number;
  modelIndex: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface QuakeMoversControllerOptions {
  applyState: (state: QuakeMoverState, movePlayer: boolean) => void;
  fireTarget: (targetname: string, sourceEntityIndex?: number) => void;
  groupUnlocked: (state: QuakeMoverState) => boolean;
  playerBlocks: (state: QuakeMoverState, nextOffset: Vec3, delta: Vec3) => boolean;
}

export interface QuakeMoversController {
  clear: () => void;
  setup: (
    entities: QuakeEntity[],
    models: QuakePreparedModel[],
    pivot: { x: number; y: number; z: number },
  ) => void;
  get: (entityIndex: number) => QuakeMoverState | undefined;
  activateEntity: (entityIndex: number, sourceEntityIndex?: number) => boolean;
  activateGroup: (state: QuakeMoverState) => boolean;
  touchingDoorTriggerFields: (origin: [number, number, number], eyeHeight: number) => QuakeTouchedTrigger[];
}

export function createQuakeMoversController(options: QuakeMoversControllerOptions): QuakeMoversController {
  let movers = new Map<number, QuakeMoverState>();
  let doorTriggerFields: QuakeDoorTriggerField[] = [];
  let pivot = { x: 0, y: 0, z: 0 };
  let moverFrame: number | null = null;
  let moverTime = 0;

  const clear = (): void => {
    if (moverFrame !== null) {
      window.cancelAnimationFrame(moverFrame);
      moverFrame = null;
    }
    movers = new Map();
    doorTriggerFields = [];
    moverTime = 0;
    pivot = { x: 0, y: 0, z: 0 };
  };

  const setup = (
    entities: QuakeEntity[],
    models: QuakePreparedModel[],
    nextPivot: { x: number; y: number; z: number },
  ): void => {
    clear();
    pivot = nextPivot;
    const modelsByIndex = new Map(models.map((model) => [model.index, model]));
    for (const entity of entities) {
      if (entity.modelIndex === undefined || !isQuakeMoverEntity(entity.classname)) continue;
      const model = modelsByIndex.get(entity.modelIndex);
      if (!model) continue;
      const state = createQuakeMoverState(entity, model);
      if (!state) continue;
      movers.set(entity.index, state);
    }
    linkDoorGroups();
    setupDoorTriggerFields();
    for (const state of movers.values()) options.applyState(state, false);
  };

  const activateEntity = (entityIndex: number, sourceEntityIndex?: number): boolean => {
    const mover = movers.get(entityIndex);
    if (mover?.kind === "plat" && mover.targetedPlatPrimed && sourceEntityIndex === undefined) return false;
    return mover ? activateGroup(mover) : false;
  };

  const activateGroup = (state: QuakeMoverState): boolean => {
    if (!options.groupUnlocked(state)) return false;
    let activated = false;
    for (const entityIndex of state.linkedEntityIndexes) {
      const linked = movers.get(entityIndex);
      if (linked && activateMover(linked)) activated = true;
    }
    return activated;
  };

  const activateMover = (state: QuakeMoverState): boolean => {
    if (state.kind === "plat") return activatePlat(state);

    if (state.mode === "opening") return false;
    if (state.mode === "open") {
      if (state.toggle) {
        state.mode = "closing";
        startLoop();
        return true;
      }
      if (!state.once && state.wait >= 0) state.waitUntil = performance.now() + state.wait * 1000;
      return false;
    }
    if (state.mode === "closing") {
      state.mode = "opening";
      fireButtonTarget(state);
      startLoop();
      return true;
    }
    state.mode = "opening";
    fireButtonTarget(state);
    startLoop();
    return true;
  };

  const activatePlat = (state: QuakeMoverState): boolean => {
    if (state.targetedPlatPrimed && state.mode === "open") {
      state.targetedPlatPrimed = false;
      state.mode = "closing";
      startLoop();
      return true;
    }
    if (state.mode === "closed") {
      state.mode = "opening";
      startLoop();
      return true;
    }
    if (state.mode === "open") {
      state.waitUntil = performance.now() + 1000;
    }
    return false;
  };

  const fireButtonTarget = (state: QuakeMoverState): void => {
    if (state.kind !== "button" || state.targetFired || !state.entity.properties.target) return;
    state.targetFired = true;
    options.fireTarget(state.entity.properties.target, state.entity.index);
  };

  const startLoop = (): void => {
    if (moverFrame !== null) return;
    moverTime = performance.now();
    moverFrame = window.requestAnimationFrame(tickMovers);
  };

  const tickMovers = (now: number): void => {
    const dt = Math.min(0.05, moverTime ? (now - moverTime) / 1000 : 0.0167);
    moverTime = now;
    let active = false;

    for (const state of movers.values()) {
      const changed = updateMover(state, now, dt);
      if (changed) options.applyState(state, true);
      if (state.mode === "opening" || state.mode === "closing" || (state.mode === "open" && state.waitUntil !== Infinity)) {
        active = true;
      }
    }

    if (active) {
      moverFrame = window.requestAnimationFrame(tickMovers);
    } else {
      moverFrame = null;
      moverTime = 0;
    }
  };

  const updateMover = (state: QuakeMoverState, now: number, dt: number): boolean => {
    if (distanceSq3(state.openOffset, state.closedOffset) <= COLLISION_EPSILON) return false;

    if (state.mode === "opening") {
      const next = moveOffsetToward(state.offset, state.openOffset, state.speed * dt);
      const delta = subtractVec3(next, state.offset);
      const changed = distanceSq3(next, state.offset) > COLLISION_EPSILON;
      if (changed && options.playerBlocks(state, next, delta)) {
        handleBlockedMover(state, now);
        return true;
      }
      state.offset = next;
      if (distanceSq3(state.offset, state.openOffset) <= COLLISION_EPSILON) {
        state.offset = [...state.openOffset] as Vec3;
        state.mode = "open";
        state.waitUntil = state.once || state.wait < 0 || state.toggle ? Infinity : now + state.wait * 1000;
      }
      return changed || state.mode === "open";
    }

    if (state.mode === "open") {
      if (state.waitUntil !== Infinity && now >= state.waitUntil) {
        state.mode = "closing";
        return true;
      }
      return false;
    }

    if (state.mode === "closing") {
      const next = moveOffsetToward(state.offset, state.closedOffset, state.speed * dt);
      const delta = subtractVec3(next, state.offset);
      const changed = distanceSq3(next, state.offset) > COLLISION_EPSILON;
      if (changed && options.playerBlocks(state, next, delta)) {
        handleBlockedMover(state, now);
        return true;
      }
      state.offset = next;
      if (distanceSq3(state.offset, state.closedOffset) <= COLLISION_EPSILON) {
        state.offset = [...state.closedOffset] as Vec3;
        state.mode = "closed";
        state.targetFired = false;
      }
      return changed || state.mode === "closed";
    }

    return false;
  };

  const linkDoorGroups = (): void => {
    const doors = [...movers.values()].filter((state) =>
      state.kind === "door" && !(quakeEntitySpawnflags(state.entity) & QUAKE_DOOR_DONT_LINK)
    );
    const groups = new Map<number, number>();
    for (const door of doors) groups.set(door.entity.index, door.entity.index);

    const find = (index: number): number => {
      const parent = groups.get(index) ?? index;
      if (parent === index) return parent;
      const root = find(parent);
      groups.set(index, root);
      return root;
    };
    const join = (a: number, b: number): void => {
      const ar = find(a);
      const br = find(b);
      if (ar !== br) groups.set(br, ar);
    };

    for (let i = 0; i < doors.length; i++) {
      const a = doors[i];
      if (!a) continue;
      for (let j = i + 1; j < doors.length; j++) {
        const b = doors[j];
        if (!b) continue;
        if (moverBoundsTouch(moverBounds(a, a.closedOffset, pivot), moverBounds(b, b.closedOffset, pivot))) {
          join(a.entity.index, b.entity.index);
        }
      }
    }

    const grouped = new Map<number, number[]>();
    for (const door of doors) {
      const root = find(door.entity.index);
      const bucket = grouped.get(root);
      if (bucket) {
        bucket.push(door.entity.index);
      } else {
        grouped.set(root, [door.entity.index]);
      }
    }
    for (const indexes of grouped.values()) {
      for (const index of indexes) {
        const state = movers.get(index);
        if (state) state.linkedEntityIndexes = indexes;
      }
    }
  };

  const setupDoorTriggerFields = (): void => {
    doorTriggerFields = [];
    const visited = new Set<number>();
    for (const state of movers.values()) {
      if (state.kind !== "door" || visited.has(state.entity.index)) continue;
      const linked = state.linkedEntityIndexes
        .map((entityIndex) => movers.get(entityIndex))
        .filter((item): item is QuakeMoverState => Boolean(item));
      for (const linkedState of linked) visited.add(linkedState.entity.index);
      if (!linked.length || !quakeDoorGroupCanSpawnTrigger(linked)) continue;
      const first = linked[0];
      if (!first) continue;
      const bounds = linked.reduce(
        (acc, linkedState) => unionMoverBounds(acc, moverBounds(linkedState, linkedState.closedOffset, pivot)),
        moverBounds(first, first.closedOffset, pivot),
      );
      doorTriggerFields.push({
        entityIndex: state.entity.index,
        modelIndex: state.model.index,
        minX: bounds.minX - QUAKE_DOOR_TRIGGER_XY,
        maxX: bounds.maxX + QUAKE_DOOR_TRIGGER_XY,
        minY: bounds.minY - QUAKE_DOOR_TRIGGER_XY,
        maxY: bounds.maxY + QUAKE_DOOR_TRIGGER_XY,
        minZ: bounds.minZ - QUAKE_DOOR_TRIGGER_Z,
        maxZ: bounds.maxZ + QUAKE_DOOR_TRIGGER_Z,
      });
    }
  };

  const touchingDoorTriggerFields = (
    origin: [number, number, number],
    eyeHeight: number,
  ): QuakeTouchedTrigger[] => {
    if (!doorTriggerFields.length) return [];
    const minX = origin[0] - PLAYER_RADIUS;
    const maxX = origin[0] + PLAYER_RADIUS;
    const minY = origin[1] - PLAYER_RADIUS;
    const maxY = origin[1] + PLAYER_RADIUS;
    const minZ = origin[2] - eyeHeight;
    const maxZ = minZ + PLAYER_HEIGHT;
    const out: QuakeTouchedTrigger[] = [];
    for (const field of doorTriggerFields) {
      if (
        maxX < field.minX || minX > field.maxX ||
        maxY < field.minY || minY > field.maxY ||
        maxZ < field.minZ || minZ > field.maxZ
      ) continue;
      out.push({
        entityIndex: field.entityIndex,
        modelIndex: field.modelIndex,
        classname: "func_door",
        contact: "door-trigger",
      });
    }
    return out;
  };

  return {
    clear,
    setup,
    get: (entityIndex: number) => movers.get(entityIndex),
    activateEntity,
    activateGroup,
    touchingDoorTriggerFields,
  };
}

function isQuakeMoverEntity(classname: string): boolean {
  return classname === "func_button" ||
    classname === "func_door" ||
    classname === "func_door_secret" ||
    classname === "func_plat";
}

export function quakeButtonIsPressed(state: QuakeMoverState): boolean {
  return state.mode === "opening" || state.mode === "open";
}

function quakeMoverDefaultSpeed(classname: string): number {
  if (classname === "func_plat") return 150;
  if (classname === "func_button") return 40;
  return 100;
}

function quakeMoverDefaultWait(classname: string): number {
  if (classname === "func_button") return 1;
  if (classname === "func_plat") return 3;
  if (classname === "func_door_secret") return 5;
  return 3;
}

function createQuakeMoverState(entity: QuakeEntity, model: QuakePreparedModel): QuakeMoverState | null {
  const kind = quakeMoverKind(entity.classname);
  if (!kind) return null;

  const closedOffset: Vec3 = [0, 0, 0];
  let openOffset: Vec3;
  let initialOffset: Vec3 = closedOffset;
  let initialMode: QuakeMoverMode = "closed";
  let targetedPlatPrimed = false;
  const spawnflags = quakeEntitySpawnflags(entity);
  const wait = quakeEntityNumber(entity, "wait", quakeMoverDefaultWait(entity.classname));

  if (kind === "plat") {
    const bottomOffset = quakePlatBottomOffset(entity, model);
    const startsTop = Boolean(entity.properties.targetname);
    openOffset = [0, 0, 0];
    closedOffset[0] = bottomOffset[0];
    closedOffset[1] = bottomOffset[1];
    closedOffset[2] = bottomOffset[2];
    initialOffset = startsTop ? [...openOffset] as Vec3 : [...closedOffset] as Vec3;
    initialMode = startsTop ? "open" : "closed";
    targetedPlatPrimed = startsTop;
  } else {
    openOffset = quakeMoverTravelOffset(entity, model);
    if (kind === "door" && (spawnflags & QUAKE_DOOR_START_OPEN)) {
      closedOffset[0] = openOffset[0];
      closedOffset[1] = openOffset[1];
      closedOffset[2] = openOffset[2];
      openOffset = [0, 0, 0];
      initialOffset = [...closedOffset] as Vec3;
    }
  }

  if (distanceSq3(openOffset, closedOffset) <= COLLISION_EPSILON) return null;
  return {
    entity,
    model,
    kind,
    offset: [...initialOffset] as Vec3,
    lastOffset: [...initialOffset] as Vec3,
    closedOffset,
    openOffset,
    mode: initialMode,
    speed: quakeEntityNumber(entity, "speed", quakeMoverDefaultSpeed(entity.classname)) * QUAKE_COLLISION_UNIT_SCALE,
    wait,
    waitUntil: initialMode === "open" && kind === "plat" ? Infinity : 0,
    once: wait < 0 || (kind === "secret-door" && Boolean(spawnflags & QUAKE_SECRET_OPEN_ONCE)),
    toggle: kind === "door" && Boolean(spawnflags & QUAKE_DOOR_TOGGLE),
    linkedEntityIndexes: [entity.index],
    targetedPlatPrimed,
    targetFired: false,
  };
}

function quakeMoverKind(classname: string): QuakeMoverKind | null {
  if (classname === "func_button") return "button";
  if (classname === "func_door") return "door";
  if (classname === "func_door_secret") return "secret-door";
  if (classname === "func_plat") return "plat";
  return null;
}

function quakePlatBottomOffset(entity: QuakeEntity, model: QuakePreparedModel): Vec3 {
  const height = quakeEntityNumber(
    entity,
    "height",
    Math.max(0, model.maxs.z - model.mins.z - 8),
  );
  return [0, 0, -height * QUAKE_COLLISION_UNIT_SCALE];
}

function quakeMoverTravelOffset(entity: QuakeEntity, model: QuakePreparedModel): Vec3 {
  const direction = quakeEntityMoveDirection(entity);
  const lip = quakeEntityNumber(entity, "lip", entity.classname === "func_button" ? 4 : 8);
  const size = {
    x: Math.max(0, model.maxs.x - model.mins.x),
    y: Math.max(0, model.maxs.y - model.mins.y),
    z: Math.max(0, model.maxs.z - model.mins.z),
  };
  const distance = Math.max(
    0,
    Math.abs(direction[0]) * size.x + Math.abs(direction[1]) * size.y + Math.abs(direction[2]) * size.z - lip,
  );
  return [
    direction[0] * distance * QUAKE_COLLISION_UNIT_SCALE,
    direction[1] * distance * QUAKE_COLLISION_UNIT_SCALE,
    direction[2] * distance * QUAKE_COLLISION_UNIT_SCALE,
  ];
}

function quakeEntityMoveDirection(entity: QuakeEntity): Vec3 {
  const angle = quakeEntityNumber(entity, "angle", entity.angle ?? 0);
  if (angle === -1) return [0, 0, 1];
  if (angle === -2) return [0, 0, -1];
  const radians = (angle * Math.PI) / 180;
  return normalizeVec3([Math.cos(radians), Math.sin(radians), 0]);
}

function quakeDoorGroupCanSpawnTrigger(states: QuakeMoverState[]): boolean {
  return states.every((state) => {
    return !state.entity.properties.targetname &&
      !state.entity.properties.health;
  });
}

function unionMoverBounds(
  a: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  b: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

function moverBounds(
  state: QuakeMoverState,
  offset: Vec3,
  pivot: { x: number; y: number; z: number },
): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  return {
    minX: (state.model.mins.x - pivot.x) * QUAKE_COLLISION_UNIT_SCALE + offset[0],
    maxX: (state.model.maxs.x - pivot.x) * QUAKE_COLLISION_UNIT_SCALE + offset[0],
    minY: (state.model.mins.y - pivot.y) * QUAKE_COLLISION_UNIT_SCALE + offset[1],
    maxY: (state.model.maxs.y - pivot.y) * QUAKE_COLLISION_UNIT_SCALE + offset[1],
    minZ: (state.model.mins.z - pivot.z) * QUAKE_COLLISION_UNIT_SCALE + offset[2],
    maxZ: (state.model.maxs.z - pivot.z) * QUAKE_COLLISION_UNIT_SCALE + offset[2],
  };
}

function moverBoundsTouch(
  a: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  b: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
): boolean {
  const gap = 1 * QUAKE_COLLISION_UNIT_SCALE;
  return a.minX <= b.maxX + gap && a.maxX + gap >= b.minX &&
    a.minY <= b.maxY + gap && a.maxY + gap >= b.minY &&
    a.minZ <= b.maxZ + gap && a.maxZ + gap >= b.minZ;
}

function moveOffsetToward(offset: Vec3, target: Vec3, maxStep: number): Vec3 {
  const delta = subtractVec3(target, offset);
  const distance = Math.hypot(delta[0], delta[1], delta[2]);
  if (distance <= Math.max(COLLISION_EPSILON, maxStep)) return [...target] as Vec3;
  const scale = maxStep / distance;
  return [
    offset[0] + delta[0] * scale,
    offset[1] + delta[1] * scale,
    offset[2] + delta[2] * scale,
  ];
}

function handleBlockedMover(state: QuakeMoverState, now: number): void {
  if (state.kind === "plat") {
    state.mode = state.mode === "opening" ? "closing" : "opening";
    state.waitUntil = 0;
    return;
  }
  if (state.kind === "door" || state.kind === "secret-door") {
    state.mode = state.mode === "closing" ? "opening" : "closing";
    state.waitUntil = state.mode === "closing" ? 0 : now + 0.2 * 1000;
  }
}
