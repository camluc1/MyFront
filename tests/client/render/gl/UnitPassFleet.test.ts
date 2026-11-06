import { describe, expect, it, vi } from "vitest";
import { UnitPass } from "../../../../src/client/render/gl/passes/UnitPass";
import defaults from "../../../../src/client/render/gl/render-settings.json";
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
    expect(h.bytes[14]).toBe(255);
    expect(h.bytes[15]).toBe(64); // south: quarter turn
    units.set(1, ship(2000, 2000));
    h.pass.updateUnits(units, 2);
    // Wake decays instead of popping off at a stopped snapshot.
    expect(h.bytes[14]).toBe(255);
    expect(h.bytes[15]).toBe(64); // retain heading
    units.clear();
    h.pass.updateUnits(units, 3);
    expect((h.pass as any).motions.size).toBe(0);
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
});
