type QuakeTraceMarkValue = boolean | number | string | null | undefined;

declare global {
  interface Window {
    __chromeCaptureTraceSampling?: boolean;
    __cssQuakeDebugDomMetadata?: boolean;
  }
}

function sanitizeTraceToken(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.:=@/-]/g, "_")
    .slice(0, 96);
}

function formatTraceValue(value: QuakeTraceMarkValue): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
  return sanitizeTraceToken(String(value));
}

export function markQuakeTrace(kind: string, details: Record<string, QuakeTraceMarkValue> = {}): void {
  if (!isQuakeTraceSampling()) return;
  const markerKind = sanitizeTraceToken(kind);
  if (!markerKind) return;
  const parts = Object.entries(details)
    .map(([key, value]) => {
      const formatted = formatTraceValue(value);
      return formatted === null ? "" : `${sanitizeTraceToken(key)}=${formatted}`;
    })
    .filter(Boolean);
  const label = `cssquake:${markerKind}${parts.length ? ` ${parts.join(" ")}` : ""}`;
  try {
    performance.mark(label);
    console.timeStamp(label);
  } catch {
    // Trace markers should never affect gameplay.
  }
}

export function isQuakeTraceSampling(): boolean {
  return typeof window !== "undefined" && Boolean(window.__chromeCaptureTraceSampling);
}

export function isQuakeDebugDomMetadataEnabled(): boolean {
  return typeof window !== "undefined" && Boolean(window.__cssQuakeDebugDomMetadata);
}
