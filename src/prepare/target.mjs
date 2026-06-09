import { spawn } from "node:child_process";

const mode = process.argv[2];
const targets = process.argv
  .slice(3)
  .flatMap((value) => String(value).split(","))
  .map((value) => value.trim())
  .filter(Boolean);

if (!["map", "model"].includes(mode) || targets.length === 0) {
  console.error(
    "Usage: pnpm prepare:quake:map <map...> or pnpm prepare:quake:model <model...>",
  );
  process.exit(1);
}

const env = {
  ...process.env,
  ...(mode === "map"
    ? {
        QUAKE_PREPARE_MAP_ONLY: "1",
        QUAKE_RENDER_BUNDLE_MAPS: targets.join(","),
      }
    : {
        QUAKE_PREPARE_ONLY: "models",
        QUAKE_PREPARE_MODEL_ONLY: targets.join(","),
      }),
};

const child = spawn(process.execPath, ["src/prepare/assets.mjs"], {
  env,
  stdio: "inherit",
});

child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
