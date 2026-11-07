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
  private targetAngle: number;
  private directions: number[];
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
    this.directions = [x - lastX, y - lastY];
    this.angle = this.targetAngle = Math.atan2(y - lastY, x - lastX);
    this.changedAt = this.sampledAt = now;
    this.duration = duration;
  }

  update(x: number, y: number, now: number, duration: number): void {
    if (x === this.targetX && y === this.targetY) return;
    this.sample(now);
    this.directions.push(x - this.targetX, y - this.targetY);
    if (this.directions.length > 12) this.directions.splice(0, 2);
    let dx = 0,
      dy = 0;
    for (let i = 0; i < this.directions.length; i += 2) {
      dx += this.directions[i];
      dy += this.directions[i + 1];
    }
    if (dx !== 0 || dy !== 0) {
      const desired = Math.atan2(dy, dx);
      const delta = Math.atan2(
        Math.sin(desired - this.targetAngle),
        Math.cos(desired - this.targetAngle),
      );
      // Hysteresis prevents tiny alternating course corrections from rocking the hull.
      if (Math.abs(delta) > this.tuning.courseDeadbandRadians)
        this.targetAngle += delta;
    }
    this.targetX = x;
    this.targetY = y;
    this.changedAt = now;
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
    const delta = Math.atan2(
      Math.sin(this.targetAngle - this.angle),
      Math.cos(this.targetAngle - this.angle),
    );
    this.angle +=
      delta * (1 - Math.exp((-dt * 1000) / this.tuning.turnDurationMs));
  }

  wake(now: number): number {
    if (this.directions.every((v) => v === 0)) return 0;
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
