import { describe, expect, it } from 'vitest';
import { backupVersion, EditHistory, listVersions, MemoryVersions, versionDir, versionLabel, versionStamp } from '../src/app/editCore';
import { compileTess } from '../src/tess/compile';
import { cellLine, composeOrient, EDIT_MARKER, replaceRoleSort, setCellEdit, setOrientation } from '../src/tess/edit';

/**
 * Editing in the app (Etappe 4c): the file stays the same except for the lines a change
 * concerns; undo and redo on the file text; the version store.
 */

const PLAN = [
  '# Testhaus',
  'tess 2',
  'projekt "Haus"   # Titel',
  '',
  'rolle stein stone_bricks:6 mossy_stone_bricks:2 \\',
  '  cracked_stone_bricks muster=flecken:3  # gemischt',
  'rolle holz spruce_planks',
  'box h 0,0,0 4,3,4 stein hohl',
  'block 2,4,2 holz  # Spitze',
  '',
].join('\n');

const plan = (src: string) => compileTess(src).plan!;
/** Lines that differ between two texts (index: [before, after]). */
function diff(a: string, b: string): Record<number, [string | undefined, string | undefined]> {
  const x = a.split('\n');
  const y = b.split('\n');
  const out: Record<number, [string | undefined, string | undefined]> = {};
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) out[i + 1] = [x[i], y[i]];
  return out;
}

describe('Textänderungen beim Bearbeiten', () => {
  it('tauscht eine Sorte der Rolle, Gewicht und Rest der Datei bleiben', () => {
    const p = plan(PLAN);
    const stein = p.roles.find((r) => r.name === 'stein')!;
    expect(stein).toMatchObject({ line: 5, lastLine: 6 });
    const a = replaceRoleSort(PLAN, stein, 1, 'minecraft:andesite');
    expect(diff(PLAN, a)).toEqual({ 5: ['rolle stein stone_bricks:6 mossy_stone_bricks:2 \\', 'rolle stein stone_bricks:6 andesite:2 \\'] });
    const b = replaceRoleSort(PLAN, stein, 2, 'create:cut_andesite');
    expect(diff(PLAN, b)).toEqual({ 6: ['  cracked_stone_bricks muster=flecken:3  # gemischt', '  create:cut_andesite muster=flecken:3  # gemischt'] });
    expect(compileTess(b).diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    expect(() => replaceRoleSort(PLAN.replace('mossy_stone_bricks', 'tuff'), stein, 1, 'andesite')).toThrow();
  });

  it('legt die Zeile ausrichtung unter dem Kopf an, ändert und entfernt sie', () => {
    const p = plan(PLAN);
    const turned = setOrientation(PLAN, p.orient.line, composeOrient(p.orient, 'turn'));
    const lines = turned.split('\n');
    expect(lines[3]).toBe('ausrichtung drehung=90');
    expect([...lines.slice(0, 3), ...lines.slice(4)].join('\n')).toBe(PLAN);
    const p2 = plan(turned);
    expect(p2.orient).toEqual({ turn: 90, mirror: null, line: 4 });
    const more = setOrientation(turned, p2.orient.line, composeOrient(p2.orient, 'x'));
    expect(diff(turned, more)).toEqual({ 4: ['ausrichtung drehung=90', `ausrichtung ${orientOf(composeOrient(p2.orient, 'x'))}`] });
    // Mirroring twice and turning to 360° removes the line again.
    let t = turned;
    for (let i = 0; i < 3; i++) t = setOrientation(t, plan(t).orient.line, composeOrient(plan(t).orient, 'turn'));
    expect(t).toBe(PLAN);
  });

  it('setzt ausrichtung so, dass das Ergebnis wie gedreht aussieht', () => {
    const src = 'tess 2\nrolle stein stone_bricks\nerlaube schweben\nblock 3,0,0 stein\nblock 0,0,1 oak_stairs[facing=n]\n';
    let t = src;
    for (const op of ['turn', 'x', 'turn', 'z'] as const) t = setOrientation(t, plan(t).orient.line, composeOrient(plan(t).orient, op));
    // turn, mirror x, turn, mirror z: x → −z → z → x … check one block.
    const out = compileTess(t);
    expect(out.diagnostics).toEqual([]);
    expect(out.grid.entries().length).toBe(2);
  });

  it('schreibt Einzelblöcke in den Bereich am Dateiende, eine weitere Änderung derselben Zelle ersetzt die Zeile', () => {
    const a = setCellEdit(PLAN, 2, 3, 0, cellLine(2, 3, 0, { name: 'minecraft:spruce_stairs', props: { facing: 'east', half: 'top' } }));
    const lines = a.split('\n');
    expect(lines.slice(0, 9)).toEqual(PLAN.split('\n').slice(0, 9));
    expect(lines.slice(9)).toEqual(['', EDIT_MARKER, 'block 2,3,0 spruce_stairs[facing=east,half=top]', '']);
    const b = setCellEdit(a, 4, 3, 4, cellLine(4, 3, 4, null));
    const c = setCellEdit(b, 2, 3, 0, cellLine(2, 3, 0, { name: 'minecraft:glass', props: {} }));
    expect(c.split('\n').slice(9)).toEqual(['', EDIT_MARKER, 'block 2,3,0 glass', 'leer 4,3,4', '']);
    const out = compileTess(c);
    expect(out.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    expect(out.grid.get(2, 3, 0)?.name).toBe('minecraft:glass');
    expect(out.grid.get(4, 3, 4)).toBeNull();
    // Removing the line of a cell leaves the rest untouched.
    expect(setCellEdit(c, 4, 3, 4, null).split('\n').slice(9)).toEqual(['', EDIT_MARKER, 'block 2,3,0 glass', '']);
  });

  it('behält Zeilenenden \\r\\n', () => {
    const crlf = PLAN.replace(/\n/g, '\r\n');
    const a = setCellEdit(crlf, 0, 5, 0, 'leer 0,5,0');
    expect(a.includes('\n') && !/[^\r]\n/.test(a)).toBe(true);
  });
});

function orientOf(o: { turn: number; mirror: string | null }): string {
  return [o.turn ? `drehung=${o.turn}` : '', o.mirror ? `spiegel=${o.mirror}` : ''].filter(Boolean).join(' ');
}

describe('Rückgängig und Wiederholen', () => {
  const t = (s: string) => new TextEncoder().encode(s);
  const s = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);

  it('geht Schritt für Schritt zurück und wieder vor, ein neuer Schritt leert Wiederholen', () => {
    const h = new EditHistory();
    h.record(t('A'));
    h.record(t('B'));
    // current: C
    expect(s(h.back(t('C')))).toBe('B');
    expect(s(h.back(t('B')))).toBe('A');
    expect(h.back(t('A'))).toBeNull();
    expect(s(h.forward(t('A')))).toBe('B');
    h.record(t('B'));
    expect(h.redo).toEqual([]);
    expect(h.forward(t('X'))).toBeNull();
  });

  it('hält höchstens 100 Schritte', () => {
    const h = new EditHistory();
    for (let i = 0; i < 130; i++) h.record(t(String(i)));
    expect(h.undo.length).toBe(100);
    expect(s(h.undo[0])).toBe('30');
  });
});

describe('Versionsablage', () => {
  it('legt Versionen mit Zeitstempel ab und behält die 50 neuesten', async () => {
    const b = new MemoryVersions();
    const dir = versionDir('zauberturm.tess');
    expect(dir).toBe('zauberturm');
    const start = new Date(2026, 9, 30, 16, 40, 12);
    expect(versionStamp(start)).toBe('2026-10-30_16-40-12');
    for (let i = 0; i < 55; i++) await backupVersion(b, dir, new TextEncoder().encode(`v${i}`), new Date(start.getTime() + i * 1000));
    const list = await listVersions(b, dir);
    expect(list.length).toBe(50);
    expect(list[0]).toBe('2026-10-30_16-41-06.tess');
    expect(list[49]).toBe('2026-10-30_16-40-17.tess');
    expect(new TextDecoder().decode((await b.read(dir, list[0]))!)).toBe('v54');
    expect(versionLabel(list[0])).toBe('30.10.2026, 16:41:06');
  });

  it('verliert keine Version, wenn zwei in derselben Sekunde entstehen', async () => {
    const b = new MemoryVersions();
    const now = new Date(2026, 9, 30, 9, 5, 1);
    const names = [];
    for (const v of ['a', 'b', 'c']) names.push(await backupVersion(b, 'x', new TextEncoder().encode(v), now));
    expect(names).toEqual(['2026-10-30_09-05-01.tess', '2026-10-30_09-05-01_2.tess', '2026-10-30_09-05-01_3.tess']);
    expect(await listVersions(b, 'x')).toEqual([...names].reverse());
  });
});
