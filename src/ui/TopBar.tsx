import { closeProject } from '../app/importer';
import { activeId, catalog, catalogDialogOpen, debugOpen, helpOpen, importing, projects } from '../app/workspace';
import { IconCatalog, IconClose, IconHelp, IconOpen, IconPackage, Mark } from './icons';

export function TopBar({ onOpen }: { onOpen: () => void }) {
  const list = projects.value;
  const active = activeId.value;
  return (
    <header class="topbar">
      <div class="brand">
        <Mark size={20} />
        <span class="wordmark">Tessera</span>
      </div>
      <nav class="tabs" aria-label="Offene Projekte">
        {list.map((p) => {
          const progress = p.meshProgress.value;
          return (
            <div class={`tab${p.id === active ? ' is-active' : ''}`} key={p.id}>
              <button
                class="tab-label"
                title={`${p.fileName} – ${p.data.formatLabel}`}
                onClick={() => (activeId.value = p.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) closeProject(p.id);
                }}
              >
                {p.name}
                {progress && progress.total > 1 ? <span class="tab-busy" aria-label="wird aufgebaut" /> : null}
              </button>
              <button class="tab-close" title="Tab schließen" aria-label={`${p.name} schließen`} onClick={() => closeProject(p.id)}>
                <IconClose size={12} />
              </button>
            </div>
          );
        })}
        {importing.value.map((f) => (
          <div class="tab is-loading" key={`loading-${f.fileName}`}>
            <span class="tab-label">{f.fileName}</span>
            <span class="tab-busy" />
          </div>
        ))}
        <button class="btn btn-ghost open-btn" onClick={onOpen} title="Schematic öffnen (Strg+O)" aria-label="Schematic öffnen">
          <IconOpen /> <span class="btn-label">Öffnen</span>
        </button>
      </nav>
      <div class="topbar-actions">
        <button
          class={`btn btn-ghost${catalog.value ? '' : ' needs-catalog'}`}
          onClick={() => (catalogDialogOpen.value = true)}
          title={catalog.value ? 'Block-Katalog: eingelesenes Modpack' : 'Modpack einlesen: echte Namen, Farben und Rezepte'}
          aria-label="Block-Katalog"
        >
          <IconCatalog /> <span class="btn-label">{catalog.value ? 'Katalog' : 'Modpack einlesen'}</span>
        </button>
        <button
          class="btn btn-ghost"
          onClick={() => (debugOpen.value = true)}
          title="Debug-Paket für Claude exportieren"
          aria-label="Debug-Paket"
        >
          <IconPackage /> <span class="btn-label">Debug-Paket</span>
        </button>
        <button class="btn btn-icon btn-ghost" onClick={() => (helpOpen.value = true)} title="Bedienung (?)" aria-label="Bedienung">
          <IconHelp />
        </button>
      </div>
    </header>
  );
}
