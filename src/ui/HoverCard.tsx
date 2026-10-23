import type { HoverInfo, Project } from '../app/project';
import { propLabel, valueLabel } from '../blocks/names';
import { css, num } from './format';

/** Details of the block under the cursor. */
export function HoverDetails({ project: p, hover: h, pinned }: { project: Project; hover: HoverInfo; pinned: boolean }) {
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
      {entry.colors.marked ? (
        <p class="hc-warn">
          {entry.state.name.startsWith('minecraft:')
            ? 'Unbekannter Block: Farbe ist geraten.'
            : 'Mod-Block: Farbe und Name kommen mit dem Block-Katalog (Etappe 2).'}
        </p>
      ) : null}
      {p.outlineInfo.value.limit === 'layer' ? (
        <p class="hc-hint">Zu viele für Umrisse: Umrisse nur in dieser Ebene, die Färbung zeigt alle.</p>
      ) : p.outlineInfo.value.limit === 'off' ? (
        <p class="hc-hint">Zu viele für Umrisse: die Färbung zeigt alle {num(p.outlineInfo.value.total)}.</p>
      ) : null}
      <p class="hc-hint">{pinned ? 'Festgehalten. Klick ins Leere löst die Auswahl.' : 'Klick hält alle Blöcke dieses Typs markiert.'}</p>
    </>
  );
}
