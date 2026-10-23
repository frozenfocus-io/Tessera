import { parseJson } from './jar';
import { decodePng, summarizeImage, type TextureSummary } from './png';
import type { CatalogModel, FaceColors } from './types';

/**
 * Resolving block models: parent chains, texture variables, elements. From a model Tessera
 * takes its boxes (the block's shape) and the average colour of the textures per face
 * direction. Element rotations are ignored (a preview, not a renderer); zero-thickness cards
 * (torch flames, plant crosses) contribute colour but no volume.
 */

/** "block/stone" -> "minecraft:block/stone"; keeps "#refs" untouched. */
export function rl(ref: string, ns = 'minecraft'): string {
  if (ref.startsWith('#')) return ref;
  const i = ref.indexOf(':');
  return i < 0 ? `${ns}:${ref}` : ref;
}

export function assetPath(id: string, folder: string, ext: string): string {
  const i = id.indexOf(':');
  return `assets/${id.slice(0, i)}/${folder}/${id.slice(i + 1)}${ext}`;
}

const FACE_INDEX: Record<string, number> = { east: 0, west: 1, up: 2, down: 3, south: 4, north: 5 };

/** Default tints for plains, the biome a preview assumes. */
const TINT = {
  grass: 0x91bd59,
  foliage: 0x77ab2f,
  spruce: 0x619961,
  birch: 0x80a755,
  water: 0x3f76e4,
  lilyPad: 0x208030,
  redstone: 0x7a0000,
  stem: 0xa6b52b,
};

export function tintFor(modelId: string, textureId: string): number {
  const s = `${modelId} ${textureId}`;
  if (s.includes('redstone')) return TINT.redstone;
  if (s.includes('water') || s.includes('bubble')) return TINT.water;
  if (s.includes('lily_pad')) return TINT.lilyPad;
  if (s.includes('spruce')) return TINT.spruce;
  if (s.includes('birch')) return TINT.birch;
  if (s.includes('stem')) return TINT.stem;
  if (/grass|fern|sugar_cane|bush/.test(s)) return TINT.grass;
  return TINT.foliage;
}

function multiply(rgb: number, tint: number): number {
  const r = (((rgb >> 16) & 255) * ((tint >> 16) & 255)) / 255;
  const g = (((rgb >> 8) & 255) * ((tint >> 8) & 255)) / 255;
  const b = ((rgb & 255) * (tint & 255)) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/**
 * Texture summaries (average colour, coverage) across all jars. Textures are summarised as
 * soon as a jar is read, so the image data does not have to stay in memory.
 */
export class TextureStore {
  private map = new Map<string, TextureSummary>();
  readonly failed: string[] = [];

  /** path: assets/<ns>/textures/<path>.png; later jars override earlier ones (like resource packs). */
  addPng(path: string, bytes: Uint8Array): boolean {
    const m = /^assets\/([^/]+)\/textures\/(.+)\.png$/.exec(path);
    if (!m) return false;
    const id = `${m[1]}:${m[2]}`;
    try {
      const img = decodePng(bytes);
      // Animated textures stack their frames vertically: average the first (square) frame.
      const frame = img.height > img.width && img.height % img.width === 0 ? img.width : img.height;
      this.map.set(id, summarizeImage(img, frame));
      return true;
    } catch {
      this.failed.push(id);
      return false;
    }
  }

  get(id: string): TextureSummary | null {
    return this.map.get(id) ?? null;
  }

  get size(): number {
    return this.map.size;
  }
}

interface RawModel {
  parent?: string;
  textures?: Record<string, string>;
  elements?: RawElement[];
  loader?: string;
  children?: Record<string, RawModel | string>;
  base?: RawModel | string;
  render_type?: string;
}

interface RawElement {
  from?: number[];
  to?: number[];
  rotation?: { angle?: number; axis?: string };
  faces?: Record<string, { texture?: string; tintindex?: number }>;
}

/** The full cube; geometry index 0. */
export const FULL_CUBE = [0, 0, 0, 16, 16, 16];

export class GeometryRegistry {
  readonly list: number[][] = [FULL_CUBE];
  private keys = new Map<string, number>([[FULL_CUBE.join(','), 0]]);

  add(boxes: number[]): number {
    const key = boxes.join(',');
    let i = this.keys.get(key);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(boxes);
      this.keys.set(key, i);
    }
    return i;
  }
}

interface Flattened {
  textures: Record<string, string>;
  elements: RawElement[] | null;
  chain: string[];
  loader: string | null;
  renderType: string | null;
  entity: boolean;
}

export class ModelResolver {
  readonly models: CatalogModel[] = [];
  private index = new Map<string, number>();
  private raw = new Map<string, RawModel | null>();
  /** Model ids that could not be found or parsed. */
  readonly missing = new Set<string>();

  constructor(
    private readonly files: ReadonlyMap<string, Uint8Array>,
    private readonly textures: TextureStore,
    private readonly geometries: GeometryRegistry,
  ) {}

  /** Index of the resolved model in `models`. */
  resolve(modelId: string): number {
    const id = rl(modelId);
    let i = this.index.get(id);
    if (i !== undefined) return i;
    i = this.models.length;
    this.index.set(id, i);
    this.models.push(this.build(id));
    return i;
  }

  private load(id: string): RawModel | null {
    if (this.raw.has(id)) return this.raw.get(id)!;
    let m: RawModel | null = null;
    const bytes = this.files.get(assetPath(id, 'models', '.json'));
    if (bytes) {
      try {
        const j = parseJson(bytes);
        if (j && typeof j === 'object') m = j as RawModel;
      } catch {
        m = null;
      }
    }
    if (!m) this.missing.add(id);
    this.raw.set(id, m);
    return m;
  }

  /** Walks the parent chain; the child's textures override the parent's, the nearest elements win. */
  private flatten(root: RawModel, rootId: string): Flattened {
    const chain: RawModel[] = [];
    const ids: string[] = [rootId];
    let m: RawModel | null = root;
    const seen = new Set<string>([rootId]);
    let entity = false;
    while (m && chain.length < 32) {
      chain.push(m);
      if (!m.parent) break;
      const pid = rl(m.parent);
      if (pid === 'minecraft:builtin/entity') {
        entity = true;
        break;
      }
      if (pid.startsWith('minecraft:builtin/') || seen.has(pid)) break;
      seen.add(pid);
      ids.push(pid);
      m = this.load(pid);
    }
    const textures: Record<string, string> = {};
    let elements: RawElement[] | null = null;
    let loader: string | null = null;
    let renderType: string | null = null;
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = chain[i];
      if (c.textures) Object.assign(textures, c.textures);
      if (Array.isArray(c.elements)) elements = c.elements;
      if (typeof c.loader === 'string') loader = c.loader;
      if (typeof c.render_type === 'string') renderType = c.render_type;
    }
    return { textures, elements, chain: ids, loader, renderType, entity };
  }

  private texture(textures: Record<string, string>, ref: string | undefined): string | null {
    let r = ref;
    for (let i = 0; i < 12 && r; i++) {
      if (!r.startsWith('#')) return rl(r);
      r = textures[r.slice(1)];
    }
    return null;
  }

  private build(id: string): CatalogModel {
    const empty: CatalogModel = { g: -1, f: [-1, -1, -1, -1, -1, -1], tr: 0, kind: 'empty', p: -1, id };
    const root = this.load(id);
    if (!root) return empty;
    let flat = this.flatten(root, id);

    // NeoForge loaders that are simple compositions of ordinary models.
    let elements = flat.elements ?? [];
    let textures = flat.textures;
    if (flat.loader === 'neoforge:separate_transforms' && root.base) {
      const base = typeof root.base === 'string' ? this.load(rl(root.base)) : root.base;
      if (base) {
        flat = this.flatten(base, id);
        elements = flat.elements ?? [];
        textures = flat.textures;
      }
    } else if (flat.loader === 'neoforge:composite' && root.children) {
      elements = [];
      for (const child of Object.values(root.children)) {
        const m = typeof child === 'string' ? this.load(rl(child)) : child;
        if (!m) continue;
        const f = this.flatten(m, id);
        const tex = { ...textures, ...f.textures };
        for (const e of f.elements ?? []) elements.push(resolveFaceTextures(e, tex));
      }
    }

    const particleId = this.texture(textures, textures.particle ?? '#particle');
    const particle = particleId ? this.textures.get(particleId) : null;
    // Fluids and other tinted textures are stored in grey; tint the particle colour like the game.
    const p = particle ? (/water|grass|leaves|foliage/.test(particleId!) ? multiply(particle.rgb, tintFor(id, particleId!)) : particle.rgb) : -1;

    const sums = new Float64Array(6 * 4); // r, g, b, weight per face
    let coverage = 0;
    let semi = 0;
    let faceArea = 0;
    const boxes: number[] = [];
    let cards = 0;
    let rotated45 = 0;

    for (const e of elements) {
      const from = e.from ?? [0, 0, 0];
      const to = e.to ?? [16, 16, 16];
      const angle = Math.abs(e.rotation?.angle ?? 0);
      if (angle >= 45 - 1e-6) rotated45++;
      // A "card" shows a mostly transparent texture on one pair of sides only (torch flames,
      // crossed plants, bars): it is a picture, not a volume.
      const axes = new Set<number>();
      let cov = 0;
      let nFaces = 0;
      for (const [dir, face] of Object.entries(e.faces ?? {})) {
        const d = FACE_INDEX[dir];
        if (d === undefined) continue;
        axes.add(d >> 1);
        const texId = this.texture(textures, face.texture);
        cov += (texId ? this.textures.get(texId)?.coverage : undefined) ?? 1;
        nFaces++;
      }
      const card = nFaces > 0 && axes.size < 2 && cov / nFaces < 0.75;
      const box = card ? null : toBox(from, to);
      if (box) boxes.push(...box);
      else cards++;
      for (const [dir, face] of Object.entries(e.faces ?? {})) {
        const d = FACE_INDEX[dir];
        if (d === undefined) continue;
        const texId = this.texture(textures, face.texture);
        const t = texId ? this.textures.get(texId) : null;
        if (!t || t.coverage === 0) continue;
        const area = faceSize(from, to, d);
        const w = Math.max(area, 1) * t.coverage;
        const rgb = typeof face.tintindex === 'number' && face.tintindex >= 0 ? multiply(t.rgb, tintFor(id, texId!)) : t.rgb;
        sums[d * 4] += ((rgb >> 16) & 255) * w;
        sums[d * 4 + 1] += ((rgb >> 8) & 255) * w;
        sums[d * 4 + 2] += (rgb & 255) * w;
        sums[d * 4 + 3] += w;
        coverage += t.coverage * Math.max(area, 1);
        semi += t.translucent * Math.max(area, 1);
        faceArea += Math.max(area, 1);
      }
    }

    const f: FaceColors = [-1, -1, -1, -1, -1, -1];
    for (let d = 0; d < 6; d++) {
      const w = sums[d * 4 + 3];
      if (w > 0) f[d] = (Math.round(sums[d * 4] / w) << 16) | (Math.round(sums[d * 4 + 1] / w) << 8) | Math.round(sums[d * 4 + 2] / w);
    }
    const meanCoverage = faceArea ? coverage / faceArea : 1;
    const meanSemi = faceArea ? semi / faceArea : 0;
    const translucentHint = flat.renderType?.includes('translucent') ?? false;
    const tr: 0 | 1 = translucentHint || meanSemi > 0.25 || meanCoverage < 0.55 ? 1 : 0;

    const isCross = flat.chain.some((c) => /(^|[:/])(tinted_)?cross(_emissive)?$|flower_pot_cross|crop$|template_seagrass/.test(c));
    let kind: CatalogModel['kind'] = 'boxes';
    let g = -1;
    if (boxes.length) {
      g = this.geometries.add(normalizeBoxes(boxes));
    } else if (isCross || (cards > 0 && rotated45 > 0)) {
      kind = 'cross';
    } else if (flat.entity) {
      kind = 'entity';
    } else if (flat.loader) {
      kind = 'custom';
    } else {
      kind = 'empty';
    }
    if (f.every((c) => c === -1) && p !== -1 && kind !== 'boxes') f.fill(p);
    return { g, f, tr, kind, p, id };
  }
}

/** Rounds an element to whole 1/16 units; null for cards without volume. */
function toBox(from: number[], to: number[]): number[] | null {
  const out: number[] = [];
  for (let a = 0; a < 3; a++) {
    let lo = Math.min(from[a], to[a]);
    let hi = Math.max(from[a], to[a]);
    lo = Math.max(0, Math.min(16, lo));
    hi = Math.max(0, Math.min(16, hi));
    if (hi - lo < 0.2) return null;
    let l = Math.round(lo);
    let h = Math.round(hi);
    if (h <= l) h = l + 1;
    if (h > 16) {
      h = 16;
      l = 15;
    }
    out[a] = l;
    out[a + 3] = h;
  }
  return out;
}

function faceSize(from: number[], to: number[], d: number): number {
  const dx = Math.abs(to[0] - from[0]);
  const dy = Math.abs(to[1] - from[1]);
  const dz = Math.abs(to[2] - from[2]);
  return d < 2 ? dy * dz : d < 4 ? dx * dz : dx * dy;
}

/** Sorted and de-duplicated box list, so equal shapes share one geometry entry. */
function normalizeBoxes(boxes: number[]): number[] {
  const list: number[][] = [];
  for (let i = 0; i < boxes.length; i += 6) list.push(boxes.slice(i, i + 6));
  const keys = new Set<string>();
  const unique = list.filter((b) => {
    const k = b.join(',');
    if (keys.has(k)) return false;
    keys.add(k);
    return true;
  });
  unique.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4] || a[5] - b[5]);
  return unique.flat();
}

function resolveFaceTextures(e: RawElement, textures: Record<string, string>): RawElement {
  const faces: RawElement['faces'] = {};
  for (const [dir, face] of Object.entries(e.faces ?? {})) {
    let t = face.texture;
    for (let i = 0; i < 12 && t?.startsWith('#'); i++) t = textures[t.slice(1)];
    faces[dir] = { ...face, texture: t };
  }
  return { ...e, faces };
}
