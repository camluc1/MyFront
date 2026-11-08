import { afterEach, describe, expect, it } from "vitest";
import {
  cinematicShaderSource,
  setCinematicQuality,
} from "../../../../src/client/render/gl/EnhancedVisuals";
import frag from "../../../../src/client/render/gl/shaders/unit/unit.frag.glsl?raw";
import vert from "../../../../src/client/render/gl/shaders/unit/unit.vert.glsl?raw";
import pass from "../../../../src/client/render/gl/passes/UnitPass.ts?raw";
import motion from "../../../../src/client/render/gl/utils/VesselMotion.ts?raw";

afterEach(() => setCinematicQuality("high"));

describe("Ultra-only naval presentation contract", () => {
  it("keeps the ordinary, Medium and High profiles free of Ultra defines", () => {
    expect(cinematicShaderSource(frag, false, false)).toBe(frag);
    for (const quality of ["medium", "high"] as const) {
      setCinematicQuality(quality);
      const source = cinematicShaderSource(frag, true, false);
      expect(source).toContain("#define FRONTIER_CINEMATIC 1");
      expect(source).not.toContain("#define FRONTIER_CINEMATIC_ULTRA 1");
    }
    setCinematicQuality("ultra");
    expect(cinematicShaderSource(frag, true, false))
      .toContain("#define FRONTIER_CINEMATIC_ULTRA 1");
  });

  it("keeps palette ownership, flag seven, orientation and logical scaling", () => {
    expect(frag).toContain("const float FLAG_SUPPORT_SHIP   = 7.0;");
    expect(frag).toContain("texture(uPalette, vec2(u, 0.25))");
    expect(frag).toContain("texture(uPalette, vec2(u, 0.75))");
    expect(pass).toContain("const FLAG_SUPPORT_SHIP = 7;");
    expect(pass).toContain("const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;");
    expect(pass).toContain("motion.headingByte()");
    expect(vert).toContain("float halfSize = uUnitSize * 0.5 * scale;");
    expect(vert).toContain("vec2 center = vec2(worldX + 0.5, worldY + 0.5);");
    expect(vert).toContain("mat2(c, s, -s, c) * localPos;");
  });

  it("uses the existing wake-speed byte and camera-derived LOD, without new uniforms", () => {
    expect(pass).toContain("motion.wake(now) * 255");
    expect(pass).toContain("this.groundBuf.uint8[i * 16 + 14]");
    expect(motion).toContain("wake(now: number): number");
    expect(vert).toContain("float pixelsPerTile = length(uCamera[0].xy * uViewport * 0.5);");
    expect(frag).toContain("float speedWake = smoothstep(");
    expect(frag).toContain("float fineLOD=smoothstep(");
    expect(frag).toContain("float closeLOD = 1.0 - smoothstep(");
    const uniforms = [...frag.matchAll(/uniform\\s+(?:\\w+)\\s+(\\w+)/g)].map((m) => m[1]);
    expect(uniforms).not.toContain("uNavalVelocity");
    expect(uniforms).not.toContain("uNavalHealth");
  });

  it("ensures every new hull color, silhouette and water effect has an Ultra guard", () => {
    expect(frag).toContain("#ifdef FRONTIER_CINEMATIC_ULTRA\n  if (vessel) {");
    expect(frag).toContain("#ifdef FRONTIER_CINEMATIC_ULTRA\n    // Ultra only:");
    expect(frag).toContain("#ifdef FRONTIER_CINEMATIC_ULTRA\n      // Round the bow");
    expect(frag).toContain("#ifdef FRONTIER_CINEMATIC_ULTRA\n        // Ultra Portabuques:");
    expect(frag).toContain("#ifdef FRONTIER_CINEMATIC_ULTRA\n        // The repair carrier");
    expect(frag).toContain("vec3 rimColor = mix(borderColor, territoryColor, 0.24)");
    expect(frag).toContain("float rimPx = clamp(fwidth(hullSignedDistance)");
  });
});
