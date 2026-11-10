/** Shipyard four-track, three-level experimental singleplayer research. */
export const SHIPYARD_TRACKS = [
  "merchantSpeed", "transportCapacity", "warshipHealth", "warshipDamage",
] as const;
export type ShipyardTrack = (typeof SHIPYARD_TRACKS)[number];
export type ShipyardLevels = Record<ShipyardTrack, number>;
export const SHIPYARD_MAX_LEVEL = 3;
export const emptyShipyardLevels = (): ShipyardLevels => ({
  merchantSpeed: 0, transportCapacity: 0, warshipHealth: 0, warshipDamage: 0,
});
export function shipyardUpgradePrice(level: number): bigint | null {
  return ([500_000n, 1_000_000n, 2_000_000n] as const)[level] ?? null;
}
export function shipyardLevelMultiplier(track: ShipyardTrack, level: number): number {
  const step = track === "warshipDamage" ? .10 : track === "merchantSpeed" ? .12 : .15;
  return 1 + step * Math.max(0, Math.min(SHIPYARD_MAX_LEVEL, level));
}
export function packShipyardLevels(levels: ShipyardLevels): number {
  return (levels.merchantSpeed & 3) | ((levels.transportCapacity & 3) << 2) |
    ((levels.warshipHealth & 3) << 4) | ((levels.warshipDamage & 3) << 6);
}
export function unpackShipyardLevels(packed: number): ShipyardLevels {
  return { merchantSpeed: packed & 3, transportCapacity: (packed >> 2) & 3,
    warshipHealth: (packed >> 4) & 3, warshipDamage: (packed >> 6) & 3 };
}
