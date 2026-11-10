import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  BuildableUnit,
  BuildMenus,
  bulkCost,
  Gold,
  PlayerBuildableUnitType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { renderNumber } from "@openfront/engine-lib/Format";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { EventBus } from "@openfront/shared/EventBus";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { buildActionForUnit } from "../../BuildKeybinds";
import { Platform } from "../../Platform";
import { formatKeyForDisplay, translateText } from "../../../client/Utils";
import {
  KEYBINDS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../UserSettings";
import { Controller } from "../../Controller";
import {
  CloseViewEvent,
  MouseDownEvent,
  ShowBuildMenuEvent,
  ShowEmojiMenuEvent,
} from "../../InputHandler";
import { TransformHandler } from "../../TransformHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../Transport";
import { UIState } from "../../UIState";
import { GameView } from "../../view";
import {
  renderResourceEconomy,
  resourceEconomyReason,
} from "./ResourceEconomyDetails";
const warshipIcon = assetUrl("images/BattleshipIconWhite.svg");
const cityIcon = assetUrl("images/CityIconWhite.svg");
const factoryIcon = assetUrl("images/FactoryIconWhite.svg");
const farmIcon = assetUrl("images/FarmIconWhite.svg");
const mineIcon = assetUrl("images/MineIconWhite.svg");
const oilIcon = assetUrl("images/OilWellIconWhite.svg");
const gasIcon = assetUrl("images/GasPlantIconWhite.svg");
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const mirvIcon = assetUrl("images/MIRVIcon.svg");
const missileSiloIcon = assetUrl("images/MissileSiloIconWhite.svg");
const hydrogenBombIcon = assetUrl("images/MushroomCloudIconWhite.svg");
const atomBombIcon = assetUrl("images/NukeIconWhite.svg");
const portIcon = assetUrl("images/PortIcon.svg");
const shipyardIcon = assetUrl("images/ShipyardIconWhite.svg");
const samlauncherIcon = assetUrl("images/SamLauncherIconWhite.svg");
const shieldIcon = assetUrl("images/ShieldIconWhite.svg");
const castleIcon = assetUrl("images/CastleIconWhite.svg");
const ironDomeIcon = assetUrl("images/IronDomeIconWhite.svg");

export interface BuildItemDisplay {
  unitType: PlayerBuildableUnitType;
  icon: string;
  description?: string;
  key?: string;
  countable?: boolean;
}

const buildTable: BuildItemDisplay[][] = [
  [
    {
      unitType: UnitType.AtomBomb,
      icon: atomBombIcon,
      description: "build_menu.desc.atom_bomb",
      key: "unit_type.atom_bomb",
      countable: false,
    },
    {
      unitType: UnitType.MIRV,
      icon: mirvIcon,
      description: "build_menu.desc.mirv",
      key: "unit_type.mirv",
      countable: false,
    },
    {
      unitType: UnitType.HydrogenBomb,
      icon: hydrogenBombIcon,
      description: "build_menu.desc.hydrogen_bomb",
      key: "unit_type.hydrogen_bomb",
      countable: false,
    },
    {
      unitType: UnitType.Warship,
      icon: warshipIcon,
      description: "build_menu.desc.warship",
      key: "unit_type.warship",
      countable: true,
    },
    {
      unitType: UnitType.Bismarck,
      icon: warshipIcon,
      description: "build_menu.desc.bismarck",
      key: "unit_type.bismarck",
      countable: true,
    },
    {
      unitType: UnitType.Port,
      icon: portIcon,
      description: "build_menu.desc.port",
      key: "unit_type.port",
      countable: true,
    },
    {
      unitType: UnitType.Shipyard,
      icon: shipyardIcon,
      description: "geopolitics.shipyard_help",
      key: "geopolitics.shipyard_title",
      countable: true,
    },
    {
      unitType: UnitType.MissileSilo,
      icon: missileSiloIcon,
      description: "build_menu.desc.missile_silo",
      key: "unit_type.missile_silo",
      countable: true,
    },
    {
      unitType: UnitType.SAMLauncher,
      icon: samlauncherIcon,
      description: "build_menu.desc.sam_launcher",
      key: "unit_type.sam_launcher",
      countable: true,
    },
    {
      unitType: UnitType.DefensePost,
      icon: shieldIcon,
      description: "build_menu.desc.defense_post",
      key: "unit_type.defense_post",
      countable: true,
    },
    {
      unitType: UnitType.Castle,
      icon: castleIcon,
      description: "build_menu.desc.castle",
      key: "unit_type.castle",
      countable: true,
    },
    {
      unitType: UnitType.IronDome,
      icon: ironDomeIcon,
      description: "build_menu.desc.iron_dome",
      key: "unit_type.iron_dome",
      countable: true,
    },
    {
      unitType: UnitType.City,
      icon: cityIcon,
      description: "build_menu.desc.city",
      key: "unit_type.city",
      countable: true,
    },
    {
      unitType: UnitType.Factory,
      icon: factoryIcon,
      description: "build_menu.desc.factory",
      key: "unit_type.factory",
      countable: true,
    },
  ],
  [
    {
      unitType: UnitType.Farm,
      icon: farmIcon,
      description: "build_menu.desc.farm",
      key: "unit_type.farm",
      countable: true,
    },
    {
      unitType: UnitType.Mine,
      icon: mineIcon,
      description: "build_menu.desc.mine",
      key: "unit_type.mine",
      countable: true,
    },
    {
      unitType: UnitType.OilWell,
      icon: oilIcon,
      description: "build_menu.desc.oil_well",
      key: "unit_type.oil_well",
      countable: true,
    },
    {
      unitType: UnitType.GasPlant,
      icon: gasIcon,
      description: "build_menu.desc.gas_plant",
      key: "unit_type.gas_plant",
      countable: true,
    },
  ],
];

export const flattenedBuildTable = buildTable.flat();

@customElement("build-menu")
export class BuildMenu extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  private clickedTile: TileRef;
  public playerBuildables: BuildableUnit[] | null = null;
  private filteredBuildTable: BuildItemDisplay[][] = buildTable;
  public transformHandler: TransformHandler;
  private readonly shortcutSettings = new UserSettings();
  @state() private buildShortcuts: Record<string, string> = {};

  private readonly refreshBuildShortcuts = () => {
    this.buildShortcuts = this.shortcutSettings.keybinds(Platform.isMac);
  };

  connectedCallback() {
    super.connectedCallback();
    this.refreshBuildShortcuts();
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${KEYBINDS_KEY}`,
      this.refreshBuildShortcuts,
    );
  }

  disconnectedCallback() {
    globalThis.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${KEYBINDS_KEY}`,
      this.refreshBuildShortcuts,
    );
    super.disconnectedCallback();
  }

  init() {
    this.eventBus.on(ShowBuildMenuEvent, (e) => {
      if (!this.game.myPlayer()?.isAlive()) {
        return;
      }
      if (!this._hidden) {
        // Players sometimes hold control while building a unit,
        // so if the menu is already open, ignore the event.
        return;
      }
      const clickedCell = this.transformHandler.screenToWorldCoordinates(
        e.x,
        e.y,
      );
      if (!this.game.isValidCoord(clickedCell.x, clickedCell.y)) {
        return;
      }
      const tile = this.game.ref(clickedCell.x, clickedCell.y);
      this.showMenu(tile);
    });
    this.eventBus.on(CloseViewEvent, () => this.hideMenu());
    this.eventBus.on(ShowEmojiMenuEvent, () => this.hideMenu());
    this.eventBus.on(MouseDownEvent, () => this.hideMenu());
  }

  tick() {
    if (!this._hidden) {
      void this.refresh();
    }
  }

  static styles = css`
    :host {
      display: block;
    }
    .build-menu {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 9999;
      background-color: #1e1e1e;
      padding: 15px;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: 95vw;
      max-height: 95vh;
      overflow-y: auto;
    }
    .build-description {
      font-size: 0.6rem;
    }
    .build-row {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      width: 100%;
    }
    .build-button {
      position: relative;
      width: 120px;
      height: 140px;
      border: 2px solid #444;
      background-color: #2c2c2c;
      color: white;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      margin: 8px;
      padding: 10px;
      gap: 5px;
    }
    .build-button:not(:disabled):hover {
      background-color: #3a3a3a;
      transform: scale(1.05);
      border-color: #666;
    }
    .build-button:not(:disabled):active {
      background-color: #4a4a4a;
      transform: scale(0.95);
    }
    .build-button:disabled {
      background-color: #1a1a1a;
      border-color: #333;
      cursor: not-allowed;
      opacity: 0.7;
    }
    .build-button:disabled img {
      opacity: 0.5;
    }
    .build-button:disabled .build-cost {
      color: #ff4444;
    }
    .build-icon-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 55px;
      min-height: 54px;
      flex-shrink: 0;
    }
    .build-icon-wrap > img {
      display: block;
      width: 40px;
      height: 40px;
      object-fit: contain;
    }
    .build-hotkey {
      position: absolute;
      top: -7px;
      right: -17px;
      padding: 2px 6px;
      min-width: 22px;
      max-width: calc(100% - 12px);
      overflow: hidden;
      text-overflow: ellipsis;
      border: 1px solid #64707a;
      border-radius: 5px;
      background: #303740;
      color: #e3e9ed;
      font: 800 13px/1.3 system-ui;
      text-align: center;
      pointer-events: none;
      z-index: 2;
      box-shadow: 0 1px 5px #000b;
    }
    .build-hotkey.unbound {
      color: #9ba7ad;
      border-style: dashed;
      background: #262b30;
    }
    .build-icon {
      font-size: 40px;
      margin-bottom: 5px;
    }
    .build-name {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 5px;
      text-align: center;
    }
    .build-cost {
      font-size: 14px;
    }
    .hidden {
      display: none !important;
    }
    .build-count-chip {
      position: absolute;
      top: -10px;
      right: -10px;
      background-color: #2c2c2c;
      color: white;
      padding: 2px 10px;
      border-radius: 10000px;
      transition: all 0.3s ease;
      font-size: 12px;
      display: flex;
      justify-content: center;
      align-content: center;
      border: 1px solid #444;
    }
    .build-button:not(:disabled):hover > .build-count-chip {
      background-color: #3a3a3a;
      border-color: #666;
    }
    .build-button:not(:disabled):active > .build-count-chip {
      background-color: #4a4a4a;
    }
    .build-button:disabled > .build-count-chip {
      background-color: #1a1a1a;
      border-color: #333;
      cursor: not-allowed;
    }
    .build-count {
      font-weight: bold;
      font-size: 14px;
    }

    @media (max-width: 768px) {
      .build-menu {
        padding: 10px;
        max-height: 80vh;
        width: 80vw;
      }
      .build-button {
        width: 140px;
        height: 120px;
        margin: 4px;
        padding: 6px;
        gap: 5px;
      }
      .build-icon {
        font-size: 28px;
      }
      .build-name {
        font-size: 12px;
        margin-bottom: 3px;
      }
      .build-cost {
        font-size: 11px;
      }
      .build-count {
        font-weight: bold;
        font-size: 10px;
      }
      .build-count-chip {
        padding: 1px 5px;
      }
      .build-hotkey {
        top: -5px;
        right: -9px;
        padding: 1px 4px;
        font-size: 11px;
      }
    }

    @media (max-width: 480px) {
      .build-menu {
        padding: 8px;
        max-height: 70vh;
      }
      .build-button {
        width: calc(50% - 6px);
        height: 100px;
        margin: 3px;
        padding: 4px;
        border-width: 1px;
      }
      .build-icon {
        font-size: 24px;
      }
      .build-name {
        font-size: 10px;
        margin-bottom: 2px;
      }
      .build-cost {
        font-size: 9px;
      }
      .build-count {
        font-weight: bold;
        font-size: 8px;
      }
      .build-count-chip {
        padding: 0 3px;
      }
      .build-button img {
        width: 24px;
        height: 24px;
      }
      .build-cost img {
        width: 10px;
        height: 10px;
      }
    }
  `;

  @state()
  private _hidden = true;

  public canBuildOrUpgrade(item: BuildItemDisplay): boolean {
    if (this.game?.myPlayer() === null || this.playerBuildables === null) {
      return false;
    }
    const unit = this.playerBuildables.find((u) => u.type === item.unitType);
    if (this.uiState.preventStacking) return !!unit && unit.canBuild !== false;
    return unit ? unit.canBuild !== false || unit.canUpgrade !== false : false;
  }

  public cost(item: BuildItemDisplay): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item.unitType) {
        return bu.canUpgrade !== false && !this.uiState.preventStacking
          ? bulkCost(bu, 1)
          : bu.cost;
      }
    }
    return 0n;
  }

  public count(item: BuildItemDisplay): string {
    const player = this.game?.myPlayer();
    if (!player) {
      return "?";
    }

    return player.totalUnitLevels(item.unitType).toString();
  }

  public sendBuildOrUpgrade(buildableUnit: BuildableUnit, tile: TileRef): void {
    this.uiState.supportShipMode = false;
    if (buildableUnit.canUpgrade !== false && !this.uiState.preventStacking) {
      this.eventBus.emit(
        new SendUpgradeStructureIntentEvent(
          buildableUnit.canUpgrade,
          buildableUnit.type,
        ),
      );
    } else if (buildableUnit.canBuild !== false) {
      const rocketDirectionUp =
        buildableUnit.type === UnitType.AtomBomb ||
        buildableUnit.type === UnitType.HydrogenBomb
          ? this.uiState.rocketDirectionUp
          : undefined;
      this.eventBus.emit(
        new BuildUnitIntentEvent(buildableUnit.type, tile, rocketDirectionUp),
      );
    }
    this.hideMenu();
  }

  render() {
    return html`
      <div
        class="build-menu ${this._hidden ? "hidden" : ""}"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        ${this.filteredBuildTable.map(
          (row) => html`
            <div class="build-row">
              ${row.map((item) => {
                const buildableUnit = this.playerBuildables?.find(
                  (bu) => bu.type === item.unitType,
                );
                if (buildableUnit === undefined) {
                  return html``;
                }
                const enabled = this.canBuildOrUpgrade(item);
                return html`
                  <button
                    class="build-button"
                    @click=${() =>
                      this.sendBuildOrUpgrade(buildableUnit, this.clickedTile)}
                    ?disabled=${!enabled}
                    title=${
                      !enabled
                        ? resourceEconomyReason(
                            buildableUnit.resourceEconomy,
                          ) || translateText("build_menu.not_enough_money")
                        : ""
                    }
                  >
                    <div class="build-icon-wrap">
                      <img
                        src=${item.icon}
                        alt="${item.unitType}"
                        width="40"
                        height="40"
                      />
                      ${(() => {
                        const action = buildActionForUnit(item.unitType);
                        if (!action) return "";
                        const shortcut = this.buildShortcuts[action];
                        const label = shortcut ? formatKeyForDisplay(shortcut) : "—";
                        return html`<span
                          class="build-hotkey ${shortcut ? "" : "unbound"}"
                          translate="no"
                          title=${shortcut
                            ? `Tecla: ${label}`
                            : "Atajo sin asignar. Configuración → Teclas"}
                          aria-label=${shortcut ? `Atajo ${label}` : "Atajo sin asignar"}
                        >${label}</span>`;
                      })()}
                    </div>
                    <span class="build-name">
                      ${item.key && translateText(item.key)}
                    </span>
                    <span class="build-description"
                      >${
                        item.description && translateText(item.description)
                      }</span
                    >
                    ${renderResourceEconomy(buildableUnit.resourceEconomy)}
                    <span class="build-cost" translate="no">
                      ${renderNumber(
                        this.game && this.game.myPlayer() ? this.cost(item) : 0,
                      )}
                      <img
                        src=${goldCoinIcon}
                        alt="gold"
                        width="12"
                        height="12"
                        class="align-middle"
                      />
                    </span>
                    ${
                      item.countable
                        ? html`<div class="build-count-chip">
                            <span class="build-count">${this.count(item)}</span>
                          </div>`
                        : ""
                    }
                  </button>
                `;
              })}
            </div>
          `,
        )}
      </div>
    `;
  }

  hideMenu() {
    this._hidden = true;
    this.requestUpdate();
  }

  showMenu(clickedTile: TileRef) {
    this.clickedTile = clickedTile;
    this._hidden = false;
    void this.refresh();
  }

  private refresh() {
    const refresh = this.game
      .myPlayer()
      ?.buildables(this.clickedTile, BuildMenus.types)
      .then((buildables) => {
        this.playerBuildables = buildables;
        this.requestUpdate();
      })
      .catch((error) => {
        // Retain the last successful snapshot, including newer overlapping replies.
        console.warn("Failed to refresh build menu", error);
      });

    // remove disabled buildings from the buildtable
    this.filteredBuildTable = this.getBuildableUnits();
    return refresh;
  }

  private getBuildableUnits(): BuildItemDisplay[][] {
    return buildTable.map((row) =>
      row.filter((item) => !this.game?.config()?.isUnitDisabled(item.unitType)),
    );
  }

  get isVisible() {
    return !this._hidden;
  }
}
