import { PlayerBuildableUnitType } from "@openfront/engine-api/game/GameTypes";

export interface UIState {
  preventStacking?: boolean;
  attackRatio: number;
  ghostStructure: PlayerBuildableUnitType | null;
  /** Selection-only Geopolitics logistics variant of a warship. */
  supportShipMode?: boolean;
  rocketDirectionUp: boolean;
  upgradeMultiplier: number;
}
