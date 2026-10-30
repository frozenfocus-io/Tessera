import type { PlanMeta } from '../tess/compile';
import { decompressAuto, type Compression } from './compression';
import type { FormatId, FormatInfo, FormatResult } from './formats/common';
import { looksLikeLitematic, parseLitematic } from './formats/litematic';
import { looksLikeLegacySchematic, looksLikeSponge, parseSpongeSchematic } from './formats/schem';
import { looksLikeStructure, parseStructure } from './formats/structure';
import { formatDiagnostics, looksLikeTess, parseTess, type PlanOrigins } from './formats/tess';
import type { BlockHints } from '../tess/palette';
import type { Diagnostic } from '../tess/syntax';
import { readNbt } from './nbt/reader';
import { NbtError, type NbtCompound } from './nbt/types';
import { TARGET_DATA_VERSION, TARGET_MC_VERSION, minecraftVersionLabel } from './versions';
import { analyzeVolume, type Volume, type VolumeAnalysis } from './volume';

export interface ImportTimings {
  decompressMs: number;
  nbtMs: number;
  decodeMs: number;
  analyzeMs: number;
}

export interface ImportResult {
  fileName: string;
  format: FormatId;
  formatLabel: string;
  compression: Compression;
  fileSize: number;
  volume: Volume;
  analysis: VolumeAnalysis;
  info: FormatInfo;
  minecraftVersion: string | null;
  timings: ImportTimings;
  /** Messages of the building language with line numbers (.tess only). */
  diagnostics?: Diagnostic[];
  /** Building plans: the statement that set each block (same index order as the volume). */
  origins?: PlanOrigins;
  /** Building plans in version 2: roles and ausrichtung, for editing. */
  plan?: PlanMeta;
}

/** Error with a user-facing German message and optional technical detail. */
export class ImportError extends Error {
  readonly detail?: string;
  /** For building plans: all messages with line numbers. */
  readonly diagnostics?: Diagnostic[];
  constructor(message: string, detail?: string, diagnostics?: Diagnostic[]) {
    super(message);
    this.name = 'ImportError';
    this.detail = detail;
    this.diagnostics = diagnostics;
  }
}

/** File types the import dialog offers. */
export const SUPPORTED_EXTENSIONS = ['.tess', '.schem', '.litematic', '.nbt'];

export interface ImportOptions {
  /** Block catalog knowledge for building plans (families, known ids). */
  hints?: BlockHints;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Recognises the format by content (file names from websites are unreliable). */
function parseByContent(root: NbtCompound): FormatResult {
  if (looksLikeSponge(root)) return parseSpongeSchematic(root);
  if (looksLikeLitematic(root)) return parseLitematic(root);
  if (looksLikeStructure(root)) return parseStructure(root);
  if (looksLikeLegacySchematic(root)) {
    throw new ImportError('Das alte .schematic-Format (vor Minecraft 1.13) wird noch nicht unterstützt.');
  }
  throw new ImportError(
    'Unbekanntes Dateiformat. Tessera liest Sponge-Schematics (.schem), Litematica-Dateien (.litematic) und Strukturdateien (.nbt).',
  );
}

/** Full import pipeline for one file: decompress, parse, normalise, analyse. Pure; runs in a worker. */
export function importFile(fileName: string, bytes: Uint8Array, opts: ImportOptions = {}): ImportResult {
  const timings: ImportTimings = { decompressMs: 0, nbtMs: 0, decodeMs: 0, analyzeMs: 0 };
  if (bytes.length === 0) throw new ImportError('Die Datei ist leer.');
  if (looksLikeTess(bytes)) return importTess(fileName, bytes, opts, timings);

  let t = now();
  let data: Uint8Array;
  let compression: Compression;
  try {
    ({ data, compression } = decompressAuto(bytes));
  } catch (e) {
    throw new ImportError('Die Datei ließ sich nicht entpacken – sie ist vermutlich beschädigt oder unvollständig.', errText(e));
  }
  timings.decompressMs = now() - t;

  t = now();
  let root: NbtCompound;
  try {
    root = readNbt(data).root;
  } catch (e) {
    throw new ImportError('Die Datei ist keine gültige Minecraft-NBT-Datei.', errText(e));
  }
  timings.nbtMs = now() - t;

  t = now();
  let parsed: FormatResult;
  try {
    parsed = parseByContent(root);
  } catch (e) {
    if (e instanceof NbtError) throw new ImportError(`Die Datei ist fehlerhaft: ${e.message}`, errText(e));
    throw e;
  }
  timings.decodeMs = now() - t;

  t = now();
  const analysis = analyzeVolume(parsed.volume);
  timings.analyzeMs = now() - t;

  const { info } = parsed;
  if (info.dataVersion !== null && info.dataVersion > TARGET_DATA_VERSION) {
    info.warnings.push(
      `Die Datei stammt aus Minecraft ${minecraftVersionLabel(info.dataVersion)}; einzelne Blöcke gibt es in ${TARGET_MC_VERSION} eventuell nicht.`,
    );
  }
  if (analysis.nonAir === 0) info.warnings.push('Die Datei enthält nur Luft.');

  return {
    fileName,
    format: info.format,
    formatLabel: info.formatLabel,
    compression,
    fileSize: bytes.length,
    volume: parsed.volume,
    analysis,
    info,
    minecraftVersion: minecraftVersionLabel(info.dataVersion),
    timings,
  };
}

function importTess(fileName: string, bytes: Uint8Array, opts: ImportOptions, timings: ImportTimings): ImportResult {
  let t = now();
  const parsed = parseTess(bytes, opts.hints);
  timings.decodeMs = now() - t;
  const errors = parsed.diagnostics.filter((d) => d.level === 'error');
  if (errors.length) {
    const n = errors.length;
    throw new ImportError(
      n === 1 ? `Der Bauplan hat einen Fehler (Zeile ${errors[0].line}).` : `Der Bauplan hat ${n} Fehler.`,
      formatDiagnostics(errors),
      parsed.diagnostics,
    );
  }
  t = now();
  const analysis = analyzeVolume(parsed.volume);
  timings.analyzeMs = now() - t;
  return {
    fileName,
    format: 'tess',
    formatLabel: parsed.info.formatLabel,
    compression: 'none',
    fileSize: bytes.length,
    volume: parsed.volume,
    analysis,
    info: parsed.info,
    minecraftVersion: minecraftVersionLabel(TARGET_DATA_VERSION),
    timings,
    diagnostics: parsed.diagnostics,
    origins: parsed.origins,
    plan: parsed.plan,
  };
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
