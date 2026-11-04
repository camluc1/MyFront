import type { ResourceEconomyInfo } from "@openfront/engine-api/game/GameTypes";
import type { ResourceDeposit } from "@openfront/engine-lib/game/NaturalResources";
import { render } from "lit";
import { screenResourceLabels } from "../../src/client/controllers/ResourceScreenLabels";
import { renderResourceEconomy } from "../../src/client/hud/layers/ResourceEconomyDetails";
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));
test("economic card exposes quality, payout, upgrade, exhaustion and railway state", () => {
  const info: ResourceEconomyInfo = {
    resource: "gold",
    quality: 4,
    level: 1,
    remainingCycles: 0,
    renewable: false,
    productionPerCycle: 0,
    currentPerCycle: 0,
    nextPerCycle: 0,
    upgradeGainPerCycle: 0,
    railway: "active",
    reason: "exhausted",
  };
  const host = document.createElement("div");
  render(renderResourceEconomy(info), host);
  expect(host.textContent).toContain("4/4");
  expect(host.textContent).toContain("resource_economy.next");
  expect(host.textContent).toContain("resource_economy.railway.active");
  expect(host.textContent).toContain("resource_economy.exhausted");
  expect(host.querySelector('[role="status"]')).not.toBeNull();
});
test("screen labels stay anchored while zooming and cull collisions", () => {
  const deposits = Array.from({ length: 10 }, (_, id) => ({
    id,
    resource: "gold",
    x: 30 + id * 15,
    y: 40,
    radius: 10,
    quality: 1,
    capacity: 240,
  })) as ResourceDeposit[];
  for (const scale of [0.5, 1, 2, 4]) {
    const labels = screenResourceLabels(
      deposits,
      (x, y) => ({ x: x * scale, y: y * scale }),
      1000,
      600,
    );
    expect(labels.length).toBeGreaterThan(0);
    for (let i = 0; i < labels.length; i++) {
      const a = labels[i];
      expect(a.x).toBe((a.deposit.x + 0.5) * scale);
      expect(a.y).toBe((a.deposit.y + 0.5) * scale);
      for (const b of labels.slice(i + 1))
        expect(Math.abs(a.x - b.x) >= 28 || Math.abs(a.y - b.y) >= 18).toBe(
          true,
        );
    }
  }
});
