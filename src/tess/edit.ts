import type { RoleMeta } from './compile';
import { asciiKey } from './syntax';
import { Xf } from './xform';

/**
 * Editing a building plan from the app (Etappe 4c). Every change is a small change of the file
 * text: the rest of the file, comments and layout included, stays exactly as it was.
 *
 * - Palette swap: one sort of a `rolle` statement gets another block; the weight stays.
 * - Turning and mirroring the whole plan: the `ausrichtung` line is added, changed or removed.
 * - Single blocks: `block` and `leer` lines in a section at the end of the file; a later change
 *   of the same cell replaces the earlier line.
 */

export const EDIT_MARKER = '# ---- Änderungen in Tessera ----';

interface Span {
  start: number;
  end: number;
  text: string;
}

/** Tokens of one physical line before its comment, with their positions. */
function spans(line: string): Span[] {
  const out: Span[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '#') break;
    const start = i;
    let square = 0;
    let curly = 0;
    let quoted = false;
    while (i < n) {
      const ch = line[i];
      if (ch === '"') quoted = !quoted;
      else if (!quoted) {
        if (ch === '[') square++;
        else if (ch === ']') square = Math.max(0, square - 1);
        else if (ch === '{') curly++;
        else if (ch === '}') curly = Math.max(0, curly - 1);
        else if (square === 0 && curly === 0 && (ch === ' ' || ch === '\t' || ch === '\r' || ch === '#')) break;
      }
      i++;
    }
    out.push({ start, end: i, text: line.slice(start, i) });
  }
  return out;
}

interface Lines {
  lines: string[];
  eol: string;
}

function split(source: string): Lines {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  return { lines: source.split(/\r?\n/), eol };
}

function join(l: Lines): string {
  return l.lines.join(l.eol);
}

/** Block id as written in plans: without the minecraft: namespace. */
export function shortId(id: string): string {
  return id.startsWith('minecraft:') ? id.slice(10) : id;
}

/**
 * Replaces sort `index` of a role by another block; the weight (`:6`) stays. Only the token of
 * that sort changes. Throws when the line does not look as the compiler saw it.
 */
export function replaceRoleSort(source: string, role: RoleMeta, index: number, newId: string): string {
  const l = split(source);
  const found: { line: number; span: Span }[] = [];
  for (let i = role.line - 1; i < Math.min(role.lastLine, l.lines.length); i++) {
    for (const s of spans(l.lines[i])) {
      if (s.text === '\\') continue;
      found.push({ line: i, span: s.text.endsWith('\\') ? { ...s, end: s.end - 1, text: s.text.slice(0, -1) } : s });
    }
  }
  // rolle <name> <sorts …> [<glied>=… muster=…]
  if (found.length < 2 || asciiKey(found[0].span.text) !== 'rolle' || asciiKey(found[1].span.text) !== role.name) throw new Error(`Zeile ${role.line} ist nicht mehr die Rolle „${role.name}“.`);
  const sorts = found.slice(2).filter((f) => !f.span.text.includes('='));
  const hit = sorts[index];
  if (!hit || hit.span.text !== role.sorts[index]?.text) throw new Error(`Die Rolle „${role.name}“ in Zeile ${role.line} hat sich geändert.`);
  const weight = /^(.+):(\d+)$/.exec(hit.span.text);
  const next = shortId(newId) + (weight ? `:${weight[2]}` : '');
  const text = l.lines[hit.line];
  l.lines[hit.line] = text.slice(0, hit.span.start) + next + text.slice(hit.span.end);
  return join(l);
}

/** The orientation after turning (90° clockwise) or mirroring the current one. */
export function composeOrient(cur: { turn: number; mirror: 'x' | 'z' | null }, op: 'turn' | 'x' | 'z'): { turn: number; mirror: 'x' | null } {
  const now = Xf.of(cur.turn, cur.mirror);
  const step = op === 'turn' ? Xf.of(90, null) : Xf.of(0, op);
  const next = step.then(now);
  for (const mirror of [null, 'x'] as const) {
    for (const turn of [0, 90, 180, 270]) {
      const c = Xf.of(turn, mirror);
      if (c.a === next.a && c.b === next.b && c.c === next.c && c.d === next.d) return { turn, mirror };
    }
  }
  return { turn: 0, mirror: null };
}

export function orientText(o: { turn: number; mirror: 'x' | 'z' | null }): string | null {
  if (!o.turn && !o.mirror) return null;
  return `ausrichtung${o.turn ? ` drehung=${o.turn}` : ''}${o.mirror ? ` spiegel=${o.mirror}` : ''}`;
}

/**
 * Writes the `ausrichtung` of the file: changes its line (a comment behind it stays), removes it
 * when nothing is turned, or adds it below the head (tess, projekt, samen).
 */
export function setOrientation(source: string, line: number, o: { turn: number; mirror: 'x' | 'z' | null }): string {
  const l = split(source);
  const text = orientText(o);
  if (line > 0 && line <= l.lines.length) {
    const old = l.lines[line - 1];
    const s = spans(old);
    const end = s.length ? s[s.length - 1].end : 0;
    const indent = /^\s*/.exec(old)![0];
    if (text) l.lines[line - 1] = indent + text + old.slice(end);
    else {
      const rest = old.slice(end).trim();
      if (rest) l.lines[line - 1] = indent + rest;
      else l.lines.splice(line - 1, 1);
    }
    return join(l);
  }
  if (!text) return source;
  let at = -1;
  for (let i = 0; i < l.lines.length; i++) {
    const s = spans(l.lines[i]);
    if (!s.length) {
      if (at >= 0 && l.lines[i].trim() === '') break;
      continue;
    }
    const cmd = asciiKey(s[0].text);
    if (cmd === 'tess' || (at >= 0 && (cmd === 'projekt' || cmd === 'samen'))) at = i;
    else break;
  }
  l.lines.splice(at + 1, 0, text);
  return join(l);
}

/** A changed cell: `block x,y,z <id>[…]` or `leer x,y,z` (null: remove its line). */
export function cellLine(x: number, y: number, z: number, state: { name: string; props: Readonly<Record<string, string>> } | null): string {
  if (!state) return `leer ${x},${y},${z}`;
  const props = Object.entries(state.props);
  return `block ${x},${y},${z} ${shortId(state.name)}${props.length ? `[${props.map(([k, v]) => `${k}=${v}`).join(',')}]` : ''}`;
}

const CELL_LINE = /^\s*(block|leer)\s+(-?\d+),(-?\d+),(-?\d+)(\s|$|#)/i;

/**
 * Puts a line for one cell into the section "Änderungen in Tessera" at the end of the file. A
 * line for the same cell there is replaced (or removed with `line = null`).
 */
export function setCellEdit(source: string, x: number, y: number, z: number, line: string | null): string {
  const l = split(source);
  const marker = l.lines.findIndex((t) => t.trim() === EDIT_MARKER);
  if (marker >= 0) {
    for (let i = marker + 1; i < l.lines.length; i++) {
      const m = CELL_LINE.exec(l.lines[i]);
      if (m && +m[2] === x && +m[3] === y && +m[4] === z) {
        if (line === null) l.lines.splice(i, 1);
        else l.lines[i] = line;
        return join(l);
      }
    }
  }
  if (line === null) return source;
  // Append (before trailing empty lines, which stay at the end).
  let end = l.lines.length;
  while (end > 0 && l.lines[end - 1].trim() === '') end--;
  const add = marker >= 0 ? [line] : [...(end > 0 ? [''] : []), EDIT_MARKER, line];
  l.lines.splice(end, 0, ...add);
  return join(l);
}
