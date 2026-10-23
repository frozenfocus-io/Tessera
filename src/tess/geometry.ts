/** Directions and rasterising helpers for the building language. x = east, y = up, z = south. */

export type Facing = 'north' | 'east' | 'south' | 'west';

export const FACINGS: readonly Facing[] = ['north', 'east', 'south', 'west'];

export const DIR: Record<Facing, readonly [number, number]> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

export function opposite(f: Facing): Facing {
  return f === 'north' ? 'south' : f === 'south' ? 'north' : f === 'east' ? 'west' : 'east';
}

/** Counter-clockwise seen from above (as Minecraft's Direction.getCounterClockWise). */
export function ccw(f: Facing): Facing {
  return f === 'north' ? 'west' : f === 'west' ? 'south' : f === 'south' ? 'east' : 'north';
}

export function cw(f: Facing): Facing {
  return opposite(ccw(f));
}

export function axisOf(f: Facing): 'x' | 'z' {
  return f === 'east' || f === 'west' ? 'x' : 'z';
}

/** Side names in the language: n/o/s/w or the full German words. */
const SIDE_WORDS: Record<string, Facing> = {
  n: 'north',
  nord: 'north',
  norden: 'north',
  o: 'east',
  ost: 'east',
  osten: 'east',
  s: 'south',
  sued: 'south',
  sueden: 'south',
  w: 'west',
  west: 'west',
  westen: 'west',
};

export function parseSide(word: string): Facing | null {
  return SIDE_WORDS[word] ?? null;
}

export function sideLabel(f: Facing): string {
  return f === 'north' ? 'Nord' : f === 'east' ? 'Ost' : f === 'south' ? 'Süd' : 'West';
}

/**
 * Cells of a filled disc around the centre cell with radius r (diameter 2r+1). The test
 * dx² + dz² ≤ (r + 0.5)² gives round outlines without single protruding cells.
 */
export function inDisc(dx: number, dz: number, r: number): boolean {
  return dx * dx + dz * dz <= (r + 0.5) * (r + 0.5);
}

export function discCells(r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (inDisc(dx, dz, r)) out.push([dx, dz]);
  return out;
}

/** Outline of a disc: cells with at least one side neighbour outside. Closed for walking and for light. */
export function ringCells(r: number): [number, number][] {
  return discCells(r).filter(
    ([dx, dz]) => !inDisc(dx + 1, dz, r) || !inDisc(dx - 1, dz, r) || !inDisc(dx, dz + 1, r) || !inDisc(dx, dz - 1, r),
  );
}

/** Ring cells sorted by angle (for patterns like crenellations that alternate along the ring). */
export function ringByAngle(r: number): [number, number][] {
  return ringCells(r).sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
}

/** 3D line from a to b (inclusive), one cell per step along the longest axis. */
export function lineCells(a: readonly number[], b: readonly number[]): [number, number, number][] {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
  const out: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    out.push([Math.round(a[0] + d[0] * t), Math.round(a[1] + d[1] * t), Math.round(a[2] + d[2] * t)]);
  }
  return out;
}

/** Facing of a stair on a ring that rises towards the centre: towards the centre along the longer axis. */
export function facingTowards(dx: number, dz: number): Facing {
  // dx, dz: vector from the cell to the centre.
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'east' : 'west';
  return dz > 0 ? 'south' : 'north';
}
