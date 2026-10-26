import { makeState } from '../core/blockstate';
import { annexCmd, balconyCmd, cornerTurretsCmd, dormerCmd, gallery, orielCmd } from './annex';
import { Args, NO, YES } from './args';
import { CellSet, ChebDistance, facingTowardsSet, sideBit, SIDES } from './cells';
import { runChecks } from './checks';
import { connectBlocks, hasAxis } from './connect';
import { bannerCmd, coverCmd, fieldCmd, hangingLanternCmd, ivyCmd, leavesCmd, scatterCmd, wallLanternCmd } from './decor';
import { evalExpr, substitute, type ExprEnv } from './expr';
import {
  BoxShape,
  DiscShape,
  OutlineShape,
  parseWallProfile,
  PlanShape,
  PolygonShape,
  profileOffset,
  type FormKind,
  type Piece,
  type ProfileEntry,
  type Shape2D,
} from './forms';
import { axisOf, DIR, parseSide, type Facing } from './geometry';
import { Grid, infoOrigin, infoPart, LIMIT_V2, Part } from './grid';
import { doorCmd, gateCmd, windowCmd } from './openings';
import { Palette, stringHash, type BlockHints, type BlockSpec, type Member, type RoleRef } from './palette';
import { insetAt, layerOf, parseRoofProfile, renderRoofs, renderSkirt, type GableWall, type HipEnds, type RoofDef, type RoofProfile, type RoofType } from './roof';
import { archCmd, spiralCmd, stairsCmd } from './stairs';
import { asciiKey, classify, detectVersion, FollowUpError, parseStatements2, TessError, tokenText, type Diagnostic, type Statement, type Token } from './syntax';
import { compileV1 } from './v1';
import { buttressCmd, corniceCmd, crenellationsCmd, pillarCmd } from './wallparts';
import type { Wall } from './wall';

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

export type Vec3 = [number, number, number];

/** Commands of Bau-Sprache 2 that a later part of Etappe 4 brings. */
const LATER: Record<string, string> = Object.fromEntries(
  'zeichen ebene ebenen ansicht modul baue wiederhole spiegle ende abschnitt ausrichtung'.split(' ').map((c) => [c, '4c']),
);

const KNOWN =
  'tess, projekt, samen, wert, rolle, box, zylinder, vieleck, umriss, grundriss, kugel, linie, block, leer, fenster, tür, tor, dach, kranzdach, ' +
  'gesims, pfeiler, strebe, balkon, umgang, erker, gaube, ecktuerme, zinnen, bogen, treppe, wendeltreppe, wandlaterne, haengelaterne, banner, ' +
  'efeu, bewuchs, laub, streue, feld, erlaube';

// ---------------------------------------------------------------------------
// Forms

interface Timber {
  ref: RoleRef;
  raster: number;
  riegel: number[];
  muster: 'gerade' | 'strebe' | 'kreuz' | 'raute';
  streben: RoleRef;
  schraeg: 'block' | 'treppe';
  /** Extension: beams also run over slanted sides, with posts at the corners of the form. */
  ring: boolean;
}

export interface FormOpts {
  hollow: boolean;
  wall: number;
  floor: RoleRef | null;
  ceiling: RoleRef | null;
  plinth: { ref: RoleRef; h: number } | null;
  crown: { ref: RoleRef; h: number } | null;
  corners: RoleRef | null;
  zones: { ref: RoleRef; a: number; b: number }[];
  timber: Timber | null;
  consoles: RoleRef | null;
}

export interface FormObj {
  kind: FormKind;
  name: string;
  line: number;
  y0: number;
  y1: number;
  shape: Shape2D | null;
  sphere: { cx: number; cy: number; cz: number; r: number; part: 'ganz' | 'oben' | 'unten' } | null;
  profile: ProfileEntry[];
  role: RoleRef;
  roofTop: number | null;
  outlines: Map<number, CellSet>;
  corners: Map<number, CellSet>;
  pieces: Map<number, Piece[] | null>;
  bbox: [number, number, number, number, number, number];
  /** Wall thickness (wand=) and whether the form is hollow. */
  wall: number;
  hollow: boolean;
  /** Roofs built on the form (dormers need one). */
  roofs: RoofDef[];
  /** Anbauten that are forms themselves (oriels): they lean against a wall and bring their own roof. */
  annex: boolean;
}

interface RoofObj {
  name: string;
  line: number;
  bbox: [number, number, number, number, number, number];
  top: number;
}

export interface RoofGroup {
  roofs: RoofDef[];
  /** Per roof: role, giebel role, decorations. */
  extra: RoofExtra[];
  placed: number[];
  /**
   * Cells of the group's blocks that later statements replaced or cleared, with the sequence
   * number of the roof statement that noticed it: only roofs from then on may build there again.
   */
  kept: Map<number, number>;
}

export interface RoofExtra {
  role: RoleRef;
  giebel: RoleRef;
  firstzier: BlockSpec | null;
  spitze: BlockSpec | null;
  form: FormObj;
  line: number;
}

export interface Face {
  side: Facing;
  axis: 'x' | 'z';
  tMin: number;
  tMax: number;
  cell(t: number, y: number): Vec3 | null;
  isCorner(t: number, y: number): boolean;
}

interface TimberCell {
  kind: 'post' | 'beam' | 'strut';
  axis: 'x' | 'y' | 'z';
  /** Struts as stairs: rising direction. */
  facing?: Facing;
}

const FIELDS = 'x0 y0 z0 x1 y1 z1 bx by bz mx mz r dach';

/** Two blocks high plants: placing the lower half brings the upper one. */
const TALL_PLANTS = new Set(['sunflower', 'lilac', 'rose_bush', 'peony', 'tall_grass', 'large_fern', 'pitcher_plant'].map((n) => `minecraft:${n}`));

/** Options of `dach`. */
export const ROOF_KEYS = ['name', 'ueberstand', 'profil', 'steil', 'dicke', 'rolle', 'first', 'giebel', 'kante', 'spitze', 'firstzier', 'traufe', 'kruppel', 'hoch', 'biegung', 'rand', 'art'];

// ---------------------------------------------------------------------------

export class Compiler {
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
  private readonly pending = new Map<string, { line: number; text: (n: number, first: Vec3) => string; first: Vec3; n: number }>();
  /** Cells whose overlap the running statement has reported already (no second hint). */
  readonly reported = new Set<number>();
  private readonly insideCache = new WeakMap<CellSet, Uint16Array>();

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

  constructor(hints: BlockHints | undefined) {
    this.palette = new Palette(hints, 2);
  }

  warn(message: string, line = this.line): void {
    this.diagnostics.push({ line, level: 'warn', message });
  }

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

  /** A second origin of the running statement (same line in the hover), e.g. for a dormer's roof. */
  taggedOrigin(tag: string): number {
    const o = this.grid.originId(this.line, [], tag);
    this.originSeq[o] ??= this.seq;
    return o;
  }

  /** A form object for Anbauten (oriels, turrets, dormers); not registered under a name. */
  makeForm(kind: FormKind, shape: Shape2D, y0: number, y1: number, role: RoleRef, opts: { wall?: number; hollow?: boolean; name?: string; annex?: boolean } = {}): FormObj {
    const f: FormObj = {
      kind,
      name: opts.name ?? '',
      line: this.line,
      y0,
      y1,
      shape,
      sphere: null,
      profile: [],
      role,
      roofTop: null,
      outlines: new Map(),
      corners: new Map(),
      pieces: new Map(),
      bbox: [0, 0, 0, 0, 0, 0],
      wall: opts.wall ?? 1,
      hollow: opts.hollow ?? true,
      roofs: [],
      annex: opts.annex ?? false,
    };
    const O = this.outlineAt(f, y0);
    f.bbox = [O.x0, y0, O.z0, O.x1, y1, O.z1];
    return f;
  }

  /** The roof group a roof belongs to. */
  groupOf(def: RoofDef): RoofGroup | null {
    return this.groups.find((g) => g.roofs.includes(def)) ?? null;
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

  // ---- placing

  /** State index for a block id with properties (cached; completes the axis of logs). */
  sid(id: string, props: Record<string, string> | null, axis?: 'x' | 'y' | 'z'): number {
    let m = this.stateCache.get(id);
    if (!m) {
      m = new Map();
      this.stateCache.set(id, m);
      if (this.palette.isUnknown(id) && !this.unknownReported.has(id)) {
        this.unknownReported.add(id);
        this.warn(`„${id}“ steht nicht im eingelesenen Katalog.`);
      }
    }
    const useAxis = axis && hasAxis(id) && !props?.axis ? axis : '';
    let k = useAxis;
    if (props) for (const p in props) k += `|${p}=${props[p]}`;
    let s = m.get(k);
    if (s === undefined) {
      const all: Record<string, string> = { ...(props ?? {}) };
      if (useAxis) all.axis = useAxis;
      s = this.grid.stateId(makeState(id, all));
      m.set(k, s);
    }
    return s;
  }

  put(x: number, y: number, z: number, sid: number, part: Part, origin = this.origin): void {
    this.checkCover(x, y, z, origin);
    this.grid.setId(x, y, z, sid, part, origin);
  }

  /** Makes a cell air (hollow interiors, openings, leer), with the same cover check. */
  clearCell(p: readonly number[]): void {
    this.checkCover(p[0], p[1], p[2], this.origin);
    this.grid.clear(p[0], p[1], p[2]);
  }

  /**
   * Hint "Überschrieben" (11): a statement replaces glass, a door or an Anbau of an earlier line.
   * Cells the statement already reported as an overlap (windows, doors) are left out.
   */
  private checkCover(x: number, y: number, z: number, origin: number): void {
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

  private flushPending(): void {
    for (const e of this.pending.values()) this.warn(e.text(e.n, e.first), e.line);
    this.pending.clear();
  }

  /** Places a role member at a cell. */
  place(p: readonly number[], ref: RoleRef, member: Member = ref.member, props: Record<string, string> | null = null, part: Part = Part.Plain, axis?: 'x' | 'y' | 'z', origin?: number): void {
    const id = this.palette.pick(ref.role, member, p[0], p[1], p[2], this.line);
    this.put(p[0], p[1], p[2], this.sid(id, props, axis), part, origin);
  }

  placeSpec(p: readonly number[], spec: BlockSpec, part: Part, origin?: number): void {
    if (spec.kind === 'role') this.place(p, spec.ref, spec.ref.member, null, part, 'y', origin);
    else {
      this.put(p[0], p[1], p[2], this.sid(spec.state.name, Object.keys(spec.state.props).length ? { ...spec.state.props } : null), part, origin);
      // Tall plants get their upper half (where there is room).
      if (TALL_PLANTS.has(spec.state.name) && (spec.state.props.half ?? 'lower') === 'lower' && !this.grid.has(p[0], p[1] + 1, p[2])) {
        this.put(p[0], p[1] + 1, p[2], this.sid(spec.state.name, { ...spec.state.props, half: 'upper' }), part, origin);
      }
    }
  }

  ref(text: string, what = 'Rolle'): RoleRef {
    return this.palette.roleRef(text, this.line, what);
  }

  /**
   * Role name for options that also take a block id (feld: zaun=, weg=, e.g. weg=dirt_path): a
   * role of the file wins; otherwise the block gets a role of its own, only for this file.
   */
  roleOrBlockName(text: string): string {
    const head = asciiKey(text.split(':')[0]);
    if (this.palette.roles.has(head) || this.palette.isFailed(head)) return text;
    if (!/^[a-z0-9_.:/-]+$/i.test(text)) return text;
    const key = `_block_${text.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;
    if (!this.palette.roles.has(key)) {
      this.palette.define({ line: this.line, cmd: 'rolle', args: [] }, [
        { kind: 'word', text: key, col: 0 },
        { kind: 'word', text, col: 0 },
      ]);
    }
    return key;
  }

  /** A role with a family member: `holz:zaun` as written, `holz` with the given member. */
  memberRef(text: string, member: Member): RoleRef {
    const r = this.ref(text);
    return r.explicit ? r : { ...r, member };
  }

  /**
   * Railings (gelaender=): a written member as given; otherwise the fence of the role, else its
   * wall, else the block itself.
   */
  railRef(text: string): RoleRef {
    const r = this.ref(text);
    if (r.explicit) return r;
    if (this.palette.hasMember(r.role, 'fence')) return { ...r, member: 'fence' };
    if (this.palette.hasMember(r.role, 'wall')) return { ...r, member: 'wall' };
    return r;
  }

  optRef(a: Args, key: string): RoleRef | null {
    const v = a.str(key);
    return v === undefined ? null : this.ref(v);
  }

  /** `R` or `R:h` (sockel, kranz). */
  refWithHeight(a: Args, key: string): { ref: RoleRef; h: number } | null {
    const v = a.str(key);
    if (v === undefined) return null;
    const m = /^(.*):(\d+)$/.exec(v);
    const h = m ? parseInt(m[2], 10) : 1;
    if (h < 1) throw new TessError(this.line, `„${key}=${v}“: Die Höhe muss mindestens 1 sein.`);
    return { ref: this.ref(m ? m[1] : v), h };
  }

  roleOrNone(v: string): RoleRef | null {
    if (NO.has(v.toLowerCase())) return null;
    return this.ref(v);
  }

  form(name: string, what = 'Die Form'): FormObj {
    const key = asciiKey(name);
    const f = this.forms.get(key);
    const failed = this.failedNames.get(key);
    if (!f && failed !== undefined) throw new FollowUpError(this.line, `„${name}“ fehlt, weil Zeile ${failed} fehlerhaft ist.`);
    if (!f) {
      if (this.roofObjs.has(key)) throw new TessError(this.line, `„${name}“ ist ein Dach, keine Form.`);
      const list = [...this.forms.keys()].join(', ') || 'noch keine';
      throw new TessError(this.line, `${what}: Es gibt keine Form „${name}“ (vorhanden: ${list}).`);
    }
    return f;
  }

  register(f: FormObj): void {
    const prev = this.forms.get(f.name) ?? this.roofObjs.get(f.name);
    if (prev) throw new TessError(this.line, `Den Namen „${f.name}“ gibt es schon (Zeile ${prev.line}).`);
    this.forms.set(f.name, f);
  }

  // ---- form geometry

  offsetAt(f: FormObj, y: number): number {
    return f.profile.length ? profileOffset(f.profile, y - f.y0) : 0;
  }

  outlineAt(f: FormObj, y: number): CellSet {
    if (f.sphere) {
      let c = f.outlines.get(y);
      if (!c) {
        const { cx, cy, cz, r, part } = f.sphere;
        const dy = y - cy;
        const q = (r + 0.5) ** 2 - dy * dy;
        c = q < 0 || (part === 'oben' && y < cy) || (part === 'unten' && y > cy) ? CellSet.EMPTY : CellSet.build(cx - r, cz - r, cx + r, cz + r, (x, z) => (x - cx) ** 2 + (z - cz) ** 2 <= q);
        f.outlines.set(y, c);
      }
      return c;
    }
    const v = this.offsetAt(f, y);
    let c = f.outlines.get(v);
    if (!c) {
      c = f.shape!.outline(v);
      f.outlines.set(v, c);
    }
    return c;
  }

  cornersAt(f: FormObj, y: number): CellSet {
    if (!f.shape) return CellSet.EMPTY;
    const v = this.offsetAt(f, y);
    let c = f.corners.get(v);
    if (!c) {
      c = f.shape.corners(v, this.outlineAt(f, y));
      f.corners.set(v, c);
    }
    return c;
  }

  piecesAt(f: FormObj, y: number): Piece[] | null {
    if (!f.shape) return null;
    const v = this.offsetAt(f, y);
    let p = f.pieces.get(v);
    if (p === undefined) {
      p = f.shape.pieces(v, this.outlineAt(f, y));
      f.pieces.set(v, p);
    }
    return p;
  }

  // ---- forms

  formCmd(st: Statement): void {
    const kind = st.cmd as FormKind;
    const tokens = this.tokens(st);
    const common = ['boden', 'decke', 'ecken', 'sockel', 'kranz', 'fachwerk', 'raster', 'riegel', 'muster', 'streben', 'schraeg', 'ringbalken', 'wand', 'zonen', 'profil', 'konsolen'];
    const keys: Record<FormKind, string[]> = {
      box: common,
      zylinder: [...common, 'r', 'd', 'rx', 'rz', 'h'],
      vieleck: [...common, 'n', 'r', 'h', 'drehung'],
      umriss: [...common, 'y', 'h', 'punkte'],
      grundriss: [...common, 'h'],
      kugel: ['boden', 'decke', 'sockel', 'kranz', 'wand', 'zonen', 'r', 'teil'],
    };
    const a = new Args(st, tokens, keys[kind], ['hohl', 'voll']);
    let name: string | null = null;
    let shape: Shape2D | null = null;
    let sphere: FormObj['sphere'] = null;
    let y0: number;
    let y1: number;
    let roleWord: string;
    switch (kind) {
      case 'box': {
        name = a.optionalName();
        const p1 = a.coord('Die erste Ecke');
        const p2 = a.coord('Die zweite Ecke');
        roleWord = a.word1('Die Rolle');
        a.done();
        shape = new BoxShape(Math.min(p1[0], p2[0]), Math.min(p1[2], p2[2]), Math.max(p1[0], p2[0]), Math.max(p1[2], p2[2]));
        y0 = Math.min(p1[1], p2[1]);
        y1 = Math.max(p1[1], p2[1]);
        break;
      }
      case 'zylinder': {
        name = a.optionalName();
        const [cx, y, cz] = a.coord('Die Mitte unten');
        roleWord = a.word1('Die Rolle');
        a.done();
        const given = ['r', 'd', 'rx', 'rz'].filter((k) => a.has(k));
        let mode: ConstructorParameters<typeof DiscShape>[2];
        if (given.length === 1 && given[0] === 'r') mode = { r: a.int('r', 0, 1, 500) };
        else if (given.length === 1 && given[0] === 'd') mode = { d: a.int('d', 0, 1, 1001) };
        else if (given.length === 2 && a.has('rx') && a.has('rz')) mode = { rx: a.int('rx', 0, 0, 500), rz: a.int('rz', 0, 0, 500) };
        else throw new TessError(st.line, 'Der zylinder braucht genau eins von: r= (Radius), d= (Durchmesser) oder rx= und rz= (Ellipse).');
        const h = a.requireInt('h', 1, 2000, 'Die Höhe in Blöcken.');
        if (a.flag('hohl') && 'r' in mode && mode.r < 2) throw new TessError(st.line, 'Ein hohler zylinder braucht mindestens r=2.');
        shape = new DiscShape(cx, cz, mode);
        y0 = y;
        y1 = y + h - 1;
        break;
      }
      case 'vieleck': {
        name = a.optionalName();
        const [cx, y, cz] = a.coord('Die Mitte unten');
        roleWord = a.word1('Die Rolle');
        a.done();
        const n = a.requireInt('n', 3, 16, 'Die Zahl der Ecken, z. B. n=8.');
        const r = a.requireInt('r', 0, 500, 'Der Radius: Der Umkreis hat r+0,5.');
        const h = a.requireInt('h', 1, 2000, 'Die Höhe in Blöcken.');
        const rot = a.decimal('drehung', 180 / n, -360, 360);
        shape = new PolygonShape(cx, cz, n, r, rot);
        y0 = y;
        y1 = y + h - 1;
        break;
      }
      case 'umriss': {
        const words = a.words();
        a.done();
        if (words.length === 2) {
          name = asciiKey(words[0]);
          roleWord = words[1];
        } else if (words.length === 1) roleWord = words[0];
        else throw new TessError(st.line, words.length ? `„${words[2]}“ ist hier zu viel.` : 'Beim umriss fehlt die Rolle.');
        const y = a.requireInt('y', -LIMIT_V2, LIMIT_V2, 'Die unterste Lage, z. B. y=0.');
        const h = a.requireInt('h', 1, 2000, 'Die Höhe in Blöcken.');
        const raw = a.str('punkte');
        if (!raw) throw new TessError(st.line, 'Beim umriss fehlt „punkte=“, z. B. punkte=0,0;10,0;10,6;0,6.');
        const points = raw.split(';').map((p) => {
          const m = /^(-?\d+),(-?\d+)$/.exec(p.trim());
          if (!m) throw new TessError(st.line, `„punkte=…“: „${p}“ ist kein Punkt x,z.`);
          return [parseInt(m[1], 10), parseInt(m[2], 10)] as [number, number];
        });
        if (points.length < 3) throw new TessError(st.line, 'Ein umriss braucht mindestens drei Punkte.');
        shape = new OutlineShape(points, st.line);
        y0 = y;
        y1 = y + h - 1;
        break;
      }
      case 'grundriss': {
        name = a.optionalName();
        const [x, y, z] = a.coord('Die Ecke (Zelle des ersten Zeichens)');
        roleWord = a.word1('Die Rolle');
        a.done();
        const h = a.requireInt('h', 1, 2000, 'Die Höhe in Blöcken.');
        const lines = st.ascii ?? [];
        if (!lines.length) throw new TessError(st.line, 'Unter „grundriss“ fehlt die Zeichnung (Zeilen, die mit | beginnen).');
        const cells: [number, number][] = [];
        lines.forEach((l, row) => {
          for (let i = 0; i < l.text.length; i++) {
            const c = l.text[i];
            if (c !== ' ' && c !== '.') cells.push([x + i, z + row]);
          }
        });
        if (!cells.length) throw new TessError(st.line, 'Die Zeichnung des grundriss enthält keine Zelle (Leerzeichen und . sind außen).');
        shape = new PlanShape(CellSet.fromCells(cells));
        y0 = y;
        y1 = y + h - 1;
        break;
      }
      case 'kugel': {
        name = a.optionalName();
        const [cx, cy, cz] = a.coord('Die Mitte');
        roleWord = a.word1('Die Rolle');
        a.done();
        const r = a.requireInt('r', 0, 200, 'Der Radius.');
        const teil = asciiKey(a.str('teil') ?? 'ganz');
        if (teil !== 'ganz' && teil !== 'oben' && teil !== 'unten') throw new TessError(st.line, `„teil=${teil}“: möglich sind ganz, oben und unten.`);
        sphere = { cx, cy, cz, r, part: teil };
        y0 = teil === 'oben' ? cy : cy - r;
        y1 = teil === 'unten' ? cy : cy + r;
        break;
      }
    }
    const role = this.ref(roleWord!);
    const o = this.formOpts(a, kind);
    const f: FormObj = {
      kind,
      name: name ?? '',
      line: st.line,
      y0,
      y1,
      shape,
      sphere,
      profile: o.profile,
      role,
      roofTop: null,
      outlines: new Map(),
      corners: new Map(),
      pieces: new Map(),
      bbox: [0, 0, 0, 0, 0, 0],
      wall: o.wall,
      hollow: o.hollow,
      roofs: [],
      annex: false,
    };
    if (name && (this.forms.has(name) || this.roofObjs.has(name))) this.register(f);
    // Check the outline of every layer before building anything.
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (let y = y0; y <= y1; y++) {
      const c = this.outlineAt(f, y);
      if (c.isEmpty()) {
        if (f.sphere) continue;
        throw new TessError(st.line, `Das Profil macht den Umriss in Lage ${y - y0} (y=${y}) leer.`);
      }
      bx0 = Math.min(bx0, c.x0);
      bz0 = Math.min(bz0, c.z0);
      bx1 = Math.max(bx1, c.x1);
      bz1 = Math.max(bz1, c.z1);
    }
    f.bbox = [bx0, y0, bz0, bx1, y1, bz1];
    if (o.hollow && kind === 'box') {
      const s = shape as BoxShape;
      if (s.x1 - s.x0 < 2 || s.z1 - s.z0 < 2) throw new TessError(st.line, 'Eine hohle box braucht innen Platz: mindestens 3 Blöcke in x und z.');
    }
    if (f.sphere) this.buildSphere(f, o);
    else this.buildPrism(f, o);
    if (name) this.register(f);
  }

  formOpts(a: Args, kind: FormKind): FormOpts & { profile: ProfileEntry[] } {
    const hollow = a.flag('hohl');
    const wall = a.int('wand', 1, 1, 64);
    const timberKeys = ['raster', 'riegel', 'muster', 'streben', 'schraeg', 'ringbalken'];
    const fw = a.str('fachwerk');
    if (!fw) for (const k of timberKeys) if (a.has(k)) throw new TessError(a.line, `„${k}=“ gilt nur zusammen mit „fachwerk=“.`);
    if (fw && (kind === 'zylinder' || kind === 'kugel')) throw new TessError(a.line, 'Fachwerk geht nur auf geraden Wänden: bei box, vieleck, umriss und grundriss.');
    if (a.has('ecken') && (kind === 'zylinder' || kind === 'kugel')) throw new TessError(a.line, `Ein ${kind} hat keine Ecken; „ecken=“ gilt für box, vieleck, umriss und grundriss.`);
    const profile = a.has('profil') ? parseWallProfile(a.str('profil')!, a.line) : [];
    if (a.has('konsolen') && !profile.length) throw new TessError(a.line, '„konsolen=“ gilt nur zusammen mit „profil=“ (Konsolen stützen Vorkragungen).');
    let timber: Timber | null = null;
    if (fw) {
      const ref = this.ref(fw);
      const muster = asciiKey(a.str('muster') ?? 'gerade');
      if (!['gerade', 'strebe', 'kreuz', 'raute'].includes(muster)) throw new TessError(a.line, `„muster=${muster}“: möglich sind gerade, strebe, kreuz und raute.`);
      const schraeg = asciiKey(a.str('schraeg') ?? 'block');
      if (schraeg !== 'block' && schraeg !== 'treppe') throw new TessError(a.line, `„schraeg=${schraeg}“: möglich sind block und treppe.`);
      const riegel = (a.str('riegel') ?? '')
        .split(',')
        .filter((s) => s.trim() !== '')
        .map((s) => {
          if (!/^\d+$/.test(s.trim())) throw new TessError(a.line, `„riegel=${a.str('riegel')}“: Erwartet werden Lagen (ganze Zahlen ab 0), z. B. riegel=2,5.`);
          return parseInt(s, 10);
        });
      const streben = a.str('streben') ? this.ref(a.str('streben')!) : ref;
      const ringArg = a.str('ringbalken')?.toLowerCase();
      if (ringArg !== undefined && !YES.has(ringArg) && !NO.has(ringArg)) throw new TessError(a.line, `„ringbalken=${ringArg}“: ja oder nein.`);
      const ring = ringArg !== undefined && YES.has(ringArg);
      timber = { ref, raster: a.int('raster', 4, 2, 64), riegel, muster: muster as Timber['muster'], streben, schraeg: schraeg as Timber['schraeg'], ring };
      if (schraeg === 'treppe' && muster !== 'gerade' && !this.palette.hasMember(streben.role, 'stairs')) {
        throw new TessError(a.line, `„schraeg=treppe“ braucht Treppen: Die Rolle „${streben.role.name}“ hat keine.`);
      }
    }
    const zones: FormOpts['zones'] = [];
    const zv = a.str('zonen');
    if (zv) {
      for (const part of zv.split(',')) {
        const m = /^([^@]+)@(\d+)(-(\d*))?$/.exec(part.trim());
        if (!m) throw new TessError(a.line, `„zonen=…“: „${part}“ hat nicht die Form Rolle@von-bis, z. B. putz@4-9 oder putz@4-.`);
        const lo = parseInt(m[2], 10);
        const hi = m[3] === undefined ? lo : m[4] === '' ? Infinity : parseInt(m[4], 10);
        if (hi < lo) throw new TessError(a.line, `„zonen=…“: In „${part}“ ist bis kleiner als von.`);
        zones.push({ ref: this.ref(m[1]), a: lo, b: hi });
      }
    }
    return {
      hollow,
      wall,
      floor: this.optRef(a, 'boden'),
      ceiling: this.optRef(a, 'decke'),
      plinth: this.refWithHeight(a, 'sockel'),
      crown: this.refWithHeight(a, 'kranz'),
      corners: this.optRef(a, 'ecken'),
      zones,
      timber,
      consoles: this.optRef(a, 'konsolen'),
      profile,
    };
  }

  buildPrism(f: FormObj, o: FormOpts): void {
    const h = f.y1 - f.y0 + 1;
    const round = f.kind === 'zylinder';
    const timber = o.timber;
    // Beam layers of the timber frame (relative): sill above the plinth, top, rails.
    let beams: number[] = [];
    if (timber) {
      const bottom = o.plinth ? Math.min(o.plinth.h, h - 1) : 0;
      for (const r of timber.riegel) {
        if (r <= bottom || r >= h - 1) throw new TessError(this.line, `„riegel=“: Die Lage ${r} liegt nicht zwischen Schwelle (${bottom}) und oberem Balken (${h - 1}).`);
      }
      beams = [...new Set([bottom, ...timber.riegel, h - 1])].sort((p, q) => p - q);
    }
    let slanted = false;
    for (let L = 0; L < h; L++) {
      const y = f.y0 + L;
      const O = this.outlineAt(f, y);
      const dist = O.insideDistance();
      const corners = o.corners ? this.cornersAt(f, y) : null;
      let frame: Map<number, TimberCell> | null = null;
      if (timber && L >= beams[0] && L <= beams[beams.length - 1]) {
        const res = this.timberLayer(f, timber, beams, L, y, O, dist);
        frame = res.cells;
        if (res.slanted) slanted = true;
      }
      O.forEach((x, z) => {
        const d = O.at(dist, x, z);
        const p = [x, y, z];
        if (d > o.wall) {
          if (L === 0 && o.floor) this.place(p, o.floor, o.floor.member, null, Part.Plain, 'x');
          else if (L === h - 1 && o.ceiling) this.place(p, o.ceiling, o.ceiling.member, null, Part.Plain, 'x');
          else if (!o.hollow) this.place(p, f.role, f.role.member, null, Part.Plain, 'y');
          else this.clearCell(p);
          return;
        }
        const open = O.openSides(x, z);
        const along: 'x' | 'z' = open & 5 ? 'x' : open & 10 ? 'z' : 'x';
        if (corners?.has(x, z)) this.place(p, o.corners!, o.corners!.member, null, Part.Structure, 'y');
        else if (o.plinth && L < o.plinth.h) this.place(p, o.plinth.ref, o.plinth.ref.member, null, Part.Plain, round ? 'y' : along);
        else if (o.crown && L >= h - o.crown.h) this.place(p, o.crown.ref, o.crown.ref.member, null, Part.Beam, round ? 'y' : along);
        else {
          const t = d === 1 ? frame?.get(packXZ(x, z)) : undefined;
          if (t) {
            if (t.kind === 'post') this.place(p, timber!.ref, timber!.ref.member, null, Part.Structure, 'y');
            else if (t.kind === 'beam') this.place(p, timber!.ref, timber!.ref.member, null, Part.Beam, t.axis);
            else if (timber!.schraeg === 'treppe') this.place(p, timber!.streben, 'stairs', { facing: t.facing!, half: 'bottom' }, Part.Strut);
            else this.place(p, timber!.streben, timber!.streben.member, null, Part.Strut, t.axis);
            return;
          }
          const zone = this.zoneAt(o, L);
          this.place(p, zone ?? f.role, (zone ?? f.role).member, null, Part.Plain, 'y');
        }
      });
    }
    if (slanted) this.warn(`Fachwerk geht nur auf geraden Wänden in x- oder z-Richtung; an den schrägen Seiten von „${f.name || f.kind}“ fehlt es.`);
    if (o.consoles) this.consoles(f, o.consoles);
  }

  zoneAt(o: FormOpts, L: number): RoleRef | null {
    for (let i = o.zones.length - 1; i >= 0; i--) if (L >= o.zones[i].a && L <= o.zones[i].b) return o.zones[i].ref;
    return null;
  }

  /** Posts, beams and braces of one layer of a timber frame. */
  timberLayer(
    f: FormObj,
    t: Timber,
    beams: number[],
    L: number,
    y: number,
    O: CellSet,
    dist: Uint16Array,
  ): { cells: Map<number, TimberCell>; slanted: boolean } {
    const cells = new Map<number, TimberCell>();
    const pieces = this.piecesAt(f, y) ?? [];
    const isBeam = beams.includes(L);
    let row: [number, number] | null = null;
    for (let i = 0; i + 1 < beams.length; i++) if (L > beams[i] && L < beams[i + 1]) row = [beams[i] + 1, beams[i + 1] - 1];
    for (const pc of pieces) {
      const ts = pc.cells.map((c) => (pc.axis === 'x' ? c[0] : c[1]));
      const fixed = pc.axis === 'x' ? pc.cells[0][1] : pc.cells[0][0];
      const at = (tt: number): number => (pc.axis === 'x' ? packXZ(tt, fixed) : packXZ(fixed, tt));
      const t0 = ts[0];
      const t1 = ts[ts.length - 1];
      const posts = new Set<number>([t0, t1]);
      for (let k = t0 + t.raster; k < t1; k += t.raster) posts.add(k);
      for (const tt of ts) {
        if (posts.has(tt)) cells.set(at(tt), { kind: 'post', axis: 'y' });
        else if (isBeam && !cells.has(at(tt))) cells.set(at(tt), { kind: 'beam', axis: pc.axis });
      }
      if (!row || t.muster === 'gerade') continue;
      const sorted = [...posts].sort((p, q) => p - q);
      const plus: Facing = pc.axis === 'x' ? 'east' : 'south';
      const minus: Facing = pc.axis === 'x' ? 'west' : 'north';
      for (let i = 0; i + 1 < sorted.length; i++) {
        const ta = sorted[i] + 1;
        const tb = sorted[i + 1] - 1;
        if (tb < ta) continue;
        const w = tb - ta + 1;
        const [ya, yb] = row;
        const hh = yb - ya + 1;
        const frac = hh === 1 ? 0.5 : (L - ya) / (hh - 1);
        const strut = (tt: number, facing: Facing) => {
          const k = at(tt);
          if (!cells.has(k)) cells.set(k, { kind: 'strut', axis: 'y', facing });
        };
        const rising = () => strut(ta + Math.round(frac * (w - 1)), plus);
        const falling = () => strut(tb - Math.round(frac * (w - 1)), minus);
        if (t.muster === 'strebe') {
          if (i % 2 === 0) rising();
          else falling();
        } else if (t.muster === 'kreuz') {
          rising();
          falling();
        } else if (w >= 3 && hh >= 3) {
          // Raute: lines between the middles of the four sides of the field.
          const tm = (ta + tb) / 2;
          const ym = (ya + yb) / 2;
          const seg = (p1: [number, number], p2: [number, number], facing: Facing) => {
            const [ta1, y1] = p1;
            const [ta2, y2] = p2;
            if (L < Math.min(y1, y2) - 1e-9 || L > Math.max(y1, y2) + 1e-9 || y1 === y2) return;
            strut(Math.round(ta1 + ((ta2 - ta1) * (L - y1)) / (y2 - y1)), facing);
          };
          seg([tm, ya], [ta, ym], minus);
          seg([ta, ym], [tm, yb], plus);
          seg([tm, yb], [tb, ym], minus);
          seg([tb, ym], [tm, ya], plus);
        }
      }
    }
    // Outer wall cells that no straight piece covers: slanted sides.
    const covered = new Set<number>();
    for (const pc of pieces) for (const [x, z] of pc.cells) covered.add(packXZ(x, z));
    let slanted = false;
    const corners = t.ring && f.kind !== 'grundriss' ? this.cornersAt(f, y) : null;
    O.forEach((x, z) => {
      if (O.at(dist, x, z) !== 1 || covered.has(packXZ(x, z))) return;
      if (!t.ring) {
        slanted = true;
        return;
      }
      // ringbalken=ja: posts at the corners of the form, beams around, no pattern.
      if (corners?.has(x, z)) cells.set(packXZ(x, z), { kind: 'post', axis: 'y' });
      else if (isBeam) cells.set(packXZ(x, z), { kind: 'beam', axis: O.openSides(x, z) & 5 ? 'x' : 'z' });
    });
    return { cells, slanted };
  }

  /** Corbels under every layer where the profile grows outwards. */
  consoles(f: FormObj, ref: RoleRef): void {
    const h = f.y1 - f.y0 + 1;
    for (let L = 1; L < h; L++) {
      const dv = this.offsetAt(f, f.y0 + L) - this.offsetAt(f, f.y0 + L - 1);
      if (dv < 1) continue;
      const inner = this.outlineAt(f, f.y0 + L - 1);
      const outer = this.outlineAt(f, f.y0 + L);
      const over = outer.minus(inner);
      const dist = new ChebDistance(inner, over, dv + 2);
      over.forEach((x, z) => {
        const j = Math.max(1, Math.min(dv, dist.get(x, z)));
        const ys = L - 1 - (dv - j);
        const facing = facingTowardsSet(x, z, (a, c) => (j === 1 ? inner.has(a, c) : dist.get(a, c) === j - 1), 'x') ?? 'north';
        for (let yy = Math.max(0, ys); yy <= L - 1; yy++) {
          const Y = f.y0 + yy;
          if (this.outlineAt(f, Y).has(x, z)) continue;
          if (yy === ys) this.place([x, Y, z], ref, 'stairs', { facing, half: 'top' });
          else this.place([x, Y, z], ref, 'block', null, Part.Plain, 'y');
        }
      });
    }
  }

  buildSphere(f: FormObj, o: FormOpts): void {
    const s = f.sphere!;
    const R = s.r;
    // 3D distance to the outside over the six neighbours (shell of thickness `wand`).
    const n = 2 * R + 3;
    const off = R + 1;
    const inside = new Uint8Array(n * n * n);
    const idx = (dx: number, dy: number, dz: number) => ((dy + off) * n + (dz + off)) * n + (dx + off);
    const lim = (R + 0.5) ** 2;
    for (let dy = -R; dy <= R; dy++)
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy + dz * dz <= lim) inside[idx(dx, dy, dz)] = 1;
    let core = inside;
    for (let k = 0; k < o.wall; k++) {
      const nxt = new Uint8Array(core.length);
      for (let dy = -R; dy <= R; dy++)
        for (let dz = -R; dz <= R; dz++)
          for (let dx = -R; dx <= R; dx++) {
            const i = idx(dx, dy, dz);
            if (!core[i]) continue;
            if (core[i - 1] && core[i + 1] && core[i - n] && core[i + n] && core[i - n * n] && core[i + n * n]) nxt[i] = 1;
          }
      core = nxt;
    }
    const h = f.y1 - f.y0 + 1;
    for (let y = f.y0; y <= f.y1; y++) {
      const L = y - f.y0;
      const dy = y - s.cy;
      this.outlineAt(f, y).forEach((x, z) => {
        const i = idx(x - s.cx, dy, z - s.cz);
        const p = [x, y, z];
        if (core[i]) {
          if (L === 0 && o.floor) this.place(p, o.floor, o.floor.member, null, Part.Plain, 'x');
          else if (L === h - 1 && o.ceiling) this.place(p, o.ceiling, o.ceiling.member, null, Part.Plain, 'x');
          else if (!o.hollow) this.place(p, f.role, f.role.member, null, Part.Plain, 'y');
          else this.clearCell(p);
          return;
        }
        if (o.plinth && L < o.plinth.h) this.place(p, o.plinth.ref, o.plinth.ref.member, null, Part.Plain, 'y');
        else if (o.crown && L >= h - o.crown.h) this.place(p, o.crown.ref, o.crown.ref.member, null, Part.Beam, 'y');
        else {
          const zone = this.zoneAt(o, L);
          this.place(p, zone ?? f.role, (zone ?? f.role).member, null, Part.Plain, 'y');
        }
      });
    }
  }

  // ---- simple commands

  /** linie x,y,z x,y,z <rolle> */
  lineCmd(st: Statement): void {
    const a = new Args(st, this.tokens(st), []);
    const p1 = a.coord('Der Anfang');
    const p2 = a.coord('Das Ende');
    const ref = this.ref(a.word1('Die Rolle'));
    a.done();
    const d = [Math.abs(p2[0] - p1[0]), Math.abs(p2[1] - p1[1]), Math.abs(p2[2] - p1[2])];
    const axis = d[1] >= d[0] && d[1] >= d[2] ? 'y' : d[0] >= d[2] ? 'x' : 'z';
    const n = Math.max(d[0], d[1], d[2]);
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0 : i / n;
      const p = [Math.round(p1[0] + (p2[0] - p1[0]) * t), Math.round(p1[1] + (p2[1] - p1[1]) * t), Math.round(p1[2] + (p2[2] - p1[2]) * t)];
      this.place(p, ref, ref.member, null, Part.Structure, axis);
    }
  }

  /** block x,y,z <block-angabe> */
  blockCmd(st: Statement): void {
    const a = new Args(st, this.tokens(st), []);
    const p = a.coord('Die Position');
    const what = a.word1('Der Block oder die Rolle');
    a.done();
    const spec = this.palette.blockSpec(what, st.line);
    if (spec.kind === 'role') this.place(p, spec.ref, spec.ref.member);
    else this.placeSpec(p, spec, Part.Plain);
  }

  /** leer x,y,z [x,y,z] */
  clearCmd(st: Statement): void {
    const a = new Args(st, this.tokens(st), []);
    const p1 = a.coord('Die Position');
    const p2 = a.positional.length > 1 ? a.coord('Die zweite Ecke') : p1;
    a.done();
    for (let y = Math.min(p1[1], p2[1]); y <= Math.max(p1[1], p2[1]); y++)
      for (let z = Math.min(p1[2], p2[2]); z <= Math.max(p1[2], p2[2]); z++)
        for (let x = Math.min(p1[0], p2[0]); x <= Math.max(p1[0], p2[0]); x++) this.clearCell([x, y, z]);
  }

  // ---- Bauteile (windows and doors as in version 1, on every form, with the outline of their layer)

  faceAt(f: FormObj, side: Facing, y: number): Face {
    const axis = axisOf(side) === 'x' ? 'z' : 'x';
    const [ox, oz] = DIR[side];
    if (f.kind === 'box') {
      const O = this.outlineAt(f, y);
      const [tMin, tMax] = axis === 'x' ? [O.x0, O.x1] : [O.z0, O.z1];
      return {
        side,
        axis,
        tMin,
        tMax,
        cell: (t, yy) => {
          const c = this.outlineAt(f, yy);
          const fx = side === 'north' ? c.z0 : side === 'south' ? c.z1 : side === 'west' ? c.x0 : c.x1;
          const [lo, hi] = axis === 'x' ? [c.x0, c.x1] : [c.z0, c.z1];
          if (t < lo || t > hi) return null;
          return axis === 'x' ? [t, yy, fx] : [fx, yy, t];
        },
        isCorner: (t) => t === tMin || t === tMax,
      };
    }
    const outer = (yy: number): Map<number, [number, number]> => {
      const O = this.outlineAt(f, yy);
      const best = new Map<number, [number, number]>();
      const half = f.shape?.halfFaces ?? true;
      const px = f.shape ? f.shape.px : f.sphere!.cx + 0.5;
      const pz = f.shape ? f.shape.pz : f.sphere!.cz + 0.5;
      O.forEach((x, z) => {
        if (O.has(x + ox, z + oz)) return;
        if (half && (x + 0.5 - px) * ox + (z + 0.5 - pz) * oz <= 0) return;
        const t = axis === 'x' ? x : z;
        const depth = x * ox + z * oz;
        const cur = best.get(t);
        if (!cur || depth > cur[0] * ox + cur[1] * oz) best.set(t, [x, z]);
      });
      return best;
    };
    const cache = new Map<number, Map<number, [number, number]>>();
    const at = (yy: number) => {
      let m = cache.get(yy);
      if (!m) cache.set(yy, (m = outer(yy)));
      return m;
    };
    const ts = [...at(y).keys()];
    return {
      side,
      axis,
      tMin: ts.length ? Math.min(...ts) : 0,
      tMax: ts.length ? Math.max(...ts) : -1,
      cell: (t, yy) => {
        const c = at(yy).get(t);
        return c ? [c[0], yy, c[1]] : null;
      },
      isCorner: (t, yy) => {
        const c = at(yy).get(t);
        return !!c && this.cornersAt(f, yy).has(c[0], c[1]);
      },
    };
  }

  /** Centre point of a form (cells have their centres at +0.5). */
  centrePoint(f: FormObj): { px: number; pz: number } {
    return f.shape ? { px: f.shape.px, pz: f.shape.pz } : { px: f.sphere!.cx + 0.5, pz: f.sphere!.cz + 0.5 };
  }

  /** Steps to the outside for the cells of an outline (cached per outline). */
  insideDist(O: CellSet): Uint16Array {
    let d = this.insideCache.get(O);
    if (!d) {
      d = O.insideDistance();
      this.insideCache.set(O, d);
    }
    return d;
  }

  /** Whether a cell is a wall cell of the form (in the outline, at most `wand` steps from outside). */
  isWallCell(f: FormObj, x: number, y: number, z: number): boolean {
    if (y < f.y0 || y > f.y1) return false;
    const O = this.outlineAt(f, y);
    const d = O.at(this.insideDist(O), x, z);
    return d >= 1 && d <= f.wall;
  }

  /**
   * The wall at a cell, from the outer cell inwards: as many cells as the wall is thick (`wand=`),
   * through the whole form when it is solid. Always contains the cell itself.
   */
  wallDepth(f: FormObj, p: Vec3, inward: Facing): Vec3[] {
    const out: Vec3[] = [p];
    if (p[1] < f.y0 || p[1] > f.y1) return out;
    const O = this.outlineAt(f, p[1]);
    const [dx, dz] = DIR[inward];
    if (!f.hollow) {
      // Solid forms: the opening goes through the whole form.
      for (let k = 1; k < 256; k++) {
        const x = p[0] + dx * k;
        const z = p[2] + dz * k;
        if (!O.has(x, z)) break;
        out.push([x, p[1], z]);
      }
      return out;
    }
    if (f.wall <= 1) return out;
    const dist = this.insideDist(O);
    for (let k = 1; k < f.wall; k++) {
      const x = p[0] + dx * k;
      const z = p[2] + dz * k;
      if (O.at(dist, x, z) !== k + 1) break;
      out.push([x, p[1], z]);
    }
    return out;
  }

  /** Wall cell of a Bauteil's column, with the checks of version 1 (in the wall, corner, post, beam, overlap). */
  openingCell(wall: Wall, col: number, y: number, what: string, allowBeam = false): Vec3 | null {
    const p = wall.cell(col, y);
    const where = () => (p ? `${p[0]},${p[1]},${p[2]}` : `${wall.mode === 'face' ? `${wall.axis}=${col}` : `Spalte ${col}`}, y=${y}`);
    if (!p || !this.grid.has(p[0], p[1], p[2])) {
      this.warn(`${what} liegt bei ${where()} nicht in der Wand (dort ist kein Block).`);
      return p;
    }
    if (wall.isCorner(col, y)) this.warn(`${what} sitzt bei ${where()} in der Hausecke.`);
    const info = this.grid.cellInfo(p[0], p[1], p[2]);
    if (info?.part === Part.Structure) this.warn(`${what} schneidet bei ${where()} einen Pfosten oder Eckpfeiler (Zeile ${info.line}).`);
    else if (info?.part === Part.Beam && !allowBeam) this.warn(`${what} schneidet bei ${where()} einen waagrechten Balken (Zeile ${info.line}).`);
    else if ((info?.part === Part.Opening || info?.part === Part.Frame) && info.line !== this.line) {
      this.warn(`${what} überschneidet sich bei ${where()} mit Zeile ${info.line}.`);
      this.reported.add(pack3(p[0], p[1], p[2]));
    }
    return p;
  }

  /** Lintel, reveal and door frame cells: only where the wall has a block, and not in posts, beams, braces or roofs. */
  framePut(p: Vec3 | null, ref: RoleRef, member: Member, props: Record<string, string> | null, axis: 'x' | 'y' | 'z'): void {
    if (!p || !this.grid.has(p[0], p[1], p[2])) return;
    const part = this.grid.cellInfo(p[0], p[1], p[2])?.part;
    if (part === Part.Structure || part === Part.Beam || part === Part.Roof || part === Part.Strut) return;
    this.place(p, ref, member, props, Part.Frame, axis);
  }

  outside(p: Vec3, side: Facing): Vec3 {
    const [dx, dz] = DIR[side];
    return [p[0] + dx, p[1], p[2] + dz];
  }

  /** Sills and shutters (as version 1): only into air, one hint per blocked cell. Returns whether it was placed. */
  attach(p: Vec3, ref: RoleRef, member: Member, props: Record<string, string> | null, what: string): boolean {
    const info = this.grid.cellInfo(p[0], p[1], p[2]);
    if (info) {
      if (info.part !== Part.Attachment || info.line !== this.line) this.warn(`${what} bei ${p.join(',')} stößt an einen Block (Zeile ${info.line}) und fehlt dort.`);
      return false;
    }
    this.place(p, ref, member, props, Part.Attachment);
    return true;
  }

  /** Like attach, for a Block-Angabe. */
  attachSpec(p: Vec3, spec: BlockSpec, what: string): boolean {
    const info = this.grid.cellInfo(p[0], p[1], p[2]);
    if (info) {
      if (info.part !== Part.Attachment || info.line !== this.line) this.warn(`${what} bei ${p.join(',')} stößt an einen Block (Zeile ${info.line}) und fehlt dort.`);
      return false;
    }
    this.placeSpec(p, spec, Part.Attachment);
    return true;
  }

  /**
   * Anbauten outside the wall (6.5) and other outside parts: only into air. Where something is
   * in the way it stays; the statement gets one hint per obstacle line. Cells of the statement
   * itself may be replaced. Returns whether the block was placed.
   */
  outPlace(p: readonly number[], ref: RoleRef, member: Member, props: Record<string, string> | null, part: Part, axis: 'x' | 'y' | 'z' | undefined, what: string): boolean {
    if (!this.outFree(p, what)) return false;
    this.place(p, ref, member, props, part, axis);
    return true;
  }

  /** Like outPlace, for a state index. */
  outPut(p: readonly number[], sid: number, what: string, part: Part = Part.Attachment): boolean {
    if (!this.outFree(p, what)) return false;
    this.put(p[0], p[1], p[2], sid, part);
    return true;
  }

  /** Like outPlace, for a Block-Angabe. */
  outPlaceSpec(p: readonly number[], spec: BlockSpec, part: Part, what: string): boolean {
    if (!this.outFree(p, what)) return false;
    this.placeSpec(p, spec, part);
    return true;
  }

  /** Whether an outside cell is free (or the statement's own); records the obstacle otherwise. */
  outFree(p: readonly number[], what: string): boolean {
    const v = this.grid.infoAt(p[0], p[1], p[2]);
    if (v === 0) return true;
    const o = infoOrigin(v);
    if (o === this.origin) return true;
    const line = this.grid.origins[o]?.line ?? 0;
    this.note(`block|${what}|${line}`, this.line, (n, q) => `${what} stößt bei ${q.join(',')}${n > 1 ? ` und ${n - 1} weiteren Stellen` : ''} an Blöcke aus Zeile ${line} und fehlt dort.`, [p[0], p[1], p[2]]);
    return false;
  }

  bauteilForm(a: Args): FormObj {
    const f = this.form(a.word1('Die Form (Name einer Form)'));
    if (f.kind === 'kugel') throw new TessError(this.line, 'An einer kugel hängen keine Bauteile.');
    return f;
  }

  /** erlaube schweben (11): no floating check for the file. */
  allowCmd(st: Statement): void {
    const a = new Args(st, this.tokens(st), []);
    const what = asciiKey(a.word1('Was erlaubt wird (schweben)'));
    a.done();
    if (what !== 'schweben') throw new TessError(st.line, `„erlaube ${what}“ gibt es nicht; möglich ist „erlaube schweben“.`);
    this.allowFloating = true;
  }

  // ---- roofs

  roof(st: Statement): void {
    const a = new Args(st, this.tokens(st), ROOF_KEYS, ['fuellen']);
    const typeWord = asciiKey(a.word1('Die Dachform (sattel, pult, krueppelwalm, walm, zelt, kegel, helm oder flach)'));
    const f = this.form(a.word1('Die Form'));
    a.done();
    if (f.annex) throw new TessError(st.line, `„${f.name}“ ist ein Erker; sein Dach legt „erker … dach=“ fest.`);
    this.roofOn(a, f, typeWord);
  }

  /** Arguments made up from key=value pairs (roofs of turrets and oriels use the roof options). */
  synthArgs(pairs: Record<string, string | undefined>, keys: readonly string[] = ROOF_KEYS, flags: readonly string[] = ['fuellen']): Args {
    const st: Statement = { line: this.line, cmd: 'dach', args: [] };
    const tokens: Token[] = [];
    for (const [k, v] of Object.entries(pairs)) if (v !== undefined) tokens.push(classify(`${k}=${v}`, 0, this.line, 2));
    return new Args(st, tokens, keys, flags);
  }

  /** A roof of a type on a form, with the options of `dach` (5). */
  roofOn(a: Args, f: FormObj, typeWord: string, opts: { keep?: (x: number, z: number) => boolean; tag?: string } = {}): RoofDef | null {
    const st = { line: a.line };
    const types = ['sattel', 'pult', 'krueppelwalm', 'walm', 'zelt', 'kegel', 'helm', 'flach'];
    if (!types.includes(typeWord)) throw new TessError(st.line, `„${typeWord}“ ist keine Dachform. Möglich: ${types.join(', ')}.`);
    const role = this.ref(a.str('rolle') ?? 'dach');
    const over = a.int('ueberstand', 1, 0, 16);
    const only = (key: string, allowed: string[]) => {
      if (a.has(key) && !allowed.includes(typeWord)) throw new TessError(st.line, `„${key}=“ gilt nur bei ${allowed.map((t) => `dach ${t}`).join(', ')}.`);
    };
    only('first', ['sattel', 'krueppelwalm']);
    only('giebel', ['sattel', 'krueppelwalm', 'pult']);
    only('kante', ['sattel', 'krueppelwalm', 'pult']);
    only('kruppel', ['krueppelwalm']);
    only('hoch', ['pult']);
    only('biegung', ['walm', 'zelt', 'kegel', 'helm']);
    only('rand', ['flach']);
    only('art', ['flach']);
    if (typeWord === 'flach') {
      for (const k of ['profil', 'steil', 'dicke', 'spitze', 'firstzier', 'traufe']) if (a.has(k)) throw new TessError(st.line, `„${k}=“ gibt es beim Flachdach nicht.`);
      if (a.flag('fuellen')) throw new TessError(st.line, '„fuellen“ gibt es beim Flachdach nicht.');
      this.flatRoof(a, f, role, over, opts.keep, opts.tag ? this.taggedOrigin(opts.tag) : undefined);
      return null;
    }
    const type = typeWord as RoofType;
    if ((type === 'sattel' || type === 'pult' || type === 'krueppelwalm') && f.kind !== 'box') {
      throw new TessError(st.line, `Ein ${type === 'krueppelwalm' ? 'Krüppelwalm' : type === 'pult' ? 'Pult' : 'Sattel'}dach braucht eine box; für „${f.name}“ (${f.kind}) nimm walm, kegel oder helm.`);
    }
    if ((type === 'walm' || type === 'zelt' || type === 'kegel') && f.kind === 'kugel') throw new TessError(st.line, `Ein ${type}dach geht nicht auf einer kugel; nimm helm oder flach.`);
    if (a.has('profil') && a.has('steil')) throw new TessError(st.line, '„profil=“ und „steil=“ schließen sich aus („steil=k“ ist „profil=1/k“).');
    const defaults: Record<RoofType, string> = { sattel: '1/1', pult: '1/1', krueppelwalm: '1/1', walm: '1/1', zelt: '1/1', kegel: '1/2', helm: '1/3' };
    let profile: RoofProfile;
    if (a.has('profil')) {
      const pv = asciiKey(a.str('profil')!);
      if (pv === 'mansard' && type !== 'sattel' && type !== 'walm') throw new TessError(st.line, '„profil=mansard“ gilt nur bei dach sattel und dach walm.');
      if (pv === 'zwiebel' && !['walm', 'kegel', 'helm'].includes(type)) throw new TessError(st.line, '„profil=zwiebel“ gilt nur bei dach walm, kegel und helm.');
      if (pv === 'kuppel' && !['walm', 'kegel'].includes(type)) throw new TessError(st.line, '„profil=kuppel“ gilt nur bei dach walm und kegel.');
      profile = parseRoofProfile(a.str('profil')!, st.line);
    } else if (a.has('steil')) profile = { kind: 'list', elems: [{ dx: 1, dy: a.int('steil', 1, 1, 16) }] };
    else profile = parseRoofProfile(defaults[type], st.line);
    const plain11 = profile.kind === 'list' && profile.elems.length === 1 && profile.elems[0].dx === 1 && profile.elems[0].dy === 1;
    const kanteArg = a.str('kante');
    const kante = (type === 'sattel' || type === 'krueppelwalm' || type === 'pult') && (kanteArg === undefined ? over >= 1 && plain11 : !NO.has(kanteArg.toLowerCase()));
    if (kanteArg !== undefined && !NO.has(kanteArg.toLowerCase()) && !YES.has(kanteArg.toLowerCase())) throw new TessError(st.line, `„kante=${kanteArg}“: ja oder nein.`);
    const traufeArg = asciiKey(a.str('traufe') ?? 'keine');
    if (!['treppe', 'stufe', 'keine'].includes(traufeArg)) throw new TessError(st.line, `„traufe=${traufeArg}“: möglich sind treppe, stufe und keine.`);
    const dicke = a.int('dicke', 1, 1, 8);
    const giebel = a.str('giebel') ? this.ref(a.str('giebel')!) : f.role;
    const firstzier = a.str('firstzier') ? this.palette.blockSpec(a.str('firstzier')!, st.line) : null;
    const spitze = a.str('spitze') ? this.palette.blockSpec(a.str('spitze')!, st.line) : null;
    const name = a.str('name') ? asciiKey(a.str('name')!) : null;
    if (name && (this.forms.has(name) || this.roofObjs.has(name))) {
      const prev = this.forms.get(name) ?? this.roofObjs.get(name)!;
      throw new TessError(st.line, `Den Namen „${name}“ gibt es schon (Zeile ${prev.line}).`);
    }
    if (type !== 'krueppelwalm' && a.has('kruppel')) throw new TessError(st.line, '„kruppel=“ gilt nur beim Krüppelwalm.');
    if (type === 'pult' && !a.has('hoch')) throw new TessError(st.line, 'Beim Pultdach fehlt „hoch=<seite>“: die Seite, zu der das Dach ansteigt.');

    const def = this.roofDef(a, f, type, profile, over, kante, traufeArg === 'keine' ? null : (traufeArg as 'treppe' | 'stufe'), dicke, a.flag('fuellen'), !!firstzier, !!spitze);
    const extra: RoofExtra = { role, giebel, firstzier, spitze, form: f, line: st.line };
    if (opts.keep) def.keep = opts.keep;
    if (opts.tag) def.origin = this.taggedOrigin(opts.tag);
    this.addRoof(def, extra);
    f.roofs.push(def);
    f.roofTop = Math.max(f.roofTop ?? -Infinity, def.yb + def.layers.length - 1);
    if (name) {
      let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
      for (const l of def.layers) {
        if (l.isEmpty()) continue;
        bx0 = Math.min(bx0, l.x0);
        bz0 = Math.min(bz0, l.z0);
        bx1 = Math.max(bx1, l.x1);
        bz1 = Math.max(bz1, l.z1);
      }
      const top = def.yb + def.layers.length - 1;
      this.roofObjs.set(name, { name, line: st.line, bbox: [bx0, def.yb, bz0, bx1, top, bz1], top });
    }
    return def;
  }

  /** Layer outlines of one roof (before uniting). */
  roofDef(
    a: Args,
    f: FormObj,
    type: RoofType,
    profile: RoofProfile,
    over: number,
    kante: boolean,
    traufe: 'treppe' | 'stufe' | null,
    dicke: number,
    fuellen: boolean,
    deco: boolean,
    tip: boolean,
  ): RoofDef {
    const yb = f.y1 + 1;
    const top = this.outlineAt(f, f.y1);
    const vTop = this.offsetAt(f, f.y1);
    let at: (a: number, b: number) => CellSet;
    // Gable roofs: outline with separate insets at the two gable ends (Krüppelwalm hips).
    let atEnds: ((a: number, b0: number, b1: number) => CellSet) | null = null;
    let radius: number;
    let crossAxis: 'x' | 'z' | null = null;
    let dirsNormal = 15;
    let base: CellSet;
    const gables: GableWall[] = [];
    const verge: RoofDef['verge'] = [];
    if (f.kind === 'box') {
      const [x0, z0, x1, z1] = [top.x0, top.z0, top.x1, top.z1];
      const [xa, za, xb, zb] = [x0 - over, z0 - over, x1 + over, z1 + over];
      radius = Math.floor((Math.min(xb - xa, zb - za) + 1 - 1) / 2);
      if (type === 'sattel' || type === 'krueppelwalm') {
        const ridgeArg = a.str('first')?.toLowerCase();
        if (ridgeArg && ridgeArg !== 'x' && ridgeArg !== 'z') throw new TessError(this.line, '„first=“ ist x oder z (Richtung des Dachfirsts).');
        const ridge = (ridgeArg ?? (x1 - x0 >= z1 - z0 ? 'x' : 'z')) as 'x' | 'z';
        crossAxis = ridge === 'x' ? 'z' : 'x';
        if (ridge === 'x') {
          const ends = (i: number, b0: number, b1: number) => CellSet.rect(xa + b0, za + i, xb - b1, zb - i);
          atEnds = ends;
          at = (i, b) => ends(i, b, b);
          dirsNormal = 1 | 4;
          gables.push({ axis: 'z', fixed: x0, lo: z0, hi: z1, out: 'west' }, { axis: 'z', fixed: x1, lo: z0, hi: z1, out: 'east' });
          verge.push({ axis: 'x', at: xa, towards: 'east' }, { axis: 'x', at: xb, towards: 'west' });
          radius = Math.floor((zb - za) / 2);
        } else {
          const ends = (i: number, b0: number, b1: number) => CellSet.rect(xa + i, za + b0, xb - i, zb - b1);
          atEnds = ends;
          at = (i, b) => ends(i, b, b);
          dirsNormal = 2 | 8;
          gables.push({ axis: 'x', fixed: z0, lo: x0, hi: x1, out: 'north' }, { axis: 'x', fixed: z1, lo: x0, hi: x1, out: 'south' });
          verge.push({ axis: 'z', at: za, towards: 'south' }, { axis: 'z', at: zb, towards: 'north' });
          radius = Math.floor((xb - xa) / 2);
        }
      } else if (type === 'pult') {
        const hoch = parseSide(asciiKey(a.str('hoch')!));
        if (!hoch) throw new TessError(this.line, `„hoch=${a.str('hoch')}“ ist keine Seite (n, o, s oder w).`);
        crossAxis = axisOf(hoch) === 'x' ? 'x' : 'z';
        if (hoch === 'north') {
          at = (i) => CellSet.rect(xa, za, xb, zb - i);
          dirsNormal = 4;
          radius = zb - za;
          gables.push({ axis: 'z', fixed: x0, lo: z0, hi: z1, out: 'west' }, { axis: 'z', fixed: x1, lo: z0, hi: z1, out: 'east' }, { axis: 'x', fixed: z0, lo: x0, hi: x1, out: 'north' });
          verge.push({ axis: 'x', at: xa, towards: 'east' }, { axis: 'x', at: xb, towards: 'west' });
        } else if (hoch === 'south') {
          at = (i) => CellSet.rect(xa, za + i, xb, zb);
          dirsNormal = 1;
          radius = zb - za;
          gables.push({ axis: 'z', fixed: x0, lo: z0, hi: z1, out: 'west' }, { axis: 'z', fixed: x1, lo: z0, hi: z1, out: 'east' }, { axis: 'x', fixed: z1, lo: x0, hi: x1, out: 'south' });
          verge.push({ axis: 'x', at: xa, towards: 'east' }, { axis: 'x', at: xb, towards: 'west' });
        } else if (hoch === 'east') {
          at = (i) => CellSet.rect(xa + i, za, xb, zb);
          dirsNormal = 8;
          radius = xb - xa;
          gables.push({ axis: 'x', fixed: z0, lo: x0, hi: x1, out: 'north' }, { axis: 'x', fixed: z1, lo: x0, hi: x1, out: 'south' }, { axis: 'z', fixed: x1, lo: z0, hi: z1, out: 'east' });
          verge.push({ axis: 'z', at: za, towards: 'south' }, { axis: 'z', at: zb, towards: 'north' });
        } else {
          at = (i) => CellSet.rect(xa, za, xb - i, zb);
          dirsNormal = 2;
          radius = xb - xa;
          gables.push({ axis: 'x', fixed: z0, lo: x0, hi: x1, out: 'north' }, { axis: 'x', fixed: z1, lo: x0, hi: x1, out: 'south' }, { axis: 'z', fixed: x0, lo: z0, hi: z1, out: 'west' });
          verge.push({ axis: 'z', at: za, towards: 'south' }, { axis: 'z', at: zb, towards: 'north' });
        }
      } else {
        at = (i) => CellSet.rect(xa + i, za + i, xb - i, zb - i);
      }
      base = CellSet.rect(xa, za, xb, zb);
    } else if (f.shape instanceof DiscShape || f.shape instanceof PolygonShape) {
      const shape = f.shape;
      const v0 = vTop + over;
      at = (i) => shape.outline(v0 - i);
      radius = (shape instanceof DiscShape ? shape.radius : shape.r) + v0;
      base = shape.outline(v0);
    } else {
      const F = top.dilate(over);
      at = (i) => (i >= 0 ? F.erode(i) : F.dilate(-i));
      radius = F.depth();
      base = F;
    }
    // Layers.
    const MAX = 400;
    let layers: CellSet[] = [];
    const insets: number[] = [];
    for (let y = 0; y <= MAX; y++) {
      if (y === MAX) throw new TessError(this.line, 'Das Dach schließt sich nicht: Das Profil muss nach innen ziehen (dx > 0).');
      const i = insetAt(profile, y, radius);
      if (i === null) break;
      const O = at(i, 0);
      if (O.isEmpty()) break;
      if (O.count > 4_000_000) throw new TessError(this.line, 'Das Dach wird zu groß (das Profil zieht nach außen).');
      layers.push(O);
      insets.push(i);
    }
    if (!layers.length) throw new TessError(this.line, 'Das Dach hat keine einzige Lage.');
    let dirs = layers.map(() => dirsNormal);
    let hip: HipEnds | undefined;
    if (type === 'krueppelwalm' && atEnds) {
      const K = layers.length - 1;
      const n = a.int('kruppel', 2, 1, 64);
      if (K >= 1) {
        // The hip takes the top n layers: from layer yh on, the gable ends move inwards by as
        // much as the eaves have moved since layer yh-1.
        const yh = Math.max(1, K - n + 1);
        const aRef = insets[yh - 1];
        const ends = [gables[0], gables[1]] as const;
        const cut = atEnds;
        const variant = (first: boolean, second: boolean) => {
          const out: CellSet[] = [];
          for (let y = 0; y < insets.length; y++) {
            const b = y >= yh ? insets[y] - aRef : 0;
            const O = cut(insets[y], first ? b : 0, second ? b : 0);
            if (O.isEmpty()) break;
            out.push(O);
          }
          const bits = dirsNormal | (first ? sideBit(ends[0].out) : 0) | (second ? sideBit(ends[1].out) : 0);
          return { layers: out, dirs: out.map((_, y) => (y >= yh ? bits : dirsNormal)) };
        };
        const v = variant(true, true);
        layers = v.layers;
        dirs = v.dirs;
        hip = { from: yh, ends, variant };
      }
    }
    if (a.has('biegung')) {
      const m = /^([a-zäöüß]+):(-?\d+)$/i.exec(a.str('biegung')!.trim());
      if (!m) throw new TessError(this.line, `„biegung=${a.str('biegung')}“ hat die Form Seite:n, z. B. biegung=n:3.`);
      const vec = bendVector(asciiKey(m[1]));
      if (!vec) throw new TessError(this.line, `„biegung=${a.str('biegung')}“: „${m[1]}“ ist keine Seite (n, no, o, so, s, sw, w, nw).`);
      const n = parseInt(m[2], 10);
      const K = layers.length - 1;
      if (K > 0) {
        layers = layers.map((O, y) => {
          const u = y / K;
          const s = n * Math.max(0, 3 * u - 2) ** 2;
          return O.shift(roundHalfAway(s * vec[0]), roundHalfAway(s * vec[1]));
        });
      }
    }
    const index = this.roofCount++;
    return {
      index,
      type,
      origin: this.origin,
      seq: this.seq,
      yb,
      layers,
      dirs,
      crossAxis,
      base,
      wall: top,
      gables,
      verge,
      kante,
      traufe,
      dicke,
      fuellen,
      hasRidgeDeco: deco,
      hasTip: tip,
      hip,
    };
  }

  /** Adds a roof: unites it with every group whose base area it overlaps or touches. */
  addRoof(def: RoofDef, extra: RoofExtra): void {
    const touching = this.groups.filter((g) => g.roofs.some((r) => touches(r.base, def.base)));
    const group: RoofGroup = { roofs: [], extra: [], placed: [], kept: new Map() };
    for (const g of touching) {
      group.roofs.push(...g.roofs);
      group.extra.push(...g.extra);
      group.placed.push(...g.placed);
      for (const [k, s] of g.kept) group.kept.set(k, s);
      this.groups.splice(this.groups.indexOf(g), 1);
    }
    group.roofs.push(def);
    group.extra.push(extra);
    // Keep the order of the statements: the earliest roof owns shared cells.
    const order = group.roofs.map((_, i) => i).sort((p, q) => group.roofs[p].seq - group.roofs[q].seq);
    group.roofs = order.map((i) => group.roofs[i]);
    group.extra = order.map((i) => group.extra[i]);
    this.groups.push(group);
    this.renderGroup(group);
  }

  renderGroup(g: RoofGroup): void {
    const origins = new Set(g.roofs.map((r) => r.origin));
    const firstSeq = Math.min(...g.roofs.map((r) => r.seq));
    // Remove what the group placed before, where nothing else has replaced or cleared it since;
    // such cells stay as the later statements left them.
    for (const k of g.placed) {
      const [x, y, z] = unpack3(k);
      if (origins.has(this.grid.originAt(x, y, z))) this.grid.clear(x, y, z);
      else if (!g.kept.has(k)) g.kept.set(k, this.seq);
    }
    g.placed = [];
    const { blocks, tips } = renderRoofs(g.roofs);
    const savedLine = this.line;
    for (const b of blocks) {
      const r = g.roofs[b.roof];
      const ex = g.extra[b.roof];
      if (r.keep && !r.keep(b.x, b.z)) continue;
      this.line = ex.line;
      const o = this.grid.originAt(b.x, b.y, b.z);
      if (o && !origins.has(o) && (this.originSeq[o] ?? 0) > firstSeq) continue; // placed between the roofs: stays
      const since = g.kept.get(pack3(b.x, b.y, b.z));
      if (since !== undefined && !g.roofs.some((q, i) => q.seq >= since && (i === b.roof || layerOf(q, b.y).has(b.x, b.z)))) continue;
      const onlyEmpty = b.kind === 'gable' || b.kind === 'verge' || b.kind === 'eave' || b.kind === 'deco' || b.kind === 'spire';
      if (onlyEmpty && o) continue;
      const p = [b.x, b.y, b.z];
      switch (b.kind) {
        case 'stair':
        case 'ridgeStair':
          this.place(p, ex.role, 'stairs', { facing: b.facing!, half: 'bottom' }, Part.Roof, undefined, r.origin);
          break;
        case 'belly':
        case 'verge':
          this.place(p, ex.role, 'stairs', { facing: b.facing!, half: 'top' }, Part.Roof, undefined, r.origin);
          break;
        case 'slab':
        case 'ridge':
          this.place(p, ex.role, 'slab', { type: 'bottom' }, Part.Roof, undefined, r.origin);
          break;
        case 'full':
        case 'tip':
          this.place(p, ex.role, 'block', null, Part.Roof, 'y', r.origin);
          break;
        case 'gable':
          this.place(p, ex.giebel, ex.giebel.member, null, Part.Plain, 'y', r.origin);
          break;
        case 'eave':
          if (b.slab) this.place(p, ex.role, 'slab', { type: 'top' }, Part.Roof, undefined, r.origin);
          else this.place(p, ex.role, 'stairs', { facing: b.facing!, half: 'top' }, Part.Roof, undefined, r.origin);
          break;
        case 'deco':
          this.placeSpec(p, ex.firstzier!, Part.Roof, r.origin);
          break;
        case 'spire':
          this.placeSpec(p, ex.spitze!, Part.Roof, r.origin);
          break;
      }
      g.placed.push(pack3(b.x, b.y, b.z));
    }
    this.line = savedLine;
    // Spires on roofs that end in a ridge: say so once, on the roof's own line.
    const last = g.roofs.length - 1;
    if (g.extra[last].spitze && !tips[last]) this.warn('„spitze=“: Das Dach endet in einem First, nicht in einer Spitze; die Spitze fehlt.', g.extra[last].line);
  }

  /** dach flach: one layer over the outline plus overhang, optionally a ring on top. */
  flatRoof(a: Args, f: FormObj, role: RoleRef, over: number, keep?: (x: number, z: number) => boolean, origin?: number): void {
    const art = asciiKey(a.str('art') ?? 'block');
    if (art !== 'block' && art !== 'stufe') throw new TessError(this.line, `„art=${art}“: block oder stufe.`);
    const rand = this.optRef(a, 'rand');
    const top = this.outlineAt(f, f.y1);
    let F = f.kind === 'box' ? CellSet.rect(top.x0 - over, top.z0 - over, top.x1 + over, top.z1 + over) : top.dilate(over);
    // Oriels: only the part in front of the main wall.
    if (keep) F = CellSet.build(F.x0, F.z0, F.x1, F.z1, (x, z) => F.has(x, z) && keep(x, z));
    const y = f.y1 + 1;
    F.forEach((x, z) => {
      if (art === 'stufe') this.place([x, y, z], role, 'slab', { type: 'bottom' }, Part.Roof, undefined, origin);
      else this.place([x, y, z], role, role.member, null, Part.Roof, 'y', origin);
    });
    if (rand) {
      F.forEach((x, z) => {
        const rim = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !F.has(x + dx, z + dz) && (!keep || keep(x + dx, z + dz)));
        if (rim) this.place([x, y + 1, z], rand, rand.member, null, Part.Roof, 'y', origin);
      });
    }
    f.roofTop = Math.max(f.roofTop ?? -Infinity, rand ? y + 1 : y);
  }

  /** kranzdach <form> y= [breite=2] [profil=|steil=] [rolle=dach] [kante=ja|nein] */
  skirt(st: Statement): void {
    const a = new Args(st, this.tokens(st), ['y', 'breite', 'profil', 'steil', 'rolle', 'kante']);
    const f = this.bauteilForm(a);
    a.done();
    const y = a.requireInt('y', -LIMIT_V2, LIMIT_V2, 'Die Lage, in der die Schürze an der Wand ansetzt (absolut).');
    if (y < f.y0 || y > f.y1) throw new TessError(st.line, `„y=${y}“ liegt nicht in „${f.name}“ (y=${f.y0} bis ${f.y1}).`);
    const breite = a.int('breite', 2, 1, 16);
    if (a.has('profil') && a.has('steil')) throw new TessError(st.line, '„profil=“ und „steil=“ schließen sich aus.');
    const profile: RoofProfile = a.has('profil')
      ? parseRoofProfile(a.str('profil')!, st.line)
      : { kind: 'list', elems: [{ dx: 1, dy: a.int('steil', 1, 1, 16) }] };
    const role = this.ref(a.str('rolle') ?? 'dach');
    const kv = a.str('kante');
    if (kv !== undefined && !NO.has(kv.toLowerCase()) && !YES.has(kv.toLowerCase())) throw new TessError(st.line, `„kante=${kv}“: ja oder nein.`);
    const kante = kv !== undefined && YES.has(kv.toLowerCase());
    this.buildSkirt(f, y, breite, profile, role, kante, 'Das Kranzdach');
  }

  /** Ring roof outside a form at layer y (kranzdach; umgang with dach=). */
  buildSkirt(f: FormObj, y: number, breite: number, profile: RoofProfile, role: RoleRef, kante: boolean, what: string, wall = this.outlineAt(f, y)): void {
    let blocks: ReturnType<typeof renderSkirt>;
    try {
      blocks = renderSkirt(wall, breite, profile, kante);
    } catch (e) {
      if (e instanceof TessError) throw new TessError(this.line, e.message);
      throw e;
    }
    let hitWindow = 0;
    const isWindow = (x: number, yy: number, z: number) => {
      const i = this.grid.cellInfo(x, yy, z);
      return !!i && (i.part === Part.Opening || i.part === Part.Frame || i.part === Part.Attachment);
    };
    for (const b of blocks) {
      const Y = y + b.k;
      if (Y >= f.y0 && Y <= f.y1 && this.outlineAt(f, Y).has(b.x, b.z)) continue;
      if (isWindow(b.x, Y, b.z)) {
        hitWindow++;
        continue;
      }
      // Right in front of a window or door: still only air, but say so.
      if (SIDES.some((s) => isWindow(b.x + s.dx, Y, b.z + s.dz))) hitWindow++;
      const info = this.grid.cellInfo(b.x, Y, b.z);
      if (b.kind === 'verge' && info) continue;
      const p = [b.x, Y, b.z];
      if (b.kind === 'stair') this.place(p, role, 'stairs', { facing: b.facing!, half: 'bottom' }, Part.Roof);
      else if (b.kind === 'belly' || b.kind === 'verge') this.place(p, role, 'stairs', { facing: b.facing!, half: 'top' }, Part.Roof);
      else if (b.kind === 'slab') this.place(p, role, 'slab', { type: 'bottom' }, Part.Roof);
      else this.place(p, role, 'block', null, Part.Roof, 'y');
    }
    if (hitWindow) this.warn(`${what} trifft an ${hitWindow} Stelle(n) auf Fenster oder Türen; dort setzt es nur in Luft.`);
  }
}

// ---------------------------------------------------------------------------

function packXZ(x: number, z: number): number {
  return (x + 8192) * 16384 + (z + 8192);
}

function pack3(x: number, y: number, z: number): number {
  return ((x + 8192) * 16384 + (y + 8192)) * 16384 + (z + 8192);
}

function unpack3(k: number): [number, number, number] {
  const z = (k % 16384) - 8192;
  const r = Math.floor(k / 16384);
  const y = (r % 16384) - 8192;
  const x = Math.floor(r / 16384) - 8192;
  return [x, y, z];
}

function roundHalfAway(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

/** Unit vector of a side for bending (diagonals at 45°). */
function bendVector(word: string): [number, number] | null {
  const s = Math.SQRT1_2;
  const map: Record<string, [number, number]> = {
    n: [0, -1],
    nord: [0, -1],
    o: [1, 0],
    ost: [1, 0],
    s: [0, 1],
    sued: [0, 1],
    w: [-1, 0],
    west: [-1, 0],
    no: [s, -s],
    nordost: [s, -s],
    so: [s, s],
    suedost: [s, s],
    sw: [-s, s],
    suedwest: [-s, s],
    nw: [-s, -s],
    nordwest: [-s, -s],
  };
  return map[word] ?? null;
}

/** Overlap or side contact of two base areas. */
function touches(a: CellSet, b: CellSet): boolean {
  if (a.isEmpty() || b.isEmpty()) return false;
  if (a.x1 + 1 < b.x0 || b.x1 + 1 < a.x0 || a.z1 + 1 < b.z0 || b.z1 + 1 < a.z0) return false;
  let hit = false;
  a.forEach((x, z) => {
    if (hit) return;
    if (b.has(x, z)) hit = true;
    else for (const s of SIDES) if (b.has(x + s.dx, z + s.dz)) hit = true;
  });
  return hit;
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
  c.run(statements);
  connectBlocks(c.grid, 2);
  const found = [...diagnostics, ...c.diagnostics];
  // Checks of section 11 on the finished grid (only when the file has no errors).
  if (!found.some((d) => d.level === 'error')) found.push(...runChecks(c.grid, { floating: !c.allowFloating, label: (l) => `Zeile ${l}` }));
  const all = found.sort((a, b) => a.line - b.line);
  if (c.grid.size === 0 && !all.some((d) => d.level === 'error')) all.push({ line: 1, level: 'warn', message: 'Der Bauplan erzeugt keinen einzigen Block.' });
  return { name: c.name, grid: c.grid, diagnostics: all, statements: statements.length, version: 2, lineTexts: c.lineTexts };
}
