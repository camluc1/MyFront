# FRONTIER — Cinematic combat + Ultra visual pass (Development)

Implementation branch: `frontier/development`. Main and server simulation remain untouched.

## Included — three production stages

1. **Combat:** a distinct blue-white SAM intercept (the original shockwave remains), directional SAM and shell exhaust, improved vessel course turns, cooler warship-loss flash, and *real new-projectile* SAM/naval muzzle flashes.
2. **Water and smoke:** the existing R8UI terrain texture selects between a new short blue water splash and the **unchanged accepted land-impact sequence** for conventional shells; animated foam and constrained Ultra stern turbulence reuse the existing vessel quad. The nuclear ground artwork, fallout and shockwave are unchanged. Medium/High cloud-bake ray budgets are now 16/22 vs Ultra 28, all only **once** on renderer initialization. No additional atlas textures, water simulation or emitter.
3. **Ultra polish:** added close-zoom naval deck detail, material-aware water spray, brief naval exhaust vapor, and a slightly more transparent ordinary political fill (not alternate view or fallout). **Classic remains unchanged** where shader variants guard these changes; High and Ultra share combat-family identity, Ultra adds detail.

## Runtime and memory boundaries

- No changes to game rules, damage, simulation tick, multiplayer protocol or server.
- An existing sprite FX draw call handles muzzle flashes and water impacts. No extra new render passes or persistent sprite textures.
- An existing terrain R8UI texture is sampled only for cinematic conventional impacts, not generated again.
- Launch detection uses one set of active SAM/shell IDs per simulation update; new launches are limited to 20 (Media/High) or 32 (Ultra) per tick. Naval launch matching uses 16-tile spatial buckets and same-owner nearby warships.
- FX instances remain bounded by the existing per-quality limits (320/480/640), and explosions are viewport culled.
- No fake launch flashes when loading an initial snapshot or seeking backward.
- Preserves reduced-motion handling for flash intensity, keeps visual settings manual.

## Validation to perform before release

Code-level wiring/source guards were inspected, but **the integrated app build, WebGL2 GPU/browser run and hardware FPS measurements are not completed in this chat**. On a local Node 24.15+/npm 12.1+ checkout run:

```sh
npm ci
npm run typecheck
npx vitest run tests/WeaponLaunchVisuals.test.ts
npm run build-dev
```

Perform real game QA at representative low- and high-end hardware and zoom:

- SAM launch and midair interception; MIRV multi-warhead barrage; 100+ simultaneous shells.
- Warship fire near owned and enemy fleets, turning from a standstill, shell splash on open sea versus original land impact.
- Zoom-out and political overlays (including alternate view), reduced-motion, Classic, Media, High and Ultra.
- Snapshot load/replay rewind must not flash every projectile.
- Capture median, p95/p99 frame times, GPU memory, first-load cloud baking and 500+ warship stress tests.

Any performance or visual rating remains unverified until those tests.
