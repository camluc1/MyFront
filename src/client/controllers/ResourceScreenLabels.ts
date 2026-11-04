import { Cell } from "@openfront/engine-api/game/GameTypes";
import type { ResourceDeposit } from "@openfront/engine-lib/game/NaturalResources";
import type { TransformHandler } from "../TransformHandler";
import { RESOURCE_STYLE } from "./ResourceMarkers";

/** Cull crowded labels instead of displacing them away from exploitable land. */
export function screenResourceLabels(
  deposits: readonly ResourceDeposit[],
  project: (x: number, y: number) => { x: number; y: number },
  width: number,
  height: number,
) {
  const labels: { deposit: ResourceDeposit; x: number; y: number }[] = [];
  const cells = new Set<string>();
  for (const deposit of deposits) {
    const point = project(deposit.x + 0.5, deposit.y + 0.5);
    if (
      point.x < 16 ||
      point.y < 12 ||
      point.x > width - 16 ||
      point.y > height - 12
    )
      continue;
    const minX = Math.floor((point.x - 16) / 32),
      maxX = Math.floor((point.x + 16) / 32);
    const minY = Math.floor((point.y - 12) / 24),
      maxY = Math.floor((point.y + 12) / 24);
    const keys: string[] = [];
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) keys.push(`${x},${y}`);
    if (keys.some((key) => cells.has(key))) continue;
    for (const key of keys) cells.add(key);
    labels.push({ deposit, ...point });
  }
  return labels;
}
export class ResourceScreenLabels {
  private canvas = document.createElement("canvas");
  private frame = 0;
  public visible = false;
  constructor(
    private deposits: readonly ResourceDeposit[],
    private transform: TransformHandler,
    signal: AbortSignal,
  ) {
    this.canvas.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:10";
    this.canvas.setAttribute("aria-hidden", "true");
    if (signal.aborted) return;
    document.body.appendChild(this.canvas);
    const draw = () => {
      this.draw();
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
    signal.addEventListener(
      "abort",
      () => {
        cancelAnimationFrame(this.frame);
        this.canvas.remove();
      },
      { once: true },
    );
  }
  private draw() {
    this.canvas.hidden = !this.visible;
    if (!this.visible) return;
    const width = window.innerWidth,
      height = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    if (
      this.canvas.width !== Math.round(width * dpr) ||
      this.canvas.height !== Math.round(height * dpr)
    ) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const label of screenResourceLabels(
      this.deposits,
      (x, y) => this.transform.worldToScreenCoordinates(new Cell(x, y)),
      width,
      height,
    )) {
      const style = RESOURCE_STYLE[label.deposit.resource];
      ctx.fillStyle = "#101b2b";
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 1;
      ctx.fillRect(label.x - 14, label.y - 9, 28, 18);
      ctx.strokeRect(label.x - 14, label.y - 9, 28, 18);
      ctx.fillStyle = style.color;
      ctx.fillText(style.symbol, label.x, label.y);
    }
  }
}
