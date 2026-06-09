import type { Vec3 } from "@layoutit/polycss";

import type {
  QuakeGameLogicFacts,
  QuakeGameLogicResolvedFuncButtonFact,
  QuakeGameLogicResolvedFuncDoorFact,
  QuakeGameLogicResolvedFuncPlatFact,
  QuakeGameLogicResolvedFuncTrainFact,
} from "../prepare/gameLogicFacts";
import { indexQuakeGameLogicEntityFacts } from "../prepare/gameLogicFacts";
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
export type QuakeMoverKind = "door" | "secret-door" | "button" | "plat" | "train";

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
  prebakedButton?: QuakeGameLogicResolvedFuncButtonFact;
  prebakedDoor?: QuakeGameLogicResolvedFuncDoorFact;
  prebakedPlat?: QuakeGameLogicResolvedFuncPlatFact;
  prebakedTrain?: QuakeGameLogicResolvedFuncTrainFact;
  pathBaseOrigin?: Vec3;
  pathCurrentTarget?: string;
  pathNextTarget?: string;
}

export interface QuakeMoverDebugState {
  entityIndex: number;
  classname: string;
  kind: QuakeMoverKind;
  mode: QuakeMoverMode;
  offset: Vec3;
  closedOffset: Vec3;
  openOffset: Vec3;
  speed: number;
  wait: number;
  targetedPlatPrimed: boolean;
}

export interface QuakeMoversDebugStats {
  moverCount: number;
  activeMoverCount: number;
  movers: QuakeMoverDebugState[];
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

interface QuakePlatTriggerField extends QuakeDoorTriggerField {
  contact: "plat-trigger";
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
    gameLogic?: QuakeGameLogicFacts | null,
  ) => void;
  get: (entityIndex: number) => QuakeMoverState | undefined;
  activateEntity: (entityIndex: number, sourceEntityIndex?: number) => boolean;
  activateGroup: (state: QuakeMoverState) => boolean;
  debugStats: () => QuakeMoversDebugStats;
  touchingDoorTriggerFields: (origin: [number, number, number], eyeHeight: number) => QuakeTouchedTrigger[];
}

export function createQuakeMoversController(options: QuakeMoversControllerOptions): QuakeMoversController {
  let movers = new Map<number, QuakeMoverState>();
  let pathCorners = new Map<string, QuakeEntity>();
  let doorTriggerFields: QuakeDoorTriggerField[] = [];
  let platTriggerFields: QuakePlatTriggerField[] = [];
  let pivot = { x: 0, y: 0, z: 0 };
  let moverFrame: number | null = null;
  let moverTime = 0;

  const clear = (): void => {
    if (moverFrame !== null) {
      window.cancelAnimationFrame(moverFrame);
      moverFrame = null;
    }
    movers = new Map();
    pathCorners = new Map();
    doorTriggerFields = [];
    platTriggerFields = [];
    moverTime = 0;
    pivot = { x: 0, y: 0, z: 0 };
  };

  const setup = (
    entities: QuakeEntity[],
    models: QuakePreparedModel[],
    nextPivot: { x: number; y: number; z: number },
    gameLogic?: QuakeGameLogicFacts | null,
  ): void => {
    clear();
    pivot = nextPivot;
    pathCorners = pathCornerIndex(entities);
    const modelsByIndex = new Map(models.map((model) => [model.index, model]));
    const logicEntityByIndex = indexQuakeGameLogicEntityFacts(gameLogic);
    for (const entity of entities) {
      if (entity.modelIndex === undefined || !isQuakeMoverEntity(entity.classname)) continue;
      const model = modelsByIndex.get(entity.modelIndex);
      if (!model) continue;
      const resolvedMover = logicEntityByIndex.get(entity.index)?.resolvedMover;
      const state = createQuakeMoverState(entity, model, pathCorners, resolvedMover);
      if (!state) continue;
      movers.set(entity.index, state);
    }
    linkDoorGroups();
    setupDoorTriggerFields();
    setupPlatTriggerFields();
    for (const state of movers.values()) options.applyState(state, false);
    if ([...movers.values()].some(moverLoopActive)) startLoop();
  };

  const activateEntity = (entityIndex: number, sourceEntityIndex?: number): boolean => {
    const mover = movers.get(entityIndex);
    if (mover?.kind === "plat" && mover.targetedPlatPrimed && sourceEntityIndex === undefined) return false;
    if (mover?.kind === "train") return activateTrain(mover);
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
      fireMoverTarget(state);
      startLoop();
      return true;
    }
    state.mode = "opening";
    fireMoverTarget(state);
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

  const fireMoverTarget = (state: QuakeMoverState): void => {
    if (!moverCanFireTarget(state) || state.targetFired || !state.entity.properties.target) return;
    state.targetFired = true;
    options.fireTarget(state.entity.properties.target, state.entity.index);
  };

  const moverCanFireTarget = (state: QuakeMoverState): boolean => {
    return state.kind === "button" ||
      state.kind === "door" ||
      state.kind === "secret-door";
  };

  const startLoop = (): void => {
    if (moverFrame !== null) return;
    moverTime = performance.now();
    moverFrame = window.requestAnimationFrame(tickMovers);
  };

  const moverLoopActive = (state: QuakeMoverState): boolean => {
    return state.mode === "opening" || state.mode === "closing" || (state.mode === "open" && state.waitUntil !== Infinity);
  };

  const tickMovers = (_frameNow: number): void => {
    const now = performance.now();
    const dt = Math.min(0.05, moverTime ? (now - moverTime) / 1000 : 0.0167);
    moverTime = now;
    let active = false;

    for (const state of movers.values()) {
      const changed = updateMover(state, now, dt);
      if (changed) options.applyState(state, true);
      if (moverLoopActive(state)) {
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
    if (state.kind === "train") return updateTrain(state, now, dt);
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

  const activateTrain = (state: QuakeMoverState): boolean => {
    if (state.mode === "opening") return false;
    if (!startTrainToNextCorner(state)) return false;
    startLoop();
    return true;
  };

  const updateTrain = (state: QuakeMoverState, now: number, dt: number): boolean => {
    if (state.mode === "closed") return false;
    if (state.mode === "open") {
      if (state.waitUntil === Infinity || now < state.waitUntil) return false;
      return startTrainToNextCorner(state);
    }

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
      arriveTrainAtCorner(state, now);
    }
    return changed || state.mode !== "opening";
  };

  const startTrainToNextCorner = (state: QuakeMoverState): boolean => {
    if (!state.pathBaseOrigin || !state.pathNextTarget) return false;
    const next = pathCorners.get(state.pathNextTarget);
    if (!next?.origin) return false;
    state.openOffset = trainCornerOffset(state.pathBaseOrigin, next.origin, state.closedOffset);
    state.mode = "opening";
    state.waitUntil = 0;
    return true;
  };

  const arriveTrainAtCorner = (state: QuakeMoverState, now: number): void => {
    const currentTarget = state.pathNextTarget;
    const corner = currentTarget ? pathCorners.get(currentTarget) : undefined;
    state.pathCurrentTarget = currentTarget;
    state.pathNextTarget = corner?.properties.target;
    const wait = corner ? quakeEntityNumber(corner, "wait", 0) : -1;
    if (wait < 0 || !state.pathNextTarget) {
      state.mode = "closed";
      state.waitUntil = Infinity;
      return;
    }
    if (wait > 0) {
      state.mode = "open";
      state.waitUntil = now + wait * 1000;
      return;
    }
    startTrainToNextCorner(state);
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
      const prebakedField = quakeDoorTriggerFieldFromPrebaked(first, linked, pivot);
      if (prebakedField) {
        doorTriggerFields.push(prebakedField);
        continue;
      }
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

  const setupPlatTriggerFields = (): void => {
    platTriggerFields = [];
    for (const state of movers.values()) {
      if (state.kind !== "plat") continue;
      const field = quakePlatTriggerField(state, pivot);
      if (field) platTriggerFields.push(field);
    }
  };

  const touchingDoorTriggerFields = (
    origin: [number, number, number],
    eyeHeight: number,
  ): QuakeTouchedTrigger[] => {
    if (!doorTriggerFields.length && !platTriggerFields.length) return [];
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
    for (const field of platTriggerFields) {
      if (
        maxX < field.minX || minX > field.maxX ||
        maxY < field.minY || minY > field.maxY ||
        maxZ < field.minZ || minZ > field.maxZ
      ) continue;
      out.push({
        entityIndex: field.entityIndex,
        modelIndex: field.modelIndex,
        classname: "func_plat",
        contact: field.contact,
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
    debugStats: () => ({
      moverCount: movers.size,
      activeMoverCount: [...movers.values()].filter(moverLoopActive).length,
      movers: [...movers.values()].map((state) => ({
        entityIndex: state.entity.index,
        classname: state.entity.classname,
        kind: state.kind,
        mode: state.mode,
        offset: [...state.offset] as Vec3,
        closedOffset: [...state.closedOffset] as Vec3,
        openOffset: [...state.openOffset] as Vec3,
        speed: state.speed,
        wait: state.wait,
        targetedPlatPrimed: state.targetedPlatPrimed,
      })),
    }),
    touchingDoorTriggerFields,
  };
}

function isQuakeMoverEntity(classname: string): boolean {
  return classname === "func_button" ||
    classname === "func_door" ||
    classname === "func_door_secret" ||
    classname === "func_plat" ||
    classname === "func_train";
}

export function quakeButtonIsPressed(state: QuakeMoverState): boolean {
  return state.mode === "opening" || state.mode === "open";
}

export function quakeMoverBlockDamage(state: QuakeMoverState): number {
  const amount = state.prebakedDoor?.dmg ??
    state.prebakedTrain?.dmg ??
    quakeEntityNumber(state.entity, "dmg", state.kind === "plat" ? 1 : 2);
  return Math.max(0, Number.isFinite(amount) ? amount : 0);
}

function quakeMoverDefaultSpeed(classname: string): number {
  if (classname === "func_plat") return 150;
  if (classname === "func_button") return 40;
  return 100;
}

function quakeMoverDefaultWait(classname: string): number {
  if (classname === "func_button") return 1;
  if (classname === "func_train") return 0;
  if (classname === "func_plat") return 3;
  if (classname === "func_door_secret") return 5;
  return 3;
}

const QUAKE_PLAT_LOW_TRIGGER = 1;
const QUAKE_PLAT_TRIGGER_INSET = 25;
const QUAKE_PLAT_TRIGGER_TOP_EXTRA = 8;
const QUAKE_PLAT_TRIGGER_LOW_HEIGHT = 8;
const QUAKE_PLAT_TRIGGER_MIN_SIDE = 50;

function quakePlatTriggerField(
  state: QuakeMoverState,
  pivot: { x: number; y: number; z: number },
): QuakePlatTriggerField | null {
  const prebakedTrigger = state.prebakedPlat?.trigger;
  if (prebakedTrigger && state.prebakedPlat.travelDistance > COLLISION_EPSILON) {
    return {
      entityIndex: state.entity.index,
      modelIndex: state.model.index,
      minX: (prebakedTrigger.mins.x - pivot.x) * QUAKE_COLLISION_UNIT_SCALE,
      maxX: (prebakedTrigger.maxs.x - pivot.x) * QUAKE_COLLISION_UNIT_SCALE,
      minY: (prebakedTrigger.mins.y - pivot.y) * QUAKE_COLLISION_UNIT_SCALE,
      maxY: (prebakedTrigger.maxs.y - pivot.y) * QUAKE_COLLISION_UNIT_SCALE,
      minZ: (prebakedTrigger.mins.z - pivot.z) * QUAKE_COLLISION_UNIT_SCALE,
      maxZ: (prebakedTrigger.maxs.z - pivot.z) * QUAKE_COLLISION_UNIT_SCALE,
      contact: "plat-trigger",
    };
  }

  const travel = Math.abs(state.openOffset[2] - state.closedOffset[2]) / QUAKE_COLLISION_UNIT_SCALE;
  if (travel <= COLLISION_EPSILON) return null;

  let minX = state.model.mins.x + QUAKE_PLAT_TRIGGER_INSET;
  let maxX = state.model.maxs.x - QUAKE_PLAT_TRIGGER_INSET;
  let minY = state.model.mins.y + QUAKE_PLAT_TRIGGER_INSET;
  let maxY = state.model.maxs.y - QUAKE_PLAT_TRIGGER_INSET;
  const sizeX = state.model.maxs.x - state.model.mins.x;
  const sizeY = state.model.maxs.y - state.model.mins.y;
  if (sizeX <= QUAKE_PLAT_TRIGGER_MIN_SIDE) {
    minX = (state.model.mins.x + state.model.maxs.x) / 2;
    maxX = minX + 1;
  }
  if (sizeY <= QUAKE_PLAT_TRIGGER_MIN_SIDE) {
    minY = (state.model.mins.y + state.model.maxs.y) / 2;
    maxY = minY + 1;
  }

  const triggerTopZ = state.model.maxs.z + QUAKE_PLAT_TRIGGER_TOP_EXTRA;
  const triggerBottomZ = triggerTopZ - (travel + QUAKE_PLAT_TRIGGER_TOP_EXTRA);
  const maxZ = (quakeEntitySpawnflags(state.entity) & QUAKE_PLAT_LOW_TRIGGER)
    ? triggerBottomZ + QUAKE_PLAT_TRIGGER_LOW_HEIGHT
    : triggerTopZ;

  return {
    entityIndex: state.entity.index,
    modelIndex: state.model.index,
    minX: (minX - pivot.x) * QUAKE_COLLISION_UNIT_SCALE,
    maxX: (maxX - pivot.x) * QUAKE_COLLISION_UNIT_SCALE,
    minY: (minY - pivot.y) * QUAKE_COLLISION_UNIT_SCALE,
    maxY: (maxY - pivot.y) * QUAKE_COLLISION_UNIT_SCALE,
    minZ: (triggerBottomZ - pivot.z) * QUAKE_COLLISION_UNIT_SCALE,
    maxZ: (maxZ - pivot.z) * QUAKE_COLLISION_UNIT_SCALE,
    contact: "plat-trigger",
  };
}

function quakeDoorTriggerFieldFromPrebaked(
  state: QuakeMoverState,
  linked: QuakeMoverState[],
  pivot: { x: number; y: number; z: number },
): QuakeDoorTriggerField | null {
  const trigger = state.prebakedDoor?.trigger;
  if (!trigger) return null;
  if (!sameEntityIndexes(trigger.linkedEntityIndexes, linked.map((linkedState) => linkedState.entity.index))) return null;
  return {
    entityIndex: trigger.ownerEntityIndex,
    modelIndex: trigger.modelIndex,
    minX: (trigger.mins.x - pivot.x) * QUAKE_COLLISION_UNIT_SCALE,
    maxX: (trigger.maxs.x - pivot.x) * QUAKE_COLLISION_UNIT_SCALE,
    minY: (trigger.mins.y - pivot.y) * QUAKE_COLLISION_UNIT_SCALE,
    maxY: (trigger.maxs.y - pivot.y) * QUAKE_COLLISION_UNIT_SCALE,
    minZ: (trigger.mins.z - pivot.z) * QUAKE_COLLISION_UNIT_SCALE,
    maxZ: (trigger.maxs.z - pivot.z) * QUAKE_COLLISION_UNIT_SCALE,
  };
}

function sameEntityIndexes(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length &&
    a.every((value, index) => value === b[index]);
}

function createQuakeMoverState(
  entity: QuakeEntity,
  model: QuakePreparedModel,
  pathCorners: Map<string, QuakeEntity>,
  resolvedMover?: QuakeGameLogicFacts["entities"][number]["resolvedMover"],
): QuakeMoverState | null {
  const kind = quakeMoverKind(entity.classname);
  if (!kind) return null;
  if (kind === "train") {
    const prebakedTrain = resolvedMover?.kind === "func_train" ? resolvedMover : undefined;
    return createQuakeTrainState(entity, model, pathCorners, prebakedTrain);
  }
  const prebakedButton = kind === "button" && resolvedMover?.kind === "func_button"
    ? resolvedMover
    : undefined;
  const prebakedDoor = kind === "door" && resolvedMover?.kind === "func_door"
    ? resolvedMover
    : undefined;
  const prebakedPlat = kind === "plat" && resolvedMover?.kind === "func_plat"
    ? resolvedMover
    : undefined;

  const closedOffset: Vec3 = [0, 0, 0];
  let openOffset: Vec3;
  let initialOffset: Vec3 = closedOffset;
  let initialMode: QuakeMoverMode = "closed";
  let targetedPlatPrimed = false;
  const spawnflags = quakeEntitySpawnflags(entity);
  const wait =
    prebakedButton?.wait ??
    prebakedPlat?.waitAtTop ??
    prebakedDoor?.wait ??
    quakeEntityNumber(entity, "wait", quakeMoverDefaultWait(entity.classname));

  if (kind === "plat") {
    const bottomOffset = prebakedPlat
      ? quakeVectorToScaledOffset(prebakedPlat.travelOffset)
      : quakePlatBottomOffset(entity, model);
    const startsTop = prebakedPlat?.startsTop ?? Boolean(entity.properties.targetname);
    openOffset = [0, 0, 0];
    closedOffset[0] = bottomOffset[0];
    closedOffset[1] = bottomOffset[1];
    closedOffset[2] = bottomOffset[2];
    initialOffset = startsTop ? [...openOffset] as Vec3 : [...closedOffset] as Vec3;
    initialMode = prebakedPlat?.initialState === "top" || (!prebakedPlat && startsTop) ? "open" : "closed";
    targetedPlatPrimed = startsTop;
  } else {
    const prebakedTravelOffset = prebakedButton?.travelOffset ?? prebakedDoor?.travelOffset;
    openOffset = prebakedTravelOffset
      ? quakeVectorToScaledOffset(prebakedTravelOffset)
      : quakeMoverTravelOffset(entity, model);
    const startsOpen = prebakedDoor?.startsOpen ?? Boolean(spawnflags & QUAKE_DOOR_START_OPEN);
    if (kind === "door" && startsOpen) {
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
    speed: (
      prebakedButton?.speed ??
      prebakedPlat?.speed ??
      prebakedDoor?.speed ??
      quakeEntityNumber(entity, "speed", quakeMoverDefaultSpeed(entity.classname))
    ) *
      QUAKE_COLLISION_UNIT_SCALE,
    wait,
    waitUntil: initialMode === "open" && kind === "plat" ? Infinity : 0,
    once: wait < 0 || (kind === "secret-door" && Boolean(spawnflags & QUAKE_SECRET_OPEN_ONCE)),
    toggle: kind === "door" && Boolean(spawnflags & QUAKE_DOOR_TOGGLE),
    linkedEntityIndexes: [entity.index],
    targetedPlatPrimed,
    targetFired: false,
    ...(prebakedButton ? { prebakedButton } : {}),
    ...(prebakedDoor ? { prebakedDoor } : {}),
    ...(prebakedPlat ? { prebakedPlat } : {}),
  };
}

function quakeMoverKind(classname: string): QuakeMoverKind | null {
  if (classname === "func_button") return "button";
  if (classname === "func_door") return "door";
  if (classname === "func_door_secret") return "secret-door";
  if (classname === "func_plat") return "plat";
  if (classname === "func_train") return "train";
  return null;
}

function createQuakeTrainState(
  entity: QuakeEntity,
  model: QuakePreparedModel,
  pathCorners: Map<string, QuakeEntity>,
  prebakedTrain?: QuakeGameLogicResolvedFuncTrainFact,
): QuakeMoverState | null {
  const firstTarget = prebakedTrain?.initialTarget ?? entity.properties.target;
  const firstCorner = firstTarget ? pathCorners.get(firstTarget) : undefined;
  if (!firstCorner?.origin) return null;
  const rawPathBaseOrigin = prebakedTrain?.pathBaseOrigin ?? firstCorner.origin;
  const pathBaseOrigin: Vec3 = [rawPathBaseOrigin.x, rawPathBaseOrigin.y, rawPathBaseOrigin.z];
  const baseOffset = prebakedTrain?.quakeCInitialOrigin
    ? quakeVectorToScaledOffset(prebakedTrain.quakeCInitialOrigin)
    : [0, 0, 0] as Vec3;
  const startsInactive = Boolean(entity.properties.targetname);
  const nextTarget = firstCorner.properties.target;
  const nextCorner = nextTarget ? pathCorners.get(nextTarget) : undefined;
  const openOffset = nextCorner?.origin
    ? trainCornerOffset(pathBaseOrigin, nextCorner.origin, baseOffset)
    : [...baseOffset] as Vec3;
  return {
    entity,
    model,
    kind: "train",
    offset: [...baseOffset] as Vec3,
    lastOffset: [...baseOffset] as Vec3,
    closedOffset: [...baseOffset] as Vec3,
    openOffset,
    mode: startsInactive || !nextCorner ? "closed" : "opening",
    speed: (prebakedTrain?.speed ?? quakeEntityNumber(entity, "speed", quakeMoverDefaultSpeed(entity.classname))) *
      QUAKE_COLLISION_UNIT_SCALE,
    wait: quakeEntityNumber(entity, "wait", 0),
    waitUntil: startsInactive ? Infinity : 0,
    once: false,
    toggle: false,
    linkedEntityIndexes: [entity.index],
    targetedPlatPrimed: false,
    targetFired: false,
    pathBaseOrigin,
    pathCurrentTarget: firstTarget,
    pathNextTarget: nextTarget,
    ...(prebakedTrain ? { prebakedTrain } : {}),
  };
}

function quakePlatBottomOffset(entity: QuakeEntity, model: QuakePreparedModel): Vec3 {
  const height = quakeEntityNumber(
    entity,
    "height",
    Math.max(0, model.maxs.z - model.mins.z - 8),
  );
  return [0, 0, -height * QUAKE_COLLISION_UNIT_SCALE];
}

function quakeVectorToScaledOffset(vector: { x: number; y: number; z: number }): Vec3 {
  return [
    vector.x * QUAKE_COLLISION_UNIT_SCALE,
    vector.y * QUAKE_COLLISION_UNIT_SCALE,
    vector.z * QUAKE_COLLISION_UNIT_SCALE,
  ];
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

function pathCornerIndex(entities: QuakeEntity[]): Map<string, QuakeEntity> {
  const out = new Map<string, QuakeEntity>();
  for (const entity of entities) {
    if (entity.classname !== "path_corner" || !entity.properties.targetname) continue;
    out.set(entity.properties.targetname, entity);
  }
  return out;
}

function trainCornerOffset(
  base: Vec3,
  origin: { x: number; y: number; z: number },
  baseOffset: Vec3 = [0, 0, 0],
): Vec3 {
  return [
    baseOffset[0] + (origin.x - base[0]) * QUAKE_COLLISION_UNIT_SCALE,
    baseOffset[1] + (origin.y - base[1]) * QUAKE_COLLISION_UNIT_SCALE,
    baseOffset[2] + (origin.z - base[2]) * QUAKE_COLLISION_UNIT_SCALE,
  ];
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
