export type QuakeCrosshairOption = "off" | "plus" | "dot" | "x" | "o" | "caret" | "vee";

interface QuakeCrosshairDefinition {
  value: QuakeCrosshairOption;
  label: string;
}

const QUAKE_CROSSHAIR_OPTIONS: QuakeCrosshairDefinition[] = [
  { value: "off", label: "off" },
  { value: "plus", label: "+" },
  { value: "dot", label: "." },
  { value: "x", label: "x" },
  { value: "o", label: "o" },
  { value: "caret", label: "^" },
  { value: "vee", label: "v" },
];

export interface QuakeOptionsFlowOptions {
  alwaysRunOption: HTMLInputElement | null;
  crosshair: HTMLElement | null;
  crosshairOption: HTMLElement | null;
  crosshairOptionValue: HTMLElement | null;
  disableDamageOption: HTMLInputElement | null;
  disableEnemiesOption: HTMLInputElement | null;
  disableSoundOption: HTMLInputElement | null;
  dynamicLightingOption: HTMLInputElement | null;
  invertMouseOption: HTMLInputElement | null;
  showGunOption: HTMLInputElement | null;
  audioMuted(): boolean;
  damageDisabled(): boolean;
  dynamicLightingEnabled(): boolean;
  enemiesDisabled(): boolean;
  invertMouse(): boolean;
  alwaysRun(): boolean;
  showGun(): boolean;
  mountBitmapText(element: HTMLElement): void;
  unlockAudio(): void;
  setAlwaysRun(alwaysRun: boolean): void;
  setAudioMuted(muted: boolean): void;
  setDamageDisabled(disabled: boolean): void;
  setDynamicLighting(enabled: boolean): void;
  setEnemiesDisabled(disabled: boolean): void;
  setInvertMouse(invert: boolean): void;
  setShowGun(enabled: boolean): void;
  setStaticLightingClass(enabled: boolean): void;
  syncDebugControls(): void;
  syncDebugFlyMode(): void;
}

export interface QuakeOptionsFlow {
  attach(): void;
  cycleCrosshairOption(direction: number): void;
  dispose(): void;
  setCrosshairOption(value: QuakeCrosshairOption): void;
  syncAudioToggle(): void;
  syncControls(): void;
  syncDynamicLightingOption(): void;
}

export function createQuakeOptionsFlow(options: QuakeOptionsFlowOptions): QuakeOptionsFlow {
  let crosshairOption: QuakeCrosshairOption = "plus";

  function syncAudioToggle(): void {
    if (options.disableSoundOption) options.disableSoundOption.checked = options.audioMuted();
  }

  function syncDynamicLightingOption(): void {
    const enabled = options.dynamicLightingEnabled();
    if (options.dynamicLightingOption) options.dynamicLightingOption.checked = enabled;
    options.setStaticLightingClass(!enabled);
  }

  function setCrosshairOption(value: QuakeCrosshairOption): void {
    crosshairOption = value;
    const definition = quakeCrosshairDefinition(value);
    if (options.crosshair) {
      options.crosshair.dataset.quakeCrosshair = definition.value;
      options.crosshair.hidden = definition.value === "off";
    }
    if (options.crosshairOption) {
      options.crosshairOption.dataset.quakeCrosshair = definition.value;
      options.crosshairOption.setAttribute("aria-label", `Crosshair ${definition.label}`);
    }
    if (options.crosshairOptionValue) {
      options.crosshairOptionValue.textContent = definition.label;
      options.mountBitmapText(options.crosshairOptionValue);
    }
  }

  function cycleCrosshairOption(direction: number): void {
    const step = direction < 0 ? -1 : 1;
    const index = QUAKE_CROSSHAIR_OPTIONS.findIndex((option) => option.value === crosshairOption);
    const currentIndex = index >= 0 ? index : 1;
    const next = QUAKE_CROSSHAIR_OPTIONS[
      (currentIndex + step + QUAKE_CROSSHAIR_OPTIONS.length) % QUAKE_CROSSHAIR_OPTIONS.length
    ];
    setCrosshairOption(next.value);
  }

  function syncControls(): void {
    syncAudioToggle();
    if (options.disableEnemiesOption) options.disableEnemiesOption.checked = options.enemiesDisabled();
    if (options.disableDamageOption) options.disableDamageOption.checked = options.damageDisabled();
    options.syncDebugControls();
    options.syncDebugFlyMode();
    syncDynamicLightingOption();
    if (options.invertMouseOption) options.invertMouseOption.checked = options.invertMouse();
    if (options.alwaysRunOption) options.alwaysRunOption.checked = options.alwaysRun();
    if (options.showGunOption) options.showGunOption.checked = options.showGun();
    setCrosshairOption(crosshairOption);
  }

  function handleDisableSoundOptionChange(event: Event): void {
    options.unlockAudio();
    options.setAudioMuted((event.currentTarget as HTMLInputElement).checked);
  }

  function handleDisableEnemiesOptionChange(event: Event): void {
    options.setEnemiesDisabled((event.currentTarget as HTMLInputElement).checked);
  }

  function handleDisableDamageOptionChange(event: Event): void {
    options.setDamageDisabled((event.currentTarget as HTMLInputElement).checked);
  }

  function handleDynamicLightingOptionChange(event: Event): void {
    options.setDynamicLighting((event.currentTarget as HTMLInputElement).checked);
  }

  function handleAlwaysRunOptionChange(event: Event): void {
    options.setAlwaysRun((event.currentTarget as HTMLInputElement).checked);
  }

  function handleShowGunOptionChange(event: Event): void {
    options.setShowGun((event.currentTarget as HTMLInputElement).checked);
  }

  function handleCrosshairOptionClick(): void {
    cycleCrosshairOption(1);
  }

  function handleCrosshairOptionCycle(event: Event): void {
    const direction = event instanceof CustomEvent && typeof event.detail?.direction === "number"
      ? event.detail.direction
      : 1;
    cycleCrosshairOption(direction);
  }

  function handleInvertMouseOptionChange(event: Event): void {
    options.setInvertMouse((event.currentTarget as HTMLInputElement).checked);
  }

  function attach(): void {
    options.disableSoundOption?.addEventListener("change", handleDisableSoundOptionChange);
    options.disableEnemiesOption?.addEventListener("change", handleDisableEnemiesOptionChange);
    options.disableDamageOption?.addEventListener("change", handleDisableDamageOptionChange);
    options.dynamicLightingOption?.addEventListener("change", handleDynamicLightingOptionChange);
    options.alwaysRunOption?.addEventListener("change", handleAlwaysRunOptionChange);
    options.showGunOption?.addEventListener("change", handleShowGunOptionChange);
    options.crosshairOption?.addEventListener("click", handleCrosshairOptionClick);
    options.crosshairOption?.addEventListener("quake-option-cycle", handleCrosshairOptionCycle);
    options.invertMouseOption?.addEventListener("change", handleInvertMouseOptionChange);
  }

  function dispose(): void {
    options.disableSoundOption?.removeEventListener("change", handleDisableSoundOptionChange);
    options.disableEnemiesOption?.removeEventListener("change", handleDisableEnemiesOptionChange);
    options.disableDamageOption?.removeEventListener("change", handleDisableDamageOptionChange);
    options.dynamicLightingOption?.removeEventListener("change", handleDynamicLightingOptionChange);
    options.alwaysRunOption?.removeEventListener("change", handleAlwaysRunOptionChange);
    options.showGunOption?.removeEventListener("change", handleShowGunOptionChange);
    options.crosshairOption?.removeEventListener("click", handleCrosshairOptionClick);
    options.crosshairOption?.removeEventListener("quake-option-cycle", handleCrosshairOptionCycle);
    options.invertMouseOption?.removeEventListener("change", handleInvertMouseOptionChange);
  }

  return {
    attach,
    cycleCrosshairOption,
    dispose,
    setCrosshairOption,
    syncAudioToggle,
    syncControls,
    syncDynamicLightingOption,
  };
}

function quakeCrosshairDefinition(value: QuakeCrosshairOption): QuakeCrosshairDefinition {
  return QUAKE_CROSSHAIR_OPTIONS.find((option) => option.value === value) ?? QUAKE_CROSSHAIR_OPTIONS[1];
}
