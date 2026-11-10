import { UnitType } from "./GameTypes";

/** Flight costs one fuel per map tile; time is expressed only in simulation ticks. */
export const AIRCRAFT_MAX_FUEL = 1_800;
export const AIRCRAFT_FUEL_RESERVE = 80;
export const AIRCRAFT_CRUISE_TILES_PER_TICK = 6;
export const AIRCRAFT_CARRIER_CAPACITY = 4;
export const AIRCRAFT_GROUND_STRIKE_TROOPS = 500_000;
export const AIRCRAFT_BOMBER_BOMBS = 5;
export const AIRCRAFT_BOMBER_TROOPS_PER_BOMB = 70_000;

export function isAircraftType(type: UnitType): type is
  | UnitType.AttackAircraft
  | UnitType.BomberAircraft
  | UnitType.FighterAircraft {
  return type === UnitType.AttackAircraft ||
    type === UnitType.BomberAircraft ||
    type === UnitType.FighterAircraft;
}
