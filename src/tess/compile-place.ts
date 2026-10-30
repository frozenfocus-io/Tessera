import { makeState } from '../core/blockstate';
import { Args, NO } from './args';
import { CompilerBase, pack3, type Vec3 } from './compile-base';
import { hasAxis } from './connect';
import { DIR, type Facing } from './geometry';
import { infoOrigin, Part } from './grid';
import type { BlockSpec, Member, RoleRef } from './palette';
import { asciiKey, TessError, type Statement } from './syntax';
import type { Wall } from './wall';

/**
 * Compiler layer 2 of 5 (see compile.ts): placing blocks. State indices, origins, role
 * references, the commands linie, block and leer, and the cells of Bauteile at and outside walls.
 */

/** Two blocks high plants: placing the lower half brings the upper one. */
const TALL_PLANTS = new Set(['sunflower', 'lilac', 'rose_bush', 'peony', 'tall_grass', 'large_fern', 'pitcher_plant'].map((n) => `minecraft:${n}`));

/** Whether placeSpec also sets the cell above (lower half of a tall plant). */
export function tallPlant(spec: BlockSpec): boolean {
  return spec.kind !== 'role' && TALL_PLANTS.has(spec.state.name) && (spec.state.props.half ?? 'lower') === 'lower';
}

// ---------------------------------------------------------------------------

export abstract class CompilerPlace extends CompilerBase {
  /** A second origin of the running statement (same line in the hover), e.g. for a dormer's roof. */
  taggedOrigin(tag: string): number {
    const o = this.grid.originId(this.line, [], tag);
    this.originSeq[o] ??= this.seq;
    return o;
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

  // ---- Bauteile: cells at and outside the wall

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
}
