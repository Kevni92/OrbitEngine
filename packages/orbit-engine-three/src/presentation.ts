export const ORBIT_ENGINE_THREE_PRESENTATION_ENTRY = "orbit-engine-three/presentation" as const;

export interface PresentationPackageInfo {
  readonly packageName: "orbit-engine-three";
  readonly entryPoint: typeof ORBIT_ENGINE_THREE_PRESENTATION_ENTRY;
}

export const presentationPackageInfo: PresentationPackageInfo = Object.freeze({
  packageName: "orbit-engine-three",
  entryPoint: ORBIT_ENGINE_THREE_PRESENTATION_ENTRY,
});

export * from "./presentation/appearance.js";
export * from "./presentation/atmosphere.js";
export * from "./presentation/illumination.js";
export * from "./presentation/lighting.js";
export * from "./presentation/optics.js";
