import {
  UnitType,
  type ResourceEconomyInfo,
} from "@openfront/engine-api/game/GameTypes";
import { resourceAt } from "@openfront/engine-lib/game/NaturalResources";
import {
  resourceProduction,
  RESOURCE_MAX_LEVEL,
  resourceMatchesBuilding,
} from "@openfront/engine-lib/game/ResourceProduction";
import type { Game, Player, Unit } from "./Game";

export const RESOURCE_BUILDINGS = [
  UnitType.Farm,
  UnitType.Mine,
  UnitType.OilWell,
  UnitType.GasPlant,
];
/** Resource upgrades cost half the current new-build price, including bulk escalation. */
export function structureUpgradeCost(
  game: Game,
  player: Player,
  type: UnitType,
  extraLevels = 0,
): bigint {
  const buildCost = game.unitInfo(type).cost(game, player, extraLevels);
  return RESOURCE_BUILDINGS.includes(type) ? buildCost / 2n : buildCost;
}
/** Productive or under construction on a usable site; exhausted sites free the AI investment slot. */
export function hasUsableResourceSite(game: Game, unit: Unit): boolean {
  const site = resourceAt(
    game.map(),
    game.config().gameConfig().gameMap,
    unit.tile(),
  );
  return (
    unit.isActive() &&
    !unit.isMarkedForDeletion() &&
    site !== null &&
    resourceMatchesBuilding(unit.type(), site.resource) &&
    (site.resource === "fertile_soil" ||
      game.resourceRemaining(site.id, site.capacity) > 0)
  );
}
/** Shared by authorization, AI and economic explanations. Other buildings are unaffected. */
export function resourceUpgradeBlockReason(
  game: Game,
  unit: Unit,
): ResourceEconomyInfo["reason"] {
  if (!RESOURCE_BUILDINGS.includes(unit.type())) return undefined;
  const site = resourceAt(
    game.map(),
    game.config().gameConfig().gameMap,
    unit.tile(),
  );
  if (!site) return "no_resource";
  if (!resourceMatchesBuilding(unit.type(), site.resource))
    return "wrong_resource";
  if (
    site.resource !== "fertile_soil" &&
    game.resourceRemaining(site.id, site.capacity) <= 0
  )
    return "exhausted";
  if (unit.level() >= RESOURCE_MAX_LEVEL) return "max_level";
  return undefined;
}
export function resourceRailMultiplier(game: Game, unit: Unit): number {
  if (unit.type() !== UnitType.Mine) return 1;
  const cluster = game
    .railNetwork()
    .stationManager()
    .findStation(unit)
    ?.getCluster();
  return (cluster ? Array.from(cluster.stations) : []).some(
    (s) =>
      s.isActive() &&
      s.unit.type() === UnitType.Factory &&
      s.unit.owner() === unit.owner(),
  )
    ? 1.4
    : 1;
}
export function resourceUnitIncome(
  game: Game,
  unit: Unit,
  level = unit.level(),
): number {
  const site = resourceAt(
    game.map(),
    game.config().gameConfig().gameMap,
    unit.tile(),
  );
  if (
    !site ||
    unit.isUnderConstruction() ||
    !unit.isActive() ||
    game.resourceRemaining(site.id, site.capacity) <= 0
  )
    return 0;
  return resourceProduction(
    site.resource,
    site.quality,
    level,
    resourceRailMultiplier(game, unit),
    game.config().productionGoldMultiplier(unit.owner()),
  );
}
export function resourceEconomyInfo(
  game: Game,
  player: Player,
  type: UnitType,
  tile: number,
  canBuild: number | false,
  canUpgrade: number | false,
  cost: bigint,
  newPlacement = false,
): ResourceEconomyInfo {
  const nearby = game
    .nearbyUnits(tile, game.config().structureMinDist(), type, undefined, true)
    .sort((a, b) => a.distSquared - b.distSquared)[0]?.unit;
  const unit =
    !newPlacement &&
    (canUpgrade !== false || canBuild === false) &&
    nearby?.owner() === player
      ? nearby
      : undefined;
  const placement = unit?.tile() ?? (canBuild !== false ? canBuild : tile);
  const site = resourceAt(
    game.map(),
    game.config().gameConfig().gameMap,
    placement,
  );
  const compatible = site && resourceMatchesBuilding(type, site.resource);
  const remaining = site
    ? site.resource === "fertile_soil"
      ? null
      : game.resourceRemaining(site.id, site.capacity)
    : null;
  let reason: ResourceEconomyInfo["reason"];
  if (game.config().isUnitDisabled(type)) reason = "disabled";
  else if (game.inSpawnPhase()) reason = "spawn";
  else if (!site) reason = "no_resource";
  else if (!compatible) reason = "wrong_resource";
  else if (game.owner(placement) !== player) reason = "not_owned";
  else if (remaining === 0) reason = "exhausted";
  else if (unit?.isUnderConstruction()) reason = "under_construction";
  else if (unit?.isMarkedForDeletion()) reason = "deleting";
  else if (unit && resourceUpgradeBlockReason(game, unit))
    reason = resourceUpgradeBlockReason(game, unit);
  else if (
    !unit &&
    game
      .nearbyUnits(
        placement,
        site.radius * 3,
        RESOURCE_BUILDINGS,
        undefined,
        true,
      )
      .some(
        ({ unit: u }) =>
          u.isActive() &&
          resourceAt(game.map(), game.config().gameConfig().gameMap, u.tile())
            ?.id === site.id,
      )
  )
    reason = "occupied";
  else if (player.gold() < cost) reason = "money";
  else if (canBuild === false && canUpgrade === false) reason = "spacing";
  const railwayMultiplier = unit ? resourceRailMultiplier(game, unit) : 1;
  const level = unit?.level() ?? 0;
  const production =
    site && compatible && remaining !== 0
      ? resourceProduction(
          site.resource,
          site.quality,
          Math.max(1, level),
          railwayMultiplier,
          game.config().productionGoldMultiplier(player),
        )
      : 0;
  const current = unit ? resourceUnitIncome(game, unit) : 0;
  const next =
    site && compatible && remaining !== 0
      ? resourceProduction(
          site.resource,
          site.quality,
          level + 1,
          railwayMultiplier,
          game.config().productionGoldMultiplier(player),
        )
      : 0;
  return {
    resource: site?.resource,
    quality: site?.quality,
    level,
    remainingCycles: remaining,
    renewable: site?.resource === "fertile_soil",
    productionPerCycle: production,
    currentPerCycle: current,
    nextPerCycle: next,
    upgradeGainPerCycle:
      unit && !resourceUpgradeBlockReason(game, unit)
        ? Math.max(0, next - current)
        : 0,
    railway:
      type !== UnitType.Mine
        ? "not_applicable"
        : !unit
          ? "pending"
          : railwayMultiplier > 1
            ? "active"
            : "inactive",
    reason,
  };
}
