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


## V2 — Heavy-map rendering, fleet integration, nuclear palette, ocean sound

This iteration is **opt-in and cosmetic**. All changes remain within the existing
cinematic path. The standard renderer, gameplay effects, hit boxes, map topology,
unit simulation, faction ownership and nuclear damage are unchanged.

### What changed

1. **Adaptive ocean cost:** at a quality scalar of 0.35 or below, the water
   fragment shader skips procedural high-frequency noise, specular normal
   calculations and coastline caustics. A single inexpensive broad swell
   remains; when the governor reaches zero, the renderer uses the existing
   standard water path. No new pass, texture, physics grid, or draw call.
2. **Water/naval integration:** the opt-in red pulsing boat ring is replaced by
   a restrained blue-gray pressure wash, and existing per-ship foam is slightly
   rebalanced. Ships retain their silhouette, tactical distinction, wake
   direction, affiliations and current batching.
3. **Nuclear visual design:** opt-in fallout now uses charcoal-colored residue,
   warm fading bloom, and lower-density amber embers rather than the permanent
   neon-green visual. The default blast shader has a thin secondary pressure
   ring inside the existing geometry and lifetime. The legacy renderer retains
   its colors, while a player's explicit custom stale-nuke color still wins.
   Radioactive tile state, hazard logic, damage, SAM effects and cosmetic explosion
   styles are unchanged.
4. **Maritime atmosphere:** a short deterministic mono WAV loop (~44 KB,
   generated once locally on first use) becomes available as a new ambience
   track. It starts only with cinematic graphics enabled, zoom sufficiently
   close and the camera centered on water, and only when no nearby structure
   has priority. It follows the established master and ambience volumes, mute,
   and 500 ms crossfades. No streamed asset or persistent per-unit audio.
5. **Ambient light:** existing broad sea reflections and the adjusted nuclear
   bloom contribute restrained lighting. There are no dynamic light shadows,
   per-ship spotlights, extra postprocessing layers or 4K render targets.

### Synthetic giant-map test actually executed

With Mesa llvmpipe / OpenGL ES **software** (not a consumer GPU),
an 8192 × 4096 synthetic terrain, **33,554,432 cells**, was uploaded as
one RGBA8 texture (**128 MiB**) and rendered at 960 × 600 at close
map zoom. Four water variants — standard, cinematic full, cinematic
economical and cinematic fallback — compiled and drew without a GL
error. The fallback matched the standard pixels exactly.

Recorded median wall-clock software draw times in one run, after warmup
(3 repetitions per variant, influenced by shader compilation, caches and
CPU scheduling): **standard 3.45 ms; cinematic full 2.86 ms; cinematic
economical 2.26 ms; fallback 3.44 ms**. These values are only a smoke
test; they are **not hardware frame rates**, and the differences are too
small and noisy to assert an actual speedup. Texture upload took roughly
381 ms once in software. Real GPUs have different costs.

Earlier shader harness scenes were rerun: 8 terrain variants, 11 naval
and explosion scenarios, all with no GL error; standard graphics remained
pixel-identical to their original shader paths. Reduced-motion terrain
stayed stationary. No particle or ship instance count was increased.

### What's still needed for release acceptance

Run full TypeScript check and Vitest suite plus actual browser WebGL2
rendering on integrated/discrete GPUs. Measure identical save-game scenarios
on a huge land/water map, 500+ ships, several MIRVs and large coastal
battles; capture real median, p95, p99 frametime, GPU utilization, memory,
audio intelligibility and input delay, with mode **off vs on**.
Also check renderer context restore, graphics overrides, mute/volume sliders,
accessibility reduced-motion, and mobile. Nothing here guarantees 60 FPS.

The synthetic giant-map results and test scripts were executed in a
software-only test environment; users should not confuse them with a
full gameplay benchmark. Source tests for the quality policy and ocean
ambience have been added but the repository's complete suite has **not**
been run in this environment.

## V3 — In-game performance indicator and restrained nuclear impact

The project already shipped a deep `PerformanceOverlay` with frame interval,
FPS, TPS, tick timing and optional per-layer diagnostics. This iteration does
**not** duplicate the monitoring system. It makes it usable during a real match:

- In Graphics Settings, a default-off checkbox enables/disables the existing
  performance overlay. The compact default shows FPS, the rolling 60-second
  FPS average, TPS and the 95th percentile of the **last 60 RAF intervals**.
  These are observed browser animation-frame intervals (not GPU timing), and
  the p95 window is short rather than a 60-second p95. Compact numbers refresh
  as they become available; the full monitor remains one click away.
- Compact mode avoids the expensive per-layer frame profiler. The profiler is
  enabled only while the full overlay is expanded. Hiding the monitor cancels
  its independent requestAnimationFrame loop entirely.
- Opening the full overlay retains its existing timings, copy-JSON snapshots
  and detailed performance analysis. Players can compare the same match with
  cinematic graphics enabled/disabled, including 500+ ships or nuclear battles.
- With the opt-in cinematic shader, the **existing** nuclear shockwave gets
  three visual stages: bright heat flash, a cooling compression front and a
  short warm haze. The shockwave uses its original instance, footprint,
  lifetime and alpha cap. No additional particles, draw calls, textures,
  shadow buffers, damaging area, or audio assets are introduced. Standard
  graphics and SAM/cosmetic styles retain their earlier shader branches.
- Updated Spanish/English settings label and a focused toggle regression test
  are included in the source.

**QA boundary:** This change is committed but has not been compiled, tested or
playtested in a real browser session in this environment. RAF FPS is useful
for detecting uneven pacing but should not be presented as GPU timing, and
real game stress testing remains necessary before claiming 60 FPS or a 9/10
audiovisual result.
