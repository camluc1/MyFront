import { PlayerTypeEnum } from "../../../types";
import type { RenderSettings } from "../../RenderSettings";
import type { PlayerSlot } from "./Types";

export interface VisibleName {
  slot: PlayerSlot;
  boost: number;
  priority: number;
  score: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  worldLeft: number;
  worldRight: number;
  worldTop: number;
  worldBottom: number;
}

/** CSS-pixel layout, independent of device pixel ratio and viewport aspect ratio. */
export function projectName(
  slot: PlayerSlot,
  camera: Float32Array,
  width: number,
  height: number,
  now: number,
  ns: RenderSettings["name"],
  fontSize: number,
  fontBase: number,
  highlighted: number,
): VisibleName | null {
  if (!slot.alive || slot.nameLen === 0) return null;
  const t = Math.max(
    0,
    Math.min(1 - Math.exp(-ns.lerpSpeed * (now - slot.startTime)), 1),
  );
  const x = slot.srcX + (slot.tgtX - slot.srcX) * t;
  const y = slot.srcY + (slot.tgtY - slot.srcY) * t;
  const size = Math.max(
    1,
    Math.floor(slot.srcScale + (slot.tgtScale - slot.srcScale) * t),
  );
  const scale =
    (Math.max(4, Math.floor(size * ns.nameScaleFactor)) *
      Math.min(size * 0.25, ns.nameScaleCap)) /
    fontSize;
  const pixelsPerWorldY = Math.hypot(camera[3] * width, camera[4] * height) / 2;
  const naturalPx = scale * fontBase * pixelsPerWorldY;
  const hovered = highlighted > 0 && slot.static.smallID === highlighted;
  const human = slot.static.playerType === PlayerTypeEnum.Human;
  const priority = hovered
    ? 4
    : human
      ? 3
      : slot.target || slot.nukeTargetsMe
        ? 2
        : slot.alliance || slot.crown
          ? 1
          : 0;
  // Ordinary tiny territories do not become giant labels on a world view.
  if (
    !Number.isFinite(naturalPx) ||
    naturalPx <= 0 ||
    (priority < 2 && naturalPx < 8)
  )
    return null;
  const boost = Math.max(15, Math.min(26, naturalPx)) / naturalPx;
  const worldScale = scale * boost;
  const line = fontBase * worldScale;
  const halfW =
    Math.max(
      slot.nameHalfWidth,
      (slot.troopHalfWidth ?? 0) * ns.troopSizeMultiplier,
    ) * worldScale;
  const statusCount = [
    slot.crown,
    slot.traitor,
    slot.disconnected,
    slot.alliance,
    slot.allianceReq,
    slot.target,
    slot.embargo,
    slot.nukeActive,
    slot.inDoomsdayClock ||
      slot.doomsdayClockDraining ||
      slot.doomsdayClockDecaying,
    slot.emojiAtlasIdx >= 0,
  ].filter(Boolean).length;
  const rowHalfW = (statusCount * line * 1.265) / 2;
  const worldLeft =
    x -
    Math.max(
      halfW + (slot.flagLayerIdx >= 0 ? (line * 1.2 * 128) / 85 : 0),
      rowHalfW,
    );
  const worldRight =
    x + Math.max(halfW + (slot.static.verified ? line * 0.55 : 0), rowHalfW);
  const worldTop =
    y -
    line *
      Math.max(
        0.8,
        statusCount ? Math.max(ns.statusRowOffset, ns.emojiRowOffset) : 0,
      );
  const worldBottom = y + line * (1.24 + ns.troopSizeMultiplier);
  // Transform all corners, including rotated cameras.
  const corners = [
    [worldLeft, worldTop],
    [worldRight, worldTop],
    [worldLeft, worldBottom],
    [worldRight, worldBottom],
  ];
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const [wx, wy] of corners) {
    const sx = ((camera[0] * wx + camera[3] * wy + camera[6] + 1) * width) / 2;
    const sy = ((1 - camera[1] * wx - camera[4] * wy - camera[7]) * height) / 2;
    left = Math.min(left, sx);
    right = Math.max(right, sx);
    top = Math.min(top, sy);
    bottom = Math.max(bottom, sy);
  }
  if (right < 0 || left > width || bottom < 0 || top > height) return null;
  return {
    slot,
    boost,
    priority,
    score: naturalPx,
    left,
    right,
    top,
    bottom,
    worldLeft,
    worldRight,
    worldTop,
    worldBottom,
  };
}

/** Stable priority + spatial bins: overlap checks are local, not all-pairs. */
export function selectNames(
  candidates: VisibleName[],
  width: number,
  height: number,
  previous: ReadonlySet<number>,
): VisibleName[] {
  const limit = Math.max(8, Math.min(96, Math.floor((width * height) / 18000)));
  candidates.sort(
    (a, b) =>
      b.priority - a.priority ||
      b.score * (previous.has(b.slot.index) ? 1.15 : 1) -
        a.score * (previous.has(a.slot.index) ? 1.15 : 1) ||
      a.slot.index - b.slot.index,
  );
  const grid = new Map<string, VisibleName[]>();
  const chosen: VisibleName[] = [];
  for (const item of candidates) {
    const x0 = Math.floor(Math.max(-64, item.left - 6) / 64);
    const x1 = Math.floor(Math.min(width + 64, item.right + 6) / 64);
    const y0 = Math.floor(Math.max(-64, item.top - 6) / 64);
    const y1 = Math.floor(Math.min(height + 64, item.bottom + 6) / 64);
    const keys: string[] = [];
    let overlaps = false;
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        keys.push(key);
        if (
          grid
            .get(key)
            ?.some(
              (other) =>
                item.left < other.right + 6 &&
                item.right + 6 > other.left &&
                item.top < other.bottom + 6 &&
                item.bottom + 6 > other.top,
            )
        )
          overlaps = true;
      }
    // The hovered territory remains inspectable; all other labels yield to it.
    if (overlaps) continue;
    chosen.push(item);
    for (const key of keys) {
      const bucket = grid.get(key) ?? [];
      bucket.push(item);
      grid.set(key, bucket);
    }
    if (chosen.length >= limit) break;
  }
  return chosen;
}
