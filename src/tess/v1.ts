import { makeState, parseBlockState, type BlockState } from '../core/blockstate';
import { connectBlocks, hasAxis } from './connect';
import {
  axisOf,
  ccw,
  DIR,
  discCells,
  facingTowards,
  inDisc,
  lineCells,
  opposite,
  parseSide,
  ringByAngle,
  ringCells,
  sideLabel,
  type Facing,
} from './geometry';
import { Grid, LIMIT, Part } from './grid';
import { Palette, type BlockHints, type Member, type Role } from './palette';
import { asciiKey, FollowUpError, parseStatements, TessError, tokenText, type Diagnostic, type Statement, type Token } from './syntax';

/**
 * Compiler for Bau-Sprache 1 (Etappe 3), kept as it was in version 0.3.0: `tess 1` files must
 * give exactly the same blocks. Only the storage (chunked grid), the origin of each block and
 * some error messages (hints towards `tess 2`) are new. Do not change the building logic here;
 * new behaviour belongs to Bau-Sprache 2 (compile.ts).
 *
 * Statements run top to bottom; later ones overwrite earlier blocks (a window cuts into its
 * wall). Each statement that fails becomes an error with its line number and the rest of the
 * file still compiles, so one report lists every problem. Bauteile (windows, doors, roofs,
 * crenellations) attach to a named box or cylinder and work out positions and orientations
 * themselves; that is the main guard against misplaced blocks.
 */

/** Commands that exist only in Bau-Sprache 2: in a tess 1 file they point to `tess 2`. */
const V2_COMMANDS = new Set(
  'wert vieleck umriss grundriss kugel kranzdach tor gesims pfeiler strebe balkon umgang erker gaube ecktuerme bogen treppe wendeltreppe wandlaterne haengelaterne banner efeu bewuchs laub streue feld zeichen ebene ebenen ansicht modul baue wiederhole spiegle ende abschnitt ausrichtung erlaube'.split(
    ' ',
  ),
);

/** Keys that exist only in Bau-Sprache 2. */
const V2_KEYS = new Set(
  'wand zonen profil konsolen riegel muster streben schraeg d rx rz n drehung punkte name dicke fuellen kruppel hoch biegung firstzier traufe rand'.split(' '),
);

export interface CompileOutputV1 {
  /** Name from `projekt "…"`. */
  name: string | null;
  grid: Grid;
  diagnostics: Diagnostic[];
  statements: number;
}

type Vec3 = [number, number, number];

interface BoxObj {
  kind: 'box';
  name: string;
  line: number;
  min: Vec3;
  max: Vec3;
  role: Role;
  hollow: boolean;
}

interface CylObj {
  kind: 'zylinder';
  name: string;
  line: number;
  cx: number;
  cz: number;
  y0: number;
  y1: number;
  r: number;
  role: Role;
  hollow: boolean;
}

type Obj = BoxObj | CylObj;

/** One side of a box or cylinder, as Bauteile see it. */
interface Face {
  side: Facing;
  /** Coordinate that runs along the wall. */
  axis: 'x' | 'z';
  tMin: number;
  tMax: number;
  /** Wall cell at position t along the wall and height y, null if the wall has no cell there. */
  cell(t: number, y: number): Vec3 | null;
  /** Box corners (positions where two walls meet). */
  isCorner(t: number): boolean;
}

// ---------------------------------------------------------------------------
// Argument reading

class Args {
  readonly positional: Token[] = [];
  private readonly pairs = new Map<string, Token & { kind: 'pair' }>();
  private readonly flags = new Set<string>();
  private next = 0;

  constructor(
    private readonly st: Statement,
    allowedKeys: readonly string[],
    allowedFlags: readonly string[] = [],
  ) {
    for (const t of st.args) {
      if (t.kind === 'pair') {
        if (!allowedKeys.includes(t.key)) {
          const allowed = allowedKeys.length ? allowedKeys.map((k) => `${k}=`).join(', ') : 'keine';
          const v2 = V2_KEYS.has(t.key) ? ' Mit „tess 2“ in der ersten Zeile gibt es mehr Angaben.' : '';
          throw new TessError(st.line, `„${t.key}=“ gibt es bei „${st.cmd}“ nicht (erlaubt: ${allowed}).${v2}`);
        }
        if (this.pairs.has(t.key)) throw new TessError(st.line, `„${t.key}=“ steht doppelt.`);
        this.pairs.set(t.key, t);
      } else if (t.kind === 'word' && allowedFlags.includes(t.text.toLowerCase())) {
        this.flags.add(t.text.toLowerCase());
      } else {
        this.positional.push(t);
      }
    }
  }

  flag(name: string): boolean {
    return this.flags.has(name);
  }

  has(key: string): boolean {
    return this.pairs.has(key);
  }

  str(key: string): string | undefined {
    return this.pairs.get(key)?.value;
  }

  int(key: string, def: number, min = -Infinity, max = Infinity): number {
    const raw = this.pairs.get(key)?.value;
    if (raw === undefined) return def;
    if (!/^-?\d+$/.test(raw)) throw new TessError(this.st.line, `„${key}=${raw}“: Erwartet wird eine ganze Zahl.`);
    const v = parseInt(raw, 10);
    if (v < min || v > max) throw new TessError(this.st.line, `„${key}=${raw}“: erlaubt ist ${min} bis ${max}.`);
    return v;
  }

  requireInt(key: string, min = -Infinity, max = Infinity, hint = ''): number {
    if (!this.pairs.has(key)) throw new TessError(this.st.line, `Bei „${this.st.cmd}“ fehlt „${key}=“.${hint ? ` ${hint}` : ''}`);
    return this.int(key, 0, min, max);
  }

  /** Optional leading name: a word followed by something that is not a word-only tail. */
  optionalName(): string | null {
    const t = this.positional[this.next];
    const after = this.positional[this.next + 1];
    if (t?.kind === 'word' && after?.kind === 'coord') {
      this.next++;
      return t.text.toLowerCase();
    }
    return null;
  }

  coord(what: string, dims: 2 | 3 = 3): number[] {
    const t = this.positional[this.next];
    if (!t || t.kind !== 'coord' || t.values.length !== dims) {
      const form = dims === 3 ? 'x,y,z' : 'x,z';
      throw new TessError(this.st.line, `${what} fehlt oder ist keine Koordinate ${form}${t ? ` (gefunden: „${tokenText(t)}“)` : ''}.`);
    }
    this.next++;
    return t.values;
  }

  word(what: string): string {
    const t = this.positional[this.next];
    if (!t || t.kind !== 'word') throw new TessError(this.st.line, `${what} fehlt${t ? ` (gefunden: „${tokenText(t)}“)` : ''}.`);
    this.next++;
    return t.text;
  }

  optionalWord(): string | null {
    const t = this.positional[this.next];
    if (t?.kind !== 'word') return null;
    this.next++;
    return t.text;
  }

  done(): void {
    const t = this.positional[this.next];
    if (t) throw new TessError(this.st.line, `„${tokenText(t)}“ ist hier zu viel oder an der falschen Stelle.`);
  }
}

const NO = new Set(['nein', 'aus', 'ohne', '0']);

// ---------------------------------------------------------------------------

class CompilerV1 {
  readonly grid = new Grid(LIMIT);
  readonly palette: Palette;
  readonly diagnostics: Diagnostic[] = [];
  readonly objects = new Map<string, Obj>();
  name: string | null = null;
  private line = 0;
  private readonly unknownReported = new Set<string>();

  constructor(hints: BlockHints | undefined) {
    this.palette = new Palette(hints, 1);
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
      try {
        this.exec(st, st === first);
      } catch (e) {
        if (!(e instanceof TessError)) throw e;
        this.rememberFailure(st);
        if (e instanceof FollowUpError) continue;
        this.diagnostics.push({ line: e.line, level: 'error', message: e.message });
      }
    }
  }

  /** Names defined by a failed line: later lines that use them are follow-up errors. */
  private readonly failedForms = new Map<string, number>();

  private rememberFailure(st: Statement): void {
    const [a0, a1] = st.args;
    if (a0?.kind !== 'word') return;
    if (st.cmd === 'rolle') this.palette.markFailed(a0.text);
    else if ((st.cmd === 'box' || st.cmd === 'zylinder') && a1?.kind === 'coord') this.failedForms.set(a0.text.toLowerCase(), st.line);
  }

  private exec(st: Statement, isFirst: boolean): void {
    switch (st.cmd) {
      case 'tess': {
        if (!isFirst) throw new TessError(st.line, '„tess“ darf nur in der ersten Zeile stehen.');
        const t = st.args[0];
        if (!t || t.kind !== 'number') throw new TessError(st.line, 'Nach „tess“ fehlt die Versionsnummer, also „tess 1“ oder „tess 2“.');
        if (t.value !== 1) throw new TessError(st.line, `Diese Tessera-Version kennt „tess 1“ und „tess 2“, die Datei verlangt „tess ${t.value}“.`);
        return;
      }
      case 'projekt': {
        const parts = st.args.map((t) => (t.kind === 'string' ? t.text : tokenText(t)));
        if (!parts.length) throw new TessError(st.line, 'Nach „projekt“ fehlt der Name, z. B. projekt "Nordturm".');
        this.name = parts.join(' ');
        return;
      }
      case 'samen': {
        const t = st.args[0];
        if (!t || t.kind !== 'number' || st.args.length > 1) throw new TessError(st.line, '„samen“ braucht genau eine ganze Zahl, z. B. „samen 7“.');
        this.palette.seed = t.value;
        return;
      }
      case 'rolle':
        this.palette.define(st);
        return;
      case 'box':
        return this.box(st);
      case 'zylinder':
        return this.cylinder(st);
      case 'linie':
        return this.lineCmd(st);
      case 'block':
        return this.blockCmd(st);
      case 'leer':
        return this.clearCmd(st);
      case 'fenster':
        return this.window(st);
      case 'tuer':
        return this.door(st);
      case 'dach':
        return this.roof(st);
      case 'zinnen':
        return this.crenellations(st);
      default:
        if (V2_COMMANDS.has(st.cmd)) throw new TessError(st.line, `„${st.cmd}“ gibt es erst in Bau-Sprache 2. Schreib „tess 2“ in die erste Zeile.`);
        if (st.cmd.startsWith('|')) throw new TessError(st.line, 'ASCII-Zeichnungen (|…) gibt es erst in Bau-Sprache 2. Schreib „tess 2“ in die erste Zeile.');
        throw new TessError(
          st.line,
          `Unbekannter Befehl „${st.cmd}“. Bekannt sind: tess, projekt, samen, rolle, box, zylinder, linie, block, leer, fenster, tür, dach, zinnen.`,
        );
    }
  }

  // ---- placing

  private stateOf(id: string, props: Record<string, string>, axis?: 'x' | 'y' | 'z'): BlockState {
    if (this.palette.isUnknown(id) && !this.unknownReported.has(id)) {
      this.unknownReported.add(id);
      this.warn(`„${id}“ steht nicht im eingelesenen Katalog.`);
    }
    if (axis && hasAxis(id) && !props.axis) props = { ...props, axis };
    return makeState(id, props);
  }

  private place(p: readonly number[], role: Role, member: Member, props: Record<string, string> = {}, part: Part = Part.Plain, axis?: 'x' | 'y' | 'z'): void {
    const id = this.palette.pick(role, member, p[0], p[1], p[2], this.line);
    this.grid.set(p[0], p[1], p[2], this.stateOf(id, props, axis), part, this.line);
  }

  private optRole(a: Args, key: string): Role | null {
    const v = a.str(key);
    if (v === undefined) return null;
    return this.palette.role(v, this.line);
  }

  private object(name: string, want?: Obj['kind']): Obj {
    const o = this.objects.get(name.toLowerCase());
    const failed = this.failedForms.get(name.toLowerCase());
    if (!o && failed !== undefined) throw new FollowUpError(this.line, `„${name}“ fehlt, weil Zeile ${failed} fehlerhaft ist.`);
    if (!o) {
      const list = [...this.objects.keys()].join(', ') || 'noch keine';
      throw new TessError(this.line, `Es gibt keine Form „${name}“. Bauteile hängen an einer benannten box oder einem zylinder (vorhanden: ${list}).`);
    }
    if (want && o.kind !== want) throw new TessError(this.line, `„${name}“ ist ${o.kind === 'box' ? 'eine box' : 'ein zylinder'}; dieses Bauteil braucht ${want === 'box' ? 'eine box' : 'einen zylinder'}.`);
    return o;
  }

  private register(o: Obj): void {
    const prev = this.objects.get(o.name);
    if (prev) throw new TessError(this.line, `Den Namen „${o.name}“ gibt es schon (Zeile ${prev.line}).`);
    this.objects.set(o.name, o);
  }

  // ---- primitives

  /** box [name] x,y,z x,y,z <rolle> [hohl] [boden= decke= ecken= sockel= kranz= fachwerk= raster=] */
  private box(st: Statement): void {
    const a = new Args(st, ['boden', 'decke', 'ecken', 'sockel', 'kranz', 'fachwerk', 'raster'], ['hohl', 'voll']);
    const name = a.optionalName();
    const p1 = a.coord('Die erste Ecke');
    const p2 = a.coord('Die zweite Ecke');
    const role = this.palette.role(a.word('Die Rolle'), st.line);
    a.done();
    const hollow = a.flag('hohl');
    const floor = this.optRole(a, 'boden');
    const ceiling = this.optRole(a, 'decke');
    const corners = this.optRole(a, 'ecken');
    const plinth = this.optRole(a, 'sockel');
    const crown = this.optRole(a, 'kranz');
    const frame = this.optRole(a, 'fachwerk');
    const grid = a.int('raster', 4, 2, 64);
    if (a.has('raster') && !frame) throw new TessError(st.line, '„raster=“ gilt nur zusammen mit „fachwerk=“.');
    const min: Vec3 = [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.min(p1[2], p2[2])];
    const max: Vec3 = [Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1]), Math.max(p1[2], p2[2])];
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 8_000_000) throw new TessError(st.line, 'Die box ist zu groß (mehr als 8 Millionen Blöcke).');
    if (hollow && (x1 - x0 < 2 || z1 - z0 < 2)) throw new TessError(st.line, 'Eine hohle box braucht innen Platz: mindestens 3 Blöcke in x und z.');
    const beamBottom = plinth ? y0 + 1 : y0;
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const wallX = z === z0 || z === z1; // wall running along x
          const wallZ = x === x0 || x === x1;
          const onWall = wallX || wallZ;
          const p = [x, y, z];
          if (!onWall) {
            if (y === y0 && floor) this.place(p, floor, 'block', {}, Part.Plain, 'x');
            else if (y === y1 && ceiling) this.place(p, ceiling, 'block', {}, Part.Plain, 'x');
            else if (!hollow) this.place(p, role, 'block', {}, Part.Plain, 'y');
            else this.grid.clear(x, y, z); // a hollow form is a room: it clears what was inside before
            continue;
          }
          const corner = wallX && wallZ;
          const along: 'x' | 'z' = wallX ? 'x' : 'z';
          if (corners && corner) {
            this.place(p, corners, 'block', {}, Part.Structure, 'y');
          } else if (plinth && y === y0) {
            this.place(p, plinth, 'block', {}, Part.Plain, along);
          } else if (crown && y === y1) {
            this.place(p, crown, 'block', {}, Part.Beam, along);
          } else if (frame) {
            const post = corner || (wallX && (x - x0) % grid === 0) || (wallZ && (z - z0) % grid === 0);
            if (post) this.place(p, frame, 'block', {}, Part.Structure, 'y');
            else if (y === beamBottom || y === y1) this.place(p, frame, 'block', {}, Part.Beam, along);
            else this.place(p, role, 'block', {}, Part.Plain, 'y');
          } else {
            this.place(p, role, 'block', {}, Part.Plain, 'y');
          }
        }
      }
    }
    if (name) this.register({ kind: 'box', name, line: st.line, min, max, role, hollow });
  }

  /** zylinder [name] x,y,z r= h= <rolle> [hohl] [boden= decke= sockel= kranz=]   (x,y,z = Mitte unten) */
  private cylinder(st: Statement): void {
    const a = new Args(st, ['r', 'h', 'boden', 'decke', 'sockel', 'kranz'], ['hohl', 'voll']);
    const name = a.optionalName();
    const [cx, y0, cz] = a.coord('Die Mitte unten');
    const role = this.palette.role(a.word('Die Rolle'), st.line);
    a.done();
    const r = a.requireInt('r', 1, 200, 'Der Radius: r=3 ergibt 7 Blöcke Durchmesser.');
    const h = a.requireInt('h', 1, 1000, 'Die Höhe in Blöcken.');
    const hollow = a.flag('hohl');
    if (hollow && r < 2) throw new TessError(st.line, 'Ein hohler zylinder braucht mindestens r=2.');
    const floor = this.optRole(a, 'boden');
    const ceiling = this.optRole(a, 'decke');
    const plinth = this.optRole(a, 'sockel');
    const crown = this.optRole(a, 'kranz');
    const y1 = y0 + h - 1;
    const ring = new Set(ringCells(r).map(([dx, dz]) => `${dx},${dz}`));
    for (let y = y0; y <= y1; y++) {
      for (const [dx, dz] of discCells(r)) {
        const p = [cx + dx, y, cz + dz];
        const onRing = ring.has(`${dx},${dz}`);
        if (!onRing) {
          if (y === y0 && floor) this.place(p, floor, 'block', {}, Part.Plain, 'x');
          else if (y === y1 && ceiling) this.place(p, ceiling, 'block', {}, Part.Plain, 'x');
          else if (!hollow) this.place(p, role, 'block', {}, Part.Plain, 'y');
          else this.grid.clear(p[0], y, p[2]);
          continue;
        }
        if (plinth && y === y0) this.place(p, plinth, 'block', {}, Part.Plain, 'y');
        else if (crown && y === y1) this.place(p, crown, 'block', {}, Part.Beam, 'y');
        else this.place(p, role, 'block', {}, Part.Plain, 'y');
      }
    }
    if (name) this.register({ kind: 'zylinder', name, line: st.line, cx, cz, y0, y1, r, role, hollow });
  }

  /** linie x,y,z x,y,z <rolle> */
  private lineCmd(st: Statement): void {
    const a = new Args(st, []);
    const p1 = a.coord('Der Anfang');
    const p2 = a.coord('Das Ende');
    const role = this.palette.role(a.word('Die Rolle'), st.line);
    a.done();
    const d = [Math.abs(p2[0] - p1[0]), Math.abs(p2[1] - p1[1]), Math.abs(p2[2] - p1[2])];
    const axis = d[1] >= d[0] && d[1] >= d[2] ? 'y' : d[0] >= d[2] ? 'x' : 'z';
    for (const p of lineCells(p1, p2)) this.place(p, role, 'block', {}, Part.Structure, axis);
  }

  /** block x,y,z <rolle | block-id[zustände]> */
  private blockCmd(st: Statement): void {
    const a = new Args(st, []);
    const p = a.coord('Die Position');
    const what = a.word('Der Block oder die Rolle');
    a.done();
    const role = this.palette.roles.get(asciiKey(what));
    if (role && !what.includes('[') && !what.includes(':')) {
      this.place(p, role, 'block');
      return;
    }
    const s = parseBlockState(what);
    this.grid.set(p[0], p[1], p[2], this.stateOf(s.name, { ...s.props }), Part.Plain, st.line);
  }

  /** leer x,y,z [x,y,z]: macht Luft */
  private clearCmd(st: Statement): void {
    const a = new Args(st, []);
    const p1 = a.coord('Die Position');
    const p2 = a.positional.length > 1 ? a.coord('Die zweite Ecke') : p1;
    a.done();
    for (let y = Math.min(p1[1], p2[1]); y <= Math.max(p1[1], p2[1]); y++)
      for (let z = Math.min(p1[2], p2[2]); z <= Math.max(p1[2], p2[2]); z++)
        for (let x = Math.min(p1[0], p2[0]); x <= Math.max(p1[0], p2[0]); x++) this.grid.clear(x, y, z);
  }

  // ---- Bauteile

  private face(o: Obj, side: Facing): Face {
    if (o.kind === 'box') {
      const [x0, , z0] = o.min;
      const [x1, , z1] = o.max;
      const axis = axisOf(side) === 'x' ? 'z' : 'x';
      const fixed = side === 'north' ? z0 : side === 'south' ? z1 : side === 'west' ? x0 : x1;
      const [tMin, tMax] = axis === 'x' ? [x0, x1] : [z0, z1];
      return {
        side,
        axis,
        tMin,
        tMax,
        cell: (t, y) => (t < tMin || t > tMax ? null : axis === 'x' ? [t, y, fixed] : [fixed, y, t]),
        isCorner: (t) => t === tMin || t === tMax,
      };
    }
    // Cylinder: the outermost ring cell in the side's direction, per position along the wall.
    const axis = axisOf(side) === 'x' ? 'z' : 'x';
    const [ox, oz] = DIR[side];
    const outer = new Map<number, number>();
    for (const [dx, dz] of ringCells(o.r)) {
      const t = axis === 'x' ? dx : dz;
      const depth = axis === 'x' ? dz * oz : dx * ox;
      if (depth <= 0) continue;
      if (!outer.has(t) || depth > outer.get(t)!) outer.set(t, depth);
    }
    const c = axis === 'x' ? o.cx : o.cz;
    const ts = [...outer.keys()];
    return {
      side,
      axis,
      tMin: c + Math.min(...ts),
      tMax: c + Math.max(...ts),
      cell: (t, y) => {
        const depth = outer.get(t - c);
        if (depth === undefined) return null;
        return axis === 'x' ? [t, y, o.cz + depth * oz] : [o.cx + depth * ox, y, t];
      },
      isCorner: () => false,
    };
  }

  private sideArg(a: Args): Facing {
    const w = a.word('Die Seite (n, o, s oder w)').toLowerCase();
    const side = parseSide(asciiKey(w));
    if (!side) throw new TessError(this.line, `„${w}“ ist keine Seite. Erlaubt: n, o, s, w (Norden = −z, Osten = +x).`);
    return side;
  }

  /** Start positions along the wall: given (x= or z=) or the group centred on the wall. */
  private starts(a: Args, face: Face, width: number, count: number, step: number): number[] {
    const other = face.axis === 'x' ? 'z' : 'x';
    if (a.has(other)) {
      throw new TessError(this.line, `Die ${sideLabel(face.side)}seite läuft entlang ${face.axis}; die Position wird mit „${face.axis}=“ angegeben, nicht mit „${other}=“.`);
    }
    let start: number;
    if (a.has(face.axis)) start = a.int(face.axis, 0);
    else {
      const span = (count - 1) * step + width;
      start = Math.floor((face.tMin + face.tMax + 1 - span) / 2);
    }
    return Array.from({ length: count }, (_, i) => start + i * step);
  }

  /** Checks one opening cell and reports what it hits. Returns the wall cell or null. */
  private openingCell(face: Face, t: number, y: number, what: string, allowBeam = false): Vec3 | null {
    const p = face.cell(t, y);
    const where = () => (p ? `${p[0]},${p[1]},${p[2]}` : `${face.axis}=${t}, y=${y}`);
    if (!p || !this.grid.has(p[0], p[1], p[2])) {
      this.warn(`${what} liegt bei ${where()} nicht in der Wand (dort ist kein Block).`);
      return p;
    }
    if (face.isCorner(t)) this.warn(`${what} sitzt bei ${where()} in der Hausecke.`);
    const info = this.grid.cellInfo(p[0], p[1], p[2]);
    if (info?.part === Part.Structure) this.warn(`${what} schneidet bei ${where()} einen Pfosten oder Eckpfeiler (Zeile ${info.line}).`);
    else if (info?.part === Part.Beam && !allowBeam) this.warn(`${what} schneidet bei ${where()} einen waagrechten Balken (Zeile ${info.line}).`);
    else if (info?.part === Part.Opening && info.line !== this.line) this.warn(`${what} überschneidet sich bei ${where()} mit Zeile ${info.line}.`);
    return p;
  }

  private outside(p: Vec3, side: Facing): Vec3 {
    const [dx, dz] = DIR[side];
    return [p[0] + dx, p[1], p[2] + dz];
  }

  /** Places an attachment outside the wall if the cell is free. */
  private attach(p: Vec3, state: BlockState, what: string): void {
    const info = this.grid.cellInfo(p[0], p[1], p[2]);
    if (info) {
      if (info.part !== Part.Attachment || info.line !== this.line) this.warn(`${what} bei ${p.join(',')} stößt an einen Block (Zeile ${info.line}) und fehlt dort.`);
      return;
    }
    this.grid.set(p[0], p[1], p[2], state, Part.Attachment, this.line);
  }

  /** fenster <form> <seite> y= [x=|z=] [b=1 h=2 anzahl=1 abstand=] [glas= rahmen= bank= sturz= laeden=] */
  private window(st: Statement): void {
    const a = new Args(st, ['x', 'z', 'y', 'b', 'h', 'anzahl', 'abstand', 'glas', 'rahmen', 'bank', 'sturz', 'laeden']);
    const o = this.object(a.word('Die Form (Name einer box oder eines zylinders)'));
    const side = this.sideArg(a);
    a.done();
    const face = this.face(o, side);
    const y0 = a.requireInt('y', -2000, 2000, 'Die Höhe der untersten Glasreihe (absolut).');
    const b = a.int('b', 1, 1, 16);
    const h = a.int('h', 2, 1, 32);
    const count = a.int('anzahl', 1, 1, 64);
    const step = a.int('abstand', b + 2, b + 1, 256);
    const glass = this.palette.role(a.str('glas') ?? 'glas', st.line);
    const sillRole = this.roleOrNone(a.str('bank') ?? a.str('rahmen') ?? 'rahmen');
    const lintelRole = this.roleOrNone(a.str('sturz') ?? a.str('rahmen') ?? 'rahmen');
    const shutters = this.optRole(a, 'laeden');
    const top = o.kind === 'box' ? o.max[1] : o.y1;
    const bottom = o.kind === 'box' ? o.min[1] : o.y0;
    // Windows above the top (in a gable) are fine; touching the bottom or top layer is not.
    if (y0 <= bottom || (y0 <= top && y0 + h - 1 >= top)) {
      this.warn(`Das Fenster (y=${y0} bis ${y0 + h - 1}) reicht an Boden oder Oberkante von „${o.name}“ (y=${bottom} bis ${top}).`);
    }
    const inward = opposite(side);
    for (const t0 of this.starts(a, face, b, count, step)) {
      for (let t = t0; t < t0 + b; t++) {
        for (let y = y0; y < y0 + h; y++) {
          const p = this.openingCell(face, t, y, 'Das Fenster');
          if (p) this.place(p, glass, 'block', {}, Part.Opening);
        }
      }
      if (lintelRole) {
        for (let t = t0 - 1; t <= t0 + b; t++) {
          const p = face.cell(t, y0 + h);
          if (!p || !this.grid.has(p[0], p[1], p[2])) continue;
          const part = this.grid.cellInfo(p[0], p[1], p[2])?.part;
          if (part === Part.Structure || part === Part.Beam || part === Part.Roof) continue;
          this.place(p, lintelRole, 'block', {}, Part.Opening, face.axis);
        }
      }
      if (sillRole) {
        for (let t = t0; t < t0 + b; t++) {
          const p = face.cell(t, y0 - 1);
          if (!p) continue;
          const id = this.palette.pick(sillRole, 'stairs', p[0], p[1], p[2], st.line);
          this.attach(this.outside(p, side), this.stateOf(id, { facing: inward, half: 'top' }), 'Die Fensterbank');
        }
      }
      if (shutters) {
        for (const t of [t0 - 1, t0 + b]) {
          for (let y = y0; y < y0 + h; y++) {
            const p = face.cell(t, y);
            if (!p) continue;
            const id = this.palette.pick(shutters, 'block', p[0], p[1], p[2], st.line);
            this.attach(this.outside(p, side), this.stateOf(id, { facing: side, open: 'true', half: 'bottom' }), 'Der Fensterladen');
          }
        }
      }
    }
  }

  /** A role name, or nein/aus/ohne for "leave this part out". */
  private roleOrNone(v: string): Role | null {
    if (NO.has(v.toLowerCase())) return null;
    return this.palette.role(v, this.line);
  }

  /** tür <form> <seite> [x=|z=] [y=] [b=1|2] [tuer= rahmen=] */
  private door(st: Statement): void {
    const a = new Args(st, ['x', 'z', 'y', 'b', 'tuer', 'rahmen']);
    const o = this.object(a.word('Die Form (Name einer box oder eines zylinders)'));
    const side = this.sideArg(a);
    a.done();
    const face = this.face(o, side);
    const bottom = o.kind === 'box' ? o.min[1] : o.y0;
    const y0 = a.int('y', bottom + 1, -2000, 2000);
    const b = a.int('b', 1, 1, 2);
    const doorRole = this.palette.role(a.str('tuer') ?? 'tuer', st.line);
    const frame = this.roleOrNone(a.str('rahmen') ?? 'rahmen');
    const facing = opposite(side);
    const left = ccw(facing);
    const [t0] = this.starts(a, face, b, 1, b);
    for (let t = t0; t < t0 + b; t++) {
      // The lowest row may cut the timber frame's sill beam: that is the threshold.
      const lower = this.openingCell(face, t, y0, 'Die Tür', true);
      const upper = this.openingCell(face, t, y0 + 1, 'Die Tür');
      if (!lower || !upper) continue;
      const id = this.palette.pick(doorRole, 'block', lower[0], lower[1], lower[2], st.line);
      if (!id.endsWith('_door')) throw new TessError(st.line, `Die Rolle „${doorRole.name}“ ist keine Tür („${id}“); nimm z. B. spruce_door.`);
      // Double doors: hinges on the outer edges.
      let hinge = 'left';
      if (b === 2) {
        const [lx, lz] = DIR[left];
        const otherT = t === t0 ? t0 + 1 : t0;
        const other = face.cell(otherT, y0)!;
        const towardsLeft = (other[0] - lower[0]) * lx + (other[2] - lower[2]) * lz > 0;
        hinge = towardsLeft ? 'right' : 'left';
      }
      this.grid.set(lower[0], lower[1], lower[2], this.stateOf(id, { facing, half: 'lower', hinge }), Part.Opening, st.line);
      this.grid.set(upper[0], upper[1], upper[2], this.stateOf(id, { facing, half: 'upper', hinge }), Part.Opening, st.line);
    }
    if (frame) {
      const cells: [number, number, 'x' | 'y' | 'z'][] = [];
      for (let y = y0; y <= y0 + 1; y++) cells.push([t0 - 1, y, 'y'], [t0 + b, y, 'y']);
      for (let t = t0 - 1; t <= t0 + b; t++) cells.push([t, y0 + 2, face.axis]);
      for (const [t, y, axis] of cells) {
        const p = face.cell(t, y);
        if (!p || !this.grid.has(p[0], p[1], p[2])) continue;
        const part = this.grid.cellInfo(p[0], p[1], p[2])?.part;
        if (part === Part.Structure || part === Part.Beam || part === Part.Roof) continue;
        this.place(p, frame, 'block', {}, Part.Opening, axis);
      }
    }
  }

  /** dach <sattel|walm|kegel> <form> [ueberstand=1 steil= rolle=dach first=x|z giebel= kante=ja|nein spitze=] */
  private roof(st: Statement): void {
    const a = new Args(st, ['ueberstand', 'steil', 'rolle', 'first', 'giebel', 'kante', 'spitze']);
    const type = a.word('Die Dachform (sattel, walm oder kegel)').toLowerCase();
    const o = this.object(a.word('Die Form'));
    a.done();
    const role = this.palette.role(a.str('rolle') ?? 'dach', st.line);
    const over = a.int('ueberstand', 1, 0, 8);
    if (type === 'sattel' || type === 'walm') {
      if (o.kind !== 'box') throw new TessError(st.line, `Ein ${type}dach braucht eine box; für „${o.name}“ (zylinder) nimm „dach kegel“.`);
      if (a.has('spitze')) throw new TessError(st.line, '„spitze=“ gibt es nur beim Kegeldach.');
      const steep = a.int('steil', 1, 1, 3);
      if (type === 'sattel') this.gableRoof(a, o, role, over, steep);
      else {
        if (a.has('first') || a.has('giebel') || a.has('kante')) throw new TessError(st.line, 'Ein Walmdach hat keinen Giebel: „first=“, „giebel=“ und „kante=“ gelten nur beim Satteldach.');
        this.hipRoof(o, role, over, steep);
      }
      return;
    }
    if (type === 'kegel') {
      if (o.kind !== 'zylinder') throw new TessError(st.line, `Ein Kegeldach braucht einen zylinder; für „${o.name}“ (box) nimm „dach walm“.`);
      if (a.has('first') || a.has('giebel') || a.has('kante')) throw new TessError(st.line, '„first=“, „giebel=“ und „kante=“ gelten nur beim Satteldach.');
      this.coneRoof(o, role, over, a.int('steil', 2, 1, 3), a.str('spitze'));
      return;
    }
    throw new TessError(st.line, `„${type}“ ist keine Dachform. Möglich: sattel, walm, kegel.`);
  }

  /** One step of a roof: full blocks below, stairs (or a slab on the ridge) on top. */
  private roofStep(x: number, z: number, yBase: number, steep: number, role: Role, top: { facing: Facing } | 'ridge' | 'tip'): void {
    for (let i = 0; i < steep - 1; i++) this.place([x, yBase + i, z], role, 'block', {}, Part.Roof, 'y');
    const p = [x, yBase + steep - 1, z];
    if (top === 'ridge') this.place(p, role, 'slab', { type: 'bottom' }, Part.Roof);
    else if (top === 'tip') this.place(p, role, 'block', {}, Part.Roof, 'y');
    else this.place(p, role, 'stairs', { facing: top.facing, half: 'bottom' }, Part.Roof);
  }

  private gableRoof(a: Args, o: BoxObj, role: Role, over: number, steep: number): void {
    const [x0, y0top, z0] = [o.min[0], o.max[1], o.min[2]];
    const [x1, , z1] = [o.max[0], o.max[1], o.max[2]];
    const ridgeArg = a.str('first')?.toLowerCase();
    if (ridgeArg && ridgeArg !== 'x' && ridgeArg !== 'z') throw new TessError(this.line, '„first=“ ist x oder z (Richtung des Dachfirsts).');
    // Default: ridge along the longer side.
    const ridge = (ridgeArg ?? (x1 - x0 >= z1 - z0 ? 'x' : 'z')) as 'x' | 'z';
    const gableRole = this.optRole(a, 'giebel') ?? o.role;
    const edgeArg = a.str('kante')?.toLowerCase();
    const edges = edgeArg === undefined ? over > 0 && steep === 1 : !NO.has(edgeArg);
    const base = y0top + 1;
    // u runs along the ridge, v across it.
    const [u0, u1, v0, v1] = ridge === 'x' ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
    const toXZ = (u: number, v: number): [number, number] => (ridge === 'x' ? [u, v] : [v, u]);
    const [plusV, minusV]: [Facing, Facing] = ridge === 'x' ? ['south', 'north'] : ['east', 'west'];
    const [plusU, minusU]: [Facing, Facing] = ridge === 'x' ? ['east', 'west'] : ['south', 'north'];
    const vA = v0 - over;
    const vB = v1 + over;
    const width = vB - vA + 1;
    const rows = Math.floor(width / 2);
    for (let u = u0 - over; u <= u1 + over; u++) {
      for (let k = 0; k < rows; k++) {
        const y = base + k * steep;
        this.roofStep(...toXZ(u, vA + k), y, steep, role, { facing: plusV });
        this.roofStep(...toXZ(u, vB - k), y, steep, role, { facing: minusV });
      }
      if (width % 2 === 1) this.roofStep(...toXZ(u, vA + rows), base + rows * steep, steep, role, 'ridge');
    }
    // Gables: the end walls fill up to the underside of the roof.
    for (const u of [u0, u1]) {
      for (let v = v0; v <= v1; v++) {
        const k = Math.min(v - vA, vB - v);
        const below = base + k * steep;
        for (let y = base; y < below; y++) {
          const [x, z] = toXZ(u, v);
          if (!this.grid.has(x, y, z)) this.place([x, y, z], gableRole, 'block', {}, Part.Plain, 'y');
        }
      }
    }
    // Verge: upside-down stairs under the roof edge at both gable ends.
    if (edges && over > 0) {
      for (const [u, facing] of [
        [u0 - over, plusU],
        [u1 + over, minusU],
      ] as [number, Facing][]) {
        for (let k = 0; k < rows; k++) {
          for (const v of [vA + k, vB - k]) {
            const [x, z] = toXZ(u, v);
            const y = base + k * steep + steep - 2;
            if (y < base || this.grid.has(x, y, z)) continue;
            this.place([x, y, z], role, 'stairs', { facing, half: 'top' }, Part.Roof);
          }
        }
      }
    }
  }

  private hipRoof(o: BoxObj, role: Role, over: number, steep: number): void {
    let [xa, za] = [o.min[0] - over, o.min[2] - over];
    let [xb, zb] = [o.max[0] + over, o.max[2] + over];
    let y = o.max[1] + 1;
    while (xa <= xb && za <= zb) {
      if (xa === xb || za === zb) {
        for (let z = za; z <= zb; z++) for (let x = xa; x <= xb; x++) this.roofStep(x, z, y, steep, role, xa === xb && za === zb ? 'tip' : 'ridge');
        break;
      }
      for (let z = za; z <= zb; z++) {
        for (let x = xa; x <= xb; x++) {
          if (z !== za && z !== zb && x !== xa && x !== xb) continue;
          const facing: Facing = z === za ? 'south' : z === zb ? 'north' : x === xa ? 'east' : 'west';
          this.roofStep(x, z, y, steep, role, { facing });
        }
      }
      xa++;
      za++;
      xb--;
      zb--;
      y += steep;
    }
  }

  private coneRoof(o: CylObj, role: Role, over: number, steep: number, tip: string | undefined): void {
    const R = o.r + over;
    let y = o.y1 + 1;
    for (let r = R; r >= 0; r--) {
      for (const [dx, dz] of discCells(r)) {
        if (r > 0 && inDisc(dx, dz, r - 1)) continue;
        const x = o.cx + dx;
        const z = o.cz + dz;
        this.roofStep(x, z, y, steep, role, r === 0 ? 'tip' : { facing: facingTowards(-dx, -dz) });
      }
      y += steep;
    }
    if (tip) {
      const s = parseBlockState(tip);
      this.grid.set(o.cx, y, o.cz, this.stateOf(s.name, { ...s.props }), Part.Roof, this.line);
    }
  }

  /** zinnen <form> [rolle] */
  private crenellations(st: Statement): void {
    const a = new Args(st, []);
    const o = this.object(a.word('Die Form'));
    const roleName = a.optionalWord();
    a.done();
    const role = roleName ? this.palette.role(roleName, st.line) : o.role;
    if (o.kind === 'box') {
      const [x0, , z0] = o.min;
      const [x1, top, z1] = o.max;
      const y = top + 1;
      const sides: [number, number, number, number][] = [
        [x0, z0, 1, 0],
        [x1, z0, 0, 1],
        [x1, z1, -1, 0],
        [x0, z1, 0, -1],
      ];
      for (const [sx, sz, dx, dz] of sides) {
        const len = dx !== 0 ? x1 - x0 : z1 - z0;
        for (let i = 0; i <= len; i++) if (i % 2 === 0 || i === len) this.place([sx + dx * i, y, sz + dz * i], role, 'block', {}, Part.Plain, 'y');
      }
      return;
    }
    ringByAngle(o.r).forEach(([dx, dz], i) => {
      if (i % 2 === 0) this.place([o.cx + dx, o.y1 + 1, o.cz + dz], role, 'block', {}, Part.Plain, 'y');
    });
  }
}

/** Compiles a Bau-Sprache 1 source. Never throws for problems in the file; they come back as diagnostics. */
export function compileV1(source: string, hints?: BlockHints): CompileOutputV1 {
  const { statements, diagnostics } = parseStatements(source);
  const c = new CompilerV1(hints);
  c.run(statements);
  connectBlocks(c.grid, 1);
  const all = [...diagnostics, ...c.diagnostics].sort((a, b) => a.line - b.line);
  if (c.grid.size === 0 && !all.some((d) => d.level === 'error')) all.push({ line: 1, level: 'warn', message: 'Der Bauplan erzeugt keinen einzigen Block.' });
  return { name: c.name, grid: c.grid, diagnostics: all, statements: statements.length };
}
