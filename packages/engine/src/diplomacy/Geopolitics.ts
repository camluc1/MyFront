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
  private recordRejection(offer: DiplomaticOffer, actor: string) {
    // Preserve the AI's actual strategic assessment for the player, instead
    // of replacing every explanation with the generic "declined" label.
    if (this.game.hasPlayer(actor) &&
      this.game.player(actor).type() === PlayerType.Nation)
      offer.decisionReason = offer.decisionReason ??
        (offer.reason !== "proposal" ? offer.reason : "insufficient");
    offer.status = "rejected";
    offer.reason = "declined";
    const other = offer.from === actor ? offer.to : offer.from;
    this.log(actor, other, "rejected");
    const m = this.memory(actor, other);
    m.rejections = this.game.ticks() - (m.lastRejection ?? -12001) < 12000
      ? Math.min(8, (m.rejections ?? 0) + 1) : 1;
    m.lastRejection = this.game.ticks();
    m.tick = this.game.ticks();
    const wait = Math.min(6000, 900 * 2 ** Math.min(3, m.rejections - 1));
    this.state.cooldowns[`ai:pair:${other}:${actor}`] = this.game.ticks() + wait;
  }
  /** Encodes meaningful changes in an ongoing war without reacting to every tick. */
  private diplomaticContext(actor: Player, target: Player): number {
    const pressure = this.militaryPressure(actor, target);
    const counterPressure = this.militaryPressure(target, actor);
    const threatTier = pressure >= 28 ? 3 : pressure >= 12 ? 2 : pressure > 0 ? 1 : 0;
    const counterTier = counterPressure >= 24 ? 2 : counterPressure > 0 ? 1 : 0;
    const ratio = this.strategicPower(actor) / Math.max(1, this.strategicPower(target));
    const balanceTier = ratio < 0.5 ? 1 : ratio < 0.85 ? 2 : ratio < 1.5 ? 3 : 4;
    return threatTier * 100 + counterTier * 10 + balanceTier;
  }
  private canInitiateTo(actor: Player, target: Player, tick: number): boolean {
    // There may be many AI nations: avoid an overwhelming stream of unrelated
    // diplomatic notices to the same human. A genuinely severe military crisis
    // can reopen a channel early, but never every few seconds.
    if (target.type() === PlayerType.Human) {
      const next = this.state.cooldowns["ai:human:inbox:" + target.id()] ?? 0;
      if (next > tick) {
        const pressure = Math.max(this.militaryPressure(target, actor),
          this.militaryPressure(actor, target));
        const last = this.state.cooldowns["ai:human:last:" + target.id()] ?? tick;
        if (pressure < 25 || tick - last < 180) return false;
      }
    }
    const pair = `ai:pair:${actor.id()}:${target.id()}`;
    if ((this.state.cooldowns[pair] ?? 0) <= tick) return true;
    // A genuinely new severe offensive can reopen peace talks early, but
    // never create an offer on every minor troop change.
    const context = this.diplomaticContext(actor, target);
    const lastContext = this.state.cooldowns[`ai:context:${actor.id()}:${target.id()}`] ?? context;
    const lastSent = this.state.cooldowns[`ai:sent:${actor.id()}:${target.id()}`] ?? tick;
    return Math.trunc(context / 100) >= 2 &&
      Math.trunc(context / 100) > Math.trunc(lastContext / 100) &&
      tick - lastSent >= 180;
  }
  private participants(a: string, b: string) {
    return [
      ...new Set([
        ...(this.coalition(a)?.members ?? [a]),
        ...(this.coalition(b)?.members ?? [b]),
      ]),
    ].sort();
  }
  /** A coalition's military and industrial strength influences diplomatic choices. */
  private blocPower(player: Player): number {
    const members = this.coalition(player.id())?.members ?? [player.id()];
    return members.reduce(
      (sum, id) => sum + (this.game.hasPlayer(id) && this.game.player(id).isAlive()
        ? this.strategicPower(this.game.player(id)) : 0),
      0,
    );
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
        for (const other of c.members) if (other !== id) {
          const memory = this.memory(other, id);
          memory.trust = Math.max(-100, memory.trust - 25);
          memory.tick = this.game.ticks();
        }
        this.state.cooldowns[`coalition:join:${id}`] = this.game.ticks() + 1800;
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
          this.state.coalitions = this.state.coalitions.filter((c) => c.members.length > 1);
          this.state.cooldowns[`coalition:join:${id}`] = this.game.ticks() + 1800;
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
        // Rivals and surviving coalition allies remember and publicly condemn
        // a breach. The consequence is diplomatic; no automatic declarations
        // of war are added.
        const formerAllies = new Set(harmed);
        const witnesses = this.neighbors(other)
          .filter((p) => p.isAlive() && p !== actor && p !== other &&
            (formerAllies.has(p.id()) ||
              this.coalition(other.id())?.members.includes(p.id())))
          .sort((a, b) => a.smallID() - b.smallID()).slice(0, 4);
        for (const witness of witnesses) {
          const m = this.memory(witness.id(), id);
          m.trust = Math.max(-100, m.trust - 12);
          m.tick = this.game.ticks();
          this.log(witness.id(), id, "betrayal_condemned");
        }
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
      if (action.kind === "coalition" && (
        required.some((member) =>
          (this.state.cooldowns[`coalition:join:${member}`] ?? 0) > this.game.ticks(),
        ) ||
        (required.every((member) => !this.coalition(member)) &&
          this.state.coalitions.length >= 3)
      )) return this.feedback(actor, "coalition");
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
        durationTicks: action.kind === "peace" ? (action.durationTicks ?? 1800) : undefined,
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
      this.recordRejection(offer, id);
      this.emit();
      return;
    }
    if (action.action !== "accept" || offer.approvals.includes(id)) return;
    if (!offer.approvals.includes(id)) offer.approvals.push(id);
    if (offer.required.every((id) => offer.approvals.includes(id)))
      this.accept(offer);
    this.emit();
  }
  private addTreaty(a: string, b: string, kind: DiplomaticOffer["kind"], durationTicks?: 1800 | 3000) {
    this.state.treaties = this.state.treaties.filter(
      (t) => !((t.a === a && t.b === b) || (t.a === b && t.b === a)),
    );
    this.state.treaties.push({
      id: this.state.nextID++,
      a,
      b,
      kind,
      until: this.game.ticks() + (kind === "peace" && durationTicks
        ? durationTicks : TREATY_TICKS[kind]),
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
    // Peace must actually end the active military pressure on both sides.
    // Existing attacks do not automatically stop when a treaty is created.
    if (o.kind === "peace" || o.kind === "truce") {
      for (const attacker of [a, b]) {
        const defender = attacker === a ? b : a;
        for (const attack of attacker.outgoingAttacks()) {
          if (attack.isActive() && attack.target() === defender)
            attack.orderRetreat();
        }
      }
    }
    this.addTreaty(o.from, o.to, o.kind, o.durationTicks);
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
    for (const [receiver, giver, assets] of [
      [o.to, o.from, o.give],
      [o.from, o.to, o.receive],
    ] as const) {
      const m = this.memory(receiver, giver);
      m.trust = Math.min(100, m.trust + 8);
      m.aid += 1;
      m.rejections = 0;
      m.receivedTerritory = (m.receivedTerritory ?? 0) + assets.tiles.length;
      m.receivedPorts = (m.receivedPorts ?? 0) + assets.buildings.filter((id) =>
        this.game.unit(id)?.type() === UnitType.Port).length;
      m.tick = this.game.ticks();
    }
    if (o.reason !== "proposal" && !o.decisionReason)
      o.decisionReason = o.reason;
    o.status = "accepted";
    o.reason = "agreement";
    this.log(o.from, o.to, "agreement");
    this.witnessTerritorialSettlement(a, b, o.give);
    this.witnessTerritorialSettlement(b, a, o.receive);
  }
  /** Neighboring countries react to a geopolitical border change. Those
   * reactions affect later AI negotiation through the existing trust memory.
   * Limit witnessed events to relevant border nations; don't create a global
   * diplomatic penalty for a small settlement or alter Classic gameplay. */
  private witnessTerritorialSettlement(
    loser: Player, winner: Player, assets: DiplomaticAssets,
  ) {
    if (assets.tiles.length === 0) return;
    const portCount = assets.buildings.filter((id) =>
      this.game.unit(id)?.type() === UnitType.Port).length;
    this.log(loser.id(), winner.id(),
      portCount > 0 ? "port_cession" : "territorial_cession");
    const allies = new Set(this.coalition(winner.id())?.members ?? []);
    const borderWitnesses = this.neighbors(loser)
      .filter((p) => p.isAlive() && p !== winner && p !== loser)
      .sort((a, b) => a.smallID() - b.smallID()).slice(0, 4);
    for (const observer of borderWitnesses) {
      const relationship = this.memory(observer.id(), winner.id());
      if (allies.has(observer.id())) {
        relationship.trust = Math.min(100, relationship.trust + 5);
        this.log(observer.id(), winner.id(), "ally_support");
      } else {
        const hostile = relationship.trust <= -15 ||
          relationship.betrayal > 0;
        relationship.trust = Math.max(-100,
          relationship.trust - (hostile ? 8 : 3));
        this.log(observer.id(), winner.id(),
          hostile ? "rival_alarm" : "territorial_concern");
      }
      relationship.tick = this.game.ticks();
    }
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
  /** A port far from its owner's heartland can be the enemy's essential beachhead.
   * Scores are bounded to prevent coastal geography from overriding survival. */
  private portLeverage(portTile: number, owner: Player, receiver: Player): number {
    const ports = receiver.units(UnitType.Port).filter((u) => u.isActive());
    const nearest = ports.length === 0 ? 400 : Math.min(
      400, ...ports.map((p) => this.game.manhattanDist(p.tile(), portTile)),
    );
    const enemyFront = owner.borderTiles().has(portTile) ? 8 : 0;
    // Remote naval access has value; the first port is especially important.
    return Math.min(18000, 3500 + Math.trunc(nearest * 18) +
      (ports.length === 0 ? 5500 : 0) + enemyFront * 200);
  }
  private militaryPressure(defender: Player, aggressor: Player): number {
    const invasions = defender.incomingAttacks().filter((a) =>
      a.isActive() && !a.retreating() && a.attacker() === aggressor);
    const deployed = invasions.reduce((sum, a) => sum + a.troops(), 0);
    const defending = Math.max(1, defender.troops());
    return Math.min(40, Math.trunc(deployed * 25 / defending) +
      (invasions.length > 0 ? 8 : 0));
  }
  /** Approximate the military and resource opportunity cost of a concession.
   * This is not a price displayed to the player: it is a planning comparison.
   * Last critical infrastructure and distant naval reach must not be treated
   * as interchangeable with a few units of gold. */
  private concessionCost(
    owner: Player, receiver: Player, assets: DiplomaticAssets,
  ): number {
    let cost = assets.gold + assets.troops * 3 +
      assets.tiles.length * 500 + this.depositValue(assets.tiles);
    const selected = new Set(assets.buildings);
    for (const id of assets.buildings) {
      const unit = this.game.unit(id);
      if (!unit || !unit.isActive()) continue;
      const type = unit.type();
      const level = Math.max(1, unit.level());
      const weights: Partial<Record<UnitType, number>> = {
        [UnitType.City]: 8000, [UnitType.Factory]: 7000,
        [UnitType.Port]: 6000, [UnitType.Mine]: 5200,
        [UnitType.OilWell]: 6500, [UnitType.GasPlant]: 5800,
        [UnitType.Farm]: 3400, [UnitType.MissileSilo]: 16000,
        [UnitType.SAMLauncher]: 9000, [UnitType.DefensePost]: 8500,
      };
      cost += level * (weights[type] ?? 1000);
      if (type === UnitType.Port)
        cost += this.portLeverage(unit.tile(), owner, receiver);
      if ((type === UnitType.Port || type === UnitType.City ||
        type === UnitType.OilWell || type === UnitType.GasPlant ||
        type === UnitType.Mine) &&
        owner.units(type).every((other) => selected.has(other.id())))
        cost += 60000;
    }
    return cost;
  }

  /** Choose between several credible responses instead of always selling land
   * for a fixed fraction of treasury. Each alternative is validated by the
   * same atomic transfer rules as a human proposal. No randomness is consumed. */
  private chooseCounteroffer(
    offer: DiplomaticOffer, defender: Player,
  ): { give: DiplomaticAssets; receive: DiplomaticAssets;
       reason: string; durationTicks?: 1800 | 3000 } | null {
    const proposer = this.game.player(offer.from);
    const pressure = this.militaryPressure(defender, proposer);
    const requested = offer.receive;
    const requestedLand = requested.tiles.length > 0;
    const treasury = Math.max(0, Number(defender.gold()));
    const troops = Math.max(0, defender.troops());
    const difficulty = this.game.config().gameConfig().difficulty;
    const reluctance = difficulty === Difficulty.Easy ? 5 :
      difficulty === Difficulty.Medium ? 7 :
      difficulty === Difficulty.Hard ? 10 : 14;
    const compensation = Math.min(treasury, Math.max(1000,
      Math.trunc(treasury / reluctance)));
    const originalReceive = { ...offer.give };
    const options: Array<{
      give: DiplomaticAssets; receive: DiplomaticAssets;
      reason: string; durationTicks?: 1800 | 3000;
    }> = [];
    const add = (give: DiplomaticAssets, receive: DiplomaticAssets, reason: string,
      durationTicks?: 1800 | 3000) =>
      options.push({ give, receive, reason, durationTicks });

    if (requestedLand) {
      // Keep the coast, compensate the enemy from the treasury instead.
      add({ ...requested, tiles: [], buildings: [],
        gold: Math.min(treasury, requested.gold + compensation) },
        originalReceive, "retain_land");
      if (pressure > 14 && troops > 150) {
        add({ ...requested, tiles: [], buildings: [],
          gold: Math.min(treasury, requested.gold + Math.trunc(compensation / 2)),
          troops: Math.min(troops,
            requested.troops + Math.trunc(troops / reluctance / 3)) },
          originalReceive, "military_pressure");
      }
      const requestedPorts = new Set(requested.buildings.filter(
        (id) => this.game.unit(id)?.type() === UnitType.Port));
      if (requestedPorts.size > 0 && pressure >= 8) {
        const alternatePorts = defender.units(UnitType.Port)
          .filter((unit) => unit.isActive() &&
            this.game.owner(unit.tile()) === defender &&
            !requestedPorts.has(unit.id()) &&
            !requested.tiles.includes(unit.tile()))
          .sort((left, right) =>
            this.portLeverage(left.tile(), defender, proposer) -
            this.portLeverage(right.tile(), defender, proposer) ||
            left.id() - right.id()).slice(0, 3);
        for (const port of alternatePorts) {
          const buildings = this.game.units().filter((unit) =>
            unit.isActive() && STRUCTURES.has(unit.type()) &&
            unit.tile() === port.tile()).map((unit) => unit.id());
          add({ ...requested, tiles: [port.tile()], buildings },
            originalReceive, "alternative_port");
        }
      }
      // A losing nation can concede what was asked, but request better peace
      // terms instead of making a pointless identical counteroffer.
      if (offer.kind === "peace" && pressure >= 18) {
        add({ ...requested },
          { ...originalReceive,
            gold: Math.min(Number(proposer.gold()),
              originalReceive.gold + Math.trunc(Math.max(1, treasury) / 20)) },
          "survival_peace", 3000);
      }
    } else {
      const requestedGold = requested.gold;
      if (requestedGold > 0) {
        add({ ...requested, gold: Math.max(0,
          Math.trunc(requestedGold * (pressure > 20 ? 0.85 : 0.65))) },
          originalReceive, "economic_compensation");
      }
      if (requested.troops > 0)
        add({ ...requested, troops: Math.min(troops,
          Math.trunc(requested.troops * 0.65)) },
          originalReceive, "military_pressure");
      if (offer.kind === "peace" && pressure > 12) {
        add({ ...requested },
          { ...originalReceive,
            gold: Math.min(Number(proposer.gold()),
              originalReceive.gold + Math.max(1000,
                Math.trunc(treasury / 20))) },
          "survival_peace", 3000);
      }
    }

    const fullCost = this.concessionCost(defender, proposer, requested);
    const capacity = Math.max(10000,
      treasury + troops * 3 + defender.numTilesOwned() * 500);
    const ranked = options
      .filter((option) => this.validAssets(defender, option.give) &&
        this.validAssets(proposer, option.receive))
      .map((option, index) => {
        const counter: DiplomaticOffer = {
          ...offer, from: defender.id(), to: proposer.id(),
          give: option.give, receive: option.receive,
          durationTicks: option.durationTicks ?? offer.durationTicks,
        };
        const acceptance = this.evaluate(counter, proposer).score;
        const cost = this.concessionCost(defender, proposer, option.give);
        const savings = Math.max(-30, Math.min(30,
          Math.trunc((fullCost - cost) * 60 / capacity)));
        const gain = option.receive.gold - originalReceive.gold;
        const valueOfGain = Math.min(12, Math.trunc(gain * 40 / capacity));
        // A realistic deal should satisfy the opponent while preserving as
        // much of the defender's long-term strategic position as possible.
        return { option, index, acceptance,
          value: acceptance * 2 + savings + valueOfGain };
      })
      .filter((entry) => entry.acceptance >= (pressure > 20 ? -20 : -8))
      .sort((a, b) => b.value - a.value ||
        b.acceptance - a.acceptance || a.index - b.index);
    return ranked[0]?.option ?? null;
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
    const blocMine = this.blocPower(recipient);
    const blocTheirs = this.blocPower(sender);
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
    const buildingValue = (id: number, owner: Player, receiver: Player) => {
      const unit = this.game.unit(id);
      if (!unit) return 0;
      const level = Math.max(1, unit.level());
      switch (unit.type()) {
        case UnitType.City: return 8000 * level;
        case UnitType.Port: return (5000 +
          this.portLeverage(unit.tile(), owner, receiver)) * level;
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
    const value = (assets: DiplomaticAssets, owner: Player, receiver: Player) =>
      assets.gold +
      assets.troops * 3 +
      assets.tiles.length * 500 +
      this.depositValue(assets.tiles) +
      assets.buildings.reduce((n, id) => n + buildingValue(id, owner, receiver), 0);
    // An existing coalition member does not receive the bilateral payment.
    const balance = recipient.id() === o.to
      ? value(o.give, sender, recipient) - value(o.receive, recipient, sender)
      : 0;
    const ceded = recipient.id() === o.to ? o.receive : emptyAssets();
    const outgoingPressure = this.militaryPressure(sender, recipient);
    const incomingPressure = this.militaryPressure(recipient, sender);
    const activeWar = incomingPressure > 0 || outgoingPressure > 0;
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
      Math.min(35, m.betrayal * 12) -
      Math.min(16, (m.rejections ?? 0) * 4) +
      Math.min(8, Math.trunc((m.receivedTerritory ?? 0) / 10) +
        (m.receivedPorts ?? 0) * 2) +
      Math.min(30, fronts * 10) +
      Math.min(35, Math.trunc((theirs * 15) / mine)) -
      15 +
      concession;
    if (commonThreat) score += 35;
    // A real ceasefire is far more valuable while being overrun than in peace.
    if (o.kind === "peace" || o.kind === "truce")
      score += incomingPressure - Math.trunc(outgoingPressure / 2);
    // A country cannot casually surrender a strategic coastline in peacetime.
    if (!activeWar && ceded.buildings.some((id) =>
      this.game.unit(id)?.type() === UnitType.Port)) score -= 20;
    // Countries assess a credible hostile bloc, not only its strongest member.
    if (!this.friendly(recipient.id(), sender.id()) && blocTheirs > blocMine * 1.6)
      score += Math.min(15, Math.trunc((blocTheirs / Math.max(1, blocMine) - 1) * 6));
    if (losesLastPort) score -= 30;
    if (losesLastCity) score -= 45;
    if (criticalLoss) score -= 25;
    if (o.ultimatum && theirs > mine * 2) score += 15;
    // Difficulty changes contextual judgment, not just a fixed rejection bonus.
    // Easy is more accommodating; experts distinguish survival from extortion.
    switch (this.game.config().gameConfig().difficulty) {
      case Difficulty.Easy:
        score += 12;
        break;
      case Difficulty.Medium:
        break;
      case Difficulty.Hard:
        score += incomingPressure > 15 ? 6 : -6;
        break;
      case Difficulty.Impossible:
        score += incomingPressure > 20 ? 10 : -11;
        if (!activeWar && ceded.tiles.length > 0) score -= 10;
        break;
    }
    if (personality === 0) score -= 15;
    if (personality === 1 && balance > 0) score += 15;
    if (personality === 3 && o.kind === "coalition") score -= 12;
    if (o.kind === "truce") score += 12;
    if (o.kind === "alliance") {
      score += commonThreat ? 20 : 6;
      if (personality === 3) score += 8;
      if (personality === 0 && !commonThreat) score -= 8;
    }
    if (o.kind === "coalition") {
      // Rare, consequential alliances: no automatic mega-blocs in quiet times.
      if (!commonThreat) score -= 30;
      if (this.coalition(recipient.id()) &&
          !this.coalition(recipient.id())?.members.includes(sender.id())) score -= 30;
    }
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
            o.decisionReason = evaluation.reason;
            if (evaluation.score >= 20)
              this.act(p, { action: "accept", target: o.from, offerID: o.id });
            else if (
              id === o.to &&
              (evaluation.score >= -10 ||
                evaluation.reason === "strategic_assets") &&
              (this.state.cooldowns["ai:counter:" + id + ":" + o.from] ?? 0) <= tick
            ) {
              const plan = this.chooseCounteroffer(o, p);
              if (!plan) {
                this.recordRejection(o, id);
                continue;
              }
              const give = plan.give;
              const receive = plan.receive;
              const countBefore = this.state.offers.length;
              this.act(p, {
                action: "offer",
                target: o.from,
                kind: o.kind,
                give,
                receive,
                counterTo: o.id,
                threat: o.threat,
                durationTicks: plan.durationTicks ?? o.durationTicks,
              });
              if (this.state.offers.length > countBefore) {
                this.state.offers[this.state.offers.length - 1].reason =
                  plan.reason;
                this.state.cooldowns["ai:counter:" + id + ":" + o.from] =
                  tick + Math.max(400,
                    Math.min(1800, 450 + (o.round ?? 0) * 300));
                this.log(id, o.from, "counter");
              } else {
                this.recordRejection(o, id);
              }
            } else {
              this.recordRejection(o, id);
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
      (p) => p !== a && p.isAlive() && p.type() !== PlayerType.Bot &&
        !this.friendly(a.id(), p.id()) &&
        this.canInitiateTo(a, p, tick),
    );
    if (!eligible.length) {
      this.state.cooldowns[initiativeKey] = tick + 300;
      return;
    }
    const power = (p: Player) => this.strategicPower(p);
    const neighbors = this.neighbors(a).filter((p) => eligible.includes(p));
    const activeAttackers = a.incomingAttacks()
      .filter((attack) => attack.isActive() && !attack.retreating())
      .map((attack) => attack.attacker())
      .filter((p) => eligible.includes(p))
      .sort((x, y) => power(y) - power(x) || x.smallID() - y.smallID());

    let target: Player | undefined;
    let kind: DiplomaticOffer["kind"] = "nonaggression";
    let threat = "";
    let ultimatum = false;
    let proposalReason = "balanced";
    const give = emptyAssets();
    const receive = emptyAssets();
    const personality = this.personality(a);

    if (activeAttackers.length > 0) {
      // Negotiate with the country actually attacking, not an arbitrary border neighbor.
      target = activeAttackers[0];
      kind = "peace";
      proposalReason = "survival_peace";
      give.gold = Math.min(Number(a.gold()), Math.max(0, Math.trunc(Number(a.gold()) / 12)));
      give.troops = Math.min(a.troops(), Math.trunc(a.troops() / 30));
      // When defeat is imminent, a nation can proactively offer a less vital
      // harbor as the price of ending the offensive. Harder AI resists until
      // the military situation is considerably more desperate.
      const severity = this.militaryPressure(a, target);
      const threshold: Record<Difficulty, number> = {
        [Difficulty.Easy]: 12,
        [Difficulty.Medium]: 19,
        [Difficulty.Hard]: 27,
        [Difficulty.Impossible]: 34,
      };
      const ports = a.units(UnitType.Port)
        .filter((u) => u.isActive() && this.game.owner(u.tile()) === a)
        .sort((x, y) => this.portLeverage(x.tile(), a, target!) -
          this.portLeverage(y.tile(), a, target!) || x.id() - y.id());
      if (severity >= threshold[this.game.config().gameConfig().difficulty] &&
          power(target) > power(a) * 1.25 && ports.length > 1 &&
          a.numTilesOwned() > 1) {
        give.tiles = [ports[0].tile()];
        give.buildings = this.game.units().filter((u) =>
          u.isActive() && STRUCTURES.has(u.type()) &&
          u.tile() === ports[0].tile()).map((u) => u.id());
      }
    } else {
      // Turn territorial military success into a playable peace settlement.
      // A victorious nation may seek a functioning enemy port without
      // conquering the entire coastline by force.
      const outgoing = a.outgoingAttacks()
        .filter((attack) => attack.isActive() && !attack.retreating());
      const pressured = this.game.players()
        .filter((p) => outgoing.some((attack) => attack.target() === p) &&
          eligible.includes(p) && power(a) >= power(p) * 2)
        .sort((x, y) => power(x) - power(y) || x.smallID() - y.smallID());
      const weaker = pressured.find((p) => p.units(UnitType.Port).some(
        (u) => u.isActive() && this.game.owner(u.tile()) === p));
      if (weaker) {
        const port = weaker.units(UnitType.Port)
          .filter((u) => u.isActive() && this.game.owner(u.tile()) === weaker)
          .sort((x, y) => x.id() - y.id())[0];
        if (port && weaker.numTilesOwned() > 1) {
          target = weaker;
          kind = "peace";
          proposalReason = "military_pressure";
          receive.tiles = [port.tile()];
          receive.buildings = [port.id()];
        }
      }
      const commonThreat = neighbors
        .filter((p) => power(p) > power(a) * 1.3)
        .sort((x, y) => power(y) - power(x))[0];
      if (!target && commonThreat && this.state.coalitions.length < 3) {
        const partners = eligible
          .filter((p) => p !== commonThreat && this.neighbors(p).includes(commonThreat))
          .sort((x, y) => power(y) - power(x));
        if (partners.length > 0) {
          target = partners[0];
          kind = "coalition";
          proposalReason = "common_threat";
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
          proposalReason = "military_pressure";
          ultimatum = true;
          receive.gold = Math.min(Number(target.gold()), Math.max(1000, Math.trunc(Number(target.gold()) / 12)));
          receive.troops = Math.min(target.troops(), Math.trunc(target.troops() / 20));
          // A winning aggressor can demand a remote port in exchange for peace.
          // Include its land tile: transferring only the building is not enough.
          const port = target.units(UnitType.Port)
            .filter((unit) => unit.isActive() &&
              this.game.owner(unit.tile()) === target)
            .sort((x, y) => x.id() - y.id())[0];
          if (port && target.numTilesOwned() > 1 &&
              power(a) > power(target) * 2.5) {
            receive.tiles = [port.tile()];
            receive.buildings = [port.id()];
          }
        }
      }

      if (!target) {
        const strongest = neighbors
          .filter((p) => power(p) > power(a) * 1.2)
          .sort((x, y) => power(y) - power(x))[0];
        if (strongest) {
          target = strongest;
          kind = "alliance";
          proposalReason = "common_threat";
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
    if (this.state.offers.length > before) {
      this.state.offers[this.state.offers.length - 1].reason = proposalReason;
      // A non-rejected AI offer also needs room to breathe. Backoff after
      // rejection is handled above and takes precedence for this pair.
      this.state.cooldowns[`ai:pair:${a.id()}:${target.id()}`] = tick + 900;
      this.state.cooldowns[`ai:context:${a.id()}:${target.id()}`] =
        this.diplomaticContext(a, target);
      this.state.cooldowns[`ai:sent:${a.id()}:${target.id()}`] = tick;
      if (target.type() === PlayerType.Human) {
        this.state.cooldowns["ai:human:inbox:" + target.id()] = tick + 600;
        this.state.cooldowns["ai:human:last:" + target.id()] = tick;
      }
    }
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
