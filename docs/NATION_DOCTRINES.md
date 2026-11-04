# Nation doctrine probabilities

Country doctrines currently apply to nations in both single-player and
multiplayer. The single-player War Director and protection/pressure systems
have their own mode guards; assigning a doctrine does not enable those systems
in multiplayer.

`PseudoRandom.chance(n)` means probability `1/n`, not `n` percent. Doctrine
weights and naval multipliers therefore operate on the probability numerator.
The global PRNG and `chance()` implementation are unchanged.

## Alliance requests

`allianceRequestWeight` is a relative weight, not a denominator or percentage.
Weight 30 retains the original neutral probability of 1/30 per check. The roll
uses weight/900, so larger weights make requests more likely without turning
the values into 12–42% request rates.

| Doctrine | Weight | Probability per check |
| --- | ---: | ---: |
| Diplomatic | 42 | 4.667% |
| Industrialist | 26 | 2.889% |
| Strategist | 24 | 2.667% |
| Opportunist | 20 | 2.222% |
| Imperialist | 18 | 2.000% |
| Survivor | 14 | 1.556% |
| Militarist | 12 | 1.333% |

These are only the random gate probabilities. Eligible player type, request
cooldowns, relations, threat assessment and all other alliance checks still
determine whether an alliance is actually requested or accepted.

## Naval attacks

The normal random-boat gate has base probability 1/5 without bordering enemies
and 1/10 with bordering enemies. Multiply that probability by
`navalAttackMultiplier`; do not multiply its inverse denominator. For example,
0.75 gives 15%/7.5%, 1 gives 20%/10%, and 1.1 gives 22%/11%. The integer draw
retains the 1.05 multiplier's 5% relative increase without rounding it away.

One random value is consumed per gate. Neutral doctrine outcomes and random
generator state match the legacy gates. Existing saves/replays must use their
matching engine version because non-neutral doctrine decisions change.
