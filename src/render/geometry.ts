import * as THREE from 'three';
import type { MeshBuffers } from './mesher';

/** Wraps mesher output in a BufferGeometry (positions stay compact Uint16 in 1/16 units). */
export function toGeometry(b: MeshBuffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(b.positions, 3));
  g.setAttribute('colorFace', new THREE.BufferAttribute(b.colorFace, 4));
  g.setAttribute('layerType', new THREE.BufferAttribute(b.layerType, 2));
  g.setIndex(new THREE.BufferAttribute(b.indices, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Mesh for chunk-relative buffers: scale 1/16 turns the stored units into blocks. */
export function makeBlockMesh(b: MeshBuffers, material: THREE.Material, origin: [number, number, number]): THREE.Mesh {
  const mesh = new THREE.Mesh(toGeometry(b), material);
  mesh.scale.setScalar(1 / 16);
  mesh.position.set(origin[0], origin[1], origin[2]);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
