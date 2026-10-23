/**
 * Tokenizer for the building language (.tess). The language is line based: one statement per
 * line, `#` starts a comment. A statement is a command word followed by tokens:
 *
 *   box haus 0,0,0 8,5,6 mauer hohl boden=boden
 *
 * Token kinds: words (names, roles, block ids incl. `[props]`), numbers, coordinates (`x,y,z`
 * or `x,z`), strings in double quotes and `key=value` pairs. Keys and commands may be written
 * with umlauts or their ASCII spelling (`tür` = `tuer`, `überstand` = `ueberstand`).
 */

export type Token =
  | { kind: 'word'; text: string; col: number }
  | { kind: 'number'; value: number; text: string; col: number }
  | { kind: 'coord'; values: number[]; text: string; col: number }
  | { kind: 'string'; text: string; col: number }
  | { kind: 'pair'; key: string; value: string; text: string; col: number };

export interface Statement {
  /** 1-based line number. */
  line: number;
  /** Command word, normalised (lower case, ASCII umlauts). */
  cmd: string;
  args: Token[];
}

export interface Diagnostic {
  line: number;
  level: 'error' | 'warn';
  message: string;
}

/** An error inside one statement; the compiler records it and continues with the next line. */
export class TessError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(message);
    this.name = 'TessError';
  }
}

/** "Tür" -> "tuer", "Überstand" -> "ueberstand". */
/**
 * A statement refers to a role or form whose own line already failed. That error is reported
 * once; the follow-up statements are skipped silently instead of repeating it.
 */
export class FollowUpError extends TessError {}

export function asciiKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

const NUMBER = /^-?\d+$/;
const COORD = /^-?\d+(,-?\d+){1,2}$/;

function classify(raw: string, col: number, line: number): Token {
  if (NUMBER.test(raw)) return { kind: 'number', value: parseInt(raw, 10), text: raw, col };
  if (COORD.test(raw)) return { kind: 'coord', values: raw.split(',').map((n) => parseInt(n, 10)), text: raw, col };
  const eq = raw.indexOf('=');
  const br = raw.indexOf('[');
  if (eq > 0 && (br < 0 || eq < br)) {
    const key = asciiKey(raw.slice(0, eq));
    const value = raw.slice(eq + 1);
    if (!value) throw new TessError(line, `„${raw}“: Nach dem Gleichheitszeichen fehlt der Wert.`);
    return { kind: 'pair', key, value, text: raw, col };
  }
  if (raw.includes(',')) throw new TessError(line, `„${raw}“ ist keine gültige Koordinate (Form: x,y,z mit ganzen Zahlen).`);
  return { kind: 'word', text: raw, col };
}

/** Splits one line into tokens. Brackets keep block states like `lantern[hanging=true]` together. */
export function tokenizeLine(text: string, line: number): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '#') break;
    const start = i;
    if (c === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) throw new TessError(line, 'Der Text in Anführungszeichen wird nicht geschlossen.');
      out.push({ kind: 'string', text: text.slice(i + 1, end), col: start + 1 });
      i = end + 1;
      continue;
    }
    let depth = 0;
    let quoted = false;
    while (i < n) {
      const ch = text[i];
      if (ch === '"' && depth === 0) {
        // key="value with spaces"
        quoted = !quoted;
      } else if (!quoted) {
        if (ch === '[') depth++;
        else if (ch === ']') depth = Math.max(0, depth - 1);
        else if (depth === 0 && (ch === ' ' || ch === '\t' || ch === '\r' || ch === '#')) break;
      }
      i++;
    }
    if (depth > 0) throw new TessError(line, `„${text.slice(start, i)}“: Die eckige Klammer wird nicht geschlossen.`);
    let raw = text.slice(start, i);
    if (quoted) throw new TessError(line, 'Der Text in Anführungszeichen wird nicht geschlossen.');
    raw = raw.replace(/="(.*)"$/, '=$1');
    out.push(classify(raw, start + 1, line));
  }
  return out;
}

/** Splits a whole file into statements. Lines with syntax errors become diagnostics. */
export function parseStatements(source: string): { statements: Statement[]; diagnostics: Diagnostic[] } {
  const statements: Statement[] = [];
  const diagnostics: Diagnostic[] = [];
  const lines = source.replace(/^﻿/, '').split('\n');
  lines.forEach((text, i) => {
    const line = i + 1;
    try {
      const tokens = tokenizeLine(text, line);
      if (tokens.length === 0) return;
      const head = tokens[0];
      if (head.kind !== 'word') throw new TessError(line, `Die Zeile beginnt nicht mit einem Befehl, sondern mit „${tokenText(head)}“.`);
      statements.push({ line, cmd: asciiKey(head.text), args: tokens.slice(1) });
    } catch (e) {
      if (e instanceof TessError) diagnostics.push({ line: e.line, level: 'error', message: e.message });
      else throw e;
    }
  });
  return { statements, diagnostics };
}

export function tokenText(t: Token): string {
  return t.kind === 'string' ? `"${t.text}"` : t.text;
}
