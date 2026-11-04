import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  DEFAULT_NATION_DOCTRINE,
  getNationDoctrine,
  rollDoctrineAllianceRequest,
  rollDoctrineNavalAttack,
  NATION_DOCTRINE_PROFILES,
} from "@openfront/engine/execution/nation/NationDoctrine";

describe("Nation doctrines", () => {
  const curatedCases: [string, string, string][] = [
    ["us", "United States", "imperialist"],
    ["it", "Italy", "opportunist"],
    ["de", "Germany", "industrialist"],
    ["fr", "France", "diplomatic"],
    ["gb", "United Kingdom", "diplomatic"],
    ["gb-eng", "England", "diplomatic"],
    ["au", "Australia", "strategist"],
    ["nz", "New Zealand", "strategist"],
    ["jp", "Japan", "militarist"],
    ["ru", "Russia", "militarist"],
  ];

  test.each(curatedCases)(
    "assigns a stable gameplay doctrine to %s",
    (flag, name, expected) => {
      expect(getNationDoctrine(flag, name).id).toBe(expected);
    },
  );

  test("removes the dedicated naval doctrine from the available profiles", () => {
    expect(NATION_DOCTRINE_PROFILES).toHaveLength(7);
    expect(
      NATION_DOCTRINE_PROFILES.map((doctrine) => doctrine.id),
    ).not.toContain("naval");
  });

  test("uses a flag before a localized or duplicate display name", () => {
    expect(getNationDoctrine("it", "Italy").id).toBe(
      getNationDoctrine("it", "Italia").id,
    );
  });

  test("generated nations use a stable normalized name identity", () => {
    expect(getNationDoctrine(null, "República del Sur").id).toBe(
      getNationDoctrine(null, "REPUBLICA DEL SUR").id,
    );
  });

  test("every doctrine remains expansion-capable", () => {
    for (const doctrine of NATION_DOCTRINE_PROFILES) {
      expect(
        doctrine.preferredAttackStrategies.some((strategy) =>
          [
            "bots",
            "victim",
            "veryWeak",
            "juicy",
            "weakest",
            "island",
            "crown",
          ].includes(strategy),
        ),
      ).toBe(true);
      expect(doctrine.attackCadenceMultiplier).toBeLessThanOrEqual(1.04);
      expect(doctrine.triggerRatioOffset).toBeLessThanOrEqual(0.01);
      expect(doctrine.expandRatioOffset).toBeLessThan(0);
    }
  });
});

describe("Doctrine probability direction", () => {
  test("diplomatic countries request more alliances than industrialists and militarists", () => {
    const requests = (flag: string) => {
      const random = new PseudoRandom(42);
      const draw = vi.spyOn(random, "next");
      const doctrine = getNationDoctrine(flag, flag);
      let successes = 0;
      // Exhaust the uniformly distributed draw space; no sampling noise.
      for (let roll = 0; roll < 900; roll++) {
        draw.mockReturnValue((roll + 0.5) / 900);
        if (rollDoctrineAllianceRequest(random, doctrine)) successes++;
      }
      return successes;
    };
    expect(requests("fr")).toBe(42);
    expect(requests("de")).toBe(26);
    expect(requests("us")).toBe(18);
    expect(requests("ru")).toBe(12);
  });

  test.each([5, 10] as const)(
    "naval probability increases with the multiplier at base odds %s",
    (baseOdds) => {
      const count = (flag: string) => {
        const random = new PseudoRandom(42);
        const draw = vi.spyOn(random, "next");
        const doctrine = getNationDoctrine(flag, flag);
        let successes = 0;
        for (let roll = 0; roll < baseOdds * 100; roll++) {
          draw.mockReturnValue((roll + 0.5) / (baseOdds * 100));
          if (rollDoctrineNavalAttack(random, baseOdds, doctrine)) successes++;
        }
        return successes;
      };
      expect(count("de")).toBe(75);
      expect(count("fr")).toBe(80);
      expect(count("au")).toBe(90);
      expect(count("ru")).toBe(100);
      expect(count("us")).toBe(105);
      expect(count("it")).toBe(110);
    },
  );

  test("neutral tuning preserves the legacy outcomes and PRNG stream", () => {
    const actual = new PseudoRandom(527);
    const legacy = new PseudoRandom(527);
    for (let i = 0; i < 1000; i++) {
      expect(rollDoctrineAllianceRequest(actual, DEFAULT_NATION_DOCTRINE)).toBe(
        legacy.chance(30),
      );
      for (const odds of [5, 10] as const) {
        expect(
          rollDoctrineNavalAttack(actual, odds, DEFAULT_NATION_DOCTRINE),
        ).toBe(legacy.chance(odds));
      }
    }
    expect(actual.getState()).toEqual(legacy.getState());
  });

  test("restored random state produces identical doctrine decisions", () => {
    const random = new PseudoRandom(123);
    const restored = PseudoRandom.fromState(random.getState());
    for (const doctrine of NATION_DOCTRINE_PROFILES) {
      expect(rollDoctrineAllianceRequest(random, doctrine)).toBe(
        rollDoctrineAllianceRequest(restored, doctrine),
      );
      expect(rollDoctrineNavalAttack(random, 10, doctrine)).toBe(
        rollDoctrineNavalAttack(restored, 10, doctrine),
      );
    }
    expect(random.getState()).toEqual(restored.getState());
  });
});
