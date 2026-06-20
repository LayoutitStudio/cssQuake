export interface QuakeRuntimeViewportSize {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
}

export interface QuakeRuntimeViewportFallback {
  width?: number;
  height?: number;
}

export function quakeRuntimeViewportSize(
  fallback: QuakeRuntimeViewportFallback = {},
): QuakeRuntimeViewportSize {
  const visualViewport = window.visualViewport;
  const visualWidth = positiveFiniteNumber(visualViewport?.width);
  const visualHeight = positiveFiniteNumber(visualViewport?.height);
  const root = document.documentElement;
  const width = visualWidth ??
    positiveFiniteNumber(fallback.width) ??
    positiveFiniteNumber(window.innerWidth) ??
    positiveFiniteNumber(root.clientWidth) ??
    1;
  const height = visualHeight ??
    positiveFiniteNumber(fallback.height) ??
    positiveFiniteNumber(window.innerHeight) ??
    positiveFiniteNumber(root.clientHeight) ??
    1;
  const usesVisualViewport = visualWidth !== undefined || visualHeight !== undefined;
  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
    offsetLeft: usesVisualViewport ? finiteNumber(visualViewport?.offsetLeft) ?? 0 : 0,
    offsetTop: usesVisualViewport ? finiteNumber(visualViewport?.offsetTop) ?? 0 : 0,
  };
}

export function quakeRuntimeViewportCenterCss(
  viewport: QuakeRuntimeViewportSize,
  axis: "x" | "y",
): string {
  const offset = axis === "x" ? viewport.offsetLeft : viewport.offsetTop;
  const size = axis === "x" ? viewport.width : viewport.height;
  return `${Math.round(offset + size / 2)}px`;
}

function positiveFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
