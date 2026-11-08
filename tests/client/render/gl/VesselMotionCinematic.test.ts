import { afterEach, describe, expect, it } from "vitest";
import { setEnhancedVisuals } from "../../../../src/client/render/gl/EnhancedVisuals";
import { VesselMotion } from "../../../../src/client/render/gl/utils/VesselMotion";

afterEach(() => setEnhancedVisuals(false));

describe("cinematic vessel movement", () => {
  it("limits visible yaw during a planned tight ninety-degree bend", () => {
    setEnhancedVisuals(true);
    const vessel = new VesselMotion(1,0,0,0,0,100);
    const route = {
      planId: 1, startTick: 0, ticksPerStep: 1, lastStep: 9,
      segments: [
        {start:0,end:4,ax:0,ay:0,cx:2,cy:0,bx:4,by:0},
        {start:4,end:9,ax:4,ay:0,cx:4,cy:2.5,bx:4,by:5},
      ],
    };
    vessel.setRoute(route,0,0);
    vessel.sample(50);
    let heading = vessel.angle;
    for (let tick=1;tick<30;tick++) {
      vessel.setRoute(route,tick,tick*100);
      vessel.sample(tick*100+50);
      const delta=Math.atan2(Math.sin(vessel.angle-heading),
        Math.cos(vessel.angle-heading));
      expect(Math.abs(delta)).toBeLessThanOrEqual(0.105);
      heading=vessel.angle;
    }
    expect(vessel.angle).toBeGreaterThan(1.15);
    expect(vessel.angle).toBeLessThanOrEqual(Math.PI/2+0.01);
  });
  it("preserves route positions independently of cinematic steering", () => {
    const run=(cinematic:boolean)=>{
      setEnhancedVisuals(cinematic);
      const m=new VesselMotion(1,0,0,0,0,100);
      const route={planId:1,startTick:0,ticksPerStep:1,lastStep:4,
        segments:[{start:0,end:4,ax:0,ay:0,cx:2,cy:1,bx:4,by:2}]};
      m.setRoute(route,2,200);
      m.sample(250);
      return {x:m.x,y:m.y};
    };
    expect(run(true)).toEqual(run(false));
  });
});
