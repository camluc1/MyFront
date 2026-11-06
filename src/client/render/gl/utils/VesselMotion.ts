import defaults from "../render-settings.json";
/** Render-only interpolation. Never changes simulation positions or orders. */
export class VesselMotion {
  x: number;
  y: number;
  angle: number;
  private fromX: number;
  private fromY: number;
  private targetX: number;
  private targetY: number;
  private fromAngle: number;
  private targetAngle: number;
  private dx: number;
  private dy: number;
  private changedAt: number;
  private duration: number;

  constructor(
    x: number,
    y: number,
    lastX: number,
    lastY: number,
    now: number,
    duration: number,
    private tuning = defaults.unit,
  ) {
    this.x = this.fromX = lastX;
    this.y = this.fromY = lastY;
    this.targetX = x;
    this.targetY = y;
    this.dx = x - lastX;
    this.dy = y - lastY;
    this.angle =
      this.fromAngle =
      this.targetAngle =
        Math.atan2(this.dy, this.dx);
    this.changedAt = now;
    this.duration = duration;
  }

  update(x: number, y: number, now: number, duration: number): void {
    // Snapshots can repeat lastPos for several ticks. Do not replay that step.
    if (x === this.targetX && y === this.targetY) return;
    this.sample(now);
    const dx = x - this.targetX,
      dy = y - this.targetY;
    this.fromX = this.x;
    this.fromY = this.y;
    this.targetX = x;
    this.targetY = y;
    this.fromAngle = this.angle;
    // Average trajectory across grid steps instead of pointing at each stair.
    this.dx =
      this.dx * this.tuning.headingMemory +
      dx * (1 - this.tuning.headingMemory);
    this.dy =
      this.dy * this.tuning.headingMemory +
      dy * (1 - this.tuning.headingMemory);
    const desired = Math.atan2(this.dy, this.dx);
    this.targetAngle =
      this.angle +
      Math.atan2(
        Math.sin(desired - this.angle),
        Math.cos(desired - this.angle),
      );
    this.changedAt = now;
    this.duration = duration;
  }

  sample(now: number): void {
    const t = Math.max(0, now - this.changedAt);
    const progress = Math.min(1, t / this.duration);
    this.x = this.fromX + (this.targetX - this.fromX) * progress;
    this.y = this.fromY + (this.targetY - this.fromY) * progress;
    const turn = Math.min(
      1,
      t / Math.max(this.tuning.turnDurationMs, this.duration),
    );
    this.angle = this.fromAngle + (this.targetAngle - this.fromAngle) * turn;
  }

  wake(now: number): number {
    if (this.dx === 0 && this.dy === 0) return 0;
    return Math.max(
      0,
      1 -
        Math.max(0, now - this.changedAt - this.duration) /
          this.tuning.wakeFadeMs,
    );
  }

  headingByte(): number {
    const turn = Math.PI * 2;
    return Math.round(((((this.angle % turn) + turn) % turn) * 255) / turn);
  }
}
