import { compileTess } from '../../tess/compile';
import { keyToCell } from '../../tess/grid';
import type { BlockHints } from '../../tess/palette';
import type { Diagnostic } from '../../tess/syntax';
import { TARGET_DATA_VERSION } from '../versions';
import { checkCells, PaletteBuilder, type FormatResult } from './common';

/**
 * Tessera's own building plans (.tess): plain text in the building language, compiled to
 * blocks. Recognised by content: the first statement is `tess <version>`.
 */

const decoder = new TextDecoder('utf-8');

export function looksLikeTess(bytes: Uint8Array): boolean {
  // Binary formats (gzip, zlib, NBT) contain zero bytes right at the start; text never does.
  const probe = bytes.subarray(0, 64);
  if (probe.length === 0 || probe.includes(0)) return false;
  const head = decoder.decode(bytes.subarray(0, 4096)).replace(/^﻿/, '');
  for (const raw of head.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    return /^tess(\s|$)/i.test(line);
  }
  return false;
}

export interface TessResult extends FormatResult {
  diagnostics: Diagnostic[];
}

/** Line-numbered messages, one per line, for error reports. */
export function formatDiagnostics(list: readonly Diagnostic[]): string {
  return list.map((d) => `Zeile ${d.line}: ${d.message}`).join('\n');
}

export function parseTess(bytes: Uint8Array, hints?: BlockHints): TessResult {
  const source = decoder.decode(bytes);
  const out = compileTess(source, { hints });
  const { grid } = out;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const k of grid.cells.keys()) {
    const [x, y, z] = keyToCell(k);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const empty = grid.size === 0;
  const [sizeX, sizeY, sizeZ] = empty ? [1, 1, 1] : [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1];
  checkCells(sizeX, sizeY, sizeZ);
  // Only states a cell uses end up in the project palette.
  const builder = new PaletteBuilder(TARGET_DATA_VERSION);
  const map = new Map<number, number>();
  const data = new Uint16Array(sizeX * sizeY * sizeZ);
  for (const [k, i] of grid.cells) {
    let p = map.get(i);
    if (p === undefined) {
      p = builder.add(grid.states[i]);
      map.set(i, p);
    }
    const [x, y, z] = keyToCell(k);
    data[((y - minY) * sizeZ + (z - minZ)) * sizeX + (x - minX)] = p;
  }
  return {
    volume: { sizeX, sizeY, sizeZ, palette: builder.palette, data },
    info: {
      format: 'tess',
      formatLabel: 'Tessera-Bauplan',
      formatVersion: 1,
      dataVersion: TARGET_DATA_VERSION,
      offset: empty ? null : [minX, minY, minZ],
      weOffset: null,
      blockEntityCount: 0,
      entityCount: 0,
      meta: out.name ? { name: out.name } : undefined,
      warnings: out.diagnostics.filter((d) => d.level === 'warn').map((d) => `Zeile ${d.line}: ${d.message}`),
      renames: [],
    },
    diagnostics: out.diagnostics,
  };
}
