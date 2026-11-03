import {
  GameType,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { Controller } from "../../Controller";
import type { GameView } from "../../view";
import { recordGoldRates } from "./lib/StatsColumns";
import { goldRateTracker } from "./lib/GoldRateTracker";
import {
  FrontierChronicleTracker,
  type FrontierChronicleEntry,
} from "./FrontierChronicleTracker";

@customElement("frontier-chronicle")
export class FrontierChronicle extends LitElement implements Controller {
  private _game!: GameView;

  get game(): GameView {
    return this._game;
  }

  set game(game: GameView) {
    if (this._game === game) return;
    this._game = game;
    this.tracker = new FrontierChronicleTracker();
    goldRateTracker.resetAll();
    this.entries = [];
    this.active = false;
    this.expanded = false;
    this.peaceRemainingSeconds = 0;
    this.priorityNotice = null;
    if (this.priorityNoticeTimer !== null) {
      clearTimeout(this.priorityNoticeTimer);
      this.priorityNoticeTimer = null;
    }
  }

  @state() private active = false;
  @state() private expanded = false;
  @state() private entries: FrontierChronicleEntry[] = [];
  @state() private peaceRemainingSeconds = 0;
  @state() private priorityNotice: FrontierChronicleEntry | null = null;

  private priorityNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  private tracker = new FrontierChronicleTracker();

  getTickIntervalMs(): number {
    return 600;
  }

  tick(): void {
    if (!this.game || this.game.inSpawnPhase()) return;

    const tick = this.game.ticksSinceStart();
    const gameConfig = this.game.config().gameConfig();
    const peaceMinutes =
      gameConfig.gameType === GameType.Singleplayer
        ? (gameConfig.nationPeaceTimeMinutes ?? 0)
        : 0;
    this.peaceRemainingSeconds = Math.max(
      0,
      Math.ceil(peaceMinutes * 60 - tick / 10),
    );
    const players = this.game.playerViews();
    const smallIDByPlayerID = new Map<string, number>(
      players.map(
        (player) => [String(player.id()), player.smallID()] as const,
      ),
    );

    const snapshotPlayers = players.map((player) => {
      recordGoldRates(player, this.game);
      return {
        smallID: player.smallID(),
        name: player.displayName(),
        isAI: player.type() !== PlayerType.Human,
        isHuman: player.type() === PlayerType.Human,
        isNation: player.type() === PlayerType.Nation,
        isAlive: player.isAlive(),
        tiles: player.numTilesOwned(),
        allies: player.alliances().flatMap((alliance) => {
          const smallID = smallIDByPlayerID.get(String(alliance.other));
          return smallID === undefined ? [] : [smallID];
        }),
        outgoingTargets: player.outgoingAttacks().map((attack) => attack.targetID),
        goldIncomePerMin: goldRateTracker.goldIncomePerMin(player.smallID()),
        troops: player.troops(),
        maxTroops: this.game.config().maxTroops(player),
        atomBombCount: player.units(UnitType.AtomBomb).length,
      };
    });

    const newEntries = this.tracker.observe(snapshotPlayers, tick);
    if (newEntries.length > 0) {
      this.entries = [...this.entries, ...newEntries].slice(-24);
      const nuclearNotice = newEntries.find(
        (entry) => entry.kind === "nuclear-development",
      );
      if (nuclearNotice) this.showPriorityNotice(nuclearNotice);
    }
    if (!this.active) this.active = true;
  }

  private showPriorityNotice(entry: FrontierChronicleEntry): void {
    this.priorityNotice = entry;
    if (this.priorityNoticeTimer !== null) {
      clearTimeout(this.priorityNoticeTimer);
    }
    this.priorityNoticeTimer = setTimeout(() => {
      this.priorityNotice = null;
      this.priorityNoticeTimer = null;
    }, 6500);
  }

  disconnectedCallback(): void {
    if (this.priorityNoticeTimer !== null) {
      clearTimeout(this.priorityNoticeTimer);
      this.priorityNoticeTimer = null;
    }
    super.disconnectedCallback();
  }

  private formatCountdown(seconds: number): string {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
    const remaining = (seconds % 60).toString().padStart(2, "0");
    return minutes + ":" + remaining;
  }

  private formatTime(tick: number): string {
    const totalSeconds = Math.floor(tick / 10);
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return minutes + ":" + seconds;
  }

  private presentation(kind: FrontierChronicleEntry["kind"]): {
    icon: string;
    label: string;
    color: string;
  } {
    switch (kind) {
      case "war":
        return { icon: "⚔", label: "GUERRA", color: "text-rose-300" };
      case "alliance-formed":
        return { icon: "◆", label: "PACTO", color: "text-cyan-300" };
      case "alliance-ended":
        return { icon: "◇", label: "RUPTURA", color: "text-amber-300" };
      case "elimination":
        return { icon: "✕", label: "ELIMINACIÓN", color: "text-red-300" };
      case "expansion":
        return { icon: "▲", label: "EXPANSIÓN", color: "text-emerald-300" };
      case "power-shift":
        return { icon: "♛", label: "HEGEMONÍA", color: "text-violet-300" };
      case "economic-surge":
        return { icon: "↗", label: "ECONOMÍA", color: "text-emerald-300" };
      case "military-build-up":
        return { icon: "▥", label: "REARME", color: "text-rose-300" };
      case "power-decline":
        return { icon: "↘", label: "DECLIVE", color: "text-amber-300" };
      case "economic-hegemony":
        return { icon: "◈", label: "LIDERAZGO ECONÓMICO", color: "text-emerald-200" };
      case "military-hegemony":
        return { icon: "♜", label: "LIDERAZGO MILITAR", color: "text-rose-200" };
      case "nuclear-development":
        return { icon: "☢", label: "HITO NUCLEAR", color: "text-amber-200" };
      default:
        return { icon: "•", label: "MUNDO", color: "text-slate-300" };
    }
  }

  render() {
    if (!this.active) return html``;

    const recentEntries = [...this.entries].reverse().slice(0, 8);

    return html`
      ${this.peaceRemainingSeconds > 0
        ? html`<div class="pointer-events-none fixed top-[5.5rem] left-1/2 z-[1001] -translate-x-1/2">
            <div class="rounded-xl border border-cyan-300/30 bg-slate-950/95 px-5 py-2.5 text-center text-white shadow-2xl backdrop-blur-xl">
              <div class="text-[9px] font-black tracking-[0.22em] text-cyan-200">PAZ ENTRE NACIONES</div>
              <div class="mt-0.5 text-lg font-black tabular-nums text-white">${this.formatCountdown(this.peaceRemainingSeconds)}</div>
              <div class="text-[9px] text-slate-400">Las naciones no pueden iniciar guerras todavía</div>
            </div>
          </div>`
        : ""}
      ${this.priorityNotice
        ? html`<div class="pointer-events-none fixed top-4 left-1/2 z-[1002] -translate-x-1/2">
            <div class="w-[min(92vw,30rem)] rounded-xl border border-amber-300/40 bg-slate-950/96 px-5 py-4 text-center text-white shadow-2xl backdrop-blur-xl">
              <div class="text-[9px] font-black tracking-[0.24em] text-amber-200">ACONTECIMIENTO MUNDIAL · FRONTIER</div>
              <div class="mt-1 text-base font-black">${this.priorityNotice.headline}</div>
              <div class="mt-1 text-xs leading-relaxed text-slate-300">${this.priorityNotice.detail}</div>
            </div>
          </div>`
        : ""}
      <section class="pointer-events-auto w-[min(92vw,26rem)] mb-2">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 rounded-xl border border-cyan-900/70 bg-slate-950/95 px-4 py-3 text-left text-white shadow-xl backdrop-blur-md transition hover:border-cyan-500/70"
          aria-expanded=${this.expanded}
          @click=${() => (this.expanded = !this.expanded)}
        >
          <span class="flex min-w-0 items-center gap-3">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">◈</span>
            <span class="min-w-0">
              <span class="block text-xs font-bold tracking-[0.18em] text-cyan-100">CRÓNICA MUNDIAL</span>
              <span class="block truncate text-[11px] text-slate-400">
                ${this.entries.length === 0
                  ? "Esperando acontecimientos"
                  : String(this.entries.length) + " acontecimientos registrados"}
              </span>
            </span>
          </span>
          <span class="shrink-0 text-xs font-semibold text-slate-300">
            ${this.expanded ? "CERRAR −" : "VER +"}
          </span>
        </button>

        ${this.expanded
          ? html`
              <div class="mt-2 max-h-[38vh] overflow-y-auto rounded-xl border border-slate-700/80 bg-slate-950/96 p-3 text-white shadow-2xl backdrop-blur-xl">
                <div class="mb-3 flex items-center justify-between border-b border-slate-700/70 pb-2">
                  <span class="text-[10px] font-bold tracking-[0.2em] text-slate-400">REGISTRO ESTRATÉGICO</span>
                  <span class="text-[10px] tabular-nums text-slate-500">TIEMPO DE PARTIDA</span>
                </div>
                ${recentEntries.length === 0
                  ? html`<p class="py-5 text-center text-xs text-slate-400">Todavía no hay cambios relevantes en el mundo.</p>`
                  : html`
                      <ol class="flex flex-col gap-2">
                        ${recentEntries.map((entry) => {
                          const meta = this.presentation(entry.kind);
                          return html`
                            <li class="rounded-lg border border-slate-800 bg-slate-900/75 px-3 py-2.5">
                              <div class="mb-1 flex items-center justify-between gap-2">
                                <span class="flex items-center gap-2 text-[9px] font-bold tracking-[0.16em] ${meta.color}">
                                  <span>${meta.icon}</span>
                                  <span>${meta.label}</span>
                                </span>
                                <time class="text-[10px] tabular-nums text-slate-500">${this.formatTime(entry.tick)}</time>
                              </div>
                              <h3 class="text-xs font-semibold text-slate-100">${entry.headline}</h3>
                              <p class="mt-1 text-[11px] leading-relaxed text-slate-400">${entry.detail}</p>
                            </li>
                          `;
                        })}
                      </ol>
                    `}
              </div>
            `
          : ""}
      </section>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
