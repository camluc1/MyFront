import { describe, expect, it, vi } from "vitest";
import { UnitPass } from "../../../../src/client/render/gl/passes/UnitPass";
import defaults from "../../../../src/client/render/gl/render-settings.json";
import { buildSailingRoute } from "../../../../src/client/render/gl/utils/SailingRoute";
import type { UnitState } from "../../../../src/client/render/types";

function harness(count: number) {
  const bytes = new ArrayBuffer(count * 16);
  const bufferSubData = vi.fn();
  const pass = Object.create(UnitPass.prototype) as UnitPass;
  Object.assign(pass, {
    gl: { ARRAY_BUFFER: 34962, bindBuffer: vi.fn(), bufferSubData },
    mapW: 1000,
    settings: defaults,
    lastGameTick: 0,
    smoothSegs: [],
    motions: new Map(),
    groundMotions: [],
    tickIntervalMs: 100,
    typeToAtlasCol: new Map([
      ["Transport", 0],
      ["Trade Ship", 1],
      ["Warship", 2],
    ]),
    groundBuf: {
      ensureCapacity: vi.fn(),
      float32: new Float32Array(bytes),
      uint8: new Uint8Array(bytes),
      buffer: {},
    },
    missileBuf: {},
    localPlayerID: 0,
  });
  return { pass, bytes: new Uint8Array(bytes), bufferSubData };
}
function ship(pos: number, lastPos: number): UnitState {
  return {
    isActive: true,
    waitTicks: 0,
    unitType: "Transport",
    ownerID: 1,
    pos,
    lastPos,
    targetUnitId: null,
  } as UnitState;
}

describe("directional fleet batches", () => {
  it("packs heading and movement without growing the 16-byte instance", () => {
    const h = harness(1);
    const units = new Map([[1, ship(2000, 1000)]]);
    h.pass.updateUnits(units, 1);
    expect(h.bytes[14]).toBe(0);
    expect(h.bytes[15]).toBe(64); // south: quarter turn
    units.set(1, ship(2000, 2000));
    h.pass.updateUnits(units, 2);
    // Heading is retained while the visual trajectory finishes settling.
    expect(h.bytes[15]).toBe(64); // retain heading
    units.clear();
    h.pass.updateUnits(units, 3);
    expect((h.pass as any).motions.size).toBe(0);
  });
  it("renders the Portabuques as its own support-carrier class in the same fleet instance", () => {
    const h = harness(2);
    const support = { ...ship(2000, 2000), unitType: "Warship", supportShip: true } as UnitState;
    const ordinary = { ...ship(2001, 2001), unitType: "Warship", supportShip: false } as UnitState;
    h.pass.updateUnits(new Map([[1, support], [2, ordinary]]), 1);
    expect(h.bytes[12]).toBe(2); // Warship atlas, no new network sprite.
    expect(h.bytes[13]).toBe(7); // Distinct carrier shader branch.
    expect(h.bytes[28]).toBe(2);
    expect(h.bytes[29]).toBe(0); // Ordinary warship still uses its original appearance.
    expect(h.bufferSubData).toHaveBeenCalledTimes(1);
  });

  it("uploads ten thousand ships in a single ground buffer update", () => {
    const h = harness(10000);
    const units = new Map(
      Array.from({ length: 10000 }, (_, id) => [
        id,
        ship(1001 + id, 1000 + id),
      ]),
    );
    h.pass.updateUnits(units, 1);
    expect(h.bufferSubData).toHaveBeenCalledOnce();
    expect(h.bufferSubData.mock.calls[0][4]).toBe(40000);
    expect(h.bytes.byteLength).toBe(160000);
  });
  it("uses track motion and suppresses wakes for train carriages", () => {
    const h = harness(1);
    const carriage = {
      ...ship(1002, 1000),
      unitType: "Train",
      trainType: 2,
      loaded: true,
    } as UnitState;
    h.pass.updateUnits(new Map([[1, carriage]]), 1);
    expect((h.pass as any).motions.get(1).constructor.name).toBe("RailMotion");
    expect(h.bytes[12]).toBe(11);
    expect(h.bytes[14]).toBe(0);
  });
});

it("uses the supplied navigation centerline in the actual fleet buffer", () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(200);
  try {
    const h = harness(1);
    const state = ship(1001, 1);
    state.sailingRoute = buildSailingRoute(
      {
        planId: 1,
        startTick: 0,
        ticksPerStep: 1,
        path: Uint32Array.from([0, 1, 1001, 1002, 2002]),
      },
      1000,
      () => true,
    );
    h.pass.updateUnits(new Map([[1, state]]), 2);
    clock.mockReturnValue(250);
    (h.pass as any).applyGroundSmoothing();
    const f = new Float32Array(h.bytes.buffer);
    expect(f[0]).toBeCloseTo(1.25);
    expect(f[1]).toBeCloseTo(1.25);
    expect(h.bytes[15]).toBe(32);
  } finally {
    clock.mockRestore();
  }
});
