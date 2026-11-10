/** Shared castle defense rules for both simulation and UI. */
export const CASTLE_DEFENSE_COST = 150_000n;
export const CASTLE_DEFENSE_ACTIVE_TICKS = 600; // 60 simulation seconds
export const CASTLE_DEFENSE_RECOVERY_TICKS = 1_200; // 120 seconds after activation ends
export const CASTLE_DEFENSE_LOSS_MULTIPLIER = 1.35;
export const CASTLE_DEFENSE_TIME_MULTIPLIER = 1.25;

export interface CastleDefenseState {
  activeUntilTick: number;
  cooldownUntilTick: number;
}
export type CastleDefenseMode = "normal" | "fortified" | "recovery";
export function castleDefenseMode(tick: number, state: CastleDefenseState): CastleDefenseMode {
  if (tick < state.activeUntilTick) return "fortified";
  if (tick < state.cooldownUntilTick) return "recovery";
  return "normal";
}
