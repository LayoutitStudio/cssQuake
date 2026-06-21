export const QUAKE_MULTIPLAYER_DEFAULT_REGION = "auto" as const;

export const QUAKE_MULTIPLAYER_REGIONS = [
  { id: QUAKE_MULTIPLAYER_DEFAULT_REGION, label: "Auto", inviteCode: "au" },
  { id: "na", label: "North America", inviteCode: "na" },
  { id: "eu", label: "Europe", inviteCode: "eu" },
  { id: "sa", label: "South America", inviteCode: "sa" },
  { id: "apac", label: "Asia-Pacific", inviteCode: "ap" },
] as const;

export type QuakeMultiplayerRegionId = typeof QUAKE_MULTIPLAYER_REGIONS[number]["id"];

const QUAKE_MULTIPLAYER_REGION_IDS = new Set<string>(
  QUAKE_MULTIPLAYER_REGIONS.map((region) => region.id),
);

export function isQuakeMultiplayerRegionId(value: string): value is QuakeMultiplayerRegionId {
  return QUAKE_MULTIPLAYER_REGION_IDS.has(value);
}

export function normalizeQuakeMultiplayerRegion(
  value: string | null | undefined,
): QuakeMultiplayerRegionId {
  const region = (value ?? "").trim().toLowerCase();
  return isQuakeMultiplayerRegionId(region) ? region : QUAKE_MULTIPLAYER_DEFAULT_REGION;
}

export function quakeMultiplayerRegionLabel(regionId: QuakeMultiplayerRegionId): string {
  return QUAKE_MULTIPLAYER_REGIONS.find((region) => region.id === regionId)?.label ?? "Auto";
}

export function quakeMultiplayerRegionInviteCode(regionId: QuakeMultiplayerRegionId): string {
  return QUAKE_MULTIPLAYER_REGIONS.find((region) => region.id === regionId)?.inviteCode ?? "au";
}

export function quakeMultiplayerRegionFromInviteCode(
  code: string | null | undefined,
): QuakeMultiplayerRegionId | null {
  const inviteCode = (code ?? "").trim().toLowerCase();
  return QUAKE_MULTIPLAYER_REGIONS.find((region) => region.inviteCode === inviteCode)?.id ?? null;
}
