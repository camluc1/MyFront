import {
  Difficulty,
  PlayerType,
  GameType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import {
  diplomaticPersonality,
  DiplomacyAction,
  DiplomacyState,
  DiplomaticAssets,
  DiplomaticOffer,
  emptyAssets,
  emptyDiplomacy,
  TREATY_TICKS,
} from "@openfront/engine-api/Geopolitics";
import { AttackExecution } from "../execution/AttackExecution";
import type { Game, Player } from "../game/Game";

const STRUCTURES = new Set([
  UnitType.City,
  UnitType.Port,
  UnitType.Factory,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
  UnitType.Farm,
  UnitType.Mine,
  UnitType.OilWell,
  UnitType.GasPlant,
]);
export class Geopolitics {
  state: DiplomacyState = emptyDiplomacy();
  private lastEmission = "";
  constructor(private game: Game) {}
  enabled() {
    return (
      this.game.config().gameConfig().geopolitics === true &&
      this.game.config().gameConfig().gameType === GameType.Singleplayer
    );
  }
  coalition(id: string) {
    return this.state.coalitions.find((c) => c.members.includes(id));
  }
  friendly(a: string, b: string) {
    if (!this.enabled()) return false;
    return (
      this.coalition(a)?.members.includes(b) === true ||
      this.state.treaties.some(
        (t) =>
          t.until > this.game.ticks() &&
          ((t.a === a && t.b === b) || (t.b === a && t.a === b)),
      )
    );
  }
  personality(player: Player) {
    return diplomaticPersonality(
      this.game.config().gameConfig().geopoliticsSeed,
      player.smallID(),
    );
  }
  private feedback(player: Player, reason: string) {
    if (player.type() !== PlayerType.Human) return;
    this.state.feedback ??= {};
    this.state.feedback[player.id()] = { tick: this.game.ticks(), reason };
    this.emit();
  }
  private neighbors(player: Player): Player[] {
    const ids = new Set<string>();
    for (const tile of player.borderTiles())
      this.game.forEachNeighbor(tile, (n) => {
        const p = this.game.owner(n);
        if (p.isPlayer() && p !== player) ids.add(p.id());
      });
    return [...ids].sort().map((id) => this.game.player(id));
  }
  aid(a: string, b: string, amount: number) {
    if (!this.enabled() || amount <= 0) return;
    const m = this.memory(b, a);
    m.aid++;
    m.trust = Math.min(
      100,
      m.trust + Math.min(10, Math.max(1, Math.floor(amount / 1000))),
    );
    m.tick = this.game.ticks();
    this.log(a, b, "aid");
  }
  hostility(a: string, b: string) {
    if (!this.enabled()) return;
    const key = `war:${a}:${b}`;
    if ((this.state.cooldowns[key] ?? 0) > this.game.ticks()) return;
    const m = this.memory(b, a);
    m.trust = Math.max(-100, m.trust - 8);
    m.tick = this.game.ticks();
    this.state.cooldowns[key] = this.game.ticks() + 300;
    this.log(a, b, "hostility");
  }
  private memory(a: string, b: string) {
    let m = this.state.memory.find((m) => m.a === a && m.b === b);
    if (!m) {
      m = {
        a,
        b,
        trust: 0,
        betrayal: 0,
        aid: 0,
        kept: 0,
        tick: this.game.ticks(),
      };
      this.state.memory.push(m);
    }
    return m;
  }
  private log(actor: string, target: string, event: string) {
    this.state.log.push({ tick: this.game.ticks(), actor, target, event });
    if (this.state.log.length > 120) this.state.log.shift();
  }
  private participants(a: string, b: string) {
    return [
      ...new Set([
        ...(this.coalition(a)?.members ?? [a]),
        ...(this.coalition(b)?.members ?? [b]),
      ]),
    ].sort();
  }
  private validAssets(owner: Player, assets: DiplomaticAssets) {
    if (owner.gold() < BigInt(assets.gold) || owner.troops() < assets.troops)
      return false;
    const tiles = new Set(assets.tiles);
    const buildings = new Set(assets.buildings);
    if (
      tiles.size !== assets.tiles.length ||
      buildings.size !== assets.buildings.length ||
      (tiles.size > 0 && tiles.size >= owner.numTilesOwned())
    )
      return false;
    for (const t of tiles)
      if (
        !this.game.isValidRef(t) ||
        !this.game.isLand(t) ||
        this.game.isImpassable(t) ||
        this.game.owner(t) !== owner
      )
        return false;
    for (const id of buildings) {
      const u = this.game.unit(id);
      if (
        !u ||
        !u.isActive() ||
        u.owner() !== owner ||
        !STRUCTURES.has(u.type()) ||
        !tiles.has(u.tile())
      )
        return false;
    }
    // Every building in the region must be in the frozen preview, including new construction.
    for (const u of this.game.units())
      if (
        u.isActive() &&
        STRUCTURES.has(u.type()) &&
        tiles.has(u.tile()) &&
        (u.owner() !== owner || !buildings.has(u.id()))
      )
        return false;
    return true;
  }
  act(actor: Player, action: DiplomacyAction) {
    if (!this.enabled() || !actor.isAlive() || this.state.winner.length) return;
    const id = actor.id();
    if (action.action === "leave") {
      const c = this.coalition(id);
      if (c) {
        for (const other of c.members)
          if (other !== id) this.addTreaty(id, other, "truce");
        c.members = c.members.filter((p) => p !== id);
        this.state.coalitions = this.state.coalitions.filter(
          (c) => c.members.length > 1,
        );
        this.state.victory = null;
        this.log(id, "", "leave");
      }
      this.emit();
      return;
    }
    if (!this.game.hasPlayer(action.target) || action.target === id) return;
    const other = this.game.player(action.target);
    if (action.action === "break") {
      if (this.friendly(id, other.id())) {
        const coalition = this.coalition(id);
        const harmed = coalition?.members.includes(other.id())
          ? coalition.members.filter((p) => p !== id)
          : [other.id()];
        if (coalition?.members.includes(other.id())) {
          coalition.members = coalition.members.filter((p) => p !== id);
          this.state.victory = null;
        }
        this.state.treaties = this.state.treaties.filter(
          (t) =>
            !(
              (harmed.includes(t.a) && t.b === id) ||
              (harmed.includes(t.b) && t.a === id)
            ),
        );
        for (const p of harmed) {
          const m = this.memory(p, id);
          m.trust = Math.max(-100, m.trust - 60);
          m.betrayal += 1;
          m.tick = this.game.ticks();
        }
        this.log(id, other.id(), "betrayal");
      }
      this.emit();
      return;
    }
    if (action.action === "offer") {
      if (!other.isAlive() || !action.kind || !action.give || !action.receive)
        return this.feedback(actor, "invalid");
      if (
        action.ultimatum &&
        (this.friendly(id, other.id()) ||
          actor.troops() < other.troops() * 2 ||
          !this.neighbors(actor).includes(other))
      )
        return this.feedback(actor, "ultimatum");
      if (
        action.threat &&
        (!this.game.hasPlayer(action.threat) ||
          !this.game.player(action.threat).isAlive() ||
          this.participants(id, other.id()).includes(action.threat))
      )
        return this.feedback(actor, "threat");
      const previous =
        action.counterTo === undefined
          ? undefined
          : this.state.offers.find(
              (o) =>
                o.id === action.counterTo &&
                o.status === "pending" &&
                o.to === id &&
                o.from === other.id(),
            );
      if (action.counterTo !== undefined && !previous)
        return this.feedback(actor, "expired");
      if (previous && (previous.round ?? 0) >= 3)
        return this.feedback(actor, "rounds");
      const pending = this.state.offers.filter(
        (o) => o.status === "pending" && o !== previous,
      );
      if (
        pending.length >= 32 ||
        pending.filter((o) => o.from === id || o.to === id).length >= 6 ||
        pending.filter((o) => o.from === other.id() || o.to === other.id())
          .length >= 6
      )
        return this.feedback(actor, "inbox_full");
      const key = `${id}:${other.id()}`;
      if (!previous && (this.state.cooldowns[key] ?? 0) > this.game.ticks())
        return this.feedback(actor, "cooldown");
      if (
        !this.validAssets(actor, action.give) ||
        !this.validAssets(other, action.receive)
      )
        return this.feedback(actor, "assets");
      const required =
        action.kind === "coalition"
          ? this.participants(id, other.id())
          : [id, other.id()];
      if (
        required.length > 4 ||
        (action.kind === "coalition" &&
          this.coalition(id)?.members.includes(other.id()))
      )
        return this.feedback(actor, "coalition");
      if (
        required.some(
          (member) =>
            pending.filter((o) => o.required.includes(member)).length >= 6,
        )
      )
        return this.feedback(actor, "inbox_full");
      if (this.state.feedback) delete this.state.feedback[id];
      if (previous) previous.status = "countered";
      this.state.offers.push({
        id: this.state.nextID++,
        from: id,
        to: other.id(),
        kind: action.kind,
        give: action.give,
        receive: action.receive,
        created: this.game.ticks(),
        expires: this.game.ticks() + 450,
        threat: action.threat ?? "",
        status: "pending",
        reason: "proposal",
        ultimatum: action.ultimatum === true,
        enforced: false,
        approvals: [id],
        required,
        round: previous ? (previous.round ?? 0) + 1 : 0,
      });
      this.state.cooldowns[key] = this.game.ticks() + 300;
      this.log(id, other.id(), "offer");
      this.emit();
      return;
    }
    const offer = this.state.offers.find(
      (o) => o.id === action.offerID && o.status === "pending",
    );
    if (
      !offer ||
      !offer.required.includes(id) ||
      ![offer.from, offer.to].includes(other.id())
    )
      return;
    if (action.action === "withdraw" && offer.from === id) {
      offer.status = "withdrawn";
      this.log(id, other.id(), "withdrawn");
      this.emit();
      return;
    }
    if (action.action === "reject" && offer.from !== id) {
      offer.status = "rejected";
      offer.reason = "declined";
      this.log(id, other.id(), "rejected");
      this.emit();
      return;
    }
    if (action.action !== "accept" || offer.approvals.includes(id)) return;
    if (!offer.approvals.includes(id)) offer.approvals.push(id);
    if (offer.required.every((id) => offer.approvals.includes(id)))
      this.accept(offer);
    this.emit();
  }
  private addTreaty(a: string, b: string, kind: DiplomaticOffer["kind"]) {
    this.state.treaties = this.state.treaties.filter(
      (t) => !((t.a === a && t.b === b) || (t.a === b && t.b === a)),
    );
    this.state.treaties.push({
      id: this.state.nextID++,
      a,
      b,
      kind,
      until: this.game.ticks() + TREATY_TICKS[kind],
    });
  }
  private accept(o: DiplomaticOffer) {
    const a = this.game.player(o.from),
      b = this.game.player(o.to);
    if (
      o.expires <= this.game.ticks() ||
      !a.isAlive() ||
      !b.isAlive() ||
      !this.validAssets(a, o.give) ||
      !this.validAssets(b, o.receive) ||
      (o.kind === "coalition" &&
        this.participants(o.from, o.to).join() !== o.required.join())
    ) {
      o.status = "invalid";
      o.reason = "changed";
      return;
    }
    // Validate both sides before the first mutation. No events or ticks interleave this transaction.
    const transfer = (from: Player, to: Player, assets: DiplomaticAssets) => {
      to.addGold(from.removeGold(BigInt(assets.gold)));
      to.addTroops(from.removeTroops(assets.troops));
      for (const tile of assets.tiles) to.conquer(tile);
      for (const id of assets.buildings) this.game.unit(id)!.setOwner(to);
    };
    transfer(a, b, o.give);
    transfer(b, a, o.receive);
    this.addTreaty(o.from, o.to, o.kind);
    if (o.kind === "coalition") {
      this.state.coalitions = this.state.coalitions.filter(
        (c) => !c.members.some((id) => o.required.includes(id)),
      );
      this.state.coalitions.push({
        id: this.state.nextID++,
        members: [...o.required],
        threat: o.threat,
        until: this.game.ticks() + TREATY_TICKS.coalition,
      });
      this.state.victory = null;
    }
    for (const [x, y] of [
      [o.from, o.to],
      [o.to, o.from],
    ]) {
      const m = this.memory(x, y);
      m.trust = Math.min(100, m.trust + 8);
      m.aid += 1;
    }
    o.status = "accepted";
    o.reason = "agreement";
    this.log(o.from, o.to, "agreement");
  }
  /** Integer-only, symmetric information: no extra resources or hidden human penalty. */
  evaluate(
    o: DiplomaticOffer,
    recipient: Player,
  ): { score: number; reason: string } {
    const sender = this.game.player(o.from);
    const m = this.memory(recipient.id(), sender.id());
    const power = (p: Player) =>
      Math.max(
        1,
        p.troops() +
          p.numTilesOwned() * 3 +
          p.units(UnitType.DefensePost).length * 8000 +
          p.units(UnitType.Warship).length * 10000 +
          p
            .units(UnitType.MissileSilo)
            .reduce((n, u) => n + u.level() * 20000, 0) +
          p.units([UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRV])
            .length *
            60000,
      );
    const mine = power(recipient),
      theirs = power(sender);
    const fronts = new Set(
      recipient
        .incomingAttacks()
        .filter((a) => a.isActive() && !a.retreating())
        .map((a) => a.attacker().id()),
    ).size;
    const recipientNeighbors = this.neighbors(recipient);
    const senderNeighbors = this.neighbors(sender);
    const threat = this.game
      .players()
      .filter(
        (p) =>
          p !== sender &&
          p !== recipient &&
          !this.friendly(p.id(), recipient.id()) &&
          recipientNeighbors.includes(p),
      )
      .sort((a, b) => power(b) - power(a))[0];
    const commonThreat =
      !!threat && power(threat) > mine && senderNeighbors.includes(threat);
    const value = (assets: DiplomaticAssets) =>
      assets.gold +
      assets.troops * 3 +
      assets.tiles.length * 500 +
      assets.buildings.reduce(
        (n, id) => n + (this.game.unit(id)?.level() ?? 1) * 10000,
        0,
      );
    // An existing coalition member does not receive the bilateral payment.
    const balance =
      recipient.id() === o.to ? value(o.give) - value(o.receive) : 0;
    const ceded = recipient.id() === o.to ? o.receive : emptyAssets();
    const surrendered = ceded.buildings
      .map((id) => this.game.unit(id))
      .filter((u) => u !== undefined);
    const losesLastPort =
      recipient.units(UnitType.Port).length > 0 &&
      surrendered.filter((u) => u.type() === UnitType.Port).length ===
        recipient.units(UnitType.Port).length;
    const losesLastCity =
      recipient.units(UnitType.City).length > 0 &&
      surrendered.filter((u) => u.type() === UnitType.City).length ===
        recipient.units(UnitType.City).length;
    const wealth = Math.max(
      10000,
      Number(recipient.gold()) +
        recipient.troops() * 3 +
        recipient.numTilesOwned() * 500,
    );
    const concession = Math.trunc((balance * 100) / wealth);
    const personality = this.personality(recipient); // expansionist, trader, pragmatic, cautious
    let score =
      12 +
      Math.trunc(m.trust / 3) -
      Math.min(35, m.betrayal * 12) +
      Math.min(30, fronts * 10) +
      Math.min(35, Math.trunc((theirs * 15) / mine)) -
      15 +
      concession;
    if (commonThreat) score += 35;
    if (losesLastPort) score -= 30;
    if (losesLastCity) score -= 45;
    if (o.ultimatum && theirs > mine * 2) score += 15;
    if (
      this.game.config().gameConfig().difficulty === Difficulty.Hard ||
      this.game.config().gameConfig().difficulty === Difficulty.Impossible
    )
      score -= 5;
    if (personality === 0) score -= 15;
    if (personality === 1 && balance > 0) score += 15;
    if (personality === 3 && o.kind === "coalition") score -= 12;
    if (o.kind === "truce") score += 12;
    if (o.kind === "coalition" && !commonThreat) score -= 15;
    if (ceded.tiles.length * 3 > recipient.numTilesOwned()) score -= 30;
    return {
      score,
      reason:
        losesLastPort || losesLastCity
          ? "strategic_assets"
          : commonThreat
            ? threat!.units(UnitType.MissileSilo).length > 0
              ? "nuclear_threat"
              : "common_threat"
            : fronts > 0
              ? "multiple_fronts"
              : concession < -10
                ? "cost"
                : m.betrayal > 0
                  ? "distrust"
                  : score >= 20
                    ? "balanced"
                    : "insufficient",
    };
  }
  tick() {
    if (!this.enabled() || this.game.inSpawnPhase() || this.state.winner.length)
      return;
    const tick = this.game.ticks();
    for (const o of this.state.offers)
      if (o.status === "pending" && o.expires <= tick) {
        o.status = "expired";
        o.reason = "expired";
      }
    for (const t of this.state.treaties)
      if (t.until === tick) {
        this.log(t.a, t.b, "treaty_expired");
        for (const [a, b] of [
          [t.a, t.b],
          [t.b, t.a],
        ]) {
          const m = this.memory(a, b);
          m.kept++;
          m.trust = Math.min(100, m.trust + 10);
        }
      }
    this.state.treaties = this.state.treaties.filter((t) => t.until > tick);
    this.state.coalitions = this.state.coalitions
      .filter((c) => c.until > tick)
      .map((c) => ({
        ...c,
        members: c.members.filter((id) => this.game.player(id).isAlive()),
      }))
      .filter((c) => c.members.length > 1);
    for (const o of this.state.offers)
      if (
        o.ultimatum &&
        !o.enforced &&
        (o.status === "expired" || o.status === "rejected")
      ) {
        o.enforced = true;
        const a = this.game.player(o.from),
          b = this.game.player(o.to);
        if (
          a.type() !== PlayerType.Human &&
          a.isAlive() &&
          b.isAlive() &&
          !this.friendly(a.id(), b.id()) &&
          a.troops() > b.troops() * 1.5 &&
          this.neighbors(a).includes(b)
        )
          this.game.addExecution(
            new AttackExecution(Math.floor(a.troops() / 3), a, b.id(), null),
          );
      }
    this.checkVictory();
    if (tick % 10 === 0) {
      for (const o of [...this.state.offers])
        if (o.status === "pending" && tick - o.created >= 20) {
          for (const id of o.required) {
            if (o.status !== "pending" || o.approvals.includes(id)) continue;
            const p = this.game.player(id);
            if (p.type() === PlayerType.Human) continue;
            const evaluation = this.evaluate(o, p);
            o.reason = evaluation.reason;
            if (evaluation.score >= 20)
              this.act(p, { action: "accept", target: o.from, offerID: o.id });
            else if (
              id === o.to &&
              (evaluation.score >= -10 ||
                evaluation.reason === "strategic_assets") &&
              !this.state.log
                .slice(-10)
                .some(
                  (l) =>
                    l.actor === id &&
                    l.target === o.from &&
                    l.event === "counter",
                )
            ) {
              const keepsLand = o.receive.tiles.length > 0;
              const give = keepsLand
                ? {
                    ...o.receive,
                    tiles: [],
                    buildings: [],
                    gold: Math.min(
                      Number(p.gold()),
                      o.receive.gold +
                        Math.max(1000, Math.trunc(Number(p.gold()) / 8)),
                    ),
                  }
                : { ...o.receive };
              const receive = keepsLand
                ? { ...o.give }
                : {
                    ...o.give,
                    gold: Math.min(
                      1000000000000,
                      Number(this.game.player(o.from).gold()),
                      o.give.gold +
                        Math.max(1000, Math.trunc(Number(p.gold()) / 10)),
                    ),
                  };
              const countBefore = this.state.offers.length;
              this.act(p, {
                action: "offer",
                target: o.from,
                kind: o.kind,
                give,
                receive,
                counterTo: o.id,
                threat: o.threat,
              });
              if (this.state.offers.length > countBefore) {
                if (keepsLand)
                  this.state.offers[this.state.offers.length - 1].reason =
                    "retain_land";
                this.log(id, o.from, "counter");
              } else {
                o.status = "rejected";
              }
            } else {
              o.status = "rejected";
            }
          }
        }
      if (tick % 100 === 0) this.initiate();
      if (tick % 600 === 0)
        for (const m of this.state.memory) {
          if (m.trust < 0) m.trust += 1;
          else if (m.trust > 0) m.trust -= 1;
        }
      this.state.offers = this.state.offers
        .filter((o) => o.status === "pending" || tick - o.created < 3600)
        .slice(-160);
      this.emit();
    }
  }
  private initiate() {
    const players = this.game
      .players()
      .filter((p) => p.type() !== PlayerType.Bot)
      .sort((a, b) => a.smallID() - b.smallID());
    if (!players.length) return;
    // One AI country per interval; cost stays bounded on large maps.
    const a =
      players[
        (Math.trunc(this.game.ticks() / 100) +
          (this.game.config().gameConfig().geopoliticsSeed ?? 0)) %
          players.length
      ];
    if (
      a.type() === PlayerType.Human ||
      this.state.offers.some(
        (o) => o.status === "pending" && (o.from === a.id() || o.to === a.id()),
      )
    )
      return;
    const adjacent = this.neighbors(a)
      .filter(
        (p): p is Player =>
          p.isPlayer() && p.isAlive() && !this.friendly(a.id(), p.id()),
      )
      .sort((x, y) => y.troops() - x.troops());
    const vulnerable = adjacent.find(
      (p) => p.troops() * 3 < a.troops() && Number(p.gold()) > 10000,
    );
    if (
      vulnerable &&
      this.personality(a) === 0 &&
      (this.state.cooldowns[`ultimatum:${a.id()}`] ?? 0) <= this.game.ticks()
    ) {
      this.act(a, {
        action: "offer",
        target: vulnerable.id(),
        kind: "peace",
        give: emptyAssets(),
        receive: {
          ...emptyAssets(),
          gold: Math.floor(Number(vulnerable.gold()) / 10),
        },
        ultimatum: true,
      });
      this.state.cooldowns[`ultimatum:${a.id()}`] = this.game.ticks() + 1800;
      return;
    }
    const b = adjacent.find(
      (p) => p.troops() < a.troops() * 2 && p.troops() * 2 > a.troops(),
    );
    if (!b) return;
    const threat = adjacent.find(
      (p) => p !== b && p.troops() > a.troops() * 1.5,
    );
    const kind = threat
      ? "coalition"
      : a.incomingAttacks().length
        ? "peace"
        : "nonaggression";
    if (kind === "nonaggression" && this.personality(a) === 0) return;
    const give = emptyAssets();
    if (kind === "peace") give.gold = Math.trunc(Number(a.gold()) / 12);
    this.act(a, {
      action: "offer",
      target: b.id(),
      kind,
      give,
      receive: emptyAssets(),
      threat: threat?.id(),
    });
  }
  checkVictory() {
    if (!this.enabled() || this.state.winner.length) return;
    const players = this.game.players();
    const groups = [
      ...this.state.coalitions.map((c) => c.members),
      ...players.filter((p) => !this.coalition(p.id())).map((p) => [p.id()]),
    ];
    const total = Math.max(
      1,
      this.game.numLandTiles() - this.game.numTilesWithFallout(),
    );
    const group = groups.find(
      (ids) =>
        ids.reduce((n, id) => n + this.game.player(id).numTilesOwned(), 0) *
          10 >=
        total * 9,
    );
    if (!group) {
      this.state.victory = null;
      return;
    }
    const members = [...group].sort();
    const share = Math.trunc(
      (members.reduce((n, id) => n + this.game.player(id).numTilesOwned(), 0) *
        1000) /
        total,
    );
    if (this.state.victory?.members.join() !== members.join())
      this.state.victory = {
        members,
        since: this.game.ticks(),
        remaining: 60,
        share,
      };
    const v = this.state.victory!;
    v.share = share;
    v.remaining = Math.max(
      0,
      Math.ceil((600 - (this.game.ticks() - v.since)) / 10),
    );
    if (v.remaining === 0) {
      this.state.winner = members;
      this.game.setWinner(
        members.length > 1
          ? `coalition:${members.join(",")}`
          : this.game.player(members[0]),
        this.game.stats().stats(),
      );
      this.emit();
    }
  }
  hash() {
    let h = 0;
    const value = JSON.stringify(this.state);
    for (let i = 0; i < value.length; i++)
      h = ((h << 5) - h + value.charCodeAt(i)) | 0;
    return h;
  }
  emit() {
    if (!this.enabled()) return;
    const serialized = JSON.stringify(this.state);
    if (serialized === this.lastEmission) return;
    this.lastEmission = serialized;
    this.game.addUpdate({ type: GameUpdateType.Diplomacy, state: this.state });
  }
  resync() {
    this.lastEmission = "";
    this.emit();
  }
}
