import { makeState } from '../core/blockstate';
import { Args, YES, NO } from './args';
import type { Compiler, Vec3 } from './compile';
import { ccw, cw, DIR, opposite, type Facing } from './geometry';
import { cellKey, Part } from './grid';
import type { BlockSpec } from './palette';
import { asciiKey, TessError, type AsciiLine, type Statement } from './syntax';
import { cellAngle, mainOf, readSpots, SPOT_KEYS } from './wall';
import { turnWritten } from './xform';

/**
 * Freistil (Bau-Sprache 2, section 9): characters for drawings (`zeichen`), drawn layers
 * (`ebene`, `ebenen`) and drawn walls seen from outside (`ansicht`). Space leaves a cell as it
 * is, `.` makes it air. In a module the drawing is local and turns with it.
 */

export interface CharDef {
  spec: BlockSpec;
  /** States written with the character (relative directions resolved per cell in ansicht). */
  props: Record<string, string>;
  depth: number;
  /** fest=ja: the connection pass leaves the block as it is. */
  fixed: boolean;
  line: number;
}

const RELATIVE = new Set(['aussen', 'innen', 'links', 'rechts']);
const WORDS: Record<string, string> = { n: 'north', nord: 'north', o: 'east', ost: 'east', s: 'south', sued: 'south', w: 'west', west: 'west', oben: 'up', unten: 'down' };

/** zeichen <z> <block-angabe> [tiefe=<n>] [fest=ja] [<zustand>=<wert> …] */
export function charCmd(c: Compiler, st: Statement): void {
  const ch = st.glyph;
  if (!ch) throw new TessError(st.line, '„zeichen“ braucht genau ein Zeichen und einen Block, z. B. „zeichen B balken“.');
  if (ch === '|') throw new TessError(st.line, '„|“ beginnt ASCII-Zeilen und kann kein Zeichen sein.');
  if (ch === '.') throw new TessError(st.line, '„.“ steht in Zeichnungen fest für Luft.');
  const tokens = c.tokens(st);
  const head = tokens[0];
  if (!head || head.kind !== 'word') throw new TessError(st.line, `Bei „zeichen ${ch}“ fehlt der Block (Rolle, rolle:glied oder Block-ID).`);
  const props: Record<string, string> = {};
  let depth = 0;
  let fixed = false;
  for (const t of tokens.slice(1)) {
    if (t.kind !== 'pair') throw new TessError(st.line, `„${'text' in t ? t.text : ''}“: Nach dem Block stehen nur Angaben wie tiefe=1, fest=ja oder Zustände (facing=links).`);
    if (t.key === 'tiefe') {
      if (!/^-?\d+$/.test(t.value)) throw new TessError(st.line, `„tiefe=${t.value}“: Erwartet wird eine ganze Zahl.`);
      depth = parseInt(t.value, 10);
      if (Math.abs(depth) > 16) throw new TessError(st.line, `„tiefe=${t.value}“: erlaubt ist −16 bis 16.`);
    } else if (t.key === 'fest') {
      const v = asciiKey(t.value);
      if (!YES.has(v) && !NO.has(v)) throw new TessError(st.line, `„fest=${t.value}“: ja oder nein.`);
      fixed = YES.has(v);
    } else {
      const v = asciiKey(t.value);
      props[t.key] = RELATIVE.has(v) ? v : (WORDS[v] && /facing$/.test(t.key) ? WORDS[v] : t.value);
    }
  }
  const spec = c.palette.blockSpec(head.text, st.line);
  scopeChars(c).set(ch, { spec, props, depth, fixed, line: st.line });
}

/** Characters of the innermost scope that may hold them (module or file, not a loop). */
function scopeChars(c: Compiler): Map<string, CharDef> {
  for (let i = c.frames.length - 1; i >= 0; i--) if (!c.frames[i].loopVar) return c.frames[i].chars as Map<string, CharDef>;
  return c.frames[0].chars as Map<string, CharDef>;
}

function findChar(c: Compiler, ch: string, line: number): CharDef {
  for (const f of c.visibleFrames()) {
    const d = (f.chars as Map<string, CharDef>).get(ch);
    if (d) return d;
  }
  throw new TessError(line, `Das Zeichen „${ch}“ ist nicht festgelegt (zeichen ${ch} <block>).`);
}

/**
 * Places a character at a cell. `out` is the outward direction of the wall cell (ansicht);
 * without it relative directions are an error. `mirrored`: links and rechts swap.
 */
function put(c: Compiler, d: CharDef, p: Vec3, out: Facing | null, line: number): void {
  let id: string;
  let base: Record<string, string> = {};
  if (d.spec.kind === 'role') id = c.palette.pick(d.spec.ref.role, d.spec.ref.member, p[0], p[1], p[2], line);
  else {
    id = d.spec.state.name;
    base = { ...d.spec.state.props };
  }
  const fixedProps: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.props)) {
    if (!RELATIVE.has(v)) {
      base[k] = v;
      continue;
    }
    if (!out) throw new TessError(line, `„${k}=${v}“: Relative Richtungen (aussen, innen, links, rechts) gibt es nur in „ansicht“.`);
    // Seen from outside: rechts = counter-clockwise next to aussen, links = clockwise.
    const m = c.xf.mirrored;
    fixedProps[k] = v === 'aussen' ? out : v === 'innen' ? opposite(out) : (v === 'rechts') !== m ? ccw(out) : cw(out);
  }
  let s = makeState(id, base);
  if (c.xf.turns) s = turnWritten(s, c.xf);
  const props = { ...s.props, ...fixedProps };
  c.put(p[0], p[1], p[2], c.sid(s.name, Object.keys(props).length ? props : null), Part.Plain);
  if (d.fixed) c.grid.fixed.add(cellKey(p[0], p[1], p[2]));
}

function drawCell(c: Compiler, ch: string, p: Vec3, out: Facing | null, line: number): void {
  if (ch === ' ') return;
  if (ch === '.') {
    c.clearCell(p);
    return;
  }
  const d = findChar(c, ch, line);
  if (d.depth && out) {
    const [dx, dz] = DIR[out];
    p = [p[0] + dx * d.depth, p[1], p[2] + dz * d.depth];
  }
  put(c, d, p, out, line);
}

/** Corner of a drawing: the coordinate as written (local in a module). */
function corner(a: Args, what: string): Vec3 {
  const t = a.positional.find((x) => x.kind === 'coord');
  const abs = a.coord(what);
  const local = t?.kind === 'coord' && t.local ? t.local : abs;
  return [local[0], local[1], local[2]];
}

function drawLayer(c: Compiler, lines: AsciiLine[], x: number, y: number, z: number): void {
  lines.forEach((l, row) => {
    for (let i = 0; i < l.text.length; i++) {
      const ch = l.text[i];
      if (ch === ' ') continue;
      c.line = l.line;
      drawCell(c, ch, c.xf.map(x + i, y, z + row), null, l.line);
    }
  });
}

/** ebene x,y,z + ASCII lines: rows run south (+z), characters east (+x). */
export function layerCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), []);
  const [x, y, z] = corner(a, 'Die Zelle des ersten Zeichens');
  a.done();
  const lines = st.ascii ?? [];
  if (!lines.length) throw new TessError(st.line, 'Unter „ebene“ fehlt die Zeichnung (Zeilen, die mit | beginnen).');
  if (lines.some((l) => l.text === '-')) throw new TessError(st.line, '„|-“ trennt Lagen nur bei „ebenen“.');
  try {
    drawLayer(c, lines, x, y, z);
  } finally {
    c.line = st.line;
  }
}

/** ebenen x,y,z + ASCII lines, layers separated by a line "|-"; the first layer at y. */
export function layersCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), []);
  const [x, y, z] = corner(a, 'Die Zelle des ersten Zeichens');
  a.done();
  const lines = st.ascii ?? [];
  if (!lines.length) throw new TessError(st.line, 'Unter „ebenen“ fehlt die Zeichnung (Zeilen, die mit | beginnen, Lagen getrennt durch |-).');
  const groups: AsciiLine[][] = [[]];
  for (const l of lines) {
    if (l.text === '-') groups.push([]);
    else groups[groups.length - 1].push(l);
  }
  try {
    groups.forEach((g, k) => drawLayer(c, g, x, y + k, z));
  } finally {
    c.line = st.line;
  }
}

/**
 * ansicht <form> <seite> [x=|z=|versatz=] (y=|ebene=) + ASCII lines: a wall seen from outside.
 * The lowest line lies at the height, each line above one layer higher; every character goes
 * to the wall cell of its column in its layer (6.1), also on round forms; tiefe= moves it out.
 */
export function viewCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), SPOT_KEYS.filter((k) => k !== 'anzahl' && k !== 'abstand'));
  const f = c.bauteilForm(a);
  const lines = st.ascii ?? [];
  if (!lines.length) throw new TessError(st.line, 'Unter „ansicht“ fehlt die Zeichnung (Zeilen, die mit | beginnen).');
  const width = Math.max(1, ...lines.map((l) => l.text.length));
  const [spot] = readSpots(c, a, f, { width, needHeight: true, repeat: false, what: 'Die Ansicht' });
  a.done();
  const { wall } = spot;
  const { px, pz } = c.centrePoint(f);
  // Columns grow towards wall.plus; the first character is on the left seen from outside
  // (clockwise next to the outside). A mirrored module draws its mirror image.
  const leftIsPlus = wall.plus === cw(wall.out);
  const firstAtHigh = leftIsPlus !== c.xf.mirrored;
  try {
    lines.forEach((l, k) => {
      const yy = spot.y + (lines.length - 1 - k);
      c.line = l.line;
      for (let i = 0; i < l.text.length; i++) {
        const ch = l.text[i];
        if (ch === ' ') continue;
        const col = firstAtHigh ? spot.start + width - 1 - i : spot.start + i;
        const cell = wall.cell(col, yy);
        if (!cell) {
          c.warn(`Die Ansicht trifft in Lage y=${yy} keine Wand (Zeichen ${i + 1} der Zeile).`, l.line);
          continue;
        }
        const out = wall.mode === 'face' ? wall.out : outAt(cell[0], cell[2], px, pz);
        drawCell(c, ch, cell, out, l.line);
      }
    });
  } finally {
    c.line = st.line;
  }
}

/** Outward main direction of a wall cell of a round form (from the centre). */
function outAt(x: number, z: number, px: number, pz: number): Facing {
  const ang = cellAngle(x, z, px, pz);
  return mainOf(Math.round(ang / 90) * 90) ?? 'north';
}
