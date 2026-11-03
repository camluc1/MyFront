import { GameType, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { Controller } from "../../Controller";
import type { GameView } from "../../view";
import {
  FrontierWorldIntelligenceTracker,
  type FrontierWorldPlayerInput,
  type FrontierWorldPlayerSnapshot,
} from "./FrontierWorldIntelligenceTracker";

type IntelligenceTab = "overview" | "economy" | "military" | "diplomacy" | "history";
type MetricKey =
  | "tiles"
  | "goldIncomePerMin"
  | "troops"
  | "maxTroops"
  | "gold"
  | "cities"
  | "factories"
  | "ports"
  | "warships"
  | "allies"
  | "betrayals";

@customElement("frontier-world-intelligence")
export class FrontierWorldIntelligence extends LitElement implements Controller {
  private _game!: GameView;
  private enabled = false;
  private tracker = new FrontierWorldIntelligenceTracker();

  get game(): GameView {
    return this._game;
  }

  set game(game: GameView) {
    if (this._game === game) return;
    this._game = game;
    this.enabled =
      game.config().gameConfig().gameType === GameType.Singleplayer;
    this.tracker.reset();
    this.players = [];
    this.selectedSmallID = null;
    this.open = false;
  }

  @state() private open = false;
  @state() private tab: IntelligenceTab = "overview";
  @state() private players: FrontierWorldPlayerSnapshot[] = [];
  @state() private selectedSmallID: number | null = null;

  getTickIntervalMs(): number {
    return 1000;
  }

  tick(): void {
    if (
      !this.enabled ||
      !this.game ||
      this.game.inSpawnPhase()
    ) return;

    const tick = this.game.ticksSinceStart();
    const inputs: FrontierWorldPlayerInput[] = this.game.playerViews().map((p) => ({
      smallID: p.smallID(),
      name: p.displayName(),
      kind:
        p.type() === PlayerType.Human
          ? "human"
          : p.type() === PlayerType.Nation
            ? "nation"
            : "tribe",
      isAlive: p.isAlive(),
      isMe: p.isMe(),
      tiles: p.numTilesOwned(),
      gold: Number(p.gold()),
      goldEarned: p.goldEarned(),
      tradeGold: p.tradeGold(),
      trainGold: p.trainGold(),
      piracyGold: p.piracyGold(),
      troops: p.troops(),
      maxTroops: this.game.config().maxTroops(p),
      cities: p.totalUnitLevels(UnitType.City),
      factories: p.totalUnitLevels(UnitType.Factory),
      ports: p.totalUnitLevels(UnitType.Port),
      silos: p.totalUnitLevels(UnitType.MissileSilo),
      sams: p.totalUnitLevels(UnitType.SAMLauncher),
      warships: p.totalUnitLevels(UnitType.Warship),
      allies: p.allies().length,
      betrayals: p.betrayals(),
      outgoingAttacks: p.outgoingAttacks().length,
      incomingAttacks: p.incomingAttacks().length,
    }));

    if (!this.tracker.observe(inputs, tick)) return;
    this.players = this.tracker.players();
    if (
      this.selectedSmallID === null ||
      !this.players.some((p) => p.smallID === this.selectedSmallID)
    ) {
      this.selectedSmallID = this.players[0]?.smallID ?? null;
    }
  }

  private compact(value: number): string {
    return new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(Math.max(0, value));
  }

  private selectedPlayer(): FrontierWorldPlayerSnapshot | null {
    return (
      this.players.find((p) => p.smallID === this.selectedSmallID) ?? null
    );
  }

  private alivePlayers(): FrontierWorldPlayerSnapshot[] {
    return this.players.filter((p) => p.isAlive);
  }

  private orderedPlayers(): FrontierWorldPlayerSnapshot[] {
    const alive = this.alivePlayers();
    const key: MetricKey =
      this.tab === "economy"
        ? "goldIncomePerMin"
        : this.tab === "military"
          ? "troops"
          : this.tab === "diplomacy"
            ? "allies"
            : "tiles";
    return alive.sort(
      (a, b) => b[key] - a[key] || b.tiles - a.tiles || a.smallID - b.smallID,
    );
  }

  private uniqueAlliances(): number {
    return Math.floor(
      this.alivePlayers().reduce((sum, p) => sum + p.allies, 0) / 2,
    );
  }

  private activeFronts(): number {
    return this.alivePlayers().reduce(
      (sum, p) => sum + p.outgoingAttacks,
      0,
    );
  }

  private sparkline(
    values: number[],
    stroke: string,
  ) {
    if (values.length < 2) {
      return html`<div class="h-12 flex items-center text-[10px] text-slate-500">Historial en construcción</div>`;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const points = values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 300;
        const y = 42 - ((value - min) / range) * 34;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return html`
      <svg viewBox="0 0 300 48" class="w-full h-12" preserveAspectRatio="none" aria-hidden="true">
        <polyline points=${points} fill="none" stroke=${stroke} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
      </svg>
    `;
  }

  private trendCard(
    label: string,
    values: number[],
    stroke: string,
    current: number,
  ) {
    return html`
      <div class="rounded-lg border border-slate-700/70 bg-slate-900/80 p-3 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] font-bold tracking-[0.14em] text-slate-400">${label}</span>
          <span class="text-xs font-semibold tabular-nums text-slate-100">${this.compact(current)}</span>
        </div>
        <div class="mt-2">${this.sparkline(values, stroke)}</div>
      </div>
    `;
  }

  private renderRanking() {
    const rows = this.orderedPlayers().slice(0, 10);
    const valueLabel =
      this.tab === "economy"
        ? "ORO BRUTO / MIN"
        : this.tab === "military"
          ? "TROPAS"
          : this.tab === "diplomacy"
            ? "PACTOS"
            : "TERRITORIO";
    return html`
      <div class="overflow-hidden rounded-xl border border-slate-700/80">
        <div class="grid grid-cols-[2rem_minmax(0,1fr)_5.5rem] gap-2 bg-slate-800/90 px-3 py-2 text-[9px] font-bold tracking-[0.16em] text-slate-400">
          <span>#</span><span>NACIÓN</span><span class="text-right">${valueLabel}</span>
        </div>
        <div class="max-h-64 overflow-y-auto divide-y divide-slate-800">
          ${rows.map((p, index) => {
            const value =
              this.tab === "economy"
                ? p.goldIncomePerMin
                : this.tab === "military"
                  ? p.troops
                  : this.tab === "diplomacy"
                    ? p.allies
                    : p.tiles;
            return html`
              <button
                type="button"
                class="grid w-full grid-cols-[2rem_minmax(0,1fr)_5.5rem] items-center gap-2 px-3 py-2 text-left transition hover:bg-slate-800/90 ${p.smallID === this.selectedSmallID ? "bg-cyan-950/60" : "bg-slate-950/70"}"
                @click=${() => (this.selectedSmallID = p.smallID)}
              >
                <span class="text-xs tabular-nums text-slate-500">${index + 1}</span>
                <span class="min-w-0">
                  <span class="block truncate text-xs font-semibold text-slate-100">${p.name}</span>
                  <span class="block text-[9px] uppercase tracking-wider text-slate-500">${p.kind === "nation" ? "NACIÓN" : p.kind === "tribe" ? "TRIBU" : "JUGADOR"} ${p.isMe ? "· TÚ" : ""}</span>
                </span>
                <span class="text-right text-xs font-semibold tabular-nums text-cyan-200">${this.compact(value)}</span>
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }

  private renderSelectedHistory() {
    const selected = this.selectedPlayer();
    if (!selected) {
      return html`<div class="rounded-xl border border-slate-700 bg-slate-900 p-4 text-xs text-slate-400">Seleccioná una nación para consultar su historial.</div>`;
    }
    const history = this.tracker.historyFor(selected.smallID);
    return html`
      <div class="rounded-xl border border-slate-700/80 bg-slate-950/90 p-3">
        <div class="flex items-center justify-between gap-3 mb-3">
          <div class="min-w-0">
            <div class="text-[9px] font-bold tracking-[0.18em] text-cyan-300">PERFIL DE POTENCIA</div>
            <div class="truncate text-sm font-bold text-white">${selected.name}</div>
          </div>
          <span class="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-[9px] uppercase text-slate-400">${selected.isAlive ? "ACTIVA" : "ELIMINADA"}</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          ${this.trendCard("TERRITORIO", history.map((s) => s.tiles), "#67e8f9", selected.tiles)}
          ${this.trendCard("TROPAS", history.map((s) => s.troops), "#fda4af", selected.troops)}
          ${this.trendCard("INGRESO BRUTO / MIN", history.map((s) => s.goldIncomePerMin), "#86efac", selected.goldIncomePerMin)}
          ${this.trendCard("ORO DISPONIBLE", history.map((s) => s.gold), "#fcd34d", selected.gold)}
        </div>
        <div class="mt-3 grid grid-cols-3 gap-2 text-center">
          <div class="rounded-md bg-slate-900 p-2"><div class="text-[9px] text-slate-500">CIUDADES</div><div class="text-sm font-semibold text-slate-100">${this.compact(selected.cities)}</div></div>
          <div class="rounded-md bg-slate-900 p-2"><div class="text-[9px] text-slate-500">FÁBRICAS</div><div class="text-sm font-semibold text-slate-100">${this.compact(selected.factories)}</div></div>
          <div class="rounded-md bg-slate-900 p-2"><div class="text-[9px] text-slate-500">PUERTOS</div><div class="text-sm font-semibold text-slate-100">${this.compact(selected.ports)}</div></div>
          <div class="rounded-md bg-slate-900 p-2"><div class="text-[9px] text-slate-500">SILOS</div><div class="text-sm font-semibold text-slate-100">${this.compact(selected.silos)}</div></div>
          <div class="rounded-md bg-slate-900 p-2"><div class="text-[9px] text-slate-500">SAM</div><div class="text-sm font-semibold text-slate-100">${this.compact(selected.sams)}</div></div>
          <div class="rounded-md bg-slate-900 p-2"><div class="text-[9px] text-slate-500">BUQUES</div><div class="text-sm font-semibold text-slate-100">${this.compact(selected.warships)}</div></div>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.enabled) return nothing;
    const alive = this.alivePlayers();
    const selected = this.selectedPlayer();
    const totalTerritory = alive.reduce((sum, p) => sum + p.tiles, 0);
    const activeWars = this.activeFronts();
    const tabLabels: { id: IntelligenceTab; label: string }[] = [
      { id: "overview", label: "PANORAMA" },
      { id: "economy", label: "ECONOMÍA" },
      { id: "military", label: "MILITAR" },
      { id: "diplomacy", label: "DIPLOMACIA" },
      { id: "history", label: "HISTORIAL" },
    ];

    return html`
      <section class="pointer-events-auto w-[min(94vw,58rem)] mb-2">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 rounded-xl border border-violet-800/70 bg-slate-950/95 px-4 py-3 text-left text-white shadow-xl backdrop-blur-md transition hover:border-violet-400/70"
          aria-expanded=${this.open}
          @click=${() => (this.open = !this.open)}
        >
          <span class="flex min-w-0 items-center gap-3">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-400/10 text-violet-200">⌁</span>
            <span class="min-w-0">
              <span class="block text-xs font-bold tracking-[0.18em] text-violet-100">INTELIGENCIA MUNDIAL</span>
              <span class="block truncate text-[10px] text-slate-400">Potencias · economía · fuerzas militares · diplomacia · historia</span>
            </span>
          </span>
          <span class="shrink-0 text-[10px] font-bold tracking-wider text-slate-300">${this.open ? "CERRAR −" : "ANALIZAR +"}</span>
        </button>

        ${this.open
          ? html`
              <div class="mt-2 max-h-[76vh] overflow-y-auto rounded-xl border border-slate-700/90 bg-slate-950/98 p-3 text-white shadow-2xl backdrop-blur-xl sm:p-4">
                <div class="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-slate-800 pb-3">
                  <div>
                    <div class="text-[9px] font-bold tracking-[0.22em] text-violet-300">FRONTIER STRATEGIC DATABASE</div>
                    <h2 class="mt-1 text-base font-bold tracking-wide">Balance global de poder</h2>
                  </div>
                  <div class="text-[9px] tabular-nums text-slate-500">${this.players.length} FACCIONES REGISTRADAS · MUESTRA CADA 10 S</div>
                </div>

                <div class="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div class="rounded-lg border border-slate-800 bg-slate-900/90 p-3">
                    <div class="text-[9px] font-bold tracking-wider text-slate-500">FACCIONES ACTIVAS</div>
                    <div class="mt-1 text-xl font-bold tabular-nums">${alive.length}</div>
                  </div>
                  <div class="rounded-lg border border-slate-800 bg-slate-900/90 p-3">
                    <div class="text-[9px] font-bold tracking-wider text-slate-500">ATAQUES ACTIVOS</div>
                    <div class="mt-1 text-xl font-bold tabular-nums">${activeWars}</div>
                  </div>
                  <div class="rounded-lg border border-slate-800 bg-slate-900/90 p-3">
                    <div class="text-[9px] font-bold tracking-wider text-slate-500">ALIANZAS ACTIVAS</div>
                    <div class="mt-1 text-xl font-bold tabular-nums">${this.uniqueAlliances()}</div>
                  </div>
                  <div class="rounded-lg border border-slate-800 bg-slate-900/90 p-3">
                    <div class="text-[9px] font-bold tracking-wider text-slate-500">TERRITORIO CONTROLADO</div>
                    <div class="mt-1 text-xl font-bold tabular-nums">${this.compact(totalTerritory)}</div>
                  </div>
                </div>

                <div class="mb-3 flex flex-wrap gap-1">
                  ${tabLabels.map((item) => html`
                    <button
                      type="button"
                      class="rounded-md px-3 py-2 text-[9px] font-bold tracking-wider transition ${this.tab === item.id ? "bg-violet-500/20 text-violet-100 ring-1 ring-violet-400/40" : "bg-slate-900 text-slate-400 hover:text-white"}"
                      @click=${() => (this.tab = item.id)}
                    >${item.label}</button>
                  `)}
                </div>

                <div class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                  <div class="min-w-0">
                    <div class="mb-2 flex items-center justify-between">
                      <span class="text-[9px] font-bold tracking-[0.18em] text-slate-400">${this.tab === "economy" ? "RANKING ECONÓMICO" : this.tab === "military" ? "RANKING MILITAR" : this.tab === "diplomacy" ? "RED DIPLOMÁTICA" : "RANKING TERRITORIAL"}</span>
                      <span class="text-[9px] text-slate-600">SELECCIONÁ UNA POTENCIA</span>
                    </div>
                    ${this.renderRanking()}
                  </div>
                  <div class="min-w-0">
                    ${this.renderSelectedHistory()}
                    ${selected
                      ? html`
                          <div class="mt-3 grid grid-cols-2 gap-2">
                            <div class="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                              <div class="text-[9px] text-slate-500">COMERCIO NAVAL / MIN</div>
                              <div class="mt-1 text-sm font-semibold tabular-nums">${this.compact(selected.shipTradeGoldPerMin)}</div>
                            </div>
                            <div class="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                              <div class="text-[9px] text-slate-500">COMERCIO FERROVIARIO / MIN</div>
                              <div class="mt-1 text-sm font-semibold tabular-nums">${this.compact(selected.trainTradeGoldPerMin)}</div>
                            </div>
                            <div class="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                              <div class="text-[9px] text-slate-500">PIRATERÍA / MIN</div>
                              <div class="mt-1 text-sm font-semibold tabular-nums">${this.compact(selected.piracyGoldPerMin)}</div>
                            </div>
                            <div class="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                              <div class="text-[9px] text-slate-500">CAPACIDAD MILITAR</div>
                              <div class="mt-1 text-sm font-semibold tabular-nums">${this.compact(selected.maxTroops)}</div>
                            </div>
                            <div class="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                              <div class="text-[9px] text-slate-500">PACTOS</div>
                              <div class="mt-1 text-sm font-semibold tabular-nums">${selected.allies}</div>
                            </div>
                            <div class="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
                              <div class="text-[9px] text-slate-500">TRAICIONES</div>
                              <div class="mt-1 text-sm font-semibold tabular-nums">${selected.betrayals}</div>
                            </div>
                          </div>
                        `
                      : nothing}
                  </div>
                </div>
                <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3 text-[9px] text-slate-500">
                  <span>Los rankings comparan métricas independientes; no se inventa un índice único de poder.</span>
                  <span>VENTANA HISTÓRICA DE HASTA 30 MIN · TIEMPO DE SIMULACIÓN</span>
                </div>
              </div>
            `
          : nothing}
      </section>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
