/**
 * Finding the right files in the folders the user picks. Launchers lay out their files
 * differently; Tessera looks for what it needs instead of expecting one layout.
 *
 *   CurseForge  curseforge/minecraft/Install/versions/1.21.1/1.21.1.jar, …/Install/assets
 *   Vanilla     .minecraft/versions/1.21.1/1.21.1.jar, .minecraft/assets
 *   Modrinth    com.modrinth.theseus/meta/versions/1.21.1/1.21.1.jar, …/meta/assets
 *   Prism       PrismLauncher/libraries/com/mojang/minecraft/1.21.1/minecraft-1.21.1-client.jar, …/assets
 *
 * NeoForge itself sits in libraries/net/neoforged/neoforge/<version>/neoforge-<version>-universal.jar.
 * It brings the common tags (c:ingots/iron, …) that mod recipes use, and its own versions of
 * some vanilla recipes.
 */

/** A picked file with its path inside the picked folder ("Install/versions/1.21.1/1.21.1.jar"). */
export interface PickedFile {
  path: string;
  file: File;
}

export const TARGET_VERSION = '1.21.1';

export interface MinecraftFiles {
  jar: PickedFile | null;
  version: string | null;
  languageDe: PickedFile | null;
  /** NeoForge's own jar, if it is in the picked folder. */
  loader: PickedFile | null;
  loaderVersion: string | null;
  notes: string[];
}

function norm(p: string): string {
  return p.replace(/\\/g, '/');
}

function versionOfJar(path: string): string | null {
  const p = norm(path);
  let m = /(?:^|\/)versions\/([^/]+)\/\1\.jar$/.exec(p);
  if (m) return m[1];
  m = /(?:^|\/)libraries\/com\/mojang\/minecraft\/([^/]+)\/minecraft-\1-client\.jar$/.exec(p);
  if (m) return m[1];
  m = /(?:^|\/)(\d+\.\d+(?:\.\d+)?)\.jar$/.exec(p);
  return m ? m[1] : null;
}

/** Version ordering for picking the best candidate: exact target first, then newest 1.21.x. */
function score(v: string): number {
  if (v === TARGET_VERSION) return 1e9;
  const parts = v.split('.').map((x) => parseInt(x, 10) || 0);
  return (parts[0] ?? 0) * 1e6 + (parts[1] ?? 0) * 1e3 + (parts[2] ?? 0);
}

export async function findMinecraftFiles(files: readonly PickedFile[]): Promise<MinecraftFiles> {
  const notes: string[] = [];
  const jars = files
    .map((f) => ({ f, v: versionOfJar(f.path) }))
    .filter((x): x is { f: PickedFile; v: string } => !!x.v && /^1\.\d+/.test(x.v) && !/forge|fabric|quilt|optifine/i.test(x.f.path));
  jars.sort((a, b) => score(b.v) - score(a.v));
  const jar = jars[0]?.f ?? null;
  const version = jars[0]?.v ?? null;
  if (!jar) notes.push(`Keine Minecraft-Jar gefunden. Gesucht wurde versions/${TARGET_VERSION}/${TARGET_VERSION}.jar.`);
  else if (version !== TARGET_VERSION) notes.push(`Gefunden wurde Minecraft ${version}, nicht ${TARGET_VERSION}. Blöcke können abweichen.`);

  // German names: assets/indexes/<id>.json maps "minecraft/lang/de_de.json" to an object file.
  let languageDe: PickedFile | null = null;
  const byPath = new Map(files.map((f) => [norm(f.path), f]));
  let indexId: string | null = null;
  if (version) {
    const vjson = files.find((f) => norm(f.path).endsWith(`versions/${version}/${version}.json`));
    if (vjson) {
      try {
        indexId = (JSON.parse(await vjson.file.text()) as { assetIndex?: { id?: string } }).assetIndex?.id ?? null;
      } catch {
        indexId = null;
      }
    }
  }
  const indexes = files.filter((f) => /(?:^|\/)assets\/indexes\/[^/]+\.json$/.test(norm(f.path)));
  indexes.sort((a, b) => (indexId && norm(a.path).endsWith(`/${indexId}.json`) ? -1 : indexId && norm(b.path).endsWith(`/${indexId}.json`) ? 1 : b.file.lastModified - a.file.lastModified));
  for (const idx of indexes) {
    try {
      const j = JSON.parse(await idx.file.text()) as { objects?: Record<string, { hash?: string }> };
      const hash = j.objects?.['minecraft/lang/de_de.json']?.hash;
      if (!hash) continue;
      const base = norm(idx.path).replace(/indexes\/[^/]+\.json$/, '');
      const obj = byPath.get(`${base}objects/${hash.slice(0, 2)}/${hash}`);
      if (obj) {
        languageDe = obj;
        break;
      }
    } catch {
      // next index
    }
  }
  if (jar && !languageDe) notes.push('Deutsche Namen für Vanilla-Blöcke nicht gefunden (Ordner „assets“ fehlt). Es werden die englischen verwendet.');
  const loader = findNeoForge(files, version ?? TARGET_VERSION);
  return { jar, version, languageDe, loader: loader?.file ?? null, loaderVersion: loader?.version ?? null, notes };
}

/**
 * NeoForge versions follow the Minecraft version: 21.1.x belongs to Minecraft 1.21.1. Of the
 * matching ones the newest is taken; one for another Minecraft version would bring wrong recipes.
 */
export function findNeoForge(files: readonly PickedFile[], minecraft: string): { file: PickedFile; version: string } | null {
  const [, minor = '0', patch = '0'] = minecraft.split('.');
  const prefix = `${minor}.${patch}.`;
  let best: { file: PickedFile; version: string; n: number } | null = null;
  for (const f of files) {
    const m = /(?:^|\/)neoforge-(\d+\.\d+\.\d+)(?:-[a-z]+)?-universal\.jar$/i.exec(norm(f.path));
    if (!m || !m[1].startsWith(prefix)) continue;
    const n = parseInt(m[1].slice(prefix.length), 10) || 0;
    if (!best || n > best.n) best = { file: f, version: m[1], n };
  }
  return best ? { file: best.file, version: best.version } : null;
}

export interface ModFiles {
  mods: PickedFile[];
  disabled: number;
}

export function findModFiles(files: readonly PickedFile[]): ModFiles {
  const mods: PickedFile[] = [];
  let disabled = 0;
  for (const f of files) {
    const p = norm(f.path).toLowerCase();
    if (p.endsWith('.jar.disabled')) disabled++;
    else if (p.endsWith('.jar') && !/(^|\/)\.[^/]+\//.test(p)) mods.push(f);
  }
  mods.sort((a, b) => a.path.localeCompare(b.path));
  return { mods, disabled };
}

/** Picked files from an <input type=file> (with or without webkitdirectory). */
export function pickedFromInput(list: FileList | File[]): PickedFile[] {
  return Array.from(list).map((file) => ({ file, path: norm((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name) }));
}
