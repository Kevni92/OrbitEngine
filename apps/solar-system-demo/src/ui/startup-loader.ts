export type StartupLoaderPhase = "bootstrap" | "engine" | "manifest" | "shards" | "dataset" | "scene";

export interface StartupLoaderProgress {
  readonly phase: StartupLoaderPhase;
  readonly label: string;
  readonly detail: string;
  /** A value in 0..1. Omit it while the browser cannot observe sub-phase progress. */
  readonly fraction?: number;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`Startup loader element #${id} is missing`);
  return value as T;
}

/** Owns the visible startup overlay while the first view is prepared. */
export class StartupLoader {
  readonly #root = element<HTMLElement>("startup-loader");
  readonly #phase = element<HTMLElement>("startup-loader-phase");
  readonly #progress = element<HTMLElement>("startup-loader-progress");
  readonly #percent = element<HTMLElement>("startup-loader-percent");
  readonly #detail = element<HTMLElement>("startup-loader-detail");

  setLoading(progress: StartupLoaderProgress): void {
    this.#root.dataset.state = "loading";
    this.#root.removeAttribute("aria-hidden");
    this.#phase.textContent = progress.label;
    this.#detail.textContent = progress.detail;

    if (progress.fraction === undefined) {
      this.#progress.dataset.mode = "indeterminate";
      this.#progress.removeAttribute("aria-valuenow");
      this.#percent.textContent = "Working…";
      return;
    }

    const fraction = Math.max(0, Math.min(1, progress.fraction));
    this.#progress.dataset.mode = "determinate";
    this.#progress.style.setProperty("--startup-progress", String(fraction));
    const percentage = Math.round(fraction * 100);
    this.#progress.setAttribute("aria-valuenow", String(percentage));
    this.#percent.textContent = `${percentage}%`;
  }

  setReady(detail = "Your Solar System is ready."): void {
    this.#root.dataset.state = "ready";
    this.#root.setAttribute("aria-hidden", "true");
    this.#phase.textContent = "Ready";
    this.#percent.textContent = "100%";
    this.#detail.textContent = detail;
  }

  setError(detail: string): void {
    this.#root.dataset.state = "error";
    this.#root.removeAttribute("aria-hidden");
    this.#phase.textContent = "We couldn’t load the Solar System";
    this.#percent.textContent = "—";
    this.#detail.textContent = detail;
    this.#progress.dataset.mode = "error";
    this.#progress.removeAttribute("aria-valuenow");
  }
}
