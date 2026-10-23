import { useEffect, useRef, useState } from 'preact/hooks';
import { catalogRun, importCatalog, resetCatalogRun } from '../app/catalogImport';
import { removeCatalog } from '../app/catalogState';
import { catalog, catalogOrigin, touchFirst } from '../app/workspace';
import { findMinecraftFiles, findModFiles, pickedFromInput, TARGET_VERSION, type MinecraftFiles, type ModFiles } from '../catalog/folders';
import { catalogContents } from '../catalog/runtime';
import type { Catalog } from '../catalog/types';
import { num } from './format';

/**
 * "Modpack einlesen": the user points Tessera at the Minecraft folder and the mods folder of
 * the client instance; Tessera reads blockstates, models, textures, names, tags and recipes.
 */
export function CatalogContent() {
  const c = catalog.value;
  return (
    <>
      <CatalogStatus c={c} />
      <ImportForm />
    </>
  );
}

function CatalogStatus({ c }: { c: Catalog | null }) {
  const [showMods, setShowMods] = useState(false);
  if (!c) {
    return (
      <p class="catalog-none">
        Noch kein Katalog eingelesen. Bis dahin sind die Farben geschätzt, die Namen englisch, und alle Mod-Blöcke sind rot markiert.
      </p>
    );
  }
  const { neoforge, mods } = catalogContents(c);
  const date = new Date(c.createdAt);
  return (
    <section class="catalog-status">
      <h3>{catalogOrigin.value === 'bundled' ? 'Mitgelieferter Test-Katalog' : `Eingelesen am ${date.toLocaleDateString('de-DE')}, ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`}</h3>
      <dl class="facts facts-wide">
        <dt>Minecraft</dt>
        <dd>{c.minecraft ?? 'nicht eingelesen'}</dd>
        <dt>NeoForge</dt>
        <dd>{neoforge ?? 'nicht eingelesen'}</dd>
        <dt>Mods</dt>
        <dd>{mods.length ? num(mods.length) : 'keine'}</dd>
        <dt>Blöcke</dt>
        <dd>{num(Object.keys(c.blocks).length)}</dd>
        <dt>Rezepte</dt>
        <dd>{num(c.recipes.length)}</dd>
        <dt>Familien</dt>
        <dd>{num(Object.keys(c.families).length)}</dd>
      </dl>
      {c.warnings.length ? <p class="catalog-notes">{c.warnings.join(' ')}</p> : null}
      <button class="notice-toggle" aria-expanded={showMods} onClick={() => setShowMods(!showMods)}>
        Eingelesene Dateien
      </button>
      {showMods ? (
        <ul class="catalog-sources">
          {c.sources.map((s) => (
            <li key={s.file}>
              <span class="src-name">{s.mods.map((m) => m.name).join(', ') || s.file}</span>
              <span class="muted">
                {num(s.blocks)} Blöcke, {num(s.recipes)} Rezepte
              </span>
              {s.warnings.length ? <span class="catalog-warn">{s.warnings.slice(0, 2).join(' ')}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function DirInput({ onPick, label, directory, accept }: { onPick: (files: FileList) => void; label: string; directory: boolean; accept?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      // Not in the TypeScript DOM types, but supported by all desktop browsers.
      (ref.current as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = directory;
    }
  }, [directory]);
  return (
    <>
      <button class={`btn${directory ? ' btn-primary' : ''}`} onClick={() => ref.current?.click()}>
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        multiple
        hidden
        accept={directory ? undefined : accept}
        onChange={(e) => {
          const input = e.currentTarget;
          if (input.files?.length) onPick(input.files);
          input.value = '';
        }}
      />
    </>
  );
}

function ImportForm() {
  const [mc, setMc] = useState<MinecraftFiles | null>(null);
  const [mods, setMods] = useState<ModFiles | null>(null);
  const [scanning, setScanning] = useState(false);
  const run = catalogRun.value;
  const busy = !!run && !run.done && !run.error;
  const canDirs = !touchFirst.value;

  const pickMinecraft = async (files: FileList) => {
    setScanning(true);
    try {
      setMc(await findMinecraftFiles(pickedFromInput(files)));
    } finally {
      setScanning(false);
    }
  };
  const pickMods = (files: FileList) => setMods(findModFiles(pickedFromInput(files)));

  const start = () => {
    if (!mc?.jar && !mods?.mods.length) return;
    // NeoForge goes first: mods may override its versions of recipes and tags.
    const jars = [...(mc?.loader ? [mc.loader.file] : []), ...(mods?.mods.map((m) => m.file) ?? [])];
    void importCatalog({ minecraft: mc?.jar?.file ?? null, languageDe: mc?.languageDe?.file ?? null, mods: jars });
  };

  return (
    <section class="catalog-import">
      <h3>Modpack einlesen</h3>
      <p class="muted">
        Tessera liest aus den Spieldateien nur Bilder und Textdateien: Blöcke, Formen, Farben, Namen, Familien und Rezepte. Es wird kein Code ausgeführt, und nichts
        verlässt deinen PC. Das dauert je nach Modpack Sekunden bis etwa eine Minute und ist nur nötig, wenn sich das Modpack ändert.
      </p>
      <ol class="catalog-steps">
        <li>
          <div class="step-title">Minecraft-Ordner</div>
          <p class="muted">
            Der Ordner mit „versions“, „libraries“ und „assets“. Bei CurseForge ist das <code>curseforge\minecraft\Install</code>, beim normalen
            Launcher <code>%appdata%\.minecraft</code>. Darin sucht Tessera die Datei {TARGET_VERSION}.jar, NeoForge und die deutschen Namen.
          </p>
          <div class="step-actions">
            {canDirs ? <DirInput directory label="Ordner wählen" onPick={(f) => void pickMinecraft(f)} /> : null}
            <DirInput directory={false} accept=".jar" label={`${TARGET_VERSION}.jar wählen`} onPick={(f) => void pickMinecraft(f)} />
          </div>
          {scanning ? <p class="step-result">Suche …</p> : null}
          {mc ? (
            <p class={`step-result${mc.jar ? ' is-ok' : ' is-bad'}`}>
              {mc.jar ? `Minecraft ${mc.version} gefunden${mc.languageDe ? ', mit deutschen Namen' : ''}${mc.loader ? ` und NeoForge ${mc.loaderVersion}` : ''}.` : 'Keine Minecraft-Jar gefunden.'}{' '}
              {mc.notes.join(' ')}
            </p>
          ) : null}
        </li>
        <li>
          <div class="step-title">Mods-Ordner</div>
          <p class="muted">
            Der Ordner „mods“ deines Modpacks, bei CurseForge <code>curseforge\minecraft\Instances\&lt;Modpack&gt;\mods</code>.
          </p>
          <div class="step-actions">
            {canDirs ? <DirInput directory label="Ordner wählen" onPick={pickMods} /> : null}
            <DirInput directory={false} accept=".jar" label="Jar-Dateien wählen" onPick={pickMods} />
          </div>
          {mods ? (
            <p class={`step-result${mods.mods.length ? ' is-ok' : ' is-bad'}`}>
              {num(mods.mods.length)} Mods gefunden{mods.disabled ? `, ${num(mods.disabled)} deaktiviert (werden übersprungen)` : ''}.
            </p>
          ) : null}
        </li>
      </ol>
      {!mc?.jar && mods?.mods.length ? (
        <p class="catalog-warn">Ohne die Minecraft-Jar fehlen die Grundmodelle, auf denen fast alle Mod-Blöcke aufbauen. Besser zuerst den Minecraft-Ordner wählen.</p>
      ) : null}
      <div class="dialog-actions">
        <button class="btn btn-primary" disabled={busy || (!mc?.jar && !mods?.mods.length)} onClick={start}>
          {busy ? 'Liest ein …' : 'Einlesen'}
        </button>
      </div>
      {run ? <RunStatus /> : null}
      {catalog.value && catalogOrigin.value === 'imported' && !busy ? (
        <p class="catalog-remove">
          <button
            class="btn btn-ghost"
            onClick={() => {
              resetCatalogRun();
              void removeCatalog();
            }}
          >
            Katalog entfernen
          </button>
        </p>
      ) : null}
    </section>
  );
}

function RunStatus() {
  const run = catalogRun.value;
  if (!run) return null;
  const p = run.progress;
  const pct = p ? Math.round((p.done / Math.max(1, p.total)) * 100) : 0;
  const label = !p
    ? 'Starte …'
    : p.phase === 'jar'
      ? `Lese ${p.label ?? ''} (${num(p.done + 1)} von ${num(p.total)})`
      : p.phase === 'models'
        ? `Löse Modelle auf (${num(p.done)} von ${num(p.total)} Blöcken)`
        : p.phase === 'recipes'
          ? `Lese Rezepte (${num(p.done)} von ${num(p.total)})`
          : 'Fertig';
  return (
    <div class="catalog-run" role="status">
      {run.error ? (
        <p class="catalog-warn">Einlesen fehlgeschlagen: {run.error}</p>
      ) : run.done ? (
        <p class="step-result is-ok">
          Fertig in {num(Math.round(run.done.ms / 100) / 10)} s: {num(Object.keys(run.done.catalog.blocks).length)} Blöcke und {num(run.done.catalog.recipes.length)}{' '}
          Rezepte aus {run.done.catalog.sources.length === 1 ? 'einer Datei' : `${num(run.done.catalog.sources.length)} Dateien`}.
        </p>
      ) : (
        <>
          <div class="progress-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <p class="muted">{label}</p>
        </>
      )}
    </div>
  );
}
