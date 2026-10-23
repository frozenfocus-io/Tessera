import type { Box, ShapeSpec } from './shapes';

/**
 * Exterior faces of a block shape, computed by rasterising its boxes into a 16³ micro grid and
 * extracting the visible faces per plane (greedy-merged). This removes hidden internal faces
 * (e.g. the slab top below a stair step) and overlapping boxes cleanly.
 *
 * Face record (8 × int16): dir, x0, y0, z0, x1, y1, z1, boundary
 * Coordinates in 1/16 block; boundary = 1 if the face lies on the cell border in its normal
 * direction (then a solid neighbour hides it).
 */
export interface ShapeGeometry {
  faces: Int16Array;
  faceCount: number;
  /** Boxes for ray picking, 6 floats each, 1/16 units. */
  boxes: Float32Array;
  /** Cross plants: height in 1/16 (0 for other shapes). */
  cross: number;
}

export const FACE_STRIDE = 8;

const N = 16;

function clampBox(b: Box): Box {
  const c = (v: number) => Math.max(0, Math.min(16, Math.round(v)));
  const out: Box = [c(b[0]), c(b[1]), c(b[2]), c(b[3]), c(b[4]), c(b[5])];
  if (out[3] < out[0]) [out[0], out[3]] = [out[3], out[0]];
  if (out[4] < out[1]) [out[1], out[4]] = [out[4], out[1]];
  if (out[5] < out[2]) [out[2], out[5]] = [out[5], out[2]];
  return out;
}

export function buildShapeGeometry(spec: ShapeSpec): ShapeGeometry {
  if (spec.kind === 'cross') {
    const h = Math.max(1, Math.min(16, Math.round(spec.height)));
    return { faces: new Int16Array(0), faceCount: 0, boxes: Float32Array.from([2, 0, 2, 14, h, 14]), cross: h };
  }
  if (spec.kind === 'cube') {
    return { faces: cubeFaces(), faceCount: 6, boxes: Float32Array.from([0, 0, 0, 16, 16, 16]), cross: 0 };
  }
  if (spec.kind === 'none') {
    return { faces: new Int16Array(0), faceCount: 0, boxes: new Float32Array(0), cross: 0 };
  }

  const boxes = spec.boxes.map(clampBox).filter((b) => b[3] > b[0] && b[4] > b[1] && b[5] > b[2]);
  const occ = new Uint8Array(N * N * N);
  for (const [x0, y0, z0, x1, y1, z1] of boxes) {
    for (let z = z0; z < z1; z++)
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) occ[x + N * (y + N * z)] = 1;
  }
  const get = (x: number, y: number, z: number): number =>
    x < 0 || y < 0 || z < 0 || x >= N || y >= N || z >= N ? 0 : occ[x + N * (y + N * z)];

  const out: number[] = [];
  const mask = new Uint8Array(N * N);

  // For each direction: plane coordinate p, mask over the two in-plane axes (a, b).
  for (let dir = 0; dir < 6; dir++) {
    const axis = dir >> 1; // 0 = x, 1 = y, 2 = z
    const positive = (dir & 1) === 0;
    for (let p = 0; p <= N; p++) {
      let any = false;
      for (let a = 0; a < N; a++) {
        for (let b = 0; b < N; b++) {
          // inside cell is on the negative side of the plane for positive faces
          const inside = positive ? p - 1 : p;
          const outside = positive ? p : p - 1;
          let iv: number, ov: number;
          if (axis === 0) {
            iv = get(inside, a, b);
            ov = get(outside, a, b);
          } else if (axis === 1) {
            iv = get(a, inside, b);
            ov = get(a, outside, b);
          } else {
            iv = get(a, b, inside);
            ov = get(a, b, outside);
          }
          const v = iv && !ov ? 1 : 0;
          mask[a * N + b] = v;
          if (v) any = true;
        }
      }
      if (!any) continue;
      const boundary = positive ? p === N : p === 0;
      // Greedy merge rectangles in the (a, b) mask.
      for (let a = 0; a < N; a++) {
        for (let b = 0; b < N; ) {
          if (!mask[a * N + b]) {
            b++;
            continue;
          }
          let w = 1;
          while (b + w < N && mask[a * N + b + w]) w++;
          let h = 1;
          outer: while (a + h < N) {
            for (let k = 0; k < w; k++) if (!mask[(a + h) * N + b + k]) break outer;
            h++;
          }
          for (let da = 0; da < h; da++) for (let k = 0; k < w; k++) mask[(a + da) * N + b + k] = 0;
          // a-range [a, a+h), b-range [b, b+w)
          let x0: number, y0: number, z0: number, x1: number, y1: number, z1: number;
          if (axis === 0) {
            x0 = x1 = p;
            y0 = a;
            y1 = a + h;
            z0 = b;
            z1 = b + w;
          } else if (axis === 1) {
            y0 = y1 = p;
            x0 = a;
            x1 = a + h;
            z0 = b;
            z1 = b + w;
          } else {
            z0 = z1 = p;
            x0 = a;
            x1 = a + h;
            y0 = b;
            y1 = b + w;
          }
          out.push(dir, x0, y0, z0, x1, y1, z1, boundary ? 1 : 0);
          b += w;
        }
      }
    }
  }

  const flat = new Float32Array(boxes.length * 6);
  boxes.forEach((b, i) => flat.set(b, i * 6));
  return { faces: Int16Array.from(out), faceCount: out.length / FACE_STRIDE, boxes: flat, cross: 0 };
}

function cubeFaces(): Int16Array {
  return Int16Array.from([
    0, 16, 0, 0, 16, 16, 16, 1,
    1, 0, 0, 0, 0, 16, 16, 1,
    2, 0, 16, 0, 16, 16, 16, 1,
    3, 0, 0, 0, 16, 0, 16, 1,
    4, 0, 0, 16, 16, 16, 16, 1,
    5, 0, 0, 0, 16, 16, 0, 1,
  ]);
}
