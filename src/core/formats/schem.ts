import { parseBlockState } from '../blockstate';
import { optByteArray, optCompound, optIntArray, optList, optNumber, reqCompound, reqNumber } from '../nbt/reader';
import { NbtError, isCompound, type NbtCompound } from '../nbt/types';
import { PaletteBuilder, checkCells, type FormatResult } from './common';

/** True if the NBT root looks like a Sponge schematic (any version). */
export function looksLikeSponge(root: NbtCompound): boolean {
  const inner = isCompound(root.Schematic) ? (root.Schematic as NbtCompound) : root;
  return typeof inner.Version === 'number' && (inner.Palette !== undefined || inner.Blocks !== undefined);
}

/** True if the NBT root looks like the legacy MCEdit/WorldEdit ".schematic" format (pre 1.13). */
export function looksLikeLegacySchematic(root: NbtCompound): boolean {
  return root.Materials !== undefined || (root.Blocks instanceof Uint8Array && root.Data instanceof Uint8Array);
}

/**
 * Parses a Sponge schematic (.schem) of version 1, 2 or 3 into a normalised volume:
 * palette index 0 is air, block states are canonical and renamed to the target version.
 */
export function parseSpongeSchematic(root: NbtCompound): FormatResult {
  // Version 3 wraps everything in a "Schematic" compound below an unnamed root.
  const s = isCompound(root.Schematic) ? (root.Schematic as NbtCompound) : root;
  const version = reqNumber(s, 'Version');
  if (version !== 1 && version !== 2 && version !== 3) {
    throw new NbtError(`Sponge-Schematic-Version ${version} wird nicht unterstützt (bekannt: 1, 2, 3).`);
  }

  const sizeX = reqNumber(s, 'Width') & 0xffff;
  const sizeY = reqNumber(s, 'Height') & 0xffff;
  const sizeZ = reqNumber(s, 'Length') & 0xffff;
  const cells = checkCells(sizeX, sizeY, sizeZ);

  const dataVersion = version === 1 ? null : (optNumber(s, 'DataVersion') ?? null);
  const warnings: string[] = [];
  if (version !== 1 && dataVersion === null) warnings.push('Die Datei enthält keine DataVersion; Version wird geschätzt.');

  let paletteTag: NbtCompound | undefined;
  let dataTag: Uint8Array | undefined;
  let blockEntities: unknown[] | undefined;
  if (version === 3) {
    const blocks = optCompound(s, 'Blocks');
    if (blocks) {
      paletteTag = reqCompound(blocks, 'Palette');
      dataTag = optByteArray(blocks, 'Data');
      blockEntities = optList(blocks, 'BlockEntities');
    }
  } else {
    paletteTag = optCompound(s, 'Palette');
    dataTag = optByteArray(s, 'BlockData');
    blockEntities = version === 1 ? optList(s, 'TileEntities') : optList(s, 'BlockEntities');
  }

  const offsetArr = optIntArray(s, 'Offset');
  const offset: [number, number, number] | null =
    offsetArr && offsetArr.length >= 3 ? [offsetArr[0], offsetArr[1], offsetArr[2]] : null;

  let weOffset: [number, number, number] | null = null;
  const meta = optCompound(s, 'Metadata');
  if (meta) {
    const ox = optNumber(meta, 'WEOffsetX');
    const oy = optNumber(meta, 'WEOffsetY');
    const oz = optNumber(meta, 'WEOffsetZ');
    if (ox !== undefined && oy !== undefined && oz !== undefined) weOffset = [ox, oy, oz];
    const we = optCompound(meta, 'WorldEdit');
    const origin = we ? optIntArray(we, 'Origin') : undefined;
    if (!weOffset && origin && origin.length >= 3 && offset) {
      // v3 stores the absolute origin; convert to an offset relative to the minimum corner.
      weOffset = [origin[0] - offset[0], origin[1] - offset[1], origin[2] - offset[2]];
    }
  }

  // --- Palette
  const pb = new PaletteBuilder(dataVersion);
  let maxFileIndex = -1;
  const entries: [string, number][] = [];
  if (paletteTag) {
    for (const [rawKey, idx] of Object.entries(paletteTag)) {
      if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0) {
        throw new NbtError(`Ungültiger Palettenindex für "${rawKey}".`);
      }
      entries.push([rawKey, idx]);
      if (idx > maxFileIndex) maxFileIndex = idx;
    }
  }
  if (maxFileIndex > 0xffff * 16) throw new NbtError('Palette ist unplausibel groß.');
  const remap = new Int32Array(maxFileIndex + 1).fill(-1);
  for (const [rawKey, idx] of entries) remap[idx] = pb.add(parseBlockState(rawKey));

  // --- Block data: varint encoded palette indices in (y, z, x) order.
  const data = new Uint16Array(cells);
  let invalid = 0;
  if (cells > 0) {
    if (!dataTag) throw new NbtError('Die Schematic enthält keine Blockdaten.');
    let p = 0;
    let i = 0;
    const bytes = dataTag;
    const n = bytes.length;
    while (i < cells && p < n) {
      let b = bytes[p++];
      let v = b & 0x7f;
      if (b & 0x80) {
        let shift = 7;
        do {
          if (p >= n) throw new NbtError('Blockdaten sind abgeschnitten (unvollständiger Varint).');
          b = bytes[p++];
          v |= (b & 0x7f) << shift;
          shift += 7;
          if (shift > 28) throw new NbtError('Blockdaten enthalten einen ungültigen Varint.');
        } while (b & 0x80);
      }
      const mapped = v < remap.length ? remap[v] : -1;
      if (mapped < 0) {
        invalid++;
        data[i++] = 0;
      } else {
        data[i++] = mapped;
      }
    }
    if (i < cells) {
      throw new NbtError(`Blockdaten sind unvollständig: ${i.toLocaleString('de-DE')} von ${cells.toLocaleString('de-DE')} Blöcken.`);
    }
    if (p < n) warnings.push(`Nach den Blockdaten folgen ${n - p} überzählige Bytes; sie werden ignoriert.`);
  }
  if (invalid > 0) {
    warnings.push(`${invalid.toLocaleString('de-DE')} Blöcke verweisen auf keinen Paletteneintrag und werden als Luft behandelt.`);
  }

  return {
    volume: { sizeX, sizeY, sizeZ, palette: pb.palette, data },
    info: {
      format: 'schem',
      formatLabel: `Sponge Schematic v${version}`,
      formatVersion: version,
      dataVersion,
      offset,
      weOffset,
      blockEntityCount: blockEntities?.length ?? 0,
      entityCount: optList(s, 'Entities')?.length ?? 0,
      warnings,
      renames: pb.renames,
    },
  };
}
