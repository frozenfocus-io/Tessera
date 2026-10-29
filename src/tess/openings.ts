import { Args, NO } from './args';
import type { Compiler, FormObj } from './compile';
import { DIR, opposite, type Facing } from './geometry';
import { Part } from './grid';
import type { BlockSpec, RoleRef } from './palette';
import { asciiKey, TessError, type Statement } from './syntax';
import { readSpots, SPOT_KEYS, type Spot, type Wall } from './wall';

/**
 * Openings in walls (Bau-Sprache 2, 6.2 and 6.3): windows of every shape with frame, reveal,
 * depth, bars, shutters and flower boxes; doors with transom or arch, steps and canopy; gates
 * with arches and a portcullis. An opening is a grid of columns (along the wall) and rows; each
 * cell is glass/air, a bar, an arch stair or left as it is. Openings go through the whole wall
 * thickness; outside parts (sills, shutters, boxes, steps, canopies) only go into air.
 */

type Vec3 = [number, number, number];

/** One cell of an opening shape. */
type ShapeCell = 'open' | 'bar' | { stair: 'lo' | 'hi'; half: 'top' | 'bottom' } | null;

export type WindowArt = 'rechteck' | 'bogen' | 'spitzbogen' | 'rund' | 'kreuz' | 'schlitz';
export const WINDOW_ARTS: readonly WindowArt[] = ['rechteck', 'bogen', 'spitzbogen', 'rund', 'kreuz', 'schlitz'];

/** Side of the middle a column is on: 'lo' for the low column numbers, 'hi' for the high ones. */
function sideOfMiddle(i: number, b: number): 'lo' | 'hi' | null {
  const m = (b - 1) / 2;
  return i < m ? 'lo' : i > m ? 'hi' : null;
}

/**
 * Shape of an opening, rows from the bottom. Windows and doors: bogen puts the outer cells of the
 * top row as upside-down stairs; spitzbogen narrows the top rows; rund is a disc with stairs in
 * the corners; kreuz has a bar cross. Gates (stepped=true) with bogen and b ≥ 4: two stairs per
 * side, stepped, the top corner stays wall.
 */
export function openingShape(art: WindowArt, b: number, h: number, sprossen: boolean, stepped = false): ShapeCell[][] {
  const rows: ShapeCell[][] = Array.from({ length: h }, () => Array.from({ length: b }, (): ShapeCell => 'open'));
  const away = (i: number) => sideOfMiddle(i, b) ?? 'lo';
  switch (art) {
    case 'rechteck':
      if (sprossen && b >= 3) for (const r of rows) for (let i = 1; i < b; i += 2) r[i] = 'bar';
      break;
    case 'schlitz':
      break;
    case 'bogen': {
      const top = rows[h - 1];
      if (stepped && b >= 4) {
        top[0] = null;
        top[b - 1] = null;
        top[1] = { stair: 'lo', half: 'top' };
        top[b - 2] = { stair: 'hi', half: 'top' };
        if (h >= 2) {
          rows[h - 2][0] = { stair: 'lo', half: 'top' };
          rows[h - 2][b - 1] = { stair: 'hi', half: 'top' };
        }
      } else {
        top[0] = { stair: 'lo', half: 'top' };
        top[b - 1] = { stair: 'hi', half: 'top' };
      }
      break;
    }
    case 'spitzbogen': {
      const m = (b - 1) / 2;
      const n = Math.min((b - 1) / 2, h - 1);
      for (let k = 0; k < n; k++) {
        const r = rows[h - 1 - k];
        for (let i = 0; i < b; i++) {
          const d = Math.abs(i - m);
          if (d <= k) r[i] = 'open';
          else if (d === k + 1) r[i] = { stair: away(i), half: 'top' };
          else r[i] = null;
        }
      }
      break;
    }
    case 'rund': {
      const m = (b - 1) / 2;
      const lim = b === 3 ? 1 : 5;
      for (let row = 0; row < h; row++)
        for (let i = 0; i < b; i++) {
          const dx = i - m;
          const dy = row - m;
          if (dx * dx + dy * dy <= lim) continue;
          rows[row][i] = { stair: away(i), half: dy > 0 ? 'top' : 'bottom' };
        }
      break;
    }
    case 'kreuz': {
      const mc = (b - 1) / 2;
      const mr = (h - 1) / 2;
      for (let row = 0; row < h; row++) for (let i = 0; i < b; i++) if (i === mc || row === mr) rows[row][i] = 'bar';
      break;
    }
  }
  return rows;
}

/** Facing of a stair that looks away from the middle along the wall. */
function awayFacing(wall: Wall, side: 'lo' | 'hi'): Facing {
  return side === 'hi' ? wall.plus : opposite(wall.plus);
}

/** Checks the art's size rules (spec 6.2) and returns the effective height. */
export function checkWindowArt(a: Args, art: WindowArt, b: number, h: number, what: string): number {
  const line = a.line;
  switch (art) {
    case 'bogen':
      if (b < 2) throw new TessError(line, `${what}: „art=bogen“ braucht mindestens b=2 (die äußeren Zellen der obersten Reihe werden Treppen).`);
      break;
    case 'spitzbogen':
      if (b < 3 || b % 2 === 0) throw new TessError(line, `${what}: „art=spitzbogen“ braucht eine ungerade Breite ab 3 (b=3, 5, 7 …).`);
      break;
    case 'rund':
      if (b !== 3 && b !== 5) throw new TessError(line, `${what}: „art=rund“ gibt es mit b=3 oder b=5.`);
      if (a.has('h') && h !== b) throw new TessError(line, `${what}: Bei „art=rund“ ist die Höhe gleich der Breite (h=${b}).`);
      return b;
    case 'kreuz':
      if (b < 3 || h < 3 || b % 2 === 0 || h % 2 === 0) throw new TessError(line, `${what}: „art=kreuz“ braucht ungerade b und h ab 3, z. B. b=3 h=3.`);
      break;
    case 'schlitz':
      if (b !== 1) throw new TessError(line, `${what}: Eine Schießscharte („art=schlitz“) ist einen Block breit (b=1).`);
      break;
  }
  return h;
}

export interface WindowOpts {
  b: number;
  h: number;
  art: WindowArt;
  glass: RoleRef | null;
  frame: RoleRef | null;
  sill: RoleRef | null;
  lintel: RoleRef | null;
  reveal: RoleRef | null;
  shutters: RoleRef | null;
  bars: RoleRef | null;
  depth: number;
  box: { soil: RoleRef; front: RoleRef; flowers: BlockSpec[] } | null;
  /** Warn when the window touches the bottom or top of the form (as version 1). */
  edgeCheck: boolean;
  what: string;
}

/** fenster <form> <seite> (y=|ebene=) … (6.2) */
export function windowCmd(c: Compiler, st: Statement): void {
  const keys = [...SPOT_KEYS, 'b', 'h', 'art', 'glas', 'rahmen', 'bank', 'sturz', 'laibung', 'laeden', 'sprossen', 'tiefe', 'kasten', 'blumen', 'kastenfront'];
  const a = new Args(st, c.tokens(st), keys);
  const f = c.bauteilForm(a);
  const art = a.choice<WindowArt>('art', WINDOW_ARTS, 'rechteck');
  const b = a.int('b', art === 'rund' ? 3 : 1, 1, 16);
  const h = checkWindowArt(a, art, b, a.int('h', art === 'rund' ? b : 2, 1, 32), 'Das Fenster');
  const spots = readSpots(c, a, f, { width: b, needHeight: true, what: 'Das Fenster' });
  a.done();
  const o = windowOpts(c, a, f, art, b, h);
  for (const s of spots) placeWindow(c, f, s, o);
}

/** Reads the window options of `fenster` (and of a dormer's window). */
export function windowOpts(c: Compiler, a: Args, f: FormObj, art: WindowArt, b: number, h: number, what = 'Das Fenster'): WindowOpts {
  const slit = art === 'schlitz';
  if (slit && a.has('laeden')) throw new TessError(a.line, 'Eine Schießscharte hat keine Läden.');
  if (a.has('sprossen') && !(art === 'kreuz' || (art === 'rechteck' && b >= 3))) {
    throw new TessError(a.line, '„sprossen=“ gilt bei art=rechteck ab b=3 (jede zweite Spalte) und bei art=kreuz (das Kreuz).');
  }
  const glasWord = a.str('glas') ?? (slit ? 'luft' : 'glas');
  const glass = asciiKey(glasWord) === 'luft' ? null : c.ref(glasWord);
  const frameWord = a.str('rahmen') ?? 'rahmen';
  const needFrame = art === 'bogen' || art === 'spitzbogen' || art === 'rund';
  const frame = needFrame || a.has('rahmen') ? c.roleOrNone(frameWord) : null;
  if (needFrame && !frame) throw new TessError(a.line, `${what}: „art=${art}“ braucht einen Rahmen für die Bogentreppen.`);
  const box = a.str('kasten');
  if (!box && (a.has('blumen') || a.has('kastenfront'))) throw new TessError(a.line, '„blumen=“ und „kastenfront=“ gelten nur zusammen mit „kasten=“.');
  if (box && a.has('bank')) throw new TessError(a.line, 'Der Blumenkasten ersetzt die Bank; „bank=“ und „kasten=“ schließen sich aus.');
  const sill = box ? null : c.roleOrNone(a.str('bank') ?? (slit ? 'nein' : frameWord));
  const lintel = c.roleOrNone(a.str('sturz') ?? frameWord);
  const depth = a.int('tiefe', 0, 0, 16);
  if (depth > 0 && f.wall <= depth) throw new TessError(a.line, `„tiefe=${depth}“ braucht eine Wand, die dicker ist als ${depth} („wand=${depth + 1}“ oder mehr bei „${f.name}“).`);
  const sprossen = a.str('sprossen');
  return {
    b,
    h,
    art,
    glass,
    frame,
    sill,
    lintel,
    reveal: a.has('laibung') ? c.ref(a.str('laibung')!) : null,
    shutters: a.has('laeden') ? c.ref(a.str('laeden')!) : null,
    bars: art === 'kreuz' ? c.ref(sprossen ?? frameWord) : sprossen ? c.ref(sprossen) : null,
    depth,
    box: box
      ? {
          soil: c.ref(box),
          front: c.memberRef(a.str('kastenfront') ?? `${frameWord}:falltuer`, 'trapdoor'),
          flowers: a.list('blumen').map((s) => c.palette.blockSpec(s, a.line)),
        }
      : null,
    edgeCheck: true,
    what,
  };
}

/** Cells of the wall from the outer cell inwards (as thick as the form's wall). */
function throughWall(c: Compiler, f: FormObj, p: Vec3, inward: Facing): Vec3[] {
  return c.wallDepth(f, p, inward);
}

/** One window at one spot. */
export function placeWindow(c: Compiler, f: FormObj, s: Spot, o: WindowOpts): void {
  const { wall, start, y: y0 } = s;
  const { b, h } = o;
  const out = wall.out;
  const inward = opposite(out);
  if (o.edgeCheck && (y0 <= f.y0 || (y0 <= f.y1 && y0 + h - 1 >= f.y1))) {
    c.warn(`${o.what} (y=${y0} bis ${y0 + h - 1}) reicht an Boden oder Oberkante von „${f.name}“ (y=${f.y0} bis ${f.y1}).`);
  }
  const shape = openingShape(o.art, b, h, !!o.bars);
  // Reveal first: the opening and the lintel replace it where they overlap.
  if (o.reveal) {
    for (let i = -1; i <= b; i++)
      for (let row = -1; row <= h; row++) {
        if (i >= 0 && i < b && row >= 0 && row < h) continue;
        c.framePut(wall.cell(start + i, y0 + row), o.reveal, o.reveal.member, null, i < 0 || i >= b ? 'y' : wall.axis);
      }
  }
  for (let row = 0; row < h; row++) {
    for (let i = 0; i < b; i++) {
      const cell = shape[row][i];
      if (!cell) continue;
      const p = c.openingCell(wall, start + i, y0 + row, o.what);
      if (!p) continue;
      const cells = throughWall(c, f, p, inward);
      cells.forEach((q, depth) => {
        if (cell === 'open') {
          if (depth === o.depth && o.glass) c.place(q, o.glass, o.glass.member, null, Part.Opening);
          else c.clearCell(q);
        } else if (cell === 'bar') {
          if (depth === o.depth) c.place(q, o.bars!, o.bars!.member, null, Part.Frame, 'y');
          else c.clearCell(q);
        } else {
          c.place(q, o.frame!, 'stairs', { facing: awayFacing(wall, cell.stair), half: cell.half }, Part.Frame);
        }
      });
    }
  }
  if (o.lintel) {
    for (let i = -1; i <= b; i++) c.framePut(wall.cell(start + i, y0 + h), o.lintel, o.lintel.member, null, wall.axis);
  }
  if (o.sill) {
    for (let i = 0; i < b; i++) {
      const p = wall.cell(start + i, y0 - 1);
      if (!p) continue;
      c.attach(c.outside(p, out), o.sill, 'stairs', { facing: inward, half: 'top' }, 'Die Fensterbank');
    }
  }
  if (o.box) {
    const { soil, front, flowers } = o.box;
    for (let i = 0; i < b; i++) {
      const p = wall.cell(start + i, y0 - 1);
      if (!p) continue;
      const q = c.outside(p, out);
      const placed = c.attach(q, soil, soil.member, null, 'Der Blumenkasten');
      c.attach(c.outside(q, out), front, 'trapdoor', { facing: out, open: 'true', half: 'bottom' }, 'Der Blumenkasten');
      if (placed && flowers.length) {
        const top: Vec3 = [q[0], q[1] + 1, q[2]];
        c.attachSpec(top, flowers[i % flowers.length], 'Die Blume');
      }
    }
    for (const [i, dir] of [
      [-1, opposite(wall.plus)],
      [b, wall.plus],
    ] as const) {
      const p = wall.cell(start + i, y0 - 1);
      if (!p) continue;
      c.attach(c.outside(p, out), front, 'trapdoor', { facing: dir, open: 'true', half: 'bottom' }, 'Der Blumenkasten');
    }
  }
  if (o.shutters) {
    for (const i of [-1, b]) {
      for (let row = 0; row < h; row++) {
        const p = wall.cell(start + i, y0 + row);
        if (!p) continue;
        c.attach(c.outside(p, out), o.shutters, 'trapdoor', { facing: out, open: 'true', half: 'bottom' }, 'Der Fensterladen');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Doors

export interface DoorOpts {
  b: number;
  h: number;
  art: 'rechteck' | 'bogen' | 'spitzbogen';
  door: RoleRef | null;
  frame: RoleRef | null;
  transom: RoleRef | null;
  steps: number;
  stepRole: RoleRef | null;
  canopy: RoleRef | null;
}

/** tür <form> <seite> … (6.3) */
export function doorCmd(c: Compiler, st: Statement): void {
  const keys = [...SPOT_KEYS, 'b', 'h', 'art', 'tuer', 'rahmen', 'oberlicht', 'stufen', 'vordach'];
  const a = new Args(st, c.tokens(st), keys);
  const f = c.bauteilForm(a);
  const b = a.int('b', 1, 1, 2);
  const spots = readSpots(c, a, f, { width: b, needHeight: false, defaultY: f.y0 + 1, what: 'Die Tür' });
  a.done();
  const o = doorOpts(c, a, b);
  for (const s of spots) placeDoor(c, f, s, o);
}

export function doorOpts(c: Compiler, a: Args, b: number): DoorOpts {
  const h = a.int('h', 2, 2, 4);
  const art = a.choice('art', ['rechteck', 'bogen', 'spitzbogen'] as const, 'rechteck');
  if (art !== 'rechteck') {
    if (b !== 2) throw new TessError(a.line, `Die Tür: „art=${art}“ braucht b=2 (der Bogen entsteht aus den beiden Zellen über den Türflügeln).`);
    if (h < 3) throw new TessError(a.line, `Die Tür: „art=${art}“ braucht h=3 oder h=4 (der Bogen sitzt über der Tür).`);
  }
  if (a.has('oberlicht') && h < 3) throw new TessError(a.line, '„oberlicht=“ braucht h=3 oder h=4 (das Oberlicht sitzt über der zwei Blöcke hohen Tür).');
  const doorWord = a.str('tuer') ?? 'tuer';
  const frameWord = a.str('rahmen');
  const frame = c.roleOrNone(frameWord ?? 'rahmen');
  const steps = a.int('stufen', 0, 0, 32);
  if (art !== 'rechteck' && !frame) throw new TessError(a.line, `Die Tür: „art=${art}“ braucht einen Rahmen für die Bogentreppen.`);
  return {
    b,
    h,
    art,
    door: asciiKey(doorWord) === 'luft' ? null : c.ref(doorWord),
    frame,
    transom: h > 2 ? c.ref(a.str('oberlicht') ?? 'glas') : null,
    steps,
    stepRole: steps ? (frame ?? c.ref('rahmen')) : null,
    canopy: a.has('vordach') ? c.ref(a.str('vordach')!) : null,
  };
}

/** One door at one spot. */
export function placeDoor(c: Compiler, f: FormObj, s: Spot, o: DoorOpts): void {
  const { wall, start: t0, y: y0 } = s;
  const { b, h } = o;
  const out = wall.out;
  const facing = opposite(out);
  const inward = facing;
  for (let i = 0; i < b; i++) {
    const t = t0 + i;
    const lower = c.openingCell(wall, t, y0, 'Die Tür', true);
    const upper = c.openingCell(wall, t, y0 + 1, 'Die Tür');
    if (!lower || !upper) continue;
    if (o.door) {
      let hinge = 'left';
      if (b === 2) {
        // Hinges outside: the leaf on the left (seen from inside) has its hinge on the left.
        const left = DIR[ccwOf(facing)];
        const other = wall.cell(i === 0 ? t0 + 1 : t0, y0);
        if (other) hinge = (other[0] - lower[0]) * left[0] + (other[2] - lower[2]) * left[1] > 0 ? 'right' : 'left';
      }
      const id = c.palette.pick(o.door.role, 'door', lower[0], lower[1], lower[2], c.line);
      c.put(lower[0], lower[1], lower[2], c.sid(id, { facing, half: 'lower', hinge }), Part.Opening);
      c.put(upper[0], upper[1], upper[2], c.sid(id, { facing, half: 'upper', hinge }), Part.Opening);
    } else {
      c.clearCell(lower);
      c.clearCell(upper);
    }
    // Through a thick wall: a passage behind the door.
    for (const p of [lower, upper]) {
      const cells = c.wallDepth(f, p, inward);
      for (let k = 1; k < cells.length; k++) c.clearCell(cells[k]);
    }
    // Transom or arch above the door leaves.
    for (let row = 2; row < h; row++) {
      const p = c.openingCell(wall, t, y0 + row, 'Das Oberlicht');
      if (!p) continue;
      const arch = o.art !== 'rechteck' && row === h - 1;
      const cells = c.wallDepth(f, p, inward);
      cells.forEach((q, depth) => {
        if (arch) c.place(q, o.frame!, 'stairs', { facing: i === 0 ? opposite(wall.plus) : wall.plus, half: 'top' }, Part.Frame);
        else if (depth === 0) c.place(q, o.transom!, o.transom!.member, null, Part.Opening);
        else c.clearCell(q);
      });
    }
  }
  if (o.frame) {
    for (let row = 0; row < h; row++) {
      c.framePut(wall.cell(t0 - 1, y0 + row), o.frame, o.frame.member, null, 'y');
      c.framePut(wall.cell(t0 + b, y0 + row), o.frame, o.frame.member, null, 'y');
    }
    for (let t = t0 - 1; t <= t0 + b; t++) c.framePut(wall.cell(t, y0 + h), o.frame, o.frame.member, null, wall.axis);
  }
  if (o.steps && o.stepRole) {
    const role = o.stepRole;
    for (let i = 0; i < b; i++) {
      const p = wall.cell(t0 + i, y0);
      if (!p) continue;
      for (let k = 1; k <= o.steps; k++) {
        const [dx, dz] = DIR[out];
        const x = p[0] + dx * k;
        const z = p[2] + dz * k;
        c.outPlace([x, y0 - k, z], role, 'stairs', { facing, half: 'bottom' }, Part.Attachment, undefined, 'Die Stufen');
        for (let yy = y0 - k - 1; yy >= y0 - o.steps; yy--) c.outPlace([x, yy, z], role, 'block', null, Part.Attachment, 'y', 'Die Stufen');
      }
    }
  }
  if (o.canopy) {
    const yv = y0 + h + (o.frame ? 1 : 0);
    for (let t = t0 - 1; t <= t0 + b; t++) {
      const p = wall.cell(t, yv) ?? wall.cell(t, y0 + h);
      if (!p) continue;
      c.outPlace(c.outside([p[0], yv, p[2]], out), o.canopy, 'stairs', { facing: inward, half: 'bottom' }, Part.Attachment, undefined, 'Das Vordach');
    }
  }
}

function ccwOf(f: Facing): Facing {
  return f === 'north' ? 'west' : f === 'west' ? 'south' : f === 'south' ? 'east' : 'north';
}

// ---------------------------------------------------------------------------
// Gates

/** tor <form> <seite> … b= h= [art=] [rahmen=] [fallgitter=] (6.3) */
export function gateCmd(c: Compiler, st: Statement): void {
  const keys = [...SPOT_KEYS, 'b', 'h', 'art', 'rahmen', 'fallgitter'];
  const a = new Args(st, c.tokens(st), keys);
  const f = c.bauteilForm(a);
  const b = a.requireInt('b', 1, 32, 'Die Breite der Öffnung.');
  const h = a.requireInt('h', 1, 64, 'Die Höhe der Öffnung.');
  const art = a.choice('art', ['rechteck', 'bogen', 'spitzbogen'] as const, 'rechteck');
  checkWindowArt(a, art, b, h, 'Das Tor');
  const spots = readSpots(c, a, f, { width: b, needHeight: false, defaultY: f.y0, what: 'Das Tor' });
  a.done();
  const frame = art === 'rechteck' && !a.has('rahmen') ? null : c.ref(a.str('rahmen') ?? 'rahmen');
  const grid = a.has('fallgitter') ? c.memberRef(a.str('fallgitter')!, 'fence') : null;
  const shape = openingShape(art, b, h, false, true);
  // The portcullis hangs in the highest row that is open.
  let gridRow = -1;
  for (let row = h - 1; row >= 0 && gridRow < 0; row--) if (shape[row].includes('open')) gridRow = row;
  for (const s of spots) {
    const { wall, start, y: y0 } = s;
    const inward = opposite(wall.out);
    for (let row = 0; row < h; row++) {
      for (let i = 0; i < b; i++) {
        const cell = shape[row][i];
        if (!cell) continue;
        const p = c.openingCell(wall, start + i, y0 + row, 'Das Tor', row === 0);
        if (!p) continue;
        c.wallDepth(f, p, inward).forEach((q, depth) => {
          if (cell === 'open') {
            if (row === gridRow && grid && depth === 0) c.place(q, grid, grid.member, null, Part.Frame);
            else c.clearCell(q);
          } else if (cell !== 'bar') {
            c.place(q, frame!, 'stairs', { facing: awayFacing(wall, cell.stair), half: cell.half }, Part.Frame);
          }
        });
      }
    }
  }
}

/** Whether a value means "nothing" (nein, aus …). */
export function isNo(v: string | undefined): boolean {
  return v !== undefined && NO.has(v.toLowerCase());
}
