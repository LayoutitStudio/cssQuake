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
  setCurrentLevel(mapName: string): void;
  handleKeyDown(event: KeyboardEvent): boolean;
  focusCurrent(): void;
  dispose(): void;
}

export interface QuakeMenuControllerOptions {
  enabled: boolean;
  host: HTMLElement;
  controls: QuakeMenuControls;
  mainMenu: HTMLElement | null;
  mainMenuArt: HTMLElement | null;
  levelPanel: HTMLElement | null;
  aboutPanel: HTMLElement | null;
  optionsPanel: HTMLElement | null;
  onSelectLevel?(mapName: string): void | Promise<void>;
  clearCrosshairTarget(): void;
  syncCrosshairTarget(): void;
}

const QUAKE_MAIN_MENU_ROWS = [0, 1, 2, 3];

export function createQuakeMenuController({
  enabled,
  host,
  controls,
  mainMenu,
  mainMenuArt,
  levelPanel,
  aboutPanel,
  optionsPanel,
  onSelectLevel,
  clearCrosshairTarget,
  syncCrosshairTarget,
}: QuakeMenuControllerOptions): QuakeMenuController {
  let mainMenuSelectionIndex = 0;
  let loadingLevelMap: string | null = null;

  function showMainMenu(): void {
    if (!mainMenu) return;
    if (!enabled) {
      hideMainMenu();
      return;
    }
    controls.update({ moveEnabled: false });
    updateMainMenuCursor();
    levelPanel?.setAttribute("hidden", "");
    aboutPanel?.setAttribute("hidden", "");
    optionsPanel?.setAttribute("hidden", "");
    mainMenu.hidden = false;
    document.body.dataset.menu = "true";
    clearCrosshairTarget();
    mainMenu.focus({ preventScroll: true });
  }

  function hideMainMenu(): void {
    if (!mainMenu) return;
    controls.update({ moveEnabled: true });
    mainMenu.hidden = true;
    levelPanel?.setAttribute("hidden", "");
    aboutPanel?.setAttribute("hidden", "");
    optionsPanel?.setAttribute("hidden", "");
    delete document.body.dataset.menu;
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

  function isLevelPanelOpen(): boolean {
    if (!enabled) return false;
    return Boolean(levelPanel && !levelPanel.hidden);
  }

  function isOptionsPanelOpen(): boolean {
    if (!enabled) return false;
    return Boolean(optionsPanel && !optionsPanel.hidden);
  }

  function isMenuPanelOpen(): boolean {
    return isLevelPanelOpen() || isAboutPanelOpen() || isOptionsPanelOpen();
  }

  function showMenuPanel(panel: HTMLElement): void {
    if (!mainMenu) return;
    controls.update({ moveEnabled: false });
    mainMenu.hidden = true;
    levelPanel?.setAttribute("hidden", "");
    aboutPanel?.setAttribute("hidden", "");
    optionsPanel?.setAttribute("hidden", "");
    panel.hidden = false;
    document.body.dataset.menu = "true";
    panel.focus({ preventScroll: true });
  }

  function showLevelPanel(): void {
    if (!enabled || !levelPanel) {
      startFromMainMenu();
      return;
    }
    showMenuPanel(levelPanel);
    (currentLevelButton() ?? firstLevelButton())?.focus({ preventScroll: true });
  }

  function showAboutPanel(): void {
    if (!enabled || !aboutPanel) return;
    showMenuPanel(aboutPanel);
  }

  function showOptionsPanel(): void {
    if (!enabled || !optionsPanel) return;
    showMenuPanel(optionsPanel);
  }

  function closeMenuPanel(): void {
    if (!isMenuPanelOpen()) return;
    showMainMenu();
  }

  function aboutSourceLinkFor(target: EventTarget | null): HTMLAnchorElement | null {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return element?.closest("#quake-about-source-links a") as HTMLAnchorElement | null;
  }

  function mainMenuBrandLinkFor(target: EventTarget | null): HTMLAnchorElement | null {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return element?.closest("#quake-main-menu-brand-meta a") as HTMLAnchorElement | null;
  }

  function menuBackButtonFor(target: EventTarget | null): HTMLButtonElement | null {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return element?.closest("#quake-level-back, #quake-about-back, #quake-options-back") as HTMLButtonElement | null;
  }

  function menuCardFor(target: EventTarget | null): HTMLElement | null {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return element?.closest(".quake-menu-card") as HTMLElement | null;
  }

  function levelButtonFor(target: EventTarget | null): HTMLButtonElement | null {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return element?.closest(".quake-level-button[data-map]") as HTMLButtonElement | null;
  }

  function mainMenuItems(): HTMLElement[] {
    if (!mainMenuArt) return [];
    return Array.from(mainMenuArt.querySelectorAll<HTMLElement>(".quake-main-menu-item[data-menu-row]"));
  }

  function updateMainMenuCursor(): void {
    const row = QUAKE_MAIN_MENU_ROWS[mainMenuSelectionIndex] ?? 0;
    for (const item of mainMenuItems()) {
      if (Number(item.dataset.menuRow) === row) {
        item.dataset.active = "true";
      } else {
        delete item.dataset.active;
      }
    }
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
    if (row === 1) showLevelPanel();
    if (row === 2) showOptionsPanel();
    if (row === 3) showAboutPanel();
  }

  function levelButtons(): HTMLButtonElement[] {
    if (!levelPanel) return [];
    return Array.from(levelPanel.querySelectorAll<HTMLButtonElement>(".quake-level-button[data-map]"));
  }

  function firstLevelButton(): HTMLButtonElement | null {
    return levelButtons()[0] ?? null;
  }

  function currentLevelButton(): HTMLButtonElement | null {
    return levelButtons().find((button) => button.dataset.current === "true") ?? null;
  }

  function setCurrentLevel(mapName: string): void {
    for (const button of levelButtons()) {
      const current = button.dataset.map === mapName;
      if (current) {
        button.dataset.current = "true";
        button.setAttribute("aria-current", "page");
      } else {
        delete button.dataset.current;
        button.removeAttribute("aria-current");
      }
    }
  }

  function setLoadingLevel(mapName: string | null): void {
    loadingLevelMap = mapName;
    if (mapName) {
      levelPanel?.setAttribute("aria-busy", "true");
    } else {
      levelPanel?.removeAttribute("aria-busy");
    }
    for (const button of levelButtons()) {
      button.disabled = Boolean(mapName);
      if (mapName && button.dataset.map === mapName) {
        button.dataset.loading = "true";
      } else {
        delete button.dataset.loading;
      }
    }
  }

  function selectLevel(button: HTMLButtonElement): void {
    const mapName = button.dataset.map;
    if (!mapName || !onSelectLevel || loadingLevelMap) return;
    setLoadingLevel(mapName);
    Promise.resolve(onSelectLevel(mapName))
      .then(() => {
        setCurrentLevel(mapName);
        setLoadingLevel(null);
        controls.lock();
        hideMainMenu();
      })
      .catch((error: unknown) => {
        console.error(error);
        setLoadingLevel(null);
        showLevelPanel();
      });
  }

  function levelButtonColumnCount(): number {
    const buttons = levelButtons();
    const firstTop = buttons[0]?.offsetTop;
    if (firstTop === undefined) return 1;
    let count = 0;
    for (const button of buttons) {
      if (Math.abs(button.offsetTop - firstTop) > 2) break;
      count++;
    }
    return Math.max(1, count);
  }

  function focusLevelButton(delta: number): void {
    const buttons = levelButtons();
    if (!buttons.length) return;
    const active = levelButtonFor(document.activeElement);
    const current = active ?? currentLevelButton() ?? buttons[0];
    const index = Math.max(0, buttons.indexOf(current));
    buttons[(index + delta + buttons.length) % buttons.length]?.focus({ preventScroll: true });
  }

  function handleLevelPanelKey(event: KeyboardEvent): boolean {
    if (!isLevelPanelOpen()) return false;
    const button = levelButtonFor(event.target);
    switch (event.code) {
      case "Escape":
      case "Backspace":
        event.preventDefault();
        event.stopPropagation();
        closeMenuPanel();
        return true;
      case "Enter":
      case "Space":
        if (!button) return false;
        event.preventDefault();
        event.stopPropagation();
        selectLevel(button);
        return true;
      case "ArrowDown":
      case "KeyS":
        event.preventDefault();
        event.stopPropagation();
        focusLevelButton(levelButtonColumnCount());
        return true;
      case "ArrowUp":
      case "KeyW":
        event.preventDefault();
        event.stopPropagation();
        focusLevelButton(-levelButtonColumnCount());
        return true;
      case "ArrowRight":
      case "KeyD":
        event.preventDefault();
        event.stopPropagation();
        focusLevelButton(1);
        return true;
      case "ArrowLeft":
      case "KeyA":
        event.preventDefault();
        event.stopPropagation();
        focusLevelButton(-1);
        return true;
      default:
        return false;
    }
  }

  function handleMenuPanelKey(event: KeyboardEvent): boolean {
    if (!isMenuPanelOpen()) return false;
    if (handleLevelPanelKey(event)) return true;
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
    const levelButton = levelButtonFor(event.target);
    if (levelButton) {
      selectLevel(levelButton);
      return;
    }
    if (aboutSourceLinkFor(event.target)) return;
    if (menuCardFor(event.target)) return;
    closeMenuPanel();
  }

  function handleMainMenuKey(event: KeyboardEvent): boolean {
    if (!isMainMenuOpen()) return false;
    const brandLink = mainMenuBrandLinkFor(event.target);
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
        if (brandLink) return false;
        event.preventDefault();
        event.stopPropagation();
        activateMainMenuSelection();
        return true;
      case "Space":
        event.preventDefault();
        event.stopPropagation();
        if (brandLink) {
          brandLink.click();
        } else {
          activateMainMenuSelection();
        }
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
    if (mainMenuBrandLinkFor(event.target)) return;
    const row = mainMenuPointerRow(event);
    if (row === null || !selectMainMenuRow(row)) return;
    activateMainMenuSelection();
  }

  function handleMainMenuPointerMove(event: PointerEvent): void {
    const row = mainMenuPointerRow(event);
    if (row !== null && selectMainMenuRow(row)) {
      if (mainMenu) mainMenu.dataset.hover = "true";
    } else {
      delete mainMenu?.dataset.hover;
    }
  }

  function handleMainMenuPointerLeave(): void {
    delete mainMenu?.dataset.hover;
  }

  function mainMenuPointerRow(event: MouseEvent): number | null {
    if (!mainMenuArt) return null;
    for (const item of mainMenuItems()) {
      const itemRect = item.getBoundingClientRect();
      const cursor = item.querySelector<HTMLElement>(".quake-main-menu-item-cursor");
      const cursorRect = cursor && getComputedStyle(cursor).display !== "none"
        ? cursor.getBoundingClientRect()
        : null;
      const left = cursorRect ? Math.min(itemRect.left, cursorRect.left) : itemRect.left;
      const right = cursorRect ? Math.max(itemRect.right, cursorRect.right) : itemRect.right;
      const top = cursorRect ? Math.min(itemRect.top, cursorRect.top) : itemRect.top;
      const bottom = cursorRect ? Math.max(itemRect.bottom, cursorRect.bottom) : itemRect.bottom;
      if (
        event.clientX >= left &&
        event.clientX <= right &&
        event.clientY >= top &&
        event.clientY <= bottom
      ) {
        const row = Number(item.dataset.menuRow);
        return Number.isFinite(row) ? row : null;
      }
    }
    return null;
  }

  function focusCurrent(): void {
    if (isLevelPanelOpen()) {
      (currentLevelButton() ?? firstLevelButton() ?? levelPanel)?.focus({ preventScroll: true });
    } else if (isAboutPanelOpen()) {
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
    levelPanel?.removeEventListener("click", handleMenuPanelClick);
    aboutPanel?.removeEventListener("click", handleMenuPanelClick);
    optionsPanel?.removeEventListener("click", handleMenuPanelClick);
    controls.removeEventListener("start", handleControlsStart);
    controls.removeEventListener("end", handleControlsEnd);
  }

  if (enabled) {
    mainMenu?.addEventListener("click", handleMainMenuClick);
    mainMenu?.addEventListener("pointermove", handleMainMenuPointerMove);
    mainMenu?.addEventListener("pointerleave", handleMainMenuPointerLeave);
    levelPanel?.addEventListener("click", handleMenuPanelClick);
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
    setCurrentLevel,
    handleKeyDown,
    focusCurrent,
    dispose,
  };
}
