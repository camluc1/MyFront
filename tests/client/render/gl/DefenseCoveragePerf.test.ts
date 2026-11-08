import { describe, expect, it, vi } from "vitest";
import { DefenseCoveragePass } from "../../../../src/client/render/gl/passes/DefenseCoveragePass";

describe("Defense coverage incremental updates", () => {
  it("does not upload or re-stamp an unchanged defense/castle list", () => {
    const pass = Object.create(DefenseCoveragePass.prototype) as any;
    const ensureCapacity = vi.fn();
    pass.settings = { mapOverlay: { defensePostRange: 30 } };
    pass.instanceBuf = {
      float32: new Float32Array([30, 40, 1, 30, 90, 50, 1, 60]),
      buffer: {},
      ensureCapacity,
    };
    pass.count = 2;
    pass.fullDirty = false;
    const same = [
      { x: 30, y: 40, ownerID: 1 },
      { x: 90, y: 50, ownerID: 1, range: 60 },
    ];
    pass.updateDefensePosts(same);
    expect(pass.fullDirty).toBe(false);
    expect(ensureCapacity).not.toHaveBeenCalled();

    const bufferSubData = vi.fn();
    pass.gl = { ARRAY_BUFFER: 34962, bindBuffer: vi.fn(), bufferSubData };
    pass.updateDefensePosts([
      same[0],
      { x: 90, y: 50, ownerID: 2, range: 60 },
    ]);
    expect(pass.fullDirty).toBe(true);
    expect(bufferSubData).toHaveBeenCalledTimes(1);
  });

  it("still initializes a cleared coverage map with no buildings", () => {
    const pass = Object.create(DefenseCoveragePass.prototype) as any;
    pass.settings = { mapOverlay: { defensePostRange: 30 } };
    pass.instanceBuf = { float32: new Float32Array(4), ensureCapacity: vi.fn() };
    pass.count = 0;
    pass.fullDirty = true;
    pass.updateDefensePosts([]);
    expect(pass.fullDirty).toBe(true);
  });
});
