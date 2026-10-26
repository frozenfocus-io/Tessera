import { asciiKey, TessError, tokenText, type Statement, type Token } from './syntax';

/**
 * Reading the arguments of one statement (Bau-Sprache 2): positional tokens in order (name,
 * coordinates, words), `key=value` pairs in any order, and flag words (`hohl`). Unknown keys and
 * leftover tokens are errors with the statement's line.
 */

export const NO = new Set(['nein', 'aus', 'ohne', '0']);
export const YES = new Set(['ja', 'an', '1']);

export class Args {
  readonly positional: Token[] = [];
  private readonly pairs = new Map<string, Token & { kind: 'pair' }>();
  private readonly flags = new Set<string>();
  private next = 0;

  constructor(
    private readonly st: Statement,
    tokens: Token[],
    allowedKeys: readonly string[],
    allowedFlags: readonly string[] = [],
  ) {
    for (const t of tokens) {
      if (t.kind === 'pair') {
        if (!allowedKeys.includes(t.key)) {
          const allowed = allowedKeys.length ? allowedKeys.map((k) => `${k}=`).join(', ') : 'keine';
          throw new TessError(st.line, `„${t.key}=“ gibt es bei „${st.cmd}“ nicht (erlaubt: ${allowed}).`);
        }
        if (this.pairs.has(t.key)) throw new TessError(st.line, `„${t.key}=“ steht doppelt.`);
        this.pairs.set(t.key, t);
      } else if (t.kind === 'word' && allowedFlags.includes(asciiKey(t.text))) {
        this.flags.add(asciiKey(t.text));
      } else {
        this.positional.push(t);
      }
    }
  }

  get line(): number {
    return this.st.line;
  }

  get cmd(): string {
    return this.st.cmd;
  }

  flag(name: string): boolean {
    return this.flags.has(name);
  }

  has(key: string): boolean {
    return this.pairs.has(key);
  }

  str(key: string): string | undefined {
    return this.pairs.get(key)?.value;
  }

  /** Lower-case ASCII value of a word option, or the default. */
  word(key: string, def: string): string;
  word(key: string): string | undefined;
  word(key: string, def?: string): string | undefined {
    const v = this.pairs.get(key)?.value;
    return v === undefined ? def : asciiKey(v);
  }

  /** Word option from a fixed list (error with the list otherwise). */
  choice<T extends string>(key: string, options: readonly T[], def: T): T {
    const v = this.word(key, def);
    if (!(options as readonly string[]).includes(v)) throw new TessError(this.st.line, `„${key}=${this.str(key)}“: möglich sind ${options.join(', ')}.`);
    return v as T;
  }

  /** ja/nein option. */
  bool(key: string, def: boolean): boolean {
    const v = this.str(key);
    if (v === undefined) return def;
    const k = asciiKey(v);
    if (YES.has(k)) return true;
    if (NO.has(k)) return false;
    throw new TessError(this.st.line, `„${key}=${v}“: ja oder nein.`);
  }

  int(key: string, def: number, min = -Infinity, max = Infinity): number {
    const raw = this.pairs.get(key)?.value;
    if (raw === undefined) return def;
    if (!/^-?\d+$/.test(raw)) throw new TessError(this.st.line, `„${key}=${raw}“: Erwartet wird eine ganze Zahl.`);
    const v = parseInt(raw, 10);
    if (v < min || v > max) throw new TessError(this.st.line, `„${key}=${raw}“: erlaubt ist ${min} bis ${max}.`);
    return v;
  }

  requireInt(key: string, min = -Infinity, max = Infinity, hint = ''): number {
    if (!this.pairs.has(key)) throw new TessError(this.st.line, `Bei „${this.st.cmd}“ fehlt „${key}=“.${hint ? ` ${hint}` : ''}`);
    return this.int(key, 0, min, max);
  }

  decimal(key: string, def: number, min = -Infinity, max = Infinity): number {
    const raw = this.pairs.get(key)?.value;
    if (raw === undefined) return def;
    if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new TessError(this.st.line, `„${key}=${raw}“: Erwartet wird eine Zahl, z. B. ${key}=0.3.`);
    const v = parseFloat(raw);
    if (v < min || v > max) throw new TessError(this.st.line, `„${key}=${raw}“: erlaubt ist ${min} bis ${max}.`);
    return v;
  }

  /** Comma-separated list (`riegel=2,5`, `blumen=poppy,dandelion`). */
  list(key: string): string[] {
    const v = this.str(key);
    if (v === undefined) return [];
    return v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  }

  /** Optional leading name: a word followed by a coordinate. */
  optionalName(): string | null {
    const t = this.positional[this.next];
    const after = this.positional[this.next + 1];
    if (t?.kind === 'word' && after?.kind === 'coord') {
      this.next++;
      return asciiKey(t.text);
    }
    return null;
  }

  coord(what: string, dims: 2 | 3 = 3): number[] {
    const t = this.positional[this.next];
    if (!t || t.kind !== 'coord' || t.values.length !== dims) {
      const form = dims === 3 ? 'x,y,z' : 'x,z';
      throw new TessError(this.st.line, `${what} fehlt oder ist keine Koordinate ${form}${t ? ` (gefunden: „${tokenText(t)}“)` : ''}.`);
    }
    this.next++;
    return t.values;
  }

  /** Whether the next positional token is a coordinate. */
  nextIsCoord(): boolean {
    return this.positional[this.next]?.kind === 'coord';
  }

  word1(what: string): string {
    const t = this.positional[this.next];
    if (!t || t.kind !== 'word') throw new TessError(this.st.line, `${what} fehlt${t ? ` (gefunden: „${tokenText(t)}“)` : ''}.`);
    this.next++;
    return t.text;
  }

  optionalWord(): string | null {
    const t = this.positional[this.next];
    if (t?.kind !== 'word') return null;
    this.next++;
    return t.text;
  }

  /** The next positional word without taking it. */
  peekWord(): string | null {
    const t = this.positional[this.next];
    return t?.kind === 'word' ? t.text : null;
  }

  /** Remaining positional words. */
  words(): string[] {
    const out: string[] = [];
    while (this.positional[this.next]?.kind === 'word') out.push((this.positional[this.next++] as { text: string }).text);
    return out;
  }

  done(): void {
    const t = this.positional[this.next];
    if (t) throw new TessError(this.st.line, `„${tokenText(t)}“ ist hier zu viel oder an der falschen Stelle.`);
  }
}
