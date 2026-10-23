import { useEffect } from 'preact/hooks';
import { openFromFolder } from '../app/planFiles';
import { projects } from '../app/workspace';
import { chooseFolder, folderFiles, folderName, folderStatus, grantAccess, PROJECT_DIR, refreshFolder } from '../platform/folder';
import { bytes } from './format';
import { IconFolder } from './icons';

/** Content of the "Projekte" dialog: the project folder and the building plans in it. */
export function FolderContent({ onOpened }: { onOpened: () => void }) {
  const status = folderStatus.value;
  useEffect(() => {
    if (status === 'ready') void refreshFolder();
  }, [status]);

  if (status === 'unsupported') {
    return (
      <>
        <p>
          Dieser Browser erlaubt Tessera keinen Ordner auf der Festplatte (File System Access API). In Brave lässt sich das einschalten: <code>brave://flags</code>{' '}
          öffnen, nach „File System Access API“ suchen, auf „Enabled“ stellen und Brave neu starten.
        </p>
        <p class="muted">
          Bis dahin öffnest du Baupläne (<code>.tess</code>) über „Öffnen“ oder per Ziehen ins Fenster; „Speichern“ lädt die Datei herunter.
        </p>
      </>
    );
  }

  if (status === 'none') {
    return (
      <>
        <p>
          Wähle einmal einen Ordner für deine Projekte, z. B. „Tessera“ in deinen Dokumenten. Tessera legt darin den Unterordner <code>{PROJECT_DIR}</code> an und
          speichert die Baupläne dort als <code>.tess</code>-Dateien. Den Ordner kannst du sichern oder per Cloud synchronisieren.
        </p>
        <div class="dialog-actions">
          <button class="btn btn-primary" onClick={() => void chooseFolder()}>
            <IconFolder /> Projektordner wählen
          </button>
        </div>
      </>
    );
  }

  if (status === 'needs-permission') {
    return (
      <>
        <p>
          Nach einem Neustart fragt der Browser einmal nach, ob Tessera den Ordner „{folderName.value}“ weiter benutzen darf. Bis dahin zeigen die Tabs die zuletzt
          gelesene Fassung.
        </p>
        <div class="dialog-actions">
          <button class="btn btn-ghost" onClick={() => void chooseFolder()}>
            Anderen Ordner wählen
          </button>
          <button class="btn btn-primary" onClick={() => void grantAccess()}>
            <IconFolder /> Zugriff auf „{folderName.value}“ erlauben
          </button>
        </div>
      </>
    );
  }

  const files = folderFiles.value;
  const linked = new Set(projects.value.map((p) => p.link.value?.name).filter(Boolean));
  return (
    <>
      <p>
        Ordner: <code>{`${folderName.value}/${PROJECT_DIR}`}</code>. Ändert sich eine Datei dort, baut Tessera den offenen Tab neu auf; Kamera, Ebene und Fortschritt
        bleiben.
      </p>
      {files.length ? (
        <ul class="file-list">
          {files.map((f) => (
            <li key={f.name}>
              <button
                class="file-row"
                onClick={() => {
                  void openFromFolder(f.name);
                  onOpened();
                }}
              >
                <span class="file-name">{f.name.replace(/\.tess$/i, '')}</span>
                <span class="muted">
                  {new Date(f.lastModified).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} · {bytes(f.size)}
                </span>
                {linked.has(f.name) ? <span class="badge">offen</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted">
          Noch keine Baupläne im Ordner. Lege <code>.tess</code>-Dateien hinein oder öffne einen Bauplan und speichere ihn über „Im Projektordner speichern“.
        </p>
      )}
      <div class="dialog-actions">
        <button class="btn btn-ghost" onClick={() => void chooseFolder()}>
          Anderen Ordner wählen
        </button>
        <button class="btn btn-ghost" onClick={() => void refreshFolder()}>
          Aktualisieren
        </button>
      </div>
    </>
  );
}
