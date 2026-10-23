/**
 * Block states as stored in schematic palettes, e.g.
 *   "minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]"
 */
export interface BlockState {
  /** Namespaced block id, lower case, e.g. "minecraft:oak_stairs". */
  readonly name: string;
  /** Block state properties. Keys are sorted. */
  readonly props: Readonly<Record<string, string>>;
  /** Canonical state string (namespaced, properties sorted). */
  readonly key: string;
}

export const AIR_NAME = 'minecraft:air';

const AIR_LIKE = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);

export function isAirName(name: string): boolean {
  return AIR_LIKE.has(name);
}

export function normalizeName(raw: string): string {
  const name = raw.trim().toLowerCase();
  return name.includes(':') ? name : `minecraft:${name}`;
}

export function makeState(name: string, props: Record<string, string> = {}): BlockState {
  const sortedKeys = Object.keys(props).sort();
  const sorted: Record<string, string> = {};
  for (const k of sortedKeys) sorted[k] = props[k];
  const key = sortedKeys.length ? `${name}[${sortedKeys.map((k) => `${k}=${sorted[k]}`).join(',')}]` : name;
  return { name, props: sorted, key };
}

/** Parses "ns:id[k=v,...]" (namespace optional). Tolerates whitespace and missing brackets. */
export function parseBlockState(raw: string): BlockState {
  const s = raw.trim();
  const open = s.indexOf('[');
  if (open < 0) return makeState(normalizeName(s));
  const close = s.lastIndexOf(']');
  const name = normalizeName(s.slice(0, open));
  const inner = s.slice(open + 1, close > open ? close : s.length);
  const props: Record<string, string> = {};
  for (const part of inner.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim().toLowerCase();
    const v = part.slice(eq + 1).trim().toLowerCase();
    if (k) props[k] = v;
  }
  return makeState(name, props);
}

/** "minecraft:oak_stairs" -> "oak_stairs" (other namespaces are kept). */
export function shortName(name: string): string {
  return name.startsWith('minecraft:') ? name.slice(10) : name;
}

export function namespaceOf(name: string): string {
  const i = name.indexOf(':');
  return i < 0 ? 'minecraft' : name.slice(0, i);
}
