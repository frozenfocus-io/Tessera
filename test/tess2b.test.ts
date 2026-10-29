import { describe, expect, it } from 'vitest';
import { compileTess } from '../src/tess/compile';
import { waterRows } from '../src/tess/decor';
import { ringCells } from '../src/tess/geometry';
import { archEdge } from '../src/tess/stairs';
import { cellAngle } from '../src/tess/wall';

/**
 * Bau-Sprache 2, Etappe 4b (Anbauten und Zier): every instruction and option checks the
 * behaviour described in docs/bau-sprache-2.md (sections 6, 7, 8 and 11), not only that a file
 * compiles. Coordinates: x east, y up, z south.
 */

const HEAD = [
  'tess 2',
  'rolle stein stone_bricks',
  'rolle holz spruce_planks',
  'rolle glas glass_pane',
  'rolle rahmen oak_planks',
  'rolle tuer spruce_door',
  'rolle dach deepslate_tiles',
  'rolle balken dark_oak_log',
  'rolle putz white_terracotta',
  'rolle laden spruce_trapdoor',
  'rolle erde rooted_dirt',
  'rolle laub oak_leaves',
  '',
].join('\n');
/** File line of body line n. */
const line = (n: number) => n + 12;

type Out = ReturnType<typeof compileTess>;
const c2 = (body: string) => compileTess(HEAD + body);
const at = (out: Out, x: number, y: number, z: number) => out.grid.get(x, y, z);
const name = (out: Out, x: number, y: number, z: number) => out.grid.get(x, y, z)?.name.replace('minecraft:', '') ?? null;
const props = (out: Out, x: number, y: number, z: number) => out.grid.get(x, y, z)?.props ?? null;
const errors = (out: Out) => out.diagnostics.filter((d) => d.level === 'error');
const warnings = (out: Out) => out.diagnostics.filter((d) => d.level === 'warn');
const clean = (out: Out) => expect(out.diagnostics, out.diagnostics.map((d) => `${d.line}: ${d.message}`).join('\n')).toEqual([]);
const cells = (out: Out, pred: (x: number, y: number, z: number, n: string) => boolean) =>
  out.grid
    .entries()
    .filter(([x, y, z, s]) => pred(x, y, z, s.name.replace('minecraft:', '')))
    .map(([x, y, z]) => `${x},${y},${z}`)
    .sort();
/** Blocks as "x,y,z key" lines, for comparing two results. */
const dump = (out: Out) =>
  out.grid
    .entries()
    .map(([x, y, z, s]) => `${x},${y},${z} ${s.key}`)
    .sort();

// ---------------------------------------------------------------------------

describe('6.1 Bauteile finden ihre Stelle', () => {
  it('versatz schiebt nach rechts (von außen gesehen), ebene zählt ab der untersten Lage', () => {
    const out = c2('box h 0,2,0 10,8,6 stein hohl\nfenster h n ebene=2 versatz=2 bank=nein sturz=nein\nfenster h s ebene=2 versatz=2 bank=nein sturz=nein');
    clean(out);
    // North side, seen from outside: right is west. South side: right is east.
    expect(name(out, 3, 4, 0)).toBe('glass_pane');
    expect(name(out, 7, 4, 6)).toBe('glass_pane');
    expect(name(out, 5, 4, 0)).toBe('stone_bricks');
    expect(errors(c2('box h 0,0,0 10,8,6 stein hohl\nfenster h n y=2 ebene=2'))[0].message).toContain('schließen sich aus');
    expect(errors(c2('box h 0,0,0 10,8,6 stein hohl\nfenster h n'))[0].message).toContain('ebene=');
    expect(errors(c2('box h 0,0,0 10,8,6 stein hohl\nfenster h n y=2 x=3 versatz=1'))[0].message).toContain('versatz');
  });

  it('Schrägen und winkel= an runden Formen: der Strahl trifft die äußerste Wandzelle, außen ist gerundet', () => {
    const out = c2('zylinder t 0,0,0 r=4 h=8 stein hohl\nfenster t no y=3 sturz=nein');
    clean(out);
    // The ray at 45° leaves the disc after (3,-3); north and east are open, north wins the tie.
    expect(name(out, 3, 3, -3)).toBe('glass_pane');
    expect(props(out, 3, 2, -4)).toMatchObject({ facing: 'south', half: 'top' }); // sill outside, facing in
    const side = c2('zylinder t 0,0,0 r=4 h=8 stein hohl\nfenster t o y=3');
    const angle = c2('zylinder t 0,0,0 r=4 h=8 stein hohl\nfenster t winkel=90 y=3');
    expect(dump(angle)).toEqual(dump(side));
    expect(errors(c2('box h 0,0,0 8,6,8 stein hohl\nfenster h no y=2'))[0].message).toContain('box');
    expect(errors(c2('box h 0,0,0 8,6,8 stein hohl\nfenster h winkel=30 y=2'))[0].message).toContain('box');
  });

  it('seite=k beim vieleck: Seite 0 zeigt am ehesten nach Norden, gezählt im Uhrzeigersinn', () => {
    const base = 'vieleck v 0,0,0 n=8 r=5 h=8 stein hohl\n';
    expect(dump(c2(base + 'fenster v seite=0 y=3'))).toEqual(dump(c2(base + 'fenster v n y=3')));
    expect(dump(c2(base + 'fenster v seite=2 y=3'))).toEqual(dump(c2(base + 'fenster v o y=3')));
    expect(dump(c2(base + 'fenster v seite=1 y=3'))).toEqual(dump(c2(base + 'fenster v no y=3')));
    const six = c2('vieleck v 0,0,0 n=6 r=5 h=6 stein hohl\nfenster v seite=3 y=2 bank=nein sturz=nein');
    clean(six);
    expect(name(six, 0, 2, 4)).toBe('glass_pane'); // side 3 of a hexagon faces south
    expect(errors(c2('zylinder z 0,0,0 r=4 h=6 stein hohl\nfenster z seite=1 y=2'))[0].message).toContain('vieleck');
  });

  it('anzahl ohne Seite verteilt rundum gleichmäßig, ab winkel=', () => {
    const out = c2('zylinder t 0,0,0 r=4 h=8 stein hohl\nfenster t y=3 anzahl=4 bank=nein sturz=nein');
    clean(out);
    for (const [x, z] of [[0, -4], [4, 0], [0, 4], [-4, 0]]) expect(name(out, x, 3, z)).toBe('glass_pane');
    const turned = c2('zylinder t 0,0,0 r=4 h=8 stein hohl\nfenster t y=3 anzahl=4 winkel=45 bank=nein sturz=nein');
    expect(name(turned, 0, 3, -4)).toBe('stone_bricks');
    expect(name(turned, 3, 3, -3)).toBe('glass_pane');
    expect(errors(c2('box h 0,0,0 8,6,8 stein hohl\nfenster h y=2 anzahl=4'))[0].message).toContain('Seite fehlt');
  });

  it('anzahl und abstand gelten auch für andere Bauteile', () => {
    const out = c2('box h 0,0,0 12,6,6 stein hohl\nwandlaterne h s y=3 anzahl=2 abstand=4 art=fackel');
    clean(out);
    expect(cells(out, (_x, _y, _z, n) => n === 'wall_torch')).toEqual(['4,3,7', '8,3,7']);
  });
});

describe('6.2 Fenster', () => {
  const house = 'box h 0,0,0 20,9,8 putz hohl\n';

  it('art=bogen: die äußeren Zellen der obersten Reihe werden umgedrehte Treppen, von der Mitte weg', () => {
    const out = c2(house + 'fenster h s y=2 x=3 b=3 h=3 art=bogen');
    clean(out);
    expect(name(out, 4, 4, 8)).toBe('glass_pane');
    expect(props(out, 3, 4, 8)).toMatchObject({ facing: 'west', half: 'top' });
    expect(props(out, 5, 4, 8)).toMatchObject({ facing: 'east', half: 'top' });
    expect(name(out, 3, 4, 8)).toBe('oak_stairs');
    expect(name(out, 3, 3, 8)).toBe('glass_pane');
    expect(errors(c2(house + 'fenster h s y=2 art=bogen'))[0].message).toContain('b=2');
  });

  it('art=spitzbogen: oben schmaler, Treppen neben dem Glas, außen bleibt die Wand', () => {
    const out = c2(house + 'fenster h s y=2 x=3 b=5 h=4 art=spitzbogen');
    clean(out);
    // Top row (y=5): one glass in the middle, stairs beside it, wall outside.
    expect(name(out, 5, 5, 8)).toBe('glass_pane');
    expect(props(out, 4, 5, 8)).toMatchObject({ facing: 'west', half: 'top' });
    expect(props(out, 6, 5, 8)).toMatchObject({ facing: 'east', half: 'top' });
    expect(name(out, 3, 5, 8)).toBe('white_terracotta');
    // Row below: three glass, stairs at the edges.
    expect([4, 5, 6].map((x) => name(out, x, 4, 8))).toEqual(['glass_pane', 'glass_pane', 'glass_pane']);
    expect(props(out, 3, 4, 8)).toMatchObject({ facing: 'west', half: 'top' });
    expect(name(out, 3, 3, 8)).toBe('glass_pane');
    expect(errors(c2(house + 'fenster h s y=2 b=4 art=spitzbogen'))[0].message).toContain('ungerade');
  });

  it('art=rund: Glas im Kreis, Ecken als Treppen (oben umgedreht), h ist b', () => {
    const out = c2(house + 'fenster h s y=2 x=3 b=3 art=rund');
    clean(out);
    for (const [x, y] of [[4, 2], [3, 3], [4, 3], [5, 3], [4, 4]]) expect(name(out, x, y, 8)).toBe('glass_pane');
    expect(props(out, 3, 4, 8)).toMatchObject({ facing: 'west', half: 'top' });
    expect(props(out, 5, 4, 8)).toMatchObject({ facing: 'east', half: 'top' });
    expect(props(out, 3, 2, 8)).toMatchObject({ facing: 'west', half: 'bottom' });
    const five = c2(house + 'fenster h s y=2 x=3 b=5 art=rund');
    expect(name(five, 3, 3, 8)).toBe('glass_pane'); // dx=-2, dy=-1: 5 ≤ 5
    expect(name(five, 3, 2, 8)).toBe('oak_stairs');
    expect(errors(c2(house + 'fenster h s y=2 b=3 h=4 art=rund'))[0].message).toContain('h=3');
    expect(errors(c2(house + 'fenster h s y=2 b=4 art=rund'))[0].message).toContain('b=3 oder b=5');
  });

  it('art=kreuz: Mittelspalte und Mittelreihe aus sprossen (Standard rahmen)', () => {
    const out = c2(house + 'fenster h s y=2 x=3 b=3 h=3 art=kreuz');
    clean(out);
    for (const [x, y] of [[4, 2], [3, 3], [4, 3], [5, 3], [4, 4]]) expect(name(out, x, y, 8)).toBe('oak_planks');
    expect(name(out, 3, 2, 8)).toBe('glass_pane');
    const bars = c2(house + 'fenster h s y=2 x=3 b=3 h=3 art=kreuz sprossen=balken');
    expect(name(bars, 4, 3, 8)).toBe('dark_oak_log');
    expect(errors(c2(house + 'fenster h s y=2 b=3 h=2 art=kreuz'))[0].message).toContain('ungerade');
  });

  it('art=schlitz: Luft statt Glas, ohne Bank, ohne Läden', () => {
    const out = c2(house + 'fenster h s y=2 x=3 h=3 art=schlitz sturz=nein');
    clean(out);
    expect(at(out, 3, 3, 8)).toBeNull();
    expect(at(out, 3, 1, 9)).toBeNull(); // no sill
    expect(errors(c2(house + 'fenster h s y=2 art=schlitz laeden=laden'))[0].message).toContain('Läden');
    expect(errors(c2(house + 'fenster h s y=2 art=schlitz b=2'))[0].message).toContain('b=1');
  });

  it('laibung: Ring um die Öffnung in der Wandebene', () => {
    const out = c2(house + 'fenster h s y=2 x=3 b=2 h=2 laibung=stein sturz=nein bank=nein');
    clean(out);
    for (const [x, y] of [[2, 1], [5, 1], [2, 4], [5, 4], [2, 3], [5, 2], [3, 1], [4, 4]]) expect(name(out, x, y, 8)).toBe('stone_bricks');
    expect(name(out, 3, 2, 8)).toBe('glass_pane');
  });

  it('tiefe: das Glas sitzt nach innen versetzt, davor Luft; nur bei dickerer Wand', () => {
    const out = c2('box h 0,0,0 12,8,8 putz hohl wand=2\nfenster h s y=2 tiefe=1');
    clean(out);
    expect(at(out, 6, 2, 8)).toBeNull();
    expect(name(out, 6, 2, 7)).toBe('glass_pane');
    const flat = c2('box h 0,0,0 12,8,8 putz hohl wand=2\nfenster h s y=2');
    expect(name(flat, 6, 2, 8)).toBe('glass_pane');
    expect(at(flat, 6, 2, 7)).toBeNull(); // the opening goes through the wall
    expect(errors(c2(house + 'fenster h s y=2 tiefe=1'))[0].message).toContain('wand=2');
  });

  it('sprossen: bei rechteck ab b=3 jede zweite Spalte', () => {
    const out = c2(house + 'fenster h s y=2 x=3 b=5 sprossen=balken');
    clean(out);
    expect([3, 4, 5, 6, 7].map((x) => name(out, x, 2, 8))).toEqual(['glass_pane', 'dark_oak_log', 'glass_pane', 'dark_oak_log', 'glass_pane']);
    expect(errors(c2(house + 'fenster h s y=2 b=2 sprossen=balken'))[0].message).toContain('b=3');
  });

  it('kasten: Erde unter dem Fenster, Falltüren davor und an den Enden, Blumen reihum, keine Bank', () => {
    const out = c2(house + 'fenster h s y=2 x=4 b=3 kasten=erde blumen=poppy,cornflower');
    clean(out);
    for (const x of [4, 5, 6]) expect(name(out, x, 1, 9)).toBe('rooted_dirt');
    expect([4, 5, 6].map((x) => name(out, x, 2, 9))).toEqual(['poppy', 'cornflower', 'poppy']);
    expect(at(out, 5, 1, 10)?.props).toMatchObject({ facing: 'south', open: 'true' });
    expect(name(out, 5, 1, 10)).toBe('oak_trapdoor'); // kastenfront: rahmen:falltuer
    expect(at(out, 3, 1, 9)?.props).toMatchObject({ facing: 'west', open: 'true' });
    expect(at(out, 7, 1, 9)?.props).toMatchObject({ facing: 'east', open: 'true' });
    const front = c2(house + 'fenster h s y=2 x=4 b=1 kasten=erde kastenfront=laden');
    expect(name(front, 4, 1, 10)).toBe('spruce_trapdoor');
    expect(errors(c2(house + 'fenster h s y=2 kasten=erde bank=rahmen'))[0].message).toContain('ersetzt die Bank');
  });
});

describe('6.3 Türen und Tore', () => {
  const house = 'box h 0,0,0 12,7,8 stein hohl boden=holz\n';

  it('tür h=3: Oberlicht über der Tür, der Rahmen wächst mit', () => {
    const out = c2(house + 'tür h s x=5 h=3');
    clean(out);
    expect(props(out, 5, 1, 8)).toMatchObject({ half: 'lower', facing: 'north' });
    expect(name(out, 5, 3, 8)).toBe('glass_pane');
    for (const y of [1, 2, 3]) expect(name(out, 4, y, 8)).toBe('oak_planks');
    for (const x of [4, 5, 6]) expect(name(out, x, 4, 8)).toBe('oak_planks');
    const glass = c2(house + 'tür h s x=5 h=4 oberlicht=putz');
    expect(name(glass, 5, 3, 8)).toBe('white_terracotta');
    expect(name(glass, 5, 4, 8)).toBe('white_terracotta');
  });

  it('tür art=bogen: Bogen aus Treppen über einer Doppeltür; tuer=luft ist ein offener Durchgang', () => {
    const out = c2(house + 'tür h s x=5 b=2 h=3 art=bogen');
    clean(out);
    expect(props(out, 5, 3, 8)).toMatchObject({ facing: 'west', half: 'top' });
    expect(props(out, 6, 3, 8)).toMatchObject({ facing: 'east', half: 'top' });
    expect(errors(c2(house + 'tür h s h=3 art=bogen'))[0].message).toContain('b=2');
    const open = c2(house + 'tür h s x=5 tuer=luft');
    clean(open);
    expect(at(open, 5, 1, 8)).toBeNull();
    expect(at(open, 5, 2, 8)).toBeNull();
    expect(name(open, 5, 3, 8)).toBe('oak_planks');
  });

  it('tür art=spitzbogen ist bei der Doppeltür der Bogen über den Flügeln; rahmen=nein lässt den Rahmen weg', () => {
    const house = 'box h 0,0,0 12,7,8 stein hohl boden=holz\n';
    expect(dump(c2(house + 'tür h s x=5 b=2 h=3 art=spitzbogen'))).toEqual(dump(c2(house + 'tür h s x=5 b=2 h=3 art=bogen')));
    expect(errors(c2(house + 'tür h s h=3 art=spitzbogen'))[0].message).toContain('b=2');
    const bare = c2(house + 'tür h s x=5 rahmen=nein');
    clean(bare);
    expect(name(bare, 4, 1, 8)).toBe('stone_bricks');
    expect(name(bare, 5, 3, 8)).toBe('stone_bricks');
    expect(props(bare, 5, 1, 8)).toMatchObject({ half: 'lower' });
  });

  it('stufen: Treppen abwärts zur Tür, darunter volle Blöcke aus rahmen', () => {
    const out = c2('box h 0,2,0 12,8,8 stein hohl boden=holz\nbox 0,0,0 12,1,8 stein\ntür h s x=5 stufen=3');
    clean(out);
    // Door at y=3; steps at y=2, 1, 0 going outwards.
    expect(props(out, 5, 2, 9)).toMatchObject({ facing: 'north', half: 'bottom' });
    expect(props(out, 5, 1, 10)).toMatchObject({ facing: 'north', half: 'bottom' });
    expect(props(out, 5, 0, 11)).toMatchObject({ facing: 'north', half: 'bottom' });
    expect(name(out, 5, 1, 9)).toBe('oak_planks');
    expect(name(out, 5, 0, 9)).toBe('oak_planks');
    expect(name(out, 5, 0, 10)).toBe('oak_planks');
    expect(at(out, 5, -1, 11)).toBeNull();
  });

  it('vordach: eine Reihe Treppen über dem Rahmen, b+2 breit, steigt zur Wand', () => {
    const out = c2(house + 'tür h s x=5 vordach=holz');
    clean(out);
    // Door y=1..2, lintel y=3, canopy y=4 outside.
    expect(cells(out, (_x, y, z, n) => y === 4 && z === 9 && n === 'spruce_stairs')).toEqual(['4,4,9', '5,4,9', '6,4,9']);
    expect(props(out, 5, 4, 9)).toMatchObject({ facing: 'north', half: 'bottom' });
  });

  it('tor: Öffnung aus Luft durch die ganze Mauer, Bogen treppenförmig ab b=4, Fallgitter oben', () => {
    const out = c2('box m 0,0,0 12,7,2 stein\ntor m s b=4 h=4 art=bogen rahmen=stein fallgitter=holz');
    clean(out);
    // Columns x=4..7, rows y=0..3; the gate goes through z=0..2.
    for (const z of [0, 1, 2]) {
      expect(at(out, 5, 1, z)).toBeNull();
      expect(name(out, 4, 3, z)).toBe('stone_bricks'); // top corner stays wall
      expect(props(out, 5, 3, z)).toMatchObject({ facing: 'west', half: 'top' });
      expect(props(out, 6, 3, z)).toMatchObject({ facing: 'east', half: 'top' });
      expect(props(out, 4, 2, z)).toMatchObject({ facing: 'west', half: 'top' });
      expect(props(out, 7, 2, z)).toMatchObject({ facing: 'east', half: 'top' });
    }
    // Portcullis in the highest open row, on the outside.
    expect(name(out, 5, 2, 2)).toBe('spruce_fence');
    expect(at(out, 5, 2, 1)).toBeNull();
    const pointed = c2('box m 0,0,0 12,7,2 stein\ntor m n b=3 h=3 art=spitzbogen rahmen=stein');
    clean(pointed);
    expect(at(pointed, 6, 2, 0)).toBeNull();
    expect(props(pointed, 5, 2, 0)).toMatchObject({ facing: 'west', half: 'top' });
    expect(errors(c2('box m 0,0,0 12,7,2 stein\ntor m s h=3'))[0].message).toContain('b=');
  });
});

describe('6.4 Gliederung der Wand', () => {
  const house = 'box h 0,0,0 6,4,4 stein hohl\n';

  it('gesims art=treppe: umgedrehte Treppen rundum zur Wand, Ecken außen', () => {
    const out = c2(house + 'gesims h y=2 holz');
    clean(out);
    expect(props(out, 3, 2, -1)).toMatchObject({ facing: 'south', half: 'top' });
    expect(props(out, 7, 2, 2)).toMatchObject({ facing: 'west', half: 'top' });
    expect(props(out, -1, 2, -1)?.shape).toMatch(/^outer_/);
    expect(name(out, 3, 2, -1)).toBe('spruce_stairs');
    expect(cells(out, (_x, y, _z, n) => y === 2 && n === 'spruce_stairs')).toHaveLength(28); // 9 + 9 + 5 + 5
  });

  it('gesims stufe, block, kragen, zahn und seiten=', () => {
    expect(props(c2(house + 'gesims h y=2 holz art=stufe'), 3, 2, -1)).toMatchObject({ type: 'top' });
    expect(name(c2(house + 'gesims h y=2 holz art=block'), 3, 2, -1)).toBe('spruce_planks');
    const k = c2(house + 'gesims h y=2 holz art=kragen');
    expect(name(k, 3, 2, -1)).toBe('spruce_planks');
    expect(props(k, 3, 1, -1)).toMatchObject({ facing: 'south', half: 'top' });
    const z = c2(house + 'gesims h y=2 holz art=zahn');
    expect([0, 1, 2, 3].map((x) => name(z, x, 2, -1))).toEqual([null, 'spruce_planks', null, 'spruce_planks']);
    const n = c2(house + 'gesims h ebene=2 holz seiten=n');
    expect(cells(n, (_x, y, _z, nm) => y === 2 && nm === 'spruce_stairs')).toEqual(['0,2,-1', '1,2,-1', '2,2,-1', '3,2,-1', '4,2,-1', '5,2,-1', '6,2,-1']);
    const nw = c2(house + 'gesims h ebene=2 holz seiten=n,w');
    expect(name(nw, -1, 2, -1)).toBe('spruce_stairs'); // the corner belongs to both sides
  });

  it('pfeiler an=raster: alle abstand Zellen ab dem West- bzw. Nordende, tiefe und Höhe', () => {
    const out = c2('box h 0,0,0 8,5,8 stein hohl\npfeiler h seiten=n holz abstand=4 tiefe=2 von=1 bis=4 kopf=holz:stufe fuss=stein');
    clean(out);
    for (const x of [0, 4, 8]) {
      expect(name(out, x, 2, -1)).toBe('spruce_planks');
      expect(name(out, x, 2, -2)).toBe('spruce_planks');
      expect(name(out, x, 5, -1)).toBe('spruce_slab'); // kopf on top
      expect(name(out, x, 0, -1)).toBe('stone_bricks'); // fuss below
    }
    expect(at(out, 2, 2, -1)).toBeNull();
    expect(at(out, -1, 2, 4)).toBeNull(); // only the north side
    const shifted = c2('box h 0,0,0 8,5,8 stein hohl\npfeiler h seiten=n holz abstand=4 versatz=2 breite=2');
    expect(cells(shifted, (_x, y, z, n) => y === 1 && z === -1 && n === 'spruce_planks')).toEqual(['2,1,-1', '3,1,-1', '6,1,-1', '7,1,-1']);
  });

  it('pfeiler art=strebe: Tiefe nimmt in gleichen Abschnitten ab, Rücksprünge mit Treppen zur Wand', () => {
    const out = c2('box h 0,0,0 8,5,8 stein hohl\npfeiler h seiten=s holz abstand=8 tiefe=2 art=strebe');
    clean(out);
    // Height 6: layers 0-2 two deep, 3-5 one deep; setback at y=3, cap on top at y=6.
    expect(name(out, 0, 2, 10)).toBe('spruce_planks');
    expect(props(out, 0, 3, 10)).toMatchObject({ facing: 'north', half: 'bottom' });
    expect(name(out, 0, 4, 9)).toBe('spruce_planks');
    expect(at(out, 0, 4, 10)).toBeNull();
    expect(props(out, 0, 6, 9)).toMatchObject({ facing: 'north', half: 'bottom' });
  });

  it('pfeiler an=ecken: an den Ecken, diagonal nach außen', () => {
    const out = c2('box h 0,0,0 8,5,8 stein hohl\npfeiler h an=ecken holz');
    clean(out);
    for (const [x, z] of [[-1, -1], [9, -1], [-1, 9], [9, 9]]) expect(name(out, x, 3, z)).toBe('spruce_planks');
    expect(at(out, 0, 3, -1)).toBeNull();
  });

  it('strebe: pro Schritt eine Zelle in Richtung und eine Lage höher, umgedreht, Blick zurück', () => {
    const out = c2(house + 'strebe 3,2,-1 richtung=n laenge=3 holz');
    clean(out);
    for (const [y, z] of [[2, -1], [3, -2], [4, -3]]) expect(props(out, 3, y, z)).toMatchObject({ facing: 'south', half: 'top' });
    expect(errors(c2(house + 'strebe 3,2,-1 laenge=3 holz'))[0].message).toContain('richtung=');
  });
});

describe('6.5 Anbauten', () => {
  it('balkon: Boden in Lage y−1, Geländer auf drei Kanten, Konsolen wie 4.3', () => {
    const out = c2('box h 0,0,0 10,8,6 putz hohl\nbalkon h s y=4 x=3 b=3 tiefe=2');
    clean(out);
    for (const x of [3, 4, 5]) for (const z of [7, 8]) expect(name(out, x, 3, z)).toBe('oak_planks');
    for (const [x, z] of [[3, 7], [3, 8], [4, 8], [5, 8], [5, 7]]) expect(name(out, x, 4, z)).toBe('oak_fence');
    expect(at(out, 4, 4, 7)).toBeNull();
    // Ring 1 at the wall lowest, ring 2 directly under the edge.
    expect(props(out, 4, 1, 7)).toMatchObject({ facing: 'north', half: 'top' });
    expect(name(out, 4, 2, 7)).toBe('oak_planks');
    expect(props(out, 4, 2, 8)).toMatchObject({ facing: 'north', half: 'top' });
  });

  it('balkon stuetzen, dach und tuer', () => {
    const out = c2('box h 0,0,0 10,9,6 putz hohl\nbalkon h s y=4 x=3 b=3 tiefe=2 stuetzen=balken dach=holz tuer=ja');
    clean(out);
    for (const y of [0, 1, 2]) {
      expect(name(out, 3, y, 8)).toBe('dark_oak_log');
      expect(name(out, 5, y, 8)).toBe('dark_oak_log');
    }
    expect(at(out, 4, 1, 7)).toBeNull(); // no corbels with posts
    // Lean-to roof: from y+3 over the balcony plus 1, rising towards the wall.
    for (const [y, z] of [[7, 9], [8, 8], [9, 7]]) {
      expect(cells(out, (_x, yy, zz, n) => yy === y && zz === z && n === 'spruce_stairs')).toHaveLength(5);
      expect(props(out, 4, y, z)).toMatchObject({ facing: 'north', half: 'bottom' });
    }
    expect(props(out, 4, 4, 6)).toMatchObject({ half: 'lower', facing: 'north' });
    expect(name(out, 4, 4, 6)).toBe('spruce_door');
  });

  it('umgang: Ring mit Abstand 1 bis tiefe, Geländer außen, Konsolen zur Wand', () => {
    const out = c2('box t 0,0,0 6,14,6 stein hohl\numgang t y=6 tiefe=2');
    clean(out);
    expect(name(out, 3, 5, -2)).toBe('oak_planks');
    expect(name(out, -2, 5, -2)).toBe('oak_planks');
    expect(name(out, 3, 6, -2)).toBe('oak_fence');
    expect(at(out, 3, 6, -1)).toBeNull();
    expect(props(out, 3, 3, -1)).toMatchObject({ facing: 'south', half: 'top' });
    expect(name(out, 3, 4, -1)).toBe('oak_planks');
    expect(props(out, 3, 4, -2)).toMatchObject({ facing: 'south', half: 'top' });
  });

  it('umgang stuetzen: Stämme auf dem äußeren Ring alle abstand Zellen, Strebe zur Wand; dach als Kranzdach', () => {
    const out = c2('box t 0,0,0 6,14,6 stein hohl\numgang t y=6 tiefe=2 stuetzen=balken abstand=4 dach=dach');
    clean(out);
    // Posts at the corners and evenly in between, at most 4 apart: x = -2, 1, 5, 8 on the north side.
    expect(cells(out, (_x, y, z, n) => y === 7 && z === -2 && n === 'dark_oak_log')).toEqual(['-2,7,-2', '1,7,-2', '5,7,-2', '8,7,-2']);
    // With dach= the posts carry the roof: four layers up to its outer ring in y+4.
    for (const y of [6, 7, 8, 9]) expect(at(out, 1, y, -2)?.key).toBe('minecraft:dark_oak_log[axis=y]');
    expect(name(out, 1, 10, -2)).toBe('deepslate_tile_stairs');
    expect(cells(out, (_x, y, _z, n) => y === 7 && n === 'dark_oak_log')).toHaveLength(12);
    // A brace under each post, one ring closer per layer; at corners diagonally.
    expect(props(out, 1, 4, -2)).toMatchObject({ facing: 'south', half: 'top' });
    expect(props(out, 1, 3, -1)).toMatchObject({ facing: 'south', half: 'top' });
    expect(at(out, 2, 3, -1)).toBeNull(); // braces only under the posts
    expect(props(out, -2, 4, -2)).toMatchObject({ facing: 'east', half: 'top' });
    expect(props(out, -1, 3, -1)).toMatchObject({ facing: 'east', half: 'top' });
    expect(at(out, -1, 3, -2)).toBeNull();
    // Round forms: evenly spaced, starting in the north.
    const round = c2('zylinder t 0,0,0 r=4 h=14 stein hohl\numgang t y=6 tiefe=1 stuetzen=balken abstand=4');
    clean(round);
    const ring = cells(round, (_x, y, _z, n) => y === 6 && (n === 'dark_oak_log' || n === 'oak_fence'));
    const logs = cells(round, (_x, y, _z, n) => y === 6 && n === 'dark_oak_log');
    expect(logs).toContain('0,6,-5');
    expect(logs).toHaveLength(Math.round(ring.length / 4));
    expect(name(round, 0, 8, -5)).toBe('dark_oak_log'); // nothing above: three layers
    expect(at(round, 0, 9, -5)).toBeNull();
    // Without a roof of their own they reach up to the first block above (here a ring in y+4).
    const under = c2('box t 0,0,0 6,14,6 stein hohl\nbox -2,10,-2 8,10,-2 holz\numgang t y=6 tiefe=2 stuetzen=balken');
    clean(under);
    for (const y of [6, 7, 8, 9]) expect(name(under, 1, y, -2)).toBe('dark_oak_log');
    expect(name(under, 8, 8, 8)).toBe('dark_oak_log');
    expect(at(under, 8, 9, 8)).toBeNull();
    // Skirt roof at y+3 = 9 with breite 3.
    expect(props(out, 3, 9, -3)).toMatchObject({ facing: 'south', half: 'bottom' });
    expect(name(out, 3, 9, -3)).toBe('deepslate_tile_stairs');
    expect(props(out, 3, 10, -2)).toMatchObject({ facing: 'south' });
  });

  it('erker eckig: hohle Form vor der Wand, offen zum Haus, Boden, Konsolen, Walmdach nur vor der Wand', () => {
    const out = c2('box h 0,0,0 12,9,8 putz hohl\nerker h s y=3 b=5 h=3 holz name=e1\nfenster e1 s y=4 b=3 h=1 bank=nein');
    clean(out);
    for (let x = 4; x <= 8; x++) for (const z of [9, 10]) expect(name(out, x, 3, z)).toBe('spruce_planks'); // floor
    expect(name(out, 4, 4, 9)).toBe('spruce_planks');
    expect(at(out, 6, 5, 9)).toBeNull(); // inside
    expect(at(out, 6, 5, 8)).toBeNull(); // the main wall is opened
    expect(name(out, 6, 4, 10)).toBe('glass_pane'); // window in the oriel's front, no hint
    expect(props(out, 6, 2, 10)).toMatchObject({ facing: 'north', half: 'top' });
    expect(name(out, 6, 2, 9)).toBe('oak_planks');
    expect(props(out, 6, 1, 9)).toMatchObject({ facing: 'north', half: 'top' });
    expect(props(out, 6, 6, 11)).toMatchObject({ facing: 'north', half: 'bottom' });
    expect(name(out, 6, 6, 8)).toBe('white_terracotta'); // the roof leaves the wall alone
    expect(cells(out, (_x, y, z, n) => z <= 8 && y >= 6 && n.startsWith('deepslate'))).toEqual([]);
  });

  it('erker halbrund und dreieck, Dach passend zur Art, dach=nein', () => {
    const half = c2('box h 0,0,0 12,9,8 putz hohl\nerker h n y=3 b=5 h=3 art=halbrund holz');
    clean(half);
    expect(cells(half, (_x, y, z, n) => y === 3 && z < 0 && n === 'spruce_planks')).toEqual(['4,3,-1', '5,3,-1', '5,3,-2', '6,3,-1', '6,3,-2', '7,3,-1', '7,3,-2', '8,3,-1']);
    expect(cells(half, (_x, y, z, n) => y >= 6 && z < 0 && n.startsWith('deepslate')).length).toBeGreaterThan(0);
    const tri = c2('box h 0,0,0 12,9,8 putz hohl\nerker h n y=3 b=5 h=3 art=dreieck holz dach=nein');
    clean(tri);
    expect(cells(tri, (_x, y, z, n) => y === 3 && z < 0 && n === 'spruce_planks')).toEqual(['4,3,-1', '5,3,-1', '5,3,-2', '6,3,-1', '6,3,-2', '6,3,-3', '7,3,-1', '7,3,-2', '8,3,-1']);
    expect(cells(tri, (_x, _y, _z, n) => n.startsWith('deepslate'))).toEqual([]);
    expect(errors(c2('box h 0,0,0 12,9,8 putz hohl\nerker h n y=3 b=4 h=3 art=halbrund holz'))[0].message).toContain('ungerade');
  });

  it('erker halbrund ist rund wie ein zylinder: ein Fenster b=3 sitzt ohne Hinweis in der Front', () => {
    const out = c2('box h 0,0,0 12,9,8 putz hohl\nerker h s y=4 b=5 h=4 art=halbrund holz name=e\nfenster e s y=5 b=3');
    clean(out); // before: "sitzt bei 5,5,10 in der Hausecke" for both outer columns
    for (const x of [5, 6, 7]) expect([name(out, x, 5, 10), name(out, x, 6, 10)]).toEqual(['glass_pane', 'glass_pane']);
    expect(props(out, 6, 4, 11)).toMatchObject({ facing: 'north', half: 'top' }); // sill
    expect(name(out, 6, 7, 10)).toBe('oak_planks'); // lintel
    // An eckig oriel keeps its corners.
    const box = c2('box h 0,0,0 12,9,8 putz hohl\nerker h s y=4 b=5 h=4 holz name=e\nfenster e s y=5 b=5 bank=nein sturz=nein');
    expect(warnings(box).filter((w) => w.message.includes('Hausecke')).length).toBeGreaterThan(0);
  });

  it('erker dach=sattel mit dachrolle, dach=flach nur vor der Wand', () => {
    const out = c2('box h 0,0,0 20,9,8 putz hohl\nerker h s y=3 x=2 b=5 h=3 holz dach=sattel dachrolle=stein\nerker h s y=3 x=12 b=5 h=3 holz dach=flach');
    clean(out);
    // Gable roof with the ridge across the wall: gable from the oriel's role at the front.
    expect(props(out, 1, 6, 10)).toMatchObject({ facing: 'east', half: 'bottom' });
    expect(name(out, 1, 6, 10)).toBe('stone_brick_stairs');
    expect([2, 3, 4, 5, 6].map((x) => name(out, x, 6, 10))).toEqual(Array(5).fill('spruce_planks'));
    expect(name(out, 4, 9, 9)).toBe('stone_brick_slab');
    expect(name(out, 4, 9, 8)).toBe('white_terracotta');
    // Flat roof: one layer over the oriel plus overhang, but not over the main wall or inside.
    expect(cells(out, (x, y, _z, n) => y === 6 && x >= 11 && x <= 17 && n === 'deepslate_tiles')).toHaveLength(7 * 3);
    expect(name(out, 14, 6, 8)).toBe('white_terracotta');
    expect(at(out, 14, 6, 7)).toBeNull();
  });

  it('gaube: Vorderwand in der Wandebene, Fenster, Wangen bis zur Dachfläche, eigenes Dach in der Kehle', () => {
    const out = c2('box h 0,0,0 12,4,8 putz hohl\ndach sattel h first=x\ngaube h s b=1 h=2');
    clean(out);
    expect(name(out, 6, 6, 8)).toBe('glass_pane');
    expect(name(out, 6, 7, 8)).toBe('glass_pane');
    expect(name(out, 5, 5, 8)).toBe('white_terracotta'); // front wall
    expect(name(out, 5, 7, 7)).toBe('white_terracotta'); // cheek back to the roof
    expect(at(out, 6, 7, 7)).toBeNull(); // main roof removed inside
    expect(name(out, 6, 9, 8)).toBe('white_terracotta'); // gable of the dormer roof
    expect(name(out, 6, 10, 6)).toBe('deepslate_tile_slab'); // ridge runs into the main roof
    expect(props(out, 4, 8, 7)).toMatchObject({ facing: 'east', half: 'bottom' });
    expect(props(out, 2, 7, 7)).toMatchObject({ facing: 'north', half: 'bottom' }); // main roof elsewhere
    expect(errors(c2('box h 0,0,0 12,4,8 putz hohl\ngaube h s'))[0].message).toContain('Dach');
    expect(errors(c2('box h 0,0,0 12,4,8 putz hohl\ndach sattel h first=x\ngaube h o'))[0].message).toContain('Traufseite');
  });

  it('gaube schlepp und spitz, einzug', () => {
    const shed = c2('box h 0,0,0 12,4,8 putz hohl\ndach sattel h first=x\ngaube h s b=3 h=1 art=schlepp');
    clean(shed);
    // Lean-to roof with profile 2/1 rising towards the main roof: two rows inwards per layer.
    expect(props(shed, 6, 7, 9)).toMatchObject({ type: 'bottom' });
    expect(name(shed, 6, 7, 9)).toBe('deepslate_tile_slab');
    expect(props(shed, 6, 7, 8)).toMatchObject({ facing: 'north', half: 'bottom' });
    expect(props(shed, 6, 8, 7)).toMatchObject({ type: 'bottom' });
    expect(props(shed, 6, 8, 6)).toMatchObject({ facing: 'north', half: 'bottom' });
    expect([4, 5, 6, 7, 8].map((x) => name(shed, x, 6, 8))).toEqual(['white_terracotta', 'glass_pane', 'glass_pane', 'glass_pane', 'white_terracotta']);
    const hip = c2('box h 0,0,0 12,4,8 putz hohl\ndach sattel h first=x\ngaube h s art=spitz');
    clean(hip);
    expect(props(hip, 6, 8, 9)).toMatchObject({ facing: 'north', half: 'bottom' });
    const back = c2('box h 0,0,0 12,4,8 putz hohl\ndach sattel h first=x ueberstand=2\ngaube h s einzug=1');
    clean(back);
    expect(name(back, 6, 6, 7)).toBe('glass_pane');
  });

  it('gaube rolle, dachrolle, fensterart und laeden', () => {
    const out = c2('box h 0,0,0 12,4,8 putz hohl\ndach sattel h first=x\ngaube h s b=2 h=2 fensterart=bogen laeden=laden rolle=holz dachrolle=stein');
    clean(out);
    // Front wall x=4..7 from the first roof layer (y=5), window y=6..7 with an arch in the top row.
    expect([4, 5, 6, 7].map((x) => name(out, x, 5, 8))).toEqual(['spruce_planks', 'spruce_planks', 'spruce_planks', 'spruce_planks']);
    expect(name(out, 5, 6, 8)).toBe('glass_pane');
    expect(props(out, 5, 7, 8)).toMatchObject({ facing: 'west', half: 'top' });
    expect(props(out, 6, 7, 8)).toMatchObject({ facing: 'east', half: 'top' });
    expect(name(out, 5, 7, 8)).toBe('oak_stairs');
    for (const [x, y] of [[4, 6], [7, 6], [4, 7], [7, 7]]) expect(props(out, x, y, 9)).toMatchObject({ facing: 'south', open: 'true' });
    expect(name(out, 4, 6, 9)).toBe('spruce_trapdoor');
    // Gable of the dormer roof from rolle, roof surface from dachrolle; the main roof keeps its role.
    expect(name(out, 5, 9, 8)).toBe('spruce_planks');
    expect(props(out, 3, 8, 8)).toMatchObject({ facing: 'east', half: 'bottom' });
    expect(name(out, 3, 8, 8)).toBe('stone_brick_stairs');
    expect(name(out, 1, 6, 8)).toBe('deepslate_tile_stairs');
  });

  it('ecktuerme: Mitte um r−einzug diagonal nach außen, hohl ab r=2, Konsolen als umgekehrter Kegel, Helm', () => {
    const out = c2('box h 0,0,0 10,8,10 stein hohl\ndach walm h\necktuerme h an=nw r=2 h=4 y=6 holz');
    clean(out);
    // Centre (-1,-1).
    expect(name(out, -3, 7, -1)).toBe('spruce_planks');
    expect(at(out, -1, 7, -1)).toBeNull();
    expect(at(out, -1, 9, -1)).toBeNull(); // the main roof's eave gives way
    expect(props(out, -3, 5, -1)).toMatchObject({ facing: 'east', half: 'top' });
    expect(name(out, -1, 5, -1)).toBe('oak_planks');
    expect(props(out, -2, 4, -1)).toMatchObject({ facing: 'east', half: 'top' });
    const top = Math.max(...out.grid.entries().filter(([x, , z]) => x === -1 && z === -1).map(([, y]) => y));
    expect(top).toBeGreaterThan(12);
    expect(name(out, -1, top, -1)?.startsWith('deepslate')).toBe(true);
    expect(cells(out, (x, y, _z, n) => y === 7 && x > 9 && n === 'spruce_planks')).toEqual([]); // only nw
    expect(errors(c2('zylinder z 0,0,0 r=4 h=4 stein\necktuerme z r=1 h=2 y=3 holz'))[0].message).toContain('Ecken');
  });
});

describe('6.6 Zinnen, Bögen, Treppen', () => {
  it('zinnen muster, hoehe und kappe; Ecken sind immer Zinne', () => {
    const out = c2('box h 0,0,0 8,3,8 stein\nzinnen h muster=2:1 hoehe=2 kappe=holz:stufe');
    clean(out);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((x) => name(out, x, 4, 0))).toEqual(['stone_bricks', 'stone_bricks', null, 'stone_bricks', 'stone_bricks', null, 'stone_bricks', 'stone_bricks', 'stone_bricks']);
    expect(name(out, 0, 5, 0)).toBe('stone_bricks');
    expect(name(out, 0, 6, 0)).toBe('spruce_slab');
    expect(at(out, 2, 6, 0)).toBeNull();
  });

  it('zinnen vorkragung=1: Kranz und Brüstung einen Block außen, Treppen auf jeder zweiten Zelle, Gussöffnungen', () => {
    const out = c2('box h 0,0,0 8,3,8 stein\nzinnen h vorkragung=1 konsolen=holz');
    clean(out);
    for (let x = -1; x <= 9; x++) expect(name(out, x, 4, -1)).toBe('stone_bricks'); // parapet
    expect(name(out, -1, 5, -1)).toBe('stone_bricks'); // corner merlon
    expect(at(out, 0, 5, -1)).toBeNull();
    expect(props(out, 1, 3, -1)).toMatchObject({ facing: 'south', half: 'top' });
    expect(name(out, 1, 3, -1)).toBe('spruce_stairs');
    expect(at(out, 2, 3, -1)).toBeNull(); // murder hole
    expect(at(out, 4, 3, 4)).not.toBeNull(); // the top of the solid box
    expect(at(out, 4, 4, 4)).toBeNull();
    expect(at(out, 0, 4, 4)).toBeNull(); // the walk behind the parapet stays free
  });

  it('bogen: Unterkante rund, spitz, flach; ab ,5 eine Treppe vom Mittelpunkt weg', () => {
    expect(archEdge('rund', 6, 3, 3)).toBeCloseTo(3);
    expect(archEdge('rund', 6, 3, 0)).toBeCloseTo(0);
    expect(archEdge('spitz', 6, 4, 3)).toBeCloseTo(4);
    expect(archEdge('flach', 6, 2, 0)).toBeCloseTo(0);
    expect(archEdge('flach', 6, 2, 3)).toBeCloseTo(2);
    const out = c2('box 0,0,0 0,2,0 stein\nbox 6,0,0 6,2,0 stein\nbogen 0,3,0 6,3,0 hoehe=3 stein tiefe=2');
    clean(out);
    expect(name(out, 0, 3, 0)).toBe('stone_bricks'); // e = 0: the leg …
    expect(name(out, 0, 4, 0)).toBe('stone_bricks'); // … reaches up to just below the next column (closed arch)
    expect(at(out, 0, 5, 0)).toBeNull();
    expect(at(out, 1, 4, 0)).toBeNull();
    expect(name(out, 1, 5, 0)).toBe('stone_bricks'); // e = 2.24
    expect(props(out, 2, 5, 0)).toMatchObject({ facing: 'west', half: 'top' }); // e = 2.83
    expect(name(out, 3, 6, 0)).toBe('stone_bricks'); // apex
    expect(props(out, 4, 5, 0)).toMatchObject({ facing: 'east', half: 'top' });
    expect(props(out, 4, 5, 1)).toMatchObject({ facing: 'east', half: 'top' }); // tiefe
    expect(at(out, 3, 5, 0)).toBeNull();
    const thick = c2('box 0,0,0 0,2,0 stein\nbox 6,0,0 6,2,0 stein\nbogen 0,3,0 6,3,0 hoehe=3 stein dicke=2');
    expect(name(thick, 3, 7, 0)).toBe('stone_bricks');
    expect(errors(c2('bogen 0,3,0 6,4,0 hoehe=3 stein'))[0].message).toContain('Höhe');
    expect(errors(c2('bogen 0,3,0 6,3,2 hoehe=3 stein'))[0].message).toContain('Linie');
  });

  it('treppe: Stufen in richtung, eine Lage pro Stufe, Breite nach rechts, Unterbau und Geländer', () => {
    const out = c2('treppe 0,0,0 richtung=n laenge=3 holz breite=2 gelaender=holz');
    clean(out);
    for (const [y, z] of [[0, 0], [1, -1], [2, -2]]) {
      expect(props(out, 0, y, z)).toMatchObject({ facing: 'north', half: 'bottom' });
      expect(props(out, 1, y, z)).toMatchObject({ facing: 'north', half: 'bottom' });
      expect(name(out, -1, y + 1, z)).toBe('spruce_fence');
      expect(name(out, 2, y + 1, z)).toBe('spruce_fence');
    }
    expect(name(out, 0, 0, -2)).toBe('spruce_planks'); // unterbau=voll
    const under = c2('treppe 0,0,0 richtung=o laenge=3 holz unterbau=treppe');
    clean(under);
    expect(props(under, 1, 0, 0)).toMatchObject({ facing: 'west', half: 'top' });
    expect(at(under, 2, 0, 0)).toBeNull();
    const none = c2('treppe 0,0,0 richtung=o laenge=3 holz unterbau=keiner\nblock 1,0,0 stein\nblock 2,0,0 stein\nblock 2,1,0 stein');
    expect(name(none, 2, 2, 0)).toBe('spruce_stairs');
  });

  it('wendeltreppe innen: Ring nach Winkel ab start, rechts im Uhrzeigersinn, Spindel, Kopffreiheit durch Böden', () => {
    const out = c2('zylinder t 0,0,0 r=4 h=8 stein hohl boden=holz\nbox 0,4,0 0,4,0 stein\nbox -2,4,-2 2,4,2 holz\nwendeltreppe 0,1,0 r=2 bis=4 holz spindel=stein');
    clean(out);
    // Ring r=2 from north, clockwise: (0,-2), (1,-2), (2,-1), (2,0) …
    expect(props(out, 0, 1, -2)).toMatchObject({ facing: 'east', half: 'bottom' });
    expect(props(out, 1, 2, -2)).toMatchObject({ facing: 'east' });
    expect(props(out, 2, 3, -1)).toMatchObject({ facing: 'south' });
    expect(props(out, 2, 4, 0)).toMatchObject({ facing: 'south' });
    for (let y = 1; y <= 4; y++) expect(name(out, 0, y, 0)).toBe('stone_bricks');
    expect(at(out, 0, 4, -2)).toBeNull(); // the floor above the first steps is cut away
    const left = c2('wendeltreppe 0,0,0 r=2 bis=2 holz richtung=links start=o');
    expect(props(left, 2, 0, 0)).toMatchObject({ facing: 'north' });
    expect(name(left, 2, 1, -1)).toBe('spruce_stairs');
    const slabs = c2('wendeltreppe 0,0,0 r=2 bis=1 holz stufen=stufe');
    expect(props(slabs, 0, 0, -2)).toMatchObject({ type: 'bottom' });
    expect(props(slabs, 1, 0, -2)).toMatchObject({ type: 'top' });
    expect(props(slabs, 2, 1, -1)).toMatchObject({ type: 'bottom' });
    expect(props(slabs, 2, 1, 0)).toMatchObject({ type: 'top' });
  });

  it('wendeltreppe breite=2: der innere Ring gibt den Takt vor, kein Ring springt zwei Lagen, Absätze außen', () => {
    // The inner ring has fewer cells; it rises one layer per cell, the outer ring joins its steps.
    const wide = c2('wendeltreppe 0,0,0 r=3 bis=12 holz breite=2');
    clean(wide);
    expect(props(wide, 0, 0, -3)).toMatchObject({ facing: 'east', half: 'bottom' });
    expect(props(wide, 0, 0, -2)).toMatchObject({ facing: 'east', half: 'bottom' });
    expect(props(wide, 1, 1, -2)).toMatchObject({ facing: 'east' });
    expect(props(wide, 2, 2, -1)).toMatchObject({ facing: 'south' }); // before the fix: (2,3,-1), two layers up
    expect(props(wide, 3, 2, -1)).toMatchObject({ facing: 'south' });
    // Two cells of the outer ring in one step: the first is a landing (bottom slab).
    expect(at(wide, 2, 2, -2)?.key).toBe('minecraft:spruce_slab[type=bottom,waterlogged=false]');
    // Walking along each ring, the next cell is at most one layer higher, for both directions.
    for (const dir of ['rechts', 'links']) {
      const out = c2(`wendeltreppe 0,0,0 r=5 bis=20 holz breite=3 richtung=${dir}`);
      clean(out);
      for (const rr of [3, 4, 5]) {
        const ring = ringCells(rr).sort((p, q) => cellAngle(p[0], p[1], 0.5, 0.5) - cellAngle(q[0], q[1], 0.5, 0.5));
        if (dir === 'links') ring.reverse();
        ring.forEach(([x, z], i) => {
          const [nx, nz] = ring[(i + 1) % ring.length];
          for (let y = 0; y < 20; y++)
            if (at(out, x, y, z)) expect(!!at(out, nx, y, nz) || !!at(out, nx, y + 1, nz), `${dir} r=${rr}: ${x},${y},${z} → ${nx},${nz}`).toBe(true);
        });
      }
      expect(Math.max(...out.grid.entries().map(([, y]) => y))).toBe(20);
    }
  });

  it('wendeltreppe aussen: Weg außen um die Form, Konsolen zur Wand, Geländer außen, schritt', () => {
    const out = c2('box t 0,0,0 4,10,4 stein hohl\nwendeltreppe t aussen bis=3 holz gelaender=balken');
    clean(out);
    expect(props(out, 2, 0, -1)).toMatchObject({ facing: 'east', half: 'bottom' });
    expect(props(out, 3, 1, -1)).toMatchObject({ facing: 'east' });
    expect(props(out, 4, 2, -1)).toMatchObject({ facing: 'east' });
    expect(name(out, 5, 3, -1)).toBe('spruce_stairs');
    expect(props(out, 3, 0, -1)).toMatchObject({ facing: 'south', half: 'top' }); // corbel under the step
    expect(at(out, 2, -1, -1)).toBeNull(); // none under the first step on the ground
    expect(name(out, 3, 2, -2)).toBe('dark_oak_log'); // railing post outside, one layer above
    const slow = c2('box t 0,0,0 4,10,4 stein hohl\nwendeltreppe t aussen bis=2 holz schritt=2');
    clean(slow);
    expect(name(slow, 2, 0, -1)).toBe('spruce_stairs');
    expect(props(slow, 3, 0, -1)).toMatchObject({ type: 'top' });
    expect(name(slow, 4, 1, -1)).toBe('spruce_stairs');
  });
});

describe('7 Zier und Deko', () => {
  const house = 'box h 0,0,0 8,6,8 stein hohl decke=holz\n';

  it('wandlaterne mit Arm, als Fackel und auf einem Block', () => {
    const out = c2(house + 'wandlaterne h s y=3 arm=holz\nwandlaterne h n y=3 art=fackel\nwandlaterne h o y=3 art=seelenlaterne');
    clean(out);
    expect(name(out, 4, 3, 9)).toBe('spruce_fence');
    expect(at(out, 4, 2, 9)?.key).toBe('minecraft:lantern[hanging=true,waterlogged=false]');
    expect(at(out, 4, 3, -1)?.key).toBe('minecraft:wall_torch[facing=north]');
    expect(name(out, 9, 3, 4)).toBe('oak_planks');
    expect(props(out, 9, 4, 4)).toMatchObject({ hanging: 'false' });
    expect(name(out, 9, 4, 4)).toBe('soul_lantern');
  });

  it('haengelaterne: Ketten unter einem Block, darunter die Laterne', () => {
    const out = c2(house + 'haengelaterne 4,5,4 kette=2');
    clean(out);
    expect(at(out, 4, 5, 4)?.key).toBe('minecraft:chain[axis=y,waterlogged=false]');
    expect(name(out, 4, 4, 4)).toBe('chain');
    expect(props(out, 4, 3, 4)).toMatchObject({ hanging: 'true' });
    expect(warnings(c2('box h 0,0,0 8,6,8 stein hohl\nhaengelaterne 4,4,4'))[0].message).toContain('kein Block');
    expect(at(c2(house + 'haengelaterne 4,5,4 kette=0 art=seelenlaterne'), 4, 5, 4)?.key).toBe('minecraft:soul_lantern[hanging=true,waterlogged=false]');
  });

  it('banner: Wandbanner der Farbe, Blick nach außen; haengend=ja mit Stange darüber', () => {
    const out = c2(house + 'banner h w y=4 farbe=rot\nbanner h s y=4 farbe=blue haengend=ja');
    clean(out);
    expect(at(out, -1, 4, 4)?.key).toBe('minecraft:red_wall_banner[facing=west]');
    expect(at(out, 4, 4, 9)?.key).toBe('minecraft:blue_wall_banner[facing=south]');
    expect(name(out, 4, 5, 9)).toBe('oak_fence');
    expect(errors(c2(house + 'banner h w y=4 farbe=pink_lila'))[0].message).toContain('Farbe');
  });

  it('efeu: Ranken vor vollen Wandflächen, mit der Seite zur Wand, hängt bis laenge nach unten', () => {
    const all = c2(house + 'efeu h dichte=1 laenge=1');
    clean(all);
    expect(at(all, 4, 3, -1)?.props).toMatchObject({ south: 'true', north: 'false' });
    expect(at(all, 9, 3, 4)?.props).toMatchObject({ west: 'true' });
    expect(cells(all, (_x, _y, _z, n) => n === 'vine')).toHaveLength(4 * 9 * 7);
    expect(cells(c2(house + 'efeu h dichte=0'), (_x, _y, _z, n) => n === 'vine')).toEqual([]);
    const lichen = c2(house + 'efeu h dichte=1 laenge=1 art=flechte seiten=n von=2 bis=3');
    expect(cells(lichen, (_x, _y, _z, n) => n === 'glow_lichen')).toHaveLength(2 * 9);
    expect(at(lichen, 4, 2, -1)?.props).toMatchObject({ south: 'true' });
    // Hanging: from the start cells down while the wall goes on, at most laenge cells.
    const some = c2(house + 'efeu h dichte=0.2 laenge=4 seiten=n');
    const vines = cells(some, (_x, _y, _z, n) => n === 'vine');
    expect(vines.length).toBeGreaterThan(0);
    for (const v of vines) {
      const [x, y, z] = v.split(',').map(Number);
      expect(z).toBe(-1);
      expect(x >= 0 && x <= 8 && y >= 0 && y <= 6).toBe(true);
    }
  });

  it('bewuchs oben und an den Seiten, streue auf freie Oberseiten', () => {
    const top = c2('box h 0,0,0 6,3,6 stein\nbewuchs h block=moss_carpet dichte=1');
    clean(top);
    expect(cells(top, (_x, y, _z, n) => y === 4 && n === 'moss_carpet')).toHaveLength(49);
    const sides = c2('box h 0,0,0 6,3,6 stein\nbewuchs h block=vine flaechen=seiten dichte=1');
    expect(at(sides, 3, 1, -1)?.props).toMatchObject({ south: 'true' });
    const none = c2('box h 0,0,0 6,3,6 stein\nstreue h block=brown_mushroom dichte=0');
    expect(cells(none, (_x, _y, _z, n) => n === 'brown_mushroom')).toEqual([]);
    const full = c2('box h 0,0,0 6,3,6 stein\nstreue h block=brown_mushroom dichte=1');
    clean(full);
    expect(cells(full, (_x, y, _z, n) => y === 4 && n === 'brown_mushroom')).toHaveLength(49);
    const half = c2('box h 0,0,0 20,0,20 stein\nstreue h block=poppy dichte=0.3');
    const n = cells(half, (_x, _y, _z, nm) => nm === 'poppy').length;
    expect(n).toBeGreaterThan(441 * 0.15);
    expect(n).toBeLessThan(441 * 0.45);
  });

  it('laub: Blätterwolke um eine Mitte, dauerhaft, Stamm und Äste bleiben', () => {
    const out = c2('linie 0,0,0 0,4,0 balken\nlaub 0,5,0 r=2 laub dichte=1');
    clean(out);
    expect(at(out, 0, 5, 0)?.props).toMatchObject({ persistent: 'true' });
    expect(name(out, 2, 5, 0)).toBe('oak_leaves');
    expect(name(out, 2, 6, 0)).toBe('oak_leaves');
    expect(at(out, 2, 7, 0)).toBeNull();
    expect(name(out, 0, 4, 0)).toBe('dark_oak_log');
    const thin = c2('linie 0,0,0 0,4,0 balken\nlaub 0,5,0 r=3 laub dichte=0.4');
    expect(cells(thin, (_x, _y, _z, nm) => nm === 'oak_leaves').length).toBeLessThan(cells(c2('linie 0,0,0 0,4,0 balken\nlaub 0,5,0 r=3 laub dichte=1'), (_x, _y, _z, nm) => nm === 'oak_leaves').length);
  });
});

describe('8 Farmen', () => {
  it('Wasserreihen: erste auf min(4,(B−1)/2) vom Rand, dann alle 9, am anderen Rand nach Bedarf', () => {
    expect(waterRows(12)).toEqual([4, 7]);
    expect(waterRows(9)).toEqual([4]);
    expect(waterRows(5)).toEqual([2]);
    expect(waterRows(30)).toEqual([4, 13, 22, 25]);
    expect(waterRows(23)).toEqual([4, 13, 18]); // never on the edge row
    expect(waterRows(14)).toEqual([4, 9]);
  });

  it('feld: Ackerboden mit Wasser in Reichweite, Früchte im höchsten Alter', () => {
    const small = c2('feld 0,0,0 6,0,6');
    clean(small);
    expect(at(small, 3, 0, 3)?.key).toBe('minecraft:water[level=0]');
    expect(at(small, 0, 0, 0)?.key).toBe('minecraft:farmland[moisture=7]');
    expect(at(small, 0, 1, 0)?.key).toBe('minecraft:wheat[age=7]');
    expect(at(small, 3, 1, 3)).toBeNull();
    const big = c2('feld 0,0,0 19,0,11 frucht=beetroots');
    clean(big);
    expect(at(big, 0, 1, 0)?.props).toEqual({ age: '3' });
    const water = cells(big, (_x, _y, _z, n) => n === 'water').map((k) => k.split(',').map(Number));
    expect(new Set(water.map(([, , z]) => z))).toEqual(new Set([4, 7]));
    expect(Math.min(...water.map(([x]) => x))).toBe(1); // rows stay enclosed by farmland
    for (let x = 0; x <= 19; x++)
      for (let z = 0; z <= 11; z++) {
        if (water.some(([wx, , wz]) => wx === x && wz === z)) continue;
        expect(water.some(([wx, , wz]) => Math.max(Math.abs(wx - x), Math.abs(wz - z)) <= 4), `${x},${z}`).toBe(true);
      }
  });

  it('feld zaun, tor und weg', () => {
    const out = c2('feld 0,0,0 7,0,5 frucht=carrots zaun=holz tor=s weg=dirt_path');
    clean(out);
    expect(name(out, -1, 1, -1)).toBe('spruce_fence');
    expect(name(out, 8, 1, 3)).toBe('spruce_fence');
    expect(at(out, 3, 1, 6)?.props).toMatchObject({ facing: 'south' });
    expect(name(out, 3, 1, 6)).toBe('spruce_fence_gate');
    expect(name(out, -2, 0, 2)).toBe('dirt_path');
    expect(at(out, -1, 0, 2)).toBeNull();
    expect(at(out, 2, 1, 2)?.key).toBe('minecraft:carrots[age=7]');
    expect(errors(c2('feld 0,0,0 7,1,5'))[0].message).toContain('Lage');
  });
});

describe('11 Prüfungen', () => {
  it('Überschrieben: spätere Anweisungen über Glas, Tür oder Anbau', () => {
    const out = c2('box h 0,0,0 8,4,6 stein hohl\nfenster h s y=2 x=3\nbox 3,2,6 3,3,6 holz\ntür h n x=4\nleer 4,1,0 4,2,0');
    expect(warnings(out).map((w) => [w.line, w.message])).toEqual([
      [line(3), expect.stringContaining('das Fenster aus Zeile 14 an 2 Stellen')],
      [line(5), expect.stringContaining('die Tür aus Zeile 16')],
    ]);
    const annex = c2('box h 0,0,0 10,8,6 putz hohl\nbalkon h s y=4 x=3 b=3\nbox 4,3,7 4,3,7 stein');
    expect(warnings(annex)[0].message).toContain('den Balkon aus Zeile 14');
  });

  it('Halt: Blöcke ohne passenden Halt, Falltüren brauchen keinen', () => {
    const out = c2(
      [
        'box 0,0,0 9,0,0 stein',
        'block 0,2,0 lantern',
        'block 1,2,0 wall_torch[facing=north]',
        'block 2,2,0 vine[north=true]',
        'block 3,2,0 spruce_door',
        'block 4,1,0 poppy',
        'block 5,2,0 sand',
        'block 6,2,0 spruce_trapdoor',
        'block 7,1,0 spruce_fence',
        'block 7,2,0 torch',
        'block 8,1,0 lantern[hanging=true]',
      ].join('\n'),
    );
    expect(errors(out)).toEqual([]);
    const halt = warnings(out).filter((w) => w.message.startsWith('Halt'));
    expect(halt.map((w) => w.line)).toEqual([line(2), line(3), line(4), line(5), line(6), line(7), line(11)]);
    expect(halt[0].message).toContain('Laterne');
    expect(halt[5].message).toContain('Sand');
    expect(warnings(c2('block 0,0,0 lantern\nblock 1,0,0 poppy')).filter((w) => w.message.startsWith('Halt'))).toEqual([]); // the lowest layer stands on the ground
  });

  it('Schweben: Gruppen ohne Block in der untersten Lage, Kanten verbinden; erlaube schweben', () => {
    const out = c2('box 0,0,0 4,0,4 stein\nbox 0,6,0 1,6,0 holz\nblock 2,7,2 holz');
    const s = warnings(out).filter((w) => w.message.startsWith('Schweben'));
    expect(s.map((w) => w.line)).toEqual([line(2), line(3)]);
    expect(s[0].message).toContain('2 Blöcke von 0,6,0 bis 1,6,0');
    expect(s[0].message).toContain('Zeile 14 (2)');
    // Over an edge counts as connected (roofs of stairs, tapering walls).
    clean(c2('box 0,0,0 4,0,4 stein\nblock 5,1,0 stein\nblock 6,2,0 stein'));
    clean(c2('box h 0,0,0 8,4,6 stein hohl\ndach walm h'));
    clean(c2('erlaube schweben\nbox 0,0,0 4,0,4 stein\nbox 0,6,0 1,6,0 holz'));
    expect(errors(c2('erlaube fliegen'))[0].message).toContain('schweben');
  });

  it('Fließen: Wasser oder Lava mit Luft daneben oder darunter', () => {
    const out = c2('box 0,0,0 4,1,4 stein\nblock 2,2,2 water\nleer 2,1,2\nblock 2,1,2 lava');
    const f = warnings(out).filter((w) => w.message.startsWith('Fließen'));
    expect(f.map((w) => w.line)).toEqual([line(2)]);
    expect(f[0].message).toContain('Wasser bei 2,2,2');
    clean(c2('box 0,0,0 4,1,4 stein\nblock 2,1,2 water'));
    clean(c2('box 0,0,0 4,0,4 stein\nleer 2,0,2\nblock 2,0,2 water')); // lowest layer: ground below
  });
});
