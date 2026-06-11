import { worldPositionToPolyCss, type Vec3 } from "@layoutit/polycss";

import { PLAYER_RADIUS, COLLISION_EPSILON, GROUND_SNAP, QUAKE_COLLISION_UNIT_SCALE } from "../constants";
import type { QuakeCollisionWorld } from "../collision";
import type { QuakeDoorKey } from "../doors";
import { quakeDoorGroupKeyRequirement, quakePlayerHasDoorKey } from "../doors";
import { distanceSq3, subtractVec3 } from "../math";
import type { QuakeMoverState } from "../movers";
import {
  quakeButtonIsPressed,
  quakeMoverBlockDamage,
  quakeMoverBlockDamageCooldownMs,
} from "../movers";
import type { QuakeSoundController } from "../audio";
import type { QuakeFaceLeaf } from "../world";
import type { QuakePlayerInventory } from "../hud";
import type { QuakeShootableBounds, QuakeShootablesController } from "../shootables";

type MoverBounds = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

export interface QuakeMoverInteractionFlowOptions {
  audio: QuakeSoundController;
  doorMessageCooldownMs: number;
  applyButtonLeafVisual(leaf: QuakeFaceLeaf, pressed: boolean): void;
  compactInlineStyle(element: HTMLElement): void;
  currentCollisionWorld(): QuakeCollisionWorld | null;
  currentGroundEntity(): number | null;
  getMover(entityIndex: number): QuakeMoverState | undefined;
  isDebugFlyModeActive(): boolean;
  modelLeaves(modelIndex: number): QuakeFaceLeaf[];
  playerCarryWithMover(delta: Vec3, entityIndex: number): void;
  playerDamage(amount: number): boolean;
  playerEyeHeight(): number;
  playerInventory(): QuakePlayerInventory;
  playerOrigin(): [number, number, number];
  requiredDoorText(entityIndexes: number[], requiredKey: QuakeDoorKey): string | null;
  shootables: QuakeShootablesController;
  showCenterPrint(text: string): void;
  syncCrosshairTarget(): void;
}

export interface QuakeMoverInteractionFlow {
  applyLeafTransform(leaf: QuakeFaceLeaf): void;
  applyState(state: QuakeMoverState, movePlayer?: boolean): void;
  clear(): void;
  groupUnlocked(state: QuakeMoverState): boolean;
  playerBlocks(state: QuakeMoverState, nextOffset: Vec3, delta: Vec3): boolean;
  resumeAfterPause(durationMs: number): void;
  setModelPivot(pivot: { x: number; y: number; z: number }): void;
  syncButtonLeafVisual(leaf: QuakeFaceLeaf): void;
}

export function createQuakeMoverInteractionFlow(options: QuakeMoverInteractionFlowOptions): QuakeMoverInteractionFlow {
  let crushDamageAt = new Map<number, number>();
  let doorMessageCooldownUntil = new Map<number, number>();
  let modelPivot = { x: 0, y: 0, z: 0 };
  let soundModes = new Map<number, QuakeMoverState["mode"]>();

  function clear(): void {
    crushDamageAt = new Map();
    doorMessageCooldownUntil = new Map();
    modelPivot = { x: 0, y: 0, z: 0 };
    soundModes = new Map();
  }

  function setModelPivot(pivot: { x: number; y: number; z: number }): void {
    modelPivot = pivot;
  }

  function resumeAfterPause(durationMs: number): void {
    if (!durationMs) return;
    for (const [entityIndex, deadline] of crushDamageAt) {
      crushDamageAt.set(entityIndex, deadline + durationMs);
    }
    for (const [entityIndex, deadline] of doorMessageCooldownUntil) {
      doorMessageCooldownUntil.set(entityIndex, deadline + durationMs);
    }
  }

  function groupUnlocked(state: QuakeMoverState): boolean {
    if (state.kind !== "door" && state.kind !== "secret-door") return true;
    const entities = state.linkedEntityIndexes
      .map((entityIndex) => options.getMover(entityIndex)?.entity)
      .filter((entity): entity is QuakeMoverState["entity"] => Boolean(entity));
    const requiredKey = quakeDoorGroupKeyRequirement(entities.length ? entities : [state.entity]);
    if (quakePlayerHasDoorKey(options.playerInventory(), requiredKey)) return true;
    if (requiredKey) showDoorRequirementText(state, requiredKey);
    return false;
  }

  function showDoorRequirementText(state: QuakeMoverState, requiredKey: QuakeDoorKey): void {
    const cooldownKey = groupCooldownKey(state);
    const now = performance.now();
    if ((doorMessageCooldownUntil.get(cooldownKey) ?? 0) > now) return;
    doorMessageCooldownUntil.set(cooldownKey, now + options.doorMessageCooldownMs);
    const text = options.requiredDoorText(groupEntityIndexes(state), requiredKey);
    if (text) options.showCenterPrint(text);
  }

  function groupCooldownKey(state: QuakeMoverState): number {
    let key = state.entity.index;
    for (const entityIndex of state.linkedEntityIndexes) key = Math.min(key, entityIndex);
    return key;
  }

  function groupEntityIndexes(state: QuakeMoverState): number[] {
    const entityIndexes: number[] = [];
    const seen = new Set<number>();
    const addEntityIndex = (entityIndex: number): void => {
      if (seen.has(entityIndex)) return;
      seen.add(entityIndex);
      entityIndexes.push(entityIndex);
    };
    addEntityIndex(state.entity.index);
    for (const entityIndex of state.linkedEntityIndexes) addEntityIndex(entityIndex);
    return entityIndexes;
  }

  function playerBlocks(state: QuakeMoverState, nextOffset: Vec3, delta: Vec3): boolean {
    return blockedByPlayer(state, nextOffset, delta) ||
      blockedByMonster(state, nextOffset, delta);
  }

  function blockedByPlayer(state: QuakeMoverState, nextOffset: Vec3, delta: Vec3): boolean {
    if (options.isDebugFlyModeActive()) return false;
    if (state.kind === "button" || shouldCarryPlayerWithMover(state, delta)) return false;
    const origin = options.playerOrigin();
    if (!options.currentCollisionWorld()?.playerIntersectsBrush?.(
      state.entity.index,
      nextOffset,
      origin,
      options.playerEyeHeight(),
    )) return false;
    if (moverPushClearsPlayer(state, nextOffset, delta, origin)) return false;
    damagePlayerForMoverBlock(state);
    return true;
  }

  function blockedByMonster(state: QuakeMoverState, nextOffset: Vec3, delta: Vec3): boolean {
    if (!moverCanBeBlockedByMonster(state)) return false;
    if (distanceSq3(delta, [0, 0, 0]) <= COLLISION_EPSILON) return false;
    const blockerEntityIndex = options.shootables.pushMonsterBlockers(moverBoundsAtOffsetBounds(state, nextOffset), delta);
    if (blockerEntityIndex === null) return false;
    damageMonsterForMoverBlock(state, blockerEntityIndex);
    return true;
  }

  function moverCanBeBlockedByMonster(state: QuakeMoverState): boolean {
    return state.kind === "door" ||
      state.kind === "secret-door" ||
      state.kind === "plat" ||
      state.kind === "train";
  }

  function moverPushClearsPlayer(
    state: QuakeMoverState,
    nextOffset: Vec3,
    delta: Vec3,
    origin = options.playerOrigin(),
  ): boolean {
    const pushedOrigin: [number, number, number] = [
      origin[0] + delta[0],
      origin[1] + delta[1],
      origin[2] + delta[2],
    ];
    return !options.currentCollisionWorld()?.playerIntersectsBrush?.(
      state.entity.index,
      nextOffset,
      pushedOrigin,
      options.playerEyeHeight(),
    );
  }

  function damagePlayerForMoverBlock(state: QuakeMoverState): void {
    damageActorForMoverBlock(state, (amount) => options.playerDamage(amount));
  }

  function damageMonsterForMoverBlock(state: QuakeMoverState, entityIndex: number): void {
    damageActorForMoverBlock(state, (amount) => options.shootables.damage(entityIndex, amount));
  }

  function damageActorForMoverBlock(state: QuakeMoverState, applyDamage: (amount: number) => boolean): void {
    const amount = quakeMoverBlockDamage(state);
    if (amount <= 0) return;
    const cooldownMs = quakeMoverBlockDamageCooldownMs(state);
    if (cooldownMs > 0) {
      const now = performance.now();
      const lastDamageAt = crushDamageAt.get(state.entity.index) ?? -Infinity;
      if (now - lastDamageAt < cooldownMs) return;
      crushDamageAt.set(state.entity.index, now);
    }
    applyDamage(amount);
  }

  function applyState(state: QuakeMoverState, movePlayer = true): void {
    const delta = subtractVec3(state.offset, state.lastOffset);
    const carryPlayer = movePlayer && shouldCarryPlayerWithMover(state, delta);
    options.currentCollisionWorld()?.setBrushOffset?.(state.entity.index, state.offset);
    for (const leaf of options.modelLeaves(state.model.index)) {
      applyLeafTransform(leaf);
      if (state.kind === "button") options.applyButtonLeafVisual(leaf, quakeButtonIsPressed(state));
    }
    if (carryPlayer) carryPlayerWithMover(state, delta);
    state.lastOffset = [...state.offset] as Vec3;
    syncMoverSound(state, movePlayer);
    options.syncCrosshairTarget();
  }

  function syncMoverSound(state: QuakeMoverState, activeUpdate: boolean): void {
    const previousMode = soundModes.get(state.entity.index);
    soundModes.set(state.entity.index, state.mode);
    if (!activeUpdate || previousMode === undefined || previousMode === state.mode) return;

    if (state.kind === "button") {
      if (state.mode === "opening") options.audio.playEvent("button", { volume: 0.58 });
      return;
    }

    if (state.kind === "plat") {
      if (state.mode === "opening" || state.mode === "closing") {
        options.audio.playEvent("platMove", { volume: 0.52 });
      } else if (state.mode === "open" || state.mode === "closed") {
        options.audio.playEvent("doorStop", { volume: 0.38 });
      }
      return;
    }

    if (state.mode === "opening" || state.mode === "closing") {
      options.audio.playEvent("doorMove", { volume: 0.52 });
    } else if (state.mode === "open" || state.mode === "closed") {
      options.audio.playEvent("doorStop", { volume: 0.44 });
    }
  }

  function shouldCarryPlayerWithMover(state: QuakeMoverState, delta: Vec3): boolean {
    if (options.isDebugFlyModeActive()) return false;
    if (state.kind === "button" || distanceSq3(delta, [0, 0, 0]) <= COLLISION_EPSILON) return false;
    const origin = options.playerOrigin();
    if (
      playerStandingOnMover(state, state.lastOffset, delta, origin) ||
      playerStandingOnMover(state, state.offset, delta, origin)
    ) {
      return true;
    }
    if (
      options.currentCollisionWorld()?.playerIntersectsBrush?.(
        state.entity.index,
        state.offset,
        origin,
        options.playerEyeHeight(),
      ) &&
      moverPushClearsPlayer(state, state.offset, delta, origin)
    ) {
      return true;
    }
    const footZ = origin[2] - options.playerEyeHeight();
    const verticalWindow = Math.abs(delta[2]) + GROUND_SNAP;
    const contact = options.currentCollisionWorld()?.floorContactAt?.(
      origin[0],
      origin[1],
      footZ + verticalWindow,
      footZ - verticalWindow,
    );
    if (contact?.entityIndex === state.entity.index) return true;
    return options.currentGroundEntity() === state.entity.index;
  }

  function playerStandingOnMover(
    state: QuakeMoverState,
    offset: Vec3,
    delta: Vec3,
    origin = options.playerOrigin(),
  ): boolean {
    const bounds = moverBoundsAtOffset(state, offset);
    if (
      origin[0] < bounds.minX - PLAYER_RADIUS ||
      origin[0] > bounds.maxX + PLAYER_RADIUS ||
      origin[1] < bounds.minY - PLAYER_RADIUS ||
      origin[1] > bounds.maxY + PLAYER_RADIUS
    ) return false;

    const footZ = origin[2] - options.playerEyeHeight();
    const contactWindow = Math.abs(delta[2]) + GROUND_SNAP;
    return footZ >= bounds.maxZ - contactWindow &&
      footZ <= bounds.maxZ + contactWindow;
  }

  function moverBoundsAtOffset(state: QuakeMoverState, offset: Vec3): MoverBounds {
    return {
      minX: (state.model.mins.x - modelPivot.x) * QUAKE_COLLISION_UNIT_SCALE + offset[0],
      maxX: (state.model.maxs.x - modelPivot.x) * QUAKE_COLLISION_UNIT_SCALE + offset[0],
      minY: (state.model.mins.y - modelPivot.y) * QUAKE_COLLISION_UNIT_SCALE + offset[1],
      maxY: (state.model.maxs.y - modelPivot.y) * QUAKE_COLLISION_UNIT_SCALE + offset[1],
      minZ: (state.model.mins.z - modelPivot.z) * QUAKE_COLLISION_UNIT_SCALE + offset[2],
      maxZ: (state.model.maxs.z - modelPivot.z) * QUAKE_COLLISION_UNIT_SCALE + offset[2],
    };
  }

  function moverBoundsAtOffsetBounds(state: QuakeMoverState, offset: Vec3): QuakeShootableBounds {
    const bounds = moverBoundsAtOffset(state, offset);
    return {
      min: [bounds.minX, bounds.minY, bounds.minZ],
      max: [bounds.maxX, bounds.maxY, bounds.maxZ],
    };
  }

  function carryPlayerWithMover(state: QuakeMoverState, delta: Vec3): void {
    options.playerCarryWithMover(delta, state.entity.index);
  }

  function applyLeafTransform(leaf: QuakeFaceLeaf): void {
    const state = leaf.entityIndex !== undefined ? options.getMover(leaf.entityIndex) : undefined;
    if (!state || distanceSq3(state.offset, [0, 0, 0]) <= COLLISION_EPSILON) {
      leaf.element.style.transform = leaf.baseTransform;
      options.compactInlineStyle(leaf.element);
      return;
    }
    leaf.element.style.transform = `${offsetCss(state.offset)} ${leaf.baseTransform}`;
    options.compactInlineStyle(leaf.element);
  }

  function syncButtonLeafVisual(leaf: QuakeFaceLeaf): void {
    const state = leaf.entityIndex !== undefined ? options.getMover(leaf.entityIndex) : undefined;
    if (state?.kind !== "button") return;
    options.applyButtonLeafVisual(leaf, quakeButtonIsPressed(state));
  }

  return {
    applyLeafTransform,
    applyState,
    clear,
    groupUnlocked,
    playerBlocks,
    resumeAfterPause,
    setModelPivot,
    syncButtonLeafVisual,
  };
}

function offsetCss(offset: Vec3): string {
  const [x, y, z] = worldPositionToPolyCss(offset);
  return `translate3d(${x.toFixed(3)}px, ${y.toFixed(3)}px, ${z.toFixed(3)}px)`;
}
