import { describe, expect, it } from "vitest";
import {
  FrontierWorldIntelligenceTracker,
  type FrontierWorldPlayerInput,
} from "../../src/client/hud/layers/FrontierWorldIntelligenceTracker";

function country(
  smallID: number,
  overrides: Partial<FrontierWorldPlayerInput> = {},
): FrontierWorldPlayerInput {
  return {
    smallID,
    name: "Country " + smallID,
    kind: "nation",
    isAlive: true,
    isMe: false,
    tiles: 100,
    gold: 5000,
    goldEarned: 10000,
    tradeGold: 2000,
    trainGold: 1000,
    piracyGold: 0,
    troops: 10000,
    maxTroops: 20000,
    cities: 3,
    factories: 2,
    ports: 1,
    silos: 0,
    sams: 1,
    warships: 0,
    allies: 1,
    betrayals: 0,
    outgoingAttacks: 0,
    incomingAttacks: 0,
    ...overrides,
  };
}

describe("FrontierWorldIntelligenceTracker", () => {
  it("records an initial baseline and samples on simulation time", () => {
    const tracker = new FrontierWorldIntelligenceTracker();

    expect(tracker.observe([country(1)], 0)).toBe(true);
    expect(tracker.players()).toHaveLength(1);
    expect(tracker.players()[0].goldIncomePerMin).toBe(0);

    expect(tracker.observe([country(1, { tiles: 110 })], 99)).toBe(false);
    expect(tracker.observe([country(1, { tiles: 120 })], 100)).toBe(true);
    expect(tracker.players()[0].tiles).toBe(120);
    expect(tracker.historyFor(1)).toHaveLength(2);
  });

  it("waits for a full rate window before extrapolating per-minute income", () => {
    const tracker = new FrontierWorldIntelligenceTracker();
    tracker.observe([country(1)], 0);
    tracker.observe([country(1, { goldEarned: 5000 })], 300);

    expect(tracker.players()[0].goldIncomePerMin).toBe(0);
  });

  it("derives gold-source rates from cumulative values over game ticks", () => {
    const tracker = new FrontierWorldIntelligenceTracker();
    tracker.observe([country(1)], 0);
    tracker.observe(
      [
        country(1, {
          goldEarned: 12000,
          tradeGold: 3000,
          trainGold: 1500,
          piracyGold: 250,
        }),
      ],
      600,
    );

    const current = tracker.players()[0];
    expect(current.goldIncomePerMin).toBe(2000);
    expect(current.shipTradeGoldPerMin).toBe(1000);
    expect(current.trainTradeGoldPerMin).toBe(500);
    expect(current.piracyGoldPerMin).toBe(250);
  });

  it("resets the session history when replay time moves backwards", () => {
    const tracker = new FrontierWorldIntelligenceTracker();
    tracker.observe([country(1)], 1000);
    tracker.observe([country(1, { tiles: 150 })], 1100);

    expect(tracker.observe([country(1, { tiles: 80 })], 10)).toBe(true);
    expect(tracker.historyFor(1)).toHaveLength(1);
    expect(tracker.players()[0].tiles).toBe(80);
    expect(tracker.players()[0].goldIncomePerMin).toBe(0);
  });
});
