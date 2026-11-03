# Natural resources — phase 1 (geographic profiles only)

This commit adds a typed resource catalog and an explicitly authored broad
resource profile for all 72 nation/region entries of `map-generator/assets/maps/world/info.json`.
These are **not yet deposits on the actual map**, and they do not affect gameplay.

## Verified existing gameplay
- `PlayerExecution` awards worker gold via `goldAdditionRate`. Troops are
  explicitly stored, but there is no separately managed worker stock.
- Ports yield maritime trade, and factories activate train infrastructure.
- `EngineConfig` prices the first port at 125,000 gold, then escalates costs.
- `ConstructionExecution`, `BuildMenu`, upgrades and snapshots require
  explicit registration for new structures.
- No existing electricity, fuel, mineral-inventory or industrial-production
  system was identified in reviewed code.

## Required follow-on implementation
1. Draw actual static resource areas on the real world map, using terrain
   coordinates and regional reference data; do NOT infer deposits from owner
   or country spawn point. Extend the process to regional and fictitious maps.
2. Add sparse deterministic deposits, abundance and finite reserves, with a
   compact serialization and map overlay.
3. Integrate farms, a generic mineral mine, oil wells and gas facilities with
   current building costs, upgrading, ownership and income, initially balanced
   against port income. Add coal extraction only where useful.
4. Introduce raw material stocks only together with real production and
   consumers; do not silently break pre-existing nuclear or factory mechanics.
5. Implement overlay, icons, build preview, nation AI and multiplayer sync.
6. Verify with typecheck, gameplay tests and performance before release.

Do not advertise phase 1 as a functioning extraction system. No CI workflows
were executed as part of this read-only review and data commit.
