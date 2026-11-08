import { expect, it } from "vitest";
import { render } from "lit";
import { renderTroops } from "@openfront/engine-lib/Format";
import { ControlPanel } from "../../src/client/hud/layers/ControlPanel";

it("shows available soldiers and the actual max-troop capacity in the bottom desktop HUD", () => {
  const panel = document.createElement("control-panel") as ControlPanel;
  const values = panel as unknown as Record<string, unknown>;
  values._troops = 85_000;
  values._maxTroops = 150_000;
  values._attackingTroops = 0;
  values.troopRate = 20;
  values._gold = 0n;
  values.attackRatio = 0.2;

  const container = document.createElement("div");
  render((panel as any).renderDesktop(), container);

  const expected = `Soldados: ${renderTroops(85_000)} de ${renderTroops(150_000)} de capacidad máxima`;
  const counter = container.querySelector(`[aria-label="${expected}"]`);
  expect(counter).not.toBeNull();
  expect(counter?.textContent?.replace(/\\s+/g, " ").trim()).toBe(
    `${renderTroops(85_000)} / ${renderTroops(150_000)}`,
  );
  expect(container.textContent).toContain("ACTUALES / MÁX.");
});
