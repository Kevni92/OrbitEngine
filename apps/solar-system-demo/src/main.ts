import { createDemoEngine } from "./engine/create-engine.js";
import {
  createAnimationLoop,
  createRenderShell,
  updateCameraClipPlanes,
  WebGL2UnavailableError,
  type RenderShell,
} from "./rendering/three-shell.js";
import { SceneGuides, DEFAULT_SCENE_GUIDE_SETTINGS } from "./rendering/scene-guides.js";
import { SolarSystemScene, type AtmosphereDiagnostics, type StellarDirectionDiagnostics } from "./rendering/solar-system-scene.js";
import { isPointerClick, type PointerCoordinates } from "./rendering/pointer-selection.js";
import type { DisplayExposureDiagnostics, LightingMode } from "orbit-engine-three/presentation";
import { lightingModeDiagnostics } from "orbit-engine-three/presentation";
import { createOrbitEngineSnapshotSource, type OrbitEngineSnapshotSource } from "orbit-engine-three";
import { loadSolarSystemScenario, type SolarSystemScenario } from "./scenario/load-solar-system.js";
import { loadSolarSystemReferenceDataset } from "./scenario/load-reference-dataset.js";
import { RuntimeAsteroidOverlay } from "./scenario/runtime-asteroid-overlay.js";
import { SolarSystemStateSource, type ScenarioStateFrame } from "./scenario/state-source.js";
import { EARTH_ID, EUROPA_ID, MOON_ID, SCENARIO_ROOT_FRAME, SUN_ID } from "./scenario/scenario-data.js";
import { SimulationClock } from "./simulation/simulation-clock.js";
import { StateQueryCoordinator } from "./simulation/state-query-coordinator.js";
import { StartupInstrumentation, type StartupDiagnostics } from "./simulation/startup-instrumentation.js";
import { orbitInterval, resolveOrbitVisualizationDefinition } from "./simulation/orbit-visualization.js";
import { CelestialBrowser } from "./ui/celestial-browser.js";
import { DemoPanel } from "./ui/demo-panel.js";
import { ResponsiveSurfaceManager } from "./ui/responsive-surfaces.js";
import { StartupLoader } from "./ui/startup-loader.js";
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
  readonly planetTextureSetId?: string;
  readonly planetTextureLayers?: readonly Readonly<{
    readonly purpose: string;
    readonly assetKey: string;
    readonly loaded: boolean;
  }>[];
  readonly physicalIrradianceWattsPerSquareMeter?: number;
  readonly preExposureMappedIrradiance?: number;
  readonly displayExposure: number;
  readonly toneMappingMode: "ACESFilmic";
  readonly atmosphere: Pick<AtmosphereDiagnostics, "resourcesAllocated" | "visible" | "projectedDiameterPixels" | "viewSampleCount" | "opticalSource" | "resolvedOptics">;
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

type DemoDisplayExposureDiagnostics = DisplayExposureDiagnostics & { readonly toneMappingMode: "ACESFilmic" };

interface BrowserRenderDiagnostics {
  readonly focusId: string;
  readonly selectedId: string;
  readonly lighting: ReturnType<typeof lightingModeDiagnostics>;
  readonly displayExposure: DemoDisplayExposureDiagnostics;
  readonly atmosphereResourceCount: number;
  readonly planetTextureResources: ReturnType<SolarSystemScene["planetTextureResourceDiagnostics"]>;
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
    __orbitDemoStartupDiagnostics?: () => StartupDiagnostics;
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
  const startup = new StartupInstrumentation();
  startup.mark("bootstrap-start");
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
  let snapshotSource: OrbitEngineSnapshotSource | undefined;

  function centerCameraOnFocus(): void {
    const currentScene = scene;
    const focusPosition = currentScene?.positionFor(focusId);
    if (focusPosition === undefined || renderShell === undefined || currentScene === undefined) return;
    const sunDirection = currentScene.renderDiagnosticsFor(focusId, renderShell.camera)?.stellarDirections
      .find((direction) => direction.emitterId === SUN_ID)
      ?.renderDirectionToEmitter;
    renderShell.centerOn(focusPosition, currentScene.focusDistanceFor(focusId), sunDirection);
  }

  function updateDisplayExposure(): void {
    renderShell?.setDisplayExposure(scene?.displayExposureDiagnostics().displayExposure ?? 1);
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
    if (selectedEntry?.definition.centralBody !== undefined) {
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
    const candidates = entries.filter((entry) => entry.definition.centralBody !== undefined
      && (entry.definition.type !== ObjectType.asteroid || entry.definition.id === selectedId));
    return [...candidates].sort((left, right) => {
      const priority = (entry: SolarSystemScenario["bodies"][number]): number =>
        entry.definition.id === selectedId ? 0 : entry.definition.id === focusId ? 1 : 2;
      return priority(left) - priority(right);
    });
  }

  function sampleReferenceOrbit(entry: SolarSystemScenario["bodies"][number]): boolean {
    if (snapshotSource === undefined || scene === undefined || scenario === undefined) return false;
    try {
      const parentId = entry.definition.centralBody;
      if (parentId === undefined) return false;
      const anchorInstant = clock.currentInstant();
      const visualization = resolveOrbitVisualizationDefinition({
        scenario,
        body: entry,
        anchorInstant,
        stateAt: (objectIdValue, centralBodyId, target, outputFrame) => engine!.relativeStateAt(objectIdValue, centralBodyId, target, outputFrame),
      });
      const interval = orbitInterval(scenario, visualization, anchorInstant);
      const path = snapshotSource.sampleOrbitPath({
        objectId: entry.definition.id,
        parentId,
        frame: scenario.rootFrame,
        interval,
        sampleCount: visualization.sampleCount,
        closedReferenceOrbit: visualization.closedReferenceOrbit,
      });
      scene.setPath(path);
      return true;
    } catch {
      return false;
    }
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
        startup.mark("deferred-orbit-population-complete");
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
      const focusEntry = stateSource?.bodyFor(focusId);
      if (focusEntry?.definition.centralBody !== undefined) sampleReferenceOrbit(focusEntry);
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
  const startupLoader = new StartupLoader();
  startupLoader.setLoading({
    phase: "bootstrap",
    label: "Setting things up",
    detail: "Getting the view ready for you…",
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

  window.__orbitDemoStartupDiagnostics = () => startup.diagnostics();

  try {
    renderShell = createRenderShell(canvas);
    guides = new SceneGuides(renderShell.scene);
    guides.updateForCamera(renderShell.camera);
    startup.mark("webgl-ready");
    startupLoader.setLoading({
      phase: "engine",
      label: "Starting the simulation",
      detail: "Getting the Solar System ready…",
    });
    panel.setRenderingStatus("pending", "WebGL shell ready", "Preparing the first view");
  } catch (error) {
    if (error instanceof WebGL2UnavailableError) {
      panel.setRenderingStatus("unsupported", "WebGL 2 unavailable", error.message);
    } else {
      panel.setRenderingStatus("error", "Rendering initialization failed", error instanceof Error ? error.message : String(error));
    }
    startupLoader.setError(error instanceof Error ? error.message : String(error));
    return;
  }

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
    updateDisplayExposure();
    renderShell!.renderer.render(renderShell!.scene, camera);
  };

  let pointerDown: (PointerCoordinates & { readonly pointerId: number }) | undefined;
  let suppressNextCanvasClick = false;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerDown = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    suppressNextCanvasClick = false;
  });
  canvas.addEventListener("pointermove", (event) => {
    if (pointerDown?.pointerId !== event.pointerId) return;
    if (!isPointerClick(pointerDown, event)) suppressNextCanvasClick = true;
  });
  canvas.addEventListener("pointerup", (event) => {
    if (pointerDown?.pointerId !== event.pointerId) return;
    if (!isPointerClick(pointerDown, event)) suppressNextCanvasClick = true;
    pointerDown = undefined;
  });
  canvas.addEventListener("pointercancel", (event) => {
    if (pointerDown?.pointerId !== event.pointerId) return;
    pointerDown = undefined;
    suppressNextCanvasClick = true;
  });
  canvas.addEventListener("click", (event) => {
    const suppressClick = suppressNextCanvasClick;
    suppressNextCanvasClick = false;
    if (event.button !== 0 || suppressClick) return;
    if (scene === undefined || renderShell === undefined) return;
    const bounds = canvas.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    scene.selectFromPointer(x, y, renderShell.camera);
  });

  const animationLoop = createAnimationLoop(() => {
    const frameStartedAt = performance.now();
    clock.advanceTo(performance.now());
    updateClockUi();
    if (coordinator !== undefined) requestCurrentState();
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
    updateDisplayExposure();
    renderShell!.renderer.render(renderShell!.scene, renderShell!.camera);
    if (renderedFrameCount === 0) startup.mark("first-rendered-frame");
    lastFrameDurationMs = Math.max(0, performance.now() - frameStartedAt);
    totalFrameDurationMs += lastFrameDurationMs;
    renderedFrameCount += 1;
  });
  animationLoop.start();
  window.addEventListener("beforeunload", () => {
    animationLoop.stop();
    surfaceManager.dispose();
    window.removeEventListener("resize", resize);
    delete window.__orbitDemoRenderDiagnostics;
    delete window.__orbitDemoReferenceDiagnostics;
    delete window.__orbitDemoSetCameraFixture;
    delete window.__orbitDemoStartupDiagnostics;
    guides?.dispose();
    scene?.dispose();
    renderShell?.dispose();
    browser?.dispose();
  }, { once: true });

  try {
    engine = await createDemoEngine();
    engineHealth = engine.health();
    startup.mark("wasm-engine-ready");
    startupLoader.setLoading({
      phase: "manifest",
      label: "Checking the Solar System data",
      detail: "Making sure everything is ready…",
    });
    panel.setEngineStatus("ready", "Engine ready", `WASM · protocol ${engineHealth.protocolVersion} · core ${engineHealth.coreVersion}`);
  } catch (error) {
    panel.setEngineStatus("error", "Engine initialization failed", error instanceof Error ? error.message : String(error));
    startupLoader.setError(error instanceof Error ? error.message : String(error));
    return;
  }

  try {
    panel.setScenarioNote("pending", "Loading production Solar-System OEP…");
    const referenceDataset = await loadSolarSystemReferenceDataset(engine, {
      onProgress: (progress) => {
        if (progress.phase === "manifest-ready") {
          startup.mark("manifest-ready");
          startupLoader.setLoading({
            phase: "shards",
            label: "Loading Solar System data",
            detail: `Found ${progress.totalShards} data packages.`,
            fraction: 0,
          });
          panel.setScenarioNote("pending", `Loading ${progress.totalShards} Solar System data packages…`);
        } else if (progress.phase === "shard-validated") {
          startupLoader.setLoading({
            phase: "shards",
            label: "Loading Solar System data",
            detail: `Loaded ${progress.loadedShards} of ${progress.totalShards} data packages${progress.shardId === undefined ? "" : ` · ${progress.shardId}`}.`,
            fraction: progress.loadedShards / progress.totalShards,
          });
          panel.setScenarioNote(
            "pending",
            `Loaded Solar System data package ${progress.loadedShards}/${progress.totalShards}${progress.shardId === undefined ? "" : ` · ${progress.shardId}`}…`,
          );
        } else if (progress.phase === "required-oep-data-ready") {
          startup.mark("required-oep-data-ready");
          startupLoader.setLoading({
            phase: "dataset",
            label: "Preparing the simulation",
            detail: "The data is loaded. Now we’re getting it ready to run…",
          });
          panel.setScenarioNote("pending", "Solar System data loaded · preparing the simulation…");
        } else if (progress.phase === "dataset-ready") {
          startup.mark("dataset-ready");
          startupLoader.setLoading({
            phase: "scene",
            label: "Almost ready",
            detail: "Putting the finishing touches on your view…",
          });
          panel.setScenarioNote("pending", "Production OEP dataset ready · registering Solar-System bodies…");
        }
      },
    });
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
    snapshotSource = createOrbitEngineSnapshotSource(engine, (objectIdValue, record) => {
      const entry = scenario!.bodyById.get(objectIdValue);
      if (entry === undefined) return { objectType: record.type, parentId: record.structuralParent };
      return {
        parentId: entry.definition.centralBody,
        objectType: entry.definition.type,
        physicalRadiusMeters: entry.record.properties.physicalRadius ?? entry.definition.properties.physicalRadius,
        appearance: entry.definition.appearance,
        accentColor: entry.definition.display.accentColor,
        propertyRevision: entry.record.propertyRevision,
        stateRevision: entry.record.motion.motionRevision,
      };
    });
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
    startupLoader.setError(error instanceof Error ? error.message : String(error));
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
      startup.mark("first-state-frame-ready");
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
    if (renderShell === undefined || guides === undefined || stateSource === undefined || scenario === undefined) {
      throw new Error("Rendering prerequisites are unavailable after dataset initialization");
    }
    scene = new SolarSystemScene(renderShell.scene, scenario, {
      onSelect: setSelectedBody,
    });
    scene.setLightingMode(lightingMode);
    scene.setCurrentBodies(stateSource.currentBodies());
    scene.setFocusId(focusId);
    scene.setSelected(selectedId);
    updateDisplayExposure();
    window.__orbitDemoRenderDiagnostics = () => ({
      focusId,
      selectedId,
      lighting: scene?.lightingDiagnostics() ?? lightingModeDiagnostics(lightingMode, []),
      displayExposure: scene!.displayExposureDiagnostics(),
      atmosphereResourceCount: scene?.atmosphereResourceCount() ?? 0,
      planetTextureResources: scene?.planetTextureResourceDiagnostics() ?? {
        activeResourceCount: 0,
        pendingResourceCount: 0,
        activeReferenceCount: 0,
        loadRequestCount: 0,
      },
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
          planetTextureSetId: diagnostics?.planetTextureSetId,
          planetTextureLayers: diagnostics?.planetTextureLayers,
          physicalIrradianceWattsPerSquareMeter: diagnostics?.physicalIrradianceWattsPerSquareMeter,
          preExposureMappedIrradiance: diagnostics?.preExposureMappedIrradiance,
          displayExposure: diagnostics?.displayExposure ?? 1,
          toneMappingMode: diagnostics?.toneMappingMode ?? "ACESFilmic",
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
              resolvedOptics: atmosphere?.resolvedOptics,
            };
          })(),
        };
      }),
    });
    startup.mark("scene-ready");
    startupLoader.setReady();
    panel.setRenderingStatus("ready", "WebGL ready", "WebGL 2 · identity axes · +Z up");
  } catch (error) {
    if (error instanceof WebGL2UnavailableError) {
      panel.setRenderingStatus("unsupported", "WebGL 2 unavailable", error.message);
    } else {
      panel.setRenderingStatus("error", "Rendering initialization failed", error instanceof Error ? error.message : String(error));
    }
    startupLoader.setError(error instanceof Error ? error.message : String(error));
    return;
  }

  panel.setControlsReady(true);
  panel.setGuideSettings(guides?.settings() ?? DEFAULT_SCENE_GUIDE_SETTINGS);
  panel.setOrbitsVisible(scene?.orbitsVisible() ?? true);
  requestCurrentState();
  scheduleReferenceOrbitResample();
}

void bootstrap();
