import type { ResourceEconomyInfo } from "@openfront/engine-api/game/GameTypes";
import type { GameEvent } from "@openfront/shared/EventBus";
export class ResourceEconomyPreviewEvent implements GameEvent {
  constructor(public readonly info: ResourceEconomyInfo | null) {}
}
