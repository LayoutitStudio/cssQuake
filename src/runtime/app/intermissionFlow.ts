export interface QuakeIntermissionStats {
  elapsedSeconds: number;
  mapName: string;
  monstersKilled: number;
  secretsFound: number;
  totalMonsters: number;
  totalSecrets: number;
}

export interface QuakeIntermissionFlowOptions {
  renderBitmapText(root: HTMLElement): void;
  root: HTMLElement | null;
}

export interface QuakeIntermissionFlow {
  active(): boolean;
  clear(): void;
  show(stats: QuakeIntermissionStats): void;
}

const QUAKE_INTERMISSION_COMPLETE_ART = {
  className: "quake-intermission-complete-art",
  height: 24,
  src: "/q/intermission-complete.png",
  width: 192,
} as const;

const QUAKE_INTERMISSION_LABEL_ART = {
  className: "quake-intermission-label-art",
  height: 144,
  src: "/q/intermission-labels.png",
  width: 160,
} as const;

const QUAKE_INTERMISSION_NUMBER_ART = {
  glyphs: "0123456789:/-",
  height: 24,
  src: "/q/intermission-numbers.png",
  width: 24,
} as const;

export function createQuakeIntermissionFlow(
  options: QuakeIntermissionFlowOptions,
): QuakeIntermissionFlow {
  let visible = false;

  function clear(): void {
    visible = false;
    if (!options.root) return;
    options.root.replaceChildren();
    options.root.hidden = true;
  }

  function show(stats: QuakeIntermissionStats): void {
    visible = true;
    if (!options.root) return;
    options.root.replaceChildren(
      intermissionScrim(),
      intermissionCanvas(stats),
    );
    options.root.hidden = false;
    options.renderBitmapText(options.root);
  }

  return {
    active: () => visible,
    clear,
    show,
  };
}

function intermissionScrim(): HTMLElement {
  const scrim = document.createElement("div");
  scrim.className = "quake-intermission-scrim";
  return scrim;
}

function intermissionCanvas(stats: QuakeIntermissionStats): HTMLElement {
  const canvas = document.createElement("div");
  canvas.className = "quake-intermission-canvas";
  canvas.append(
    intermissionCompleteTitle(),
    intermissionStatsRows(stats),
  );
  return canvas;
}

function intermissionCompleteTitle(): HTMLElement {
  const title = document.createElement("div");
  title.className = "quake-intermission-complete";
  title.append(
    intermissionSourceArt(
      QUAKE_INTERMISSION_COMPLETE_ART,
      () => title.classList.add("quake-intermission-complete-source-ready"),
    ),
    intermissionText("COMPLETED", "quake-intermission-title"),
  );
  return title;
}

function intermissionStatsRows(stats: QuakeIntermissionStats): HTMLElement {
  const values = {
    kills: formatQuakeIntermissionRatio(stats.monstersKilled, stats.totalMonsters),
    secrets: formatQuakeIntermissionRatio(stats.secretsFound, stats.totalSecrets),
    time: formatQuakeIntermissionTime(stats.elapsedSeconds),
  };
  const layout = intermissionStatsLayout([values.time, values.secrets, values.kills]);
  const rows = document.createElement("div");
  rows.className = "quake-intermission-stats";
  rows.style.setProperty("--quake-intermission-label-x", String(layout.labelX));
  rows.style.setProperty("--quake-intermission-value-right", String(layout.valueRight));
  rows.append(
    intermissionSourceArt(
      QUAKE_INTERMISSION_LABEL_ART,
      () => rows.classList.add("quake-intermission-label-source-ready"),
    ),
    intermissionRow("TIME", values.time, 8),
    intermissionRow("SECRETS", values.secrets, 48),
    intermissionRow("KILLS", values.kills, 88),
  );
  return rows;
}

function intermissionRow(label: string, value: string, y: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "quake-intermission-row";
  row.style.setProperty("--quake-intermission-row-y", String(y));
  row.append(
    intermissionText(label, "quake-intermission-label"),
    intermissionValueText(value),
  );
  return row;
}

function intermissionText(text: string, className: string): HTMLElement {
  const element = document.createElement("span");
  element.className = `${className} quake-bm quake-bm-alt`;
  element.textContent = text;
  return element;
}

function intermissionValueText(text: string): HTMLElement {
  const value = document.createElement("span");
  value.className = "quake-intermission-value";
  value.style.setProperty("--quake-intermission-value-width", String(intermissionTextWidth(text)));
  value.dataset.value = text;

  const source = document.createElement("span");
  source.className = "quake-intermission-value-text quake-bitmap-source";
  source.textContent = text;
  value.append(source);

  for (const char of text) {
    if (char === " ") continue;

    const index = QUAKE_INTERMISSION_NUMBER_ART.glyphs.indexOf(char);
    if (index < 0) continue;
    const glyph = document.createElement("span");
    glyph.className = "quake-intermission-value-glyph";
    glyph.style.setProperty("--quake-intermission-value-glyph-index", String(index));
    value.append(glyph);
  }

  return value;
}

function intermissionSourceArt(
  art: { className: string; height: number; src: string; width: number },
  onReady: () => void,
): HTMLImageElement {
  const image = document.createElement("img");
  image.alt = "";
  image.className = art.className;
  image.decoding = "async";
  image.draggable = false;
  image.height = art.height;
  image.width = art.width;
  image.addEventListener("load", onReady, { once: true });
  image.addEventListener("error", () => { image.hidden = true; }, { once: true });
  image.src = art.src;
  return image;
}

function intermissionStatsLayout(values: string[]): { labelX: number; valueRight: number } {
  const widestValue = Math.max(...values.map(intermissionTextWidth));
  const total = Math.min(320, QUAKE_INTERMISSION_LABEL_ART.width + QUAKE_INTERMISSION_NUMBER_ART.width + widestValue);
  return {
    labelX: 160 - total / 2,
    valueRight: 160 + total / 2,
  };
}

function intermissionTextWidth(text: string): number {
  return text.length * QUAKE_INTERMISSION_NUMBER_ART.width;
}

function formatQuakeIntermissionTime(elapsedSeconds: number): string {
  const total = Math.max(0, Math.floor(elapsedSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatQuakeIntermissionRatio(value: number, total: number): string {
  return `${Math.trunc(value)}/${String(Math.trunc(total)).padStart(2, " ")}`;
}
