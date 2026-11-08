/**
 * Compact strategic navigation. Keep the intelligence and chronicle elements
 * mounted: their trackers and the chronicle's fixed peace timer must continue
 * updating even while a different tab is selected.
 */
export class FrontierStrategyDock extends HTMLElement {
  private active: "none" | "intelligence" | "chronicle" | "geopolitics" = "none";
  private readonly clickTab = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const tab = target.closest<HTMLButtonElement>("[data-strategy-tab]");
    if (!tab || !this.contains(tab)) return;
    event.stopPropagation();
    const next = tab.dataset.strategyTab as typeof this.active;
    if (next === "geopolitics" && !document.querySelector("geopolitics-panel")) return;
    this.active = this.active === next ? "none" : next;
    if (this.active === "geopolitics") {
      const launcher = document.querySelector<HTMLButtonElement>(
        "geopolitics-panel .launcher > button",
      );
      if (launcher?.getAttribute("aria-expanded") !== "true") launcher?.click();
    }
    this.updateTabs();
  };

  connectedCallback() {
    this.classList.add("frontier-strategy-dock");
    if (!this.querySelector(".frontier-strategy-nav")) {
      const nav = document.createElement("nav");
      nav.className = "frontier-strategy-nav";
      nav.setAttribute("aria-label", "Información estratégica");
      nav.innerHTML = `
        <button type="button" data-strategy-tab="intelligence" aria-pressed="false">◎ Inteligencia</button>
        <button type="button" data-strategy-tab="chronicle" aria-pressed="false">◈ Crónica</button>
        <button type="button" data-strategy-tab="geopolitics" aria-pressed="false">♜ Geopolítica</button>
      `;
      this.prepend(nav);
    }
    this.addEventListener("click", this.clickTab);
    this.updateTabs();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.clickTab);
  }

  private updateTabs() {
    this.dataset.active = this.active;
    for (const tab of this.querySelectorAll<HTMLButtonElement>("[data-strategy-tab]")) {
      tab.setAttribute("aria-pressed", String(tab.dataset.strategyTab === this.active));
    }
  }
}

customElements.define("frontier-strategy-dock", FrontierStrategyDock);
