/**
 * Tokenizer for the building language (.tess). The language is line based: one statement per
 * line, `#` starts a comment. A statement is a command word followed by tokens:
 *
 *   box haus 0,0,0 8,5,6 mauer hohl boden=boden
 *
 * Token kinds: words (names, roles, block ids incl. `[props]`), numbers, coordinates (`x,y,z`
 * or `x,z`), strings in double quotes and `key=value` pairs. Keys and commands may be written
 * with umlauts or their ASCII spelling (`tür` = `tuer`, `überstand` = `ueberstand`).
 *
 * Bau-Sprache 2 adds continuation lines (`\` at the end), expressions in braces (`{haus.x1+1}`,
 * evaluated when the statement runs, so tokens are kept raw until then) and ASCII drawings:
 * lines starting with `|` right below `grundriss`, `ebene`, `ebenen` or `ansicht`.
 */

export type Token =
  | { kind: 'word'; text: string; col: number }
  | { kind: 'number'; value: number; text: string; col: number }
  | { kind: 'coord'; values: number[]; text: string; col: number }
  | { kind: 'string'; text: string; col: number }
  | { kind: 'pair'; key: string; value: string; text: string; col: number };

/** Bau-Sprache 2: a token as written, before expressions are evaluated. */
export interface RawToken {
  text: string;
  col: number;
  /** A string in quotes (expressions inside are not evaluated). */
  quoted: boolean;
}

export interface AsciiLine {
  line: number;
  /** Everything after the `|`, trailing spaces removed. */
  text: string;
}

export interface Statement {
  /** 1-based line number (first line of the statement). */
  line: number;
  /** Command word, normalised (lower case, ASCII umlauts). */
  cmd: string;
  /** Version 1: classified tokens. Version 2: filled when the statement runs. */
  args: Token[];
  /** Version 2: tokens as written. */
  raw?: RawToken[];
  /** Version 2: statement text without comments, continuation lines joined. */
  text?: string;
  /** Version 2: ASCII drawing below the statement. */
  ascii?: AsciiLine[];
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

/**
 * A statement refers to a role or form whose own line already failed. That error is reported
 * once; the follow-up statements are skipped silently instead of repeating it.
 */
export class FollowUpError extends TessError {}

/** "Tür" -> "tuer", "Überstand" -> "ueberstand". */
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

export function classify(raw: string, col: number, line: number): Token {
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

/** Bau-Sprache 1: splits a whole file into statements. Lines with syntax errors become diagnostics. */
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

// ---------------------------------------------------------------------------
// Bau-Sprache 2

/** Commands that take an ASCII drawing in the following `|` lines. */
export const DRAWING_COMMANDS = new Set(['grundriss', 'ebene', 'ebenen', 'ansicht']);

/** Removes a comment: `#` outside quotes, brackets and braces. */
function stripComment(text: string): string {
  let quoted = false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted) {
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth = Math.max(0, depth - 1);
      else if (c === '#' && depth === 0) return text.slice(0, i);
    }
  }
  return text;
}

/** Splits a logical line into raw tokens: whitespace outside quotes, brackets and braces. */
export function splitRaw(text: string, line: number): RawToken[] {
  const out: RawToken[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    const start = i;
    if (c === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) throw new TessError(line, 'Der Text in Anführungszeichen wird nicht geschlossen.');
      out.push({ text: text.slice(i + 1, end), col: start + 1, quoted: true });
      i = end + 1;
      continue;
    }
    let square = 0;
    let curly = 0;
    let quoted = false;
    while (i < n) {
      const ch = text[i];
      if (ch === '"' && square === 0) quoted = !quoted;
      else if (!quoted) {
        if (ch === '[') square++;
        else if (ch === ']') square = Math.max(0, square - 1);
        else if (ch === '{') curly++;
        else if (ch === '}') {
          if (curly === 0) throw new TessError(line, `„${text.slice(start, i + 1)}“: Zu dieser geschweiften Klammer fehlt die öffnende.`);
          curly--;
        } else if (square === 0 && curly === 0 && (ch === ' ' || ch === '\t' || ch === '\r')) break;
      }
      i++;
    }
    if (square > 0) throw new TessError(line, `„${text.slice(start, i)}“: Die eckige Klammer wird nicht geschlossen.`);
    if (curly > 0) throw new TessError(line, `„${text.slice(start, i)}“: Die geschweifte Klammer wird nicht geschlossen.`);
    if (quoted) throw new TessError(line, 'Der Text in Anführungszeichen wird nicht geschlossen.');
    out.push({ text: text.slice(start, i).replace(/="(.*)"$/, '=$1'), col: start + 1, quoted: false });
  }
  return out;
}

/**
 * Bau-Sprache 2: splits a file into statements. Joins continuation lines (`\` at the end),
 * collects ASCII drawings and keeps tokens raw (expressions are evaluated when a statement runs).
 */
export function parseStatements2(source: string): { statements: Statement[]; diagnostics: Diagnostic[] } {
  const statements: Statement[] = [];
  const diagnostics: Diagnostic[] = [];
  const lines = source.replace(/^﻿/, '').split('\n');
  /** Statement that may take ASCII lines right now (the previous line belongs to it). */
  let drawing: Statement | null = null;
  let i = 0;
  while (i < lines.length) {
    const first = i + 1;
    const physical = lines[i].replace(/\r$/, '');
    const trimmed = physical.trimStart();
    if (trimmed.startsWith('|')) {
      if (drawing) {
        drawing.ascii!.push({ line: first, text: trimmed.slice(1).replace(/\s+$/, '') });
      } else {
        diagnostics.push({ line: first, level: 'error', message: 'Eine ASCII-Zeile (|…) gehört direkt unter grundriss, ebene, ebenen oder ansicht.' });
      }
      i++;
      continue;
    }
    drawing = null;
    // Logical line: join continuations.
    let text = stripComment(physical);
    while (/\\\s*$/.test(text) && i + 1 < lines.length) {
      text = text.replace(/\\\s*$/, ' ');
      i++;
      text += stripComment(lines[i].replace(/\r$/, ''));
    }
    if (/\\\s*$/.test(text)) text = text.replace(/\\\s*$/, '');
    i++;
    try {
      const raw = splitRaw(text, first);
      if (raw.length === 0) continue;
      const head = raw[0];
      if (head.quoted || /^[-\d{]/.test(head.text) || head.text.includes('=')) {
        throw new TessError(first, `Die Zeile beginnt nicht mit einem Befehl, sondern mit „${head.quoted ? `"${head.text}"` : head.text}“.`);
      }
      const st: Statement = {
        line: first,
        cmd: asciiKey(head.text),
        args: [],
        raw: raw.slice(1),
        text: text.replace(/\s+/g, ' ').trim(),
      };
      if (DRAWING_COMMANDS.has(st.cmd)) {
        st.ascii = [];
        drawing = st;
      }
      statements.push(st);
    } catch (e) {
      if (e instanceof TessError) diagnostics.push({ line: e.line, level: 'error', message: e.message });
      else throw e;
    }
  }
  return { statements, diagnostics };
}

/** The language version a file asks for in its first statement, null when there is none. */
export function detectVersion(source: string): number | null {
  for (const raw of source.replace(/^﻿/, '').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^tess\s+(-?\d+)\s*$/i.exec(line);
    return m ? parseInt(m[1], 10) : null;
  }
  return null;
}
