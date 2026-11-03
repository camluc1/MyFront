/**
 * MapLayerController — loads map-layer images (off the critical path) and
 * applies initial visibility from user settings.
 *
 * The renderer tolerates missing layers (warn + skip) until images arrive,
 * so the game starts without blocking on layer images.
 */

import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import { MapLayer } from "@openfront/engine-api/game/MapFiles";
import { TerrainMapData } from "@openfront/engine-lib/game/TerrainMapLoader";
import { resourceDeposits, type NaturalResource } from "@openfront/engine-lib/game/NaturalResources";
import { EventBus } from "@openfront/shared/EventBus";
import { GameMapLoader } from "@openfront/shared/GameMapLoader";
import { Controller } from "../Controller";
import { pushMapLayerState } from "../MapLayerSettings";
import { MapRenderer } from "../render/gl";
import { UserSettings } from "../UserSettings";

export const RESOURCE_LAYER_ID = "frontier-resources";
export class ToggleResourcesEvent {
  constructor(public readonly enabled: boolean, public readonly temporary = false) {}
}
const resourceColors: Record<NaturalResource, string> = {
  fertile_soil: "#80cc62", oil: "#d89d36", gas: "#e28d38",
  coal: "#4b5969", gold: "#edc64a", silver: "#b9c5d5",
  copper: "#d57d45", iron: "#a2a6ad", lithium: "#76dbe8", uranium: "#ab79da",
};
const resourceLabels: Record<NaturalResource, string> = {
  fertile_soil: "AGR", oil: "OIL", gas: "GAS", coal: "C",
  gold: "Au", silver: "Ag", copper: "Cu", iron: "Fe",
  lithium: "Li", uranium: "U",
};
async function buildResourceLayer(map: TerrainMapData["gameMap"], type: GameMapType): Promise<ImageBitmap> {
  const canvas = document.createElement("canvas");
  canvas.width = map.width();
  canvas.height = map.height();
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Resources overlay requires a 2D canvas");
  for (const deposit of resourceDeposits(map, type)) {
    ctx.fillStyle = resourceColors[deposit.resource];
    ctx.globalAlpha = 0.76;
    ctx.beginPath();
    ctx.arc(deposit.x + 0.5, deposit.y + 0.5, deposit.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.95;
    if (deposit.radius >= 5) {
      ctx.fillStyle = "#122032";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `bold ${Math.max(5, Math.floor(deposit.radius * 0.68))}px sans-serif`;
      ctx.fillText(resourceLabels[deposit.resource], deposit.x, deposit.y,
        deposit.radius * 1.6);
    }
  }
  ctx.globalAlpha = 1;
  return createImageBitmap(canvas);
}
export class MapLayerController implements Controller {
  private resourcesEnabled = false;
  private temporaryResourcesEnabled = false;
  constructor(
    private readonly view: MapRenderer,
    private readonly gameMap: TerrainMapData,
    private readonly userSettings: UserSettings,
    private readonly gameMapType: GameMapType,
    private readonly gameMapSize: GameMapSize,
    private readonly mapLoader: GameMapLoader,
    private readonly abortSignal: AbortSignal,
    private readonly eventBus: EventBus,
  ) {}

  init() {
    this.eventBus.on(ToggleResourcesEvent, (event) => {
      if (event.temporary) {
        this.temporaryResourcesEnabled = event.enabled;
      } else {
        this.resourcesEnabled = event.enabled;
      }
      this.view.setLayerVisible(RESOURCE_LAYER_ID,
        this.resourcesEnabled || this.temporaryResourcesEnabled);
    });
    const normalLayers = this.gameMap.layers ?? [];
    const allLayers: MapLayer[] = [
      ...normalLayers,
      { id: RESOURCE_LAYER_ID, placement: "land", nukeable: false, alpha: 0.83 },
    ];
    void Promise.all([
      loadLayerImages(this.gameMapType, this.gameMapSize, this.mapLoader, normalLayers),
      buildResourceLayer(this.gameMap.gameMap, this.gameMapType),
    ]).then(([images, resources]) => {
      if (this.abortSignal.aborted) return;
      images.set(RESOURCE_LAYER_ID, resources);
      this.view.setMapLayers(allLayers, images);
      pushMapLayerState(
        this.userSettings, normalLayers,
        (id, visible) => this.view.setLayerVisible(id, visible),
        (id, alpha) => this.view.setLayerAlpha(id, alpha),
      );
      this.view.setLayerVisible(RESOURCE_LAYER_ID,
        this.resourcesEnabled || this.temporaryResourcesEnabled);
      this.view.setLayerAlpha(RESOURCE_LAYER_ID, 0.83);
    }).catch((e) =>
      console.warn("[MapLayerController] Failed to prepare map/resource layers:", e)
    );
  }
}

/**
 * Load the layer images for a map that already has layer definitions.
 * Compact games load the map4x-sized variant, matching the grid they draw on.
 */
export async function loadLayerImages(
  map: GameMapType,
  mapSize: GameMapSize,
  terrainMapFileLoader: GameMapLoader,
  layers: MapLayer[],
): Promise<Map<string, ImageBitmap>> {
  const mapFiles = terrainMapFileLoader.getMapData(map);
  const compact = mapSize === GameMapSize.Compact;
  const images = new Map<string, ImageBitmap>();
  await Promise.all(
    layers.map(async (layer) => {
      try {
        images.set(layer.id, await mapFiles.layerImage(layer.id, compact));
      } catch (e) {
        console.warn(
          `[MapLoader] Failed to load layer "${layer.id}" for map ${map}: ${e}`,
        );
      }
    }),
  );
  return images;
}
