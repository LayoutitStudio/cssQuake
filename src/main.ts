import "./quake.css";
import { mountQuakeBitmapText } from "./runtime/bitmapText";

const params = new URLSearchParams(window.location.search);
if (params.has("map") || params.has("view")) {
  document.body.classList.remove("quake-menu-open");
  document.body.classList.add("quake-main-menu-deferred");
}

await import("./App");

mountQuakeBitmapText();
