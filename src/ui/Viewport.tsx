import { useEffect, useRef, useState } from 'preact/hooks';
import type { Project } from '../app/project';
import { attachViewer, getPool, getViewer, hoverAt } from '../app/viewController';
import { activeProject, lastBenchmark, markUnknown, projection, showToast } from '../app/workspace';
import { log } from '../debug/log';
import { downloadBlob } from '../debug/debugPackage';
import { HoverDetails } from './HoverCard';
import { IconCamera, IconFrame, IconGauge, IconOpen, IconStripes, IconTop, Mark } from './icons';
import { LayerRail } from './LayerRail';
import { compact, ms, num, num1 } from './format';

export function Viewport({ onOpen }: { onOpen: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number; pending: boolean; downX: number; downY: number; down: boolean }>({
    x: 0,
    y: 0,
    pending: false,
    downX: 0,
    downY: 0,
    down: false,
  });
  useEffect(() => attachViewer(hostRef.current!), []);
  const p = activeProject.value;

  const scheduleHover = () => {
    if (pointer.current.pending) return;
    pointer.current.pending = true;
    requestAnimationFrame(() => {
      pointer.current.pending = false;
      const proj = activeProject.value;
      if (proj) hoverAt(proj, pointer.current.x, pointer.current.y);
    });
  };

  return (
    <section class="viewport" aria-label="3D-Ansicht">
      <div
        class="viewer-host"
        ref={hostRef}
        onPointerMove={(e) => {
          pointer.current.x = e.clientX;
          pointer.current.y = e.clientY;
          scheduleHover();
        }}
        onPointerLeave={() => {
          const proj = activeProject.value;
          if (proj) proj.hover.value = null;
        }}
        onPointerDown={(e) => {
          pointer.current.down = true;
          pointer.current.downX = e.clientX;
          pointer.current.downY = e.clientY;
        }}
        onPointerUp={(e) => {
          const ptr = pointer.current;
          const wasClick = ptr.down && e.button === 0 && Math.hypot(e.clientX - ptr.downX, e.clientY - ptr.downY) < 5;
          ptr.down = false;
          const proj = activeProject.value;
          if (!wasClick || !proj) return;
          const h = proj.hover.value;
          const key = h ? `type:${h.typeId}` : null;
          if (key) proj.togglePinned(key);
          else if (proj.pinned.value) proj.togglePinned(null);
        }}
      />
      {p ? <ProjectOverlays project={p} /> : <EmptyState onOpen={onOpen} />}
    </section>
  );
}

function ProjectOverlays({ project: p }: { project: Project }) {
  return (
    <>
      <ViewToolbar project={p} />
      <LayerRail project={p} />
      <HoverCard project={p} />
      <PerfLine project={p} />
      <Compass />
      <BuildProgress project={p} />
    </>
  );
}

function ViewToolbar({ project: p }: { project: Project }) {
  const [busy, setBusy] = useState(false);
  const viewer = getViewer();
  const hasUnknown = p.unknownBlocks.length > 0;
  return (
    <div class="view-toolbar" role="toolbar" aria-label="Ansicht">
      <button
        class={`btn btn-float${projection.value === 'perspective' ? ' is-current' : ''}`}
        title="Ganzes Modell perspektivisch zeigen (F)"
        onClick={() => p.bounds && viewer?.frame(p.bounds)}
      >
        <IconFrame /> Übersicht
      </button>
      <button
        class={`btn btn-float${projection.value === 'orthographic' ? ' is-current' : ''}`}
        title="Bauplan: senkrecht von oben, ohne Perspektive, Norden oben (T)"
        onClick={() => p.bounds && viewer?.topView(p.bounds, p.viewMode.value === 'all' ? null : p.layer.value)}
      >
        <IconTop /> Draufsicht
      </button>
      <button
        class="btn btn-float"
        title="Screenshot als PNG speichern"
        onClick={async () => {
          const blob = await viewer?.screenshot();
          if (!blob) return;
          const label = p.viewMode.value === 'all' ? 'gesamt' : `ebene-${p.displayLayer(p.layer.value)}`;
          downloadBlob(blob, `${p.name}-${label}.png`);
          log.info('view', 'Screenshot gespeichert');
        }}
      >
        <IconCamera /> Screenshot
      </button>
      <button
        class="btn btn-float"
        disabled={busy}
        title="Die Kamera fünf Sekunden um das Modell drehen und die Bildrate messen"
        onClick={async () => {
          if (!viewer) return;
          setBusy(true);
          try {
            const r = await viewer.benchmark(5);
            const pool = getPool();
            const result = {
              project: p.name,
              blocks: p.data.analysis.nonAir,
              ...r,
              avgFps: Math.round(r.avgFps * 10) / 10,
              minFps: Math.round(r.minFps * 10) / 10,
              p95FrameMs: Math.round(r.p95FrameMs * 10) / 10,
              meshWorkers: pool?.workerCount ?? 0,
              at: new Date().toISOString(),
            };
            lastBenchmark.value = result;
            log.info('perf', 'Leistungstest', result);
            showToast('success', `Leistungstest: ${num1(r.avgFps)} Bilder/s im Schnitt, langsamstes Bild ${num1(1000 / r.minFps)} ms.`);
          } finally {
            setBusy(false);
          }
        }}
      >
        <IconGauge /> {busy ? 'Messe …' : 'Leistungstest'}
      </button>
      {hasUnknown ? (
        <button
          class={`btn btn-float${markUnknown.value ? ' is-on' : ''}`}
          aria-pressed={markUnknown.value}
          title="Unbekannte und Mod-Blöcke rot schraffieren"
          onClick={() => (markUnknown.value = !markUnknown.value)}
        >
          <IconStripes /> Unbekannte ({p.unknownBlocks.length})
        </button>
      ) : null}
    </div>
  );
}

function HoverCard({ project: p }: { project: Project }) {
  const h = p.hover.value;
  const pin = p.pinned.value;
  if (!h) {
    if (pin?.startsWith('type:')) {
      const t = p.model.types[Number(pin.slice(5))];
      return (
        <div class="hover-card is-compact">
          <span class="pin-note">
            Festgehalten: <strong>{t?.displayName}</strong>. Klick ins Leere löst.
          </span>
        </div>
      );
    }
    return null;
  }
  return (
    <div class="hover-card">
      <HoverDetails project={p} hover={h} pinned={pin === `type:${h.typeId}`} />
    </div>
  );
}

function PerfLine({ project: p }: { project: Project }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);
  const viewer = getViewer();
  const stats = p.sceneStats.value ?? p.scene?.stats;
  const fps = viewer?.frameStats.fps;
  const triangles = stats ? (stats.opaqueQuads + stats.translucentQuads) * 2 : 0;
  return (
    <div class="perf-line" title="Leistung der 3D-Ansicht. Die Bildrate wird nur gemessen, solange sich etwas bewegt.">
      <span>
        <em>Bildrate</em> {fps ? `${Math.round(fps)} fps` : '–'}
      </span>
      <span>
        <em>Blöcke</em> {compact(p.data.analysis.nonAir)}
      </span>
      <span>
        <em>Dreiecke</em> {compact(triangles)}
      </span>
      {stats?.done ? (
        <span>
          <em>Meshing</em> {ms(stats.wallMs)}
          {stats.mode === 'workers' ? ` mit ${stats.workers} ${stats.workers === 1 ? 'Worker' : 'Workern'}` : ' im Hauptthread'}
        </span>
      ) : null}
    </div>
  );
}

function Compass() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewer = getViewer();
    if (!viewer) return;
    let last = NaN;
    const prev = viewer.onFrame;
    viewer.onFrame = () => {
      prev();
      const h = viewer.heading;
      if (Math.abs(h - last) > 0.2 && ref.current) {
        last = h;
        ref.current.style.setProperty('--heading', `${-h}deg`);
      }
    };
    return () => {
      viewer.onFrame = prev;
    };
  }, []);
  return (
    <div class="compass" ref={ref} title="Himmelsrichtung (Norden = −Z)" aria-hidden="true">
      <div class="compass-rose">
        <span class="c-n">N</span>
        <span class="c-e">O</span>
        <span class="c-s">S</span>
        <span class="c-w">W</span>
      </div>
    </div>
  );
}

function BuildProgress({ project: p }: { project: Project }) {
  const prog = p.meshProgress.value;
  if (!prog || prog.total < 8) return null;
  const pct = Math.round((prog.done / prog.total) * 100);
  return (
    <div class="build-progress" role="status">
      <span>3D-Ansicht wird aufgebaut</span>
      <div class="bar">
        <div style={{ width: `${pct}%` }} />
      </div>
      <span class="muted">
        {num(prog.done)} von {num(prog.total)} Abschnitten
      </span>
    </div>
  );
}

/** Slicer in miniature: layers above outlined, current layer in prismarine, below in stone, finished in moss. */
const MOSAIC = [
  ...Array(5).fill('above'),
  'above', 'above', 'above', '', 'above',
  'current', 'current', 'current hl', 'current', 'current',
  'below', 'below alt', 'below', 'below', 'below alt',
  'done', 'done', 'done', 'done', 'done',
];

function EmptyState({ onOpen }: { onOpen: () => void }) {
  return (
    <div class="empty">
      <div class="empty-mosaic" aria-hidden="true">
        {MOSAIC.map((cls, i) => (
          <span key={i} class={`t ${cls}`} />
        ))}
      </div>
      <h1>Schematic öffnen</h1>
      <p>
        Zieh eine Schematic hierher oder wähle sie aus. Jede Datei bekommt einen eigenen Tab, und nichts verlässt deinen PC.
      </p>
      <button class="btn btn-primary" onClick={onOpen}>
        <IconOpen /> Datei auswählen
      </button>
      <p class="fine">
        Liest <strong>.schem</strong> (WorldEdit, Sponge v1 bis v3), <strong>.litematic</strong> (Litematica) und <strong>.nbt</strong>{' '}
        (Strukturblöcke, Create).
      </p>
      <div class="empty-mark">
        <Mark size={14} /> Tessera
      </div>
    </div>
  );
}
