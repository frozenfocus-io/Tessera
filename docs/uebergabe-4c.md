# Übergabe Etappe 4c

Stand 30.10.2026, Branch `etappe-4c` auf `main` (0.4.1 mit Vorarbeit), Endstand von Teil 4c (Version 0.4.2). Ergänzt `docs/uebergabe-4b.md`, `docs/vorarbeit-4c.md`, `docs/bau-sprache.md` (Ist-Referenz) und `docs/future-fixes.md`. Etappe 4 ist damit vollständig.

## 1. Stand

- **Pull Request:** `etappe-4c` gegen `main`.
- **Prüfung am 30.10.:**
  - `npm test` mit `TESSERA_MCMETA_BLOCKS`: 351 Tests, 349 grün, 0 rot, 2 übersprungen (Minecraft-Jar und Beispiel-Schematic). Ohne mcmeta: 348 grün, 3 übersprungen.
  - Alle Dateien in `beispiele/` ohne Fehler und Hinweise, jede in unter 1 Sekunde; `haus-mit-rundturm.tess` blockgenau wie 0.3.0.
  - `typecheck` und `build` ohne Fehler. Bearbeiten-Ablauf headless im Browser mit privatem Dateisystem als Projektordner durchgespielt (Tausch, Drehen, Strg+Z/Y, Einzelblock, Versionen, schreibgeschützter Tab).

## 2. Umsetzung

- **Grenzen (10, 12):** `executed` zählt jede ausgeführte Anweisung (auch in Schleifen und Modulen), `placed` jeden gesetzten Block; Dachgruppen zählen nur die Zellen, die sie neu füllen (`addRoof`). `grid.sets` zählt weiter alles (nur Tests). Für Tests senkbar über `CompileOptions.limits`.
- **Parser:** `modul`, `wiederhole`, `spiegle` nehmen Anweisungen bis `ende` als `body` (`nest` in `syntax.ts`). Anweisungen kennen ihre letzte Zeile (`lastLine`), `zeichen` sein Zeichen roh (`glyph`, auch `#`).
- **Ausführung (`compile.ts`):** `execList` statt einer flachen Schleife; Gültigkeitsbereiche als `frames` (Datei, Modul, Schleife), sichtbar über `visibleFrames()` wie geschrieben. Der Kontext eines Laufs steht in `compile-base.ts`: `xf` (lokal → absolut), `chain`/`ctx` (Modulkette), `iter` (Durchlauf), `section`, `prefixes`/`suffixes` (Namen `turm1.t`, `t_s`).
- **Drehen und Spiegeln (`xform.ts`, `turngrid.ts`):** `Xf` bildet Zellen ab. `tokens()` rechnet Koordinaten und Höhen (`y=`, `von=`, `bis=`) um; Befehle rechnen Seiten, Winkel, Achsen und Richtungen selbst über `c.xf` um (Liste in `bau-sprache.md`). `turnState` dreht Zustände, `turnWritten` nur was geschrieben ist oder sich dabei ändert. `ausrichtung` dreht das fertige Grid vor `connectBlocks`.
- **Freistil (`freestyle.ts`):** `zeichen`, `ebene`, `ebenen`, `ansicht`; `fest=ja` über `Grid.fixed`.
- **Herkunft und Meldungen:** `Origin` hat `chain`, `ctx`, `section`; `Diagnostic.ctx`; `diagLabel()` für „Zeile 40 (in modul turm, gebaut in Zeile 88)“. Prüfungen tragen die Kette, ein Klick auf einen Hinweis markiert nur die eigene Instanz.
- **App, Bauabschnitte:** `Project.scope` (Analyse, Materialien, Ebenen je Abschnitt), Fortschritt je Abschnitt gespeichert, Grau über eine 3D-Maske im Shader.
- **App, Bearbeiten:** `tess/edit.ts` (Textänderungen), `app/editCore.ts` (Verlauf, Versionsablage, ohne DOM testbar), `app/planEdit.ts` (Ablauf: übersetzen, Version sichern, schreiben, Tab tauschen), `ui/PlanEdit.tsx`. Versionen im Ordner (`folderVersions`) oder im Browser (`browserVersions`, IndexedDB-Version 2).
- **Zielbau:** `beispiele/zauberturm.tess` mit Tests in `test/tess2c.test.ts`; Verhaltenstests für 4c dort und in `test/edit.test.ts`.

## 3. Abweichungen und Entscheidungen

Alle stehen in `docs/bau-sprache.md` unter „Entscheidungen und Erweiterungen (Etappe 4c)“. Die wichtigsten:

- **Gedrehte Instanzen** sind wie von Hand gedreht geschrieben, nicht das exakte Spiegelbild: Formen, Dächer und Prüfungen rechnen absolut (so verlangt), Rundungen bei Gleichstand können um eine Zelle abweichen.
- **Felder im Modul sind lokal**, ein Modul sieht die Datei, nicht das bauende Modul; Standardwerte rechnet die Datei aus.
- **`baue`:** erst spiegeln, dann drehen. `ausrichtung` nicht in Modulen, Schleifen oder `spiegle`.
- **ASCII:** ein Leerzeichen direkt nach `|` gehört zur Zeichnung (das Beispiel der Spezifikation beginnt deshalb eine Spalte rechts).
- **Änderungen in Tessera** melden kein „Überdeckt“. Ein verbundener Tab ohne Ordnerzugriff schreibt nichts. Zwei Versionen in derselben Sekunde heißen `…_2.tess`.

## 4. Offene Punkte

- **Future Fixes:** nicht angefasst. Aus Eintrag 20 sind die Grenzen jetzt umgesetzt (Teil des Auftrags), Adrian kann den Punkt anpassen. Eintrag 18 (Reihenfolge) gilt auch in Modulen: Was ein Modul trägt, muss vorher gebaut sein. Eintrag 19 (Richtungswörter nur bei `facing`) gilt auch für `zeichen`.
- **Bekannte Schwächen:**
  - Rückgängig/Wiederholen lebt im Speicher des Tabs und ist nach dem Neuladen weg (die Versionen bleiben).
  - Versionen aus dem Browser-Speicher wandern nicht mit, wenn der Tab später in den Projektordner kommt.
  - Grau für andere Abschnitte nur bis 2048 Blöcke Kantenlänge.
  - Bearbeiten nur in der Desktop-Seitenleiste und nur für `tess 2`; Palettentausch nur für Sorten, nicht für Glieder.
  - Einzelblöcke in Modulinstanzen werden als absolute `block`-Zeile geschrieben, nicht im Modul.
- **Nicht headless prüfbar:** Neustart mit echtem Projektordner (Absturz von Headless-Chromium, siehe CLAUDE.md), Rückfrage nach Ordnerzugriff beim Bearbeiten.

## 5. Architektur für Etappe 5

- **Neue Befehle** mit Richtungen, Seiten, Achsen oder Längen entlang einer Achse müssen sie über `c.xf` umrechnen (Beispiele: `readSpots`, `stairsCmd`, `archCmd`); Koordinaten und Höhen macht `tokens()`. Ins Grid weiter nur über `put`, `clear`, `replace` (Dachgruppen).
- **Herkunft:** `PlanOrigins` hat `sections`; `OriginEntry` hat `ctx` und `section`.
- **Schreiben aus der App** nur über `writePlan` in `planEdit.ts` (Version, `selfWrites`, Stempel, Tausch des `Project`). Verlauf und Bearbeiten-Zustand hängen an der Tab-Id.
- **`ausrichtung`** dreht das ganze Ergebnis am Ende (`turnGrid`); Ingame-Koordinaten in Etappe 5 sollten das berücksichtigen.

## 6. Arbeitshinweise

- mcmeta, Git (`gh` nur per REST, vor dem Push `git fetch origin main`) und Reihenfolge-Regeln stehen in `CLAUDE.md`.
- `node scripts/lagen.mjs <datei> block=x,y,z` zeigt Modulkette und Bauabschnitt eines Blocks.
- Bearbeiten im Browser prüfen: Projektordner wie in CLAUDE.md mit `navigator.storage.getDirectory()` nachstellen; die Datei liegt dann in `projekte/`, Versionen in `projekte/.versionen/<name>/`.
