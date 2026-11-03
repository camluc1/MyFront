/**
 * Periodic single-player intelligence samples. This tracker is independent of
 * the dashboard's visibility: the HUD controller keeps sampling while closed.
 * Samples use simulation ticks (10 ticks/second), never wall-clock time.
 */

export type FrontierWorldPlayerKind = "human" | "nation" | "tribe";

export interface FrontierWorldPlayerInput {
  smallID: number;
  name: string;
  kind: FrontierWorldPlayerKind;
  isAlive: boolean;
  isMe: boolean;
  tiles: number;
  gold: number;
  goldEarned: number;
  tradeGold: number;
  trainGold: number;
  piracyGold: number;
  troops: number;
  maxTroops: number;
  cities: number;
  factories: number;
  ports: number;
  silos: number;
  sams: number;
  warships: number;
  allies: number;
  betrayals: number;
  outgoingAttacks: number;
  incomingAttacks: number;
  /** Relationship to the human player in the current single-player campaign. */
  diplomacyStatus?: "TU NACIÓN" | "ALIADO" | "MISMO EQUIPO" | "EN GUERRA" | "SIN PACTO";
}

export interface FrontierWorldPlayerSnapshot extends FrontierWorldPlayerInput {
  tick: number;
  goldIncomePerMin: number;
  shipTradeGoldPerMin: number;
  trainTradeGoldPerMin: number;
  piracyGoldPerMin: number;
}

const SAMPLE_INTERVAL_TICKS = 100; // 10 seconds of simulation time
const RATE_WINDOW_TICKS = 600; // 1 minute
const MAX_HISTORY_SAMPLES = 180; // 30 minutes at the sampling interval

type CumulativeKey =
  | "goldEarned"
  | "tradeGold"
  | "trainGold"
  | "piracyGold";

function rateSince(
  history: readonly FrontierWorldPlayerSnapshot[],
  current: FrontierWorldPlayerInput,
  tick: number,
  key: CumulativeKey,
): number {
  let baseline: FrontierWorldPlayerSnapshot | undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    if (tick - history[i].tick >= RATE_WINDOW_TICKS) {
      baseline = history[i];
      break;
    }
  }
  if (!baseline) {
    // Avoid highly volatile per-minute extrapolations during the first minute
    // of a match; the balance and cumulative totals remain visible meanwhile.
    const first = history[0];
    if (!first || tick - first.tick < RATE_WINDOW_TICKS) return 0;
    baseline = first;
  }

  const elapsedTicks = tick - baseline.tick;
  if (elapsedTicks <= 0) return 0;
  const delta = current[key] - baseline[key];
  if (delta <= 0) return 0;
  return (delta * 600) / elapsedTicks;
}

export class FrontierWorldIntelligenceTracker {
  private readonly histories = new Map<number, FrontierWorldPlayerSnapshot[]>();
  private latest = new Map<number, FrontierWorldPlayerSnapshot>();
  private lastSampleTick = -1;

  observe(players: readonly FrontierWorldPlayerInput[], tick: number): boolean {
    if (tick < this.lastSampleTick) this.reset();
    if (
      this.lastSampleTick >= 0 &&
      tick - this.lastSampleTick < SAMPLE_INTERVAL_TICKS
    ) {
      return false;
    }

    const next = new Map<number, FrontierWorldPlayerSnapshot>();
    for (const player of players) {
      const history = this.histories.get(player.smallID) ?? [];
      const snapshot: FrontierWorldPlayerSnapshot = {
        ...player,
        tick,
        goldIncomePerMin: rateSince(history, player, tick, "goldEarned"),
        shipTradeGoldPerMin: rateSince(history, player, tick, "tradeGold"),
        trainTradeGoldPerMin: rateSince(history, player, tick, "trainGold"),
        piracyGoldPerMin: rateSince(history, player, tick, "piracyGold"),
      };
      history.push(snapshot);
      if (history.length > MAX_HISTORY_SAMPLES) {
        history.splice(0, history.length - MAX_HISTORY_SAMPLES);
      }
      this.histories.set(player.smallID, history);
      next.set(player.smallID, snapshot);
    }

    this.latest = next;
    this.lastSampleTick = tick;
    return true;
  }

  players(): FrontierWorldPlayerSnapshot[] {
    return Array.from(this.latest.values()).sort(
      (a, b) => b.tiles - a.tiles || a.smallID - b.smallID,
    );
  }

  historyFor(smallID: number): readonly FrontierWorldPlayerSnapshot[] {
    return this.histories.get(smallID) ?? [];
  }

  reset(): void {
    this.histories.clear();
    this.latest.clear();
    this.lastSampleTick = -1;
  }
}
