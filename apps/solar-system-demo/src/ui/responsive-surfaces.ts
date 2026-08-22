type Surface = "controls" | "browser";

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`Responsive surface element #${id} is missing`);
  return value as T;
}

/** Keeps the two dense UI surfaces independently reachable on phone-sized viewports. */
export class ResponsiveSurfaceManager {
  readonly #shell = document.querySelector<HTMLElement>(".demo-shell");
  readonly #controls = element<HTMLElement>("demo-panel");
  readonly #browser = element<HTMLElement>("celestial-browser");
  readonly #controlsToggle = element<HTMLButtonElement>("mobile-controls-toggle");
  readonly #browserToggle = element<HTMLButtonElement>("mobile-browser-toggle");
  readonly #mediaQuery = window.matchMedia("(max-width: 640px)");
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.#mediaQuery.matches || this.#activeSurface === undefined) return;
    const closedSurface = this.#activeSurface;
    this.#activeSurface = undefined;
    this.#render();
    this.#toggleFor(closedSurface).focus();
  };
  readonly #onMediaChange = (): void => {
    if (this.#mediaQuery.matches && this.#activeSurface === undefined) this.#activeSurface = "controls";
    this.#render();
  };
  #activeSurface: Surface | undefined;

  constructor() {
    if (this.#shell === null) throw new Error("Responsive surface shell is missing");
    this.#controlsToggle.addEventListener("click", () => this.#toggleSurface("controls"));
    this.#browserToggle.addEventListener("click", () => this.#toggleSurface("browser"));
    document.addEventListener("keydown", this.#onKeyDown);
    this.#mediaQuery.addEventListener("change", this.#onMediaChange);
    if (this.#mediaQuery.matches) this.#activeSurface = "controls";
    this.#render();
  }

  dispose(): void {
    document.removeEventListener("keydown", this.#onKeyDown);
    this.#mediaQuery.removeEventListener("change", this.#onMediaChange);
  }

  #toggleSurface(surface: Surface): void {
    this.#activeSurface = this.#activeSurface === surface ? undefined : surface;
    this.#render();
    if (this.#activeSurface === surface) {
      window.requestAnimationFrame(() => this.#focusSurface(surface));
    }
  }

  #focusSurface(surface: Surface): void {
    const target = surface === "controls"
      ? this.#controls.querySelector<HTMLElement>("#panel-toggle, #control-nav button")
      : this.#browser.querySelector<HTMLElement>("#celestial-browser-toggle, #celestial-browser-search");
    target?.focus();
  }

  #toggleFor(surface: Surface): HTMLButtonElement {
    return surface === "controls" ? this.#controlsToggle : this.#browserToggle;
  }

  #render(): void {
    const mobile = this.#mediaQuery.matches;
    this.#shell?.classList.toggle("is-mobile-surfaces", mobile);
    const controlsActive = !mobile || this.#activeSurface === "controls";
    const browserActive = !mobile || this.#activeSurface === "browser";
    this.#controls.classList.toggle("mobile-surface-hidden", !controlsActive);
    this.#browser.classList.toggle("mobile-surface-hidden", !browserActive);
    this.#controls.setAttribute("aria-hidden", String(!controlsActive));
    this.#browser.setAttribute("aria-hidden", String(!browserActive));
    this.#controlsToggle.setAttribute("aria-expanded", String(controlsActive));
    this.#browserToggle.setAttribute("aria-expanded", String(browserActive));
    this.#controlsToggle.dataset.state = controlsActive ? "open" : "closed";
    this.#browserToggle.dataset.state = browserActive ? "open" : "closed";
  }
}
