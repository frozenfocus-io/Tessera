import type { HoverInfo, Project } from '../app/project';
import { propLabel, valueLabel } from '../blocks/names';
import { blockName } from '../catalog/runtime';
import { css, num } from './format';

/** Details of the block under the cursor (or under the finger that tapped it). */
export function HoverDetails({ project: p, hover: h, pinned, touch = false }: { project: Project; hover: HoverInfo; pinned: boolean; touch?: boolean }) {
  const entry = p.model.entries[h.palette];
  const type = p.model.types[h.typeId];
  const props = Object.entries(entry.state.props).filter(([k]) => k !== 'waterlogged' || entry.state.props[k] === 'true');
  const inProject = p.typeCount(h.typeId);
  const inLayer = p.typeCountInLayer(h.typeId, h.y);
  const x = h.x - (p.bounds?.minX ?? 0);
  const z = h.z - (p.bounds?.minZ ?? 0);
  return (
    <>
      <div class="hc-head">
        <span class="swatch" style={{ background: css(entry.colors.swatch) }} />
        <div>
          <div class="hc-name">{type.displayName}</div>
          <div class="hc-id">{entry.state.name}</div>
        </div>
      </div>
      {props.length ? (
        <ul class="hc-props">
          {props.map(([k, v]) => (
            <li key={k}>
              <span>{propLabel(k)}</span> {valueLabel(v)}
            </li>
          ))}
        </ul>
      ) : null}
      <dl class="hc-grid">
        <dt>Ebene</dt>
        <dd>
          {p.displayLayer(h.y)} von {p.layerCount}
        </dd>
        <dt>Position</dt>
        <dd title="Gezählt ab der nordwestlichen Ecke des Gebäudes">
          {x + 1}. von Westen, {z + 1}. von Norden
        </dd>
        <dt>Anzahl</dt>
        <dd>
          {num(inProject)} gesamt, {num(inLayer)} in dieser Ebene
        </dd>
      </dl>
      {type.mod && type.mod !== 'minecraft' ? <p class="hc-meta">Mod: {modName(p, type.mod)}</p> : null}
      {type.family && type.family !== type.name ? <p class="hc-meta">Familie: {blockName(p.catalog, type.family)}</p> : null}
      {entry.colors.marked ? (
        <p class="hc-warn">
          {p.catalog
            ? 'Nicht im Katalog: Farbe und Form sind geraten. Fehlt der Mod im eingelesenen Modpack, oder stammt der Block aus einer anderen Version?'
            : 'Noch kein Katalog eingelesen: Farbe und Name sind geraten.'}
        </p>
      ) : null}
      {p.outlineInfo.value.limit === 'layer' ? (
        <p class="hc-hint">Zu viele für Umrisse: Umrisse nur in dieser Ebene, die Färbung zeigt alle.</p>
      ) : p.outlineInfo.value.limit === 'off' ? (
        <p class="hc-hint">Zu viele für Umrisse: die Färbung zeigt alle {num(p.outlineInfo.value.total)}.</p>
      ) : null}
      <p class="hc-hint">
        {touch
          ? 'Alle Blöcke dieser Sorte sind markiert. Tippe ins Leere, um die Auswahl aufzuheben.'
          : pinned
            ? 'Festgehalten. Klick ins Leere löst die Auswahl.'
            : 'Klick hält alle Blöcke dieses Typs markiert.'}
      </p>
    </>
  );
}

function modName(p: Project, id: string): string {
  for (const s of p.catalog?.sources ?? []) {
    const m = s.mods.find((x) => x.id === id);
    if (m) return m.name;
  }
  return id;
}
