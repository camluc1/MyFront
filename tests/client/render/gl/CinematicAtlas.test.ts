import { describe, expect, it } from "vitest";
import mushroom from "../../../../resources/sprites/cinematic-nuke-atlas.svg?raw";
import impact from "../../../../resources/sprites/cinematic-impact-atlas.svg?raw";

describe("new cinematic blast artwork", () => {
  for (const [name, svg] of [["mushroom", mushroom],["impact", impact]] as const) {
    it(`${name}: contains 16 transparent 256px cells in one reusable 1024px atlas`, () => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      expect(doc.querySelector("parsererror")).toBeNull();
      const root = doc.documentElement;
      expect(root.tagName.toLowerCase()).toBe("svg");
      expect(root.getAttribute("width")).toBe("1024");
      expect(root.getAttribute("height")).toBe("1024");
      const frames = [...root.querySelectorAll("svg")];
      expect(frames).toHaveLength(16);
      for (let i = 0; i < 16; i++) {
        expect(frames[i].getAttribute("x")).toBe(String(i % 4 * 256));
        expect(frames[i].getAttribute("y")).toBe(String(Math.floor(i / 4) * 256));
        expect(frames[i].getAttribute("width")).toBe("256");
        expect(frames[i].getAttribute("height")).toBe("256");
      }
      expect(svg).not.toMatch(/<script|<image|https?:\/\//i);
    });
  }
});
