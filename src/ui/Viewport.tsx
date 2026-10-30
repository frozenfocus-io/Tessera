import { editTarget, isEditing } from '../app/planEdit';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Project } from '../app/project';
import { attachViewer, getPool, getViewer, hoverAt } from '../app/viewController';
import { readableName } from '../blocks/names';
import { activeProject, compactLayout, examples, lastBenchmark, markUnknown, projection, showToast, touchFirst } from '../app/workspace';
import { log } from '../debug/log';
import { openExample } from '../platform/examples';
import { saveFile } from '../platform/save';
import { HoverDetails } from './HoverCard';
import { IconCamera, IconClose, IconFrame, IconGauge, IconOpen, IconStripes, IconTop, Mark } from './icons';
import { LayerRail } from './LayerRail';
import { compact, ms, num, num1 } from './format';

/** A touch counts as a tap if the finger moved less than this (CSS pixels) … */
const TAP_SLOP = 10;
/** … and was lifted within this time (ms). */
const TAP_MS = 600;

/** Selects the block under a finger: info card plus all blocks of its kind; empty space clears. */
function selectAt(clientX: number, clientY: number): void {
  const p = activeProject.value;
  if (!p) return;
  hoverAt(p, clientX, clientY);
  const h = p.hover.value;
  if (isEditing(p)) {
    editTarget.value = h ? { id: p.id, x: h.x, y: h.y, z: h.z, left: clientX + 8, top: clientY + 8 } : null;
    return;
  }
  p.setPinned(h ? `type:${h.typeId}` : null);
}

export function clearSelection(p: Project): void {
  p.hover.value = null;
  p.setPinned(null);
}

export function Viewport({ onOpen }: { onOpen: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0, pending: false, downX: 0, downY: 0, down: false });
  // Touch gestures: OrbitControls rotates/zooms; a short single-finger tap selects a block.
  const touch = useRef({ active: 0, multi: false, startX: 0, startY: 0, startT: 0 });
  useEffect(() => attachViewer(hostRef.current!), []);
  const compactUi = compactLayout.value;
  useEffect(() => {
    // Keep framed models clear of the toolbar, the layer slider and the info line (see app.css).
    const viewer = getViewer();
    if (viewer) viewer.frameInsets = compactUi ? { top: 54, right: 58, bottom: 10, left: 10 } : { top: 48, right: 52, bottom: 40, left: 12 };
  }, [compactUi]);
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
          if (e.pointerType === 'touch') return;
          pointer.current.x = e.clientX;
          pointer.current.y = e.clientY;
          scheduleHover();
        }}
        onPointerLeave={(e) => {
          // A lifted finger "leaves" too; the tapped block stays selected.
          if (e.pointerType === 'touch') return;
          const proj = activeProject.value;
          if (proj) proj.hover.value = null;
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'touch') {
            const t = touch.current;
            t.active++;
            if (t.active > 1) {
              t.multi = true;
            } else {
              t.multi = false;
              t.startX = e.clientX;
              t.startY = e.clientY;
              t.startT = performance.now();
            }
            return;
          }
          pointer.current.down = true;
          pointer.current.downX = e.clientX;
          pointer.current.downY = e.clientY;
        }}
        onPointerCancel={(e) => {
          if (e.pointerType !== 'touch') return;
          const t = touch.current;
          t.active = Math.max(0, t.active - 1);
          t.multi = true;
        }}
        onPointerUp={(e) => {
          if (e.pointerType === 'touch') {
            const t = touch.current;
            t.active = Math.max(0, t.active - 1);
            const tap =
              !t.multi &&
              t.active === 0 &&
              Math.hypot(e.clientX - t.startX, e.clientY - t.startY) < TAP_SLOP &&
              performance.now() - t.startT < TAP_MS;
            if (tap) selectAt(e.clientX, e.clientY);
            return;
          }
          const ptr = pointer.current;
          const wasClick = ptr.down && e.button === 0 && Math.hypot(e.clientX - ptr.downX, e.clientY - ptr.downY) < 5;
          ptr.down = false;
          const proj = activeProject.value;
          if (!wasClick || !proj) return;
          const h = proj.hover.value;
          // Edit mode: a click on a block opens its menu, a click into empty space closes it.
          if (isEditing(proj)) {
            editTarget.value = h ? { id: proj.id, x: h.x, y: h.y, z: h.z, left: e.clientX + 8, top: e.clientY + 8 } : null;
            return;
          }
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
        aria-label="Übersicht"
        onClick={() => p.bounds && viewer?.frame(p.bounds)}
      >
        <IconFrame /> <span class="btn-label">Übersicht</span>
      </button>
      <button
        class={`btn btn-float${projection.value === 'orthographic' ? ' is-current' : ''}`}
        title="Bauplan: senkrecht von oben, ohne Perspektive, Norden oben (T)"
        aria-label="Draufsicht"
        onClick={() => p.bounds && viewer?.topView(p.bounds, p.viewMode.value === 'all' ? null : p.layer.value)}
      >
        <IconTop /> <span class="btn-label">Draufsicht</span>
      </button>
      <button
        class="btn btn-float"
        title="Screenshot als PNG speichern"
        aria-label="Screenshot"
        onClick={async () => {
          const blob = await viewer?.screenshot();
          if (!blob) return;
          const label = p.viewMode.value === 'all' ? 'gesamt' : `ebene-${p.displayLayer(p.layer.value)}`;
          const outcome = await saveFile(blob, `${p.name}-${label}.png`);
          if (outcome === 'saved') log.info('view', 'Screenshot gespeichert');
          else if (outcome === 'unavailable') showToast('error', 'Screenshots lassen sich in dieser Ansicht nicht speichern.');
        }}
      >
        <IconCamera /> <span class="btn-label">Screenshot</span>
      </button>
      <button
        class="btn btn-float"
        disabled={busy}
        title="Die Kamera fünf Sekunden um das Modell drehen und die Bildrate messen"
        aria-label="Leistungstest"
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
        <IconGauge /> <span class="btn-label">{busy ? 'Messe …' : 'Leistungstest'}</span>
      </button>
      {hasUnknown ? (
        <button
          class={`btn btn-float${markUnknown.value ? ' is-on' : ''}`}
          aria-pressed={markUnknown.value}
          title="Unbekannte und Mod-Blöcke rot schraffieren"
          aria-label={`Unbekannte Blöcke markieren (${p.unknownBlocks.length})`}
          onClick={() => (markUnknown.value = !markUnknown.value)}
        >
          <IconStripes /> <span class="btn-label">Unbekannte ({p.unknownBlocks.length})</span>
        </button>
      ) : null}
    </div>
  );
}

function HoverCard({ project: p }: { project: Project }) {
  const h = p.hover.value;
  const pin = p.pinned.value;
  const touchUi = touchFirst.value;
  const close = touchUi ? (
    <button class="hc-close btn btn-icon btn-ghost" aria-label="Auswahl aufheben" onClick={() => clearSelection(p)}>
      <IconClose size={14} />
    </button>
  ) : null;
  if (!h) {
    if (pin) {
      const isType = pin.startsWith('type:');
      // On desktop the material table shows an item marking; on touch the table may be folded away.
      if (!isType && !touchUi) return null;
      const label = isType ? p.model.types[Number(pin.slice(5))]?.displayName : readableName(pin.slice(5));
      if (!label) return null;
      return (
        <div class="hover-card is-compact">
          <span class="pin-note">
            Markiert: <strong>{label}</strong>. {touchUi ? 'Tippe ins Leere, um sie aufzuheben.' : 'Klick ins Leere löst.'}
          </span>
          {close}
        </div>
      );
    }
    return null;
  }
  return (
    <div class="hover-card">
      {close}
      <HoverDetails project={p} hover={h} pinned={pin === `type:${h.typeId}`} touch={touchUi} />
    </div>
  );
}

export function PerfLine({ project: p, inline = false }: { project: Project; inline?: boolean }) {
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
    <div
      class={`perf-line${inline ? ' is-inline' : ''}`}
      title="Leistung der 3D-Ansicht. Die Bildrate wird nur gemessen, solange sich etwas bewegt."
    >
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
  const list = examples.value;
  return (
    <div class="empty">
      <div class="empty-mosaic" aria-hidden="true">
        {MOSAIC.map((cls, i) => (
          <span key={i} class={`t ${cls}`} />
        ))}
      </div>
      <h1>Schematic öffnen</h1>
      <p>
        {touchFirst.value ? 'Wähle eine Schematic aus.' : 'Zieh eine Schematic hierher oder wähle sie aus.'} Jede Datei bekommt einen eigenen
        Tab, und nichts verlässt dein Gerät.
      </p>
      <div class="empty-actions">
        <button class="btn btn-primary" onClick={onOpen}>
          <IconOpen /> Datei auswählen
        </button>
        {list.map((ex) => (
          <button key={ex.name} class="btn" onClick={() => void openExample(ex)}>
            Beispiel: {ex.label}
          </button>
        ))}
      </div>
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
