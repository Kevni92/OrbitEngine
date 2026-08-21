import { createDemoEngine } from "./engine/create-engine.js";
import {
  createAnimationLoop,
  createRenderShell,
  updateCameraClipPlanes,
  WebGL2UnavailableError,
  type RenderShell,
} from "./rendering/three-shell.js";
import { SceneGuides, DEFAULT_SCENE_GUIDE_SETTINGS } from "./rendering/scene-guides.js";
import { SolarSystemScene } from "./rendering/solar-system-scene.js";
import { loadSolarSystemScenario, type SolarSystemScenario } from "./scenario/load-solar-system.js";
import { SolarSystemStateSource, type ScenarioStateFrame } from "./scenario/state-source.js";
import { SCENARIO_ROOT_FRAME, SUN_ID } from "./scenario/scenario-data.js";
import { PathCache } from "./simulation/path-sampling.js";
import { createOrbitPath, ORBIT_CACHE_ENTRIES } from "./simulation/orbit-visualization.js";
import { SimulationClock } from "./simulation/simulation-clock.js";
import { StateQueryCoordinator } from "./simulation/state-query-coordinator.js";
import { DemoPanel } from "./ui/demo-panel.js";
import {
  compareSimulationInstants,
  objectId,
  simulationInstant,
  type ObjectId,
  type OrbitEngine,
} from "orbit-engine";

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
const clock = new SimulationClock();

async function bootstrap(): Promise<void> {
  let panel!: DemoPanel;

  let scenario: SolarSystemScenario | undefined;
  let engine: OrbitEngine | undefined;
  let engineHealth: ReturnType<OrbitEngine["health"]> | undefined;
  let renderShell: RenderShell | undefined;
  let scene: SolarSystemScene | undefined;
  let guides: SceneGuides | undefined;
  let stateSource: SolarSystemStateSource | undefined;
  let coordinator: StateQueryCoordinator<ScenarioStateFrame> | undefined;
  let focusId: ObjectId = SUN_ID;
  let selectedId: ObjectId = SUN_ID;
  const pathCache = new PathCache(ORBIT_CACHE_ENTRIES);

  function updateClockUi(): void {
    panel.setSimulationTime(clock.currentInstant(), clock.isPlaying());
  }

  function updateSelectedPanel(frame: ScenarioStateFrame): void {
    if (scenario === undefined || engineHealth === undefined) return;
    const selectedIndex = scenario.objectIds.indexOf(selectedId);
    const focusIndex = scenario.objectIds.indexOf(focusId);
    const selectedEntry = scenario.bodyById.get(selectedId);
    const state = selectedIndex < 0 ? undefined : frame.states[selectedIndex];
    const focusState = focusIndex < 0 ? undefined : frame.states[focusIndex];
    if (selectedEntry === undefined || state === undefined) return;
    panel.setSelectedBody(selectedEntry, state, focusState);
    panel.setTechnicalDetails(selectedEntry, state, focusId, engineHealth);
  }

  function requestCurrentState(): void {
    if (coordinator === undefined) return;
    coordinator.request(clock.currentInstant(), `view-center:${focusId}`);
    panel.setFocusId(focusId);
  }

  function setSelectedBody(objectIdValue: ObjectId): void {
    selectedId = objectIdValue;
    panel.setSelectedId(selectedId);
    scene?.setSelected(selectedId);
    if (scene?.selectedOrbitActive()) {
      panel.setOrbitStatus("ready", `${scene.pathCount()} reference orbits · selected direction highlighted`);
    } else if (scene !== undefined) {
      panel.setOrbitStatus("ready", `${scene.pathCount()} reference orbits ready · select a planet or moon to highlight direction`);
    }
    const snapshot = coordinator?.latestSnapshot();
    if (snapshot !== undefined) updateSelectedPanel(snapshot.value);
  }

  function sampleReferenceOrbits(): void {
    if (scenario === undefined || stateSource === undefined || scene === undefined) return;
    let ready = 0;
    let failures = 0;
    for (const entry of scenario.bodies) {
      if (entry.definition.centralBody === undefined || entry.definition.propagation.orbitVisualization === undefined) continue;
      try {
        const path = createOrbitPath({
          scenario,
          body: entry,
          cache: pathCache,
          stateAt: (objectIdValue, centralBodyId, target, outputFrame) =>
            stateSource!.relativeStateAt(objectIdValue, centralBodyId, target, outputFrame),
        });
        if (path === undefined) continue;
        scene.setPath(path);
        ready += 1;
      } catch {
        failures += 1;
      }
    }
    panel.setOrbitStatus(
      failures === 0 ? "ready" : "warning",
      failures === 0 ? `${ready} reference orbits ready` : `${ready} reference orbits ready · ${failures} unavailable`,
    );
  }

  panel = new DemoPanel({
    onPlayPause: () => {
      panel.clearSimulationError();
      clock.toggle(performance.now());
      updateClockUi();
      requestCurrentState();
    },
    onWarpChange: (value) => {
      try {
        clock.setWarpFactor(value, performance.now());
        panel.clearSimulationError();
        updateClockUi();
        requestCurrentState();
      } catch (error) {
        panel.setSimulationError(error instanceof Error ? error.message : String(error));
      }
    },
    onFocusChange: (objectIdValue) => {
      focusId = objectIdValue;
      requestCurrentState();
    },
    onSelectedChange: setSelectedBody,
    onCenterSelected: () => {
      focusId = selectedId;
      requestCurrentState();
    },
    onRadiusModeChange: (mode) => scene?.setRadiusMode(mode),
    onGridChange: (visible) => guides?.setGridVisible(visible),
    onOrbitsChange: (visible) => scene?.setOrbitsVisible(visible),
    onAxesChange: (visible) => guides?.setAxesVisible(visible),
    onExactJump: (seconds, nanoseconds) => {
      try {
        if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(nanoseconds)) {
          throw new RangeError("Seconds and nanoseconds must be safe integers");
        }
        const target = simulationInstant(seconds, nanoseconds);
        const end = scenario?.validity.end;
        if (scenario === undefined || compareSimulationInstants(target, scenario.validity.start) < 0
            || (end !== undefined && compareSimulationInstants(target, end) >= 0)) {
          throw new RangeError("Exact time is outside the supported scenario interval");
        }
        clock.jump(target, performance.now());
        panel.clearExactJumpError();
        updateClockUi();
        requestCurrentState();
      } catch (error) {
        panel.setExactJumpError(error instanceof Error ? error.message : String(error));
      }
    },
  });
  panel.setSimulationTime(clock.currentInstant(), clock.isPlaying());
  panel.setGuideSettings(DEFAULT_SCENE_GUIDE_SETTINGS);
  panel.setOrbitsVisible(true);
  panel.setControlsReady(false);

  if (canvas === null) {
    panel.setEngineStatus("error", "Scene canvas is missing");
    return;
  }

  try {
    engine = await createDemoEngine();
    engineHealth = engine.health();
    panel.setEngineStatus("ready", "Engine ready", `WASM · protocol ${engineHealth.protocolVersion} · core ${engineHealth.coreVersion}`);
  } catch (error) {
    panel.setEngineStatus("error", "Engine initialization failed", error instanceof Error ? error.message : String(error));
    return;
  }

  try {
    scenario = loadSolarSystemScenario(engine);
    if (scenario.rootFrame !== SCENARIO_ROOT_FRAME) throw new Error("Scenario root frame is not the engine root frame");
    if (scenario.catalog.roots.length !== 1) throw new Error("Scenario catalog must have exactly one root");
    panel.populateBodies(scenario);
    panel.setFocusId(focusId);
    panel.setSelectedId(selectedId);
    panel.setScenarioNote("ready", `Offline deterministic catalog · ${scenario.bodies.length} bodies`);
  } catch (error) {
    panel.setScenarioNote("error", error instanceof Error ? error.message : String(error));
    return;
  }

  stateSource = new SolarSystemStateSource(engine, scenario);
  coordinator = new StateQueryCoordinator<ScenarioStateFrame>({
    source: {
      query: (request) => {
        const requestedFocus = request.contextKey.startsWith("view-center:")
          ? objectId(request.contextKey.slice("view-center:".length))
          : focusId;
        return stateSource!.query(requestedFocus, request.target);
      },
    },
    onSnapshot: (snapshot) => {
      scene?.update(snapshot.value.states);
      updateSelectedPanel(snapshot.value);
    },
    onError: (error) => {
      panel.setScenarioNote("error", `State query failed: ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  try {
    renderShell = createRenderShell(canvas);
    guides = new SceneGuides(renderShell.scene);
    guides.updateForCamera(renderShell.camera);
    panel.setRenderingStatus("ready", "WebGL ready", "WebGL 2 · identity axes · +Z up");
    scene = new SolarSystemScene(renderShell.scene, scenario, {
      onSelect: setSelectedBody,
    });
    scene.setSelected(selectedId);
    sampleReferenceOrbits();
  } catch (error) {
    if (error instanceof WebGL2UnavailableError) {
      panel.setRenderingStatus("unsupported", "WebGL 2 unavailable", error.message);
    } else {
      panel.setRenderingStatus("error", "Rendering initialization failed", error instanceof Error ? error.message : String(error));
    }
  }

  panel.setControlsReady(true);
  panel.setGuideSettings(guides?.settings() ?? DEFAULT_SCENE_GUIDE_SETTINGS);
  panel.setOrbitsVisible(scene?.orbitsVisible() ?? true);
  requestCurrentState();

  if (renderShell === undefined) return;
  const resize = (): void => {
    renderShell!.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  };
  window.addEventListener("resize", resize);
  resize();

  canvas.addEventListener("click", (event) => {
    if (scene === undefined || renderShell === undefined) return;
    const bounds = canvas.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    scene.selectFromPointer(x, y, renderShell.camera);
  });

  const loop = createAnimationLoop(() => {
    clock.advanceTo(performance.now());
    updateClockUi();
    requestCurrentState();
    guides?.updateForCamera(renderShell!.camera);
    updateCameraClipPlanes(renderShell!.camera, renderShell!.controls.target);
    renderShell!.renderer.render(renderShell!.scene, renderShell!.camera);
  });
  loop.start();
  window.addEventListener("beforeunload", () => {
    loop.stop();
    window.removeEventListener("resize", resize);
    guides?.dispose();
    scene?.dispose();
    renderShell?.dispose();
  }, { once: true });
}

void bootstrap();
