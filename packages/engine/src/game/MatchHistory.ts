import {
  GameType,
  PlayerType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type {
  MatchHistory,
  HistoryRow,
} from "@openfront/engine-api/game/MatchHistory";
import type { Game } from "./Game";
import { StatsImpl } from "./StatsImpl";
export function sampleMatchHistory(
  game: Game,
  history: MatchHistory | undefined,
  finish = false,
): MatchHistory | undefined {
  if (
    game.config().gameConfig().gameType !== GameType.Singleplayer ||
    game.inSpawnPhase()
  )
    return history;
  const tick = Math.round(game.elapsedGameSeconds() * 10);
  if (history?.endTick !== undefined) return history;
  history ??= { version: 1, startTick: tick, players: [], samples: [] };
  const last = history.samples[history.samples.length - 1];
  if (!finish && last && tick - last.tick < 100) return history;
  const rows: HistoryRow[] = [];
  const sourceRows: Record<string, number[]> = {};
  for (const p of game.allPlayers()) {
    if (p.type() === PlayerType.Bot || !p.hasSpawned()) continue;
    if (!history.players.some((m) => m.id === p.smallID()))
      history.players.push({ id: p.smallID(), name: p.name(), kind: p.type() });
    const sources = (game.stats() as StatsImpl).historyIncome(p.id());
    sourceRows[String(p.smallID())] = [...sources];
    const units = p
      .units()
      .filter((u) => u.isActive() && Structures.has(u.type()));
    const deployed =
      p.outgoingAttacks().reduce((n, a) => n + a.troops(), 0) +
      p.units(UnitType.TransportShip).reduce((n, u) => n + u.troops(), 0);
    // Work includes extraction; trade and trains are recurring, conquest/donations/piracy are not.
    const recurring = [0, 2, 4, 5].reduce((n, i) => n + (sources[i] ?? 0), 0);
    rows.push([
      p.smallID(),
      p.numTilesOwned(),
      p.troops(),
      deployed,
      Number(p.gold()),
      Number(p.goldEarned()),
      recurring,
      units.length,
      units.reduce((n, u) => n + u.level(), 0),
      sources[7] ?? 0,
      sources[8] ?? 0,
      sources[9] ?? 0,
      sources[10] ?? 0,
    ]);
  }
  if (last?.tick === tick)
    history.samples[history.samples.length - 1] = {
      tick,
      rows,
      sources: sourceRows,
    };
  else history.samples.push({ tick, rows, sources: sourceRows });
  if (finish) history.endTick = tick;
  return history;
}
