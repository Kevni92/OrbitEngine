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
import { RuntimeAsteroidOverlay } from "./scenario/runtime-asteroid-overlay.js";
import { SolarSystemStateSource, type ScenarioStateFrame } from "./scenario/state-source.js";
import { EUROPA_ID, SCENARIO_ROOT_FRAME, SUN_ID } from "./scenario/scenario-data.js";
import { PathCache } from "./simulation/path-sampling.js";
import { createOrbitPath, ORBIT_CACHE_ENTRIES } from "./simulation/orbit-visualization.js";
import { SimulationClock } from "./simulation/simulation-clock.js";
import { StateQueryCoordinator } from "./simulation/state-query-coordinator.js";
import { CelestialBrowser } from "./ui/celestial-browser.js";
import { DemoPanel } from "./ui/demo-panel.js";
import { simulationInstantFromLocalDateTimeInput } from "./ui/civil-time.js";
import {
  compareSimulationInstants,
  objectId,
  simulationInstant,
  type ObjectId,
  type OrbitEngine,
} from "orbit-engine";

interface PendingNavigation {
  readonly targetId: ObjectId;
  readonly previousSelectedId: ObjectId;
  readonly previousFocusId: ObjectId;
}

interface BrowserRenderBodyDiagnostics {
  readonly objectId: string;
  readonly name: string;
  readonly type: string;
  readonly representation: string;
  readonly submitted: boolean;
  readonly inFront: boolean;
  readonly inViewport: boolean;
  readonly positionErrorSceneUnits?: number;
}

interface BrowserRenderDiagnostics {
  readonly focusId: string;
  readonly selectedId: string;
  readonly bodies: readonly BrowserRenderBodyDiagnostics[];
}

declare global {
  interface Window {
    __orbitDemoRenderDiagnostics?: () => BrowserRenderDiagnostics;
  }
}

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
  let runtimeOverlay: RuntimeAsteroidOverlay | undefined;
  let coordinator: StateQueryCoordinator<ScenarioStateFrame> | undefined;
  let browser: CelestialBrowser | undefined;
  let focusId: ObjectId = SUN_ID;
  let selectedId: ObjectId = SUN_ID;
  let recenterAfterState = false;
  let pendingNavigation: PendingNavigation | undefined;
  let orbitResampleTimer: number | undefined;
  const pathCache = new PathCache(ORBIT_CACHE_ENTRIES);

  function centerCameraOnFocus(): void {
    const currentScene = scene;
    const focusPosition = currentScene?.positionFor(focusId);
    if (focusPosition === undefined || renderShell === undefined || currentScene === undefined) return;
    renderShell.centerOn(focusPosition, currentScene.focusDistanceFor(focusId));
  }

  function updateClockUi(): void {
    panel.setSimulationTime(clock.currentInstant(), clock.isPlaying());
  }

  function updateSelectedPanel(frame: ScenarioStateFrame): void {
    if (stateSource === undefined || engineHealth === undefined) return;
    const selectedIndex = frame.objectIds.indexOf(selectedId);
    const focusIndex = frame.objectIds.indexOf(focusId);
    const selectedEntry = stateSource.bodyFor(selectedId);
    const state = selectedIndex < 0 ? undefined : frame.states[selectedIndex];
    const focusState = focusIndex < 0 ? undefined : frame.states[focusIndex];
    if (selectedEntry === undefined || state === undefined) return;
    const parentRepresentation = selectedEntry.definition.centralBody === undefined
      ? undefined
      : scene?.representationFor(selectedEntry.definition.centralBody);
    panel.setSelectedBody(selectedEntry, state, focusState, scene?.representationFor(selectedId), parentRepresentation);
    panel.setTechnicalDetails(selectedEntry, state, focusId, engineHealth);
  }

  function requestCurrentState(recenter = false, centerImmediately = false): void {
    if (recenter) {
      recenterAfterState = true;
      if (centerImmediately) centerCameraOnFocus();
    }
    panel.setFocusId(focusId);
    scene?.setFocusId(focusId);
    if (scenario?.catalog.bodyById.has(focusId)) browser?.setViewCenter(focusId);
    if (coordinator === undefined) return;
    coordinator.request(clock.currentInstant(), stateSource?.contextKey(focusId) ?? `view-center:${focusId}`);
  }

  function setSelectedBody(objectIdValue: ObjectId): void {
    selectedId = objectIdValue;
    panel.setSelectedId(selectedId);
    if (scenario?.catalog.bodyById.has(selectedId)) browser?.setSelectedBody(selectedId);
    scene?.setSelected(selectedId);
    if (scene?.selectedOrbitActive()) {
      panel.setOrbitStatus("ready", `${scene.pathCount()} reference orbits · selected direction highlighted`);
    } else if (scene !== undefined) {
      panel.setOrbitStatus("ready", `${scene.pathCount()} reference orbits ready · select a planet or moon to highlight direction`);
    }
    const snapshot = coordinator?.latestSnapshot();
    if (snapshot !== undefined) updateSelectedPanel(snapshot.value);
  }

  function navigateToBody(objectIdValue: ObjectId): void {
    if (stateSource === undefined || stateSource.bodyFor(objectIdValue) === undefined) {
      panel.setScenarioNote("error", `Cannot navigate to unknown celestial body ${objectIdValue}`);
      return;
    }
    const previousSelectedId = selectedId;
    const previousFocusId = focusId;
    setSelectedBody(objectIdValue);
    focusId = objectIdValue;
    pendingNavigation = { targetId: objectIdValue, previousSelectedId, previousFocusId };
    requestCurrentState(true);
  }

  function orbitEntries(): readonly SolarSystemScenario["bodies"][number][] {
    return scenario?.bodies.filter((entry) =>
      entry.definition.centralBody !== undefined && entry.definition.propagation.orbitVisualization !== undefined) ?? [];
  }

  function sampleReferenceOrbit(entry: SolarSystemScenario["bodies"][number]): boolean {
    if (stateSource === undefined || scene === undefined) return false;
    try {
      const path = createOrbitPath({
        scenario: scenario!,
        body: entry,
        cache: pathCache,
        stateAt: (objectIdValue, centralBodyId, target, outputFrame) =>
          stateSource!.relativeStateAt(objectIdValue, centralBodyId, target, outputFrame),
        anchorInstant: clock.currentInstant(),
      });
      if (path === undefined) return false;
      scene.setPath(path);
      return true;
    } catch {
      return false;
    }
  }

  function sampleReferenceOrbits(): void {
    if (scenario === undefined || stateSource === undefined || scene === undefined) return;
    let ready = 0;
    let failures = 0;
    for (const entry of orbitEntries()) {
      if (sampleReferenceOrbit(entry)) ready += 1;
      else failures += 1;
    }
    panel.setOrbitStatus(
      failures === 0 ? "ready" : "warning",
      failures === 0 ? `${ready} reference orbits ready` : `${ready} reference orbits ready · ${failures} unavailable`,
    );
  }

  function scheduleReferenceOrbitResample(): void {
    if (orbitResampleTimer !== undefined) window.clearTimeout(orbitResampleTimer);
    const entries = orbitEntries();
    let index = 0;
    let ready = 0;
    let failures = 0;
    panel.setOrbitStatus("pending", "Updating reference orbits…");
    const sampleNext = (): void => {
      orbitResampleTimer = undefined;
      const entry = entries[index];
      index += 1;
      if (entry === undefined) {
        panel.setOrbitStatus(
          failures === 0 ? "ready" : "warning",
          failures === 0 ? `${ready} reference orbits ready` : `${ready} reference orbits ready · ${failures} unavailable`,
        );
        return;
      }
      if (sampleReferenceOrbit(entry)) ready += 1;
      else failures += 1;
      panel.setOrbitStatus("pending", `Updating reference orbits… ${index}/${entries.length}`);
      orbitResampleTimer = window.setTimeout(sampleNext, 0);
    };
    orbitResampleTimer = window.setTimeout(sampleNext, 0);
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
      pendingNavigation = undefined;
      focusId = objectIdValue;
      requestCurrentState(true);
    },
    onSelectedChange: (objectIdValue) => {
      pendingNavigation = undefined;
      setSelectedBody(objectIdValue);
    },
    onCenterSelected: () => {
      pendingNavigation = undefined;
      const focusAlreadySelected = focusId === selectedId;
      focusId = selectedId;
      requestCurrentState(true, focusAlreadySelected);
    },
    onRadiusModeChange: (mode) => scene?.setRadiusMode(mode),
    onAddAsteroids: (count, seed) => {
      if (runtimeOverlay === undefined || stateSource === undefined) return;
      try {
        runtimeOverlay.add(count, seed);
        scene?.setCurrentBodies(stateSource.currentBodies());
        panel.populateBodies(stateSource.currentBodies());
        panel.setFocusId(focusId);
        panel.setSelectedId(selectedId);
        panel.setPopulationStatus("ready", `${runtimeOverlay.count} generated asteroid${runtimeOverlay.count === 1 ? "" : "s"}`);
        requestCurrentState();
      } catch (error) {
        panel.setPopulationStatus("error", error instanceof Error ? error.message : String(error));
      }
    },
    onRemoveAsteroids: () => {
      if (runtimeOverlay === undefined || stateSource === undefined) return;
      const removed = runtimeOverlay.removeAll();
      if (removed > 0 && stateSource.bodyFor(selectedId) === undefined) {
        selectedId = SUN_ID;
        scene?.setSelected(selectedId);
      }
      if (removed > 0 && stateSource.bodyFor(focusId) === undefined) {
        focusId = SUN_ID;
      }
      scene?.setCurrentBodies(stateSource.currentBodies());
      panel.populateBodies(stateSource.currentBodies());
      panel.setFocusId(focusId);
      panel.setSelectedId(selectedId);
      panel.setPopulationStatus("ready", removed === 0 ? "No runtime asteroids to remove" : `Removed ${removed} generated asteroid${removed === 1 ? "" : "s"}`);
      requestCurrentState();
    },
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
        panel.syncLocalDateTime(target);
        updateClockUi();
        requestCurrentState();
        scheduleReferenceOrbitResample();
      } catch (error) {
        panel.setExactJumpError(error instanceof Error ? error.message : String(error));
      }
    },
    onLocalDateTimeJump: (value) => {
      try {
        const target = simulationInstantFromLocalDateTimeInput(value);
        const end = scenario?.validity.end;
        if (scenario === undefined || compareSimulationInstants(target, scenario.validity.start) < 0
            || (end !== undefined && compareSimulationInstants(target, end) >= 0)) {
          throw new RangeError("Local date/time is outside the supported scenario interval");
        }
        clock.jump(target, performance.now());
        panel.clearLocalDateTimeJumpError();
        panel.syncLocalDateTime(target);
        updateClockUi();
        requestCurrentState();
        scheduleReferenceOrbitResample();
      } catch (error) {
        panel.setLocalDateTimeJumpError(error instanceof Error ? error.message : String(error));
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
    browser = new CelestialBrowser({
      catalog: scenario.catalog,
      selectedBodyId: selectedId,
      viewCenterBodyId: focusId,
      onNavigateToBody: navigateToBody,
    });
    runtimeOverlay = new RuntimeAsteroidOverlay(engine, scenario);
    stateSource = new SolarSystemStateSource(engine, scenario, runtimeOverlay);
    panel.populateBodies(stateSource.currentBodies());
    panel.setFocusId(focusId);
    panel.setSelectedId(selectedId);
    panel.setPopulationDiagnostics(runtimeOverlay.count, {
      registeredCount: scenario.bodies.length,
      queriedCount: 0,
      hiddenCount: 0,
      markerCount: 0,
      sphereCount: scenario.bodies.length,
      promotedRuntimeSphereCount: 0,
    });
    panel.setScenarioNote("ready", `Offline deterministic catalog · ${scenario.bodies.length} committed bodies`);
  } catch (error) {
    panel.setScenarioNote("error", error instanceof Error ? error.message : String(error));
    return;
  }

  coordinator = new StateQueryCoordinator<ScenarioStateFrame>({
    source: {
      query: (request) => {
        const requestedFocus = request.contextKey.startsWith("view-center:")
          ? objectId(request.contextKey.slice("view-center:".length).split(":", 1)[0]!)
          : focusId;
        return stateSource!.query(requestedFocus, request.target);
      },
    },
    onSnapshot: (snapshot) => {
      scene?.update(snapshot.value.states, snapshot.value.objectIds);
      if (scene !== undefined) panel.setPopulationDiagnostics(runtimeOverlay?.count ?? 0, scene.lodDiagnostics());
      panel.setHierarchyDiagnostics(scene?.representationFor(EUROPA_ID));
      if (recenterAfterState && snapshot.value.focusId === focusId) {
        centerCameraOnFocus();
        recenterAfterState = false;
      }
      if (pendingNavigation?.targetId === snapshot.value.focusId
          && snapshot.contextKey.startsWith(`view-center:${pendingNavigation.targetId}:`)) {
        pendingNavigation = undefined;
      }
      updateSelectedPanel(snapshot.value);
    },
    onError: (error, request) => {
      const failedNavigation = pendingNavigation;
      if (failedNavigation !== undefined
          && request.contextKey.startsWith(`view-center:${failedNavigation.targetId}:`)) {
        pendingNavigation = undefined;
        recenterAfterState = false;
        selectedId = failedNavigation.previousSelectedId;
        focusId = failedNavigation.previousFocusId;
        setSelectedBody(selectedId);
        requestCurrentState(true);
      }
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
    scene.setCurrentBodies(stateSource.currentBodies());
    scene.setFocusId(focusId);
    scene.setSelected(selectedId);
    window.__orbitDemoRenderDiagnostics = () => ({
      focusId,
      selectedId,
      bodies: (stateSource?.currentBodies() ?? []).map((entry) => {
        const diagnostics = scene?.renderDiagnosticsFor(entry.definition.id, renderShell!.camera);
        return {
          objectId: entry.definition.id,
          name: entry.definition.name,
          type: entry.definition.type,
          representation: diagnostics?.representation ?? "pending",
          submitted: diagnostics?.submitted ?? false,
          inFront: diagnostics?.inFront ?? false,
          inViewport: diagnostics?.inViewport ?? false,
          positionErrorSceneUnits: diagnostics?.positionErrorSceneUnits,
        };
      }),
    });
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
    scene?.updatePresentation(renderShell!.camera, canvas.clientHeight || window.innerHeight);
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
    scene?.updatePresentation(renderShell!.camera, canvas.clientHeight || window.innerHeight);
    panel.setHierarchyDiagnostics(scene?.representationFor(EUROPA_ID));
    const latest = coordinator?.latestSnapshot();
    if (latest !== undefined && scene !== undefined) {
      panel.setPopulationDiagnostics(runtimeOverlay?.count ?? 0, scene.lodDiagnostics());
      updateSelectedPanel(latest.value);
    }
    renderShell!.renderer.render(renderShell!.scene, renderShell!.camera);
  });
  loop.start();
  window.addEventListener("beforeunload", () => {
    loop.stop();
    window.removeEventListener("resize", resize);
    delete window.__orbitDemoRenderDiagnostics;
    guides?.dispose();
    scene?.dispose();
    renderShell?.dispose();
    browser?.dispose();
  }, { once: true });
}

void bootstrap();
