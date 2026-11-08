# Optional cinematic graphics: audit and implementation

Baseline: `51860e6d4ae2cbd91f6477ff282fa7c0314b206d` on `frontier/development`.
Scope: client presentation in the existing shared match-configuration UI. Classic, Geopolitics and team configurations can opt in. The option is not a new game mode, not a 4K switch, and not a simulation rule.

## Executive assessment

The renderer already has useful foundations: batched units, procedural ship silhouettes, a single terrain/overview quad, per-tile texture sub-updates, and a device-pixel-ratio cap. A safe improvement should concentrate visual work on the sea and moving fleets, not add expensive land detail that territorial color will cover.

This implementation is an optional rendering revision, **not a complete replacement of every sprite, every sound or the engine**. No claim of guaranteed frame rate or a measured 9/10 aesthetic rating is made. Whole-game hardware playtesting remains necessary.

## 360-degree audit

| Area | Inspected implementation | Decision and change |
| --- | --- | --- |
| Water | `TerrainPass.ts`, `terrain.frag.glsl`: procedural waves and glints in the existing terrain pass | Optional directional surface normals, restrained broad reflections, shallow-water wash/foam and limited caustic detail. Extra detail fades with zoom and a frame-time governor. No water simulation or reflection texture. |
| Coastline | Terrain bytes already stored in the alpha channel of the terrain texture | Reuse the shoreline bit. No coastline displacement, new territory mask or gameplay tile changes. |
| Terrain | Two elevation-neighbor reads and material grains | Small relief increase, reduced fine grain. Do not turn the world into an expensive detailed landscape hidden by ownership fills. |
| Territory expansion and colors | Separate territory, affiliation and border pipeline | Preserve ownership colors, opacity, affiliation view and capture rules. User palette choices still take precedence. |
| Ships | `UnitPass.ts`, unit shaders: procedural transport, merchant and warship forms in existing batches | Preserve size, position, heading, class markers and country identity. Add subtle close-up deck light rather than replacing readable silhouettes. |
| Wakes | Existing local quad and movement fade | Optional tapered stern wash and bow-pressure arc, derivative-based detail reduction, bounded alpha, no particles or movement-history buffers. Fade settings lengthen from 400 to 650 ms. |
| Nuclear effects | `FxShockwavePass.ts`, shockwave shader and debris settings | Optional warm pressure front and faint inner light for the default nuclear ring. No larger damage radius, no full-screen flash, no camera shake. Cosmetic styles and SAM rings remain unchanged. Reduce debris density/lifetime instead of increasing simultaneous particles. |
| Zoom-out surround | Terrain pass already fills off-map margins | A quieter dark chart surround and restrained static vignette; no animated ocean outside the map. |
| Audio | `SoundEffectController.ts`: MIRV impacts, nuclear warnings and train-station cues already have repeat throttles | Preserve the mixer, warning sounds and throttles. No new audio assets, no volume increase and no claimed audio remaster. A listening review was not performed. |
| Resolution | `utils/Dpr.ts`: backing-store ratio capped at 2 | Leave resolution and the DPR cap unchanged. Visual quality and resolution are separate concerns. |

## User-facing behavior

`Cinematic graphics` / `Gráficos cinematográficos` appears below the mode section in `GameConfigSettings`. A native labeled checkbox is unchecked on a fresh app session. Selecting it affects rendering initialized for the next match on this device only; it does not send an engine intent or alter saved rules. The current choice remains in memory for the session and is not written to local storage.

The control supports Spanish and English (English fallback), keyboard activation, a visible focus state, explanatory text, a narrow mobile layout and synchronized state when two configuration panels are mounted. It is a local preference, not something the host imposes on other players.

## Cost controls and isolation

- Only shaders carrying `FRONTIER_CINEMATIC_VARIANT` receive the optional define. The disabled variant and unrelated shaders retain their original source path.
- Water changes reuse the existing RGBA terrain texture, including the encoded shoreline/terrain byte. There is no additional map-sized texture, reflection buffer, CPU water grid or draw pass.
- Optional detail declines at overview zoom and on large framebuffers. More than 3.7 million framebuffer pixels caps the quality scalar at 0.65; more than 8.3 million caps it at 0.35. These are pixel-cost limits, not forced output resolutions.
- `WaterQualityGovernor` uses a smoothed frame interval, sustained slow-frame detection and slow recovery. It can shed the extra water detail entirely. Background-tab gaps are ignored. This is **not a GPU timer** and cannot solve AI/simulation stalls.
- Wakes stay inside existing vessel quads and skip fine work at distant zoom. Vessel count and draw-call count do not increase.
- The optional profile reduces debris density to at most 0.7 and lifetime to at most 4500 ms. It does not impose a new hard limit on all simultaneous explosions, so extreme MIRV overdraw still needs a stress test.
- Reduced-motion preference freezes the additional ocean/wake phase and removes the added nuclear core glow. Existing gameplay-warning effects are not silently removed.
- No engine, economics, diplomacy, damage, movement, visibility, networking or ownership code changes are required by this feature.

## Verification actually executed

The repository could not be cloned in this environment, so these results are **isolated checks, not a whole-repository build**.

1. Strict TypeScript compilation of both newly introduced standalone modules: passed.
2. Twelve Node assertions for opt-in state, shader-source isolation, disabled profile identity, profile idempotence, frame-pacing degradation/recovery, large-framebuffer caps and invalid timestamps: passed.
3. Eight Chromium checks of the actual compiled checkbox component: unchecked default, Spanish copy, activation, new-instance state, synchronization, language change, no mobile horizontal overflow and no JavaScript exceptions: passed.
4. Browser WebGL2 was unavailable in this managed Chromium environment. Shader execution therefore used **Mesa llvmpipe OpenGL ES 3.2 via EGL**; this is a software rendering smoke test, not a gaming GPU benchmark.
5. Eight terrain variants rendered without GL errors: baseline, optional code disabled, enabled, fallback quality, two reduced-motion times, overview and close-up. Disabled output was pixel-identical to baseline; reduced-motion output was stationary.
6. Three vessel classes were exercised in normal and affiliation views using baseline, disabled, enabled and reduced-motion shaders. Disabled output was pixel-identical; affiliation-view output stayed identical even when enabled.
7. SAM, default nuclear, EMP, sparkle and ember shockwave cases were exercised with the same shader variants. Disabled output was pixel-identical. SAM and user-cosmetic styles remained pixel-identical when enabled; only the intended default nuclear effect changed.

Synthetic render images are test scenes, **not screenshots of a completed game**. CPU/GPU timings from software rendering are not used to promise real-world FPS. Regression tests are also committed in `tests/client/EnhancedVisuals.test.ts`; the full Vitest suite has not been run here.

## Required release gate

Before advertising this as a finished remaster, run repository typecheck, production build, lint/format and tests. Then compare the same saved late-game scene with the feature off/on at 1080p, 1440p and 4K on at least one integrated and one discrete GPU.

Include a large mostly-water map, distant world overview, a densely contested coastline, large transport/merchant/warship fleets, many simultaneous MIRV impacts, night mode, alternate affiliation view and a restored graphics context. Record median/p95 frame time, worst stalls, GPU/CPU utilization and memory; distinguish simulation-bound from rendering-bound stalls. Confirm that audio warnings remain intelligible rather than merely loud.

The next visual iteration should be driven by those comparisons. Do not add ray marching, per-ship particle emitters, high-resolution shadow maps or 4K textures just to raise a quality label.
