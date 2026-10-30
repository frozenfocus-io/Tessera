import { Args } from './args';
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
import { asciiKey, classify, detectVersion, FollowUpError, parseStatements2, TessError, tokenText, type Diagnostic, type RawToken, type Statement, type Token } from './syntax';
import { turnGrid } from './turngrid';
import { Xf } from './xform';
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
  /** Lower limits than section 10 (tests). */
  limits?: { statements?: number; blocks?: number };
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
const LATER: Record<string, string> = Object.fromEntries('zeichen ebene ebenen ansicht'.split(' ').map((c) => [c, '4c']));

const KNOWN =
  'tess, projekt, samen, wert, rolle, box, zylinder, vieleck, umriss, grundriss, kugel, linie, block, leer, fenster, tür, tor, dach, kranzdach, ' +
  'gesims, pfeiler, strebe, balkon, umgang, erker, gaube, ecktuerme, zinnen, bogen, treppe, wendeltreppe, wandlaterne, haengelaterne, banner, ' +
  'efeu, bewuchs, laub, streue, feld, zeichen, ebene, ebenen, ansicht, modul, baue, wiederhole, spiegle, ende, abschnitt, ausrichtung, erlaube';

/** Commands whose `y=`/`x=` and coordinates are not positions of the running module. */
const LOCAL_ONLY = new Set(['wiederhole', 'spiegle', 'baue', 'ausrichtung', 'modul', 'wert', 'zeichen', 'abschnitt']);

/** Pairs that are absolute heights: shifted by the module's y. */
const HEIGHT_KEYS = new Set(['y', 'von', 'bis']);

/** Scope of values (2): the file, a module instance or a loop (only its variable). */
interface Frame {
  vars: Map<string, number>;
  /** Word settings of a module (role names, block ids, sides). */
  words: Map<string, string>;
  module: boolean;
  /** Loop variable (a loop frame holds only it) and the line of its loop. */
  loopVar?: string;
  loopLine?: number;
  /** Characters of drawings (zeichen) defined here. */
  chars: Map<string, unknown>;
}

interface ModuleDef {
  name: string;
  st: Statement;
  /** Settings with their default as written. */
  params: Map<string, RawToken>;
  instances: number;
}

const FIELDS = 'x0 y0 z0 x1 y1 z1 bx by bz mx mz r dach';

// ---------------------------------------------------------------------------

/**
 * The compiler is one class in five layers, one file each; a layer uses only itself and the
 * layers below: compile-base.ts (state, messages) → compile-place.ts (placing blocks) →
 * compile-forms.ts (forms) → compile-roofs.ts (roofs) → compile.ts (running statements). Commands
 * of other modules are functions xxxCmd(c, st), called from the switch in exec.
 */
export class Compiler extends CompilerRoofs {
  readonly frames: Frame[] = [{ vars: this.values, words: new Map(), module: true, chars: new Map() }];
  readonly modules = new Map<string, ModuleDef>();
  private readonly failedModules = new Map<string, number>();
  private readonly instanceNames = new Set<string>();
  /** `ausrichtung` of the file (applied to the finished grid) and its line. */
  orient: Xf = Xf.ID;
  private orientLine = 0;
  private first: Statement | undefined;
  private stopped = false;

  readonly env: ExprEnv = {
    value: (name) => {
      for (let i = this.frames.length - 1; i >= 0; i--) {
        const v = this.frames[i].vars.get(name);
        if (v !== undefined) return v;
      }
      if (this.failedValues.has(name)) throw new FollowUpError(this.line, `„${name}“ fehlt, weil Zeile ${this.failedValues.get(name)} fehlerhaft ist.`);
      return undefined;
    },
    field: (path) => this.field(path),
    random: (a, b, k) => {
      const r = hashUnit(this.palette.seed, this.line, k);
      return a + Math.floor(r * (b - a + 1));
    },
  };

  run(statements: Statement[]): void {
    const first = statements[0];
    this.first = first;
    if (!first || first.cmd !== 'tess') {
      this.diagnostics.push({ line: first?.line ?? 1, level: 'error', message: 'Die Datei muss mit „tess 1“ oder „tess 2“ beginnen (Kommentare davor sind erlaubt).' });
    }
    // Modules are known from the start, so baue may come before the modul.
    for (const st of statements) if (st.cmd === 'modul') this.defineModule(st);
    this.execList(statements, true);
  }

  /** Runs statements in order; errors are recorded and the next statement runs. */
  execList(list: readonly Statement[], top = false): void {
    for (const st of list) {
      if (this.stopped) return;
      this.line = st.line;
      if (++this.executed > this.maxStatements) {
        this.error(st.line, `Der Bauplan führt mehr als ${millions(this.maxStatements)} Anweisungen aus; Tessera bricht hier ab.`);
        this.stopped = true;
        return;
      }
      this.seq++;
      this.origin = this.grid.originId(st.line, this.chain, this.iter, this.section, this.ctx);
      this.originSeq[this.origin] ??= this.seq;
      if (st.text) this.lineTexts.set(st.line, st.text);
      this.pending.clear();
      this.reported.clear();
      try {
        switch (st.cmd) {
          case 'modul':
            if (!top || this.chain.length) throw new TessError(st.line, 'Module legst du auf oberster Ebene an, nicht in wiederhole, spiegle oder einem anderen Modul.');
            if (this.failedModules.get(asciiKey(st.raw?.[0]?.text ?? '')) === st.line) throw new FollowUpError(st.line, '');
            break;
          case 'wiederhole':
            this.loopCmd(st);
            break;
          case 'spiegle':
            this.mirrorCmd(st);
            break;
          case 'baue':
            this.buildCmd(st);
            break;
          default:
            this.exec(st, st === this.first);
        }
        this.line = st.line;
        this.flushPending();
      } catch (e) {
        if (!(e instanceof TessError)) throw e;
        this.pending.clear();
        this.rememberFailure(st);
        if (!(e instanceof FollowUpError)) this.error(e.line || st.line, e.message);
      }
      if (this.placed > this.maxBlocks) {
        this.error(st.line, `Der Bauplan setzt mehr als ${millions(this.maxBlocks)} Blöcke; Tessera bricht hier ab.`);
        this.stopped = true;
        return;
      }
    }
  }

  /** An error of the running statement, with the module chain. */
  error(line: number, message: string): void {
    this.diagnostics.push(this.ctx ? { line, level: 'error', message, ctx: this.ctx } : { line, level: 'error', message });
  }

  // ---- modules, loops, mirroring, sections (section 10)

  private defineModule(st: Statement): void {
    try {
      const raw = st.raw ?? [];
      const head = raw[0];
      if (!head || head.quoted || head.text.includes('=')) throw new TessError(st.line, 'Nach „modul“ fehlt der Name, z. B. „modul turm h=12“.');
      const name = asciiKey(head.text);
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new TessError(st.line, `„${head.text}“ ist kein gültiger Name für ein Modul (Buchstaben, Ziffern, Unterstrich).`);
      const prev = this.modules.get(name);
      if (prev) throw new TessError(st.line, `Das Modul „${name}“ gibt es schon (Zeile ${prev.st.line}).`);
      const params = new Map<string, RawToken>();
      for (const r of raw.slice(1)) {
        const eq = r.text.indexOf('=');
        if (r.quoted || eq <= 0) throw new TessError(st.line, `„${r.text}“: Angaben eines Moduls stehen als name=standard, z. B. „h=12“ oder „rolle=stein“.`);
        const key = asciiKey(r.text.slice(0, eq));
        if (!/^[a-z_][a-z0-9_]*$/.test(key)) throw new TessError(st.line, `„${key}“ ist kein gültiger Name für eine Angabe.`);
        if (['name', 'drehung', 'spiegel', 'abschnitt'].includes(key)) throw new TessError(st.line, `„${key}=“ gehört zu „baue“ und kann keine Angabe des Moduls sein.`);
        if (params.has(key)) throw new TessError(st.line, `„${key}=“ steht doppelt.`);
        if (!r.text.slice(eq + 1)) throw new TessError(st.line, `„${r.text}“: Nach dem Gleichheitszeichen fehlt der Standard.`);
        params.set(key, { ...r, text: r.text.slice(eq + 1) });
      }
      this.modules.set(name, { name, st, params, instances: 0 });
    } catch (e) {
      if (!(e instanceof TessError)) throw e;
      this.diagnostics.push({ line: e.line, level: 'error', message: e.message });
      const n = asciiKey(st.raw?.[0]?.text ?? '');
      if (n && !this.modules.has(n)) this.failedModules.set(n, st.line);
    }
  }

  /** baue <modul> x,y,z [name=] [drehung=] [spiegel=x|z] [abschnitt="…"] [<angabe>=<wert> …] */
  private buildCmd(st: Statement): void {
    const raw = st.raw ?? [];
    const modName = raw[0] && !raw[0].quoted ? asciiKey(substitute(raw[0].text, this.env, st.line)) : '';
    if (!modName || modName.includes('=')) throw new TessError(st.line, 'Nach „baue“ fehlt der Name des Moduls, z. B. „baue turm 10,0,4“.');
    const failed = this.failedModules.get(modName);
    if (failed !== undefined) throw new FollowUpError(st.line, `„${modName}“ fehlt, weil Zeile ${failed} fehlerhaft ist.`);
    const mod = this.modules.get(modName);
    if (!mod) {
      const list = [...this.modules.keys()].join(', ') || 'keins';
      throw new TessError(st.line, `Ein Modul „${modName}“ gibt es nicht (vorhanden: ${list}).`);
    }
    if (mod.st.endLine === undefined) throw new FollowUpError(st.line, '');
    if (this.chain.length >= 16) throw new TessError(st.line, `Module rufen sich zu tief auf (höchstens 16 Ebenen); „${modName}“ wird hier nicht mehr gebaut.`);
    const a = new Args(st, this.tokens(st).slice(1), ['name', 'drehung', 'spiegel', 'abschnitt', ...mod.params.keys()]);
    const tok = a.positional[0];
    if (!tok || tok.kind !== 'coord' || tok.values.length !== 3) throw new TessError(st.line, 'Bei „baue“ fehlt der Punkt x,y,z, an dem das Modul gebaut wird.');
    const local = tok.local ?? tok.values;
    a.coord('Der Punkt');
    a.done();
    const turn = a.int('drehung', 0, 0, 270);
    if (turn % 90 !== 0) throw new TessError(st.line, `„drehung=${turn}“: möglich sind 0, 90, 180 und 270.`);
    const mirror = a.has('spiegel') ? a.choice('spiegel', ['x', 'z'] as const, 'x') : null;
    // Settings: given values, otherwise the defaults (evaluated here).
    const vars = new Map<string, number>();
    const words = new Map<string, string>();
    for (const [key, def] of mod.params) {
      const v = a.has(key) ? a.str(key)! : this.substWords(substitute(def.text, this.env, st.line));
      if (/^-?\d+$/.test(v)) vars.set(key, parseInt(v, 10));
      else words.set(key, v);
    }
    mod.instances++;
    const inst = asciiKey(a.str('name') ?? `${mod.name}${mod.instances}`);
    if (!/^[a-z_][a-z0-9_]*$/.test(inst)) throw new TessError(st.line, `„name=${inst}“ ist kein gültiger Name (Buchstaben, Ziffern, Unterstrich).`);
    const full = this.qname(inst);
    if (this.instanceNames.has(full) || this.forms.has(full) || this.roofObjs.has(full)) throw new TessError(st.line, `Den Namen „${full}“ gibt es schon.`);
    this.instanceNames.add(full);
    const section = a.has('abschnitt') ? this.sectionIndex(a.str('abschnitt')!) : this.section;

    const saved = { xf: this.xf, chain: this.chain, ctx: this.ctx, prefixes: this.prefixes, suffixes: this.suffixes, section: this.section, iter: this.iter };
    this.xf = this.xf.then(Xf.of(turn, mirror, local[0], local[1], local[2]));
    this.chain = [...this.chain, st.line];
    this.ctx = `in modul ${mod.name}, gebaut in Zeile ${st.line}${this.ctx ? `; ${this.ctx}` : ''}`;
    this.prefixes = [...this.prefixes, `${full}.`];
    this.suffixes = [...this.suffixes, ''];
    this.section = section;
    this.frames.push({ vars, words, module: true, chars: new Map() });
    try {
      this.execList(mod.st.body ?? []);
    } finally {
      this.frames.pop();
      Object.assign(this, saved);
    }
  }

  /** wiederhole <var>=<a>..<b> [schritt=<s>] */
  private loopCmd(st: Statement): void {
    if (st.endLine === undefined) throw new FollowUpError(st.line, '');
    const ts = this.tokens(st);
    const head = ts[0];
    const m = head?.kind === 'pair' ? /^(-?\d+)\.\.(-?\d+)$/.exec(head.value) : null;
    if (!head || head.kind !== 'pair' || !m) throw new TessError(st.line, '„wiederhole“ braucht eine Variable mit Bereich, z. B. „wiederhole i=1..5“ oder „wiederhole k=0..{n-1} schritt=2“.');
    const name = head.key;
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new TessError(st.line, `„${name}“ ist kein gültiger Name für die Variable.`);
    const a = new Args(st, ts.slice(1), ['schritt']);
    a.done();
    const from = parseInt(m[1], 10);
    const to = parseInt(m[2], 10);
    const step = a.int('schritt', 1);
    if (step === 0) throw new TessError(st.line, '„schritt=0“ würde nie enden.');
    const count = (to - from) / step < 0 ? 0 : Math.floor((to - from) / step) + 1;
    if (count > 10_000) throw new TessError(st.line, `Die Schleife hätte ${count} Durchläufe; erlaubt sind höchstens 10 000.`);
    const iter = this.iter;
    try {
      for (let k = 0; k < count && !this.stopped; k++) {
        this.frames.push({ vars: new Map([[name, from + k * step]]), words: new Map(), module: false, loopVar: name, loopLine: st.line, chars: new Map() });
        this.iter = `${iter}/${st.line}:${k}`;
        try {
          this.execList(st.body ?? []);
        } finally {
          this.frames.pop();
        }
      }
    } finally {
      this.iter = iter;
    }
  }

  /** spiegle (x=<achse>|z=<achse>): the body twice, the second time mirrored; names get _s. */
  private mirrorCmd(st: Statement): void {
    if (st.endLine === undefined) throw new FollowUpError(st.line, '');
    const a = new Args(st, this.tokens(st), ['x', 'z']);
    a.done();
    if (a.has('x') === a.has('z')) throw new TessError(st.line, '„spiegle“ braucht genau eine Achse: x=<zahl> oder z=<zahl> (auch halbe Zahlen, z. B. x=10.5).');
    const axis = a.has('x') ? 'x' : 'z';
    const v = a.decimal(axis, 0, -4000, 4000);
    if (!Number.isInteger(v * 2)) throw new TessError(st.line, `„${axis}=${a.str(axis)}“: Die Achse liegt auf einer Zelle oder genau dazwischen (z. B. 10 oder 10.5).`);
    this.execList(st.body ?? []);
    if (this.stopped) return;
    const saved = { xf: this.xf, suffixes: this.suffixes, iter: this.iter };
    this.xf = this.xf.then(Xf.mirrorAt(axis, Math.round(v * 2)));
    this.suffixes = [...this.suffixes, `${this.suffixes[this.suffixes.length - 1]}_s`];
    this.iter = `${this.iter}/${st.line}s`;
    try {
      this.execList(st.body ?? []);
    } finally {
      Object.assign(this, saved);
    }
  }

  sectionIndex(name: string): number {
    const n = name.trim();
    if (!n) throw new TessError(this.line, 'Der Name des Bauabschnitts ist leer.');
    let i = this.grid.sections.indexOf(n);
    if (i < 0) {
      i = this.grid.sections.length;
      this.grid.sections.push(n);
    }
    return i;
  }

  /** abschnitt "<name>" */
  private sectionCmd(st: Statement): void {
    const ts = this.tokens(st);
    if (ts.length !== 1 || ts[0].kind !== 'string') throw new TessError(st.line, '„abschnitt“ braucht einen Namen in Anführungszeichen, z. B. abschnitt "Nordturm".');
    this.section = this.sectionIndex(ts[0].text);
  }

  /** ausrichtung [drehung=0|90|180|270] [spiegel=x|z] */
  private orientCmd(st: Statement): void {
    if (this.chain.length || this.suffixes.length > 1 || this.iter) throw new TessError(st.line, '„ausrichtung“ gilt für die ganze Datei und steht deshalb nicht in Modulen, Schleifen oder spiegle.');
    if (this.orientLine) throw new TessError(st.line, `„ausrichtung“ steht schon in Zeile ${this.orientLine}; sie darf nur einmal vorkommen.`);
    const a = new Args(st, this.tokens(st), ['drehung', 'spiegel']);
    a.done();
    const turn = a.int('drehung', 0, 0, 270);
    if (turn % 90 !== 0) throw new TessError(st.line, `„drehung=${turn}“: möglich sind 0, 90, 180 und 270.`);
    const mirror = a.has('spiegel') ? a.choice('spiegel', ['x', 'z'] as const, 'x') : null;
    this.orient = Xf.of(turn, mirror);
    this.orientLine = st.line;
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
        if (n) this.failedNames.set(this.qname(n), st.line);
      }
    } else if (st.cmd === 'umriss') {
      if (plain.length >= 2) {
        const n = safe(plain[0].text);
        if (n) this.failedNames.set(this.qname(n), st.line);
      }
    } else if (st.cmd === 'dach' || st.cmd === 'erker') {
      const named = raw.find((r) => asciiKey(r.text).startsWith('name='));
      if (named) {
        const n = safe(named.text.slice(named.text.indexOf('=') + 1));
        if (n) this.failedNames.set(this.qname(n), st.line);
      }
    }
  }

  /** Tokens of a statement with all expressions evaluated. */
  tokens(st: Statement): Token[] {
    const move = !this.xf.identity && !LOCAL_ONLY.has(st.cmd);
    return (st.raw ?? []).map((r) => {
      if (r.quoted) return { kind: 'string', text: r.text, col: r.col };
      const t = classify(this.substWords(substitute(r.text, this.env, st.line)), r.col, st.line, 2);
      if (!move) return t;
      if (t.kind === 'coord' && t.values.length === 3) {
        const v = this.xf.map(t.values[0], t.values[1], t.values[2]);
        return { ...t, values: v, text: v.join(','), local: t.values };
      }
      if (t.kind === 'pair' && HEIGHT_KEYS.has(t.key) && /^-?\d+$/.test(t.value)) {
        const v = String(parseInt(t.value, 10) + this.xf.ty);
        return { ...t, value: v, text: `${t.key}=${v}` };
      }
      return t;
    });
  }

  /** Word settings of the modules around (innermost first), or null outside modules. */
  private wordMap(): Map<string, string> | null {
    let out: Map<string, string> | null = null;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      for (const [k, v] of this.frames[i].words) {
        out ??= new Map();
        if (!out.has(k)) out.set(k, v);
      }
    }
    return out;
  }

  /**
   * Word settings of a module stand for themselves: a whole token (`wand`), the value of a pair
   * (`dachrolle=wand`) or the role before a member (`wand:treppe`).
   */
  substWords(text: string): string {
    const words = this.wordMap();
    if (!words) return text;
    const one = (t: string): string => {
      const w = words.get(asciiKey(t));
      if (w !== undefined) return w;
      const c = t.indexOf(':');
      if (c > 0 && !t.includes('[')) {
        const h = words.get(asciiKey(t.slice(0, c)));
        if (h !== undefined) return h + t.slice(c);
      }
      return t;
    };
    const eq = text.indexOf('=');
    const br = text.indexOf('[');
    if (eq > 0 && (br < 0 || eq < br)) return `${text.slice(0, eq + 1)}${one(text.slice(eq + 1))}`;
    return one(text);
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
      case 'abschnitt':
        return this.sectionCmd(st);
      case 'ausrichtung':
        return this.orientCmd(st);
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
    // Set where the value lives in this module (or the file), else in the innermost scope.
    let target: Frame | null = null;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (f.loopVar === name) throw new TessError(st.line, `„${name}“ ist die Variable der Schleife in Zeile ${f.loopLine} und lässt sich nicht neu festlegen.`);
      if (!f.loopVar && f.vars.has(name)) {
        target = f;
        break;
      }
      if (f.module) break;
    }
    if (!target) {
      for (let i = this.frames.length - 1; i >= 0; i--) {
        if (!this.frames[i].loopVar) {
          target = this.frames[i];
          break;
        }
      }
    }
    target!.vars.set(name, v);
    if (this.frames[0] === target) this.failedValues.delete(name);
  }

  field(path: string[]): number {
    const fieldName = path[path.length - 1];
    const objName = this.resolveName(path.slice(0, -1).join('.'), (k) => this.forms.has(k) || this.roofObjs.has(k) || this.failedNames.has(k));
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

/** "2 Millionen", "8 Millionen"; smaller limits (tests) as plain numbers. */
function millions(n: number): string {
  return n >= 1_000_000 && n % 1_000_000 === 0 ? `${n / 1_000_000} Millionen` : n.toLocaleString('de-DE');
}

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
  if (opts.limits?.statements !== undefined) c.maxStatements = opts.limits.statements;
  if (opts.limits?.blocks !== undefined) c.maxBlocks = opts.limits.blocks;
  c.run(statements);
  c.stopWatching();
  const grid = c.orient.identity ? c.grid : turnGrid(c.grid, c.orient);
  connectBlocks(grid, 2);
  // Loops repeat messages: each once.
  const seen = new Set<string>();
  const found = [...diagnostics, ...c.diagnostics].filter((d) => {
    const k = `${d.line}|${d.level}|${d.ctx ?? ''}|${d.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Checks of section 11 on the finished grid (only when the file has no errors).
  if (!found.some((d) => d.level === 'error')) found.push(...runChecks(grid, { floating: !c.allowFloating, label: (l) => `Zeile ${l}` }));
  const all = found.sort((a, b) => a.line - b.line);
  if (grid.size === 0 && !all.some((d) => d.level === 'error')) all.push({ line: 1, level: 'warn', message: 'Der Bauplan erzeugt keinen einzigen Block.' });
  return { name: c.name, grid, diagnostics: all, statements: statements.length, version: 2, lineTexts: c.lineTexts };
}
