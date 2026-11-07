/** Orient each rail vehicle from two axle positions on its recorded track. */
export class RailMotion {
  x: number;
  y: number;
  angle: number;
  private path: number[];
  private targetX: number;
  private targetY: number;
  private segmentLength: number;
  private startedAt: number;
  constructor(
    x: number,
    y: number,
    lastX: number,
    lastY: number,
    now: number,
    private duration: number,
  ) {
    this.path = [lastX, lastY, x, y];
    this.targetX = x;
    this.targetY = y;
    this.segmentLength = Math.hypot(x - lastX, y - lastY);
    this.startedAt = now;
    this.x = lastX;
    this.y = lastY;
    this.angle = Math.atan2(y - lastY, x - lastX);
  }
  update(x: number, y: number, now: number, duration: number): void {
    if (x === this.targetX && y === this.targetY) return;
    this.segmentLength = Math.hypot(x - this.targetX, y - this.targetY);
    this.path.push(x, y);
    if (this.path.length > 32) this.path.splice(0, 2);
    this.targetX = x;
    this.targetY = y;
    this.startedAt = now;
    this.duration = duration;
  }
  private pointBehind(distance: number): [number, number] {
    const p = this.path;
    for (let i = p.length - 2; i >= 2; i -= 2) {
      const dx = p[i] - p[i - 2],
        dy = p[i + 1] - p[i - 1],
        length = Math.hypot(dx, dy);
      if (length > 0 && distance <= length)
        return [
          p[i] - (dx * distance) / length,
          p[i + 1] - (dy * distance) / length,
        ];
      distance -= length;
    }
    return [p[0], p[1]];
  }
  sample(now: number): void {
    const t = Math.max(0, Math.min(1, (now - this.startedAt) / this.duration));
    const back = (1 - t) * this.segmentLength;
    const front = this.pointBehind(back),
      rear = this.pointBehind(back + 1);
    this.x = (front[0] + rear[0]) / 2;
    this.y = (front[1] + rear[1]) / 2;
    if (Math.hypot(front[0] - rear[0], front[1] - rear[1]) > 0.001)
      this.angle = Math.atan2(front[1] - rear[1], front[0] - rear[0]);
  }
  wake(): number {
    return 0;
  }
  headingByte(): number {
    const turn = Math.PI * 2;
    return Math.round(((((this.angle % turn) + turn) % turn) * 255) / turn);
  }
}
