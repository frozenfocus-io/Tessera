import { describe, expect, it } from 'vitest';
import { makeState } from '../src/core/blockstate';
import { parseTess } from '../src/core/formats/tess';
import { compileTess } from '../src/tess/compile';
import { turnState, Xf } from '../src/tess/xform';

/**
 * Bau-Sprache 2, Etappe 4c (Werkzeuge): modules, baue with turning and mirroring, wiederhole,
 * spiegle, abschnitt, ausrichtung and the Freistil (sections 9 and 10). Each instruction checks
 * the behaviour of docs/bau-sprache-2.md. Coordinates: x east, y up, z south.
 */

const HEAD = ['tess 2', 'rolle stein stone_bricks', 'rolle holz spruce_planks', 'rolle glas glass_pane', 'rolle rahmen oak_planks', 'rolle tuer spruce_door', 'rolle dach deepslate_tiles', 'rolle balken dark_oak_log', ''].join('\n');
/** File line of body line n. */
const line = (n: number) => n + 8;

type Out = ReturnType<typeof compileTess>;
const c2 = (body: string) => compileTess(HEAD + body);
const name = (out: Out, x: number, y: number, z: number) => out.grid.get(x, y, z)?.name.replace('minecraft:', '') ?? null;
const props = (out: Out, x: number, y: number, z: number) => out.grid.get(x, y, z)?.props ?? null;
const errors = (out: Out) => out.diagnostics.filter((d) => d.level === 'error');
const clean = (out: Out) => expect(out.diagnostics, out.diagnostics.map((d) => `${d.line}${d.ctx ? ` (${d.ctx})` : ''}: ${d.message}`).join('\n')).toEqual([]);
/** All blocks as sorted "x,y,z state" lines (for comparing two plans). */
const blocks = (out: Out) =>
  out.grid
    .entries()
    .map(([x, y, z, s]) => `${x},${y},${z} ${s.key}`)
    .sort();
/** Same blocks without hints about floating (small test pieces float on purpose). */
const quiet = (body: string) => c2(`erlaube schweben\n${body}`);

const FACINGS = ['north', 'east', 'south', 'west'] as const;

describe('Drehen und Spiegeln von Blockzuständen', () => {
  it('dreht jede Blickrichtung um 90, 180 und 270 Grad im Uhrzeigersinn', () => {
    for (const turn of [0, 90, 180, 270]) {
      for (const [i, f] of FACINGS.entries()) {
        const s = turnState(makeState('minecraft:oak_stairs', { facing: f, half: 'bottom' }), Xf.of(turn, null));
        expect(s.props.facing, `${f} um ${turn}`).toBe(FACINGS[(i + turn / 90) % 4]);
        expect(s.props.half).toBe('bottom');
      }
    }
    for (const f of ['up', 'down']) expect(turnState(makeState('minecraft:hopper', { facing: f }), Xf.of(90, null)).props.facing).toBe(f);
  });

  it('spiegelt Blickrichtungen: spiegel=x tauscht o und w, spiegel=z n und s', () => {
    const fx = (f: string, m: 'x' | 'z') => turnState(makeState('minecraft:oak_stairs', { facing: f }), Xf.of(0, m)).props.facing;
    expect(FACINGS.map((f) => fx(f, 'x'))).toEqual(['north', 'west', 'south', 'east']);
    expect(FACINGS.map((f) => fx(f, 'z'))).toEqual(['south', 'east', 'north', 'west']);
  });

  it('tauscht die Achsen x und z bei 90 und 270 Grad, y bleibt', () => {
    const ax = (a: string, t: number) => turnState(makeState('minecraft:oak_log', { axis: a }), Xf.of(t, null)).props.axis;
    expect([ax('x', 90), ax('z', 90), ax('y', 90), ax('x', 180), ax('z', 270)]).toEqual(['z', 'x', 'y', 'x', 'x']);
    expect(ax('x', 0)).toBe('x');
    expect(turnState(makeState('minecraft:oak_log', { axis: 'x' }), Xf.of(0, 'x')).props.axis).toBe('x');
  });

  it('tauscht Türangeln und Truhenhälften nur beim Spiegeln', () => {
    const door = makeState('minecraft:spruce_door', { facing: 'north', half: 'lower', hinge: 'left' });
    expect(turnState(door, Xf.of(90, null)).props).toMatchObject({ facing: 'east', hinge: 'left' });
    expect(turnState(door, Xf.of(0, 'x')).props).toMatchObject({ facing: 'north', hinge: 'right' });
    expect(turnState(door, Xf.of(0, 'z')).props).toMatchObject({ facing: 'south', hinge: 'right' });
    expect(turnState(makeState('minecraft:chest', { facing: 'north', type: 'left' }), Xf.of(0, 'x')).props.type).toBe('right');
  });

  it('dreht Ranken, Schilder, Schienen und Treppenecken', () => {
    const vine = turnState(makeState('minecraft:vine', { north: 'true', east: 'false', south: 'false', west: 'false', up: 'false' }), Xf.of(90, null));
    expect(vine.props).toMatchObject({ north: 'false', east: 'true', south: 'false', west: 'false', up: 'false' });
    // rotation 0 = sign facing south; turned by 90 it faces west (4).
    expect(turnState(makeState('minecraft:oak_sign', { rotation: '0' }), Xf.of(90, null)).props.rotation).toBe('4');
    expect(turnState(makeState('minecraft:oak_sign', { rotation: '2' }), Xf.of(0, 'x')).props.rotation).toBe('14');
    expect(turnState(makeState('minecraft:rail', { shape: 'north_south' }), Xf.of(90, null)).props.shape).toBe('east_west');
    expect(turnState(makeState('minecraft:rail', { shape: 'south_east' }), Xf.of(90, null)).props.shape).toBe('south_west');
    expect(turnState(makeState('minecraft:rail', { shape: 'ascending_north' }), Xf.of(180, null)).props.shape).toBe('ascending_south');
    expect(turnState(makeState('minecraft:oak_stairs', { facing: 'north', shape: 'inner_left' }), Xf.of(0, 'x')).props.shape).toBe('inner_right');
  });
});

describe('Module und baue', () => {
  it('baut ein Modul erst bei baue, Koordinaten relativ zum Punkt von baue', () => {
    const out = quiet('modul pfeiler h=3\n  box 0,0,0 0,{h-1},0 stein\nende\nbaue pfeiler 5,0,2\nbaue pfeiler 9,1,2 h=2');
    clean(out);
    expect([0, 1, 2].map((y) => name(out, 5, y, 2))).toEqual(['stone_bricks', 'stone_bricks', 'stone_bricks']);
    expect([1, 2, 3].map((y) => name(out, 9, y, 2))).toEqual(['stone_bricks', 'stone_bricks', null]);
    expect(name(out, 0, 0, 0)).toBeNull();
  });

  it('nimmt Wort-Angaben als Rolle, Block-Angabe und Seite', () => {
    const out = quiet('modul haus wand=stein seite=n\n  box h 0,0,0 4,3,4 wand hohl\n  fenster h seite y=1 glas=glas\n  block 2,4,2 wand:stufe\nende\nbaue haus 0,0,0 wand=holz seite=s');
    clean(out);
    expect(name(out, 0, 0, 0)).toBe('spruce_planks');
    expect(name(out, 2, 1, 4)).toBe('glass_pane');
    expect(name(out, 2, 1, 0)).toBe('spruce_planks');
    expect(name(out, 2, 4, 2)).toBe('spruce_slab');
  });

  it('nennt Formen im Modul von außen <instanz>.<form>, Standardname mit laufender Nummer', () => {
    const out = quiet('modul t\n  box k 0,0,0 2,2,2 stein\nende\nbaue t 0,0,0\nbaue t 10,0,0 name=ost\nblock {t1.k.x1},5,0 holz\nblock {ost.k.x0},5,0 holz');
    clean(out);
    expect(name(out, 2, 5, 0)).toBe('spruce_planks');
    expect(name(out, 10, 5, 0)).toBe('spruce_planks');
  });

  it('kennt Werte und Zeichen nur im eigenen Gültigkeitsbereich', () => {
    const out = quiet('wert a=2\nmodul m\n  wert b={a+1}\n  block {b},0,0 stein\nende\nbaue m 0,0,0\nblock {b},1,0 stein');
    expect(name(out, 3, 0, 0)).toBe('stone_bricks');
    expect(errors(out)).toEqual([expect.objectContaining({ line: line(8), message: expect.stringContaining('b') })]);
  });

  it('meldet unbekannte Module und Angaben', () => {
    expect(errors(c2('baue nichts 0,0,0'))[0].message).toContain('Ein Modul „nichts“ gibt es nicht');
    expect(errors(c2('modul m h=2\nende\nbaue m 0,0,0 b=3'))[0].message).toContain('„b=“ gibt es bei „baue“ nicht');
  });

  it('begrenzt die Aufruftiefe auf 16', () => {
    const out = c2('modul m n=0\n  block 0,0,0 stein\n  baue m 0,1,0 n={n+1}\nende\nbaue m 0,0,0');
    expect(out.grid.get(0, 15, 0)).not.toBeNull();
    expect(out.grid.get(0, 16, 0)).toBeNull();
    const e = errors(out);
    expect(e).toHaveLength(1);
    expect(e[0].message).toContain('höchstens 16 Ebenen');
  });

  it('nennt in Meldungen die Modulkette, auch in der Herkunft der Blöcke', () => {
    const out = c2('modul m\n  block 0,0 stein\nende\nbaue m 3,0,0');
    expect(errors(out)[0]).toMatchObject({ line: line(2), ctx: `in modul m, gebaut in Zeile ${line(4)}` });
    const inner = quiet('modul a\n  block 0,0,0 stein\nende\nmodul b\n  baue a 1,0,0\nende\nbaue b 5,0,0');
    const r = parseTess(new TextEncoder().encode(HEAD + 'erlaube schweben\nmodul a\n  block 0,0,0 stein\nende\nmodul b\n  baue a 1,0,0\nende\nbaue b 5,0,0'));
    const o = r.origins.table[r.origins.ids[0]];
    expect(o).toMatchObject({ line: line(3), chain: [line(8), line(6)], ctx: `in modul a, gebaut in Zeile ${line(6)}; in modul b, gebaut in Zeile ${line(8)}` });
    expect(name(inner, 6, 0, 0)).toBe('stone_bricks');
  });

  it('dreht mit drehung= im Uhrzeigersinn: (x,z) wird (−z,x), Blickrichtungen und Seiten drehen mit', () => {
    const mod = 'modul m\n  block 2,0,0 stein\n  block 0,0,1 oak_stairs[facing=n]\n  block 0,1,0 oak_log[axis=x]\nende\n';
    for (const [turn, pos, facing, axis] of [
      [0, [12, 0, 10], 'north', 'x'],
      [90, [10, 0, 12], 'east', 'z'],
      [180, [8, 0, 10], 'south', 'x'],
      [270, [10, 0, 8], 'west', 'z'],
    ] as const) {
      const out = quiet(`${mod}baue m 10,0,10 drehung=${turn}`);
      clean(out);
      expect(name(out, ...pos), `drehung=${turn}`).toBe('stone_bricks');
      const stairs = turn === 0 ? [10, 0, 11] : turn === 90 ? [9, 0, 10] : turn === 180 ? [10, 0, 9] : [11, 0, 10];
      expect(props(out, stairs[0], stairs[1], stairs[2])?.facing, `drehung=${turn}`).toBe(facing);
      expect(props(out, 10, 1, 10)?.axis).toBe(axis);
    }
  });

  it('spiegelt mit spiegel=x und spiegel=z, Türangeln wechseln', () => {
    const mod = 'modul m\n  block 2,0,0 stein\n  block 0,0,1 oak_stairs[facing=o]\n  block 0,1,1 spruce_door[facing=s,hinge=left]\nende\n';
    const ox = quiet(`${mod}baue m 10,0,10 spiegel=x`);
    expect(name(ox, 8, 0, 10)).toBe('stone_bricks');
    expect(props(ox, 10, 0, 11)?.facing).toBe('west');
    expect(props(ox, 10, 1, 11)).toMatchObject({ facing: 'south', hinge: 'right' });
    const oz = quiet(`${mod}baue m 10,0,10 spiegel=z`);
    expect(name(oz, 12, 0, 10)).toBe('stone_bricks');
    expect(props(oz, 10, 0, 9)?.facing).toBe('east');
    expect(props(oz, 10, 1, 9)).toMatchObject({ facing: 'north', hinge: 'right' });
  });

  it('dreht Formen, Bauteile und Dächer wie von Hand gedreht geschrieben', () => {
    const mod = 'modul haus\n  box h 0,0,0 6,4,8 stein hohl\n  fenster h n y=2 glas=glas\n  tuer h s tuer=tuer\n  dach sattel h rolle=dach\nende\n';
    const turned = c2(`${mod}baue haus 20,0,0 drehung=90`);
    const byHand = c2('box h 12,0,0 20,4,6 stein hohl\nfenster h o y=2 glas=glas\ntuer h w tuer=tuer\ndach sattel h rolle=dach');
    clean(turned);
    expect(blocks(turned)).toEqual(blocks(byHand));
    const mirrored = c2(`${mod.replace('  tuer h s tuer=tuer\n', '')}baue haus 20,0,0 spiegel=x`);
    const mirroredByHand = c2('box h 14,0,0 20,4,8 stein hohl\nfenster h n y=2 glas=glas\ndach sattel h rolle=dach');
    expect(blocks(mirrored)).toEqual(blocks(mirroredByHand));
  });

  it('verschneidet Dächer verschiedener Instanzen absolut', () => {
    const mod = 'modul haus\n  box h 0,0,0 6,4,8 stein hohl\n  dach walm h rolle=dach\nende\n';
    const out = c2(`${mod}baue haus 0,0,0\nbaue haus 6,0,8 drehung=90`);
    const byHand = c2('box a 0,0,0 6,4,8 stein hohl\ndach walm a rolle=dach\nbox b -2,0,8 6,4,14 stein hohl\ndach walm b rolle=dach');
    clean(out);
    expect(blocks(out)).toEqual(blocks(byHand));
  });

  it('rechnet x=, versatz= und winkel= im gedrehten Modul lokal', () => {
    const mod = 'modul m\n  box h 0,0,0 8,4,6 stein hohl\n  fenster h s x=1 y=2 glas=glas\n  fenster h n versatz=2 y=2 glas=glas\nende\n';
    const out = c2(`${mod}baue m 0,0,0 drehung=180`);
    // Turned by 180: the box is −8…0 × −6…0, local south is north; x=1 (cells 1) is now x=−1.
    expect(name(out, -1, 2, -6)).toBe('glass_pane');
    // versatz=2 to the right seen from outside stays to the right: local north is now south.
    expect(name(out, -2, 2, 0)).toBe('glass_pane');
  });
});

describe('wiederhole, spiegle, abschnitt, ausrichtung', () => {
  it('wiederholt von a bis b einschließlich, auch mit negativem Schritt', () => {
    const out = quiet('wiederhole i=0..4 schritt=2\n  block {i},0,0 stein\nende\nwiederhole k=3..1 schritt=-1\n  block {k},0,2 holz\nende');
    clean(out);
    expect([0, 1, 2, 3, 4].map((x) => name(out, x, 0, 0))).toEqual(['stone_bricks', null, 'stone_bricks', null, 'stone_bricks']);
    expect([0, 1, 2, 3].map((x) => name(out, x, 0, 2))).toEqual([null, 'spruce_planks', 'spruce_planks', 'spruce_planks']);
  });

  it('erlaubt höchstens 10 000 Durchläufe und schützt die Schleifenvariable', () => {
    expect(errors(c2('wiederhole i=0..10000\nende'))[0].message).toContain('höchstens 10 000');
    expect(errors(c2('wiederhole i=1..2\n  wert i=5\nende'))[0].message).toContain('Variable der Schleife');
    expect(errors(c2('wiederhole i=0..9999\nende'))).toEqual([]);
  });

  it('meldet fehlendes und überzähliges ende', () => {
    expect(errors(c2('wiederhole i=1..2\n  block {i},0,0 stein'))[0]).toMatchObject({ line: line(1), message: expect.stringContaining('nicht mit „ende“ geschlossen') });
    expect(errors(c2('block 0,0,0 stein\nende'))[0]).toMatchObject({ line: line(2), message: expect.stringContaining('ohne passenden Anfang') });
  });

  it('spiegelt an einer Zelle oder einer halben Zahl, Namen bekommen _s', () => {
    const a = quiet('spiegle x=10\n  box t 12,0,0 13,0,0 stein\n  block 14,1,0 oak_stairs[facing=o]\nende\nblock {t_s.x0},3,0 holz');
    clean(a);
    expect([6, 7, 8, 12, 13].map((x) => name(a, x, 0, 0))).toEqual([null, 'stone_bricks', 'stone_bricks', 'stone_bricks', 'stone_bricks']);
    expect(props(a, 6, 1, 0)?.facing).toBe('west');
    expect(name(a, 7, 3, 0)).toBe('spruce_planks');
    const b = quiet('spiegle z=0.5\n  block 0,0,3 stein\nende');
    expect([name(b, 0, 0, 3), name(b, 0, 0, -2)]).toEqual(['stone_bricks', 'stone_bricks']);
  });

  it('ordnet Blöcke ihrem Bauabschnitt zu, baue … abschnitt= gilt für die Instanz', () => {
    const src = HEAD + 'erlaube schweben\nmodul m\n  block 0,0,0 stein\nende\nabschnitt "Nord"\nblock 0,0,0 stein\nbaue m 2,0,0 abschnitt="Turm"\nblock 4,0,0 stein\nabschnitt "Süd"\nblock 6,0,0 stein';
    const r = parseTess(new TextEncoder().encode(src));
    expect(r.diagnostics).toEqual([]);
    const sec = (x: number) => r.origins.sections[r.origins.table[r.origins.ids[x]].section];
    expect(r.origins.sections).toEqual(['', 'Nord', 'Turm', 'Süd']);
    expect([0, 2, 4, 6].map(sec)).toEqual(['Nord', 'Turm', 'Nord', 'Süd']);
  });

  it('dreht mit ausrichtung das ganze Ergebnis um 0,0,0, auch die Blockzustände', () => {
    const body = 'block 2,0,0 stein\nblock 0,0,1 oak_stairs[facing=n]\nblock 1,0,1 oak_fence\nblock 1,0,2 oak_fence';
    const out = quiet(`${body}\nausrichtung drehung=90`);
    clean(out);
    expect(name(out, 0, 0, 2)).toBe('stone_bricks');
    expect(props(out, -1, 0, 0)?.facing).toBe('east');
    // Connections are computed after turning: the two fence posts now join along x.
    expect(props(out, -1, 0, 1)).toMatchObject({ west: 'true', north: 'false' });
    expect(errors(c2('ausrichtung drehung=90\nausrichtung spiegel=x'))[0].message).toContain('nur einmal');
    expect(errors(c2('modul m\n  ausrichtung drehung=90\nende\nbaue m 0,0,0'))[0].message).toContain('ganze Datei');
  });

  it('zählt Anweisungen in Schleifen und Modulen für die Grenze von 2 Millionen', () => {
    const src = 'wiederhole i=1..1000\n  wiederhole k=1..1000\n    wert x=1\n  ende\nende';
    expect(errors(c2(src))).toEqual([]);
    const e = errors(c2(src.replace('1..1000\n  wiederhole', '1..2001\n  wiederhole')));
    expect(e[0].message).toContain('mehr als 2 Millionen Anweisungen');
  }, 30_000);
});

describe('Freistil', () => {
  it('legt Zeichen fest: Leerzeichen lässt stehen, . macht Luft, Zustände haben Vorrang', () => {
    const out = quiet('block 1,0,0 stein\nblock 2,0,0 stein\nzeichen S holz\nzeichen T oak_stairs facing=o half=top\nebene 0,0,0\n|S .T');
    clean(out);
    expect([0, 1, 2, 3].map((x) => name(out, x, 0, 0))).toEqual(['spruce_planks', 'stone_bricks', null, 'oak_stairs']);
    expect(props(out, 3, 0, 0)).toMatchObject({ facing: 'east', half: 'top' });
    expect(errors(c2('zeichen | stein'))[0].message).toContain('ASCII-Zeilen');
    expect(errors(c2('ebene 0,0,0\n|Q'))[0].message).toContain('„Q“ ist nicht festgelegt');
  });

  it('nimmt auch # als Zeichen und lässt fest=ja-Blöcke unverbunden', () => {
    const out = quiet('zeichen # oak_fence fest=ja\nzeichen Z oak_fence\nebene 0,0,0\n|##\nebene 0,0,2\n|ZZ');
    clean(out);
    expect(props(out, 0, 0, 0)?.east).toBe('false');
    expect(props(out, 0, 0, 2)?.east).toBe('true');
  });

  it('zeichnet ebene nach Süden und Osten, relative Richtungen sind dort ein Fehler', () => {
    const out = quiet('zeichen A stein\nzeichen B holz\nebene 5,2,5\n|AB\n|B');
    expect([name(out, 5, 2, 5), name(out, 6, 2, 5), name(out, 5, 2, 6)]).toEqual(['stone_bricks', 'spruce_planks', 'spruce_planks']);
    expect(errors(c2('zeichen T oak_stairs facing=aussen\nebene 0,0,0\n|T'))[0].message).toContain('nur in „ansicht“');
  });

  it('legt bei ebenen jede Gruppe eine Lage höher', () => {
    const out = quiet('zeichen A stein\nebenen 0,1,0\n|A\n|-\n| A\n|-\n|  A');
    expect([name(out, 0, 1, 0), name(out, 1, 2, 0), name(out, 2, 3, 0)]).toEqual(['stone_bricks', 'stone_bricks', 'stone_bricks']);
  });

  it('zeichnet eine Ansicht von außen: unterste Zeile unten, erstes Zeichen links, tiefe= nach außen', () => {
    const out = c2('box haus 0,0,0 8,6,6 stein hohl\nzeichen B rahmen\nzeichen < rahmen:treppe facing=links half=top\nzeichen > rahmen:treppe facing=rechts half=top\nzeichen G glas\nzeichen F rahmen tiefe=1\nansicht haus s x=2 y=1\n|B<G>B\n|BGGGB\n|BFFFB');
    clean(out);
    // South wall, seen from outside: left is west.
    expect([2, 3, 4, 5, 6].map((x) => name(out, x, 3, 6))).toEqual(['oak_planks', 'oak_stairs', 'glass_pane', 'oak_stairs', 'oak_planks']);
    expect(props(out, 3, 3, 6)).toMatchObject({ facing: 'west', half: 'top' });
    expect(props(out, 5, 3, 6)).toMatchObject({ facing: 'east', half: 'top' });
    expect([3, 4, 5].map((x) => name(out, x, 1, 7))).toEqual(['oak_planks', 'oak_planks', 'oak_planks']);
    // East wall: left seen from outside is south (larger z).
    const east = c2('box haus 0,0,0 8,6,6 stein hohl\nzeichen < rahmen:treppe facing=links\nzeichen R rahmen\nansicht haus o z=1 y=1\n|<R');
    expect(props(east, 8, 1, 2)?.facing).toBe('south');
    expect(name(east, 8, 1, 1)).toBe('oak_planks');
  });

  it('bildet an runden Formen jede Zeichenposition auf die Wandzelle ihrer Lage ab', () => {
    const out = c2('zylinder t 0,0,0 r=4 h=6 stein hohl\nzeichen G glas\nzeichen A rahmen:treppe facing=aussen\nansicht t no y=2\n|GGG\n|A');
    clean(out);
    const glass = out.grid.entries().filter(([, y, , s]) => y === 3 && s.name === 'minecraft:glass_pane');
    expect(glass).toHaveLength(3);
    for (const [x, , z] of glass) expect(x > 0 && z < 0).toBe(true);
  });

  it('dreht Zeichnungen im Modul mit', () => {
    const out = quiet('zeichen A stein\nzeichen T oak_stairs facing=n\nmodul m\n  ebene 0,0,0\n  |AT\nende\nbaue m 10,0,0 drehung=90');
    clean(out);
    expect(name(out, 10, 0, 0)).toBe('stone_bricks');
    expect(props(out, 10, 0, 1)?.facing).toBe('east');
  });
});
