import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "./importTsModule.mjs";

const {
  normalizeQuakeUrlAngle,
  parseQuakeUrlRouteFromLocation,
  quakeUrlForMapView,
  quakeUrlRouteIsDirect,
  quakeUrlRouteShouldNormalize,
  quakeUrlView,
} = await importTsModule("src/runtime/routeState.ts");

const mapExists = (mapName) => new Set(["start", "e1m1", "e1m5"]).has(mapName);
const compactMultiplayerInviteMapName = (inviteId) => inviteId === "01bcdfgh23" ? "e1m1" : null;

test("valid map routes normalize map names and enter direct gameplay", () => {
  const route = parseQuakeUrlRouteFromLocation({ search: "?map=E1M1" }, { mapExists, startMap: "start" });
  assert.equal(route.mapName, "e1m1");
  assert.equal(route.mapParamPresent, true);
  assert.equal(route.mapParamValid, true);
  assert.equal(route.compactMultiplayerInvitePresent, false);
  assert.equal(route.view, null);
  assert.equal(quakeUrlRouteIsDirect(route), true);
  assert.equal(quakeUrlRouteShouldNormalize(route), true);
});

test("invalid map routes fall back without applying a view", () => {
  const route = parseQuakeUrlRouteFromLocation(
    { search: "?map=bad&view=-576,192,184,0,90,0" },
    { mapExists, startMap: "start" },
  );
  assert.equal(route.mapName, "start");
  assert.equal(route.mapParamPresent, true);
  assert.equal(route.mapParamValid, false);
  assert.equal(route.compactMultiplayerInvitePresent, false);
  assert.equal(route.view, null);
  assert.equal(quakeUrlRouteIsDirect(route), false);
  assert.equal(quakeUrlRouteShouldNormalize(route), false);
});

test("view-only routes use the start map but still enter direct gameplay", () => {
  const route = parseQuakeUrlRouteFromLocation(
    { search: "?view=-576,192,184,0,-450,0" },
    { mapExists, startMap: "start" },
  );
  assert.equal(route.mapName, "start");
  assert.equal(route.mapParamPresent, false);
  assert.equal(route.mapParamValid, false);
  assert.equal(route.compactMultiplayerInvitePresent, false);
  assert.deepEqual(route.view, {
    origin: [-576, 192, 184],
    pitch: 0,
    yaw: 270,
    roll: 0,
  });
  assert.equal(quakeUrlRouteIsDirect(route), true);
  assert.equal(quakeUrlRouteShouldNormalize(route), true);
});

test("compact multiplayer invites route to their map without URL normalization", () => {
  const route = parseQuakeUrlRouteFromLocation(
    { search: "?room=01bcdfgh23" },
    { compactMultiplayerInviteMapName, mapExists, startMap: "start" },
  );
  assert.equal(route.mapName, "e1m1");
  assert.equal(route.mapParamPresent, true);
  assert.equal(route.mapParamValid, true);
  assert.equal(route.compactMultiplayerInvitePresent, true);
  assert.equal(route.view, null);
  assert.equal(quakeUrlRouteIsDirect(route), true);
  assert.equal(quakeUrlRouteShouldNormalize(route), false);
});

test("compact multiplayer invites reject map-prefixed ids", () => {
  const route = parseQuakeUrlRouteFromLocation(
    { search: "?room=e1m1-bcdfgh23" },
    { compactMultiplayerInviteMapName, mapExists, startMap: "start" },
  );
  assert.equal(route.mapName, "start");
  assert.equal(route.mapParamPresent, true);
  assert.equal(route.mapParamValid, false);
  assert.equal(route.compactMultiplayerInvitePresent, true);
  assert.equal(quakeUrlRouteIsDirect(route), false);
});

test("compact multiplayer invites reject token-only ids", () => {
  const route = parseQuakeUrlRouteFromLocation(
    { search: "?room=bcdfgh23" },
    { compactMultiplayerInviteMapName, mapExists, startMap: "start" },
  );
  assert.equal(route.mapName, "start");
  assert.equal(route.mapParamPresent, true);
  assert.equal(route.mapParamValid, false);
  assert.equal(route.compactMultiplayerInvitePresent, true);
  assert.equal(quakeUrlRouteIsDirect(route), false);
});

test("Quake-native view parsing rejects unsupported shapes", () => {
  assert.equal(quakeUrlView(new URLSearchParams("view=-576,192,184,0,90")), null);
  assert.equal(quakeUrlView(new URLSearchParams("view=-576,192,184,0,90,1")), null);
  assert.equal(quakeUrlView(new URLSearchParams("view=100001,192,184,0,90,0")), null);
  assert.equal(quakeUrlView(new URLSearchParams("view=-576,192,184,91,90,0")), null);
  assert.equal(quakeUrlView(new URLSearchParams("view=-576,192,184,0,36001,0")), null);
  assert.equal(quakeUrlView(new URLSearchParams("view=-576_192_184_0_90_0")), null);
});

test("URL view formatting is stable and keeps unrelated params", () => {
  const url = quakeUrlForMapView("https://cssquake.test/?debug=1&view=old", "e1m5", {
    origin: [-576.0004, 192, -0],
    pitch: 0,
    yaw: 450,
    roll: 0,
  });
  assert.equal(url.searchParams.get("debug"), "1");
  assert.equal(url.searchParams.get("map"), "e1m5");
  assert.equal(url.searchParams.get("view"), "-576,192,0,0,450,0");
  assert.equal(url.href, "https://cssquake.test/?debug=1&view=-576,192,0,0,450,0&map=e1m5");
});

test("URL helper removes stale view when only a map is requested", () => {
  const url = quakeUrlForMapView("https://cssquake.test/?debug=1&view=-1,2,3,4,5,0", "start", null);
  assert.equal(url.searchParams.get("debug"), "1");
  assert.equal(url.searchParams.get("map"), "start");
  assert.equal(url.searchParams.has("view"), false);
});

test("angle normalization wraps into Quake URL range", () => {
  assert.equal(normalizeQuakeUrlAngle(0), 0);
  assert.equal(normalizeQuakeUrlAngle(360), 0);
  assert.equal(normalizeQuakeUrlAngle(-90), 270);
  assert.equal(normalizeQuakeUrlAngle(810), 90);
});
