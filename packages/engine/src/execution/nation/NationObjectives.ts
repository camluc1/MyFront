import {
  Difficulty,
  GameType,
  NationObjectiveKind,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  resourceDeposits,
  type ResourceDeposit,
} from "@openfront/engine-lib/game/NaturalResources";
import { resourceProduction } from "@openfront/engine-lib/game/ResourceProduction";
import { simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import type { Game, Player } from "../../game/Game";
import {
  RESOURCE_BUILDINGS,
  hasUsableResourceSite,
  resourceRailMultiplier,
  structureUpgradeCost,
} from "../../game/ResourceEconomy";
import type { NationDoctrineId } from "./NationDoctrine";

export const NationObjectiveSchema = z.object({
  kind: z.enum(["develop", "capture", "consolidate", "maritime", "contain"]),
  targetSmallID: z.number().int().nonnegative().nullable(),
  tile: z.number().int().nonnegative().nullable(),
  siteId: z.number().int().nonnegative().nullable(),
  unitId: z.number().int().nonnegative().nullable(),
  initialLevel: z.number().int().nonnegative(),
  startedTick: z.number().int().nonnegative(),
  expiresTick: z.number().int().nonnegative(),
  // Absent until the first actual land campaign launch; old saves remain valid.
  progress: z
    .object({
      bestDistance: z.number().nonnegative(),
      lastProgressTick: z.number().int().nonnegative(),
      attempts: z.number().int().nonnegative(),
    })
    .optional(),
});
export type NationObjective = z.infer<typeof NationObjectiveSchema>;
export interface ObjectiveCandidate {
  kind: NationObjectiveKind;
  targetSmallID: number | null;
  tile: number | null;
  siteId: number | null;
  unitId: number | null;
  initialLevel: number;
  benefit: number;
  cost: number;
  risk: number;
  opportunity: number;
}
interface Priorities {
  benefit: number;
  cost: number;
  risk: number;
  opportunity: number;
  kinds: Record<NationObjectiveKind, number>;
}
// Same evidence, different trade-offs. Biases never bypass feasibility checks.
export const OBJECTIVE_PRIORITIES: Record<NationDoctrineId, Priorities> = {
  imperialist: {
    benefit: 110,
    cost: 45,
    risk: 55,
    opportunity: 35,
    kinds: {
      develop: 0,
      capture: 18,
      consolidate: -4,
      maritime: 8,
      contain: 0,
    },
  },
  militarist: {
    benefit: 100,
    cost: 35,
    risk: 40,
    opportunity: 40,
    kinds: {
      develop: -6,
      capture: 14,
      consolidate: 0,
      maritime: 0,
      contain: 12,
    },
  },
  strategist: {
    benefit: 110,
    cost: 70,
    risk: 95,
    opportunity: 55,
    kinds: { develop: 4, capture: 4, consolidate: 12, maritime: 4, contain: 8 },
  },
  opportunist: {
    benefit: 95,
    cost: 65,
    risk: 70,
    opportunity: 100,
    kinds: {
      develop: 0,
      capture: 8,
      consolidate: -4,
      maritime: 6,
      contain: -4,
    },
  },
  industrialist: {
    benefit: 125,
    cost: 80,
    risk: 100,
    opportunity: 25,
    kinds: {
      develop: 22,
      capture: 2,
      consolidate: 8,
      maritime: 4,
      contain: -5,
    },
  },
  diplomatic: {
    benefit: 100,
    cost: 65,
    risk: 100,
    opportunity: 40,
    kinds: {
      develop: 6,
      capture: -8,
      consolidate: 8,
      maritime: 6,
      contain: 22,
    },
  },
  survivor: {
    benefit: 95,
    cost: 85,
    risk: 135,
    opportunity: 35,
    kinds: {
      develop: 6,
      capture: -12,
      consolidate: 24,
      maritime: -5,
      contain: 8,
    },
  },
};
export function objectiveKey(
  c: Pick<ObjectiveCandidate, "kind" | "tile" | "targetSmallID">,
): string {
  return `${c.kind}:${c.tile}:${c.targetSmallID}`;
}
export function objectiveScore(
  c: ObjectiveCandidate,
  doctrine: NationDoctrineId,
): number {
  const w = OBJECTIVE_PRIORITIES[doctrine];
  return (
    (c.benefit * w.benefit -
      c.cost * w.cost -
      c.risk * w.risk +
      c.opportunity * w.opportunity) /
      100 +
    w.kinds[c.kind]
  );
}
/** Stable diversity within 10 utility points of the best viable choice only. */
export function chooseObjective(
  candidates: ObjectiveCandidate[],
  doctrine: NationDoctrineId,
  seed: string,
): ObjectiveCandidate | null {
  const ranked = candidates
    .map((c) => ({ c, score: objectiveScore(c, doctrine) }))
    .filter((x) => x.score >= 12)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (objectiveKey(a.c) < objectiveKey(b.c)
          ? -1
          : objectiveKey(a.c) > objectiveKey(b.c)
            ? 1
            : 0),
    );
  if (!ranked.length) return null;
  const choices = ranked.filter((x) => x.score >= ranked[0].score - 10);
  // String comparison avoids host locale dependence in the actual simulation.
  choices.sort((a, b) =>
    objectiveKey(a.c) < objectiveKey(b.c)
      ? -1
      : objectiveKey(a.c) > objectiveKey(b.c)
        ? 1
        : 0,
  );
  return choices[(simpleHash(seed) >>> 0) % choices.length].c;
}
export function objectivesEnabled(game: Game): boolean {
  const config = game.config().gameConfig();
  return config.gameType === GameType.Singleplayer && !config.tutorial;
}
export function resourceBuilding(site: ResourceDeposit): UnitType {
  return site.resource === "fertile_soil"
    ? UnitType.Farm
    : site.resource === "oil"
      ? UnitType.OilWell
      : site.resource === "gas"
        ? UnitType.GasPlant
        : UnitType.Mine;
}
function usable(game: Game, site: ResourceDeposit): boolean {
  return (
    site.resource === "fertile_soil" ||
    game.resourceRemaining(site.id, site.capacity) > 0
  );
}
function candidate(
  kind: NationObjectiveKind,
  tile: number | null,
  target: Player | null,
  benefit: number,
  cost: number,
  risk: number,
  opportunity = 0,
): ObjectiveCandidate {
  return {
    kind,
    tile,
    targetSmallID: target?.smallID() ?? null,
    siteId: null,
    unitId: null,
    initialLevel: 0,
    benefit,
    cost,
    risk,
    opportunity,
  };
}
/** Evaluate the existing threat itself, not whether it still ranks first among all neighbors. */
export function containmentThreatScore(
  game: Game,
  player: Player,
  other: Player,
  retaining = false,
): number | null {
  if (
    game.elapsedGameSeconds() < 120 ||
    other === player ||
    !other.isAlive() ||
    player.isFriendly(other) ||
    other.type() === PlayerType.Bot ||
    !player.sharesBorderWith(other)
  )
    return null;
  const incoming = player
    .incomingAttacks()
    .filter((a) => a.attacker() === other)
    .reduce((n, a) => n + a.troops(), 0);
  const landRatio = other.numTilesOwned() / Math.max(1, player.numTilesOwned());
  const strengthRatio =
    (other.troops() + game.config().maxTroops(other) * 0.15) /
    Math.max(1, player.troops() + game.config().maxTroops(player) * 0.15);
  // Small fluctuations should not repeatedly end and recreate a still-useful plan.
  if (
    incoming < Math.max(1000, player.troops() * (retaining ? 0.1 : 0.15)) &&
    !(
      landRatio >= (retaining ? 1.45 : 1.6) &&
      strengthRatio >= (retaining ? 1.1 : 1.2)
    )
  )
    return null;
  return strengthRatio + incoming / Math.max(1, player.troops());
}
export function objectiveThreat(game: Game, player: Player): Player | null {
  let best: Player | null = null;
  let bestScore = 0;
  for (const other of player.nearby()) {
    if (!other.isPlayer()) continue;
    const score = containmentThreatScore(game, player, other);
    if (
      score !== null &&
      (score > bestScore ||
        (score === bestScore &&
          best !== null &&
          other.smallID() < best.smallID()))
    ) {
      best = other;
      bestScore = score;
    }
  }
  return best;
}
/** A usable coast must lead to ocean or a substantial shared water body, not a decorative pond. */
export function usefulCoast(game: Game, player: Player): number | null {
  const shared = game.sharedWaterComponents(player);
  if (shared === null) return null;
  // Bound work on huge borders; keep the sample deterministic.
  const tiles = Array.from(player.borderTiles());
  const step = Math.max(1, Math.ceil(tiles.length / 256));
  for (let i = 0; i < tiles.length; i += step) {
    const tile = tiles[i];
    if (!game.isShore(tile)) continue;
    for (const n of game.neighbors(tile)) {
      if (!game.isWater(n)) continue;
      if (game.isOcean(n)) return tile;
      const component = game.getWaterComponent(n);
      if (
        component !== null &&
        shared.has(component) &&
        (game.getWaterComponentSize(n) ?? 0) >= 3000
      )
        return tile;
    }
  }
  return null;
}

export function objectiveCandidates(
  game: Game,
  player: Player,
  canReach: (p: Player) => boolean,
  current: NationObjective | null = null,
  overseas: readonly Player[] = [],
): ObjectiveCandidate[] {
  if (!objectivesEnabled(game)) return [];
  const result: ObjectiveCandidate[] = [];
  const sites = resourceDeposits(
    game.map(),
    game.config().gameConfig().gameMap,
  );
  const units = player.units(RESOURCE_BUILDINGS);
  const ownStrength = Math.max(
    1,
    player.troops() + game.config().maxTroops(player) * 0.15,
  );
  const incoming = player.incomingAttacks().reduce((n, a) => n + a.troops(), 0);
  const pressure = Math.min(
    100,
    (incoming / Math.max(1, player.troops())) * 100,
  );
  const ownCoast = usefulCoast(game, player);
  const borderTiles = Array.from(player.borderTiles());
  const borderStep = Math.max(1, Math.ceil(borderTiles.length / 64));
  const distanceCost = (tile: number): number => {
    let distance = game.width() + game.height();
    for (let i = 0; i < borderTiles.length; i += borderStep)
      distance = Math.min(distance, game.manhattanDist(borderTiles[i], tile));
    return Math.min(
      30,
      (distance * 100) / Math.max(1, game.width() + game.height()),
    );
  };
  for (const site of sites) {
    const tile = game.ref(site.x, site.y);
    if (game.owner(tile) !== player || !usable(game, site)) continue;
    const type = resourceBuilding(site);
    if (game.config().isUnitDisabled(type)) continue;
    const unit = units.find(
      (u) =>
        game.euclideanDistSquared(u.tile(), tile) <= site.radius * site.radius,
    );
    const cityCount = game.config().isUnitDisabled(UnitType.City)
      ? Math.max(1, Math.floor(player.numTilesOwned() / 2000))
      : player.unitsOwned(UnitType.City);
    if (
      !unit &&
      units.filter((u) => hasUsableResourceSite(game, u)).length >=
        Math.max(1, Math.min(9, Math.ceil(cityCount * 0.8)))
    )
      continue;
    if (
      unit
        ? !player.canUpgradeUnit(unit)
        : player.canBuild(type, tile) === false
    )
      continue;
    const cost = unit
      ? structureUpgradeCost(game, player, type)
      : game.unitInfo(type).cost(game, player);
    // Leave a budget for the normal economy/defense, and reject upgrades that cannot repay before depletion.
    if (player.gold() < cost * 2n) continue;
    const level = unit?.level() ?? 0;
    const rail = unit ? resourceRailMultiplier(game, unit) : 1;
    const goldMultiplier = game.config().productionGoldMultiplier(player);
    const gain =
      resourceProduction(
        site.resource,
        site.quality,
        level + 1,
        rail,
        goldMultiplier,
      ) -
      (level
        ? resourceProduction(
            site.resource,
            site.quality,
            level,
            rail,
            goldMultiplier,
          )
        : 0);
    const cycles =
      site.resource === "fertile_soil"
        ? 30
        : Math.min(30, game.resourceRemaining(site.id, site.capacity));
    if (gain * cycles <= Number(cost)) continue;
    const c = candidate(
      "develop",
      unit?.tile() ?? tile,
      null,
      Math.min(95, 30 + ((gain * cycles) / Math.max(1, Number(cost))) * 12),
      (Number(cost) / Math.max(1, Number(player.gold()))) * 100,
      pressure,
    );
    c.siteId = site.id;
    c.unitId = unit?.id() ?? null;
    c.initialLevel = level;
    result.push(c);
  }
  if (incoming > Math.max(1000, player.troops() * 0.2)) {
    const tile =
      units[0]?.tile() ?? player.borderTiles().values().next().value ?? null;
    result.push(
      candidate("consolidate", tile, null, 90, 10, 0, Math.min(60, pressure)),
    );
  }
  if (
    ownCoast !== null &&
    !game.config().isUnitDisabled(UnitType.Port) &&
    player.units(UnitType.Port).length === 0
  ) {
    const cost = game.unitInfo(UnitType.Port).cost(game, player);
    if (
      player.gold() >= cost * 2n &&
      player.canBuild(UnitType.Port, ownCoast) !== false
    )
      result.push(
        candidate(
          "maritime",
          ownCoast,
          null,
          65,
          (Number(cost) / Math.max(1, Number(player.gold()))) * 100,
          pressure,
        ),
      );
  }
  if (game.config().gameConfig().difficulty === Difficulty.Easy) return result;
  const threat = objectiveThreat(game, player);
  if (threat) result.push(candidate("contain", null, threat, 70, 20, 20, 10));
  // Keep the current viable option in the comparison so the normal commitment
  // and 15-point switching margin also apply when another neighbor ranks first.
  if (current?.kind === "contain" && current.targetSmallID !== null) {
    const prior = game.playerBySmallID(current.targetSmallID);
    if (
      prior.isPlayer() &&
      prior !== threat &&
      containmentThreatScore(game, player, prior, true) !== null
    )
      result.push(candidate("contain", null, prior, 70, 20, 20, 10));
  }
  const neighbors = [...new Set([...player.nearby(), ...overseas])]
    .filter(
      (p): p is Player =>
        p.isPlayer() &&
        p !== player &&
        p.isAlive() &&
        !player.isFriendly(p) &&
        p.type() !== PlayerType.Bot,
    )
    .sort((a, b) => a.smallID() - b.smallID())
    .slice(0, 30);
  for (const other of neighbors) {
    const enemyStrength = Math.max(
      1,
      other.troops() + game.config().maxTroops(other) * 0.15,
    );
    const relative = ownStrength / enemyStrength;
    if (relative < 0.65 || !canReach(other)) continue;
    const border = player.sharesBorderWith(other);
    const committed = other
      .outgoingAttacks()
      .reduce((n, a) => n + a.troops(), 0);
    const opportunity = Math.min(
      80,
      (committed / Math.max(1, other.troops() + committed)) * 100,
    );
    const risk = Math.min(
      100,
      (enemyStrength / ownStrength) * 45 + pressure * 0.5 + (border ? 0 : 15),
    );
    const cost = Math.min(
      95,
      (enemyStrength / ownStrength) * 30 + (border ? 0 : 20),
    );
    // One best economic site per rival keeps the candidate pool balanced.
    let bestSite: ResourceDeposit | null = null;
    let bestValue = 0;
    for (const site of sites) {
      if (
        !usable(game, site) ||
        game.owner(game.ref(site.x, site.y)) !== other ||
        game.config().isUnitDisabled(resourceBuilding(site))
      )
        continue;
      const value =
        resourceProduction(site.resource, site.quality, 1, 1, 1) *
        Math.min(
          30,
          site.resource === "fertile_soil"
            ? 30
            : game.resourceRemaining(site.id, site.capacity),
        );
      if (value > bestValue) {
        bestValue = value;
        bestSite = site;
      }
    }
    if (bestSite) {
      const c = candidate(
        "capture",
        game.ref(bestSite.x, bestSite.y),
        other,
        Math.min(95, 45 + bestValue / 25000),
        cost + distanceCost(game.ref(bestSite.x, bestSite.y)),
        risk,
        opportunity,
      );
      c.siteId = bestSite.id;
      result.push(c);
    }
    // Existing infrastructure is also a prize; do not require natural resources.
    const asset = other
      .units([UnitType.City, UnitType.Factory, UnitType.Port])
      .filter((u) => u.isActive() && !u.isUnderConstruction())
      .sort((a, b) => b.level() - a.level() || a.id() - b.id())[0];
    if (asset)
      result.push(
        candidate(
          "capture",
          asset.tile(),
          other,
          Math.min(85, 48 + asset.level() * 3),
          cost + distanceCost(asset.tile()),
          risk,
          opportunity,
        ),
      );
    if (
      ownCoast === null &&
      border &&
      !game.config().isUnitDisabled(UnitType.Port)
    ) {
      const coast = usefulCoast(game, other);
      if (coast !== null)
        result.push(
          candidate(
            "maritime",
            coast,
            other,
            70,
            cost + distanceCost(coast),
            risk,
            opportunity,
          ),
        );
    }
  }
  return result;
}

export function objectiveStillValid(
  game: Game,
  player: Player,
  goal: NationObjective,
): boolean {
  if (!objectivesEnabled(game) || game.ticks() >= goal.expiresTick)
    return false;
  if (goal.siteId !== null) {
    const site = resourceDeposits(
      game.map(),
      game.config().gameConfig().gameMap,
    ).find((s) => s.id === goal.siteId);
    if (!site || !usable(game, site)) return false;
  }
  if (goal.targetSmallID !== null) {
    const target = game.playerBySmallID(goal.targetSmallID);
    if (!target.isPlayer() || !target.isAlive() || player.isFriendly(target))
      return false;
    if (goal.kind === "contain")
      return containmentThreatScore(game, player, target, true) !== null;
    if (goal.tile !== null && game.owner(goal.tile) !== target) return false;
    const strength = player.troops() + game.config().maxTroops(player) * 0.15;
    if (
      strength <
      (target.troops() + game.config().maxTroops(target) * 0.15) * 0.55
    )
      return false;
  } else if (goal.tile !== null && game.owner(goal.tile) !== player)
    return false;
  if (
    goal.kind === "consolidate" &&
    game.ticks() - goal.startedTick >= 300 &&
    player.incomingAttacks().length === 0 &&
    player.troops() >= game.config().maxTroops(player) * 0.45
  )
    return false;
  if (goal.kind === "develop") {
    if (goal.unitId !== null) {
      const unit = game.unit(goal.unitId);
      return (
        unit !== undefined &&
        unit.isActive() &&
        unit.owner() === player &&
        unit.level() === goal.initialLevel &&
        !unit.isMarkedForDeletion()
      );
    }
    const site = resourceDeposits(
      game.map(),
      game.config().gameConfig().gameMap,
    ).find((s) => s.id === goal.siteId);
    return (
      site !== undefined &&
      !game.anyUnitNearby(
        goal.tile!,
        site.radius,
        RESOURCE_BUILDINGS,
        () => true,
        undefined,
        true,
      )
    );
  }
  if (goal.kind === "maritime" && goal.targetSmallID === null)
    return (
      player.units(UnitType.Port).length === 0 &&
      !game.config().isUnitDisabled(UnitType.Port)
    );
  return true;
}
