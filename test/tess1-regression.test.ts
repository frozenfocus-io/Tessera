import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileTess } from '../src/tess/compile';

/**
 * Bau-Sprache 1 stays valid: tess 1 files must give exactly the blocks of version 0.3.0.
 * The hashes below were taken with Tessera 0.3.0 (before Etappe 4): every cell as
 * "x,y,z state", sorted, SHA-256. Do not update them; a difference is a regression.
 */

const HEAD = 'tess 1\nrolle stein stone_bricks\nrolle holz spruce_planks\nrolle glas glass_pane\nrolle rahmen spruce_planks\nrolle tuer spruce_door\n';

function fingerprint(source: string): { hash: string; blocks: number } {
  const out = compileTess(source);
  const cells = out.grid.entries().map(([x, y, z, s]) => `${x},${y},${z} ${s.key}`);
  cells.sort();
  return { hash: createHash('sha256').update(cells.join('\n')).digest('hex'), blocks: cells.length };
}

const CASES: [string, string, number, string][] = [
  ["t_errors", HEAD + "kiste 0,0,0\nbox 0,0,0 2,2,2 unbekannt\nbox 0,0,0 2,2,2 stein farbe=rot\nbox 0,0 1,1,1 stein\nbox 5,0,0 5,0,0 stein", 1, 'b31f39505f2864e733c5bfce2ea8c4404911cf10e5d0c8c29b0af954277f9473'],
  ["t_followup", HEAD + "rolle zier stone:0\nzylinder t 0,0,0 r=3 h=5 stein hohl kranz=zier\nfenster t s y=2\ntür t s\ndach kegel t rolle=stein", 0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ["t_umlaut_a", HEAD + "box haus 0,0,0 4,3,4 stein hohl\ntür haus s", 64, 'f75eb2677e5350e2948116f11fca40285a8178c7d5d6022163d047e5f56329e7'],
  ["t_umlaut_b", HEAD + "box haus 0,0,0 4,3,4 stein hohl\ntuer haus süd", 64, 'f75eb2677e5350e2948116f11fca40285a8178c7d5d6022163d047e5f56329e7'],
  ["t_mix", "tess 1\nrolle m stone_bricks:7 mossy_stone_bricks:2 cracked_stone_bricks:1\nbox 0,0,0 29,0,29 m", 900, '7ea7ff27182eb4ec8ddbb05d13e66fa2adcd01925b73cc15bced226dbed5df9a'],
  ["t_mix_seed", "tess 1\nsamen 99\nrolle m stone_bricks:7 mossy_stone_bricks:2 cracked_stone_bricks:1\nbox 0,0,0 29,0,29 m", 900, 'ad3c0e38a84e362dae20694363a71109c793970005be7714feff0ef1168d0ff1'],
  ["t_mixstairs", "tess 1\nrolle m stone_bricks cracked_stone_bricks\nbox h 0,0,0 4,2,4 m hohl\ndach walm h rolle=m", 97, 'fcdd40a8f18af8265fe6aab1516a91654a07b7b460fc5cceb90b91f6d077ddea'],
  ["t_fachwerk", "tess 1\nrolle w white_terracotta\nrolle b dark_oak_log\nrolle s cobblestone\nbox h 0,0,0 8,4,4 w hohl fachwerk=b sockel=s", 120, '5ccc44b8104c05de2644438f6ff8c3b16fa9418db7d8f33c08f4df8284a0044d'],
  ["t_zyl", "tess 1\nrolle s stone_bricks\nzylinder t 0,0,0 r=4 h=1 s hohl", 24, 'a65a84de34a958afda1bba9e17f637b5a1886003a0df4167b3fc5e2fbca953ec'],
  ["t_clear", "tess 1\nrolle s stone\nbox 0,0,0 6,3,6 s\nbox 0,0,0 6,3,6 s hohl", 96, '19740ba4b2ba5547aaefa7cc03caec4a8c9dc6c9bd0b55f39ea3dad0378ecf6b'],
  ["t_window", HEAD + "rolle laden spruce_trapdoor\nbox h 0,0,0 6,4,4 stein hohl\nfenster h s y=2 x=3 laeden=laden", 105, '69668c42c1e8da6562b75fa0e533fe55c43e632bb21edebb6e3768068fc31dbf'],
  ["t_window_sides", HEAD + "box h 0,0,0 6,4,6 stein hohl\nfenster h n y=2\nfenster h o y=2\nfenster h w y=2", 123, '507faa5b0ed8ce68a47c19a68ad88e6de60fa143620d8477d6c2fe1bb5ef6912'],
  ["t_window_many", HEAD + "box h 0,0,0 12,4,4 stein hohl\nfenster h s y=2 anzahl=3 abstand=4", 163, '52f0c907aa34fc6c4cdd731cc4d17a77765cff572be5102b19230a0a451701a6'],
  ["t_window_warn", "tess 1\nrolle w white_terracotta\nrolle b oak_log\nrolle glas glass\nrolle rahmen oak_planks\nbox h 0,0,0 8,4,4 w hohl fachwerk=b\nfenster h s y=2 x=4\nfenster h s y=2 x=0\nfenster h s y=2 x=20", 122, '62250f62d3f4e55389564ad2fba0f65431ad219bf6c826dfa36b06b4b20d52aa'],
  ["t_doors", HEAD + "box h 0,0,0 6,4,4 stein hohl\ntür h s x=3\nbox g 10,0,0 16,4,4 stein hohl\ntür g s x=12 b=2", 200, '274c204a44ad8367e655a7b68ef8bc12f3e5da0ac8e15fd79aa347edc022c0d7'],
  ["t_sattel", HEAD + "rolle dach spruce_planks\nbox h 0,0,0 6,3,4 stein hohl\ndach sattel h", 169, 'fee87bdcf5ba92575ba4f6b5983aff99e2ba1ed35a1430831f56004c56448128'],
  ["t_walm", HEAD + "rolle dach spruce_planks\nbox h 0,0,0 4,2,4 stein hohl\ndach walm h ueberstand=0", 73, '6226b4249c839c5de769fa8742e18bddfd798c856f9701d383f977713b3f3552'],
  ["t_kegel", HEAD + "rolle dach deepslate_tiles\nzylinder t 0,0,0 r=3 h=5 stein hohl\ndach kegel t spitze=lightning_rod", 219, '3bc26834e2059e4e5865fdfdefd5abe8bc1e5e89df85abdb5af9b29ea0458c72'],
  ["t_fences", "tess 1\nrolle z oak_fence\nrolle s stone\nlinie 0,0,0 3,0,0 z\nblock 4,0,0 s\nblock 0,0,1 z", 6, '17b86847a6d049bc7a72e382d2d6264d202f8aacd813d4c2420216fd7e6cde1e'],
  ["t_walls", "tess 1\nrolle m cobblestone_wall\nrolle s stone\nlinie 0,0,0 4,0,0 m\nblock 2,1,0 s", 6, 'c0cfff384490f07a332b7f2c2257c2001791f0ada58c4550efbf22a3a40450e0'],
  ["t_stairs", "tess 1\nblock 0,0,0 oak_stairs[facing=north]\nblock 1,0,0 oak_stairs[facing=north]\nblock 0,0,1 oak_stairs[facing=west]\nblock 0,0,2 oak_stairs[facing=west]", 4, '50361ee34f4300b418782e0d74ee1100e7e6ea4212bb0612df2561dafb156682'],
  ["t_complete", "tess 1\nblock 0,0,0 oak_door\nblock 2,0,0 lantern\nblock 4,0,0 oak_log", 3, '91712bbffa19000ba7c0027ca4c56acba9e4a61c3f4921061b3023b3f1e8ce94'],
  ["t_extra", HEAD + "rolle m cobblestone_wall\nrolle z oak_fence\nrolle laden oak_trapdoor\nrolle dach stone_bricks\nbox h 0,0,0 8,3,6 stein hohl\nfenster h n y=1 b=2 laeden=laden\ntür h s b=2\ndach walm h\nlinie 0,0,10 6,0,10 m\nlinie 0,0,12 6,0,12 z\nblock 3,1,12 lantern\nblock 7,0,12 oak_fence_gate[facing=east]", 233, '1386b56ffe13217f21e4c38cf9aa6250c6da34abc92b2e6a02ed6b672633f2a3'],
  ["x_sattel_steil", HEAD + "rolle dach dark_oak_planks\nbox a 0,0,0 8,4,5 stein hohl\ndach sattel a steil=2 first=z\nbox b 20,0,0 27,3,7 stein hohl\ndach sattel b steil=3 ueberstand=2 giebel=holz kante=ja\nbox c 40,0,0 45,3,9 stein hohl\ndach sattel c ueberstand=0 kante=nein\nbox d 60,0,0 66,3,5 stein hohl\ndach sattel d steil=1 ueberstand=1 first=z", 1506, '72cd093fd4e0b5127c8dfe1681d1a9d98d3741221d7a1cd0e2a987bd27d76c3a'],
  ["x_walm_steil", HEAD + "rolle dach deepslate_tiles\nbox a 0,0,0 9,3,6 stein hohl\ndach walm a steil=2\nbox b 20,0,0 27,3,7 stein hohl\ndach walm b steil=3 ueberstand=2\nbox c 40,0,0 45,3,5 stein hohl\ndach walm c", 1024, '462477f1da6b8e967c701a4fa28292d64467b25e7a17ff765d264cf3a7b288a6'],
  ["x_kegel", HEAD + "rolle dach deepslate_tiles\nzylinder a 0,0,0 r=2 h=4 stein hohl\ndach kegel a steil=1\nzylinder b 20,0,0 r=5 h=6 stein hohl boden=holz decke=holz sockel=holz kranz=holz\ndach kegel b steil=3 ueberstand=2 spitze=lantern\nzylinder c 40,0,0 r=4 h=3 stein\ndach kegel c ueberstand=0", 1268, '9bf559d0d2094b7766172399ecffc9715fe6b394c7ac9146bfc93b96329d71d0'],
  ["x_zinnen", HEAD + "rolle zier cobblestone\nbox a 0,0,0 7,5,5 stein hohl\nzinnen a\nbox b 20,0,0 26,5,8 stein hohl\nzinnen b zier\nzylinder c 40,0,0 r=4 h=6 stein hohl\nzinnen c\nzylinder d 60,0,0 r=6 h=3 stein hohl\nzinnen d zier", 622, '79479d470ac04f5175434e15ca2be675dd493a492e17136f0d5ac9c636ca85c4'],
  ["x_box_opts", HEAD + "rolle eck oak_log\nrolle b dark_oak_log\nrolle p white_terracotta\nbox a 0,0,0 12,6,9 p hohl boden=holz decke=holz sockel=stein kranz=holz ecken=eck fachwerk=b raster=3\nbox c 20,0,0 26,3,26 p fachwerk=b raster=5\nbox d 40,0,0 44,0,44 stein boden=holz\nbox e 50,0,0 52,2,52 stein boden=holz decke=holz", 1928, '738c216c592a4ff8c610762505aa28c19774abdf07d9779f4b98554e86f88ca5'],
  ["x_windows", HEAD + "rolle laden spruce_trapdoor\nrolle dach spruce_planks\nbox h 0,0,0 14,5,9 stein hohl\nfenster h s y=2 b=2 h=3 anzahl=3 abstand=5 laeden=laden\nfenster h n y=2 x=1 b=3 h=2 bank=nein\nfenster h o y=2 z=2 b=2 sturz=nein\nfenster h w y=3 b=1 h=1 rahmen=stein\ndach sattel h first=x\nfenster h o y=7 b=2 h=1 bank=nein sturz=nein\nzylinder t 30,0,0 r=4 h=10 stein hohl\nfenster t n y=3 b=2\nfenster t s y=3 b=3 laeden=laden\nfenster t o y=6 h=3\nfenster t w y=6 rahmen=stein", 838, 'a5045b8c9d4f9fb8f2088d84e728e4cbd16a37207329bb85873aa2c31144dcb2'],
  ["x_doors", HEAD + "rolle b dark_oak_log\nrolle p white_terracotta\nbox h 0,0,0 10,4,7 p hohl fachwerk=b sockel=stein\ntür h s x=2\ntür h n b=2\ntür h o z=3 rahmen=nein\ntür h w y=2 tuer=tuer rahmen=stein\nzylinder t 30,0,0 r=3 h=6 stein hohl\ntür t s\ntür t n b=2\ntür t o rahmen=holz", 266, 'd984366b4365bc1b78bde2b835feaf9102a010b8177730a01c817fb663c7da16'],
  ["x_linie", HEAD + "rolle b oak_log\nlinie 0,0,0 0,10,0 b\nlinie 0,0,0 10,0,3 b\nlinie 0,0,0 2,5,9 b\nlinie 5,5,5 -3,2,5 stein\nleer 0,0,0\nleer 0,1,0 0,3,0\nblock 3,3,3 holz\nblock 4,4,4 minecraft:oak_stairs[facing=east,half=top]\nblock 5,5,5 create:andesite_casing", 36, '8b41f2aa6bb62a49d7217cfdd29d33e64afc82396470a5f6d2561f2ea15c6460'],
  ["x_overrides", "tess 1\nrolle d white_wool treppe=oak_stairs stufe=oak_slab\nrolle m stone treppe=stone_stairs mauer=cobblestone_wall zaun=oak_fence\nbox h 0,0,0 6,2,5 m hohl\ndach sattel h rolle=d\nbox g 20,0,0 26,2,26 m hohl\ndach walm g rolle=m steil=2\nzinnen g", 920, '040d5444727d8f81c47a00095b5441e304085b7cb707f9bc571e35992c10805c'],
  ["x_mix_roof", "tess 1\nsamen 3\nrolle w stone_bricks:5 mossy_stone_bricks:3 cracked_stone_bricks:2\nrolle d spruce_planks:2 dark_oak_planks:1\nrolle glas glass_pane\nrolle rahmen spruce_planks\nrolle tuer oak_door\nbox h 0,0,0 10,6,8 w hohl\ndach sattel h rolle=d\nfenster h s y=2 anzahl=2 abstand=4\ntür h n\nzylinder t 20,0,0 r=4 h=12 w hohl\ndach kegel t rolle=d", 945, '990c4c3e49fe69b4aa75520bad3feb870f783d1301c0a14defaaa0805b65baf1'],
];

describe('Bau-Sprache 1: blockgenau wie 0.3.0', () => {
  it('beispiele/haus-mit-rundturm.tess', () => {
    const f = fingerprint(readFileSync('beispiele/haus-mit-rundturm.tess', 'utf8'));
    expect(f.blocks).toBe(826);
    expect(f.hash).toBe('68b3d7d8ddee3d6b1b981fd9dd033e23d85b325c7cf33394fee7be26579f53c8');
  });

  it.each(CASES)('%s', (_name, source, blocks, hash) => {
    const f = fingerprint(source);
    expect(f.blocks).toBe(blocks);
    expect(f.hash).toBe(hash);
  });
});
