import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gzipSync } from 'fflate';
import { importFile, ImportError } from '../src/core/importFile';
import { looksLikeTess } from '../src/core/formats/tess';
import { compileTess } from '../src/tess/compile';
import { keyToCell } from '../src/tess/grid';
import { Palette } from '../src/tess/palette';

const HEAD = 'tess 1\nrolle stein stone_bricks\nrolle holz spruce_planks\nrolle glas glass_pane\nrolle rahmen spruce_planks\nrolle tuer spruce_door\n';

function compile(body: string, hints?: Parameters<typeof compileTess>[1]) {
  return compileTess(HEAD + body, hints);
}

const at = (out: ReturnType<typeof compileTess>, x: number, y: number, z: number) => out.grid.get(x, y, z);
const errors = (out: ReturnType<typeof compileTess>) => out.diagnostics.filter((d) => d.level === 'error');
const warnings = (out: ReturnType<typeof compileTess>) => out.diagnostics.filter((d) => d.level === 'warn');
const line = (n: number) => n + 6; // HEAD has 6 lines

describe('Bau-Sprache: Syntax und Fehler', () => {
  it('verlangt tess 1 am Anfang', () => {
    const out = compileTess('rolle a stone\nbox 0,0,0 1,1,1 a');
    expect(errors(out)[0]).toMatchObject({ line: 1 });
    expect(errors(out)[0].message).toContain('tess 1');
  });

  it('meldet jeden Fehler mit Zeilennummer und baut den Rest weiter', () => {
    const out = compile('kiste 0,0,0\nbox 0,0,0 2,2,2 unbekannt\nbox 0,0,0 2,2,2 stein farbe=rot\nbox 0,0 1,1,1 stein\nbox 5,0,0 5,0,0 stein');
    const errs = errors(out);
    expect(errs.map((e) => e.line)).toEqual([line(1), line(2), line(3), line(4)]);
    expect(errs[0].message).toContain('Unbekannter Befehl „kiste“');
    expect(errs[1].message).toContain('„unbekannt“ ist nicht festgelegt');
    expect(errs[2].message).toContain('„farbe=“ gibt es bei „box“ nicht');
    expect(errs[3].message).toContain('x,y,z');
    expect(at(out, 5, 0, 0)?.name).toBe('minecraft:stone_bricks');
  });

  it('meldet einen Fehler einmal, nicht noch einmal bei jedem Bauteil, das davon abhängt', () => {
    const out = compile('rolle zier stone:0\nzylinder t 0,0,0 r=3 h=5 stein hohl kranz=zier\nfenster t s y=2\ntür t s\ndach kegel t rolle=stein');
    expect(errors(out).map((e) => e.line)).toEqual([line(1)]);
  });

  it('versteht Umlaute und ihre Umschreibung gleich', () => {
    const a = compile('box haus 0,0,0 4,3,4 stein hohl\ntür haus s');
    const b = compile('box haus 0,0,0 4,3,4 stein hohl\ntuer haus süd');
    expect(errors(a)).toEqual([]);
    expect(errors(b)).toEqual([]);
    expect(at(a, 2, 1, 4)?.key).toBe(at(b, 2, 1, 4)?.key);
  });

  it('erkennt .tess am Inhalt, nicht an der Endung', () => {
    expect(looksLikeTess(new TextEncoder().encode('# Kommentar\n\ntess 1\n'))).toBe(true);
    expect(looksLikeTess(new TextEncoder().encode('box 0,0,0 1,1,1 a'))).toBe(false);
    expect(looksLikeTess(gzipSync(new TextEncoder().encode('tess 1')))).toBe(false);
  });

  it('wirft beim Import einen Fehler mit allen Zeilen', () => {
    const bytes = new TextEncoder().encode('tess 1\nbox 0,0,0 1,1,1 fehlt\nfenster x s y=1');
    try {
      importFile('a.tess', bytes);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ImportError);
      expect((e as ImportError).message).toBe('Der Bauplan hat 2 Fehler.');
      expect((e as ImportError).detail).toMatch(/^Zeile 2: .*\nZeile 3: /);
    }
  });
});

describe('Bau-Sprache: Rollen', () => {
  it('leitet Treppen und Stufen aus dem Grundblock ab', () => {
    const p = new Palette();
    expect(p.member('minecraft:stone_bricks', 'stairs')).toBe('minecraft:stone_brick_stairs');
    expect(p.member('minecraft:spruce_planks', 'slab')).toBe('minecraft:spruce_slab');
    expect(p.member('minecraft:deepslate_tiles', 'stairs')).toBe('minecraft:deepslate_tile_stairs');
    expect(p.member('minecraft:quartz_block', 'stairs')).toBe('minecraft:quartz_stairs');
    expect(p.member('minecraft:cracked_stone_bricks', 'stairs')).toBeNull();
    expect(p.member('minecraft:stone', 'wall')).toBeNull();
  });

  it('nimmt mit Katalog nur Blöcke, die es gibt, und die Familien des Katalogs', () => {
    const p = new Palette({ known: ['minecraft:quartz_block', 'minecraft:quartz_stairs', 'mod:roof'], families: { 'mod:tiles': { stairs: 'mod:roof' } } });
    expect(p.member('minecraft:quartz_block', 'stairs')).toBe('minecraft:quartz_stairs');
    expect(p.member('minecraft:quartz_block', 'slab')).toBeNull();
    expect(p.member('mod:tiles', 'stairs')).toBe('mod:roof');
  });

  it('mischt nach Gewicht, mit festem Startwert immer gleich', () => {
    const src = 'tess 1\nrolle m stone_bricks:7 mossy_stone_bricks:2 cracked_stone_bricks:1\nbox 0,0,0 29,0,29 m';
    const a = compileTess(src);
    const b = compileTess(src);
    const c = compileTess(src.replace('tess 1', 'tess 1\nsamen 99'));
    const count = (out: ReturnType<typeof compileTess>, id: string) => [...out.grid.cells.values()].filter((i) => out.grid.states[i].name === id).length;
    expect(count(a, 'minecraft:stone_bricks')).toBe(count(b, 'minecraft:stone_bricks'));
    expect(count(a, 'minecraft:stone_bricks') / 900).toBeGreaterThan(0.6);
    expect(count(a, 'minecraft:stone_bricks') / 900).toBeLessThan(0.8);
    const keys = (out: ReturnType<typeof compileTess>) => [...out.grid.cells.values()].join();
    expect(keys(a)).toBe(keys(b));
    expect(keys(a)).not.toBe(keys(c));
  });

  it('nimmt für Treppen einer Mischung nur Sorten mit Treppe', () => {
    const out = compileTess('tess 1\nrolle m stone_bricks cracked_stone_bricks\nbox h 0,0,0 4,2,4 m hohl\ndach walm h rolle=m');
    expect(errors(out)).toEqual([]);
    const names = new Set([...out.grid.cells.values()].map((i) => out.grid.states[i].name));
    expect(names.has('minecraft:stone_brick_stairs')).toBe(true);
    expect([...names].some((n) => n.startsWith('minecraft:cracked') && n.endsWith('stairs'))).toBe(false);
  });

  it('meldet eine fehlende Treppe mit der Zeile der Rolle', () => {
    const out = compileTess('tess 1\nrolle d white_wool\nbox h 0,0,0 4,2,4 d hohl\ndach walm h rolle=d');
    expect(errors(out)[0].line).toBe(4);
    expect(errors(out)[0].message).toContain('(Zeile 2)');
    expect(errors(out)[0].message).toContain('treppe=');
  });
});

describe('Bau-Sprache: Grundformen', () => {
  it('baut eine hohle box mit Fachwerk, Sockel und liegenden Balken', () => {
    const out = compileTess('tess 1\nrolle w white_terracotta\nrolle b dark_oak_log\nrolle s cobblestone\nbox h 0,0,0 8,4,4 w hohl fachwerk=b sockel=s');
    expect(errors(out)).toEqual([]);
    expect(at(out, 0, 0, 0)?.name).toBe('minecraft:cobblestone');
    expect(at(out, 4, 2, 0)?.key).toBe('minecraft:dark_oak_log[axis=y]'); // post every 4
    expect(at(out, 2, 1, 0)?.key).toBe('minecraft:dark_oak_log[axis=x]'); // sill beam above the plinth
    expect(at(out, 0, 4, 2)?.key).toBe('minecraft:dark_oak_log[axis=z]'); // top beam on the west wall
    expect(at(out, 2, 2, 0)?.name).toBe('minecraft:white_terracotta');
    expect(at(out, 2, 2, 2)).toBeNull();
  });

  it('macht runde Zylinder ohne Lücken in der Wand', () => {
    const out = compileTess('tess 1\nrolle s stone_bricks\nzylinder t 0,0,0 r=4 h=1 s hohl');
    const cells = [...out.grid.cells.keys()].map(keyToCell);
    expect(cells.length).toBeGreaterThan(20);
    // Every wall cell has two wall neighbours (8-connected ring).
    for (const [x, , z] of cells) {
      let n = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) if (out.grid.has(x + dx, 0, z + dz)) n++;
      expect(n).toBeGreaterThanOrEqual(2);
    }
    expect(out.grid.has(0, 0, 0)).toBe(false);
    expect(out.grid.has(4, 0, 0)).toBe(true);
  });

  it('räumt in einer hohlen Form aus, was vorher drin war', () => {
    const out = compileTess('tess 1\nrolle s stone\nbox 0,0,0 6,3,6 s\nbox 0,0,0 6,3,6 s hohl');
    expect(out.grid.has(3, 1, 3)).toBe(false);
  });
});

describe('Bau-Sprache: Bauteile', () => {
  it('setzt ein Fenster mit Bank, Sturz und Läden in die Südwand', () => {
    const out = compile('rolle laden spruce_trapdoor\nbox h 0,0,0 6,4,4 stein hohl\nfenster h s y=2 x=3 laeden=laden');
    expect(errors(out)).toEqual([]);
    expect(warnings(out)).toEqual([]);
    expect(at(out, 3, 2, 4)?.name).toBe('minecraft:glass_pane');
    expect(at(out, 3, 3, 4)?.name).toBe('minecraft:glass_pane');
    expect(at(out, 3, 2, 4)?.props).toMatchObject({ east: 'true', west: 'true', north: 'false', south: 'false' });
    expect(at(out, 3, 1, 5)?.props).toMatchObject({ facing: 'north', half: 'top' }); // sill outside, against the wall
    expect(at(out, 3, 1, 5)?.name).toBe('minecraft:spruce_stairs');
    expect(at(out, 2, 4, 4)?.name).toBe('minecraft:spruce_planks'); // lintel one wider than the window
    expect(at(out, 4, 4, 4)?.name).toBe('minecraft:spruce_planks');
    expect(at(out, 2, 2, 5)?.props).toMatchObject({ facing: 'south', open: 'true' });
    expect(at(out, 4, 3, 5)?.props).toMatchObject({ facing: 'south', open: 'true' });
  });

  it('richtet Fenster auf allen Seiten nach außen', () => {
    const out = compile('box h 0,0,0 6,4,6 stein hohl\nfenster h n y=2\nfenster h o y=2\nfenster h w y=2');
    expect(at(out, 3, 1, -1)?.props.facing).toBe('south');
    expect(at(out, 7, 1, 3)?.props.facing).toBe('west');
    expect(at(out, -1, 1, 3)?.props.facing).toBe('east');
  });

  it('verteilt mehrere Fenster mittig mit Abstand', () => {
    const out = compile('box h 0,0,0 12,4,4 stein hohl\nfenster h s y=2 anzahl=3 abstand=4');
    const glass = [...out.grid.cells.entries()].filter(([, i]) => out.grid.states[i].name === 'minecraft:glass_pane').map(([k]) => keyToCell(k)[0]);
    expect([...new Set(glass)].sort((a, b) => a - b)).toEqual([2, 6, 10]);
  });

  it('warnt bei Fenstern im Pfosten, in der Ecke und in der Luft', () => {
    const out = compileTess(
      'tess 1\nrolle w white_terracotta\nrolle b oak_log\nrolle glas glass\nrolle rahmen oak_planks\nbox h 0,0,0 8,4,4 w hohl fachwerk=b\nfenster h s y=2 x=4\nfenster h s y=2 x=0\nfenster h s y=2 x=20',
    );
    const w = warnings(out).map((d) => d.message);
    expect(w.some((m) => m.includes('Pfosten'))).toBe(true);
    expect(w.some((m) => m.includes('Hausecke'))).toBe(true);
    expect(w.some((m) => m.includes('nicht in der Wand'))).toBe(true);
  });

  it('verlangt die Position entlang der Wand mit der passenden Achse', () => {
    const out = compile('box h 0,0,0 6,4,4 stein hohl\nfenster h s y=2 z=2');
    expect(errors(out)[0].message).toContain('mit „x=“');
  });

  it('setzt Türen mit Ober- und Unterteil und Doppeltüren mit Angeln außen', () => {
    const out = compile('box h 0,0,0 6,4,4 stein hohl\ntür h s x=3\nbox g 10,0,0 16,4,4 stein hohl\ntür g s x=12 b=2');
    expect(errors(out)).toEqual([]);
    expect(at(out, 3, 1, 4)?.props).toMatchObject({ facing: 'north', half: 'lower', hinge: 'left', open: 'false' });
    expect(at(out, 3, 2, 4)?.props).toMatchObject({ facing: 'north', half: 'upper' });
    expect(at(out, 2, 1, 4)?.name).toBe('minecraft:spruce_planks'); // frame
    // Seen from outside (looking north), west is on the left.
    expect(at(out, 12, 1, 4)?.props.hinge).toBe('left');
    expect(at(out, 13, 1, 4)?.props.hinge).toBe('right');
  });
});

describe('Bau-Sprache: Dächer', () => {
  it('baut ein Satteldach mit Giebeln und Kanten', () => {
    const out = compile('rolle dach spruce_planks\nbox h 0,0,0 6,3,4 stein hohl\ndach sattel h');
    expect(errors(out)).toEqual([]);
    // Ridge along x (the longer side), width 7 with overhang: 3 rows per side and a slab ridge.
    expect(at(out, 0, 4, -1)?.props).toMatchObject({ facing: 'south', half: 'bottom', shape: 'straight' });
    expect(at(out, 0, 4, 5)?.props.facing).toBe('north');
    expect(at(out, 3, 7, 2)?.key).toBe('minecraft:spruce_slab[type=bottom,waterlogged=false]');
    expect(at(out, 0, 6, 2)?.name).toBe('minecraft:stone_bricks'); // gable
    expect(at(out, 0, 7, 2)).not.toBeNull();
    expect(at(out, 1, 6, 2)).toBeNull(); // attic stays empty
    expect(at(out, -1, 4, 0)?.props).toMatchObject({ facing: 'east', half: 'top' }); // verge
  });

  it('formt beim Walmdach die Ecken als Außenecken', () => {
    const out = compile('rolle dach spruce_planks\nbox h 0,0,0 4,2,4 stein hohl\ndach walm h ueberstand=0');
    const corners = [at(out, 0, 3, 0), at(out, 4, 3, 0), at(out, 0, 3, 4), at(out, 4, 3, 4)];
    for (const c of corners) expect(c?.props.shape).toMatch(/^outer_/);
    expect(at(out, 2, 3, 0)?.props.shape).toBe('straight');
    expect(at(out, 2, 5, 2)?.name).toBe('minecraft:spruce_planks'); // tip
  });

  it('setzt einen geschlossenen Kegel auf den Zylinder', () => {
    const out = compile('rolle dach deepslate_tiles\nzylinder t 0,0,0 r=3 h=5 stein hohl\ndach kegel t spitze=lightning_rod');
    expect(errors(out)).toEqual([]);
    // Seen from above, every cell inside the overhang is covered by the roof.
    for (let z = -4; z <= 4; z++)
      for (let x = -4; x <= 4; x++) {
        if (x * x + z * z > 4.5 * 4.5) continue;
        let covered = false;
        for (let y = 5; y < 20; y++) if (out.grid.has(x, y, z)) covered = true;
        expect(covered, `${x},${z}`).toBe(true);
      }
    expect(at(out, 0, 15, 0)?.name).toBe('minecraft:lightning_rod');
  });

  it('lehnt falsche Kombinationen verständlich ab', () => {
    const out = compile('rolle dach spruce_planks\nzylinder t 0,0,0 r=3 h=5 stein hohl\ndach sattel t');
    expect(errors(out)[0].message).toContain('dach kegel');
  });
});

describe('Bau-Sprache: verbundene Blöcke', () => {
  it('verbindet Zäune untereinander und mit vollen Blöcken', () => {
    const out = compileTess('tess 1\nrolle z oak_fence\nrolle s stone\nlinie 0,0,0 3,0,0 z\nblock 4,0,0 s\nblock 0,0,1 z');
    expect(at(out, 1, 0, 0)?.props).toMatchObject({ east: 'true', west: 'true', north: 'false', south: 'false' });
    expect(at(out, 3, 0, 0)?.props).toMatchObject({ east: 'true', west: 'true' });
    expect(at(out, 0, 0, 0)?.props).toMatchObject({ east: 'true', west: 'false', south: 'true' });
  });

  it('setzt bei Mauern Pfosten, niedrige und hohe Seiten', () => {
    const out = compileTess('tess 1\nrolle m cobblestone_wall\nrolle s stone\nlinie 0,0,0 4,0,0 m\nblock 2,1,0 s');
    expect(at(out, 1, 0, 0)?.props).toMatchObject({ east: 'low', west: 'low', up: 'false' });
    expect(at(out, 2, 0, 0)?.props).toMatchObject({ east: 'tall', west: 'tall', up: 'false' });
    expect(at(out, 0, 0, 0)?.props).toMatchObject({ east: 'low', west: 'none', up: 'true' });
  });

  it('formt Treppen-Innenecken wie im Spiel', () => {
    const out = compileTess(
      'tess 1\nblock 0,0,0 oak_stairs[facing=north]\nblock 1,0,0 oak_stairs[facing=north]\nblock 0,0,1 oak_stairs[facing=west]\nblock 0,0,2 oak_stairs[facing=west]',
    );
    // In front of the north-facing stair at 0,0,0 sits a west-facing one: an inner corner.
    expect(at(out, 0, 0, 0)?.props.shape).toBe('inner_left');
    expect(at(out, 1, 0, 0)?.props.shape).toBe('straight');
  });

  it('ergänzt fehlende Zustände', () => {
    const out = compileTess('tess 1\nblock 0,0,0 oak_door\nblock 2,0,0 lantern\nblock 4,0,0 oak_log');
    expect(at(out, 0, 0, 0)?.props).toEqual({ facing: 'north', half: 'lower', hinge: 'left', open: 'false', powered: 'false' });
    expect(at(out, 2, 0, 0)?.props).toEqual({ hanging: 'false', waterlogged: 'false' });
    expect(at(out, 4, 0, 0)?.props).toEqual({ axis: 'y' });
  });
});

describe('Testhaus mit Rundturm', () => {
  const source = readFileSync('beispiele/haus-mit-rundturm.tess', 'utf8');

  it('übersetzt ohne Fehler und Hinweise', () => {
    const out = compileTess(source);
    expect(out.diagnostics).toEqual([]);
    expect(out.name).toBe('Haus mit Rundturm');
  });

  it('öffnet als Projekt mit Größe aus dem Inhalt', () => {
    const r = importFile('haus-mit-rundturm.tess', new TextEncoder().encode(source));
    expect(r.format).toBe('tess');
    expect(r.analysis.nonAir).toBeGreaterThan(500);
    expect(r.info.offset).toEqual([-1, 0, -1]);
    expect(r.volume.sizeY).toBe(24);
  });

  // Optional: checks every block state against vanilla 1.21.1 (misode/mcmeta, branch 1.21.1-summary,
  // file blocks/data.min.json). TESSERA_MCMETA_BLOCKS=pfad/zu/data.min.json npm test
  const mcmeta = process.env.TESSERA_MCMETA_BLOCKS;
  it.runIf(!!mcmeta && existsSync(mcmeta))('erzeugt nur gültige, vollständige Vanilla-Blockzustände', () => {
    const data = JSON.parse(readFileSync(mcmeta!, 'utf8')) as Record<string, [Record<string, string[]>, Record<string, string>]>;
    const known = Object.keys(data).map((k) => `minecraft:${k}`);
    const out = compileTess(source, { hints: { known } });
    expect(out.diagnostics).toEqual([]);
    const extra = compileTess(
      HEAD +
        'rolle m cobblestone_wall\nrolle z oak_fence\nrolle laden oak_trapdoor\nrolle dach stone_bricks\nbox h 0,0,0 8,3,6 stein hohl\nfenster h n y=1 b=2 laeden=laden\ntür h s b=2\ndach walm h\nlinie 0,0,10 6,0,10 m\nlinie 0,0,12 6,0,12 z\nblock 3,1,12 lantern\nblock 7,0,12 oak_fence_gate[facing=east]',
      { hints: { known } },
    );
    expect(extra.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    for (const s of [...out.grid.usedStates(), ...extra.grid.usedStates()]) {
      const entry = data[s.name.replace('minecraft:', '')];
      expect(entry, s.name).toBeDefined();
      const [props] = entry;
      expect(Object.keys(s.props).sort(), s.key).toEqual(Object.keys(props).sort());
      for (const [k, v] of Object.entries(s.props)) expect(props[k], `${s.key}: ${k}`).toContain(v);
    }
  });
});
