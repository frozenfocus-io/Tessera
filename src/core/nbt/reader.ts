import { decodeModifiedUtf8 } from './mutf8';
import { NbtError, TAG, type NbtCompound, type NbtValue } from './types';

export interface NbtDocument {
  /** Name of the root tag (e.g. "Schematic"); empty string for unnamed roots. */
  rootName: string;
  root: NbtCompound;
  /** Number of bytes consumed. */
  bytesRead: number;
}

const MAX_DEPTH = 512;

/**
 * Reads an uncompressed, big-endian (Java Edition) NBT document whose root is a compound tag.
 * Throws NbtError with a German message on malformed input.
 */
export function readNbt(bytes: Uint8Array): NbtDocument {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.length;
  let pos = 0;

  const need = (n: number): void => {
    if (n < 0 || pos + n > len) {
      throw new NbtError(`NBT-Daten enden unerwartet (Position ${pos}, benötigt ${n} Bytes, vorhanden ${len - pos}).`);
    }
  };

  const readU8 = (): number => {
    need(1);
    return bytes[pos++];
  };
  const readI8 = (): number => {
    need(1);
    const v = view.getInt8(pos);
    pos += 1;
    return v;
  };
  const readI16 = (): number => {
    need(2);
    const v = view.getInt16(pos);
    pos += 2;
    return v;
  };
  const readU16 = (): number => {
    need(2);
    const v = view.getUint16(pos);
    pos += 2;
    return v;
  };
  const readI32 = (): number => {
    need(4);
    const v = view.getInt32(pos);
    pos += 4;
    return v;
  };
  const readI64 = (): bigint => {
    need(8);
    const v = view.getBigInt64(pos);
    pos += 8;
    return v;
  };
  const readF32 = (): number => {
    need(4);
    const v = view.getFloat32(pos);
    pos += 4;
    return v;
  };
  const readF64 = (): number => {
    need(8);
    const v = view.getFloat64(pos);
    pos += 8;
    return v;
  };
  const readString = (): string => {
    const n = readU16();
    need(n);
    const s = decodeModifiedUtf8(bytes, pos, pos + n);
    pos += n;
    return s;
  };
  const readLength = (what: string, elementSize: number): number => {
    const n = readI32();
    if (n < 0) throw new NbtError(`Ungültige Länge ${n} für ${what} (Position ${pos - 4}).`);
    if (elementSize > 0 && n * elementSize > len - pos) {
      throw new NbtError(`${what} mit ${n} Einträgen passt nicht in die Datei (Position ${pos - 4}).`);
    }
    return n;
  };

  const readPayload = (type: number, depth: number): NbtValue => {
    switch (type) {
      case TAG.Byte:
        return readI8();
      case TAG.Short:
        return readI16();
      case TAG.Int:
        return readI32();
      case TAG.Long:
        return readI64();
      case TAG.Float:
        return readF32();
      case TAG.Double:
        return readF64();
      case TAG.ByteArray: {
        const n = readLength('Byte-Array', 1);
        const arr = bytes.subarray(pos, pos + n);
        pos += n;
        return arr;
      }
      case TAG.String:
        return readString();
      case TAG.List: {
        if (depth > MAX_DEPTH) throw new NbtError('NBT ist zu tief verschachtelt.');
        const elementType = readU8();
        const n = readLength('Liste', minPayloadSize(elementType));
        if (elementType === TAG.End && n > 0) {
          throw new NbtError(`Liste mit ${n} Einträgen ohne Elementtyp (Position ${pos}).`);
        }
        if (elementType > TAG.LongArray) throw new NbtError(`Unbekannter Listentyp ${elementType} (Position ${pos}).`);
        const out: NbtValue[] = new Array(n);
        for (let i = 0; i < n; i++) out[i] = readPayload(elementType, depth + 1);
        return out;
      }
      case TAG.Compound: {
        if (depth > MAX_DEPTH) throw new NbtError('NBT ist zu tief verschachtelt.');
        const obj: NbtCompound = Object.create(null) as NbtCompound;
        for (;;) {
          const t = readU8();
          if (t === TAG.End) break;
          if (t > TAG.LongArray) throw new NbtError(`Unbekannter Tag-Typ ${t} (Position ${pos - 1}).`);
          const name = readString();
          obj[name] = readPayload(t, depth + 1);
        }
        return obj;
      }
      case TAG.IntArray: {
        const n = readLength('Int-Array', 4);
        const arr = new Int32Array(n);
        for (let i = 0; i < n; i++) arr[i] = view.getInt32(pos + i * 4);
        pos += n * 4;
        return arr;
      }
      case TAG.LongArray: {
        const n = readLength('Long-Array', 8);
        const arr = new BigInt64Array(n);
        for (let i = 0; i < n; i++) arr[i] = view.getBigInt64(pos + i * 8);
        pos += n * 8;
        return arr;
      }
      default:
        throw new NbtError(`Unbekannter Tag-Typ ${type} (Position ${pos}).`);
    }
  };

  if (len === 0) throw new NbtError('Die Datei ist leer.');
  const rootType = readU8();
  if (rootType !== TAG.Compound) {
    throw new NbtError(`Keine NBT-Datei: erwartet Compound-Tag (10) am Anfang, gefunden ${rootType}.`);
  }
  const rootName = readString();
  const root = readPayload(TAG.Compound, 0) as NbtCompound;
  return { rootName, root, bytesRead: pos };
}

function minPayloadSize(type: number): number {
  switch (type) {
    case TAG.End:
      return 0;
    case TAG.Byte:
      return 1;
    case TAG.Short:
      return 2;
    case TAG.Int:
    case TAG.Float:
      return 4;
    case TAG.Long:
    case TAG.Double:
      return 8;
    case TAG.String:
      return 2;
    case TAG.ByteArray:
    case TAG.IntArray:
    case TAG.LongArray:
      return 4;
    case TAG.List:
      return 5;
    case TAG.Compound:
      return 1;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Typed accessors with readable errors for format parsers.

export function describeType(v: NbtValue | undefined): string {
  if (v === undefined) return 'fehlt';
  if (typeof v === 'number') return 'Zahl';
  if (typeof v === 'bigint') return 'Long';
  if (typeof v === 'string') return 'Text';
  if (v instanceof Uint8Array) return 'Byte-Array';
  if (v instanceof Int32Array) return 'Int-Array';
  if (v instanceof BigInt64Array) return 'Long-Array';
  if (Array.isArray(v)) return 'Liste';
  return 'Compound';
}

export function optNumber(c: NbtCompound, key: string): number | undefined {
  const v = c[key];
  if (v === undefined) return undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  throw new NbtError(`Feld "${key}" hat den falschen Typ (${describeType(v)} statt Zahl).`);
}

export function reqNumber(c: NbtCompound, key: string): number {
  const v = optNumber(c, key);
  if (v === undefined) throw new NbtError(`Pflichtfeld "${key}" fehlt.`);
  return v;
}

export function optString(c: NbtCompound, key: string): string | undefined {
  const v = c[key];
  if (v === undefined) return undefined;
  if (typeof v === 'string') return v;
  throw new NbtError(`Feld "${key}" hat den falschen Typ (${describeType(v)} statt Text).`);
}

export function optCompound(c: NbtCompound, key: string): NbtCompound | undefined {
  const v = c[key];
  if (v === undefined) return undefined;
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v)) return v as NbtCompound;
  throw new NbtError(`Feld "${key}" hat den falschen Typ (${describeType(v)} statt Compound).`);
}

export function reqCompound(c: NbtCompound, key: string): NbtCompound {
  const v = optCompound(c, key);
  if (v === undefined) throw new NbtError(`Pflichtfeld "${key}" fehlt.`);
  return v;
}

export function optList(c: NbtCompound, key: string): NbtValue[] | undefined {
  const v = c[key];
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v;
  throw new NbtError(`Feld "${key}" hat den falschen Typ (${describeType(v)} statt Liste).`);
}

export function optByteArray(c: NbtCompound, key: string): Uint8Array | undefined {
  const v = c[key];
  if (v === undefined) return undefined;
  if (v instanceof Uint8Array) return v;
  throw new NbtError(`Feld "${key}" hat den falschen Typ (${describeType(v)} statt Byte-Array).`);
}

export function optIntArray(c: NbtCompound, key: string): Int32Array | undefined {
  const v = c[key];
  if (v === undefined) return undefined;
  if (v instanceof Int32Array) return v;
  throw new NbtError(`Feld "${key}" hat den falschen Typ (${describeType(v)} statt Int-Array).`);
}
