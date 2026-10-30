import { useRef, useState } from 'preact/hooks';
import type { MaterialMode, Project, ViewMode } from '../app/project';
import { activeProject, catalogDialogOpen, compactLayout, sheetExpanded, sheetTab, showToast, sideSheet, touchFirst } from '../app/workspace';
import { catalogContents } from '../catalog/runtime';
import type { Catalog } from '../catalog/types';
import { describeSlots, formatShulkers, formatStacks, type MaterialSummary } from '../materials/materialList';
import { saveToFolder } from '../app/planFiles';
import { folderStatus } from '../platform/folder';
import { IconCheck, IconCopy, IconFolder, IconSave } from './icons';
import { RawMaterials } from './RawMaterials';
import { PerfLine } from './Viewport';
import { bytes, css, num } from './format';
import { diagLabel } from '../tess/syntax';
import { PlanEditPanel, SectionPicker } from './PlanEdit';

export function Sidebar() {
  const p = activeProject.value;
  if (compactLayout.value) return p ? <Sheet project={p} /> : null;
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
      <PlanEditPanel project={p} />
      <LayerPanel project={p} />
      <MaterialPanel project={p} />
    </aside>
  );
}

const SHEET_TABS: { id: 'material' | 'raw' | 'project'; label: string }[] = [
  { id: 'material', label: 'Material' },
  { id: 'raw', label: 'Rohstoffe' },
  { id: 'project', label: 'Projekt' },
];

/**
 * Phone and tablet layout: the project panel as a sheet. Folded, it shows only what you need
 * while building (current layer, done button, view mode); unfolded, material list and project
 * data. In landscape it sits on the right and stays unfolded. Its top edge fills with moss as
 * the building progresses.
 */
function Sheet({ project: p }: { project: Project }) {
  const side = sideSheet.value;
  const expanded = side || sheetExpanded.value;
  const tab = sheetTab.value;
  const swipe = useRef<{ y: number; moved: boolean } | null>(null);
  const progress = p.blockTotal ? (p.doneBlocks() / p.blockTotal) * 100 : 0;
  return (
    <aside
      class={`sheet${expanded ? ' is-expanded' : ''}${side ? ' is-side' : ''}`}
      aria-label="Projekt"
      style={{ '--progress': `${progress}%` }}
    >
      {side ? null : (
        <button
          class="sheet-grip"
          aria-expanded={expanded}
          aria-label={expanded ? 'Material und Projektdaten ausblenden' : 'Material und Projektdaten zeigen'}
          onPointerDown={(e) => {
            swipe.current = { y: e.clientY, moved: false };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const s = swipe.current;
            if (!s || s.moved) return;
            const dy = e.clientY - s.y;
            if (Math.abs(dy) > 24) {
              s.moved = true;
              sheetExpanded.value = dy < 0;
            }
          }}
          onPointerUp={() => {
            const s = swipe.current;
            swipe.current = null;
            if (s && !s.moved) sheetExpanded.value = !expanded;
          }}
          onPointerCancel={() => (swipe.current = null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              sheetExpanded.value = !expanded;
            }
          }}
        >
          <span />
        </button>
      )}
      <LayerStrip project={p} />
      {expanded ? (
        <>
          <div class="sheet-tabs" role="tablist" aria-label="Bereich">
            {SHEET_TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                class={tab === t.id ? 'is-on' : ''}
                onClick={() => (sheetTab.value = t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div class="sheet-body" role="tabpanel">
            {tab === 'material' || tab === 'raw' ? (
              <MaterialPanel project={p} view={tab === 'raw' ? 'raw' : 'blocks'} />
            ) : (
              <>
                <ProjectInfo project={p} />
                <section class="panel">
                  <h3 class="panel-title">Leistung</h3>
                  <PerfLine project={p} inline />
                </section>
              </>
            )}
          </div>
        </>
      ) : null}
    </aside>
  );
}

/** Current layer, done button and view mode: always visible in the sheet. */
function LayerStrip({ project: p }: { project: Project }) {
  const layer = p.layer.value;
  const mode = p.viewMode.value;
  const done = p.done.value;
  const isDone = done.has(layer);
  const total = p.layerCount;
  const doneCount = [...done].filter((y) => y >= p.minLayer && y <= p.maxLayer).length;
  const inLayer = p.layerCounts[layer] ?? 0;
  return (
    <section class="layer-strip" aria-label="Ebene">
      <div class="strip-row">
        <div class="strip-text">
          <div>
            <span class="layer-big">
              {p.sectionName ? `${p.sectionName}, ` : ''}Ebene {p.displayLayer(layer)}
            </span>
            <span class="muted"> von {num(total)}</span>
          </div>
          <div class="strip-sub">
            {num(inLayer)} Blöcke · {num(doneCount)} von {num(total)} Ebenen fertig
          </div>
        </div>
        <button
          class={`btn btn-done${isDone ? ' is-done' : ''}`}
          aria-pressed={isDone}
          onClick={() => p.toggleDone()}
          title="Ebene als fertig gebaut abhaken"
        >
          <IconCheck /> {isDone ? 'Fertig' : 'Abhaken'}
        </button>
      </div>
      <div class="segmented segmented-wide" role="radiogroup" aria-label="Ansicht der Ebenen">
        {VIEW_MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={mode === m.id} class={mode === m.id ? 'is-on' : ''} onClick={() => p.setViewMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
    </section>
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
        <dt>Katalog</dt>
        <dd>
          {p.catalog ? (
            catalogLabel(p.catalog)
          ) : (
            <button class="link-btn" onClick={() => (catalogDialogOpen.value = true)}>
              noch keiner – Modpack einlesen
            </button>
          )}
        </dd>
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
      {p.isPlan ? <PlanFile project={p} /> : null}
      {p.unknownBlocks.length || warnings.length ? (
        <div class="notice">
          <button class="notice-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {p.unknownBlocks.length ? `${p.unknownBlocks.length} unbekannte Blocksorten` : ''}
            {p.unknownBlocks.length && warnings.length ? ', ' : ''}
            {warnings.length ? `${warnings.length} Hinweis${warnings.length > 1 ? 'e' : ''}` : ''}
          </button>
          {open ? (
            <div class="notice-body">
              {p.isPlan && r.diagnostics?.length ? <PlanHints project={p} /> : warnings.map((w) => <p key={w}>{w}</p>)}
              {p.unknownBlocks.length ? (
                <>
                  <p>
                    {p.catalog
                      ? 'Diese Blöcke stehen nicht im Katalog. Sie sind rot schraffiert, Farbe und Form sind geraten. Fehlt ein Mod im eingelesenen Modpack?'
                      : 'Diese Blöcke kennt Tessera noch nicht. Sie sind rot schraffiert; Farben und Namen kommen mit dem Block-Katalog.'}
                  </p>
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

/**
 * Hints of a building plan, one button each: a click marks the blocks of that line in the model
 * and turns the camera to them; a second click (or Esc) clears the marking.
 */
function PlanHints({ project: p }: { project: Project }) {
  const marked = p.markedLine.value;
  const hints = (p.data.diagnostics ?? []).filter((d) => d.level === 'warn');
  return (
    <>
      <p class="muted hint-help">Klick auf einen Hinweis zeigt die Blöcke seiner Zeile.</p>
      <ul class="plan-hints">
        {hints.map((d, i) => {
          const ctx = d.ctx ?? '';
          const on = !!marked && marked.line === d.line && marked.ctx === ctx;
          return (
            <li key={i}>
              <button
                class={`plan-hint${on ? ' is-on' : ''}`}
                aria-pressed={on}
                title={on ? 'Markierung lösen (Esc)' : 'Blöcke dieser Zeile markieren und hindrehen'}
                onClick={() => {
                  if (!on && !p.lineCells(d.line, ctx)) {
                    showToast('info', `${diagLabel(d)} hat keinen Block gesetzt, den Tessera markieren könnte.`);
                    return;
                  }
                  p.markLine(d.line, ctx);
                }}
              >
                <span class="plan-hint-line">{diagLabel(d)}</span> {d.message}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Building plans: where the file lives, saving into the project folder, build errors of the last change. */
function PlanFile({ project: p }: { project: Project }) {
  const link = p.link.value;
  const issue = p.fileIssue.value;
  const unsupported = folderStatus.value === 'unsupported';
  if (p.readOnly) {
    return (
      <div class="plan-file">
        <p class="muted">Schreibgeschützte Version. Wiederherstellen geht im Tab des Bauplans über „Versionen“.</p>
      </div>
    );
  }
  return (
    <div class="plan-file">
      {link && !p.fileMissing.value ? (
        <p class="plan-path" title="Änderungen an dieser Datei übernimmt Tessera von selbst">
          <IconFolder size={14} /> <code>projekte/{link.name}</code>
        </p>
      ) : (
        <>
          <p class="muted">{p.fileMissing.value ? 'Die Datei fehlt im Projektordner.' : 'Dieser Bauplan liegt noch nicht im Projektordner.'}</p>
          <button class="btn btn-ghost" onClick={() => void saveToFolder(p)}>
            <IconSave /> {unsupported ? 'Als Datei speichern' : 'Im Projektordner speichern'}
          </button>
        </>
      )}
      {issue ? (
        <div class="notice notice-open" role="alert">
          <div class="notice-body">
            <p>
              <strong>{issue.message}</strong> Angezeigt wird die letzte fehlerfreie Fassung.
            </p>
            {issue.detail ? <pre class="plan-errors">{issue.detail}</pre> : null}
          </div>
        </div>
      ) : null}
    </div>
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
  const blocksAll = p.blockTotal;
  const inLayer = p.layerCounts[layer] ?? 0;
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
      <SectionPicker project={p} />
      <div class="layer-now">
        <div>
          <span class="layer-big">
            {p.sectionName ? `${p.sectionName}, ` : ''}Ebene {p.displayLayer(layer)}
          </span>
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

function MaterialPanel({ project: p, view }: { project: Project; view?: 'blocks' | 'raw' }) {
  const s = summarize(p);
  const mode = p.materialMode.value;
  const v = view ?? p.materialView.value;
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
      {/* In the phone sheet its tabs already switch between material and raw materials. */}
      {view ? null : (
        <div class="view-tabs" role="tablist" aria-label="Liste">
          <button role="tab" aria-selected={v === 'blocks'} class={v === 'blocks' ? 'is-on' : ''} onClick={() => p.setMaterialView('blocks')}>
            Material
          </button>
          <button
            role="tab"
            aria-selected={v === 'raw'}
            class={v === 'raw' ? 'is-on' : ''}
            onClick={() => p.setMaterialView('raw')}
            title="Was abgebaut oder gesammelt werden muss, über die Rezepte zurückgerechnet"
          >
            Rohstoffe
          </button>
        </div>
      )}
      <div class="segmented segmented-wide scope-switch" role="radiogroup" aria-label="Umfang der Liste">
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
      {v === 'raw' ? (
        <RawMaterials project={p} summary={s} scopeText={scopeText} />
      ) : (
        <BlockMaterials project={p} summary={s} scopeText={scopeText} mode={mode} pinned={pinned} copy={copy} />
      )}
    </section>
  );
}

function BlockMaterials({
  project: p,
  summary: s,
  scopeText,
  mode,
  pinned,
  copy,
}: {
  project: Project;
  summary: MaterialSummary;
  scopeText: string;
  mode: MaterialMode;
  pinned: string | null;
  copy: () => void;
}) {
  return (
    <>
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
                    onClick={() => {
                      // A block selected by tapping would otherwise keep its card next to the new marking.
                      p.hover.value = null;
                      p.togglePinned(key);
                    }}
                    title={isPinned ? 'Markierung aufheben' : 'Alle Blöcke dieser Sorte im Modell markieren'}
                  >
                    <td class="c-name">
                      <span class="cell-name">
                        <span class="swatch" style={{ background: css(r.swatch) }} />
                        <span class="name">{r.displayName}</span>
                        {r.marked ? <span class="tag tag-red" title="Unbekannter Block">?</span> : null}
                        {r.creativeOnly ? <span class="tag" title="Im Survival nicht erhältlich">C</span> : null}
                      </span>
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
      <p class="material-scope muted">
        Umfang: {scopeText}. {touchFirst.value ? 'Tippe auf eine Zeile' : 'Klick auf eine Zeile'}, um die Blöcke im Modell zu markieren.
      </p>
    </>
  );
}

/** "1.21.1, NeoForge und 12 Mods" */
function catalogLabel(c: Catalog): string {
  const { minecraft, neoforge, mods } = catalogContents(c);
  const parts = [minecraft ?? 'ohne Minecraft', ...(neoforge ? ['NeoForge'] : [])];
  const text = parts.join(', ');
  return mods.length ? `${text} und ${num(mods.length)} ${mods.length === 1 ? 'Mod' : 'Mods'}` : text;
}
