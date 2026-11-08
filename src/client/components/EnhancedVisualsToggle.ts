import {
  enhancedVisualsEnabled,
  ENHANCED_VISUALS_EVENT,
  setEnhancedVisuals,
} from "../render/gl/EnhancedVisuals";

const COPY = {
  en: {
    title: "Cinematic graphics",
    badge: "OPTIONAL",
    detail: "Richer water, wakes and explosions. Adaptive water detail protects frame pacing without forcing 4K.",
    note: "This device only. Off by default. Applies when the next match starts; no gameplay advantage.",
  },
  es: {
    title: "Gr\u00e1ficos cinematogr\u00e1ficos",
    badge: "OPCIONAL",
    detail: "Agua, estelas y explosiones con m\u00e1s detalle. El agua se adapta al rendimiento sin forzar 4K.",
    note: "Solo este dispositivo. Desactivado por defecto. Se aplica al iniciar la pr\u00f3xima partida; no da ventajas de juego.",
  },
} as const;

/** Local presentation preference, deliberately separate from host/game rules. */
export class EnhancedVisualsToggle extends HTMLElement {
  private selectedLanguage: string | undefined;
  private readonly input: HTMLInputElement;
  private readonly titleNode: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly note: HTMLElement;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    // Static markup only: localized strings are assigned with textContent.
    root.innerHTML = `
      <style>
        :host { display:block; color:#e9f0f5; font:14px/1.5 system-ui,sans-serif; }
        label { display:grid; grid-template-columns:24px 1fr; align-items:start; gap:12px; padding:18px; border:1px solid #526776; border-radius:14px; background:linear-gradient(120deg,#162c3b,#16232e); cursor:pointer; }
        label:focus-within { outline:2px solid #b5dbc8; outline-offset:3px; }
        input { margin:4px 0 0; width:20px; height:20px; accent-color:#a0cfbd; }
        .heading { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
        strong { font-size:16px; font-weight:750; }
        .badge { color:#adc5d3; font-size:10px; letter-spacing:.1em; border:1px solid #536c7b; border-radius:6px; padding:3px 6px; }
        p { margin:7px 0 0; color:#c4d4de; }
        .note { color:#9db3c1; font-size:12px; }
        :host([enabled]) label { border-color:#80bba4; background:linear-gradient(120deg,#1c3d43,#182e3b); }
        @media(prefers-reduced-motion:reduce) { * { animation:none; transition:none; } }
      </style>
      <label>
        <input type="checkbox" aria-describedby="visual-detail visual-note">
        <span><span class="heading"><strong></strong><span class="badge"></span></span>
          <p id="visual-detail"></p><p class="note" id="visual-note"></p>
        </span>
      </label>`;
    this.input = root.querySelector("input")!;
    this.titleNode = root.querySelector("strong")!;
    this.badge = root.querySelector(".badge")!;
    this.detail = root.querySelector("#visual-detail")!;
    this.note = root.querySelector("#visual-note")!;
    this.input.addEventListener("change", () => {
      setEnhancedVisuals(this.input.checked);
      this.refresh();
    });
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
    const selector = document.querySelector("lang-selector") as
      (HTMLElement & { currentLang?: string }) | null;
    const language = this.selectedLanguage ?? selector?.currentLang ??
      document.documentElement.lang ?? "en";
    const copy = language.toLowerCase().startsWith("es") ? COPY.es : COPY.en;
    this.titleNode.textContent = copy.title;
    this.badge.textContent = copy.badge;
    this.detail.textContent = copy.detail;
    this.note.textContent = copy.note;
    this.input.checked = enhancedVisualsEnabled();
    this.toggleAttribute("enabled", this.input.checked);
  };
}

if (!customElements.get("enhanced-visuals-toggle")) {
  customElements.define("enhanced-visuals-toggle", EnhancedVisualsToggle);
}
