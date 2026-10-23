import { useState } from 'preact/hooks';
import type { MaterialMode, Project, ViewMode } from '../app/project';
import { activeProject, showToast } from '../app/workspace';
import { describeSlots, formatShulkers, formatStacks, type MaterialSummary } from '../materials/materialList';
import { IconCheck, IconCopy } from './icons';
import { bytes, css, num } from './format';

export function Sidebar() {
  const p = activeProject.value;
  if (!p) {
    return (
      <aside class="sidebar is-empty">
        <p>Hier erscheinen Projektdaten, Ebenen und die Materialliste, sobald eine Schematic offen ist.</p>
      </aside>
    );
  }
  return (
    <aside class="sidebar" aria-label="Projekt">
      <ProjectInfo project={p} />
      <LayerPanel project={p} />
      <MaterialPanel project={p} />
    </aside>
  );
}

function ProjectInfo({ project: p }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const r = p.data;
  const b = p.bounds;
  const size = b ? `${b.maxX - b.minX} × ${b.maxY - b.minY} × ${b.maxZ - b.minZ}` : '–';
  const warnings = r.info.warnings;
  return (
    <section class="panel">
      <h2 class="project-name" title={p.fileName}>
        {p.name}
      </h2>
      <dl class="facts">
        <dt>Größe</dt>
        <dd title="Breite (x) × Höhe (y) × Länge (z) der belegten Blöcke">{size}</dd>
        <dt>Blöcke</dt>
        <dd>
          {num(r.analysis.nonAir)} in {num(p.model.types.length - 1)} Sorten
        </dd>
        <dt>Format</dt>
        <dd>
          {r.formatLabel}, {bytes(r.fileSize)}
        </dd>
        <dt>Minecraft</dt>
        <dd>{r.minecraftVersion ?? 'unbekannt'}</dd>
        {r.info.meta?.name && r.info.meta.name !== p.name ? (
          <>
            <dt>Titel</dt>
            <dd>{r.info.meta.name}</dd>
          </>
        ) : null}
        {r.info.meta?.author ? (
          <>
            <dt>Von</dt>
            <dd>{r.info.meta.author}</dd>
          </>
        ) : null}
      </dl>
      {p.unknownBlocks.length || warnings.length ? (
        <div class="notice">
          <button class="notice-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {p.unknownBlocks.length ? `${p.unknownBlocks.length} unbekannte Blocksorten` : ''}
            {p.unknownBlocks.length && warnings.length ? ', ' : ''}
            {warnings.length ? `${warnings.length} Hinweis${warnings.length > 1 ? 'e' : ''}` : ''}
          </button>
          {open ? (
            <div class="notice-body">
              {warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              {p.unknownBlocks.length ? (
                <>
                  <p>Diese Blöcke kennt Tessera noch nicht. Sie sind rot schraffiert; Farben und Namen kommen mit dem Block-Katalog.</p>
                  <ul>
                    {p.unknownBlocks.map((u) => (
                      <li key={u.name}>
                        <code>{u.name}</code> <span class="muted">{num(u.count)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const VIEW_MODES: { id: ViewMode; label: string; title: string }[] = [
  { id: 'all', label: 'Gesamt', title: 'Ganzes Gebäude in Farbe (Esc)' },
  { id: 'slice', label: 'Schnitt', title: 'Aktuelle Ebene in Farbe, darunter grau, darüber ausgeblendet' },
  { id: 'single', label: 'Einzeln', title: 'Nur die aktuelle Ebene' },
];

function LayerPanel({ project: p }: { project: Project }) {
  const layer = p.layer.value;
  const mode = p.viewMode.value;
  const done = p.done.value;
  const isDone = done.has(layer);
  const total = p.layerCount;
  const doneCount = [...done].filter((y) => y >= p.minLayer && y <= p.maxLayer).length;
  const blocksDone = p.doneBlocks();
  const blocksAll = p.data.analysis.nonAir;
  const inLayer = p.data.analysis.layerCounts[layer] ?? 0;
  return (
    <section class="panel">
      <div class="panel-head">
        <h3>Ebenen</h3>
        <div class="segmented" role="radiogroup" aria-label="Ansicht der Ebenen">
          {VIEW_MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={mode === m.id}
              class={mode === m.id ? 'is-on' : ''}
              title={m.title}
              onClick={() => p.setViewMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div class="layer-now">
        <div>
          <span class="layer-big">Ebene {p.displayLayer(layer)}</span>
          <span class="muted"> von {num(total)}</span>
        </div>
        <div class="muted">{num(inLayer)} Blöcke in dieser Ebene</div>
      </div>
      <button
        class={`btn btn-done${isDone ? ' is-done' : ''}`}
        aria-pressed={isDone}
        onClick={() => p.toggleDone()}
        title="Ebene als fertig gebaut abhaken (Leertaste)"
      >
        <IconCheck /> {isDone ? 'Ebene ist fertig' : 'Ebene als fertig abhaken'}
      </button>
      <div class="progress" aria-label="Baufortschritt">
        <div class="progress-bar">
          <div style={{ width: `${blocksAll ? (blocksDone / blocksAll) * 100 : 0}%` }} />
        </div>
        <div class="progress-text">
          <span>
            {num(doneCount)} von {num(total)} Ebenen fertig
          </span>
          <span class="muted">
            {num(blocksDone)} von {num(blocksAll)} Blöcken
          </span>
        </div>
      </div>
    </section>
  );
}

const MATERIAL_MODES: { id: MaterialMode; label: string; title: string }[] = [
  { id: 'all', label: 'Gesamt', title: 'Material für das ganze Gebäude' },
  { id: 'layer', label: 'Ebene', title: 'Nur die aktuelle Ebene' },
  { id: 'from', label: 'Ab hier', title: 'Ab der aktuellen Ebene aufwärts' },
  { id: 'open', label: 'Offen', title: 'Alle Ebenen, die noch nicht abgehakt sind' },
];

function summarize(p: Project): MaterialSummary {
  const mode = p.materialMode.value;
  const layer = p.layer.value;
  const done = p.done.value;
  const inRange = (y: number) => y >= p.minLayer && y <= p.maxLayer;
  switch (mode) {
    case 'layer':
      return p.materials.summarize((y) => y === layer);
    case 'from':
      return p.materials.summarize((y) => inRange(y) && y >= layer);
    case 'open':
      return p.materials.summarize((y) => inRange(y) && !done.has(y));
    default:
      return p.materials.summarize(inRange);
  }
}

function MaterialPanel({ project: p }: { project: Project }) {
  const s = summarize(p);
  const mode = p.materialMode.value;
  const pinned = p.pinned.value;
  const scopeText =
    mode === 'layer'
      ? `Ebene ${p.displayLayer(p.layer.value)}`
      : mode === 'from'
        ? `ab Ebene ${p.displayLayer(p.layer.value)}`
        : mode === 'open'
          ? 'noch nicht abgehakte Ebenen'
          : 'ganzes Gebäude';

  const copy = async () => {
    const lines = [
      `${p.name} – Material (${scopeText})`,
      ...s.rows.map((r) => `${num(r.count)}\t${r.displayName}\t${r.liquid ? 'Quellblöcke' : formatStacks(r)}`),
      `${num(s.totalItems)}\tSumme`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      showToast('success', 'Materialliste kopiert.');
    } catch {
      showToast('error', 'Kopieren hat nicht geklappt – der Browser hat den Zugriff auf die Zwischenablage verweigert.');
    }
  };

  return (
    <section class="panel panel-grow">
      <div class="panel-head">
        <h3>Material</h3>
        <div class="segmented" role="radiogroup" aria-label="Umfang der Materialliste">
          {MATERIAL_MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={mode === m.id}
              class={mode === m.id ? 'is-on' : ''}
              title={m.title}
              onClick={() => p.setMaterialMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div class="material-totals">
        <div>
          <strong>{num(s.totalItems)}</strong>
          <span>Items</span>
        </div>
        <div title="Inventarplätze: jeder angefangene Stack belegt einen Platz">
          <strong>{num(s.totalStacks)}</strong>
          <span>Stacks</span>
        </div>
        <div title={`${num(s.totalStacks)} Plätze = ${describeSlots(s.totalStacks)} (eine Kiste hat 27 Plätze)`}>
          <strong>{formatShulkers(s.totalShulkers)}</strong>
          <span>Shulker</span>
        </div>
        <button class="btn btn-icon btn-ghost" title="Liste als Text kopieren" aria-label="Liste kopieren" onClick={copy}>
          <IconCopy />
        </button>
      </div>
      {s.rows.length === 0 ? (
        <p class="muted material-empty">{mode === 'open' ? 'Alles abgehakt – nichts mehr zu besorgen.' : 'In diesem Bereich gibt es keine Blöcke.'}</p>
      ) : (
        <div class="material-scroll">
          <table class="material">
            <thead>
              <tr>
                <th scope="col" class="c-name">
                  Block
                </th>
                <th scope="col" class="c-num">
                  Anzahl
                </th>
                <th scope="col" class="c-stack">
                  Stacks
                </th>
                <th scope="col" class="c-sk" title="Shulker-Kisten">
                  SK
                </th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => {
                const key = `item:${r.item}`;
                const isPinned = pinned === key;
                return (
                  <tr
                    key={r.item}
                    class={isPinned ? 'is-pinned' : ''}
                    onClick={() => p.togglePinned(key)}
                    title={isPinned ? 'Markierung aufheben' : 'Alle Blöcke dieser Sorte im Modell markieren'}
                  >
                    <td class="c-name">
                      <span class="swatch" style={{ background: css(r.swatch) }} />
                      <span class="name">{r.displayName}</span>
                      {r.marked ? <span class="tag tag-red" title="Unbekannter oder Mod-Block">?</span> : null}
                      {r.creativeOnly ? <span class="tag" title="Im Survival nicht erhältlich">C</span> : null}
                    </td>
                    <td class="c-num">{num(r.count)}</td>
                    <td class="c-stack">{r.liquid ? 'Quellblöcke' : formatStacks(r)}</td>
                    <td class="c-sk" title={r.liquid ? undefined : describeSlots(r.slots)}>
                      {r.liquid ? '–' : formatShulkers(r.shulkers)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p class="material-scope muted">Umfang: {scopeText}. Klick auf eine Zeile markiert die Blöcke im Modell.</p>
    </section>
  );
}
