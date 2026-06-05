import type { Polygon, Vec3 } from "@layoutit/polycss";

import type { QuakePreparedCollision } from "../prepare/scene";
import {
  COLLISION_EPSILON,
  GROUND_SNAP,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  QUAKE_COLLISION_UNIT_SCALE,
  QUAKE_PLAYER_VIEW_Z,
  STEP_HEIGHT,
} from "./constants";
import { addVec3, dotVec3, lerpVec3, subtractVec3 } from "./math";

interface WalkSurface {
  vertices: Vec3[];
  normal: Vec3;
  anchor: Vec3;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface WallSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface QuakeCollisionWorld {
  floorAt(x: number, y: number, maxZ?: number, minZ?: number): number | null;
  floorContactAt?(x: number, y: number, maxZ?: number, minZ?: number): QuakeFloorContact | null;
  contentsAt?(point: Vec3): number | null;
  traceUse?(start: Vec3, end: Vec3): QuakeUseTrace | null;
  playerIntersectsBrush?(entityIndex: number, offset: Vec3, origin: [number, number, number]): boolean;
  touchingTriggers?(origin: [number, number, number], eyeHeight: number): QuakeTouchedTrigger[];
  setBrushOffset?(entityIndex: number, offset: Vec3): void;
  resolve(
    origin: [number, number, number],
    previous: [number, number, number],
    eyeHeight: number,
    currentGroundZ: number,
  ): QuakeCollisionResult;
}

export interface QuakeCollisionResult {
  origin: [number, number, number];
  groundZ: number;
  grounded: boolean;
  touches?: QuakeTouchedTrigger[];
}

interface QuakeClipPlane {
  normal: Vec3;
  dist: number;
}

interface QuakeHullTrace {
  allSolid: boolean;
  startSolid: boolean;
  fraction: number;
  end: Vec3;
  planeNormal: Vec3 | null;
  brush?: QuakeClipBrush;
}

interface QuakeFloorTrace {
  z: number;
  brush?: QuakeClipBrush;
}

export interface QuakeFloorContact {
  z: number;
  entityIndex?: number;
  modelIndex?: number;
  classname?: string;
}

export interface QuakeUseTrace {
  fraction: number;
  end: Vec3;
  planeNormal: Vec3 | null;
  entityIndex?: number;
  modelIndex?: number;
  classname?: string;
}

interface QuakeClipBrush {
  headNode: number;
  pointHeadNode?: number;
  kind: "solid" | "trigger";
  baseOffset: Vec3;
  offset: Vec3;
  entityIndex?: number;
  modelIndex?: number;
  classname?: string;
  target?: string;
  targetname?: string;
}

export interface QuakeTouchedTrigger {
  entityIndex: number;
  modelIndex: number;
  classname: string;
  contact?: "trigger" | "door-trigger" | "solid" | "floor";
  target?: string;
  targetname?: string;
}

const WALKABLE_NORMAL_Z = 0.52;
const WALL_NORMAL_Z = 0.45;
const QUAKE_CONTENTS_SOLID = -2;
const QUAKE_TRACE_EPSILON = 0.03125 * QUAKE_COLLISION_UNIT_SCALE;
const QUAKE_TRACE_RANGE = 8192 * QUAKE_COLLISION_UNIT_SCALE;
const COLLISION_WALL_SKIN = 1 * QUAKE_COLLISION_UNIT_SCALE;
const COLLISION_WALL_FLOOR_CLEARANCE = 2 * QUAKE_COLLISION_UNIT_SCALE;
const COLLISION_MAX_STEP = 8 * QUAKE_COLLISION_UNIT_SCALE;
const COLLISION_FLOOR_EDGE_SNAP = 1 * QUAKE_COLLISION_UNIT_SCALE;

export function buildQuakeClipCollisionWorld(collision: QuakePreparedCollision): QuakeCollisionWorld | null {
  const runtime = collision.runtime;
  if (!runtime.brushes.length || !runtime.planes.length) return null;
  const hullMinsZ = runtime.hullMinsZ;
  const planes = runtime.planes.map((plane): QuakeClipPlane => ({
    normal: [...plane.normal] as Vec3,
    dist: plane.dist,
  }));
  const brushes: QuakeClipBrush[] = runtime.brushes.map((brush) => ({
    ...brush,
    baseOffset: [...brush.baseOffset] as Vec3,
    offset: [...brush.baseOffset] as Vec3,
  }));
  const solidBrushes = runtime.solidBrushIndexes
    .map((index) => brushes[index])
    .filter((brush): brush is QuakeClipBrush => Boolean(brush));
  const triggerBrushes = runtime.triggerBrushIndexes
    .map((index) => brushes[index])
    .filter((brush): brush is QuakeClipBrush => Boolean(brush));
  let currentTouches = new Map<number, QuakeTouchedTrigger>();

  function isValidPointHeadNode(headNode: number | undefined): headNode is number {
    if (headNode === undefined) return false;
    return Number.isInteger(headNode) &&
      headNode >= 0 &&
      Boolean(collision.nodes?.length) &&
      Boolean(collision.leaves?.length) &&
      headNode < (collision.nodes?.length ?? 0);
  }

  function eyeToHullOrigin(origin: [number, number, number]): Vec3 {
    return [origin[0], origin[1], origin[2] - QUAKE_PLAYER_VIEW_Z];
  }

  function hullOriginToEye(origin: Vec3): [number, number, number] {
    return [origin[0], origin[1], origin[2] + QUAKE_PLAYER_VIEW_Z];
  }

  function hullOriginToFootZ(origin: Vec3): number {
    return origin[2] + hullMinsZ;
  }

  function footZToHullOriginZ(footZ: number): number {
    return footZ - hullMinsZ;
  }

  function pointContents(nodeIndex: number, point: Vec3): number {
    let index = nodeIndex;
    for (let guard = 0; guard < collision.clipNodes.length + 8; guard++) {
      if (index < 0) return index;
      const node = collision.clipNodes[index];
      if (!node) return QUAKE_CONTENTS_SOLID;
      const plane = planes[node.plane];
      if (!plane) return QUAKE_CONTENTS_SOLID;
      index = node.children[dotVec3(point, plane.normal) - plane.dist >= 0 ? 0 : 1];
    }
    return QUAKE_CONTENTS_SOLID;
  }

  function nodePointContents(nodeIndex: number, point: Vec3): number {
    let index = nodeIndex;
    for (let guard = 0; guard < (collision.nodes?.length ?? 0) + 8; guard++) {
      if (index < 0) return collision.leaves?.[-index - 1]?.contents ?? QUAKE_CONTENTS_SOLID;
      const node = collision.nodes?.[index];
      if (!node) return QUAKE_CONTENTS_SOLID;
      const plane = planes[node.plane];
      if (!plane) return QUAKE_CONTENTS_SOLID;
      index = node.children[dotVec3(point, plane.normal) - plane.dist >= 0 ? 0 : 1];
    }
    return QUAKE_CONTENTS_SOLID;
  }

  function traceBrush(brush: QuakeClipBrush, start: Vec3, end: Vec3): QuakeHullTrace {
    const localStart = subtractVec3(start, brush.offset);
    const localEnd = subtractVec3(end, brush.offset);
    const trace: QuakeHullTrace = {
      allSolid: true,
      startSolid: false,
      fraction: 1,
      end: [...localEnd] as Vec3,
      planeNormal: null,
    };
    if (pointContents(brush.headNode, localStart) === QUAKE_CONTENTS_SOLID) {
      return {
        allSolid: true,
        startSolid: true,
        fraction: 0,
        end: [...start] as Vec3,
        planeNormal: null,
        brush,
      };
    }
    recursiveHullCheck(brush.headNode, 0, 1, localStart, localEnd, trace);
    trace.end = addVec3(trace.fraction >= 1 ? localEnd : trace.end, brush.offset);
    if (trace.fraction < 1 || trace.startSolid) trace.brush = brush;
    return trace;
  }

  function tracePointBrush(brush: QuakeClipBrush, start: Vec3, end: Vec3): QuakeHullTrace {
    if (brush.pointHeadNode === undefined) return traceBrush(brush, start, end);
    const localStart = subtractVec3(start, brush.offset);
    const localEnd = subtractVec3(end, brush.offset);
    const trace: QuakeHullTrace = {
      allSolid: true,
      startSolid: false,
      fraction: 1,
      end: [...localEnd] as Vec3,
      planeNormal: null,
    };
    if (nodePointContents(brush.pointHeadNode, localStart) === QUAKE_CONTENTS_SOLID) {
      return {
        allSolid: true,
        startSolid: true,
        fraction: 0,
        end: [...start] as Vec3,
        planeNormal: null,
        brush,
      };
    }
    recursiveNodeCheck(brush.pointHeadNode, 0, 1, localStart, localEnd, trace);
    trace.end = addVec3(trace.fraction >= 1 ? localEnd : trace.end, brush.offset);
    if (trace.fraction < 1 || trace.startSolid) trace.brush = brush;
    return trace;
  }

  function traceSolids(start: Vec3, end: Vec3): QuakeHullTrace {
    let best: QuakeHullTrace = {
      allSolid: false,
      startSolid: false,
      fraction: 1,
      end: [...end] as Vec3,
      planeNormal: null,
    };
    for (const brush of solidBrushes) {
      const trace = traceBrush(brush, start, end);
      if (trace.startSolid) return trace;
      if (trace.fraction < best.fraction) best = trace;
    }
    return best;
  }

  function traceUseSolids(start: Vec3, end: Vec3): QuakeHullTrace {
    let best: QuakeHullTrace = {
      allSolid: false,
      startSolid: false,
      fraction: 1,
      end: [...end] as Vec3,
      planeNormal: null,
    };
    for (const brush of solidBrushes) {
      const trace = tracePointBrush(brush, start, end);
      if (trace.startSolid) return trace;
      if (trace.fraction < best.fraction) best = trace;
    }
    return best;
  }

  function recursiveHullCheck(
    nodeIndex: number,
    p1f: number,
    p2f: number,
    p1: Vec3,
    p2: Vec3,
    trace: QuakeHullTrace,
  ): boolean {
    if (nodeIndex < 0) {
      if (nodeIndex === QUAKE_CONTENTS_SOLID) {
        trace.startSolid = trace.startSolid || p1f === 0;
        return false;
      }
      trace.allSolid = false;
      return true;
    }

    const node = collision.clipNodes[nodeIndex];
    if (!node) return false;
    const plane = planes[node.plane];
    if (!plane) return false;

    const t1 = dotVec3(p1, plane.normal) - plane.dist;
    const t2 = dotVec3(p2, plane.normal) - plane.dist;
    if (t1 >= 0 && t2 >= 0) return recursiveHullCheck(node.children[0], p1f, p2f, p1, p2, trace);
    if (t1 < 0 && t2 < 0) return recursiveHullCheck(node.children[1], p1f, p2f, p1, p2, trace);

    const side = t1 < 0 ? 1 : 0;
    const denom = t1 - t2;
    const frac = Math.max(0, Math.min(1, denom === 0
      ? 1
      : (t1 + (side ? QUAKE_TRACE_EPSILON : -QUAKE_TRACE_EPSILON)) / denom));
    const midf = p1f + (p2f - p1f) * frac;
    const mid = lerpVec3(p1, p2, frac);

    if (!recursiveHullCheck(node.children[side], p1f, midf, p1, mid, trace)) return false;
    if (pointContents(node.children[side ^ 1], mid) !== QUAKE_CONTENTS_SOLID) {
      return recursiveHullCheck(node.children[side ^ 1], midf, p2f, mid, p2, trace);
    }
    if (trace.allSolid) return false;

    trace.fraction = midf;
    trace.end = mid;
    trace.planeNormal = side === 0
      ? [...plane.normal] as Vec3
      : [-plane.normal[0], -plane.normal[1], -plane.normal[2]];
    return false;
  }

  function recursiveNodeCheck(
    nodeIndex: number,
    p1f: number,
    p2f: number,
    p1: Vec3,
    p2: Vec3,
    trace: QuakeHullTrace,
  ): boolean {
    if (nodeIndex < 0) {
      if ((collision.leaves?.[-nodeIndex - 1]?.contents ?? QUAKE_CONTENTS_SOLID) === QUAKE_CONTENTS_SOLID) {
        trace.startSolid = trace.startSolid || p1f === 0;
        return false;
      }
      trace.allSolid = false;
      return true;
    }

    const node = collision.nodes?.[nodeIndex];
    if (!node) return false;
    const plane = planes[node.plane];
    if (!plane) return false;

    const t1 = dotVec3(p1, plane.normal) - plane.dist;
    const t2 = dotVec3(p2, plane.normal) - plane.dist;
    if (t1 >= 0 && t2 >= 0) return recursiveNodeCheck(node.children[0], p1f, p2f, p1, p2, trace);
    if (t1 < 0 && t2 < 0) return recursiveNodeCheck(node.children[1], p1f, p2f, p1, p2, trace);

    const side = t1 < 0 ? 1 : 0;
    const denom = t1 - t2;
    const frac = Math.max(0, Math.min(1, denom === 0
      ? 1
      : (t1 + (side ? QUAKE_TRACE_EPSILON : -QUAKE_TRACE_EPSILON)) / denom));
    const midf = p1f + (p2f - p1f) * frac;
    const mid = lerpVec3(p1, p2, frac);

    if (!recursiveNodeCheck(node.children[side], p1f, midf, p1, mid, trace)) return false;
    if (nodePointContents(node.children[side ^ 1], mid) !== QUAKE_CONTENTS_SOLID) {
      return recursiveNodeCheck(node.children[side ^ 1], midf, p2f, mid, p2, trace);
    }
    if (trace.allSolid) return false;

    trace.fraction = midf;
    trace.end = mid;
    trace.planeNormal = side === 0
      ? [...plane.normal] as Vec3
      : [-plane.normal[0], -plane.normal[1], -plane.normal[2]];
    return false;
  }

  function floorTraceAt(x: number, y: number, maxZ = Infinity, minZ = -Infinity): QuakeFloorTrace | null {
    const upper = Number.isFinite(maxZ) ? maxZ : QUAKE_TRACE_RANGE;
    const lower = Number.isFinite(minZ) ? minZ : upper - QUAKE_TRACE_RANGE;
    let best = -Infinity;
    let bestBrush: QuakeClipBrush | undefined;
    const start: Vec3 = [x, y, footZToHullOriginZ(upper)];
    const end: Vec3 = [x, y, footZToHullOriginZ(lower)];
    for (const brush of solidBrushes) {
      const trace = traceBrush(brush, start, end);
      if (trace.startSolid || trace.fraction >= 1 || !trace.planeNormal || trace.planeNormal[2] < WALKABLE_NORMAL_Z) {
        continue;
      }
      const footZ = hullOriginToFootZ(trace.end);
      if (footZ <= upper + COLLISION_EPSILON && footZ >= lower - COLLISION_EPSILON && footZ > best) {
        best = footZ;
        bestBrush = brush;
      }
    }
    return best === -Infinity ? null : { z: best, ...(bestBrush ? { brush: bestBrush } : {}) };
  }

  function floorAt(x: number, y: number, maxZ = Infinity, minZ = -Infinity): number | null {
    return floorTraceAt(x, y, maxZ, minZ)?.z ?? null;
  }

  function floorContactAt(x: number, y: number, maxZ = Infinity, minZ = -Infinity): QuakeFloorContact | null {
    const floor = floorTraceAt(x, y, maxZ, minZ);
    if (!floor) return null;
    return {
      z: floor.z,
      ...(floor.brush?.entityIndex !== undefined ? { entityIndex: floor.brush.entityIndex } : {}),
      ...(floor.brush?.modelIndex !== undefined ? { modelIndex: floor.brush.modelIndex } : {}),
      ...(floor.brush?.classname ? { classname: floor.brush.classname } : {}),
    };
  }

  function contentsAt(point: Vec3): number | null {
    const pointHeadNode = runtime.pointHeadNode;
    if (!isValidPointHeadNode(pointHeadNode)) return null;
    return nodePointContents(pointHeadNode, point);
  }

  function traceUse(start: Vec3, end: Vec3): QuakeUseTrace | null {
    const trace = traceUseSolids(start, end);
    if (trace.fraction >= 1 || !trace.brush) return null;
    return {
      fraction: trace.fraction,
      end: trace.end,
      planeNormal: trace.planeNormal,
      ...(trace.brush.entityIndex !== undefined ? { entityIndex: trace.brush.entityIndex } : {}),
      ...(trace.brush.modelIndex !== undefined ? { modelIndex: trace.brush.modelIndex } : {}),
      ...(trace.brush.classname ? { classname: trace.brush.classname } : {}),
    };
  }

  function playerIntersectsBrush(entityIndex: number, offset: Vec3, origin: [number, number, number]): boolean {
    const hullOrigin = eyeToHullOrigin(origin);
    for (const brush of solidBrushes) {
      if (brush.entityIndex !== entityIndex) continue;
      const brushOffset = addVec3(brush.baseOffset, offset);
      if (pointContents(brush.headNode, subtractVec3(hullOrigin, brushOffset)) === QUAKE_CONTENTS_SOLID) return true;
    }
    return false;
  }

  function touchingTriggers(origin: [number, number, number], _eyeHeight: number): QuakeTouchedTrigger[] {
    if (!triggerBrushes.length) return [];
    const hullOrigin = eyeToHullOrigin(origin);
    const out: QuakeTouchedTrigger[] = [];
    for (const brush of triggerBrushes) {
      if (pointContents(brush.headNode, subtractVec3(hullOrigin, brush.offset)) !== QUAKE_CONTENTS_SOLID) continue;
      if (brush.entityIndex === undefined || brush.modelIndex === undefined || !brush.classname) continue;
      out.push({
        entityIndex: brush.entityIndex,
        modelIndex: brush.modelIndex,
        classname: brush.classname,
        contact: "trigger",
        ...(brush.target ? { target: brush.target } : {}),
        ...(brush.targetname ? { targetname: brush.targetname } : {}),
      });
    }
    return out;
  }

  function setBrushOffset(entityIndex: number, offset: Vec3): void {
    for (const brush of brushes) {
      if (brush.entityIndex !== entityIndex) continue;
      brush.offset = addVec3(brush.baseOffset, offset);
    }
  }

  function recordSolidTouch(brush: QuakeClipBrush | undefined, contact: QuakeTouchedTrigger["contact"] = "solid"): void {
    if (!brush || brush.kind !== "solid") return;
    if (brush.entityIndex === undefined || brush.modelIndex === undefined || !brush.classname) return;
    if (!brush.classname.startsWith("func_")) return;
    currentTouches.set(brush.entityIndex, {
      entityIndex: brush.entityIndex,
      modelIndex: brush.modelIndex,
      classname: brush.classname,
      contact,
      ...(brush.target ? { target: brush.target } : {}),
      ...(brush.targetname ? { targetname: brush.targetname } : {}),
    });
  }

  function resolve(
    origin: [number, number, number],
    previous: [number, number, number],
    _eyeHeight: number,
    currentGroundZ: number,
  ): QuakeCollisionResult {
    currentTouches = new Map();
    const previousHull = eyeToHullOrigin(previous);
    const targetHull = eyeToHullOrigin(origin);
    const dx = targetHull[0] - previousHull[0];
    const dy = targetHull[1] - previousHull[1];
    const dz = targetHull[2] - previousHull[2];
    const distance = Math.hypot(dx, dy, dz);
    const steps = Math.max(1, Math.ceil(distance / COLLISION_MAX_STEP));
    let hullOrigin = previousHull;
    let groundZ = currentGroundZ;
    let grounded = Math.abs(hullOriginToFootZ(hullOrigin) - currentGroundZ) <= GROUND_SNAP;

    for (let step = 1; step <= steps; step++) {
      const target = lerpVec3(previousHull, targetHull, step / steps);
      const result = resolveHullStep(hullOrigin, target, groundZ, grounded);
      hullOrigin = result.hullOrigin;
      groundZ = result.groundZ;
      grounded = result.grounded;
    }

    return {
      origin: hullOriginToEye(hullOrigin),
      groundZ,
      grounded,
      touches: [...currentTouches.values()],
    };
  }

  function resolveHullStep(
    start: Vec3,
    target: Vec3,
    currentGroundZ: number,
    wasGrounded: boolean,
  ): { hullOrigin: Vec3; groundZ: number; grounded: boolean } {
    const startFootZ = hullOriginToFootZ(start);
    const startGrounded = wasGrounded && Math.abs(startFootZ - currentGroundZ) <= GROUND_SNAP;
    if (startGrounded && target[2] <= start[2] + GROUND_SNAP) {
      return resolveGroundMove(start, target, currentGroundZ);
    }
    return resolveAirMove(start, target, currentGroundZ);
  }

  function resolveGroundMove(
    start: Vec3,
    target: Vec3,
    currentGroundZ: number,
  ): { hullOrigin: Vec3; groundZ: number; grounded: boolean } {
    const groundHullZ = footZToHullOriginZ(currentGroundZ);
    const startOnGround: Vec3 = [start[0], start[1], groundHullZ];
    const targetOnGround: Vec3 = [target[0], target[1], groundHullZ];
    const direct = finishGroundMove(slideMove(startOnGround, targetOnGround).position, currentGroundZ, startOnGround);
    const directMiss = distSq2(direct.hullOrigin[0], direct.hullOrigin[1], targetOnGround[0], targetOnGround[1]);
    if (directMiss <= COLLISION_EPSILON) return direct;

    const stepped = tryStepMove(startOnGround, targetOnGround, currentGroundZ);
    if (!stepped) return direct;
    const steppedMiss = distSq2(stepped.hullOrigin[0], stepped.hullOrigin[1], targetOnGround[0], targetOnGround[1]);
    return steppedMiss + COLLISION_EPSILON < directMiss ? stepped : direct;
  }

  function finishGroundMove(
    hullOrigin: Vec3,
    currentGroundZ: number,
    fallbackHullOrigin: Vec3,
  ): { hullOrigin: Vec3; groundZ: number; grounded: boolean } {
    const floor = floorTraceAt(
      hullOrigin[0],
      hullOrigin[1],
      currentGroundZ + STEP_HEIGHT + GROUND_SNAP,
      currentGroundZ - STEP_HEIGHT - GROUND_SNAP,
    );
    if (!floor) {
      const lowerFloor = floorTraceAt(
        hullOrigin[0],
        hullOrigin[1],
        currentGroundZ + STEP_HEIGHT + GROUND_SNAP,
        -Infinity,
      );
      if (!lowerFloor) {
        return { hullOrigin: fallbackHullOrigin, groundZ: currentGroundZ, grounded: true };
      }
      return { hullOrigin, groundZ: currentGroundZ, grounded: false };
    }
    recordSolidTouch(floor.brush, "floor");
    return {
      hullOrigin: [hullOrigin[0], hullOrigin[1], footZToHullOriginZ(floor.z)],
      groundZ: floor.z,
      grounded: true,
    };
  }

  function tryStepMove(
    startOnGround: Vec3,
    targetOnGround: Vec3,
    currentGroundZ: number,
  ): { hullOrigin: Vec3; groundZ: number; grounded: boolean } | null {
    const raisedStart: Vec3 = [startOnGround[0], startOnGround[1], startOnGround[2] + STEP_HEIGHT];
    const raiseTrace = traceSolids(startOnGround, raisedStart);
    if (raiseTrace.startSolid || raiseTrace.fraction < 1) return null;

    const raisedTarget: Vec3 = [targetOnGround[0], targetOnGround[1], raisedStart[2]];
    const moved = slideMove(raisedStart, raisedTarget).position;
    const floor = floorTraceAt(
      moved[0],
      moved[1],
      currentGroundZ + STEP_HEIGHT + GROUND_SNAP,
      currentGroundZ - GROUND_SNAP,
    );
    if (!floor) return null;
    recordSolidTouch(floor.brush, "floor");
    return {
      hullOrigin: [moved[0], moved[1], footZToHullOriginZ(floor.z)],
      groundZ: floor.z,
      grounded: true,
    };
  }

  function resolveAirMove(
    start: Vec3,
    target: Vec3,
    currentGroundZ: number,
  ): { hullOrigin: Vec3; groundZ: number; grounded: boolean } {
    const moved = slideMove(start, target).position;
    const footZ = hullOriginToFootZ(moved);
    const floor = floorTraceAt(moved[0], moved[1], footZ + GROUND_SNAP, footZ - GROUND_SNAP);
    if (floor && target[2] <= start[2] + COLLISION_EPSILON) {
      recordSolidTouch(floor.brush, "floor");
      return {
        hullOrigin: [moved[0], moved[1], footZToHullOriginZ(floor.z)],
        groundZ: floor.z,
        grounded: true,
      };
    }
    return { hullOrigin: moved, groundZ: currentGroundZ, grounded: false };
  }

  function slideMove(start: Vec3, end: Vec3): { position: Vec3; blocked: boolean } {
    let from = [...start] as Vec3;
    let to = [...end] as Vec3;
    let blocked = false;

    for (let bump = 0; bump < 2; bump++) {
      const trace = traceSolids(from, to);
      if (trace.startSolid) {
        recordSolidTouch(trace.brush);
        return { position: [...start] as Vec3, blocked: true };
      }
      if (trace.fraction >= 1 || !trace.planeNormal) return { position: trace.end, blocked };

      blocked = true;
      recordSolidTouch(trace.brush);
      const remaining: Vec3 = [
        to[0] - trace.end[0],
        to[1] - trace.end[1],
        to[2] - trace.end[2],
      ];
      const into = Math.min(0, dotVec3(remaining, trace.planeNormal));
      to = [
        trace.end[0] + remaining[0] - trace.planeNormal[0] * into,
        trace.end[1] + remaining[1] - trace.planeNormal[1] * into,
        trace.end[2] + remaining[2] - trace.planeNormal[2] * into,
      ];
      from = [
        trace.end[0] + trace.planeNormal[0] * QUAKE_TRACE_EPSILON,
        trace.end[1] + trace.planeNormal[1] * QUAKE_TRACE_EPSILON,
        trace.end[2] + trace.planeNormal[2] * QUAKE_TRACE_EPSILON,
      ];
      if (distanceSq3(from, to) <= COLLISION_EPSILON) return { position: trace.end, blocked };
    }

    return { position: from, blocked };
  }

  return { floorAt, floorContactAt, contentsAt, traceUse, playerIntersectsBrush, resolve, touchingTriggers, setBrushOffset };
}

export function buildQuakeCollisionWorld(polygons: Polygon[]): QuakeCollisionWorld {
  const floors: WalkSurface[] = [];
  const walls: WallSegment[] = [];

  for (const polygon of polygons) {
    const vertices = polygon.vertices;
    if (vertices.length < 3) continue;
    const normal = polygonNormal(vertices);
    if (normal[2] > WALKABLE_NORMAL_Z) {
      const bounds = bounds2(vertices);
      floors.push({
        vertices,
        normal,
        anchor: vertices[0] ?? [0, 0, 0],
        minX: bounds.minX,
        maxX: bounds.maxX,
        minY: bounds.minY,
        maxY: bounds.maxY,
      });
    } else if (Math.abs(normal[2]) < WALL_NORMAL_Z) {
      const zBounds = boundsZ(vertices);
      for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % vertices.length];
        if (!a || !b) continue;
        const lengthSq = distSq2(a[0], a[1], b[0], b[1]);
        if (lengthSq < COLLISION_EPSILON) continue;
        walls.push({
          ax: a[0],
          ay: a[1],
          bx: b[0],
          by: b[1],
          minX: Math.min(a[0], b[0]),
          maxX: Math.max(a[0], b[0]),
          minY: Math.min(a[1], b[1]),
          maxY: Math.max(a[1], b[1]),
          minZ: zBounds.minZ,
          maxZ: zBounds.maxZ,
        });
      }
    }
  }

  function floorAt(x: number, y: number, maxZ = Infinity, minZ = -Infinity): number | null {
    let best = -Infinity;
    for (const floor of floors) {
      if (x < floor.minX - PLAYER_RADIUS || x > floor.maxX + PLAYER_RADIUS) continue;
      if (y < floor.minY - PLAYER_RADIUS || y > floor.maxY + PLAYER_RADIUS) continue;
      if (!pointInPolygon2(x, y, floor.vertices)) continue;
      const z = zOnPlane(x, y, floor);
      if (!Number.isFinite(z) || z > maxZ + COLLISION_EPSILON || z < minZ - COLLISION_EPSILON) continue;
      if (z > best) best = z;
    }
    return best === -Infinity ? null : best;
  }

  function resolve(
    origin: [number, number, number],
    previous: [number, number, number],
    eyeHeight: number,
    currentGroundZ: number,
  ): QuakeCollisionResult {
    const dx = origin[0] - previous[0];
    const dy = origin[1] - previous[1];
    const distance = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(distance / COLLISION_MAX_STEP));
    let stepPrevious = previous;
    let stepGroundZ = currentGroundZ;
    let result: QuakeCollisionResult = {
      origin: previous,
      groundZ: currentGroundZ,
      grounded: true,
    };

    for (let step = 1; step <= steps; step++) {
      const target: [number, number, number] = [
        previous[0] + dx * (step / steps),
        previous[1] + dy * (step / steps),
        origin[2],
      ];
      result = resolveStep(target, stepPrevious, eyeHeight, stepGroundZ);
      stepPrevious = result.origin;
      stepGroundZ = result.groundZ;
    }

    return result;
  }

  function resolveStep(
    origin: [number, number, number],
    previous: [number, number, number],
    eyeHeight: number,
    currentGroundZ: number,
  ): QuakeCollisionResult {
    const direct = resolveCandidate(origin, previous, eyeHeight, currentGroundZ);
    if (direct) return direct;

    const xOnly = resolveCandidate([origin[0], previous[1], origin[2]], previous, eyeHeight, currentGroundZ);
    const yOnly = resolveCandidate([previous[0], origin[1], origin[2]], previous, eyeHeight, currentGroundZ);
    if (xOnly && yOnly) {
      return distanceSq2(xOnly.origin, previous) >= distanceSq2(yOnly.origin, previous) ? xOnly : yOnly;
    }
    return xOnly ?? yOnly ?? {
      origin: previous,
      groundZ: previous[2] - eyeHeight,
      grounded: true,
    };
  }

  function resolveCandidate(
    origin: [number, number, number],
    previous: [number, number, number],
    eyeHeight: number,
    currentGroundZ: number,
  ): QuakeCollisionResult | null {
    const footZ = origin[2] - eyeHeight;
    const floorZ = floorAt(origin[0], origin[1], footZ + STEP_HEIGHT, -Infinity);
    if (floorZ === null) {
      if (intersectsWall(origin, previous, footZ)) return null;
      return {
        origin,
        groundZ: currentGroundZ,
        grounded: false,
      };
    }

    const groundedFoot = Math.abs(footZ - currentGroundZ) <= GROUND_SNAP;
    const canStepUp = floorZ > footZ + GROUND_SNAP && floorZ <= currentGroundZ + STEP_HEIGHT;
    const canSnapDown = Math.abs(floorZ - footZ) <= GROUND_SNAP;
    const canStepDown = groundedFoot && floorZ < footZ - GROUND_SNAP && floorZ >= currentGroundZ - STEP_HEIGHT;
    const canGround = canStepUp || canSnapDown || canStepDown;
    const wallFootZ = canGround ? floorZ : footZ;
    const ignoredStepRiser = canStepDown ? { lowZ: floorZ, highZ: currentGroundZ } : undefined;
    if (intersectsWall(origin, previous, wallFootZ, ignoredStepRiser)) return null;
    if (canGround) {
      return {
        origin: [origin[0], origin[1], floorZ + eyeHeight],
        groundZ: floorZ,
        grounded: true,
      };
    }

    return {
      origin,
      groundZ: currentGroundZ,
      grounded: false,
    };
  }

  function intersectsWall(
    origin: [number, number, number],
    previous: [number, number, number],
    footZ: number,
    ignoredStepRiser?: { lowZ: number; highZ: number },
  ): boolean {
    const minZ = footZ + COLLISION_WALL_FLOOR_CLEARANCE;
    const maxZ = footZ + PLAYER_HEIGHT;
    const moved = distSq2(origin[0], origin[1], previous[0], previous[1]) > COLLISION_EPSILON;
    const radius = PLAYER_RADIUS + COLLISION_WALL_SKIN;
    const radiusSq = radius * radius;
    const sweepMinX = Math.min(origin[0], previous[0]) - radius;
    const sweepMaxX = Math.max(origin[0], previous[0]) + radius;
    const sweepMinY = Math.min(origin[1], previous[1]) - radius;
    const sweepMaxY = Math.max(origin[1], previous[1]) + radius;
    for (const wall of walls) {
      if (maxZ < wall.minZ || minZ > wall.maxZ) continue;
      if (sweepMaxX < wall.minX || sweepMinX > wall.maxX || sweepMaxY < wall.minY || sweepMinY > wall.maxY) continue;
      if (
        ignoredStepRiser &&
        wall.minZ >= ignoredStepRiser.lowZ - COLLISION_WALL_FLOOR_CLEARANCE &&
        wall.maxZ <= ignoredStepRiser.highZ + COLLISION_WALL_FLOOR_CLEARANCE
      ) continue;
      if (pointSegmentDistanceSq2(origin[0], origin[1], wall.ax, wall.ay, wall.bx, wall.by) < radiusSq) {
        return true;
      }
      if (
        moved &&
        segmentDistanceSq2(
          previous[0],
          previous[1],
          origin[0],
          origin[1],
          wall.ax,
          wall.ay,
          wall.bx,
          wall.by,
        ) < radiusSq
      ) {
        return true;
      }
    }
    return false;
  }

  return { floorAt, resolve };
}

function polygonNormal(vertices: Vec3[]): Vec3 {
  for (let i = 0; i < vertices.length - 2; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const c = vertices[i + 2];
    if (!a || !b || !c) continue;
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal: Vec3 = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const length = Math.hypot(normal[0], normal[1], normal[2]);
    if (length > COLLISION_EPSILON) return [normal[0] / length, normal[1] / length, normal[2] / length];
  }
  return [0, 0, 0];
}

function bounds2(vertices: Vec3[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex[0]);
    maxX = Math.max(maxX, vertex[0]);
    minY = Math.min(minY, vertex[1]);
    maxY = Math.max(maxY, vertex[1]);
  }
  return { minX, maxX, minY, maxY };
}

function boundsZ(vertices: Vec3[]): { minZ: number; maxZ: number } {
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const vertex of vertices) {
    minZ = Math.min(minZ, vertex[2]);
    maxZ = Math.max(maxZ, vertex[2]);
  }
  return { minZ, maxZ };
}

function zOnPlane(x: number, y: number, floor: WalkSurface): number {
  const normalZ = floor.normal[2];
  if (Math.abs(normalZ) < COLLISION_EPSILON) return NaN;
  return floor.anchor[2] - (
    floor.normal[0] * (x - floor.anchor[0]) +
    floor.normal[1] * (y - floor.anchor[1])
  ) / normalZ;
}

function pointInPolygon2(x: number, y: number, vertices: Vec3[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    if (!a || !b) continue;
    if (pointSegmentDistanceSq2(x, y, a[0], a[1], b[0], b[1]) < COLLISION_FLOOR_EDGE_SNAP * COLLISION_FLOOR_EDGE_SNAP) return true;
    const intersects = (a[1] > y) !== (b[1] > y) &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointSegmentDistanceSq2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < COLLISION_EPSILON) return distSq2(px, py, ax, ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return distSq2(px, py, ax + dx * t, ay + dy * t);
}

function segmentDistanceSq2(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  if (segmentsIntersect2(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    pointSegmentDistanceSq2(ax, ay, cx, cy, dx, dy),
    pointSegmentDistanceSq2(bx, by, cx, cy, dx, dy),
    pointSegmentDistanceSq2(cx, cy, ax, ay, bx, by),
    pointSegmentDistanceSq2(dx, dy, ax, ay, bx, by),
  );
}

function segmentsIntersect2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o1 = orient2(ax, ay, bx, by, cx, cy);
  const o2 = orient2(ax, ay, bx, by, dx, dy);
  const o3 = orient2(cx, cy, dx, dy, ax, ay);
  const o4 = orient2(cx, cy, dx, dy, bx, by);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function orient2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function distSq2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

function distanceSq2(a: Vec3, b: Vec3): number {
  return distSq2(a[0], a[1], b[0], b[1]);
}

function distanceSq3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}
