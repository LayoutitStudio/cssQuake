import {
  QUAKE_MULTIPLAYER_DEFAULT_REGION,
  quakeMultiplayerRegionFromInviteCode,
  type QuakeMultiplayerRegionId,
} from "./region";

export const QUAKE_MULTIPLAYER_ROOM_TOKEN_LENGTH = 8;
export const QUAKE_MULTIPLAYER_ROOM_TOKEN_ALPHABET = "bcdfghjkmnpqrstvwxyz23456789";
export const QUAKE_MULTIPLAYER_ROOM_TOKEN_PATTERN = /^[bcdfghjkmnpqrstvwxyz23456789]{8}$/i;
export const QUAKE_MULTIPLAYER_COMPACT_MAP_CODE_LENGTH = 2;
export const QUAKE_MULTIPLAYER_COMPACT_MAP_CODE_CAPACITY = 36 ** QUAKE_MULTIPLAYER_COMPACT_MAP_CODE_LENGTH;
export const QUAKE_MULTIPLAYER_COMPACT_MAP_CODE_PATTERN = /^[0-9a-z]{2}$/i;
export const QUAKE_MULTIPLAYER_COMPACT_INVITE_PATTERN =
  /^([0-9a-z]{2})([bcdfghjkmnpqrstvwxyz23456789]{8})([0-9a-z]{2})$/i;

export interface QuakeMultiplayerCompactInviteParts {
  mapCode: string;
  token: string;
  region: QuakeMultiplayerRegionId;
}

export function parseQuakeMultiplayerCompactInviteParts(
  value: string | null | undefined,
): QuakeMultiplayerCompactInviteParts | null {
  const inviteId = (value ?? "").trim().toLowerCase();
  const match = QUAKE_MULTIPLAYER_COMPACT_INVITE_PATTERN.exec(inviteId);
  if (!match) return null;
  const region = quakeMultiplayerRegionFromInviteCode(match[3]);
  if (!region) return null;
  return {
    region,
    mapCode: (match[1] ?? "").toLowerCase(),
    token: (match[2] ?? "").toLowerCase(),
  };
}

export function createQuakeMultiplayerCompactInviteValue(
  mapCode: string,
  token: string,
): string | null {
  const safeMapCode = mapCode.trim().toLowerCase();
  const safeToken = token.trim().toLowerCase();
  if (!QUAKE_MULTIPLAYER_COMPACT_MAP_CODE_PATTERN.test(safeMapCode)) return null;
  if (!QUAKE_MULTIPLAYER_ROOM_TOKEN_PATTERN.test(safeToken)) return null;
  return `${safeMapCode}${safeToken}au`;
}

export function createQuakeMultiplayerRoomIdFromToken(
  mapName: string,
  token: string,
): string | null {
  const safeMapName = mapName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const safeToken = token.trim().toLowerCase();
  if (!safeMapName || !QUAKE_MULTIPLAYER_ROOM_TOKEN_PATTERN.test(safeToken)) return null;
  return `cssquake-${QUAKE_MULTIPLAYER_DEFAULT_REGION}-${safeMapName}-${safeToken}`;
}
