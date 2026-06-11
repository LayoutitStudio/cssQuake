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
  singlePlayerPanel: HTMLElement | null;
  multiplayerPanel: HTMLElement | null;
  levelPanel: HTMLElement | null;
  aboutPanel: HTMLElement | null;
  optionsPanel: HTMLElement | null;
  debugPanel: HTMLElement | null;
  onSelectNewGame?(): void | Promise<void>;
  onShowMultiplayer?(): void;
  onLoadGame?(): void | Promise<void>;
  onSaveGame?(): void | Promise<void>;
  onSelectLevel?(mapName: string): void | Promise<void>;
  onSelectDebug?(): void;
  onSelectQuit?(): void;
  canLoadGame?(): boolean;
  canSaveGame?(): boolean;
  isQuitEnabled?(): boolean;
  onMenuVisibilityChange?(visible: boolean): void;
  onMenuPauseChange?(paused: boolean): void;
  onResumeMainMenuFromEscape?(): void;
  shouldResumeMainMenuOnEscape?(): boolean;
  shouldOpenMainMenuOnControlsEnd?(): boolean;
  clearCrosshairTarget(): void;
  syncCrosshairTarget(): void;
}

type QuakeMainMenuAction = "single-player" | "multiplayer" | "level-select" | "options" | "debug" | "quit";
type QuakeSinglePlayerAction = "new-game" | "load" | "save";

const QUAKE_MAIN_MENU_ACTION_ATTRIBUTE = "data-quake-main-menu-action";
const QUAKE_SINGLE_PLAYER_ACTION_ATTRIBUTE = "data-quake-single-player-action";
const QUAKE_OPTION_CYCLE_EVENT = "quake-option-cycle";
const QUAKE_MAIN_MENU_SELECTABLE_CLASS = "quake-main-menu-item-selectable";
const QUAKE_MAIN_MENU_DISABLED_CLASS = "quake-main-menu-item-disabled";

export function createQuakeMenuController({
  enabled,
  host,
  controls,
  mainMenu,
  mainMenuArt,
  singlePlayerPanel,
  multiplayerPanel,
  levelPanel,
  aboutPanel,
  optionsPanel,
  debugPanel,
  onSelectNewGame,
  onShowMultiplayer,
  onLoadGame,
  onSaveGame,
  onSelectLevel,
  onSelectDebug,
  onSelectQuit,
  canLoadGame,
  canSaveGame,
  isQuitEnabled,
  onMenuVisibilityChange,
  onMenuPauseChange,
  onResumeMainMenuFromEscape,
  shouldResumeMainMenuOnEscape,
  shouldOpenMainMenuOnControlsEnd,
  clearCrosshairTarget,
  syncCrosshairTarget,
}: QuakeMenuControllerOptions): QuakeMenuController {
  let mainMenuSelectionIndex = 0;
  let startingNewGame = false;
  let loadingGame = false;
  let savingGame = false;
  let loadingLevelMap: string | null = null;

  function showMainMenu(): void {
    if (!mainMenu) return;
    if (!enabled) {
      hideMainMenu();
      return;
    }
    controls.update({ moveEnabled: false });
    updateMainMenuCursor();
    singlePlayerPanel?.setAttribute("hidden", "");
    multiplayerPanel?.setAttribute("hidden", "");
    levelPanel?.setAttribute("hidden", "");
    aboutPanel?.setAttribute("hidden", "");
    optionsPanel?.setAttribute("hidden", "");
    debugPanel?.setAttribute("hidden", "");
    mainMenu.hidden = false;
    document.body.classList.add("quake-menu-open");
    onMenuVisibilityChange?.(true);
    onMenuPauseChange?.(true);
    clearCrosshairTarget();
    mainMenu.focus({ preventScroll: true });
  }

  function hideMainMenu(): void {
    if (!mainMenu) return;
    controls.update({ moveEnabled: true });
    mainMenu.hidden = true;
    singlePlayerPanel?.setAttribute("hidden", "");
    multiplayerPanel?.setAttribute("hidden", "");
    levelPanel?.setAttribute("hidden", "");
    aboutPanel?.setAttribute("hidden", "");
    optionsPanel?.setAttribute("hidden", "");
    debugPanel?.setAttribute("hidden", "");
    document.body.classList.remove("quake-menu-open");
    onMenuVisibilityChange?.(false);
    onMenuPauseChange?.(false);
    host.focus({ preventScroll: true });
    syncCrosshairTarget();
  }

  function startFromMainMenu(): void {
    controls.lock();
    hideMainMenu();
  }

  function selectNewGame(): void {
    if (!onSelectNewGame) {
      startFromMainMenu();
      return;
    }
    if (startingNewGame) return;
    startingNewGame = true;
    Promise.resolve(onSelectNewGame())
      .then(() => {
        startingNewGame = false;
        controls.lock();
        hideMainMenu();
      })
      .catch((error: unknown) => {
        console.error(error);
        startingNewGame = false;
        showMainMenu();
      });
  }

  function selectLoadGame(): void {
    if (!onLoadGame || loadingGame || !canLoadGame?.()) return;
    loadingGame = true;
    syncSinglePlayerItemAvailability();
    Promise.resolve(onLoadGame())
      .then(() => {
        loadingGame = false;
        syncSinglePlayerItemAvailability();
        controls.lock();
        hideMainMenu();
      })
      .catch((error: unknown) => {
        console.error(error);
        loadingGame = false;
        syncSinglePlayerItemAvailability();
        showSinglePlayerPanel();
      });
  }

  function selectSaveGame(): void {
    if (!onSaveGame || savingGame || !canSaveGame?.()) return;
    savingGame = true;
    syncSinglePlayerItemAvailability();
    Promise.resolve(onSaveGame())
      .then(() => {
        savingGame = false;
        syncSinglePlayerItemAvailability();
        currentSinglePlayerButton()?.focus({ preventScroll: true });
      })
      .catch((error: unknown) => {
        console.error(error);
        savingGame = false;
        syncSinglePlayerItemAvailability();
        showSinglePlayerPanel();
      });
  }

  function isMainMenuOpen(): boolean {
    if (!enabled) return false;
    return Boolean(mainMenu && !mainMenu.hidden);
  }

  function isAboutPanelOpen(): boolean {
    if (!enabled) return false;
    return Boolean(aboutPanel && !aboutPanel.hidden);
  }

  function isSinglePlayerPanelOpen(): boolean {
    if (!enabled) return false;
    return Boolean(singlePlayerPanel && !singlePlayerPanel.hidden);
  }

  function isMultiplayerPanelOpen(): boolean {
    if (!enabled) return false;
    return Boolean(multiplayerPanel && !multiplayerPanel.hidden);
  }

  function isLevelPanelOpen(): boolean {
    if (!enabled) return false;
    return Boolean(levelPanel && !levelPanel.hidden);
  }

  function isOptionsPanelOpen(): boolean {
    if (!enabled) return false;
    return Boolean(optionsPanel && !optionsPanel.hidden);
  }

  function isDebugPanelOpen(): boolean {
    if (!enabled) return false;
    return Boolean(debugPanel && !debugPanel.hidden);
  }

  function isMenuPanelOpen(): boolean {
    return isSinglePlayerPanelOpen() || isMultiplayerPanelOpen() || isLevelPanelOpen() || isAboutPanelOpen() || isOptionsPanelOpen() ||
      isDebugPanelOpen();
  }

  function showMenuPanel(panel: HTMLElement): void {
    if (!mainMenu) return;
    controls.update({ moveEnabled: false });
    mainMenu.hidden = true;
    singlePlayerPanel?.setAttribute("hidden", "");
    multiplayerPanel?.setAttribute("hidden", "");
    levelPanel?.setAttribute("hidden", "");
    aboutPanel?.setAttribute("hidden", "");
    optionsPanel?.setAttribute("hidden", "");
    debugPanel?.setAttribute("hidden", "");
    panel.hidden = false;
    document.body.classList.add("quake-menu-open");
    onMenuVisibilityChange?.(true);
    onMenuPauseChange?.(true);
    panel.focus({ preventScroll: true });
  }

  function showSinglePlayerPanel(): void {
    if (!enabled || !singlePlayerPanel) {
      selectNewGame();
      return;
    }
    showMenuPanel(singlePlayerPanel);
    syncSinglePlayerItemAvailability();
    firstSinglePlayerButton()?.focus({ preventScroll: true });
  }

  function showMultiplayerPanel(): void {
    if (!enabled || !multiplayerPanel) {
      startFromMainMenu();
      return;
    }
    showMenuPanel(multiplayerPanel);
    onShowMultiplayer?.();
    firstMultiplayerControl()?.focus({ preventScroll: true });
  }

  function showLevelPanel(): void {
    if (!enabled || !levelPanel) {
      startFromMainMenu();
      return;
    }
    showMenuPanel(levelPanel);
    (currentLevelButton() ?? firstLevelButton())?.focus({ preventScroll: true });
  }

  function showOptionsPanel(): void {
    if (!enabled || !optionsPanel) return;
    showMenuPanel(optionsPanel);
    firstMenuOptionToggle()?.focus({ preventScroll: true });
  }

  function showDebugPanel(): void {
    if (!enabled) return;
    if (debugPanel) {
      showMenuPanel(debugPanel);
      firstMenuOptionToggle()?.focus({ preventScroll: true });
      return;
    }
    onSelectDebug?.();
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
    return element?.closest(
      "#quake-single-player-back, #quake-multiplayer-back, #quake-level-back, #quake-about-back, #quake-options-back, #quake-debug-menu-back",
    ) as HTMLButtonElement | null;
  }

  function menuCardFor(target: EventTarget | null): HTMLElement | null {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return element?.closest(".quake-menu-card") as HTMLElement | null;
  }

  function menuOptionToggleFor(target: EventTarget | null): HTMLElement | null {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return element?.closest(".quake-option-toggle") as HTMLElement | null;
  }

  function levelButtonFor(target: EventTarget | null): HTMLButtonElement | null {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return element?.closest(".quake-level-button") as HTMLButtonElement | null;
  }

  function singlePlayerButtonFor(target: EventTarget | null): HTMLButtonElement | null {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return element?.closest(".quake-single-player-button") as HTMLButtonElement | null;
  }

  function multiplayerControlFor(target: EventTarget | null): HTMLElement | null {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return element?.closest("#quake-multiplayer-panel input, #quake-multiplayer-panel select, #quake-multiplayer-panel button") as HTMLElement | null;
  }

  function multiplayerControls(): HTMLElement[] {
    if (!multiplayerPanel) return [];
    return Array.from(multiplayerPanel.querySelectorAll<HTMLElement>("input, select, button"))
      .filter((element) => !(element instanceof HTMLButtonElement && element.disabled));
  }

  function firstMultiplayerControl(): HTMLElement | null {
    return multiplayerControls()[0] ?? null;
  }

  function currentMultiplayerControl(): HTMLElement | null {
    const active = multiplayerControlFor(document.activeElement);
    if (!active || !multiplayerPanel?.contains(active)) return firstMultiplayerControl();
    return active;
  }

  function focusMultiplayerControl(delta: number): void {
    const controls = multiplayerControls();
    if (!controls.length) return;
    const current = currentMultiplayerControl() ?? controls[0];
    const index = Math.max(0, controls.indexOf(current));
    controls[(index + delta + controls.length) % controls.length]?.focus({ preventScroll: true });
  }

  function isTextEntryTarget(target: EventTarget | null): boolean {
    const element = target instanceof HTMLElement ? target : target instanceof Node ? target.parentElement : null;
    return Boolean(element?.closest("input[type=\"text\"], input[type=\"number\"], input:not([type]), textarea, select"));
  }

  function syncSinglePlayerItemAvailability(): void {
    if (!singlePlayerPanel) return;
    const loadEnabled = Boolean(onLoadGame && !loadingGame && canLoadGame?.());
    const saveEnabled = Boolean(onSaveGame && !savingGame && canSaveGame?.());
    const busy = loadingGame || savingGame;
    singlePlayerPanel.toggleAttribute("aria-busy", busy);
    for (const button of singlePlayerPanel.querySelectorAll<HTMLButtonElement>(".quake-single-player-button")) {
      const action = button.getAttribute(QUAKE_SINGLE_PLAYER_ACTION_ATTRIBUTE) as QuakeSinglePlayerAction | null;
      const disabled = action === "load"
        ? !loadEnabled
        : action === "save"
          ? !saveEnabled
          : busy;
      button.disabled = disabled;
      button.setAttribute("aria-disabled", String(disabled));
    }
  }

  function singlePlayerButtons(): HTMLButtonElement[] {
    if (!singlePlayerPanel) return [];
    syncSinglePlayerItemAvailability();
    return Array.from(singlePlayerPanel.querySelectorAll<HTMLButtonElement>(".quake-single-player-button"))
      .filter((button) => !button.disabled);
  }

  function firstSinglePlayerButton(): HTMLButtonElement | null {
    return singlePlayerButtons()[0] ?? null;
  }

  function currentSinglePlayerButton(): HTMLButtonElement | null {
    const active = singlePlayerButtonFor(document.activeElement);
    if (!active || active.disabled || !singlePlayerPanel?.contains(active)) return firstSinglePlayerButton();
    return active;
  }

  function focusSinglePlayerButton(delta: number): void {
    const buttons = singlePlayerButtons();
    if (!buttons.length) return;
    const current = currentSinglePlayerButton() ?? buttons[0];
    const index = Math.max(0, buttons.indexOf(current));
    buttons[(index + delta + buttons.length) % buttons.length]?.focus({ preventScroll: true });
  }

  function activateSinglePlayerButton(button: HTMLButtonElement | null): void {
    syncSinglePlayerItemAvailability();
    if (!button || button.disabled) return;
    const action = button.getAttribute(QUAKE_SINGLE_PLAYER_ACTION_ATTRIBUTE) as QuakeSinglePlayerAction | null;
    if (action === "new-game") selectNewGame();
    if (action === "load") selectLoadGame();
    if (action === "save") selectSaveGame();
  }

  function currentOptionPanel(): HTMLElement | null {
    if (isOptionsPanelOpen()) return optionsPanel;
    if (isDebugPanelOpen()) return debugPanel;
    return null;
  }

  function menuOptionToggles(): HTMLElement[] {
    const panel = currentOptionPanel();
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>(".quake-option-toggle"));
  }

  function firstMenuOptionToggle(): HTMLElement | null {
    return menuOptionToggles()[0] ?? null;
  }

  function currentMenuOptionToggle(): HTMLElement | null {
    const panel = currentOptionPanel();
    const active = menuOptionToggleFor(document.activeElement);
    if (!panel || !active || !panel.contains(active)) return firstMenuOptionToggle();
    return active;
  }

  function focusMenuOptionToggle(delta: number): void {
    const toggles = menuOptionToggles();
    if (!toggles.length) return;
    const current = currentMenuOptionToggle() ?? toggles[0];
    const index = Math.max(0, toggles.indexOf(current));
    toggles[(index + delta + toggles.length) % toggles.length]?.focus({ preventScroll: true });
  }

  function toggleMenuOption(toggle: HTMLElement | null, direction = 1): void {
    if (toggle instanceof HTMLButtonElement) {
      toggle.dispatchEvent(new CustomEvent(QUAKE_OPTION_CYCLE_EVENT, {
        bubbles: true,
        detail: { direction },
      }));
      return;
    }
    const input = toggle?.querySelector<HTMLInputElement>("input[type=\"checkbox\"]");
    if (!input || input.disabled) return;
    input.click();
  }

  function syncMainMenuItemAvailability(): void {
    const quitItem = mainMenuArt?.querySelector<HTMLElement>(
      `[${QUAKE_MAIN_MENU_ACTION_ATTRIBUTE}="quit"]`,
    );
    if (!quitItem) return;
    const enabled = Boolean(isQuitEnabled?.());
    quitItem.classList.toggle(QUAKE_MAIN_MENU_SELECTABLE_CLASS, enabled);
    quitItem.classList.toggle(QUAKE_MAIN_MENU_DISABLED_CLASS, !enabled);
    quitItem.setAttribute("aria-disabled", String(!enabled));
    if (!enabled) quitItem.classList.remove("quake-main-menu-item-active");
  }

  function mainMenuItems(): HTMLElement[] {
    if (!mainMenuArt) return [];
    syncMainMenuItemAvailability();
    return Array.from(mainMenuArt.querySelectorAll<HTMLElement>(`.${QUAKE_MAIN_MENU_SELECTABLE_CLASS}`))
      .filter((item) => !item.classList.contains(QUAKE_MAIN_MENU_DISABLED_CLASS));
  }

  function updateMainMenuCursor(): void {
    const items = mainMenuItems();
    if (items.length > 0) {
      mainMenuSelectionIndex = Math.min(Math.max(mainMenuSelectionIndex, 0), items.length - 1);
    } else {
      mainMenuSelectionIndex = 0;
    }
    for (let index = 0; index < items.length; index++) {
      items[index]?.classList.toggle("quake-main-menu-item-active", index === mainMenuSelectionIndex);
    }
  }

  function selectMainMenuRow(row: number): boolean {
    const items = mainMenuItems();
    if (row < 0 || row >= items.length) return false;
    if (mainMenuSelectionIndex !== row) {
      mainMenuSelectionIndex = row;
      updateMainMenuCursor();
    }
    return true;
  }

  function moveMainMenuCursor(delta: number): void {
    const items = mainMenuItems();
    if (!items.length) return;
    mainMenuSelectionIndex = (mainMenuSelectionIndex + delta + items.length) % items.length;
    updateMainMenuCursor();
  }

  function activateMainMenuSelection(): void {
    const item = mainMenuItems()[mainMenuSelectionIndex];
    const action = item?.getAttribute(QUAKE_MAIN_MENU_ACTION_ATTRIBUTE) as QuakeMainMenuAction | null;
    if (action === "single-player") showSinglePlayerPanel();
    if (action === "multiplayer") showMultiplayerPanel();
    if (action === "level-select") showLevelPanel();
    if (action === "options") showOptionsPanel();
    if (action === "debug") showDebugPanel();
    if (action === "quit" && isQuitEnabled?.()) onSelectQuit?.();
  }

  function levelButtons(): HTMLButtonElement[] {
    if (!levelPanel) return [];
    return Array.from(levelPanel.querySelectorAll<HTMLButtonElement>(".quake-level-button"));
  }

  function firstLevelButton(): HTMLButtonElement | null {
    return levelButtons()[0] ?? null;
  }

  function currentLevelButton(): HTMLButtonElement | null {
    return levelButtons().find((button) => button.getAttribute("aria-current") === "page") ?? null;
  }

  function setCurrentLevel(mapName: string): void {
    for (const button of levelButtons()) {
      const current = button.value === mapName;
      if (current) {
        button.setAttribute("aria-current", "page");
      } else {
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
    }
  }

  function selectLevel(button: HTMLButtonElement): void {
    const mapName = button.value;
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

  function handleSinglePlayerPanelKey(event: KeyboardEvent): boolean {
    if (!isSinglePlayerPanelOpen()) return false;
    const button = singlePlayerButtonFor(event.target);
    switch (event.code) {
      case "Escape":
      case "Backspace":
        event.preventDefault();
        event.stopPropagation();
        closeMenuPanel();
        return true;
      case "Enter":
      case "Space":
        event.preventDefault();
        event.stopPropagation();
        activateSinglePlayerButton(button ?? currentSinglePlayerButton());
        return true;
      case "ArrowDown":
      case "KeyS":
        event.preventDefault();
        event.stopPropagation();
        focusSinglePlayerButton(1);
        return true;
      case "ArrowUp":
      case "KeyW":
        event.preventDefault();
        event.stopPropagation();
        focusSinglePlayerButton(-1);
        return true;
      default:
        return false;
    }
  }

  function handleMenuPanelKey(event: KeyboardEvent): boolean {
    if (!isMenuPanelOpen()) return false;
    if (isMultiplayerPanelOpen()) {
      if (event.code === "Escape" || event.code === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        closeMenuPanel();
        return true;
      }
      if (isTextEntryTarget(event.target)) return false;
      if (event.code === "ArrowDown" || event.code === "KeyS") {
        event.preventDefault();
        event.stopPropagation();
        focusMultiplayerControl(1);
        return true;
      }
      if (event.code === "ArrowUp" || event.code === "KeyW") {
        event.preventDefault();
        event.stopPropagation();
        focusMultiplayerControl(-1);
        return true;
      }
    }
    if (handleSinglePlayerPanelKey(event)) return true;
    if (handleLevelPanelKey(event)) return true;
    const sourceLink = aboutSourceLinkFor(event.target);
    const optionToggle = menuOptionToggleFor(event.target);
    switch (event.code) {
      case "Escape":
      case "Backspace":
        event.preventDefault();
        event.stopPropagation();
        closeMenuPanel();
        return true;
      case "Enter":
        if (optionToggle) {
          event.preventDefault();
          event.stopPropagation();
          toggleMenuOption(optionToggle, 1);
          return true;
        }
        if (sourceLink) return false;
        event.preventDefault();
        event.stopPropagation();
        closeMenuPanel();
        return true;
      case "Space":
        event.preventDefault();
        event.stopPropagation();
        if (optionToggle) {
          toggleMenuOption(optionToggle, 1);
        } else if (sourceLink) {
          sourceLink.click();
        } else {
          closeMenuPanel();
        }
        return true;
      case "ArrowDown":
      case "KeyS":
        event.preventDefault();
        event.stopPropagation();
        if (currentOptionPanel()) focusMenuOptionToggle(1);
        return true;
      case "ArrowUp":
      case "KeyW":
        event.preventDefault();
        event.stopPropagation();
        if (currentOptionPanel()) focusMenuOptionToggle(-1);
        return true;
      case "ArrowLeft":
      case "KeyA":
        event.preventDefault();
        event.stopPropagation();
        if (currentOptionPanel()) toggleMenuOption(currentMenuOptionToggle(), -1);
        return true;
      case "ArrowRight":
      case "KeyD":
        event.preventDefault();
        event.stopPropagation();
        if (currentOptionPanel()) toggleMenuOption(currentMenuOptionToggle(), 1);
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
    const singlePlayerButton = singlePlayerButtonFor(event.target);
    if (singlePlayerButton) {
      activateSinglePlayerButton(singlePlayerButton);
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
        event.preventDefault();
        event.stopPropagation();
        activateMainMenuSelection();
        return true;
      case "Space":
        event.preventDefault();
        event.stopPropagation();
        activateMainMenuSelection();
        return true;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        if (shouldResumeMainMenuOnEscape?.()) {
          onResumeMainMenuFromEscape?.();
          startFromMainMenu();
        }
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
    if (row === null) {
      const target = event.target instanceof Node ? event.target : null;
      if (!mainMenuItemFor(target)) hideMainMenu();
      return;
    }
    if (!selectMainMenuRow(row)) return;
    activateMainMenuSelection();
  }

  function handleMainMenuPointerMove(event: PointerEvent): void {
    const row = mainMenuPointerRow(event);
    if (row !== null && selectMainMenuRow(row)) {
      mainMenu?.classList.add("quake-main-menu-hover");
    } else {
      mainMenu?.classList.remove("quake-main-menu-hover");
    }
  }

  function handleMainMenuPointerLeave(): void {
    mainMenu?.classList.remove("quake-main-menu-hover");
  }

  function mainMenuPointerRow(event: MouseEvent): number | null {
    if (!mainMenuArt) return null;
    const items = mainMenuItems();
    for (const item of items) {
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
        const row = items.indexOf(item);
        return row >= 0 ? row : null;
      }
    }
    return null;
  }

  function mainMenuItemFor(target: EventTarget | null): HTMLElement | null {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    return element?.closest(".quake-main-menu-item") as HTMLElement | null;
  }

  function focusCurrent(): void {
    if (isSinglePlayerPanelOpen()) {
      (currentSinglePlayerButton() ?? firstSinglePlayerButton() ?? singlePlayerPanel)?.focus({ preventScroll: true });
    } else if (isMultiplayerPanelOpen()) {
      (currentMultiplayerControl() ?? multiplayerPanel)?.focus({ preventScroll: true });
    } else if (isLevelPanelOpen()) {
      (currentLevelButton() ?? firstLevelButton() ?? levelPanel)?.focus({ preventScroll: true });
    } else if (isAboutPanelOpen()) {
      aboutPanel?.focus({ preventScroll: true });
    } else if (isOptionsPanelOpen()) {
      optionsPanel?.focus({ preventScroll: true });
    } else if (isDebugPanelOpen()) {
      debugPanel?.focus({ preventScroll: true });
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
    if (shouldOpenMainMenuOnControlsEnd && !shouldOpenMainMenuOnControlsEnd()) return;
    showMainMenu();
  }

  function dispose(): void {
    mainMenu?.removeEventListener("click", handleMainMenuClick);
    mainMenu?.removeEventListener("pointermove", handleMainMenuPointerMove);
    mainMenu?.removeEventListener("pointerleave", handleMainMenuPointerLeave);
    singlePlayerPanel?.removeEventListener("click", handleMenuPanelClick);
    multiplayerPanel?.removeEventListener("click", handleMenuPanelClick);
    levelPanel?.removeEventListener("click", handleMenuPanelClick);
    aboutPanel?.removeEventListener("click", handleMenuPanelClick);
    optionsPanel?.removeEventListener("click", handleMenuPanelClick);
    debugPanel?.removeEventListener("click", handleMenuPanelClick);
    controls.removeEventListener("start", handleControlsStart);
    controls.removeEventListener("end", handleControlsEnd);
  }

  if (enabled) {
    mainMenu?.addEventListener("click", handleMainMenuClick);
    mainMenu?.addEventListener("pointermove", handleMainMenuPointerMove);
    mainMenu?.addEventListener("pointerleave", handleMainMenuPointerLeave);
    singlePlayerPanel?.addEventListener("click", handleMenuPanelClick);
    multiplayerPanel?.addEventListener("click", handleMenuPanelClick);
    levelPanel?.addEventListener("click", handleMenuPanelClick);
    aboutPanel?.addEventListener("click", handleMenuPanelClick);
    optionsPanel?.addEventListener("click", handleMenuPanelClick);
    debugPanel?.addEventListener("click", handleMenuPanelClick);
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
