#!/usr/bin/env node
/**
 * Screenshots of a building plan from several directions, for checking target buildings.
 *
 * Starts the built app (dist/, so run `npm run build` first) with `vite preview` inside this
 * process, opens the file in headless Chromium (Playwright, WebGL via SwiftShader), sets the
 * camera with window.__tessera.camera and saves one PNG per direction.
 *
 * Usage: node scripts/fotos.mjs <datei.tess> [--out <ordner>] [--ansichten sw,so,no,nw,s,w,o,n,oben]
 *                               [--abstand 1.0] [--hoehe 0.45] [--groesse 1200x900] [--ziel x,y,z]
 *   --ansichten  camera positions by compass direction (the camera stands there and looks at the
 *                model); "oben" looks straight down. Default: sw,so,no,nw
 *   --abstand    distance factor (smaller = closer), --hoehe camera elevation as a fraction
 *   --ziel       look at this block (world coordinates as in the file) instead of the centre
 *
 * Playwright: uses a local or global installation (`npm i --no-save playwright` and
 * `npx playwright install chromium` if missing). Output: <ordner>/<name>-<ansicht>.png
 */
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { preview } from 'vite';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
if (!file) {
  console.error('Aufruf: node scripts/fotos.mjs <datei.tess> [--out <ordner>] [--ansichten sw,so,no,nw] [--abstand 1] [--hoehe 0.45] [--ziel x,y,z]');
  process.exit(1);
}
const outDir = resolve(opt('out', 'fotos'));
const views = opt('ansichten', 'sw,so,no,nw').split(',');
const factor = Number(opt('abstand', '1'));
const lift = Number(opt('hoehe', '0.45'));
const [width, height] = opt('groesse', '1200x900').split('x').map(Number);
const aim = opt('ziel', null)?.split(',').map(Number) ?? null;
mkdirSync(outDir, { recursive: true });

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try {
    return req('playwright');
  } catch {
    const global = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(`${global}/`)('playwright');
  }
}
const { chromium } = loadPlaywright();

const root = resolve(new URL('..', import.meta.url).pathname);
const server = await preview({ root, preview: { port: 4173, strictPort: false, open: false }, logLevel: 'error' });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => console.error('Seitenfehler:', e.message));
  await page.goto(url);
  await page.waitForFunction(() => !!window.__tessera);
  await page.setInputFiles('input[type=file]', resolve(file));
  await page.waitForFunction(
    () => {
      const s = window.__tessera.status();
      const p = s.projects.find((q) => q.id === s.active);
      return !!p?.scene?.done;
    },
    null,
    { timeout: 60000 },
  );
  const p = await page.evaluate(() => {
    const s = window.__tessera.status();
    return s.projects.find((q) => q.id === s.active);
  });
  const b = p.bounds;
  const off = p.offset;
  const c = aim ? [aim[0] - off[0] + 0.5, aim[1] - off[1] + 0.5, aim[2] - off[2] + 0.5] : [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2];
  const r = Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) / 2;
  const dist = r * 2.3 * factor;
  const DIRS = { n: [0, -1], o: [1, 0], s: [0, 1], w: [-1, 0], no: [1, -1], so: [1, 1], sw: [-1, 1], nw: [-1, -1] };
  const canvas = page.locator('canvas.viewer-canvas');
  for (const v of views) {
    let pos;
    if (v === 'oben') pos = [c[0], c[1] + dist, c[2] + 0.01];
    else {
      const d = DIRS[v];
      if (!d) throw new Error(`Unbekannte Ansicht: ${v}`);
      const len = Math.hypot(d[0], d[1]);
      const flat = dist * Math.cos(Math.asin(Math.min(0.95, lift)));
      pos = [c[0] + (d[0] / len) * flat, c[1] + dist * lift, c[2] + (d[1] / len) * flat];
    }
    await page.evaluate(([pp, tt]) => window.__tessera.camera(pp, tt), [pos, c]);
    await page.waitForTimeout(400);
    const target = `${outDir}/${basename(file, '.tess')}-${v}.png`;
    await canvas.screenshot({ path: target });
    console.log(target);
  }
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
