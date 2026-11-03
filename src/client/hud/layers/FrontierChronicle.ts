import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { GameView } from "../../view";
import {
  FrontierChronicleEntry,
  FrontierChronicleTracker,
} from "./FrontierChronicleTracker";

@customElement("frontier-chronicle")
export class FrontierChronicle extends LitElement implements Controller {
  public game!: GameView;

  @state() private active = false;
  @state() private expanded = false;
  @state() private entries: FrontierChronicleEntry[] = [];

  private tracker = new FrontierChronicleTracker();

  getTickIntervalMs(): number {
    return 600;
  }

  tick(): void {
    if (!this.game || this.game.inSpawnPhase()) return;

    const tick = this.game.ticks();
    const players = this.game.playerViews();
    const smallIDByPlayerID = new Map(
      players.map((player) => [String(player.id()), player.smallID()]),
    );

    const snapshotPlayers = players.map((player) => ({
      smallID: player.smallID(),
      name: player.displayName(),
      isAI: player.type() !== PlayerType.Human,
      isHuman: player.type() === PlayerType.Human,
      isAlive: player.isAlive(),
      tiles: player.numTilesOwned(),
      allies: player.alliances().flatMap((alliance) => {
        const smallID = smallIDByPlayerID.get(String(alliance.other));
        return smallID === undefined ? [] : [smallID];
      }),
      outgoingTargets: player.outgoingAttacks().map((attack) => attack.targetID),
    }));

    const newEntries = this.tracker.observe(snapshotPlayers, tick);
    if (newEntries.length > 0) {
      this.entries = [...this.entries, ...newEntries].slice(-24);
    }
    if (!this.active) this.active = true;
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
    }
  }

  render() {
    if (!this.active) return html``;

    const recentEntries = [...this.entries].reverse().slice(0, 8);

    return html`
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
