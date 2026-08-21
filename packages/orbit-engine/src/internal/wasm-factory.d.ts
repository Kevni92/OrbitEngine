export interface EmscriptenWasmFactoryOptions {
  readonly locateFile: (fileName: string) => string;
}

export interface EmscriptenWasmFactoryModule {
  readonly default?: (options: EmscriptenWasmFactoryOptions) => Promise<unknown>;
}

declare module "*orbit_engine_wasm.js" {
  const createOrbitEngineWasmModule: (
    options: EmscriptenWasmFactoryOptions,
  ) => Promise<unknown>;

  export default createOrbitEngineWasmModule;
}
