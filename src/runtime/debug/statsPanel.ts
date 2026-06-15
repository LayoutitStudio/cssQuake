interface QuakeStatsPanel {
  value: HTMLElement;
  bars: HTMLElement[];
  history: number[];
  max: number;
  label: string;
}

const FPS_SAMPLE_MS = 1000;
const MS_SAMPLE_MS = 500;
const STATS_GRAPH_COLUMNS = 40;
const STATS_GRAPH_HEIGHT = 30;
const STATS_OVERLAY_BACKGROUND = "#050302";
const STATS_GRAPH_BACKGROUND = "#050302";
const STATS_FPS_FOREGROUND = "#9a4a24";
const STATS_FPS_BACKGROUND = "#100604";
const STATS_MS_FOREGROUND = "#a98c3f";
const STATS_MS_BACKGROUND = "#100803";

export function mountQuakeStatsOverlay(root: HTMLElement): () => void {
  document.querySelector(".dn-stats-overlay")?.remove();
  const statsContainer = document.createElement("div");
  statsContainer.className = "dn-stats-overlay";
  statsContainer.setAttribute("aria-hidden", "true");
  statsContainer.style.position = "fixed";
  statsContainer.style.right = "4px";
  statsContainer.style.bottom = "clamp(4px, calc(602px - 50vw), 88px)";
  statsContainer.style.zIndex = "40";
  statsContainer.style.top = "auto";
  statsContainer.style.left = "auto";
  statsContainer.style.display = "flex";
  statsContainer.style.alignItems = "flex-end";
  statsContainer.style.gap = "2px";
  statsContainer.style.background = STATS_OVERLAY_BACKGROUND;
  statsContainer.style.opacity = "1";
  statsContainer.style.pointerEvents = "none";

  const fpsPanel = createStatsPanel("FPS", STATS_FPS_FOREGROUND, STATS_FPS_BACKGROUND, 100);
  const msPanel = createStatsPanel("MS", STATS_MS_FOREGROUND, STATS_MS_BACKGROUND, 200);
  statsContainer.append(fpsPanel.element, msPanel.element);
  root.appendChild(statsContainer);

  let lastFrame = performance.now();
  let fpsSampleStart = lastFrame;
  let msSampleStart = lastFrame;
  let fpsFrameCount = 0;
  let maxFrameMs = 0;
  let animationFrame = 0;
  let disposed = false;

  function tick(now: number): void {
    if (disposed) return;
    const frameMs = Math.max(0, now - lastFrame);
    lastFrame = now;
    fpsFrameCount += 1;
    if (frameMs > maxFrameMs) maxFrameMs = frameMs;

    if (now - msSampleStart >= MS_SAMPLE_MS) {
      updateStatsPanel(msPanel, maxFrameMs);
      msSampleStart = now;
      maxFrameMs = 0;
    }

    const fpsElapsed = now - fpsSampleStart;
    if (fpsElapsed >= FPS_SAMPLE_MS) {
      updateStatsPanel(fpsPanel, (fpsFrameCount * 1000) / fpsElapsed);
      fpsSampleStart = now;
      fpsFrameCount = 0;
    }

    animationFrame = window.requestAnimationFrame(tick);
  }

  animationFrame = window.requestAnimationFrame(tick);

  return () => {
    disposed = true;
    window.cancelAnimationFrame(animationFrame);
    statsContainer.remove();
  };
}

function createStatsPanel(label: string, fg: string, bg: string, max: number): QuakeStatsPanel & { element: HTMLElement } {
  const element = document.createElement("div");
  element.style.width = "80px";
  element.style.height = "48px";
  element.style.padding = "2px 3px";
  element.style.background = bg;
  element.style.color = fg;
  element.style.font = "bold 9px Helvetica, Arial, sans-serif";
  element.style.lineHeight = "1";
  element.style.textAlign = "left";
  element.style.textShadow = "0 1px 0 #000";

  const value = document.createElement("div");
  value.textContent = `0 ${label}`;
  value.style.marginBottom = "2px";

  const graph = document.createElement("div");
  graph.style.position = "relative";
  graph.style.display = "grid";
  graph.style.gridTemplateColumns = `repeat(${STATS_GRAPH_COLUMNS}, 1fr)`;
  graph.style.alignItems = "end";
  graph.style.gap = "0";
  graph.style.height = `${STATS_GRAPH_HEIGHT}px`;
  graph.style.background = STATS_GRAPH_BACKGROUND;
  graph.style.overflow = "hidden";

  const bars = Array.from({ length: STATS_GRAPH_COLUMNS }, () => {
    const bar = document.createElement("span");
    bar.style.display = "block";
    bar.style.width = "100%";
    bar.style.height = "0";
    bar.style.background = fg;
    graph.appendChild(bar);
    return bar;
  });
  element.append(value, graph);
  const panel = { element, value, bars, history: [], max, label };
  drawStatsPanelGraph(panel);
  return panel;
}

function updateStatsPanel(panel: QuakeStatsPanel, value: number): void {
  const rounded = Math.round(value);
  panel.value.textContent = `${rounded} ${panel.label}`;
  panel.history.push(Math.max(0, Math.min(panel.max, value)));
  while (panel.history.length > STATS_GRAPH_COLUMNS) panel.history.shift();
  drawStatsPanelGraph(panel);
}

function drawStatsPanelGraph(panel: QuakeStatsPanel): void {
  const offset = STATS_GRAPH_COLUMNS - panel.history.length;
  for (let index = 0; index < panel.bars.length; index++) {
    const value = index >= offset ? panel.history[index - offset] ?? 0 : 0;
    const height = Math.round((value / panel.max) * STATS_GRAPH_HEIGHT);
    panel.bars[index].style.height = `${height}px`;
  }
}
