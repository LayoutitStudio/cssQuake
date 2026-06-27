import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const invite = await importTsModule("src/runtime/multiplayer/invite.ts");
const region = await importTsModule("src/runtime/multiplayer/region.ts");
const routeState = await importTsModule("src/runtime/routeState.ts");

test("multiplayer region helpers expose only the launch-safe auto region", () => {
  assert.equal(region.normalizeQuakeMultiplayerRegion("auto"), "auto");
  assert.equal(region.normalizeQuakeMultiplayerRegion("sa"), "auto");
  assert.equal(region.normalizeQuakeMultiplayerRegion(" APAC "), "auto");
  assert.equal(region.normalizeQuakeMultiplayerRegion("mars"), "auto");
  assert.equal(region.quakeMultiplayerRegionLabel("auto"), "Auto");
  assert.equal(region.quakeMultiplayerRegionInviteCode("auto"), "au");
  assert.equal(region.quakeMultiplayerRegionFromInviteCode("au"), "auto");
  assert.equal(region.quakeMultiplayerRegionFromInviteCode("sa"), null);
});

test("compact multiplayer invites require the auto suffix in the room token", () => {
  assert.deepEqual(invite.parseQuakeMultiplayerCompactInviteParts("01bcdfghjkau"), {
    mapCode: "01",
    token: "bcdfghjk",
    region: "auto",
  });
  assert.equal(invite.parseQuakeMultiplayerCompactInviteParts("01bcdfghjk"), null);
  assert.equal(invite.parseQuakeMultiplayerCompactInviteParts("01bcdfghjksa"), null);
  assert.equal(invite.parseQuakeMultiplayerCompactInviteParts("01bcdfghjkap"), null);
  assert.equal(invite.parseQuakeMultiplayerCompactInviteParts("sa-01bcdfghjk"), null);
  assert.equal(invite.parseQuakeMultiplayerCompactInviteParts("moon-01bcdfghjk"), null);
});

test("compact multiplayer invite values always encode auto in the room string", () => {
  assert.equal(
    invite.createQuakeMultiplayerCompactInviteValue("01", "bcdfghjk"),
    "01bcdfghjkau",
  );
  assert.equal(invite.createQuakeMultiplayerCompactInviteValue("bad", "bcdfghjk"), null);
});

test("multiplayer room ids always use the auto namespace", () => {
  assert.equal(
    invite.createQuakeMultiplayerRoomIdFromToken("e1m1", "bcdfghjk"),
    "cssquake-auto-e1m1-bcdfghjk",
  );
});

test("compact multiplayer invite routes use the encoded map after region suffixes", () => {
  const route = routeState.parseQuakeUrlRouteFromLocation(
    { search: "?room=06bcdfghjkau" },
    {
      compactMultiplayerInviteMapName: (inviteId) => inviteId === "06bcdfghjkau" ? "e1m7" : null,
      mapExists: (mapName) => mapName === "e1m1" || mapName === "e1m7",
      startMap: "e1m1",
    },
  );
  assert.equal(route.mapName, "e1m7");
  assert.equal(route.mapParamPresent, true);
  assert.equal(route.mapParamValid, true);
  assert.equal(route.compactMultiplayerInvitePresent, true);
});

test("map view urls drop compact multiplayer room params", () => {
  const url = routeState.quakeUrlForMapView(
    "https://quake.example/play?room=06bcdfghjkau&map=e1m7&view=1,2,3,4,5,0",
    "e1m1",
  );
  assert.equal(url.searchParams.get("room"), null);
  assert.equal(url.searchParams.get("map"), "e1m1");
  assert.equal(url.searchParams.get("view"), null);
});
