# Match history and post-game analysis

Single-player games record a persistent, read-only history every 100 simulation
ticks (10 seconds), including the human and map nations. Tribes are excluded
from country rankings. Names are stored once; samples use compact numeric rows.
The observer consumes no randomness and does not affect combat or AI decisions.

History is part of the existing game snapshot. New optional fields preserve
old snapshot compatibility. Loading an older save starts a partial history at
its current simulation time; the panel explicitly identifies this limitation.
A final sample is frozen at the first game-end notification, including a
winnerless end. Further after-game play does not alter it.

Open Strategic Database > Historial to compare up to eight countries. The same
component appears in the scrolling results dialog. Choose territory, economic
or military position, recurring income, available or deployed troops, banked
gold, building count or total building levels. Hover or scrub to inspect values;
range controls zoom the time interval. Eliminated nations remain selectable. Click country buttons to show/hide curves;
a full selection disables additions without silently dropping a country. The
"Yo + cinco líderes territoriales" preset includes the human and current top
five living territorial leaders, deduplicating the human if already in the top five.

Recurring income includes workers, extraction, trade ships and trains, but
excludes conquests, donations and piracy. The rate uses up to two simulation
minutes; the initial partial window is used. Existing gross-income views retain
their gross-received meaning, with the intelligence rate window aligned to two
minutes. Resource payouts preserve existing work-income statistics and also
record farm/mine/oil/gas production separately for every country, including AI.

Highlights describe observed territorial leadership (sustained 30 seconds),
eliminations, sustained crossings relative to the selected country, and the
rival's position ten minutes later when that data exists. These timings have
sample resolution; they do not infer why a nation declined. Ties share rank.
The summary includes maximum territory, best territorial position, maximum
drawdown (including elimination), and sampled time in first position.

Exact casualty attribution and a comprehensive expenditure ledger are not
implemented here. Deployed troops are shown separately so mobilization is not
reported as loss. Historical source totals start at the recording-enabled build;
old saves cannot reconstruct earlier source breakdowns.

Validation includes history longer than thirty minutes, snapshot round trips,
legacy saves, freeze after game end, multiplayer exclusion, human leadership,
eliminated rivals, payout accounting, common SVG axes and stale-response guards.
Interactive human playtesting remains required for final visual/balance review.
