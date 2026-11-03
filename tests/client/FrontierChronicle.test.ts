import { describe, expect, it } from "vitest";
import {
  FrontierChroniclePlayer,
  FrontierChronicleTracker,
} from "../../src/client/hud/layers/FrontierChronicleTracker";

function player(
  smallID: number,
  overrides: Partial<FrontierChroniclePlayer> = {},
): FrontierChroniclePlayer {
  return {
    smallID,
    name: "Nación " + smallID,
    isAI: true,
    isHuman: false,
    isAlive: true,
    tiles: 100,
    allies: [],
    outgoingTargets: [],
    ...overrides,
  };
}

describe("FrontierChronicleTracker", () => {
  it("uses the first observation as a baseline instead of inventing history", () => {
    const tracker = new FrontierChronicleTracker();
    expect(tracker.observe([player(1), player(2)], 0)).toEqual([]);
  });

  it("records a new front once and does not repeat it every sample", () => {
    const tracker = new FrontierChronicleTracker();
    tracker.observe([player(1), player(2)], 0);

    const started = tracker.observe(
      [player(1, { outgoingTargets: [2] }), player(2)],
      10,
    );
    const repeated = tracker.observe(
      [player(1, { outgoingTargets: [2] }), player(2)],
      20,
    );

    expect(started.map((entry) => entry.kind)).toEqual(["war"]);
    expect(repeated).toEqual([]);
  });

  it("records alliance formation and dissolution once for the pair", () => {
    const tracker = new FrontierChronicleTracker();
    tracker.observe([player(1), player(2)], 0);

    const formed = tracker.observe(
      [player(1, { allies: [2] }), player(2, { allies: [1] })],
      10,
    );
    const ended = tracker.observe([player(1), player(2)], 20);

    expect(formed.map((entry) => entry.kind)).toEqual(["alliance-formed"]);
    expect(ended.map((entry) => entry.kind)).toEqual(["alliance-ended"]);
  });

  it("records an elimination only on the alive-to-dead transition", () => {
    const tracker = new FrontierChronicleTracker();
    tracker.observe([player(1), player(2)], 0);

    const eliminated = tracker.observe(
      [player(1), player(2, { isAlive: false, tiles: 0 })],
      10,
    );
    const repeated = tracker.observe(
      [player(1), player(2, { isAlive: false, tiles: 0 })],
      20,
    );

    expect(eliminated.map((entry) => entry.kind)).toContain("elimination");
    expect(repeated).toEqual([]);
  });

  it("reports major expansion, but applies a per-faction cooldown", () => {
    const tracker = new FrontierChronicleTracker();
    tracker.observe([player(1)], 0);

    const expansion = tracker.observe([player(1, { tiles: 140 })], 10);
    const tooSoon = tracker.observe([player(1, { tiles: 200 })], 100);
    const afterCooldown = tracker.observe([player(1, { tiles: 260 })], 320);

    expect(expansion.map((entry) => entry.kind)).toContain("expansion");
    expect(tooSoon.map((entry) => entry.kind)).not.toContain("expansion");
    expect(afterCooldown.map((entry) => entry.kind)).toContain("expansion");
  });

  it("does not announce a one-tile change of map leader as a power shift", () => {
    const tracker = new FrontierChronicleTracker();
    tracker.observe([player(1, { tiles: 110 }), player(2, { tiles: 100 })], 0);

    const minorChange = tracker.observe(
      [player(1, { tiles: 110 }), player(2, { tiles: 111 })],
      10,
    );

    expect(minorChange.map((entry) => entry.kind)).not.toContain("power-shift");
  });
});
