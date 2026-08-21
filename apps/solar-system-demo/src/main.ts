import { createDemoEngine } from "./engine/create-engine.js";
import {
  createAnimationLoop,
  createRenderShell,
  WebGL2UnavailableError,
  type RenderShell,
} from "./rendering/three-shell.js";
import { SimulationClock } from "./simulation/simulation-clock.js";
import { StateQueryCoordinator } from "./simulation/state-query-coordinator.js";
import { loadSolarSystemScenario, type SolarSystemScenario } from "./scenario/load-solar-system.js";
import { SolarSystemStateSource, type ScenarioStateFrame } from "./scenario/state-source.js";
import { EARTH_ID, SCENARIO_ROOT_FRAME, SUN_ID } from "./scenario/scenario-data.js";
import { SolarSystemScene } from "./rendering/solar-system-scene.js";
import { objectId, type ObjectId, type OrbitEngine, type PropagationState } from "orbit-engine";

const engineStatus = document.querySelector<HTMLElement>("#engine-status");
const renderingStatus = document.querySelector<HTMLElement>("#rendering-status");
const simulationInstant = document.querySelector<HTMLElement>("#simulation-instant");
const playPause = document.querySelector<HTMLButtonElement>("#play-pause");
const scenarioNote = document.querySelector<HTMLElement>("#scenario-note");
const focusContext = document.querySelector<HTMLElement>("#focus-context");
const focusSelect = document.querySelector<HTMLSelectElement>("#focus-select");
const selectedSelect = document.querySelector<HTMLSelectElement>("#selected-select");
const radiusMode = document.querySelector<HTMLSelectElement>("#radius-mode");
const focusSelected = document.querySelector<HTMLButtonElement>("#focus-selected");
const selectedPanel = document.querySelector<HTMLElement>("#selected-panel");
const canvas = document.querySelector<HTMLCanvasElement>("#scene");
const clock = new SimulationClock();

function formatInstant(): string {
  const instant = clock.currentInstant();
  return `${instant.seconds}s + ${instant.nanoseconds}ns`;
}

function updateClockUi(): void {
  if (simulationInstant !== null) simulationInstant.textContent = formatInstant();
  if (playPause !== null) playPause.textContent = clock.isPlaying() ? "Pause" : "Play";
}

function setStatus(element: HTMLElement | null, state: string, message: string): void {
  if (element === null) return;
  element.dataset.state = state;
  element.textContent = message;
}

function formatVector(value: { readonly x: number; readonly y: number; readonly z: number }): string {
  return `(${value.x.toExponential(6)}, ${value.y.toExponential(6)}, ${value.z.toExponential(6)})`;
}

function formatState(state: PropagationState): string {
  return `epoch ${state.epoch.seconds}s + ${state.epoch.nanoseconds}ns\nframe ${state.referenceFrame}\npos ${formatVector(state.position)} m\nvel ${formatVector(state.velocity)} m/s`;
}

function populateBodySelect(select: HTMLSelectElement | null, scenario: SolarSystemScenario): void {
  if (select === null) return;
  select.replaceChildren(...scenario.bodies.map((entry) => {
    const option = document.createElement("option");
    option.value = entry.definition.id;
    option.textContent = `${entry.definition.name} (${entry.definition.id})`;
    return option;
  }));
  select.disabled = false;
}

async function bootstrap(): Promise<void> {
  updateClockUi();
  if (canvas === null) {
    setStatus(engineStatus, "error", "Canvas element is missing.");
    return;
  }

  let engine: OrbitEngine;
  try {
    engine = await createDemoEngine();
    const health = engine.health();
    setStatus(engineStatus, "ready", `WASM ready · protocol ${health.protocolVersion} · core ${health.coreVersion}`);
    if (playPause !== null) playPause.disabled = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(engineStatus, "error", `WASM initialization failed: ${message}`);
    return;
  }

  let scenario: SolarSystemScenario;
  try {
    scenario = loadSolarSystemScenario(engine);
    if (scenario.bodies.length !== 10) throw new Error(`Expected 10 bodies, received ${scenario.bodies.length}`);
    if (scenario.rootFrame !== SCENARIO_ROOT_FRAME) throw new Error("Scenario root frame is not the engine root frame");
    if (scenario.bodyById.get(EARTH_ID) === undefined) throw new Error("Scenario Earth registration is missing");
    setStatus(scenarioNote, "ready", `Offline deterministic scenario ready · ${scenario.bodies.length} bodies · no runtime network`);
    populateBodySelect(focusSelect, scenario);
    populateBodySelect(selectedSelect, scenario);
    if (focusSelect !== null) focusSelect.value = SUN_ID;
    if (selectedSelect !== null) selectedSelect.value = SUN_ID;
    if (focusSelected !== null) focusSelected.disabled = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(scenarioNote, "error", `Scenario loading failed: ${message}`);
    return;
  }

  let renderShell: RenderShell | undefined;
  let solarSystemScene: SolarSystemScene | undefined;
  let focusId: ObjectId = SUN_ID;
  const stateSource = new SolarSystemStateSource(engine, scenario);
  const coordinator = new StateQueryCoordinator<ScenarioStateFrame>({
    source: {
      query: (request) => {
        const requestedFocus = request.contextKey.startsWith("focus:")
          ? objectId(request.contextKey.slice("focus:".length))
          : focusId;
        return stateSource.query(requestedFocus, request.target);
      },
    },
    onSnapshot: (snapshot) => {
      solarSystemScene?.update(snapshot.value.states);
      updateSelectedPanel(scenario, snapshot.value);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(scenarioNote, "error", `State query failed: ${message}`);
    },
  });

  function requestCurrentState(): void {
    coordinator.request(clock.currentInstant(), `focus:${focusId}`);
    if (focusContext !== null) focusContext.textContent = `${focusId} / ${scenario.rootFrame}`;
  }

  function updateSelectedPanel(currentScenario: SolarSystemScenario, frame: ScenarioStateFrame): void {
    if (selectedPanel === null) return;
    const selectedId = selectedSelect === null ? SUN_ID : objectId(selectedSelect.value || SUN_ID);
    const index = currentScenario.objectIds.indexOf(selectedId);
    const entry = currentScenario.bodyById.get(selectedId);
    const state = index < 0 ? undefined : frame.states[index];
    if (entry === undefined || state === undefined) {
      selectedPanel.textContent = "Selected state unavailable.";
      return;
    }
    const properties = entry.record.properties;
    selectedPanel.textContent = `${entry.definition.name} · ObjectId ${entry.definition.id} · ${entry.definition.type}\n` +
      `mass ${properties.mass ?? "n/a"} kg · μ ${properties.mu ?? "n/a"} m³/s² · radius ${properties.physicalRadius ?? "n/a"} m\n` +
      `model ${entry.record.motion.modelKind} · motion rev ${entry.record.motion.motionRevision}\n${formatState(state)}`;
  }

  try {
    renderShell = createRenderShell(canvas);
    setStatus(renderingStatus, "ready", "WebGL 2 ready · identity axes · +Z up");
    solarSystemScene = new SolarSystemScene(renderShell.scene, scenario, {
      onSelect: (objectId) => {
        if (selectedSelect !== null) selectedSelect.value = objectId;
        const snapshot = coordinator.latestSnapshot();
        if (snapshot !== undefined) updateSelectedPanel(scenario, snapshot.value);
      },
    });
    solarSystemScene.setSelected(SUN_ID);
  } catch (error) {
    if (error instanceof WebGL2UnavailableError) {
      setStatus(renderingStatus, "unsupported", error.message);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(renderingStatus, "error", `Rendering initialization failed: ${message}`);
    }
  }

  focusSelect?.addEventListener("change", () => {
    if (focusSelect.value.length === 0) return;
    focusId = objectId(focusSelect.value);
    requestCurrentState();
  });
  selectedSelect?.addEventListener("change", () => {
    if (solarSystemScene !== undefined && selectedSelect.value.length > 0) {
      solarSystemScene.setSelected(objectId(selectedSelect.value));
    }
    const snapshot = coordinator.latestSnapshot();
    if (snapshot !== undefined) updateSelectedPanel(scenario, snapshot.value);
  });
  focusSelected?.addEventListener("click", () => {
    if (selectedSelect === null || selectedSelect.value.length === 0) return;
    focusId = objectId(selectedSelect.value);
    if (focusSelect !== null) focusSelect.value = focusId;
    requestCurrentState();
  });
  radiusMode?.addEventListener("change", () => {
    solarSystemScene?.setRadiusMode(radiusMode.value === "physical" ? "physical" : "visible");
  });
  canvas.addEventListener("click", (event) => {
    if (solarSystemScene === undefined || renderShell === undefined) return;
    const bounds = canvas.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    solarSystemScene.selectFromPointer(x, y, renderShell.camera);
  });
  requestCurrentState();

  if (playPause !== null) {
    playPause.addEventListener("click", () => {
      clock.toggle(performance.now());
      updateClockUi();
    });
  }

  if (renderShell === undefined) return;
  const resize = (): void => {
    renderShell.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  };
  window.addEventListener("resize", resize);
  resize();

  const loop = createAnimationLoop((timestampMilliseconds) => {
    clock.advanceTo(timestampMilliseconds);
    updateClockUi();
    requestCurrentState();
    renderShell.renderer.render(renderShell.scene, renderShell.camera);
  });
  loop.start();
  window.addEventListener("beforeunload", () => {
    loop.stop();
    window.removeEventListener("resize", resize);
    renderShell.dispose();
    solarSystemScene?.dispose();
  }, { once: true });
}

void bootstrap();
