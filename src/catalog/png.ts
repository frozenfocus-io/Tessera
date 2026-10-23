import { unzlibSync } from 'fflate';

/**
 * Minimal PNG decoder for block textures (pure TypeScript, runs in workers and in Node).
 * Supports every colour type, bit depths 1–16, palettes with transparency and Adam7 interlacing.
 * Only what is needed to average a texture: no gamma or colour profile handling.
 */

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major. */
  data: Uint8Array;
}

export class PngError extends Error {}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const ADAM7 = [
  // [x0, y0, dx, dy]
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

export function decodePng(bytes: Uint8Array): DecodedImage {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new PngError('Keine PNG-Datei');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let idatLength = 0;
  while (pos + 8 <= bytes.length) {
    const len = u32(bytes, pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const start = pos + 8;
    const end = start + len;
    if (end > bytes.length) throw new PngError('PNG abgeschnitten');
    const chunk = bytes.subarray(start, end);
    if (type === 'IHDR') {
      width = u32(chunk, 0);
      height = u32(chunk, 4);
      depth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === 'PLTE') {
      palette = chunk;
    } else if (type === 'tRNS') {
      trns = chunk;
    } else if (type === 'IDAT') {
      idat.push(chunk);
      idatLength += chunk.length;
    } else if (type === 'IEND') {
      break;
    }
    pos = end + 4; // skip CRC
  }
  if (!width || !height) throw new PngError('PNG ohne Kopfdaten');
  if (width * height > 4096 * 4096) throw new PngError('PNG zu groß');
  const compressed = new Uint8Array(idatLength);
  let o = 0;
  for (const c of idat) {
    compressed.set(c, o);
    o += c.length;
  }
  const raw = unzlibSync(compressed);
  const channels = [1, 0, 3, 1, 2, 0, 4][colorType];
  if (!channels) throw new PngError(`Unbekannter PNG-Farbtyp ${colorType}`);
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const out = new Uint8Array(width * height * 4);

  const passes = interlace === 1 ? ADAM7 : [[0, 0, 1, 1]];
  let offset = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx);
    const ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * bitsPerPixel) / 8);
    let prev = new Uint8Array(stride);
    let cur = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const filter = raw[offset++];
      cur.set(raw.subarray(offset, offset + stride));
      offset += stride;
      unfilter(filter, cur, prev, bpp);
      for (let x = 0; x < pw; x++) {
        writePixel(out, (y0 + y * dy) * width + (x0 + x * dx), cur, x, depth, colorType, palette, trns);
      }
      const t = prev;
      prev = cur;
      cur = t;
    }
  }
  return { width, height, data: out };
}

function unfilter(filter: number, cur: Uint8Array, prev: Uint8Array, bpp: number): void {
  const n = cur.length;
  switch (filter) {
    case 0:
      return;
    case 1:
      for (let i = bpp; i < n; i++) cur[i] = (cur[i] + cur[i - bpp]) & 255;
      return;
    case 2:
      for (let i = 0; i < n; i++) cur[i] = (cur[i] + prev[i]) & 255;
      return;
    case 3:
      for (let i = 0; i < n; i++) cur[i] = (cur[i] + (((i >= bpp ? cur[i - bpp] : 0) + prev[i]) >> 1)) & 255;
      return;
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      return;
    default:
      throw new PngError(`Unbekannter PNG-Filter ${filter}`);
  }
}

function sample(row: Uint8Array, index: number, depth: number): number {
  if (depth === 8) return row[index];
  if (depth === 16) return row[index * 2]; // high byte
  const perByte = 8 / depth;
  const byte = row[Math.floor(index / perByte)];
  const shift = 8 - depth * ((index % perByte) + 1);
  return (byte >> shift) & ((1 << depth) - 1);
}

function scale(v: number, depth: number): number {
  if (depth >= 8) return v;
  return Math.round((v * 255) / ((1 << depth) - 1));
}

function writePixel(
  out: Uint8Array,
  p: number,
  row: Uint8Array,
  x: number,
  depth: number,
  colorType: number,
  palette: Uint8Array | null,
  trns: Uint8Array | null,
): void {
  const o = p * 4;
  switch (colorType) {
    case 0: {
      const raw = sample(row, x, depth);
      const g = scale(raw, depth);
      out[o] = out[o + 1] = out[o + 2] = g;
      const t = trns && trns.length >= 2 ? (trns[0] << 8) | trns[1] : -1;
      out[o + 3] = depth === 16 ? (((row[x * 2] << 8) | row[x * 2 + 1]) === t ? 0 : 255) : raw === t ? 0 : 255;
      break;
    }
    case 2: {
      const r = sample(row, x * 3, depth);
      const g = sample(row, x * 3 + 1, depth);
      const b = sample(row, x * 3 + 2, depth);
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      let a = 255;
      if (trns && trns.length >= 6) {
        const tr = depth === 16 ? trns[0] : trns[1];
        const tg = depth === 16 ? trns[2] : trns[3];
        const tb = depth === 16 ? trns[4] : trns[5];
        if (r === tr && g === tg && b === tb) a = 0;
      }
      out[o + 3] = a;
      break;
    }
    case 3: {
      const i = sample(row, x, depth);
      if (palette && i * 3 + 2 < palette.length) {
        out[o] = palette[i * 3];
        out[o + 1] = palette[i * 3 + 1];
        out[o + 2] = palette[i * 3 + 2];
      }
      out[o + 3] = trns && i < trns.length ? trns[i] : 255;
      break;
    }
    case 4: {
      const g = sample(row, x * 2, depth);
      out[o] = out[o + 1] = out[o + 2] = g;
      out[o + 3] = sample(row, x * 2 + 1, depth);
      break;
    }
    case 6: {
      out[o] = sample(row, x * 4, depth);
      out[o + 1] = sample(row, x * 4 + 1, depth);
      out[o + 2] = sample(row, x * 4 + 2, depth);
      out[o + 3] = sample(row, x * 4 + 3, depth);
      break;
    }
  }
}

export interface TextureSummary {
  /** Average colour of the visible pixels (0xRRGGBB), alpha-weighted. */
  rgb: number;
  /** Mean alpha 0..1: how much of the texture is covered. */
  coverage: number;
  /** Share of pixels that are neither fully transparent nor fully opaque (glass, ice, water). */
  translucent: number;
}

/**
 * Averages a texture. For animated textures (frames stacked vertically) only the first frame
 * is used when `frameHeight` is given.
 */
export function summarizeImage(img: DecodedImage, frameHeight = img.height): TextureSummary {
  const h = Math.min(img.height, frameHeight || img.height);
  const n = img.width * h;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let semi = 0;
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const alpha = d[o + 3];
    if (alpha === 0) continue;
    // Linear-light average reads closer to how the eye mixes the pixels of a texture.
    r += SRGB_TO_LINEAR[d[o]] * alpha;
    g += SRGB_TO_LINEAR[d[o + 1]] * alpha;
    b += SRGB_TO_LINEAR[d[o + 2]] * alpha;
    a += alpha;
    if (alpha < 250) semi++;
  }
  if (a === 0) return { rgb: 0x808080, coverage: 0, translucent: 0 };
  const rgb = (linearToSrgb(r / a) << 16) | (linearToSrgb(g / a) << 8) | linearToSrgb(b / a);
  return { rgb, coverage: a / (255 * n), translucent: semi / n };
}

const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}
