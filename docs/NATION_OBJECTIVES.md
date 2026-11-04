# Single-player nation objectives

Objectives are temporary plans, not additional personalities. The seven existing doctrines remain unchanged. Every eligible nation can evaluate development, capture, consolidation, maritime access and containment. Multiplayer and the scripted tutorial retain their previous decision paths. Easy nations evaluate domestic development, ports and defense, without gaining the higher-difficulty offensive campaign behavior.

## Plans and execution

| Objective   | Opportunity                                                                                                 | Execution and completion                                                                                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Develop     | A compatible, affordable owned deposit or productive extractor with enough reserves to repay the investment | Prioritize one authorized construction or upgrade at that site; retain the existing industry quota, normal construction pacing, initial build order and emergency defense. Existing factory ratios still gate factory building. Finish once the installation is started or its level increases. |
| Capture     | An accessible rival's usable resource deposit, city, factory or port                                        | Prefer that rival in the existing campaign attack slot. Finish when ownership of the goal tile changes; a successful capture starts consolidation.                                                                                                                                              |
| Consolidate | A newly captured prize or substantial incoming attack                                                       | Reduce discretionary non-bot troop commitments, preserve retaliation, and attempt a spaced defense post only near an exposed frontier. Finish after recovery or a bounded stabilization interval.                                                                                               |
| Maritime    | A viable owned coast without a port, or an adjacent rival's useful coast when landlocked                    | Build a first port through normal validation or prefer a campaign against the coastal rival. A captured coast first enters consolidation; port development can follow as a new objective. Tiny isolated ponds do not qualify.                                                                   |
| Contain     | A stronger threatening neighbor or significant ongoing aggression, after the opening two minutes            | Prefer neutral partners exposed to the same threat, subject to existing alliance exclusions. Prefer an offensive campaign only when relative strength allows it; do not force suicidal attacks or break alliances.                                                                              |

A maritime operation remains a means to capture resources or infrastructure. There is no exclusive naval personality. Plans do not grant income, troops, discounts or new abilities. Existing build costs, level caps, spacing, resource reserves, alliance executions, troop reserve checks, spawn immunity, naval route safety and simultaneous naval-pressure limits remain authoritative.

## Choosing and reconsidering

Candidates use expected economic/strategic benefit, investment or military cost, relative strength, incoming pressure, distance and the rival's committed troops. Each doctrine weights those factors differently and has modest goal preferences. An industrialist can still conquer; a militarist can still invest. Feasibility filtering is common, not the ranking.

Selection uses a deterministic game/nation/decision hash to choose among candidates within ten utility points of the best positive opportunity. It does not consume the existing behavior PRNG. This creates variation between similarly useful choices, not arbitrary selection of bad plans.

The plan is reviewed every 300 simulation ticks (30 seconds), retains a valid commitment for at least 600 ticks, and subsequently requires a 15-point improvement to switch to another candidate. Completion, ownership changes, alliances, depletion, major relative-strength changes and urgent defense can override that commitment. Ordinary plans expire after 1800 ticks; consolidation has a 600-tick upper bound and may finish after 300 ticks when recovered. An expired/invalid plan gets a 600-tick cooldown. No suitable candidate means normal legacy decisions continue.

Economic candidates reserve a second construction/upgrade price for other needs. Their first five minutes of marginal production, truncated to remaining reserves, must repay the cost. These are initial tuning choices, not validated balance claims.

## Persistence and visibility

The Nation execution snapshot is version 3, migrating version 2 to an empty plan. The target, time bounds, review time, selection counter and cooldown persist. Transient behavior hints are reconstructed on load. Old saves can migrate structurally; continuation uses the new AI rules and is not a promise of identical old-version replay outcomes.

The existing player-profile worker query exposes a read-only objective in single-player intelligence. The dashboard shows the actual plan and target country, including an idle state, with stale-response protection. It does not infer a plan from a doctrine name.

## Scope and validation limits

Capture plans select a prize and a rival; existing land attacks and boat-route selection still determine the tactical path. This is not precise steering of armies to a chosen tile, a new peace treaty system, or a new victory condition. Changing resource distributions was not part of this change.

Tests cover personality trade-offs, bounded deterministic variety, actual economic construction/upgrades, exhausted and low-reserve sites, allied/unreachable rivals, coast acquisition and port construction, capture-to-consolidation transitions, urgent defense, expiry, mode exclusions, read-only queries, UI query races and save/load continuation. Integrated nation snapshot simulations exercise real attacks and building behavior. Interactive playtesting is still needed to tune decision frequency, personality differences and pacing.
