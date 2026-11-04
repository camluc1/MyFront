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
preserve a target count. Resource markers and building placement are unchanged.

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
