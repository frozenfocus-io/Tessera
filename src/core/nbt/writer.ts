import { encodeModifiedUtf8 } from './mutf8';
import { TAG } from './types';

/**
 * Explicitly typed NBT tags for writing (export formats, test fixtures).
 * The reader returns plain JS values; the writer needs exact tag types.
 */
export type NbtTag =
  | { t: 'byte'; v: number }
  | { t: 'short'; v: number }
  | { t: 'int'; v: number }
  | { t: 'long'; v: bigint }
  | { t: 'float'; v: number }
  | { t: 'double'; v: number }
  | { t: 'string'; v: string }
  | { t: 'byteArray'; v: Uint8Array }
  | { t: 'intArray'; v: ArrayLike<number> }
  | { t: 'longArray'; v: ArrayLike<bigint> }
  | { t: 'list'; of: NbtTagName; v: NbtTag[] }
  | { t: 'compound'; v: Record<string, NbtTag> };

export type NbtTagName = NbtTag['t'] | 'end';

const TAG_IDS: Record<NbtTagName, number> = {
  end: TAG.End,
  byte: TAG.Byte,
  short: TAG.Short,
  int: TAG.Int,
  long: TAG.Long,
  float: TAG.Float,
  double: TAG.Double,
  string: TAG.String,
  byteArray: TAG.ByteArray,
  intArray: TAG.IntArray,
  longArray: TAG.LongArray,
  list: TAG.List,
  compound: TAG.Compound,
};

export const nbt = {
  byte: (v: number): NbtTag => ({ t: 'byte', v }),
  short: (v: number): NbtTag => ({ t: 'short', v }),
  int: (v: number): NbtTag => ({ t: 'int', v }),
  long: (v: bigint): NbtTag => ({ t: 'long', v }),
  float: (v: number): NbtTag => ({ t: 'float', v }),
  double: (v: number): NbtTag => ({ t: 'double', v }),
  string: (v: string): NbtTag => ({ t: 'string', v }),
  byteArray: (v: Uint8Array): NbtTag => ({ t: 'byteArray', v }),
  intArray: (v: ArrayLike<number>): NbtTag => ({ t: 'intArray', v }),
  longArray: (v: ArrayLike<bigint>): NbtTag => ({ t: 'longArray', v }),
  list: (of: NbtTagName, v: NbtTag[]): NbtTag => ({ t: 'list', of, v }),
  compound: (v: Record<string, NbtTag>): NbtTag => ({ t: 'compound', v }),
};

class ByteSink {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.length + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number): void {
    this.ensure(1);
    this.buf[this.length++] = v & 0xff;
  }
  i16(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.length, v);
    this.length += 2;
  }
  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.length, v);
    this.length += 2;
  }
  i32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.length, v);
    this.length += 4;
  }
  i64(v: bigint): void {
    this.ensure(8);
    this.view.setBigInt64(this.length, v);
    this.length += 8;
  }
  f32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.length, v);
    this.length += 4;
  }
  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.length, v);
    this.length += 8;
  }
  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  string(s: string): void {
    const enc = encodeModifiedUtf8(s);
    if (enc.length > 0xffff) throw new Error('NBT-String zu lang');
    this.u16(enc.length);
    this.bytes(enc);
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

function writePayload(out: ByteSink, tag: NbtTag): void {
  switch (tag.t) {
    case 'byte':
      out.u8(tag.v);
      return;
    case 'short':
      out.i16(tag.v);
      return;
    case 'int':
      out.i32(tag.v);
      return;
    case 'long':
      out.i64(tag.v);
      return;
    case 'float':
      out.f32(tag.v);
      return;
    case 'double':
      out.f64(tag.v);
      return;
    case 'string':
      out.string(tag.v);
      return;
    case 'byteArray':
      out.i32(tag.v.length);
      out.bytes(tag.v);
      return;
    case 'intArray':
      out.i32(tag.v.length);
      for (let i = 0; i < tag.v.length; i++) out.i32(tag.v[i]);
      return;
    case 'longArray':
      out.i32(tag.v.length);
      for (let i = 0; i < tag.v.length; i++) out.i64(tag.v[i]);
      return;
    case 'list': {
      const elementType = tag.v.length === 0 ? TAG_IDS[tag.of] : TAG_IDS[tag.v[0].t];
      out.u8(elementType);
      out.i32(tag.v.length);
      for (const el of tag.v) {
        if (TAG_IDS[el.t] !== elementType) throw new Error('NBT-Liste mit gemischten Typen');
        writePayload(out, el);
      }
      return;
    }
    case 'compound':
      for (const [name, child] of Object.entries(tag.v)) {
        out.u8(TAG_IDS[child.t]);
        out.string(name);
        writePayload(out, child);
      }
      out.u8(TAG.End);
      return;
  }
}

/** Serialises a named root compound to uncompressed NBT bytes. */
export function writeNbt(rootName: string, root: NbtTag & { t: 'compound' }): Uint8Array {
  const out = new ByteSink();
  out.u8(TAG.Compound);
  out.string(rootName);
  writePayload(out, root);
  return out.result();
}
