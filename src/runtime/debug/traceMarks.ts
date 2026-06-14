export type QuakeTraceMarkValue = boolean | number | string | null | undefined;
export type QuakeTraceMarkDetails = Record<string, QuakeTraceMarkValue>;

export interface QuakeTraceMarkEntry {
  at: number;
  details: QuakeTraceMarkDetails;
  kind: string;
}

export type QuakeTraceMarkSink = (entry: QuakeTraceMarkEntry) => void;

const quakeTraceMarkSinks = new Set<QuakeTraceMarkSink>();

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

export function markQuakeTrace(kind: string, details: QuakeTraceMarkDetails = {}): void {
  const traceSampling = isQuakeTraceSampling();
  if (!traceSampling && quakeTraceMarkSinks.size === 0) return;
  const markerKind = sanitizeTraceToken(kind);
  if (!markerKind) return;
  if (quakeTraceMarkSinks.size > 0) {
    const entry = { at: performance.now(), details: { ...details }, kind: markerKind };
    for (const sink of quakeTraceMarkSinks) {
      try {
        sink(entry);
      } catch {
        // Trace sinks are debug-only and should never affect gameplay.
      }
    }
  }
  if (!traceSampling) return;
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

export function registerQuakeTraceMarkSink(sink: QuakeTraceMarkSink): () => void {
  quakeTraceMarkSinks.add(sink);
  return () => {
    quakeTraceMarkSinks.delete(sink);
  };
}

export function isQuakeTraceSampling(): boolean {
  return typeof window !== "undefined" && Boolean(window.__chromeCaptureTraceSampling);
}

export function isQuakeDebugDomMetadataEnabled(): boolean {
  return typeof window !== "undefined" && Boolean(window.__cssQuakeDebugDomMetadata);
}
