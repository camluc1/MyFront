import defaults from "../render-settings.json";
import { sampleSailingRoute, type SailingRoute } from "./SailingRoute";

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
  private course: number[];
  private courseAngle: number;
  private lastCourseAngle = 0;
  private stableCourseSamples = 0;
  private route?: SailingRoute;
  private routeTick = 0;
  private routeAt = -1;
  private routeSpeed = 0;
  private routeHeadingInitialized = false;
  private anchorX = 0;
  private anchorY = 0;

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
    this.course = [lastX, lastY, x, y];
    this.courseAngle = this.angle;
    this.changedAt = this.sampledAt = now;
    this.duration = duration;
    this.anchorX = this.x;
    this.anchorY = this.y;
  }

  setRoute(route: SailingRoute | undefined, tick: number, now: number) {
    const changed = this.route !== route;
    this.route = route;
    if (
      changed ||
      tick !== this.routeTick ||
      now === this.routeAt ||
      this.routeAt < 0
    ) {
      this.routeTick = tick;
      this.routeAt = now;
    }
  }
  update(x: number, y: number, now: number, duration: number): void {
    if (now === this.updatedAt) return;
    this.sample(now);
    this.updatedAt = now;
    if (x !== this.lastInputX || y !== this.lastInputY) {
      if (now - this.changedAt > Math.max(500, this.duration * 3))
        this.course = [this.lastInputX, this.lastInputY];
      this.changedAt = now;
      this.course.push(x, y);
      if (this.course.length > 26) this.course.splice(0, 2);
      const dx = x - this.course[0],
        dy = y - this.course[1];
      if (Math.hypot(dx, dy) > 0.5) {
        const desired = Math.atan2(dy, dx);
        const delta = Math.atan2(
          Math.sin(desired - this.courseAngle),
          Math.cos(desired - this.courseAngle),
        );
        // Ignore the alternating bearings produced by raster stairs. Actual
        // bends accumulate beyond the hysteresis and turn the hull smoothly.
        this.stableCourseSamples =
          Math.abs(
            Math.atan2(
              Math.sin(desired - this.lastCourseAngle),
              Math.cos(desired - this.lastCourseAngle),
            ),
          ) < 0.002
            ? this.stableCourseSamples + 1
            : 0;
        this.lastCourseAngle = desired;
        if (Math.abs(delta) > Math.PI / 15 || this.stableCourseSamples >= 4)
          this.courseAngle = desired;
      }
    }
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
    if (!this.route) {
      const dx = Math.cos(this.courseAngle),
        dy = Math.sin(this.courseAngle);
      const lateral =
        (this.targetX - this.anchorX) * -dy +
        (this.targetY - this.anchorY) * dx;
      // The sub-tile corridor removes lateral stair motion. Real bends and
      // stops recenter it; the body follows the resulting trajectory tangent.
      if (Math.abs(lateral) > 0.7 || now - this.changedAt > duration * 2) {
        this.anchorX = this.targetX;
        this.anchorY = this.targetY;
      } else {
        const along =
          (this.targetX - this.anchorX) * dx +
          (this.targetY - this.anchorY) * dy;
        this.targetX = this.anchorX + along * dx;
        this.targetY = this.anchorY + along * dy;
      }
    }
    this.duration = duration;
  }

  sample(now: number): void {
    if (this.route) {
      const dt = Math.max(0, Math.min(0.1,
        (now - this.sampledAt) / 1000));
      const lastHeading = this.angle;
      const fraction = Math.min(
        1,
        Math.max(0, (now - this.routeAt) / Math.max(1, this.duration)),
      );
      const step =
        (this.routeTick + fraction - this.route.startTick) /
        Math.max(1, this.route.ticksPerStep);
      this.routeSpeed = sampleSailingRoute(this.route, step, this);
      const desired = this.angle;
      // The sailing centerline remains authoritative, but the ship itself
      // turns with bounded angular velocity rather than visibly snapping
      // between control points on long or stair-stepped naval routes.
      const delta = Math.atan2(
        Math.sin(desired - lastHeading), Math.cos(desired - lastHeading));
      const maxTurn = Math.PI * 0.62 * dt;
      this.angle = !this.routeHeadingInitialized ? desired :
        lastHeading + Math.max(-maxTurn, Math.min(maxTurn, delta));
      this.routeHeadingInitialized = true;
      this.sampledAt = now;
      return;
    }
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
    // A stable navigational bearing avoids left-right wiggle from the
    // spring's tiny lateral corrections along rasterized water paths.
    if (
      now - this.changedAt <= this.duration * 2 &&
      Math.hypot(this.vx, this.vy) > 0.001
    ) {
      const delta = Math.atan2(
        Math.sin(this.courseAngle - this.angle),
        Math.cos(this.courseAngle - this.angle),
      );
      const step = delta * (1 - Math.exp(-5 * dt));
      this.angle += Math.max(
        (-Math.PI / 2) * dt,
        Math.min((Math.PI / 2) * dt, step),
      );
    }
  }

  wake(now: number): number {
    if (this.route) return Math.min(1, this.routeSpeed);
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
