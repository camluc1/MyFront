import { UnitType } from "@openfront/engine-api/game/GameTypes";
import type { NaturalResource } from "./NaturalResources";

export const RESOURCE_MAX_LEVEL = 50;

export function resourceMatchesBuilding(
  type: UnitType,
  resource: NaturalResource,
): boolean {
  switch (type) {
    case UnitType.Farm:
      return resource === "fertile_soil";
    case UnitType.OilWell:
      return resource === "oil";
    case UnitType.GasPlant:
      return resource === "gas";
    case UnitType.Mine:
      return (
        resource !== "fertile_soil" && resource !== "oil" && resource !== "gas"
      );
    default:
      return false;
  }
}

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
      (1 + (Math.min(RESOURCE_MAX_LEVEL, Math.max(1, level)) - 1) * 0.3) *
      railwayMultiplier *
      goldMultiplier,
  );
}
