import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { originLabel, parseTess } from '../src/core/formats/tess';
import { compileTess } from '../src/tess/compile';
import { Palette } from '../src/tess/palette';
import { leaks } from './helpers/leaks';

/**
 * Bau-Sprache 2 (Etappe 4a): every instruction and option checks the behaviour described in
 * docs/bau-sprache-2.md, not only that a file compiles.
 */

const HEAD =
  'tess 2\nrolle stein stone_bricks\nrolle holz spruce_planks\nrolle glas glass_pane\nrolle rahmen spruce_planks\nrolle tuer spruce_door\nrolle dach spruce_planks\nrolle balken dark_oak_log\nrolle putz white_terracotta\n';
const HEAD_LINES = 10;
const line = (n: number) => n + HEAD_LINES - 1;

type Out = ReturnType<typeof compileTess>;
const c2 = (body: string, opts?: Parameters<typeof compileTess>[1]) => compileTess(HEAD + body, opts);
const at = (out: Out, x: number, y: number, z: number) => out.grid.get(x, y, z);
const name = (out: Out, x: number, y: number, z: number) => out.grid.get(x, y, z)?.name.replace('minecraft:', '') ?? null;
const errors = (out: Out) => out.diagnostics.filter((d) => d.level === 'error');
const warnings = (out: Out) => out.diagnostics.filter((d) => d.level === 'warn');
const clean = (out: Out) => expect(out.diagnostics, out.diagnostics.map((d) => `${d.line}: ${d.message}`).join('\n')).toEqual([]);
/** Cells of one layer as a set of "x,z". */
const layer = (out: Out, y: number) => new Set(out.grid.entries().filter(([, yy]) => yy === y).map(([x, , z]) => `${x},${z}`));
const blocksIn = (out: Out, y: number) => out.grid.entries().filter(([, yy]) => yy === y);
const xs = (out: Out, y: number, z: number) =>
  out.grid
    .entries()
    .filter(([, yy, zz]) => yy === y && zz === z)
    .map(([x]) => x)
    .sort((a, b) => a - b);

describe('Bau-Sprache 2: Versionen und Zeilen', () => {
  it('kennt tess 2 neben tess 1 und lehnt andere Versionen ab', () => {
    clean(c2('box 0,0,0 1,1,1 stein'));
    expect(errors(compileTess('tess 3\nrolle a stone\nbox 0,0,0 1,1,1 a'))[0].message).toContain('tess 1“ und „tess 2');
    expect(errors(compileTess('rolle a stone'))[0].message).toContain('tess 2');
  });

  it('meldet neue Befehle in tess 1 mit dem Hinweis auf tess 2', () => {
    const out = compileTess('tess 1\nrolle a stone\nvieleck t 0,0,0 n=8 r=3 h=2 a\nbox b 0,0,0 4,4,4 a profil=2:1');
    expect(errors(out).map((e) => e.line)).toEqual([3, 4]);
    expect(errors(out)[0].message).toContain('tess 2');
    expect(errors(out)[1].message).toContain('tess 2');
  });

  it('verbindet Fortsetzungszeilen und nennt bei Fehlern die erste Zeile', () => {
    const out = c2('box a 0,0,0 \\\n   4,3,4 \\\n   stein hohl\nbox b 0,0,0 \\\n  1,1,1 nichts');
    expect(errors(out).map((e) => e.line)).toEqual([line(4)]);
    expect(name(out, 0, 3, 4)).toBe('stone_bricks');
    expect(at(out, 2, 2, 2)).toBeNull();
  });

  it('beendet Kommentare nicht in Anführungszeichen, aber vor Ausdrücken nicht', () => {
    const out = c2('projekt "Turm #1" # Kommentar\nwert a=2 # Kommentar\nbox 0,0,0 {a},0,0 stein # noch einer');
    clean(out);
    expect(out.name).toBe('Turm #1');
    expect(name(out, 2, 0, 0)).toBe('stone_bricks');
  });

  it('nimmt ASCII-Zeilen nur direkt unter Zeichenbefehlen, mit # und Leerzeichen', () => {
    const ok = c2('grundriss g 0,0,0 h=1 stein\n|##  #\n  |#\n');
    clean(ok);
    expect(layer(ok, 0)).toEqual(new Set(['0,0', '1,0', '4,0', '0,1']));
    const bad = c2('box 0,0,0 1,1,1 stein\n| ##');
    expect(errors(bad)[0]).toMatchObject({ line: line(2) });
    expect(errors(bad)[0].message).toContain('grundriss');
    const gap = c2('grundriss g 0,0,0 h=1 stein\n|##\n\n|##');
    expect(errors(gap).map((e) => e.line)).toEqual([line(4)]);
  });
});

describe('Bau-Sprache 2: Werte und Ausdrücke', () => {
  const value = (expr: string, pre = '') => {
    const out = c2(`${pre}wert v=${expr}\nbox {v},0,0 {v},0,0 stein`);
    expect(errors(out)).toEqual([]);
    return out.grid.entries()[0][0];
  };

  it('rechnet mit Vorrang, Klammern und einstelligem Minus', () => {
    expect(value('2+3*4')).toBe(14);
    expect(value('(2+3)*4')).toBe(20);
    expect(value('-3*-2')).toBe(6);
    expect(value('{ 2 + 3 }')).toBe(5);
  });

  it('teilt mit Abrunden und rechnet % immer positiv', () => {
    expect(value('-7/2')).toBe(-4);
    expect(value('7/2')).toBe(3);
    expect(value('-7%3')).toBe(2);
    expect(value('7%3')).toBe(1);
    expect(errors(c2('wert v=1/0'))[0].message).toContain('Division durch 0');
  });

  it('kennt min, max, abs und clamp', () => {
    expect(value('min(4,2,9)')).toBe(2);
    expect(value('max(4,2,9)')).toBe(9);
    expect(value('abs(-5)')).toBe(5);
    expect(value('clamp(12,0,10)')).toBe(10);
    expect(value('clamp(-3,0,10)')).toBe(0);
  });

  it('zufall hängt nur von samen, Zeile und k ab', () => {
    const src = 'samen 5\nwert a=zufall(1,100,1)\nwert b=zufall(1,100,2)\nbox {a},0,0 {a},0,0 stein\nbox {b},1,0 {b},1,0 stein';
    const p = c2(src);
    const q = c2(src);
    const r = c2(src.replace('samen 5', 'samen 6'));
    const get = (o: Out, y: number) => o.grid.entries().find(([, yy]) => yy === y)![0];
    expect(get(p, 0)).toBe(get(q, 0));
    expect(get(p, 0)).toBeGreaterThanOrEqual(1);
    expect(get(p, 0)).toBeLessThanOrEqual(100);
    expect([get(p, 0), get(p, 1)].join()).not.toBe([get(r, 0), get(r, 1)].join());
    const values = new Set<number>();
    for (let k = 0; k < 40; k++) values.add(value(`zufall(1,6,${k})`));
    expect([...values].every((v) => v >= 1 && v <= 6)).toBe(true);
    expect(values.size).toBeGreaterThan(3);
  });

  it('wert gilt ab seiner Zeile und darf neu gesetzt werden', () => {
    const out = c2('wert a=1\nbox {a},0,0 {a},0,0 stein\nwert a={a+10}\nbox {a},1,0 {a},1,0 stein');
    clean(out);
    expect(name(out, 1, 0, 0)).toBe('stone_bricks');
    expect(name(out, 11, 1, 0)).toBe('stone_bricks');
    expect(errors(c2('box {b},0,0 1,1,1 stein'))[0].message).toContain('„b“');
  });

  it('meldet Folgefehler nicht doppelt', () => {
    const out = c2('wert a=1+\nbox {a},0,0 1,1,1 stein\nbox {a},2,0 1,2,1 stein');
    expect(errors(out).map((e) => e.line)).toEqual([line(1)]);
  });

  it('löst Ausdrücke in Koordinaten, Angaben und Namen auf, innere zuerst', () => {
    const out = c2('wert i=2\nbox t{i} 0,0,0 3,1,3 stein\nbox {t{i}.x1+2},0,0 {t2.x1+2},{t2.y1},0 holz');
    clean(out);
    expect(name(out, 5, 1, 0)).toBe('spruce_planks');
  });

  it('kennt die Felder der Formen', () => {
    const out = c2(
      [
        'box h 0,0,0 10,4,6 stein hohl profil=3:1',
        'zylinder z 30,2,40 r=4 h=6 stein',
        'vieleck v 60,0,0 n=8 r=5 h=3 stein',
        'dach sattel h',
        'box a {h.x0},{h.dach+1},{h.z1} {h.x1},{h.dach+1},{h.z1} holz',
        'box b {z.mx},{z.y1},{z.mz} {z.mx+z.r},{z.y1},{z.mz} holz',
        'box c {v.mx},{v.y0+v.by},{v.mz} {v.mx},{v.y0+v.by},{v.mz} holz',
        'box d {h.bx},20,{h.bz} {h.bx},20,{h.bz} holz',
      ].join('\n'),
    );
    clean(out);
    // h: profile 3:1 widens the top layers: x -1..11, z -1..7; the roof (9 + 2 deep) closes in layer 5, y=10.
    expect(name(out, -1, 11, 7)).toBe('spruce_planks');
    expect(name(out, 11, 11, 7)).toBe('spruce_planks');
    expect(name(out, 34, 7, 40)).toBe('spruce_planks');
    expect(name(out, 60, 3, 0)).toBe('spruce_planks');
    expect(name(out, 13, 20, 9)).toBe('spruce_planks');
  });

  it('meldet unbekannte Felder und Formen mit Zeile', () => {
    const out = c2('box h 0,0,0 2,2,2 stein\nbox {h.breite},0,0 1,1,1 stein\nbox {k.x0},0,0 1,1,1 stein\nbox {h.r},0,0 1,1,1 stein');
    expect(errors(out).map((e) => e.line)).toEqual([line(2), line(3), line(4)]);
    expect(errors(out)[0].message).toContain('breite');
    expect(errors(out)[1].message).toContain('„k“');
  });

  it('erlaubt Dezimalzahlen nur, wo es vorgesehen ist', () => {
    expect(errors(c2('box 0,0,0 2,2,2 stein\nzylinder z 0,0,0 r=2.5 h=2 stein'))[0].message).toContain('ganze Zahl');
    clean(c2('vieleck v 0,0,0 n=6 r=3 h=1 stein drehung=12.5'));
  });
});

describe('Bau-Sprache 2: Rollen', () => {
  const p = new Palette({}, 2);

  it('leitet alle Glieder ohne Katalog ab', () => {
    expect(p.member('minecraft:spruce_planks', 'fence')).toBe('minecraft:spruce_fence');
    expect(p.member('minecraft:spruce_planks', 'fence_gate')).toBe('minecraft:spruce_fence_gate');
    expect(p.member('minecraft:spruce_planks', 'trapdoor')).toBe('minecraft:spruce_trapdoor');
    expect(p.member('minecraft:spruce_planks', 'door')).toBe('minecraft:spruce_door');
    expect(p.member('minecraft:spruce_planks', 'button')).toBe('minecraft:spruce_button');
    expect(p.member('minecraft:spruce_planks', 'pressure_plate')).toBe('minecraft:spruce_pressure_plate');
    expect(p.member('minecraft:nether_bricks', 'fence')).toBe('minecraft:nether_brick_fence');
    expect(p.member('minecraft:iron_block', 'trapdoor')).toBe('minecraft:iron_trapdoor');
    expect(p.member('minecraft:iron_block', 'door')).toBe('minecraft:iron_door');
    expect(p.member('minecraft:stone', 'button')).toBe('minecraft:stone_button');
    expect(p.member('minecraft:stone', 'pressure_plate')).toBe('minecraft:stone_pressure_plate');
    expect(p.member('minecraft:polished_blackstone', 'button')).toBe('minecraft:polished_blackstone_button');
    expect(p.member('minecraft:glass', 'pane')).toBe('minecraft:glass_pane');
    expect(p.member('minecraft:red_stained_glass', 'pane')).toBe('minecraft:red_stained_glass_pane');
    expect(p.member('minecraft:white_wool', 'carpet')).toBe('minecraft:white_carpet');
    expect(p.member('minecraft:moss_block', 'carpet')).toBe('minecraft:moss_carpet');
    expect(p.member('minecraft:stone_bricks', 'fence')).toBeNull();
    expect(p.member('minecraft:stone_bricks', 'button')).toBeNull();
  });

  it('nimmt einen Block, der selbst ein Glied ist, als dieses Glied', () => {
    expect(p.member('minecraft:spruce_trapdoor', 'trapdoor')).toBe('minecraft:spruce_trapdoor');
    expect(p.member('minecraft:oak_fence', 'fence')).toBe('minecraft:oak_fence');
    const out = c2('rolle laden spruce_trapdoor\nblock 0,0,0 laden:block\nblock 1,0,0 laden:falltuer');
    clean(out);
    expect(name(out, 0, 0, 0)).toBe('spruce_trapdoor');
    expect(name(out, 1, 0, 0)).toBe('spruce_trapdoor');
  });

  it('nimmt Glieder mit Katalog aus dessen Familien', () => {
    const q = new Palette({ known: ['mod:tiles', 'mod:tile_gate', 'mod:tile_plate'], families: { 'mod:tiles': { fence_gate: 'mod:tile_gate', pressure_plate: 'mod:tile_plate' } } }, 2);
    expect(q.member('mod:tiles', 'fence_gate')).toBe('mod:tile_gate');
    expect(q.member('mod:tiles', 'pressure_plate')).toBe('mod:tile_plate');
    expect(q.member('mod:tiles', 'door')).toBeNull();
  });

  it('spricht Glieder mit rolle:glied an und erlaubt feste Glieder in der Rolle', () => {
    const out = c2('rolle zier oak_planks zauntor=birch_fence_gate\nlinie 0,0,0 3,0,0 holz:zaun\nblock 0,1,0 holz:treppe\nblock 0,2,0 zier:zauntor\nblock 0,3,0 holz:teppich');
    expect(errors(out).map((e) => e.message)).toEqual([expect.stringContaining('Teppich')]);
    expect(name(out, 1, 0, 0)).toBe('spruce_fence');
    expect(at(out, 1, 0, 0)?.props).toMatchObject({ east: 'true', west: 'true' });
    expect(name(out, 0, 1, 0)).toBe('spruce_stairs');
    expect(name(out, 0, 2, 0)).toBe('birch_fence_gate');
  });

  it('versteht Block-Angaben; der Rollenname hat Vorrang vor einer gleichnamigen Block-ID', () => {
    const out = c2('rolle stone oak_planks\nblock 0,0,0 stone\nblock 1,0,0 lantern[hanging=true]\nblock 2,0,0 create:andesite_casing\nblock 3,0,0 stone:stufe');
    clean(out);
    expect(name(out, 0, 0, 0)).toBe('oak_planks');
    expect(at(out, 1, 0, 0)?.props).toMatchObject({ hanging: 'true' });
    expect(at(out, 2, 0, 0)?.name).toBe('create:andesite_casing');
    expect(name(out, 3, 0, 0)).toBe('oak_slab');
  });

  it('verteilt muster=flecken in zusammenhängenden Flecken nach Gewicht', () => {
    const plain = compileTess('tess 2\nrolle m stone_bricks:6 mossy_stone_bricks:2 andesite:2\nbox 0,0,0 63,0,63 m');
    const patchy = compileTess('tess 2\nrolle m stone_bricks:6 mossy_stone_bricks:2 andesite:2 muster=flecken:4\nbox 0,0,0 63,0,63 m');
    const same = (out: Out) => {
      let n = 0;
      let s = 0;
      for (let z = 0; z < 64; z++)
        for (let x = 0; x < 63; x++) {
          n++;
          if (out.grid.get(x, 0, z)!.name === out.grid.get(x + 1, 0, z)!.name) s++;
        }
      return s / n;
    };
    expect(same(patchy)).toBeGreaterThan(same(plain) + 0.2);
    const share = patchy.grid.entries().filter(([, , , s]) => s.name === 'minecraft:stone_bricks').length / 4096;
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.75);
  });

  it('nimmt bei muster=lagen eine Sorte pro Lagenband', () => {
    const out = compileTess('tess 2\nsamen 3\nrolle m stone_bricks:1 andesite:1 granite:1 muster=lagen:2\nbox 0,0,0 9,19,9 m');
    const kinds: string[] = [];
    for (let y = 0; y < 20; y++) {
      const names = new Set(blocksIn(out, y).map(([, , , s]) => s.name));
      expect(names.size).toBe(1);
      kinds.push([...names][0]);
    }
    for (let y = 0; y < 20; y += 2) expect(kinds[y]).toBe(kinds[y + 1]);
    expect(new Set(kinds).size).toBeGreaterThan(1);
    expect(errors(compileTess('tess 2\nrolle m stone muster=wellen'))[0].message).toContain('flecken');
  });
});

describe('Bau-Sprache 2: Formen', () => {
  it('zylinder mit d: ungerade wie r, gerade um die Ecke zwischen vier Zellen', () => {
    const a = c2('zylinder z 0,0,0 d=5 h=1 stein');
    const b = c2('zylinder z 0,0,0 r=2 h=1 stein');
    expect(layer(a, 0)).toEqual(layer(b, 0));
    expect(layer(c2('zylinder z 0,0,0 d=2 h=1 stein'), 0)).toEqual(new Set(['0,0', '1,0', '0,1', '1,1']));
    const d4 = layer(c2('zylinder z 0,0,0 d=4 h=1 stein'), 0);
    expect(d4.size).toBe(12);
    for (const c of ['-1,-1', '2,-1', '-1,2', '2,2']) expect(d4.has(c)).toBe(false);
    const d6 = layer(c2('zylinder z 0,0,0 d=6 h=1 stein'), 0);
    for (const c of d6) {
      const [x, z] = c.split(',').map(Number);
      expect(d6.has(`${1 - x},${z}`) && d6.has(`${x},${1 - z}`)).toBe(true);
    }
  });

  it('zylinder mit rx und rz ist eine Ellipse', () => {
    const out = c2('zylinder e 0,0,0 rx=4 rz=2 h=1 stein');
    expect(xs(out, 0, 0)).toEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4]);
    expect(xs(out, 0, 1)).toEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4]);
    expect(xs(out, 0, 2)).toEqual([-2, -1, 0, 1, 2]);
    expect(xs(out, 0, 3)).toEqual([]);
    expect(errors(c2('zylinder e 0,0,0 rx=4 h=1 stein'))[0].message).toContain('rx= und rz=');
  });

  it('vieleck: gerade Seite nach Norden, Umkreis r+0,5, drehung dreht', () => {
    const out = c2('vieleck v 0,0,0 n=8 r=5 h=1 stein');
    expect(xs(out, 0, -5)).toEqual([-2, -1, 0, 1, 2]);
    expect(xs(out, 0, 0)).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
    const cells = layer(out, 0);
    for (const c of cells) {
      const [x, z] = c.split(',').map(Number);
      for (const m of [`${-x},${z}`, `${x},${-z}`, `${z},${x}`]) expect(cells.has(m)).toBe(true);
    }
    const turned = layer(c2('vieleck v 0,0,0 n=8 r=5 h=1 stein drehung=0'), 0);
    expect(turned).not.toEqual(cells);
    const tri = c2('vieleck v 0,0,0 n=3 r=4 h=1 stein drehung=0');
    expect(xs(tri, 0, -4)).toEqual([0]);
  });

  it('umriss ergibt rechtwinklige Formen exakt', () => {
    const L = c2('umriss l y=0 h=1 punkte=0,0;6,0;6,3;3,3;3,8;0,8 stein');
    clean(L);
    expect(layer(L, 0).size).toBe(7 * 4 + 4 * 5);
    expect(layer(L, 0).has('5,4')).toBe(false);
    expect(layer(c2('umriss r y=0 h=1 punkte=0,0;10,0;10,6;0,6 stein'), 0)).toEqual(layer(c2('box 0,0,0 10,0,6 stein'), 0));
    expect(errors(c2('umriss r y=0 h=1 punkte=0,0;10,0 stein'))[0].message).toContain('drei Punkte');
  });

  it('grundriss: Zeilen nach Süden, Zeichen nach Osten, Leerzeichen und . außen', () => {
    const out = c2('grundriss g 5,0,7 h=2 stein\n|###\n|#.#\n| ##');
    clean(out);
    expect(layer(out, 1)).toEqual(new Set(['5,7', '6,7', '7,7', '5,8', '7,8', '6,9', '7,9']));
    expect(errors(c2('grundriss g 0,0,0 h=1 stein'))[0].message).toContain('Zeichnung');
  });

  it('kugel: ganz, oben, unten und hohl', () => {
    const full = c2('kugel k 0,10,0 r=3 stein');
    let n = 0;
    for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) for (let z = -3; z <= 3; z++) if (x * x + y * y + z * z <= 3.5 * 3.5) n++;
    expect(full.grid.size).toBe(n);
    const top = c2('kugel k 0,10,0 r=3 stein teil=oben');
    expect(top.grid.entries().every(([, y]) => y >= 10)).toBe(true);
    const bottom = c2('kugel k 0,10,0 r=3 stein teil=unten');
    expect(bottom.grid.entries().every(([, y]) => y <= 10)).toBe(true);
    const hollow = c2('kugel k 0,10,0 r=3 stein hohl');
    expect(at(hollow, 0, 10, 0)).toBeNull();
    expect(at(hollow, 1, 10, 1)).toBeNull();
    expect(name(hollow, 3, 10, 0)).toBe('stone_bricks');
    expect(name(hollow, 0, 13, 0)).toBe('stone_bricks');
  });

  it('wand=n macht die Wand n dick', () => {
    const out = c2('box b 0,0,0 8,2,8 stein hohl wand=2');
    expect(name(out, 1, 1, 4)).toBe('stone_bricks');
    expect(at(out, 2, 1, 4)).toBeNull();
    expect(xs(out, 1, 4)).toEqual([0, 1, 7, 8]);
  });

  it('zonen: Wandrolle nach Höhe, spätere Einträge haben Vorrang, Sockel und Kranz bleiben', () => {
    const out = c2('box b 0,0,0 6,6,6 stein hohl sockel=holz kranz=holz zonen=putz@1-3,balken@3-');
    clean(out);
    expect(name(out, 3, 0, 0)).toBe('spruce_planks'); // sockel
    expect(name(out, 3, 1, 0)).toBe('white_terracotta');
    expect(name(out, 3, 2, 0)).toBe('white_terracotta');
    expect(name(out, 3, 3, 0)).toBe('dark_oak_log'); // later entry wins
    expect(name(out, 3, 5, 0)).toBe('dark_oak_log');
    expect(name(out, 3, 6, 0)).toBe('spruce_planks'); // kranz
  });

  it('ecken: box, vieleck (Ecken des Vielecks) und umriss (nur konvexe Ecken)', () => {
    const v = c2('vieleck v 0,0,0 n=8 r=5 h=1 stein ecken=holz');
    expect(name(v, 2, 0, -5)).toBe('spruce_planks');
    expect(name(v, -3, 0, -5)).toBeNull();
    expect(name(v, 0, 0, -5)).toBe('stone_bricks');
    const corners = v.grid.entries().filter(([, , , s]) => s.name === 'minecraft:spruce_planks');
    expect(corners.length).toBe(8);
    const u = c2('umriss l y=0 h=1 punkte=0,0;6,0;6,3;3,3;3,8;0,8 stein ecken=holz');
    for (const [x, z] of [[0, 0], [6, 0], [6, 3], [3, 8], [0, 8]]) expect(name(u, x, 0, z)).toBe('spruce_planks');
    expect(name(u, 3, 0, 3)).toBe('stone_bricks');
    expect(errors(c2('zylinder z 0,0,0 r=3 h=1 stein ecken=holz'))[0].message).toContain('Ecken');
  });

  it('sockel und kranz mit Höhe, Rangfolge ecken > sockel > kranz > Fachwerk > zonen', () => {
    const out = c2('box b 0,0,0 8,8,4 stein hohl ecken=holz sockel=putz:2 kranz=putz:2 fachwerk=balken zonen=glas@0-')
    expect(errors(out)).toEqual([]);
    expect(name(out, 0, 0, 0)).toBe('spruce_planks');
    expect(name(out, 0, 5, 0)).toBe('spruce_planks');
    expect(name(out, 2, 1, 0)).toBe('white_terracotta');
    expect(name(out, 2, 7, 0)).toBe('white_terracotta');
    expect(at(out, 4, 4, 0)?.key).toBe('minecraft:dark_oak_log[axis=y]'); // post every 4
    expect(at(out, 2, 2, 0)?.key).toBe('minecraft:dark_oak_log[axis=x]'); // sill above the 2-high plinth
    expect(name(out, 2, 4, 0)).toBe('glass_pane'); // zone in the field
  });
});

describe('Bau-Sprache 2: Wandprofile und Konsolen', () => {
  it('verschiebt den Umriss pro Lage, mit ~ linear und gerundet weg von null', () => {
    const out = c2('box b 0,0,0 10,6,10 stein profil=0:2~,4:0,5:-1');
    clean(out);
    const minX = (y: number) => xs(out, y, 5)[0];
    expect([0, 1, 2, 3, 4, 5, 6].map(minX)).toEqual([-2, -2, -1, -1, 0, 1, 1]);
    expect(errors(c2('box b 0,0,0 2,3,2 stein profil=2:-2'))[0].message).toContain('leer');
    expect(errors(c2('box b 0,0,0 2,3,2 stein profil=2:1,1:0'))[0].message).toContain('aufsteigen');
  });

  it('baut jede Lage mit ihrem eigenen Umriss, auch hohl', () => {
    const out = c2('box b 0,0,0 6,4,6 stein hohl profil=2:1');
    expect(name(out, -1, 2, 3)).toBe('stone_bricks');
    expect(at(out, -1, 1, 3)).toBeNull();
    expect(at(out, 0, 2, 3)).toBeNull(); // inside the wider layer
    expect(name(out, 0, 1, 3)).toBe('stone_bricks');
  });

  it('setzt Konsolen unter eine Vorkragung um 1: umgedrehte Treppen zur Wand', () => {
    const out = c2('box b 0,0,0 6,5,6 stein hohl profil=3:1 konsolen=holz');
    clean(out);
    expect(at(out, 3, 2, -1)?.props).toMatchObject({ facing: 'south', half: 'top' });
    expect(at(out, 7, 2, 3)?.props).toMatchObject({ facing: 'west', half: 'top' });
    expect(name(out, 3, 2, -1)).toBe('spruce_stairs');
    expect(at(out, 3, 1, -1)).toBeNull();
    // Corner with only a diagonal neighbour: along x.
    expect(at(out, -1, 2, -1)?.props.facing).toBe('east');
    expect(errors(c2('box b 0,0,0 6,5,6 stein konsolen=holz'))[0].message).toContain('profil');
  });

  it('setzt bei einer Vorkragung um 2 die Konsolen gestuft (Ring 1 tiefer, Ring 2 an der Lage darunter)', () => {
    const out = c2('box b 0,0,0 6,6,6 stein hohl profil=4:2 konsolen=holz');
    clean(out);
    // Ring 1 (next to the wall below): stair in layer 4-1-1 = 2, full block in layer 3.
    expect(at(out, 3, 2, -1)?.props).toMatchObject({ facing: 'south', half: 'top' });
    expect(name(out, 3, 3, -1)).toBe('spruce_planks');
    // Ring 2 (outside): stair in layer 3.
    expect(at(out, 3, 3, -2)?.props).toMatchObject({ facing: 'south', half: 'top' });
    expect(at(out, 3, 2, -2)).toBeNull();
    expect(name(out, 3, 4, -2)).toBe('stone_bricks');
  });

  it('Bauteile nehmen den Umriss ihrer Lage', () => {
    const out = c2('box b 0,0,0 8,7,6 stein hohl profil=4:1\nfenster b n y=5 x=3');
    clean(out);
    expect(name(out, 3, 5, -1)).toBe('glass_pane');
    expect(name(out, 3, 4, -2)).toBe('spruce_stairs'); // sill outside the overhanging wall
  });
});

describe('Bau-Sprache 2: Fachwerk', () => {
  const frame = (opts: string) => c2(`box b 0,0,0 8,4,4 putz hohl fachwerk=balken raster=4 ${opts}`);

  it('Pfosten an den Enden und im Raster, Balken unten, oben und als Riegel', () => {
    const out = c2('box b 0,0,0 8,6,4 putz hohl sockel=stein fachwerk=balken riegel=4');
    clean(out);
    for (const x of [0, 4, 8]) expect(at(out, x, 3, 0)?.key).toBe('minecraft:dark_oak_log[axis=y]');
    expect(at(out, 2, 1, 0)?.key).toBe('minecraft:dark_oak_log[axis=x]'); // sill above the plinth
    expect(at(out, 2, 4, 0)?.key).toBe('minecraft:dark_oak_log[axis=x]'); // rail
    expect(at(out, 2, 6, 0)?.key).toBe('minecraft:dark_oak_log[axis=x]'); // top
    expect(at(out, 0, 2, 0)?.key).toBe('minecraft:dark_oak_log[axis=y]'); // corner post
    expect(at(out, 0, 4, 2)?.key).toBe('minecraft:dark_oak_log[axis=z]'); // west wall: rail along z
    expect(name(out, 0, 2, 2)).toBe('white_terracotta');
    expect(name(out, 2, 3, 0)).toBe('white_terracotta');
    expect(errors(c2('box b 0,0,0 8,6,4 putz riegel=2'))[0].message).toContain('fachwerk');
    expect(errors(c2('box b 0,0,0 8,6,4 putz fachwerk=balken riegel=6'))[0].message).toContain('riegel');
  });

  it('muster=strebe: eine Diagonale pro Feld, von unten außen nach oben innen, Richtung wechselt', () => {
    const out = frame('muster=strebe');
    clean(out);
    const strut = (x: number, y: number) => at(out, x, y, 0)?.name === 'minecraft:dark_oak_log';
    expect([strut(1, 1), strut(2, 2), strut(3, 3)]).toEqual([true, true, true]);
    expect([strut(3, 1), strut(1, 3)]).toEqual([false, false]);
    expect([strut(7, 1), strut(6, 2), strut(5, 3)]).toEqual([true, true, true]);
    expect([strut(5, 1), strut(7, 3)]).toEqual([false, false]);
  });

  it('muster=kreuz und muster=raute', () => {
    const k = frame('muster=kreuz');
    for (const [x, y] of [[1, 1], [2, 2], [3, 3], [3, 1], [1, 3]]) expect(name(k, x, y, 0)).toBe('dark_oak_log');
    expect(name(k, 2, 1, 0)).toBe('white_terracotta');
    const r = frame('muster=raute');
    for (const [x, y] of [[2, 1], [1, 2], [3, 2], [2, 3]]) expect(name(r, x, y, 0)).toBe('dark_oak_log');
    for (const [x, y] of [[1, 1], [2, 2], [3, 3]]) expect(name(r, x, y, 0)).toBe('white_terracotta');
  });

  it('schraeg=treppe setzt Treppen in Steigrichtung, streben= eine andere Rolle', () => {
    const out = frame('muster=strebe schraeg=treppe streben=holz');
    clean(out);
    expect(at(out, 1, 1, 0)?.props).toMatchObject({ facing: 'east', half: 'bottom' });
    expect(name(out, 1, 1, 0)).toBe('spruce_stairs');
    expect(at(out, 7, 1, 0)?.props).toMatchObject({ facing: 'west', half: 'bottom' });
    expect(errors(c2('rolle w white_wool\nbox b 0,0,0 8,4,4 putz fachwerk=balken muster=strebe schraeg=treppe streben=w'))[0].message).toContain('Treppen');
  });

  it('auf dem Vieleck nur an den geraden Seiten in den Hauptrichtungen, mit Hinweis', () => {
    const out = c2('vieleck v 0,0,0 n=8 r=5 h=4 putz hohl fachwerk=balken');
    expect(errors(out)).toEqual([]);
    expect(warnings(out).map((w) => w.message)).toEqual([expect.stringContaining('schrägen Seiten')]);
    expect(at(out, -2, 2, -5)?.key).toBe('minecraft:dark_oak_log[axis=y]');
    expect(at(out, 2, 2, -5)?.key).toBe('minecraft:dark_oak_log[axis=y]');
    expect(at(out, 0, 0, -5)?.key).toBe('minecraft:dark_oak_log[axis=x]');
    expect(name(out, 3, 2, -4)).toBe('white_terracotta');
    expect(errors(c2('zylinder z 0,0,0 r=4 h=3 putz fachwerk=balken'))[0].message).toContain('Fachwerk');
  });

  it('ringbalken=ja führt die Balken über schräge Seiten, mit Pfosten an den Ecken und ohne Hinweis', () => {
    const out = c2('vieleck v 0,0,0 n=8 r=5 h=4 putz hohl fachwerk=balken ringbalken=ja');
    clean(out);
    expect(name(out, 3, 0, -4)).toBe('dark_oak_log'); // slanted side: sill beam
    expect(name(out, 3, 3, -4)).toBe('dark_oak_log'); // top beam
    expect(name(out, 3, 1, -4)).toBe('white_terracotta');
    expect(at(out, 2, 1, -5)?.props.axis).toBe('y'); // corner post
  });

  it('ein Fenster im Feld ersetzt die Strebe ohne Hinweis', () => {
    const out = c2('box b 0,0,0 8,4,4 putz hohl fachwerk=balken muster=kreuz\nfenster b n y=1 x=1 b=3 h=3 bank=nein sturz=nein');
    clean(out);
    expect(name(out, 2, 2, 0)).toBe('glass_pane');
  });

  it('auf umriss an allen geraden Wandstücken, auch an der Innenecke', () => {
    const out = c2('umriss l y=0 h=4 punkte=0,0;8,0;8,4;4,4;4,8;0,8 putz hohl fachwerk=balken');
    clean(out);
    // The inner corner cell has no side towards the outside: the walls meet at (5,4) and (4,5).
    for (const [x, z] of [[8, 4], [5, 4], [4, 5], [4, 8], [0, 8]]) expect(at(out, x, 2, z)?.props.axis).toBe('y');
    expect(at(out, 4, 2, 4)).toBeNull();
    expect(at(out, 6, 2, 4)?.name).toBe('minecraft:white_terracotta');
  });
});

describe('Bau-Sprache 2: Dachmaschine', () => {
  const same = (a: Out, b: Out) => expect(a.grid.entries().map(([x, y, z, s]) => `${x},${y},${z} ${s.key}`).sort()).toEqual(b.grid.entries().map(([x, y, z, s]) => `${x},${y},${z} ${s.key}`).sort());

  it('profil=2/1: Einzug um 2 pro Lage, außen Stufe, innen Treppe', () => {
    const out = c2('box h 0,0,0 10,3,10 stein hohl\ndach walm h profil=2/1 ueberstand=0');
    clean(out);
    expect(at(out, 0, 4, 5)?.key).toBe('minecraft:spruce_slab[type=bottom,waterlogged=false]');
    expect(at(out, 1, 4, 5)?.props).toMatchObject({ facing: 'east', half: 'bottom' });
    expect(at(out, 2, 4, 5)).toBeNull();
    expect(name(out, 2, 5, 5)).toBe('spruce_slab');
    expect(at(out, 3, 5, 5)?.props).toMatchObject({ facing: 'east', half: 'bottom' });
    expect(at(out, 4, 5, 5)).toBeNull();
    expect(name(out, 4, 6, 5)).toBe('spruce_stairs');
    expect(name(out, 5, 6, 5)).toBe('spruce_planks'); // 3×3 top: stairs around a tip
  });

  it('steil=k ist profil=1/k; Voreinstellungen sind ihre Profile', () => {
    same(c2('box h 0,0,0 8,3,6 stein hohl\ndach sattel h steil=2'), c2('box h 0,0,0 8,3,6 stein hohl\ndach sattel h profil=1/2'));
    same(c2('vieleck v 0,0,0 n=8 r=5 h=2 stein hohl\ndach helm v profil=glocke'), c2('vieleck v 0,0,0 n=8 r=5 h=2 stein hohl\ndach helm v profil=2/1,1/1,1/2,1/3'));
    same(c2('box h 0,0,0 8,3,6 stein hohl\ndach sattel h profil=mansard'), c2('box h 0,0,0 8,3,6 stein hohl\ndach sattel h profil=1/3,1/3,2/1'));
    expect(errors(c2('zylinder z 0,0,0 r=3 h=1 stein\ndach kegel z profil=mansard'))[0].message).toContain('mansard');
    expect(errors(c2('box h 0,0,0 8,3,6 stein\ndach sattel h profil=zwiebel'))[0].message).toContain('zwiebel');
    expect(errors(c2('box h 0,0,0 8,3,6 stein\ndach sattel h profil=1/2 steil=2'))[0].message).toContain('schließen sich aus');
  });

  it('Bauch (Zwiebel): umgedrehte Treppen, wo die Lage nach außen wächst', () => {
    const out = c2('zylinder z 0,0,0 r=3 h=1 stein hohl\ndach kegel z profil=zwiebel ueberstand=0');
    clean(out);
    expect(name(out, 3, 1, 0)).toBe('spruce_planks'); // shell under the first belly
    expect(at(out, 4, 2, 0)?.props).toMatchObject({ facing: 'west', half: 'top' });
    expect(at(out, 5, 3, 0)?.props).toMatchObject({ facing: 'west', half: 'top' });
    expect(name(out, 5, 4, 0)).toBe('spruce_planks'); // 0/2: vertical part
    expect(at(out, 5, 5, 0)?.props).toMatchObject({ facing: 'west', half: 'bottom' });
  });

  it('kuppel: Einzug als Viertelkreis über den Radius', () => {
    const out = c2('zylinder z 0,0,0 r=5 h=1 stein hohl\ndach kegel z profil=kuppel ueberstand=0');
    clean(out);
    const reach = (y: number) => Math.max(...xs(out, y, 0));
    expect([1, 2, 3, 4, 5, 6].map(reach)).toEqual([5, 5, 5, 4, 3, 2]);
    expect(blocksIn(out, 7)).toEqual([]);
  });

  it('Satteldach: schrumpft nur quer zum First, mit Giebel und Ortgang', () => {
    const out = c2('box h 0,0,0 6,3,4 stein hohl\ndach sattel h');
    clean(out);
    expect(at(out, 0, 4, -1)?.props).toMatchObject({ facing: 'south', half: 'bottom', shape: 'straight' });
    expect(at(out, 0, 4, 5)?.props.facing).toBe('north');
    expect(at(out, -1, 6, 1)?.props.facing).toBe('south'); // the slope runs over the full length
    expect(at(out, 3, 7, 2)?.key).toBe('minecraft:spruce_slab[type=bottom,waterlogged=false]');
    expect(name(out, 0, 6, 2)).toBe('stone_bricks'); // gable
    expect(at(out, 1, 6, 2)).toBeNull(); // attic
    expect(at(out, -1, 4, 0)?.props).toMatchObject({ facing: 'east', half: 'top' }); // verge
    expect(at(c2('box h 0,0,0 6,3,4 stein hohl\ndach sattel h kante=nein'), -1, 4, 0)).toBeNull();
    expect(name(c2('box h 0,0,0 6,3,4 stein hohl\ndach sattel h giebel=holz'), 0, 6, 2)).toBe('spruce_planks');
    expect(errors(c2('zylinder z 0,0,0 r=3 h=2 stein\ndach sattel z'))[0].message).toContain('box');
  });

  it('Pultdach steigt zur hohen Seite, Giebel an den Seiten und der hohen Wand', () => {
    const out = c2('box h 0,0,0 5,3,4 stein hohl\ndach pult h hoch=n');
    clean(out);
    expect(at(out, 2, 4, 5)?.props).toMatchObject({ facing: 'north', half: 'bottom' });
    expect(at(out, 2, 9, 0)?.props).toMatchObject({ facing: 'north', half: 'bottom' });
    expect(name(out, 2, 10, -1)).toBe('spruce_slab');
    expect(name(out, 2, 8, 0)).toBe('stone_bricks'); // high wall
    expect(name(out, 0, 6, 2)).toBe('stone_bricks'); // side gable under the roof
    expect(at(out, 0, 6, 3)?.props).toMatchObject({ facing: 'north', half: 'bottom' });
    expect(at(out, 0, 7, 3)).toBeNull();
    expect(errors(c2('box h 0,0,0 5,3,4 stein\ndach pult h'))[0].message).toContain('hoch=');
  });

  it('Krüppelwalm: Walm in den obersten kruppel=n Lagen', () => {
    const out = c2('box h 0,0,0 8,3,6 stein hohl\ndach krueppelwalm h');
    clean(out);
    expect(at(out, -1, 6, 3)?.props).toMatchObject({ facing: 'east', half: 'bottom' });
    expect(at(out, 0, 7, 3)?.props).toMatchObject({ facing: 'east', half: 'bottom' });
    expect(xs(out, 8, 3)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(name(out, 0, 6, 3)).toBe('stone_bricks'); // gable below the hip
    expect(at(out, 0, 7, 2)?.props.facing).not.toBe('east');
    const one = c2('box h 0,0,0 8,3,6 stein hohl\ndach krueppelwalm h kruppel=1');
    expect(at(one, -1, 7, 3)?.props).toMatchObject({ facing: 'east', half: 'bottom' });
    expect(xs(one, 8, 3)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('Walm, Kegel und Helm schrumpfen in der Form ihrer Grundfläche', () => {
    const roof = c2('vieleck v 0,0,0 n=8 r=5 h=1 stein hohl\ndach walm v');
    clean(roof);
    const ring = (r: number) => {
      const a = layer(c2(`vieleck v 0,0,0 n=8 r=${r} h=1 stein`), 0);
      const b = layer(c2(`vieleck v 0,0,0 n=8 r=${r - 1} h=1 stein`), 0);
      return new Set([...a].filter((c) => !b.has(c)));
    };
    const stairs = (y: number) => new Set(blocksIn(roof, y).filter(([, , , s]) => s.name.endsWith('_stairs')).map(([x, , z]) => `${x},${z}`));
    expect(stairs(1)).toEqual(ring(6));
    expect(stairs(2)).toEqual(ring(5));
    const cone = c2('zylinder z 0,0,0 r=3 h=1 stein hohl\ndach kegel z spitze=lightning_rod');
    clean(cone);
    for (let z = -4; z <= 4; z++)
      for (let x = -4; x <= 4; x++) {
        if (x * x + z * z > 4.5 * 4.5) continue;
        expect(cone.grid.entries().some(([xx, y, zz]) => xx === x && zz === z && y >= 1), `${x},${z}`).toBe(true);
      }
    expect(name(cone, 0, 11, 0)).toBe('lightning_rod');
    const helm = c2('box h 0,0,0 6,1,6 stein hohl\ndach helm h ueberstand=0');
    // 1/3: every inset lasts three layers; two of them are vertical (full blocks).
    expect([2, 3, 4].map((y) => name(helm, 0, y, 3))).toEqual(['spruce_planks', 'spruce_planks', 'spruce_stairs']);
  });

  it('ist auch an schrägen Kanten dicht: kein Blick ins Dachinnere', () => {
    for (const src of [
      'vieleck v 0,0,0 n=8 r=6 h=4 stein hohl boden=stein\ndach helm v profil=glocke ueberstand=2',
      'zylinder z 0,0,0 r=6 h=4 stein hohl boden=stein\ndach kegel z',
      'vieleck v 0,0,0 n=6 r=5 h=4 stein hohl boden=stein\ndach walm v',
      'box a 0,0,0 10,3,6 stein hohl boden=stein\ndach sattel a first=x\nbox b 3,0,6 7,3,15 stein hohl boden=stein\ndach sattel b first=z',
    ]) {
      const out = c2(src);
      clean(out);
      const inside = (x: number, y: number, z: number) => y >= 1 && y <= 3 && Math.abs(x) < 20 && out.grid.has(x, 0, z) && !out.grid.has(x, y, z);
      expect(leaks(out.grid, inside), src).toEqual([]);
    }
  });

  it('verschneidet Dächer: Vereinigung der Lagen, Kehle als Treppen-Innenecke, innere Giebel entfallen', () => {
    const out = c2('box a 0,0,0 10,3,6 stein hohl\ndach sattel a first=x\nbox b 3,0,6 7,3,15 stein hohl\ndach sattel b first=z');
    clean(out);
    expect(at(out, 4, 6, 5)?.props).toMatchObject({ facing: 'north', half: 'bottom', shape: expect.stringMatching(/^inner_/) });
    expect(at(out, 6, 6, 5)?.props.shape).toMatch(/^inner_/);
    expect(at(out, 3, 5, 6)?.props.shape).toMatch(/^inner_/);
    for (let z = 5; z <= 16; z++) expect(name(out, 5, 7, z)).toBe('spruce_slab'); // ridge of b runs into a
    expect(at(out, 5, 4, 6)).toBeNull(); // gable of b inside the united roof
    expect(name(out, 5, 4, 15)).toBe('stone_bricks'); // outer gable of b stays
    // Roofs that neither overlap nor touch stay apart.
    const apart = c2('box a 0,0,0 4,2,4 stein hohl\ndach walm a\nbox b 20,0,0 24,2,4 stein hohl\ndach walm b');
    same(apart, c2('box a 0,0,0 4,2,4 stein hohl\ndach walm a\nbox b 20,0,0 24,2,4 stein hohl\nbox c 20,0,0 24,2,4 stein hohl\ndach walm c'));
  });

  it('Krüppelwalm an einem anderen Dach: Walm nur an der freien Giebelseite', () => {
    const out = c2('box a 0,0,0 10,3,6 stein hohl\ndach sattel a first=x\nbox b 3,0,6 7,3,15 stein hohl\ndach krueppelwalm b first=z');
    clean(out);
    // The north end lies against roof a: no hip there, the ridge of b runs into a's slope.
    for (let z = 5; z <= 14; z++) expect(name(out, 5, 7, z), `z=${z}`).toBe('spruce_slab');
    expect(at(out, 5, 7, 4)?.props).toMatchObject({ facing: 'north', half: 'bottom' });
    expect(at(out, 5, 6, 6)).toBeNull(); // no gable of b in the attic
    // The south end is free: gable below, hip in the top two layers.
    expect(name(out, 5, 5, 15)).toBe('stone_bricks');
    expect(at(out, 5, 5, 16)?.props).toMatchObject({ facing: 'north', half: 'bottom' });
    expect(at(out, 5, 6, 15)?.props).toMatchObject({ facing: 'north', half: 'bottom' });
    expect(at(out, 5, 7, 15)).toBeNull();
    // Alone, the same roof has its hip at both ends.
    const alone = c2('box b 3,0,6 7,3,15 stein hohl\ndach krueppelwalm b first=z');
    expect(at(alone, 5, 6, 6)?.props).toMatchObject({ facing: 'south', half: 'bottom' });
    expect(xs(alone, 7, 9)).toEqual([5]);
    expect(at(alone, 5, 7, 6)).toBeNull();
  });

  it('lässt Blöcke stehen, die andere Anweisungen zwischen zwei Dächern gesetzt haben', () => {
    const out = c2('box a 0,0,0 10,3,6 stein hohl\ndach sattel a first=x\nbox 2,4,1 2,9,1 holz\nbox b 3,0,6 7,3,15 stein hohl\ndach sattel b first=z');
    clean(out);
    for (let y = 4; y <= 9; y++) expect(name(out, 2, y, 1)).toBe('spruce_planks');
    expect(at(out, 4, 6, 5)?.props.shape).toMatch(/^inner_/);
  });

  it('biegung verschiebt nur das oberste Drittel', () => {
    const bent = c2('zylinder z 0,0,0 r=3 h=1 stein hohl\ndach helm z biegung=n:3 ueberstand=0');
    const plain = c2('zylinder z 0,0,0 r=3 h=1 stein hohl\ndach helm z ueberstand=0');
    clean(bent);
    // 12 layers (0…11): u = y/11 ≤ 2/3 up to layer 7 stays in place.
    for (let y = 1; y <= 8; y++) expect(layer(bent, y), `y=${y}`).toEqual(layer(plain, y));
    expect(layer(plain, 12)).toEqual(new Set(['0,0']));
    expect(layer(bent, 12)).toEqual(new Set(['0,-3']));
    expect(layer(bent, 11)).toEqual(new Set(['0,-2']));
    expect(errors(c2('box h 0,0,0 4,2,4 stein\ndach sattel h biegung=n:2'))[0].message).toContain('biegung');
  });

  it('firstzier auf jeder Firstzelle, spitze auf der Spitze', () => {
    const out = c2('box h 0,0,0 6,3,4 stein hohl\ndach sattel h firstzier=stone_brick_wall');
    clean(out);
    for (let x = -1; x <= 7; x++) expect(name(out, x, 8, 2)).toBe('stone_brick_wall');
    expect(at(out, 3, 8, 2)?.props).toMatchObject({ east: 'low', west: 'low' });
    const deco = c2('rolle zier stone_bricks\nbox h 0,0,0 6,3,4 stein hohl\ndach sattel h firstzier=zier:mauer');
    expect(name(deco, 3, 8, 2)).toBe('stone_brick_wall');
    const tip = c2('box h 0,0,0 4,2,4 stein hohl\ndach helm h spitze=lantern');
    expect(name(tip, 2, tip.grid.bounds()!.max[1], 2)).toBe('lantern');
    const ridge = c2('box h 0,0,0 6,3,4 stein hohl\ndach sattel h spitze=lantern');
    expect(warnings(ridge).map((w) => w.message)).toEqual([expect.stringContaining('Spitze')]);
  });

  it('traufe setzt unter den Überstand umgedrehte Treppen zur Wand oder obere Stufen', () => {
    const out = c2('box h 0,0,0 6,3,4 stein hohl\ndach sattel h traufe=treppe');
    clean(out);
    expect(at(out, 3, 3, -1)?.props).toMatchObject({ facing: 'south', half: 'top' });
    expect(at(out, 3, 3, 5)?.props).toMatchObject({ facing: 'north', half: 'top' });
    expect(at(out, -1, 3, 2)).toBeNull(); // no roof block above at the gable end
    const slab = c2('box h 0,0,0 6,3,4 stein hohl\ndach sattel h traufe=stufe');
    expect(at(slab, 3, 3, -1)?.key).toBe('minecraft:spruce_slab[type=top,waterlogged=false]');
  });

  it('dicke und fuellen', () => {
    const thin = c2('box h 0,0,0 6,3,8 stein hohl\ndach sattel h first=x');
    const thick = c2('box h 0,0,0 6,3,8 stein hohl\ndach sattel h first=x dicke=2');
    const full = c2('box h 0,0,0 6,3,8 stein hohl\ndach sattel h first=x fuellen');
    expect(at(thin, 3, 4, 0)).toBeNull();
    expect(name(thick, 3, 4, 0)).toBe('spruce_planks');
    expect(at(thick, 3, 4, 2)).toBeNull();
    expect(name(full, 3, 4, 4)).toBe('spruce_planks');
  });

  it('Flachdach mit Überstand, als Stufen und mit Rand', () => {
    const out = c2('box h 0,0,0 4,2,4 stein hohl\ndach flach h');
    clean(out);
    expect(layer(out, 3).size).toBe(49);
    expect(name(out, -1, 3, -1)).toBe('spruce_planks');
    expect(name(c2('box h 0,0,0 4,2,4 stein hohl\ndach flach h art=stufe ueberstand=0'), 2, 3, 2)).toBe('spruce_slab');
    const rim = c2('box h 0,0,0 4,2,4 stein hohl\ndach flach h rand=stein:mauer');
    expect(name(rim, -1, 4, 2)).toBe('stone_brick_wall');
    expect(at(rim, 2, 4, 2)).toBeNull();
    expect(errors(c2('box h 0,0,0 4,2,4 stein hohl\ndach flach h profil=1/1'))[0].message).toContain('Flachdach');
  });

  it('prüft Angaben je Dachtyp und Profile, die nicht schließen', () => {
    expect(errors(c2('box h 0,0,0 4,2,4 stein\ndach walm h first=x'))[0].message).toContain('first=');
    expect(errors(c2('box h 0,0,0 4,2,4 stein\ndach sattel h hoch=n'))[0].message).toContain('hoch=');
    expect(errors(c2('box h 0,0,0 4,2,4 stein\ndach sattel h kruppel=2'))[0].message).toContain('kruppel=');
    expect(errors(c2('box h 0,0,0 4,2,4 stein\ndach walm h profil=0/1'))[0].message).toContain('schließt sich nicht');
    expect(errors(c2('box h 0,0,0 4,2,4 stein\ndach dom h'))[0].message).toContain('Dachform');
  });

  it('Dächer mit Namen haben Felder', () => {
    const out = c2('box h 0,0,0 6,3,4 stein hohl\ndach sattel h name=hd\nblock 0,{hd.dach+1},0 holz\nblock {hd.x0},0,10 holz');
    clean(out);
    expect(name(out, 0, 8, 0)).toBe('spruce_planks');
    expect(name(out, -1, 0, 10)).toBe('spruce_planks');
  });
});

describe('Bau-Sprache 2: Kranzdach', () => {
  it('Ring außen um die Form, steigt zur Wand an, Treppen blicken zur Wand', () => {
    const out = c2('box t 0,0,0 6,9,6 stein hohl\nkranzdach t y=4 breite=2');
    clean(out);
    expect(at(out, 3, 4, -2)?.props).toMatchObject({ facing: 'south', half: 'bottom' });
    expect(at(out, 3, 4, -1)).toBeNull();
    expect(at(out, 3, 5, -1)?.props).toMatchObject({ facing: 'south', half: 'bottom' });
    expect(at(out, 8, 4, 3)?.props.facing).toBe('west');
    expect(at(out, 3, 6, -1)).toBeNull();
    expect(name(out, 0, 5, 0)).toBe('stone_bricks'); // the wall stays
  });

  it('setzt an Fenstern nur in Luft und meldet einen Hinweis', () => {
    const out = c2('box t 0,0,0 6,9,6 stein hohl\nfenster t n y=4 x=3 bank=nein\nkranzdach t y=4 breite=2');
    expect(name(out, 3, 4, 0)).toBe('glass_pane');
    expect(warnings(out).map((w) => w.message)).toEqual([expect.stringContaining('Fenster')]);
  });
});

describe('Herkunft pro Block', () => {
  it('steht für jede Zelle in den Projektdaten, mit dem Text der Anweisung', () => {
    const src = HEAD + 'box h 0,0,0 6,3,4 stein hohl\nfenster h s y=1 \\\n   x=3 # Fenster\ndach sattel h profil=1/1';
    const r = parseTess(new TextEncoder().encode(src));
    const [ox, oy, oz] = r.info.offset!;
    const v = r.volume;
    const originAt = (x: number, y: number, z: number) => r.origins.table[r.origins.ids[((y - oy) * v.sizeZ + (z - oz)) * v.sizeX + (x - ox)]];
    expect(originAt(3, 1, 4)).toMatchObject({ line: line(2), text: 'fenster h s y=1 x=3' });
    expect(originAt(0, 0, 0)).toMatchObject({ line: line(1), text: 'box h 0,0,0 6,3,4 stein hohl' });
    expect(originAt(3, 7, 2)).toMatchObject({ line: line(4) });
    expect(r.origins.ids[0] === 0 || r.origins.table[r.origins.ids[0]].line > 0).toBe(true);
  });

  it('gilt auch für Bau-Sprache 1', () => {
    const r = parseTess(new TextEncoder().encode('tess 1\nrolle a stone # Kommentar\nbox 0,0,0 1,1,1 a   # Würfel'));
    expect(r.origins.table[r.origins.ids[0]]).toMatchObject({ line: 3, text: 'box 0,0,0 1,1,1 a' });
  });

  it('zeigt im Hover eine gekürzte Zeile', () => {
    const o = { line: 57, chain: [], text: 'dach helm turm profil=glocke spitze=lightning_rod firstzier=zier:mauer biegung=n:2' };
    expect(originLabel(o, 200)).toBe('Zeile 57: dach helm turm profil=glocke spitze=lightning_rod firstzier=zier:mauer biegung=n:2');
    const short = originLabel(o, 40);
    expect(short.length).toBeLessThanOrEqual(40);
    expect(short).toMatch(/^Zeile 57: dach helm turm .* …$/);
  });
});

describe('Bau-Sprache 2: weitere Angaben', () => {
  it('Feld z0 und muster=einzeln wie ohne Angabe', () => {
    const out = c2('box h 3,2,5 9,4,8 stein\nblock 0,0,{h.z0} holz');
    expect(name(out, 0, 0, 5)).toBe('spruce_planks');
    const a = compileTess('tess 2\nrolle m stone_bricks:3 andesite:1\nbox 0,0,0 9,0,9 m');
    const b = compileTess('tess 2\nrolle m stone_bricks:3 andesite:1 muster=einzeln\nbox 0,0,0 9,0,9 m');
    expect(a.grid.entries().map((e) => e[3].key)).toEqual(b.grid.entries().map((e) => e[3].key));
  });

  it('boden und decke auf neuen Formen, wand und zonen auf der kugel', () => {
    const v = c2('vieleck v 0,0,0 n=8 r=4 h=5 stein hohl boden=holz decke=putz');
    expect(name(v, 0, 0, 0)).toBe('spruce_planks');
    expect(name(v, 0, 4, 0)).toBe('white_terracotta');
    expect(at(v, 0, 2, 0)).toBeNull();
    const k = c2('kugel k 0,10,0 r=5 stein hohl wand=2 zonen=holz@6-');
    expect(name(k, 4, 10, 0)).toBe('stone_bricks');
    expect(at(k, 3, 10, 0)).toBeNull();
    expect(name(k, 0, 15, 0)).toBe('spruce_planks'); // relative layer 10
    expect(errors(c2('kugel k 0,10,0 r=5 stein profil=2:1'))[0].message).toContain('profil=');
  });

  it('zelt ist ein Walmdach, ueberstand verbreitert die Grundfläche', () => {
    const z = c2('box h 0,0,0 6,2,4 stein hohl\ndach zelt h');
    const w = c2('box h 0,0,0 6,2,4 stein hohl\ndach walm h');
    expect(z.grid.entries().map((e) => e.join())).toEqual(w.grid.entries().map((e) => e.join()));
    const wide = c2('box h 0,0,0 6,2,4 stein hohl\ndach walm h ueberstand=2');
    expect(xs(wide, 3, 2)).toEqual([-2, 8]);
  });

  it('Kranzdach mit breite, steil, rolle und kante', () => {
    const out = c2('rolle schiefer deepslate_tiles\nbox t 0,0,0 6,9,6 stein hohl\nkranzdach t y=4 breite=3 steil=2 rolle=schiefer kante=ja');
    clean(out);
    expect(name(out, 3, 4, -3)).toBe('deepslate_tiles'); // 1/2: two layers per ring, the lower one full
    expect(at(out, 3, 5, -3)?.props).toMatchObject({ facing: 'south', half: 'bottom' });
    expect(name(out, 3, 6, -2)).toBe('deepslate_tiles');
    expect(at(out, 3, 7, -2)?.props.facing).toBe('south');
    expect(at(out, 3, 3, -3)?.props).toMatchObject({ facing: 'south', half: 'top' }); // kante
    expect(errors(c2('box t 0,0,0 6,9,6 stein hohl\nkranzdach t y=12'))[0].message).toContain('y=12');
  });
});

describe('Zielbau 4a: beispiele/wachturm.tess', () => {
  const out = compileTess(readFileSync('beispiele/wachturm.tess', 'utf8'));
  const west = (cells: Set<string>) => new Set([...cells].filter((c) => Number(c.split(',')[0]) <= 5)); // without the annex
  const ring = (r: number) => west(layer(c2(`vieleck v 0,0,0 n=8 r=${r} h=1 stein hohl`), 0));

  it('übersetzt ohne Fehler und ohne Hinweise', () => clean(out));

  it('Turm: achteckig, unten breiter, verjüngt, ab Lage 18 vorgekragt mit Konsolen, Fenster in mehreren Höhen', () => {
    // r=5 with profile 0:2,3:2~,12:0,18:1 → r=7 up to layer 5, r=6 up to 9, r=5 up to 17, r=6 from 18.
    expect(west(layer(out, 1))).toEqual(ring(7));
    expect(west(layer(out, 9))).toEqual(ring(6));
    expect(west(layer(out, 16))).toEqual(ring(5));
    expect(west(layer(out, 23))).toEqual(ring(6));
    expect(at(out, -6, 17, 0)?.props).toMatchObject({ facing: 'east', half: 'top' }); // console under the overhang
    expect(name(out, -6, 17, 0)).toBe('stone_brick_stairs');
    expect(name(out, -6, 3, 0)).toBe('glass_pane');
    expect(name(out, 0, 14, -5)).toBe('glass_pane');
    expect(name(out, 0, 1, 6)).toBe('spruce_door');
  });

  it('Obergeschoss in Fachwerk mit Schwelle, Riegel, Pfosten und Streben', () => {
    expect(at(out, 0, 18, -6)?.props.axis).toBe('x'); // sill beam
    expect(at(out, 0, 19, -6)?.props.axis).toBe('x'); // riegel=1
    expect(at(out, -2, 20, -6)?.props.axis).toBe('y'); // post
    expect([name(out, 6, 20, -1), name(out, 6, 21, 0), name(out, 6, 22, 1)]).toEqual(['dark_oak_log', 'dark_oak_log', 'dark_oak_log']); // strut
    expect(name(out, 6, 20, 1)).toBe('calcite');
    expect(name(out, -2, 21, -7)).toBe('spruce_trapdoor'); // shutter of the upper window
  });

  it('gestaffelter Helm: Kranzdach am Fuß des Obergeschosses, Glockenhelm mit Spitze', () => {
    expect(at(out, -8, 18, 0)?.props).toMatchObject({ facing: 'east', half: 'bottom' });
    expect(at(out, -7, 19, 0)?.props).toMatchObject({ facing: 'east', half: 'bottom' });
    const top = Math.max(...out.grid.entries().map(([, y]) => y));
    expect(name(out, 0, top, 0)).toBe('lightning_rod');
    expect(name(out, 0, top - 1, 0)).toBe('deepslate_tiles');
  });

  it('Anbau: L aus zwei boxen, Kehle als Innenecke, Krüppelwalm nur an der freien Seite', () => {
    expect(at(out, 8, 5, 4)?.props).toMatchObject({ facing: 'north', shape: expect.stringMatching(/^inner_/) });
    expect(at(out, 11, 7, 10)?.props).toMatchObject({ facing: 'north', half: 'bottom' });
    expect([name(out, 11, 8, 2), name(out, 11, 8, 3)]).toEqual(['deepslate_tile_slab', 'deepslate_tile_slab']);
  });
});
