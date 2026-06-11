const QUAKE_PARENT_KEY_MESSAGE_TYPE = "cssquake:key";

export interface QuakeParentKeyRelay {
  clear(): void;
  handle(event: KeyboardEvent, pressed: boolean): void;
}

export interface QuakeParentKeyRelayOptions {
  canUseInput(): boolean;
  gameplayKeyCodes: ReadonlySet<string>;
  isEditableTarget(target: EventTarget | null): boolean;
}

export function createQuakeParentKeyRelay({
  canUseInput,
  gameplayKeyCodes,
  isEditableTarget,
}: QuakeParentKeyRelayOptions): QuakeParentKeyRelay {
  const targetOrigin = quakeParentKeyTargetOrigin();
  const relayedKeyCodesDown = new Map<string, string>();

  function post(action: "down" | "up", code: string, key: string): void {
    if (targetOrigin === null) return;
    window.parent.postMessage({
      type: QUAKE_PARENT_KEY_MESSAGE_TYPE,
      action,
      code,
      key,
    }, targetOrigin);
  }

  function handle(event: KeyboardEvent, pressed: boolean): void {
    if (targetOrigin === null || !gameplayKeyCodes.has(event.code)) return;
    const key = relayedKeyCodesDown.get(event.code);
    if (!pressed) {
      if (key === undefined) return;
      relayedKeyCodesDown.delete(event.code);
      post("up", event.code, key);
      return;
    }
    if (event.repeat || key !== undefined || !canUseInput() || isEditableTarget(event.target)) return;
    relayedKeyCodesDown.set(event.code, event.key);
    post("down", event.code, event.key);
  }

  function clear(): void {
    if (relayedKeyCodesDown.size === 0) return;
    const relayedKeys = Array.from(relayedKeyCodesDown);
    relayedKeyCodesDown.clear();
    if (window.parent === window) return;
    for (const [code, key] of relayedKeys) {
      post("up", code, key);
    }
  }

  return { clear, handle };
}

function quakeParentKeyTargetOrigin(): string | null {
  if (new URLSearchParams(window.location.search).get("relayKeys") !== "1" || window.parent === window || !document.referrer) {
    return null;
  }
  try {
    return new URL(document.referrer).origin;
  } catch {
    return null;
  }
}
