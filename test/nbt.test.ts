import { describe, expect, it } from 'vitest';
import { readNbt } from '../src/core/nbt/reader';
import { NbtError, type NbtCompound } from '../src/core/nbt/types';
import { nbt, writeNbt } from '../src/core/nbt/writer';
import { decodeModifiedUtf8, encodeModifiedUtf8 } from '../src/core/nbt/mutf8';

describe('NBT reader/writer', () => {
  it('round-trips every tag type', () => {
    const bytes = writeNbt('Root', {
      t: 'compound',
      v: {
        b: nbt.byte(-5),
        s: nbt.short(-30000),
        i: nbt.int(123456789),
        l: nbt.long(-9007199254740993n),
        f: nbt.float(1.5),
        d: nbt.double(Math.PI),
        str: nbt.string('Grüße ✓ 🧱 \u0000 Ende'),
        ba: nbt.byteArray(Uint8Array.from([0, 1, 127, 128, 255])),
        ia: nbt.intArray([1, -2, 2147483647]),
        la: nbt.longArray([1n, -1n, 9223372036854775807n]),
        list: nbt.list('compound', [nbt.compound({ x: nbt.int(1) }), nbt.compound({ x: nbt.int(2) })]),
        empty: nbt.list('end', []),
        nested: nbt.compound({ deeper: nbt.compound({ name: nbt.string('minecraft:stone') }) }),
      },
    });
    const doc = readNbt(bytes);
    expect(doc.rootName).toBe('Root');
    expect(doc.bytesRead).toBe(bytes.length);
    const r = doc.root;
    expect(r.b).toBe(-5);
    expect(r.s).toBe(-30000);
    expect(r.i).toBe(123456789);
    expect(r.l).toBe(-9007199254740993n);
    expect(r.f).toBe(1.5);
    expect(r.d).toBeCloseTo(Math.PI, 12);
    expect(r.str).toBe('Grüße ✓ 🧱 \u0000 Ende');
    expect(Array.from(r.ba as Uint8Array)).toEqual([0, 1, 127, 128, 255]);
    expect(Array.from(r.ia as Int32Array)).toEqual([1, -2, 2147483647]);
    expect(Array.from(r.la as BigInt64Array)).toEqual([1n, -1n, 9223372036854775807n]);
    expect((r.list as NbtCompound[]).map((c) => c.x)).toEqual([1, 2]);
    expect(r.empty).toEqual([]);
    expect(((r.nested as NbtCompound).deeper as NbtCompound).name).toBe('minecraft:stone');
  });

  it('encodes NUL and supplementary characters like Java (modified UTF-8)', () => {
    const enc = encodeModifiedUtf8('\u0000A🧱');
    // NUL -> C0 80, 'A' -> 41, emoji -> two 3-byte surrogates
    expect(Array.from(enc.slice(0, 3))).toEqual([0xc0, 0x80, 0x41]);
    expect(enc.length).toBe(3 + 6);
    expect(decodeModifiedUtf8(enc, 0, enc.length)).toBe('\u0000A🧱');
  });

  it('accepts standard 4-byte UTF-8 written by other tools', () => {
    const std = new TextEncoder().encode('x🧱y');
    expect(decodeModifiedUtf8(std, 0, std.length)).toBe('x🧱y');
  });

  it('throws a readable error for truncated data', () => {
    const bytes = writeNbt('', { t: 'compound', v: { a: nbt.intArray([1, 2, 3, 4]) } });
    expect(() => readNbt(bytes.slice(0, bytes.length - 6))).toThrow(NbtError);
  });

  it('rejects non-compound roots and empty input', () => {
    expect(() => readNbt(new Uint8Array([8, 0, 0]))).toThrow(/Compound/);
    expect(() => readNbt(new Uint8Array())).toThrow(/leer/);
  });

  it('rejects absurd array lengths without allocating', () => {
    // compound "" { byteArray "a" length 2^30 }
    const bytes = Uint8Array.from([10, 0, 0, 7, 0, 1, 0x61, 0x40, 0, 0, 0]);
    expect(() => readNbt(bytes)).toThrow(/passt nicht/);
  });
});
