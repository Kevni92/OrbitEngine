import * as THREE from "three";

/**
 * Three.js sphere UVs use +Y as the polar axis. Equirectangular planet maps
 * put their north pole at the top edge, so rotate texture-aligned meshes by
 * +90° about X to present that pole along the demo's +Z ecliptic normal.
 */
export const TEXTURED_BODY_POLE_ALIGNMENT_ROTATION_X_RADIANS = Math.PI / 2;

export function applyTexturedBodyPoleAlignment(object: THREE.Object3D): void {
  object.rotation.set(TEXTURED_BODY_POLE_ALIGNMENT_ROTATION_X_RADIANS, 0, 0);
}
