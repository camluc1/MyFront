/**
 * Cosmetic-only weapon launch detection. Does not simulate firing or affect
 * positions. Launch FX are produced by real newly observed units, not timers.
 * A 16-tile bucket lookup keeps naval attribution bounded even with large fleets.
 */
import type { UnitState } from "../../types";
import { UT_SAM_MISSILE, UT_SHELL, UT_WARSHIP } from "../../types";

export type WeaponLaunchVisual = { x: number; y: number; kind: "sam" | "naval" };

const BUCKET_TILES = 16;
const MAX_MUZZLE_DISTANCE_SQ = 12 * 12;
const key = (owner: number, x: number, y: number) =>
  `${owner}:${x}:${y}`;

export function findNewWeaponLaunches(
  units: ReadonlyMap<number, UnitState>,
  previous: ReadonlySet<number>,
  historyReady: boolean,
  mapW: number,
  limit = 24,
): { launches: WeaponLaunchVisual[]; seen: Set<number> } {
  const seen = new Set<number>();
  const newcomers: UnitState[] = [];
  for (const unit of units.values()) {
    if (!unit.isActive || unit.waitTicks > 0) continue;
    if (unit.unitType !== UT_SAM_MISSILE && unit.unitType !== UT_SHELL)
      continue;
    seen.add(unit.id);
    if (historyReady && !previous.has(unit.id) && newcomers.length < limit)
      newcomers.push(unit);
  }
  if (!historyReady || newcomers.length === 0)
    return { launches: [], seen };

  // Build the lightweight spatial index only when actual new shells exist.
  const hasShell = newcomers.some((unit) => unit.unitType === UT_SHELL);
  const ships = new Map<string, UnitState[]>();
  if (hasShell) {
    for (const unit of units.values()) {
      if (!unit.isActive || unit.waitTicks > 0 || unit.unitType !== UT_WARSHIP)
        continue;
      const x = unit.pos % mapW;
      const y = Math.floor(unit.pos / mapW);
      const bucket = key(unit.ownerID, Math.floor(x / BUCKET_TILES),
        Math.floor(y / BUCKET_TILES));
      const list = ships.get(bucket);
      if (list) list.push(unit);
      else ships.set(bucket, [unit]);
    }
  }

  const launches: WeaponLaunchVisual[] = [];
  for (const unit of newcomers) {
    // The old position is the source side of this missile's first travel
    // segment. It is far more accurate than a guessed launcher midpoint.
    const source = unit.lastPos >= 0 ? unit.lastPos : unit.pos;
    const x = source % mapW;
    const y = Math.floor(source / mapW);
    if (unit.unitType === UT_SAM_MISSILE) {
      launches.push({ x, y, kind: "sam" });
      continue;
    }
    // Shells can originate elsewhere: emit a naval muzzle only when their
    // first observed position is close to a SAME-OWNER active warship.
    let nearest = MAX_MUZZLE_DISTANCE_SQ;
    let fromWarship = false;
    const cx = Math.floor(x / BUCKET_TILES);
    const cy = Math.floor(y / BUCKET_TILES);
    for (let ox = -1; ox <= 1; ox++)
      for (let oy = -1; oy <= 1; oy++) {
        const list = ships.get(key(unit.ownerID, cx + ox, cy + oy));
        if (!list) continue;
        for (const ship of list) {
          const sx = ship.pos % mapW;
          const sy = Math.floor(ship.pos / mapW);
          const distSq = (x - sx) ** 2 + (y - sy) ** 2;
          if (distSq <= nearest) {
            nearest = distSq;
            fromWarship = true;
          }
        }
      }
    if (fromWarship) launches.push({ x, y, kind: "naval" });
  }
  return { launches, seen };
}
