# FRONTIER — Natural-resource economy (implementation)

## Design contract

- Native mechanic; no DLC branding, no second currency and no material inventories.
- A geographical resource is intrinsic to the map, **not** to current ownership.
- A player must own a suitable site to build there; capture transfers a building
  but does not move or reset the deposit.
- Original cities, ports, railways, nuclear weapons, gold and troop rules stay intact.

## Map generation

The World map has approximate mineral/fertility profiles for every one of its
72 named region/nation entries, plus fixed map-coordinate anchors. Static
resource circles are generated near those anchors on land. This is **approximate
geography**, not a verified survey of deposit locations. Other maps use seeded,
spatially clustered deposits leaving many tiles empty. Map generation is
initialized before terrain alterations and yields identical results on all
clients for a matching map.

Resource footprints are separated across all resource types by their combined
radii plus a small map-scaled gap. When a proposed site collides, generation
searches deterministically for nearby land within a bounded regional distance.
If there is no room, that deposit is omitted; circles are never stacked to
preserve a target count. Building placement is unchanged. Resource markers are anchored to the center
of their own deposit, with no grid displacement or connector lines.

This changes generated deposit coordinates and IDs compared with older builds.
Use the matching game version for existing saves/replays; migration of old
resource consumption and extractor locations is not included in this change.

Resources: fertile soil, oil, gas, coal, gold, silver, copper, iron, lithium,
uranium. Four quality levels. Agriculture renews; other deposits have finite
production-cycle reserves. Shared consumed reserves persist in game snapshots.

## Buildings and profitability

- Farm (fertile soil), Mine (coal + minerals), Oil Well (oil), Gas Plant (gas).
- Core `ConstructionExecution` handles original placement, ownership, build
  duration and upgrade behavior. Each extractor is one unit type; mines read
  their mineral from the static deposit, so no dedicated mine per mineral.
- Construction starts at 100k/125k/175k/150k gold for
  Farm/Mine/Oil Well/Gas Plant, subject to existing escalating unit cost model.
- Production is paid directly in gold every 100 ticks (10 seconds); no stocks.
  Base gold per interval at level 1, before quality or gold multipliers:
  fertile soil 11,500; oil 22,000; gas 17,500; coal 9,000; gold 19,000;
  silver 15,000; copper 12,000; iron 9,000; lithium 16,500; uranium 18,500.
  Quality multiplier = 0.75 + quality * 0.25.
  Level multiplier = 1 + 0.30 * (level - 1), capped to 50 levels.
  These are **unvalidated initial balance parameters**, not proven port-equivalent
  earnings. Real ports have variable ship availability and trade income.
- Mines form real rail stations around factories. When the mine has a station
  in the same live rail cluster as a same-owner factory, its periodic gold is
  increased by 40%, without changing original train commerce behavior.

## User interface and AI

- Custom icons and names for all four constructions, in build menu and hotbar.
- Resource layer toggles independently from the main terrain/layers.
- Selecting a resource building for placement temporarily enables that layer,
  then restores the player's manually chosen visibility on cancellation.
- AI nations can invest in owned deposits, improve existing production
  facilities, and use them according to skill level.

## Validation limitations

The source has been changed directly on `frontier/development` with
`[skip ci]`. **GitHub Actions were not executed**. No integrated TypeScript
compile, unit-test run, multiplayer match, save/load replay, balance simulation
or GPU rendering verification was performed in this environment.
Treat these changes as an unverified integration until those checks pass.

## Economic decision information

The engine's buildable-unit query now returns optional resource economics for
resource buildings: deposit and quality, current/next-level gold per 10-second
cycle, marginal single-level upgrade gain, renewable status or remaining
production cycles, and the actual connected-factory railway bonus. The query
also explains disabled buildings, spawn phase, unsuitable deposits, ownership,
depletion, occupied sites, construction/deletion, affordability and spacing.
These are read-only queries; they never consume reserves or grant income.

The production calculation and connected-factory check are shared with the
existing execution. Costs, resource consumption and payout timing are unchanged.
New mines exclude the railway bonus until their connection is actually built.
The preview, build menu and radial tooltips expose these facts; upgrade figures
are explicitly for one next level even when a bulk upgrade button is selected.

The single-player intelligence Economy tab queries current resource production
capacity for the selected nation, split into farms, mines, oil wells and gas
plants. Values are labelled estimates per minute, not historical money earned.
The aggregate earned-income history remains the separate existing metric.

In live games, the terrain image retains the resource footprints while labels
are projected into screen space at a fixed 11 CSS pixels. Labels that collide
at distant zooms are culled, never displaced to another deposit or water.
The replay viewer without a camera transform retains its raster label fallback.

Economic details use translation keys in en.json. Visual in-game playtesting
is still required in addition to the targeted automated checks.

## Resource investment authorization

Resource upgrades (Farm, Mine, Oil Well and Gas Plant) cost 50% of the current
price of constructing another building of the same type. New construction
keeps its full price. Every bulk-upgrade step uses its own escalated new-build
price before the discount, rounded down to whole gold. Execution, affordability,
AI and previews share this rule. The 30% base-production increase and productive
level cap of 50 are unchanged. Original buildings keep their upgrade prices.

Only active extractors on compatible, non-depleted deposits count toward the
nation AI resource-installation quota. Sites still under construction count as
committed capacity; exhausted, invalid and deletion-marked sites do not. An
exhausted extractor stays on the map but no longer prevents investment in a
new deposit. The one-extractor-per-deposit rule still applies.

Resource construction searches the existing owned/spacing-valid candidate list
in nearest-first order and filters each candidate for compatible resource,
remaining reserves and deposit occupancy. A failing first candidate no longer
prevents using a later valid tile. Original non-resource placement is unchanged.

Resource upgrade authorization is shared by the engine, preview and AI:
non-depleted compatible deposits only, up to productive level 50. Bulk upgrade
quotes contain only the remaining productive levels; oversized execution
requests stop at 50 and charge only executed levels. Direct upgrade calls also
reject invalid resource upgrades. These restrictions do not cap original
cities, ports, factories or other non-resource structures.
