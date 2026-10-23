import { gunzipSync, unzlibSync } from 'fflate';

export type Compression = 'gzip' | 'zlib' | 'none';

/** Detects gzip / zlib / uncompressed data and returns the raw bytes. */
export function decompressAuto(bytes: Uint8Array): { data: Uint8Array; compression: Compression } {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return { data: gunzipSync(bytes), compression: 'gzip' };
  }
  // zlib header: CMF 0x78 and (CMF*256 + FLG) divisible by 31.
  if (bytes.length >= 2 && bytes[0] === 0x78 && ((bytes[0] << 8) | bytes[1]) % 31 === 0) {
    return { data: unzlibSync(bytes), compression: 'zlib' };
  }
  return { data: bytes, compression: 'none' };
}
