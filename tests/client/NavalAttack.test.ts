import { describe, expect, it } from "vitest";
import { UnitType, type BuildableUnit } from "@openfront/engine-api/game/GameTypes";
import { canAutoBoatAttack } from "../../src/client/NavalAttack";

function boat(canBuild: number | false): BuildableUnit {
  return {
    type: UnitType.TransportShip,
    canBuild,
    canUpgrade: false,
    cost: 0n,
    overlappingRailroads: [],
    ghostRailPaths: [],
  };
}

describe("click-to-attack islands", () => {
  it("launches at a valid distant island even if the source is over 100 tiles away", () => {
    // Source ref can be far away: auto-boat may not use a distance threshold.
    expect(canAutoBoatAttack(true, [boat(99999)])).toBe(true);
  });
  it("does not launch when water routing or the ship limit rejects building", () => {
    expect(canAutoBoatAttack(true, [boat(false)])).toBe(false);
    expect(canAutoBoatAttack(true, [])).toBe(false);
  });
  it("does not launch from a click on ocean or for other buildables", () => {
    expect(canAutoBoatAttack(false, [boat(10)])).toBe(false);
    expect(canAutoBoatAttack(true, [{ ...boat(10), type: UnitType.Farm }])).toBe(false);
  });
});
