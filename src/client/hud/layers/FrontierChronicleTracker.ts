export interface FrontierChroniclePlayer {
  smallID: number;
  name: string;
  isAI: boolean;
  isHuman: boolean;
  /** True for map nations; excludes simpler tribes from power rankings. */
  isNation?: boolean;
  isAlive: boolean;
  tiles: number;
  allies: readonly number[];
  outgoingTargets: readonly number[];
  /** Smoothed cumulative income rate supplied by the client-side rate tracker. */
  goldIncomePerMin?: number;
  troops?: number;
  maxTroops?: number;
  /** Active atom-bomb units observed on the map; used to detect a nation's first nuclear launch. */
  atomBombCount?: number;
  /** Nation IDs currently sending transport ships toward this player. */
  incomingNavalAttackers?: readonly number[];
}

export type FrontierChronicleKind =
  | "war"
  | "alliance-formed"
  | "alliance-ended"
  | "elimination"
  | "expansion"
  | "power-shift"
  | "economic-surge"
  | "military-build-up"
  | "power-decline"
  | "economic-hegemony"
  | "military-hegemony"
  | "nuclear-development"
  | "naval-threat";

export interface FrontierChronicleEntry {
  id: string;
  tick: number;
  kind: FrontierChronicleKind;
  headline: string;
  detail: string;
}

interface Snapshot {
  players: Map<number, FrontierChroniclePlayer>;
  alliances: Map<string, readonly [number, number]>;
  attacks: Map<string, readonly [number, number]>;
  navalThreats: Map<string, readonly [number, number]>;
  leadingNationID: number | null;
  leadingEconomicNationID: number | null;
  leadingMilitaryNationID: number | null;
}

function pairKey(a: number, b: number): string {
  return a < b ? String(a) + ":" + String(b) : String(b) + ":" + String(a);
}

function createSnapshot(
  players: readonly FrontierChroniclePlayer[],
): Snapshot {
  const byID = new Map<number, FrontierChroniclePlayer>(
    players.map((player) => [player.smallID, player] as const),
  );
  const alliances = new Map<string, readonly [number, number]>();
  const attacks = new Map<string, readonly [number, number]>();
  const navalThreats = new Map<string, readonly [number, number]>();

  for (const player of players) {
    if (!player.isAlive) continue;

    for (const otherID of player.allies) {
      const other = byID.get(otherID);
      if (!other?.isAlive || otherID === player.smallID) continue;
      const key = pairKey(player.smallID, otherID);
      alliances.set(key, [
        Math.min(player.smallID, otherID),
        Math.max(player.smallID, otherID),
      ]);
    }

    for (const targetID of player.outgoingTargets) {
      const target = byID.get(targetID);
      if (!target?.isAlive || targetID === player.smallID) continue;
      const key = String(player.smallID) + ">" + String(targetID);
      attacks.set(key, [player.smallID, targetID]);
    }

    for (const attackerID of player.incomingNavalAttackers ?? []) {
      const attacker = byID.get(attackerID);
      if (!attacker?.isAlive || attackerID === player.smallID) continue;
      const key = String(attackerID) + "~>" + String(player.smallID);
      navalThreats.set(key, [attackerID, player.smallID]);
    }
  }

  // Preserve the existing territorial-hegemony definition (all living AI
  // factions). Economic and military leadership are nation-only metrics.
  const leadingNation = players
    .filter((player) => player.isAI && player.isAlive)
    .sort((a, b) => b.tiles - a.tiles || a.smallID - b.smallID)[0];
  const nations = players.filter(
    (player) => (player.isNation ?? player.isAI) && player.isAlive,
  );
  const leadingEconomicNation = nations
    .filter((player) => (player.goldIncomePerMin ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.goldIncomePerMin ?? 0) -
          (a.goldIncomePerMin ?? 0) ||
        a.smallID - b.smallID,
    )[0];
  const leadingMilitaryNation = nations
    .filter((player) => (player.troops ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.troops ?? 0) - (a.troops ?? 0) ||
        a.smallID - b.smallID,
    )[0];

  return {
    players: byID,
    alliances,
    attacks,
    navalThreats,
    leadingNationID: leadingNation?.smallID ?? null,
    leadingEconomicNationID: leadingEconomicNation?.smallID ?? null,
    leadingMilitaryNationID: leadingMilitaryNation?.smallID ?? null,
  };
}

/**
 * Turns authoritative client-side game-state changes into a compact,
 * single-player world chronicle. It does not mutate the simulation.
 */
export class FrontierChronicleTracker {
  private previous: Snapshot | null = null;
  private previousTick = -1;
  private sequence = 0;
  private readonly lastWarNotice = new Map<string, number>();
  private readonly lastExpansionNotice = new Map<number, number>();
  private readonly lastEconomyNotice = new Map<number, number>();
  private readonly lastMilitaryNotice = new Map<number, number>();
  private readonly lastDeclineNotice = new Map<number, number>();
  private announcedLeaderID: number | null = null;
  private announcedEconomicLeaderID: number | null = null;
  private announcedMilitaryLeaderID: number | null = null;
  private readonly announcedNuclearSmallIDs = new Set<number>();
  private lastPowerNotice = -1;
  private lastEconomicPowerNotice = -1;
  private lastMilitaryPowerNotice = -1;

  observe(
    players: readonly FrontierChroniclePlayer[],
    tick: number,
  ): FrontierChronicleEntry[] {
    const current = createSnapshot(players);

    if (this.previous === null || tick < this.previousTick) {
      this.previous = current;
      this.previousTick = tick;
      this.announcedNuclearSmallIDs.clear();
      for (const player of players) {
        if (
          (player.isNation || player.isHuman) &&
          (player.atomBombCount ?? 0) > 0
        ) {
          this.announcedNuclearSmallIDs.add(player.smallID);
        }
      }
      this.announcedLeaderID = current.leadingNationID;
      this.announcedEconomicLeaderID = current.leadingEconomicNationID;
      this.announcedMilitaryLeaderID = current.leadingMilitaryNationID;
      this.lastWarNotice.clear();
      this.lastExpansionNotice.clear();
      this.lastEconomyNotice.clear();
      this.lastMilitaryNotice.clear();
      this.lastDeclineNotice.clear();
      this.lastPowerNotice = -1;
      this.lastEconomicPowerNotice = -1;
      this.lastMilitaryPowerNotice = -1;
      return [];
    }

    const previous = this.previous;
    const entries: FrontierChronicleEntry[] = [];
    const push = (
      kind: FrontierChronicleKind,
      headline: string,
      detail: string,
    ) => {
      entries.push({
        id: String(tick) + "-" + String(this.sequence++),
        tick,
        kind,
        headline,
        detail,
      });
    };

    for (const [smallID, oldPlayer] of previous.players) {
      const nextPlayer = current.players.get(smallID);
      if (oldPlayer.isAlive && nextPlayer && !nextPlayer.isAlive) {
        push(
          "elimination",
          oldPlayer.isHuman ? "Tu imperio fue eliminado" : "Facción eliminada",
          oldPlayer.name + " perdió el control de su territorio.",
        );
      }
    }

    for (const [key, pair] of current.alliances) {
      if (previous.alliances.has(key)) continue;
      const left = current.players.get(pair[0]);
      const right = current.players.get(pair[1]);
      if (!left || !right) continue;
      push(
        "alliance-formed",
        "Nuevo pacto",
        left.name + " y " + right.name + " formaron una alianza.",
      );
    }

    for (const [key, pair] of previous.alliances) {
      if (current.alliances.has(key)) continue;
      const left = current.players.get(pair[0]);
      const right = current.players.get(pair[1]);
      if (!left?.isAlive || !right?.isAlive) continue;
      push(
        "alliance-ended",
        "Pacto disuelto",
        "La alianza entre " + left.name + " y " + right.name + " terminó.",
      );
    }

    for (const [smallID, nextPlayer] of current.players) {
      const oldPlayer = previous.players.get(smallID);
      if (
        !oldPlayer?.isAlive ||
        !nextPlayer.isAlive ||
        (!nextPlayer.isNation && !nextPlayer.isHuman)
      ) {
        continue;
      }
      if (
        (nextPlayer.atomBombCount ?? 0) > 0 &&
        !this.announcedNuclearSmallIDs.has(smallID)
      ) {
        push(
          "nuclear-development",
          "Nueva potencia nuclear",
          nextPlayer.name +
            " realizó su primer lanzamiento de bomba atómica. El equilibrio militar mundial cambió.",
        );
        this.announcedNuclearSmallIDs.add(smallID);
      }
    }

    for (const [key, pair] of current.navalThreats) {
      if (previous.navalThreats.has(key)) continue;
      const attacker = current.players.get(pair[0]);
      const target = current.players.get(pair[1]);
      if (!attacker || !target || !target.isHuman) continue;
      push(
        "naval-threat",
        "Invasión naval detectada",
        attacker.name + " envió un transporte hacia las costas de " + target.name + ".",
      );
    }

    for (const [key, pair] of current.attacks) {
      if (previous.attacks.has(key)) continue;
      const lastNotice = this.lastWarNotice.get(key);
      if (lastNotice !== undefined && tick - lastNotice < 240) continue;
      const attacker = current.players.get(pair[0]);
      const target = current.players.get(pair[1]);
      if (!attacker || !target) continue;
      push(
        "war",
        "Se abrió un frente",
        attacker.name + " lanzó una ofensiva contra " + target.name + ".",
      );
      this.lastWarNotice.set(key, tick);
    }

    for (const [smallID, nextPlayer] of current.players) {
      const oldPlayer = previous.players.get(smallID);
      if (!oldPlayer?.isAlive || !nextPlayer.isAlive || !nextPlayer.isAI) continue;
      const gained = nextPlayer.tiles - oldPlayer.tiles;
      const threshold = Math.max(18, Math.ceil(oldPlayer.tiles * 0.3));
      const lastNotice = this.lastExpansionNotice.get(smallID);
      if (
        gained < threshold ||
        (lastNotice !== undefined && tick - lastNotice < 300)
      ) {
        continue;
      }
      push(
        "expansion",
        "Expansión territorial",
        nextPlayer.name + " incorporó " + gained + " territorios en poco tiempo.",
      );
      this.lastExpansionNotice.set(smallID, tick);
    }

    // Strategic/economic notices are intentionally sparse. They require a
    // meaningful relative change plus a long cooldown, so the chronicle stays
    // a record of major developments rather than a stream of tick noise.
    for (const [smallID, nextPlayer] of current.players) {
      const oldPlayer = previous.players.get(smallID);
      if (
        !oldPlayer?.isAlive ||
        !nextPlayer.isAlive ||
        !nextPlayer.isAI
      ) {
        continue;
      }

      const oldIncome = oldPlayer.goldIncomePerMin ?? 0;
      const nextIncome = nextPlayer.goldIncomePerMin ?? 0;
      const lastEconomy =
        this.lastEconomyNotice.get(smallID) ?? Number.NEGATIVE_INFINITY;
      if (
        oldIncome >= 1000 &&
        nextIncome >= oldIncome * 1.5 &&
        nextIncome - oldIncome >= 1000 &&
        tick - lastEconomy >= 900
      ) {
        push(
          "economic-surge",
          "Aceleración económica",
          nextPlayer.name +
            " aumentó significativamente sus ingresos por minuto.",
        );
        this.lastEconomyNotice.set(smallID, tick);
      }

      const oldCapacity = oldPlayer.maxTroops ?? 0;
      const nextCapacity = nextPlayer.maxTroops ?? 0;
      const lastMilitary =
        this.lastMilitaryNotice.get(smallID) ?? Number.NEGATIVE_INFINITY;
      if (
        oldCapacity >= 1000 &&
        nextCapacity >= oldCapacity * 1.2 &&
        nextCapacity - oldCapacity >= 1000 &&
        tick - lastMilitary >= 900
      ) {
        push(
          "military-build-up",
          "Expansión de capacidad militar",
          nextPlayer.name +
            " aumentó considerablemente su capacidad máxima de tropas.",
        );
        this.lastMilitaryNotice.set(smallID, tick);
      }

      const lostTiles = oldPlayer.tiles - nextPlayer.tiles;
      const lastDecline =
        this.lastDeclineNotice.get(smallID) ?? Number.NEGATIVE_INFINITY;
      if (
        lostTiles >= Math.max(40, Math.ceil(oldPlayer.tiles * 0.25)) &&
        tick - lastDecline >= 900
      ) {
        push(
          "power-decline",
          "Retroceso de una potencia",
          nextPlayer.name +
            " perdió " +
            lostTiles +
            " territorios desde la última observación.",
        );
        this.lastDeclineNotice.set(smallID, tick);
      }
    }

    const nextLeaderID = current.leadingNationID;
    if (
      nextLeaderID !== null &&
      nextLeaderID !== this.announcedLeaderID &&
      tick - this.lastPowerNotice >= 180
    ) {
      const nextLeader = current.players.get(nextLeaderID);
      const priorLeader =
        this.announcedLeaderID === null
          ? undefined
          : current.players.get(this.announcedLeaderID) ??
            previous.players.get(this.announcedLeaderID);
      const hasMeaningfulLead =
        !priorLeader?.isAlive ||
        (nextLeader !== undefined &&
          (nextLeader.tiles >= priorLeader.tiles + 25 ||
            nextLeader.tiles >= Math.ceil(priorLeader.tiles * 1.08)));

      if (nextLeader && hasMeaningfulLead) {
        push(
          "power-shift",
          "Cambio de hegemonía",
          priorLeader
            ? nextLeader.name +
                " superó a " +
                priorLeader.name +
                " y pasó a liderar el mapa."
            : nextLeader.name +
                " se convirtió en la principal potencia del mapa.",
        );
        this.announcedLeaderID = nextLeaderID;
        this.lastPowerNotice = tick;
      }
    }

    const nextEconomicLeaderID = current.leadingEconomicNationID;
    if (
      nextEconomicLeaderID !== null &&
      nextEconomicLeaderID !== this.announcedEconomicLeaderID &&
      tick - this.lastEconomicPowerNotice >= 900
    ) {
      const nextLeader = current.players.get(nextEconomicLeaderID);
      const priorLeader =
        this.announcedEconomicLeaderID === null
          ? undefined
          : current.players.get(this.announcedEconomicLeaderID) ??
            previous.players.get(this.announcedEconomicLeaderID);
      const nextIncome = nextLeader?.goldIncomePerMin ?? 0;
      const priorIncome = priorLeader?.goldIncomePerMin ?? 0;
      const meaningful =
        nextLeader !== undefined &&
        (priorLeader?.isAlive
          ? nextIncome >= Math.max(priorIncome * 1.15, priorIncome + 1000)
          : nextIncome >= 1000);

      if (nextLeader && meaningful) {
        push(
          "economic-hegemony",
          "Cambio de liderazgo económico",
          priorLeader
            ? nextLeader.name +
                " superó a " +
                priorLeader.name +
                " como principal potencia económica."
            : nextLeader.name +
                " se convirtió en la principal potencia económica.",
        );
        this.announcedEconomicLeaderID = nextEconomicLeaderID;
        this.lastEconomicPowerNotice = tick;
      }
    }

    const nextMilitaryLeaderID = current.leadingMilitaryNationID;
    if (
      nextMilitaryLeaderID !== null &&
      nextMilitaryLeaderID !== this.announcedMilitaryLeaderID &&
      tick - this.lastMilitaryPowerNotice >= 900
    ) {
      const nextLeader = current.players.get(nextMilitaryLeaderID);
      const priorLeader =
        this.announcedMilitaryLeaderID === null
          ? undefined
          : current.players.get(this.announcedMilitaryLeaderID) ??
            previous.players.get(this.announcedMilitaryLeaderID);
      const nextTroops = nextLeader?.troops ?? 0;
      const priorTroops = priorLeader?.troops ?? 0;
      const meaningful =
        nextLeader !== undefined &&
        (priorLeader?.isAlive
          ? nextTroops >= Math.max(priorTroops * 1.15, priorTroops + 1000)
          : nextTroops >= 1000);

      if (nextLeader && meaningful) {
        push(
          "military-hegemony",
          "Cambio de liderazgo militar",
          priorLeader
            ? nextLeader.name +
                " superó a " +
                priorLeader.name +
                " en tropas disponibles."
            : nextLeader.name +
                " se convirtió en la principal potencia militar.",
        );
        this.announcedMilitaryLeaderID = nextMilitaryLeaderID;
        this.lastMilitaryPowerNotice = tick;
      }
    }

    this.previous = current;
    this.previousTick = tick;
    return entries;
  }
}
