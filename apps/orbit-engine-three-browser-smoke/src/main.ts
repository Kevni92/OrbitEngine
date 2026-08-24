import { CelestialSystemView, ORBIT_ENGINE_THREE_PACKAGE_NAME, createCelestialRenderSnapshot } from "orbit-engine-three";
import { createCelestialAppearance, presentationPackageInfo } from "orbit-engine-three/presentation";
import type { ObjectId, SimulationInstant } from "orbit-engine";

const status = document.querySelector<HTMLParagraphElement>("#status");
const objectId = (value: string): ObjectId => value as ObjectId;
const simulationInstant = (seconds: number, nanoseconds = 0): SimulationInstant => Object.freeze({ seconds, nanoseconds }) as unknown as SimulationInstant;

try {
  const sunId = objectId("1");
  const planetId = objectId("2");
  const provenance = [{
    source: "browser-smoke",
    sourceIdentifier: "browser-smoke:173",
    fields: ["visibleLayer", "atmosphere", "stellarEmission"],
    normalization: "test values are normalized",
    limitations: "browser smoke fixture",
  }];
  const view = new CelestialSystemView({ configuration: { renderSpace: { metersPerSceneUnit: 1e9 } } });
  const result = view.update(createCelestialRenderSnapshot({
    instant: simulationInstant(0),
    origin: { kind: "frame", frameId: "browser-smoke:origin" },
    bodies: [
      {
        objectId: sunId,
        positionRelativeToOriginMeters: { x: 0, y: 0, z: 0 },
        physicalRadiusMeters: 6.9634e8,
        appearance: createCelestialAppearance({
          schemaVersion: "1.0",
          stellarEmission: { effectiveTemperatureKelvin: 5772, luminosityWatts: 3.828e26 },
          provenance,
        }),
      },
      {
        objectId: planetId,
        positionRelativeToOriginMeters: { x: 1.495978707e11, y: 0, z: 0 },
        physicalRadiusMeters: 6.371e6,
        parentId: sunId,
        appearance: createCelestialAppearance({
          schemaVersion: "1.0",
          visibleLayer: { kind: "solidSurface", composition: [{ materialId: "basaltic-rock", fraction: 1 }] },
          atmosphere: {
            referencePressurePa: 101325,
            scaleHeightMeters: 8500,
            gases: [{ gasId: "N2", mixingRatio: 1 }],
            optics: {
              rayleighScattering: { r: 0.1, g: 0.2, b: 0.9 },
              mieScattering: { r: 0.03, g: 0.03, b: 0.03 },
              absorption: { r: 0.01, g: 0.01, b: 0.01 },
              referenceVerticalOpticalDepth: 0.5,
              mieAnisotropy: 0,
            },
            cloudLayers: [],
          },
          provenance,
        }),
      },
    ],
  }));
  const diagnostics = view.diagnostics();
  if (!result.committed || diagnostics.bodyCount !== 2 || diagnostics.atmosphereCount !== 1) throw new Error("snapshot resource update failed");
  if (status !== null) {
    status.dataset.orbitEngineThreeSmoke = "ready";
    status.dataset.renderResources = "ready";
    status.textContent = `ready:${ORBIT_ENGINE_THREE_PACKAGE_NAME}:${presentationPackageInfo.entryPoint}:resources:${diagnostics.bodyCount}:${diagnostics.atmosphereCount}`;
  }
} catch (error) {
  if (status !== null) {
    status.dataset.orbitEngineThreeSmoke = "error";
    status.textContent = `error:${error instanceof Error ? error.message : String(error)}`;
  }
}
