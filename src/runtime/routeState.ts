import { QUAKE_MULTIPLAYER_COMPACT_INVITE_PATTERN } from "./multiplayer/invite";

const QUAKE_URL_VIEW_PART_COUNT = 6;
const QUAKE_URL_NUMBER_SCALE = 1000;
const QUAKE_URL_VIEW_ORIGIN_LIMIT = 100000;
const QUAKE_URL_VIEW_PITCH_MIN = -90;
const QUAKE_URL_VIEW_PITCH_MAX = 90;
const QUAKE_URL_VIEW_ANGLE_LIMIT = 36000;
const QUAKE_URL_VIEW_ROLL_EPSILON = 0.001;
const QUAKE_URL_MULTIPLAYER_INVITE_PARAM = "room";
const QUAKE_URL_MULTIPLAYER_INVITE_ID_PATTERN = QUAKE_MULTIPLAYER_COMPACT_INVITE_PATTERN;

export type QuakeUrlUpdateMode = "none" | "push" | "replace";

export interface QuakeUrlView {
  origin: [number, number, number];
  pitch: number;
  yaw: number;
  roll: number;
}

export interface QuakeUrlRoute {
  mapName: string;
  mapParamPresent: boolean;
  mapParamValid: boolean;
  compactMultiplayerInvitePresent: boolean;
  view: QuakeUrlView | null;
}

interface QuakeUrlRouteOptions {
  compactMultiplayerInviteMapName?: (inviteId: string) => string | null;
  mapExists: (mapName: string) => boolean;
  startMap: string;
}

export function parseQuakeUrlRouteFromLocation(
  location: Pick<Location, "search">,
  options: QuakeUrlRouteOptions,
): QuakeUrlRoute {
  const params = new URLSearchParams(location.search);
  const compactMultiplayerInvitePresent = params.has(QUAKE_URL_MULTIPLAYER_INVITE_PARAM);
  const mapName = quakeUrlMapName(params, options.mapExists) ??
    quakeUrlCompactMultiplayerInviteMapName(params, options);
  const mapParamPresent = params.has("map") || compactMultiplayerInvitePresent;
  const view = mapName !== null || !mapParamPresent ? quakeUrlView(params) : null;
  return {
    mapName: mapName ?? options.startMap,
    mapParamPresent,
    mapParamValid: mapName !== null,
    compactMultiplayerInvitePresent,
    view,
  };
}

export function quakeUrlRouteIsDirect(route: QuakeUrlRoute): boolean {
  return route.mapParamValid || route.view !== null;
}

export function quakeUrlRouteShouldNormalize(route: QuakeUrlRoute): boolean {
  if (route.compactMultiplayerInvitePresent) return false;
  return !route.mapParamPresent || route.mapParamValid;
}

function quakeUrlMapName(params: URLSearchParams, mapExists: (mapName: string) => boolean): string | null {
  const mapName = params.get("map")?.trim().toLowerCase();
  return mapName && mapExists(mapName) ? mapName : null;
}

function quakeUrlCompactMultiplayerInviteMapName(
  params: URLSearchParams,
  options: QuakeUrlRouteOptions,
): string | null {
  const rawValue = params.get(QUAKE_URL_MULTIPLAYER_INVITE_PARAM)?.trim().toLowerCase();
  if (!rawValue || !QUAKE_URL_MULTIPLAYER_INVITE_ID_PATTERN.test(rawValue)) return null;
  const mapName = options.compactMultiplayerInviteMapName?.(rawValue)?.trim().toLowerCase() ?? "";
  return mapName && options.mapExists(mapName) ? mapName : null;
}

export function quakeUrlView(params: URLSearchParams): QuakeUrlView | null {
  const rawValue = params.get("view");
  if (!rawValue) return null;
  const parts = quakeUrlNumberParts(rawValue);
  if (parts.length !== QUAKE_URL_VIEW_PART_COUNT || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  if (parts.slice(0, 3).some((part) => Math.abs(part) > QUAKE_URL_VIEW_ORIGIN_LIMIT)) return null;
  if (parts[3] < QUAKE_URL_VIEW_PITCH_MIN || parts[3] > QUAKE_URL_VIEW_PITCH_MAX) return null;
  if (Math.abs(parts[4]) > QUAKE_URL_VIEW_ANGLE_LIMIT) return null;
  if (parts[5] !== undefined && Math.abs(parts[5]) > QUAKE_URL_VIEW_ANGLE_LIMIT) return null;
  const roll = parts[5];
  if (Math.abs(roll) > QUAKE_URL_VIEW_ROLL_EPSILON) return null;
  return {
    origin: [parts[0], parts[1], parts[2]],
    pitch: parts[3],
    yaw: normalizeQuakeUrlAngle(parts[4]),
    roll: 0,
  };
}

function quakeUrlNumberParts(rawValue: string): number[] {
  return rawValue.trim().split(/[,\s]+/).filter(Boolean).map((part) => Number(part));
}

export function normalizeQuakeUrlAngle(value: number): number {
  return (value % 360 + 360) % 360;
}

export function quakeUrlForMapView(href: string, mapName: string, view: QuakeUrlView | null = null): URL {
  const url = new URL(href);
  url.searchParams.set("map", mapName);
  if (view) {
    setQuakeUrlViewParam(url, quakeUrlViewValue(view));
  } else {
    url.searchParams.delete("view");
  }
  return url;
}

function setQuakeUrlViewParam(url: URL, value: string): void {
  url.searchParams.set("view", value);
  url.search = url.search.replace(/([?&]view=)[^&]*/, `$1${value}`);
}

function quakeUrlViewValue(view: QuakeUrlView): string {
  return [
    ...view.origin,
    view.pitch,
    view.yaw,
    view.roll,
  ].map(formatQuakeUrlNumber).join(",");
}

function formatQuakeUrlNumber(value: number): string {
  const rounded = Math.round(value * QUAKE_URL_NUMBER_SCALE) / QUAKE_URL_NUMBER_SCALE;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
