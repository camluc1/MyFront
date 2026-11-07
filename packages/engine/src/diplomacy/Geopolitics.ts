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
import { resourceDeposits } from "@openfront/engine-lib/game/NaturalResources";
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
          this.strategicPower(actor) < this.strategicPower(other) * 2 ||
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
  /** Values static natural-resource deposits intersecting an exact land transfer. */
  private depositValue(tiles: readonly number[]): number {
    if (tiles.length === 0) return 0;
    const map = this.game.map();
    const mapType = this.game.config().gameConfig().gameMap;
    const selected = new Set(tiles);
    const baseValue: Record<string, number> = {
      fertile_soil: 250, oil: 1500, gas: 1250, coal: 800,
      gold: 1450, silver: 950, copper: 850, iron: 900,
      lithium: 1350, uranium: 1550,
    };
    let total = 0;
    for (const site of resourceDeposits(map, mapType)) {
      const radius = Math.ceil(site.radius);
      const minX = Math.max(0, Math.floor(site.x - radius));
      const maxX = Math.min(map.width() - 1, Math.ceil(site.x + radius));
      const minY = Math.max(0, Math.floor(site.y - radius));
      const maxY = Math.min(map.height() - 1, Math.ceil(site.y + radius));
      let intersects = false;
      for (let y = minY; y <= maxY && !intersects; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = x - site.x, dy = y - site.y;
          if (dx * dx + dy * dy > site.radius * site.radius) continue;
          const ref = map.ref(x, y);
          if (map.isLand(ref) && selected.has(ref)) { intersects = true; break; }
        }
      }
      if (!intersects) continue;
      const remaining = site.resource === "fertile_soil"
        ? 6
        : Math.min(6, this.game.resourceRemaining(site.id, site.capacity));
      if (remaining > 0)
        total += (baseValue[site.resource] ?? 500) * site.quality * remaining;
    }
    return Math.trunc(total / 10);
  }
  /** Shared strategic valuation used by both offer evaluation and AI diplomacy. */
  private strategicPower(p: Player): number {
    const value = (type: UnitType, weight: number) =>
      p.units(type).reduce(
        (sum, unit) => sum + weight * Math.max(1, unit.level()),
        0,
      );
    // Treasury has diminishing returns: wealth matters, but cannot replace an army.
    const treasury = Math.trunc(Math.sqrt(Math.max(0, Number(p.gold()))) * 8);
    return Math.max(
      1,
      p.troops() +
        p.numTilesOwned() * 3 +
        treasury +
        value(UnitType.City, 2400) +
        value(UnitType.Port, 1500) +
        value(UnitType.Factory, 1900) +
        value(UnitType.Farm, 850) +
        value(UnitType.Mine, 1400) +
        value(UnitType.OilWell, 1600) +
        value(UnitType.GasPlant, 1500) +
        value(UnitType.DefensePost, 8000) +
        value(UnitType.SAMLauncher, 6500) +
        value(UnitType.MissileSilo, 20000) +
        p.units(UnitType.Warship).length * 10000 +
        p.units([UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRV])
          .length *
          60000,
    );
  }
  /** Deterministic evaluation of an offer from the recipient country's perspective. */
  evaluate(
    o: DiplomaticOffer,
    recipient: Player,
  ): { score: number; reason: string } {
    const sender = this.game.player(o.from);
    const m = this.memory(recipient.id(), sender.id());
    const power = (p: Player) => this.strategicPower(p);
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
    const buildingValue = (id: number) => {
      const unit = this.game.unit(id);
      if (!unit) return 0;
      const level = Math.max(1, unit.level());
      switch (unit.type()) {
        case UnitType.City: return 8000 * level;
        case UnitType.Port: return 5000 * level;
        case UnitType.Factory: return 6500 * level;
        case UnitType.Farm: return 2800 * level;
        case UnitType.Mine: return 4800 * level;
        case UnitType.OilWell: return 6000 * level;
        case UnitType.GasPlant: return 5600 * level;
        case UnitType.DefensePost: return 9000 * level;
        case UnitType.SAMLauncher: return 8000 * level;
        case UnitType.MissileSilo: return 18000 * level;
        default: return 1500 * level;
      }
    };
    const value = (assets: DiplomaticAssets) =>
      assets.gold +
      assets.troops * 3 +
      assets.tiles.length * 500 +
      this.depositValue(assets.tiles) +
      assets.buildings.reduce((n, id) => n + buildingValue(id), 0);
    // An existing coalition member does not receive the bilateral payment.
    const balance =
      recipient.id() === o.to ? value(o.give) - value(o.receive) : 0;
    const ceded = recipient.id() === o.to ? o.receive : emptyAssets();
    const surrendered = ceded.buildings
      .map((id) => this.game.unit(id))
      .filter((u) => u !== undefined);
    const losesLast = (type: UnitType) => {
      const owned = recipient.units(type);
      return owned.length > 0 &&
        owned.every((unit) => ceded.buildings.includes(unit.id()));
    };
    const losesLastPort = losesLast(UnitType.Port);
    const losesLastCity = losesLast(UnitType.City);
    const criticalLoss = [
      UnitType.Factory,
      UnitType.Farm,
      UnitType.Mine,
      UnitType.OilWell,
      UnitType.GasPlant,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
      UnitType.DefensePost,
    ].some(losesLast);
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
    if (criticalLoss) score -= 25;
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
    if (o.kind === "alliance") {
      score += commonThreat ? 20 : 6;
      if (personality === 3) score += 8;
      if (personality === 0 && !commonThreat) score -= 8;
    }
    if (o.kind === "coalition" && !commonThreat) score -= 15;
    if (ceded.tiles.length * 3 > recipient.numTilesOwned()) score -= 30;
    return {
      score,
      reason:
        losesLastPort || losesLastCity || criticalLoss
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
          this.strategicPower(a) > this.strategicPower(b) * 1.5 &&
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
      if (tick % 30 === 0) this.initiate();
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
    const nations = this.game
      .players()
      .filter((p) => p.type() === PlayerType.Nation && p.isAlive())
      .sort((a, b) => a.smallID() - b.smallID());
    if (!nations.length) return;

    // One nation gets an initiative slot every three seconds. Per-country and
    // per-pair cooldowns prevent repeated pressure while allowing diplomacy
    // to remain visible throughout a long campaign.
    const tick = this.game.ticks();
    const slot = Math.trunc(tick / 30);
    const a = nations[(slot + (this.game.config().gameConfig().geopoliticsSeed ?? 0)) % nations.length]!;
    const initiativeKey = `initiative:${a.id()}`;
    if (
      (this.state.cooldowns[initiativeKey] ?? 0) > tick ||
      this.state.offers.some(
        (o) => o.status === "pending" && (o.from === a.id() || o.to === a.id()),
      )
    ) return;

    const eligible = this.game.players().filter(
      (p) => p !== a && p.isAlive() && p.type() !== PlayerType.Bot && !this.friendly(a.id(), p.id()),
    );
    if (!eligible.length) {
      this.state.cooldowns[initiativeKey] = tick + 300;
      return;
    }
    const power = (p: Player) => this.strategicPower(p);
    const neighbors = this.neighbors(a).filter(
      (p) => p.isAlive() && p.type() !== PlayerType.Bot && !this.friendly(a.id(), p.id()),
    );
    const activeAttackers = a.incomingAttacks()
      .filter((attack) => attack.isActive() && !attack.retreating())
      .map((attack) => attack.attacker())
      .filter((p) => p.isAlive() && p.type() !== PlayerType.Bot && !this.friendly(a.id(), p.id()))
      .sort((x, y) => power(y) - power(x) || x.smallID() - y.smallID());

    let target: Player | undefined;
    let kind: DiplomaticOffer["kind"] = "nonaggression";
    let threat = "";
    let ultimatum = false;
    const give = emptyAssets();
    const receive = emptyAssets();
    const personality = this.personality(a);

    if (activeAttackers.length > 0) {
      // Negotiate with the country actually attacking, not an arbitrary border neighbor.
      target = activeAttackers[0];
      kind = "peace";
      give.gold = Math.min(Number(a.gold()), Math.max(0, Math.trunc(Number(a.gold()) / 12)));
      give.troops = Math.min(a.troops(), Math.trunc(a.troops() / 30));
    } else {
      const commonThreat = neighbors
        .filter((p) => power(p) > power(a) * 1.3)
        .sort((x, y) => power(y) - power(x))[0];
      if (commonThreat) {
        const partners = eligible
          .filter((p) => p !== commonThreat && this.neighbors(p).includes(commonThreat))
          .sort((x, y) => power(y) - power(x));
        if (partners.length > 0) {
          target = partners[0];
          kind = "coalition";
          threat = commonThreat.id();
        }
      }

      if (!target) {
        const vulnerable = neighbors
          .filter((p) => power(a) >= power(p) * 2 && Number(p.gold()) > 5000)
          .sort((x, y) => power(x) - power(y))[0];
        if (vulnerable && personality === 0 &&
            (this.state.cooldowns[`ultimatum:${a.id()}`] ?? 0) <= tick) {
          target = vulnerable;
          kind = "peace";
          ultimatum = true;
          receive.gold = Math.min(Number(target.gold()), Math.max(1000, Math.trunc(Number(target.gold()) / 12)));
          receive.troops = Math.min(target.troops(), Math.trunc(target.troops() / 20));
        }
      }

      if (!target) {
        const strongest = neighbors
          .filter((p) => power(p) > power(a) * 1.2)
          .sort((x, y) => power(y) - power(x))[0];
        if (strongest) {
          target = strongest;
          kind = "alliance";
          give.gold = Math.min(Number(a.gold()), Math.trunc(Number(a.gold()) / 30));
          give.troops = Math.trunc(a.troops() / 40);
        }
      }

      if (!target) {
        // Distant nations can still sign a bilateral pact; diplomacy is not
        // restricted to land borders when no immediate military crisis exists.
        target = eligible
          .slice()
          .sort((x, y) =>
            Math.abs(power(x) - power(a)) - Math.abs(power(y) - power(a)) ||
            x.smallID() - y.smallID(),
          )[0];
        if (target) {
          kind = personality === 1 || personality === 2 ? "alliance" : "nonaggression";
          if (kind === "alliance") give.gold = Math.min(Number(a.gold()), Math.trunc(Number(a.gold()) / 50));
        }
      }
    }

    if (!target) {
      this.state.cooldowns[initiativeKey] = tick + 300;
      return;
    }
    const before = this.state.offers.length;
    this.act(a, {
      action: "offer",
      target: target.id(),
      kind,
      give,
      receive,
      threat: threat || undefined,
      ultimatum,
    });
    this.state.cooldowns[initiativeKey] = tick + (this.state.offers.length > before ? 300 : 120);
    if (ultimatum && this.state.offers.length > before)
      this.state.cooldowns[`ultimatum:${a.id()}`] = tick + 1800;
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
