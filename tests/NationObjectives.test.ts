import {
  Difficulty,
  GameMapType,
  GameType,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { resourceDeposits } from "@openfront/engine-lib/game/NaturalResources";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { NationAllianceBehavior } from "@openfront/engine/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import {
  chooseObjective,
  objectiveCandidates,
  objectiveScore,
  objectiveStillValid,
  objectiveThreat,
  usefulCoast,
  type ObjectiveCandidate,
  type NationObjective,
} from "@openfront/engine/execution/nation/NationObjectives";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { UpgradeStructureExecution } from "@openfront/engine/execution/UpgradeStructureExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import { createGame, L, W } from "./core/pathfinding/_fixtures";
import { setup } from "./util/Setup";
import { roundTrip, expectSnapshotRoundTrip } from "./util/Snapshot";

const makeCandidate = (
  kind: ObjectiveCandidate["kind"],
  values: Partial<ObjectiveCandidate> = {},
): ObjectiveCandidate => ({
  kind,
  targetSmallID: null,
  tile: 1,
  siteId: null,
  unitId: null,
  initialLevel: 0,
  benefit: 60,
  cost: 20,
  risk: 20,
  opportunity: 0,
  ...values,
});
const goal = (c: ObjectiveCandidate, tick = 0): NationObjective => ({
  kind: c.kind,
  targetSmallID: c.targetSmallID,
  tile: c.tile,
  siteId: c.siteId,
  unitId: c.unitId,
  initialLevel: c.initialLevel,
  startedTick: tick,
  expiresTick: tick + 1800,
});
async function world(gameType = GameType.Singleplayer) {
  const infos = ["own", "enemy", "partner"].map(
    (id) => new PlayerInfo(id, PlayerType.Nation, null, id),
  );
  const game = await setup(
    "big_plains",
    {
      gameMap: GameMapType.World,
      gameType,
      difficulty: Difficulty.Hard,
      instantBuild: true,
    },
    infos,
  );
  const [own, enemy, partner] = infos.map((i) => game.player(i.id));
  game.map().forEachTile((t) => {
    if (game.isLand(t))
      (game.x(t) < 50 ? own : game.y(t) < 130 ? enemy : partner).conquer(t);
  });
  own.addGold(100000000n);
  enemy.addGold(10000000n);
  own.addTroops(150000);
  enemy.addTroops(120000);
  partner.addTroops(80000);
  const sites = resourceDeposits(game.map(), GameMapType.World);
  const execution = new NationExecution(
    "objective_test",
    new Nation(undefined, infos[0]),
  );
  execution.init(game);
  execution["initializeBehaviors"]();
  return { game, own, enemy, partner, sites, execution };
}

describe("Objective preferences", () => {
  test("the same viable choices produce different decisions by personality", () => {
    const development = makeCandidate("develop", {
      benefit: 65,
      cost: 20,
      risk: 5,
    });
    const conquest = makeCandidate("capture", {
      benefit: 80,
      cost: 20,
      risk: 50,
      opportunity: 30,
      tile: 2,
    });
    expect(
      chooseObjective([development, conquest], "industrialist", "a")?.kind,
    ).toBe("develop");
    expect(
      chooseObjective([development, conquest], "militarist", "a")?.kind,
    ).toBe("capture");
    expect(objectiveScore(conquest, "survivor")).toBeLessThan(
      objectiveScore(conquest, "militarist"),
    );
  });
  test("variation is reproducible and restricted to similarly valuable choices", () => {
    const a = makeCandidate("capture", { tile: 1 }),
      b = makeCandidate("capture", { tile: 2 }),
      bad = makeCandidate("capture", { tile: 3, risk: 100, cost: 100 });
    const selected = new Set<number | null>();
    for (let i = 0; i < 30; i++) {
      const seed = `game${i}`;
      const first = chooseObjective([a, b, bad], "strategist", seed);
      expect(first).toEqual(chooseObjective([bad, b, a], "strategist", seed));
      selected.add(first!.tile);
    }
    expect(selected).toEqual(new Set([1, 2]));
  });
  test("no positive opportunity falls back to normal behavior", () => {
    expect(
      chooseObjective(
        [makeCandidate("capture", { benefit: 0, risk: 100, cost: 100 })],
        "militarist",
        "a",
      ),
    ).toBeNull();
  });
});

describe("Objectives in the real engine", () => {
  test("all five goal types exist but containment does not start at tick zero", async () => {
    const { game, own, enemy } = await world();
    expect(objectiveThreat(game, own)).toBeNull();
    expect(
      objectiveCandidates(game, own, () => true).some(
        (c) => c.kind === "contain",
      ),
    ).toBe(false);
    enemy.addTroops(400000);
    vi.spyOn(game, "ticks").mockReturnValue(3000);
    expect(objectiveThreat(game, own)).toBe(enemy);
    expect(
      objectiveCandidates(game, own, () => true).some(
        (c) => c.kind === "contain" && c.targetSmallID === enemy.smallID(),
      ),
    ).toBe(true);
  });
  test("unreachable rivals and allies are excluded, while owned investment remains possible", async () => {
    const { game, own, enemy } = await world();
    const candidates = objectiveCandidates(game, own, () => false);
    expect(candidates.some((c) => c.kind === "develop")).toBe(true);
    expect(candidates.some((c) => c.kind === "capture")).toBe(false);
    own.createAllianceRequest(enemy)!.accept();
    expect(
      objectiveCandidates(game, own, () => true).some(
        (c) => c.targetSmallID === enemy.smallID(),
      ),
    ).toBe(false);
  });
  test("development executes the intended site through normal construction and completes", async () => {
    const { game, own } = await world();
    const c = objectiveCandidates(game, own, () => false).find(
      (c) => c.kind === "develop",
    )!;
    expect(c).toBeDefined();
    const g = goal(c);
    const behavior = new NationStructureBehavior(
      new PseudoRandom(1),
      game,
      own,
    );
    behavior.setObjective(g);
    const added = vi.spyOn(game, "addExecution");
    expect(behavior["maybeBuildObjective"]()).toBe(true);
    const exec = added.mock.calls[0][0];
    expect(exec).toBeInstanceOf(ConstructionExecution);
    exec.init(game, game.ticks());
    exec.tick(game.ticks());
    expect(objectiveStillValid(game, own, g)).toBe(false);
  });
  test("development supports a profitable upgrade and does not repeat it", async () => {
    const { game, own, sites } = await world();
    const site = sites.find(
      (s) => game.owner(game.ref(s.x, s.y)) === own && s.resource === "oil",
    )!;
    const unit = own.buildUnit(UnitType.OilWell, game.ref(site.x, site.y), {});
    const c = objectiveCandidates(game, own, () => false).find(
      (c) => c.unitId === unit.id(),
    )!;
    expect(c).toBeDefined();
    const behavior = new NationStructureBehavior(
      new PseudoRandom(1),
      game,
      own,
    );
    behavior.setObjective(goal(c));
    const added = vi.spyOn(game, "addExecution");
    expect(behavior["maybeBuildObjective"]()).toBe(true);
    const exec = added.mock.calls[0][0];
    expect(exec).toBeInstanceOf(UpgradeStructureExecution);
    exec.init(game, game.ticks());
    expect(unit.level()).toBe(2);
    expect(behavior["maybeBuildObjective"]()).toBe(false);
  });
  test("rejects exhausted sites and investments unable to repay their remaining reserves", async () => {
    const { game, own, sites } = await world();
    const site = sites.find(
      (s) => game.owner(game.ref(s.x, s.y)) === own && s.resource === "oil",
    )!;
    for (let i = 0; i < site.capacity - 1; i++)
      game.consumeResource(site.id, site.capacity);
    expect(
      objectiveCandidates(game, own, () => false).some(
        (c) => c.siteId === site.id,
      ),
    ).toBe(false);
    game.consumeResource(site.id, site.capacity);
    expect(
      objectiveStillValid(
        game,
        own,
        goal(
          makeCandidate("develop", {
            tile: game.ref(site.x, site.y),
            siteId: site.id,
          }),
        ),
      ),
    ).toBe(false);
  });
  test("capture produces a defensive consolidation after the prize changes owner", async () => {
    const { game, own, enemy, execution } = await world();
    const c = objectiveCandidates(game, own, () => true).find(
      (c) => c.kind === "capture" && c.targetSmallID === enemy.smallID(),
    )!;
    expect(c).toBeDefined();
    execution["objective"] = goal(c);
    own.conquer(c.tile!);
    execution["updateObjective"](50);
    expect(execution.objectiveInfo(own.smallID())?.kind).toBe("consolidate");
    expect(execution.objectiveInfo(own.smallID())?.tile).toBe(c.tile);
    expect(execution["attackBehavior"]["consolidating"]).toBe(true);
  });
  test("invalid plans are abandoned immediately even during the minimum commitment", async () => {
    const { game, own, enemy, execution } = await world();
    const c = objectiveCandidates(game, own, () => true).find(
      (c) => c.kind === "capture" && c.targetSmallID === enemy.smallID(),
    )!;
    execution["objective"] = goal(c);
    execution["objectiveReviewTick"] = 300;
    own.createAllianceRequest(enemy)!.accept();
    execution["updateObjective"](10);
    expect(execution.objectiveInfo(own.smallID())?.targetSmallID).not.toBe(
      enemy.smallID(),
    );
  });
  test("retains an affordable plan between reviews and expires stalled plans", async () => {
    const { game, own, execution } = await world();
    execution["updateObjective"](0);
    const first = execution.objectiveInfo(own.smallID());
    expect(first).toBeDefined();
    execution["updateObjective"](20);
    expect(execution.objectiveInfo(own.smallID())).toEqual(first);
    vi.spyOn(game, "ticks").mockReturnValue(2000);
    execution["updateObjective"](2000);
    expect(execution["objectiveCooldownUntil"]).toBe(2600);
    expect(execution.objectiveInfo(own.smallID())?.startedTick).not.toBe(
      first?.startedTick,
    );
  });
  test("containment favors a neutral partner sharing the threat, not the threat itself", async () => {
    const { game, own, enemy, partner } = await world();
    const random = new PseudoRandom(1);
    const behavior = new NationAllianceBehavior(
      random,
      game,
      own,
      new NationEmojiBehavior(random, game, own),
    );
    behavior.setContainmentTarget(enemy.smallID());
    expect(behavior["objectivePartner"](enemy)).toBe(false);
    expect(behavior["objectivePartner"](partner)).toBe(true);
  });
  test("multiplayer gets no objectives or objective construction", async () => {
    const { game, own, execution } = await world(GameType.Public);
    expect(objectiveCandidates(game, own, () => true)).toEqual([]);
    execution["updateObjective"](0);
    expect(execution.objectiveInfo(own.smallID())).toBeUndefined();
    const behavior = new NationStructureBehavior(
      new PseudoRandom(1),
      game,
      own,
    );
    behavior.setObjective(goal(makeCandidate("develop")));
    expect(behavior["maybeBuildObjective"]()).toBe(false);
  });
  test("read-only profile exposes the current plan without changing simulation state", async () => {
    const { game, own, execution } = await world();
    game.addExecution(execution);
    execution["updateObjective"](0);
    const profile = GameRunner.prototype.playerProfile.call(
      { game } as GameRunner,
      own.smallID(),
    );
    expect(profile.objective).toEqual(execution.objectiveInfo(own.smallID()));
  });
  test("persists the selected plan, review timing and future decisions across save/load", async () => {
    const { game, own, execution } = await world();
    game.addExecution(execution);
    execution["updateObjective"](0);
    const before = execution.objectiveInfo(own.smallID());
    expect(before).toBeDefined();
    const { restored } = await roundTrip(game, "big_plains");
    const restoredExec = restored
      .executions()
      .find((e) => e instanceof NationExecution) as NationExecution;
    expect(restoredExec.objectiveInfo(own.smallID())).toEqual(before);
    expect(restoredExec["objectiveSelection"]).toBe(
      execution["objectiveSelection"],
    );
    await expectSnapshotRoundTrip(game, "big_plains", 100);
  }, 60000);
  test("an inland country has no fictitious maritime development opportunity", async () => {
    const { game, own } = await world();
    expect(usefulCoast(game, own)).toBeNull();
    expect(
      objectiveCandidates(game, own, () => true).some(
        (c) => c.kind === "maritime",
      ),
    ).toBe(false);
  });
});

test("maritime goals use a real coast and build an authorized port", () => {
  const grid = Array.from({ length: 10000 }, (_, i) =>
    Math.floor(i / 100) < 40 ? L : W,
  );
  const game = createGame(
    { width: 100, height: 100, grid },
    {
      gameType: GameType.Singleplayer,
      difficulty: Difficulty.Hard,
      instantBuild: true,
    },
  );
  game.endSpawnPhase();
  const own = game.addPlayer(
    new PlayerInfo("coast", PlayerType.Nation, null, "coast"),
  );
  const other = game.addPlayer(
    new PlayerInfo("other", PlayerType.Nation, null, "other"),
  );
  game.map().forEachTile((t) => {
    if (game.isLand(t)) (game.x(t) < 50 ? own : other).conquer(t);
  });
  own.addGold(10000000n);
  own.addTroops(100000);
  expect(usefulCoast(game, own)).not.toBeNull();
  const c = objectiveCandidates(game, own, () => true).find(
    (c) => c.kind === "maritime" && c.targetSmallID === null,
  )!;
  expect(c).toBeDefined();
  const behavior = new NationStructureBehavior(new PseudoRandom(1), game, own);
  behavior.setObjective(goal(c));
  const added = vi.spyOn(game, "addExecution");
  expect(behavior["maybeBuildObjective"]()).toBe(true);
  const exec = added.mock.calls[0][0];
  exec.init(game, 0);
  exec.tick(0);
  expect(own.units(UnitType.Port)).toHaveLength(1);
  expect(objectiveStillValid(game, own, goal(c))).toBe(false);
});

test("landlocked nations can pursue an adjacent useful coast", () => {
  const grid = Array.from({ length: 10000 }, (_, i) =>
    Math.floor(i / 100) < 40 ? L : W,
  );
  const game = createGame(
    { width: 100, height: 100, grid },
    { gameType: GameType.Singleplayer, difficulty: Difficulty.Hard },
  );
  game.endSpawnPhase();
  const own = game.addPlayer(
    new PlayerInfo("inland", PlayerType.Nation, null, "inland"),
  );
  const other = game.addPlayer(
    new PlayerInfo("coast", PlayerType.Nation, null, "coast"),
  );
  game.map().forEachTile((t) => {
    if (game.isLand(t)) (game.y(t) < 20 ? own : other).conquer(t);
  });
  own.addTroops(100000);
  other.addTroops(50000);
  expect(usefulCoast(game, own)).toBeNull();
  expect(
    objectiveCandidates(game, own, () => true).some(
      (c) => c.kind === "maritime" && c.targetSmallID === other.smallID(),
    ),
  ).toBe(true);
});

test("an urgent real attack interrupts investment and prioritizes consolidation", async () => {
  const { game, own, enemy, execution } = await world();
  const c = objectiveCandidates(game, own, () => false).find(
    (c) => c.kind === "develop",
  )!;
  execution["objective"] = goal(c);
  execution["objectiveReviewTick"] = 300;
  enemy.addTroops(300000);
  new AttackExecution(100000, enemy, own.id()).init(game, 0);
  expect(own.incomingAttacks().length).toBeGreaterThan(0);
  execution["updateObjective"](10);
  expect(execution.objectiveInfo(own.smallID())?.kind).toBe("consolidate");
});

test("tutorial keeps its original scripted behavior", async () => {
  const { game, own, execution } = await world();
  game.config().gameConfig().tutorial = true;
  expect(objectiveCandidates(game, own, () => true)).toEqual([]);
  execution["updateObjective"](0);
  expect(execution.objectiveInfo(own.smallID())).toBeUndefined();
});

test("a route that becomes inaccessible invalidates a campaign at its next review", async () => {
  const { game, own, enemy, execution } = await world();
  const c = objectiveCandidates(game, own, () => true).find(
    (c) => c.kind === "capture" && c.targetSmallID === enemy.smallID(),
  )!;
  execution["objective"] = goal(c);
  execution["objectiveReviewTick"] = 100;
  vi.spyOn(execution["attackBehavior"], "canPursueObjective").mockReturnValue(
    false,
  );
  execution["updateObjective"](100);
  expect(execution.objectiveInfo(own.smallID())?.targetSmallID).not.toBe(
    enemy.smallID(),
  );
});

test("containment persists when a second neighbor becomes slightly stronger, but ends for an ally", async () => {
  const { game, own, enemy, partner, execution } = await world();
  game.map().forEachTile((t) => {
    if (game.isLand(t))
      (game.x(t) < 40 ? own : game.y(t) < 100 ? enemy : partner).conquer(t);
  });
  for (const p of [own, enemy, partner]) p.removeTroops(p.troops());
  own.addTroops(100000);
  enemy.addTroops(250000);
  partner.addTroops(220000);
  own.removeGold(own.gold());
  vi.spyOn(game, "ticks").mockReturnValue(3000);
  expect(objectiveThreat(game, own)).toBe(enemy);
  const current = goal(
    makeCandidate("contain", { tile: null, targetSmallID: enemy.smallID() }),
    3000,
  );
  execution["objective"] = current;
  execution["objectiveReviewTick"] = 3300;
  partner.addTroops(60000);
  expect(objectiveThreat(game, own)).toBe(partner);
  expect(objectiveStillValid(game, own, current)).toBe(true);
  execution["updateObjective"](3040);
  expect(execution["objective"]).toEqual(current);
  const choices = objectiveCandidates(game, own, () => true, current);
  expect(
    choices.filter((c) => c.kind === "contain").map((c) => c.targetSmallID),
  ).toEqual(expect.arrayContaining([enemy.smallID(), partner.smallID()]));
  execution["updateObjective"](3700);
  expect(execution["objective"]?.targetSmallID).toBe(enemy.smallID());
  own.createAllianceRequest(enemy)!.accept();
  expect(objectiveStillValid(game, own, current)).toBe(false);
});

test("economic campaigns consider a reachable overseas country, beyond nearby river neighbors", () => {
  const grid = Array.from({ length: 10000 }, (_, i) =>
    i % 100 < 30 || i % 100 >= 65 ? L : W,
  );
  const game = createGame(
    { width: 100, height: 100, grid },
    { gameType: GameType.Singleplayer, difficulty: Difficulty.Hard },
  );
  game.endSpawnPhase();
  const info = new PlayerInfo("own", PlayerType.Nation, null, "own");
  const own = game.addPlayer(info),
    other = game.addPlayer(
      new PlayerInfo("island", PlayerType.Nation, null, "island"),
    );
  game.map().forEachTile((t) => {
    if (game.isLand(t)) (game.x(t) < 30 ? own : other).conquer(t);
  });
  own.addTroops(200000);
  other.addTroops(20000);
  other.addGold(1000000n);
  other.buildUnit(UnitType.City, game.ref(80, 50), {});
  vi.spyOn(game, "ticks").mockReturnValue(3000);
  const execution = new NationExecution(
    "overseas-goal",
    new Nation(undefined, info),
  );
  execution.init(game);
  execution["initializeBehaviors"]();
  const behavior = execution["attackBehavior"];
  expect(own.nearby()).not.toContain(other);
  const overseas = behavior.objectiveOverseasTargets();
  expect(overseas).toContain(other);
  expect(behavior.canPursueObjective(other)).toBe(true);
  expect(
    objectiveCandidates(
      game,
      own,
      (p) => behavior.canPursueObjective(p),
      null,
      overseas,
    ).some((c) => c.kind === "capture" && c.targetSmallID === other.smallID()),
  ).toBe(true);
  const added = vi.spyOn(game, "addExecution");
  behavior.setStrategicTarget(other);
  behavior["attackBestTarget"]([], []);
  expect(
    added.mock.calls.some(
      ([execution]) => execution.constructor.name === "TransportShipExecution",
    ),
  ).toBe(true);
  own.createAllianceRequest(other)!.accept();
  expect(behavior.objectiveOverseasTargets()).not.toContain(other);
});

describe("campaign direction and progress", () => {
  test("the same land army advances nearer the selected installation", async () => {
    const advance = async (focused: boolean) => {
      const { game, own, enemy } = await world();
      const tile = game.ref(80, 20);
      const before = new Set(own.tiles());
      const attack = new AttackExecution(
        10000,
        own,
        enemy.id(),
        null,
        true,
        focused ? tile : null,
      );
      attack.init(game, 0);
      for (let tick = 1; tick <= 60; tick++) attack.tick(tick);
      const gained = Array.from(own.tiles()).filter((t) => !before.has(t));
      return {
        gained: gained.length,
        distance:
          gained.reduce((n, t) => n + game.manhattanDist(t, tile), 0) /
          gained.length,
      };
    };
    const normal = await advance(false);
    const focused = await advance(true);
    expect(focused.gained).toBe(normal.gained);
    expect(focused.distance).toBeLessThan(normal.distance);
  });

  test("passes the prize to a land attack without bypassing troop gates", async () => {
    const { game, own, enemy, execution } = await world();
    const behavior = execution["attackBehavior"];
    const tile = game.ref(80, 20);
    vi.spyOn(game, "isNationSpawnImmunityActive").mockReturnValue(false);
    own.addTroops(game.config().maxTroops(own));
    behavior.setStrategicTarget(enemy, tile);
    const send = vi.spyOn(game, "addExecution");
    expect(behavior.sendAttack(enemy, false, tile)).toBe(true);
    const attack = send.mock.calls
      .flat()
      .find((e) => e instanceof AttackExecution) as AttackExecution;
    expect(attack["objectiveTile"]).toBe(tile);
    own.removeTroops(own.troops());
    expect(behavior.sendAttack(enemy, false, tile)).toBe(false);
  });

  test("waiting for troops is not classified as a failed campaign", async () => {
    const { game, enemy, execution } = await world();
    const current = goal(
      makeCandidate("capture", {
        tile: game.ref(80, 20),
        targetSmallID: enemy.smallID(),
      }),
    );
    execution["objective"] = current;
    expect(execution["campaignStalled"](current, 1500)).toBe(false);
    execution["recordCampaignAttempt"](100);
    expect(execution["campaignStalled"](current, 1500)).toBe(false);
  });

  test("several failed attempts trigger reconsideration and a cooldown", async () => {
    const { game, enemy, execution } = await world();
    const current = goal(
      makeCandidate("capture", {
        tile: game.ref(80, 20),
        targetSmallID: enemy.smallID(),
      }),
    );
    execution["objective"] = current;
    for (const tick of [100, 200, 300])
      execution["recordCampaignAttempt"](tick);
    expect(execution["campaignStalled"](current, 800)).toBe(false);
    execution["updateObjective"](1400);
    expect(execution["objectiveCooldownKey"]).toBe(
      `capture:${current.tile}:${enemy.smallID()}`,
    );
    expect(execution["objectiveCooldownUntil"]).toBe(2000);
    expect(execution["objective"]).not.toBe(current);
  });

  test("real progress renews patience; retaking the same ground does not", async () => {
    const { game, own, enemy, execution } = await world();
    const current = goal(
      makeCandidate("capture", {
        tile: game.ref(80, 20),
        targetSmallID: enemy.smallID(),
      }),
    );
    execution["objective"] = current;
    for (const tick of [100, 200, 300])
      execution["recordCampaignAttempt"](tick);
    for (let x = 50; x <= 54; x++) own.conquer(game.ref(x, 20));
    expect(execution["campaignStalled"](current, 1300)).toBe(false);
    expect(current.progress?.lastProgressTick).toBe(1300);
    expect(current.progress?.attempts).toBe(0);
    for (let x = 50; x <= 54; x++) enemy.conquer(game.ref(x, 20));
    for (const tick of [1400, 1500, 1600])
      execution["recordCampaignAttempt"](tick);
    for (let x = 50; x <= 54; x++) own.conquer(game.ref(x, 20));
    expect(execution["campaignStalled"](current, 2600)).toBe(true);
  });

  test("militarist nations tolerate a longer unsuccessful campaign", async () => {
    const { game, enemy, execution } = await world();
    const current = goal(
      makeCandidate("capture", {
        tile: game.ref(80, 20),
        targetSmallID: enemy.smallID(),
      }),
    );
    execution["objective"] = current;
    for (const tick of [100, 200, 300])
      execution["recordCampaignAttempt"](tick);
    execution["doctrine"] = { ...execution["doctrine"], id: "strategist" };
    expect(execution["campaignStalled"](current, 1000)).toBe(true);
    execution["doctrine"] = { ...execution["doctrine"], id: "militarist" };
    expect(execution["campaignStalled"](current, 1000)).toBe(false);
    expect(execution["campaignStalled"](current, 1300)).toBe(true);
  });

  test("saves focused attacks and campaign progress with deterministic continuation", async () => {
    const { game, enemy, own, execution } = await world();
    execution["objective"] = goal(
      makeCandidate("capture", {
        tile: game.ref(80, 20),
        targetSmallID: enemy.smallID(),
      }),
    );
    execution["recordCampaignAttempt"](0);
    execution["applyObjective"]();
    game.addExecution(execution);
    game.addExecution(
      new AttackExecution(10000, own, enemy.id(), null, true, game.ref(80, 20)),
    );
    await expectSnapshotRoundTrip(game, "big_plains", 30);
    for (let i = 0; i < 3; i++) game.executeNextTick();
    await expectSnapshotRoundTrip(game, "big_plains", 30);
  }, 60000);
});
