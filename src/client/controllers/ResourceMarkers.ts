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

/** Markers identify actual extraction sites. Deposit generation handles spacing;
 * moving a label to an empty grid cell can put it on water or another resource.
 */
export function layoutResourceMarkers(
  deposits: readonly ResourceDeposit[],
  width: number,
  height: number,
): ResourceMarker[] {
  if (!deposits.length || width <= 0 || height <= 0) return [];
  const baseRadius = Math.min(
    Math.max(3, Math.min(7, width / 320)),
    Math.min(width, height) / 4,
    Math.sqrt((width * height) / (deposits.length * 9)) / 2,
  );
  return deposits.map((deposit) => {
    // Tile centers match the footprints drawn by MapLayerController. Keep the
    // marker inside its own footprint and canvas, including at map edges.
    const x = deposit.x + 0.5;
    const y = deposit.y + 0.5;
    return {
      deposit,
      x,
      y,
      radius: Math.min(
        baseRadius,
        deposit.radius / 2,
        x,
        y,
        width - x,
        height - y,
      ),
    };
  });
}
