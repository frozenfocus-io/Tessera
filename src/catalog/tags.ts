/**
 * Tags (data/<ns>/tags/block|item/…): named groups of blocks or items. Mods add to vanilla
 * tags, so files with the same tag id are merged in load order unless one says "replace".
 */

export type TagKind = 'block' | 'item';

interface RawTag {
  replace?: boolean;
  values?: (string | { id?: string; required?: boolean })[];
}

export class TagCollector {
  private raw: Record<TagKind, Map<string, string[]>> = { block: new Map(), item: new Map() };

  /** path: data/<ns>/tags/<kind>/<path>.json */
  add(path: string, json: unknown): void {
    const m = /^data\/([^/]+)\/tags\/(block|blocks|item|items)\/(.+)\.json$/.exec(path);
    if (!m || !json || typeof json !== 'object') return;
    const kind: TagKind = m[2].startsWith('block') ? 'block' : 'item';
    const id = `${m[1]}:${m[3]}`;
    const t = json as RawTag;
    const values = (t.values ?? [])
      .map((v) => (typeof v === 'string' ? v : typeof v?.id === 'string' ? v.id : null))
      .filter((v): v is string => !!v);
    const map = this.raw[kind];
    const prev = t.replace ? [] : (map.get(id) ?? []);
    map.set(id, [...prev, ...values]);
  }

  /** All tags of a kind, with nested tags expanded. */
  resolveAll(kind: TagKind): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const map = this.raw[kind];
    const expand = (id: string, stack: Set<string>): string[] => {
      if (out[id]) return out[id];
      const values = map.get(id);
      if (!values) return [];
      if (stack.has(id)) return [];
      stack.add(id);
      const set = new Set<string>();
      for (const v of values) {
        if (v.startsWith('#')) for (const x of expand(normalize(v.slice(1)), stack)) set.add(x);
        else set.add(normalize(v));
      }
      stack.delete(id);
      out[id] = [...set];
      return out[id];
    };
    for (const id of map.keys()) expand(id, new Set());
    return out;
  }
}

function normalize(id: string): string {
  return id.includes(':') ? id : `minecraft:${id}`;
}
