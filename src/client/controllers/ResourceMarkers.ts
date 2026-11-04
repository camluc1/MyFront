import type {
  NaturalResource,
  ResourceDeposit,
} from "@openfront/engine-lib/game/NaturalResources";

/** Chemical symbols remain readable without relying on color alone. */
export const RESOURCE_STYLE: Record<
  NaturalResource,
  { color: string; symbol: string }
> = {
  fertile_soil: { color: "#79d567", symbol: "AGR" },
  oil: { color: "#ad8458", symbol: "OIL" },
  gas: { color: "#42d9ed", symbol: "GAS" },
  coal: { color: "#788398", symbol: "C" },
  gold: { color: "#ffce42", symbol: "Au" },
  silver: { color: "#e6edf7", symbol: "Ag" },
  copper: { color: "#ed8b55", symbol: "Cu" },
  iron: { color: "#73a9de", symbol: "Fe" },
  lithium: { color: "#c58aff", symbol: "Li" },
  uranium: { color: "#c8ee47", symbol: "U" },
};
export interface ResourceMarker {
  deposit: ResourceDeposit;
  x: number;
  y: number;
  radius: number;
}

/** Visual layout only: deposits, extraction ranges and saved games stay unchanged.
 * Search outward on a lattice so even a dense cluster retains every marker.
 */
export function layoutResourceMarkers(
  deposits: readonly ResourceDeposit[],
  width: number,
  height: number,
): ResourceMarker[] {
  if (!deposits.length || width <= 0 || height <= 0) return [];
  const radius = Math.min(
    Math.max(3, Math.min(7, width / 320)),
    Math.min(width, height) / 4,
    Math.sqrt((width * height) / (deposits.length * 9)) / 2,
  );
  const step = radius * 2 + Math.min(2, radius / 2);
  const cols = Math.max(1, Math.floor((width - radius * 2) / step) + 1);
  const rows = Math.max(1, Math.floor((height - radius * 2) / step) + 1);
  const occupied = new Set<number>();
  const result: ResourceMarker[] = [];
  for (const deposit of deposits) {
    const cx = Math.max(
      0,
      Math.min(cols - 1, Math.round((deposit.x - radius) / step)),
    );
    const cy = Math.max(
      0,
      Math.min(rows - 1, Math.round((deposit.y - radius) / step)),
    );
    let found = false;
    const tryCell = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
      const key = y * cols + x;
      if (occupied.has(key)) return false;
      occupied.add(key);
      result.push({
        deposit,
        x: radius + x * step,
        y: radius + y * step,
        radius,
      });
      return true;
    };
    for (let ring = 0; ring < Math.max(cols, rows) && !found; ring++) {
      // Stable clockwise order keeps the layer identical after reload.
      for (let dx = -ring; dx <= ring && !found; dx++)
        found = tryCell(cx + dx, cy - ring);
      for (let dy = -ring + 1; dy <= ring && !found; dy++)
        found = tryCell(cx + ring, cy + dy);
      for (let dx = ring - 1; dx >= -ring && !found; dx--)
        found = tryCell(cx + dx, cy + ring);
      for (let dy = ring - 1; dy > -ring && !found; dy--)
        found = tryCell(cx - ring, cy + dy);
    }
    if (!found) throw new Error("Resource marker layout exhausted its grid");
  }
  return result;
}
