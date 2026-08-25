declare module "@funsoftware/planettech" {
  import type * as THREE from "three";

  export interface PlanetInfrastructureConfig {
    readonly useWorkers?: boolean;
    readonly material?: THREE.Material;
  }

  export interface PlanetSphereParameters extends PlanetInfrastructureConfig {
    readonly offset: number;
    readonly levels: number;
    readonly size: number;
    readonly radius: number;
    readonly resolution: number;
    readonly dimension: number;
  }

  export interface PlanetPrimitive {
    readonly infrastructure: {
      readonly config: PlanetInfrastructureConfig & Record<string, unknown>;
    };
    update(object3D: Pick<THREE.Object3D, "position">): void;
  }

  export class Planet extends THREE.Object3D {
    readonly primitive: PlanetPrimitive;
    initSphere(parameters: PlanetSphereParameters): void;
    create(): void;
  }
}
