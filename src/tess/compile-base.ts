import { Args } from './args';
import { CellSet } from './cells';
import type { FormObj } from './compile-forms';
import type { RoofGroup, RoofObj } from './compile-roofs';
import { Grid, infoOrigin, infoPart, LIMIT_V2, Part } from './grid';
import { Palette, type BlockHints } from './palette';
import { asciiKey, TessError, type Diagnostic, type Statement, type Token } from './syntax';

/**
 * Compiler layer 1 of 5 (see compile.ts): the state of a run and its messages (warnings, hints
 * collected per statement, the check "Überschrieben", `erlaube`).
 */

export type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------

export abstract class CompilerBase {
  readonly grid = new Grid(LIMIT_V2);
  readonly palette: Palette;
  readonly diagnostics: Diagnostic[] = [];
  readonly forms = new Map<string, FormObj>();
  readonly roofObjs = new Map<string, RoofObj>();
  readonly failedNames = new Map<string, number>();
  readonly values = new Map<string, number>();
  readonly failedValues = new Map<string, number>();
  readonly groups: RoofGroup[] = [];
  readonly lineTexts = new Map<number, string>();
  name: string | null = null;
  line = 0;
  origin = 0;
  seq = 0;
  readonly originSeq: number[] = [];
  readonly unknownReported = new Set<string>();
  readonly stateCache = new Map<string, Map<string, number>>();
  roofCount = 0;
  /** `erlaube schweben`: no floating check for this file. */
  allowFloating = false;
  /** Hints of the running statement, merged by key (several cells, one message). */
  protected readonly pending = new Map<string, { line: number; text: (n: number, first: Vec3) => string; first: Vec3; n: number }>();
  /** Cells whose overlap the running statement has reported already (no second hint). */
  readonly reported = new Set<number>();
  protected readonly insideCache = new WeakMap<CellSet, Uint16Array>();

  constructor(hints: BlockHints | undefined) {
    this.palette = new Palette(hints, 2);
  }

  /** Tokens of a statement with all expressions evaluated (compile.ts). */
  abstract tokens(st: Statement): Token[];

  // ---- messages

  warn(message: string, line = this.line): void {
    this.diagnostics.push({ line, level: 'warn', message });
  }

  /**
   * Hint "Überschrieben" (11): a statement replaces glass, a door or an Anbau of an earlier line.
   * Cells the statement already reported as an overlap (windows, doors) are left out.
   */
  protected checkCover(x: number, y: number, z: number, origin: number): void {
    const v = this.grid.infoAt(x, y, z);
    if (v === 0) return;
    const part = infoPart(v);
    if (part !== Part.Opening && part !== Part.Annex) return;
    const o = infoOrigin(v);
    if (o === origin) return;
    const old = this.grid.origins[o]?.line ?? 0;
    const cur = this.grid.origins[origin]?.line ?? this.line;
    if (!old || old === cur) return;
    if (this.reported.has(pack3(x, y, z))) return;
    const label = this.coverLabel(old, part);
    this.note(`cover|${old}|${label}`, cur, (n, p) => `Überdeckt ${label} aus Zeile ${old}${n > 1 ? ` an ${n} Stellen, z. B.` : ''} bei ${p.join(',')}.`, [x, y, z]);
  }

  /** "das Fenster", "die Tür", "den Balkon" … for the statement in a line. */
  private coverLabel(line: number, part: Part): string {
    const cmd = asciiKey((this.lineTexts.get(line) ?? '').split(' ')[0] ?? '');
    const labels: Record<string, string> = {
      fenster: 'das Fenster',
      tuer: 'die Tür',
      tor: 'das Tor',
      balkon: 'den Balkon',
      umgang: 'den Umgang',
      erker: 'den Erker',
      gaube: 'die Gaube',
      ecktuerme: 'die Ecktürmchen',
    };
    return labels[cmd] ?? (part === Part.Annex ? 'den Anbau' : 'die Öffnung');
  }

  /**
   * A hint of the running statement that may concern many cells: one message per key, with the
   * number of cells and the first one.
   */
  note(key: string, line: number, text: (n: number, first: Vec3) => string, cell: Vec3): void {
    const e = this.pending.get(key);
    if (e) e.n++;
    else this.pending.set(key, { line, text, first: cell, n: 1 });
  }

  protected flushPending(): void {
    for (const e of this.pending.values()) this.warn(e.text(e.n, e.first), e.line);
    this.pending.clear();
  }

  /** erlaube schweben (11): no floating check for the file. */
  allowCmd(st: Statement): void {
    const a = new Args(st, this.tokens(st), []);
    const what = asciiKey(a.word1('Was erlaubt wird (schweben)'));
    a.done();
    if (what !== 'schweben') throw new TessError(st.line, `„erlaube ${what}“ gibt es nicht; möglich ist „erlaube schweben“.`);
    this.allowFloating = true;
  }
}

// ---------------------------------------------------------------------------

export function pack3(x: number, y: number, z: number): number {
  return ((x + 8192) * 16384 + (y + 8192)) * 16384 + (z + 8192);
}

export function unpack3(k: number): [number, number, number] {
  const z = (k % 16384) - 8192;
  const r = Math.floor(k / 16384);
  const y = (r % 16384) - 8192;
  const x = Math.floor(r / 16384) - 8192;
  return [x, y, z];
}
