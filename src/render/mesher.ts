import {
  FLAG_CULL_SAME,
  FLAG_OCCLUDES,
  FLAG_TRANSLUCENT,
  KIND_CROSS,
  KIND_CUBE,
  KIND_SHAPE,
  type RenderTable,
} from '../blocks/blockModel';
import { FACE_STRIDE } from '../blocks/shapeGeometry';

/**
 * Chunk mesher (pure, runs in Web Workers).
 *
 * - Full cubes are greedy-merged per layer: top/bottom faces in 2D, side faces as runs along
 *   the layer. Faces are never merged across layers, so every vertex belongs to exactly one
 *   layer – the shader can hide layers above / grey out layers below without re-meshing.
 * - Faces are culled against solid (occluding) neighbours; translucent blocks also against
 *   neighbours of the same type (glass next to glass).
 * - Other shapes (stairs, fences, …) emit their precomputed exterior faces; faces on the cell
 *   border are culled against solid neighbours.
 *
 * Vertex format (compact, see blockMaterial.ts):
 *   position  : Uint16 × 3, 1/16 block units relative to the chunk origin
 *   colorFace : Uint8 × 4  (r, g, b, face 0..5 or 6 for cross plants)
 *   layerType : Uint16 × 2 (absolute layer y, block type id)
 */

export const FACE_CROSS = 6;

export interface MeshBuffers {
  positions: Uint16Array;
  colorFace: Uint8Array;
  layerType: Uint16Array;
  indices: Uint16Array | Uint32Array;
  vertexCount: number;
  quadCount: number;
}

export interface ChunkMeshResult {
  opaque: MeshBuffers | null;
  translucent: MeshBuffers | null;
}

class Builder {
  pos: Uint16Array;
  cf: Uint8Array;
  lt: Uint16Array;
  vertexCount = 0;
  private cap: number;

  constructor(initialQuads = 256) {
    this.cap = initialQuads * 4;
    this.pos = new Uint16Array(this.cap * 3);
    this.cf = new Uint8Array(this.cap * 4);
    this.lt = new Uint16Array(this.cap * 2);
  }

  private grow(): void {
    this.cap *= 2;
    const pos = new Uint16Array(this.cap * 3);
    pos.set(this.pos);
    const cf = new Uint8Array(this.cap * 4);
    cf.set(this.cf);
    const lt = new Uint16Array(this.cap * 2);
    lt.set(this.lt);
    this.pos = pos;
    this.cf = cf;
    this.lt = lt;
  }

  vertex(x: number, y: number, z: number, rgb: number, face: number, layer: number, type: number): void {
    if (this.vertexCount >= this.cap) this.grow();
    const v = this.vertexCount++;
    this.pos[v * 3] = x;
    this.pos[v * 3 + 1] = y;
    this.pos[v * 3 + 2] = z;
    this.cf[v * 4] = (rgb >> 16) & 255;
    this.cf[v * 4 + 1] = (rgb >> 8) & 255;
    this.cf[v * 4 + 2] = rgb & 255;
    this.cf[v * 4 + 3] = face;
    this.lt[v * 2] = layer;
    this.lt[v * 2 + 1] = type;
  }

  /**
   * Axis-aligned quad with zero thickness along the face normal, coordinates in 1/16 units.
   * Winding is counter-clockwise seen from outside.
   */
  quad(dir: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, rgb: number, layer: number, type: number): void {
    switch (dir) {
      case 0: // +X
        this.vertex(x0, y0, z1, rgb, dir, layer, type);
        this.vertex(x0, y0, z0, rgb, dir, layer, type);
        this.vertex(x0, y1, z0, rgb, dir, layer, type);
        this.vertex(x0, y1, z1, rgb, dir, layer, type);
        break;
      case 1: // -X
        this.vertex(x0, y0, z0, rgb, dir, layer, type);
        this.vertex(x0, y0, z1, rgb, dir, layer, type);
        this.vertex(x0, y1, z1, rgb, dir, layer, type);
        this.vertex(x0, y1, z0, rgb, dir, layer, type);
        break;
      case 2: // +Y
        this.vertex(x0, y0, z0, rgb, dir, layer, type);
        this.vertex(x0, y0, z1, rgb, dir, layer, type);
        this.vertex(x1, y0, z1, rgb, dir, layer, type);
        this.vertex(x1, y0, z0, rgb, dir, layer, type);
        break;
      case 3: // -Y
        this.vertex(x0, y0, z0, rgb, dir, layer, type);
        this.vertex(x1, y0, z0, rgb, dir, layer, type);
        this.vertex(x1, y0, z1, rgb, dir, layer, type);
        this.vertex(x0, y0, z1, rgb, dir, layer, type);
        break;
      case 4: // +Z
        this.vertex(x0, y0, z0, rgb, dir, layer, type);
        this.vertex(x1, y0, z0, rgb, dir, layer, type);
        this.vertex(x1, y1, z0, rgb, dir, layer, type);
        this.vertex(x0, y1, z0, rgb, dir, layer, type);
        break;
      default: // -Z
        this.vertex(x1, y0, z0, rgb, dir, layer, type);
        this.vertex(x0, y0, z0, rgb, dir, layer, type);
        this.vertex(x0, y1, z0, rgb, dir, layer, type);
        this.vertex(x1, y1, z0, rgb, dir, layer, type);
        break;
    }
  }

  /** Two-sided diagonal planes for cross-shaped plants. (x, y, z) = cell corner in 1/16 units. */
  cross(x: number, y: number, z: number, h: number, rgb: number, layer: number, type: number): void {
    const a = 2;
    const b = 14;
    const planes = [
      [x + a, z + a, x + b, z + b],
      [x + b, z + a, x + a, z + b],
    ];
    for (const [sx, sz, ex, ez] of planes) {
      // front
      this.vertex(sx, y, sz, rgb, FACE_CROSS, layer, type);
      this.vertex(ex, y, ez, rgb, FACE_CROSS, layer, type);
      this.vertex(ex, y + h, ez, rgb, FACE_CROSS, layer, type);
      this.vertex(sx, y + h, sz, rgb, FACE_CROSS, layer, type);
      // back
      this.vertex(ex, y, ez, rgb, FACE_CROSS, layer, type);
      this.vertex(sx, y, sz, rgb, FACE_CROSS, layer, type);
      this.vertex(sx, y + h, sz, rgb, FACE_CROSS, layer, type);
      this.vertex(ex, y + h, ez, rgb, FACE_CROSS, layer, type);
    }
  }

  finish(): MeshBuffers | null {
    const n = this.vertexCount;
    if (n === 0) return null;
    const quads = n / 4;
    const indices = n > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4;
      const i = q * 6;
      indices[i] = v;
      indices[i + 1] = v + 1;
      indices[i + 2] = v + 2;
      indices[i + 3] = v;
      indices[i + 4] = v + 2;
      indices[i + 5] = v + 3;
    }
    return {
      positions: this.pos.slice(0, n * 3),
      colorFace: this.cf.slice(0, n * 4),
      layerType: this.lt.slice(0, n * 2),
      indices,
      vertexCount: n,
      quadCount: quads,
    };
  }
}

/** Per-table lookups derived once per project (face merge keys). */
export interface MeshTables {
  table: RenderTable;
  /** Merge key per palette index and face (index * 6 + dir); identical keys may be merged. */
  faceKey: Int32Array;
  keyColor: Uint32Array;
}

export function prepareTables(table: RenderTable): MeshTables {
  const faceKey = new Int32Array(table.size * 6);
  const keys = new Map<string, number>();
  const colors: number[] = [];
  for (let p = 0; p < table.size; p++) {
    for (let d = 0; d < 6; d++) {
      const c = table.faceColors[p * 6 + d];
      const k = `${c}|${table.typeId[p]}|${table.flags[p] & FLAG_TRANSLUCENT}`;
      let id = keys.get(k);
      if (id === undefined) {
        id = colors.length;
        keys.set(k, id);
        colors.push(c);
      }
      faceKey[p * 6 + d] = id;
    }
  }
  return { table, faceKey, keyColor: Uint32Array.from(colors) };
}

/** True if the face of block p in direction dir is hidden by neighbour q. */
function hidden(t: RenderTable, p: number, q: number, dir: number): boolean {
  if (q === 0) return false;
  if (t.flags[q] & FLAG_OCCLUDES) return true;
  if ((t.fullSides[q] >> (dir ^ 1)) & 1) return true;
  return (t.flags[p] & FLAG_CULL_SAME) !== 0 && t.kind[q] === KIND_CUBE && t.typeId[q] === t.typeId[p];
}

export interface ChunkInput {
  /** Padded block data: interior plus a one-cell border, index ((y*D)+z)*W+x. */
  data: Uint16Array;
  sx: number;
  sy: number;
  sz: number;
  /** World position (blocks) of the interior's minimum corner. */
  ox: number;
  oy: number;
  oz: number;
}

export function meshChunk(tables: MeshTables, input: ChunkInput): ChunkMeshResult {
  const { table: t, faceKey, keyColor } = tables;
  const { data, sx, sy, sz, oy } = input;
  const W = sx + 2;
  const D = sz + 2;
  const at = (x: number, y: number, z: number): number => data[((y + 1) * D + (z + 1)) * W + (x + 1)];

  const opaque = new Builder();
  const clear = new Builder();
  const bucket = (p: number): Builder => ((t.flags[p] & FLAG_TRANSLUCENT) !== 0 ? clear : opaque);

  // Masks hold faceKey + 1 (0 = no face) and the palette index of the first block (for bucket/type).
  const mask2 = new Int32Array(sx * sz);
  const owner2 = new Int32Array(sx * sz);
  const run = new Int32Array(Math.max(sx, sz));
  const runOwner = new Int32Array(Math.max(sx, sz));

  for (let y = 0; y < sy; y++) {
    const layer = oy + y;

    // ---- Full cubes: +Y / -Y, greedy in 2D.
    for (const dir of [2, 3]) {
      const dy = dir === 2 ? 1 : -1;
      let any = false;
      for (let z = 0; z < sz; z++) {
        for (let x = 0; x < sx; x++) {
          const p = at(x, y, z);
          let v = 0;
          if (p !== 0 && t.kind[p] === KIND_CUBE && !hidden(t, p, at(x, y + dy, z), dir)) {
            v = faceKey[p * 6 + dir] + 1;
            any = true;
          }
          mask2[z * sx + x] = v;
          owner2[z * sx + x] = p;
        }
      }
      if (!any) continue;
      const plane = (dir === 2 ? y + 1 : y) * 16;
      for (let z = 0; z < sz; z++) {
        for (let x = 0; x < sx; ) {
          const k = mask2[z * sx + x];
          if (k === 0) {
            x++;
            continue;
          }
          let w = 1;
          while (x + w < sx && mask2[z * sx + x + w] === k) w++;
          let h = 1;
          outer: while (z + h < sz) {
            for (let i = 0; i < w; i++) if (mask2[(z + h) * sx + x + i] !== k) break outer;
            h++;
          }
          for (let dz = 0; dz < h; dz++) for (let i = 0; i < w; i++) mask2[(z + dz) * sx + x + i] = 0;
          const p = owner2[z * sx + x];
          bucket(p).quad(dir, x * 16, plane, z * 16, (x + w) * 16, plane, (z + h) * 16, keyColor[k - 1], layer, t.typeId[p]);
          x += w;
        }
      }
    }

    // ---- Full cubes: ±X, runs along z.
    for (const dir of [0, 1]) {
      const dx = dir === 0 ? 1 : -1;
      for (let x = 0; x < sx; x++) {
        let any = false;
        for (let z = 0; z < sz; z++) {
          const p = at(x, y, z);
          let v = 0;
          if (p !== 0 && t.kind[p] === KIND_CUBE && !hidden(t, p, at(x + dx, y, z), dir)) {
            v = faceKey[p * 6 + dir] + 1;
            any = true;
          }
          run[z] = v;
          runOwner[z] = p;
        }
        if (!any) continue;
        const plane = (dir === 0 ? x + 1 : x) * 16;
        for (let z = 0; z < sz; ) {
          const k = run[z];
          if (k === 0) {
            z++;
            continue;
          }
          let len = 1;
          while (z + len < sz && run[z + len] === k) len++;
          const p = runOwner[z];
          bucket(p).quad(dir, plane, y * 16, z * 16, plane, (y + 1) * 16, (z + len) * 16, keyColor[k - 1], layer, t.typeId[p]);
          z += len;
        }
      }
    }

    // ---- Full cubes: ±Z, runs along x.
    for (const dir of [4, 5]) {
      const dz = dir === 4 ? 1 : -1;
      for (let z = 0; z < sz; z++) {
        let any = false;
        for (let x = 0; x < sx; x++) {
          const p = at(x, y, z);
          let v = 0;
          if (p !== 0 && t.kind[p] === KIND_CUBE && !hidden(t, p, at(x, y, z + dz), dir)) {
            v = faceKey[p * 6 + dir] + 1;
            any = true;
          }
          run[x] = v;
          runOwner[x] = p;
        }
        if (!any) continue;
        const plane = (dir === 4 ? z + 1 : z) * 16;
        for (let x = 0; x < sx; ) {
          const k = run[x];
          if (k === 0) {
            x++;
            continue;
          }
          let len = 1;
          while (x + len < sx && run[x + len] === k) len++;
          const p = runOwner[x];
          bucket(p).quad(dir, x * 16, y * 16, plane, (x + len) * 16, (y + 1) * 16, plane, keyColor[k - 1], layer, t.typeId[p]);
          x += len;
        }
      }
    }

    // ---- Shapes and plants.
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const p = at(x, y, z);
        if (p === 0) continue;
        const kind = t.kind[p];
        if (kind === KIND_SHAPE) {
          emitShape(t, p, x, y, z, x * 16, y * 16, z * 16, layer, at, bucket(p));
        } else if (kind === KIND_CROSS) {
          const g = t.shapes[t.shapeIndex[p]];
          bucket(p).cross(x * 16, y * 16, z * 16, g.cross, t.faceColors[p * 6 + 2], layer, t.typeId[p]);
        }
      }
    }
  }
  return { opaque: opaque.finish(), translucent: clear.finish() };
}

const NEIGHBOUR: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * Emits the faces of a non-cube shape. (x, y, z) address the neighbourhood through `at`;
 * (bx, by, bz) is the cell corner in output coordinates (1/16 units).
 */
function emitShape(
  t: RenderTable,
  p: number,
  x: number,
  y: number,
  z: number,
  bx: number,
  by: number,
  bz: number,
  layer: number,
  at: (x: number, y: number, z: number) => number,
  out: Builder,
  onlyCulledTop = false,
): void {
  const g = t.shapes[t.shapeIndex[p]];
  const f = g.faces;
  const type = t.typeId[p];
  const culled = [false, false, false, false, false, false];
  for (let d = 0; d < 6; d++) {
    const n = NEIGHBOUR[d];
    const q = at(x + n[0], y + n[1], z + n[2]);
    culled[d] = q !== 0 && ((t.flags[q] & FLAG_OCCLUDES) !== 0 || ((t.fullSides[q] >> (d ^ 1)) & 1) === 1);
  }
  for (let i = 0; i < g.faceCount; i++) {
    const o = i * FACE_STRIDE;
    const dir = f[o];
    const boundary = f[o + 7] === 1;
    if (onlyCulledTop) {
      if (!(dir === 2 && boundary && culled[2])) continue;
    } else if (boundary && culled[dir]) {
      continue;
    }
    out.quad(dir, bx + f[o + 1], by + f[o + 2], bz + f[o + 3], bx + f[o + 4], by + f[o + 5], bz + f[o + 6], t.faceColors[p * 6 + dir], layer, type);
  }
}

/**
 * "Cap" of one layer for the slicer view: the top faces of blocks in layer `y` that are hidden
 * by the block above. When the layers above are hidden, these faces close the cut surface.
 * `slab` holds layers y-1 .. y+1 of the whole volume with a one-cell border in x and z:
 * index ((ly * D) + (z + 1)) * W + (x + 1) with ly = 0..2 and W = sizeX + 2, D = sizeZ + 2.
 */
export function meshCapLayer(tables: MeshTables, slab: Uint16Array, sizeX: number, sizeZ: number, y: number): ChunkMeshResult {
  const { table: t, faceKey, keyColor } = tables;
  const W = sizeX + 2;
  const D = sizeZ + 2;
  const at = (x: number, ly: number, z: number): number => slab[((ly + 1) * D + (z + 1)) * W + (x + 1)];
  const opaque = new Builder();
  const clear = new Builder();
  const bucket = (p: number): Builder => ((t.flags[p] & FLAG_TRANSLUCENT) !== 0 ? clear : opaque);
  const mask = new Int32Array(sizeX * sizeZ);
  const owner = new Int32Array(sizeX * sizeZ);
  const plane = (y + 1) * 16;

  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const p = at(x, 0, z);
      mask[z * sizeX + x] = 0;
      if (p === 0) continue;
      const kind = t.kind[p];
      if (kind === KIND_CUBE) {
        if (hidden(t, p, at(x, 1, z), 2)) {
          mask[z * sizeX + x] = faceKey[p * 6 + 2] + 1;
          owner[z * sizeX + x] = p;
        }
      } else if (kind === KIND_SHAPE) {
        emitShape(t, p, x, 0, z, x * 16, y * 16, z * 16, y, at, bucket(p), true);
      }
    }
  }
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; ) {
      const k = mask[z * sizeX + x];
      if (k === 0) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < sizeX && mask[z * sizeX + x + w] === k) w++;
      let h = 1;
      outer: while (z + h < sizeZ) {
        for (let i = 0; i < w; i++) if (mask[(z + h) * sizeX + x + i] !== k) break outer;
        h++;
      }
      for (let dz = 0; dz < h; dz++) for (let i = 0; i < w; i++) mask[(z + dz) * sizeX + x + i] = 0;
      const p = owner[z * sizeX + x];
      bucket(p).quad(2, x * 16, plane, z * 16, (x + w) * 16, plane, (z + h) * 16, keyColor[k - 1], y, t.typeId[p]);
      x += w;
    }
  }
  return { opaque: opaque.finish(), translucent: clear.finish() };
}
