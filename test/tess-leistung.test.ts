import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTess } from '../src/core/formats/tess';

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

  it('übersetzt jeden Zielbau in unter 1 Sekunde', () => {
    for (const f of readdirSync('beispiele').filter((n) => n.endsWith('.tess'))) {
      const bytes = readFileSync(`beispiele/${f}`);
      const t0 = performance.now();
      parseTess(bytes);
      expect(performance.now() - t0, f).toBeLessThan(1000);
    }
  });
});
