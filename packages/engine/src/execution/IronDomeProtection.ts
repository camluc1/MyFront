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
  return game.config().gameConfig().geopolitics === true &&
    game.hasUnitNearby(
      tile,
      game.config().ironDomeRange(),
      UnitType.IronDome,
      owner.id(),
    );
}
