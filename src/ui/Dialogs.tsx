import { useEffect, useRef, useState } from 'preact/hooks';
import { Fragment, type ComponentChildren } from 'preact';
import { getPool, getViewer } from '../app/viewController';
import { activeId, activeProject, debugOpen, helpOpen, lastBenchmark, projects, showToast } from '../app/workspace';
import { buildDebugPackage, downloadBlob } from '../debug/debugPackage';
import { browserLabel, collectEnvironment, type EnvironmentInfo } from '../debug/environment';
import { log } from '../debug/log';
import { BUILD_TIME, STAGE, VERSION } from '../version';
import { IconClose, IconPackage } from './icons';
import { num } from './format';

function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      class={`dialog${wide ? ' is-wide' : ''}`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div class="dialog-head">
        <h2>{title}</h2>
        <button class="btn btn-icon btn-ghost" onClick={onClose} aria-label="Schließen">
          <IconClose />
        </button>
      </div>
      <div class="dialog-body">{children}</div>
    </dialog>
  );
}

export function Dialogs() {
  return (
    <>
      {helpOpen.value ? <HelpDialog /> : null}
      {debugOpen.value ? <DebugDialog /> : null}
    </>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Pfeil hoch / runter', 'Ebene wechseln (startet den Schnitt-Modus)'],
  ['Bild hoch / runter', '10 Ebenen weiter'],
  ['Pos1 / Ende', 'unterste / oberste Ebene'],
  ['Leertaste', 'aktuelle Ebene als fertig abhaken'],
  ['S', 'Schnitt oder Einzel-Ebene umschalten'],
  ['Esc', 'Gesamtansicht, Markierung lösen'],
  ['F', 'ganzes Modell zeigen'],
  ['T', 'Draufsicht als Bauplan (ohne Perspektive)'],
  ['Strg + O', 'Schematic öffnen'],
];

function HelpDialog() {
  return (
    <Dialog title="Bedienung" onClose={() => (helpOpen.value = false)}>
      <h3>Maus</h3>
      <dl class="keys">
        <dt>Linke Maustaste ziehen</dt>
        <dd>drehen</dd>
        <dt>Rechte Maustaste ziehen</dt>
        <dd>verschieben</dd>
        <dt>Mausrad</dt>
        <dd>zoomen (zum Mauszeiger hin)</dd>
        <dt>Klick auf einen Block</dt>
        <dd>alle Blöcke dieser Sorte markieren</dd>
        <dt>Mausrad über dem Ebenen-Regler</dt>
        <dd>Ebene wechseln</dd>
      </dl>
      <h3>Tastatur</h3>
      <dl class="keys">
        {SHORTCUTS.map(([k, v]) => (
          <Fragment key={k}>
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{v}</dd>
          </Fragment>
        ))}
      </dl>
      <p class="muted fine">
        Tessera {VERSION}, {STAGE}. Gebaut {BUILD_TIME ? new Date(BUILD_TIME).toLocaleString('de-DE') : 'lokal'}.
      </p>
    </Dialog>
  );
}

function DebugDialog() {
  const [env, setEnv] = useState<EnvironmentInfo | null>(null);
  const [include, setInclude] = useState<'active' | 'all' | 'none'>('active');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void collectEnvironment().then(setEnv);
  }, []);
  const p = activeProject.value;
  const viewer = getViewer();
  const pool = getPool();
  const webgl = viewer?.webglInfo() ?? null;

  const save = async () => {
    setBusy(true);
    try {
      const { blob, fileName } = await buildDebugPackage({
        projects: projects.value,
        activeId: activeId.value,
        includeProjectFiles: include,
        webgl,
        frame: viewer ? { ...viewer.frameStats } : null,
        benchmark: lastBenchmark.value,
        meshPool: pool ? { mode: pool.mode, workers: pool.workerCount, pending: pool.pending } : null,
      });
      downloadBlob(blob, fileName);
      showToast('success', `${fileName} gespeichert.`);
      debugOpen.value = false;
    } catch (e) {
      log.error('debug', 'Debug-Paket konnte nicht erstellt werden', e);
      showToast('error', 'Debug-Paket konnte nicht erstellt werden.', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const fsa = env?.features.fileSystemAccess;
  return (
    <Dialog title="Debug-Paket" onClose={() => (debugOpen.value = false)} wide>
      <p>
        Das Paket ist eine ZIP-Datei, die du Claude direkt geben kannst. Es enthält das Protokoll mit Fehlern und Warnungen, Version, Browser,
        Leistungswerte und die Liste unbekannter Blöcke.
      </p>
      <fieldset class="choice">
        <legend>Projektdateien beilegen</legend>
        <label>
          <input type="radio" name="inc" checked={include === 'active'} onChange={() => setInclude('active')} disabled={!p} />
          Aktives Projekt{p ? ` (${p.fileName})` : ''}
        </label>
        <label>
          <input type="radio" name="inc" checked={include === 'all'} onChange={() => setInclude('all')} disabled={projects.value.length === 0} />
          Alle offenen Projekte ({num(projects.value.length)})
        </label>
        <label>
          <input type="radio" name="inc" checked={include === 'none'} onChange={() => setInclude('none')} />
          Keine
        </label>
      </fieldset>
      <h3>Diese Umgebung</h3>
      <dl class="facts facts-wide">
        <dt>Tessera</dt>
        <dd>
          {VERSION}, {STAGE}
        </dd>
        <dt>Browser</dt>
        <dd>{env ? browserLabel(env) : '…'}</dd>
        <dt>Grafik</dt>
        <dd>{webgl ? String(webgl.renderer) : '…'}</dd>
        <dt>Meshing</dt>
        <dd>{pool ? (pool.mode === 'workers' ? `${pool.workerCount} Web Worker` : 'Hauptthread (keine Worker)') : '…'}</dd>
        <dt>Ordner-Zugriff</dt>
        <dd class={fsa === false ? 'warn' : ''}>
          {env === null
            ? '…'
            : fsa
              ? 'verfügbar (File System Access API)'
              : env.isBrave
                ? 'abgeschaltet – in Brave unter brave://flags „File System Access API“ aktivieren'
                : 'nicht verfügbar in diesem Browser'}
        </dd>
        <dt>Speicher</dt>
        <dd>
          {env?.features.storagePersisted === true
            ? 'dauerhaft'
            : env?.features.storagePersisted === false
              ? 'nicht dauerhaft (Browser darf aufräumen)'
              : 'unbekannt'}
          {env?.features.storageEstimateMb ? `, ${num(env.features.storageEstimateMb.usage)} MB belegt` : ''}
        </dd>
        <dt>Protokoll</dt>
        <dd>
          {num(log.all().length)} Einträge, davon {num(log.counts.error)} Fehler und {num(log.counts.warn)} Warnungen
        </dd>
      </dl>
      <div class="dialog-actions">
        <button class="btn btn-primary" onClick={save} disabled={busy}>
          <IconPackage /> {busy ? 'Erstelle …' : 'Debug-Paket speichern'}
        </button>
      </div>
    </Dialog>
  );
}
