import { optCompound, optNumber, optString, reqCompound, reqNumber } from '../nbt/reader';
import { NbtError, isCompound, type NbtCompound } from '../nbt/types';
import { PaletteBuilder, checkCells, compoundList, stateFromCompound, type FormatResult } from './common';

/** True if the NBT root looks like a Litematica schematic. */
export function looksLikeLitematic(root: NbtCompound): boolean {
  return isCompound(root.Regions) && root.MinecraftDataVersion !== undefined;
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * Bit-packed palette indices as stored by Litematica: entries of `bits` bits, packed LSB-first
 * into 64-bit longs, allowed to span two longs. On little-endian machines the longs can be read
 * as a plain sequence of 32-bit words.
 */
class PackedReader {
  private readonly words: Uint32Array;
  private readonly mask: number;

  constructor(
    longs: BigInt64Array,
    private readonly bits: number,
  ) {
    this.mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1;
    if (LITTLE_ENDIAN) {
      this.words = new Uint32Array(longs.buffer, longs.byteOffset, longs.length * 2);
    } else {
      this.words = new Uint32Array(longs.length * 2);
      for (let i = 0; i < longs.length; i++) {
        const v = BigInt.asUintN(64, longs[i]);
        this.words[i * 2] = Number(v & 0xffffffffn);
        this.words[i * 2 + 1] = Number(v >> 32n);
      }
    }
  }

  get(index: number): number {
    const bitOffset = index * this.bits;
    const j = Math.floor(bitOffset / 32);
    const s = bitOffset - j * 32;
    let v = this.words[j] >>> s;
    if (s + this.bits > 32) v |= this.words[j + 1] << (32 - s);
    return (v & this.mask) >>> 0;
  }
}

interface RegionData {
  name: string;
  min: [number, number, number];
  size: [number, number, number];
  remap: Int32Array;
  reader: PackedReader;
}

/** Parses a Litematica .litematic file; all regions are merged into one volume. */
export function parseLitematic(root: NbtCompound): FormatResult {
  const version = optNumber(root, 'Version') ?? 0;
  const dataVersion = optNumber(root, 'MinecraftDataVersion') ?? null;
  const regionsTag = reqCompound(root, 'Regions');
  const meta = optCompound(root, 'Metadata');
  const warnings: string[] = [];
  if (version > 7) warnings.push(`Litematica-Version ${version} ist neuer als bekannt (bis 7); die Datei wird trotzdem gelesen.`);

  const pb = new PaletteBuilder(dataVersion);
  const regions: RegionData[] = [];
  let blockEntityCount = 0;
  let entityCount = 0;

  for (const [name, r] of Object.entries(regionsTag)) {
    if (!isCompound(r)) continue;
    const pos = reqCompound(r, 'Position');
    const size = reqCompound(r, 'Size');
    const p = [reqNumber(pos, 'x'), reqNumber(pos, 'y'), reqNumber(pos, 'z')];
    const s = [reqNumber(size, 'x'), reqNumber(size, 'y'), reqNumber(size, 'z')];
    if (s.some((v) => v === 0)) {
      warnings.push(`Region „${name}“ ist leer und wird übersprungen.`);
      continue;
    }
    // Negative sizes extend from the position towards negative coordinates.
    const min = p.map((v, i) => (s[i] < 0 ? v + s[i] + 1 : v)) as [number, number, number];
    const abs = s.map((v) => Math.abs(v)) as [number, number, number];
    const cells = checkCells(abs[0], abs[1], abs[2]);

    const paletteList = compoundList(r.BlockStatePalette);
    if (paletteList.length === 0) throw new NbtError(`Region „${name}“ hat keine Blockpalette.`);
    const remap = Int32Array.from(paletteList.map((c) => pb.add(stateFromCompound(c))));
    const bits = Math.max(2, 32 - Math.clz32(paletteList.length - 1));
    const longs = r.BlockStates;
    if (!(longs instanceof BigInt64Array)) throw new NbtError(`Region „${name}“ hat keine Blockdaten.`);
    if (longs.length * 64 < cells * bits) {
      throw new NbtError(`Region „${name}“: Blockdaten sind unvollständig.`);
    }
    regions.push({ name, min, size: abs, remap, reader: new PackedReader(longs, bits) });
    blockEntityCount += compoundList(r.TileEntities).length;
    entityCount += compoundList(r.Entities).length;
  }
  if (regions.length === 0) throw new NbtError('Die Litematic-Datei enthält keine Regionen mit Blöcken.');

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const r of regions) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], r.min[i]);
      hi[i] = Math.max(hi[i], r.min[i] + r.size[i]);
    }
  }
  const sizeX = hi[0] - lo[0];
  const sizeY = hi[1] - lo[1];
  const sizeZ = hi[2] - lo[2];
  const cells = checkCells(sizeX, sizeY, sizeZ);
  const data = new Uint16Array(cells);
  let invalid = 0;

  for (const r of regions) {
    const [rx, ry, rz] = r.size;
    const ox = r.min[0] - lo[0];
    const oy = r.min[1] - lo[1];
    const oz = r.min[2] - lo[2];
    let i = 0;
    for (let y = 0; y < ry; y++) {
      for (let z = 0; z < rz; z++) {
        const dst = ((y + oy) * sizeZ + (z + oz)) * sizeX + ox;
        for (let x = 0; x < rx; x++, i++) {
          const v = r.reader.get(i);
          if (v >= r.remap.length) {
            invalid++;
            continue;
          }
          const mapped = r.remap[v];
          if (mapped !== 0) data[dst + x] = mapped;
        }
      }
    }
  }
  if (invalid > 0) warnings.push(`${invalid.toLocaleString('de-DE')} Blöcke verweisen auf keinen Paletteneintrag und werden als Luft behandelt.`);
  if (regions.length > 1) warnings.push(`Die Datei hat ${regions.length} Regionen; sie werden zusammen angezeigt.`);

  return {
    volume: { sizeX, sizeY, sizeZ, palette: pb.palette, data },
    info: {
      format: 'litematic',
      formatLabel: `Litematica v${version}`,
      formatVersion: version,
      dataVersion,
      offset: [lo[0], lo[1], lo[2]],
      weOffset: null,
      blockEntityCount,
      entityCount,
      regions: regions.length,
      meta: meta
        ? { name: optString(meta, 'Name'), author: optString(meta, 'Author'), description: optString(meta, 'Description') }
        : undefined,
      warnings,
      renames: pb.renames,
    },
  };
}
