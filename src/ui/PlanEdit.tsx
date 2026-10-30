import { useEffect, useState } from 'preact/hooks';
import { makeState, type BlockState } from '../core/blockstate';
import {
  blockAt,
  canRedo,
  canUndo,
  editable,
  editTarget,
  fileCell,
  isEditing,
  openVersion,
  redo,
  replaceCell,
  restoreVersion,
  setCell,
  setEditing,
  swapSort,
  turnPlan,
  undo,
  versionsFor,
  versionsOf,
  type VersionEntry,
} from '../app/planEdit';
import type { Project } from '../app/project';
import { catalog, projects } from '../app/workspace';
import { readableName } from '../blocks/names';
import { shortId } from '../tess/edit';
import { num } from './format';

/**
 * Building plans in the app (Etappe 4c): choosing a Bauabschnitt, and editing. Every edit is
 * written into the .tess file (palette swap in the rolle line, turning and mirroring through
 * `ausrichtung`, single blocks in the section "Änderungen in Tessera"), with undo, redo and
 * versions.
 */

/** "Ganzes Gebäude" or one Bauabschnitt: layers, materials and progress follow the choice. */
export function SectionPicker({ project: p }: { project: Project }) {
  const names = p.sections;
  if (names.length < 2) return null;
  return (
    <label class="section-pick">
      <span class="muted">Bauabschnitt</span>
      <select value={String(p.section.value)} onChange={(e) => p.setSection(Number((e.currentTarget as HTMLSelectElement).value))}>
        <option value="0">Ganzes Gebäude</option>
        {names.slice(1).map((n, i) => (
          <option key={n} value={String(i + 1)}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Block ids to suggest: the catalog's, else the blocks of this plan. */
function suggestions(p: Project): string[] {
  const c = catalog.value;
  const ids = c ? Object.keys(c.blocks) : p.data.volume.palette.map((s) => s.name);
  return [...new Set(ids.filter((n) => n !== 'minecraft:air').map(shortId))].sort();
}

/** Search for a block id (catalog search): type and pick from the list, Enter takes it. */
export function BlockPicker({ project: p, onPick, onCancel, initial = '' }: { project: Project; onPick: (id: string) => void; onCancel: () => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  const list = `blocks-${p.id}`;
  const ok = /^[a-z0-9_.:/-]+$/i.test(value.trim());
  return (
    <div class="block-pick">
      <input
        type="search"
        list={list}
        value={value}
        placeholder="Block suchen, z. B. spruce_planks"
        autoFocus
        onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && ok) onPick(value.trim().toLowerCase());
          if (e.key === 'Escape') onCancel();
        }}
      />
      <datalist id={list}>
        {suggestions(p).map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <button class="btn" disabled={!ok} onClick={() => onPick(value.trim().toLowerCase())}>
        Übernehmen
      </button>
      <button class="btn btn-ghost" onClick={onCancel}>
        Abbrechen
      </button>
    </div>
  );
}

/** Edit panel of a building plan: undo/redo, turning, mirroring, versions, edit mode, roles. */
export function PlanEditPanel({ project: p }: { project: Project }) {
  if (!p.isPlan) return null;
  if (p.readOnly) {
    return (
      <section class="panel">
        <h3 class="panel-title">Bearbeiten</h3>
        <p class="muted">Diese Version ist schreibgeschützt. Wiederherstellen geht über „Versionen“ im Tab des Bauplans.</p>
      </section>
    );
  }
  if (!editable(p)) {
    return (
      <section class="panel">
        <h3 class="panel-title">Bearbeiten</h3>
        <p class="muted">Bearbeiten gibt es für Baupläne in Bau-Sprache 2 (tess 2).</p>
      </section>
    );
  }
  const editing = isEditing(p);
  const o = p.data.plan!.orient;
  return (
    <section class="panel">
      <div class="panel-head">
        <h3>Bearbeiten</h3>
        <button class={`btn${editing ? ' btn-primary' : ''}`} aria-pressed={editing} onClick={() => setEditing(p, !editing)} title="Im Bearbeiten-Modus öffnet ein Klick auf einen Block ein Menü">
          {editing ? 'Bearbeiten an' : 'Einzelblöcke bearbeiten'}
        </button>
      </div>
      {editing ? <p class="muted edit-help">Klick auf einen Block: Entfernen, Ersetzen oder Zustand. Die Änderung steht danach am Ende der Datei.</p> : null}
      <div class="edit-row">
        <button class="btn" disabled={!canUndo(p)} onClick={() => void undo(p)} title="Rückgängig (Strg+Z)">
          Rückgängig
        </button>
        <button class="btn" disabled={!canRedo(p)} onClick={() => void redo(p)} title="Wiederholen (Strg+Y oder Strg+Umschalt+Z)">
          Wiederholen
        </button>
        <button class="btn btn-ghost" onClick={() => (versionsFor.value = p.id)} title="Frühere Fassungen dieser Datei">
          Versionen
        </button>
      </div>
      <div class="edit-row">
        <span class="muted">Ganzer Plan:</span>
        <button class="btn" onClick={() => void turnPlan(p, 'turn')} title="Um 90° im Uhrzeigersinn drehen (Zeile „ausrichtung“)">
          Drehen 90°
        </button>
        <button class="btn" onClick={() => void turnPlan(p, 'x')} title="Ost und West tauschen">
          Spiegeln x
        </button>
        <button class="btn" onClick={() => void turnPlan(p, 'z')} title="Nord und Süd tauschen">
          Spiegeln z
        </button>
      </div>
      {o.turn || o.mirror ? (
        <p class="muted edit-help">
          Ausrichtung: {o.turn ? `gedreht um ${o.turn}°` : ''}
          {o.turn && o.mirror ? ', ' : ''}
          {o.mirror ? `gespiegelt (${o.mirror})` : ''}
        </p>
      ) : null}
      <Roles project={p} />
    </section>
  );
}

/** Palette swap: every role with its sorts; a sort gets another block, the weight stays. */
function Roles({ project: p }: { project: Project }) {
  const [open, setOpen] = useState<string | null>(null);
  const roles = p.data.plan?.roles ?? [];
  if (!roles.length) return null;
  return (
    <div class="roles">
      <h4 class="roles-title">Rollen</h4>
      <ul class="roles-list">
        {roles.map((r) => (
          <li key={r.name}>
            <span class="role-name" title={`Zeile ${r.line}`}>
              {r.name}
            </span>
            <span class="role-sorts">
              {r.sorts.map((s, i) => {
                const key = `${r.name}|${i}`;
                return open === key ? (
                  <BlockPicker
                    key={key}
                    project={p}
                    initial={shortId(s.id)}
                    onCancel={() => setOpen(null)}
                    onPick={(id) => {
                      setOpen(null);
                      void swapSort(p, r.name, i, id);
                    }}
                  />
                ) : (
                  <button key={key} class="role-sort" title={`${s.id} tauschen`} onClick={() => setOpen(key)}>
                    {readableName(s.id)}
                    {r.sorts.length > 1 ? <span class="muted"> {s.weight}</span> : null}
                  </button>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const BOOL = ['true', 'false'];
function valuesFor(key: string, value: string, name: string): string[] | null {
  if (key === 'facing') return ['north', 'east', 'south', 'west', 'up', 'down'];
  if (key === 'half') return value === 'upper' || value === 'lower' ? ['lower', 'upper'] : ['bottom', 'top'];
  if (key === 'axis') return ['x', 'y', 'z'];
  if (key === 'type' && name.endsWith('_slab')) return ['bottom', 'top', 'double'];
  if (key === 'hinge') return ['left', 'right'];
  if (key === 'rotation') return Array.from({ length: 16 }, (_, i) => String(i));
  if (BOOL.includes(value)) return BOOL;
  return null;
}

/** Menu of a clicked block in edit mode: remove, replace, change its state. */
export function EditMenu() {
  const t = editTarget.value;
  const p = t ? projects.value.find((x) => x.id === t.id) : null;
  const [mode, setMode] = useState<'menu' | 'replace' | 'state'>('menu');
  useEffect(() => setMode('menu'), [t?.x, t?.y, t?.z, t?.id]);
  if (!t || !p || !isEditing(p)) return null;
  const block = blockAt(p, t.x, t.y, t.z);
  if (!block) return null;
  const [fx, fy, fz] = fileCell(p, t.x, t.y, t.z);
  const close = () => (editTarget.value = null);
  const style = { left: `${Math.min(t.left, window.innerWidth - 300)}px`, top: `${Math.min(t.top, window.innerHeight - 260)}px` };
  return (
    <div class="edit-menu" style={style} role="dialog" aria-label="Block bearbeiten">
      <div class="edit-menu-head">
        <strong>{readableName(block.name)}</strong>
        <span class="muted">
          {fx},{fy},{fz}
        </span>
      </div>
      {mode === 'menu' ? (
        <div class="edit-menu-actions">
          <button
            class="btn"
            onClick={() => {
              close();
              void setCell(p, t.x, t.y, t.z, null);
            }}
          >
            Entfernen
          </button>
          <button class="btn" onClick={() => setMode('replace')}>
            Ersetzen
          </button>
          <button class="btn" disabled={!Object.keys(block.props).length} onClick={() => setMode('state')}>
            Zustand
          </button>
          <button class="btn btn-ghost" onClick={close}>
            Schließen
          </button>
        </div>
      ) : mode === 'replace' ? (
        <BlockPicker
          project={p}
          onCancel={() => setMode('menu')}
          onPick={(id) => {
            close();
            void replaceCell(p, t.x, t.y, t.z, id);
          }}
        />
      ) : (
        <StateEditor
          block={block}
          onCancel={() => setMode('menu')}
          onSave={(s) => {
            close();
            void setCell(p, t.x, t.y, t.z, s);
          }}
        />
      )}
    </div>
  );
}

function StateEditor({ block, onSave, onCancel }: { block: BlockState; onSave: (s: BlockState) => void; onCancel: () => void }) {
  const [props, setProps] = useState<Record<string, string>>({ ...block.props });
  const keys = Object.keys(props).filter((k) => !(k === 'shape' && block.name.endsWith('_stairs')));
  return (
    <div class="state-edit">
      {keys.map((k) => {
        const opts = valuesFor(k, block.props[k], block.name);
        return (
          <label key={k}>
            <span>{k}</span>
            {opts ? (
              <select value={props[k]} onChange={(e) => setProps({ ...props, [k]: (e.currentTarget as HTMLSelectElement).value })}>
                {opts.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <input value={props[k]} onInput={(e) => setProps({ ...props, [k]: (e.currentTarget as HTMLInputElement).value })} />
            )}
          </label>
        );
      })}
      <div class="edit-menu-actions">
        <button class="btn btn-primary" onClick={() => onSave(makeState(block.name, props))}>
          Übernehmen
        </button>
        <button class="btn btn-ghost" onClick={onCancel}>
          Zurück
        </button>
      </div>
    </div>
  );
}

/** Versions of the tab's file: open read-only or restore (the current text is kept first). */
export function VersionsContent({ project: p }: { project: Project }) {
  const [list, setList] = useState<VersionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    versionsOf(p)
      .then((l) => alive && setList(l))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [p.id, p.source]);
  const where = p.link.value ? `projekte/.versionen/${p.link.value.name.replace(/\.tess$/i, '')}/` : 'im Browser-Speicher';
  return (
    <div class="versions">
      <p class="muted">
        Vor jedem Schreiben aus Tessera und vor dem Übernehmen einer Änderung von außen sichert Tessera die bisherige Fassung, die 50 neuesten bleiben. Ablage: <code>{where}</code>
      </p>
      {error ? <p class="warn">{error}</p> : null}
      {list === null ? (
        <p class="muted">Lese Versionen …</p>
      ) : list.length === 0 ? (
        <p class="muted">Noch keine Versionen.</p>
      ) : (
        <ul class="version-list">
          {list.map((v) => (
            <li key={v.name}>
              <span>{v.label}</span>
              <span class="version-actions">
                <button class="btn" onClick={() => void openVersion(p, v.name)} title="Als schreibgeschützten Tab öffnen">
                  Öffnen
                </button>
                <button
                  class="btn"
                  onClick={async () => {
                    if (!window.confirm(`Fassung vom ${v.label} wiederherstellen? Die aktuelle Fassung wird vorher gesichert.`)) return;
                    await restoreVersion(p, v.name);
                    versionsFor.value = null;
                  }}
                >
                  Wiederherstellen
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p class="muted">{num(list?.length ?? 0)} von höchstens 50</p>
    </div>
  );
}
