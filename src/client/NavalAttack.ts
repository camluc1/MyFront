import { type BuildableUnit, UnitType } from "@openfront/engine-api/game/GameTypes";

/**
 * Auto-naval attack eligibility for an ordinary map click.
 * Actual landing/path/boat-cap checks are performed by Player.actions(),
 * which supplies BuildableUnit.canBuild. There must be NO arbitrary
 * world-distance cutoff: an ocean route can be thousands of tiles long.
 */
export function canAutoBoatAttack(
  isLand: boolean,
  buildables: readonly BuildableUnit[],
): boolean {
  return isLand && buildables.some(
    (unit) => unit.type === UnitType.TransportShip && unit.canBuild !== false,
  );
}
