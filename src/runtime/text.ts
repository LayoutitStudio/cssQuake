import { mountQuakeBitmapText } from "./bitmapText";

const QUAKE_NOTIFY_MAX_LINES = 4;
const QUAKE_TEXT_LINE_CHARS = 40;
const QUAKE_NOTIFY_DEFAULT_MS = 3000;
const QUAKE_CENTERPRINT_DEFAULT_MS = 2600;

export interface QuakeNotifyTextOptions {
  durationMs?: number;
}

export interface QuakeCenterPrintOptions {
  durationMs?: number;
}

export interface QuakeTextController {
  clear: () => void;
  clearCenterPrint: () => void;
  clearNotify: () => void;
  notify: (text: string, options?: QuakeNotifyTextOptions) => void;
  centerPrint: (text: string, options?: QuakeCenterPrintOptions) => void;
  setCenterPrint: (text: string) => void;
  setNotify: (text: string) => void;
}

interface QuakeNotifyLine {
  expiresAt: number;
  text: string;
}

export function createQuakeTextController(options: {
  centerPrintRoot: HTMLElement | null;
  notifyRoot: HTMLElement | null;
}): QuakeTextController {
  const { centerPrintRoot, notifyRoot } = options;
  let notifyLines: QuakeNotifyLine[] = [];
  let notifyTimer: number | null = null;
  let centerPrintTimer: number | null = null;

  const clearNotifyTimer = (): void => {
    if (notifyTimer === null) return;
    window.clearTimeout(notifyTimer);
    notifyTimer = null;
  };

  const scheduleNotifyExpiry = (): void => {
    clearNotifyTimer();
    if (!notifyLines.length) return;
    const nextExpiry = Math.min(...notifyLines.map((line) => line.expiresAt));
    notifyTimer = window.setTimeout(expireNotifyLines, Math.max(0, nextExpiry - Date.now()) + 1);
  };

  const expireNotifyLines = (): void => {
    notifyTimer = null;
    const now = Date.now();
    notifyLines = notifyLines.filter((line) => line.expiresAt > now);
    renderNotify();
    scheduleNotifyExpiry();
  };

  const renderNotify = (): void => {
    if (!notifyRoot) return;
    notifyRoot.replaceChildren();
    notifyRoot.hidden = notifyLines.length === 0;
    for (const line of notifyLines) {
      notifyRoot.append(createBitmapTextLine(line.text, "quake-notify-line"));
    }
  };

  const clearNotify = (): void => {
    clearNotifyTimer();
    notifyLines = [];
    if (!notifyRoot) return;
    notifyRoot.replaceChildren();
    notifyRoot.hidden = true;
  };

  const setNotify = (text: string): void => {
    clearNotifyTimer();
    notifyLines = quakeTextLines(text).map((line) => ({ expiresAt: Infinity, text: line }));
    renderNotify();
  };

  const clearCenterPrintTimer = (): void => {
    if (centerPrintTimer === null) return;
    window.clearTimeout(centerPrintTimer);
    centerPrintTimer = null;
  };

  const clearCenterPrint = (): void => {
    clearCenterPrintTimer();
    if (!centerPrintRoot) return;
    centerPrintRoot.replaceChildren();
    centerPrintRoot.hidden = true;
  };

  const setCenterPrint = (text: string): void => {
    if (!centerPrintRoot) return;
    const lines = quakeTextLines(text);
    centerPrintRoot.replaceChildren();
    centerPrintRoot.hidden = lines.length === 0;
    for (const line of lines) {
      centerPrintRoot.append(createBitmapTextLine(line, "quake-centerprint-line"));
    }
  };

  return {
    clear: () => {
      clearNotify();
      clearCenterPrint();
    },
    clearCenterPrint,
    clearNotify,
    notify: (text, notifyOptions = {}) => {
      const durationMs = quakePositiveDuration(notifyOptions.durationMs, QUAKE_NOTIFY_DEFAULT_MS);
      const expiresAt = Date.now() + durationMs;
      notifyLines.push(...quakeTextLines(text).map((line) => ({ expiresAt, text: line })));
      if (notifyLines.length > QUAKE_NOTIFY_MAX_LINES) {
        notifyLines = notifyLines.slice(notifyLines.length - QUAKE_NOTIFY_MAX_LINES);
      }
      renderNotify();
      scheduleNotifyExpiry();
    },
    centerPrint: (text, centerPrintOptions = {}) => {
      clearCenterPrintTimer();
      setCenterPrint(text);
      if (!centerPrintRoot || centerPrintRoot.hidden) return;
      const durationMs = quakePositiveDuration(centerPrintOptions.durationMs, QUAKE_CENTERPRINT_DEFAULT_MS);
      centerPrintTimer = window.setTimeout(clearCenterPrint, durationMs);
    },
    setCenterPrint: (text) => {
      clearCenterPrintTimer();
      setCenterPrint(text);
    },
    setNotify,
  };
}

function createBitmapTextLine(text: string, className: string): HTMLElement {
  const line = document.createElement("span");
  line.className = `${className} quake-bm-label quake-bm-anywhere`;
  line.textContent = text;
  mountQuakeBitmapText(line);
  return line;
}

function quakeTextLines(text: string): string[] {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return [];
  const lines: string[] = [];
  for (const sourceLine of normalized.split("\n")) {
    const line = sourceLine.trim();
    if (!line) continue;
    for (let index = 0; index < line.length; index += QUAKE_TEXT_LINE_CHARS) {
      lines.push(line.slice(index, index + QUAKE_TEXT_LINE_CHARS));
    }
  }
  return lines;
}

function quakePositiveDuration(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
