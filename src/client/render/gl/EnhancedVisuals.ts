/** Client-only presentation. Never enters a game intent or save. */
export const ENHANCED_VISUALS_EVENT = "frontier:enhanced-visuals-changed";
export const ENHANCED_SHADER_MARKER = "// FRONTIER_CINEMATIC_VARIANT";
export type CinematicQuality = "medium" | "high" | "ultra";
const STORAGE_KEY = "frontier-cinematic-profile-v1";
let requested = false;
let quality: CinematicQuality = "high";
try {
  const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  if (saved === "medium" || saved === "high" || saved === "ultra") {
    requested = true;
    quality = saved;
  }
} catch { /* Private browsing/storage policy: session preference still works. */ }

export function enhancedVisualsEnabled(): boolean { return requested; }
export function cinematicQuality(): CinematicQuality { return quality; }

function notify(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, requested ? quality : "classic");
    }
  } catch { /* Never block graphics selection on storage. */ }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ENHANCED_VISUALS_EVENT, {
      detail: { enabled: requested, quality },
    }));
  }
}

export function setEnhancedVisuals(enabled: boolean): void {
  if (requested === enabled) return;
  requested = enabled;
  notify();
}

export function setCinematicQuality(value: CinematicQuality): void {
  if (value !== "medium" && value !== "high" && value !== "ultra") return;
  if (quality === value) return;
  quality = value;
  notify();
}

/** Fixed budgets selected by the player. No FPS/resolution-based downgrades. */
export function cinematicQualityBudget(value = quality) {
  switch (value) {
    case "medium": return { water: 0.35, debris: 0.35, debrisMs: 2200, plumeLimit: 6, fxLimit: 320 };
    case "ultra": return { water: 1, debris: 0.50, debrisMs: 2800, plumeLimit: 10, fxLimit: 640 };
    default: return { water: 1, debris: 0.45, debrisMs: 2600, plumeLimit: 8, fxLimit: 480 };
  }
}

export function prefersReducedVisualMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Standard shaders are unchanged. Profile is captured at renderer creation. */
export function cinematicShaderSource(
  source: string,
  enabled = enhancedVisualsEnabled(),
  reducedMotion = prefersReducedVisualMotion(),
): string {
  if (!enabled || !source.includes(ENHANCED_SHADER_MARKER)) return source;
  const flags = "#define FRONTIER_CINEMATIC 1\n" +
    (quality === "ultra" ? "#define FRONTIER_CINEMATIC_ULTRA 1\n" : "") +
    (quality === "medium" ? "#define FRONTIER_CINEMATIC_MEDIUM 1\n" : "") +
    (reducedMotion ? "#define FRONTIER_REDUCED_MOTION 1\n" : "");
  return source.replace(/^(#version[^\r\n]*\r?\n)/, "$1" + flags);
}

/** Compatibility adapter for TerrainPass; now a fixed manual quality budget.
 * Capture once so a menu change cannot partially reconfigure a live renderer.
 */
export class WaterQualityGovernor {
  private readonly level = cinematicQualityBudget().water;
  sample(_nowMs: number, _framebufferPixels: number): number { return this.level; }
}

interface VisualProfileTarget {
  terrain: { backgroundColor: string; reliefStrength: number; surfaceTextureStrength: number };
  unit: { wakeFadeMs: number };
  fx: { debrisDensity: number; debrisLifetimeMs: number };
  mapOverlay: { staleNukeR: number; staleNukeG: number; staleNukeB: number; staleNukeVariation: number };
  falloutBloom: {
    bloomR: number; bloomG: number; bloomB: number; intensityHot: number; intensityCold: number;
    particleColorDarkR: number; particleColorDarkG: number; particleColorDarkB: number;
    particleColorBrightR: number; particleColorBrightG: number; particleColorBrightB: number;
    particleStrength: number;
  };
  lighting: { falloutLightR: number; falloutLightG: number; falloutLightB: number; falloutLightIntensity: number };
}

/** Preserve the accepted ground-impact appearance; only airborne debris budgets differ. */
export function applyEnhancedVisualProfile(settings: VisualProfileTarget, enabled = enhancedVisualsEnabled()): void {
  if (!enabled) return;
  const budget = cinematicQualityBudget();
  settings.terrain.backgroundColor = "#091826";
  settings.terrain.reliefStrength = 0.17;
  settings.terrain.surfaceTextureStrength = 0.028;
  settings.unit.wakeFadeMs = 630;
  settings.mapOverlay.staleNukeR = 0.18;
  settings.mapOverlay.staleNukeG = 0.21;
  settings.mapOverlay.staleNukeB = 0.23;
  settings.mapOverlay.staleNukeVariation = 0.025;
  settings.falloutBloom.bloomR = 0.89;
  settings.falloutBloom.bloomG = 0.41;
  settings.falloutBloom.bloomB = 0.20;
  settings.falloutBloom.intensityHot = Math.min(1.55, settings.falloutBloom.intensityHot);
  settings.falloutBloom.intensityCold = Math.min(0.06, settings.falloutBloom.intensityCold);
  settings.falloutBloom.particleColorDarkR = 0.42;
  settings.falloutBloom.particleColorDarkG = 0.20;
  settings.falloutBloom.particleColorDarkB = 0.13;
  settings.falloutBloom.particleColorBrightR = 0.94;
  settings.falloutBloom.particleColorBrightG = 0.64;
  settings.falloutBloom.particleColorBrightB = 0.39;
  settings.falloutBloom.particleStrength = Math.min(0.45, settings.falloutBloom.particleStrength);
  settings.lighting.falloutLightR = 1.0;
  settings.lighting.falloutLightG = 0.55;
  settings.lighting.falloutLightB = 0.29;
  settings.lighting.falloutLightIntensity = Math.min(3.0, settings.lighting.falloutLightIntensity);
  settings.fx.debrisDensity = Math.max(0, Math.min(settings.fx.debrisDensity, budget.debris));
  settings.fx.debrisLifetimeMs = Math.min(settings.fx.debrisLifetimeMs, budget.debrisMs);
}
