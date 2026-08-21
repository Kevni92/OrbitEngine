import { createDemoEngine } from "./engine/create-engine.js";
import {
  createAnimationLoop,
  createRenderShell,
  WebGL2UnavailableError,
  type RenderShell,
} from "./rendering/three-shell.js";
import { SimulationClock } from "./simulation/simulation-clock.js";

const engineStatus = document.querySelector<HTMLElement>("#engine-status");
const renderingStatus = document.querySelector<HTMLElement>("#rendering-status");
const simulationInstant = document.querySelector<HTMLElement>("#simulation-instant");
const playPause = document.querySelector<HTMLButtonElement>("#play-pause");
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

async function bootstrap(): Promise<void> {
  updateClockUi();
  if (canvas === null) {
    setStatus(engineStatus, "error", "Canvas element is missing.");
    return;
  }

  try {
    const engine = await createDemoEngine();
    const health = engine.health();
    setStatus(engineStatus, "ready", `WASM ready · protocol ${health.protocolVersion} · core ${health.coreVersion}`);
    if (playPause !== null) playPause.disabled = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(engineStatus, "error", `WASM initialization failed: ${message}`);
    return;
  }

  let renderShell: RenderShell | undefined;
  try {
    renderShell = createRenderShell(canvas);
    setStatus(renderingStatus, "ready", "WebGL 2 ready · identity axes · +Z up");
  } catch (error) {
    if (error instanceof WebGL2UnavailableError) {
      setStatus(renderingStatus, "unsupported", error.message);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(renderingStatus, "error", `Rendering initialization failed: ${message}`);
    }
  }

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
    renderShell.renderer.render(renderShell.scene, renderShell.camera);
  });
  loop.start();
  window.addEventListener("beforeunload", () => {
    loop.stop();
    window.removeEventListener("resize", resize);
    renderShell.dispose();
  }, { once: true });
}

void bootstrap();
