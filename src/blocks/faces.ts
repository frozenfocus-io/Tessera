/**
 * Face/direction conventions used throughout Tessera.
 *
 * Minecraft axes: +X = east, -X = west, +Y = up, -Y = down, +Z = south, -Z = north.
 * Face index order: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z.
 */
export const EAST = 0;
export const WEST = 1;
export const UP = 2;
export const DOWN = 3;
export const SOUTH = 4;
export const NORTH = 5;

export const FACE_NAMES = ['east', 'west', 'up', 'down', 'south', 'north'] as const;
export type FaceName = (typeof FACE_NAMES)[number];

/** Unit normal per face index. */
export const FACE_NORMALS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function faceIndex(name: string | undefined): number {
  switch (name) {
    case 'east':
      return EAST;
    case 'west':
      return WEST;
    case 'up':
      return UP;
    case 'down':
      return DOWN;
    case 'south':
      return SOUTH;
    case 'north':
      return NORTH;
    default:
      return -1;
  }
}

export function oppositeFace(f: number): number {
  return f ^ 1;
}

/** Horizontal rotation steps (clockwise seen from above) from north. */
export function horizontalSteps(facing: string | undefined): number {
  switch (facing) {
    case 'east':
      return 1;
    case 'south':
      return 2;
    case 'west':
      return 3;
    default:
      return 0; // north and anything unknown
  }
}
