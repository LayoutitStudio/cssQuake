import {
  BASE_TILE,
  type Polygon,
  type PolyMeshHandle,
  type Vec3,
} from "@layoutit/polycss";

import type { QuakePreparedRenderBundle } from "../prepare/scene";

export function mountQuakeRenderBundleMesh(
  sceneElement: HTMLElement,
  renderBundle: QuakePreparedRenderBundle,
): PolyMeshHandle {
  const template = document.createElement("template");
  template.innerHTML = renderBundle.meshHtml.trim();
  const element = template.content.firstElementChild;
  if (!(element instanceof HTMLElement) || !element.classList.contains("polycss-mesh")) {
    throw new Error("Quake render bundle did not contain a .polycss-mesh root.");
  }
  const leafCount = element.querySelectorAll("b,i,s,u").length;
  if (leafCount !== renderBundle.leafCount) {
    throw new Error(`Quake render bundle leaf count mismatch: expected ${renderBundle.leafCount}, got ${leafCount}.`);
  }
  sceneElement.appendChild(element);
  return createQuakeRenderBundleMeshHandle(element);
}

export function stripPolyMeshMetadata(element: HTMLElement): void {
  element.removeAttribute("data-poly-mesh-id");
  element.removeAttribute("data-poly-mesh-index");
  for (const leaf of element.querySelectorAll<HTMLElement>("[data-poly-index]")) {
    leaf.removeAttribute("data-poly-index");
  }
}

export function createQuakeRenderBundleMeshHandle(element: HTMLElement): PolyMeshHandle {
  const transform: { position?: Vec3; rotation?: Vec3; scale?: number | Vec3 } = {};
  const handle = {
    polygons: [] as Polygon[],
    element,
    transform,
    remove: () => element.remove(),
    setPolygons: () => undefined,
    updatePolygon: () => undefined,
    setTransform: (nextTransform: Partial<typeof transform>) => {
      if (nextTransform.position !== undefined) transform.position = nextTransform.position;
      if (nextTransform.rotation !== undefined) transform.rotation = nextTransform.rotation;
      if (nextTransform.scale !== undefined) transform.scale = nextTransform.scale;
      const style = quakeMeshTransformStyle(transform);
      if (style) {
        element.style.transform = style;
      } else {
        element.style.removeProperty("transform");
      }
    },
    dispose: () => element.remove(),
    rebakeAtlas: () => undefined,
    getPosition: () => transform.position,
    getRotation: () => transform.rotation,
    getScale: () => transform.scale,
    getPolygons: () => [],
  };
  return handle as PolyMeshHandle;
}

function quakeMeshTransformStyle(transform: {
  position?: Vec3;
  rotation?: Vec3;
  scale?: number | Vec3;
}): string | undefined {
  const scaleX = typeof transform.scale === "number" ? transform.scale : transform.scale?.[0] ?? 1;
  const scaleY = typeof transform.scale === "number" ? transform.scale : transform.scale?.[1] ?? 1;
  const scaleZ = typeof transform.scale === "number" ? transform.scale : transform.scale?.[2] ?? 1;
  const hasScale = scaleX !== 1 || scaleY !== 1 || scaleZ !== 1;
  const [x, y, z] = transform.position
    ? [transform.position[1] * BASE_TILE, transform.position[0] * BASE_TILE, transform.position[2] * BASE_TILE]
    : [0, 0, 0];
  const parts: string[] = [];
  if (x !== 0 || y !== 0 || z !== 0) parts.push(`translate3d(${x}px, ${y}px, ${z}px)`);
  if (transform.rotation?.[0]) parts.push(`rotateY(${-transform.rotation[0]}deg)`);
  if (transform.rotation?.[1]) parts.push(`rotateX(${-transform.rotation[1]}deg)`);
  if (transform.rotation?.[2]) parts.push(`rotateZ(${-transform.rotation[2]}deg)`);
  if (hasScale) parts.push(`scale3d(${scaleX}, ${scaleY}, ${scaleZ})`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}
