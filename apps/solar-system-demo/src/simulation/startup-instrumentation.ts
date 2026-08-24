export const STARTUP_MILESTONES = [
  "bootstrap-start",
  "wasm-engine-ready",
  "manifest-ready",
  "required-oep-data-ready",
  "dataset-ready",
  "webgl-ready",
  "scene-ready",
  "first-state-frame-ready",
  "first-rendered-frame",
  "deferred-orbit-population-complete",
] as const;

export type StartupMilestone = (typeof STARTUP_MILESTONES)[number];

export interface StartupDiagnostics {
  readonly milestones: Readonly<Record<StartupMilestone, number | undefined>>;
}

const MARK_PREFIX = "orbit-demo:startup:";

function now(): number {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

/**
 * Lightweight, first-write-only startup markers for browser diagnostics.
 * Values are relative to the browser performance timeline, not simulation time.
 */
export class StartupInstrumentation {
  readonly #startedAt = now();
  readonly #milestones = new Map<StartupMilestone, number>();

  mark(milestone: StartupMilestone): void {
    if (this.#milestones.has(milestone)) return;
    const timestamp = now();
    if (typeof globalThis.performance?.mark === "function") {
      globalThis.performance.mark(`${MARK_PREFIX}${milestone}`);
    }
    this.#milestones.set(milestone, timestamp);
  }

  diagnostics(): StartupDiagnostics {
    const milestones = Object.fromEntries(
      STARTUP_MILESTONES.map((milestone) => [milestone, this.#milestones.get(milestone)]),
    ) as Record<StartupMilestone, number | undefined>;
    return Object.freeze({
      milestones: Object.freeze(milestones),
    });
  }

  elapsedSinceStart(): number {
    return now() - this.#startedAt;
  }
}

export function startupMarkName(milestone: StartupMilestone): string {
  return `${MARK_PREFIX}${milestone}`;
}
