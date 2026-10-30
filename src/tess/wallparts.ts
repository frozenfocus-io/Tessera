import { Args } from './args';
import { CellSet, facingTowardsSet, SIDES } from './cells';
import type { Compiler, FormObj, Vec3 } from './compile';
import { DiscShape } from './forms';
import { DIR, opposite, parseSide, ringByAngle, type Facing } from './geometry';
import { Part } from './grid';
import type { BlockSpec, RoleRef } from './palette';
import { Xf } from './xform';
import { asciiKey, TessError, type Statement } from './syntax';
import { cellAngle, heightOf, norm, sideAngle } from './wall';

/**
 * Wall articulation (Bau-Sprache 2, 6.4) and crenellations (6.6): cornices around a form,
 * pilasters and buttresses in front of the wall, single braces, merlons with pattern, height,
 * caps and machicolations.
 */

// ---------------------------------------------------------------------------
// Sides of cells around a form (seiten=)

const MAIN: readonly Facing[] = ['north', 'east', 'south', 'west'];

/** Parses `seiten=n,o` / `seiten=alle` into compass angles (null = all sides). */
export function parseSides(a: Args, key = 'seiten', xf: Xf = Xf.ID): number[] | null {
  const v = a.str(key);
  if (v === undefined || asciiKey(v) === 'alle') return null;
  return v.split(',').map((w) => {
    const ang = sideAngle(w.trim());
    if (ang === null) throw new TessError(a.line, `„${key}=${v}“: „${w}“ ist keine Seite (n, o, s, w, no, so, sw, nw oder alle).`);
    return xf.angle(ang);
  });
}

/**
 * Whether a cell outside the form (next to the wall) belongs to one of the given sides. Straight
 * forms go by the face the cell lies in front of (a corner cell needs both of its sides); round
 * forms by the angle from the centre (main sides ±45°, diagonals ±22.5°).
 */
export function onSides(c: Compiler, f: FormObj, O: CellSet, x: number, z: number, sides: number[] | null): boolean {
  if (!sides) return true;
  if (f.kind === 'zylinder' || f.kind === 'vieleck') {
    const { px, pz } = c.centrePoint(f);
    const a = cellAngle(x, z, px, pz);
    return sides.some((s) => {
      const d = Math.abs(norm(a - s + 180) - 180);
      return d <= (s % 90 === 0 ? 45 : 22.5) + 1e-9;
    });
  }
  const dirs: number[] = [];
  for (const s of SIDES) if (O.has(x - s.dx, z - s.dz)) dirs.push(MAIN.indexOf(s.facing) * 90);
  if (dirs.length) return dirs.some((d) => sides.includes(d));
  // Diagonal corner cell: the diagonal itself, or both of its sides.
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    if (!O.has(x + dx, z + dz)) continue;
    const ns = dz > 0 ? 0 : 180; // the form lies south of the cell: north side
    const ew = dx > 0 ? 270 : 90; // the form lies east of the cell: west side
    const diag = ns === 0 ? (ew === 270 ? 315 : 45) : ew === 270 ? 225 : 135;
    return sides.includes(diag) || (sides.includes(ns) && sides.includes(ew));
  }
  return false;
}

/** Cells of a ring outside an outline: air or not, with an 8-neighbour in the outline. */
export function bandCells(O: CellSet): [number, number][] {
  return O.dilate(1).minus(O).list();
}

// ---------------------------------------------------------------------------
// gesims

/** gesims <form> (y=|ebene=) [rolle] [art=treppe|stufe|block|kragen|zahn] [seiten=…] */
export function corniceCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), ['y', 'ebene', 'art', 'seiten']);
  const f = c.bauteilForm(a);
  const roleWord = a.optionalWord();
  a.done();
  const ref = roleWord ? c.ref(roleWord) : f.role;
  const y = heightOf(c, a, f, true, undefined, 'Die Lage des Gesimses');
  const art = a.choice('art', ['treppe', 'stufe', 'block', 'kragen', 'zahn'] as const, 'treppe');
  const sides = parseSides(a, 'seiten', c.xf);
  if (y < f.y0 - 1 || y > f.y1 + 1) throw new TessError(st.line, `Das Gesims (y=${y}) liegt nicht an „${f.name}“ (y=${f.y0} bis ${f.y1}).`);
  const O = c.outlineAt(f, Math.max(f.y0, Math.min(f.y1, y)));
  const inO = (x: number, z: number) => O.has(x, z);
  const what = 'Das Gesims';
  for (const [x, z] of bandCells(O)) {
    if (!onSides(c, f, O, x, z, sides)) continue;
    const p: Vec3 = [x, y, z];
    const facing = facingTowardsSet(x, z, inO, 'z') ?? 'north';
    switch (art) {
      case 'treppe':
        c.outPlace(p, ref, 'stairs', { facing, half: 'top' }, Part.Attachment, undefined, what);
        break;
      case 'stufe':
        c.outPlace(p, ref, 'slab', { type: 'top' }, Part.Attachment, undefined, what);
        break;
      case 'block':
        c.outPlace(p, ref, 'block', null, Part.Attachment, 'y', what);
        break;
      case 'kragen':
        c.outPlace(p, ref, 'block', null, Part.Attachment, 'y', what);
        c.outPlace([x, y - 1, z], ref, 'stairs', { facing, half: 'top' }, Part.Attachment, undefined, what);
        break;
      case 'zahn':
        if ((((x + z) % 2) + 2) % 2 === 0) c.outPlace(p, ref, 'block', null, Part.Attachment, 'y', what);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// pfeiler

/** Outermost cell of an outline in a direction, in the row/column through t. */
function outerAt(O: CellSet, dir: Facing, t: number): [number, number] | null {
  const along: 'x' | 'z' = dir === 'north' || dir === 'south' ? 'x' : 'z';
  let best: [number, number] | null = null;
  const [dx, dz] = DIR[dir];
  if (along === 'x') {
    for (let z = O.z0; z <= O.z1; z++) if (O.has(t, z) && !O.has(t + dx, z + dz) && (!best || z * dz > best[1] * dz)) best = [t, z];
  } else {
    for (let x = O.x0; x <= O.x1; x++) if (O.has(x, t) && !O.has(x + dx, t + dz) && (!best || x * dx > best[0] * dx)) best = [x, t];
  }
  return best;
}

/** pfeiler <form> [seiten=] [an=raster|ecken] [abstand=4] [versatz=0] [breite=1] [tiefe=1] [von=] [bis=] <rolle> [kopf=] [fuss=] [art=gerade|strebe] */
export function pillarCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), ['seiten', 'an', 'abstand', 'versatz', 'breite', 'tiefe', 'von', 'bis', 'kopf', 'fuss', 'art']);
  const f = c.bauteilForm(a);
  const ref = c.ref(a.word1('Die Rolle der Pfeiler'));
  a.done();
  const sides = parseSides(a, 'seiten', c.xf);
  const an = a.choice('an', ['raster', 'ecken'] as const, 'raster');
  const step = a.int('abstand', 4, 1, 256);
  const shift = a.int('versatz', 0, -256, 256);
  const width = a.int('breite', 1, 1, 16);
  const depth = a.int('tiefe', 1, 1, 16);
  const von = a.int('von', f.y0, -4000, 4000);
  const bis = a.int('bis', f.y1, -4000, 4000);
  if (bis < von) throw new TessError(st.line, `„bis=${bis}“ liegt unter „von=${von}“.`);
  const art = a.choice('art', ['gerade', 'strebe'] as const, 'gerade');
  const head = a.has('kopf') ? c.spec(a.str('kopf')!) : null;
  const foot = a.has('fuss') ? c.spec(a.str('fuss')!) : null;
  if (an === 'ecken' && (a.has('abstand') || a.has('versatz') || a.has('breite'))) throw new TessError(st.line, '„abstand=“, „versatz=“ und „breite=“ gelten bei „an=raster“; an den Ecken ist ein Pfeiler „tiefe“ × „tiefe“ groß.');
  const what = 'Der Pfeiler';
  const H = bis - von + 1;
  /** Depth of a buttress in layer y (equal sections from `depth` down to 1). */
  const depthAt = (y: number): number => {
    if (art === 'gerade') return depth;
    const i = Math.min(depth - 1, Math.floor(((y - von) * depth) / H));
    return depth - i;
  };
  const refY = Math.max(f.y0, Math.min(f.y1, von));
  const tops: { x: number; z: number; toWall: Facing }[] = [];
  const bottoms: { x: number; z: number }[] = [];

  if (an === 'raster') {
    const pieces = c.piecesAt(f, refY);
    let columns: { dir: Facing; t: number }[] = [];
    if (pieces) {
      for (const pc of pieces) {
        if (!sides || sides.includes(MAIN.indexOf(pc.dir) * 90)) {
          const ts = pc.cells.map(([x, z]) => (pc.axis === 'x' ? x : z));
          const t0 = ts[0];
          const t1 = ts[ts.length - 1];
          for (let t = t0 + shift; t <= t1; t += step) {
            if (t < t0) continue;
            for (let k = 0; k < width && t + k <= t1; k++) columns.push({ dir: pc.dir, t: t + k });
          }
        }
      }
    } else {
      // Round forms: every `abstand` wall cells along the ring, outwards from the centre.
      const O = c.outlineAt(f, refY);
      const dist = c.insideDist(O);
      const { px, pz } = c.centrePoint(f);
      const ring = O.list()
        .filter(([x, z]) => O.at(dist, x, z) === 1)
        .sort((p, q) => cellAngle(p[0], p[1], px, pz) - cellAngle(q[0], q[1], px, pz));
      columns = [];
      for (let i = ((shift % step) + step) % step; i < ring.length; i += step) {
        const [x, z] = ring[i];
        if (!onSides(c, f, O, x, z, sides)) continue;
        const open = SIDES.filter((s) => !O.has(x + s.dx, z + s.dz));
        if (!open.length) continue;
        // Most outward open side.
        const ang = cellAngle(x, z, px, pz);
        open.sort((p, q) => Math.abs(norm(MAIN.indexOf(p.facing) * 90 - ang + 180) - 180) - Math.abs(norm(MAIN.indexOf(q.facing) * 90 - ang + 180) - 180));
        const dir = open[0].facing;
        columns.push({ dir, t: dir === 'north' || dir === 'south' ? x : z });
      }
    }
    for (const col of columns) {
      const [dx, dz] = DIR[col.dir];
      let last: [number, number] | null = null;
      for (let y = von; y <= bis; y++) {
        const O = c.outlineAt(f, Math.max(f.y0, Math.min(f.y1, y)));
        const w = outerAt(O, col.dir, col.t);
        if (!w) continue;
        const d = depthAt(y);
        for (let k = 1; k <= d; k++) c.outPlace([w[0] + dx * k, y, w[1] + dz * k], ref, ref.member, null, Part.Attachment, 'y', what);
        // Setback of a buttress: a stair rising towards the wall on the cell given up.
        if (art === 'strebe' && y > von && depthAt(y - 1) > d) {
          for (let k = d + 1; k <= depthAt(y - 1); k++) c.outPlace([w[0] + dx * k, y, w[1] + dz * k], ref, 'stairs', { facing: opposite(col.dir), half: 'bottom' }, Part.Attachment, undefined, what);
        }
        if (y === von) for (let k = 1; k <= d; k++) bottoms.push({ x: w[0] + dx * k, z: w[1] + dz * k });
        last = w;
      }
      if (last) for (let k = 1; k <= depthAt(bis); k++) tops.push({ x: last[0] + dx * k, z: last[1] + dz * k, toWall: opposite(col.dir) });
    }
  } else {
    const O = c.outlineAt(f, refY);
    const { px, pz } = c.centrePoint(f);
    for (const [cx, cz] of c.cornersAt(f, refY).list()) {
      let sx = 0;
      let sz = 0;
      if (!O.has(cx - 1, cz)) sx = -1;
      else if (!O.has(cx + 1, cz)) sx = 1;
      if (!O.has(cx, cz - 1)) sz = -1;
      else if (!O.has(cx, cz + 1)) sz = 1;
      if (!sx) sx = cx + 0.5 >= px ? 1 : -1;
      if (!sz) sz = cz + 0.5 >= pz ? 1 : -1;
      if (sides) {
        const ns = sz < 0 ? 0 : 180;
        const ew = sx > 0 ? 90 : 270;
        const diag = ns === 0 ? (ew === 90 ? 45 : 315) : ew === 90 ? 135 : 225;
        if (!sides.includes(ns) && !sides.includes(ew) && !sides.includes(diag)) continue;
      }
      for (let y = von; y <= bis; y++) {
        const d = depthAt(y);
        for (let i = 1; i <= d; i++) for (let j = 1; j <= d; j++) c.outPlace([cx + sx * i, y, cz + sz * j], ref, ref.member, null, Part.Attachment, 'y', what);
        if (art === 'strebe' && y > von && depthAt(y - 1) > d) {
          const prev = depthAt(y - 1);
          for (let i = 1; i <= prev; i++)
            for (let j = 1; j <= prev; j++) {
              if (i <= d && j <= d) continue;
              const toWall: Facing = i > j ? (sx > 0 ? 'west' : 'east') : sz > 0 ? 'north' : 'south';
              c.outPlace([cx + sx * i, y, cz + sz * j], ref, 'stairs', { facing: toWall, half: 'bottom' }, Part.Attachment, undefined, what);
            }
        }
      }
      for (let i = 1; i <= depthAt(bis); i++)
        for (let j = 1; j <= depthAt(bis); j++) {
          tops.push({ x: cx + sx * i, z: cz + sz * j, toWall: sz > 0 ? 'north' : 'south' });
          if (depthAt(von) >= i && depthAt(von) >= j) bottoms.push({ x: cx + sx * i, z: cz + sz * j });
        }
    }
  }
  for (const t of tops) {
    if (head) c.outPlaceSpec([t.x, bis + 1, t.z], head, Part.Attachment, what);
    else if (art === 'strebe') c.outPlace([t.x, bis + 1, t.z], ref, 'stairs', { facing: t.toWall, half: 'bottom' }, Part.Attachment, undefined, what);
  }
  if (foot) for (const b of bottoms) c.outPlaceSpec([b.x, von - 1, b.z], foot, Part.Attachment, what);
}

// ---------------------------------------------------------------------------
// strebe

/** strebe x,y,z richtung=<seite> laenge=<n> <rolle>: upside-down stairs, one cell out and one up per step. */
export function buttressCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), ['richtung', 'laenge']);
  const [x, y, z] = a.coord('Der Anfang');
  const ref = c.ref(a.word1('Die Rolle'));
  a.done();
  const dirWord = a.str('richtung');
  if (!dirWord) throw new TessError(st.line, 'Bei „strebe“ fehlt „richtung=“ (n, o, s oder w): die Richtung, in die die Strebe nach oben ausläuft.');
  const side = parseSide(asciiKey(dirWord));
  if (!side) throw new TessError(st.line, `„richtung=${dirWord}“ ist keine Seite (n, o, s oder w).`);
  const dir = c.xf.facing(side);
  const n = a.requireInt('laenge', 1, 256, 'Die Zahl der Schritte.');
  const [dx, dz] = DIR[dir];
  for (let i = 0; i < n; i++) c.place([x + dx * i, y + i, z + dz * i], ref, 'stairs', { facing: opposite(dir), half: 'top' }, Part.Strut);
}

// ---------------------------------------------------------------------------
// zinnen

/** zinnen <form> [rolle] [muster=1:1] [hoehe=1] [kappe=] [vorkragung=0|1 konsolen=R] */
export function crenellationsCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), ['muster', 'hoehe', 'kappe', 'vorkragung', 'konsolen']);
  const f = c.bauteilForm(a);
  const roleWord = a.optionalWord();
  a.done();
  const ref = roleWord ? c.ref(roleWord) : f.role;
  const m = /^(\d+):(\d+)$/.exec(a.str('muster') ?? '1:1');
  if (!m || +m[1] < 1 || +m[2] < 0) throw new TessError(st.line, `„muster=${a.str('muster')}“ hat die Form Zinne:Lücke, z. B. muster=2:1.`);
  const on = +m[1];
  const period = on + +m[2];
  const hoehe = a.int('hoehe', 1, 1, 16);
  const cap: BlockSpec | null = a.has('kappe') ? c.spec(a.str('kappe')!) : null;
  const machi = a.int('vorkragung', 0, 0, 1) === 1;
  if (a.has('konsolen') && !machi) throw new TessError(st.line, '„konsolen=“ gilt nur mit „vorkragung=1“ (Maschikuli).');
  const consoles: RoleRef = a.has('konsolen') ? c.ref(a.str('konsolen')!) : ref;
  const O = c.outlineAt(f, f.y1);
  const base = f.y1 + 1 + (machi ? 1 : 0);
  const merlon = (x: number, z: number) => {
    for (let k = 0; k < hoehe; k++) c.place([x, base + k, z], ref, ref.member, null, Part.Plain, 'y');
    if (cap) c.placeSpec([x, base + hoehe, z], cap, Part.Plain);
  };
  const isOn = (i: number) => i % period < on;
  if (machi) {
    // Machicolation: parapet and merlons one block further out, stairs under every second cell.
    const ring = O.dilate(1).minus(O);
    const inO = (x: number, z: number) => O.has(x, z);
    ring.forEach((x, z) => c.outPlace([x, f.y1 + 1, z], ref, ref.member, null, Part.Plain, 'y', 'Die Zinnen'));
    walkRing(c, f, ring, true, (x, z, i, corner) => {
      if (isOn(i) || corner) merlon(x, z);
      if (i % 2 === 0) c.outPlace([x, f.y1, z], consoles, 'stairs', { facing: facingTowardsSet(x, z, inO, 'x') ?? 'north', half: 'top' }, Part.Plain, undefined, 'Die Zinnen');
    });
    return;
  }
  walkRing(c, f, O, false, (x, z, i, corner) => {
    if (isOn(i) || corner) merlon(x, z);
  });
}

/**
 * Walks the outer cells of a crenellation ring in order: per side of a box (corners count as the
 * end of a side), along the circle for round forms, sorted by angle otherwise.
 */
function walkRing(c: Compiler, f: FormObj, set: CellSet, outward: boolean, fn: (x: number, z: number, i: number, corner: boolean) => void): void {
  if (f.kind === 'box') {
    const [x0, z0, x1, z1] = [set.x0, set.z0, set.x1, set.z1];
    const sides: [number, number, number, number][] = [
      [x0, z0, 1, 0],
      [x1, z0, 0, 1],
      [x1, z1, -1, 0],
      [x0, z1, 0, -1],
    ];
    for (const [sx, sz, dx, dz] of sides) {
      const len = dx !== 0 ? x1 - x0 : z1 - z0;
      for (let i = 0; i <= len; i++) fn(sx + dx * i, sz + dz * i, i, i === len || i === 0);
    }
    return;
  }
  const shape = f.shape;
  if (!outward && shape instanceof DiscShape && 'r' in shape.mode) {
    const r = shape.mode.r + c.offsetAt(f, f.y1);
    ringByAngle(r).forEach(([dx, dz], i) => fn(shape.cx + dx, shape.cz + dz, i, false));
    return;
  }
  const { px, pz } = c.centrePoint(f);
  let cells: [number, number][];
  let corners: CellSet;
  if (outward) {
    cells = set.list();
    // Corners of the outward ring: cells diagonally in front of a corner of the form.
    const fc = c.cornersAt(f, f.y1);
    const cs: [number, number][] = [];
    for (const [x, z] of cells) {
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ])
        if (fc.has(x + dx, z + dz) && !set.has(x + dx, z) && !set.has(x, z + dz)) cs.push([x, z]);
    }
    corners = CellSet.fromCells(cs);
  } else {
    const dist = c.insideDist(set);
    cells = set.list().filter(([x, z]) => set.at(dist, x, z) === 1);
    corners = c.cornersAt(f, f.y1);
  }
  cells.sort((p, q) => Math.atan2(p[1] + 0.5 - pz, p[0] + 0.5 - px) - Math.atan2(q[1] + 0.5 - pz, q[0] + 0.5 - px));
  cells.forEach(([x, z], i) => fn(x, z, i, corners.has(x, z)));
}
