/**
 * Java "modified UTF-8" (DataInput.readUTF / DataOutput.writeUTF), as used by NBT strings.
 *
 * Differences to standard UTF-8: U+0000 is written as two bytes (C0 80) and characters outside
 * the BMP are written as two separately encoded UTF-16 surrogates (3 bytes each). The decoder
 * also accepts standard 4-byte UTF-8 sequences, which some third-party tools write.
 */

export function decodeModifiedUtf8(bytes: Uint8Array, start: number, end: number): string {
  // Fast path: pure ASCII (block ids, property names, almost everything in schematics).
  let ascii = true;
  for (let i = start; i < end; i++) {
    if (bytes[i] >= 0x80 || bytes[i] === 0) {
      ascii = false;
      break;
    }
  }
  if (ascii) {
    let s = '';
    const CHUNK = 8192;
    for (let i = start; i < end; i += CHUNK) {
      s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(end, i + CHUNK))));
    }
    return s;
  }

  const units: number[] = [];
  let i = start;
  while (i < end) {
    const b = bytes[i];
    if (b < 0x80) {
      units.push(b);
      i += 1;
    } else if ((b & 0xe0) === 0xc0 && i + 1 < end) {
      units.push(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if ((b & 0xf0) === 0xe0 && i + 2 < end) {
      units.push(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else if ((b & 0xf8) === 0xf0 && i + 3 < end) {
      const cp =
        ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      const v = cp - 0x10000;
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      i += 4;
    } else {
      units.push(0xfffd); // malformed byte
      i += 1;
    }
  }
  let s = '';
  const CHUNK = 8192;
  for (let k = 0; k < units.length; k += CHUNK) {
    s += String.fromCharCode.apply(null, units.slice(k, k + CHUNK));
  }
  return s;
}

export function encodeModifiedUtf8(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0x0001 && c <= 0x007f) {
      out.push(c);
    } else if (c <= 0x07ff) {
      out.push(0xc0 | ((c >> 6) & 0x1f), 0x80 | (c & 0x3f));
    } else {
      out.push(0xe0 | ((c >> 12) & 0x0f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return Uint8Array.from(out);
}
