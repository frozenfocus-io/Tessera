/**
 * NBT value model used by the reader.
 *
 * Java Edition NBT (big-endian). Values are mapped to plain JS types:
 *  - byte, short, int, float, double -> number
 *  - long                            -> bigint
 *  - string                          -> string
 *  - byte array                      -> Uint8Array (raw bytes, unsigned view)
 *  - int array                       -> Int32Array
 *  - long array                      -> BigInt64Array
 *  - list                            -> NbtValue[]
 *  - compound                        -> NbtCompound (null-prototype object)
 */
export type NbtValue =
  | number
  | bigint
  | string
  | Uint8Array
  | Int32Array
  | BigInt64Array
  | NbtValue[]
  | NbtCompound;

export interface NbtCompound {
  [key: string]: NbtValue;
}

export const TAG = {
  End: 0,
  Byte: 1,
  Short: 2,
  Int: 3,
  Long: 4,
  Float: 5,
  Double: 6,
  ByteArray: 7,
  String: 8,
  List: 9,
  Compound: 10,
  IntArray: 11,
  LongArray: 12,
} as const;

export type TagId = (typeof TAG)[keyof typeof TAG];

export class NbtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NbtError';
  }
}

export function isCompound(v: NbtValue | undefined): v is NbtCompound {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Uint8Array) &&
    !(v instanceof Int32Array) &&
    !(v instanceof BigInt64Array)
  );
}
