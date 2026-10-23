import type { Applied, CatalogStates, Condition } from './types';

/**
 * Blockstate files: which model a block uses in which state. Parsing happens once during the
 * import; matching a concrete state happens whenever a project builds its block model.
 */

interface RawApply {
  model?: string;
  x?: number;
  y?: number;
  weight?: number;
}

/** Normalises 0/90/180/270 (and odd values) to quarter turns 0..3. */
function quarter(v: unknown): number {
  const n = typeof v === 'number' ? v : 0;
  return (((Math.round(n / 90) % 4) + 4) % 4) as number;
}

function firstApply(v: RawApply | RawApply[] | undefined): RawApply | null {
  if (!v) return null;
  if (Array.isArray(v)) {
    // Weighted random models (stone, grass): any of them stands for the block.
    return v.find((a) => a && typeof a.model === 'string') ?? null;
  }
  return typeof v.model === 'string' ? v : null;
}

export function parseBlockstate(json: unknown, resolveModel: (id: string) => number): CatalogStates | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as { variants?: Record<string, RawApply | RawApply[]>; multipart?: { when?: Condition; apply?: RawApply | RawApply[] }[] };
  if (j.variants && typeof j.variants === 'object') {
    const variants: [string, Applied][] = [];
    for (const [key, value] of Object.entries(j.variants)) {
      const a = firstApply(value);
      if (!a) continue;
      variants.push([key, [resolveModel(a.model!), quarter(a.x), quarter(a.y)]]);
    }
    return variants.length ? { variants } : null;
  }
  if (Array.isArray(j.multipart)) {
    const multipart: [Condition | null, Applied][] = [];
    for (const part of j.multipart) {
      const a = firstApply(part?.apply);
      if (!a) continue;
      multipart.push([part.when ?? null, [resolveModel(a.model!), quarter(a.x), quarter(a.y)]]);
    }
    return multipart.length ? { multipart } : null;
  }
  return null;
}

/** Does a variant key ("facing=east,half=top") match the given properties? "" matches all. */
export function matchKey(key: string, props: Readonly<Record<string, string>>): boolean {
  if (key === '' || key === 'normal') return true;
  for (const pair of key.split(',')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (props[k] !== undefined && props[k] !== v) return false;
  }
  return true;
}

export function matchCondition(cond: Condition | null, props: Readonly<Record<string, string>>): boolean {
  if (!cond) return true;
  if ('OR' in cond && Array.isArray(cond.OR)) return cond.OR.some((c) => matchCondition(c, props));
  if ('AND' in cond && Array.isArray(cond.AND)) return cond.AND.every((c) => matchCondition(c, props));
  for (const [k, v] of Object.entries(cond as Record<string, string>)) {
    const actual = props[k];
    if (actual === undefined) continue;
    if (!String(v).split('|').includes(actual)) return false;
  }
  return true;
}

/** The models drawn for a block in the given state. */
export function appliedFor(states: CatalogStates, props: Readonly<Record<string, string>>): Applied[] {
  if ('variants' in states) {
    // The most specific matching key wins (vanilla keys are disjoint; mods are not always).
    let best: Applied | null = null;
    let bestScore = -1;
    for (const [key, applied] of states.variants) {
      if (!matchKey(key, props)) continue;
      const score = key === '' ? 0 : key.split(',').length;
      if (score > bestScore) {
        best = applied;
        bestScore = score;
      }
    }
    return best ? [best] : [states.variants[0][1]];
  }
  const out: Applied[] = [];
  for (const [when, applied] of states.multipart) if (matchCondition(when, props)) out.push(applied);
  return out;
}

// ---- rotations (Minecraft order: first x, then y; 90° steps)

/** Rotates boxes (6 ints each, 0..16) by x then y quarter turns. */
export function rotateBoxes(boxes: readonly number[], x: number, y: number): number[] {
  const out = boxes.slice();
  for (let i = 0; i < out.length; i += 6) {
    let [x0, y0, z0, x1, y1, z1] = out.slice(i, i + 6);
    for (let r = 0; r < x; r++) {
      // up -> north: y' = z, z' = 16 - y
      [y0, y1, z0, z1] = [z0, z1, 16 - y1, 16 - y0];
    }
    for (let r = 0; r < y; r++) {
      // north -> east: x' = 16 - z, z' = x
      [x0, x1, z0, z1] = [16 - z1, 16 - z0, x0, x1];
    }
    out.splice(i, 6, x0, y0, z0, x1, y1, z1);
  }
  return out;
}

/** Face order: 0 east, 1 west, 2 up, 3 down, 4 south, 5 north. */
export function rotateFaces<T>(faces: readonly T[], x: number, y: number): T[] {
  let f = faces.slice();
  for (let r = 0; r < x; r++) {
    // up -> north, north -> down, down -> south, south -> up
    f = [f[0], f[1], f[4], f[5], f[3], f[2]];
  }
  for (let r = 0; r < y; r++) {
    // north -> east, east -> south, south -> west, west -> north
    f = [f[5], f[4], f[2], f[3], f[0], f[1]];
  }
  return f;
}
