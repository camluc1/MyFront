import {
  GameMapType,
  listedMaps,
  type MapInfo,
} from "@openfront/engine-api/game/GameTypes";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import { translateText } from "../Utils";
import {
  getFavoriteMaps,
  starIcon,
  toggleFavoriteMap,
} from "./map/MapFavorites";

@customElement("solo-map-menu")
export class SoloMapMenu extends LitElement {
  @state() private favorites = getFavoriteMaps();

  private refreshFavorites = () => {
    this.favorites = getFavoriteMaps();
  };

  connectedCallback() {
    super.connectedCallback();
    this.refreshFavorites();
    window.addEventListener("map-favorites-changed", this.refreshFavorites);
    window.addEventListener("storage", this.refreshFavorites);
  }

  disconnectedCallback() {
    window.removeEventListener("map-favorites-changed", this.refreshFavorites);
    window.removeEventListener("storage", this.refreshFavorites);
    super.disconnectedCallback();
  }

  createRenderRoot() {
    return this;
  }

  private emit(name: string, detail?: { map: GameMapType }) {
    this.dispatchEvent(
      new CustomEvent(name, { detail, bubbles: true, composed: true }),
    );
  }

  private card(map: MapInfo) {
    const favorite = this.favorites.includes(map.type);
    const name = translateText(map.translationKey);
    return html`<div class="relative min-w-0">
      <button
        class="group relative block w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-950 text-left text-white hover:border-cyan-300/60 focus-visible:outline-2 focus-visible:outline-cyan-300"
        @click=${() => this.emit("solo-map-selected", { map: map.type })}
        aria-label=${`${name} · ${translateText("geopolitics.classic")}`}
      >
        <img
          src=${terrainMapFileLoader.getMapData(map.type).webpPath}
          alt=""
          loading="lazy"
          class="h-40 w-full object-contain bg-slate-900 p-3 transition-transform group-hover:scale-105"
        />
        <div class="border-t border-white/10 p-4 pr-12">
          <p class="font-bold">${name}</p>
          <p class="mt-1 text-xs text-cyan-200">
            Configurar partida individual
          </p>
        </div>
      </button>
      <button
        class="absolute right-3 bottom-5 rounded-lg bg-slate-800 p-2 text-yellow-300 hover:bg-slate-700"
        aria-label=${`${favorite ? "Quitar de favoritos" : "Agregar a favoritos"}: ${name}`}
        aria-pressed=${favorite}
        @click=${() => {
          this.favorites = toggleFavoriteMap(map.type);
        }}
      >
        ${starIcon(favorite, "h-5 w-5")}
      </button>
    </div>`;
  }

  render() {
    const favorites = listedMaps.filter((map) =>
      this.favorites.includes(map.type),
    );
    const featured = [...listedMaps]
      .filter((map) => map.categories.includes("featured"))
      .sort((a, b) => (a.featuredRank ?? 999) - (b.featuredRank ?? 999));
    return html`<section class="space-y-5" aria-label="Partidas individuales">
      <div class="flex flex-wrap gap-3">
        <button
          class="flex-1 rounded-xl bg-cyan-600 px-6 py-4 font-bold text-white hover:bg-cyan-500"
          @click=${() => this.emit("open-solo")}
        >
          ${translateText("geopolitics.classic")}
        </button>
        <button
          class="rounded-xl bg-slate-800 px-6 py-4 font-bold text-white hover:bg-slate-700"
          @click=${() => this.emit("solo-tutorial")}
        >
          ${translateText("main.tutorial")}
        </button>
      </div>
      <button
        class="w-full rounded-xl border border-amber-300/40 bg-gradient-to-r from-slate-900 to-cyan-950 px-6 py-5 text-left text-white hover:border-amber-200"
        @click=${() => this.emit("open-geopolitics")}
      >
        <strong class="block text-xl text-amber-200"
          >${translateText("geopolitics.title")}</strong
        >
        <span class="text-sm text-slate-300"
          >${translateText("geopolitics.subtitle")}</span
        >
      </button>
      ${
        favorites.length
          ? html`<h2
                class="text-sm font-bold uppercase tracking-wider text-yellow-200"
              >
                Mapas favoritos
              </h2>
              <div class="grid gap-4 sm:grid-cols-2">
                ${favorites.map((map) => this.card(map))}
              </div>`
          : html`<p class="text-sm text-slate-400">
              Marcá un mapa con la estrella para tenerlo a mano en favoritos.
            </p>`
      }
      <h2 class="text-sm font-bold uppercase tracking-wider text-cyan-200">
        Mapas para jugar solo
      </h2>
      <div class="grid gap-4 sm:grid-cols-2">
        ${featured.map((map) => this.card(map))}
      </div>
      <p class="text-xs text-slate-400">
        Todos los mapas y dificultades están disponibles en Solo. Elegí una
        tarjeta para abrir su configuración.
      </p>
    </section>`;
  }
}
