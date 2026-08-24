import { createDemoEngine } from "./engine/create-engine.js";
import {
  createAnimationLoop,
  createRenderShell,
  updateCameraClipPlanes,
  WebGL2UnavailableError,
  type RenderShell,
} from "./rendering/three-shell.js";
import { SceneGuides, DEFAULT_SCENE_GUIDE_SETTINGS } from "./rendering/scene-guides.js";
import { SolarSystemScene, type StellarDirectionDiagnostics } from "./rendering/solar-system-scene.js";
import type { AtmosphereDiagnostics } from "./rendering/atmosphere-rendering.js";
import { lightingModeDiagnostics, type LightingMode } from "./rendering/lighting-mode.js";
import { loadSolarSystemScenario, type SolarSystemScenario } from "./scenario/load-solar-system.js";
import { loadSolarSystemReferenceDataset } from "./scenario/load-reference-dataset.js";
import { RuntimeAsteroidOverlay } from "./scenario/runtime-asteroid-overlay.js";
import { SolarSystemStateSource, type ScenarioStateFrame } from "./scenario/state-source.js";
import { EARTH_ID, EUROPA_ID, MOON_ID, SCENARIO_ROOT_FRAME, SUN_ID } from "./scenario/scenario-data.js";
import { PathCache } from "./simulation/path-sampling.js";
import { createOrbitPath, ORBIT_CACHE_ENTRIES } from "./simulation/orbit-visualization.js";
import { SimulationClock } from "./simulation/simulation-clock.js";
import { StateQueryCoordinator } from "./simulation/state-query-coordinator.js";
import { CelestialBrowser } from "./ui/celestial-browser.js";
import { DemoPanel } from "./ui/demo-panel.js";
import { ResponsiveSurfaceManager } from "./ui/responsive-surfaces.js";
import { simulationInstantFromLocalDateTimeInput } from "./ui/civil-time.js";
import {
  compareSimulationInstants,
  objectId,
  ObjectType,
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
  readonly orbitVisible: boolean;
  readonly inFront: boolean;
  readonly inViewport: boolean;
  readonly ndcX: number;
  readonly ndcY: number;
  readonly renderWorldPosition: { readonly x: number; readonly y: number; readonly z: number };
  readonly markerSizePixels?: number;
  readonly positionErrorSceneUnits?: number;
  readonly surfaceReflectanceSource?: string;
  readonly physicalIrradianceWattsPerSquareMeter?: number;
  readonly atmosphere: Pick<AtmosphereDiagnostics, "resourcesAllocated" | "visible" | "projectedDiameterPixels" | "viewSampleCount" | "opticalSource">;
  readonly stellarDirections: readonly StellarDirectionDiagnostics[];
  readonly lightingMode: LightingMode;
  readonly inspectionFillApplied: boolean;
  readonly inspectionFillContribution: number;
}

interface BrowserOrbitDiagnostics {
  readonly objectId: string;
  readonly kind: string;
  readonly role: string;
  readonly opacity: number;
  readonly visible: boolean;
  readonly anchorPosition: { readonly x: number; readonly y: number; readonly z: number };
}

interface BrowserRenderDiagnostics {
  readonly focusId: string;
  readonly selectedId: string;
  readonly lighting: ReturnType<typeof lightingModeDiagnostics>;
  readonly atmosphereResourceCount: number;
  readonly performance: {
    readonly frameCount: number;
    readonly lastFrameDurationMs: number;
    readonly averageFrameDurationMs: number;
  };
  readonly orbits: readonly BrowserOrbitDiagnostics[];
  readonly bodies: readonly BrowserRenderBodyDiagnostics[];
}

interface BrowserCameraFixture {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly up?: readonly [number, number, number];
}

interface EclipseRegressionDiagnostics {
  readonly instant: { readonly seconds: number; readonly nanoseconds: number };
  readonly angularSeparationRadians: number;
  readonly angularErrorRadians: number;
  readonly maxPositionErrorMeters: number;
  readonly maxVelocityErrorMetersPerSecond: number;
}

declare global {
  interface Window {
    __orbitDemoRenderDiagnostics?: () => BrowserRenderDiagnostics;
    /** Deterministic camera control for renderer regression scenarios. */
    __orbitDemoSetCameraFixture?: (fixture: BrowserCameraFixture) => void;
    __orbitDemoReferenceDiagnostics?: () => {
      readonly datasetId: string;
      readonly datasetVersion: string;
      readonly validityStartSeconds: number;
      readonly validityEndSeconds?: number;
      readonly eclipse: EclipseRegressionDiagnostics;
    };
  }
}

function vectorError(actual: readonly number[], expected: readonly number[]): number {
  return Math.hypot(...actual.map((value, index) => value - (expected[index] ?? Number.NaN)));
}

function stateVector(state: ReturnType<OrbitEngine["stateAt"]>): readonly number[] {
  return [
    state.position.x,
    state.position.y,
    state.position.z,
    state.velocity.x,
    state.velocity.y,
    state.velocity.z,
  ];
}

function validateEclipseRegression(engine: OrbitEngine, scenario: SolarSystemScenario): EclipseRegressionDiagnostics {
  const oracle = scenario.eclipseOracle;
  if (oracle === undefined) throw new Error("Production eclipse oracle is missing from the loaded scenario");
  const instant = simulationInstant(
    oracle.event.normalizedInstant.seconds,
    oracle.event.normalizedInstant.nanoseconds,
  );
  const sun = stateVector(engine.stateAt(SUN_ID, instant, SCENARIO_ROOT_FRAME));
  const earth = stateVector(engine.stateAt(EARTH_ID, instant, SCENARIO_ROOT_FRAME));
  const moon = stateVector(engine.stateAt(MOON_ID, instant, SCENARIO_ROOT_FRAME));
  const sunEarth = sun.map((value, index) => value - earth[index]!);
  const moonEarth = moon.map((value, index) => value - earth[index]!);
  const statePositionErrors = [
    vectorError(sun.slice(0, 3), oracle.sourceStates.sunSsb ?? []),
    vectorError(earth.slice(0, 3), oracle.sourceStates.earthSsb ?? []),
    vectorError(moon.slice(0, 3), oracle.sourceStates.moonSsb ?? []),
  ];
  const stateVelocityErrors = [
    vectorError(sun.slice(3), (oracle.sourceStates.sunSsb ?? []).slice(3)),
    vectorError(earth.slice(3), (oracle.sourceStates.earthSsb ?? []).slice(3)),
    vectorError(moon.slice(3), (oracle.sourceStates.moonSsb ?? []).slice(3)),
  ];
  const geometryPositionErrors = [
    vectorError(sunEarth.slice(0, 3), oracle.sourceStates.sunEarth ?? []),
    vectorError(moonEarth.slice(0, 3), oracle.sourceStates.moonEarth ?? []),
  ];
  const cosine = sunEarth.slice(0, 3).reduce((sum, value, index) => sum + value * moonEarth[index]!, 0)
    / (Math.hypot(...sunEarth.slice(0, 3)) * Math.hypot(...moonEarth.slice(0, 3)));
  const angularSeparationRadians = Math.acos(Math.max(-1, Math.min(1, cosine)));
  const angularErrorRadians = Math.abs(angularSeparationRadians - oracle.earthCenteredGeometry.angularSeparationRadians);
  const maxStatePositionErrorMeters = Math.max(...statePositionErrors);
  const maxGeometryPositionErrorMeters = Math.max(...geometryPositionErrors);
  const maxPositionErrorMeters = Math.max(maxStatePositionErrorMeters, maxGeometryPositionErrorMeters);
  const maxVelocityErrorMetersPerSecond = Math.max(...stateVelocityErrors);
  if (maxStatePositionErrorMeters > oracle.tolerance.statePositionMeters
      || maxGeometryPositionErrorMeters > oracle.tolerance.geometryPositionMeters
      || maxVelocityErrorMetersPerSecond > oracle.tolerance.stateVelocityMetersPerSecond
      || angularErrorRadians > oracle.tolerance.geometryDirectionRadians) {
    throw new Error(`Eclipse OEP regression failed: position ${maxPositionErrorMeters} m, velocity ${maxVelocityErrorMetersPerSecond} m/s, angular ${angularErrorRadians} rad`);
  }
  return Object.freeze({
    instant: oracle.event.normalizedInstant,
    angularSeparationRadians,
    angularErrorRadians,
    maxPositionErrorMeters,
    maxVelocityErrorMetersPerSecond,
  });
}

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
const clock = new SimulationClock();
const surfaceManager = new ResponsiveSurfaceManager();

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
  let lightingMode: LightingMode = "physical";
  let recenterAfterState = false;
  let pendingNavigation: PendingNavigation | undefined;
  let orbitResampleTimer: number | undefined;
  let renderedFrameCount = 0;
  let totalFrameDurationMs = 0;
  let lastFrameDurationMs = 0;
  let eclipseRegression: EclipseRegressionDiagnostics | undefined;
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

  function updateSceneContext(): void {
    if (stateSource === undefined) return;
    const focusEntry = stateSource.bodyFor(focusId);
    const selectedEntry = stateSource.bodyFor(selectedId);
    if (focusEntry === undefined || selectedEntry === undefined) return;
    const localSystemId = focusEntry.definition.display.category === "moon"
      ? focusEntry.definition.centralBody
      : focusEntry.definition.display.category === "planet"
        ? focusEntry.definition.id
        : undefined;
    panel.setSceneContext({
      focus: focusEntry,
      selected: selectedEntry,
      localSystem: localSystemId === undefined ? undefined : stateSource.bodyFor(localSystemId),
    });
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
    panel.setTechnicalDetails(selectedEntry, state, focusId, engineHealth, scenario?.referenceSources?.get(selectedId));
  }

  function requestCurrentState(recenter = false, centerImmediately = false): void {
    if (recenter) {
      recenterAfterState = true;
      if (centerImmediately) centerCameraOnFocus();
    }
    panel.setFocusId(focusId);
    updateSceneContext();
    scene?.setFocusId(focusId);
    if (scenario?.catalog.bodyById.has(focusId)) browser?.setViewCenter(focusId);
    if (coordinator === undefined) return;
    coordinator.request(clock.currentInstant(), stateSource?.contextKey(focusId) ?? `view-center:${focusId}`);
  }

  function setSelectedBody(objectIdValue: ObjectId): void {
    const previousSelectedId = selectedId;
    selectedId = objectIdValue;
    panel.setSelectedId(selectedId);
    updateSceneContext();
    if (scenario?.catalog.bodyById.has(selectedId)) browser?.setSelectedBody(selectedId);
    scene?.setSelected(selectedId);
    const previousEntry = stateSource?.bodyFor(previousSelectedId);
    if (previousSelectedId !== selectedId && previousEntry?.definition.type === ObjectType.asteroid) {
      scene?.clearPath(previousSelectedId);
    }
    const selectedEntry = stateSource?.bodyFor(selectedId);
    if (selectedEntry?.definition.type === ObjectType.asteroid) {
      sampleReferenceOrbit(selectedEntry);
    }
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
    const entries = stateSource?.currentBodies() ?? scenario?.bodies ?? [];
    return entries.filter((entry) => entry.definition.centralBody !== undefined
      && (entry.definition.type !== ObjectType.asteroid || entry.definition.id === selectedId));
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
    onLightingModeChange: (mode) => {
      lightingMode = mode;
      scene?.setLightingMode(mode);
      panel.setLightingDiagnostics(scene?.lightingDiagnostics() ?? lightingModeDiagnostics(mode, []));
    },
    onAddAsteroids: (count, seed) => {
      if (runtimeOverlay === undefined || stateSource === undefined) return;
      try {
        runtimeOverlay.add(count, seed);
        scene?.setCurrentBodies(stateSource.currentBodies());
        panel.populateBodies(stateSource.currentBodies());
        panel.setFocusId(focusId);
        panel.setSelectedId(selectedId);
        panel.setPopulationLiveCount(runtimeOverlay.count);
        panel.setPopulationStatus("ready", `Added ${count} generated asteroid${count === 1 ? "" : "s"}. Live total: ${runtimeOverlay.count}.`);
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
      panel.setPopulationLiveCount(runtimeOverlay.count);
      panel.setPopulationStatus("ready", removed === 0 ? "No generated asteroids to remove. Live total: 0." : `Removed ${removed} generated asteroid${removed === 1 ? "" : "s"}. Live total: ${runtimeOverlay.count}.`);
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
  panel.setLightingMode(lightingMode);
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
    const referenceDataset = await loadSolarSystemReferenceDataset(engine);
    scenario = loadSolarSystemScenario(engine, referenceDataset.dataset, referenceDataset.eclipseOracle);
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
    updateSceneContext();
    panel.setSelectedId(selectedId);
    panel.setPopulationDiagnostics(runtimeOverlay.count, {
      registeredCount: scenario.bodies.length,
      queriedCount: 0,
      hiddenCount: 0,
      markerCount: 0,
      sphereCount: scenario.bodies.length,
      promotedRuntimeSphereCount: 0,
    });
    const referenceIdentity = scenario.referenceDataset;
    if (referenceIdentity === undefined) throw new Error("Production OEP identity is missing from the loaded scenario");
    panel.setReferenceDataset(referenceIdentity, scenario.validity);
    eclipseRegression = validateEclipseRegression(engine, scenario);
    panel.setEclipseDiagnostics(`pass · ${eclipseRegression.angularSeparationRadians.toFixed(9)} rad · max ${eclipseRegression.maxPositionErrorMeters.toExponential(2)} m`);
    panel.setScenarioNote("ready", `OEP ${referenceIdentity.datasetId}@${referenceIdentity.datasetVersion} · ${scenario.bodies.length} catalog bodies`);
    window.__orbitDemoReferenceDiagnostics = () => ({
      datasetId: referenceIdentity.datasetId,
      datasetVersion: referenceIdentity.datasetVersion,
      validityStartSeconds: scenario!.validity.start.seconds,
      validityEndSeconds: scenario!.validity.end?.seconds,
      eclipse: eclipseRegression!,
    });
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
    scene.setLightingMode(lightingMode);
    scene.setCurrentBodies(stateSource.currentBodies());
    scene.setFocusId(focusId);
    scene.setSelected(selectedId);
    window.__orbitDemoRenderDiagnostics = () => ({
      focusId,
      selectedId,
      lighting: scene?.lightingDiagnostics() ?? lightingModeDiagnostics(lightingMode, []),
      atmosphereResourceCount: scene?.atmosphereResourceCount() ?? 0,
      performance: {
        frameCount: renderedFrameCount,
        lastFrameDurationMs,
        averageFrameDurationMs: renderedFrameCount === 0 ? 0 : totalFrameDurationMs / renderedFrameCount,
      },
      orbits: (scene?.orbitGuideDiagnostics() ?? []).map((orbit) => ({
        objectId: orbit.objectId,
        kind: orbit.kind,
        role: orbit.role,
        opacity: orbit.opacity,
        visible: orbit.visible,
        anchorPosition: orbit.anchorPosition ?? { x: 0, y: 0, z: 0 },
      })),
      bodies: (stateSource?.currentBodies() ?? []).map((entry) => {
        const diagnostics = scene?.renderDiagnosticsFor(entry.definition.id, renderShell!.camera);
        return {
          objectId: entry.definition.id,
          name: entry.definition.name,
          type: entry.definition.type,
          representation: diagnostics?.representation ?? "pending",
          submitted: diagnostics?.submitted ?? false,
          orbitVisible: diagnostics?.orbitVisible ?? false,
          inFront: diagnostics?.inFront ?? false,
          inViewport: diagnostics?.inViewport ?? false,
          ndcX: diagnostics?.ndcX ?? 0,
          ndcY: diagnostics?.ndcY ?? 0,
          renderWorldPosition: diagnostics?.renderWorldPosition ?? { x: 0, y: 0, z: 0 },
          markerSizePixels: diagnostics?.markerSizePixels,
          positionErrorSceneUnits: diagnostics?.positionErrorSceneUnits,
          surfaceReflectanceSource: diagnostics?.surfaceReflectanceSource,
          physicalIrradianceWattsPerSquareMeter: diagnostics?.physicalIrradianceWattsPerSquareMeter,
          stellarDirections: diagnostics?.stellarDirections ?? [],
          lightingMode: diagnostics?.lightingMode ?? lightingMode,
          inspectionFillApplied: diagnostics?.inspectionFillApplied ?? false,
          inspectionFillContribution: diagnostics?.inspectionFillContribution ?? 0,
          atmosphere: (() => {
            const atmosphere = scene?.atmosphereDiagnosticsFor(entry.definition.id);
            return {
              resourcesAllocated: atmosphere?.resourcesAllocated ?? false,
              visible: atmosphere?.visible ?? false,
              projectedDiameterPixels: atmosphere?.projectedDiameterPixels ?? 0,
              viewSampleCount: atmosphere?.viewSampleCount ?? 0,
              opticalSource: atmosphere?.opticalSource,
            };
          })(),
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
    if (scene !== undefined) panel.setLightingDiagnostics(scene.lightingDiagnostics());
  };
  window.addEventListener("resize", resize);
  resize();

  window.__orbitDemoSetCameraFixture = (fixture) => {
    const { camera, controls } = renderShell!;
    const values = [...fixture.position, ...fixture.target, ...(fixture.up ?? [0, 0, 1])];
    if (!values.every((value) => Number.isFinite(value))) {
      throw new RangeError("Camera fixture coordinates must be finite");
    }
    camera.position.set(fixture.position[0], fixture.position[1], fixture.position[2]);
    camera.up.set(
      fixture.up?.[0] ?? 0,
      fixture.up?.[1] ?? 0,
      fixture.up?.[2] ?? 1,
    );
    controls.target.set(fixture.target[0], fixture.target[1], fixture.target[2]);
    controls.update();
    // OrbitControls caches its previous quaternion. Re-apply the requested
    // up vector after the control update so directional fixtures can use a
    // deterministic roll as well as a deterministic orbit position.
    camera.lookAt(controls.target);
    updateCameraClipPlanes(camera, controls.target);
    guides?.updateForCamera(camera);
    scene?.updatePresentation(camera, canvas.clientHeight || window.innerHeight);
    renderShell!.renderer.render(renderShell!.scene, camera);
  };

  canvas.addEventListener("click", (event) => {
    if (scene === undefined || renderShell === undefined) return;
    const bounds = canvas.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    scene.selectFromPointer(x, y, renderShell.camera);
  });

  const loop = createAnimationLoop(() => {
    const frameStartedAt = performance.now();
    clock.advanceTo(performance.now());
    updateClockUi();
    requestCurrentState();
    guides?.updateForCamera(renderShell!.camera);
    updateCameraClipPlanes(renderShell!.camera, renderShell!.controls.target);
    scene?.updatePresentation(renderShell!.camera, canvas.clientHeight || window.innerHeight);
    if (scene !== undefined) panel.setLightingDiagnostics(scene.lightingDiagnostics());
    panel.setHierarchyDiagnostics(scene?.representationFor(EUROPA_ID));
    const latest = coordinator?.latestSnapshot();
    if (latest !== undefined && scene !== undefined) {
      panel.setPopulationDiagnostics(runtimeOverlay?.count ?? 0, scene.lodDiagnostics());
      updateSelectedPanel(latest.value);
    }
    renderShell!.renderer.render(renderShell!.scene, renderShell!.camera);
    lastFrameDurationMs = Math.max(0, performance.now() - frameStartedAt);
    totalFrameDurationMs += lastFrameDurationMs;
    renderedFrameCount += 1;
  });
  loop.start();
  window.addEventListener("beforeunload", () => {
    loop.stop();
    surfaceManager.dispose();
    window.removeEventListener("resize", resize);
    delete window.__orbitDemoRenderDiagnostics;
    delete window.__orbitDemoSetCameraFixture;
    guides?.dispose();
    scene?.dispose();
    renderShell?.dispose();
    browser?.dispose();
  }, { once: true });
}

void bootstrap();
