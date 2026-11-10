import { Cell, UnitType } from "@openfront/engine-api/game/GameTypes";
import { SHIPYARD_TRACKS, SHIPYARD_MAX_LEVEL,
  shipyardUpgradePrice, shipyardLevelMultiplier,
  type ShipyardTrack } from "@openfront/engine-api/game/Shipyard";
import { EventBus } from "@openfront/shared/EventBus";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../Utils";
import { MouseUpEvent } from "../InputHandler";
import { SendUpgradeStructureIntentEvent } from "../Transport";
import type { TransformHandler } from "../TransformHandler";
import type { UIState } from "../UIState";
import type { GameView, UnitView } from "../view";

export function shipyardAtScreenPoint(
  game: GameView, transform: TransformHandler, x: number, y: number,
): UnitView | undefined {
  if (!game.config().isFunctionalGeopolitics() || game.inSpawnPhase()) return;
  const me = game.myPlayer();
  if (!me) return;
  let best: UnitView | undefined, closest = 16 * 16;
  for (const unit of game.units(UnitType.Shipyard)) {
    if (!unit.isActive() || unit.isUnderConstruction() ||
        unit.owner().id() !== me.id()) continue;
    const p = transform.worldToScreenCoordinates(
      new Cell(game.x(unit.tile()), game.y(unit.tile())),
    );
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= closest) { best = unit; closest = d; }
  }
  return best;
}
export class InspectShipyardEvent {
  constructor(public readonly unitId: number) {}
}

/** The existing upgrade intent purchases actual research in the engine. */
@customElement("geopolitics-shipyard-panel")
export class ShipyardPanel extends LitElement {
  game!: GameView;
  bus!: EventBus;
  transform!: TransformHandler;
  uiState!: UIState;
  @state() private selectedId: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onMap = (e: MouseUpEvent) => {
    if (this.uiState.ghostStructure !== null) return;
    this.selectedId = shipyardAtScreenPoint(
      this.game, this.transform, e.x, e.y,
    )?.id() ?? null;
  };
  private onInspect = (e: InspectShipyardEvent) => this.selectedId = e.unitId;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.selectedId = null;
  };
  connectedCallback() {
    super.connectedCallback();
    this.bus.on(MouseUpEvent, this.onMap);
    this.bus.on(InspectShipyardEvent, this.onInspect);
    window.addEventListener("keydown", this.onKey);
    this.timer = setInterval(() => this.requestUpdate(), 400);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.bus.off(MouseUpEvent, this.onMap);
    this.bus.off(InspectShipyardEvent, this.onInspect);
    window.removeEventListener("keydown", this.onKey);
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
  private buy(unit: UnitView, track: ShipyardTrack) {
    const mine = this.game.myPlayer();
    if (!mine || mine.id() !== unit.owner().id() ||
        !this.game.config().isFunctionalGeopolitics() ||
        unit.isUnderConstruction() || !unit.isActive()) return;
    const price = shipyardUpgradePrice(unit.state.shipyardLevels?.[track] ?? 0);
    if (price === null || (mine.gold() < price &&
        !this.game.config().gameConfig().infiniteGold)) return;
    this.bus.emit(new SendUpgradeStructureIntentEvent(
      unit.id(), UnitType.Shipyard, 1, track,
    ));
  }
  static styles = css`
    :host{position:fixed;inset:0;pointer-events:none;z-index:1075;
      font:13px/1.45 system-ui,sans-serif;color:#f5f9fc}
    *{box-sizing:border-box}button{font:inherit;cursor:pointer}
    .tag{position:fixed;transform:translate(-50%,-150%);pointer-events:auto;
      border:1px solid #81b3da;border-radius:10px;padding:5px 9px;
      background:#15394deb;color:#e9f8ff;font-weight:800;
      box-shadow:0 4px 12px #0009}
    .panel{pointer-events:auto;position:fixed;top:17%;right:16px;
      width:min(360px,calc(100vw - 24px));padding:18px;
      background:linear-gradient(145deg,#112936f6,#101d2bf8);
      border:1px solid #7395b6;border-radius:16px;
      box-shadow:0 18px 44px #000b;max-height:76vh;overflow-y:auto}
    .head{display:flex;align-items:center;justify-content:space-between;
      gap:12px;margin-bottom:12px}h2{font-size:19px;margin:0}
    .close{border:0;background:transparent;color:white;font-size:20px}
    .help{color:#b6cddc;margin-bottom:12px;font-size:12px}
    .track{display:flex;align-items:center;justify-content:space-between;
      gap:10px;padding:11px;border:1px solid #45637a;border-radius:12px;
      background:#162d3d;margin-bottom:8px}
    .name{font-weight:700}.small{font-size:11px;color:#bad0de}
    .buy{border:1px solid #88c9a0;background:#216146;color:#fff;
      border-radius:9px;padding:7px 10px;min-width:100px;font-weight:700}
    .buy:disabled{opacity:.5;cursor:default}
    button:focus-visible{outline:2px solid #fff;outline-offset:2px}
    @media(max-width:650px){.panel{right:8px;top:auto;bottom:14%;padding:13px}}
  `;
  render() {
    const mine = this.game.myPlayer();
    const units = mine ? this.game.units(UnitType.Shipyard).filter((u) =>
      u.isActive() && u.owner().id() === mine.id()) : [];
    const selected = units.find((u) => u.id() === this.selectedId);
    const names: Record<ShipyardTrack,string> = {
      merchantSpeed: "geopolitics.shipyard_merchant",
      transportCapacity: "geopolitics.shipyard_transport",
      warshipHealth: "geopolitics.shipyard_hull",
      warshipDamage: "geopolitics.shipyard_firepower",
    };
    return html`
      ${units.filter((u) => this.transform.scale >= 1.1 ||
        u.id() === this.selectedId).slice(0,120).map((u) => {
        const p = this.transform.worldToScreenCoordinates(
          new Cell(this.game.x(u.tile()), this.game.y(u.tile())),
        );
        return p.x < 0 || p.y < 0 ||
          p.x > window.innerWidth || p.y > window.innerHeight
          ? nothing : html`<button class="tag"
            style="left:${p.x}px;top:${p.y-18}px"
            aria-label="${translateText("geopolitics.shipyard_title")}"
            @click=${() => this.selectedId = u.id()}>⚓</button>`;
      })}
      ${selected ? html`<section class="panel"
        aria-label="${translateText("geopolitics.shipyard_title")}">
        <div class="head"><h2>⚓ ${translateText("geopolitics.shipyard_title")}</h2>
          <button class="close"
            aria-label="${translateText("geopolitics.shipyard_close")}"
            @click=${() => this.selectedId = null}>✕</button>
        </div>
        <div class="help">${translateText("geopolitics.shipyard_help")}</div>
        ${SHIPYARD_TRACKS.map((track) => {
          const level = selected.state.shipyardLevels?.[track] ?? 0;
          const price = shipyardUpgradePrice(level);
          const bonus = Math.round(
            (shipyardLevelMultiplier(track, level) - 1) * 100,
          );
          const disabled = price === null || selected.isUnderConstruction() ||
            (mine!.gold() < price && !this.game.config().gameConfig().infiniteGold);
          return html`<div class="track"><div>
            <div class="name">${translateText(names[track])}</div>
            <div class="small">${translateText("geopolitics.shipyard_level")}
              ${level}/${SHIPYARD_MAX_LEVEL} · +${bonus}%</div>
            </div><button class="buy" ?disabled=${disabled}
              @click=${() => this.buy(selected, track)}>
              ${price === null
                ? translateText("geopolitics.shipyard_max")
                : "$" + price.toLocaleString("es-AR")}
            </button></div>`;
        })}
      </section>` : nothing}
    `;
  }
}
export function mountShipyard(
  game: GameView, bus: EventBus, transform: TransformHandler, uiState: UIState,
): () => void {
  if (!game.config().isFunctionalGeopolitics()) return () => {};
  const el = document.createElement("geopolitics-shipyard-panel") as ShipyardPanel;
  el.game = game; el.bus = bus; el.transform = transform; el.uiState = uiState;
  document.body.append(el);
  return () => el.remove();
}
