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


## V4 — Player-reported visual regressions and build-key visibility

**Triggered by in-game feedback, not by another assumed 8.7/10 rating.**
The player reported that cinematic water looked worse, small missile impacts
were comical, naval bows jerked left/right at course changes, and DLC
structures still had no visible keycap.

### Corrections

- **Build keys across all modes:** the J, V, O, Z bindings (farm, mine,
  oil well, gas) and the legacy 0–9 keys are now displayed at the upper
  corner of **each item's icon**, instead of in the remote corner of its
  full build card. A true unbound key shows a dash with an explanation rather
  than silently disappearing. Existing user remapping continues to win.
- **Cinematic sea:** replaced the overly subdued wave highlight with
  directional traveling swells, modulated crest ribbons, coastal teal and
  a more readable surf layer. Noise is shared between crest breakup and shore
  wash. At low quality the shader exits early and preserves an affordable
  broad wave. Terrain relief changes are slight to keep faction colors
  legible. Changes are isolated behind FRONTIER_CINEMATIC.
- **Vessel steering:** the visual hull uses a rate-limited heading on
  planned sailing routes and a stable course bearing on fallback routes.
  The authoritative position, route, tile arrivals and unit behavior remain
  unchanged; this adjusts rendering only.
- **Rocket/bomb impacts:** the existing explosion sprite vertex shader
  enlarges only nuke, building and small-shell impact silhouettes in the
  cinematic profile. The fragment shader shades the same existing atlas
  texture through hot flash, cooling embers and dark smoke. No new
  particle emitters or draw calls. SAM intercepts, faction/cosmetic
  branches and classic graphics retain original behavior. Enlarged quads
  can shade slightly more pixels, so this is not mathematically free.

### Executed isolated visual checks

Mesa llvmpipe OpenGL ES 3.2 software renderer, not browser/WebGL2:

- **Terrain shader** compiled and rendered all eight previously defined
  synthetic variants, including close and overview scales, cinematic
  quality, fallback, and reduced motion. Standard profile compared
  pixel-identical to the earlier shader baseline; reduced-motion frames
  were stationary. Earlier first-pass V4 source had a nested-preprocessor
  replacement error; the smoke test caught it and it was corrected **before**
  moving the feature branch into development.
- **Giant texture:** 8192 × 4096 synthetic cells (33,554,432 cells,
  128 MiB RGBA8 texture) rendered with standard, cinematic full,
  cinematic quality 0.25 and fallback, with no OpenGL errors. On one
  software run the median measured draw calls were approximately
  3.41/2.98/2.92/3.33 ms respectively on a 960 × 600 output.
  These are **not gameplay frame times, GPU benchmarks or claims of speedup**.
- **Explosion sprite program:** default, cinematic, and cinematic with
  reduced motion compiled and linked with a representative WebGL2 ES
  test harness. This is not a final explosion visual art review.
- New repository regression tests cover hotkeys anchored over icons,
  unbound-key messaging, planned ship steering and optional shader
  gating. The repository's Vitest suite, full build, actual browser,
  shader appearance on production terrain/ships, and real gameplay
  remain untested here.

### Deployment caveat

The default GitHub branch is `main`, while development work is under
`frontier/development`. At the time of audit the latter was 214 commits
ahead; a live app based on `main` may show none of these fixes. Check the
deployment source/revision before diagnosing a screenshot as containing
the new renderer. Do not merge into `main` without an explicit release
decision and QA approval.


## V5 — Rebuild the art foundation rather than adjusting the old sprite

**User acceptance target** (not a verified score): ocean 9/10, nuclear
mushroom 9.5/10, impacts 9/10, terrain 8.5/10, ships 9/10, visual whole 9/10.
Earlier assistant-generated claims of 8.7/10 are withdrawn. A source change is
not equivalent to an independent gameplay art-quality judgment.

### Stage A: ocean material

The cinematic terrain pass now mixes water color by encoded depth and existing
coastal flags; draws large overlapping wind-driven swells; and at close zoom
samples a **128×128 deterministic, seamless RGBA normal/foam texture** twice.
A tiny mipmap chain prevents shimmer at farther zoom. The normals contribute
sky glints and physically motivated highlight direction; foam fragments follow
crests and beaches instead of fixed parallel diagonal stripes. At quality <=
0.35 it immediately uses a cheap analytic wave and performs no normal-texture
samples. Extreme zoom skips close-water detail. This remains **one existing
terrain draw call** and no extra full-map texture.

### Stage B: conventional impacts

A new original **16-frame, 1024×1024 transparent SVG atlas** replaces the
four-frame tiny blast animation in the cinematic profile when its image has
decoded. It depicts short-lived flash, irregular fireball, advancing pressure
front, debris points and dark smoke. Building, unit and shell impacts use
different lifetimes (1200/900/700 ms). SAM interception, custom effects,
ordinary graphics and gameplay physics retain their original artwork.
The new texture is rasterized and uploaded **once per cinematic renderer**.
It adds a texture binding, not a separate render pass or per-impact emitter.

### Stage C: the actual mushroom

A separate original **16-frame, 1024×1024 SVG atlas** replaces the 9-frame,
630ms nuclear sprite with a **3.2s rising column and smoke cap**. Stages
include fireball, expanding ground pressure ring, hot ascension, visible stem,
broad mushroom crown, an incandescent underside and gradual cooling. Rendering
uses the existing instanced FX quad and the separate existing shockwave; no
added explosion sprite instances. No visible asset? The old blast remains
available as a fallback, preserving complete gameplay functionality.
The draw pass caps high-quality mushroom sprites at 10 simultaneous instances.

### Stages D/E: terrain, fleets

Mountain crests and valleys now receive restrained directional light and
material grain; national control colors are preserved. Ship steering limits
visible yaw on bends without changing authoritative position, simulation or
arrival time. The existing boat trail pass doubles as a pale foam ribbon only
at sufficiently close zoom, while the original tactical path and fleet
instance count remain. Standard and affiliation view are isolated.

### Stage F: global performance budgets

- Ocean normal map: 128² RGBA8 = **64 KiB** plus ~21 KiB of mipmaps, created
  only with the optional graphics profile; never map-width × map-height.
- Two sprite atlases: 1024² RGBA8 each = **8 MiB total**, loaded once per
  renderer (plus compact SVG source), not per weapon. If decode fails, the
  original atlas is used.
- At most 10 concurrent cinematic mushroom sprites; debris limited to 12
  instances per type per detonation; at most 640 instances in the total FX
  batch during extreme MIRV storms. High-importance impacts take priority
  over smoke fragments.
- There is no new geometry pass, real-time volumetric fluid simulation,
  ray tracing, noise regeneration each frame, impact damage adjustment,
  unit type or game resource. Existing dynamic framebuffer/zoom quality
  governor stays active.
- Newly enlarged blast quads shade more pixels than old quads and two extra
  small textures cost memory: this is an explicit, bounded tradeoff, **not**
  a claim of zero performance penalty.
- Existing compact FPS/TPS/p95 overlay should be used to compare matched
  saves on identical hardware in normal and cinematic variants.

### QA and deployment gates

Repository tests cover deterministic normal generation, source-level
normal/cinematic shader isolation, the 16-frame SVG grid, FX limits and
cinematic steering. Before release, run TypeScript/format/lint, all Vitest
tests, the production build, software WebGL smoke compilation, and actual
WebGL2 browser decode of both SVG atlases, including Safari/mobile behavior.
Compare 2000×1000 world maps, 500+ warships, many MIRV simultaneous
detonations, old save resume, graphics-off, reduced-motion and alternative
cosmetics. Capture median/p95/p99 frame time, sim TPS, GPU memory and
representative screenshots of each explosion stage. No 9/10 score is
established without visual acceptance.

Changes should remain in `frontier/development` until validated. The
repository's default `main` branch and any public deployment are separate.


### V5 isolated tests and QA evidence actually executed in this session

- **SVG integrity:** both atlases validated as well-formed nested SVG markup
  with 16 cells at the correct 4×4 positions, no external image/script tags.
- **Actual artwork preview:** reconstructed both committed SVGs locally and
  verified their Git blob IDs against the GitHub source. Rasterized with Cairo
  and **displayed in Chromium** in five stages each using data URIs; these
  are asset previews, *not gameplay screenshots*. Visual inspection led to
  an additional corrected mushroom crown and continuous stem.
- **Fragment/vertex shader syntax:** the 3 representative V5 sprite variants
  (standard, cinematic, reduced motion) linked on Mesa llvmpipe OpenGL ES
  3.2. Exact production browser WebGL2 texture upload still needs validation.
- **Representative terrain-shader smoke:** normal, cinematic, low-quality,
  fallback, overview and reduced-motion variants compiled/drew on software
  OpenGL ES without errors. The ordinary renderer and cinematic fallback
  produced exactly matching pixel checksums in the synthetic scenes;
  reduced-motion repeated times also matched.
- **Representative giant texture:** 8192 × 4096 synthetic terrain
  (33,554,432 tiles, 128 MiB RGBA8), rendered at 960 × 600. One sample run
  returned median software-only drawing times: **normal 3.21 ms**,
  **cinematic-full 5.39 ms**, **cinematic-cheap 3.75 ms**, **fallback 3.02 ms**.
  This demonstrates a *real cost* to full-detail visuals and a reduction
  of that cost in the adaptive path. It does not demonstrate equivalent GPU
  performance, full-game FPS, zero lag, or superiority in all circumstances.
  Test used a synthetic 128px detail texture and a representative nearby
  water shader; the full repo renderer is not exercised.
- **Ocean detail logic:** an independently copied TypeScript implementation
  passed strict standalone typecheck and a deterministic 128×128 byte-buffer
  test. This is not the full repository typecheck or Vitest suite.

**CI state:** PR #10 has had no GitHub Actions runs/checks available through
this connector. The full app build, integrated Vitest, actual WebGL2
sprite-atlas upload, UI, 500+ ship and MIRV playtests therefore remain
unverified. GPU-driven failure of optional cinematic shaders now triggers
an attempt to recompile the original shader instead of dropping the terrain
or explosion pass, except on lost contexts.
