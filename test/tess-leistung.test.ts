import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseTess } from '../src/core/formats/tess';
import { compileTess } from '../src/tess/compile';
import { CompilerRoofs } from '../src/tess/compile-roofs';

/**
 * Leistung (Bau-Sprache 2, Abschnitt 12): a plan with 2 million blocks compiles in under
 * 5 seconds, the target buildings in under 1 second. The large plan is generated here: solid
 * ground, octagonal towers with profiles, corbels, timber frames, skirt roofs and bell helms,
 * houses with overhangs and united roofs.
 */

function largePlan(): string {
  const L: string[] = [
    'tess 2',
    'projekt "Großbau"',
    'rolle stein stone_bricks:6 mossy_stone_bricks:2 cracked_stone_bricks:2 muster=flecken:3',
    'rolle putz white_terracotta',
    'rolle balken dark_oak_log',
    'rolle dach deepslate_tiles',
    'rolle holz spruce_planks',
    'rolle glas glass_pane',
    'rolle rahmen spruce_planks',
    'rolle tuer spruce_door',
    'rolle boden cobblestone:3 andesite:1 muster=lagen:2',
  ];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) L.push(`box ${i * 100},-20,${j * 100} ${i * 100 + 89},-1,${j * 100 + 89} boden`);
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 16; j++) {
      const x = i * 25 + 5;
      const z = j * 25 + 5;
      const n = `t${i}_${j}`;
      if ((i + j) % 2 === 0) {
        L.push(`vieleck ${n} ${x + 6},0,${z + 6} n=8 r=5 h=24 stein hohl profil=0:2,3:2~,12:0,18:1 konsolen=stein`);
        L.push(`vieleck ${n}o ${x + 6},18,${z + 6} n=8 r=6 h=6 putz hohl fachwerk=balken riegel=3 muster=strebe`);
        L.push(`kranzdach ${n}o y=18 breite=2`);
        L.push(`dach helm ${n}o profil=glocke spitze=lightning_rod`);
      } else {
        L.push(`box ${n} ${x},0,${z} ${x + 12},6,${z + 8} putz hohl sockel=stein fachwerk=balken muster=kreuz riegel=3 profil=4:1 konsolen=holz`);
        L.push(`dach sattel ${n} rolle=dach`);
        L.push(`box ${n}b ${x + 4},0,${z + 8} ${x + 9},6,${z + 16} putz hohl`);
        L.push(`dach krueppelwalm ${n}b`);
        L.push(`fenster ${n} s y=2 anzahl=2 abstand=4`);
      }
    }
  return L.join('\n');
}

/** A row of houses whose gable roofs touch: one roof group of n roofs (5.3). */
function rowPlan(n: number): string {
  const L = ['tess 2', 'projekt "Reihe"', 'rolle wand stone_bricks', 'rolle putz white_terracotta', 'rolle dach spruce_planks'];
  for (let i = 0; i < n; i++) {
    const x = i * 7;
    L.push(`box h${i} ${x},0,0 ${x + 6},4,8 ${i % 3 ? 'wand' : 'putz'} hohl`);
    L.push(`dach sattel h${i} rolle=dach`);
  }
  return L.join('\n');
}

/**
 * A village with roof groups of many kinds: rows of houses on different heights with gable,
 * Krüppelwalm, hipped and shed roofs, cross gables, dormers, oriels, towers, chimneys and cuts
 * through the roofs after them, and roofs that join two groups.
 */
function villagePlan(seed: number): string {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8) / 16777216;
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const L = ['tess 2', 'rolle wand stone_bricks', 'rolle putz white_terracotta', 'rolle holz spruce_planks', 'rolle rahmen spruce_planks', 'rolle glas glass_pane'];
  L.push('rolle dach dark_oak_planks', 'rolle bunt oak_planks:3 birch_planks:2 muster=flecken:2', `samen ${seed}`);
  const later: string[] = [];
  for (let row = 0; row < 2; row++) {
    let x = 0;
    for (let i = 0; i < int(6, 9); i++) {
      const [w, d, y0, h] = [int(5, 9), int(5, 9), pick([0, 0, 1, 2]), int(3, 5)];
      const n = `h${row}_${i}`;
      const z = row * 14 + int(-1, 1);
      L.push(`box ${n} ${x},${y0},${z} ${x + w - 1},${y0 + h - 1},${z + d - 1} ${pick(['wand', 'putz', 'bunt'])} hohl`);
      const type = pick(['sattel first=x', 'sattel first=z', 'sattel', 'krueppelwalm first=x', 'walm', 'pult hoch=n']);
      L.push(`dach ${type} ${n} rolle=${pick(['dach', 'bunt'])}${pick(['', ' ueberstand=0', ' ueberstand=2', ' profil=1/2', ' traufe=treppe'])}`);
      if (rnd() < 0.3) L.push(`gaube ${n} ${pick(['n', 's'])}${pick(['', ' art=schlepp', ' b=2'])}`);
      if (rnd() < 0.2) L.push(`erker ${n} ${pick(['n', 's'])} y=${y0 + h - 2} b=3 h=2 holz dach=${pick(['walm', 'sattel', 'helm'])}`);
      if (rnd() < 0.3) later.push(`box k${n} ${x + int(1, w - 2)},${y0 + h - 1},${z + int(1, d - 2)} ${x + 1},${y0 + h + 5},${z + 1} wand`);
      if (rnd() < 0.2) later.push(`leer ${x + int(0, w - 1)},${y0 + h},${z} ${x + int(0, w - 1)},${y0 + h + 2},${z + 2}`);
      if (rnd() < 0.15) later.push(`dach sattel ${n} first=${pick(['x', 'z'])} rolle=holz`);
      x += w + int(-2, 1);
    }
  }
  L.push('zylinder turm 30,0,7 r=3 h=9 wand hohl', 'dach helm turm profil=glocke spitze=lightning_rod');
  L.push('box steg 10,4,6 40,5,9 holz', 'dach sattel steg first=x');
  return [...L, ...later].join('\n');
}

/**
 * A hipped roof on a cross with arms of unequal length and two houses at its middle: the ridge
 * cell in the middle depends on the whole length of both arms, also when only the part around
 * the houses is drawn again.
 */
const crossPlan = [
  'tess 2',
  'rolle wand stone_bricks',
  'rolle dach spruce_planks',
  'umriss kreuz y=0 h=3 punkte=28,10;32,10;32,28;56,28;56,32;32,32;32,70;28,70;28,32;6,32;6,28;28,28 wand hohl',
  'dach walm kreuz',
  'box a 33,0,33 37,2,37 wand hohl',
  'dach sattel a',
  'box b 23,0,33 27,2,37 wand hohl',
  'dach walm b',
].join('\n');

/** Blocks with state, part and origin, and the messages. */
function result(src: string): string[] {
  const out = compileTess(src);
  const rows = out.diagnostics.map((d) => `${d.line} ${d.level} ${d.message}`);
  out.grid.forEach((x, y, z, id, info) => rows.push(`${x},${y},${z} ${out.grid.states[id].key} ${info}`));
  return rows;
}

describe('Leistung des Compilers', () => {
  it('übersetzt einen Bauplan mit über 2 Millionen Blöcken in unter 5 Sekunden', () => {
    const bytes = new TextEncoder().encode(largePlan());
    const t0 = performance.now();
    const r = parseTess(bytes);
    const ms = performance.now() - t0;
    expect(r.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    let blocks = 0;
    for (const p of r.volume.data) if (p) blocks++;
    expect(blocks).toBeGreaterThan(2_000_000);
    expect(ms).toBeLessThan(5000);
  });

  it('übersetzt eine Dachgruppe aus 300 Häusern in unter 3 Sekunden', () => {
    // Up to 0.4.1 every new roof drew its whole group again: 200 houses took 28 seconds.
    const bytes = new TextEncoder().encode(rowPlan(300));
    const t0 = performance.now();
    const r = parseTess(bytes);
    const ms = performance.now() - t0;
    expect(r.diagnostics).toEqual([]);
    let blocks = 0;
    for (const p of r.volume.data) if (p) blocks++;
    expect(blocks).toBeGreaterThan(75_000);
    expect(ms).toBeLessThan(3000);
  });

  it('zeichnet Dachgruppen in Teilen blockgenau wie ganz', () => {
    const was = CompilerRoofs.partFrom;
    const spy = vi.spyOn(CompilerRoofs.prototype as unknown as { drawPart(): boolean }, 'drawPart');
    try {
      for (const [name, src] of [['Kreuz', crossPlan], ...[1, 2, 3, 4, 5, 6, 7, 8].map((seed) => [`Dorf ${seed}`, villagePlan(seed)])]) {
        CompilerRoofs.partFrom = Infinity;
        const whole = result(src);
        CompilerRoofs.partFrom = 0;
        const parts = result(src);
        expect(parts, name).toEqual(whole);
      }
      expect(spy.mock.results.filter((r) => r.value === true).length).toBeGreaterThan(60);
    } finally {
      CompilerRoofs.partFrom = was;
      spy.mockRestore();
    }
  }, 30_000);

  it('übersetzt jeden Zielbau in unter 1 Sekunde', () => {
    for (const f of readdirSync('beispiele').filter((n) => n.endsWith('.tess'))) {
      const bytes = readFileSync(`beispiele/${f}`);
      const t0 = performance.now();
      parseTess(bytes);
      expect(performance.now() - t0, f).toBeLessThan(1000);
    }
  });
});
