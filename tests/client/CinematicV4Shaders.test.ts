import { describe, expect, it } from "vitest";
import { cinematicShaderSource } from "../../src/client/render/gl/EnhancedVisuals";
import ocean from "../../src/client/render/gl/shaders/terrain/terrain.frag.glsl?raw";
import hull from "../../src/client/render/gl/shaders/unit/unit.frag.glsl?raw";
import spriteVertex from "../../src/client/render/gl/shaders/fx/sprite.vert.glsl?raw";
import spriteFragment from "../../src/client/render/gl/shaders/fx/sprite.frag.glsl?raw";

describe("cinematic V4 visual policy", () => {
  const shaders = [ocean, hull, spriteVertex, spriteFragment];

  it("leaves all normal renderer sources byte-for-byte unchanged", () => {
    for (const source of shaders) {
      expect(cinematicShaderSource(source, false, false)).toBe(source);
      expect(source).toContain("FRONTIER_CINEMATIC_VARIANT");
    }
  });

  it("activates enhancements only in the optional cinematic path", () => {
    for (const source of shaders) {
      const variant = cinematicShaderSource(source, true, false);
      expect(variant).toContain("#define FRONTIER_CINEMATIC 1");
      expect(variant.startsWith("#version 300 es")).toBe(true);
    }
  });

  it("keeps water fully within the existing terrain shader", () => {
    expect(ocean).toContain("vec3 cinematicOcean");
    expect(ocean).toContain("uWaterQuality");
    expect(ocean).toContain("if (quality <= 0.35) return sea;");
    expect(ocean).toContain("if (close < 0.04 || quality < 0.08)");
    expect(ocean).toContain("coast");
  });

  it("does not affect SAM or cosmetics in the sprite effect", () => {
    expect(spriteFragment).toContain("bool nuke = vFxType < 0.5");
    expect(spriteFragment).toContain("bool shellBlast");
    expect(spriteFragment).toContain("if (nuke || buildingBlast || shellBlast)");
    expect(spriteVertex).toContain("type == 4 ? 1.55 : 1.0");
  });
});
