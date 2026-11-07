/** Presentation-only, timed centerline. Source tile indexes retain engine arrival times. */
export interface SailingSegment {
  start: number;
  end: number;
  ax: number;
  ay: number;
  cx: number;
  cy: number;
  bx: number;
  by: number;
}
export interface SailingRoute {
  planId: number;
  startTick: number;
  ticksPerStep: number;
  segments: SailingSegment[];
  lastStep: number;
}
export interface SailingPlan {
  planId: number;
  startTick: number;
  ticksPerStep: number;
  path: Uint32Array;
}
interface Point {
  x: number;
  y: number;
  t: number;
}

export function buildSailingRoute(
  plan: SailingPlan,
  width: number,
  canSail: (x: number, y: number) => boolean,
): SailingRoute {
  const path = plan.path;
  const point = (i: number): Point => ({
    x: path[i] % width,
    y: Math.floor(path[i] / width),
    t: i,
  });
  const clear = (a: Point, b: Point) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4));
    for (let j = 1; j < n; j++) {
      const u = j / n;
      if (
        !canSail(
          Math.floor(a.x + (b.x - a.x) * u + 0.5),
          Math.floor(a.y + (b.y - a.y) * u + 0.5),
        )
      )
        return false;
    }
    return true;
  };
  const keep = new Set<number>([0, path.length - 1]);
  const stack = [[0, path.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    const a = point(lo),
      b = point(hi),
      dx = b.x - a.x,
      dy = b.y - a.y,
      len2 = dx * dx + dy * dy;
    let error = 0,
      split = lo + 1;
    for (let i = lo + 1; i < hi; i++) {
      const p = point(i),
        u = len2
          ? Math.max(
              0,
              Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2),
            )
          : 0;
      const d = (p.x - a.x - u * dx) ** 2 + (p.y - a.y - u * dy) ** 2;
      if (d > error) {
        error = d;
        split = i;
      }
    }
    if (error > 2.25 || !clear(a, b)) {
      if (error <= 2.25) split = (lo + hi) >>> 1;
      keep.add(split);
      stack.push([lo, split], [split, hi]);
    }
  }
  const points = [...keep].sort((a, b) => a - b).map(point);
  const segments: SailingSegment[] = [];
  const line = (a: Point, b: Point) => {
    if (b.t > a.t)
      segments.push({
        start: a.t,
        end: b.t,
        ax: a.x,
        ay: a.y,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        bx: b.x,
        by: b.y,
      });
  };
  let previous = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1],
      p = points[i],
      b = points[i + 1];
    const l1 = Math.hypot(p.x - a.x, p.y - a.y),
      l2 = Math.hypot(b.x - p.x, b.y - p.y),
      cut = Math.min(1, l1 * 0.2, l2 * 0.2);
    if (cut < 0.01) {
      line(previous, p);
      previous = p;
      continue;
    }
    const f = cut / l1,
      g = cut / l2;
    const enter = {
        x: p.x + (a.x - p.x) * f,
        y: p.y + (a.y - p.y) * f,
        t: p.t + (a.t - p.t) * f,
      },
      exit = {
        x: p.x + (b.x - p.x) * g,
        y: p.y + (b.y - p.y) * g,
        t: p.t + (b.t - p.t) * g,
      };
    let safe = true;
    for (let j = 0; j <= 8; j++) {
      const u = j / 8,
        v = 1 - u;
      const x = v * v * enter.x + 2 * v * u * p.x + u * u * exit.x,
        y = v * v * enter.y + 2 * v * u * p.y + u * u * exit.y;
      if (!canSail(Math.floor(x + 0.5), Math.floor(y + 0.5))) {
        safe = false;
        break;
      }
    }
    if (safe) {
      line(previous, enter);
      segments.push({
        start: enter.t,
        end: exit.t,
        ax: enter.x,
        ay: enter.y,
        cx: p.x,
        cy: p.y,
        bx: exit.x,
        by: exit.y,
      });
      previous = exit;
    } else {
      line(previous, p);
      previous = p;
    }
  }
  if (points.length > 1) line(previous, points[points.length - 1]);
  if (!segments.length) {
    const p = point(0);
    segments.push({
      start: 0,
      end: 1,
      ax: p.x,
      ay: p.y,
      cx: p.x,
      cy: p.y,
      bx: p.x,
      by: p.y,
    });
  }
  return {
    planId: plan.planId,
    startTick: plan.startTick,
    ticksPerStep: plan.ticksPerStep,
    segments,
    lastStep: path.length - 1,
  };
}

export function sampleSailingRoute(
  route: SailingRoute,
  step: number,
  out: { x: number; y: number; angle: number },
): number {
  const s = route.segments;
  let lo = 0,
    hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (step > s[mid].end) lo = mid + 1;
    else hi = mid;
  }
  const p = s[lo],
    u = Math.max(
      0,
      Math.min(1, (step - p.start) / Math.max(0.0001, p.end - p.start)),
    ),
    v = 1 - u;
  out.x = v * v * p.ax + 2 * v * u * p.cx + u * u * p.bx;
  out.y = v * v * p.ay + 2 * v * u * p.cy + u * u * p.by;
  const dx = 2 * (v * (p.cx - p.ax) + u * (p.bx - p.cx)),
    dy = 2 * (v * (p.cy - p.ay) + u * (p.by - p.cy));
  if (Math.hypot(dx, dy) > 0.0001) out.angle = Math.atan2(dy, dx);
  return step < 0 || step >= route.lastStep
    ? 0
    : Math.hypot(dx, dy) / (p.end - p.start);
}
