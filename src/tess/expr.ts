import { asciiKey, TessError } from './syntax';

/**
 * Integer expressions of Bau-Sprache 2, written in braces wherever a whole number may stand:
 * `{haus.x1+1},0,{haus.mz}`, `h={hoehe*2}`, `turm{i}`. Operators + - * / % with the usual
 * precedence, unary minus, parentheses and the functions min, max, abs, clamp and zufall.
 * `/` divides rounding down (-7/2 = -4), `%` always gives 0 … divisor−1.
 */

export interface ExprEnv {
  /** A named value (wert, module setting, loop variable), or undefined if there is none. */
  value(name: string): number | undefined;
  /** A field of a form: path = ["haus", "x1"] or ["nordturm", "turm", "x1"]. */
  field(path: string[]): number;
  /** zufall(a, b, k): a … b, from the seed, the line and k. */
  random(a: number, b: number, k: number): number;
}

type Tok = { t: 'num'; v: number } | { t: 'name'; v: string } | { t: 'op'; v: string };

function lex(src: string, line: number): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (/\d/.test(c)) {
      let j = i;
      while (j < src.length && /\d/.test(src[j])) j++;
      if (src[j] === '.' && /\d/.test(src[j + 1] ?? '')) throw new TessError(line, `„${src}“: In Ausdrücken gibt es nur ganze Zahlen.`);
      out.push({ t: 'num', v: parseInt(src.slice(i, j), 10) });
      i = j;
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      let j = i;
      while (j < src.length && /[\p{L}\d_.]/u.test(src[j])) j++;
      out.push({ t: 'name', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/%(),'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new TessError(line, `„${src}“: Das Zeichen „${c}“ gehört nicht in einen Ausdruck.`);
  }
  return out;
}

const FUNCTIONS = new Set(['min', 'max', 'abs', 'clamp', 'zufall']);

class Parser {
  private i = 0;
  constructor(
    private readonly toks: Tok[],
    private readonly src: string,
    private readonly env: ExprEnv,
    private readonly line: number,
  ) {}

  private fail(msg: string): never {
    throw new TessError(this.line, `Ausdruck „{${this.src}}“: ${msg}`);
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private isOp(v: string): boolean {
    const t = this.peek();
    return t?.t === 'op' && t.v === v;
  }

  parse(): number {
    if (this.toks.length === 0) this.fail('Er ist leer.');
    const v = this.expr();
    if (this.i < this.toks.length) this.fail(`„${tokStr(this.toks[this.i])}“ ist hier zu viel.`);
    return v;
  }

  private expr(): number {
    let v = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.toks[this.i++] as { v: string }).v;
      const r = this.term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  private term(): number {
    let v = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = (this.toks[this.i++] as { v: string }).v;
      const r = this.unary();
      if (op === '*') v = v * r;
      else if (op === '/') {
        if (r === 0) this.fail('Division durch 0.');
        v = Math.floor(v / r);
      } else {
        if (r <= 0) this.fail('Der Teiler von % muss größer als 0 sein.');
        v = ((v % r) + r) % r;
      }
    }
    return v;
  }

  private unary(): number {
    if (this.isOp('-')) {
      this.i++;
      return -this.unary();
    }
    if (this.isOp('+')) {
      this.i++;
      return this.unary();
    }
    return this.primary();
  }

  private primary(): number {
    const t = this.toks[this.i++];
    if (!t) this.fail('Er endet zu früh.');
    if (t.t === 'num') return t.v;
    if (t.t === 'op') {
      if (t.v !== '(') this.fail(`„${t.v}“ steht an der falschen Stelle.`);
      const v = this.expr();
      if (!this.isOp(')')) this.fail('Eine Klammer wird nicht geschlossen.');
      this.i++;
      return v;
    }
    const name = asciiKey(t.v);
    if (this.isOp('(')) {
      if (!FUNCTIONS.has(name)) this.fail(`Die Funktion „${t.v}“ gibt es nicht (möglich: min, max, abs, clamp, zufall).`);
      this.i++;
      const args: number[] = [];
      if (!this.isOp(')')) {
        for (;;) {
          args.push(this.expr());
          if (this.isOp(',')) {
            this.i++;
            continue;
          }
          break;
        }
      }
      if (!this.isOp(')')) this.fail(`Bei „${t.v}(“ fehlt die schließende Klammer.`);
      this.i++;
      return this.call(name, args);
    }
    if (name.includes('.')) {
      const parts = name.split('.');
      if (parts.some((p) => !p)) this.fail(`„${t.v}“ ist kein gültiger Name.`);
      return this.env.field(parts);
    }
    const v = this.env.value(name);
    if (v === undefined) this.fail(`Den Wert „${t.v}“ gibt es nicht. Lege ihn mit „wert ${t.v}=…“ an.`);
    return v;
  }

  private call(name: string, a: number[]): number {
    const need = (n: number) => {
      if (a.length !== n) this.fail(`„${name}“ braucht ${n} Angaben, nicht ${a.length}.`);
    };
    switch (name) {
      case 'min':
        if (a.length === 0) this.fail('„min“ braucht mindestens eine Angabe.');
        return Math.min(...a);
      case 'max':
        if (a.length === 0) this.fail('„max“ braucht mindestens eine Angabe.');
        return Math.max(...a);
      case 'abs':
        need(1);
        return Math.abs(a[0]);
      case 'clamp':
        need(3);
        if (a[1] > a[2]) this.fail(`clamp: ${a[1]} ist größer als ${a[2]}.`);
        return Math.min(a[2], Math.max(a[1], a[0]));
      case 'zufall':
        need(3);
        if (a[0] > a[1]) this.fail(`zufall: ${a[0]} ist größer als ${a[1]}.`);
        return this.env.random(a[0], a[1], a[2]);
    }
    this.fail(`Die Funktion „${name}“ gibt es nicht.`);
  }
}

function tokStr(t: Tok): string {
  return typeof t.v === 'number' ? String(t.v) : t.v;
}

/** Evaluates one expression (the text between the braces). */
export function evalExpr(src: string, env: ExprEnv, line: number): number {
  const v = new Parser(lex(src, line), src, env, line).parse();
  if (!Number.isSafeInteger(v)) throw new TessError(line, `Ausdruck „{${src}}“: Das Ergebnis ist zu groß.`);
  return v === 0 ? 0 : v; // no -0
}

/** Replaces every `{…}` in a token by its value, innermost first (`{turm{i}.x1}` works). */
export function substitute(text: string, env: ExprEnv, line: number): string {
  let s = text;
  for (let guard = 0; s.includes('{'); guard++) {
    if (guard > 1000) throw new TessError(line, `„${text}“: zu viele Ausdrücke.`);
    const close = s.indexOf('}');
    if (close < 0) throw new TessError(line, `„${text}“: Die geschweifte Klammer wird nicht geschlossen.`);
    const open = s.lastIndexOf('{', close);
    if (open < 0) throw new TessError(line, `„${text}“: Zu dieser geschweiften Klammer fehlt die öffnende.`);
    const v = evalExpr(s.slice(open + 1, close), env, line);
    s = s.slice(0, open) + String(v) + s.slice(close + 1);
  }
  if (s.includes('}')) throw new TessError(line, `„${text}“: Zu dieser geschweiften Klammer fehlt die öffnende.`);
  return s;
}
