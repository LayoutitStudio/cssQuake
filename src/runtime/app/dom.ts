export interface QuakeAppDomElements {
  app: HTMLElement;
  ui: HTMLElement | null;
  viewmodelLayer: HTMLElement | null;
  mainMenu: HTMLElement | null;
  mainMenuArt: HTMLElement | null;
  versionLabel: HTMLElement | null;
  singlePlayerPanel: HTMLElement | null;
  multiplayerPanel: HTMLElement | null;
  multiplayerForm: HTMLFormElement | null;
  multiplayerNameInput: HTMLInputElement | null;
  multiplayerColorInput: HTMLInputElement | null;
  multiplayerRoomInput: HTMLInputElement | null;
  multiplayerMapSelect: HTMLSelectElement | null;
  multiplayerFragLimitInput: HTMLInputElement | null;
  multiplayerTimeLimitInput: HTMLInputElement | null;
  multiplayerMaxPlayersInput: HTMLInputElement | null;
  multiplayerCreateButton: HTMLButtonElement | null;
  multiplayerJoinButton: HTMLButtonElement | null;
  multiplayerCopyButton: HTMLButtonElement | null;
  multiplayerStatus: HTMLElement | null;
  levelPanel: HTMLElement | null;
  levelList: HTMLElement | null;
  aboutPanel: HTMLElement | null;
  optionsPanel: HTMLElement | null;
  debugMenuPanel: HTMLElement | null;
  disableSoundOption: HTMLInputElement | null;
  disableEnemiesOption: HTMLInputElement | null;
  disableDamageOption: HTMLInputElement | null;
  invertMouseOption: HTMLInputElement | null;
  alwaysRunOption: HTMLInputElement | null;
  showGunOption: HTMLInputElement | null;
  dynamicLightingOption: HTMLInputElement | null;
  crosshair: HTMLElement | null;
  crosshairOption: HTMLButtonElement | null;
  crosshairOptionValue: HTMLElement | null;
  debugPanel: HTMLElement | null;
  debugShowMenuOption: HTMLInputElement | null;
  debugEnabledOption: HTMLInputElement | null;
  debugShowFpsOption: HTMLInputElement | null;
  debugEnableAnimationsOption: HTMLInputElement | null;
  debugShowTexturesOption: HTMLInputElement | null;
  debugFlyModeOption: HTMLInputElement | null;
  debugShowOutlinesOption: HTMLInputElement | null;
  debugShowLabelsOption: HTMLInputElement | null;
  debugRecordButton: HTMLButtonElement | null;
  debugStatElements: Map<string, HTMLElement>;
  loadingOverlay: HTMLElement | null;
  loadingStatus: HTMLElement | null;
  loadingProgress: HTMLElement | null;
  loadingProgressFill: HTMLElement | null;
  loadingAction: HTMLElement | null;
  hudArmorValue: HTMLElement | null;
  hudHealthValue: HTMLElement | null;
  hudHealthDamageValue: HTMLElement | null;
  hudAmmoValue: HTMLElement | null;
  classicHud: HTMLElement | null;
  hud: HTMLElement | null;
  bonusOverlay: HTMLElement | null;
  damageOverlay: HTMLElement | null;
  notify: HTMLElement | null;
  centerPrint: HTMLElement | null;
}

export function queryQuakeAppDom(): QuakeAppDomElements {
  return {
    app: requiredQuakeElement("quake-app"),
    ui: quakeElement("quake-ui"),
    viewmodelLayer: quakeElement("quake-viewmodel-layer"),
    mainMenu: quakeElement("quake-main-menu"),
    mainMenuArt: quakeElement("quake-main-menu-art"),
    versionLabel: quakeElement("cssquake-version"),
    singlePlayerPanel: quakeElement("quake-single-player-panel"),
    multiplayerPanel: quakeElement("quake-multiplayer-panel"),
    multiplayerForm: quakeElement("quake-multiplayer-form"),
    multiplayerNameInput: quakeElement("quake-multiplayer-name"),
    multiplayerColorInput: quakeElement("quake-multiplayer-color"),
    multiplayerRoomInput: quakeElement("quake-multiplayer-room"),
    multiplayerMapSelect: quakeElement("quake-multiplayer-map"),
    multiplayerFragLimitInput: quakeElement("quake-multiplayer-fraglimit"),
    multiplayerTimeLimitInput: quakeElement("quake-multiplayer-timelimit"),
    multiplayerMaxPlayersInput: quakeElement("quake-multiplayer-maxplayers"),
    multiplayerCreateButton: quakeElement("quake-multiplayer-create"),
    multiplayerJoinButton: quakeElement("quake-multiplayer-join"),
    multiplayerCopyButton: quakeElement("quake-multiplayer-copy"),
    multiplayerStatus: quakeElement("quake-multiplayer-status"),
    levelPanel: quakeElement("quake-level-panel"),
    levelList: quakeElement("quake-level-list"),
    aboutPanel: quakeElement("quake-about-panel"),
    optionsPanel: quakeElement("quake-options-panel"),
    debugMenuPanel: quakeElement("quake-debug-menu-panel"),
    disableSoundOption: quakeElement("quake-option-disable-sound"),
    disableEnemiesOption: quakeElement("quake-option-disable-enemies"),
    disableDamageOption: quakeElement("quake-option-disable-damage"),
    invertMouseOption: quakeElement("quake-option-invert-mouse"),
    alwaysRunOption: quakeElement("quake-option-always-run"),
    showGunOption: quakeElement("quake-option-show-gun"),
    dynamicLightingOption: quakeElement("quake-option-dynamic-lighting"),
    crosshair: quakeElement("quake-crosshair"),
    crosshairOption: quakeElement("quake-option-crosshair"),
    crosshairOptionValue: quakeElement("quake-option-crosshair-value"),
    debugPanel: quakeElement("quake-debug-panel"),
    debugShowMenuOption: quakeElement("quake-debug-show-menu"),
    debugEnabledOption: quakeElement("quake-debug-enabled"),
    debugShowFpsOption: quakeElement("quake-debug-show-fps"),
    debugEnableAnimationsOption: quakeElement("quake-debug-enable-animations"),
    debugShowTexturesOption: quakeElement("quake-debug-show-textures"),
    debugFlyModeOption: quakeElement("quake-debug-fly-mode"),
    debugShowOutlinesOption: quakeElement("quake-debug-show-outlines"),
    debugShowLabelsOption: quakeElement("quake-debug-show-labels"),
    debugRecordButton: quakeElement("quake-debug-record"),
    debugStatElements: new Map(
      Array.from(document.querySelectorAll<HTMLElement>("[data-qstat]"))
        .map((element) => [element.dataset.qstat ?? "", element] as const)
        .filter(([name]) => Boolean(name)),
    ),
    loadingOverlay: quakeElement("quake-loading-overlay"),
    loadingStatus: quakeElement("quake-loading-status"),
    loadingProgress: quakeElement("quake-loading-progress"),
    loadingProgressFill: quakeElement("quake-loading-progress-fill"),
    loadingAction: quakeElement("quake-loading-action"),
    hudArmorValue: quakeElement("quake-hud-armor-value"),
    hudHealthValue: quakeElement("quake-hud-health-value"),
    hudHealthDamageValue: quakeElement("quake-hud-health-damage-value"),
    hudAmmoValue: quakeElement("quake-hud-ammo-value"),
    classicHud: quakeElement("quake-classic-hud"),
    hud: quakeElement("quake-hud"),
    bonusOverlay: quakeElement("quake-bonus-overlay"),
    damageOverlay: quakeElement("quake-damage-overlay"),
    notify: quakeElement("quake-notify"),
    centerPrint: quakeElement("quake-centerprint"),
  };
}

export function addQuakeBodyClasses(...classNames: string[]): void {
  document.body.classList.add(...classNames);
}

export function removeQuakeBodyClasses(...classNames: string[]): void {
  document.body.classList.remove(...classNames);
}

export function setQuakeBodyClass(className: string, active: boolean): void {
  document.body.classList.toggle(className, active);
}

export function hasQuakeBodyClass(className: string): boolean {
  return document.body.classList.contains(className);
}

function quakeElement<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function requiredQuakeElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = quakeElement<T>(id);
  if (!element) throw new Error(`Missing cssQuake shell element #${id}.`);
  return element;
}
