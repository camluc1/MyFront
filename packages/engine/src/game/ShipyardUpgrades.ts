import type { ShipyardTrack } from "@openfront/engine-api/game/Shipyard";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import type { Player } from "./Game";

/** Highest operational research level by track; shipyards never stack. */
export function shipyardLevel(owner: Player, track: ShipyardTrack): number {
  let level = 0;
  for (const unit of owner.units(UnitType.Shipyard)) {
    if (!unit.isActive() || unit.isUnderConstruction()) continue;
    level = Math.max(level, unit.shipyardLevels()?.[track] ?? 0);
  }
  return level;
}
