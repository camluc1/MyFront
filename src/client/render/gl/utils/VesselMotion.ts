import defaults from "../render-settings.json";

/** Render-only motion: continuous velocity and a stable course across grid stairs. */
export class VesselMotion {
  x: number;
  y: number;
  angle: number;
  private targetX: number;
  private targetY: number;
  private vx = 0;
  private vy = 0;
  private history: number[];
  private lastInputX: number;
  private lastInputY: number;
  private updatedAt: number;
  private changedAt: number;
  private sampledAt: number;
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
    this.x = lastX;
    this.y = lastY;
    this.targetX = x;
    this.targetY = y;
    this.history = [x, y, x, y, x, y, x, y];
    this.lastInputX = x;
    this.lastInputY = y;
    this.updatedAt = now;
    this.angle = Math.atan2(y - lastY, x - lastX);
    this.changedAt = this.sampledAt = now;
    this.duration = duration;
  }

  update(x: number, y: number, now: number, duration: number): void {
    if (now === this.updatedAt) return;
    this.sample(now);
    this.updatedAt = now;
    if (x !== this.lastInputX || y !== this.lastInputY) this.changedAt = now;
    this.lastInputX = x;
    this.lastInputY = y;
    this.history.splice(0, 2);
    this.history.push(x, y);
    this.targetX = 0;
    this.targetY = 0;
    for (let i = 0; i < this.history.length; i += 2) {
      this.targetX += this.history[i] / 4;
      this.targetY += this.history[i + 1] / 4;
    }
    this.duration = duration;
  }

  sample(now: number): void {
    const dt = Math.max(0, now - this.sampledAt) / 1000;
    this.sampledAt = now;
    // Exact critically damped solution. Velocity stays continuous at tick boundaries.
    const omega = this.tuning.motionResponse;
    const decay = Math.exp(-omega * dt);
    const ox = this.x - this.targetX,
      oy = this.y - this.targetY;
    const cx = this.vx + omega * ox,
      cy = this.vy + omega * oy;
    this.x = this.targetX + (ox + cx * dt) * decay;
    this.y = this.targetY + (oy + cy * dt) * decay;
    this.vx = (this.vx - omega * cx * dt) * decay;
    this.vy = (this.vy - omega * cy * dt) * decay;
    // The hull and wake follow the actual rendered velocity. Never rotate an
    // independently filtered body while it is travelling sideways.
    if (Math.hypot(this.vx, this.vy) > 0.001)
      this.angle = Math.atan2(this.vy, this.vx);
  }

  wake(now: number): number {
    return (
      Math.min(1, (Math.hypot(this.vx, this.vy) * this.duration) / 1000) *
      Math.max(
        0,
        1 -
          Math.max(0, now - this.changedAt - this.duration) /
            this.tuning.wakeFadeMs,
      )
    );
  }

  headingByte(): number {
    const turn = Math.PI * 2;
    return Math.round(((((this.angle % turn) + turn) % turn) * 255) / turn);
  }
}
