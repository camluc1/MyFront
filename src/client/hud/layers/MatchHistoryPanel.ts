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
const colors = ["#67e8f9", "#fbbf24", "#c084fc", "#fb7185"];
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
  private choose(id: number) {
    this.selected = this.selected.includes(id)
      ? this.selected.filter((x) => x !== id)
      : [...this.selected.slice(-3), id];
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
      class="rounded-xl border border-slate-700 bg-slate-950 p-3 text-slate-100 text-xs space-y-3"
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
      <div class="flex flex-wrap gap-2">
        ${h.players.map((p) => {
          const row = h.samples[h.samples.length - 1]!.rows.find(
            (r) => r[0] === p.id,
          );
          return html`<button
            type="button"
            class="rounded border border-slate-600 px-2 py-1"
            aria-pressed=${this.selected.includes(p.id)}
            @click=${() => this.choose(p.id)}
            style=${`color:${this.selected.includes(p.id) ? colors[this.selected.indexOf(p.id)] : "#94a3b8"}`}
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
      <svg
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
        ${series.map((s, k) => svg`<polyline fill="none" stroke=${colors[k]} stroke-width="2" points=${s.points.map((p) => `${x(p.i)},${y(p.value)}`).join(" ")} />`)}
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
        return html`<div style=${`color:${colors[k]}`}>
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
      ${sample.rows.find((r) => r[0] === focus) ? html`<p>Producción acumulada del país seleccionado: ${["Granjas", "Minas", "Petróleo", "Gas"].map((name, i) => html`<span>${name}: ${number(sample.rows.find((r) => r[0] === focus)![9 + i])} · </span>`)}</p>` : nothing}
    </section>`;
  }
}
