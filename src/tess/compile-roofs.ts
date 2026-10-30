import { Args, NO, YES } from './args';
import { CellSet, sideBit, SIDES } from './cells';
import { pack3, unpack3 } from './compile-base';
import { CompilerForms, type FormObj } from './compile-forms';
import { DiscShape, PolygonShape } from './forms';
import { axisOf, parseSide } from './geometry';
import { LIMIT_V2, Part } from './grid';
import type { BlockSpec, RoleRef } from './palette';
import { insetAt, layerOf, parseRoofProfile, renderRoofs, renderSkirt, type GableWall, type HipEnds, type RoofDef, type RoofProfile, type RoofType } from './roof';
import { asciiKey, classify, TessError, type Statement, type Token } from './syntax';

/**
 * Compiler layer 4 of 5 (see compile.ts): roofs. dach and kranzdach, roofs on forms and
 * Anbauten, and roof groups: roofs whose base areas touch unite and are drawn again together.
 */

export interface RoofObj {
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

/** Options of `dach`. */
export const ROOF_KEYS = ['name', 'ueberstand', 'profil', 'steil', 'dicke', 'rolle', 'first', 'giebel', 'kante', 'spitze', 'firstzier', 'traufe', 'kruppel', 'hoch', 'biegung', 'rand', 'art'];

// ---------------------------------------------------------------------------

export abstract class CompilerRoofs extends CompilerForms {
  /** The roof group a roof belongs to. */
  groupOf(def: RoofDef): RoofGroup | null {
    return this.groups.find((g) => g.roofs.includes(def)) ?? null;
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
