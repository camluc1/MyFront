import { Cell, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  diplomaticPersonality,
  DiplomacyAction,
  DiplomaticOffer,
  emptyAssets,
  TREATY_TICKS,
  TreatyKind,
} from "@openfront/engine-api/Geopolitics";
import { EventBus } from "@openfront/shared/EventBus";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { TransformHandler, GoToPositionEvent } from "../TransformHandler";
import { PlaySoundEffectEvent } from "../sound/Sounds";
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
  @state() private peaceDuration: 1800 | 3000 = 1800;
  @state() private advancedOpen = false;
  @state() private mapLayer: "relations" | "blocs" | "conflicts" | "assets" = "relations";
  private politicalTick = -1;
  private politicalLayer = "";
  @state() private side: "give" | "receive" = "receive";
  @state() private radius = 3;
  @state() private search = "";
  @state() private buildingType = "all";
  @state() private editing = false;
  @state() private ultimatum = false;
  @state() private threat = "";
  @state() private notice = "";
  @state() private confirmAcceptId: number | null = null;
  @state() private confirmSend = false;
  private observedOffers = new Set<number>();
  private observedDiplomaticMoments = new Set<string>();
  private momentUntil = 0;
  @state() private moment: { tick: number; actor: string; target: string; event: string } | null = null;
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
      font: 15px/1.5 system-ui;
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
    .relation-hostile { color:#ff9d91; border-color:#a74c45; background:#4b211f66; }
    .relation-coalition, .relation-alliance { color:#9be5ad; border-color:#477e60; background:#1b473566; }
    .relation-neutral { color:#c2cbd1; border-color:#526575; }
    .review { margin-top:12px; border:1px solid #b38b54; border-radius:10px; }
    .offer-summary { padding:20px; border:1px solid #486b77; border-radius:18px; background:linear-gradient(140deg,#19313d,#0f202e); box-shadow:0 14px 35px #0005; margin-bottom:16px; }
    .offer-summary .columns { gap:12px; }
    .offer-summary .asset { padding:16px; overflow-wrap:anywhere; min-height:100px; }
    .offer-summary .asset.receive { background:#163b36; border-color:#427664; }
    .offer-summary .asset.give { background:#3a302b; border-color:#816553; }
    .deal-title { font-size:21px; font-weight:800; letter-spacing:.01em; margin:2px 0 4px; }
    .deal-eyebrow { text-transform:uppercase; letter-spacing:.12em; font-size:11px; color:#92bbca; font-weight:800; }
    .deal-duration { font-size:14px; padding:8px 12px; border-radius:10px; color:#f3d9a1; background:#3e382c; }
    .deal-side-label { font-size:14px; font-weight:800; margin-bottom:6px; }
    .deal-summary { color:#e0eff1; line-height:1.55; }
    .deal-impact { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
    .deal-impact span { font-size:12px; border:1px solid #5b787b; border-radius:7px; padding:5px 8px; background:#122c32; }
    .deal-impact strong { color:#f6d79a; }
    .war-context { margin:12px 0; padding:12px 14px; background:#203745; border-radius:12px; }
    .war-track { height:9px; display:flex; border-radius:20px; overflow:hidden; background:#384858; margin:8px 0; }
    .war-track .ours { background:#74ba9b; }
    .war-track .theirs { background:#c87770; flex:1; }
    .treaty-note { padding:10px 12px; background:#193e39; color:#d1ebdf; border-radius:9px; font-size:13px; margin-top:10px; }
    .advanced-editor { margin:12px 0; border:1px solid #435767; border-radius:13px; background:#152939; padding:12px; }
    .advanced-editor summary { cursor:pointer; font-weight:750; font-size:15px; padding:6px 3px; }
    .advanced-editor[open] summary { margin-bottom:14px; }
    .map-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:14px 0 8px; }
    .map-heading h3 { font-size:16px; margin:0; }
    .metric-grid { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
    .metric-chip { font-size:12px; padding:5px 9px; border-radius:8px; background:#283f4a; border:1px solid #3e626b; }
    .metric-chip strong { color:#eac98e; }
    .country-dossier { margin-top:12px; padding:12px; border-radius:10px; background:#203746; border:1px solid #3a5661; }
    .country-dossier .row { gap:12px; align-items:baseline; padding:5px 0; }
    .country-dossier strong { color:#d9e9e9; }
    .country-dossier .muted { font-size:13px; }
    .decision-buttons { display:flex; flex-wrap:wrap; gap:10px; margin-top:12px; }
    .decision-buttons button { flex:1; min-width:140px; padding:11px; font-weight:750; }
    .review .danger { color:#ff9d91; }
    .event-feed { margin-bottom:14px; padding:12px; border:1px solid #3c5965; border-radius:12px; background:#122631; }
    .moment-toast { position:fixed; right:18px; top:180px; width:min(360px,calc(100vw - 36px)); pointer-events:auto; border:1px solid #78b4b0; border-radius:16px; padding:16px; background:linear-gradient(145deg,#1a3f46f5,#142836fa 64%,#17222dfa); box-shadow:0 16px 70px #000a,0 0 30px #3b91852b; backdrop-filter:blur(16px); animation:moment-in .35s ease-out; }
    .moment-toast::before { content:""; position:absolute; inset:0; border-radius:inherit; background:linear-gradient(115deg,transparent 40%,#fff1 52%,transparent 68%); pointer-events:none; }
    .moment-brow { color:#a7e7db; text-transform:uppercase; font-size:10px; letter-spacing:.15em; font-weight:850; }
    .moment-title { font-size:18px; font-weight:800; color:#f4f7f6; margin-top:4px; }
    .moment-detail { color:#c0d4db; font-size:13px; line-height:1.5; margin:8px 0 12px; }
    .moment-controls { display:flex; justify-content:space-between; gap:8px; }
    .moment-controls button { font-size:12px; flex:1; }
    .moment-inline { border-left:3px solid #7ccdb7; padding:10px 14px; background:#21403e; margin:10px 16px 0; border-radius:6px; }
    .event-major { border-left:2px solid #89d8c3; padding:7px 10px !important; background:#1a3840; border-radius:6px; }
    .event-strained { border-left:2px solid #e4ad84; padding:7px 10px !important; background:#3b302f; border-radius:6px; }
    @keyframes moment-in { from { opacity:0; transform:translateY(-12px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
    .event-feed .event { padding:5px 0; border-bottom:1px solid #293f4b; }
    .event-feed .event:last-child { border-bottom:0; }
    .relation-legend { display:flex; flex-wrap:wrap; gap:12px; margin-top:7px; font-size:11px; }
    .legend-friendly { color:#8be0a0; }
    .legend-hostile { color:#ff958b; }
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
      width: min(840px, calc(100vw - 36px));
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
      font-size: 16px;
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
    .geo-map { cursor: default; max-height: 300px; object-fit: contain; }
    .map-legend { display:flex; flex-wrap:wrap; gap:12px; margin:8px 0 14px; color:#b8c8d0; font-size:12px; }
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
      .offer-summary { padding:12px; }
      .deal-title { font-size:19px; }
      .decision-buttons button { min-width:120px; }
      .panel { max-height:calc(100dvh - 155px); }
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
      * { transition: none !important; animation: none !important; }
    }
    @media (max-width:640px) { .moment-toast { top:145px; right:10px; } }
  `;
  /** The diplomatic chronicle generates brief, non-blocking milestone cards.
   * The game's existing sound mixer handles muted/disabled sound settings. */
  private checkDiplomaticMoments() {
    const mine = this.mine();
    if (!mine) return;
    const important = new Set([
      "port_cession", "territorial_cession", "agreement",
      "betrayal", "ally_support", "rival_alarm",
      "territorial_concern", "betrayal_condemned",
    ]);
    const myBloc = this.game.diplomacy.coalitions.find((c) =>
      c.members.includes(mine.id()));
    const involved = new Set(myBloc?.members ?? [mine.id()]);
    const fresh = [];
    for (const event of this.game.diplomacy.log) {
      const key = event.tick + ":" + event.actor + ":" +
        event.target + ":" + event.event;
      if (this.observedDiplomaticMoments.has(key)) continue;
      this.observedDiplomaticMoments.add(key);
      if (important.has(event.event) &&
        (involved.has(event.actor) || involved.has(event.target)))
        fresh.push(event);
    }
    if (this.observedDiplomaticMoments.size > 260)
      this.observedDiplomaticMoments = new Set(
        this.game.diplomacy.log.map((e) =>
          e.tick + ":" + e.actor + ":" + e.target + ":" + e.event));
    if (this.moment && Date.now() >= this.momentUntil) this.moment = null;
    if (!fresh.length) return;
    const priority = (event: string) =>
      event === "port_cession" ? 5 :
      event === "betrayal" ? 4 :
      event === "territorial_cession" ? 3 :
      event === "agreement" ? 2 : 1;
    fresh.sort((a, b) => priority(b.event) - priority(a.event) ||
      b.tick - a.tick);
    this.moment = fresh[0];
    this.momentUntil = Date.now() + 8500;
    const significant = ["port_cession", "betrayal", "agreement"];
    if (significant.includes(this.moment.event) &&
      (this.moment.actor === mine.id() ||
        this.moment.target === mine.id())) {
      this.bus.emit(new PlaySoundEffectEvent(
        this.moment.event === "betrayal" ? "alliance-broken" :
        this.moment.event === "port_cession" ? "conquered" :
        "alliance-accepted"));
    }
  }
  private momentDetail(event: string) {
    return t(event === "port_cession" ? "moment_port_detail" :
      event === "territorial_cession" ? "moment_territory_detail" :
      event === "agreement" ? "moment_agreement_detail" :
      event === "betrayal" ? "moment_betrayal_detail" :
      "moment_reaction_detail");
  }
  private openMomentHistory() {
    this.opened = true;
    this.tab = "history";
    this.moment = null;
  }
  private renderMoment() {
    if (!this.moment) return nothing;
    const moment = this.moment;
    return html`<section class="moment-toast" aria-live="polite" role="status">
      <div class="moment-brow">FRONTIER · ${t("deal_important")}</div>
      <div class="moment-title">${t("moment_headline")}</div>
      <div class="moment-detail">
        <strong>${this.name(moment.actor)}</strong>
        ${t("event_" + moment.event)}
        <strong>${this.name(moment.target)}</strong>.
        ${this.momentDetail(moment.event)}
      </div>
      <div class="moment-controls">
        <button class="primary" @click=${() => this.openMomentHistory()}>${t("moment_open")}</button>
        <button @click=${() => this.moment = null}>${t("moment_close")}</button>
      </div>
    </section>`;
  }

  private onContextDiplomacy = (event: Event) => {
    if (!this.game?.config().gameConfig().geopolitics || !this.mine()) return;
    const detail = (event as CustomEvent<{ target: string; action?: string }>).detail;
    if (!detail?.target) return;
    const target = this.game.players().find((p) => p.id() === detail.target);
    if (!target || target === this.mine() || target.numTilesOwned() <= 0) return;
    this.opened = true;
    if (detail.action === "info") {
      this.search = target.name();
      this.tab = "countries";
    } else if (detail.action === "coalition") {
      this.proposeCoalition(target);
    } else if (detail.action === "demand") {
      this.demandPort(target);
    } else {
      this.newOffer(target);
    }
  };
  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("geopolitics:open-diplomacy", this.onContextDiplomacy);
    this.overlay.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:1099;width:100vw;height:100vh";
    this.overlay.setAttribute("aria-hidden", "true");
    document.body.append(this.overlay);
    const mine = this.mine();
    if (mine) {
      for (const offer of this.game.diplomacy.offers) this.observedOffers.add(offer.id);
      const incoming = this.game.diplomacy.offers
        .filter((o) => o.status === "pending" && o.from !== mine.id() &&
          o.required.includes(mine.id()) && !o.approvals.includes(mine.id()))
        .sort((a, b) => b.created - a.created)[0];
      if (incoming) {
        this.opened = true;
        this.inspect(incoming);
        this.notice = t("incoming_offer_attention");
      }
    }
    this.timer = setInterval(() => {
      const player = this.mine();
      if (player) {
        const incoming = this.game.diplomacy.offers
          .filter((o) => o.status === "pending" && o.from !== player.id() &&
            o.required.includes(player.id()) && !o.approvals.includes(player.id()))
          .sort((a, b) => b.created - a.created);
        const fresh = incoming.find((o) => !this.observedOffers.has(o.id));
        for (const offer of this.game.diplomacy.offers) this.observedOffers.add(offer.id);
        if (fresh) {
          const selectedPending = this.selected !== null &&
            this.game.diplomacy.offers.some(
              (offer) => offer.id === this.selected!.id && offer.status === "pending",
            );
          if (!this.editing && !selectedPending) {
            this.opened = true;
            this.inspect(fresh);
            this.notice = t("incoming_offer_attention");
          } else {
            this.notice = t("new_offer_waiting");
          }
        }
      }
      const feedback = this.game.diplomacy.feedback?.[player?.id() ?? ""];
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
    window.removeEventListener("geopolitics:open-diplomacy", this.onContextDiplomacy);
    clearInterval(this.timer);
    cancelAnimationFrame(this.frame);
    this.overlay.remove();
  }
  protected updated() {
    this.drawPreview();
    this.drawPoliticalMap();
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
    this.confirmSend = false;
    this.confirmAcceptId = null;
    this.peaceDuration = 1800;
    this.advancedOpen = false;
  }
  private proposeCoalition(p: PlayerView) {
    this.newOffer(p);
    this.kind = "coalition";
    this.notice = t("coalition_help");
  }
  private demandPort(p: PlayerView) {
    this.newOffer(p);
    this.kind = "peace";
    const port = p.units().filter((u) => u.type() === UnitType.Port)
      .sort((a, b) => a.id() - b.id())[0];
    if (port) this.toggleExactPort("receive", port.id(), port.tile());
    this.notice = "Exigencia de paz: seleccioná un puerto o territorio que quieras recibir y revisá la propuesta antes de enviarla.";
  }
  private inspect(o: DiplomaticOffer) {
    this.previewBase = null;
    this.selected = o;
    this.peaceDuration = o.durationTicks ?? 1800;
    this.advancedOpen = false;
    this.target = o.from === this.mine()?.id() ? o.to : o.from;
    this.editing = false;
    this.tab = "negotiate";
    this.notice = "";
    this.confirmAcceptId = null;
    this.confirmSend = false;
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
    this.peaceDuration = this.selected.durationTicks ?? 1800;
    this.advancedOpen = true;
    this.threat = this.selected.threat;
    this.ultimatum = false;
    this.counterTo = this.selected.id;
    this.confirmSend = false;
    this.confirmAcceptId = null;
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
  /** Select an operational port and its tile, without accidentally ceding a large region. */
  private toggleExactPort(side: "give" | "receive", unitID: number, tile: number) {
    const current = this[side];
    const selected = current.buildings.includes(unitID);
    const tiles = new Set(current.tiles);
    if (selected) tiles.delete(tile);
    else tiles.add(tile);
    const buildings = this.game.units()
      .filter((u) => structures.has(u.type()) && tiles.has(u.tile()))
      .map((u) => u.id());
    this[side] = {
      ...current,
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
    const heading = this.selected
      ? side === "give"
        ? owner === this.mine()?.id() ? t("you_offer") : `${this.name(owner ?? "")} · ${t("offers")}`
        : owner === this.mine()?.id() ? t("you_would_give") : `${this.name(owner ?? "")} · ${t("would_give")}`
      : t(side);
    return html`<section class="asset ${side}">
      <h3>${heading}</h3>
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
                      if (u.type() === UnitType.Port)
                        this.toggleExactPort(side, u.id(), u.tile());
                      else this.region(u.tile(), side, a.buildings.includes(u.id()));
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
      ${a.buildings.some((id) => this.game.unit(id)?.type() === UnitType.Port)
        ? html`<p class="notice">${t("deal_port_effect")}</p>`
        : nothing}
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
  private relationship(p: PlayerView): string {
    const mine = this.mine();
    if (!mine) return "neutral";
    const active = (attacks: ReturnType<PlayerView["incomingAttacks"]>, attackerID: number) =>
      attacks.some((attack) => attack.attackerID === attackerID && !attack.retreating);
    if (
      active(mine.incomingAttacks(), p.smallID()) ||
      active(p.incomingAttacks(), mine.smallID())
    ) return "hostile";
    if (this.game.diplomacy.coalitions.some(
      (c) => c.members.includes(mine.id()) && c.members.includes(p.id()),
    )) return "coalition";
    const treaty = this.game.diplomacy.treaties.find(
      (t) => t.until > this.game.ticks() &&
        ((t.a === mine.id() && t.b === p.id()) || (t.b === mine.id() && t.a === p.id())),
    );
    return treaty?.kind ?? "neutral";
  }
  private assetSummary(assets: typeof this.give): string {
    const parts: string[] = [];
    if (assets.gold > 0) parts.push(`${assets.gold.toLocaleString()} ${t("gold")}`);
    if (assets.troops > 0) parts.push(`${assets.troops.toLocaleString()} ${t("troops")}`);
    if (assets.tiles.length > 0) parts.push(`${assets.tiles.length.toLocaleString()} ${t("tiles")}`);
    if (assets.buildings.length > 0) {
      const groups = new Map<string, { count: number; levels: number }>();
      for (const id of assets.buildings) {
        const unit = this.game.unit(id);
        if (!unit) continue;
        const key = unit.type();
        const entry = groups.get(key) ?? { count: 0, levels: 0 };
        entry.count++;
        entry.levels += unit.level();
        groups.set(key, entry);
      }
      for (const [type, group] of groups) {
        const label = translateText(`unit_type.${type.toLowerCase().replace(/ /g, "_")}`);
        parts.push(`${group.count} × ${label} · ${t("levels_total")} ${group.levels}`);
      }
    }
    for (const site of this.game.resourceSitesInTiles(assets.tiles)) {
      const resourceName = t("resource_" + site.resource);
      parts.push(`${resourceName} · Q${site.quality}`);
    }
    return parts.length ? parts.join(" · ") : t("no_assets");
  }
  private criticalAssetWarnings(assets: typeof this.give, ownerID: string): string[] {
    const owner = this.game.players().find((p) => p.id() === ownerID);
    if (!owner) return [];
    const critical: [UnitType, string][] = [
      [UnitType.Port, "risk_last_port"],
      [UnitType.City, "risk_last_city"],
      [UnitType.Factory, "risk_last_factory"],
      [UnitType.Farm, "risk_last_farm"],
      [UnitType.Mine, "risk_last_mine"],
      [UnitType.OilWell, "risk_last_oil"],
      [UnitType.GasPlant, "risk_last_gas"],
      [UnitType.SAMLauncher, "risk_last_sam"],
      [UnitType.MissileSilo, "risk_last_silo"],
      [UnitType.DefensePost, "risk_last_defense"],
    ];
    return critical.flatMap(([type, key]) => {
      const owned = this.game.units().filter((u) => u.owner().id() === ownerID && u.type() === type);
      return owned.length > 0 && owned.every((u) => assets.buildings.includes(u.id()))
        ? [t(key)]
        : [];
    });
  }
  private sendDraft() {
    this.send({
      action: "offer",
      target: this.target,
      kind: this.kind,
      give: this.give,
      receive: this.receive,
      counterTo: this.counterTo,
      ultimatum: this.ultimatum,
      threat: this.threat,
      durationTicks: this.kind === "peace" ? this.peaceDuration : undefined,
    });
    this.confirmSend = false;
    this.notice = t("sent");
    this.editing = false;
    this.tab = "inbox";
  }

  /** Exact, contextual impact percentages: share of the owner's assets in this offer. */
  private renderRegionImpact(assets: typeof this.give, ownerID: string) {
    const owner = this.game.players().find((p) => p.id() === ownerID);
    if (!owner) return nothing;
    const owned = owner.units();
    const selected = new Set(assets.buildings);
    const labels: [UnitType, string][] = [
      [UnitType.Port, t("deal_pct_ports")], [UnitType.City, t("deal_pct_cities")],
      [UnitType.Mine, t("deal_pct_mines")], [UnitType.OilWell, t("deal_pct_oil")],
      [UnitType.GasPlant, t("deal_pct_gas")], [UnitType.Factory, t("deal_pct_factories")],
      [UnitType.Farm, t("deal_pct_farms")], [UnitType.DefensePost, t("deal_pct_defense")],
      [UnitType.SAMLauncher, t("deal_pct_sam")], [UnitType.MissileSilo, t("deal_pct_silos")],
    ];
    const percent = (n: number, total: number) =>
      total > 0 ? Math.min(100, Math.round(n * 1000 / total) / 10) : 0;
    const impacts = labels.flatMap(([type, label]) => {
      const total = owned.filter((u) => u.type() === type && u.isActive()).length;
      const count = owned.filter((u) => u.type() === type && u.isActive() &&
        selected.has(u.id())).length;
      return count ? [{ label, count, pct: percent(count, total) }] : [];
    });
    const deposits = this.game.resourceSitesInTiles(assets.tiles);
    return html`<div class="metric-grid" aria-label="Impacto comprobable sobre los activos del país">
      ${assets.tiles.length > 0 ? html`<span class="metric-chip">
        ${t("deal_pct_territory")}: <strong>${percent(assets.tiles.length, owner.numTilesOwned())}%</strong>
        · ${assets.tiles.length.toLocaleString()} ${t("deal_tiles")}
      </span>` : nothing}
      ${assets.gold > 0 ? html`<span class="metric-chip">
        ${t("deal_pct_gold")}: <strong>${percent(assets.gold, Number(owner.gold()))}%</strong>
      </span>` : nothing}
      ${assets.troops > 0 ? html`<span class="metric-chip">
        ${t("deal_pct_troops")}: <strong>${percent(assets.troops, owner.troops())}%</strong>
      </span>` : nothing}
      ${impacts.map((item) => html`<span class="metric-chip">
        ${item.label}: <strong>${item.pct}%</strong> · ${item.count}
      </span>`)}
      ${deposits.slice(0, 4).map((site) => html`<span class="metric-chip">
        ${t("resource_" + site.resource)} · Q${site.quality}
      </span>`)}
      ${deposits.length > 4 ? html`<span class="metric-chip">+${deposits.length - 4} ${t("deal_pct_sites")}</span>` : nothing}
    </div>`;
  }

  /** Diplomacy must read from the current player's perspective, including coalition votes. */
  private renderDealOverview(o: DiplomaticOffer | null) {
    const myID = this.mine()?.id() ?? "";
    const thirdParty = o !== null && o.from !== myID && o.to !== myID;
    const from = o?.from ?? myID;
    const to = o?.to ?? this.target;
    const incoming = o
      ? (o.to === myID ? o.give : o.receive)
      : this.receive;
    const outgoing = o
      ? (o.to === myID ? o.receive : o.give)
      : this.give;
    const incomingOwner = o ? (o.to === myID ? o.from : o.to) : to;
    const outgoingOwner = o ? (o.to === myID ? o.to : o.from) : from;
    const incomingTitle = thirdParty ? this.name(o!.from) + t("deal_receives") : t("deal_get");
    const outgoingTitle = thirdParty ? this.name(o!.to) + t("deal_receives") : t("deal_give");
    const duration = (o?.kind ?? this.kind) === "peace"
      ? (o?.durationTicks ?? this.peaceDuration)
      : TREATY_TICKS[o?.kind ?? this.kind];
    const own = this.mine();
    const rival = this.game.players().find((p) => p.id() === this.target);
    const ours = Math.max(0, own?.troops() ?? 0);
    const theirs = Math.max(0, rival?.troops() ?? 0);
    const share = Math.round(100 * ours / Math.max(1, ours + theirs));
    const activeOffensive = !!own && !!rival &&
      (own.incomingAttacks().some((a) => a.attackerID === rival.smallID() && !a.retreating) ||
       rival.incomingAttacks().some((a) => a.attackerID === own.smallID() && !a.retreating));
    const entitled = !!o && o.required.includes(myID) && !o.approvals.includes(myID);
    return html`<section class="offer-summary" aria-label="Consejo diplomático: resumen claro del tratado">
      <div class="row wrap">
        <div>
          <div class="deal-eyebrow">FRONTIER · ${t("deal_desk")}</div>
          <div class="deal-title">${o ? this.name(o.from) + t("deal_proposes") : t("deal_you_propose")}${t(o?.kind ?? this.kind)}</div>
          <div class="muted">${this.name(from)} ↔ ${this.name(to)}</div>
        </div>
        <div class="deal-duration">${Math.round(duration / 600)} ${t((o?.kind ?? this.kind) === "peace" ? "deal_peace_minutes" : "deal_treaty_minutes")}</div>
      </div>
      ${this.editing && this.kind === "peace" ? html`<label style="max-width:270px;margin-top:10px">
        ${t("deal_peace_duration")}
        <select aria-label="Duración de la paz" .value=${String(this.peaceDuration)}
          @change=${(e: Event) => this.peaceDuration =
            Number((e.target as HTMLSelectElement).value) === 3000 ? 3000 : 1800}>
          <option value="1800">${t("deal_three_minutes")}</option>
          <option value="3000">${t("deal_five_minutes")}</option>
        </select>
      </label>` : nothing}
      ${o?.kind === "coalition" ? html`<div class="treaty-note">
        ${t("deal_block_approvals")}: ${o.approvals.length}/${o.required.length}.
        ${o.required.map((id) => html`<span class="badge">
          ${o.approvals.includes(id) ? "✓" : "…" } ${this.name(id)}
        </span>`)}
        ${thirdParty ? html`<p>${t("deal_block_vote")}</p>` : nothing}
      </div>` : nothing}
      <div class="war-context">
        <div class="row"><strong>${t("deal_military")}</strong><span class="muted">
          ${activeOffensive ? t("deal_active") : t("deal_inactive")}
        </span></div>
        <div class="war-track" role="img" aria-label="Proporción de tropas en reserva entre tu país y el otro país">
          <span class="ours" style="width:${share}%"></span>
          <span class="theirs"></span>
        </div>
        <div class="row muted">
          <span>${t("deal_reserves_yours")}: ${Math.floor(ours).toLocaleString()}</span>
          <span>${t("deal_reserves_rival")}: ${Math.floor(theirs).toLocaleString()}</span>
        </div>
      </div>
      <div class="columns">
        <div class="asset receive">
          <div class="deal-side-label">↓ ${incomingTitle}</div>
          <div class="deal-summary">${this.assetSummary(incoming)}</div>
          ${this.renderRegionImpact(incoming, incomingOwner)}
        </div>
        <div class="asset give">
          <div class="deal-side-label">↑ ${outgoingTitle}</div>
          <div class="deal-summary">${this.assetSummary(outgoing)}</div>
          ${this.renderRegionImpact(outgoing, outgoingOwner)}
        </div>
      </div>
      <p class="muted" style="margin-top:8px">${t("deal_pct_explainer")}</p>
      ${(o?.kind ?? this.kind) === "peace" ? html`<div class="treaty-note">
        ${t("deal_peace_effect")}
        ${Math.round(duration / 600)} ${t("deal_peace_effect_end")}
      </div>` : nothing}
      ${o?.reason && o.status === "pending" ? html`<p class="muted" style="margin-top:10px">
        ${t("deal_stance")}: ${t("reason_" + o.reason)}
      </p>` : nothing}
      ${o && entitled && o.status === "pending" ? html`<div class="decision-buttons">
        <button class="danger" @click=${() => this.send({
          action: "reject", target: o.from === myID ? o.to : o.from, offerID: o.id
        })}>${t("deal_reject")}</button>
        ${o.to === myID ? html`<button @click=${() => this.counter()}>${t("deal_counter")}</button>` : nothing}
        <button class="primary" @click=${() => (this.confirmAcceptId = o.id)}>${t("deal_review_accept")}</button>
      </div>` : nothing}
      ${o && o.from === myID && o.status === "pending" ? html`<div class="decision-buttons">
        <button @click=${() => this.send({ action:"withdraw", target:o.to, offerID:o.id })}>${t("deal_withdraw")}</button>
      </div>` : nothing}
      ${this.confirmAcceptId === o?.id && o?.status === "pending" ? html`<div class="notice review">
        <strong>${t("deal_confirm_title")} ${t(o.kind)}</strong>
        ${this.criticalAssetWarnings(outgoing, outgoingOwner).map((warning) =>
          html`<p class="danger">${warning}</p>`)}
        <div class="footer"><button @click=${() => this.confirmAcceptId = null}>${t("deal_cancel")}</button>
          <button class="primary" @click=${() => {
            this.send({ action:"accept", target:o.from === myID ? o.to : o.from, offerID:o.id });
            this.confirmAcceptId = null;
          }}>${t("deal_confirm")}</button>
        </div>
      </div>` : nothing}
      ${this.editing ? html`<div class="decision-buttons">
        <button @click=${() => this.advancedOpen = !this.advancedOpen}>${t("deal_edit")}</button>
        <button class="primary" @click=${() => this.confirmSend = true}>${t("deal_review")}</button>
      </div>` : nothing}
      ${this.confirmSend && this.editing ? html`<div class="notice review">
        <strong>${t("deal_send_question")}</strong>
        <p>${t("deal_other_gets")} ${this.assetSummary(this.give)}</p>
        <p>${t("deal_you_request")} ${this.assetSummary(this.receive)}</p>
        ${[...this.criticalAssetWarnings(this.give, myID),
          ...this.criticalAssetWarnings(this.receive, this.target)].map((warning) =>
          html`<p class="danger">${warning}</p>`)}
        <div class="footer">
          <button @click=${() => this.confirmSend = false}>${t("deal_back")}</button>
          <button class="primary" @click=${() => this.sendDraft()}>${t("deal_confirm_send")}</button>
        </div>
      </div>` : nothing}
    </section>`;
  }

  private renderNegotiation() {
    const o = this.selected
      ? (this.game.diplomacy.offers.find((offer) => offer.id === this.selected!.id) ??
         this.selected)
      : null;
    if (!this.editing && !o)
      return html`<p class="empty">${t("choose_country")}</p>`;
    return html`
      ${this.renderDealOverview(o)}
      <section class="card" aria-label="Mapa de las cesiones territoriales">
        <div class="map-heading">
          <h3>${t("deal_territory_map")}</h3>
          <span class="badge">${t("deal_exact_transfer")}</span>
        </div>
        <p class="muted">${t("deal_map_help")}</p>
        ${this.editing ? html`<div class="row wrap" style="margin:12px 0">
          <label style="min-width:160px">${t("deal_select_owner")}
            <select aria-label="País al que pertenece la zona seleccionada"
              .value=${this.side}
              @change=${(e: Event) => this.side =
                (e.target as HTMLSelectElement).value as "give" | "receive"}>
              <option value="receive">${t("deal_rival_land")}</option>
              <option value="give">${t("deal_my_land")}</option>
            </select>
          </label>
          <label style="min-width:180px;flex:1">
            ${t("deal_radius")}: ${this.radius === 0 ? t("deal_exact_tile") : this.radius + " " + t("deal_tiles")}
            <input type="range" min="0" max="40" .value=${String(this.radius)}
              @input=${(e: Event) => this.radius = Number((e.target as HTMLInputElement).value)}/>
          </label>
          <button @click=${() => this.radius = 0}>${t("deal_pin")}</button>
        </div>` : nothing}
        <canvas class="preview" width=${this.game.width()} height=${this.game.height()}
          aria-label="Mapa editable con el territorio que se entrega y se recibe"
          @click=${(e: MouseEvent) => {
            if (!this.editing) return;
            const c = e.currentTarget as HTMLCanvasElement;
            const r = c.getBoundingClientRect();
            const x = Math.min(this.game.width() - 1,
              Math.max(0, Math.floor((e.clientX - r.left) * this.game.width() / r.width)));
            const y = Math.min(this.game.height() - 1,
              Math.max(0, Math.floor((e.clientY - r.top) * this.game.height() / r.height)));
            this.region(this.game.ref(x, y), this.side);
          }}></canvas>
        <div class="map-legend">
          <span>🟩 ${o && o.from !== this.mine()?.id() && o.to !== this.mine()?.id() ? this.name(o.from) + t("deal_receives") : t("deal_receive_map")}</span>
          <span>🟨 ${o && o.from !== this.mine()?.id() && o.to !== this.mine()?.id() ? this.name(o.to) + t("deal_receives") : t("deal_give_map")}</span>
          <span>${t("deal_legend")}</span>
        </div>
        ${this.editing ? html`<div class="row wrap">
          <button @click=${() => this.clear("receive")}>${t("deal_clear_request")}</button>
          <button @click=${() => this.clear("give")}>${t("deal_clear_offer")}</button>
        </div>` : nothing}
      </section>
      <details class="advanced-editor" ?open=${this.advancedOpen}
        @toggle=${(e: Event) => this.advancedOpen =
          (e.currentTarget as HTMLDetailsElement).open}>
        <summary>${this.editing
          ? t("deal_advanced")
          : t("deal_full_details")}</summary>
        ${this.editing ? html`
          <label class="building"><input type="checkbox"
            .checked=${this.ultimatum}
            @change=${(e: Event) => this.ultimatum =
              (e.target as HTMLInputElement).checked}/>
            ${t("ultimatum_help")}
          </label>
          <label>${t("deal_type")}
            <select aria-label="Tipo de tratado" .value=${this.kind}
              @change=${(e: Event) => this.kind =
                (e.target as HTMLSelectElement).value as TreatyKind}>
              ${(["truce","nonaggression","alliance","coalition","peace"] as TreatyKind[])
                .map((k) => html`<option value=${k}>${t(k)}</option>`)}
            </select>
          </label>
          ${this.kind === "coalition" ? html`<label>
            ${t("common_target")}
            <select .value=${this.threat}
              @change=${(e: Event) => this.threat =
                (e.target as HTMLSelectElement).value}>
              <option value="">${t("no_target")}</option>
              ${this.game.players().filter((p) =>
                p !== this.mine() && p.id() !== this.target && p.numTilesOwned() > 0)
                .map((p) => html`<option value=${p.id()}>${p.name()}</option>`)}
            </select>
          </label>` : nothing}
          ${this.counterTo === undefined ? html`<div class="row wrap">
            ${(["survival","infrastructure","aid","pressure"] as const).map(
              (kind) => html`<button @click=${() => this.approach(kind)}>
                ${t("approach_" + kind)}</button>`)}
          </div>` : nothing}
        ` : nothing}
        <div class="columns">
          ${this.renderAssets("give")}
          ${this.renderAssets("receive")}
        </div>
        <p class="muted">${t("preview_help")}</p>
      </details>
      ${o ? html`<p class="notice" role="status">
        ${t("reason_" + o.reason)} · ${t("effect_" + o.kind)}
      </p>` : nothing}
      ${this.notice ? html`<p role="status" class="notice">${this.notice}</p>` : nothing}
      <div class="footer">
        ${this.editing ? html`
          <button @click=${() => { this.editing = false; this.tab = "countries"; }}>${t("deal_cancel")}</button>
          <button class="primary" @click=${() => {
            this.confirmSend = true;
            this.renderRoot.querySelector(".offer-summary")?.scrollIntoView({ behavior:"smooth", block:"start" });
          }}>${t("deal_review_send")}</button>
        ` : html`<button @click=${() => this.tab = "countries"}>${t("deal_back_countries")}</button>`}
      </div>
    `;
  }
  private renderRecentEvents() {
    const recent = this.game.diplomacy.log.slice(-5).reverse();
    return recent.length ? html`<section class="event-feed">
      <h3>${t("recent_diplomacy")}</h3>
      ${recent.map((event) => html`<div class="event"><span class="muted">${Math.floor(event.tick / 10)}s</span> · <strong>${this.name(event.actor)}</strong> ${t("event_" + event.event)} ${event.target ? "· " + this.name(event.target) : ""}</div>`)}
    </section>` : nothing;
  }
  private renderPoliticalLayers() {
    const legends: Record<typeof this.mapLayer, string> = {
      relations: "Verde: aliados · Rojo: enemigos · Gris: neutrales",
      blocs: "Cada bloque comparte color; las naciones independientes quedan grises",
      conflicts: "Rojo: países en guerra con vos · Naranja: conflictos activos",
      assets: "Puntos celestes: puertos · Amarillos: infraestructura estratégica",
    };
    return html`<section class="card" aria-label="Mapa geopolítico">
      <div class="row wrap"><h3>Mapa geopolítico</h3>
        <select aria-label="Capa geopolítica" style="width:auto"
          .value=${this.mapLayer}
          @change=${(e: Event) => {
            this.mapLayer = (e.target as HTMLSelectElement).value as typeof this.mapLayer;
            this.politicalTick = -1;
          }}>
          <option value="relations">Relaciones</option>
          <option value="blocs">Bloques de poder</option>
          <option value="conflicts">Conflictos</option>
          <option value="assets">Activos estratégicos</option>
        </select></div>
      <canvas class="preview geo-map" width="512"
        height=${Math.max(1, Math.round(512 * this.game.height() / this.game.width()))}
        aria-label="Mapa político de países, coaliciones, conflictos y activos"></canvas>
      <div class="map-legend">${legends[this.mapLayer]}</div>
      ${this.mapLayer === "blocs" ? html`<div class="stack">${this.game.diplomacy.coalitions.map((c, index) => html`<div class="row"><span>Bloque ${index + 1}: ${c.members.map((id) => this.name(id)).join(" · ")}</span><span class="gold">${c.members.length} miembros</span></div>`)}</div>` : nothing}
    </section>`;
  }
  private drawPoliticalMap() {
    if (!this.opened || this.tab !== "countries") return;
    const canvas = this.renderRoot.querySelector(".geo-map") as HTMLCanvasElement | null;
    if (!canvas || (this.politicalLayer === this.mapLayer &&
      this.game.ticks() - this.politicalTick < 50)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    const data = ctx.createImageData(w, h);
    const me = this.mine()?.id() ?? "";
    const blocColors = ["#56c9ac", "#e9a75f", "#9e9af6", "#e478a2", "#60b1e8"];
    const blocs = new Map<string, string>();
    this.game.diplomacy.coalitions.forEach((c, i) =>
      c.members.forEach((id) => blocs.set(id, blocColors[i % blocColors.length])));
    const relations = new Map<string, string>();
    const opponents = new Set<string>();
    const combatants = new Set<string>();
    for (const p of this.game.players()) {
      const relation = this.relationship(p);
      relations.set(p.id(), relation === "hostile" ? "#c75b57" :
        relation === "coalition" || relation === "alliance" ? "#5fbb8a" :
        relation === "truce" || relation === "peace" || relation === "nonaggression"
          ? "#8cbeae" : "#687782");
      if (relation === "hostile") opponents.add(p.id());
      if (p.incomingAttacks().some((attack) => !attack.retreating)) combatants.add(p.id());
    }
    const color = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const palette = new Map<string, number[]>();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const tile = this.game.ref(
        Math.min(this.game.width() - 1, Math.floor(x * this.game.width() / w)),
        Math.min(this.game.height() - 1, Math.floor(y * this.game.height() / h)));
      const i = (y * w + x) * 4;
      let hex = "#102f42";
      if (this.game.isLand(tile)) {
        const id = this.game.owner(tile).id();
        if (id === me) hex = "#b9dec2";
        else if (this.mapLayer === "blocs") hex = blocs.get(id) ?? "#55636d";
        else if (this.mapLayer === "relations") hex = relations.get(id) ?? "#55636d";
        else if (this.mapLayer === "conflicts") hex = opponents.has(id) ? "#d45b57" :
          combatants.has(id) ? "#d39b54" : "#55636d";
        else hex = "#536872";
      }
      let rgb = palette.get(hex);
      if (!rgb) { rgb = color(hex); palette.set(hex, rgb); }
      data.data[i] = rgb[0]; data.data[i + 1] = rgb[1];
      data.data[i + 2] = rgb[2]; data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    if (this.mapLayer === "assets") {
      for (const u of this.game.units()) {
        if (!structures.has(u.type())) continue;
        const isPort = u.type() === UnitType.Port;
        if (!isPort && ![UnitType.City, UnitType.Factory, UnitType.MissileSilo,
          UnitType.Mine, UnitType.OilWell, UnitType.GasPlant].includes(u.type())) continue;
        ctx.fillStyle = isPort ? "#76e3ff" : "#f2cc72";
        ctx.fillRect(Math.floor(this.game.x(u.tile()) * w / this.game.width()) - 1,
          Math.floor(this.game.y(u.tile()) * h / this.game.height()) - 1, 3, 3);
      }
    }
    this.politicalTick = this.game.ticks();
    this.politicalLayer = this.mapLayer;
  }

  /** Country dossier: right-click opens this focused, readable treaty record. */
  private renderCountryTreaties(p: PlayerView) {
    const mine = this.mine();
    if (!mine) return nothing;
    const now = this.game.ticks();
    const pact = this.game.diplomacy.treaties.find((tr) =>
      tr.until > now && ((tr.a === p.id() && tr.b === mine.id()) ||
        (tr.b === p.id() && tr.a === mine.id())));
    const coalition = this.game.diplomacy.coalitions.find((c) =>
      c.members.includes(p.id()));
    const related = this.game.diplomacy.offers.filter((o) =>
      o.status === "pending" &&
      (o.from === p.id() || o.to === p.id()) &&
      (o.from === mine.id() || o.to === mine.id()));
    return html`<div class="country-dossier" aria-label="Tratados y situación de ${p.name()}">
      <div class="deal-eyebrow">${t("deal_treaties")}</div>
      <div class="row">
        <span>${t("deal_current_relation")}</span><strong>${t("relation_" + this.relationship(p))}</strong>
      </div>
      <div class="row">
        <span>${t("deal_bilateral")}</span>
        <strong>${pact ? t(pact.kind) + " · " +
          Math.ceil((pact.until - now) / 10) + " segundos restantes" : t("deal_no_treaty")}</strong>
      </div>
      <div class="row">
        <span>${t("deal_power_bloc")}</span>
        <strong>${coalition ? coalition.members.map((id) => this.name(id)).join(" · ") :
          t("deal_independent")}</strong>
      </div>
      ${coalition ? html`<div class="muted">
        ${t("deal_remaining")}: ${Math.ceil((coalition.until - now) / 10)} s
        ${coalition.threat ?  " · " + t("deal_target") + ": "  + this.name(coalition.threat) : ""}
      </div>` : nothing}
      ${related.map((o) => html`<button
        @click=${() => this.inspect(o)}
        style="margin-top:8px">
        ${t("deal_pending_offer")}: ${t(o.kind)} · ${t("deal_view_terms")}
      </button>`)}
      <p class="muted">${t("deal_country_tip")}</p>
    </div>`;
  }
  private renderCountries() {
    return html`${this.renderPoliticalLayers()}${this.renderRecentEvents()}<label
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
                  <span class="badge relation-${this.relationship(p)}">${t("relation_" + this.relationship(p))}</span>
                  <div class="muted">
                    ${Math.floor(p.troops()).toLocaleString()} ${t("troops")} ·
                    ${p.numTilesOwned().toLocaleString()} ${t("tiles")}
                  </div>
                  <div class="muted">
                    ${Number(p.gold()).toLocaleString()} ${t("gold")} ·
                    ${p.units().filter((u) => structures.has(u.type())).length} ${t("buildings")}
                  </div>
                  <div class="muted">
                    ${t("trust")}: ${trust?.trust ?? 0} ·
                    ${t("personality_" + diplomaticPersonality(this.game.config().gameConfig().geopoliticsSeed, p.smallID()))}<br />${t("kept")}:
                    ${trust?.kept ?? 0} · ${t("aid")}: ${trust?.aid ?? 0} ·
                    ${t("betrayals")}: ${trust?.betrayal ?? 0}
                  </div>
                </div>
                <div class="stack">
                  <button @click=${() => this.newOffer(p)}>${t("negotiate")}</button>
                  <button @click=${() => this.proposeCoalition(p)}>Proponer coalición</button>
                  <button @click=${() => this.demandPort(p)}>Exigir territorio / puerto</button>
                </div>
              </div>
              ${this.renderCountryTreaties(p)}
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
      (t) => (t.a === id || t.b === id) && t.kind !== "coalition",
    );
    return html`<h3>${t("coalition")} · ${c?.members.length ?? 0}/4</h3>
      <p class="muted">Podés crear un bloque desde Países → Proponer coalición. Las alianzas se acuerdan entre naciones, no se crean automáticamente.</p>
      <div class="footer"><button @click=${() => (this.tab = "countries")}>Buscar aliados y proponer coalición</button></div>
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
                  >${p !== id ? html`<button @click=${() => this.newOffer(this.game.player(p))}>${t("negotiate")}</button><button class="danger" @click=${() => {
                    this.target = p;
                    this.tab = "betray";
                  }}>Romper coalición</button><button title=${t("donate_gold")} @click=${() => this.bus.emit(new SendDonateGoldIntentEvent(this.game.player(p), BigInt(Math.floor(Number(this.mine()!.gold()) / 10))))}>${t("gold")} 10%</button><button title=${t("donate_troops")} @click=${() => this.bus.emit(new SendDonateTroopsIntentEvent(this.game.player(p), Math.floor(this.mine()!.troops() / 10)))}>${t("troops")} 10%</button>` : nothing}
                </div>`,
            )
          : html`<p class="muted">${t("coalition_help")}</p>`
      }${treaties.length ? html`<h3>${t("bilateral_treaties")}</h3>` : nothing}${treaties.map(
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
                  @click=${() => {
                    if (window.confirm("¿Abandonar la coalición? Perderás confianza y habrá un período de enfriamiento."))
                      this.send({ action: "leave", target: "" });
                  }}
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
                  <div class="relation-legend">
                    <span class="legend-friendly">● ${t("relation_legend_friendly")}</span>
                    <span class="legend-hostile">● ${t("relation_legend_hostile")}</span>
                  </div>
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
    const flipped = !this.editing && this.selected?.to === this.mine()?.id();
    for (const side of ["give", "receive"] as const) {
      ctx.fillStyle = (side === "give") !== flipped ? "#ffd17e" : "#69f0c9";
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
    const flipped = !this.editing && this.selected?.to === this.mine()?.id();
    for (const side of ["give", "receive"] as const) {
      ctx.fillStyle = (side === "give") !== flipped ? "#ffd17e99" : "#69f0c999";
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
