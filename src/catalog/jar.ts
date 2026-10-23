import { strFromU8, unzipSync } from 'fflate';

/**
 * Reading the parts of a Minecraft or mod jar that the catalog needs. A jar is a ZIP archive;
 * only resource files are read and nothing in it is executed.
 */

export interface JarFiles {
  /** File name of the jar (for messages). */
  name: string;
  /** Wanted entries by path. */
  files: Map<string, Uint8Array>;
}

const WANTED = [
  /^assets\/[^/]+\/blockstates\/.+\.json$/,
  /^assets\/[^/]+\/lang\/(de_de|en_us)\.json$/,
  /^data\/[^/]+\/tags\/(block|blocks|item|items)\/.+\.json$/,
  /^data\/[^/]+\/(recipe|recipes)\/.+\.json$/,
  /^data\/[^/]+\/loot_table\/blocks\/.+\.json$/,
  /^data\/[^/]+\/loot_tables\/blocks\/.+\.json$/,
  /^META-INF\/(neoforge\.)?mods\.toml$/,
  /^fabric\.mod\.json$/,
  /^version\.json$/,
];

/** Models and textures can live in any folder ("modid:custom/thing"): read all of them … */
const MODEL_ANY = /^assets\/[^/]+\/models\/.+\.json$/;
const TEXTURE_ANY = /^assets\/[^/]+\/textures\/.+\.png$/;
/** … except texture folders that never belong to blocks. */
const TEXTURE_SKIP = /^assets\/[^/]+\/textures\/(gui|entity|particle|painting|mob_effect|environment|font|map|misc|models|trims|effect|colormap|armor|shaders?)\//;
const NESTED_JAR = /^META-INF\/jarjar\/[^/]+\.jar$/;

export function isWanted(path: string): boolean {
  if (MODEL_ANY.test(path)) return true;
  if (TEXTURE_ANY.test(path)) return !TEXTURE_SKIP.test(path);
  return WANTED.some((r) => r.test(path));
}

/**
 * Extracts the wanted entries of a jar, including jars nested by NeoForge's jar-in-jar
 * (META-INF/jarjar), which sometimes carry blocks of their own.
 */
export function readJar(name: string, bytes: Uint8Array, depth = 0): JarFiles[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: (f) => isWanted(f.name) || (depth < 2 && NESTED_JAR.test(f.name)) });
  } catch (e) {
    throw new Error(`${name} ist kein gültiges Jar-/ZIP-Archiv: ${e instanceof Error ? e.message : String(e)}`);
  }
  const files = new Map<string, Uint8Array>();
  const nested: JarFiles[] = [];
  for (const [path, data] of Object.entries(entries)) {
    if (NESTED_JAR.test(path)) {
      try {
        for (const inner of readJar(`${name}!/${path.slice('META-INF/jarjar/'.length)}`, data, depth + 1)) {
          if (inner.files.size > 0) nested.push(inner);
        }
      } catch {
        // A broken nested library is not worth failing the whole jar for.
      }
      continue;
    }
    files.set(path, data);
  }
  return [{ name, files }, ...nested];
}

export function text(data: Uint8Array): string {
  // Strip a UTF-8 byte order mark, which some mods leave in their JSON files.
  const s = strFromU8(data);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Lenient JSON: some mod files contain comments or trailing commas. */
export function parseJson(data: Uint8Array): unknown {
  const s = text(data);
  try {
    return JSON.parse(s);
  } catch {
    return JSON.parse(stripJsonComments(s).replace(/,\s*([}\]])/g, '$1'));
  }
}

function stripJsonComments(s: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      out += c;
      if (c === '\\') out += s[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

export interface ModInfo {
  modId: string;
  displayName: string;
  version: string;
}

/** Mod ids and names from META-INF/neoforge.mods.toml (or mods.toml / fabric.mod.json). */
export function readModInfo(jar: JarFiles): ModInfo[] {
  const toml = jar.files.get('META-INF/neoforge.mods.toml') ?? jar.files.get('META-INF/mods.toml');
  if (toml) return parseModsToml(text(toml));
  const fabric = jar.files.get('fabric.mod.json');
  if (fabric) {
    try {
      const j = parseJson(fabric) as { id?: string; name?: string; version?: string };
      if (j.id) return [{ modId: j.id, displayName: j.name ?? j.id, version: j.version ?? '' }];
    } catch {
      // fall through
    }
  }
  return [];
}

/** Just enough TOML for the [[mods]] tables of mods.toml. */
export function parseModsToml(src: string): ModInfo[] {
  const mods: ModInfo[] = [];
  let current: Record<string, string> | null = null;
  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('[[')) {
      if (current) mods.push(toInfo(current));
      current = /^\[\[\s*mods\s*\]\]/.test(line) ? {} : null;
      continue;
    }
    if (line.startsWith('[')) {
      if (current) mods.push(toInfo(current));
      current = null;
      continue;
    }
    if (!current) continue;
    const m = /^([A-Za-z0-9_]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(line);
    if (m) current[m[1]] = m[2] ?? m[3] ?? '';
  }
  if (current) mods.push(toInfo(current));
  return mods.filter((m) => m.modId);
}

function toInfo(t: Record<string, string>): ModInfo {
  return { modId: t.modId ?? '', displayName: t.displayName ?? t.modId ?? '', version: t.version ?? '' };
}
