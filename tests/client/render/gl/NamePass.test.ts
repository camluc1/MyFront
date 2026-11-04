import { describe, expect, it, vi } from "vitest";
import { NamePass } from "../../../../src/client/render/gl/passes/name-pass";
import { FlagAtlasArray } from "../../../../src/client/render/gl/passes/name-pass/FlagAtlasArray";
import {
  projectName,
  selectNames,
  type VisibleName,
} from "../../../../src/client/render/gl/passes/name-pass/NameVisibility";
import type { PlayerSlot } from "../../../../src/client/render/gl/passes/name-pass/Types";
import { SkinAtlasArray } from "../../../../src/client/render/gl/passes/SkinAtlasArray";
import settings from "../../../../src/client/render/gl/render-settings.json";
import { PlayerTypeEnum } from "../../../../src/client/render/types";

const camera = new Float32Array([0.01, 0, 0, 0, -0.01, 0, -1, 1, 1]);
function slot(index = 0, x = 100, size = 10): PlayerSlot {
  return {
    index,
    alive: true,
    nameLen: 8,
    nameHalfWidth: 50,
    troopHalfWidth: 30,
    startTime: 0,
    srcX: x,
    tgtX: x,
    srcY: 100,
    tgtY: 100,
    srcScale: size,
    tgtScale: size,
    flagLayerIdx: -1,
    emojiAtlasIdx: -1,
    static: { smallID: index + 1, playerType: PlayerTypeEnum.Nation },
  } as PlayerSlot;
}
function project(s: PlayerSlot, highlight = 0) {
  return projectName(
    s,
    camera,
    1000,
    1000,
    1,
    settings.name,
    32,
    32,
    highlight,
  );
}

describe("Name visibility", () => {
  it("culls dead, off-screen and tiny labels, but reveals the hovered nation", () => {
    expect(project({ ...slot(), alive: false })).toBeNull();
    expect(project(slot(0, 10000))).toBeNull();
    expect(project(slot(0, 100, 1))).toBeNull();
    expect(project(slot(0, 100, 1), 1)).not.toBeNull();
  });
  it("uses CSS pixels independently of canvas resolution", () => {
    const item = project(slot())!;
    expect(item.boost).toBeGreaterThan(0);
    expect(item.score * item.boost).toBeLessThanOrEqual(26);
    expect(
      projectName(slot(), camera, 1000, 500, 1, settings.name, 32, 32, 0)!
        .boost,
    ).toBeGreaterThan(item.boost);
  });
  it("reserves the hovered label before larger overlapping nations", () => {
    const ordinary = project(slot(0, 100, 30))!;
    const hovered = project(slot(1, 100, 5), 2)!;
    expect(
      selectNames([ordinary, hovered], 1000, 1000, new Set()).map(
        (x) => x.slot.index,
      ),
    ).toEqual([1]);
  });
  it("limits a crowded world view without overlaps and is deterministic", () => {
    const candidates: VisibleName[] = [];
    for (let i = 0; i < 2000; i++) {
      const item = project(slot(i))!;
      const x = (i % 50) * 22,
        y = Math.floor(i / 50) * 22;
      candidates.push({
        ...item,
        left: x,
        right: x + 40,
        top: y,
        bottom: y + 20,
      });
    }
    const selected = selectNames(candidates, 1000, 1000, new Set());
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(55);
    for (let i = 0; i < selected.length; i++)
      for (let j = i + 1; j < selected.length; j++) {
        const a = selected[i],
          b = selected[j];
        expect(
          a.left < b.right &&
            a.right > b.left &&
            a.top < b.bottom &&
            a.bottom > b.top,
        ).toBe(false);
      }
    expect(
      selectNames([...candidates].reverse(), 1000, 1000, new Set()).map(
        (x) => x.slot.index,
      ),
    ).toEqual(selected.map((x) => x.slot.index));
  });
  it("packs only visible players while preserving their original text rows", () => {
    const visible = slot(700);
    const gl = {
      drawingBufferWidth: 1000,
      drawingBufferHeight: 1000,
      bindTexture: vi.fn(),
      texSubImage2D: vi.fn(),
    };
    const data = new Float32Array(1024 * 36);
    data[700 * 36 + 35] = 700;
    const pass = Object.assign(Object.create(NamePass.prototype), {
      gl,
      slots: new Map([
        ["visible", visible],
        ["off", slot(3, 10000)],
      ]),
      settings,
      fontSize: 32,
      fontBase: 32,
      highlightOwnerID: 0,
      visibleIndices: new Set(),
      lastLayoutTime: -Infinity,
      cpuPlayerData: data,
      packedPlayerData: new Float32Array(data.length),
    }) as any;
    pass.updateVisibleNames(camera, 1);
    expect(pass.visibleNames).toHaveLength(1);
    const uploaded = gl.texSubImage2D.mock.calls[0];
    expect(uploaded[5]).toBe(1);
    expect(uploaded[8][35]).toBe(700);
    expect(uploaded[8][7]).toBeCloseTo(pass.visibleNames[0].boost);
    pass.setMouseWorldPos(100, 100);
    expect(pass.hitTestNamePlate()).toBe(701);
    pass.setMouseWorldPos(10000, 100);
    expect(pass.hitTestNamePlate()).toBe(0);
  });
  it("submits the selected count to text and all icon programs", () => {
    const text = vi.fn(),
      icons = vi.fn(),
      status = vi.fn(),
      debug = vi.fn();
    const pass = Object.assign(Object.create(NamePass.prototype), {
      settings: {
        ...settings,
        passEnabled: { ...settings.passEnabled, nameDebug: true },
      },
      slots: new Map([["p", slot()]]),
      visibleNames: [project(slot())!],
      updateVisibleNames: vi.fn(),
      hitTestNamePlate: () => 1,
      textProgram: { ready: true, draw: text },
      iconProgram: { draw: icons },
      statusIconProgram: { draw: status },
      debugProgram: { draw: debug },
      highlightOwnerID: 1,
      stringDataDirty: false,
      cursorDataDirty: false,
    }) as any;
    pass.draw(camera, 1);
    expect(text.mock.calls[0][3]).toBe(1);
    expect(icons.mock.calls[0][4]).toBe(1);
    expect(status.mock.calls[0][4]).toBe(1);
    expect(debug.mock.calls[0][3]).toBe(1);
  });
});

describe("FlagAtlasArray disposal", () => {
  it("guards against upload and callbacks when disposed while image is loading", () => {
    let deleted = false;
    const fakeGl: any = {
      MAX_ARRAY_TEXTURE_LAYERS: 256,
      TEXTURE_2D_ARRAY: 0x8c1a,
      RGBA8: 0x8058,
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      getParameter: () => 256,
      createTexture: () => ({}),
      deleteTexture: () => (deleted = true),
      bindTexture: () => {},
      texStorage3D: () => {},
      texParameteri: () => {},
      texSubImage3D: vi.fn(),
      generateMipmap: vi.fn(),
    };
    let onReady = false;
    const atlas = new FlagAtlasArray(fakeGl, () => (onReady = true));
    let onload: (() => void) | undefined;
    vi.stubGlobal(
      "Image",
      class {
        width = 32;
        height = 32;
        set onload(fn: () => void) {
          onload = fn;
        }
      },
    );
    atlas.request("http://example.com/flag.png");
    atlas.dispose();
    expect(deleted).toBe(true);
    onload?.();
    expect(fakeGl.texSubImage3D).not.toHaveBeenCalled();
    expect(onReady).toBe(false);
  });
});

describe("SkinAtlasArray", () => {
  it("reuses scratch canvas across uploads", () => {
    const sub = vi.fn();
    const gl: any = new Proxy(
      { createTexture: () => ({}), texSubImage3D: sub },
      { get: (t: any, k: string) => t[k] ?? (() => {}) },
    );
    let canvasCount = 0;
    const orig = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((t) => {
      if (t === "canvas") canvasCount++;
      return orig(t);
    });
    const atlas = new SkinAtlasArray(gl, [], () => {});
    const img = document.createElement("img");
    for (let i = 0; i < 2; i++) (atlas as any).uploadImage(img, i);
    expect(canvasCount).toBe(1);
    expect(sub).toHaveBeenCalledTimes(2);
    atlas.dispose();
  });
});
