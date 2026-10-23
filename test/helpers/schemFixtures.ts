import { gzipSync } from 'fflate';
import { nbt, writeNbt, type NbtTag } from '../../src/core/nbt/writer';

export function encodeVarints(values: ArrayLike<number>): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    let v = values[i];
    while (v >= 0x80) {
      out.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    out.push(v);
  }
  return Uint8Array.from(out);
}

export interface SchemSpec {
  version: 1 | 2 | 3;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  /** Palette as written to the file: key -> index (indices may be in any order). */
  palette: Record<string, number>;
  /** File palette index for each cell. */
  block: (x: number, y: number, z: number) => number;
  dataVersion?: number;
  offset?: [number, number, number];
  weOffset?: [number, number, number];
  gzip?: boolean;
  /** Truncate block data to this many cells (for error tests). */
  truncateCells?: number;
}

export function makeSpongeSchem(spec: SchemSpec): Uint8Array {
  const { sizeX, sizeY, sizeZ } = spec;
  const values: number[] = [];
  for (let y = 0; y < sizeY; y++)
    for (let z = 0; z < sizeZ; z++) for (let x = 0; x < sizeX; x++) values.push(spec.block(x, y, z));
  const cells = spec.truncateCells !== undefined ? values.slice(0, spec.truncateCells) : values;
  const blockData = encodeVarints(cells);
  const paletteTag: Record<string, NbtTag> = {};
  for (const [k, v] of Object.entries(spec.palette)) paletteTag[k] = nbt.int(v);
  const paletteMax = Math.max(0, ...Object.values(spec.palette)) + 1;

  let rootName = 'Schematic';
  let root: NbtTag & { t: 'compound' };
  if (spec.version === 3) {
    const inner: Record<string, NbtTag> = {
      Version: nbt.int(3),
      DataVersion: nbt.int(spec.dataVersion ?? 3955),
      Width: nbt.short(sizeX),
      Height: nbt.short(sizeY),
      Length: nbt.short(sizeZ),
      Offset: nbt.intArray(spec.offset ?? [0, 0, 0]),
      Blocks: nbt.compound({
        Palette: nbt.compound(paletteTag),
        Data: nbt.byteArray(blockData),
        BlockEntities: nbt.list('compound', [
          nbt.compound({ Pos: nbt.intArray([0, 0, 0]), Id: nbt.string('minecraft:chest'), Data: nbt.compound({}) }),
        ]),
      }),
      Metadata: nbt.compound({
        WorldEdit: nbt.compound({
          Origin: nbt.intArray(
            spec.offset && spec.weOffset
              ? [spec.offset[0] + spec.weOffset[0], spec.offset[1] + spec.weOffset[1], spec.offset[2] + spec.weOffset[2]]
              : [0, 0, 0],
          ),
        }),
      }),
    };
    rootName = '';
    root = { t: 'compound', v: { Schematic: nbt.compound(inner) } };
  } else {
    const fields: Record<string, NbtTag> = {
      Version: nbt.int(spec.version),
      Width: nbt.short(sizeX),
      Height: nbt.short(sizeY),
      Length: nbt.short(sizeZ),
      Offset: nbt.intArray(spec.offset ?? [0, 0, 0]),
      PaletteMax: nbt.int(paletteMax),
      Palette: nbt.compound(paletteTag),
      BlockData: nbt.byteArray(blockData),
    };
    if (spec.version === 2) {
      fields.DataVersion = nbt.int(spec.dataVersion ?? 3465);
      fields.BlockEntities = nbt.list('compound', []);
      if (spec.weOffset) {
        fields.Metadata = nbt.compound({
          WEOffsetX: nbt.int(spec.weOffset[0]),
          WEOffsetY: nbt.int(spec.weOffset[1]),
          WEOffsetZ: nbt.int(spec.weOffset[2]),
        });
      }
    } else {
      fields.TileEntities = nbt.list('compound', [
        nbt.compound({ Pos: nbt.intArray([1, 0, 0]), Id: nbt.string('minecraft:sign') }),
      ]);
    }
    root = { t: 'compound', v: fields };
  }
  const raw = writeNbt(rootName, root);
  return spec.gzip === false ? raw : gzipSync(raw);
}

/** Packs values LSB-first into 64-bit longs, entries may span two longs (Litematica layout). */
export function packLongs(values: number[], bits: number): bigint[] {
  const totalBits = values.length * bits;
  const longs = new Array<bigint>(Math.ceil(totalBits / 64)).fill(0n);
  values.forEach((v, i) => {
    const bit = i * bits;
    const li = Math.floor(bit / 64);
    const off = bit % 64;
    longs[li] |= BigInt(v) << BigInt(off);
    if (off + bits > 64) longs[li + 1] |= BigInt(v) >> BigInt(64 - off);
  });
  return longs.map((l) => BigInt.asIntN(64, l & ((1n << 64n) - 1n)));
}

export interface LitematicRegionSpec {
  name: string;
  pos: [number, number, number];
  size: [number, number, number];
  palette: { Name: string; Properties?: Record<string, string> }[];
  /** palette index for region-local (x, y, z) measured from the region's minimum corner */
  block: (x: number, y: number, z: number) => number;
}

export function makeLitematic(regions: LitematicRegionSpec[], dataVersion = 3955): Uint8Array {
  const regionTags: Record<string, NbtTag> = {};
  for (const r of regions) {
    const [sx, sy, sz] = r.size.map(Math.abs);
    const values: number[] = [];
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) values.push(r.block(x, y, z));
    const bits = Math.max(2, 32 - Math.clz32(r.palette.length - 1));
    regionTags[r.name] = nbt.compound({
      Position: nbt.compound({ x: nbt.int(r.pos[0]), y: nbt.int(r.pos[1]), z: nbt.int(r.pos[2]) }),
      Size: nbt.compound({ x: nbt.int(r.size[0]), y: nbt.int(r.size[1]), z: nbt.int(r.size[2]) }),
      BlockStatePalette: nbt.list(
        'compound',
        r.palette.map((p) =>
          nbt.compound({
            Name: nbt.string(p.Name),
            ...(p.Properties
              ? { Properties: nbt.compound(Object.fromEntries(Object.entries(p.Properties).map(([k, v]) => [k, nbt.string(v)]))) }
              : {}),
          }),
        ),
      ),
      BlockStates: nbt.longArray(packLongs(values, bits)),
      TileEntities: nbt.list('compound', []),
      Entities: nbt.list('compound', []),
    });
  }
  const root = nbt.compound({
    MinecraftDataVersion: nbt.int(dataVersion),
    Version: nbt.int(6),
    Metadata: nbt.compound({ Name: nbt.string('Testbau'), Author: nbt.string('Steve'), Description: nbt.string('') }),
    Regions: nbt.compound(regionTags),
  }) as NbtTag & { t: 'compound' };
  return gzipSync(writeNbt('', root));
}

export function makeStructure(
  size: [number, number, number],
  palette: { Name: string; Properties?: Record<string, string> }[],
  blocks: { pos: [number, number, number]; state: number }[],
): Uint8Array {
  const root = nbt.compound({
    DataVersion: nbt.int(3955),
    size: nbt.list('int', size.map((v) => nbt.int(v))),
    palette: nbt.list(
      'compound',
      palette.map((p) =>
        nbt.compound({
          Name: nbt.string(p.Name),
          ...(p.Properties
            ? { Properties: nbt.compound(Object.fromEntries(Object.entries(p.Properties).map(([k, v]) => [k, nbt.string(v)]))) }
            : {}),
        }),
      ),
    ),
    blocks: nbt.list(
      'compound',
      blocks.map((b) => nbt.compound({ pos: nbt.list('int', b.pos.map((v) => nbt.int(v))), state: nbt.int(b.state) })),
    ),
    entities: nbt.list('compound', []),
  }) as NbtTag & { t: 'compound' };
  return gzipSync(writeNbt('', root));
}
