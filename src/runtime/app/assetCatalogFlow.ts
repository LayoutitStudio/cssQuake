import type { QuakeAssetManifest, QuakeAssetManifestMap, QuakeSceneMode } from "./session";
import {
  FALLBACK_QUAKE_ASSET_MANIFEST,
  quakeAssetManifestMapTitle,
  quakeAssetManifestSceneUrlMap,
  quakeAssetManifestSelectableLevels,
} from "./session";

export interface QuakeAssetCatalogFlowOptions {
  levelList: HTMLElement | null;
  mountBitmapText(root: HTMLElement): void;
}

export interface QuakeAssetCatalogFlow {
  assetRoot(): string | undefined;
  manifest(): QuakeAssetManifest;
  mapExists(mapName: string): boolean;
  mapTitle(level: QuakeAssetManifestMap): string;
  mountLevelSelector(renderBitmapText?: boolean): void;
  sceneUrl(mapName: string, mode?: QuakeSceneMode): string | undefined;
  selectableLevels(): QuakeAssetManifestMap[];
  setManifest(manifest: QuakeAssetManifest, options?: { renderBitmapText?: boolean }): void;
  startMap(): string;
  version(): number;
}

export function createQuakeAssetCatalogFlow(
  options: QuakeAssetCatalogFlowOptions,
): QuakeAssetCatalogFlow {
  let assetManifest = FALLBACK_QUAKE_ASSET_MANIFEST;
  let mapUrls = quakeAssetManifestSceneUrlMap(assetManifest);
  let deathmatchMapUrls = quakeAssetManifestSceneUrlMap(assetManifest, "deathmatch");

  function manifest(): QuakeAssetManifest {
    return assetManifest;
  }

  function setManifest(
    manifest: QuakeAssetManifest,
    setOptions: { renderBitmapText?: boolean } = {},
  ): void {
    assetManifest = manifest;
    mapUrls = quakeAssetManifestSceneUrlMap(manifest);
    deathmatchMapUrls = quakeAssetManifestSceneUrlMap(manifest, "deathmatch");
    mountLevelSelector(setOptions.renderBitmapText ?? false);
  }

  function mountLevelSelector(renderBitmapText = false): void {
    if (!options.levelList) return;
    options.levelList.replaceChildren();
    for (const level of selectableLevels()) {
      const button = document.createElement("button");
      button.className = "quake-level-button";
      button.type = "button";
      button.value = level.mapName;
      button.setAttribute("aria-label", `${level.mapName.toUpperCase()} ${mapTitle(level)}`);

      const code = document.createElement("span");
      code.className = "quake-level-code quake-bm-label quake-bm-alt";
      code.textContent = level.mapName.toUpperCase();

      const title = document.createElement("span");
      title.className = "quake-level-name quake-bm-label";
      title.textContent = mapTitle(level);

      button.append(code, title);
      options.levelList.append(button);
    }
    if (renderBitmapText) options.mountBitmapText(options.levelList);
  }

  function selectableLevels(): QuakeAssetManifestMap[] {
    return quakeAssetManifestSelectableLevels(assetManifest);
  }

  function mapTitle(level: QuakeAssetManifestMap): string {
    return quakeAssetManifestMapTitle(level);
  }

  function sceneUrl(mapName: string, mode: QuakeSceneMode = "singleplayer"): string | undefined {
    return (mode === "deathmatch" ? deathmatchMapUrls : mapUrls).get(mapName);
  }

  return {
    assetRoot: () => assetManifest.assetRoot,
    manifest,
    mapExists: (mapName) => sceneUrl(mapName) !== undefined,
    mapTitle,
    mountLevelSelector,
    sceneUrl,
    selectableLevels,
    setManifest,
    startMap: () => assetManifest.startMap,
    version: () => assetManifest.version,
  };
}
