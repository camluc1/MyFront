import { GameType } from "@openfront/engine-api/game/GameTypes";
import type { MatchHistory } from "@openfront/engine-api/game/MatchHistory";
import {
  countrySummary,
  rivalHighlights,
  historyHighlights,
  historyValue,
  type HistoryMetric,
} from "@openfront/engine-lib/game/MatchHistory";
import { html, svg, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GameView } from "../../view";
const colors = [
  "#67e8f9",
  "#fbbf24",
  "#c084fc",
  "#fb7185",
  "#4ade80",
  "#fb923c",
  "#a5b4fc",
  "#f0abfc",
];
const MAX_COMPARISON_COUNTRIES = colors.length;
const metrics: Record<HistoryMetric, string> = {
  territory: "Territorio (casillas)",
  rank: "Posición territorial",
  economicRank: "Posición económica",
  militaryRank: "Posición militar (reservas + despliegue)",
  income: "Ingreso recurrente / min",
  reserves: "Tropas disponibles",
  deployed: "Tropas desplegadas",
  gold: "Oro disponible",
  buildings: "Edificios",
  levels: "Niveles de edificios",
};
const time = (tick: number) =>
  `${Math.floor(tick / 600)}:${String(Math.floor(tick / 10) % 60).padStart(2, "0")}`;
const number = (n: number) => Math.round(n).toLocaleString();
@customElement("match-history-panel")
export class MatchHistoryPanel extends LitElement {
  @property({ attribute: false }) game?: GameView;
  @property({ type: Boolean }) summary = false;
  @state() history: MatchHistory | null = null;
  @state() selected: number[] = [];
  @state() metric: HistoryMetric = "territory";
  @state() cursor = -1;
  @state() from = 0;
  @state() to = 1;
  @state() error = false;
  private timer?: ReturnType<typeof setInterval>;
  private pending = false;
  private cachedHistory?: MatchHistory;
  private cachedFocus?: number;
  private cachedEvents: { tick: number; text: string }[] = [];
  private generation = 0;
  createRenderRoot() {
    return this;
  }
  connectedCallback() {
    super.connectedCallback();
    this.timer = setInterval(() => void this.refresh(), 10000);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.timer);
    this.generation++;
  }
  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("game")) {
      this.generation++;
      this.history = null;
      this.selected = [];
      this.cursor = -1;
      this.from = 0;
      this.to = 1;
      void this.refresh();
    }
  }
  async refresh() {
    const game = this.game;
    if (
      !game ||
      this.pending ||
      game.config().gameConfig().gameType !== GameType.Singleplayer
    )
      return;
    if (this.history?.endTick !== undefined) return;
    const generation = this.generation;
    this.pending = true;
    try {
      const h = await game.worker.matchHistory();
      if (
        this.game === game &&
        generation === this.generation &&
        this.isConnected
      ) {
        this.history = h;
        this.error = false;
        if (!this.selected.length && h) {
          const mine = game.myPlayer()?.smallID();
          this.selected = h.players.some((p) => p.id === mine)
            ? [mine!]
            : h.players.slice(0, 1).map((p) => p.id);
        }
      }
    } catch {
      if (generation === this.generation) this.error = true;
    } finally {
      this.pending = false;
    }
  }
  private countryColor(id: number): string {
    return `hsl(${(id * 137.508) % 360} 75% 70%)`;
  }
  private zoomPeriod(factor: number, anchor = 0.5) {
    const minimum = 1 / Math.max(1, (this.history?.samples.length ?? 2) - 1);
    const width = Math.min(
      1,
      Math.max(minimum, (this.to - this.from) * factor),
    );
    const center = this.from + (this.to - this.from) * anchor;
    this.from = Math.max(0, Math.min(1 - width, center - width * anchor));
    this.to = this.from + width;
    this.cursor = -1;
  }
  private panPeriod(direction: number) {
    const span = this.to - this.from;
    this.from = Math.max(
      0,
      Math.min(1 - span, this.from + direction * span * 0.4),
    );
    this.to = this.from + span;
    this.cursor = -1;
  }
  private choose(id: number) {
    if (this.selected.includes(id))
      this.selected = this.selected.filter((x) => x !== id);
    else if (this.selected.length < MAX_COMPARISON_COUNTRIES)
      this.selected = [...this.selected, id];
  }
  private selectLeaders() {
    const h = this.history;
    if (!h) return;
    const me = this.game?.myPlayer()?.smallID();
    const leaders = [...h.samples[h.samples.length - 1].rows]
      .filter((r) => r[1] > 0)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 5)
      .map((r) => r[0]);
    this.selected = [
      ...new Set([
        ...(me !== undefined && h.players.some((p) => p.id === me) ? [me] : []),
        ...leaders,
      ]),
    ];
  }
  render() {
    const h = this.history;
    if (this.game?.config().gameConfig().gameType !== GameType.Singleplayer)
      return nothing;
    if (!h?.samples.length)
      return html`<div class="p-3 text-xs text-slate-400">
        ${this.error ? "No se pudo cargar el historial. Se reintentará." : "Registrando la evolución de la partida…"}
      </div>`;
    const begin = Math.floor(this.from * (h.samples.length - 1)),
      end = Math.max(begin + 1, Math.ceil(this.to * (h.samples.length - 1)));
    const indices = h.samples
      .map((_, i) => i)
      .filter((i) => i >= begin && i <= end);
    const active =
      this.cursor < begin || this.cursor > end
        ? indices[indices.length - 1]!
        : this.cursor;
    const sample = h.samples[active];
    const series = this.selected.map((id) => ({
      id,
      points: indices.flatMap((i) => {
        const row = h.samples[i].rows.find((r) => r[0] === id);
        return row ? [{ i, value: historyValue(h, i, row, this.metric) }] : [];
      }),
    }));
    const max = Math.max(
      1,
      ...series.flatMap((s) => s.points.map((p) => p.value)),
    );
    const x = (i: number) =>
      40 + ((i - begin) / Math.max(1, end - begin)) * 630;
    const y = (v: number) =>
      ["rank", "economicRank", "militaryRank"].includes(this.metric)
        ? 25 + ((v - 1) / Math.max(1, max - 1)) * 155
        : 180 - (v / max) * 155;
    const focus = this.selected[0];
    const stats = focus === undefined ? null : countrySummary(h, focus);
    if (this.cachedHistory !== h || this.cachedFocus !== focus) {
      this.cachedEvents = [
        ...historyHighlights(h),
        ...(focus === undefined ? [] : rivalHighlights(h, focus)),
      ].sort((a, b) => a.tick - b.tick);
      this.cachedHistory = h;
      this.cachedFocus = focus;
    }
    const events = this.cachedEvents;
    return html`<section
      data-match-history
      class="rounded-xl border border-slate-700 bg-slate-950 p-5 text-slate-100 text-sm space-y-4"
    >
      <div class="flex justify-between gap-2">
        <strong
          >${this.summary ? "RESUMEN DE LA PARTIDA" : "EVOLUCIÓN DE LA PARTIDA"}</strong
        ><span
          >${h.endTick === undefined ? "EN CURSO" : "RESULTADO FINAL"} ·
          ${time(h.samples[h.samples.length - 1]!.tick)}</span
        >
      </div>
      <p class="text-slate-400">
        Historial desde ${time(h.startTick)} · muestras cada 10 s ·
        ${h.startTick > 100 ? "Registro parcial: la partida se cargó sin historial anterior." : "Se conserva el recorrido completo."}
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-history-leaders
          class="rounded border border-slate-600 px-2 py-1"
          @click=${() => this.selectLeaders()}
        >
          Yo + cinco líderes territoriales
        </button>
        <span
          >${this.selected.length}/${MAX_COMPARISON_COUNTRIES} seleccionados ·
          clic en un país para mostrar u ocultar su curva</span
        >
      </div>
      <div class="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
        ${h.players.map((p) => {
          const row = h.samples[h.samples.length - 1]!.rows.find(
            (r) => r[0] === p.id,
          );
          return html`<button
            type="button"
            class="rounded border border-slate-600 px-2 py-1"
            aria-pressed=${this.selected.includes(p.id)}
            ?disabled=${!this.selected.includes(p.id) && this.selected.length >= MAX_COMPARISON_COUNTRIES}
            @click=${() => this.choose(p.id)}
            style=${`color:${this.selected.includes(p.id) ? this.countryColor(p.id) : "#94a3b8"}`}
          >
            ${p.name}${row?.[1] === 0 ? " · eliminado" : ""}
          </button>`;
        })}
      </div>
      <label
        >Métrica
        <select
          class="bg-slate-800 p-1 rounded"
          .value=${this.metric}
          @change=${(e: Event) => {
            this.metric = (e.target as HTMLSelectElement)
              .value as HistoryMetric;
          }}
        >
          ${Object.entries(metrics).map(([key, label]) => html`<option value=${key}>${label}</option>`)}
        </select></label
      >
      <div class="flex flex-wrap gap-2 items-center">
        <button
          class="rounded border border-slate-600 px-3 py-2"
          @click=${() => this.zoomPeriod(0.6)}
        >
          Acercar período +
        </button>
        <button
          class="rounded border border-slate-600 px-3 py-2"
          @click=${() => this.zoomPeriod(1.6)}
        >
          Alejar período −
        </button>
        <button
          class="rounded border border-slate-600 px-3 py-2"
          @click=${() => {
            this.from = 0;
            this.to = 1;
          }}
        >
          Ver toda la partida
        </button>
        <span class="text-slate-400"
          >Rueda: zoom · arrastrá el control Desde para recorrer el
          período</span
        >
      </div>
      <div class="flex gap-2">
        <button
          class="rounded border border-slate-600 px-3 py-2"
          @click=${() => this.panPeriod(-1)}
        >
          ← Período anterior
        </button>
        <button
          class="rounded border border-slate-600 px-3 py-2"
          @click=${() => this.panPeriod(1)}
        >
          Período siguiente →
        </button>
      </div>
      <svg
        @wheel=${(e: WheelEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const box = (
            e.currentTarget as SVGSVGElement
          ).getBoundingClientRect();
          this.zoomPeriod(
            e.deltaY > 0 ? 1.15 : 0.85,
            Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
          );
        }}
        style="min-height:260px; background:linear-gradient(180deg,#172036,#020617);border-radius:12px"
        viewBox="0 0 700 215"
        role="img"
        aria-label=${metrics[this.metric]}
        class="w-full"
        @pointermove=${(e: PointerEvent) => {
          const box = (
            e.currentTarget as SVGSVGElement
          ).getBoundingClientRect();
          this.cursor = Math.max(
            begin,
            Math.min(
              end,
              Math.round(
                begin +
                  ((((e.clientX - box.left) / box.width) * 700 - 40) / 630) *
                    (end - begin),
              ),
            ),
          );
        }}
      >
        <path d="M40 20V180H675" fill="none" stroke="#64748b" />
        <text x="2" y="28" fill="#94a3b8" font-size="10">
          ${number(["rank", "economicRank", "militaryRank"].includes(this.metric) ? 1 : max)}
        </text>
        <text x="2" y="180" fill="#94a3b8" font-size="10">
          ${["rank", "economicRank", "militaryRank"].includes(this.metric) ? number(max) : 0}
        </text>
        ${[0.25, 0.5, 0.75].map((f) => svg`<path d=${`M40 ${180 - f * 155}H675`} stroke="#334155" stroke-dasharray="3 5"/><text x="3" y=${184 - f * 155} fill="#cbd5e1" font-size="10">${number(["rank", "economicRank", "militaryRank"].includes(this.metric) ? 1 + (max - 1) * (1 - f) : max * f)}</text>`)}
        ${series.map((s) => svg`<polyline fill="none" stroke=${this.countryColor(s.id)} stroke-width="2" points=${s.points.map((p) => `${x(p.i)},${y(p.value)}`).join(" ")} />`)}
        <path
          d=${`M${x(active)} 20V180`}
          stroke="#cbd5e1"
          stroke-dasharray="3 3"
        />
        <text x="40" y="205" fill="#94a3b8" font-size="11">
          ${time(h.samples[begin].tick)}
        </text>
        <text x="620" y="205" fill="#94a3b8" font-size="11">
          ${time(h.samples[Math.min(end, h.samples.length - 1)].tick)}
        </text>
      </svg>
      <label class="block"
        >Momento: ${time(sample.tick)}<input
          aria-label="Momento de la partida"
          type="range"
          class="w-full"
          min=${begin}
          max=${Math.min(end, h.samples.length - 1)}
          .value=${String(active)}
          @input=${(e: Event) => (this.cursor = Number((e.target as HTMLInputElement).value))}
      /></label>
      <div class="flex gap-3">
        <label
          >Desde
          <input
            aria-label="Inicio del período"
            type="range"
            min="0"
            max="0.99"
            step="0.01"
            .value=${String(this.from)}
            @input=${(e: Event) => (this.from = Math.min(this.to - 0.01, Number((e.target as HTMLInputElement).value)))} /></label
        ><label
          >Hasta
          <input
            aria-label="Fin del período"
            type="range"
            min="0.01"
            max="1"
            step="0.01"
            .value=${String(this.to)}
            @input=${(e: Event) => (this.to = Math.max(this.from + 0.01, Number((e.target as HTMLInputElement).value)))}
        /></label>
      </div>
      ${this.selected.map((id, k) => {
        const r = sample.rows.find((r) => r[0] === id);
        return html`<div style=${`color:${this.countryColor(id)}`}>
          ${h.players.find((p) => p.id === id)?.name}:
          ${r ? number(historyValue(h, active, r, this.metric)) : "Sin muestra"}
        </div>`;
      })}
      ${
        stats?.points.length
          ? html`<div
              class="grid grid-cols-2 gap-2 border-t border-slate-700 pt-2"
            >
              <div>Máximo territorio: ${number(stats.peak)}</div>
              <div>
                Mejor puesto:
                ${Number.isFinite(stats.bestRank) ? stats.bestRank : "—"}
              </div>
              <div>
                Mayor caída desde un máximo:
                ${Math.round(stats.drawdown * 100)}%
              </div>
              <div>
                Tiempo en primer puesto territorial: ${time(stats.leadTicks)}
              </div>
            </div>`
          : nothing
      }
      <details ?open=${this.summary}>
        <summary>Momentos destacados (${events.length})</summary>
        <div class="max-h-48 overflow-auto">
          ${events.map(
            (e) =>
              html`<button
                type="button"
                class="block text-left py-1"
                @click=${() => {
                  this.from = 0;
                  this.to = 1;
                  this.cursor = h.samples.findIndex((s) => s.tick >= e.tick);
                }}
              >
                ${time(e.tick)} · ${e.text}
              </button>`,
          )}
        </div>
      </details>
      <p class="text-slate-400">
        Ingresos recurrentes: producción y comercio, promedio de hasta 2
        minutos. Tropas desplegadas siguen vivas; su movilización no se
        interpreta como bajas.
      </p>
      <details open>
        <summary class="font-semibold py-2">
          Origen del oro · ${time(sample.tick)}
        </summary>
        <p class="text-slate-400">
          Ingresos acumulados hasta el momento elegido. El saldo disponible
          incluye gastos y puede diferir del ingreso.
        </p>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead>
              <tr>
                <th>País / fuente</th>
                <th>Oro recibido</th>
                <th>Participación</th>
              </tr>
            </thead>
            <tbody>
              ${this.selected.map((id) => {
                const values = sample.sources?.[String(id)];
                if (!values)
                  return html`<tr>
                    <td colspan="3">
                      ${h.players.find((p) => p.id === id)?.name}: desglose no
                      disponible en esta muestra.
                    </td>
                  </tr>`;
                const resource = values.slice(7, 11).reduce((a, b) => a + b, 0);
                const amounts = [
                  Math.max(0, (values[0] ?? 0) - resource),
                  ...[7, 8, 9, 10, 2, 4, 5, 1, 3, 6].map((i) => values[i] ?? 0),
                ];
                const labels = [
                  "Trabajo",
                  "Agricultura",
                  "Minería",
                  "Petróleo",
                  "Gas",
                  "Comercio marítimo",
                  "Trenes propios",
                  "Trenes de terceros",
                  "Conquista",
                  "Piratería",
                  "Donaciones",
                ];
                const total = amounts.reduce((a, b) => a + b, 0);
                return html`<tr style=${`color:${this.countryColor(id)}`}>
                    <th class="pt-3">
                      ${h.players.find((p) => p.id === id)?.name}
                    </th>
                    <th>${number(total)}</th>
                    <th>100%</th>
                  </tr>
                  ${amounts.map(
                    (amount, i) =>
                      html`<tr>
                        <td class="py-1">${labels[i]}</td>
                        <td>${number(amount)}</td>
                        <td>
                          ${total ? ((amount / total) * 100).toFixed(1) : "0"}%
                        </td>
                      </tr>`,
                  )}`;
              })}
            </tbody>
          </table>
        </div>
      </details>
      <details ?open=${this.summary}>
        <summary class="font-semibold py-2">
          Clasificación · todos los países
        </summary>
        <p class="text-slate-400">
          Los supervivientes se ordenan por territorio. Las eliminaciones sin
          evento exacto se indican con la precisión de las muestras.
        </p>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead>
              <tr>
                <th>Puesto</th>
                <th>País</th>
                <th>Eliminación</th>
                <th>Eliminado por</th>
              </tr>
            </thead>
            <tbody>
              ${h.players
                .map((p) => {
                  const last = h.samples[h.samples.length - 1].rows.find(
                    (r) => r[0] === p.id,
                  );
                  const event = h.eliminations?.find((e) => e.id === p.id);
                  const sampled = h.samples.find((s) =>
                    s.rows.some((r) => r[0] === p.id && r[1] === 0),
                  );
                  return {
                    p,
                    tiles: last?.[1] ?? 0,
                    tick: event?.tick ?? sampled?.tick,
                    event,
                  };
                })
                .sort(
                  (a, b) =>
                    (b.tiles > 0 ? 1 : 0) - (a.tiles > 0 ? 1 : 0) ||
                    (a.tiles > 0
                      ? b.tiles - a.tiles
                      : (b.tick ?? -1) - (a.tick ?? -1)) ||
                    a.p.id - b.p.id,
                )
                .map(
                  (entry, i) =>
                    html`<tr class="border-t border-slate-800">
                      <td class="py-2">${i + 1} / ${h.players.length}</td>
                      <td>${entry.p.name}</td>
                      <td>
                        ${entry.tick === undefined ? "En pie" : `${entry.event ? "" : "≈ "}${time(entry.tick)} · eliminación ${h.players.length - i} / ${h.players.length}`}
                      </td>
                      <td>
                        ${entry.event ? (h.players.find((p) => p.id === entry.event?.killer)?.name ?? "Otro participante") : "—"}
                      </td>
                    </tr>`,
                )}
            </tbody>
          </table>
        </div>
      </details>
    </section>`;
  }
}
