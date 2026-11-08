/** Client-only, opt-in presentation. Never enters a game intent or save. */
export const ENHANCED_VISUALS_EVENT = "frontier:enhanced-visuals-changed";
export const ENHANCED_SHADER_MARKER = "// FRONTIER_CINEMATIC_VARIANT";
let requested = false;

export function enhancedVisualsEnabled(): boolean {
  return requested;
}

/** Session preference, intentionally not persisted or enabled on first launch. */
export function setEnhancedVisuals(enabled: boolean): void {
  if (requested === enabled) return;
  requested = enabled;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ENHANCED_VISUALS_EVENT, {
      detail: { enabled },
    }));
  }
}

export function prefersReducedVisualMotion(): boolean {
  return typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Only explicitly marked shaders opt in. Standard shaders are byte-identical. */
export function cinematicShaderSource(
  source: string,
  enabled = enhancedVisualsEnabled(),
  reducedMotion = prefersReducedVisualMotion(),
): string {
  if (!enabled || !source.includes(ENHANCED_SHADER_MARKER)) return source;
  const flags = "#define FRONTIER_CINEMATIC 1\n" +
    (reducedMotion ? "#define FRONTIER_REDUCED_MOTION 1\n" : "");
  return source.replace(/^(#version[^\r\n]*\r?\n)/, "$1" + flags);
}

/** Constant-memory frame pacing guard, NOT a GPU benchmark or an FPS promise. */
export class WaterQualityGovernor {
  private lastTime: number | null = null;
  private average = 16.67;
  private slowFrames = 0;
  private fastFrames = 0;
  private level = 3;
  private smoothed = 1;

  sample(nowMs: number, framebufferPixels: number): number {
    const cap = framebufferPixels > 8_300_000 ? 0.35 :
      framebufferPixels > 3_700_000 ? 0.65 : 1;
    if (!Number.isFinite(nowMs)) return Math.min(this.smoothed, cap);
    const dt = this.lastTime === null ? 0 : nowMs - this.lastTime;
    this.lastTime = nowMs;
    // A paused/background tab is not evidence that this shader is expensive.
    if (dt < 2 || dt > 250) {
      this.slowFrames = 0;
      this.fastFrames = 0;
      return Math.min(this.smoothed, cap);
    }
    this.average += (dt - this.average) * 0.04;
    this.slowFrames = this.average > 23 ? this.slowFrames + 1 : 0;
    this.fastFrames = this.average < 17.5 ? this.fastFrames + 1 : 0;
    if (this.slowFrames >= 45 && this.level > 0) {
      this.level--;
      this.slowFrames = 0;
      this.fastFrames = 0;
    } else if (this.fastFrames >= 600 && this.level < 3) {
      this.level++;
      this.fastFrames = 0;
    }
    const target = Math.min([0, 0.3, 0.65, 1][this.level], cap);
    this.smoothed += (target - this.smoothed) * Math.min(0.1, dt / 300);
    return Math.max(0, Math.min(this.smoothed, cap));
  }
}

/** Structural subset: keep this policy independent of renderer internals. */
interface VisualProfileTarget {
  terrain: {
    backgroundColor: string;
    reliefStrength: number;
    surfaceTextureStrength: number;
  };
  unit: { wakeFadeMs: number };
  fx: { debrisDensity: number; debrisLifetimeMs: number };
}

/** Apply before explicit user overrides. No palette, resolution or sim edits. */
export function applyEnhancedVisualProfile(
  settings: VisualProfileTarget,
  enabled = enhancedVisualsEnabled(),
): void {
  if (!enabled) return;
  settings.terrain.backgroundColor = "#091826";
  settings.terrain.reliefStrength = 0.17;
  settings.terrain.surfaceTextureStrength = 0.028;
  settings.unit.wakeFadeMs = 650;
  // Better-shaped explosions, not more debris: reduce overlap in MIRV storms.
  settings.fx.debrisDensity = Math.max(0, Math.min(settings.fx.debrisDensity, 0.7));
  settings.fx.debrisLifetimeMs = Math.min(settings.fx.debrisLifetimeMs, 4500);
}
