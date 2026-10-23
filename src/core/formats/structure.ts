import { optNumber } from '../nbt/reader';
import { NbtError, isCompound, type NbtCompound } from '../nbt/types';
import { PaletteBuilder, asIntList, checkCells, compoundList, stateFromCompound, type FormatResult } from './common';

/** True if the NBT root looks like a vanilla structure file (structure block, Create schematics). */
export function looksLikeStructure(root: NbtCompound): boolean {
  return (
    root.size !== undefined && (Array.isArray(root.palette) || Array.isArray(root.palettes)) && Array.isArray(root.blocks)
  );
}

/** Parses a vanilla structure file (.nbt). Positions not listed are structure voids (shown as air). */
export function parseStructure(root: NbtCompound): FormatResult {
  const dataVersion = optNumber(root, 'DataVersion') ?? null;
  const [sizeX, sizeY, sizeZ] = asIntList(root.size, 'Die Größe (size)');
  if (![sizeX, sizeY, sizeZ].every((v) => Number.isInteger(v) && v >= 0)) throw new NbtError('Ungültige Strukturgröße.');
  const cells = checkCells(sizeX, sizeY, sizeZ);
  const warnings: string[] = [];

  let paletteList = compoundList(root.palette);
  if (paletteList.length === 0 && Array.isArray(root.palettes)) {
    const variants = root.palettes;
    paletteList = compoundList(variants[0]);
    if (variants.length > 1) warnings.push(`Die Struktur hat ${variants.length} Paletten-Varianten; die erste wird angezeigt.`);
  }
  const pb = new PaletteBuilder(dataVersion);
  const remap = paletteList.map((c) => pb.add(stateFromCompound(c)));

  const data = new Uint16Array(cells);
  let invalid = 0;
  let outside = 0;
  let blockEntityCount = 0;
  for (const b of compoundList(root.blocks)) {
    const pos = asIntList(b.pos, 'Blockposition');
    const state = typeof b.state === 'number' ? b.state : -1;
    if (isCompound(b.nbt)) blockEntityCount++;
    const [x, y, z] = pos;
    if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ) {
      outside++;
      continue;
    }
    if (state < 0 || state >= remap.length) {
      invalid++;
      continue;
    }
    data[(y * sizeZ + z) * sizeX + x] = remap[state];
  }
  if (outside > 0) warnings.push(`${outside} Blöcke liegen außerhalb der Strukturgröße und werden ignoriert.`);
  if (invalid > 0) warnings.push(`${invalid} Blöcke verweisen auf keinen Paletteneintrag und werden als Luft behandelt.`);

  return {
    volume: { sizeX, sizeY, sizeZ, palette: pb.palette, data },
    info: {
      format: 'structure',
      formatLabel: 'Strukturdatei (.nbt)',
      formatVersion: 1,
      dataVersion,
      offset: null,
      weOffset: null,
      blockEntityCount,
      entityCount: compoundList(root.entities).length,
      warnings,
      renames: pb.renames,
    },
  };
}
