import { openBytes } from '../app/importer';
import { examples, showToast, type ExampleFile } from '../app/workspace';
import { log } from '../debug/log';

/**
 * Optional example files next to the app. `examples/index.json` lists them, each either as a
 * URL or embedded as base64 (some hosts serve no binary files):
 *   [{ "label": "Turm", "name": "turm.schem", "file": "examples/turm.schem" }]
 *   [{ "label": "Turm", "name": "turm.schem", "data": "H4sIAAAA…" }]
 * A normal installation has none; hosted test versions bring some along, so the app can be
 * tried without own files.
 */
export async function loadExamples(): Promise<void> {
  try {
    const res = await fetch('examples/index.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const text = await res.text();
    // The dev server answers unknown paths with the app's HTML.
    if (text.trimStart().startsWith('<')) return;
    const list = JSON.parse(text) as unknown;
    if (!Array.isArray(list)) return;
    examples.value = list.flatMap((e): ExampleFile[] => {
      if (typeof e !== 'object' || e === null || typeof e.label !== 'string') return [];
      const file = typeof e.file === 'string' ? e.file : undefined;
      const data = typeof e.data === 'string' ? e.data : undefined;
      if (!file && !data) return [];
      const name = typeof e.name === 'string' ? e.name : (file?.split('/').pop() ?? 'beispiel.schem');
      return [{ label: e.label, name, file, data }];
    });
    if (examples.value.length) log.info('app', `${examples.value.length} Beispieldatei(en) verfügbar`);
  } catch {
    // No examples: the normal case for local installations.
  }
}

function fromBase64(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function openExample(example: ExampleFile): Promise<void> {
  try {
    let bytes: Uint8Array;
    if (example.data) {
      bytes = fromBase64(example.data);
    } else {
      const res = await fetch(example.file!);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    await openBytes(example.name, bytes);
  } catch (e) {
    log.error('import', `Beispiel ${example.name} konnte nicht geladen werden`, e);
    showToast('error', 'Das Beispiel konnte nicht geladen werden.', e instanceof Error ? e.message : String(e));
  }
}
