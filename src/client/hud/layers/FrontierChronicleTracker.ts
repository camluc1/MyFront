export interface FrontierChroniclePlayer {
  smallID: number;
  name: string;
  isAI: boolean;
  isHuman: boolean;
  isAlive: boolean;
  tiles: number;
  allies: readonly number[];
  outgoingTargets: readonly number[];
}

export type FrontierChronicleKind =
  | "war"
  | "alliance-formed"
  | "alliance-ended"
  | "elimination"
  | "expansion"
  | "power-shift";

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
  leadingNationID: number | null;
}

function pairKey(a: number, b: number): string {
  return a < b ? String(a) + ":" + String(b) : String(b) + ":" + String(a);
}

function createSnapshot(
  players: readonly FrontierChroniclePlayer[],
): Snapshot {
  const byID = new Map(players.map((player) => [player.smallID, player]));
  const alliances = new Map<string, readonly [number, number]>();
  const attacks = new Map<string, readonly [number, number]>();

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
  }

  const leadingNation = players
    .filter((player) => player.isAI && player.isAlive)
    .sort((a, b) => b.tiles - a.tiles || a.smallID - b.smallID)[0];

  return {
    players: byID,
    alliances,
    attacks,
    leadingNationID: leadingNation?.smallID ?? null,
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
  private announcedLeaderID: number | null = null;
  private lastPowerNotice = -1;

  observe(
    players: readonly FrontierChroniclePlayer[],
    tick: number,
  ): FrontierChronicleEntry[] {
    const current = createSnapshot(players);

    if (this.previous === null || tick < this.previousTick) {
      this.previous = current;
      this.previousTick = tick;
      this.announcedLeaderID = current.leadingNationID;
      this.lastWarNotice.clear();
      this.lastExpansionNotice.clear();
      this.lastPowerNotice = -1;
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

    this.previous = current;
    this.previousTick = tick;
    return entries;
  }
}
