/**
 * Stable package marker for the renderer-neutral presentation entry point.
 *
 * Semantic appearance and derivation APIs are added here by the next package
 * implementation stage. Keeping this entry point separate prevents consumers
 * from depending on Three.js implementation details.
 */
export const ORBIT_ENGINE_THREE_PRESENTATION_ENTRY = "orbit-engine-three/presentation" as const;

export interface PresentationPackageInfo {
  readonly packageName: "orbit-engine-three";
  readonly entryPoint: typeof ORBIT_ENGINE_THREE_PRESENTATION_ENTRY;
}

export const presentationPackageInfo: PresentationPackageInfo = Object.freeze({
  packageName: "orbit-engine-three",
  entryPoint: ORBIT_ENGINE_THREE_PRESENTATION_ENTRY,
});
