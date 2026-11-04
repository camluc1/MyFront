# Nation objective simulation audit — 2026-11-04

Baseline: `06a84a2ce5220d68a4ce3d3ba3cffe5383afcd43`. This audit found and corrected two integration problems: containment plans were invalidated whenever a different neighbor became the top threat, and capture candidates omitted normal overseas rivals outside `nearby()`.

Containment now retains a still-meaningful threat with entry/exit hysteresis and participates in the existing commitment/switching rules. Overseas candidates reuse the existing transport range, strength and route safety checks. A regression test crosses a real water gap and verifies that the selected objective produces a `TransportShipExecution`; forming an alliance removes that candidate. The containment regression failed against the previous implementation and passes with the fix.

## Method

Opt-in `tests/NationObjectiveSimulation.test.ts` runs the production World map (2000 × 1000), its 72 nations and flags, real EngineConfig, normal construction costs and starting gold, no human players and no bots. Country identities and geography remain fixed; only the game seed changes. It records objective transitions, construction actions, captures, attacks, alliances and minute-by-minute country/economy state. It checks finite troops, nonnegative gold and absence of friendly attacks. It stops at the first minute boundary after the engine declares a winner.

The final implementation was exercised with three distinct Hard seeds for 15 simulated minutes, an exact repeat of the first seed, a Medium run, a same-seed control with objective updates disabled, and a Hard run allowed up to 60 minutes. Earlier baseline and intermediate runs were also used to diagnose oscillation. Results below concern the final implementation unless labeled otherwise.

## Results

| Hard seed  | Countries alive at 15 min | Territorial leader | Cities | Ports | Resource industries | Attacks |
| ---------- | ------------------------: | ------------------ | -----: | ----: | ------------------: | ------: |
| frontier-a |                        19 | Greenland          |    149 |    97 |                 102 |    3145 |
| frontier-b |                        27 | Greenland          |    137 |    92 |                 100 |    2979 |
| frontier-c |                        20 | West Antarctica    |    139 |    92 |                 119 |    3162 |

All five objective kinds occurred in each of these runs. Across the three distinct seeds, instrumentation recorded 270 captures of objective tiles, 133 construction/upgrade actions initiated through the objective path, and 37 completed development objectives. These categories overlap and are not additive. Different outcomes do not imply each objective alone caused every capture.

The three fingerprints of measured objective events and final country states differed. Repeating `frontier-a` reproduced exactly the same fingerprint. This verifies measured deterministic behavior and seed variation; it is not a byte-for-byte full-engine state comparison.

The long `frontier-a` run reached the engine's victory condition by the minute-40 sample, with Ukraine leading at 497711 tiles and seven countries remaining. Greenland had led at minute 15. The run recorded 4124 attacks and continued construction through the late game; resource industry counts also fell as wars progressed. No claim is made that every seed finishes within this time.

Medium `frontier-a` had 14 countries alive, Belarus leading, 105 resource industries and 2734 attacks at minute 15. The Hard control without objective updates had 12 countries alive, Greenland at 437357 tiles, 89 resource industries and 2612 attacks. The enabled same-seed run clearly changed behavior, but one paired control cannot establish general balance or difficulty improvement.

The original containment median lifetime in seed a was 9.8 seconds, with 91 of 179 ended plans lasting less than ten seconds. After both fixes it was 35.4 seconds, with 25 of 129 below ten seconds. These are descriptive same-seed comparisons of diverging matches, not isolated causal estimates. Fast endings can still be legitimate when ownership, alliances or threats change.

No friendly attacks, negative-gold checks or nonfinite-troop checks failed in the final runs. The focused regression suite passed 185 tests with one skipped; the overseas transport assertion also passed separately after being strengthened. Type checking, scoped lint, Vite production compilation and asset-hash generation passed. The build script's `tsx` launcher hit a sandbox IPC restriction; the equivalent hash step succeeded via `node --import tsx scripts/buildAssetHashes.ts`. Sixteen unrelated combat/diplomacy failures had already been reproduced on the preceding source during the baseline audit; this is not a claim that the entire repository test suite is green.

## Reproduce

```sh
OBJECTIVE_AUDIT=1 OBJECTIVE_AUDIT_SEEDS=frontier-a,frontier-b,frontier-c,frontier-a OBJECTIVE_AUDIT_MINUTES=15 OBJECTIVE_AUDIT_OUTPUT=/tmp/objectives-hard.json npx vitest run tests/NationObjectiveSimulation.test.ts
OBJECTIVE_AUDIT=1 OBJECTIVE_AUDIT_SEEDS=frontier-a OBJECTIVE_AUDIT_MINUTES=60 OBJECTIVE_AUDIT_OUTPUT=/tmp/objectives-long.json npx vitest run tests/NationObjectiveSimulation.test.ts
```

Set `OBJECTIVE_AUDIT_DIFFICULTY=Medium` for the difficulty check or `OBJECTIVE_AUDIT_DISABLE=1` for the control. The audit is skipped in ordinary test runs. Performance timing is diagnostic only: several jobs ran concurrently, and engine ticks are not browser frame rates.

## Limits

These are AI-only engine simulations, not human or browser playtests. They establish functioning execution, deterministic variation and absence of the checked invalid states in the sampled matches. They do not guarantee that every match feels different, that every personality is equally balanced, or that no other bug exists. Geography and resource layouts were unchanged. Country-level personality counts are confounded by geography and survival; controlled unit scenarios separately test doctrine preference differences. Human playtesting should next assess whether objectives are understandable, naval threats give fair reaction time, and recovery periods feel purposeful rather than passive.
