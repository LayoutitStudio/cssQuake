const QUAKE_POINTER_TRACE_LIMIT = 200;

export type QuakePointerTraceValue = string | number | boolean | null;
export type QuakePointerTraceDetails = Record<string, QuakePointerTraceValue>;

interface QuakePointerTraceEntry {
  id: number;
  at: number;
  kind: string;
  details: QuakePointerTraceDetails;
}

interface QuakePointerTraceWindow {
  __cssQuakePointerTrace?: QuakePointerTraceEntry[];
  __cssQuakePointerTraceClear?: () => void;
  __cssQuakePointerTraceDump?: () => string;
}

interface QuakePointerTracerOptions {
  enabled: () => boolean;
  logToConsole: () => boolean;
  baseDetails: () => QuakePointerTraceDetails;
}

export interface QuakePointerTracer {
  syncAccessors(): QuakePointerTraceWindow | null;
  trace(kind: string, details?: QuakePointerTraceDetails): void;
}

export function createQuakePointerTracer(options: QuakePointerTracerOptions): QuakePointerTracer {
  let serial = 0;

  function syncAccessors(): QuakePointerTraceWindow | null {
    if (!options.enabled()) return null;
    const traceWindow = window as unknown as QuakePointerTraceWindow;
    traceWindow.__cssQuakePointerTrace ??= [];
    traceWindow.__cssQuakePointerTraceDump = () => JSON.stringify(traceWindow.__cssQuakePointerTrace ?? [], null, 2);
    traceWindow.__cssQuakePointerTraceClear = () => {
      serial = 0;
      traceWindow.__cssQuakePointerTrace = [];
      syncTraceDom([]);
    };
    syncTraceDom(traceWindow.__cssQuakePointerTrace);
    return traceWindow;
  }

  function trace(kind: string, details: QuakePointerTraceDetails = {}): void {
    const traceWindow = syncAccessors();
    if (!traceWindow) return;
    const traceEntries = traceWindow.__cssQuakePointerTrace ?? [];
    const entry: QuakePointerTraceEntry = {
      id: ++serial,
      at: Math.round(performance.now() * 10) / 10,
      kind,
      details: {
        ...options.baseDetails(),
        ...details,
      },
    };
    traceEntries.push(entry);
    if (traceEntries.length > QUAKE_POINTER_TRACE_LIMIT) {
      traceEntries.splice(0, traceEntries.length - QUAKE_POINTER_TRACE_LIMIT);
    }
    traceWindow.__cssQuakePointerTrace = traceEntries;
    syncTraceDom(traceEntries);
    if (options.logToConsole()) {
      console.debug(`cssquake:pointer ${JSON.stringify(entry)}`);
    }
  }

  return { syncAccessors, trace };
}

function syncTraceDom(trace: readonly QuakePointerTraceEntry[]): void {
  let element = document.getElementById("quake-pointer-trace-dump") as HTMLScriptElement | null;
  if (!element) {
    element = document.createElement("script");
    element.id = "quake-pointer-trace-dump";
    element.type = "application/json";
    document.body.appendChild(element);
  }
  element.dataset.count = String(trace.length);
  element.textContent = JSON.stringify(trace);
}

export function quakePointerEventTargetLabel(target: EventTarget | null): string | null {
  if (!target) return null;
  if (target === window) return "window";
  if (target === document) return "document";
  if (target instanceof Element) return quakePointerDomNodeLabel(target);
  if (target instanceof Node) return target.nodeName.toLowerCase();
  return target.constructor?.name ?? typeof target;
}

function quakePointerDomNodeLabel(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes = Array.from(element.classList)
    .slice(0, 2)
    .map((className) => `.${className}`)
    .join("");
  return `${tag}${id}${classes}`;
}

export function quakePointerUserActivationDetails(): QuakePointerTraceDetails {
  const activation = (navigator as Navigator & {
    userActivation?: {
      hasBeenActive: boolean;
      isActive: boolean;
    };
  }).userActivation;
  return {
    userActivationActive: activation?.isActive ?? null,
    userActivationHasBeenActive: activation?.hasBeenActive ?? null,
  };
}

export function quakePointerErrorDetails(error: unknown): QuakePointerTraceDetails {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message.slice(0, 200),
    };
  }
  return {
    errorName: typeof error,
    errorMessage: String(error).slice(0, 200),
  };
}
