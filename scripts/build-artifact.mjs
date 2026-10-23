#!/usr/bin/env node
/**
 * Prepares the built app (dist/) for publishing as a claude.ai artifact.
 *
 * The artifact host wraps the page in its own document skeleton and serves further files next
 * to it, so the output is:
 *   page.html      the page content without doctype/head/body
 *   assets/…       scripts, workers, styles and fonts (without source maps)
 *   examples/      optional examples/index.json with the example files embedded (see src/platform/examples.ts)
 *   katalog.json   optional test catalog, used while no catalog has been read (see app/catalogState.ts)
 *   files.json     published path -> source path, for the Artifact tool's `files`
 *   index.html     page.html inside a skeleton like the host's, for local tests
 *
 * Usage: node scripts/build-artifact.mjs --out <dir> [--example <file>=<label> …] [--catalog <katalog.json>]
 * Run `npm run build` first (or use `npm run build:artifact -- --out <dir>`).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
let out = null;
let catalog = null;
const examples = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') {
    out = resolve(args[++i]);
  } else if (args[i] === '--catalog') {
    catalog = resolve(args[++i]);
  } else if (args[i] === '--example') {
    const spec = args[++i] ?? '';
    const eq = spec.indexOf('=');
    const file = resolve(eq < 0 ? spec : spec.slice(0, eq));
    examples.push({ file, label: eq < 0 ? basename(file) : spec.slice(eq + 1) });
  } else {
    console.error(`Unbekanntes Argument: ${args[i]}`);
    process.exit(1);
  }
}
if (!out) {
  console.error('Aufruf: node scripts/build-artifact.mjs --out <ordner> [--example <datei>=<name> …]');
  process.exit(1);
}

const dist = resolve('dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html fehlt – zuerst `npm run build` ausführen.');
  process.exit(1);
}
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const script = html.match(/<script type="module"[^>]*\ssrc="\.\/(assets\/[^"]+\.js)"/)?.[1];
const stylesheet = html.match(/<link rel="stylesheet"[^>]*\shref="\.\/(assets\/[^"]+\.css)"/)?.[1];
if (!script || !stylesheet) {
  console.error('dist/index.html: Skript oder Stylesheet nicht gefunden.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });
const files = {};
let bytes = 0;
for (const name of readdirSync(join(dist, 'assets'))) {
  if (name.endsWith('.map')) continue;
  const target = join(out, 'assets', name);
  copyFileSync(join(dist, 'assets', name), target);
  files[`assets/${name}`] = target;
  bytes += readFileSync(target).length;
}

if (examples.length) {
  // Embedded as base64: the artifact host serves no binary files of unknown type.
  mkdirSync(join(out, 'examples'), { recursive: true });
  const list = examples.map(({ file, label }) => ({ label, name: basename(file), data: readFileSync(file).toString('base64') }));
  const index = join(out, 'examples', 'index.json');
  writeFileSync(index, JSON.stringify(list, null, 2) + '\n');
  files['examples/index.json'] = index;
  bytes += readFileSync(index).length;
}

if (catalog) {
  const target = join(out, 'katalog.json');
  copyFileSync(catalog, target);
  files['katalog.json'] = target;
  bytes += readFileSync(target).length;
}

// Tells the app that example files and a test catalog may lie next to it (normal builds do not look).
const page = `<title>Tessera</title>
<meta name="tessera-extras" content="1">
<style>:root{color-scheme:dark;background:#171b20}</style>
<link rel="stylesheet" href="${stylesheet}">
<div id="app"></div>
<noscript>Tessera braucht JavaScript.</noscript>
<script type="module" src="${script}"></script>
`;
writeFileSync(join(out, 'page.html'), page);

// Local preview: the same page inside a skeleton like the one the artifact host adds.
const skeleton =
  '<!doctype html><html><head><meta charset=utf8>' +
  '<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}' +
  'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>' +
  '</head><body>';
writeFileSync(join(out, 'index.html'), `${skeleton}${page}</body></html>\n`);
writeFileSync(join(out, 'files.json'), JSON.stringify(files, null, 2) + '\n');

console.log(`Artefakt-Version in ${out}: ${Object.keys(files).length} Dateien, ${(bytes / 1024).toFixed(0)} KB`);
