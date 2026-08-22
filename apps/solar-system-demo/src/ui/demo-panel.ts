import { objectId, type ObjectId, type OrbitEngine, type PropagationState, type SimulationInstant } from "orbit-engine";
import type { RegisteredScenarioBody } from "../scenario/load-solar-system.js";
import type { LodDiagnostics } from "../rendering/representation-lod.js";
import type { RepresentationLevel } from "../rendering/representation-lod.js";
import {
  formatDistance,
  formatExactInstant,
  formatMass,
  formatModel,
  formatObjectType,
  formatRadius,
  formatSimulationTime,
  formatSpeed,
  formatVector,
} from "./formatters.js";
import { formatLocalDateTimeInput } from "./civil-time.js";

export interface DemoPanelOptions {
  readonly onPlayPause?: () => void;
  readonly onWarpChange?: (warpFactor: number) => void;
  readonly onFocusChange?: (objectId: ObjectId) => void;
  readonly onSelectedChange?: (objectId: ObjectId) => void;
  readonly onCenterSelected?: () => void;
  readonly onRadiusModeChange?: (mode: "adaptive" | "physical") => void;
  readonly onAddAsteroids?: (count: number, seed: string) => void;
  readonly onRemoveAsteroids?: () => void;
  readonly onGridChange?: (visible: boolean) => void;
  readonly onOrbitsChange?: (visible: boolean) => void;
  readonly onAxesChange?: (visible: boolean) => void;
  readonly onExactJump?: (seconds: number, nanoseconds: number) => void;
  readonly onLocalDateTimeJump?: (value: string) => void;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`Demo panel element #${id} is missing`);
  return value as T;
}

function setStatus(value: HTMLElement, state: string, message: string): void {
  value.dataset.state = state;
  value.textContent = message;
}

export class DemoPanel {
  readonly #panel = element<HTMLElement>("demo-panel");
  readonly #engineStatus = element<HTMLElement>("engine-status");
  readonly #renderingStatus = element<HTMLElement>("rendering-status");
  readonly #scenarioNote = element<HTMLElement>("scenario-note");
  readonly #simulationTime = element<HTMLElement>("simulation-instant");
  readonly #simulationError = element<HTMLElement>("simulation-error");
  readonly #playPause = element<HTMLButtonElement>("play-pause");
  readonly #warpSelect = element<HTMLSelectElement>("warp-select");
  readonly #focusSelect = element<HTMLSelectElement>("focus-select");
  readonly #selectedSelect = element<HTMLSelectElement>("selected-select");
  readonly #radiusMode = element<HTMLSelectElement>("radius-mode");
  readonly #populationCount = element<HTMLInputElement>("population-count");
  readonly #populationSeed = element<HTMLInputElement>("population-seed");
  readonly #addAsteroids = element<HTMLButtonElement>("add-asteroids");
  readonly #removeAsteroids = element<HTMLButtonElement>("remove-asteroids");
  readonly #populationStatus = element<HTMLElement>("population-status");
  readonly #populationDiagnostics = element<HTMLElement>("population-diagnostics");
  readonly #hierarchyDiagnostics = element<HTMLElement>("hierarchy-diagnostics");
  readonly #focusSelected = element<HTMLButtonElement>("focus-selected");
  readonly #jumpSeconds = element<HTMLInputElement>("jump-seconds");
  readonly #jumpNanoseconds = element<HTMLInputElement>("jump-nanoseconds");
  readonly #jumpTime = element<HTMLButtonElement>("jump-time");
  readonly #jumpError = element<HTMLElement>("jump-error");
  readonly #localDateTime = element<HTMLInputElement>("jump-local-datetime");
  readonly #localDateTimeJump = element<HTMLButtonElement>("jump-local-time");
  readonly #localDateTimeError = element<HTMLElement>("local-jump-error");
  #localDateTimeDraft = false;
  readonly #selectedName = element<HTMLElement>("selected-name");
  readonly #selectedType = element<HTMLElement>("selected-type");
  readonly #summaryDistance = element<HTMLElement>("summary-distance");
  readonly #summarySpeed = element<HTMLElement>("summary-speed");
  readonly #summaryRadius = element<HTMLElement>("summary-radius");
  readonly #summaryMass = element<HTMLElement>("summary-mass");
  readonly #summaryModel = element<HTMLElement>("summary-model");
  readonly #technicalDetails = element<HTMLElement>("technical-details");
  readonly #focusContext = element<HTMLElement>("focus-context");
  readonly #orbitStatus = element<HTMLElement>("orbit-status");
  readonly #engineDetails = element<HTMLElement>("engine-details");
  readonly #renderingDetails = element<HTMLElement>("rendering-details");
  readonly #panelToggle = element<HTMLButtonElement>("panel-toggle");
  readonly #gridToggle = element<HTMLButtonElement>("grid-toggle");
  readonly #orbitsToggle = element<HTMLButtonElement>("orbits-toggle");
  readonly #axesToggle = element<HTMLButtonElement>("axes-toggle");
  readonly #gridState = element<HTMLElement>("grid-state");
  readonly #orbitsState = element<HTMLElement>("orbits-state");
  readonly #axesState = element<HTMLElement>("axes-state");
  readonly #selectedBodySection = element<HTMLElement>("selected-body-section");
  readonly #options: DemoPanelOptions;

  constructor(options: DemoPanelOptions = {}) {
    this.#options = options;
    this.#playPause.addEventListener("click", () => this.#options.onPlayPause?.());
    this.#warpSelect.addEventListener("change", () => this.#options.onWarpChange?.(Number(this.#warpSelect.value)));
    this.#focusSelect.addEventListener("change", () => this.#options.onFocusChange?.(this.focusId()));
    this.#selectedSelect.addEventListener("change", () => this.#options.onSelectedChange?.(this.selectedId()));
    this.#focusSelected.addEventListener("click", () => this.#options.onCenterSelected?.());
    this.#radiusMode.addEventListener("change", () => {
      const value = this.#radiusMode.value === "physical" ? "physical" : "adaptive";
      this.#options.onRadiusModeChange?.(value);
    });
    this.#addAsteroids.addEventListener("click", () => {
      this.#options.onAddAsteroids?.(Number(this.#populationCount.value), this.#populationSeed.value);
    });
    this.#removeAsteroids.addEventListener("click", () => this.#options.onRemoveAsteroids?.());
    this.#gridToggle.addEventListener("click", () => {
      const visible = !this.isPressed(this.#gridToggle);
      this.setToggle(this.#gridToggle, this.#gridState, visible);
      this.#options.onGridChange?.(visible);
    });
    this.#orbitsToggle.addEventListener("click", () => {
      const visible = !this.isPressed(this.#orbitsToggle);
      this.setToggle(this.#orbitsToggle, this.#orbitsState, visible);
      this.#options.onOrbitsChange?.(visible);
    });
    this.#axesToggle.addEventListener("click", () => {
      const visible = !this.isPressed(this.#axesToggle);
      this.setToggle(this.#axesToggle, this.#axesState, visible);
      this.#options.onAxesChange?.(visible);
    });
    this.#jumpTime.addEventListener("click", () => {
      this.clearExactJumpError();
      this.#options.onExactJump?.(Number(this.#jumpSeconds.value), Number(this.#jumpNanoseconds.value));
    });
    this.#localDateTimeJump.addEventListener("click", () => {
      this.clearLocalDateTimeJumpError();
      this.#options.onLocalDateTimeJump?.(this.#localDateTime.value);
    });
    this.#localDateTime.addEventListener("input", () => {
      this.#localDateTimeDraft = true;
    });
    this.#panelToggle.addEventListener("click", () => {
      const collapsed = this.#panel.classList.toggle("is-collapsed");
      this.#panelToggle.setAttribute("aria-expanded", String(!collapsed));
      this.#panelToggle.textContent = collapsed ? "Show panel" : "Hide panel";
      this.#panelToggle.setAttribute("aria-label", collapsed ? "Show control panel" : "Hide control panel");
    });
  }

  populateBodies(entries: readonly RegisteredScenarioBody[]): void {
    const options = entries.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.definition.id;
      option.textContent = entry.definition.name;
      return option;
    });
    this.#focusSelect.replaceChildren(...options.map((option) => option.cloneNode(true)));
    this.#selectedSelect.replaceChildren(...options);
    this.#focusSelect.disabled = false;
    this.#selectedSelect.disabled = false;
  }

  setEngineStatus(state: string, message: string, details = ""): void {
    setStatus(this.#engineStatus, state, message);
    this.#engineDetails.textContent = details;
  }

  setRenderingStatus(state: string, message: string, details = ""): void {
    setStatus(this.#renderingStatus, state, message);
    this.#renderingDetails.textContent = details;
  }

  setScenarioNote(state: string, message: string): void {
    setStatus(this.#scenarioNote, state, message);
  }

  setControlsReady(ready: boolean): void {
    this.#playPause.disabled = !ready;
    this.#focusSelected.disabled = !ready;
    this.#warpSelect.disabled = !ready;
    this.#radiusMode.disabled = !ready;
    this.#gridToggle.disabled = !ready;
    this.#orbitsToggle.disabled = !ready;
    this.#axesToggle.disabled = !ready;
    this.#jumpSeconds.disabled = !ready;
    this.#jumpNanoseconds.disabled = !ready;
    this.#jumpTime.disabled = !ready;
    this.#localDateTime.disabled = !ready;
    this.#localDateTimeJump.disabled = !ready;
    this.#populationCount.disabled = !ready;
    this.#populationSeed.disabled = !ready;
    this.#addAsteroids.disabled = !ready;
    this.#removeAsteroids.disabled = !ready;
  }

  setSimulationTime(instant: SimulationInstant, playing: boolean): void {
    this.#simulationTime.textContent = formatSimulationTime(instant);
    if (!this.#localDateTimeDraft) this.#localDateTime.value = formatLocalDateTimeInput(instant);
    this.#playPause.textContent = playing ? "Pause" : "Play";
    this.#playPause.setAttribute("aria-label", playing ? "Pause simulation" : "Play simulation");
  }

  syncLocalDateTime(instant: SimulationInstant): void {
    this.#localDateTimeDraft = false;
    this.#localDateTime.value = formatLocalDateTimeInput(instant);
  }

  setSimulationError(message: string): void {
    setStatus(this.#simulationError, "error", message);
  }

  clearSimulationError(): void {
    setStatus(this.#simulationError, "pending", "");
  }

  setFocusId(objectIdValue: ObjectId): void {
    this.#focusSelect.value = objectIdValue;
    this.#focusContext.textContent = `${this.#focusSelect.selectedOptions[0]?.textContent ?? objectIdValue} · render origin`;
  }

  setSelectedId(objectIdValue: ObjectId): void {
    this.#selectedSelect.value = objectIdValue;
  }

  focusId(): ObjectId {
    return objectId(this.#focusSelect.value);
  }

  selectedId(): ObjectId {
    return objectId(this.#selectedSelect.value);
  }

  setGuideSettings(settings: { readonly gridVisible: boolean; readonly axesVisible: boolean }): void {
    this.setToggle(this.#gridToggle, this.#gridState, settings.gridVisible);
    this.setToggle(this.#axesToggle, this.#axesState, settings.axesVisible);
  }

  setOrbitsVisible(visible: boolean): void {
    this.setToggle(this.#orbitsToggle, this.#orbitsState, visible);
  }

  setOrbitStatus(state: string, message: string): void {
    setStatus(this.#orbitStatus, state, message);
  }

  setSelectedBody(
    entry: RegisteredScenarioBody,
    state: PropagationState,
    focusState: PropagationState | undefined,
    representation: RepresentationLevel | undefined = undefined,
    parentRepresentation: RepresentationLevel | undefined = undefined,
  ): void {
    const properties = entry.record.properties;
    this.#selectedName.textContent = entry.definition.name;
    this.#selectedType.textContent = formatObjectType(entry.definition.type);
    this.#summaryDistance.textContent = formatDistance(Math.hypot(state.position.x, state.position.y, state.position.z));
    this.#summarySpeed.textContent = formatSpeed(state);
    this.#summaryRadius.textContent = properties.physicalRadius === undefined ? "—" : formatRadius(properties.physicalRadius);
    this.#summaryMass.textContent = formatMass(properties.mass);
    this.#summaryModel.textContent = formatModel(entry.record.motion.modelKind);
    this.#selectedBodySection.dataset.objectId = entry.definition.id;
    this.#selectedBodySection.dataset.hasFocusState = String(focusState !== undefined);
    this.#selectedBodySection.dataset.representation = representation ?? "unknown";
    this.#selectedBodySection.dataset.parentRepresentation = parentRepresentation ?? "unknown";
  }

  setTechnicalDetails(
    entry: RegisteredScenarioBody,
    state: PropagationState,
    focusId: ObjectId,
    health: ReturnType<OrbitEngine["health"]>,
  ): void {
    const properties = entry.record.properties;
    this.#technicalDetails.textContent = [
      `ObjectId: ${entry.definition.id}`,
      `Type: ${entry.definition.type}`,
      `Reference frame: ${state.referenceFrame}`,
      `View center: ${focusId}`,
      formatExactInstant(state.epoch),
      `Position (m): ${formatVector(state.position)}`,
      `Velocity (m/s): ${formatVector(state.velocity)}`,
      `Mass (kg): ${properties.mass ?? "n/a"}`,
      `μ (m³/s²): ${properties.mu ?? "n/a"}`,
      `Motion model: ${entry.record.motion.modelKind}`,
      `Motion revision: ${entry.record.motion.motionRevision}`,
      `Configuration revision: ${entry.record.motion.configurationRevision}`,
      `Reference status: ${entry.record.referenceStatus}`,
      `Backend: WASM · protocol ${health.protocolVersion} · core ${health.coreVersion}`,
    ].join("\n");
  }

  setExactJumpError(message: string): void {
    setStatus(this.#jumpError, "error", message);
  }

  clearExactJumpError(): void {
    setStatus(this.#jumpError, "pending", "");
  }

  setLocalDateTimeJumpError(message: string): void {
    setStatus(this.#localDateTimeError, "error", message);
  }

  clearLocalDateTimeJumpError(): void {
    setStatus(this.#localDateTimeError, "pending", "");
  }

  setPopulationStatus(state: string, message: string): void {
    setStatus(this.#populationStatus, state, message);
  }

  setPopulationDiagnostics(generatedCount: number, diagnostics: LodDiagnostics): void {
    this.#populationDiagnostics.textContent = [
      `Generated asteroids: ${generatedCount}`,
      `Registered objects: ${diagnostics.registeredCount}`,
      `Queried objects: ${diagnostics.queriedCount}`,
      `Hidden: ${diagnostics.hiddenCount}`,
      `Markers: ${diagnostics.markerCount}`,
      `Spheres: ${diagnostics.sphereCount}`,
      `Promoted runtime spheres: ${diagnostics.promotedRuntimeSphereCount}`,
    ].join(" · ");
  }

  setHierarchyDiagnostics(representation: RepresentationLevel | undefined): void {
    const target = representation ?? "pending";
    this.#hierarchyDiagnostics.textContent = `Europa representation: ${target}`;
  }

  #isPressed(button: HTMLButtonElement): boolean {
    return button.getAttribute("aria-pressed") === "true";
  }

  isPressed(button: HTMLButtonElement): boolean {
    return this.#isPressed(button);
  }

  #setToggle(button: HTMLButtonElement, state: HTMLElement, pressed: boolean): void {
    button.setAttribute("aria-pressed", String(pressed));
    state.textContent = pressed ? "On" : "Off";
    state.dataset.state = pressed ? "on" : "off";
  }

  setToggle(button: HTMLButtonElement, state: HTMLElement, pressed: boolean): void {
    this.#setToggle(button, state, pressed);
  }
}
