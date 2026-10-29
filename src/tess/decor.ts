import { Args } from './args';
import type { Compiler, FormObj, Vec3 } from './compile';
import { sturdyFace } from './connect';
import { DIR, opposite, parseSide, type Facing } from './geometry';
import { Part } from './grid';
import { cellRandom, parsePattern, patchNoise, stringHash, type BlockSpec, type Pattern } from './palette';
import { asciiKey, TessError, type Statement } from './syntax';
import { onSides, parseSides } from './wallparts';
import { readSpots, SPOT_KEYS } from './wall';

/**
 * Decoration (Bau-Sprache 2, 7) and farms (8): lanterns and torches at walls, hanging lanterns,
 * banners, ivy and other growth on walls and tops, leaf clouds, scattered blocks and fields with
 * water rows, fence, gate and path. Everything outside the wall only goes into air.
 */

const MAIN: readonly Facing[] = ['north', 'east', 'south', 'west'];

// ---------------------------------------------------------------------------
// wandlaterne

/** wandlaterne <form> <seite> (y=|ebene=) [x=|z=|versatz=] [art=laterne|seelenlaterne|fackel|seelenfackel] [arm=R] */
export function wallLanternCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), [...SPOT_KEYS, 'art', 'arm']);
  const f = c.bauteilForm(a);
  const spots = readSpots(c, a, f, { width: 1, needHeight: true, what: 'Die Wandlaterne' });
  a.done();
  const art = a.choice('art', ['laterne', 'seelenlaterne', 'fackel', 'seelenfackel'] as const, 'laterne');
  const torch = art === 'fackel' || art === 'seelenfackel';
  if (torch && a.has('arm')) throw new TessError(st.line, 'Eine Wandfackel hängt direkt an der Wand; „arm=“ gilt für Laternen.');
  const arm = a.has('arm') ? c.memberRef(a.str('arm')!, 'fence') : null;
  const mount = !torch && !arm ? c.ref('rahmen') : null;
  const lantern = art === 'seelenlaterne' ? 'minecraft:soul_lantern' : 'minecraft:lantern';
  const what = 'Die Wandlaterne';
  for (const s of spots) {
    const p = s.wall.cell(s.start, s.y);
    if (!p) {
      c.warn(`${what}: An dieser Stelle hat „${f.name}“ in y=${s.y} keine Wand.`);
      continue;
    }
    const q = c.outside(p, s.wall.out);
    if (torch) {
      c.outPut(q, c.sid(art === 'fackel' ? 'minecraft:wall_torch' : 'minecraft:soul_wall_torch', { facing: s.wall.out }), what);
    } else if (arm) {
      if (c.outPlace(q, arm, arm.member, null, Part.Attachment, 'y', what)) c.outPut([q[0], q[1] - 1, q[2]], c.sid(lantern, { hanging: 'true' }), what);
    } else if (c.outPlace(q, mount!, mount!.member, null, Part.Attachment, s.wall.axis, what)) {
      c.outPut([q[0], q[1] + 1, q[2]], c.sid(lantern, { hanging: 'false' }), what);
    }
  }
}

// ---------------------------------------------------------------------------
// haengelaterne

/** haengelaterne x,y,z [kette=<n>] [art=laterne|seelenlaterne] */
export function hangingLanternCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), ['kette', 'art']);
  const [x, y, z] = a.coord('Die Stelle unter dem Block, an dem die Laterne hängt');
  a.done();
  const n = a.int('kette', 1, 0, 64);
  const art = a.choice('art', ['laterne', 'seelenlaterne'] as const, 'laterne');
  if (!c.grid.has(x, y + 1, z)) c.warn(`Über ${x},${y},${z} ist kein Block; die Laterne hängt in der Luft.`);
  for (let i = 0; i < n; i++) c.put(x, y - i, z, c.sid('minecraft:chain', { axis: 'y' }), Part.Attachment);
  c.put(x, y - n, z, c.sid(art === 'seelenlaterne' ? 'minecraft:soul_lantern' : 'minecraft:lantern', { hanging: 'true' }), Part.Attachment);
}

// ---------------------------------------------------------------------------
// banner

const COLORS: Record<string, string> = {
  white: 'white',
  weiss: 'white',
  orange: 'orange',
  magenta: 'magenta',
  light_blue: 'light_blue',
  hellblau: 'light_blue',
  yellow: 'yellow',
  gelb: 'yellow',
  lime: 'lime',
  hellgruen: 'lime',
  pink: 'pink',
  rosa: 'pink',
  gray: 'gray',
  grau: 'gray',
  light_gray: 'light_gray',
  hellgrau: 'light_gray',
  cyan: 'cyan',
  tuerkis: 'cyan',
  purple: 'purple',
  lila: 'purple',
  violett: 'purple',
  blue: 'blue',
  blau: 'blue',
  brown: 'brown',
  braun: 'brown',
  green: 'green',
  gruen: 'green',
  red: 'red',
  rot: 'red',
  black: 'black',
  schwarz: 'black',
};

/** banner <form> <seite> (y=|ebene=) [x=|z=|versatz=] farbe=<farbe> [haengend=ja] */
export function bannerCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), [...SPOT_KEYS, 'farbe', 'haengend']);
  const f = c.bauteilForm(a);
  const spots = readSpots(c, a, f, { width: 1, needHeight: true, what: 'Das Banner' });
  a.done();
  const word = a.str('farbe');
  if (!word) throw new TessError(st.line, 'Beim Banner fehlt „farbe=“, z. B. farbe=rot oder farbe=blue.');
  const color = COLORS[asciiKey(word)];
  if (!color) throw new TessError(st.line, `„farbe=${word}“ ist keine Farbe (z. B. rot, blau, gelb, gruen, weiss, schwarz oder die Minecraft-Namen).`);
  const hanging = a.bool('haengend', false);
  const pole = hanging ? c.memberRef('rahmen', 'fence') : null;
  const what = 'Das Banner';
  for (const s of spots) {
    const p = s.wall.cell(s.start, s.y);
    if (!p) {
      c.warn(`${what}: An dieser Stelle hat „${f.name}“ in y=${s.y} keine Wand.`);
      continue;
    }
    const q = c.outside(p, s.wall.out);
    if (pole) c.outPlace([q[0], q[1] + 1, q[2]], pole, pole.member, null, Part.Attachment, 'y', what);
    c.outPut(q, c.sid(`minecraft:${color}_wall_banner`, { facing: s.wall.out }), what);
  }
}

// ---------------------------------------------------------------------------
// Growth on walls and tops

/** Noise in [0,1) for growth: patches (flecken:n) or single cells (einzeln). */
function growthNoise(c: Compiler, p: Pattern, salt: number, x: number, y: number, z: number): number {
  if (p.kind === 'flecken') return patchNoise((c.palette.seed ^ salt) >>> 0, p.n, x, y, z);
  return cellRandom(c.palette.seed, x, y, z, salt);
}

function growthPattern(a: Args, def: string): Pattern {
  const p = parsePattern(a.str('muster') ?? def, a.line);
  if (p.kind === 'lagen') throw new TessError(a.line, '„muster=lagen“ passt hier nicht; möglich sind flecken:<n> und einzeln.');
  return p;
}

/** Air cells in front of the form's wall cells whose face towards them is full, per layer. */
function wallFaces(c: Compiler, f: FormObj, y: number, sides: number[] | null): { cell: Vec3; wallSide: Facing }[] {
  const out: { cell: Vec3; wallSide: Facing }[] = [];
  if (y < f.y0 || y > f.y1) return out;
  const O = c.outlineAt(f, y);
  O.forEach((x, z) => {
    for (const d of MAIN) {
      const [dx, dz] = DIR[d];
      const cx = x + dx;
      const cz = z + dz;
      if (O.has(cx, cz)) continue;
      if (c.grid.has(cx, y, cz)) continue;
      const wall = c.grid.get(x, y, z);
      if (!sturdyFace(wall, d)) continue;
      if (!onSides(c, f, O, cx, cz, sides)) continue;
      out.push({ cell: [cx, y, cz], wallSide: opposite(d) });
    }
  });
  return out;
}

/** efeu <form> [seiten=] [dichte=0.3] [laenge=3] [von=] [bis=] [art=ranke|flechte] [muster=flecken:3] */
export function ivyCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), ['seiten', 'dichte', 'laenge', 'von', 'bis', 'art', 'muster']);
  const f = c.bauteilForm(a);
  a.done();
  const sides = parseSides(a);
  const density = a.decimal('dichte', 0.3, 0, 1);
  const len = a.int('laenge', 3, 1, 64);
  const von = a.int('von', f.y0, -4000, 4000);
  const bis = a.int('bis', f.y1, -4000, 4000);
  const art = a.choice('art', ['ranke', 'flechte'] as const, 'ranke');
  const pattern = growthPattern(a, 'flecken:3');
  const salt = stringHash(`efeu${st.line}`);
  const id = art === 'ranke' ? 'minecraft:vine' : 'minecraft:glow_lichen';
  // Start cells, then each hangs down 1 … laenge cells while air and wall go on.
  const faces = new Map<string, { cell: Vec3; sides: Set<Facing> }>();
  const add = (cell: Vec3, side: Facing) => {
    const k = cell.join(',');
    let e = faces.get(k);
    if (!e) faces.set(k, (e = { cell, sides: new Set() }));
    e.sides.add(side);
  };
  const lo = Math.max(von, f.y0);
  const hi = Math.min(bis, f.y1);
  const below = (cell: Vec3, side: Facing): boolean => {
    const [x, y, z] = cell;
    if (y - 1 < lo || c.grid.has(x, y - 1, z)) return false;
    const [dx, dz] = DIR[side];
    return sturdyFace(c.grid.get(x + dx, y - 1, z + dz), opposite(side));
  };
  for (let y = hi; y >= lo; y--) {
    for (const { cell, wallSide } of wallFaces(c, f, y, sides)) {
      if (growthNoise(c, pattern, salt, cell[0], cell[1], cell[2]) <= 1 - density) continue;
      const n = 1 + Math.floor(cellRandom(c.palette.seed, cell[0], cell[1], cell[2], salt ^ 0x5bd1) * len);
      let cur: Vec3 = cell;
      add(cur, wallSide);
      for (let k = 1; k < n && below(cur, wallSide); k++) {
        cur = [cur[0], cur[1] - 1, cur[2]];
        add(cur, wallSide);
      }
    }
  }
  for (const { cell, sides: ss } of faces.values()) {
    const props: Record<string, string> = {};
    for (const s of ss) props[s] = 'true';
    c.outPut(cell, c.sid(id, props), 'Der Efeu');
  }
}

/** Cells above full top faces in the region of a form (walls, roofs, Anbauten on it). */
function topCells(c: Compiler, f: FormObj): Vec3[] {
  const [x0, , z0, x1, , z1] = f.bbox;
  const top = Math.max(f.y1, f.roofTop ?? f.y1) + 1;
  const out: Vec3[] = [];
  for (let y = f.y0 + 1; y <= top + 1; y++)
    for (let z = z0 - 2; z <= z1 + 2; z++)
      for (let x = x0 - 2; x <= x1 + 2; x++) {
        if (c.grid.has(x, y, z)) continue;
        if (!sturdyFace(c.grid.get(x, y - 1, z), 'up')) continue;
        out.push([x, y, z]);
      }
  return out;
}

const DIRECTIONAL = new Set(['minecraft:vine', 'minecraft:glow_lichen']);

/** bewuchs <form> [flaechen=oben|seiten|alle] block=<block-angabe> [dichte=0.3] [muster=flecken:3] */
export function coverCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), ['flaechen', 'block', 'dichte', 'muster']);
  const f = c.bauteilForm(a);
  a.done();
  const where = a.choice('flaechen', ['oben', 'seiten', 'alle'] as const, 'oben');
  const blockWord = a.str('block');
  if (!blockWord) throw new TessError(st.line, 'Beim Bewuchs fehlt „block=“, z. B. block=moss_carpet.');
  const spec = c.palette.blockSpec(blockWord, st.line);
  const density = a.decimal('dichte', 0.3, 0, 1);
  const pattern = growthPattern(a, 'flecken:3');
  const salt = stringHash(`bewuchs${st.line}`);
  const what = 'Der Bewuchs';
  const take = (p: Vec3) => growthNoise(c, pattern, salt, p[0], p[1], p[2]) > 1 - density;
  if (where !== 'seiten') for (const p of topCells(c, f)) if (take(p)) c.outPlaceSpec(p, spec, Part.Attachment, what);
  if (where !== 'oben') {
    for (let y = f.y0; y <= f.y1; y++)
      for (const { cell, wallSide } of wallFaces(c, f, y, null)) {
        if (!take(cell)) continue;
        if (spec.kind === 'state' && DIRECTIONAL.has(spec.state.name)) c.outPut(cell, c.sid(spec.state.name, { ...spec.state.props, [wallSide]: 'true' }), what);
        else c.outPlaceSpec(cell, spec, Part.Attachment, what);
      }
  }
}

/** streue <form> block=<block-angabe> [dichte=0.2] [flaechen=oben] */
export function scatterCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), ['block', 'dichte', 'flaechen']);
  const f = c.bauteilForm(a);
  a.done();
  a.choice('flaechen', ['oben'] as const, 'oben');
  const blockWord = a.str('block');
  if (!blockWord) throw new TessError(st.line, 'Bei „streue“ fehlt „block=“, z. B. block=brown_mushroom.');
  const spec: BlockSpec = c.palette.blockSpec(blockWord, st.line);
  const density = a.decimal('dichte', 0.2, 0, 1);
  const salt = stringHash(`streue${st.line}`);
  for (const p of topCells(c, f)) if (cellRandom(c.palette.seed, p[0], p[1], p[2], salt) < density) c.outPlaceSpec(p, spec, Part.Attachment, 'Die Streu');
}

/** laub x,y,z r=<n> <rolle> [dichte=0.85]: a cloud of leaves; at the edge noise takes some away. */
export function leavesCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), ['r', 'dichte']);
  const [cx, cy, cz] = a.coord('Die Mitte');
  const ref = c.ref(a.word1('Die Rolle (Blätter)'));
  a.done();
  const r = a.requireInt('r', 0, 32, 'Der Radius der Blätterwolke.');
  const density = a.decimal('dichte', 0.85, 0, 1);
  const lim = (r + 0.5) ** 2;
  const inside = (dx: number, dy: number, dz: number) => dx * dx + dy * dy + dz * dz <= lim;
  const salt = stringHash(`laub${st.line}`);
  for (let dy = -r; dy <= r; dy++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (!inside(dx, dy, dz)) continue;
        const edge = !inside(dx + 1, dy, dz) || !inside(dx - 1, dy, dz) || !inside(dx, dy + 1, dz) || !inside(dx, dy - 1, dz) || !inside(dx, dy, dz + 1) || !inside(dx, dy, dz - 1);
        const x = cx + dx;
        const y = cy + dy;
        const z = cz + dz;
        if (edge && patchNoise((c.palette.seed ^ salt) >>> 0, 2, x, y, z) > density) continue;
        if (c.grid.has(x, y, z)) continue; // branches and trunks stay
        c.place([x, y, z], ref, ref.member, null, Part.Plain, 'y');
      }
}

// ---------------------------------------------------------------------------
// feld

const CROP_AGE: Record<string, number> = {
  'minecraft:wheat': 7,
  'minecraft:carrots': 7,
  'minecraft:potatoes': 7,
  'minecraft:beetroots': 3,
  'minecraft:melon_stem': 7,
  'minecraft:pumpkin_stem': 7,
  'minecraft:torchflower_crop': 1,
};

/** Water rows across the shorter side (offsets from the first cell), as in spec 8. */
export function waterRows(B: number): number[] {
  const first = Math.min(4, Math.floor((B - 1) / 2));
  const rows: number[] = [];
  // Rows every 9, but never closer to the far edge than the first row is to its edge (water at
  // the edge would run out of the field); the extra row there covers the rest.
  for (let r = first; r <= B - 1 - first; r += 9) rows.push(r);
  const last = rows[rows.length - 1];
  if (B - 1 - last > 4) rows.push(B - 1 - first);
  return rows;
}

/** feld x,y,z x,y,z [frucht=wheat|…] [zaun=R] [tor=<seite>] [weg=R] */
export function fieldCmd(c: Compiler, st: Statement): void {
  const a = new Args(st, c.tokens(st), ['frucht', 'zaun', 'tor', 'weg']);
  const p = a.coord('Die erste Ecke');
  const q = a.coord('Die zweite Ecke');
  a.done();
  if (p[1] !== q[1]) throw new TessError(st.line, `Die beiden Ecken des Felds liegen nicht in derselben Lage (y=${p[1]} und y=${q[1]}).`);
  const y = p[1];
  const x0 = Math.min(p[0], q[0]);
  const x1 = Math.max(p[0], q[0]);
  const z0 = Math.min(p[2], q[2]);
  const z1 = Math.max(p[2], q[2]);
  const W = x1 - x0 + 1;
  const L = z1 - z0 + 1;
  const crop = c.palette.blockSpec(a.str('frucht') ?? 'wheat', st.line);
  const fence = a.has('zaun') ? c.memberRef(c.roleOrBlockName(a.str('zaun')!), 'fence') : null;
  const gateSide = a.has('tor') ? parseSide(asciiKey(a.str('tor')!)) : null;
  if (a.has('tor') && !gateSide) throw new TessError(st.line, `„tor=${a.str('tor')}“ ist keine Seite (n, o, s oder w).`);
  if (gateSide && !fence) throw new TessError(st.line, '„tor=“ braucht einen Zaun („zaun=“).');
  const path = a.has('weg') ? c.ref(c.roleOrBlockName(a.str('weg')!)) : null;
  // Water: rows along the longer side, or one cell in the middle when both sides are at most 9.
  const water = new Set<string>();
  if (W <= 9 && L <= 9) water.add(`${x0 + Math.floor((W - 1) / 2)},${z0 + Math.floor((L - 1) / 2)}`);
  else {
    const rowsAlongX = W >= L;
    const B = rowsAlongX ? L : W;
    const A = rowsAlongX ? W : L;
    for (const r of waterRows(B)) {
      // The rows keep one cell of farmland at their ends, so the water stays enclosed.
      for (let t = A > 2 ? 1 : 0; t < (A > 2 ? A - 1 : A); t++) water.add(rowsAlongX ? `${x0 + t},${z0 + r}` : `${x0 + r},${z0 + t}`);
    }
  }
  const farmland = c.sid('minecraft:farmland', { moisture: '7' });
  const water0 = c.sid('minecraft:water', { level: '0' });
  const plant = (x: number, z: number) => {
    if (crop.kind === 'state') {
      const age = CROP_AGE[crop.state.name];
      const props = age !== undefined && crop.state.props.age === undefined ? { ...crop.state.props, age: String(age) } : { ...crop.state.props };
      c.put(x, y + 1, z, c.sid(crop.state.name, Object.keys(props).length ? props : null), Part.Plain);
    } else c.placeSpec([x, y + 1, z], crop, Part.Plain);
  };
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      if (water.has(`${x},${z}`)) {
        c.put(x, y, z, water0, Part.Plain);
        c.clearCell([x, y + 1, z]);
      } else {
        c.put(x, y, z, farmland, Part.Plain);
        plant(x, z);
      }
    }
  const ring = (d: number): Vec3[] => {
    const out: Vec3[] = [];
    for (let x = x0 - d; x <= x1 + d; x++) out.push([x, 0, z0 - d], [x, 0, z1 + d]);
    for (let z = z0 - d + 1; z <= z1 + d - 1; z++) out.push([x0 - d, 0, z], [x1 + d, 0, z]);
    return out;
  };
  if (fence) {
    let gate: Vec3 | null = null;
    if (gateSide) {
      const mx = x0 + Math.floor((W - 1) / 2);
      const mz = z0 + Math.floor((L - 1) / 2);
      gate = gateSide === 'north' ? [mx, 0, z0 - 1] : gateSide === 'south' ? [mx, 0, z1 + 1] : gateSide === 'west' ? [x0 - 1, 0, mz] : [x1 + 1, 0, mz];
    }
    for (const [x, , z] of ring(1)) {
      if (gate && gate[0] === x && gate[2] === z) c.place([x, y + 1, z], fence, 'fence_gate', { facing: gateSide! }, Part.Plain);
      else c.place([x, y + 1, z], fence, fence.member, null, Part.Plain);
    }
  }
  if (path) for (const [x, , z] of ring(fence ? 2 : 1)) c.place([x, y, z], path, path.member, null, Part.Plain, 'y');
}
