import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyEnhancedVisualProfile,
  cinematicShaderSource,
  enhancedVisualsEnabled,
  ENHANCED_SHADER_MARKER,
  setEnhancedVisuals,
  WaterQualityGovernor,
} from "../../src/client/render/gl/EnhancedVisuals";
import "../../src/client/components/EnhancedVisualsToggle";

const source = `#version 300 es\n${ENHANCED_SHADER_MARKER}\nvoid main() {}\n`;
const initialLanguage = document.documentElement.lang;

beforeEach(() => setEnhancedVisuals(false));
afterEach(() => {
  document.querySelectorAll("enhanced-visuals-toggle").forEach((el) => el.remove());
  document.documentElement.lang = initialLanguage;
  setEnhancedVisuals(false);
});

describe("optional cinematic rendering policy", () => {
  it("is disabled until explicitly selected", () => {
    expect(enhancedVisualsEnabled()).toBe(false);
    setEnhancedVisuals(true);
    expect(enhancedVisualsEnabled()).toBe(true);
  });

  it("leaves standard and unrelated shaders unchanged", () => {
    expect(cinematicShaderSource(source, false, false)).toBe(source);
    expect(cinematicShaderSource("unmarked shader", true, false)).toBe("unmarked shader");
  });

  it("inserts opt-in and reduced-motion flags after the GLSL version", () => {
    expect(cinematicShaderSource(source, true, true)).toBe(source.replace(
      "#version 300 es\n",
      "#version 300 es\n#define FRONTIER_CINEMATIC 1\n#define FRONTIER_REDUCED_MOTION 1\n",
    ));
  });

  const settings = () => ({
    terrain: { backgroundColor: "#0b1624", reliefStrength: 0.15, surfaceTextureStrength: 0.035 },
    unit: { wakeFadeMs: 400 },
    fx: { debrisDensity: 1, debrisLifetimeMs: 6000 },
    resolution: 1,
    territory: { color: "#123456", alpha: 0.588 },
  });

  it("does not modify settings when disabled", () => {
    const value = settings();
    applyEnhancedVisualProfile(value, false);
    expect(value).toEqual(settings());
  });

  it("is idempotent and does not alter territory colors or resolution", () => {
    const value = settings();
    applyEnhancedVisualProfile(value, true);
    const once = structuredClone(value);
    applyEnhancedVisualProfile(value, true);
    expect(value).toEqual(once);
    expect(value.resolution).toBe(1);
    expect(value.territory).toEqual(settings().territory);
    expect(value.fx.debrisDensity).toBeLessThan(settings().fx.debrisDensity);
  });

  it("retains detail at steady frame pacing", () => {
    const q = new WaterQualityGovernor();
    let result = 0;
    for (let i = 0; i < 100; i++) result = q.sample(i * 16.67, 1920 * 1080);
    expect(result).toBeGreaterThan(0.99);
  });

  it("sheds optional water detail during sustained slow frames", () => {
    const q = new WaterQualityGovernor();
    let result = 1;
    for (let i = 0; i < 350; i++) result = q.sample(i * 35, 1920 * 1080);
    expect(result).toBeLessThan(0.01);
  });

  it("recovers gradually instead of alternating quality every frame", () => {
    const q = new WaterQualityGovernor();
    let now = 0, result = 1;
    for (let i = 0; i < 350; i++) result = q.sample(now += 35, 1920 * 1080);
    for (let i = 0; i < 60; i++) result = q.sample(now += 16.67, 1920 * 1080);
    expect(result).toBeLessThan(0.1);
    for (let i = 0; i < 2200; i++) result = q.sample(now += 16.67, 1920 * 1080);
    expect(result).toBeGreaterThan(0.95);
  });

  it("ignores background-tab gaps and caps large framebuffer detail", () => {
    const q = new WaterQualityGovernor();
    let result = 1;
    for (let i = 0; i < 60; i++) result = q.sample(i * 1000, 1920 * 1080);
    expect(result).toBeGreaterThan(0.99);
    expect(q.sample(60000, 3840 * 2160)).toBeLessThanOrEqual(0.65);
    expect(q.sample(60016, 7680 * 4320)).toBeLessThanOrEqual(0.35);
    expect(Number.isFinite(q.sample(Number.NaN, 1920 * 1080))).toBe(true);
  });
});

describe("pregame cinematic control", () => {
  function mount() {
    const element = document.createElement("enhanced-visuals-toggle");
    document.body.append(element);
    return element;
  }

  it("renders an unchecked, labeled checkbox without changing game rules", () => {
    const element = mount();
    const input = element.shadowRoot!.querySelector("input")!;
    expect(input.checked).toBe(false);
    expect(input.getAttribute("aria-describedby")).toBe("visual-detail visual-note");
    expect(element.shadowRoot!.querySelector("strong")!.textContent).not.toBe("");
  });

  it("updates the opt-in flag and synchronizes other mounted controls", () => {
    const first = mount(), second = mount();
    const a = first.shadowRoot!.querySelector("input")!;
    const b = second.shadowRoot!.querySelector("input")!;
    a.checked = true;
    a.dispatchEvent(new Event("change"));
    expect(enhancedVisualsEnabled()).toBe(true);
    expect(b.checked).toBe(true);
    b.checked = false;
    b.dispatchEvent(new Event("change"));
    expect(a.checked).toBe(false);
  });

  it("follows the chosen language", () => {
    const element = mount();
    window.dispatchEvent(new CustomEvent("language-selected", { detail: { lang: "es" } }));
    expect(element.shadowRoot!.querySelector("strong")!.textContent).toBe("Gr\u00e1ficos cinematogr\u00e1ficos");
    window.dispatchEvent(new CustomEvent("language-selected", { detail: { lang: "en" } }));
    expect(element.shadowRoot!.querySelector("strong")!.textContent).toBe("Cinematic graphics");
  });

  it("unsubscribes from changes when removed", () => {
    const element = mount();
    const input = element.shadowRoot!.querySelector("input")!;
    element.remove();
    setEnhancedVisuals(true);
    expect(input.checked).toBe(false);
  });
});
