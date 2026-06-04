import { defineConfig } from "vite";
import { rm } from "node:fs/promises";
import path from "node:path";

export default defineConfig({
  plugins: [
    {
      name: "cssquake-omit-build-source-archive",
      async closeBundle() {
        await rm(path.resolve("dist/quake/resource.1"), { force: true });
        await rm(path.resolve("dist/quake"), { recursive: true, force: true });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
  },
});
