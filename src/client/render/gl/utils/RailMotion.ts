/** A rail vehicle follows its current track segment, without ship course inertia. */
export class RailMotion {
  x: number;
  y: number;
  angle: number;
  private fromX: number;
  private fromY: number;
  private targetX: number;
  private targetY: number;
  private fromAngle: number;
  private targetAngle: number;
  private startedAt: number;

  constructor(
    x: number,
    y: number,
    lastX: number,
    lastY: number,
    now: number,
    private duration: number,
  ) {
    this.x = this.fromX = lastX;
    this.y = this.fromY = lastY;
    this.targetX = x;
    this.targetY = y;
    this.angle =
      this.fromAngle =
      this.targetAngle =
        Math.atan2(y - lastY, x - lastX);
    this.startedAt = now;
  }

  update(x: number, y: number, now: number, duration: number): void {
    if (x === this.targetX && y === this.targetY) return;
    this.sample(now);
    const desired = Math.atan2(y - this.targetY, x - this.targetX);
    this.fromX = this.x;
    this.fromY = this.y;
    this.fromAngle = this.angle;
    this.targetAngle =
      this.angle +
      Math.atan2(
        Math.sin(desired - this.angle),
        Math.cos(desired - this.angle),
      );
    this.targetX = x;
    this.targetY = y;
    this.startedAt = now;
    this.duration = duration;
  }

  sample(now: number): void {
    const t = Math.max(0, Math.min(1, (now - this.startedAt) / this.duration));
    this.x = this.fromX + (this.targetX - this.fromX) * t;
    this.y = this.fromY + (this.targetY - this.fromY) * t;
    this.angle = this.fromAngle + (this.targetAngle - this.fromAngle) * t;
  }

  wake(): number {
    return 0;
  }
  headingByte(): number {
    const turn = Math.PI * 2;
    return Math.round(((((this.angle % turn) + turn) % turn) * 255) / turn);
  }
}
