import { Args, NO, YES } from './args';
import { CellSet, sideBit, SIDES } from './cells';
import { pack3, unpack3 } from './compile-base';
import { CompilerForms, type FormObj } from './compile-forms';
import { tallPlant } from './compile-place';
import { DiscShape, PolygonShape } from './forms';
import { axisOf, parseSide } from './geometry';
import { LIMIT_V2, Part } from './grid';
import type { RoleRef } from './palette';
import { hipFree, insetAt, layerOf, parseRoofProfile, renderRoofs, renderSkirt, type GableWall, type HipEnds, type RoofBlock, type RoofDef, type RoofProfile, type RoofType } from './roof';
import { blockOrder, clipSet, compareOrder, inBox, RoofGroup, RoofIndex, type CellBox, type RoofExtra } from './roofgroup';
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

/** Options of `dach`. */
export const ROOF_KEYS = ['name', 'ueberstand', 'profil', 'steil', 'dicke', 'rolle', 'first', 'giebel', 'kante', 'spitze', 'firstzier', 'traufe', 'kruppel', 'hoch', 'biegung', 'rand', 'art'];

// ---------------------------------------------------------------------------

export abstract class CompilerRoofs extends CompilerForms {
  /** Groups with fewer blocks are always drawn whole (cheaper); tests set 0 to draw parts wherever possible. */
  static partFrom = 1500;
  /** All roofs added to groups, by area. */
  private readonly roofIndex = new RoofIndex();
  private readonly roofGroups = new Map<RoofDef, RoofGroup>();
  private groupStamp = 0;

  /** The roof group a roof belongs to. */
  groupOf(def: RoofDef): RoofGroup | null {
    return this.roofGroups.get(def) ?? null;
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
    const firstzier = a.str('firstzier') ? this.spec(a.str('firstzier')!) : null;
    const spitze = a.str('spitze') ? this.spec(a.str('spitze')!) : null;
    const name = a.str('name') ? this.qname(asciiKey(a.str('name')!)) : null;
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
        const ridge = (ridgeArg ? this.xf.axis(ridgeArg as 'x' | 'z') : x1 - x0 >= z1 - z0 ? 'x' : 'z') as 'x' | 'z';
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
        const hochLocal = parseSide(asciiKey(a.str('hoch')!));
        const hoch = hochLocal && this.xf.facing(hochLocal);
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
    } else if (f.shape instanceof DiscShape) {
      const shape = f.shape;
      const v0 = vTop + over;
      at = (i) => shape.outline(v0 - i);
      radius = shape.radius + v0;
      base = shape.outline(v0);
    } else if (f.shape instanceof PolygonShape) {
      // Profile offset and overhang move the straight sides; the layers shrink over the radius.
      const shape = f.shape;
      const v0 = vTop + over;
      at = (i) => shape.outline(v0, i);
      radius = Math.round(shape.circumradius(v0) - 0.5);
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
      const local = bendVector(asciiKey(m[1]));
      // In a turned or mirrored module the side is local: turn the direction with it.
      const vec = local && (this.xf.turns ? this.xf.dir(local[0], local[1]) : local);
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
  /**
   * Adds a roof to its group and draws what changes. Drawing a group again does not count as
   * setting blocks (limit of section 10); only cells the group newly fills do.
   */
  addRoof(def: RoofDef, extra: RoofExtra): void {
    const before = this.grid.size;
    this.roofDrawing++;
    try {
      this.addRoofInner(def, extra);
    } finally {
      this.roofDrawing--;
      this.placed += Math.max(0, this.grid.size - before);
    }
  }

  private addRoofInner(def: RoofDef, extra: RoofExtra): void {
    this.roofIndex.add(def);
    const b = def.base;
    const near = b.isEmpty() ? [] : this.roofIndex.near(b.x0 - 1, b.z0 - 1, b.x1 + 1, b.z1 + 1);
    const touching = [...new Set(near.filter((r) => this.roofGroups.has(r) && touches(r.base, def.base)).map((r) => this.roofGroups.get(r)!))];
    touching.sort((p, q) => p.stamp - q.stamp);
    // A later roof of one group: draw only the part of the group that changes.
    if (touching.length === 1 && this.drawPart(touching[0], def, extra)) {
      this.groups.delete(touching[0]);
      touching[0].stamp = ++this.groupStamp;
      this.groups.add(touching[0]);
      return;
    }
    const group = touching[0] ?? new RoofGroup();
    const placed = touching.map((g) => g.placed);
    const kept = new Map<number, number>();
    const roofs: RoofDef[] = [];
    const extras: RoofExtra[] = [];
    for (const g of touching) {
      roofs.push(...g.roofs);
      extras.push(...g.extra);
      for (const [k, s] of g.kept) kept.set(k, s);
      this.groups.delete(g);
      if (g !== group) g.unwatch(this.grid, unpack3);
    }
    roofs.push(def);
    extras.push(extra);
    // Keep the order of the statements: the earliest roof owns shared cells.
    const order = roofs.map((_, i) => i).sort((p, q) => roofs[p].seq - roofs[q].seq);
    group.roofs = order.map((i) => roofs[i]);
    group.extra = order.map((i) => extras[i]);
    group.kept = kept;
    for (const r of group.roofs) this.roofGroups.set(r, group);
    group.stamp = ++this.groupStamp;
    this.groups.add(group);
    this.renderGroup(group, placed);
  }

  /** After the last statement no group is drawn again: the grid need not report changes. */
  stopWatching(): void {
    for (const g of this.groups) g.unwatch(this.grid, unpack3);
  }

  /** Draws a whole group again; `placed` are the cells its parts placed before. */
  renderGroup(g: RoofGroup, placed: Iterable<Set<number>>): void {
    g.broken = true;
    g.ready = false;
    const origins = new Set(g.roofs.map((r) => r.origin));
    const firstSeq = Math.min(...g.roofs.map((r) => r.seq));
    // Remove what the group placed before, where nothing else has replaced or cleared it since;
    // such cells stay as the later statements left them.
    for (const cells of placed) {
      for (const k of cells) {
        const [x, y, z] = unpack3(k);
        if (origins.has(this.grid.originAt(x, y, z))) this.grid.clear(x, y, z);
        else if (!g.kept.has(k)) g.kept.set(k, this.seq);
      }
    }
    g.placed = new Set();
    const { blocks, tips, roofs } = renderRoofs(g.roofs);
    const savedLine = this.line;
    for (const b of blocks) this.placeRoofBlock(g, b, origins, firstSeq);
    this.line = savedLine;
    // Spires on roofs that end in a ridge: say so once, on the roof's own line.
    const last = g.roofs.length - 1;
    if (g.extra[last].spitze && !tips[last]) this.warn('„spitze=“: Das Dach endet in einem First, nicht in einer Spitze; die Spitze fehlt.', g.extra[last].line);
    g.broken = false;
    // Drawing a part later pays off for larger groups only. It needs at most one tip per roof
    // (the spire), no wide bellies (their facing looks far) and no decorations of two blocks
    // (they reach into the cell above).
    const tipsOf = new Map<number, Set<number>>();
    let ready = blocks.length >= CompilerRoofs.partFrom && !g.extra.some(tallDeco);
    for (const b of blocks) {
      if (b.wide) ready = false;
      if (b.kind !== 'tip') continue;
      const t = tipsOf.get(b.roof);
      if (t) ready = false;
      else tipsOf.set(b.roof, new Set([pack3(b.x, b.y, b.z)]));
    }
    g.ready = ready;
    g.dirty.clear();
    if (!ready) {
      g.unwatch(this.grid, unpack3);
      g.target = new Map();
      return;
    }
    g.origins = origins;
    g.firstSeq = firstSeq;
    g.resolved = roofs;
    g.index = new Map(g.roofs.map((r, i) => [r, i]));
    g.free = new Map();
    for (const [i, r] of g.roofs.entries()) if (r.hip) g.free.set(i, g.roofs.length < 2 ? [true, true] : this.hipFreeIn(g, r));
    g.dicke = g.roofs.reduce((m, r) => Math.max(m, r.dicke), 1);
    g.target = new Map(blocks.map((b) => [pack3(b.x, b.y, b.z), b]));
    g.tips = tipsOf;
    g.seed = this.palette.seed;
    g.watch(this.grid, blocks);
  }

  /**
   * Adds a later roof to a group and draws only the window around it again. The blocks of a
   * group change only near the new roof (and near Krüppelwalm roofs whose ends it closes); outside
   * that window, drawing the whole group again would place the same blocks again. Cells that
   * other statements changed since the last drawing (the grid reports them) are checked again.
   * The window is drawn by renderRoofs on the nearby roofs cut to a larger box, so that the
   * blocks inside the window come out as for the whole group. Returns false, with nothing done,
   * where this would not be exact; then the whole group is drawn.
   */
  private drawPart(g: RoofGroup, def: RoofDef, extra: RoofExtra): boolean {
    if (!g.ready || g.broken || g.seed !== this.palette.seed || tallDeco(extra)) return false;
    if (def.seq < g.roofs[g.roofs.length - 1].seq) return false;
    const ri = g.roofs.length;
    // Krüppelwalm hips (resolveHips): the new roof's own ends, and ends of nearby roofs it closes.
    const box = this.roofIndex.box(def);
    const near = this.roofIndex.near(box.x0 - 1, box.z0 - 1, box.x1 + 1, box.z1 + 1).filter((r) => this.roofGroups.get(r) === g);
    let resDef = def;
    let defFree: [boolean, boolean] | null = null;
    if (def.hip) {
      defFree = hipFree(def, () => true, near);
      if (!defFree[0] || !defFree[1]) {
        const v = def.hip.variant(defFree[0], defFree[1]);
        resDef = { ...def, layers: v.layers, dirs: v.dirs };
      }
    }
    const changed = new Map<number, { now: RoofDef; free: [boolean, boolean] }>();
    for (const r of near) {
      if (!r.hip) continue;
      const i = g.index.get(r)!;
      const was = g.free.get(i)!;
      const f = hipFree(r, () => true, [def]);
      const free: [boolean, boolean] = [was[0] && f[0], was[1] && f[1]];
      if (free[0] === was[0] && free[1] === was[1]) continue;
      const v = r.hip.variant(free[0], free[1]);
      changed.set(i, { now: { ...r, layers: v.layers, dirs: v.dirs }, free });
    }
    const resolvedAt = (i: number) => (i === ri ? resDef : (changed.get(i)?.now ?? g.resolved[i]));
    // Window W: where the union of the layers changes, widened by how far a block looks (shell
    // thickness, seal and gables two cells further) and three layers up and down. The roofs are
    // drawn in a box E around W; blocks near the edge of E may differ, those inside W do not.
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of [resDef, ...[...changed.keys()].flatMap((i) => [g.resolved[i], changed.get(i)!.now])]) {
      p.layers.forEach((L, k) => {
        if (L.isEmpty()) return;
        x0 = Math.min(x0, L.x0);
        z0 = Math.min(z0, L.z0);
        x1 = Math.max(x1, L.x1);
        z1 = Math.max(z1, L.z1);
        y0 = Math.min(y0, p.yb + k);
        y1 = Math.max(y1, p.yb + k);
      });
    }
    if (x0 === Infinity) return false;
    const thick = Math.max(g.dicke, def.dicke);
    const W: CellBox = { x0: x0 - thick - 2, z0: z0 - thick - 2, x1: x1 + thick + 2, z1: z1 + thick + 2, y0: y0 - 3, y1: y1 + 3 };
    const m = thick + 3;
    const E: CellBox = { x0: W.x0 - m, z0: W.z0 - m, x1: W.x1 + m, z1: W.z1 + m, y0: W.y0 - 4, y1: W.y1 + 4 };
    const local: number[] = [];
    for (const r of this.roofIndex.near(E.x0 - 1, E.z0 - 1, E.x1 + 1, E.z1 + 1)) {
      const i = r === def ? ri : this.roofGroups.get(r) === g ? g.index.get(r)! : -1;
      const b = this.roofIndex.box(r);
      if (i >= 0 && b.y1 >= E.y0 - 1 && b.y0 <= E.y1 + 1) local.push(i);
    }
    local.sort((p, q) => p - q);
    // Eaves look at most 33 cells away from the wall (ChebDistance up to 32).
    const near33: CellBox = { x0: E.x0 - 34, z0: E.z0 - 34, x1: E.x1 + 34, z1: E.z1 + 34, y0: E.y0, y1: E.y1 };
    const cut = local.map((i): RoofDef => {
      const r = resolvedAt(i);
      const layers = r.layers.map((L, k) => (r.yb + k < E.y0 || r.yb + k > E.y1 ? CellSet.EMPTY : clipSet(L, E)));
      return { ...r, hip: undefined, layers, full: r.layers, wall: r.traufe ? clipSet(r.wall, near33) : r.wall };
    });
    const fresh = new Map<number, RoofBlock>();
    for (const b of renderRoofs(cut, { spires: false }).blocks) {
      if (!inBox(W, b.x, b.y, b.z)) continue;
      if (b.wide) return false;
      b.roof = local[b.roof];
      fresh.set(pack3(b.x, b.y, b.z), b);
    }
    // Tips (at most one per roof) and spires above them.
    const tipsNow = new Map<number, number[]>();
    for (const i of local) tipsNow.set(i, [...(g.tips.get(i) ?? [])].filter((k) => !inBox(W, ...unpack3(k))));
    for (const [k, b] of fresh) if (b.kind === 'tip') tipsNow.get(b.roof)!.push(k);
    for (const [i, t] of tipsNow) {
      if (t.length > 1) return false;
      const before = [...(g.tips.get(i) ?? [])][0];
      if (before !== t[0]) for (const k of [before, t[0]]) if (k !== undefined && !inBox(W, ...up(unpack3(k)))) return false;
    }
    for (const i of local) {
      const t = tipsNow.get(i)![0];
      if (!resolvedAt(i).hasTip || t === undefined) continue;
      const [x, y, z] = up(unpack3(t));
      if (!inBox(W, x, y, z)) continue;
      const k = pack3(x, y, z);
      const existing = fresh.get(k);
      if (!existing || existing.kind === 'deco') fresh.set(k, { x, y, z, kind: 'spire', roof: i });
    }
    // From here on the group changes. Cells to place again: the window, and what changed.
    const todo = new Set<number>();
    const old: number[] = [];
    for (let y = W.y0; y <= W.y1; y++) {
      for (let z = W.z0; z <= W.z1; z++) {
        for (let x = W.x0; x <= W.x1; x++) {
          const k = pack3(x, y, z);
          if (g.target.has(k)) old.push(k);
        }
      }
    }
    for (const k of old) todo.add(k);
    for (const k of fresh.keys()) todo.add(k);
    for (const k of g.dirty) todo.add(k);
    g.roofs.push(def);
    g.extra.push(extra);
    g.index.set(def, ri);
    g.resolved.push(resDef);
    if (defFree) g.free.set(ri, defFree);
    for (const [i, c] of changed) {
      g.resolved[i] = c.now;
      g.free.set(i, c.free);
    }
    g.dicke = thick;
    g.origins.add(def.origin);
    this.roofGroups.set(def, g);
    g.broken = true;
    for (const k of todo) {
      if (!g.placed.has(k)) continue;
      const [x, y, z] = unpack3(k);
      if (g.origins.has(this.grid.originAt(x, y, z))) this.grid.clear(x, y, z);
      else if (!g.kept.has(k)) g.kept.set(k, this.seq);
      g.placed.delete(k);
    }
    const blocks: [number[], RoofBlock][] = [];
    for (const k of todo) {
      const b = inBox(W, ...unpack3(k)) ? fresh.get(k) : g.target.get(k);
      if (b) blocks.push([blockOrder(b, g.resolved), b]);
    }
    blocks.sort((p, q) => compareOrder(p[0], q[0]));
    const savedLine = this.line;
    let n = 0;
    try {
      for (; n < blocks.length; n++) this.placeRoofBlock(g, blocks[n][1], g.origins, g.firstSeq);
    } catch (e) {
      // Leave the cells as drawing the whole group would have: its blocks after the failing one
      // are not placed again.
      for (const k of [...g.placed]) {
        if (todo.has(k) || compareOrder(blockOrder(g.target.get(k)!, g.resolved), blocks[n][0]) < 0) continue;
        this.grid.clear(...unpack3(k));
        g.placed.delete(k);
      }
      throw e;
    }
    this.line = savedLine;
    for (const k of old) g.target.delete(k);
    for (const [k, b] of fresh) g.target.set(k, b);
    for (const [i, t] of tipsNow) {
      if (t.length) g.tips.set(i, new Set(t));
      else g.tips.delete(i);
    }
    g.watch(this.grid, fresh.values());
    g.dirty.clear();
    g.broken = false;
    if (extra.spitze && !tipsNow.get(ri)!.length) this.warn('„spitze=“: Das Dach endet in einem First, nicht in einer Spitze; die Spitze fehlt.', extra.line);
    return true;
  }

  /** Places one block of a group's drawing (5.3: blocks other statements placed meanwhile stay). */
  private placeRoofBlock(g: RoofGroup, b: RoofBlock, origins: Set<number>, firstSeq: number): void {
    const r = g.roofs[b.roof];
    const ex = g.extra[b.roof];
    if (r.keep && !r.keep(b.x, b.z)) return;
    this.line = ex.line;
    const o = this.grid.originAt(b.x, b.y, b.z);
    if (o && !origins.has(o) && (this.originSeq[o] ?? 0) > firstSeq) return; // placed between the roofs: stays
    const since = g.kept.get(pack3(b.x, b.y, b.z));
    if (since !== undefined && !this.coveredSince(g, b, since)) return;
    const onlyEmpty = b.kind === 'gable' || b.kind === 'verge' || b.kind === 'eave' || b.kind === 'deco' || b.kind === 'spire';
    if (onlyEmpty && o) return;
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
    g.placed.add(pack3(b.x, b.y, b.z));
  }

  /** Whether a roof of the group from statement `since` on covers the cell of a block (or is its roof). */
  private coveredSince(g: RoofGroup, b: RoofBlock, since: number): boolean {
    if (g.roofs[b.roof].seq >= since) return true;
    for (const q of this.roofIndex.near(b.x, b.z, b.x, b.z)) if (q.seq >= since && this.roofGroups.get(q) === g && layerOf(q, b.y).has(b.x, b.z)) return true;
    return false;
  }

  /** Free gable ends of a Krüppelwalm roof in its group (resolveHips). */
  private hipFreeIn(g: RoofGroup, r: RoofDef): [boolean, boolean] {
    const b = this.roofIndex.box(r);
    return hipFree(r, () => true, this.roofIndex.near(b.x0 - 1, b.z0 - 1, b.x1 + 1, b.z1 + 1).filter((o) => o !== r && this.roofGroups.get(o) === g));
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

/** The cell above. */
function up([x, y, z]: [number, number, number]): [number, number, number] {
  return [x, y + 1, z];
}

/** Decorations of two blocks (tall plants): they also fill the cell above. */
function tallDeco(ex: RoofExtra): boolean {
  return (!!ex.firstzier && tallPlant(ex.firstzier)) || (!!ex.spitze && tallPlant(ex.spitze));
}
