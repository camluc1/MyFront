import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  diplomaticPersonality,
  emptyAssets,
  TreatyKind,
} from "@openfront/engine-api/Geopolitics";
import {
  IntentSchema,
  DiplomacyIntentSchema,
} from "@openfront/engine-api/Schemas";
import { DiplomacyExecution } from "@openfront/engine/execution/DiplomacyExecution";
import { survivalPeaceGold } from "@openfront/engine/diplomacy/Geopolitics";
import { Game, Player } from "@openfront/engine/game/Game";
import { zb } from "@openfront/zbin";
import { setup } from "./util/Setup";
import { roundTrip, diffSnapshots } from "./util/Snapshot";
let game: Game, a: Player, b: Player, c: Player;
const offer = (
  from: Player,
  to: Player,
  kind: TreatyKind = "peace",
  extra = {},
) => {
  game.diplomacy.act(from, {
    action: "offer",
    target: to.id(),
    kind,
    give: emptyAssets(),
    receive: emptyAssets(),
    ...extra,
  });
  return game.diplomacy.state.offers[game.diplomacy.state.offers.length - 1];
};
const accept = (p: Player, id: number, from: Player = a) =>
  game.diplomacy.act(p, { action: "accept", target: from.id(), offerID: id });
beforeEach(async () => {
  game = await setup(
    "plains",
    { geopolitics: true, instantBuild: true },
    ["a", "b", "c", "d", "e"].map(
      (id) => new PlayerInfo(id, PlayerType.Human, id.padEnd(8, "0"), id),
    ),
  );
  [a, b, c] = ["a", "b", "c"].map((id) => game.player(id));
  for (let i = 0; i < 5; i++) {
    const p = game.player(["a", "b", "c", "d", "e"][i]);
    for (let x = 0; x < 5; x++) p.conquer(game.ref(x, i));
    p.addGold(1000000n);
    p.addTroops(10000);
  }
});
describe("survival diplomacy treasury consequences", () => {
  it("starts with modest terms and scales with military disadvantage", () => {
    const treasury = 3_000_000;
    const initial = survivalPeaceGold(treasury, 8, 1, false);
    const losing = survivalPeaceGold(treasury, 27, 2.1, false);
    const desperate = survivalPeaceGold(treasury, 40, 4, false);
    expect(initial).toBe(240_000);
    expect(initial).toBeLessThan(losing);
    expect(losing).toBeLessThan(desperate);
    expect(desperate).toBeLessThan(treasury);
  });
  it("can offer all remaining gold only near elimination", () => {
    expect(survivalPeaceGold(1_250_000, 40, 3, true)).toBe(1_250_000);
    expect(survivalPeaceGold(1_250_000, 22, 3, true)).toBeLessThan(1_250_000);
    expect(survivalPeaceGold(1_250_000, 40, 1, true)).toBeLessThan(1_250_000);
    expect(survivalPeaceGold(0, 40, 4, true)).toBe(0);
  });
});
it("creates a bilateral alliance without creating a shared-victory coalition", () => {
  const o = offer(a, b, "alliance");
  accept(b, o.id);
  expect(o.status).toBe("accepted");
  expect(game.diplomacy.friendly(a.id(), b.id())).toBe(true);
  expect(game.diplomacy.state.coalitions.some((c) => c.members.includes(a.id()) && c.members.includes(b.id()))).toBe(false);
  expect(game.diplomacy.state.treaties.some((t) => t.kind === "alliance" && t.a === a.id() && t.b === b.id())).toBe(true);
});
it("transfers exact isolated tiles and building levels, once, with both resource legs", () => {
  const tile = game.ref(0, 1);
  const city = b.buildUnit(UnitType.City, tile, {});
  city.increaseLevel();
  city.setUnderConstruction(true);
  const health = city.health();
  const goldA = a.gold(),
    goldB = b.gold();
  const o = offer(a, b, "peace", {
    give: { ...emptyAssets(), gold: 200, troops: 50 },
    receive: { ...emptyAssets(), tiles: [tile], buildings: [city.id()] },
  });
  accept(b, o.id);
  expect(o.status).toBe("accepted");
  expect(game.owner(tile)).toBe(a);
  expect(game.owner(game.ref(1, 1))).toBe(b);
  expect(city.owner()).toBe(a);
  expect(city.level()).toBe(2);
  expect(city.health()).toBe(health);
  expect(city.isUnderConstruction()).toBe(true);
  expect(a.gold()).toBe(goldA - 200n);
  expect(b.gold()).toBe(goldB + 200n);
  accept(b, o.id);
  expect(a.gold()).toBe(goldA - 200n);
  expect(a.isFriendly(b)).toBe(true);
});
it("invalidates an ownership change without moving either party's resources", () => {
  const tile = game.ref(0, 1);
  const o = offer(a, b, "peace", {
    give: { ...emptyAssets(), gold: 500 },
    receive: { ...emptyAssets(), tiles: [tile] },
  });
  const before = a.gold();
  c.conquer(tile);
  accept(b, o.id);
  expect(o.status).toBe("invalid");
  expect(a.gold()).toBe(before);
  expect(game.owner(tile)).toBe(c);
});
it("rejects newly built structures hidden from the preview", () => {
  const tile = game.ref(0, 1);
  const o = offer(a, b, "peace", {
    receive: { ...emptyAssets(), tiles: [tile] },
  });
  b.buildUnit(UnitType.City, tile, {});
  accept(b, o.id);
  expect(o.status).toBe("invalid");
  expect(game.owner(tile)).toBe(b);
});
it("invalidates depleted funds atomically", () => {
  const o = offer(a, b, "peace", {
    give: { ...emptyAssets(), gold: 500 },
    receive: { ...emptyAssets(), troops: 100 },
  });
  a.removeGold(a.gold());
  const before = b.troops();
  accept(b, o.id);
  expect(o.status).toBe("invalid");
  expect(b.troops()).toBe(before);
});
it("cannot accept another country's offer or counterfeit a counteroffer", () => {
  const o = offer(a, b);
  accept(c, o.id);
  expect(o.status).toBe("pending");
  offer(c, a, "peace", { counterTo: o.id });
  expect(game.diplomacy.state.offers).toHaveLength(1);
});
it("replaces terms with a counteroffer and freezes the earlier terms", () => {
  const o = offer(a, b);
  const counter = offer(b, a, "peace", {
    counterTo: o.id,
    receive: { ...emptyAssets(), gold: 150 },
  });
  expect(o.status).toBe("countered");
  accept(a, counter.id, b);
  expect(counter.status).toBe("accepted");
});
it("requires every coalition member to approve and rejects a fifth member", () => {
  const first = offer(a, b, "coalition");
  accept(b, first.id);
  const second = offer(a, c, "coalition");
  accept(c, second.id);
  expect(game.diplomacy.coalition(a.id())?.members).toHaveLength(2);
  accept(b, second.id);
  expect(game.diplomacy.coalition(a.id())?.members).toHaveLength(3);
  const d = game.player("d"),
    e = game.player("e");
  const third = offer(a, d, "coalition");
  accept(d, third.id);
  accept(b, third.id);
  accept(c, third.id);
  expect(game.diplomacy.coalition(a.id())?.members).toHaveLength(4);
  const count = game.diplomacy.state.offers.length;
  offer(a, e, "coalition");
  expect(game.diplomacy.state.offers).toHaveLength(count);
});
it("records betrayal and permits attacks, while a peaceful exit keeps a truce", () => {
  const o = offer(a, b, "coalition");
  accept(b, o.id);
  game.diplomacy.act(a, { action: "break", target: b.id() });
  expect(a.isFriendly(b)).toBe(false);
  expect(
    game.diplomacy.state.memory.find((m) => m.a === b.id() && m.b === a.id())
      ?.betrayal,
  ).toBe(1);
  const next = offer(b, c, "coalition");
  accept(c, next.id, b);
  game.diplomacy.act(b, { action: "leave", target: "" });
  expect(b.isFriendly(c)).toBe(true);
  expect(game.diplomacy.coalition(b.id())).toBeUndefined();
});
it("expires offers and truces in simulation time", () => {
  const o = offer(a, b, "truce");
  accept(b, o.id);
  for (let i = 0; i < 601; i++) game.executeNextTick();
  expect(a.isFriendly(b)).toBe(false);
  expect(game.diplomacy.state.memory.find((m) => m.a === a.id())?.kept).toBe(1);
  const pending = offer(a, b);
  for (let i = 0; i < 451; i++) game.executeNextTick();
  expect(pending.status).toBe("expired");
});
it("holds 90% for a full 600 ticks and resets on a territorial loss", () => {
  const o = offer(a, b, "coalition");
  accept(b, o.id);
  const land: number[] = [];
  for (let y = 0; y < game.height(); y++)
    for (let x = 0; x < game.width(); x++) {
      const t = game.ref(x, y);
      if (game.isLand(t) && !game.isImpassable(t)) land.push(t);
    }
  for (const t of land) if (game.owner(t) !== b) a.conquer(t);
  game.diplomacy.checkVictory();
  for (let i = 0; i < 599; i++) game.executeNextTick();
  expect(game.diplomacy.state.winner).toEqual([]);
  const lost = land
    .filter((t) => game.owner(t) !== b)
    .slice(0, Math.ceil(land.length / 5));
  for (const t of lost) c.conquer(t);
  game.executeNextTick();
  expect(game.diplomacy.state.victory).toBeNull();
  for (const t of lost) a.conquer(t);
  game.executeNextTick();
  for (let i = 0; i < 600; i++) game.executeNextTick();
  expect(game.diplomacy.state.winner).toEqual(["a", "b"]);
  expect(game.getWinner()).toBe("coalition:a,b");
});
it("round-trips pending actions, territories, memory and deterministic continuation", async () => {
  const o = offer(a, b);
  accept(b, o.id);
  game.addExecution(
    new DiplomacyExecution(c.id(), {
      action: "offer",
      target: a.id(),
      kind: "truce",
      give: emptyAssets(),
      receive: emptyAssets(),
    }),
  );
  const { bytes, restored, again } = await roundTrip(game, "plains");
  expect(diffSnapshots(bytes, again)).toEqual([]);
  for (let i = 0; i < 700; i++) {
    game.executeNextTick();
    restored.executeNextTick();
  }
  expect(restored.diplomacy.state).toEqual(game.diplomacy.state);
});
it("does not activate in Classic", async () => {
  const classic = await setup("plains", {}, [
    new PlayerInfo("a", PlayerType.Human, "aaaaaaaa", "a"),
    new PlayerInfo("b", PlayerType.Human, "bbbbbbbb", "b"),
  ]);
  const a = classic.player("a"),
    b = classic.player("b");
  a.conquer(classic.ref(0, 0));
  b.conquer(classic.ref(1, 0));
  classic.diplomacy.act(a, {
    action: "offer",
    target: b.id(),
    kind: "peace",
    give: emptyAssets(),
    receive: emptyAssets(),
  });
  expect(classic.diplomacy.state.offers).toEqual([]);
});
it("validates and binary round-trips diplomacy intents, preserving existing intent ordering", () => {
  const codec = zb.object(DiplomacyIntentSchema.shape);
  const intent = {
    type: "diplomacy" as const,
    diplomacy: {
      action: "offer" as const,
      target: "country",
      kind: "peace" as const,
      give: { ...emptyAssets(), gold: 10000000000 },
      receive: emptyAssets(),
    },
  };
  expect(codec.parseBytes(codec.serialize(intent))).toEqual(intent);
  expect(
    IntentSchema.safeParse({
      ...intent,
      diplomacy: { ...intent.diplomacy, give: { ...emptyAssets(), gold: -1 } },
    }).success,
  ).toBe(false);
  expect(IntentSchema.options[0].shape.type.value).toBe("attack");
});

it("only allows credible ultimatums and persists them", async () => {
  a.addTroops(100000);
  const o = offer(a, b, "peace", {
    ultimatum: true,
    receive: { ...emptyAssets(), gold: 500 },
  });
  expect(o.ultimatum).toBe(true);
  const { bytes, again } = await roundTrip(game, "plains");
  expect(diffSnapshots(bytes, again)).toEqual([]);
  const count = game.diplomacy.state.offers.length;
  offer(b, c, "peace", { ultimatum: true });
  expect(game.diplomacy.state.offers).toHaveLength(count);
});

it("can overcome past hostility to cooperate against a larger common neighbor", () => {
  a.addTroops(90000);
  b.addTroops(90000);
  c.addTroops(290000);
  // Put the stronger country on both borders.
  c.conquer(game.ref(5, 0));
  c.conquer(game.ref(5, 1));
  game.diplomacy.hostility(a.id(), b.id());
  const o = offer(a, b, "coalition", { threat: c.id() });
  const evaluation = game.diplomacy.evaluate(o, b);
  expect(evaluation.reason).toBe("common_threat");
  expect(evaluation.score).toBeGreaterThanOrEqual(20);
});
it("blocks AI and human land attacks during a signed ceasefire", async () => {
  const { AttackExecution } =
    await import("@openfront/engine/execution/AttackExecution");
  const o = offer(a, b, "truce");
  accept(b, o.id);
  const tiles = b.numTilesOwned();
  game.addExecution(new AttackExecution(500, a, b.id(), null));
  for (let i = 0; i < 20; i++) game.executeNextTick();
  expect(b.numTilesOwned()).toBe(tiles);
  expect(a.outgoingAttacks()).toHaveLength(0);
});
it("remembers donated military aid in Geopolitics", () => {
  const o = offer(a, b, "coalition");
  accept(b, o.id);
  const before = game.diplomacy.state.memory.find(
    (m) => m.a === b.id() && m.b === a.id(),
  )!.trust;
  a.donateTroops(b, 5000);
  expect(
    game.diplomacy.state.memory.find((m) => m.a === b.id() && m.b === a.id())!
      .trust,
  ).toBeGreaterThan(before);
});

it("varies personality by campaign seed while preserving old campaigns", () => {
  const signatures = new Set(
    Array.from({ length: 12 }, (_, seed) =>
      Array.from({ length: 8 }, (_, i) =>
        diplomaticPersonality(seed, i + 1),
      ).join(),
    ),
  );
  expect(signatures.size).toBeGreaterThan(8);
  expect(diplomaticPersonality(42, 3)).toBe(diplomaticPersonality(42, 3));
  expect(diplomaticPersonality(undefined, 3)).toBe(3);
});
it("weighs the loss of the final port and city independently of cash", () => {
  const t = game.ref(0, 1);
  const port = b.buildUnit(UnitType.Port, t, {});
  const proposal = offer(a, b, "peace", {
    receive: { ...emptyAssets(), tiles: [t], buildings: [port.id()] },
  });
  expect(game.diplomacy.evaluate(proposal, b).reason).toBe("strategic_assets");
});
it("explains invalid offers and preserves the feedback through saves", async () => {
  offer(a, b, "peace", { give: { ...emptyAssets(), gold: 1000000000 } });
  expect(game.diplomacy.state.offers).toHaveLength(0);
  expect(game.diplomacy.state.feedback?.[a.id()].reason).toBe("assets");
  const { bytes, again } = await roundTrip(game, "plains");
  expect(diffSnapshots(bytes, again)).toEqual([]);
});
it("caps counteroffer chains and keeps the last proposal pending", () => {
  let proposal = offer(a, b);
  let from = b,
    to = a;
  for (let i = 0; i < 3; i++) {
    proposal = offer(from, to, "peace", { counterTo: proposal.id });
    [from, to] = [to, from];
  }
  const count = game.diplomacy.state.offers.length;
  offer(from, to, "peace", { counterTo: proposal.id });
  expect(game.diplomacy.state.offers).toHaveLength(count);
  expect(proposal.status).toBe("pending");
  expect(game.diplomacy.state.feedback?.[from.id()].reason).toBe("rounds");
});
it("does not treat a payment to another coalition member as its own compensation", () => {
  const proposal = offer(a, b, "coalition", {
    give: { ...emptyAssets(), gold: 500000 },
  });
  const score = game.diplomacy.evaluate(proposal, c).score;
  proposal.give.gold = 0;
  expect(game.diplomacy.evaluate(proposal, c).score).toBe(score);
});

it("AI counters a request for its last port with monetary compensation", async () => {
  game = await setup("plains", { geopolitics: true, instantBuild: true }, [
    new PlayerInfo("a", PlayerType.Human, "aaaaaaaa", "a"),
    new PlayerInfo("b", PlayerType.Nation, null, "b"),
  ]);
  a = game.player("a");
  b = game.player("b");
  for (let x = 0; x < 5; x++) {
    a.conquer(game.ref(x, 0));
    b.conquer(game.ref(x, 1));
  }
  a.addGold(1000000n);
  b.addGold(1000000n);
  a.addTroops(10000);
  b.addTroops(10000);
  const port = b.buildUnit(UnitType.Port, game.ref(0, 1), {});
  const original = offer(a, b, "peace", {
    receive: { ...emptyAssets(), tiles: [port.tile()], buildings: [port.id()] },
  });
  for (let i = 0; i < 31; i++) game.executeNextTick();
  expect(original.status).toBe("countered");
  const counter = game.diplomacy.state.offers.find((o) => o.from === b.id())!;
  expect(counter.reason).toBe("retain_land");
  expect(counter.give.tiles).toEqual([]);
  expect(counter.give.gold).toBeGreaterThan(0);
  expect(counter.status).toBe("pending");
});

it("recognizes a nuclear common threat even when its conventional army is smaller", () => {
  a.addTroops(90000);
  b.addTroops(90000);
  c.addTroops(70000);
  c.conquer(game.ref(5, 0));
  c.conquer(game.ref(5, 1));
  const silo = c.buildUnit(UnitType.MissileSilo, game.ref(5, 0), {});
  silo.increaseLevel();
  const proposal = offer(a, b, "coalition", { threat: c.id() });
  expect(game.diplomacy.evaluate(proposal, b).reason).toBe("nuclear_threat");
  expect(game.diplomacy.evaluate(proposal, b).score).toBeGreaterThanOrEqual(20);
});

it("transfers a negotiated port and its exact coastal tile, without surrounding land", () => {
  const coast = game.ref(0, 1);
  const port = b.buildUnit(UnitType.Port, coast, {});
  const proposal = offer(a, b, "peace", {
    receive: { ...emptyAssets(), tiles: [coast], buildings: [port.id()] },
  });
  accept(b, proposal.id);
  expect(proposal.status).toBe("accepted");
  expect(game.owner(coast)).toBe(a);
  expect(game.owner(game.ref(1, 1))).toBe(b);
  expect(port.owner()).toBe(a);
  expect(a.units(UnitType.Port).some((unit) => unit.id() === port.id())).toBe(true);
  const memory = game.diplomacy.state.memory.find((m) => m.a === a.id() && m.b === b.id());
  expect(memory?.receivedPorts).toBe(1);
  expect(memory?.receivedTerritory).toBe(1);
});

it("makes rejected diplomatic proposals progressively less frequent for the same pair", () => {
  const proposal = offer(a, b);
  game.diplomacy.act(b, { action: "reject", target: a.id(), offerID: proposal.id });
  expect(proposal.status).toBe("rejected");
  const key = `ai:pair:${a.id()}:${b.id()}`;
  expect(game.diplomacy.state.cooldowns[key]).toBe(game.ticks() + 900);
  expect(game.diplomacy.state.memory.find((m) => m.a === b.id() && m.b === a.id())?.rejections).toBe(1);
  // Diplomacy with a different country is still possible.
  const other = offer(a, c);
  expect(other.status).toBe("pending");
});

it("preserves deterministic diplomacy behavior across snapshot restore", async () => {
  const proposal = offer(a, b, "peace");
  game.diplomacy.act(b, { action: "reject", target: a.id(), offerID: proposal.id });
  const { bytes, again, restored } = await roundTrip(game, "plains");
  expect(diffSnapshots(bytes, again)).toEqual([]);
  expect(restored.diplomacy.state.cooldowns).toEqual(game.diplomacy.state.cooldowns);
});

it("honors an explicitly negotiated five-minute peace while old offers remain three minutes", () => {
  const longer = offer(a, b, "peace", { durationTicks: 3000 });
  accept(b, longer.id);
  expect(longer.status).toBe("accepted");
  const treaty = game.diplomacy.state.treaties.find((t) => t.a === a.id() && t.b === b.id())!;
  expect(treaty.until - game.ticks()).toBe(3000);
  for (let i = 0; i < 1801; i++) game.executeNextTick();
  expect(game.diplomacy.friendly(a.id(), b.id())).toBe(true);
  for (let i = 0; i < 1200; i++) game.executeNextTick();
  expect(game.diplomacy.friendly(a.id(), b.id())).toBe(false);
});

it("keeps the selected peace duration across a save/restore", async () => {
  const proposal = offer(a, b, "peace", { durationTicks: 3000 });
  expect(proposal.durationTicks).toBe(3000);
  const { bytes, again, restored } = await roundTrip(game, "plains");
  expect(diffSnapshots(bytes, again)).toEqual([]);
  expect(restored.diplomacy.state.offers[0].durationTicks).toBe(3000);
});

it("compares alternatives to surrendering a strategically valuable port", () => {
  const harbor = b.buildUnit(UnitType.Port, game.ref(1, 1), {});
  b.buildUnit(UnitType.Port, game.ref(3, 1), {});
  const proposal = offer(a, b, "peace", {
    receive: { ...emptyAssets(), tiles: [harbor.tile()], buildings: [harbor.id()] },
  });
  const plan = (game.diplomacy as unknown as {
    chooseCounteroffer: (offer: typeof proposal, player: Player) =>
      { give: ReturnType<typeof emptyAssets>; reason: string } | null;
  }).chooseCounteroffer(proposal, b);
  expect(plan).not.toBeNull();
  expect(plan?.give.tiles).toEqual([]);
  expect(plan?.give.buildings).toEqual([]);
  expect(plan?.give.gold).toBeGreaterThan(0);
  expect(plan?.reason).toBe("retain_land");
});

it("makes border changes a memorable diplomatic event with meaningful third-party reactions", () => {
  const port = b.buildUnit(UnitType.Port, game.ref(1, 1), {});
  const treaty = offer(a, b, "peace", {
    receive: { ...emptyAssets(), tiles: [port.tile()], buildings: [port.id()] },
  });
  accept(b, treaty.id);
  expect(treaty.status).toBe("accepted");
  expect(game.diplomacy.state.log.some((e) =>
    e.actor === b.id() && e.target === a.id() &&
    e.event === "port_cession")).toBe(true);
  expect(game.diplomacy.state.log.some((e) =>
    e.actor === c.id() && e.target === a.id() &&
    e.event === "territorial_concern")).toBe(true);
  const witness = game.diplomacy.state.memory.find((m) =>
    m.a === c.id() && m.b === a.id());
  expect(witness?.trust).toBe(-3);
});

it("spaces out AI proposals reaching the same human without blocking other nations", () => {
  const d = game.diplomacy as unknown as {
    canInitiateTo: (actor: Player, target: Player, tick: number) => boolean;
  };
  const tick = game.ticks();
  game.diplomacy.state.cooldowns["ai:human:inbox:" + b.id()] = tick + 600;
  game.diplomacy.state.cooldowns["ai:human:last:" + b.id()] = tick;
  expect(d.canInitiateTo(a, b, tick)).toBe(false);
  expect(d.canInitiateTo(a, c, tick)).toBe(true);
});

it("keeps geopolitical reaction history and memory across saved games", async () => {
  const port = b.buildUnit(UnitType.Port, game.ref(1, 1), {});
  const treaty = offer(a, b, "peace", {
    receive: { ...emptyAssets(), tiles: [port.tile()], buildings: [port.id()] },
  });
  accept(b, treaty.id);
  const { bytes, again, restored } = await roundTrip(game, "plains");
  expect(diffSnapshots(bytes, again)).toEqual([]);
  expect(restored.diplomacy.state.log).toEqual(game.diplomacy.state.log);
  expect(restored.diplomacy.state.memory).toEqual(game.diplomacy.state.memory);
});

it("preserves a nation's concrete diplomatic objection after rejecting a treaty", () => {
  const treaty = offer(a, b, "peace");
  treaty.reason = "strategic_assets";
  // The AI assessment is recorded before the decision; declining must not
  // erase the explanation that the UI needs to show to the player.
  treaty.decisionReason = "strategic_assets";
  game.diplomacy.act(b, {
    action: "reject", target: a.id(), offerID: treaty.id,
  });
  expect(treaty.status).toBe("rejected");
  expect(treaty.decisionReason).toBe("strategic_assets");
  expect(treaty.reason).toBe("declined");
});

it("lets diplomatic style affect the ranking of alternative concessions without changing cash or resources", () => {
  const port = b.buildUnit(UnitType.Port, game.ref(2, 1), {});
  const proposal = offer(a, b, "peace", {
    receive: { ...emptyAssets(), tiles: [port.tile()], buildings: [port.id()] },
  });
  const beforeGold = b.gold(), beforeOwner = game.owner(port.tile());
  const choice = (game.diplomacy as unknown as {
    chooseCounteroffer: (o: typeof proposal, owner: Player) =>
      { give: ReturnType<typeof emptyAssets> } | null;
  }).chooseCounteroffer(proposal, b);
  expect(choice).not.toBeNull();
  expect(b.gold()).toBe(beforeGold);
  expect(game.owner(port.tile())).toBe(beforeOwner);
  expect(proposal.status).toBe("pending");
});

it("does not modify Classic diplomacy when an ordinary treaty-like action is attempted", async () => {
  const classic = await setup("plains", {}, [
    new PlayerInfo("alpha", PlayerType.Human, "aaaa1111", "alpha"),
    new PlayerInfo("beta", PlayerType.Human, "bbbb1111", "beta"),
  ]);
  const alpha = classic.player("alpha"), beta = classic.player("beta");
  alpha.conquer(classic.ref(0, 0));
  beta.conquer(classic.ref(1, 0));
  classic.diplomacy.act(alpha, {
    action: "offer", target: beta.id(), kind: "peace",
    give: emptyAssets(), receive: emptyAssets(),
  });
  expect(classic.diplomacy.state.log).toEqual([]);
  expect(classic.diplomacy.state.memory).toEqual([]);
});

it("allied border witnesses support a port treaty rather than reacting like neutral rivals", () => {
  const coalition = offer(a, c, "coalition");
  accept(c, coalition.id);
  expect(game.diplomacy.coalition(a.id())?.members).toContain(c.id());
  const port = b.buildUnit(UnitType.Port, game.ref(1, 1), {});
  const treaty = offer(a, b, "peace", {
    receive: { ...emptyAssets(), tiles: [port.tile()], buildings: [port.id()] },
  });
  accept(b, treaty.id);
  expect(treaty.status).toBe("accepted");
  expect(game.diplomacy.state.log.some((event) =>
    event.actor === c.id() && event.target === a.id() &&
    event.event === "ally_support")).toBe(true);
  const memory = game.diplomacy.state.memory.find((entry) =>
    entry.a === c.id() && entry.b === a.id());
  expect(memory?.trust).toBeGreaterThan(8);
});

it("round-trips the new AI decision rationale without altering existing treaty terms", async () => {
  const treaty = offer(a, b, "peace", {
    durationTicks: 3000,
    receive: { ...emptyAssets(), gold: 250 },
  });
  treaty.decisionReason = "cost";
  game.diplomacy.act(b, {
    action: "reject", target: a.id(), offerID: treaty.id,
  });
  const { bytes, again, restored } = await roundTrip(game, "plains");
  expect(diffSnapshots(bytes, again)).toEqual([]);
  const saved = restored.diplomacy.state.offers.find((o) => o.id === treaty.id);
  expect(saved?.decisionReason).toBe("cost");
  expect(saved?.durationTicks).toBe(3000);
  expect(saved?.status).toBe("rejected");
});
