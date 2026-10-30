import { annexCmd, balconyCmd, cornerTurretsCmd, dormerCmd, gallery, orielCmd } from './annex';
import { runChecks } from './checks';
import { CompilerRoofs } from './compile-roofs';
import { connectBlocks } from './connect';
import { bannerCmd, coverCmd, fieldCmd, hangingLanternCmd, ivyCmd, leavesCmd, scatterCmd, wallLanternCmd } from './decor';
import { evalExpr, substitute, type ExprEnv } from './expr';
import { DiscShape, PolygonShape } from './forms';
import { Grid } from './grid';
import { doorCmd, gateCmd, windowCmd } from './openings';
import { stringHash, type BlockHints } from './palette';
import { archCmd, spiralCmd, stairsCmd } from './stairs';
import { asciiKey, classify, detectVersion, FollowUpError, parseStatements2, TessError, tokenText, type Diagnostic, type Statement, type Token } from './syntax';
import { compileV1 } from './v1';
import { buttressCmd, corniceCmd, crenellationsCmd, pillarCmd } from './wallparts';

export type { Vec3 } from './compile-base';
export type { Face, FormObj } from './compile-forms';

/**
 * Compiler for the building language. `tess 1` files go to the frozen compiler of version 0.3.0
 * (v1.ts); `tess 2` files are compiled here. Statements run top to bottom; later ones overwrite
 * earlier blocks (a window cuts into its wall), except where the language says otherwise (roofs
 * unite, blocks between two roofs stay). Each failing statement becomes an error with its line
 * and the rest of the file still compiles, so one report lists every problem.
 *
 * Forms are stacks of layers whose outlines follow a wall profile; Bauteile and roofs work from
 * those outlines. Every block remembers its origin (the statement), shown in the hover card.
 */

export interface CompileOptions {
  hints?: BlockHints;
}

export interface CompileOutput {
  /** Name from `projekt "…"`. */
  name: string | null;
  grid: Grid;
  diagnostics: Diagnostic[];
  statements: number;
  /** Language version of the file. */
  version: 1 | 2;
  /** Statement text by first line (for the origin of blocks). */
  lineTexts: Map<number, string>;
}

/** Commands of Bau-Sprache 2 that a later part of Etappe 4 brings. */
const LATER: Record<string, string> = Object.fromEntries(
  'zeichen ebene ebenen ansicht modul baue wiederhole spiegle ende abschnitt ausrichtung'.split(' ').map((c) => [c, '4c']),
);

const KNOWN =
  'tess, projekt, samen, wert, rolle, box, zylinder, vieleck, umriss, grundriss, kugel, linie, block, leer, fenster, tür, tor, dach, kranzdach, ' +
  'gesims, pfeiler, strebe, balkon, umgang, erker, gaube, ecktuerme, zinnen, bogen, treppe, wendeltreppe, wandlaterne, haengelaterne, banner, ' +
  'efeu, bewuchs, laub, streue, feld, erlaube';

const FIELDS = 'x0 y0 z0 x1 y1 z1 bx by bz mx mz r dach';

// ---------------------------------------------------------------------------

/**
 * The compiler is one class in five layers, one file each; a layer uses only itself and the
 * layers below: compile-base.ts (state, messages) → compile-place.ts (placing blocks) →
 * compile-forms.ts (forms) → compile-roofs.ts (roofs) → compile.ts (running statements). Commands
 * of other modules are functions xxxCmd(c, st), called from the switch in exec.
 */
export class Compiler extends CompilerRoofs {
  readonly env: ExprEnv = {
    value: (name) => {
      const v = this.values.get(name);
      if (v === undefined && this.failedValues.has(name)) throw new FollowUpError(this.line, `„${name}“ fehlt, weil Zeile ${this.failedValues.get(name)} fehlerhaft ist.`);
      return v;
    },
    field: (path) => this.field(path),
    random: (a, b, k) => {
      const r = hashUnit(this.palette.seed, this.line, k);
      return a + Math.floor(r * (b - a + 1));
    },
  };

  run(statements: Statement[]): void {
    const first = statements[0];
    if (!first || first.cmd !== 'tess') {
      this.diagnostics.push({ line: first?.line ?? 1, level: 'error', message: 'Die Datei muss mit „tess 1“ oder „tess 2“ beginnen (Kommentare davor sind erlaubt).' });
    }
    for (const st of statements) {
      this.line = st.line;
      this.seq++;
      this.origin = this.grid.originId(st.line);
      this.originSeq[this.origin] ??= this.seq;
      if (st.text) this.lineTexts.set(st.line, st.text);
      this.pending.clear();
      this.reported.clear();
      try {
        this.exec(st, st === first);
        this.flushPending();
      } catch (e) {
        if (!(e instanceof TessError)) throw e;
        this.pending.clear();
        this.rememberFailure(st);
        if (e instanceof FollowUpError) continue;
        this.diagnostics.push({ line: e.line || st.line, level: 'error', message: e.message });
      }
      if (this.grid.sets > 8_000_000) {
        this.diagnostics.push({ line: st.line, level: 'error', message: 'Der Bauplan setzt mehr als 8 Millionen Blöcke; Tessera bricht hier ab.' });
        break;
      }
    }
  }

  /** Names defined by a failed line: later lines that use them are follow-up errors. */
  rememberFailure(st: Statement): void {
    const raw = st.raw ?? [];
    const plain = raw.filter((r) => !r.quoted && !r.text.includes('='));
    const safe = (t: string): string | null => {
      try {
        return asciiKey(substitute(t, this.env, st.line));
      } catch {
        return null;
      }
    };
    if (st.cmd === 'rolle' && plain[0]) {
      const n = safe(plain[0].text);
      if (n) this.palette.markFailed(n);
    } else if (st.cmd === 'wert') {
      const m = /^wert\s+([^=\s]+)\s*=/.exec(st.text ?? '');
      if (m) this.failedValues.set(asciiKey(m[1]), st.line);
    } else if (['box', 'zylinder', 'vieleck', 'grundriss', 'kugel'].includes(st.cmd)) {
      if (plain[0] && plain[1] && /^[-\d{]/.test(plain[1].text) && !/^[-\d{]/.test(plain[0].text)) {
        const n = safe(plain[0].text);
        if (n) this.failedNames.set(n, st.line);
      }
    } else if (st.cmd === 'umriss') {
      if (plain.length >= 2) {
        const n = safe(plain[0].text);
        if (n) this.failedNames.set(n, st.line);
      }
    } else if (st.cmd === 'dach' || st.cmd === 'erker') {
      const named = raw.find((r) => asciiKey(r.text).startsWith('name='));
      if (named) {
        const n = safe(named.text.slice(named.text.indexOf('=') + 1));
        if (n) this.failedNames.set(n, st.line);
      }
    }
  }

  /** Tokens of a statement with all expressions evaluated. */
  tokens(st: Statement): Token[] {
    return (st.raw ?? []).map((r) => (r.quoted ? { kind: 'string', text: r.text, col: r.col } : classify(substitute(r.text, this.env, st.line), r.col, st.line, 2)));
  }

  exec(st: Statement, isFirst: boolean): void {
    switch (st.cmd) {
      case 'tess': {
        if (!isFirst) throw new TessError(st.line, '„tess“ darf nur in der ersten Zeile stehen.');
        const t = this.tokens(st)[0];
        if (!t || t.kind !== 'number' || t.value !== 2) throw new TessError(st.line, 'Erwartet wird „tess 2“.');
        return;
      }
      case 'projekt': {
        const parts = this.tokens(st).map((t) => (t.kind === 'string' ? t.text : tokenText(t)));
        if (!parts.length) throw new TessError(st.line, 'Nach „projekt“ fehlt der Name, z. B. projekt "Nordturm".');
        this.name = parts.join(' ');
        return;
      }
      case 'samen': {
        const ts = this.tokens(st);
        const t = ts[0];
        if (!t || t.kind !== 'number' || ts.length > 1) throw new TessError(st.line, '„samen“ braucht genau eine ganze Zahl, z. B. „samen 7“.');
        this.palette.seed = t.value;
        return;
      }
      case 'wert':
        return this.valueCmd(st);
      case 'rolle':
        this.palette.define(st, this.tokens(st));
        return;
      case 'box':
      case 'zylinder':
      case 'vieleck':
      case 'umriss':
      case 'grundriss':
      case 'kugel':
        return this.formCmd(st);
      case 'linie':
        return this.lineCmd(st);
      case 'block':
        return this.blockCmd(st);
      case 'leer':
        return this.clearCmd(st);
      case 'fenster':
        return windowCmd(this, st);
      case 'tuer':
        return doorCmd(this, st);
      case 'tor':
        return gateCmd(this, st);
      case 'dach':
        return this.roof(st);
      case 'kranzdach':
        return this.skirt(st);
      case 'gesims':
        return corniceCmd(this, st);
      case 'pfeiler':
        return pillarCmd(this, st);
      case 'strebe':
        return buttressCmd(this, st);
      case 'balkon':
        return balconyCmd(this, st);
      case 'umgang':
        return annexCmd(this, st, gallery);
      case 'erker':
        return orielCmd(this, st);
      case 'gaube':
        return dormerCmd(this, st);
      case 'ecktuerme':
        return cornerTurretsCmd(this, st);
      case 'zinnen':
        return crenellationsCmd(this, st);
      case 'bogen':
        return archCmd(this, st);
      case 'treppe':
        return stairsCmd(this, st);
      case 'wendeltreppe':
        return spiralCmd(this, st);
      case 'wandlaterne':
        return wallLanternCmd(this, st);
      case 'haengelaterne':
        return hangingLanternCmd(this, st);
      case 'banner':
        return bannerCmd(this, st);
      case 'efeu':
        return ivyCmd(this, st);
      case 'bewuchs':
        return coverCmd(this, st);
      case 'laub':
        return leavesCmd(this, st);
      case 'streue':
        return scatterCmd(this, st);
      case 'feld':
        return fieldCmd(this, st);
      case 'erlaube':
        return this.allowCmd(st);
      default:
        if (LATER[st.cmd]) {
          throw new TessError(st.line, `„${st.cmd}“ gehört zu Bau-Sprache 2, ist in dieser Tessera-Version aber noch nicht umgesetzt (kommt mit Etappe ${LATER[st.cmd]}).`);
        }
        throw new TessError(st.line, `Unbekannter Befehl „${st.cmd}“. Bekannt sind: ${KNOWN}.`);
    }
  }

  // ---- values and fields

  valueCmd(st: Statement): void {
    const text = (st.text ?? '').replace(/^\S+\s*/, '');
    const eq = text.indexOf('=');
    if (eq < 0) throw new TessError(st.line, '„wert“ braucht einen Namen und einen Ausdruck, z. B. „wert breite=12“.');
    const raw = text.slice(0, eq).trim();
    const name = asciiKey(raw);
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new TessError(st.line, `„${raw}“ ist kein gültiger Name für einen Wert (Buchstaben, Ziffern, Unterstrich).`);
    if (['min', 'max', 'abs', 'clamp', 'zufall'].includes(name)) throw new TessError(st.line, `„${name}“ ist der Name einer Funktion.`);
    const expr = text.slice(eq + 1).trim();
    if (!expr) throw new TessError(st.line, `Bei „wert ${raw}=“ fehlt der Ausdruck.`);
    const v = evalExpr(substitute(expr, this.env, st.line), this.env, st.line);
    this.values.set(name, v);
    this.failedValues.delete(name);
  }

  field(path: string[]): number {
    const fieldName = path[path.length - 1];
    const objName = path.slice(0, -1).join('.');
    const f = this.forms.get(objName);
    const r = f ? null : this.roofObjs.get(objName);
    if (!f && !r) {
      const failed = this.failedNames.get(objName);
      if (failed !== undefined) throw new FollowUpError(this.line, `„${objName}“ fehlt, weil Zeile ${failed} fehlerhaft ist.`);
      throw new TessError(this.line, `„${path.join('.')}“: Eine Form „${objName}“ gibt es (noch) nicht.`);
    }
    const bbox = f ? f.bbox : r!.bbox;
    const [x0, y0, z0, x1, y1, z1] = bbox;
    const centre = f && (f.kind === 'zylinder' || f.kind === 'vieleck' || f.kind === 'kugel');
    switch (fieldName) {
      case 'x0':
        return x0;
      case 'y0':
        return y0;
      case 'z0':
        return z0;
      case 'x1':
        return x1;
      case 'y1':
        return y1;
      case 'z1':
        return z1;
      case 'bx':
        return x1 - x0 + 1;
      case 'by':
        return y1 - y0 + 1;
      case 'bz':
        return z1 - z0 + 1;
      case 'mx':
        return centre ? (f!.sphere ? f!.sphere.cx : f!.shape!.cx) : Math.floor((x0 + x1) / 2);
      case 'mz':
        return centre ? (f!.sphere ? f!.sphere.cz : f!.shape!.cz) : Math.floor((z0 + z1) / 2);
      case 'r':
        if (f?.sphere) return f.sphere.r;
        if (f?.shape instanceof DiscShape) return f.shape.radius;
        if (f?.shape instanceof PolygonShape) return f.shape.r;
        throw new TessError(this.line, `„${path.join('.')}“: Einen Radius r haben nur zylinder, vieleck und kugel.`);
      case 'dach':
        return f ? (f.roofTop ?? f.y1) : r!.top;
    }
    throw new TessError(this.line, `„${path.join('.')}“: Das Feld „${fieldName}“ gibt es nicht (Felder: ${FIELDS}).`);
  }
}

// ---------------------------------------------------------------------------

function hashUnit(seed: number, line: number, k: number): number {
  let h = (seed ^ 0x2545f491) >>> 0;
  for (const v of [line, k, stringHash('zufall')]) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

/** Line texts of a version 1 file (comment removed), for the origin of blocks. */
function lineTextsV1(source: string): Map<number, string> {
  const out = new Map<number, string>();
  source
    .replace(/^﻿/, '')
    .split('\n')
    .forEach((raw, i) => {
      let quoted = false;
      let end = raw.length;
      for (let j = 0; j < raw.length; j++) {
        if (raw[j] === '"') quoted = !quoted;
        else if (raw[j] === '#' && !quoted) {
          end = j;
          break;
        }
      }
      const t = raw.slice(0, end).replace(/\s+/g, ' ').trim();
      if (t) out.set(i + 1, t);
    });
  return out;
}

/** Compiles a .tess source. Never throws for problems in the file; they come back as diagnostics. */
export function compileTess(source: string, opts: CompileOptions = {}): CompileOutput {
  if (detectVersion(source) !== 2) {
    const out = compileV1(source, opts.hints);
    return { ...out, version: 1, lineTexts: lineTextsV1(source) };
  }
  const { statements, diagnostics } = parseStatements2(source);
  const c = new Compiler(opts.hints);
  c.run(statements);
  connectBlocks(c.grid, 2);
  const found = [...diagnostics, ...c.diagnostics];
  // Checks of section 11 on the finished grid (only when the file has no errors).
  if (!found.some((d) => d.level === 'error')) found.push(...runChecks(c.grid, { floating: !c.allowFloating, label: (l) => `Zeile ${l}` }));
  const all = found.sort((a, b) => a.line - b.line);
  if (c.grid.size === 0 && !all.some((d) => d.level === 'error')) all.push({ line: 1, level: 'warn', message: 'Der Bauplan erzeugt keinen einzigen Block.' });
  return { name: c.name, grid: c.grid, diagnostics: all, statements: statements.length, version: 2, lineTexts: c.lineTexts };
}
