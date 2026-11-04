import { INCOME_RATE_WINDOW_TICKS } from "@openfront/engine-api/game/MatchHistory";
import type {
  MatchHistory,
  HistoryRow,
} from "@openfront/engine-api/game/MatchHistory";
export type HistoryMetric =
  | "territory"
  | "economicRank"
  | "militaryRank"
  | "rank"
  | "income"
  | "reserves"
  | "deployed"
  | "gold"
  | "buildings"
  | "levels";
const valueCache = new WeakMap<MatchHistory, Map<string, number>>();
export function historyValue(
  h: MatchHistory,
  index: number,
  row: HistoryRow,
  metric: HistoryMetric,
): number {
  let cache = valueCache.get(h);
  if (!cache) {
    cache = new Map();
    valueCache.set(h, cache);
  }
  const key = `${index}:${row[0]}:${metric}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const result = computeHistoryValue(h, index, row, metric);
  cache.set(key, result);
  return result;
}
function computeHistoryValue(
  h: MatchHistory,
  index: number,
  row: HistoryRow,
  metric: HistoryMetric,
): number {
  if (metric === "economicRank" || metric === "militaryRank") {
    const value = (r: HistoryRow) =>
      metric === "economicRank"
        ? historyValue(h, index, r, "income")
        : r[2] + r[3];
    return (
      1 +
      h.samples[index].rows.filter((r) => r[1] > 0 && value(r) > value(row))
        .length
    );
  }
  if (metric === "rank")
    return 1 + h.samples[index].rows.filter((r) => r[1] > row[1]).length;
  if (metric === "income") {
    const now = h.samples[index];
    let base = index;
    while (
      base > 0 &&
      now.tick - h.samples[base].tick < INCOME_RATE_WINDOW_TICKS
    )
      base--;
    const previous = h.samples[base];
    const before = previous.rows.find((r) => r[0] === row[0]);
    return before && now.tick > previous.tick
      ? Math.max(0, ((row[6] - before[6]) * 600) / (now.tick - previous.tick))
      : 0;
  }
  const column = {
    territory: 1,
    reserves: 2,
    deployed: 3,
    gold: 4,
    buildings: 7,
    levels: 8,
  }[metric];
  return row[column];
}
export function historyHighlights(
  h: MatchHistory,
): { tick: number; text: string }[] {
  const events: { tick: number; text: string }[] = [];
  let leader: number | undefined;
  let candidate: number | undefined;
  let since = 0;
  const dead = new Set<number>();
  const seenAlive = new Set<number>();
  for (const sample of h.samples) {
    const alive = sample.rows
      .filter((r) => r[1] > 0)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const top = alive[0];
    if (top && (alive.length === 1 || top[1] > alive[1][1])) {
      if (candidate !== top[0]) {
        candidate = top[0];
        since = sample.tick;
      }
      if (leader !== candidate && sample.tick - since >= 300) {
        const name = h.players.find((p) => p.id === candidate)?.name ?? "";
        events.push({
          tick: since,
          text: `${name}: liderazgo territorial sostenido`,
        });
        leader = candidate;
      }
    } else {
      candidate = undefined;
    }
    for (const row of sample.rows) {
      if (row[1] > 0) {
        dead.delete(row[0]);
        seenAlive.add(row[0]);
      } else if (!dead.has(row[0]) && seenAlive.has(row[0])) {
        dead.add(row[0]);
        events.push({
          tick: sample.tick,
          text: `${h.players.find((p) => p.id === row[0])?.name ?? ""}: eliminado`,
        });
      }
    }
  }
  return events.sort((a, b) => a.tick - b.tick);
}
export function countrySummary(h: MatchHistory, id: number) {
  const points = h.samples.flatMap((s, i) => {
    const r = s.rows.find((r) => r[0] === id);
    return r
      ? [{ tick: s.tick, row: r, rank: historyValue(h, i, r, "rank") }]
      : [];
  });
  let peak = 0,
    drawdown = 0;
  for (const p of points) {
    peak = Math.max(peak, p.row[1]);
    if (peak > 0) drawdown = Math.max(drawdown, (peak - p.row[1]) / peak);
  }
  const leadTicks = points.reduce(
    (total, p, i) =>
      total +
      (p.row[1] > 0 && p.rank === 1 && points[i + 1]
        ? points[i + 1].tick - p.tick
        : 0),
    0,
  );
  return {
    leadTicks,
    peak,
    bestRank: points.length
      ? Math.min(...points.filter((p) => p.row[1] > 0).map((p) => p.rank))
      : 0,
    drawdown,
    points,
  };
}

/** Sustained crossings relative to the selected country, never inferred battle causes. */
export function rivalHighlights(
  h: MatchHistory,
  id: number,
): { tick: number; text: string }[] {
  const result: { tick: number; text: string }[] = [];
  for (const p of h.players.filter((p) => p.id !== id)) {
    let settled: boolean | undefined;
    let pending: boolean | undefined;
    let since = 0;
    for (const s of h.samples) {
      const mine = s.rows.find((r) => r[0] === id),
        other = s.rows.find((r) => r[0] === p.id);
      if (
        !mine ||
        !other ||
        mine[1] <= 0 ||
        other[1] <= 0 ||
        mine[1] === other[1]
      ) {
        pending = undefined;
        continue;
      }
      const ahead = other[1] > mine[1];
      if (settled === undefined) {
        settled = ahead;
        continue;
      }
      if (ahead === settled) {
        pending = undefined;
        continue;
      }
      if (pending !== ahead) {
        pending = ahead;
        since = s.tick;
      }
      if (s.tick - since < 300) continue;
      settled = ahead;
      pending = undefined;
      result.push({
        tick: since,
        text: ahead
          ? `${p.name} superó territorialmente al país seleccionado`
          : `El país seleccionado superó territorialmente a ${p.name}`,
      });
      if (ahead) {
        const later = h.samples.find((t) => t.tick >= since + 6000);
        const row = later?.rows.find((r) => r[0] === p.id);
        if (later && row) {
          result.push({
            tick: later.tick,
            text:
              row[1] > 0
                ? `${p.name}, 10 minutos después: puesto territorial ${historyValue(h, h.samples.indexOf(later), row, "rank")}`
                : `${p.name}, 10 minutos después: eliminado`,
          });
        }
      }
    }
  }
  return result.sort((a, b) => a.tick - b.tick);
}
