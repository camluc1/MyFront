import defaults from "../render-settings.json";
import { enhancedVisualsEnabled } from "../EnhancedVisuals";
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
  /** Visual angular velocity (rad/s), independent of simulation heading. */
  private turnVelocity = 0;
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
  private readonly cinematicSteering = enhancedVisualsEnabled();
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
    // When a planned journey ends, coast the remaining visual offset into the
    // actual destination. The recent grid history must not tug the hull back.
    if (this.route && !route) {
      this.targetX = this.lastInputX;
      this.targetY = this.lastInputY;
      this.history = [
        this.targetX, this.targetY, this.targetX, this.targetY,
        this.targetX, this.targetY, this.targetX, this.targetY,
      ];
      this.vx = 0;
      this.vy = 0;
    }
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
      // Ease into and out of a voyage over its first/last few route steps.
      // This only warps visual progress on the same safe water centerline:
      // it neither changes engine movement nor cuts across land.
      const lastStep = this.route.lastStep;
      const ramp = Math.min(4, lastStep / 4);
      let visualStep = step;
      let speedFactor = 1;
      if (step <= 0 || step >= lastStep) {
        visualStep = Math.max(0, Math.min(lastStep, step));
        speedFactor = 0;
      } else if (ramp > 0 && step < ramp) {
        const u = step / ramp;
        visualStep = ramp * u * u * (2 - u);
        speedFactor = u * (4 - 3 * u);
      } else if (ramp > 0 && step > lastStep - ramp) {
        const u = (lastStep - step) / ramp;
        visualStep = lastStep - ramp * u * u * (2 - u);
        speedFactor = u * (4 - 3 * u);
      }
      this.routeSpeed =
        sampleSailingRoute(this.route, visualStep, this) * speedFactor;
      const desired = this.angle;
      // Path tangents are instant, but a vessel's bow has angular inertia:
      // its rotational speed accelerates and brakes instead of snapping.
      this.angle = lastHeading;
      if (!this.routeHeadingInitialized) {
        // Preserve the vessel\u0027s visible prior bearing on the first planned
        // frame. A vertical route ordered from an east-facing vessel must not
        // instantly rotate its hull by ninety degrees.
        this.turnVelocity = 0;
      }
      this.steerToward(desired, dt);
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
      this.steerToward(this.courseAngle, Math.min(0.1, dt));
    }
  }

  /**
   * Render-only critically responsive steering with bounded angular
   * acceleration. Holding turn velocity across frames avoids the mechanical
   * instant-speed changes seen when a ship enters a new course.
   */
  private steerToward(desired: number, dt: number): void {
    if (dt <= 0) return;
    const delta = Math.atan2(
      Math.sin(desired - this.angle),
      Math.cos(desired - this.angle),
    );
    const maxRate = this.cinematicSteering
      ? Math.abs(delta) > 1.35 ? 1.7 : 1.15
      : 1.45;
    const response = this.cinematicSteering ? 3.4 : 5;
    const acceleration = this.cinematicSteering ? 4.5 : 7;
    const targetRate = Math.max(-maxRate, Math.min(maxRate, delta * response));
    const change = Math.max(
      -acceleration * dt,
      Math.min(acceleration * dt, targetRate - this.turnVelocity),
    );
    this.turnVelocity += change;
    const step = this.turnVelocity * dt;
    // Never cross the target angle due to stored rotational momentum.
    if ((delta >= 0 && step >= delta) ||
        (delta <= 0 && step <= delta)) {
      this.angle += delta;
      this.turnVelocity = 0;
    } else {
      this.angle += step;
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
