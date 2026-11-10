import { GameType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UnitSelectionEvent } from "../InputHandler";
import { GameView, UnitView } from "../view";

function vesselStatus(unit: UnitView): string {
  const state = unit.warshipState();
  if (state.isInCombat) return "En combate";
  if (state.state === "retreating") return "Retirándose";
  if (state.state === "docked") return "En puerto";
  return state.supportShip ? "En operación de apoyo" : "Patrullando";
}

/** Information-only overlay: reuses existing warship selection and movement. */
@customElement("geopolitics-naval-status")
export class NavalStatusPanel extends LitElement {
  game!: GameView;
  bus!: EventBus;
  @state() private selectedIds: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onSelection = (event: UnitSelectionEvent) => {
    this.selectedIds = event.isSelected
      ? event.units.length ? event.units.map((u) => u.id())
        : event.unit ? [event.unit.id()] : []
      : [];
  };
  connectedCallback() {
    super.connectedCallback();
    this.bus.on(UnitSelectionEvent, this.onSelection);
    this.timer = setInterval(() => this.requestUpdate(), 400);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.bus.off(UnitSelectionEvent, this.onSelection);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  static styles = css`
    :host {position:fixed;left:18px;bottom:98px;z-index:1040;pointer-events:none;
      color:#ecf5fa;font:13px/1.5 system-ui,sans-serif;}
    * {box-sizing:border-box}
    .panel {pointer-events:auto;width:min(295px,calc(100vw - 28px));padding:14px 15px;
      border:1px solid #456b81;border-radius:16px;
      background:linear-gradient(135deg,#153745f4,#0e2434f6);
      box-shadow:0 16px 40px #0009;backdrop-filter:blur(10px);}
    .row {display:flex;justify-content:space-between;align-items:center;gap:10px}
    .eyebrow {font-size:10px;color:#9cbcca;letter-spacing:.15em;text-transform:uppercase;font-weight:800;}
    .title {font-size:17px;font-weight:850;color:#f9f2e5;margin-top:3px;}
    .status {display:inline-flex;padding:4px 9px;border:1px solid #578787;
      border-radius:16px;background:#1b4546;color:#c5eed7;font-size:11px;font-weight:800;}
    .status.combat {border-color:#c58861;background:#53352e;color:#ffe1bd}
    .grid {display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:11px 0}
    .metric {border:1px solid #35596d;border-radius:10px;padding:8px;background:#132e3e;}
    .metric span {display:block;font-size:10px;color:#acc3cf}
    .metric strong {display:block;font-size:13px;font-variant-numeric:tabular-nums}
    .hint {border-top:1px solid #35576b;padding-top:10px;color:#afc7d4;font-size:11px;}
    .close {color:#c9dce9;background:#2a4d60;border:1px solid #487083;
      padding:3px 8px;border-radius:8px;cursor:pointer;}
    @media(max-width:740px){:host{left:12px;bottom:66px}.panel{padding:10px 12px;width:min(270px,calc(100vw - 24px))}}
  `;
  render() {
    const selected = this.game.units(UnitType.Warship)
      .filter((unit) => this.selectedIds.includes(unit.id()));
    if (selected.length === 0) return nothing;
    const single = selected.length === 1 ? selected[0] : null;
    const state = single?.warshipState();
    const patrolTile = state?.patrolTile;
    const destination = patrolTile === undefined ? "Sin destino fijado" :
      `${this.game.x(patrolTile)}, ${this.game.y(patrolTile)}`;
    const totalHealth = selected.reduce((s, u) => s + Math.max(0,u.health()),0);
    const inCombat = selected.filter((u) => u.warshipState().isInCombat).length;
    const support = selected.filter((u) => u.warshipState().supportShip).length;
    return html`
      <section class="panel" role="region" aria-label="Estado de los barcos seleccionados">
        <div class="row">
          <div><div class="eyebrow">Geopolítica · Naval</div>
            <div class="title">⚓ ${single
              ? state?.supportShip ? "Barco de apoyo" : "Buque de guerra"
              : `Flota seleccionada · ${selected.length}`}
            </div></div>
          <button class="close" aria-label="Cerrar ficha naval"
            @click=${() => this.selectedIds = []}>✕</button>
        </div>
        <div style="margin-top:9px">
          <span class="status ${inCombat ? "combat" : ""}">
            ${single ? vesselStatus(single) : inCombat ? `${inCombat} en combate` : "Flota operativa"}
          </span>
        </div>
        <div class="grid">
          <div class="metric"><span>${single ? "Integridad" : "Integridad total"}</span>
            <strong>${Math.round(totalHealth).toLocaleString("es-AR")}</strong></div>
          <div class="metric"><span>${single ? "Experiencia" : "Barcos de apoyo"}</span>
            <strong>${single ? `Nivel ${single.veterancy()}` : support}</strong></div>
          <div class="metric"><span>${single ? "Destino / patrulla" : "Buques"}</span>
            <strong>${single ? destination : selected.length}</strong></div>
          <div class="metric"><span>Posición${single ? "" : " de referencia"}</span>
            <strong>${this.game.x(selected[0].tile())}, ${this.game.y(selected[0].tile())}</strong></div>
        </div>
        <div class="hint">Seleccioná el buque y pulsá una zona de agua para
          dar una orden de movimiento. También podés seleccionar varios
          buques con el recuadro de selección existente.</div>
      </section>
    `;
  }
}

export function mountNavalStatus(game: GameView, bus: EventBus): () => void {
  if (!game.config().gameConfig().geopolitics ||
      game.config().gameConfig().gameType !== GameType.Singleplayer) return () => {};
  const panel = document.createElement("geopolitics-naval-status") as NavalStatusPanel;
  panel.game = game;
  panel.bus = bus;
  document.body.append(panel);
  return () => panel.remove();
}
