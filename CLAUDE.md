# Tessera – Hinweise für Claude

Tessera ist eine lokale Bauhilfe für Minecraft Java 1.21.1 (NeoForge 21.1.252, Survival): Baupläne in der eigenen Bau-Sprache (`.tess`) und Schematics in 3D ansehen und Ebene für Ebene nachbauen. Web-App ohne Server: Vite, TypeScript strict, Preact + Signals, Three.js, fflate, Vitest. Projektinhaber ist **Adrian**; er entscheidet über Umfang und Richtung. Andere Personen (z. B. seine Cousine) können die Arbeit in seinem Auftrag anstoßen.

## Zuerst lesen

1. `README.md` – Funktionen, Aufbau des Codes, Befehle
2. `docs/konzept.md` – Konzept, Architektur-Regeln, Etappenplan (maßgebliche Fassung)
3. `docs/bau-sprache.md` – Bau-Sprache, Ist-Stand
4. `docs/bau-sprache-2.md` – Bau-Sprache 2, Soll-Spezifikation für Etappe 4 (verbindlich)
5. `docs/etappe-4.md` – Auftrag Etappe 4 mit Teilen 4a, 4b, 4c, Zielbauten und Abnahme

Im Code gezielt lesen, was die Aufgabe berührt; nicht alles auf Vorrat.

## Arbeitsweise

- **Schritt für Schritt nach Konzept und Spezifikation. Nach jedem Teil stoppen** (z. B. nach 4a), Bericht geben (Vorlage in `docs/etappe-4.md`), auf Freigabe warten.
- **Sprache:** Oberfläche, README und Dokumentation auf Deutsch in du-Form. Code-Kommentare wie im bestehenden Code auf Englisch. Commit-Nachrichten auf Deutsch.
- **Sparsam:** gezielt lesen, keine Abschweifungen, Bildschirmfotos nur am Ende eines Teils. Keine Arbeit an der Handy-Darstellung.
- **Nicht ohne Adrians Anweisung:** Rohstoff-Aufschlüsselung für Chipped, FramedBlocks, Domum Ornamentum; echte Texturen; Etappen 5 und 6; Innenräume.
- **Schwachstellen im Blick behalten:** räumliche Vorstellung (Fehlplatzierungen, Ästhetik), verbundene Blöcke (Zäune, Mauern, Scheiben, Treppen-Ecken), Leistung bei großen Builds.
- **Zielbauten selbst kritisch ansehen:** aus mehreren Richtungen, bevor ein Teil als fertig gilt. Ziel ist, dass sie gut aussehen, nicht dass sie die Abnahme knapp bestehen.

## Regeln für den Code

- **Keine Spieldaten im Repository:** keine Dateien von Mojang oder Mod-Autoren (Jars, Texturen, Sprachdateien, Blocklisten). Tests erzeugen ihre Daten selbst. Für Vanilla-Abgleiche die Datei `blocks/data.min.json` aus [misode/mcmeta](https://github.com/misode/mcmeta), Zweig `1.21.1-summary`, außerhalb des Repos ablegen und mit `TESSERA_MCMETA_BLOCKS=<pfad> npm test` nutzen.
- **Architektur-Regel Isolation** (`docs/konzept.md`): nichts aus einem Projekt sickert in ein anderes; jede `.tess`-Datei ist in sich abgeschlossen; Rollen werden sofort in Block-IDs aufgelöst.
- **Version 1 bleibt gültig:** `tess 1`-Dateien müssen blockgenau dasselbe ergeben wie in 0.3.0.
- Kein `const enum` (Vite übersetzt Dateien einzeln); Konstantenobjekte wie `Part` in `src/tess/grid.ts`.
- Vom Compiler gesetzte Blätter immer mit `persistent=true`; alle Blockzustände vollständig (siehe `completeState` in `src/tess/connect.ts`).
- Meldungen der Bau-Sprache: deutsch, mit Zeile, ohne Folgefehler (`FollowUpError`).
- Eigene Beispieldateien gehören nach `samples/` (nicht eingecheckt) oder, wenn sie Teil der Abnahme sind, nach `beispiele/`.

## Befehle

```sh
npm install
npm test              # Vitest
npm run typecheck
npm run build         # prüft und baut nach dist/
npm run preview       # gebaute Version auf http://localhost:4173
```

Optionale Tests: `TESSERA_MCMETA_BLOCKS` (Vanilla-Blockzustände), `TESSERA_SAMPLE_SCHEM`, `TESSERA_MC_ROOT` (siehe README).

## Im Browser prüfen

- `window.__tessera.status()` liefert Projekte, Blockzahl, Meshing-Stand; `window.__tessera.camera([x,y,z],[x,y,z])` setzt die Kamera.
- Dateien lassen sich über das versteckte `input[type=file]` öffnen (Playwright: `set_input_files`). Headless-Chromium braucht für WebGL `--use-gl=swiftshader --enable-unsafe-swiftshader`.
- Den Projektordner kann man headless mit dem privaten Browser-Dateisystem nachstellen: `window.showDirectoryPicker = async () => navigator.storage.getDirectory()` als Init-Skript.
- Bekannte Eigenheit: Headless-Chromium stürzt beim Neuladen ab, wenn ein solches Handle in IndexedDB liegt, auch ohne Tessera-Code. Den Neustart-Fall mit echtem Ordner prüft Adrian von Hand.

## Git

- Pro Teil ein Branch von `main`: `etappe-4a`, `etappe-4b`, `etappe-4c`. Ist der vorige Teil noch nicht gemergt, vom vorigen Branch abzweigen.
- Am Ende des Teils pushen und einen Pull Request nach `main` öffnen. Adrian prüft und merged. Nicht direkt auf `main` pushen, außer Adrian sagt es ausdrücklich.
- Commits mit den üblichen Co-Authored-By-Zeilen, so wie sie die Umgebung vorgibt.
- `node_modules/`, `dist/` und `samples/*` nie einchecken.
