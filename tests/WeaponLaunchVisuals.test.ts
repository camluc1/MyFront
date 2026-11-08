import { describe, expect, it } from "vitest";
import { UT_SAM_MISSILE, UT_SHELL, UT_WARSHIP } from "../src/client/render/types";
import type { UnitState } from "../src/client/render/types";
import { findNewWeaponLaunches } from "../src/client/render/gl/utils/WeaponLaunchVisuals";

const width = 512;
const unit = (id: number, unitType: string, x: number, y: number,
  ownerID = 1, lx = x, ly = y): UnitState => ({
    id, unitType, pos: y * width + x, lastPos: ly * width + lx,
    ownerID, isActive: true, waitTicks: 0,
  }) as UnitState;

describe("cinematic weapon launch cosmetics", () => {
  it("never flashes all existing shells when joining or loading a save", () => {
    const units = new Map([[1, unit(1, UT_WARSHIP, 80, 90)],
      [2, unit(2, UT_SHELL, 82, 90)]]);
    const initial = findNewWeaponLaunches(units, new Set(), false, width);
    expect(initial.launches).toEqual([]);
    expect(findNewWeaponLaunches(units, initial.seen, true, width).launches)
      .toEqual([]);
  });

  it("emits only an actual new shell near a same-owner active warship", () => {
    const ships = new Map([[1, unit(1, UT_WARSHIP, 80, 90)],
      [2, unit(2, UT_WARSHIP, 210, 90, 3)],
      [3, unit(3, UT_SHELL, 82, 90, 1, 81, 90)],
      [4, unit(4, UT_SHELL, 212, 90, 1, 211, 90)]]);
    const events = findNewWeaponLaunches(ships, new Set(), true, width);
    expect(events.launches).toEqual([{ x: 81, y: 90, kind: "naval" }]);
    expect(findNewWeaponLaunches(ships, events.seen, true, width).launches)
      .toHaveLength(0);
  });

  it("renders SAM departures separately and honors the event budget", () => {
    const missiles = new Map<number, UnitState>();
    for (let i = 0; i < 60; i++)
      missiles.set(i, unit(i, UT_SAM_MISSILE, 40+i, 100));
    const result = findNewWeaponLaunches(missiles, new Set(), true, width, 12);
    expect(result.launches).toHaveLength(12);
    expect(result.launches.every((event) => event.kind === "sam")).toBe(true);
  });

  it("skips inactive and waiting projectiles", () => {
    const a = { ...unit(1, UT_SAM_MISSILE, 10, 10), waitTicks: 2 };
    const b = { ...unit(2, UT_SHELL, 20, 20), isActive: false };
    const units = new Map([[1, a], [2, b]]);
    expect(findNewWeaponLaunches(units, new Set(), true, width).launches)
      .toHaveLength(0);
  });
});
