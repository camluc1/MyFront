import type { ResourceEconomyInfo } from "@openfront/engine-api/game/GameTypes";
import {
  BuildableUnit,
  BuildMenus,
  Gold,
  maxBulkAmount,
  PlayerBuildableUnitType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { renderNumber } from "@openfront/engine-lib/Format";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { ToggleResourcesEvent } from "../../controllers/MapLayerController";
import { ResourceEconomyPreviewEvent } from "../../controllers/ResourceEconomyPreview";
import {
  InputHandler,
  ToggleStructureEvent,
  TouchGhostPlacementSelectEvent,
  highlightTypesForUnit,
  isForwardedTouchClick,
} from "../../InputHandler";
import { KeyboardLayoutController } from "../../KeyboardLayout";
import { Platform } from "../../Platform";
import { UIState } from "../../UIState";
import {
  KEYBINDS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../UserSettings";
import { resolveKeybindLabel, translateText } from "../../Utils";
import { GameView } from "../../view";
import {
  atomBombIcon,
  cityIcon,
  defensePostIcon,
  castleIcon,
  ironDomeIcon,
  factoryIcon,
  goldCoinIcon,
  hydrogenBombIcon,
  mirvIcon,
  missileSiloIcon,
  portIcon,
  samLauncherIcon,
  repairCarrierIcon,
  warshipIcon,
} from "../HotbarIcons";
import { TutorialHighlight, TutorialHighlightEvent } from "../Tutorial";
import { renderResourceEconomy } from "./ResourceEconomyDetails";

/** How long a build button has to be held before it shows its details (cost etc.) */
const farmIcon = assetUrl("images/FarmIconWhite.svg");
const mineIcon = assetUrl("images/MineIconWhite.svg");
const oilWellIcon = assetUrl("images/OilWellIconWhite.svg");
const gasPlantIcon = assetUrl("images/GasPlantIconWhite.svg");
const shipyardIcon = assetUrl("images/ShipyardIconWhite.svg");
const PEEK_HOLD_MS = 450;
/** How long the details stay up after the browser cancels the touch itself. */
const PEEK_GRACE_MS = 1200;
type BuildCategory = "economy" | "defense" | "naval" | "arsenal";
const BUILD_CATEGORIES: ReadonlyArray<{
  id: Exclude<BuildCategory, "arsenal">;
  label: string;
  types: readonly PlayerBuildableUnitType[];
}> = [
  { id: "economy", label: "Economía", types: [UnitType.City, UnitType.Factory, UnitType.Farm, UnitType.Mine, UnitType.OilWell, UnitType.GasPlant] },
  { id: "defense", label: "Defensa", types: [UnitType.DefensePost, UnitType.MissileSilo, UnitType.SAMLauncher, UnitType.Castle, UnitType.IronDome] },
  { id: "naval", label: "Naval", types: [UnitType.Port, UnitType.Warship, UnitType.Shipyard, UnitType.Bismarck] },
];

@customElement("unit-display")
export class UnitDisplay extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  public inputHandler: InputHandler;
  private playerBuildables: BuildableUnit[] | null = null;
  // The resource toggle remains visible above the responsive build grid.
  @state() private resourcesVisible = false;
  @state() private activeBuildCategory: BuildCategory = "economy";
  @state() private resourceEconomy: ResourceEconomyInfo | null = null;

  private toggleResources(): void {
    this.resourcesVisible = !this.resourcesVisible;
    this.eventBus.emit(new ToggleResourcesEvent(this.resourcesVisible));
  }
  // This must be the effective map (defaults + user remaps), not just saved
  // overrides. Otherwise Farm/Mine/Oil/Gas and new defenses show no badges.
  private keybinds: Record<string, string> = {};

  private refreshBuildHotkeys = () => {
    this.keybinds = new UserSettings().keybinds(Platform.isMac);
    this.requestUpdate();
  };
  private keyboardLayout = new KeyboardLayoutController(this);
  private _cities = 0;
  private _warships = 0;
  private _factories = 0;
  private _farms = 0;
  private _mines = 0;
  private _oilWells = 0;
  private _gasPlants = 0;
  private _missileSilo = 0;
  private _port = 0;
  private _shipyard = 0;
  private _defensePost = 0;
  private _castle = 0;
  private _ironDome = 0;
  private _samLauncher = 0;
  private allDisabled = false;
  private enabledUnitCount = 0;
  private tutorialMode = false;
  private _hoveredUnitTooltip: {
    unitType: PlayerBuildableUnitType;
    structureKey: string;
    hotkey: string;
    element: HTMLElement;
  } | null = null;
  /**
   * The unit the player is holding down. A touch device has no hover, so a
   * press-and-hold is how the cost and description are read before the unit
   * is picked.
   */
  private _peekedUnitTooltip: {
    unitType: PlayerBuildableUnitType;
    structureKey: string;
    hotkey: string; //touch device may still have a keyboard
    element: HTMLElement;
  } | null = null;
  private peekTimer: ReturnType<typeof setTimeout> | null = null;
  private peekGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressNextClick = false;
  // Keep the hold's release click suppressed, but not a later physical click.
  private suppressReleaseClick = false;
  private lastTouchClickItem: HTMLElement | null = null;
  private peekPointerId: number | null = null;
  private peekTouchIdentifier: number | null = null;
  private activeTouchIdentifiers = new Set<number>();
  // Where the tooltip is centred, in the bar's own coordinates.
  private _tooltipCenter: number | null = null;
  private tutorialHighlight: PlayerBuildableUnitType | null = null;
  // Whether the build bar has actions hidden off either edge. The fade on that
  // edge tells the player there is more to swipe to.
  private moreActionsLeft = false;
  private moreActionsRight = false;
  private observedScroller: HTMLElement | null = null;
  private windowListenersAttached = false;
  private lastHasKeyboard = Platform.hasKeyboard;

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(ResourceEconomyPreviewEvent, (event) => {
      this.resourceEconomy = event.info;
    });
    const config = this.game.config();
    this.refreshBuildHotkeys();

    this.tutorialMode = config.gameConfig().tutorial ?? false;
    // The dock can stack on small screens while the radial menu also builds, but
    // the onboarding tutorial fires its atom bomb from here on every screen.
    if (this.tutorialMode) this.classList.remove("hidden");

    this.enabledUnitCount = BuildMenus.types.filter((unitType) =>
      this.isUnitDisplayed(unitType),
    ).length;
    this.allDisabled = this.enabledUnitCount === 0;

    const highlightUnits: Partial<
      Record<TutorialHighlight, PlayerBuildableUnitType>
    > = {
      city: UnitType.City,
      port: UnitType.Port,
      defense_post: UnitType.DefensePost,
      factory: UnitType.Factory,
      warship: UnitType.Warship,
      silo: UnitType.MissileSilo,
      atom: UnitType.AtomBomb,
      hydrogen: UnitType.HydrogenBomb,
      mirv: UnitType.MIRV,
      sam: UnitType.SAMLauncher,
    };
    this.eventBus.on(TutorialHighlightEvent, (e) => {
      this.tutorialHighlight = (e.target && highlightUnits[e.target]) ?? null;
      this.requestUpdate();
    });
    this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.windowListenersAttached) return;
    window.addEventListener("resize", this.onLayoutChange);
    window.addEventListener("keydown", this.handleKeyboardDetection);
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${KEYBINDS_KEY}`,
      this.refreshBuildHotkeys,
    );
    document.addEventListener("pointerdown", this.handleDocumentPointerDown);
    document.addEventListener("pointerup", this.handleDocumentPointerUp);
    document.addEventListener(
      "pointercancel",
      this.handleDocumentPointerCancel,
    );
    document.addEventListener("touchstart", this.handlePeekTouchEvent, true);
    document.addEventListener("touchend", this.handlePeekTouchEvent, true);
    document.addEventListener("touchcancel", this.handlePeekTouchEvent, true);
    this.windowListenersAttached = true;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("resize", this.onLayoutChange);
    window.removeEventListener("keydown", this.handleKeyboardDetection);
    window.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${KEYBINDS_KEY}`,
      this.refreshBuildHotkeys,
    );
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown);
    document.removeEventListener("pointerup", this.handleDocumentPointerUp);
    document.removeEventListener(
      "pointercancel",
      this.handleDocumentPointerCancel,
    );
    document.removeEventListener("touchstart", this.handlePeekTouchEvent, true);
    document.removeEventListener("touchend", this.handlePeekTouchEvent, true);
    document.removeEventListener(
      "touchcancel",
      this.handlePeekTouchEvent,
      true,
    );
    this.dismissPeek();
    this.activeTouchIdentifiers.clear();
    this.suppressNextClick = false;
    this.suppressReleaseClick = false;
    this.clearTouchClickTarget();
    this.windowListenersAttached = false;
  }

  /** The bar moved or resized: the tooltip and the edge fades have to follow. */
  private onLayoutChange = () => {
    this.requestUpdate();
  };

  /**
   * A keyboard can show up after the page loaded (a tablet with a Bluetooth
   * keyboard, a desktop user who only now typed). Show the hotkeys from then on.
   */
  private handleKeyboardDetection = () => {
    if (Platform.hasKeyboard && !this.lastHasKeyboard) {
      this.lastHasKeyboard = true;
      this.requestUpdate();
    }
  };

  /**
   * Holding a build button shows its cost and description. Touch devices have
   * no hover, and a tap selects the unit right away, so the details need a
   * press of their own.
   */
  private startPeek = (
    event: PointerEvent,
    unitType: PlayerBuildableUnitType,
    structureKey: string,
    hotkey: string,
  ) => {
    if (event.pointerType !== "touch") return;
    // A new press replaces the peek of the previous one.
    this.dismissPeek();
    this.peekPointerId = event.pointerId;
    // The press that follows is a new gesture: it may select the unit.
    this.suppressNextClick = false;
    const element = event.currentTarget as HTMLElement;
    this.peekTimer = setTimeout(() => {
      this.peekTimer = null;
      // The hold becomes a peek: releasing it must not select the unit.
      this.suppressNextClick = true;
      this._peekedUnitTooltip = { unitType, structureKey, hotkey, element };
      this.requestUpdate();
    }, PEEK_HOLD_MS);
  };

  private cancelPeekTimer() {
    if (this.peekTimer === null) return;
    clearTimeout(this.peekTimer);
    this.peekTimer = null;
  }

  private dismissPeek() {
    this.cancelPeekTimer();
    this.peekPointerId = null;
    this.peekTouchIdentifier = null;
    if (this.peekGraceTimer !== null) {
      clearTimeout(this.peekGraceTimer);
      this.peekGraceTimer = null;
    }
    if (this._peekedUnitTooltip === null) return;
    this._peekedUnitTooltip = null;
    this.requestUpdate();
  }

  /** A press outside the bar dismisses the peek it opened. */
  private handleDocumentPointerDown = (event: PointerEvent) => {
    this.suppressReleaseClick = false;
    if (event.pointerType !== "touch") this.clearTouchClickTarget();
    if (this._peekedUnitTooltip === null) return;
    const root = this.querySelector(".unit-display-root");
    if (root && event.target instanceof Node && root.contains(event.target)) {
      return;
    }
    this.dismissPeek();
  };

  /** Releasing anywhere ends the hold, wherever the finger ended up. */
  private handleDocumentPointerUp = (event: PointerEvent) => {
    if (this.peekPointerId !== event.pointerId) return;
    this.suppressReleaseClick = this.suppressNextClick;
    this.suppressNextClick = false;
    this.cancelPeekTimer();
    this.peekPointerId = null;
    this.peekTouchIdentifier = null;
    // The details are only useful while the button is held down.
    if (this._peekedUnitTooltip !== null) this.dismissPeek();
  };

  /** Pointer cancellation can precede touchend; the touch event ends the peek. */
  private handleDocumentPointerCancel = (event: PointerEvent) => {
    if (this.peekPointerId !== event.pointerId) return;
    this.cancelPeekTimer();
    if (
      this._peekedUnitTooltip !== null &&
      this.activeTouchIdentifiers.size > 1
    ) {
      this.startPeekGraceTimer();
    }
  };

  private handlePeekTouchEvent = (event: TouchEvent) => {
    const root = this.querySelector(".unit-display-root");
    const isInBuildBar =
      event.target instanceof Node && root?.contains(event.target);
    const changedTouches = Array.from(event.changedTouches);

    if (event.type === "touchstart") {
      this.clearTouchClickTarget();
      for (const touch of changedTouches) {
        this.activeTouchIdentifiers.add(touch.identifier);
      }
      if (isInBuildBar && this.peekTouchIdentifier === null) {
        this.peekTouchIdentifier = changedTouches[0]?.identifier ?? null;
      }
    } else {
      if (event.type === "touchend" && isInBuildBar) {
        this.lastTouchClickItem =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>(".unit-display-grid > div")
            : null;
      }
      const trackedTouchEnded = changedTouches.some(
        (touch) => touch.identifier === this.peekTouchIdentifier,
      );
      for (const touch of changedTouches) {
        this.activeTouchIdentifiers.delete(touch.identifier);
      }

      if (!trackedTouchEnded) return;
      this.peekTouchIdentifier = null;
      this.peekPointerId = null;
      this.cancelPeekTimer();
      if (event.type === "touchend") {
        this.suppressReleaseClick ||= this.suppressNextClick;
        this.suppressNextClick = false;
        if (this._peekedUnitTooltip !== null) this.dismissPeek();
      } else {
        this.clearTouchClickTarget();
        this.suppressNextClick = false;
        this.suppressReleaseClick = false;
        if (this._peekedUnitTooltip !== null) {
          this.startPeekGraceTimer();
        }
      }
    }
  };

  private clearTouchClickTarget() {
    this.lastTouchClickItem = null;
  }

  private isTouchClick(event: Event, item: Element | null): boolean {
    const isTouch =
      (event instanceof PointerEvent && event.pointerType === "touch") ||
      isForwardedTouchClick(event) ||
      (event instanceof MouseEvent &&
        event.detail > 0 &&
        item === this.lastTouchClickItem);
    this.clearTouchClickTarget();
    return isTouch;
  }

  private startPeekGraceTimer() {
    if (this.peekGraceTimer !== null) clearTimeout(this.peekGraceTimer);
    this.peekGraceTimer = setTimeout(() => {
      this.peekGraceTimer = null;
      if (this._peekedUnitTooltip !== null) this.dismissPeek();
    }, PEEK_GRACE_MS);
  }

  private onScroll = () => {
    this.requestUpdate();
  };

  /**
   * Track which edge of the build bar still hides actions, so the fade can
   * point at it. The bar only scrolls where it does not fit, so on a wide
   * screen neither side is marked.
   */
  private measureScrollState() {
    const scroller = this.getScroller();
    if (!scroller) return;
    this.moreActionsLeft = scroller.scrollLeft > 1;
    this.moreActionsRight =
      scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
  }

  private getScroller(): HTMLElement | null {
    return this.querySelector<HTMLElement>(".unit-display-scroll");
  }

  willUpdate() {
    this.measureScrollState();
  }

  updated() {
    const scroller = this.getScroller();
    if (scroller !== this.observedScroller) {
      this.observedScroller?.removeEventListener("scroll", this.onScroll);
      this.observedScroller = scroller;
      scroller?.addEventListener("scroll", this.onScroll);
    }
    this.clampTooltipToViewport();
  }

  /**
   * Keep the tooltip on the mobile screen: next to the left or right edge it would
   * otherwise hang off.
   */
  private clampTooltipToViewport() {
    const tooltip = this.querySelector<HTMLElement>(".unit-display-tooltip");
    const root = this.querySelector<HTMLElement>(".unit-display-root");
    if (!tooltip || !root || this._tooltipCenter === null) return;
    const rootBounds = root.getBoundingClientRect();
    const tooltipBounds = tooltip.getBoundingClientRect();
    const margin = 8;
    // The tooltip is centred on the item, so its left edge sits half its
    // width to the left of that centre.
    let left = rootBounds.left + this._tooltipCenter - tooltipBounds.width / 2;
    const max = window.innerWidth - margin - tooltipBounds.width;
    if (left < margin) left = margin;
    else if (left > max) left = max;
    // The tooltip is pulled left by half its width with the transform, so the
    // style has to put that half back, or the box ends up twice shifted.
    tooltip.style.left = `${left - rootBounds.left + tooltipBounds.width / 2}px`;
  }

  private cost(item: UnitType): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item) {
        return bu.cost;
      }
    }
    return 0n;
  }

  private canBuild(item: UnitType): boolean {
    if (this.game?.config().isUnitDisabled(item)) return false;
    // Never display missing asynchronous prices as free build actions.
    // This applies to every unit, including future game-mode-specific units.
    if (!this.playerBuildables?.some((bu) => bu.type === item)) return false;
    const player = this.game?.myPlayer();
    switch (item) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.MissileSilo).length ?? 0) > 0
        );
      case UnitType.Warship:
      case UnitType.Bismarck:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.Port).length ?? 0) > 0
        );
      default: {
        if (this.cost(item) <= (player?.gold() ?? 0n)) return true;
        // An owned resource building can be upgraded even when a new one is unaffordable.
        const buildable = this.playerBuildables?.find((bu) => bu.type === item);
        return (
          !this.uiState.preventStacking &&
          buildable?.upgradeCost !== undefined &&
          buildable.upgradeCost <= (player?.gold() ?? 0n) &&
          (player?.units(item).length ?? 0) > 0
        );
      }
    }
  }

  private isUnitDisplayed(unitType: PlayerBuildableUnitType): boolean {
    return (
      !this.game.config().isUnitDisabled(unitType) &&
      (!this.tutorialMode || unitType === UnitType.AtomBomb)
    );
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player) return;
    player
      .buildables(undefined, BuildMenus.types)
      .then((buildables) => {
        this.playerBuildables = buildables;
      })
      .catch((error) => console.warn("Failed to refresh unit costs", error));
    this._cities = player.totalUnitLevels(UnitType.City);
    this._missileSilo = player.totalUnitLevels(UnitType.MissileSilo);
    this._port = player.totalUnitLevels(UnitType.Port);
    this._shipyard = player.totalUnitLevels(UnitType.Shipyard);
    this._defensePost = player.totalUnitLevels(UnitType.DefensePost);
    this._castle = player.totalUnitLevels(UnitType.Castle);
    this._ironDome = player.totalUnitLevels(UnitType.IronDome);
    this._samLauncher = player.totalUnitLevels(UnitType.SAMLauncher);
    this._factories = player.totalUnitLevels(UnitType.Factory);
    this._farms = player.totalUnitLevels(UnitType.Farm);
    this._mines = player.totalUnitLevels(UnitType.Mine);
    this._oilWells = player.totalUnitLevels(UnitType.OilWell);
    this._gasPlants = player.totalUnitLevels(UnitType.GasPlant);
    this._warships = player.totalUnitLevels(UnitType.Warship);
    this.requestUpdate();
  }

  render() {
    const myPlayer = this.game?.myPlayer();
    if (
      !this.game ||
      !myPlayer ||
      this.game.inSpawnPhase() ||
      !myPlayer.isAlive()
    ) {
      return null;
    }
    if (this.allDisabled) {
      return null;
    }
    // The onboarding tutorial's one build is the atom bomb, fired from the
    // nation's silo once captured.
    if (
      this.tutorialMode &&
      myPlayer.units(UnitType.MissileSilo).length === 0
    ) {
      return null;
    }
    const showNuclear = this.isUnitDisplayed(UnitType.AtomBomb) || this.isUnitDisplayed(UnitType.HydrogenBomb) || this.isUnitDisplayed(UnitType.MIRV);
    const availableCategory = BUILD_CATEGORIES.find((cat) => cat.types.some((type) => this.isUnitDisplayed(type)));
    const selectedCategory = BUILD_CATEGORIES.find((cat) => cat.id === this.activeBuildCategory);
    const activeCategory: BuildCategory = this.tutorialMode ? "arsenal" :
      this.activeBuildCategory === "arsenal" && !showNuclear ? availableCategory?.id ?? "economy" :
      selectedCategory && !selectedCategory.types.some((type) => this.isUnitDisplayed(type))
        ? availableCategory?.id ?? (showNuclear ? "arsenal" : "economy")
        : this.activeBuildCategory;
    return html`
      <div
        class="unit-display-root relative w-full rounded-xl border border-sky-200/15 bg-slate-950/90 p-2 shadow-[0_12px_28px_rgba(0,0,0,0.30)]
          ${this.moreActionsLeft ? "unit-display-more-left" : ""}
          ${this.moreActionsRight ? "unit-display-more-right" : ""}"
        data-radial-click-through
        @contextmenu=${(event: Event) => event.preventDefault()}
      >
        ${this.resourceEconomy ? html`<div class="absolute bottom-full left-0 mb-2 w-72 max-w-[90vw] pointer-events-none">${renderResourceEconomy(this.resourceEconomy)}</div>` : null}

        <div class="unit-display-workspace">
          <div class="unit-display-construction min-w-0 flex-1">
            <div class="unit-display-tabs" role="tablist" aria-label="Categorías de construcción">
              <span class="unit-display-eyebrow hidden xl:inline">CONSTRUIR</span>
              ${BUILD_CATEGORIES.filter((cat) => cat.types.some((type) => this.isUnitDisplayed(type))).map((cat) => html`
                <button type="button" role="tab" data-build-category=${cat.id}
                  aria-selected=${activeCategory === cat.id}
                  class="unit-display-tab ${activeCategory === cat.id ? "is-active" : ""}"
                  @click=${() => this.selectBuildCategory(cat.id)}>${cat.label}</button>
              `)}
              ${showNuclear && !this.tutorialMode ? html`
                <button type="button" role="tab" data-build-category="arsenal"
                  aria-selected=${activeCategory === "arsenal"}
                  class="unit-display-tab unit-display-tab-arsenal lg:hidden ${activeCategory === "arsenal" ? "is-active" : ""}"
                  @click=${() => this.selectBuildCategory("arsenal")}>☢ Arsenal</button>
              ` : nothing}
              <button type="button" data-frontier-resources-toggle data-radial-click-through
                aria-pressed=${this.resourcesVisible}
                title=${this.resourcesVisible ? "Ocultar recursos naturales" : "Mostrar recursos naturales"}
                class="unit-display-resources"
                @click=${(e: MouseEvent) => { e.stopPropagation(); this.toggleResources(); }}>
                ${this.resourcesVisible ? "◉ Recursos" : "◎ Recursos"}
              </button>
            </div>
            <div class="unit-display-scroll w-full" aria-label="Acciones disponibles">
              <div class="unit-display-grid">
                ${activeCategory === "arsenal" ? this.renderNuclearActions() : this.renderBuildCategory(activeCategory)}
              </div>
            </div>
          </div>
          ${showNuclear && !this.tutorialMode ? html`
            <aside class="unit-display-arsenal hidden lg:flex" aria-label="Arsenal nuclear">
              <span class="unit-display-arsenal-heading">☢ ARSENAL</span>
              <div class="unit-display-grid unit-display-nuclear-grid">${this.renderNuclearActions()}</div>
            </aside>
          ` : nothing}
        </div>
        ${this.renderUnitTooltip()}
      </div>
    `;
  }


  private selectBuildCategory(category: BuildCategory) {
    this._hoveredUnitTooltip = null;
    this.dismissPeek();
    this.activeBuildCategory = category;
  }

  private renderNuclearActions() {
    return html`
      ${this.renderUnitItem(atomBombIcon, null, UnitType.AtomBomb, "atom_bomb", this.getHotkey("buildAtomBomb", "Digit8"), "Atómica")}
      ${this.renderUnitItem(hydrogenBombIcon, null, UnitType.HydrogenBomb, "hydrogen_bomb", this.getHotkey("buildHydrogenBomb", "Digit9"), "Hidrógeno")}
      ${this.renderUnitItem(mirvIcon, null, UnitType.MIRV, "mirv", this.getHotkey("buildMIRV", "Digit0"), "MIRV")}
    `;
  }

  private renderMobileShipyard() {
    const player = this.game.myPlayer();
    if (!player || this.tutorialMode || !this.game.config().gameConfig().geopolitics || !this.isUnitDisplayed(UnitType.Warship)) return nothing;
    const selected = this.uiState.ghostStructure === UnitType.Warship && this.uiState.supportShipMode;
    const lacksPort = player.units(UnitType.Port).length === 0;
    const lacksGold = player.gold() < 5_000_000n && !this.game.config().gameConfig().infiniteGold;
    const unavailable = !this.playerBuildables?.some((b) => b.type === UnitType.Warship) || lacksGold || lacksPort;
    return html`
      <div class="flex flex-col items-center relative" data-mobile-shipyard-container>
        <button type="button" data-mobile-shipyard data-radial-click-through
          aria-label="Portabuques de reparación" aria-pressed=${selected}
          title=${"Portabuques · Base naval móvil · Repara hasta 3 barcos aliados cerca de su posición · 5M de oro" +
            (unavailable ? " · " + (lacksPort ? "Requiere puerto" : lacksGold ? "Oro insuficiente" : "No disponible") : "")}
          ?disabled=${unavailable}
          class="unit-display-action unit-display-shipyard ${selected ? "is-selected" : ""}"
          @click=${(event: MouseEvent) => {
            event.stopPropagation();
            if (selected) {
              this.inputHandler.setGhostStructure(null, "GUIclick");
              this.uiState.supportShipMode = false;
            } else {
              if (this.uiState.ghostStructure === UnitType.Warship) this.inputHandler.setGhostStructure(null, "GUIclick");
              this.inputHandler.setGhostStructure(UnitType.Warship, "GUIclick");
              this.uiState.supportShipMode = true;
            }
            this.requestUpdate();
          }}>
          <img src=${repairCarrierIcon} alt="" aria-hidden="true" class="unit-display-action-image" />
          <span class="unit-display-action-cost ${lacksGold ? "is-unaffordable" : ""}">5M <img src=${goldCoinIcon} alt="" width="11" height="11" /></span>
        </button>
        <span class="unit-display-action-label">Portabuques</span>
      </div>
    `;
  }

  private renderBuildCategory(category: BuildCategory) {
    switch (category) {
      case "economy":
        return html`
          ${this.renderUnitItem(cityIcon, this._cities, UnitType.City, "city", this.getHotkey("buildCity", "Digit1"))}
          ${this.renderUnitItem(factoryIcon, this._factories, UnitType.Factory, "factory", this.getHotkey("buildFactory", "Digit2"))}
          ${this.renderUnitItem(farmIcon, this._farms, UnitType.Farm, "farm", this.getHotkey("buildFarm", ""))}
          ${this.renderUnitItem(mineIcon, this._mines, UnitType.Mine, "mine", this.getHotkey("buildMine", ""))}
          ${this.renderUnitItem(oilWellIcon, this._oilWells, UnitType.OilWell, "oil_well", this.getHotkey("buildOilWell", ""))}
          ${this.renderUnitItem(gasPlantIcon, this._gasPlants, UnitType.GasPlant, "gas_plant", this.getHotkey("buildGasPlant", ""))}
        `;
      case "defense":
        return html`
          ${this.renderUnitItem(defensePostIcon, this._defensePost, UnitType.DefensePost, "defense_post", this.getHotkey("buildDefensePost", "Digit4"))}
          ${this.renderUnitItem(missileSiloIcon, this._missileSilo, UnitType.MissileSilo, "missile_silo", this.getHotkey("buildMissileSilo", "Digit5"))}
          ${this.renderUnitItem(samLauncherIcon, this._samLauncher, UnitType.SAMLauncher, "sam_launcher", this.getHotkey("buildSamLauncher", "Digit6"))}
          ${this.renderUnitItem(castleIcon, this._castle, UnitType.Castle, "castle", this.getHotkey("buildCastle", ""))}
          ${this.renderUnitItem(ironDomeIcon, this._ironDome, UnitType.IronDome, "iron_dome", this.getHotkey("buildIronDome", ""))}
        `;
      case "naval":
        return html`
          ${this.renderUnitItem(portIcon, this._port, UnitType.Port, "port", this.getHotkey("buildPort", "Digit3"))}
          ${this.renderUnitItem(shipyardIcon, this._shipyard, UnitType.Shipyard, "shipyard", this.getHotkey("buildShipyard", ""))}
          ${this.renderUnitItem(warshipIcon, this._warships, UnitType.Warship, "warship", this.getHotkey("buildWarship", "Digit7"))}
          ${this.game.config().isFunctionalGeopolitics?.() ? this.renderUnitItem(warshipIcon, null, UnitType.Bismarck, "bismarck", this.getHotkey("buildBismarck", ""), "Bismarck") : nothing}
          ${this.renderMobileShipyard()}
        `;
      case "arsenal":
        return this.renderNuclearActions();
    }
  }

  private getHotkey(action: string, defaultCode: string): string {
    // Without a keyboard the hotkeys cannot be used, so don't resolve them
    // (or the keyboard layout behind them) and don't show them.
    // An explicitly unbound action must not display a fallback digit.
    if (!Platform.hasKeyboard || !this.keybinds[action]) return "";
    return resolveKeybindLabel(
      this.keybinds[action],
      defaultCode,
      this.keyboardLayout.map,
    );
  }

  private renderUnitItem(
    icon: string,
    number: number | null,
    unitType: PlayerBuildableUnitType,
    structureKey: string,
    hotkey: string,
    label?: string,
  ) {
    if (!this.isUnitDisplayed(unitType)) {
      return html``;
    }
    const selected = this.uiState.ghostStructure === unitType &&
      !(unitType === UnitType.Warship && this.uiState.supportShipMode);
    const naturalResource =
      unitType === UnitType.Farm ||
      unitType === UnitType.Mine ||
      unitType === UnitType.OilWell ||
      unitType === UnitType.GasPlant;
    // Repeated desktop clicks should use the same upgrade ladder as repeated
    // hotkeys (1 -> 5 -> 10 -> ...). Never imply that a non-upgradable
    // Castle can be upgraded in bulk; touch taps keep their cancel behavior.
    const canRepeatBulk =
      !this.uiState.preventStacking &&
      (unitType === UnitType.AtomBomb ||
        this.game.config().unitInfo?.(unitType)?.upgradable === true);
    const requestedBulk = this.uiState.upgradeMultiplier ?? 1;
    const currentBuildable = this.playerBuildables?.find(
      (bu) => bu.type === unitType,
    );
    const playerGold = this.game.myPlayer()?.gold();
    // When an upgrade has an explicit escalating price table, the number
    // shown on the button must agree with what the player can actually buy.
    const affordableBulk =
      selected && currentBuildable?.canUpgrade !== false &&
      currentBuildable?.upgradeCosts && playerGold !== undefined
        ? maxBulkAmount(currentBuildable, playerGold)
        : requestedBulk;
    const bulkBadge = selected && canRepeatBulk && requestedBulk > 1
      ? Math.max(1, Math.min(
          requestedBulk,
          affordableBulk,
          currentBuildable?.upgradeCosts?.length ?? requestedBulk,
        ))
      : 0;
    const displayHotkey = hotkey
      .replace(/^Shift\+/, "⇧")
      .replace("Digit", "")
      .replace("Key", "")
      .toUpperCase();

    return html`
      <div
        class="flex flex-col items-center relative"
        @mouseenter=${(event: MouseEvent) => {
          const item = event.currentTarget as HTMLElement;
          this._hoveredUnitTooltip = {
            unitType,
            structureKey,
            hotkey,
            element: item,
          };
          this.requestUpdate();
        }}
        @mouseleave=${() => {
          this._hoveredUnitTooltip = null;
          this.requestUpdate();
        }}
        @pointerdown=${(event: PointerEvent) =>
          this.startPeek(event, unitType, structureKey, hotkey)}
      >
        <div
          role="button" tabindex="0"
          aria-label=${translateText("unit_type." + structureKey)}
          aria-pressed=${selected}
          aria-disabled=${!this.canBuild(unitType)}
          class="unit-display-action ${naturalResource ? "is-resource" : ""} ${selected ? "is-selected" : ""} ${!this.canBuild(unitType) ? "is-unavailable" : ""} ${this.tutorialHighlight === unitType ? "tutorial-highlight" : ""}"
          title=${translateText("unit_type." + structureKey) + (!this.canBuild(unitType) ? " · " + this.buildUnavailableReason(unitType) : "")}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            (event.currentTarget as HTMLElement).click();
          }}
          @click=${(event: Event) => {
            const item = (event.currentTarget as HTMLElement).closest(
              ".unit-display-grid > div",
            );
            const fromTouch = this.isTouchClick(event, item);
            // A press that turned into a peek shows the details instead of
            // selecting the unit
            if (this.suppressNextClick || this.suppressReleaseClick) {
              this.suppressNextClick = false;
              this.suppressReleaseClick = false;
              return;
            }
            this.uiState.supportShipMode = false;
            if (selected) {
              if (!fromTouch && canRepeatBulk) {
                this.inputHandler.setGhostStructure(unitType, "GUIclick");
              } else {
                this.inputHandler.setGhostStructure(null, "GUIclick");
              }
            } else if (this.canBuild(unitType)) {
              this.inputHandler.setGhostStructure(unitType, "GUIclick");
              if (fromTouch) {
                this.eventBus?.emit(new TouchGhostPlacementSelectEvent());
                this.eventBus?.emit(
                  new ToggleStructureEvent(highlightTypesForUnit(unitType)),
                );
              }
            } else {
              const selectedGhost = this.uiState.ghostStructure;
              this.eventBus?.emit(
                new ToggleStructureEvent(
                  selectedGhost === null
                    ? null
                    : highlightTypesForUnit(selectedGhost),
                ),
              );
            }
            this.requestUpdate();
          }}
          @pointerenter=${(event: PointerEvent) => {
            if (event.pointerType === "touch") return;
            this.eventBus?.emit(
              new ToggleStructureEvent(highlightTypesForUnit(unitType)),
            );
          }}
          @pointerleave=${(event: PointerEvent) => {
            if (event.pointerType === "touch") return;
            const selectedGhost = this.uiState.ghostStructure;
            this.eventBus?.emit(
              new ToggleStructureEvent(
                selectedGhost === null
                  ? null
                  : highlightTypesForUnit(selectedGhost),
              ),
            );
          }}
        >
          ${
            hotkey
              ? html`<div
                  class="unit-display-hotkey absolute left-1 top-1 rounded border border-white/10 bg-slate-950/90 px-1 text-[10px] font-bold leading-tight text-cyan-200"
                >
                  ${displayHotkey}
                </div>`
              : nothing
          }
          ${bulkBadge > 0
            ? html`<span
                class="unit-display-multiplier pointer-events-none absolute right-0.5 top-0.5 rounded border border-cyan-300/45 bg-cyan-950/95 px-1 text-[10px] font-bold leading-tight text-cyan-100 tabular-nums motion-safe:animate-pulse"
                title="Cantidad de mejoras según el oro disponible"
              >×${bulkBadge}</span>`
            : nothing}
          <div class="unit-display-action-content">
            <img src=${icon} alt="" aria-hidden="true" class="unit-display-action-image" />
            <span class="unit-display-action-count" translate="no">${renderNumber(number ?? (this.game.myPlayer()?.units(unitType).length ?? 0))}</span>
            <span class="unit-display-action-cost ${this.cost(unitType) > (playerGold ?? 0n) && !this.game.config().gameConfig().infiniteGold ? "is-unaffordable" : ""}" translate="no">
              ${this.playerBuildables?.some((b) => b.type === unitType) ? renderNumber(this.cost(unitType)) : "—"}
              <img src=${goldCoinIcon} alt="" aria-hidden="true" width="11" height="11" />
            </span>
          </div>
        </div>
        ${label ? html`<span class="unit-display-action-label">${label}</span>` : nothing}
      </div>
    `;
  }

  private buildUnavailableReason(unitType: PlayerBuildableUnitType): string {
    if (!this.playerBuildables) return "Cargando costos";
    const player = this.game.myPlayer();
    if (!player) return "No disponible";
    if ((unitType === UnitType.AtomBomb || unitType === UnitType.HydrogenBomb || unitType === UnitType.MIRV) &&
        player.units(UnitType.MissileSilo).length === 0) return "Requiere silo";
    if ((unitType === UnitType.Warship || unitType === UnitType.Bismarck) && player.units(UnitType.Port).length === 0) return "Requiere puerto";
    if (this.cost(unitType) > player.gold() && !this.game.config().gameConfig().infiniteGold) return "Oro insuficiente";
    return "No disponible en este momento";
  }

  private renderUnitTooltip() {
    // A peek wins over a hover: it is the one the player asked for by
    // holding the button.
    const peek = this._peekedUnitTooltip;
    const tooltip = peek ?? this._hoveredUnitTooltip;
    if (!tooltip) return nothing;
    // The item can go away (a unit gets disabled) while it is hovered.
    if (!tooltip.element.isConnected) return nothing;
    const displayHotkey = tooltip.hotkey
      .replace("Digit", "")
      .replace("Key", "")
      .toUpperCase();
    // Measured at render time so the tooltip follows the item when the bar
    // scrolls or the layout changes, instead of staying where it was hovered.
    const root = this.querySelector<HTMLElement>(".unit-display-root");
    const itemBounds = tooltip.element.getBoundingClientRect();
    const rootBounds = root?.getBoundingClientRect();
    const left =
      itemBounds.left + itemBounds.width / 2 - (rootBounds?.left ?? 0);
    const top = itemBounds.top - (rootBounds?.top ?? 0) - 4;
    // Kept for the clamp after the render: the tooltip cannot be measured
    // before it exists.
    this._tooltipCenter = left;

    return html`
      <div
        class="unit-display-tooltip ${peek ? "block" : "hidden pointer-fine:block"} absolute -translate-x-1/2 -translate-y-full text-gray-200 text-center w-max max-w-[min(100%_-_1rem,100vw_-_1rem)] break-words text-xs border border-sky-300/20 bg-slate-950/95 rounded-lg p-2 z-[100] shadow-[0_12px_30px_rgba(0,0,0,0.5)] pointer-events-none"
        style=${`left: ${left}px; top: ${top}px;`}
      >
        <div class="font-bold text-sm mb-1">
          ${translateText("unit_type." + tooltip.structureKey)}${
            tooltip.hotkey ? ` [${displayHotkey}]` : ""
          }
        </div>
        <div class="p-2">
          ${translateText("build_menu.desc." + tooltip.structureKey)}
        </div>
        ${!this.canBuild(tooltip.unitType) ? html`<div class="unit-display-disabled-reason">${this.buildUnavailableReason(tooltip.unitType)}</div>` : nothing}
        ${
          tooltip.unitType === UnitType.Warship && Platform.hasKeyboard
            ? html`<div
                class="mt-1 px-2 py-1 text-[10px] text-cyan-300 border-t border-white/10"
              >
                ⇧ ${translateText("build_menu.warship_shift_hint")}
              </div>`
            : null
        }
        <div class="flex items-center justify-center gap-1">
          <img src=${goldCoinIcon} width="13" height="13" />
          <span class="text-yellow-300"
            >${renderNumber(this.cost(tooltip.unitType))}</span
          >
        </div>
      </div>
    `;
  }
}
