import {
  PlayerBuildableUnitType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";

/**
 * Single source of truth for build hotkeys in every game mode.
 * The bindings themselves live in UserSettings and remain user-editable.
 */
export const BUILD_KEYBIND_ACTIONS: ReadonlyArray<{
  action: string;
  type: PlayerBuildableUnitType;
}> = [
  { action: "buildCity", type: UnitType.City },
  { action: "buildFactory", type: UnitType.Factory },
  { action: "buildPort", type: UnitType.Port },
  { action: "buildShipyard", type: UnitType.Shipyard },
  { action: "buildDefensePost", type: UnitType.DefensePost },
  { action: "buildCastle", type: UnitType.Castle },
  { action: "buildIronDome", type: UnitType.IronDome },
  { action: "buildMissileSilo", type: UnitType.MissileSilo },
  { action: "buildSamLauncher", type: UnitType.SAMLauncher },
  { action: "buildWarship", type: UnitType.Warship },
  { action: "buildBismarck", type: UnitType.Bismarck },
  { action: "buildAtomBomb", type: UnitType.AtomBomb },
  { action: "buildHydrogenBomb", type: UnitType.HydrogenBomb },
  { action: "buildTsarBomba", type: UnitType.TsarBomba },
  { action: "buildMIRV", type: UnitType.MIRV },
  { action: "buildFarm", type: UnitType.Farm },
  { action: "buildMine", type: UnitType.Mine },
  { action: "buildOilWell", type: UnitType.OilWell },
  { action: "buildGasPlant", type: UnitType.GasPlant },
];

export function buildActionForUnit(
  type: PlayerBuildableUnitType,
): string | undefined {
  return BUILD_KEYBIND_ACTIONS.find((entry) => entry.type === type)?.action;
}
