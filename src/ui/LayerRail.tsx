import { useMemo, useRef } from 'preact/hooks';
import type { Project } from '../app/project';
import { IconDown, IconUp } from './icons';
import { num } from './format';

/**
 * Vertical layer slider. The track doubles as the building's profile: one bar per layer, its
 * width proportional to the number of blocks; finished layers are green, the current one is
 * marked by the thumb with the layer number.
 */
export function LayerRail({ project: p }: { project: Project }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const counts = p.data.analysis.layerCounts;
  const n = p.layerCount;
  const max = useMemo(() => {
    let m = 1;
    for (let y = p.minLayer; y <= p.maxLayer; y++) m = Math.max(m, counts[y]);
    return m;
  }, [p]);

  const layer = p.layer.value;
  const mode = p.viewMode.value;
  const done = p.done.value;
  const active = mode !== 'all';
  const idx = layer - p.minLayer;
  const pos = n > 1 ? (idx + 0.5) / n : 0.5;

  const layerFromPointer = (clientY: number): number => {
    const r = trackRef.current!.getBoundingClientRect();
    const f = 1 - (clientY - r.top) / r.height;
    return p.minLayer + Math.min(n - 1, Math.max(0, Math.floor(f * n)));
  };

  const bars = [];
  for (let i = 0; i < n; i++) {
    const y = p.minLayer + i;
    const c = counts[y];
    const w = c === 0 ? 0 : Math.max(8, (c / max) * 100);
    const cls = y === layer && active ? 'is-current' : done.has(y) ? 'is-done' : active && y > layer ? 'is-above' : '';
    bars.push(<rect key={y} x={0} y={n - 1 - i} width={w} height={n > 160 ? 1 : 0.8} class={cls} />);
  }

  return (
    <div class={`rail${active ? ' is-active' : ''}`} role="group" aria-label="Ebenen">
      <button class="rail-step" title="Ebene höher (Pfeil hoch)" aria-label="Ebene höher" onClick={() => p.stepLayer(1)}>
        <IconUp />
      </button>
      <div
        class="rail-track"
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={p.displayLayer(layer)}
        aria-valuetext={`Ebene ${p.displayLayer(layer)} von ${n}`}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          p.setLayer(layerFromPointer(e.clientY));
        }}
        onPointerMove={(e) => {
          if (dragging.current) p.setLayer(layerFromPointer(e.clientY));
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onWheel={(e) => {
          e.preventDefault();
          p.stepLayer(e.deltaY < 0 ? 1 : -1);
        }}
      >
        <svg class="rail-profile" viewBox={`0 0 100 ${n}`} preserveAspectRatio="none" aria-hidden="true">
          {bars}
        </svg>
        <div class="rail-thumb" style={{ bottom: `calc(${pos * 100}% - 1px)` }}>
          <span class="rail-readout">
            <span class="rail-number">{p.displayLayer(layer)}</span>
            <span class="rail-total">/{num(n)}</span>
          </span>
        </div>
      </div>
      <button class="rail-step" title="Ebene tiefer (Pfeil runter)" aria-label="Ebene tiefer" onClick={() => p.stepLayer(-1)}>
        <IconDown />
      </button>
    </div>
  );
}
