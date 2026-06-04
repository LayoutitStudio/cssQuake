import type { Vec3 } from "@layoutit/polycss";

import type {
  QuakeBrushModel,
  QuakeLeaf,
  QuakeNode,
  QuakePlane,
  QuakeVertex,
  QuakeVisibility,
  QuakeVisibilityCandidate,
} from "./scene";

interface QuakeBrushVisibility {
  leafIndex: number;
  faceIndices: number[];
}

export function buildSourceFaceVisibilityKeys(
  planes: QuakePlane[],
  nodes: QuakeNode[],
  leaves: QuakeLeaf[],
  markSurfaces: number[],
  visData: Uint8Array,
  candidates: QuakeVisibilityCandidate[],
  brushModels: QuakeBrushModel[],
): Map<number, string> {
  if (!planes.length || !nodes.length || !leaves.length) {
    return new Map(candidates.map((candidate) => [candidate.faceIndex, "all"]));
  }
  const sourceFaces = sourceFaceSetFor(candidates);
  const worldFaceByLeaf = buildWorldFaceByLeaf(leaves, markSurfaces, sourceFaces);
  const brushVisibility = buildBrushVisibility(brushModels, sourceFaces, planes, nodes);
  const visibleFromLeafByFace = new Map<number, number[]>();
  for (const faceIndex of sourceFaces) visibleFromLeafByFace.set(faceIndex, []);

  for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
    const visibleFaces = visibleSourceFacesForLeaf(
      leafIndex,
      leaves,
      worldFaceByLeaf,
      visData,
      brushVisibility,
      sourceFaces,
    ) ?? sourceFaces;
    for (const faceIndex of visibleFaces) {
      visibleFromLeafByFace.get(faceIndex)?.push(leafIndex);
    }
  }

  const keys = new Map<number, string>();
  for (const [faceIndex, visibleLeaves] of visibleFromLeafByFace) {
    keys.set(faceIndex, visibleLeaves.join(","));
  }
  return keys;
}

export function buildVisibility(
  planes: QuakePlane[],
  nodes: QuakeNode[],
  leaves: QuakeLeaf[],
  markSurfaces: number[],
  visData: Uint8Array,
  candidates: QuakeVisibilityCandidate[],
  brushModels: QuakeBrushModel[],
  pivot: QuakeVertex,
): QuakeVisibility | undefined {
  if (!planes.length || !nodes.length || !leaves.length) return undefined;
  const sourceFaces = sourceFaceSetFor(candidates);
  const renderFacesBySource = renderFaceMapFor(candidates);
  const faceForPolygon = candidates.map((candidate) => candidate.faceIndex);
  const worldFaceByLeaf = buildWorldFaceByLeaf(leaves, markSurfaces, sourceFaces);
  const brushVisibility = buildBrushVisibility(brushModels, sourceFaces, planes, nodes);
  const allFaces = new Set(candidates.map((candidate) => candidate.faceIndex));

  function leafIndexAt(point: Vec3): number {
    return leafForPoint(polyToQuake(point, pivot), planes, nodes);
  }

  function visibleLeavesAt(point: Vec3): Set<number> | null {
    const leafIndex = leafIndexAt(point);
    const leaf = leaves[leafIndex];
    if (!leaf) return new Set([leafIndex]);
    if (leaf.visOffset < 0 || !visData.length) return null;
    const visible = decompressVisibleLeaves(visData, leaf.visOffset, leaves.length);
    const out = new Set<number>([leafIndex]);
    for (let i = 0; i < visible.length; i++) {
      if (visible[i]) out.add(i);
    }
    return out;
  }

  function visibleFacesAt(point: Vec3): Set<number> | null {
    const leafIndex = leafIndexAt(point);
    const sourceVisibleFaces = visibleSourceFacesForLeaf(
      leafIndex,
      leaves,
      worldFaceByLeaf,
      visData,
      brushVisibility,
      sourceFaces,
    );
    if (!sourceVisibleFaces) return allFaces;
    const faces = new Set<number>();
    for (const sourceFaceIndex of sourceVisibleFaces) {
      for (const renderFaceIndex of renderFacesBySource.get(sourceFaceIndex) ?? []) {
        faces.add(renderFaceIndex);
      }
    }
    return faces;
  }

  return { faceForPolygon, leafIndexAt, visibleLeavesAt, visibleFacesAt };
}

function sourceFaceSetFor(candidates: QuakeVisibilityCandidate[]): Set<number> {
  const faces = new Set<number>();
  for (const candidate of candidates) {
    for (const faceIndex of candidate.sourceFaceIndices) faces.add(faceIndex);
  }
  return faces;
}

function renderFaceMapFor(candidates: QuakeVisibilityCandidate[]): Map<number, number[]> {
  const faces = new Map<number, number[]>();
  for (const candidate of candidates) {
    for (const sourceFaceIndex of candidate.sourceFaceIndices) {
      const renderFaces = faces.get(sourceFaceIndex);
      if (renderFaces) {
        renderFaces.push(candidate.faceIndex);
      } else {
        faces.set(sourceFaceIndex, [candidate.faceIndex]);
      }
    }
  }
  return faces;
}

function buildWorldFaceByLeaf(
  leaves: QuakeLeaf[],
  markSurfaces: number[],
  sourceFaces: Set<number>,
): Array<Set<number>> {
  return leaves.map((leaf) => {
    const faces = new Set<number>();
    const end = leaf.firstMarkSurface + leaf.markSurfaceCount;
    for (let i = leaf.firstMarkSurface; i < end; i++) {
      const faceIndex = markSurfaces[i];
      if (faceIndex !== undefined && sourceFaces.has(faceIndex)) faces.add(faceIndex);
    }
    return faces;
  });
}

function buildBrushVisibility(
  brushModels: QuakeBrushModel[],
  sourceFaces: Set<number>,
  planes: QuakePlane[],
  nodes: QuakeNode[],
): QuakeBrushVisibility[] {
  return brushModels.map((brushModel) => ({
    leafIndex: leafForPoint(brushModel.center, planes, nodes),
    faceIndices: brushModel.faceIndices.filter((faceIndex) => sourceFaces.has(faceIndex)),
  })).filter((brushModel) => brushModel.faceIndices.length > 0);
}

function visibleSourceFacesForLeaf(
  leafIndex: number,
  leaves: QuakeLeaf[],
  worldFaceByLeaf: Array<Set<number>>,
  visData: Uint8Array,
  brushVisibility: QuakeBrushVisibility[],
  sourceFaces: Set<number>,
): Set<number> | null {
  const leaf = leaves[leafIndex];
  if (!leaf) return sourceFaces;
  if (leaf.visOffset < 0 || !visData.length) return null;

  const visibleLeaves = decompressVisibleLeaves(visData, leaf.visOffset, leaves.length);
  const faces = new Set<number>();
  for (let i = 0; i < visibleLeaves.length; i++) {
    if (!visibleLeaves[i]) continue;
    for (const faceIndex of worldFaceByLeaf[i] ?? []) faces.add(faceIndex);
  }
  for (const brushModel of brushVisibility) {
    if (brushModel.leafIndex !== leafIndex && !visibleLeaves[brushModel.leafIndex]) continue;
    for (const faceIndex of brushModel.faceIndices) faces.add(faceIndex);
  }
  return faces;
}

function leafForPoint(point: QuakeVertex, planes: QuakePlane[], nodes: QuakeNode[]): number {
  let index = 0;
  for (let guard = 0; guard < nodes.length; guard++) {
    const node = nodes[index];
    if (!node) return 0;
    const plane = planes[node.plane];
    if (!plane) return 0;
    const dist = point.x * plane.normal.x + point.y * plane.normal.y + point.z * plane.normal.z - plane.dist;
    const child = node.children[dist >= 0 ? 0 : 1];
    if (child < 0) return -child - 1;
    index = child;
  }
  return 0;
}

function decompressVisibleLeaves(visData: Uint8Array, offset: number, leafCount: number): boolean[] {
  const visible = Array.from({ length: leafCount }, () => false);
  let leaf = 1;
  let cursor = offset;
  while (leaf < leafCount && cursor < visData.length) {
    const value = visData[cursor++] ?? 0;
    if (value !== 0) {
      for (let bit = 0; bit < 8 && leaf < leafCount; bit++, leaf++) {
        visible[leaf] = (value & (1 << bit)) !== 0;
      }
      continue;
    }
    const skip = visData[cursor++] ?? 0;
    leaf += skip * 8;
  }
  return visible;
}

function polyToQuake(point: Vec3, pivot: QuakeVertex): QuakeVertex {
  return {
    x: point[0] / QUAKE_UNIT_SCALE + pivot.x,
    y: point[1] / QUAKE_UNIT_SCALE + pivot.y,
    z: point[2] / QUAKE_UNIT_SCALE + pivot.z,
  };
}

const QUAKE_UNIT_SCALE = 1 / 48;
