import { stairQuarters } from '../../src/blocks/shapes';
import type { Grid } from '../../src/tess/grid';

/**
 * Light leaks at half-block resolution: flood-fills the air outside a building through every
 * gap (open quarters of stairs, upper halves of slabs) and returns the empty cells inside
 * `inside` that it reaches. Thin blocks (panes, fences, trapdoors …) count as open.
 */
export function leaks(grid: Grid, inside: (x: number, y: number, z: number) => boolean): string[] {
  const b = grid.bounds();
  if (!b) return [];
  const [x0, y0, z0] = [b.min[0] - 1, b.min[1] - 1, b.min[2] - 1];
  const [x1, y1, z1] = [b.max[0] + 1, b.max[1] + 1, b.max[2] + 1];
  const W = (x1 - x0 + 1) * 2;
  const H = (y1 - y0 + 1) * 2;
  const D = (z1 - z0 + 1) * 2;
  const solid = new Uint8Array(W * H * D);
  const idx = (sx: number, sy: number, sz: number) => (sy * D + sz) * W + sx;
  grid.forEach((x, y, z, id) => {
    const s = grid.states[id];
    const n = s.name.slice(s.name.indexOf(':') + 1);
    const bx = (x - x0) * 2;
    const by = (y - y0) * 2;
    const bz = (z - z0) * 2;
    const fill = (qx: number, qy: number, qz: number) => (solid[idx(bx + qx, by + qy, bz + qz)] = 1);
    if (n.endsWith('_stairs')) {
      const top = s.props.half === 'top';
      const q = stairQuarters(s.props.facing ?? 'north', s.props.shape ?? 'straight');
      for (let qz = 0; qz < 2; qz++)
        for (let qx = 0; qx < 2; qx++) {
          fill(qx, top ? 1 : 0, qz);
          if (q & (1 << (qz * 2 + qx))) fill(qx, top ? 0 : 1, qz);
        }
    } else if (n.endsWith('_slab')) {
      const t = s.props.type ?? 'bottom';
      for (let qy = 0; qy < 2; qy++) if (t === 'double' || (t === 'bottom' && qy === 0) || (t === 'top' && qy === 1)) for (let q = 0; q < 4; q++) fill(q & 1, qy, q >> 1);
    } else if (!/(_pane|_fence|_fence_gate|trapdoor|_door|lantern|_rod|_wall|torch|_carpet|iron_bars|chain)$/.test(n)) {
      for (let q = 0; q < 8; q++) fill(q & 1, (q >> 1) & 1, (q >> 2) & 1);
    }
  });
  const seen = new Uint8Array(W * H * D);
  const queue: number[] = [];
  const push = (sx: number, sy: number, sz: number) => {
    if (sx < 0 || sy < 0 || sz < 0 || sx >= W || sy >= H || sz >= D) return;
    const i = idx(sx, sy, sz);
    if (seen[i] || solid[i]) return;
    seen[i] = 1;
    queue.push(i);
  };
  for (let sy = 0; sy < H; sy++)
    for (let sz = 0; sz < D; sz++) {
      push(0, sy, sz);
      push(W - 1, sy, sz);
    }
  for (let sy = 0; sy < H; sy++)
    for (let sx = 0; sx < W; sx++) {
      push(sx, sy, 0);
      push(sx, sy, D - 1);
    }
  for (let sz = 0; sz < D; sz++) for (let sx = 0; sx < W; sx++) push(sx, H - 1, sz);
  const out = new Set<string>();
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const sx = i % W;
    const sz = Math.floor(i / W) % D;
    const sy = Math.floor(i / (W * D));
    const x = x0 + (sx >> 1);
    const y = y0 + (sy >> 1);
    const z = z0 + (sz >> 1);
    if (inside(x, y, z) && !grid.has(x, y, z)) out.add(`${x},${y},${z}`);
    push(sx + 1, sy, sz);
    push(sx - 1, sy, sz);
    push(sx, sy + 1, sz);
    push(sx, sy - 1, sz);
    push(sx, sy, sz + 1);
    push(sx, sy, sz - 1);
  }
  return [...out];
}
