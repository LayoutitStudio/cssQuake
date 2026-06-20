const QUAKE_LOCAL_ASSET_ROOT = "/q";

export const QUAKE_ASSET_ROOT = normalizeQuakeAssetRoot(runtimeQuakeAssetRoot());

export function quakeAssetUrl(path: string): string {
  const normalizedPath = path.trim().replace(/^\/+/, "");
  return resolveQuakeAssetUrl(`${QUAKE_LOCAL_ASSET_ROOT}/${normalizedPath}`);
}

export function resolveQuakeAssetUrl(url: string | undefined): string {
  const normalizedUrl = url?.trim() ?? "";
  if (!normalizedUrl || QUAKE_ASSET_ROOT === QUAKE_LOCAL_ASSET_ROOT) return normalizedUrl;
  if (normalizedUrl === QUAKE_LOCAL_ASSET_ROOT) return QUAKE_ASSET_ROOT;
  if (normalizedUrl.startsWith(`${QUAKE_LOCAL_ASSET_ROOT}/`)) {
    return `${QUAKE_ASSET_ROOT}${normalizedUrl.slice(QUAKE_LOCAL_ASSET_ROOT.length)}`;
  }
  return normalizedUrl;
}

function runtimeQuakeAssetRoot(): string | undefined {
  return (import.meta as unknown as { env?: { VITE_QUAKE_ASSET_ROOT?: string } }).env?.VITE_QUAKE_ASSET_ROOT;
}

function normalizeQuakeAssetRoot(value: string | undefined): string {
  const normalized = value?.trim().replace(/\/+$/, "") ?? "";
  return normalized || QUAKE_LOCAL_ASSET_ROOT;
}
