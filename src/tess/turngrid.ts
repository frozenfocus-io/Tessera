import { completeState } from './connect';
import { Grid, infoOrigin, infoPart } from './grid';
import { turnState, type Xf } from './xform';

/**
 * `ausrichtung` (section 10): the finished grid turned or mirrored around 0,0,0, cell by cell.
 * States turn with their cell (complete first, so defaults like facing=north turn too); the
 * connection pass runs afterwards on the turned grid.
 */
export function turnGrid(src: Grid, xf: Xf): Grid {
  const out = new Grid(src.limit);
  out.copyMeta(src);
  const ids = new Map<number, number>();
  src.forEach((x, y, z, id, info) => {
    let n = ids.get(id);
    if (n === undefined) {
      n = out.stateId(turnState(completeState(src.states[id]), xf));
      ids.set(id, n);
    }
    const [tx, ty, tz] = xf.map(x, y, z);
    out.setId(tx, ty, tz, n, infoPart(info), infoOrigin(info));
  });
  return out;
}
