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
import { PathCache } from "./simulation/path-sampling.js";
import {
  compareSimulationInstants,
  objectId,
  simulationInstant,
  type ObjectId,
  type OrbitEngine,
  type PropagationState,
  type SimulationInstant,
} from "orbit-engine";

const engineStatus = document.querySelector<HTMLElement>("#engine-status");
const renderingStatus = document.querySelector<HTMLElement>("#rendering-status");
const simulationInstantElement = document.querySelector<HTMLElement>("#simulation-instant");
const playPause = document.querySelector<HTMLButtonElement>("#play-pause");
const warpSelect = document.querySelector<HTMLSelectElement>("#warp-select");
const jumpSeconds = document.querySelector<HTMLInputElement>("#jump-seconds");
const jumpNanoseconds = document.querySelector<HTMLInputElement>("#jump-nanoseconds");
const jumpTime = document.querySelector<HTMLButtonElement>("#jump-time");
const scenarioNote = document.querySelector<HTMLElement>("#scenario-note");
const focusContext = document.querySelector<HTMLElement>("#focus-context");
const focusSelect = document.querySelector<HTMLSelectElement>("#focus-select");
const selectedSelect = document.querySelector<HTMLSelectElement>("#selected-select");
const radiusMode = document.querySelector<HTMLSelectElement>("#radius-mode");
const focusSelected = document.querySelector<HTMLButtonElement>("#focus-selected");
const selectedPanel = document.querySelector<HTMLElement>("#selected-panel");
const samplePath = document.querySelector<HTMLButtonElement>("#sample-path");
const clearPath = document.querySelector<HTMLButtonElement>("#clear-path");
const pathStatus = document.querySelector<HTMLElement>("#path-status");
const canvas = document.querySelector<HTMLCanvasElement>("#scene");
const clock = new SimulationClock();

function formatInstant(): string {
  const instant = clock.currentInstant();
  return `${instant.seconds}s + ${instant.nanoseconds}ns`;
}

function updateClockUi(): void {
  if (simulationInstantElement !== null) simulationInstantElement.textContent = formatInstant();
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
    if (warpSelect !== null) warpSelect.disabled = false;
    if (jumpSeconds !== null) jumpSeconds.disabled = false;
    if (jumpNanoseconds !== null) jumpNanoseconds.disabled = false;
    if (jumpTime !== null) jumpTime.disabled = false;
    if (samplePath !== null) samplePath.disabled = false;
    if (clearPath !== null) clearPath.disabled = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(scenarioNote, "error", `Scenario loading failed: ${message}`);
    return;
  }

  let renderShell: RenderShell | undefined;
  let solarSystemScene: SolarSystemScene | undefined;
  let focusId: ObjectId = SUN_ID;
  let pathVisible = false;
  const pathCache = new PathCache(4);
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

  function selectedBodyId(): ObjectId {
    return objectId(selectedSelect?.value || SUN_ID);
  }

  function setPathStatus(state: string, message: string): void {
    setStatus(pathStatus, state, message);
  }

  function sampleCurrentPath(): void {
    const selectedId = selectedBodyId();
    const entry = scenario.bodyById.get(selectedId);
    const end = scenario.validity.end;
    if (entry === undefined || end === undefined) {
      setPathStatus("error", "Selected body or path interval is unavailable.");
      return;
    }
    setPathStatus("pending", "Sampling public engine states…");
    solarSystemScene?.clearPaths();
    try {
      const path = pathCache.getOrCreate({
        objectId: selectedId,
        focusId,
        outputFrame: scenario.rootFrame,
        interval: { start: scenario.validity.start, end },
        sampleCount: 96,
        motionRevision: entry.record.motion.motionRevision,
        configurationRevision: entry.record.motion.configurationRevision,
        stateAt: (objectIdValue, target, outputFrame) =>
          stateSource.stateAt(objectIdValue, focusId, target, outputFrame),
      });
      solarSystemScene?.setPath(path);
      pathVisible = true;
      setPathStatus("ready", `Sampled ${path.sampleCount} public states · ${path.interval.start.seconds}s–${path.interval.end.seconds}s · focus ${focusId}`);
    } catch (error) {
      pathVisible = false;
      const message = error instanceof Error ? error.message : String(error);
      setPathStatus("error", `Path sampling failed: ${message}`);
    }
  }

  function clearCurrentPaths(): void {
    pathVisible = false;
    solarSystemScene?.clearPaths();
    setPathStatus("pending", "No path sampled.");
  }

  function jumpToInputInstant(): void {
    try {
      const seconds = Number(jumpSeconds?.value ?? "");
      const nanoseconds = Number(jumpNanoseconds?.value ?? "0");
      if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(nanoseconds)) {
        throw new RangeError("Jump values must be safe integers");
      }
      const target = simulationInstant(seconds, nanoseconds);
      const end = scenario.validity.end;
      if (compareSimulationInstants(target, scenario.validity.start) < 0
          || (end !== undefined && compareSimulationInstants(target, end) >= 0)) {
        throw new RangeError("Jump instant is outside the supported scenario interval");
      }
      clock.jump(target, performance.now());
      updateClockUi();
      requestCurrentState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPathStatus("error", `Exact jump failed: ${message}`);
    }
  }

  function updateSelectedPanel(currentScenario: SolarSystemScenario, frame: ScenarioStateFrame): void {
    if (selectedPanel === null) return;
    const selectedId = selectedBodyId();
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
      `model ${entry.record.motion.modelKind} · motion rev ${entry.record.motion.motionRevision} · reference ${entry.record.referenceStatus}\n${formatState(state)}`;
  }

  try {
    renderShell = createRenderShell(canvas);
    setStatus(renderingStatus, "ready", "WebGL 2 ready · identity axes · +Z up");
    solarSystemScene = new SolarSystemScene(renderShell.scene, scenario, {
      onSelect: (objectId) => {
        if (selectedSelect !== null) selectedSelect.value = objectId;
        const snapshot = coordinator.latestSnapshot();
        if (snapshot !== undefined) updateSelectedPanel(scenario, snapshot.value);
        if (pathVisible) sampleCurrentPath();
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
    if (pathVisible) sampleCurrentPath();
  });
  selectedSelect?.addEventListener("change", () => {
    if (solarSystemScene !== undefined && selectedSelect.value.length > 0) {
      solarSystemScene.setSelected(objectId(selectedSelect.value));
    }
    const snapshot = coordinator.latestSnapshot();
    if (snapshot !== undefined) updateSelectedPanel(scenario, snapshot.value);
    if (pathVisible) sampleCurrentPath();
  });
  focusSelected?.addEventListener("click", () => {
    if (selectedSelect === null || selectedSelect.value.length === 0) return;
    focusId = objectId(selectedSelect.value);
    if (focusSelect !== null) focusSelect.value = focusId;
    requestCurrentState();
    if (pathVisible) sampleCurrentPath();
  });
  radiusMode?.addEventListener("change", () => {
    solarSystemScene?.setRadiusMode(radiusMode.value === "physical" ? "physical" : "visible");
  });
  warpSelect?.addEventListener("change", () => {
    try {
      const value = Number(warpSelect.value);
      clock.setWarpFactor(value, performance.now());
      updateClockUi();
      requestCurrentState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPathStatus("error", `Warp change failed: ${message}`);
    }
  });
  jumpTime?.addEventListener("click", jumpToInputInstant);
  samplePath?.addEventListener("click", sampleCurrentPath);
  clearPath?.addEventListener("click", clearCurrentPaths);
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
      requestCurrentState();
    });
  }

  if (renderShell === undefined) return;
  const resize = (): void => {
    renderShell.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  };
  window.addEventListener("resize", resize);
  resize();

  const loop = createAnimationLoop(() => {
    // Use the same monotonic source as control handlers. The timestamp passed
    // to requestAnimationFrame can describe an earlier frame than a
    // performance.now() sample taken by a control event before this callback.
    clock.advanceTo(performance.now());
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
