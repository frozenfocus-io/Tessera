#!/usr/bin/env node
/**
 * Prints a building plan (.tess) as text: messages, then layer by layer as top views, optionally
 * vertical sections and single blocks with the line that set them. For checking placements
 * without screenshots.
 *
 * Usage: node scripts/lagen.mjs <datei.tess> [y=a-b] [x=a-b] [z=a-b] [schnitt=x:N|z:N] [block=x,y,z …]
 *   y=, x=, z=      range to print (default: everything; a single number is one layer)
 *   schnitt=x:N     vertical section at x=N (columns z), schnitt=z:N at z=N (columns x)
 *   block=x,y,z     full state and origin line of one block (repeatable)
 *
 * Characters: . air · ^ > v < stairs (bottom half) facing north, east, south, west ·
 * n o s w stairs (top half, upside down) facing north, east, south, west · + inner corner,
 * * outer corner (any half) · - bottom slab, = top slab · letters and digits: see legend.
 * In top views north is up and east is right; x and z labels are the last digit.
 */
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { runnerImport } from 'vite';

const args = process.argv.slice(2);
const file = args.find((a) => !a.includes('='));
if (!file) {
  console.error('Aufruf: node scripts/lagen.mjs <datei.tess> [y=a-b] [x=a-b] [z=a-b] [schnitt=x:N|z:N] [block=x,y,z …]');
  process.exit(1);
}
const opt = (key) => args.filter((a) => a.startsWith(`${key}=`)).map((a) => a.slice(key.length + 1));
const range = (key) => {
  const v = opt(key)[0];
  if (v === undefined) return null;
  const m = /^(-?\d+)(?:(?:-|\.\.)(-?\d+))?$/.exec(v);
  if (!m) throw new Error(`${key}=${v}: erwartet a-b oder eine Zahl`);
  return [Number(m[1]), Number(m[2] ?? m[1])];
};

const root = resolve(new URL('..', import.meta.url).pathname);
const { module } = await runnerImport(resolve(root, 'src/tess/compile.ts'), { root, logLevel: 'error' });
const out = module.compileTess(readFileSync(file, 'utf8'));

for (const d of out.diagnostics) console.log(`${d.level === 'error' ? 'Fehler' : 'Hinweis'} Zeile ${d.line}: ${d.message}`);
if (!out.diagnostics.length) console.log('Keine Meldungen.');
const b = out.grid.bounds();
if (!b) process.exit(0);
console.log(`Blöcke: ${out.grid.size}, Quader ${b.min.join(',')} bis ${b.max.join(',')}`);

const [x0, x1] = range('x') ?? [b.min[0], b.max[0]];
const [y0, y1] = range('y') ?? [b.min[1], b.max[1]];
const [z0, z1] = range('z') ?? [b.min[2], b.max[2]];

const legend = new Map();
const pool = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmpqrtuxyz0123456789#%&@$?!~:;'];
const STAIR = { north: '^', east: '>', south: 'v', west: '<' };
const STAIR_TOP = { north: 'n', east: 'o', south: 's', west: 'w' };
function char(s) {
  if (!s) return '.';
  const name = s.name.replace('minecraft:', '');
  const p = s.props ?? {};
  if (name.endsWith('_stairs')) {
    if (p.shape?.startsWith('inner')) return '+';
    if (p.shape?.startsWith('outer')) return '*';
    return (p.half === 'top' ? STAIR_TOP : STAIR)[p.facing] ?? '?';
  }
  if (name.endsWith('_slab') && p.type !== 'double') return p.type === 'top' ? '=' : '-';
  const key = p.axis ? `${name}[axis=${p.axis}]` : name;
  if (!legend.has(key)) legend.set(key, pool[legend.size] ?? '?');
  return legend.get(key);
}
const digit = (v) => String(Math.abs(v) % 10);
const label = (v) => String(v).padStart(4);

for (let y = y1; y >= y0 && !opt('schnitt').length; y--) {
  const rows = [];
  for (let z = z0; z <= z1; z++) {
    let row = '';
    for (let x = x0; x <= x1; x++) row += char(out.grid.get(x, y, z));
    rows.push(`${label(z)} ${row}`);
  }
  if (rows.every((r) => /^\s*-?\d+ \.*$/.test(r))) continue;
  let head = '     ';
  for (let x = x0; x <= x1; x++) head += digit(x);
  console.log(`\ny=${y}\n${head}\n${rows.join('\n')}`);
}

for (const s of opt('schnitt')) {
  const m = /^([xz]):(-?\d+)$/.exec(s);
  if (!m) throw new Error(`schnitt=${s}: erwartet x:N oder z:N`);
  const fixed = Number(m[2]);
  const [a0, a1] = m[1] === 'x' ? [z0, z1] : [x0, x1];
  let head = '     ';
  for (let a = a0; a <= a1; a++) head += digit(a);
  console.log(`\nSchnitt ${m[1]}=${fixed} (Spalten ${m[1] === 'x' ? 'z' : 'x'}, oben ist oben)\n${head}`);
  for (let y = y1; y >= y0; y--) {
    let row = '';
    for (let a = a0; a <= a1; a++) row += char(m[1] === 'x' ? out.grid.get(fixed, y, a) : out.grid.get(a, y, fixed));
    console.log(`${label(y)} ${row}`);
  }
}

for (const p of opt('block')) {
  const [x, y, z] = p.split(',').map(Number);
  const s = out.grid.get(x, y, z);
  const info = out.grid.cellInfo(x, y, z);
  const text = info ? (out.lineTexts?.[info.line] ?? out.lineTexts?.get?.(info.line) ?? '') : '';
  console.log(`\n${x},${y},${z}: ${s ? s.key : 'Luft'}${info ? `  (Zeile ${info.line}: ${String(text).trim()})` : ''}`);
}

if (legend.size) console.log(`\nLegende: ${[...legend].map(([k, c]) => `${c} ${k.replace('minecraft:', '')}`).join(' · ')}`);
