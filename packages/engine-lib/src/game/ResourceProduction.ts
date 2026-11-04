import type { NaturalResource } from "./NaturalResources";

export const RESOURCE_BASE_GOLD: Record<NaturalResource, number> = {
  fertile_soil: 11500,
  oil: 22000,
  gas: 17500,
  coal: 9000,
  gold: 19000,
  silver: 15000,
  copper: 12000,
  iron: 9000,
  lithium: 16500,
  uranium: 18500,
};
/** Gold per ten-second production cycle, shared by execution and UI queries. */
export function resourceProduction(
  resource: NaturalResource,
  quality: number,
  level: number,
  railwayMultiplier: number,
  goldMultiplier: number,
): number {
  return Math.floor(
    RESOURCE_BASE_GOLD[resource] *
      (0.75 + quality * 0.25) *
      (1 + (Math.min(50, Math.max(1, level)) - 1) * 0.3) *
      railwayMultiplier *
      goldMultiplier,
  );
}
