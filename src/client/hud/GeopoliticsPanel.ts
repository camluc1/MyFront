import { Cell, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  diplomaticPersonality,
  DiplomacyAction,
  DiplomaticOffer,
  emptyAssets,
  TreatyKind,
} from "@openfront/engine-api/Geopolitics";
import { EventBus } from "@openfront/shared/EventBus";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { TransformHandler, GoToPositionEvent } from "../TransformHandler";
import {
  SendDonateGoldIntentEvent,
  SendDonateTroopsIntentEvent,
  SendDiplomacyIntentEvent,
} from "../Transport";
import { translateText } from "../Utils";
import { GameView, PlayerView } from "../view";

const t = (key: string) => translateText(`geopolitics.${key}`);
export function transferRuns(
  tiles: readonly number[],
  game: Pick<GameView, "x" | "y">,
) {
  const cells = tiles
    .map((t) => ({ x: game.x(t), y: game.y(t) }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const runs: { x: number; y: number; width: number }[] = [];
  for (const c of cells) {
    const last = runs[runs.length - 1];
    if (last && last.y === c.y && last.x + last.width === c.x) last.width++;
    else runs.push({ ...c, width: 1 });
  }
  return runs;
}
const structures = new Set([
  UnitType.City,
  UnitType.Port,
  UnitType.Factory,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
  UnitType.Farm,
  UnitType.Mine,
  UnitType.OilWell,
  UnitType.GasPlant,
]);
@customElement("geopolitics-panel")
export class GeopoliticsPanel extends LitElement {
  game!: GameView;
  bus!: EventBus;
  transform!: TransformHandler;
  @state() private opened = false;
  @state() private target = "";
  @state() private kind: TreatyKind = "nonaggression";
  @state() private give = emptyAssets();
  @state() private receive = emptyAssets();
  @state() private selected: DiplomaticOffer | null = null;
  @state() private tab = "countries";
  @state() private side: "give" | "receive" = "receive";
  @state() private radius = 3;
  @state() private search = "";
  @state() private buildingType = "all";
  @state() private editing = false;
  @state() private ultimatum = false;
  @state() private threat = "";
  @state() private notice = "";
  private counterTo: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private overlay = document.createElement("canvas");
  private frame = 0;
  private previewBase: HTMLCanvasElement | null = null;
  private previewTick = -1;
  private lastFeedbackKey = "";
  private runCache = new Map<
    readonly number[],
    ReturnType<typeof transferRuns>
  >();
  private runs(tiles: readonly number[]) {
    let runs = this.runCache.get(tiles);
    if (!runs) {
      runs = transferRuns(tiles, this.game);
      if (this.runCache.size >= 2) this.runCache.clear();
      this.runCache.set(tiles, runs);
    }
    return runs;
  }

  static styles = css`
    :host {
      position: fixed;
      right: 18px;
      top: 100px;
      z-index: 1100;
      color: #edf6f8;
      font: 13px/1.5 system-ui;
      pointer-events: none;
      max-width: calc(100vw - 24px);
    }
    * {
      box-sizing: border-box;
    }
    button,
    input,
    select {
      font: inherit;
    }
    button {
      cursor: pointer;
      border: 1px solid #526575;
      border-radius: 9px;
      color: #eaf3f8;
      background: #182b3b;
      padding: 8px 12px;
      transition: background 0.15s;
    }
    button:hover {
      background: #284558;
      border-color: #9ccfd5;
    }
    button:focus-visible,
    input:focus-visible,
    select:focus-visible {
      outline: 2px solid #f4ce7b;
      outline-offset: 2px;
    }
    button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .primary {
      background: #b9daca;
      color: #152e2a;
      font-weight: 750;
      border: 0;
    }
    .danger {
      color: #ffb5a9;
      border-color: #9a574b;
    }
    .gold {
      color: #efd093;
    }
    .muted {
      color: #9db0be;
      font-size: 12px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: space-between;
    }
    .wrap {
      flex-wrap: wrap;
    }
    .stack {
      display: grid;
      gap: 10px;
    }
    .badge {
      font-size: 11px;
      border: 1px solid #48616d;
      border-radius: 20px;
      padding: 2px 8px;
    }
    .launcher {
      pointer-events: auto;
      width: 260px;
      background: linear-gradient(135deg, #152934f5, #101d2bf5);
      border: 1px solid #526a77;
      border-radius: 14px;
      padding: 12px;
      box-shadow: 0 8px 35px #0005;
    }
    .launcher button {
      width: 100%;
      text-align: left;
    }
    .panel {
      pointer-events: auto;
      margin-top: 10px;
      width: min(780px, calc(100vw - 36px));
      max-height: calc(100dvh - 190px);
      overflow: auto;
      background: #101d2bf5;
      border: 1px solid #526a77;
      border-radius: 16px;
      box-shadow: 0 20px 80px #0008;
      backdrop-filter: blur(18px);
    }
    header {
      padding: 20px;
      background: linear-gradient(120deg, #1f3743, #17242e);
      border-bottom: 1px solid #334858;
    }
    h2 {
      font-size: 22px;
      letter-spacing: 0.03em;
      margin: 0;
    }
    h3 {
      margin: 0 0 8px;
      font-size: 14px;
    }
    nav {
      display: flex;
      gap: 6px;
      padding: 12px 18px;
      border-bottom: 1px solid #334858;
    }
    nav button[aria-selected="true"] {
      background: #36505c;
      border-color: #e2c38a;
    }
    .body {
      padding: 18px;
    }
    .card {
      padding: 12px;
      border: 1px solid #354c5b;
      border-radius: 12px;
      background: #172937;
    }
    .card + .card {
      margin-top: 10px;
    }
    .columns {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .asset {
      padding: 12px;
      border-radius: 12px;
      border: 1px solid #3f6c75;
      background: #162c37;
    }
    .asset.give {
      border-color: #987955;
    }
    .fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    label {
      display: grid;
      gap: 4px;
      color: #b8c8d0;
    }
    input,
    select {
      width: 100%;
      min-width: 0;
      padding: 8px;
      color: #edf6f8;
      background: #0c1924;
      border: 1px solid #435b6a;
      border-radius: 8px;
    }
    input[type="checkbox"] {
      width: auto;
    }
    .buildings {
      max-height: 180px;
      overflow: auto;
      margin-top: 10px;
    }
    .building {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid #304552;
    }
    .preview {
      width: 100%;
      height: auto;
      border: 1px solid #435b6a;
      background: #0a1723;
      image-rendering: pixelated;
      cursor: crosshair;
      border-radius: 10px;
    }
    .footer {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding-top: 14px;
      justify-content: flex-end;
    }
    .countdown {
      color: #efd093;
      font-size: 19px;
      font-variant-numeric: tabular-nums;
    }
    progress {
      width: 100%;
      accent-color: #e4c886;
      height: 5px;
    }
    .pill {
      display: inline-block;
      padding: 2px 6px;
      color: #87d5ca;
    }
    .empty {
      padding: 24px;
      text-align: center;
      color: #a5bac6;
    }
    .notice {
      padding: 10px;
      border-left: 3px solid #e4c886;
      background: #2a3030;
    }
    .danger-zone {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid #53606a;
    }
    @media (max-width: 640px) {
      :host {
        top: 76px;
        right: 12px;
      }
      .launcher {
        width: 210px;
      }
      .panel {
        max-height: calc(100dvh - 155px);
      }
      .columns {
        grid-template-columns: 1fr;
      }
      .body {
        padding: 12px;
      }
      header {
        padding: 14px;
      }
      .buildings {
        max-height: 120px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        transition: none;
      }
    }
  `;
  connectedCallback() {
    super.connectedCallback();
    this.overlay.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:1099;width:100vw;height:100vh";
    this.overlay.setAttribute("aria-hidden", "true");
    document.body.append(this.overlay);
    this.timer = setInterval(() => {
      const feedback = this.game.diplomacy.feedback?.[this.mine()?.id() ?? ""];
      const feedbackKey = feedback ? `${feedback.tick}:${feedback.reason}` : "";
      if (feedback && feedbackKey !== this.lastFeedbackKey) {
        this.lastFeedbackKey = feedbackKey;
        this.notice = t("feedback_" + feedback.reason);
        if (!this.selected && this.tab === "inbox") {
          this.editing = true;
          this.tab = "negotiate";
        }
      }
      this.requestUpdate();
    }, 1000);
    this.frame = requestAnimationFrame(() => this.drawOverlay());
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.timer);
    cancelAnimationFrame(this.frame);
    this.overlay.remove();
  }
  protected updated() {
    this.drawPreview();
  }
  private send(action: DiplomacyAction) {
    this.bus.emit(new SendDiplomacyIntentEvent(action));
  }
  private name(id: string) {
    return (
      this.game
        .players()
        .find((p) => p.id() === id)
        ?.name() ?? id
    );
  }
  private mine() {
    return this.game.myPlayer();
  }
  private pending() {
    const id = this.mine()?.id();
    return this.game.diplomacy.offers.filter(
      (o) => o.status === "pending" && o.required.includes(id ?? ""),
    );
  }
  private assets() {
    return this.selected
      ? { give: this.selected.give, receive: this.selected.receive }
      : { give: this.give, receive: this.receive };
  }
  private newOffer(p: PlayerView) {
    this.previewBase = null;
    this.target = p.id();
    this.selected = null;
    this.give = emptyAssets();
    this.receive = emptyAssets();
    this.counterTo = undefined;
    this.ultimatum = false;
    this.threat = "";
    this.editing = true;
    this.tab = "negotiate";
    this.notice = "";
  }
  private inspect(o: DiplomaticOffer) {
    this.previewBase = null;
    this.selected = o;
    this.target = o.from === this.mine()?.id() ? o.to : o.from;
    this.editing = false;
    this.tab = "negotiate";
    this.notice = "";
  }
  private counter() {
    if (!this.selected) return;
    this.give = {
      ...this.selected.receive,
      tiles: [...this.selected.receive.tiles],
      buildings: [...this.selected.receive.buildings],
    };
    this.receive = {
      ...this.selected.give,
      tiles: [...this.selected.give.tiles],
      buildings: [...this.selected.give.buildings],
    };
    this.kind = this.selected.kind;
    this.threat = this.selected.threat;
    this.ultimatum = false;
    this.counterTo = this.selected.id;
    this.selected = null;
    this.editing = true;
  }
  private region(tile: number, side: "give" | "receive", remove = false) {
    const owner = side === "give" ? this.mine()?.id() : this.target;
    const tiles = new Set(this[side].tiles);
    const x = this.game.x(tile),
      y = this.game.y(tile),
      r = this.radius;
    for (
      let yy = Math.max(0, y - r);
      yy <= Math.min(this.game.height() - 1, y + r);
      yy++
    )
      for (
        let xx = Math.max(0, x - r);
        xx <= Math.min(this.game.width() - 1, x + r);
        xx++
      ) {
        const ref = this.game.ref(xx, yy);
        if (
          (xx - x) * (xx - x) + (yy - y) * (yy - y) <= r * r &&
          this.game.isLand(ref) &&
          !this.game.isImpassable(ref) &&
          this.game.owner(ref).id() === owner
        ) {
          if (remove) tiles.delete(ref);
          else tiles.add(ref);
        }
      }
    if (tiles.size > 20000) {
      this.notice = t("region_limit");
      return;
    }
    const buildings = this.game
      .units()
      .filter((u) => structures.has(u.type()) && tiles.has(u.tile()))
      .map((u) => u.id());
    this[side] = {
      ...this[side],
      tiles: [...tiles].sort((a, b) => a - b),
      buildings,
    };
  }
  private clear(side: "give" | "receive") {
    this[side] = { ...this[side], tiles: [], buildings: [] };
  }
  private quantity(
    side: "give" | "receive",
    key: "gold" | "troops",
    event: Event,
  ) {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    this[side] = {
      ...this[side],
      [key]: Math.max(
        0,
        Math.min(1000000000000, Math.floor(Number.isFinite(value) ? value : 0)),
      ),
    };
  }
  private renderAssets(side: "give" | "receive") {
    const a = this.assets()[side];
    const owner = this.selected
      ? side === "give"
        ? this.selected.from
        : this.selected.to
      : side === "give"
        ? this.mine()?.id()
        : this.target;
    const p = this.game.players().find((p) => p.id() === owner);
    const units = this.game
      .units()
      .filter((u) => u.owner().id() === owner && structures.has(u.type()))
      .sort((a, b) => b.level() - a.level() || a.id() - b.id());
    return html`<section class="asset ${side}">
      <h3>${this.selected ? this.name(owner ?? "") : t(side)}</h3>
      <div class="muted">
        ${t("available")}: ${Number(p?.gold() ?? 0n).toLocaleString()}
        ${t("gold")} · ${Math.floor(p?.troops() ?? 0).toLocaleString()}
        ${t("troops")}
      </div>
      <div class="fields">
        ${(["gold", "troops"] as const).map((key) => html`<label>${t(key)}<input aria-label=${t(side) + " " + t(key)} type="number" min="0" step="100" .value=${String(a[key])} ?disabled=${!this.editing} @change=${(e: Event) => this.quantity(side, key, e)} /></label>`)}
      </div>
      ${
        this.editing
          ? html`<label
              >${t("filter_buildings")}<select
                .value=${this.buildingType}
                @change=${(e: Event) => (this.buildingType = (e.target as HTMLSelectElement).value)}
              >
                <option value="all">${t("all_buildings")}</option>
                ${[...structures].map((type) => html`<option value=${type}>${translateText(`unit_type.${type.toLowerCase().replace(/ /g, "_")}`)}</option>`)}
              </select></label
            >`
          : nothing
      }
      <div class="buildings">
        ${units
          .filter(
            (u) =>
              a.buildings.includes(u.id()) ||
              (this.editing &&
                (this.buildingType === "all" ||
                  this.buildingType === u.type())),
          )
          .map(
            (u) =>
              html`<div class="building">
                <label class="building"
                  ><input
                    type="checkbox"
                    .checked=${a.buildings.includes(u.id())}
                    ?disabled=${!this.editing}
                    @change=${() => {
                      this.region(u.tile(), side, a.buildings.includes(u.id()));
                    }}
                  /><span
                    >${translateText(`unit_type.${u.type().toLowerCase().replace(/ /g, "_")}`)}
                    <b class="gold">${t("level")} ${u.level()}</b
                    ><span class="muted">
                      · ${this.game.x(u.tile())}, ${this.game.y(u.tile())}</span
                    ></span
                  ></label
                ><button
                  aria-label=${t("locate")}
                  @click=${() => this.bus.emit(new GoToPositionEvent(this.game.x(u.tile()), this.game.y(u.tile())))}
                >
                  ⌖
                </button>
              </div>`,
          )}
      </div>
      <p class="muted">
        ${t("territory_impact")}:
        ${p ? Math.round((a.tiles.length / Math.max(1, p.numTilesOwned())) * 1000) / 10 : 0}%
        · ${t("remaining_land")}:
        ${Math.max(0, (p?.numTilesOwned() ?? 0) - a.tiles.length)}
      </p>
      <div class="row">
        <span class="muted"
          >${a.tiles.length.toLocaleString()} ${t("tiles")} ·
          ${a.buildings.length} ${t("buildings")}</span
        >${this.editing ? html`<button @click=${() => this.clear(side)}>${t("clear_region")}</button>` : nothing}
      </div>
    </section>`;
  }
  private approach(kind: "survival" | "infrastructure" | "aid" | "pressure") {
    this.give = emptyAssets();
    this.receive = emptyAssets();
    this.counterTo = undefined;
    this.ultimatum = kind === "pressure";
    this.threat = "";
    this.kind = kind === "aid" ? "nonaggression" : "peace";
    this.buildingType = kind === "infrastructure" ? UnitType.Port : "all";
    if (kind === "survival" || kind === "infrastructure")
      this.give.gold = Math.floor(Number(this.mine()?.gold() ?? 0n) / 10);
    if (kind === "aid")
      this.give.troops = Math.floor((this.mine()?.troops() ?? 0) / 10);
    if (kind === "pressure")
      this.receive.gold = Math.floor(
        Number(this.game.player(this.target).gold()) / 10,
      );
    this.notice = t("approach_" + kind + "_help");
  }
  private renderNegotiation() {
    const o = this.selected
      ? (this.game.diplomacy.offers.find((o) => o.id === this.selected!.id) ??
        this.selected)
      : null;
    if (!this.editing && !o)
      return html`<p class="empty">${t("choose_country")}</p>`;
    return html`<div class="row wrap">
        <h3>${this.name(this.target)}</h3>
        ${
          o
            ? html`<span class="badge"
                >${t(o.status)} ·
                ${Math.max(0, Math.ceil((o.expires - this.game.ticks()) / 10))}s</span
              >`
            : html`<select
                aria-label=${t("treaty")}
                style="width:auto"
                .value=${this.kind}
                @change=${(e: Event) => (this.kind = (e.target as HTMLSelectElement).value as TreatyKind)}
              >
                ${(["truce", "nonaggression", "coalition", "peace"] as TreatyKind[]).map((k) => html`<option value=${k}>${t(k)}</option>`)}
              </select>`
        }
      </div>
      <p class="muted">
        ${o?.ultimatum ? html`<strong class="gold">${t("ultimatum")} · </strong>` : nothing}${t(o?.kind ?? this.kind)}
        · ${t("duration_" + (o?.kind ?? this.kind))}
      </p>
      ${this.editing ? html`<label class="building"><input type="checkbox" .checked=${this.ultimatum} @change=${(e: Event) => (this.ultimatum = (e.target as HTMLInputElement).checked)} />${t("ultimatum_help")}</label>` : nothing}
      ${
        this.editing && this.kind === "coalition"
          ? html`<label
              >${t("common_target")}<select
                .value=${this.threat}
                @change=${(e: Event) => (this.threat = (e.target as HTMLSelectElement).value)}
              >
                <option value="">${t("no_target")}</option>
                ${this.game
                  .players()
                  .filter((p) => p.id() !== this.target && p !== this.mine())
                  .map(
                    (p) => html`<option value=${p.id()}>${p.name()}</option>`,
                  )}
              </select></label
            >`
          : nothing
      }
      ${this.editing && this.counterTo === undefined ? html`<div class="row wrap" aria-label=${t("approaches")}>${(["survival", "infrastructure", "aid", "pressure"] as const).map((kind) => html`<button @click=${() => this.approach(kind)}>${t("approach_" + kind)}</button>`)}</div>` : nothing}
      <div class="columns">
        ${this.renderAssets("give")}${this.renderAssets("receive")}
      </div>
      <p class="muted">${t("preview_help")}</p>
      ${
        this.editing
          ? html`<div class="row wrap">
              <select
                style="width:auto"
                aria-label=${t("region_side")}
                .value=${this.side}
                @change=${(e: Event) => (this.side = (e.target as HTMLSelectElement).value as "give" | "receive")}
              >
                <option value="give">${t("give")}</option>
                <option value="receive">${t("receive")}</option></select
              ><label
                >${t("radius")} ${this.radius}<input
                  type="range"
                  min="1"
                  max="40"
                  .value=${String(this.radius)}
                  @input=${(e: Event) => (this.radius = Number((e.target as HTMLInputElement).value))}
              /></label>
            </div>`
          : nothing
      }<canvas
        class="preview"
        width=${this.game.width()}
        height=${this.game.height()}
        aria-label=${t("exact_preview")}
        @click=${(e: MouseEvent) => {
          if (!this.editing) return;
          const c = e.currentTarget as HTMLCanvasElement,
            r = c.getBoundingClientRect();
          const x = Math.min(
              this.game.width() - 1,
              Math.floor(((e.clientX - r.left) * this.game.width()) / r.width),
            ),
            y = Math.min(
              this.game.height() - 1,
              Math.floor(((e.clientY - r.top) * this.game.height()) / r.height),
            );
          this.region(this.game.ref(x, y), this.side);
        }}
      ></canvas>
      <p class="muted">
        🟨 ${t("give")} · 🟩 ${t("receive")} · ${t("enclaves")}
      </p>
      ${
        o
          ? html`<div class="notice">
              ${t("reason_" + o.reason)}
              ${
                o.kind === "coalition"
                  ? html`<br />${t("approvals")}:
                      ${o.approvals.length}/${o.required.length}
                      <div>
                        ${o.required.map((id) => html`<span class="badge">${o.approvals.includes(id) ? "✓" : "…"} ${this.name(id)}</span>`)}
                      </div>`
                  : nothing
              }
            </div>`
          : nothing
      }${this.notice ? html`<div role="status" class="notice">${this.notice}</div>` : nothing}
      <p class="notice">
        ${t("effect_" + (o?.kind ?? this.kind))}<br />${t("decision_effect")}
      </p>
      <div class="footer">
        ${
          this.editing
            ? html`<button
                  @click=${() => {
                    this.editing = false;
                    this.tab = "countries";
                  }}
                >
                  ${t("cancel")}</button
                ><button
                  class="primary"
                  @click=${() => {
                    this.send({
                      action: "offer",
                      target: this.target,
                      kind: this.kind,
                      give: this.give,
                      receive: this.receive,
                      counterTo: this.counterTo,
                      ultimatum: this.ultimatum,
                      threat: this.threat,
                    });
                    this.notice = t("sent");
                    this.editing = false;
                    this.tab = "inbox";
                  }}
                >
                  ${t("send")}
                </button>`
            : o?.status === "pending"
              ? o.from === this.mine()?.id()
                ? html`<button
                    @click=${() => this.send({ action: "withdraw", target: o.to, offerID: o.id })}
                  >
                    ${t("withdraw")}
                  </button>`
                : html`<button
                      @click=${() => this.send({ action: "reject", target: o.from, offerID: o.id })}
                    >
                      ${t("reject")}</button
                    >${o.to === this.mine()?.id() ? html`<button @click=${() => this.counter()}>${t("counter")}</button>` : nothing}<button
                      class="primary"
                      ?disabled=${o.approvals.includes(this.mine()?.id() ?? "")}
                      @click=${() => this.send({ action: "accept", target: o.from, offerID: o.id })}
                    >
                      ${t("accept")}
                    </button>`
              : nothing
        }
      </div>`;
  }
  private renderCountries() {
    return html`<label
        >${t("find_country")}<input
          type="search"
          .value=${this.search}
          @input=${(e: Event) => (this.search = (e.target as HTMLInputElement).value)}
      /></label>
      <div class="stack">
        ${this.game
          .players()
          .filter(
            (p) =>
              p !== this.mine() &&
              p.name().toLowerCase().includes(this.search.toLowerCase()),
          )
          .sort((a, b) => b.numTilesOwned() - a.numTilesOwned())
          .map((p) => {
            const trust = this.game.diplomacy.memory.find(
              (m) => m.a === p.id() && m.b === this.mine()?.id(),
            );
            return html`<article class="card">
              <div class="row">
                <div>
                  <strong>${p.name()}</strong>
                  ${p.isFriendly(this.mine()!) ? html`<span class="badge">${t("agreement")}</span>` : nothing}
                  <div class="muted">
                    ${Math.floor(p.troops()).toLocaleString()} ${t("troops")} ·
                    ${p.numTilesOwned().toLocaleString()} ${t("tiles")}
                  </div>
                  <div class="muted">
                    ${t("trust")}: ${trust?.trust ?? 0} ·
                    ${t("personality_" + diplomaticPersonality(this.game.config().gameConfig().geopoliticsSeed, p.smallID()))}<br />${t("kept")}:
                    ${trust?.kept ?? 0} · ${t("aid")}: ${trust?.aid ?? 0} ·
                    ${t("betrayals")}: ${trust?.betrayal ?? 0}
                  </div>
                </div>
                <button @click=${() => this.newOffer(p)}>
                  ${t("negotiate")}
                </button>
              </div>
            </article>`;
          })}
      </div>`;
  }
  private renderAllies() {
    const id = this.mine()?.id() ?? "";
    const c = this.game.diplomacy.coalitions.find((c) =>
      c.members.includes(id),
    );
    const treaties = this.game.diplomacy.treaties.filter(
      (t) => t.a === id || t.b === id,
    );
    return html`<h3>${t("coalition")} · ${c?.members.length ?? 1}/4</h3>
      ${c?.threat ? html`<p class="muted">${t("common_target")}: ${this.name(c.threat)}</p>` : nothing}
      ${
        c
          ? c.members.map(
              (p) =>
                html`<div class="card row">
                  <span
                    >${this.name(p)}<br /><span class="muted"
                      >${
                        this.game
                          .players()
                          .find((a) => a.id() === p)
                          ?.incomingAttacks().length
                          ? t("under_attack")
                          : t("stable")
                      }</span
                    ></span
                  >${p !== id ? html`<button @click=${() => this.newOffer(this.game.player(p))}>${t("negotiate")}</button><button title=${t("donate_gold")} @click=${() => this.bus.emit(new SendDonateGoldIntentEvent(this.game.player(p), BigInt(Math.floor(Number(this.mine()!.gold()) / 10))))}>${t("gold")} 10%</button><button title=${t("donate_troops")} @click=${() => this.bus.emit(new SendDonateTroopsIntentEvent(this.game.player(p), Math.floor(this.mine()!.troops() / 10)))}>${t("troops")} 10%</button>` : nothing}
                </div>`,
            )
          : html`<p class="muted">${t("coalition_help")}</p>`
      }${treaties.map(
        (a) =>
          html`<div class="card row">
            <span
              >${this.name(a.a === id ? a.b : a.a)} · ${t(a.kind)}<br /><span
                class="muted"
                >${Math.max(0, Math.ceil((a.until - this.game.ticks()) / 10))}s</span
              ></span
            ><button
              class="danger"
              @click=${() => {
                this.target = a.a === id ? a.b : a.a;
                this.tab = "betray";
              }}
            >
              ${t("break")}
            </button>
          </div>`,
      )}${
        c
          ? html`<div class="footer">
                <button
                  @click=${() => this.send({ action: "leave", target: "" })}
                >
                  ${t("leave")}
                </button>
              </div>
              <p class="muted">${t("leave_help")}</p>`
          : nothing
      }`;
  }
  render() {
    if (!this.game || !this.mine()) return nothing;
    const pending = this.pending();
    const v = this.game.diplomacy.victory;
    const me = this.mine()!.id();
    return html`<aside class="launcher">
        <button
          @click=${() => (this.opened = !this.opened)}
          aria-expanded=${this.opened}
        >
          <strong class="gold">${t("title")}</strong>
          <span class="badge">${pending.length}</span><br /><span class="muted"
            >${t("diplomatic_desk")}</span
          ></button
        >${
          v
            ? html`<div class="row">
                  <span>${t("world_control")} ${v.share / 10}%</span
                  ><strong class="countdown">${v.remaining}s</strong>
                </div>
                <progress max="60" value=${60 - v.remaining}></progress>
                <div class="muted">
                  ${v.members.map((p) => this.name(p)).join(" · ")}
                </div>`
            : nothing
        }${
          !this.opened
            ? pending
                .filter((o) => o.from !== me && !o.approvals.includes(me))
                .slice(0, 2)
                .map(
                  (o) =>
                    html`<button
                      style="margin-top:6px"
                      @click=${() => {
                        this.opened = true;
                        this.inspect(o);
                      }}
                    >
                      ${this.name(o.from)} · ${t(o.kind)}
                    </button>`,
                )
            : nothing
        }
      </aside>
      ${
        this.opened
          ? html`<section class="panel" aria-label=${t("title")}>
              <header class="row">
                <div>
                  <div class="muted">FRONTIER</div>
                  <h2>${t("title")}</h2>
                  <div class="muted">${t("subtitle")}</div>
                </div>
                <button
                  aria-label=${t("close")}
                  @click=${() => (this.opened = false)}
                >
                  ✕
                </button>
              </header>
              <nav role="tablist">
                ${["countries", "inbox", "allies", "history"].map(
                  (tab) =>
                    html`<button
                      role="tab"
                      aria-selected=${this.tab === tab}
                      @click=${() => {
                        this.tab = tab;
                      }}
                    >
                      ${t(tab)}${tab === "inbox" ? ` (${pending.length})` : ""}
                    </button>`,
                )}
              </nav>
              <div class="body">
                ${
                  this.tab === "countries"
                    ? this.renderCountries()
                    : this.tab === "negotiate"
                      ? this.renderNegotiation()
                      : this.tab === "allies"
                        ? this.renderAllies()
                        : this.tab === "betray"
                          ? html`<div class="notice">
                                ${t("betray_warning")}
                                <p class="gold">
                                  ${(this.game.diplomacy.coalitions.find((c) => c.members.includes(me) && c.members.includes(this.target))?.members.filter((id) => id !== me) ?? [this.target]).map((id) => this.name(id)).join(" · ")}
                                </p>
                              </div>
                              <div class="footer">
                                <button @click=${() => (this.tab = "allies")}>
                                  ${t("cancel")}</button
                                ><button
                                  class="danger"
                                  @click=${() => {
                                    this.send({
                                      action: "break",
                                      target: this.target,
                                    });
                                    this.tab = "allies";
                                  }}
                                >
                                  ${t("confirm_break")}
                                </button>
                              </div>`
                          : this.tab === "history"
                            ? this.game.diplomacy.log
                                .filter(
                                  (l) => l.actor === me || l.target === me,
                                )
                                .slice()
                                .reverse()
                                .map(
                                  (l) =>
                                    html`<div class="card">
                                      <span class="muted"
                                        >${Math.floor(l.tick / 10)}s</span
                                      >
                                      ${this.name(l.actor)} ·
                                      ${t("event_" + l.event)} ·
                                      ${this.name(l.target)}
                                    </div>`,
                                )
                            : html`${this.notice ? html`<div class="notice">${this.notice}</div>` : nothing}${this.game.diplomacy.offers
                                .filter((o) => o.required.includes(me))
                                .slice()
                                .reverse()
                                .map(
                                  (o) =>
                                    html`<button
                                      class="card row"
                                      style="width:100%;text-align:left"
                                      @click=${() => this.inspect(o)}
                                    >
                                      <span
                                        >${this.name(o.from === me ? o.to : o.from)}<br /><span
                                          class="muted"
                                          >${t(o.kind)} · ${t(o.status)}</span
                                        ></span
                                      ><span class="gold"
                                        >${o.status === "pending" ? Math.max(0, Math.ceil((o.expires - this.game.ticks()) / 10)) + "s" : "→"}</span
                                      >
                                    </button>`,
                                )}`
                }
              </div>
            </section>`
          : nothing
      }`;
  }
  private drawPreview() {
    const canvas = this.renderRoot.querySelector(
      ".preview",
    ) as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!this.previewBase || this.game.ticks() - this.previewTick > 50) {
      this.previewTick = this.game.ticks();
      this.previewBase = document.createElement("canvas");
      this.previewBase.width = Math.min(512, this.game.width());
      this.previewBase.height = Math.max(
        1,
        Math.round(
          (this.game.height() * this.previewBase.width) / this.game.width(),
        ),
      );
      const bc = this.previewBase.getContext("2d")!;
      const w = this.previewBase.width,
        h = this.previewBase.height;
      const data = bc.createImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const ref = this.game.ref(
              Math.floor((x * this.game.width()) / w),
              Math.floor((y * this.game.height()) / h),
            ),
            i = (y * w + x) * 4;
          const owned = this.game.owner(ref).id();
          const land = this.game.isLand(ref);
          const col =
            owned === this.mine()?.id()
              ? [85, 116, 114]
              : owned === this.target
                ? [137, 115, 77]
                : land
                  ? [57, 75, 79]
                  : [14, 32, 47];
          data.data.set([...col, 255], i);
        }
      bc.putImageData(data, 0, 0);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.previewBase, 0, 0, canvas.width, canvas.height);
    const a = this.assets();
    for (const side of ["give", "receive"] as const) {
      ctx.fillStyle = side === "give" ? "#ffd17e" : "#69f0c9";
      for (const ref of a[side].tiles)
        ctx.fillRect(this.game.x(ref), this.game.y(ref), 1, 1);
    }
  }
  private drawOverlay() {
    this.frame = requestAnimationFrame(() => this.drawOverlay());
    const c = this.overlay;
    if (c.width !== innerWidth || c.height !== innerHeight) {
      c.width = innerWidth;
      c.height = innerHeight;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!this.opened || this.tab !== "negotiate") return;
    const a = this.assets();
    for (const side of ["give", "receive"] as const) {
      ctx.fillStyle = side === "give" ? "#ffd17e99" : "#69f0c999";
      for (const run of this.runs(a[side].tiles)) {
        const x = run.x,
          y = run.y,
          p = this.transform.worldToScreenCoordinates(new Cell(x, y)),
          q = this.transform.worldToScreenCoordinates(
            new Cell(x + run.width, y + 1),
          );
        ctx.fillRect(p.x, p.y, q.x - p.x, q.y - p.y);
      }
    }
  }
}
export function mountGeopolitics(
  game: GameView,
  bus: EventBus,
  transform: TransformHandler,
) {
  if (!game.config().gameConfig().geopolitics) return () => {};
  const panel = document.createElement("geopolitics-panel") as GeopoliticsPanel;
  panel.game = game;
  panel.bus = bus;
  panel.transform = transform;
  document.body.append(panel);
  return () => panel.remove();
}
