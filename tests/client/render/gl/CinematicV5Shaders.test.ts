import { describe, expect, it } from "vitest";
import { cinematicShaderSource } from "../../../../src/client/render/gl/EnhancedVisuals";
import terrain from "../../../../src/client/render/gl/shaders/terrain/terrain.frag.glsl?raw";
import trail from "../../../../src/client/render/gl/shaders/map-overlay/trail.frag.glsl?raw";
import spriteVertex from "../../../../src/client/render/gl/shaders/fx/sprite.vert.glsl?raw";
import spriteFragment from "../../../../src/client/render/gl/shaders/fx/sprite.frag.glsl?raw";

describe("V5 renderer integration contract", () => {
  const shaders=[terrain,trail,spriteVertex,spriteFragment];
  it("keeps all normal graphics shaders unmodified", () => {
    for(const source of shaders){
      expect(cinematicShaderSource(source,false,false)).toBe(source);
      expect(cinematicShaderSource(source,true,false))
        .toContain("#define FRONTIER_CINEMATIC 1");
    }
  });
  it("draws two distinct cinematic blast atlases in the existing FX pass",()=>{
    expect(spriteFragment).toContain("uCinematicNukeAtlas");
    expect(spriteFragment).toContain("uCinematicImpactAtlas");
    expect(spriteFragment).toContain("sampleCinematicAtlas");
    expect(spriteVertex).toContain("vFxFrame");
  });
  it("skips expensive sea normal samples at low quality",()=>{
    expect(terrain).toContain("quality <= 0.35");
    expect(terrain.indexOf("if (quality <= 0.35)"))
      .toBeLessThan(terrain.indexOf("texture(uOceanDetail"));
    expect(terrain).toContain("nearLOD < 0.025");
  });
});
