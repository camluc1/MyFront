import {
  cinematicQuality, type CinematicQuality, enhancedVisualsEnabled,
  ENHANCED_VISUALS_EVENT, setCinematicQuality, setEnhancedVisuals,
} from "../render/gl/EnhancedVisuals";

const COPY = {
  en: {
    title: "Cinematic graphics", badge: "MANUAL QUALITY", label: "Cinematic quality",
    levels: ["Medium", "High", "Ultra"],
    detail: [
      "Cinematic water and rising clouds with a smaller effects budget.",
      "Detailed sea, ship wakes and smoothly animated nuclear clouds.",
      "Richer ocean lighting and surface detail, fine wakes and continuous smoke.",
    ],
    classic: "Classic graphics. The original visual profile is preserved.",
    note: "Saved on this device. Applies to the next match. Quality never drops automatically; choose a lower level here if needed. No gameplay changes.",
  },
  es: {
    title: "Gr\u00e1ficos cinematogr\u00e1ficos", badge: "CALIDAD MANUAL", label: "Calidad cinematogr\u00e1fica",
    levels: ["Media", "Alta", "Ultra"],
    detail: [
      "Agua cinematogr\u00e1fica y humo ascendente con menos efectos secundarios.",
      "Mar detallado, estelas y nubes nucleares con animaci\u00f3n suave.",
      "Agua con mayor riqueza de luz y superficie, estelas finas y humo continuo.",
    ],
    classic: "Gr\u00e1ficos cl\u00e1sicos. Se conserva el perfil visual original.",
    note: "Se guarda en este dispositivo y se aplica a la pr\u00f3xima partida. La calidad no baja sola: eleg\u00ed un nivel menor cuando lo necesites. No cambia las reglas del juego.",
  },
} as const;

export class EnhancedVisualsToggle extends HTMLElement {
  private selectedLanguage: string | undefined;
  private readonly input: HTMLInputElement;
  private readonly select: HTMLSelectElement;
  private readonly titleNode: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly note: HTMLElement;
  private readonly qualityLabel: HTMLElement;
  private readonly qualityRow: HTMLElement;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host{display:block;color:#e9f0f5;font:14px/1.5 system-ui,sans-serif}
        section{padding:18px;border:1px solid #526776;border-radius:14px;background:linear-gradient(120deg,#162c3b,#16232e)}
        .enable{display:grid;grid-template-columns:24px 1fr;gap:12px;align-items:center;cursor:pointer}
        input{margin:0;width:20px;height:20px;accent-color:#a0cfbd}
        .heading{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
        strong{font-size:16px}.badge{color:#c4dbe7;font-size:10px;letter-spacing:.1em;border:1px solid #536c7b;border-radius:6px;padding:3px 6px}
        p{margin:10px 0 0;color:#d1e0e9}.note{color:#aabfcd;font-size:12px}
        .quality{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:16px}.quality[hidden]{display:none}
        select{min-width:150px;padding:10px 36px 10px 12px;background:#132c3b;color:#edf7ff;border:1px solid #7eaaac;border-radius:8px;font:600 14px system-ui}
        input:focus-visible,select:focus-visible{outline:2px solid #b5dbc8;outline-offset:4px}
        :host([enabled]) section{border-color:#80bba4}
      </style>
      <section>
        <label class="enable"><input type="checkbox" aria-describedby="visual-detail visual-note"><span class="heading"><strong></strong><span class="badge"></span></span></label>
        <div class="quality"><label for="cinematic-quality"></label><select id="cinematic-quality" aria-describedby="visual-detail visual-note"><option value="medium"></option><option value="high"></option><option value="ultra"></option></select></div>
        <p id="visual-detail"></p><p class="note" id="visual-note"></p>
      </section>`;
    this.input = root.querySelector("input")!;
    this.select = root.querySelector("select")!;
    this.titleNode = root.querySelector("strong")!;
    this.badge = root.querySelector(".badge")!;
    this.detail = root.querySelector("#visual-detail")!;
    this.note = root.querySelector("#visual-note")!;
    this.qualityLabel = root.querySelector("label[for]")!;
    this.qualityRow = root.querySelector(".quality")!;
    this.input.addEventListener("change", () => setEnhancedVisuals(this.input.checked));
    this.select.addEventListener("change", () => setCinematicQuality(this.select.value as CinematicQuality));
  }
  connectedCallback(): void {
    window.addEventListener(ENHANCED_VISUALS_EVENT, this.refresh);
    window.addEventListener("language-selected", this.onLanguage);
    this.refresh();
  }
  disconnectedCallback(): void {
    window.removeEventListener(ENHANCED_VISUALS_EVENT, this.refresh);
    window.removeEventListener("language-selected", this.onLanguage);
  }
  private readonly onLanguage = (event: Event) => {
    const detail = (event as CustomEvent<{ lang?: string }>).detail;
    if (typeof detail?.lang === "string") this.selectedLanguage = detail.lang;
    this.refresh();
  };
  private readonly refresh = () => {
    const selector = document.querySelector("lang-selector") as (HTMLElement & { currentLang?: string }) | null;
    const language = this.selectedLanguage ?? selector?.currentLang ?? document.documentElement.lang ?? "en";
    const copy = language.toLowerCase().startsWith("es") ? COPY.es : COPY.en;
    this.titleNode.textContent = copy.title;
    this.badge.textContent = copy.badge;
    this.qualityLabel.textContent = copy.label;
    for (let i = 0; i < this.select.options.length; i++) this.select.options[i].textContent = copy.levels[i];
    this.input.checked = enhancedVisualsEnabled();
    this.select.value = cinematicQuality();
    this.select.disabled = !this.input.checked;
    this.qualityRow.hidden = !this.input.checked;
    this.detail.textContent = this.input.checked ? copy.detail[this.select.selectedIndex] : copy.classic;
    this.note.textContent = copy.note;
    this.toggleAttribute("enabled", this.input.checked);
  };
}
if (!customElements.get("enhanced-visuals-toggle")) customElements.define("enhanced-visuals-toggle", EnhancedVisualsToggle);
