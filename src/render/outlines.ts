import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

/** Edges of a unit cube, slightly enlarged so the lines sit on top of the faces. */
function cubeEdges(pad: number): Float32Array {
  const a = -pad;
  const b = 1 + pad;
  const c = [
    [a, a, a], [b, a, a], [b, a, b], [a, a, b],
    [a, b, a], [b, b, a], [b, b, b], [a, b, b],
  ];
  const e = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
  const out = new Float32Array(e.length * 3);
  e.forEach((i, k) => out.set(c[i], k * 3));
  return out;
}

const outlineVertex = /* glsl */ `
in vec3 offset;
void main() {
  gl_Position = projectionMatrix * viewMatrix * vec4(position + offset, 1.0);
}
`;
const outlineFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
void main() { gl_FragColor = vec4(uColor, uAlpha); }
`;

/**
 * Wireframe outlines for many blocks at once (all blocks of the hovered type).
 * One instanced draw call for the visible edges plus one faint "x-ray" pass for hidden ones.
 */
export class TypeOutlines {
  readonly group = new THREE.Group();
  private geometry: THREE.InstancedBufferGeometry;
  private offsets: THREE.InstancedBufferAttribute;
  private capacity = 0;
  count = 0;

  constructor(color = 0xffd23f) {
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(cubeEdges(0.004), 3));
    this.offsets = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
    this.geometry.setAttribute('offset', this.offsets);
    this.geometry.instanceCount = 0;

    const visible = new THREE.ShaderMaterial({
      vertexShader: outlineVertex,
      fragmentShader: outlineFragment,
      uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 } },
      transparent: true,
    });
    const hidden = new THREE.ShaderMaterial({
      vertexShader: outlineVertex,
      fragmentShader: outlineFragment,
      uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0.22 } },
      transparent: true,
      depthWrite: false,
      depthFunc: THREE.GreaterDepth,
    });
    const a = new THREE.LineSegments(this.geometry, visible);
    const b = new THREE.LineSegments(this.geometry, hidden);
    for (const l of [a, b]) {
      l.frustumCulled = false;
      l.renderOrder = 10;
    }
    this.group.add(a, b);
    this.group.visible = false;
  }

  /** Positions as block coordinates (x, y, z triples). */
  set(positions: Float32Array, count: number): void {
    if (count > this.capacity) {
      this.capacity = Math.max(count, Math.ceil(this.capacity * 1.5), 64);
      this.offsets = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
      this.offsets.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute('offset', this.offsets);
    }
    (this.offsets.array as Float32Array).set(positions.subarray(0, count * 3));
    this.offsets.needsUpdate = true;
    this.offsets.clearUpdateRanges();
    this.offsets.addUpdateRange(0, count * 3);
    this.geometry.instanceCount = count;
    this.count = count;
    this.group.visible = count > 0;
  }

  clear(): void {
    this.geometry.instanceCount = 0;
    this.count = 0;
    this.group.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const c of this.group.children) ((c as THREE.LineSegments).material as THREE.Material).dispose();
  }
}

/** Thick outline around the hovered block's actual shape. */
export class HoverOutline {
  readonly object: LineSegments2;
  private material: LineMaterial;

  constructor() {
    this.material = new LineMaterial({ color: 0xffffff, linewidth: 2.5, transparent: true, opacity: 0.95, depthTest: true });
    this.object = new LineSegments2(new LineSegmentsGeometry(), this.material);
    this.object.visible = false;
    this.object.renderOrder = 11;
    this.object.frustumCulled = false;
  }

  setResolution(w: number, h: number): void {
    this.material.resolution.set(w, h);
  }

  /** boxes: 1/16 units within the block at (x, y, z). */
  show(x: number, y: number, z: number, boxes: ArrayLike<number>): void {
    const edges = cubeEdges(0);
    const pad = 0.006;
    const pts: number[] = [];
    for (let i = 0; i < boxes.length; i += 6) {
      const x0 = x + boxes[i] / 16 - pad;
      const y0 = y + boxes[i + 1] / 16 - pad;
      const z0 = z + boxes[i + 2] / 16 - pad;
      const sx = (boxes[i + 3] - boxes[i]) / 16 + 2 * pad;
      const sy = (boxes[i + 4] - boxes[i + 1]) / 16 + 2 * pad;
      const sz = (boxes[i + 5] - boxes[i + 2]) / 16 + 2 * pad;
      for (let k = 0; k < edges.length; k += 3) pts.push(x0 + edges[k] * sx, y0 + edges[k + 1] * sy, z0 + edges[k + 2] * sz);
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pts);
    this.object.geometry.dispose();
    this.object.geometry = geo;
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
