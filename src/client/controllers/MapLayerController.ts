import type { TransformHandler } from "../TransformHandler";
import { ResourceScreenLabels } from "./ResourceScreenLabels";
/**
 * MapLayerController — loads map-layer images (off the critical path) and
 * applies initial visibility from user settings.
 *
 * The renderer tolerates missing layers (warn + skip) until images arrive,
 * so the game starts without blocking on layer images.
 */

import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import { MapLayer } from "@openfront/engine-api/game/MapFiles";
import { resourceDeposits } from "@openfront/engine-lib/game/NaturalResources";
import { TerrainMapData } from "@openfront/engine-lib/game/TerrainMapLoader";
import { EventBus } from "@openfront/shared/EventBus";
import { GameMapLoader } from "@openfront/shared/GameMapLoader";
import { Controller } from "../Controller";
import { pushMapLayerState } from "../MapLayerSettings";
import { MapRenderer } from "../render/gl";
import { UserSettings } from "../UserSettings";
import { layoutResourceMarkers, RESOURCE_STYLE } from "./ResourceMarkers";

export const RESOURCE_LAYER_ID = "frontier-resources";
export class ToggleResourcesEvent {
  constructor(
    public readonly enabled: boolean,
    public readonly temporary = false,
  ) {}
}
async function buildResourceLayer(
  map: TerrainMapData["gameMap"],
  type: GameMapType,
  screenLabels = false,
): Promise<ImageBitmap> {
  const canvas = document.createElement("canvas");
  canvas.width = map.width();
  canvas.height = map.height();
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Resources overlay requires a 2D canvas");
  const deposits = resourceDeposits(map, type);
  const markers = layoutResourceMarkers(deposits, canvas.width, canvas.height);
  // Extraction footprints and marker centers use the same map coordinates.
  for (const deposit of deposits) {
    const { color } = RESOURCE_STYLE[deposit.resource];
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(deposit.x + 0.5, deposit.y + 0.5, deposit.radius, 0, Math.PI * 2);
    ctx.globalAlpha = 0.06;
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  for (const marker of screenLabels ? [] : markers) {
    const { color, symbol } = RESOURCE_STYLE[marker.deposit.resource];
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#101b2b";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, marker.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${marker.radius * (symbol.length > 2 ? 0.85 : 1.1)}px sans-serif`;
    ctx.fillText(symbol, marker.x, marker.y + 0.25, marker.radius * 1.75);
  }
  ctx.globalAlpha = 1;
  return createImageBitmap(canvas);
}
export class MapLayerController implements Controller {
  private resourcesEnabled = false;
  private temporaryResourcesEnabled = false;
  private screenLabels?: ResourceScreenLabels;
  constructor(
    private readonly view: MapRenderer,
    private readonly gameMap: TerrainMapData,
    private readonly userSettings: UserSettings,
    private readonly gameMapType: GameMapType,
    private readonly gameMapSize: GameMapSize,
    private readonly mapLoader: GameMapLoader,
    private readonly abortSignal: AbortSignal,
    private readonly eventBus: EventBus,
    private transform?: TransformHandler,
  ) {}

  setTransform(transform: TransformHandler): void {
    this.transform = transform;
  }

  init() {
    if (this.transform)
      this.screenLabels = new ResourceScreenLabels(
        resourceDeposits(this.gameMap.gameMap, this.gameMapType),
        this.transform,
        this.abortSignal,
      );
    this.eventBus.on(ToggleResourcesEvent, (event) => {
      if (event.temporary) {
        this.temporaryResourcesEnabled = event.enabled;
      } else {
        this.resourcesEnabled = event.enabled;
      }
      if (this.screenLabels)
        this.screenLabels.visible =
          this.resourcesEnabled || this.temporaryResourcesEnabled;
      this.view.setLayerVisible(
        RESOURCE_LAYER_ID,
        this.resourcesEnabled || this.temporaryResourcesEnabled,
      );
    });
    const normalLayers = this.gameMap.layers ?? [];
    const allLayers: MapLayer[] = [
      ...normalLayers,
      { id: RESOURCE_LAYER_ID, placement: "land", nukeable: false, alpha: 1 },
    ];
    void Promise.all([
      loadLayerImages(
        this.gameMapType,
        this.gameMapSize,
        this.mapLoader,
        normalLayers,
      ),
      buildResourceLayer(
        this.gameMap.gameMap,
        this.gameMapType,
        !!this.transform,
      ),
    ])
      .then(([images, resources]) => {
        if (this.abortSignal.aborted) return;
        images.set(RESOURCE_LAYER_ID, resources);
        this.view.setMapLayers(allLayers, images);
        pushMapLayerState(
          this.userSettings,
          normalLayers,
          (id, visible) => this.view.setLayerVisible(id, visible),
          (id, alpha) => this.view.setLayerAlpha(id, alpha),
        );
        this.view.setLayerVisible(
          RESOURCE_LAYER_ID,
          this.resourcesEnabled || this.temporaryResourcesEnabled,
        );
        this.view.setLayerAlpha(RESOURCE_LAYER_ID, 1);
      })
      .catch((e) =>
        console.warn(
          "[MapLayerController] Failed to prepare map/resource layers:",
          e,
        ),
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
