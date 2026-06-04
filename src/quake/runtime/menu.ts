interface QuakeMenuControls {
  update(partial: { moveEnabled?: boolean }): void;
  lock(): void;
  addEventListener(type: "start" | "end", listener: () => void): void;
  removeEventListener(type: "start" | "end", listener: () => void): void;
}

export interface QuakeMenuController {
  showMainMenu(): void;
  hideMainMenu(): void;
  isMainMenuOpen(): boolean;
  isMenuPanelOpen(): boolean;
  handleKeyDown(event: KeyboardEvent): boolean;
  focusCurrent(): void;
  dispose(): void;
}

export interface QuakeMenuControllerOptions {
  enabled: boolean;
  host: HTMLElement;
  controls: QuakeMenuControls;
  mainMenu: HTMLButtonElement | null;
  mainMenuArt: HTMLElement | null;
  aboutPanel: HTMLElement | null;
  optionsPanel: HTMLElement | null;
  clearCrosshairTarget(): void;
  syncCrosshairTarget(): void;
}

const QUAKE_MAIN_MENU_ROWS = [0, 2, 3, 4];
const QUAKE_MAIN_MENU_ROW_TOPS = [28, 52, 76, 100, 126];
const QUAKE_MAIN_MENU_ROW_HEIGHT = 20;
const QUAKE_MAIN_MENU_CURSOR_HEIGHT = 24;
const POLYCSS_URL = "https://polycss.com/";

export function createQuakeMenuController({
  enabled,
  host,
  controls,
  mainMenu,
  mainMenuArt,
  aboutPanel,
  optionsPanel,
  clearCrosshairTarget,
  syncCrosshairTarget,
}: QuakeMenuControllerOptions): QuakeMenuController {
  let mainMenuSelectionIndex = 0;

  function showMainMenu(): void {
    if (!mainMenu) return;
    if (!enabled) {
      hideMainMenu();
      return;
    }
    controls.update({ moveEnabled: false });
    updateMainMenuCursor();
    aboutPanel?.setAttribute("hidden", "");
    optionsPanel?.setAttribute("hidden", "");
    mainMenu.hidden = false;
    document.body.dataset.quakeMenuOpen = "true";
    delete document.body.dataset.quakeAboutOpen;
    delete document.body.dataset.quakeOptionsOpen;
    clearCrosshairTarget();
    mainMenu.focus({ preventScroll: true });
  }

  function hideMainMenu(): void {
    if (!mainMenu) return;
    controls.update({ moveEnabled: true });
    mainMenu.hidden = true;
    aboutPanel?.setAttribute("hidden", "");
    optionsPanel?.setAttribute("hidden", "");
    delete document.body.dataset.quakeMenuOpen;
    delete document.body.dataset.quakeAboutOpen;
    delete document.body.dataset.quakeOptionsOpen;
    host.focus({ preventScroll: true });
    syncCrosshairTarget();
  }

  function startFromMainMenu(): void {
    controls.lock();
    hideMainMenu();
  }

  function isMainMenuOpen(): boolean {
    if (!enabled) return false;
    return Boolean(mainMenu && !mainMenu.hidden);
  }

  function isAboutPanelOpen(): boolean {
    if (!enabled) return false;
    return Boolean(aboutPanel && !aboutPanel.hidden);
  }

  function isOptionsPanelOpen(): boolean {
    if (!enabled) return false;
    return Boolean(optionsPanel && !optionsPanel.hidden);
  }

  function isMenuPanelOpen(): boolean {
    return isAboutPanelOpen() || isOptionsPanelOpen();
  }

  function showMenuPanel(panel: HTMLElement, datasetKey: "quakeAboutOpen" | "quakeOptionsOpen"): void {
    if (!mainMenu) return;
    controls.update({ moveEnabled: false });
    mainMenu.hidden = true;
    aboutPanel?.setAttribute("hidden", "");
    optionsPanel?.setAttribute("hidden", "");
    delete document.body.dataset.quakeAboutOpen;
    delete document.body.dataset.quakeOptionsOpen;
    panel.hidden = false;
    document.body.dataset.quakeMenuOpen = "true";
    document.body.dataset[datasetKey] = "true";
    panel.focus({ preventScroll: true });
  }

  function showAboutPanel(): void {
    if (!enabled || !aboutPanel) return;
    showMenuPanel(aboutPanel, "quakeAboutOpen");
  }

  function showOptionsPanel(): void {
    if (!enabled || !optionsPanel) return;
    showMenuPanel(optionsPanel, "quakeOptionsOpen");
  }

  function closeMenuPanel(): void {
    if (!isMenuPanelOpen()) return;
    showMainMenu();
  }

  function aboutSourceLinkFor(target: EventTarget | null): HTMLAnchorElement | null {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return element?.closest("#quake-about-source-links a") as HTMLAnchorElement | null;
  }

  function menuBackButtonFor(target: EventTarget | null): HTMLButtonElement | null {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return element?.closest("#quake-about-back, #quake-options-back") as HTMLButtonElement | null;
  }

  function menuCardFor(target: EventTarget | null): HTMLElement | null {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return element?.closest(".quake-menu-card") as HTMLElement | null;
  }

  function updateMainMenuCursor(): void {
    const row = QUAKE_MAIN_MENU_ROWS[mainMenuSelectionIndex] ?? 0;
    const rowTop = QUAKE_MAIN_MENU_ROW_TOPS[row] ?? QUAKE_MAIN_MENU_ROW_TOPS[0];
    const cursorTop = rowTop + (QUAKE_MAIN_MENU_ROW_HEIGHT - QUAKE_MAIN_MENU_CURSOR_HEIGHT) / 2;
    const activeX = QUAKE_MAIN_MENU_ROWS.length <= 1
      ? 0
      : (mainMenuSelectionIndex / (QUAKE_MAIN_MENU_ROWS.length - 1)) * 100;
    mainMenuArt?.style.setProperty("--quake-main-menu-cursor-y", `${cursorTop / 2}%`);
    mainMenuArt?.style.setProperty("--quake-main-menu-active-x", `${activeX}%`);
  }

  function selectMainMenuRow(row: number): boolean {
    const index = QUAKE_MAIN_MENU_ROWS.indexOf(row);
    if (index < 0) return false;
    if (mainMenuSelectionIndex !== index) {
      mainMenuSelectionIndex = index;
      updateMainMenuCursor();
    }
    return true;
  }

  function moveMainMenuCursor(delta: number): void {
    mainMenuSelectionIndex = (
      mainMenuSelectionIndex + delta + QUAKE_MAIN_MENU_ROWS.length
    ) % QUAKE_MAIN_MENU_ROWS.length;
    updateMainMenuCursor();
  }

  function activateMainMenuSelection(): void {
    const row = QUAKE_MAIN_MENU_ROWS[mainMenuSelectionIndex] ?? 0;
    if (row === 0) startFromMainMenu();
    if (row === 2) showOptionsPanel();
    if (row === 3) showAboutPanel();
    if (row === 4) openPolycssSite();
  }

  function openPolycssSite(): void {
    window.location.assign(POLYCSS_URL);
  }

  function handleMenuPanelKey(event: KeyboardEvent): boolean {
    if (!isMenuPanelOpen()) return false;
    const sourceLink = aboutSourceLinkFor(event.target);
    switch (event.code) {
      case "Escape":
      case "Backspace":
        event.preventDefault();
        event.stopPropagation();
        closeMenuPanel();
        return true;
      case "Enter":
        if (sourceLink) return false;
        event.preventDefault();
        event.stopPropagation();
        closeMenuPanel();
        return true;
      case "Space":
        event.preventDefault();
        event.stopPropagation();
        if (sourceLink) {
          sourceLink.click();
        } else {
          closeMenuPanel();
        }
        return true;
      case "ArrowDown":
      case "ArrowUp":
      case "ArrowLeft":
      case "ArrowRight":
      case "KeyA":
      case "KeyD":
      case "KeyS":
      case "KeyW":
        event.preventDefault();
        event.stopPropagation();
        return true;
      default:
        return false;
    }
  }

  function handleMenuPanelClick(event: MouseEvent): void {
    if (menuBackButtonFor(event.target)) {
      closeMenuPanel();
      return;
    }
    if (aboutSourceLinkFor(event.target)) return;
    if (menuCardFor(event.target)) return;
    closeMenuPanel();
  }

  function handleMainMenuKey(event: KeyboardEvent): boolean {
    if (!isMainMenuOpen()) return false;
    switch (event.code) {
      case "ArrowDown":
      case "KeyS":
        event.preventDefault();
        event.stopPropagation();
        moveMainMenuCursor(1);
        return true;
      case "ArrowUp":
      case "KeyW":
        event.preventDefault();
        event.stopPropagation();
        moveMainMenuCursor(-1);
        return true;
      case "Enter":
      case "Space":
        event.preventDefault();
        event.stopPropagation();
        activateMainMenuSelection();
        return true;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        return true;
      default:
        return false;
    }
  }

  function handleKeyDown(event: KeyboardEvent): boolean {
    return handleMenuPanelKey(event) || handleMainMenuKey(event);
  }

  function handleMainMenuClick(event: MouseEvent): void {
    const row = mainMenuPointerRow(event);
    if (row !== null) {
      if (!selectMainMenuRow(row)) return;
    }
    activateMainMenuSelection();
  }

  function handleMainMenuPointerMove(event: PointerEvent): void {
    const row = mainMenuPointerRow(event);
    if (row !== null && selectMainMenuRow(row)) {
      if (mainMenu) mainMenu.dataset.hoverSelectable = "true";
    } else {
      delete mainMenu?.dataset.hoverSelectable;
    }
  }

  function handleMainMenuPointerLeave(): void {
    delete mainMenu?.dataset.hoverSelectable;
  }

  function mainMenuPointerRow(event: MouseEvent): number | null {
    if (!mainMenuArt) return null;
    const rect = mainMenuArt.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) return null;
    const y = ((event.clientY - rect.top) / rect.height) * 200;
    for (let row = 0; row < QUAKE_MAIN_MENU_ROW_TOPS.length; row++) {
      const top = QUAKE_MAIN_MENU_ROW_TOPS[row];
      if (top === undefined) continue;
      if (y >= top && y < top + QUAKE_MAIN_MENU_ROW_HEIGHT) return row;
    }
    return null;
  }

  function focusCurrent(): void {
    if (isAboutPanelOpen()) {
      aboutPanel?.focus({ preventScroll: true });
    } else if (isOptionsPanelOpen()) {
      optionsPanel?.focus({ preventScroll: true });
    } else if (isMainMenuOpen()) {
      mainMenu?.focus({ preventScroll: true });
    } else {
      host.focus();
    }
  }

  function handleControlsStart(): void {
    hideMainMenu();
  }

  function handleControlsEnd(): void {
    showMainMenu();
  }

  function dispose(): void {
    mainMenu?.removeEventListener("click", handleMainMenuClick);
    mainMenu?.removeEventListener("pointermove", handleMainMenuPointerMove);
    mainMenu?.removeEventListener("pointerleave", handleMainMenuPointerLeave);
    aboutPanel?.removeEventListener("click", handleMenuPanelClick);
    optionsPanel?.removeEventListener("click", handleMenuPanelClick);
    controls.removeEventListener("start", handleControlsStart);
    controls.removeEventListener("end", handleControlsEnd);
  }

  if (enabled) {
    mainMenu?.addEventListener("click", handleMainMenuClick);
    mainMenu?.addEventListener("pointermove", handleMainMenuPointerMove);
    mainMenu?.addEventListener("pointerleave", handleMainMenuPointerLeave);
    aboutPanel?.addEventListener("click", handleMenuPanelClick);
    optionsPanel?.addEventListener("click", handleMenuPanelClick);
    controls.addEventListener("start", handleControlsStart);
    controls.addEventListener("end", handleControlsEnd);
  }

  return {
    showMainMenu,
    hideMainMenu,
    isMainMenuOpen,
    isMenuPanelOpen,
    handleKeyDown,
    focusCurrent,
    dispose,
  };
}
