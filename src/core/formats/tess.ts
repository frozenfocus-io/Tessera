import { compileTess } from '../../tess/compile';
import { infoOrigin } from '../../tess/grid';
import type { BlockHints } from '../../tess/palette';
import { diagLabel, type Diagnostic } from '../../tess/syntax';
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

/** Where a block of a building plan comes from: statement line, module chain and its text. */
export interface OriginEntry {
  line: number;
  /** Lines of module calls (Etappe 4c); empty outside modules. */
  chain: number[];
  /** The statement, comments removed, continuation lines joined. */
  text: string;
  /** Inside modules: "in modul turm, gebaut in Zeile 88" (innermost first); '' outside. */
  ctx: string;
  /** Bauabschnitt (index into PlanOrigins.sections; 0 = none). */
  section: number;
}

/** Origin of every cell of a building plan (same index order as the volume data). */
export interface PlanOrigins {
  /** Index into `table` per cell; 0 = no block. */
  ids: Uint16Array | Uint32Array;
  table: OriginEntry[];
  /** Names of the Bauabschnitte; index 0 is "no section". */
  sections: string[];
}

export interface TessResult extends FormatResult {
  diagnostics: Diagnostic[];
  origins: PlanOrigins;
}

/** "Zeile 57: dach helm turm profil=glocke …", shortened to `max` characters; with modules the call chain. */
export function originLabel(o: OriginEntry, max: number): string {
  const chain = o.ctx ? ` (${o.ctx})` : o.chain.length ? ` (gebaut in Zeile ${[...o.chain].reverse().join(', ')})` : '';
  const head = `Zeile ${o.line}${chain}`;
  const text = o.text.replace(/\s+/g, ' ').trim();
  if (!text) return head;
  const full = `${head}: ${text}`;
  if (full.length <= max) return full;
  return `${full.slice(0, Math.max(head.length + 2, max - 2)).trimEnd()} …`;
}

/** Line-numbered messages, one per line, for error reports. */
export function formatDiagnostics(list: readonly Diagnostic[]): string {
  return list.map((d) => `${diagLabel(d)}: ${d.message}`).join('\n');
}

export function parseTess(bytes: Uint8Array, hints?: BlockHints): TessResult {
  const source = decoder.decode(bytes);
  const out = compileTess(source, { hints });
  const { grid } = out;
  const b = grid.bounds();
  const [minX, minY, minZ] = b ? b.min : [0, 0, 0];
  const [sizeX, sizeY, sizeZ] = b ? [b.max[0] - minX + 1, b.max[1] - minY + 1, b.max[2] - minZ + 1] : [1, 1, 1];
  checkCells(sizeX, sizeY, sizeZ);
  // Only states a cell uses end up in the project palette.
  const builder = new PaletteBuilder(TARGET_DATA_VERSION);
  const map = new Int32Array(grid.states.length).fill(-1);
  const data = new Uint16Array(sizeX * sizeY * sizeZ);
  const table: OriginEntry[] = [{ line: 0, chain: [], text: '', ctx: '', section: 0 }];
  const originMap = new Map<number, number>();
  const ids = grid.origins.length < 0xffff ? new Uint16Array(data.length) : new Uint32Array(data.length);
  grid.forEach((x, y, z, sid, info) => {
    let p = map[sid];
    if (p < 0) {
      p = builder.add(grid.states[sid]);
      map[sid] = p;
    }
    const i = ((y - minY) * sizeZ + (z - minZ)) * sizeX + (x - minX);
    data[i] = p;
    const o = infoOrigin(info);
    let t = originMap.get(o);
    if (t === undefined) {
      const src = grid.origins[o] ?? { line: 0, chain: [], ctx: '', section: 0 };
      t = table.length;
      table.push({ line: src.line, chain: [...src.chain], text: out.lineTexts.get(src.line) ?? '', ctx: src.ctx, section: src.section });
      originMap.set(o, t);
    }
    ids[i] = t;
  });
  return {
    volume: { sizeX, sizeY, sizeZ, palette: builder.palette, data },
    info: {
      format: 'tess',
      formatLabel: 'Tessera-Bauplan',
      formatVersion: out.version,
      dataVersion: TARGET_DATA_VERSION,
      offset: b ? [minX, minY, minZ] : null,
      weOffset: null,
      blockEntityCount: 0,
      entityCount: 0,
      meta: out.name ? { name: out.name } : undefined,
      warnings: out.diagnostics.filter((d) => d.level === 'warn').map((d) => `${diagLabel(d)}: ${d.message}`),
      renames: [],
    },
    diagnostics: out.diagnostics,
    origins: { ids, table, sections: [...grid.sections] },
  };
}
