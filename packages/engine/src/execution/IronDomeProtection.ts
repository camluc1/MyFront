/**
 * Deterministic, same-owner anti-nuclear coverage for offline Geopolitics.
 * The spatial unit grid filters out inactive and under-construction domes.
 * A dome is passive: no ammo, reload, scheduled execution or per-tick scan.
 *
 * Test the owner of each protected tile/unit, not just the strike center.
 * This prevents the outside edge of an atomic/hydrogen/MIRV explosion from
 * bypassing a shield whose origin is outside the incoming blast.
 */
import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { Game, Player } from "../game/Game";

export function protectedByIronDome(
  game: Game,
  tile: TileRef,
  owner: Player,
): boolean {
  if (game.config().gameConfig().geopolitics !== true) return false;
  const config = game.config();
  return game.anyUnitNearby(
    tile, Math.ceil(config.maxSamRange() * 1.2), [UnitType.IronDome],
    (unit) => game.euclideanDistSquared(tile, unit.tile()) <=
      config.ironDomeRange(unit.level()) ** 2,
    owner.id(),
  );
}

/**
 * Build one immutable blast-local coverage view. Calling hasUnitNearby() once
 * for every destroyed tile can scan several 100-tile grid buckets thousands
 * of times during a hydrogen strike. Instead snapshot active domes just once
 * when a blast starts; normal projectile checks retain the fast grid query.
 */
export function createBlastIronDomeCoverage(
  game: Game,
): (tile: TileRef, owner: Player) => boolean {
  if (game.config().gameConfig().geopolitics !== true ||
      game.unitCount(UnitType.IronDome) === 0) {
    return () => false;
  }
  const domes = new Map<number, { x: number; y: number; rangeSq: number }[]>();
  for (const dome of game.units(UnitType.IronDome)) {
    if (!dome.isActive() || dome.isUnderConstruction()) continue;
    const id = dome.owner().smallID();
    const arr = domes.get(id);
    const pos = {
      x: game.x(dome.tile()),
      y: game.y(dome.tile()),
      rangeSq: game.config().ironDomeRange(dome.level()) ** 2,
    };
    if (arr) arr.push(pos);
    else domes.set(id, [pos]);
  }
  return (tile: TileRef, owner: Player): boolean => {
    const entries = domes.get(owner.smallID());
    if (!entries) return false;
    const x = game.x(tile), y = game.y(tile);
    for (const dome of entries) {
      const dx = x - dome.x, dy = y - dome.y;
      if (dx * dx + dy * dy <= dome.rangeSq) return true;
    }
    return false;
  };
}
