# World winner and dominance audit — 2026-11-04

Engine revision: `c6a14f539077f2fe866e5139ce77d91c7616c099`. This follow-up examines whether different objective decisions still converge on the same dominant countries. It changes audit tooling only; production AI, doctrines, geography, costs and victory rules are unchanged.

## Design

All runs use production World (2000 × 1000), 72 nations, Hard difficulty, normal gold/troop/construction rules, fixed country identities and starting positions, no human player, and a 90-minute simulation limit. Victory is read from `game.getWinner()`, not inferred from the largest country. Time is sampled at minute boundaries, so a reported finish minute is an upper minute boundary rather than exact victory time.

- Baseline: seeds `balance-01` through `balance-12`, no tribes, engine-default five-second nation spawn immunity. This reproduces the earlier audit's setup, which is not the normal single-player lobby setup.
- Doctrine intervention: seeds 01–04, same map/positions/resources/settings, with all seven doctrine assignments cyclically rotated by three positions. This changes the country's and its neighbors' personalities; it measures their joint influence, not the isolated effect of one country's doctrine. The override exists only in the test and is restored after each case.
- Tribes and peace: seeds 01–04, original doctrines, 400 tribes spawned through the production Executor and two-minute nation peace, matching those single-player lobby defaults. Difficulty remains explicitly Hard (the UI default is Easy). Because both tribes and peace change, this cohort cannot isolate their separate effects.

The earlier audit omitted both the 400 tribes and the UI's two-minute peace. It therefore overstated how representative its configuration was. These cohorts address that limitation without pretending to be human playtests.

Territorial leadership and reserve-troop leadership are measured separately. Reserve troops do not include all deployed forces, and neither indicator alone defines total military power. City and resource-industry counts are also recorded. A brief land lead is not treated as a winner or proof of an unbeatable country. Countries are not expected to have equal win rates on an asymmetric map.

## Results

| Cohort            | Completed reports | Declared winners | Unique winners |
| ----------------- | ----------------: | ---------------: | -------------: |
| no-tribes         |                12 |               12 |             11 |
| rotated-doctrines |                 4 |                4 |              3 |
| tribes-and-peace  |                 4 |                4 |              4 |

### Baseline winners

| Country         | Wins |
| --------------- | ---: |
| Alaska          |    2 |
| Benin           |    1 |
| Ethiopia        |    1 |
| Madagascar      |    1 |
| Uruguay         |    1 |
| Yukon           |    1 |
| West Antarctica |    1 |
| Latvia          |    1 |
| Ukraine         |    1 |
| Germany         |    1 |
| Antarctica      |    1 |

### Same-seed interventions

| Seed       | Original   | Rotated doctrines | 400 tribes + 2-minute peace |
| ---------- | ---------- | ----------------- | --------------------------- |
| balance-01 | Benin      | Texas             | Quebec                      |
| balance-02 | Ethiopia   | Italy             | Mongolia                    |
| balance-03 | Madagascar | Japan             | Peru                        |
| balance-04 | Uruguay    | Texas             | Canada                      |

### Leadership checkpoints

- Baseline, minute 5, land leaders: Antarctica: 9, Taiwan: 1, Australia: 1, Nunavut: 1.
- Baseline, minute 5, reserve-troop leaders: Greenland: 3, West Antarctica: 1, Yukon: 1, Australia: 1, Pakistan: 1, Antarctica: 1, Senegal: 1, Taiwan: 1, Nunavut: 1, Finland: 1.
- Baseline, minute 15, land leaders: Antarctica: 1, Ethiopia: 1, Greenland: 1, Australia: 1, Alaska: 1, Yukon: 1, Russia: 1, Latvia: 1, Ukraine: 1, Niger: 1, Nunavut: 1, East Antarctica: 1.
- Baseline, minute 15, reserve-troop leaders: Alaska: 2, Ethiopia: 1, Greenland: 1, Australia: 1, Yukon: 1, Iceland: 1, Latvia: 1, Ukraine: 1, Taiwan: 1, Antarctica: 1, East Antarctica: 1.
- Rotated doctrines, minute 5, land leaders: Antarctica: 3, Japan: 1.
- Rotated doctrines, minute 5, reserve-troop leaders: Alaska: 1, Japan: 1, Taiwan: 1, Australia: 1.
- Rotated doctrines, minute 15, land leaders: Latvia: 1, Italy: 1, Japan: 1, Texas: 1.
- Rotated doctrines, minute 15, reserve-troop leaders: Italy: 2, Latvia: 1, Japan: 1.
- Tribes and peace, minute 5, land leaders: Antarctica: 3, West Antarctica: 1.
- Tribes and peace, minute 5, reserve-troop leaders: East Antarctica: 2, Alaska: 1, Antarctica: 1.
- Tribes and peace, minute 15, land leaders: Antarctica: 2, East Antarctica: 1, Mongolia: 1.
- Tribes and peace, minute 15, reserve-troop leaders: Antarctica: 2, East Antarctica: 1, Mongolia: 1.

## Interpretation and scope

The baseline has 11 different winners in 12 matches. Greenland won 0, Ukraine 1, and the most frequent winner was Alaska with 2 wins. At minute 15 there were 12 different territorial leaders and 11 different reserve-troop leaders. This sample does not support persistent Greenland/Ukraine domination.

Antarctica was the territorial leader at minute 5 in 9/12 baseline matches, but won only 1/12. That is a clear recurring early land advantage, not an equally concentrated distribution of winners. Its high land ranking should not be dismissed, but these observations do not justify a country-specific nerf. In the tribes-and-peace cohort there were 4 winners in 4 matches; Antarctica led at minute 30 in 2 and did not win any of those completed runs.

The rotated-doctrine cohort produced Texas twice, Italy once and Japan once. This repetition is reported rather than hidden; four intervention runs do not establish that the artificial rotation is balanced. Comparing the same four seeds shows that geography alone does not fix the winner, while changing every country's doctrine cannot identify the isolated strength of one doctrine. The original country assignments were retained.

The evidence supports retaining production balance while expanding future observations on early polar land advantage and human interaction. It does not support forcing different winners or penalizing Greenland/Ukraine based on the earlier three-run impression.

Relevant code paths: the World manifest fixes positions; `NaturalResources.ts` assigns no regional resource list to the three Antarctic nations; `Config.troopCap()` derives capacity from territory with a sublinear exponent plus city levels. These mechanisms can create distinct geographical strengths and weaknesses. Observed early Antarctic land expansion is consistent with its large accessible land mass, but this audit does not isolate a precise causal contribution of geography versus neighboring behaviors.

No country-specific penalty, forced winner rotation, randomized production personality, or global balance adjustment was introduced. The purpose is to detect persistent domination before changing shared game rules.

## Integration with the concurrent history change

While the audit ran, `a9ddff0c9ba779a6942230473c54ee298fd1840d` added persistent match history. That change was preserved. After integrating it locally, type checking and 30 objective/history/UI tests passed. A complete repeat of seed `balance-05` still ended with Alaska at minute 26 and exactly matched the earlier objective-event/final-country-state fingerprint. The twenty-cohort results above were measured on the stated c6a14f5 engine revision; this additional repeat checks compatibility rather than claiming all twenty were rerun on a9ddff0.

## Checks and reproducibility

An initial concurrent worker exited unexpectedly, and the environment reported out-of-memory kills. Inspection found that the headless harness retained view-only player/attack update buffers that GameRunner normally drains every tick. The harness now drains all corresponding buffers. The interrupted seed was rerun successfully; the first 32 minute samples matched the interrupted attempt. A complete repeat of seed 05 reproduced exactly the earlier event/final-state fingerprint. Failed/aborted attempts are excluded from the cohort counts. A typecheck process killed during the overloaded run was also rerun successfully after the simulation load dropped. This was an audit-host issue, not evidence of an engine decision failure.

The extended harness records the actual winner, ending status, doctrine intervention and per-minute standings. Type checking and scoped lint passed; the 23 objective regression tests passed, and two short rotated runs verified repeated-case mock cleanup. The long simulation cases additionally check finite troops, nonnegative gold and friendly attacks. Detailed summary data, event/final-state fingerprints and leadership counts are in [nation-balance-2026-11-04.json](audits/nation-balance-2026-11-04.json).

```sh
OBJECTIVE_AUDIT=1 OBJECTIVE_AUDIT_SEEDS=balance-01,balance-02,balance-03,balance-04,balance-05,balance-06,balance-07,balance-08,balance-09,balance-10,balance-11,balance-12 OBJECTIVE_AUDIT_MINUTES=90 OBJECTIVE_AUDIT_OUTPUT=/tmp/balance.json npx vitest run tests/NationObjectiveSimulation.test.ts
OBJECTIVE_AUDIT=1 OBJECTIVE_AUDIT_SEEDS=balance-01,balance-02,balance-03,balance-04 OBJECTIVE_AUDIT_DOCTRINE_ROTATION=3 OBJECTIVE_AUDIT_MINUTES=90 OBJECTIVE_AUDIT_OUTPUT=/tmp/rotated.json npx vitest run tests/NationObjectiveSimulation.test.ts
OBJECTIVE_AUDIT=1 OBJECTIVE_AUDIT_SEEDS=balance-01,balance-02,balance-03,balance-04 OBJECTIVE_AUDIT_BOTS=400 OBJECTIVE_AUDIT_PEACE_MINUTES=2 OBJECTIVE_AUDIT_MINUTES=90 OBJECTIVE_AUDIT_OUTPUT=/tmp/tribes.json npx vitest run tests/NationObjectiveSimulation.test.ts
```

This is a limited, deterministic AI-only sample on one map and one difficulty, not a statistical estimate of all players' win probabilities. The intervention runs share seeds and should not be pooled with baseline as independent draws. Human decisions, other maps, difficulty settings and tribe densities can change the outcomes. A lack of repeated domination here does not guarantee universal balance or subjective fun.
