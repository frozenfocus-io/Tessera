import { Args, NO, YES } from './args';
import { CellSet, ChebDistance, facingTowardsSet } from './cells';
import type { Vec3 } from './compile-base';
import { CompilerPlace } from './compile-place';
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
import { axisOf, DIR, type Facing } from './geometry';
import { LIMIT_V2, Part } from './grid';
import type { RoleRef } from './palette';
import type { RoofDef } from './roof';
import { asciiKey, FollowUpError, TessError, type Statement } from './syntax';

/**
 * Compiler layer 3 of 5 (see compile.ts): forms. The form commands (box, zylinder, vieleck,
 * umriss, grundriss, kugel) with wall profile, timber frame and corbels, the outlines of a form
 * per layer and the faces and wall cells that Bauteile work on.
 */

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

// ---------------------------------------------------------------------------

export abstract class CompilerForms extends CompilerPlace {
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

  bauteilForm(a: Args): FormObj {
    const f = this.form(a.word1('Die Form (Name einer Form)'));
    if (f.kind === 'kugel') throw new TessError(this.line, 'An einer kugel hängen keine Bauteile.');
    return f;
  }
}

// ---------------------------------------------------------------------------

function packXZ(x: number, z: number): number {
  return (x + 8192) * 16384 + (z + 8192);
}
