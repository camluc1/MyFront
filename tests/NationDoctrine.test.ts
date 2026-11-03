import {
  getNationDoctrine,
  NATION_DOCTRINE_PROFILES,
} from "@openfront/engine/execution/nation/NationDoctrine";

describe("Nation doctrines", () => {
  const curatedCases: [string, string, string][] = [
    ["us", "United States", "imperialist"],
    ["it", "Italy", "opportunist"],
    ["de", "Germany", "industrialist"],
    ["fr", "France", "diplomatic"],
    ["gb", "United Kingdom", "naval"],
    ["gb-eng", "England", "naval"],
    ["ru", "Russia", "militarist"],
  ];

  test.each(curatedCases)(
    "assigns a stable gameplay doctrine to %s",
    (flag, name, expected) => {
      expect(getNationDoctrine(flag, name).id).toBe(expected);
    },
  );

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
