export const QUAKE_ASSETS_REGENERATING_STATUS = "Assets regenerating";
export const QUAKE_ASSETS_REGENERATING_ACTION =
  "Wait for pnpm prepare:quake to finish, then reload.";
export const QUAKE_LOADING_CONSOLE_PAK_LINE = "Assets from id1/pak0.pak";

const QUAKE_LOADING_CONSOLE_BOOT_LINES = [
  "Quake (C) 1996 id Software, Inc.",
  "Shareware version 1.06",
  "Host_Init",
] as const;
const QUAKE_LOADING_CONSOLE_LINE_DELAY_MS = 55;
const QUAKE_LOADING_CONSOLE_LINE_DELAYS_MS = [38, 104, 26, 78, 33, 118, 24, 69] as const;
const QUAKE_LOADING_CONSOLE_MAX_LINES = 28;
const QUAKE_LOADING_ERROR_LINE_LIMIT = 10;
const QUAKE_LOADING_ERROR_LINE_MAX_CHARS = 42;

export interface QuakeLoadingProgressSnapshot {
  completed: number;
  total: number;
  visualProgress?: number;
}

export interface QuakeLoadingProgressTracker {
  setStatus(status: string): void;
  startTask(status?: string): () => void;
}

interface QuakeLoadingConsoleOptions {
  overlay: HTMLElement | null;
  status: HTMLElement | null;
  progress: HTMLElement | null;
  progressFill: HTMLElement | null;
  action: HTMLElement | null;
  hasCurrentResult: () => boolean;
  isLoading: () => boolean;
  renderBitmapText: (element: HTMLElement) => void;
}

export interface QuakeLoadingConsole {
  appendLinesNow(lines: string[]): void;
  clearQueue(): void;
  completeQueue(): void;
  createProgressTracker(status?: string): QuakeLoadingProgressTracker;
  errorLines(error: unknown): string[];
  hideAction(): void;
  hideProgress(): void;
  queueLine(status: string, key?: string | null): void;
  reset(status?: string): void;
  setLines(lines: string[]): void;
  showAction(message: string): void;
  showProgress(): void;
  updateDisplay(status: string, progress: QuakeLoadingProgressSnapshot): void;
  waitForQueue(): Promise<void>;
}

export function createQuakeLoadingConsole(options: QuakeLoadingConsoleOptions): QuakeLoadingConsole {
  let lines: string[] = [];
  let lineKeys: (string | null)[] = [];
  let lineQueue: { key: string | null; line: string }[] = [];
  let lastStatus = "";
  let currentStatus = "";
  let lineTimer: number | null = null;
  let drainResolvers: (() => void)[] = [];

  function createProgressTracker(status = "Loading"): QuakeLoadingProgressTracker {
    let completed = 0;
    let total = 0;
    let trackerStatus = status;
    let visualProgress = 0;
    const groups = new Map<string, { completed: number; total: number }>();

    const groupForStatus = (groupStatus: string) => {
      let group = groups.get(groupStatus);
      if (!group) {
        group = { completed: 0, total: 0 };
        groups.set(groupStatus, group);
      }
      return group;
    };

    const render = () => {
      const actualProgress = total > 0 ? completed / total : 0;
      visualProgress = total > 0 ? Math.max(visualProgress, actualProgress) : 0;
      const group = groups.get(trackerStatus);
      updateDisplay(trackerStatus, {
        completed: group?.completed ?? completed,
        total: group?.total ?? total,
        visualProgress,
      });
    };

    return {
      setStatus(nextStatus) {
        trackerStatus = nextStatus;
        render();
      },
      startTask(taskStatus = trackerStatus) {
        let done = false;
        const group = groupForStatus(taskStatus);
        trackerStatus = taskStatus;
        group.total++;
        total++;
        render();
        return () => {
          if (done) return;
          done = true;
          trackerStatus = taskStatus;
          group.completed = Math.min(group.total, group.completed + 1);
          completed = Math.min(total, completed + 1);
          render();
        };
      },
    };
  }

  function reset(status = "Loading"): void {
    clearQueue();
    lines = [];
    lineKeys = [];
    lastStatus = "";
    currentStatus = "";
    render();
    if (!options.hasCurrentResult() && status === "Loading") {
      for (const line of QUAKE_LOADING_CONSOLE_BOOT_LINES) {
        queueLine(line);
      }
    }
    if (!options.hasCurrentResult() && status === "Loading") return;
    updateConsoleStatus(status, 0, 0);
  }

  function clearQueue(): void {
    if (lineTimer !== null) {
      window.clearTimeout(lineTimer);
      lineTimer = null;
    }
    lineQueue = [];
    resolveDrain();
  }

  function completeQueue(): void {
    if (lineTimer !== null) {
      window.clearTimeout(lineTimer);
      lineTimer = null;
    }
    if (lineQueue.length === 0) {
      resolveDrain();
      return;
    }
    const queuedLines = lineQueue;
    lineQueue = [];
    for (const queued of queuedLines) {
      appendLineNow(queued.line, queued.key, { render: false });
    }
    render();
    resolveDrain();
  }

  function appendLinesNow(nextLines: string[]): void {
    if (!nextLines.length) return;
    if (lineTimer !== null) {
      window.clearTimeout(lineTimer);
      lineTimer = null;
    }
    lineQueue = [];
    for (const line of nextLines) {
      appendLineNow(line, null, { render: false });
    }
    render();
    resolveDrain();
  }

  function setLines(nextLines: string[]): void {
    clearQueue();
    lines = nextLines;
    lineKeys = nextLines.map(() => null);
    lastStatus = nextLines[nextLines.length - 1] ?? "";
    currentStatus = "";
    render();
  }

  function errorLines(error: unknown): string[] {
    if (error === undefined || error === null) return [];
    const rawLines = errorText(error)
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const nextLines: string[] = [];
    for (let index = 0; index < rawLines.length && nextLines.length < QUAKE_LOADING_ERROR_LINE_LIMIT; index++) {
      const prefix = index === 0 ? "error: " : "";
      for (const line of wrapLine(`${prefix}${rawLines[index]}`)) {
        nextLines.push(line);
        if (nextLines.length >= QUAKE_LOADING_ERROR_LINE_LIMIT) break;
      }
    }
    return nextLines;
  }

  function errorText(error: unknown): string {
    if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
    if (typeof error === "string") return error;
    try {
      const json = JSON.stringify(error);
      if (json) return json;
    } catch {
      // Fall through to String().
    }
    return String(error);
  }

  function wrapLine(line: string): string[] {
    if (line.length <= QUAKE_LOADING_ERROR_LINE_MAX_CHARS) return [line];
    const words = line.split(/\s+/).filter(Boolean);
    const wrapped: string[] = [];
    let current = "";
    for (const word of words) {
      if (word.length > QUAKE_LOADING_ERROR_LINE_MAX_CHARS) {
        if (current) {
          wrapped.push(current);
          current = "";
        }
        for (let index = 0; index < word.length; index += QUAKE_LOADING_ERROR_LINE_MAX_CHARS) {
          wrapped.push(word.slice(index, index + QUAKE_LOADING_ERROR_LINE_MAX_CHARS));
        }
        continue;
      }
      const next = current ? `${current} ${word}` : word;
      if (next.length <= QUAKE_LOADING_ERROR_LINE_MAX_CHARS) {
        current = next;
      } else {
        wrapped.push(current);
        current = word;
      }
    }
    if (current) wrapped.push(current);
    return wrapped.length ? wrapped : [line.slice(0, QUAKE_LOADING_ERROR_LINE_MAX_CHARS)];
  }

  function queueLine(status: string, key: string | null = null): void {
    if (!canQueue()) return;
    const line = status.replace(/\s+/g, " ").trim();
    if (!line) return;
    if (key && (replaceDisplayedLine(key, line) || replaceQueuedLine(key, line))) return;
    const lastQueuedLine = lineQueue[lineQueue.length - 1]?.line;
    if (!key && (line === lastStatus || lastQueuedLine === line)) return;
    lineQueue.push({ key, line });
    scheduleLine();
  }

  function replaceDisplayedLine(key: string, line: string): boolean {
    const index = lineKeys.lastIndexOf(key);
    if (index < 0) return false;
    if (lines[index] === line) return true;
    lines[index] = line;
    if (index === lines.length - 1) {
      lastStatus = line;
      currentStatus = key;
    }
    render();
    return true;
  }

  function replaceQueuedLine(key: string, line: string): boolean {
    for (const queued of lineQueue) {
      if (queued.key !== key) continue;
      queued.line = line;
      return true;
    }
    return false;
  }

  function scheduleLine(): void {
    if (lineTimer !== null || lineQueue.length === 0) return;
    if (!canQueue()) {
      clearQueue();
      return;
    }
    const delay = lineDelay();
    lineTimer = window.setTimeout(flushLine, delay);
  }

  function lineDelay(): number {
    if (lines.length === 0) return 0;
    const index = (lines.length - 1) % QUAKE_LOADING_CONSOLE_LINE_DELAYS_MS.length;
    return QUAKE_LOADING_CONSOLE_LINE_DELAYS_MS[index] ?? QUAKE_LOADING_CONSOLE_LINE_DELAY_MS;
  }

  function flushLine(): void {
    lineTimer = null;
    if (!canQueue()) {
      clearQueue();
      return;
    }
    const queued = lineQueue.shift();
    if (queued) appendLineNow(queued.line, queued.key);
    resolveDrain();
    scheduleLine();
  }

  function waitForQueue(): Promise<void> {
    if (lineQueue.length === 0 && lineTimer === null) return Promise.resolve();
    return new Promise((resolve) => {
      drainResolvers.push(resolve);
    });
  }

  function resolveDrain(): void {
    if (lineQueue.length > 0 || lineTimer !== null) return;
    if (drainResolvers.length === 0) return;
    const resolvers = drainResolvers;
    drainResolvers = [];
    for (const resolve of resolvers) resolve();
  }

  function appendLineNow(line: string, key: string | null, appendOptions: { render?: boolean } = {}): void {
    if (key) currentStatus = key;
    lastStatus = line;
    lines.push(line);
    lineKeys.push(key);
    if (lines.length > QUAKE_LOADING_CONSOLE_MAX_LINES) {
      lines = lines.slice(-QUAKE_LOADING_CONSOLE_MAX_LINES);
      lineKeys = lineKeys.slice(-QUAKE_LOADING_CONSOLE_MAX_LINES);
    }
    if (appendOptions.render === false) return;
    render();
  }

  function render(): void {
    if (!options.status || !canRender()) return;
    options.status.textContent = "";
    const fragment = document.createDocumentFragment();
    for (const line of lines) {
      const element = document.createElement("span");
      element.className = "quake-loading-console-line quake-bm-copy";
      element.textContent = line;
      fragment.append(element);
    }
    options.status.append(fragment);
    options.status.setAttribute("aria-label", lines.join("\n"));
    options.renderBitmapText(options.status);
  }

  function canRender(): boolean {
    return Boolean(options.overlay && !options.overlay.hidden);
  }

  function canQueue(): boolean {
    return options.isLoading() || options.overlay?.classList.contains("quake-loading-death") === true;
  }

  function updateConsoleStatus(status: string, completed: number, total: number): void {
    if (!canQueue()) return;
    const key = status.replace(/\s+/g, " ").trim() || "Loading";
    const line = formatStatus(key, completed, total);
    if (
      key === currentStatus &&
      lines.length > 0 &&
      lineKeys[lineKeys.length - 1] === key
    ) {
      if (lines[lines.length - 1] === line) return;
      lines[lines.length - 1] = line;
      lastStatus = line;
      render();
      return;
    }
    queueLine(line, key);
  }

  function formatStatus(status: string, completed: number, total: number): string {
    const label = statusLabel(status);
    if (label.startsWith("error:")) return label;
    if (total <= 1) return label;
    return `${label} ${completed}/${total}`;
  }

  function statusLabel(status: string): string {
    const label = status.replace(/\s+/g, " ").trim() || "Loading";
    switch (label) {
      case "Loading":
        return "Loading Quake data";
      case "Manifest":
        return "Loaded manifest";
      case "Loading manifest":
        return "Loaded manifest";
      case "Game logic":
        return "Loaded progs";
      case "Pickup definitions":
        return "Loaded definitions";
      case "Weapon model":
        return "Weapon model";
      case "Pickup models":
        return "Pickup models";
      case "Monster models":
        return "Monster models";
      case "Map model assets":
        return "Brush/submodels";
      case "Loading models":
        return "Models";
      case "Preparing view":
        return "Rendered first frame";
      case "Load failed":
        return "Load failed";
      case QUAKE_ASSETS_REGENERATING_STATUS:
        return QUAKE_ASSETS_REGENERATING_STATUS;
      default:
        break;
    }
    const worldBspMatch = /^World ([a-z0-9_]+)\.bsp$/i.exec(label);
    if (worldBspMatch) return `World BSP: ${worldBspMatch[1].toLowerCase()}.bsp`;
    const mapModelsMatch = /^Loading ([a-z0-9_]+) models$/i.exec(label);
    if (mapModelsMatch) return `Precache ${mapModelsMatch[1].toLowerCase()} models`;
    const mapMatch = /^Loading ([a-z0-9_]+)$/i.exec(label);
    if (mapMatch) return `World ${mapMatch[1].toLowerCase()}.bsp`;
    return label;
  }

  function updateDisplay(status: string, progress: QuakeLoadingProgressSnapshot): void {
    const total = Math.max(0, Math.trunc(progress.total));
    const completed = Math.max(0, Math.min(total, Math.trunc(progress.completed)));
    const actualProgress = total > 0 ? completed / total : 0;
    const visualProgress = Math.max(0, Math.min(1, progress.visualProgress ?? actualProgress));
    const percent = Math.round(visualProgress * 100);
    updateConsoleStatus(status, completed, total);
    if (options.progress) {
      options.progress.style.setProperty("--quake-loading-progress", String(percent / 100));
      if (total > 0) {
        options.progress.classList.remove("quake-loading-progress-indeterminate");
        options.progress.setAttribute("aria-valuenow", String(percent));
        options.progress.setAttribute("aria-valuetext", `${completed} of ${total}`);
      } else {
        options.progress.classList.add("quake-loading-progress-indeterminate");
        options.progress.removeAttribute("aria-valuenow");
        options.progress.setAttribute("aria-valuetext", "Loading");
      }
    }
    if (options.progressFill) options.progressFill.hidden = false;
  }

  function hideAction(): void {
    if (!options.action) return;
    options.action.textContent = "";
    options.action.hidden = true;
  }

  function showAction(message: string): void {
    if (!options.action) return;
    options.action.textContent = message;
    options.action.hidden = false;
    options.renderBitmapText(options.action);
  }

  function hideProgress(): void {
    if (options.progress) options.progress.hidden = true;
  }

  function showProgress(): void {
    if (options.progress) options.progress.hidden = false;
  }

  return {
    appendLinesNow,
    clearQueue,
    completeQueue,
    createProgressTracker,
    errorLines,
    hideAction,
    hideProgress,
    queueLine,
    reset,
    setLines,
    showAction,
    showProgress,
    updateDisplay,
    waitForQueue,
  };
}

export function quakeLoadingProgressGroup(
  progress: QuakeLoadingProgressTracker | undefined,
  status: string,
): QuakeLoadingProgressTracker | undefined {
  if (!progress) return undefined;
  return {
    setStatus(nextStatus) {
      progress.setStatus(nextStatus);
    },
    startTask(taskStatus = status) {
      return progress.startTask(taskStatus);
    },
  };
}
