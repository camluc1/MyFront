import {
  CASTLE_DEFENSE_COST,
  CASTLE_DEFENSE_ACTIVE_TICKS,
  CASTLE_DEFENSE_RECOVERY_TICKS,
  CASTLE_DEFENSE_LOSS_MULTIPLIER,
  castleDefenseMode,
} from "@openfront/engine-api/game/CastleDefense";
import { Cell, GameType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { MouseUpEvent } from "../InputHandler";
import { SendCastleDefenseIntentEvent } from "../Transport";
import { TransformHandler } from "../TransformHandler";
import type { UIState } from "../UIState";
import { GameView, UnitView } from "../view";

const TICKS_PER_SECOND = 10;
const money = (amount: bigint) => "$" + amount.toLocaleString("es-AR");
function clock(ticks: number): string {
  const seconds = Math.ceil(Math.max(0, ticks) / TICKS_PER_SECOND);
  const minutes = Math.floor(seconds / 60);
  return minutes + ":" + String(seconds % 60).padStart(2, "0");
}

/**
 * A single scoped map/HUD surface for Geopolitics castles.
 * The renderer owns the map, while the simulation owns gold, protection and time.
 */
@customElement("geopolitics-castle-panel")
export class CastleDefensePanel extends LitElement {
  game!: GameView;
  bus!: EventBus;
  transform!: TransformHandler;
  uiState!: UIState;
  @state() private selectedId: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onClickMap = (e: MouseUpEvent) => {
    if (this.game.inSpawnPhase() || this.uiState.ghostStructure !== null) return;
    if (this.game.isSpectator()) return;
    const mine = this.game.myPlayer();
    if (!mine) return;
    let best: UnitView | undefined;
    let distance = 22 * 22;
    for (const castle of mine.units(UnitType.Castle)) {
      if (!castle.isActive()) continue;
      const pos = this.screenPosition(castle);
      const d = (pos.x - e.x) ** 2 + (pos.y - e.y) ** 2;
      if (d < distance) { distance = d; best = castle; }
    }
    this.selectedId = best?.id() ?? null;
  };
  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.selectedId = null;
  };

  connectedCallback() {
    super.connectedCallback();
    this.bus.on(MouseUpEvent, this.onClickMap);
    window.addEventListener("keydown", this.onKey);
    // Time labels and screen projections update with the simulation and camera.
    this.timer = setInterval(() => this.requestUpdate(), 250);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.bus.off(MouseUpEvent, this.onClickMap);
    window.removeEventListener("keydown", this.onKey);
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
  private screenPosition(castle: UnitView) {
    const tile = castle.tile();
    return this.transform.worldToScreenCoordinates(
      new Cell(this.game.x(tile), this.game.y(tile)),
    );
  }
  private defenseState(castle: UnitView) {
    return {
      activeUntilTick: castle.state.castleActiveUntilTick ?? 0,
      cooldownUntilTick: castle.state.castleCooldownUntilTick ?? 0,
    };
  }
  private activate(castle: UnitView) {
    const mine = this.game.myPlayer();
    if (!mine || castle.owner().id() !== mine.id() ||
        castle.isUnderConstruction() ||
        castleDefenseMode(this.game.ticks(), this.defenseState(castle)) !== "normal" ||
        mine.gold() < CASTLE_DEFENSE_COST) return;
    this.bus.emit(new SendCastleDefenseIntentEvent(castle.id()));
  }

  static styles = css`
    :host { position:fixed; inset:0; pointer-events:none; z-index:1080;
      font: 13px/1.45 system-ui, sans-serif; color:#f1f5f9; }
    * { box-sizing:border-box; }
    .tag { position:fixed; display:flex; align-items:center; gap:5px;
      transform:translate(-50%,-140%); padding:4px 8px;
      border:1px solid #61788b; border-radius:10px;
      color:#f2f8ff; background:linear-gradient(135deg,#1b3545f2,#152732f2);
      box-shadow:0 4px 16px #0007; pointer-events:auto; cursor:pointer;
      font-size:11px; font-weight:800; font-variant-numeric:tabular-nums;
      transition:background .2s, border .2s; white-space:nowrap; }
    .tag:focus-visible, button:focus-visible { outline:2px solid #ffdc8b; outline-offset:3px; }
    .tag.fortified { border-color:#6bc4a8; color:#bff8dd;
      box-shadow:0 0 0 2px #45ae7a33, 0 4px 20px #153d32cc;
      animation: fort-pulse 1.8s ease-in-out infinite; }
    .tag.recovery { border-color:#cca56f; color:#ffe0a5; }
    @keyframes fort-pulse {
      50% { box-shadow:0 0 0 5px #45ae7a19,0 4px 20px #153d32cc; }
    }
    .panel { position:fixed; right:18px; bottom:90px; width:min(360px,calc(100vw - 24px));
      max-height:calc(100vh - 130px); overflow:auto; pointer-events:auto;
      border:1px solid #527184; border-radius:18px; padding:16px;
      background:linear-gradient(145deg,#203d4d,#102431 80%);
      box-shadow:0 20px 54px #000b; }
    .head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .eyebrow { color:#91bdc9; font-size:10px; letter-spacing:.16em;
      text-transform:uppercase; font-weight:850; }
    h2 { font-size:19px; margin:3px 0 0; letter-spacing:.01em; }
    .close { border:1px solid #526e7c; color:#f1f5f9; border-radius:9px;
      padding:5px 9px; background:#304b5b; cursor:pointer; }
    .state { display:flex; align-items:center; gap:8px; margin:14px 0;
      padding:10px 12px; border:1px solid #4e6b78; border-radius:12px;
      background:#102b39; font-variant-numeric:tabular-nums; }
    .state strong { color:#d5f4ff; }
    .choices { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
    .choice { display:flex; flex-direction:column; gap:5px; align-items:center;
      text-align:center; padding:10px 5px; border:1px solid #456577; border-radius:12px;
      background:#193440; min-height:103px; }
    .choice.current { border-color:#8fc4ad; background:#234b47; }
    .choice .symbol { font-size:21px; }
    .choice b { font-size:11px; }
    .choice small { color:#b4c9d1; font-size:10px; }
    .cost { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:12px 0; }
    .metric { border:1px solid #3a5b68; border-radius:10px; background:#122a35; padding:9px; }
    .metric span { display:block; color:#a4bdca; font-size:10px; }
    .metric strong { font-size:14px; color:#f9dba0; }
    .activate { width:100%; padding:12px 14px; font-size:13px; font-weight:850;
      color:#172b28; background:linear-gradient(115deg,#f2d89e,#83d5b5);
      border:0; border-radius:12px; cursor:pointer; }
    .activate:disabled { opacity:.48; cursor:not-allowed; }
    .help { font-size:11px; color:#b9ced6; line-height:1.55;
      padding:10px 12px; border-left:2px solid #7fb4ae; margin-top:13px;
      background:#15313d; border-radius:0 9px 9px 0; }
    .help b { color:#f5f8f9; }
    @media(max-width:740px) {
      .panel { left:12px; right:12px; bottom:72px; width:auto; max-height:55vh; padding:13px; }
      .choice { min-height:85px; padding:8px 4px; }
    }
    @media(prefers-reduced-motion:reduce) {
      .tag.fortified { animation:none; }
    }
  `;

  render() {
    const tick = this.game.ticks();
    const mine = this.game.myPlayer();
    const selected = this.selectedId === null ? undefined :
      this.game.units(UnitType.Castle).find((u) => u.id() === this.selectedId && u.isActive());
    const markers = this.game.units(UnitType.Castle)
      .filter((u) => u.isActive() && mine && u.owner().id() === mine.id())
      .map((castle) => ({
        castle,
        position: this.screenPosition(castle),
        mode: castleDefenseMode(tick, this.defenseState(castle)),
        state: this.defenseState(castle),
      }))
      .filter((m) => m.position.x >= 4 && m.position.y >= 4 &&
        m.position.x <= window.innerWidth - 4 &&
        m.position.y <= window.innerHeight - 4 &&
        (m.mode !== "normal" || this.transform.scale >= 1.1 ||
          m.castle.id() === this.selectedId))
      .slice(0, 130);
    const mode = selected ? castleDefenseMode(tick, this.defenseState(selected)) : "normal";
    const state = selected ? this.defenseState(selected) : {activeUntilTick:0,cooldownUntilTick:0};
    const validOwner = selected && mine && selected.owner().id() === mine.id();
    const canActivate = validOwner && !selected.isUnderConstruction() &&
      mode === "normal" && mine.gold() >= CASTLE_DEFENSE_COST;
    return html`
      ${markers.map(({castle,position,mode,state}) => html`
        <button class="tag ${mode}" style="left:${position.x}px;top:${position.y-16}px"
          title="${mode === "normal" ? "Defensa normal" : mode === "fortified" ? "Resistencia extrema" : "Recuperación"}"
          aria-label="Abrir castillo. Estado: ${mode}"
          @click=${() => this.selectedId = castle.id()}>
          ${mode === "fortified" ? "🛡" : mode === "recovery" ? "⌛" : "♜"}
          ${mode === "fortified"
            ? clock(state.activeUntilTick - tick)
            : mode === "recovery" ? clock(state.cooldownUntilTick - tick) : ""}
        </button>`)}
      ${selected ? html`
        <section class="panel" role="region" aria-label="Estado y opciones del castillo">
          <div class="head"><div>
            <div class="eyebrow">Geopolítica · Fortaleza</div>
            <h2>♜ Castillo</h2>
          </div><button class="close" aria-label="Cerrar panel del castillo"
             @click=${() => this.selectedId = null}>✕</button></div>
          <div class="state"><span>${mode === "normal" ? "🛡" : mode === "fortified" ? "✨" : "⌛"}</span>
            <div><strong>${selected.isUnderConstruction() ? "En construcción" :
              mode === "normal" ? "Defensa normal" :
                mode === "fortified" ? "Resistencia extrema activa" : "En recuperación"}</strong>
              <div>${mode === "fortified" ? "Quedan " + clock(state.activeUntilTick - tick) :
                mode === "recovery" ? "Disponible en " + clock(state.cooldownUntilTick - tick) :
                  "Protección permanente lista"}</div></div>
          </div>
          <div class="choices" aria-label="Tres estados de la fortaleza">
            <div class="choice ${mode === "normal" ? "current" : ""}">
              <div class="symbol">🛡️</div><b>Normal</b><small>Siempre activa</small>
            </div>
            <div class="choice ${mode === "fortified" ? "current" : ""}">
              <div class="symbol">⚔️</div><b>Extrema</b><small>60 segundos</small>
            </div>
            <div class="choice ${mode === "recovery" ? "current" : ""}">
              <div class="symbol">⏳</div><b>Recuperación</b><small>120 segundos</small>
            </div>
          </div>
          <div class="cost">
            <div class="metric"><span>Activación</span><strong>${money(CASTLE_DEFENSE_COST)}</strong></div>
            <div class="metric"><span>Tu tesoro</span><strong>${money(mine?.gold() ?? 0n)}</strong></div>
            <div class="metric"><span>Alcance defensivo</span>
              <strong>${this.game.config().castleRange()} casillas</strong></div>
            <div class="metric"><span>Desgaste enemigo</span>
              <strong>+${Math.round((CASTLE_DEFENSE_LOSS_MULTIPLIER - 1) * 100)}%</strong></div>
          </div>
          ${validOwner ? html`<button class="activate" ?disabled=${!canActivate}
             @click=${() => this.activate(selected)}>
             ${selected.isUnderConstruction() ? "Esperando construcción" :
               mode === "fortified" ? "Resistencia extrema activa" :
               mode === "recovery" ? "Recuperación · " + clock(state.cooldownUntilTick - tick) :
               mine!.gold() < CASTLE_DEFENSE_COST ? "Oro insuficiente" :
               "Activar resistencia · " + money(CASTLE_DEFENSE_COST)}
           </button>` : nothing}
          <div class="help"><b>¿Cómo funciona?</b>
            La defensa normal no cuesta oro extra. Resistencia extrema aumenta
            las pérdidas del atacante en un 35% sobre la protección del castillo
            y ralentiza su conquista un 25% durante 60 segundos. Después necesita
            120 segundos de recuperación. No se acumula con otros castillos.
            Al ser capturado o transferido, pierde su bonificación temporal.
          </div>
        </section>` : nothing}
    `;
  }
}

export function mountCastleDefense(
  game: GameView, bus: EventBus, transform: TransformHandler, uiState: UIState,
): () => void {
  if (!game.config().gameConfig().geopolitics ||
      game.config().gameConfig().gameType !== GameType.Singleplayer) return () => {};
  const el = document.createElement("geopolitics-castle-panel") as CastleDefensePanel;
  el.game = game;
  el.bus = bus;
  el.transform = transform;
  el.uiState = uiState;
  document.body.append(el);
  return () => el.remove();
}
