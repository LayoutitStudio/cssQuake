export const QUAKE_ALIAS_MODEL_RENDER_YAW_OFFSET = 180;

export function normalizeQuakeRenderYaw(yaw: number): number {
  return ((yaw % 360) + 360) % 360;
}

export function quakeAliasModelRenderYaw(yaw: number): number {
  return normalizeQuakeRenderYaw(yaw + QUAKE_ALIAS_MODEL_RENDER_YAW_OFFSET);
}
