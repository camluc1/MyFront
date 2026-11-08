import { describe, expect, it } from "vitest";
import { FxSpritePass } from "../../../../src/client/render/gl/passes/fx-pass/FxSpritePass";

const createPass = (cinematic = true, assetsReady = true) => {
  const pass = Object.create(FxSpritePass.prototype) as FxSpritePass;
  Object.assign(pass, {
    cinematic,
    cinematicNukeReady: assetsReady,
    cinematicImpactReady: assetsReady,
    activeFx: [],
  });
  return pass;
};
const fxState = (pass: FxSpritePass) =>
  (pass as unknown as {activeFx: Array<{fxType:number;lifetimeMs:number}>}).activeFx;

describe("V5 cinematic FX budgets and identity", () => {
  it("limits long-lived mushroom clouds to ten even during massive MIRV strikes", () => {
    const pass = createPass();
    for (let i = 0; i < 80; i++) pass.pushFx(i, 0, 0, i*10);
    expect(fxState(pass).filter((fx) => fx.fxType === 0)).toHaveLength(10);
    expect(fxState(pass).every((fx) => fx.lifetimeMs === 3200)).toBe(true);
  });

  it("gives conventional fireballs distinct short lifetimes", () => {
    const pass = createPass();
    pass.pushFx(1,1,2,0);
    pass.pushFx(1,1,3,0);
    pass.pushFx(1,1,4,0);
    expect(fxState(pass).map((fx) => fx.lifetimeMs)).toEqual([1200,900,700]);
  });

  it("keeps the original sprite durations when cinematic assets are unavailable", () => {
    const pass = createPass(true,false);
    pass.pushFx(0,0,0,0);
    pass.pushFx(0,0,4,0);
    expect(fxState(pass).map((fx) => fx.lifetimeMs)).toEqual([630,280]);
  });

  it("never changes the normal graphics effect durations", () => {
    const pass = createPass(false,true);
    pass.pushFx(0,0,0,0);
    pass.pushFx(0,0,4,0);
    expect(fxState(pass).map((fx) => fx.lifetimeMs)).toEqual([630,280]);
  });
});
