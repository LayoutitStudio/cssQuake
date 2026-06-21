import assert from "node:assert/strict";
import test from "node:test";

import { importTsModule } from "../importTsModule.mjs";

const invite = await importTsModule("src/runtime/multiplayer/invite.ts");
const region = await importTsModule("src/runtime/multiplayer/region.ts");
const routeState = await importTsModule("src/runtime/routeState.ts");

test("multiplayer regions normalize unknown values to auto", () => {
  assert.equal(region.normalizeQuakeMultiplayerRegion("sa"), "sa");
  assert.equal(region.normalizeQuakeMultiplayerRegion(" APAC "), "apac");
  assert.equal(region.normalizeQuakeMultiplayerRegion("mars"), "auto");
  assert.equal(region.quakeMultiplayerRegionLabel("eu"), "Europe");
  assert.equal(region.quakeMultiplayerRegionInviteCode("auto"), "au");
  assert.equal(region.quakeMultiplayerRegionFromInviteCode("ap"), "apac");
});

test("compact multiplayer invites require a region suffix in the room token", () => {
  assert.deepEqual(invite.parseQuakeMultiplayerCompactInviteParts("01bcdfghjksa"), {
    mapCode: "01",
    token: "bcdfghjk",
    region: "sa",
  });
  assert.deepEqual(invite.parseQuakeMultiplayerCompactInviteParts("01bcdfghjkau"), {
    mapCode: "01",
    token: "bcdfghjk",
    region: "auto",
  });
  assert.deepEqual(invite.parseQuakeMultiplayerCompactInviteParts("01bcdfghjkap"), {
    mapCode: "01",
    token: "bcdfghjk",
    region: "apac",
  });
  assert.equal(invite.parseQuakeMultiplayerCompactInviteParts("01bcdfghjk"), null);
  assert.equal(invite.parseQuakeMultiplayerCompactInviteParts("sa-01bcdfghjk"), null);
  assert.equal(invite.parseQuakeMultiplayerCompactInviteParts("moon-01bcdfghjk"), null);
});

test("compact multiplayer invite values encode region in the room string", () => {
  assert.equal(
    invite.createQuakeMultiplayerCompactInviteValue("01", "bcdfghjk", "auto"),
    "01bcdfghjkau",
  );
  assert.equal(
    invite.createQuakeMultiplayerCompactInviteValue("01", "bcdfghjk", "sa"),
    "01bcdfghjksa",
  );
  assert.equal(
    invite.createQuakeMultiplayerCompactInviteValue("01", "bcdfghjk", "apac"),
    "01bcdfghjkap",
  );
  assert.equal(invite.createQuakeMultiplayerCompactInviteValue("bad", "bcdfghjk", "sa"), null);
});

test("multiplayer room ids always include region", () => {
  assert.equal(
    invite.createQuakeMultiplayerRoomIdFromToken("e1m1", "bcdfghjk", "auto"),
    "cssquake-auto-e1m1-bcdfghjk",
  );
  assert.equal(
    invite.createQuakeMultiplayerRoomIdFromToken("e1m1", "bcdfghjk", "sa"),
    "cssquake-sa-e1m1-bcdfghjk",
  );
});

test("compact multiplayer invite routes use the encoded map after region suffixes", () => {
  const route = routeState.parseQuakeUrlRouteFromLocation(
    { search: "?room=06bcdfghjksa" },
    {
      compactMultiplayerInviteMapName: (inviteId) => inviteId === "06bcdfghjksa" ? "e1m7" : null,
      mapExists: (mapName) => mapName === "e1m1" || mapName === "e1m7",
      startMap: "e1m1",
    },
  );
  assert.equal(route.mapName, "e1m7");
  assert.equal(route.mapParamPresent, true);
  assert.equal(route.mapParamValid, true);
  assert.equal(route.compactMultiplayerInvitePresent, true);
});
