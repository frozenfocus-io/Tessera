# Übergabe Etappe 4b

Stand 30.10.2026, Branch `etappe-4b`, Endstand von Teil 4b (Version 0.4.1). Ergänzt `docs/uebergabe-4a.md`, `docs/bau-sprache.md` (Ist-Referenz) und `docs/future-fixes.md`.

## 1. Stand

- **Pull Requests:** #1 (4a, gegen `main`) und #2 (4b, gegen `etappe-4a`) sind offen. Nach dem Merge von #1 die Basis von #2 auf `main` stellen.
- **Prüfung am 30.10.:**
  - `npm test` mit `TESSERA_MCMETA_BLOCKS`: 293 Tests, 291 grün, 0 rot, 2 übersprungen (Minecraft-Jar und Beispiel-Schematic, beide optional). Ohne mcmeta: 290 grün, 3 übersprungen.
  - Alle Dateien in `beispiele/` übersetzen ohne Fehler und ohne Hinweise; `haus-mit-rundturm.tess` ist blockgenau wie in 0.3.0 (`test/tess1-regression.test.ts`).
  - `typecheck` und `build` ohne Fehler.

## 2. Umsetzung

- **6.1–6.6, 7, 8, 11** vollständig, mit Verhaltenstests in `test/tess2b.test.ts`; Zielbauten in `test/tess2.test.ts`. In der App markiert ein Klick auf einen Hinweis die Blöcke der Zeile und dreht die Kamera hin.
- **Wachturm** wieder nach Auftrag: h=24, ab Lage 18 mit Konsolen vorgekragt, Obergeschoss ab Lage 18 mit r+1. Umgang in Lage 15 (zwei Blöcke Kopfhöhe unter den Konsolen, Stützen tragen die Schürze), Balkon in Lage 8 auf Stützen bis zum Gesims.
- **Fachwerkhaus** fertig: zwei Blöcke Vorkragung mit Kopfbändern, gerades Fachwerk und verputzte Giebel (hell), Kreuzgiebel, zwei Gauben, halbrunder Erker mit schlankem Helm, Schornstein mit Schultern und Kragen, Läden, Blumenkästen, Tür mit Vordach und Stufen, Feld mit Zaun, Tor und Weg.
- **Behoben:** Fenster b=3 im halbrunden Erker meldete „Hausecke“; Wendeltreppe `breite=2` sprang im inneren Ring zwei Lagen. Je mit Test.
- **Nachgezogene Tests:** Ecktürme (`einzug`, `konsolen`, `stufen`, `dachprofil`, `biegung`, `spitze`), `muster=` bei Efeu und Bewuchs.
- **Werkzeuge:** `scripts/lagen.mjs` (Lagen, Schnitte, Herkunft einzelner Blöcke als Text), `scripts/fotos.mjs` (Bildschirmfotos aus mehreren Richtungen, nach `npm run build`).

## 3. Abweichungen und Entscheidungen

Alle stehen in `docs/bau-sprache.md` unter „Entscheidungen und Erweiterungen (Etappe 4a/4b)“.

- **Von Adrian bestätigt:** Abdichtung hinter offenen Treppenseiten (5.2); Verschneidung mit Krüppelwalm nur an freien Giebelseiten, Giebel entfallen auch in derselben Lage, geräumte Zellen bleiben geräumt (5.3); Schweben mit Nachbarn über Kanten (11); Wasser nie in der Randreihe (8); `erlaube schweben` schon in 4b.
- **Future Fix 1A** (Innenecken blicken in x-Richtung): **offen**, auf Adrians Entscheidung nicht umgesetzt. Ebenso 2, 3 und 4.
- **Widersprüche, selbst entschieden:** Balkonkonsolen wie 4.3; Banner ohne Hinweis; Tür `art=spitzbogen` nur mit b=2, gleich `bogen`; Wendeltreppe `breite>1`: der innerste Ring gibt den Takt vor, äußere Ringe bekommen Absätze (untere Stufen).
- **Lücken, selbst entschieden:** `anzahl=` ohne Seite rundum; `seiten=` an runden Formen nach Winkel; Umgangsstützen an den Formecken, bis unter den nächsten Block; Erkerdach auf der gespiegelten Form, `dach=nein`; halbrunder Erker ohne Ecken; Bogenspalten bis unter die nächste; `zaun=`/`weg=` mit Block-IDs; Halt in der untersten Lage erfüllt.
- **Zielbauten:**
  - Wachturm: Verjüngung endet in Lage 8 statt 12. Mit 12 bleibt unter dem Umgang nur Lage 10–13 als gerade Wand; der Balkon samt Pultdach braucht sieben Lagen, an der verjüngten Wand endet sein Dach vor der Wand (Future Fix 13).
  - Fachwerkhaus: zwei Blöcke Vorkragung, weil Kopfbänder erst damit schräg sind; das Querhaus ist je einen Block länger.

## 4. Offene Punkte

Alle bekannten Fehler, Lücken und Schönheitsfehler stehen mit Reproduktion in `docs/future-fixes.md`, Einträge 5 bis 23 (u. a. Erker am Giebel, Gesims am Vieleck, schmales Feld, Lücken der Prüfungen, Erkerdach, Biegung ohne Spitze, Wendeltreppe außen, Balkondach an verjüngter Wand, Kopfbänder, Fachwerkmuster, kreuzende Formen, bündiger Anbau, Reihenfolge, Richtungswörter in Zuständen, Leistung, Testlücken, Viewer, Zielbauten). Nichts davon ist ohne Adrians Anweisung umzusetzen.

Vor 4c geplant (eigener Chat): `compile.ts` aufteilen und die Leistung der Dachgruppen (Future Fix 20).

## 5. Architektur für 4c

**Module:** Jeder Befehl ist `xxxCmd(c, st)`, aufgerufen aus dem `switch` in `Compiler.exec`; `Compiler` nur als Typ importiert.
- `args.ts`: Angaben lesen. `wall.ts`: 6.1 (`readSpots`).
- `openings`, `wallparts`, `stairs`, `decor`: 6.2–6.4, 6.6, 7, 8.
- `annex.ts`: 6.5. Erker werden per `makeForm`/`register` zur Form (`PlanShape(…, round)` beim halbrunden), Dächer laufen über `roofOn`.
- `checks.ts`: `runChecks` am Ende von `compileTess`; Überschrieben läuft über `checkCover`.
- `grid.ts`: `Part.Frame`/`Annex`, Herkunft `<<4`, `taggedOrigin`. `connect.ts`: `completeState` auch für Pflanzen.

**`compile.ts`** hat 85.954 Byte. Vor 4c mechanisch aufteilen, ohne Verhaltensänderung: Ausführung, Formen, Dächer, Setzen und Meldungen. Die Tests für Version 1, tess2 und tess2b sichern das ab. Andere Module rufen viele Methoden über `c.…` auf (am häufigsten `outPlace`, `ref`, `tokens`, `place`, `bauteilForm`, `outlineAt`); diese Aufrufe sollten beim Aufteilen gleich bleiben.

**Stolperstellen in 4c:**
- **Parser:** Verschachtelung bis `ende`. Anweisungen kennen nur ihre erste Zeile; zum Umschreiben von `rolle`-Zeilen mit Fortsetzung fehlt das Ende.
- **`run`:** Die Kette muss an `originId`. Hinweise werden je Zeile gesammelt (`note`, `reported`), der Schlüssel braucht die Kette.
- **Drehen:** Dächer, `keep` und Prüfungen rechnen absolut. Alle Zustände (auch Ranken, `hinge`) vor `connectBlocks` drehen.
- **Reihenfolge:** Stützen, Hängelaternen und Efeu sehen nur frühere Blöcke (Future Fix 18); mit Modulen wird das wichtiger.
- **App:** `planFiles.ts` erkennt Änderungen an Größe und Zeit und tauscht das `Project` aus. Eigenes Schreiben muss den Stempel nachziehen; Rückgängig und Bearbeiten-Zustand müssen den Tausch überleben.

## 6. Arbeitshinweise

- mcmeta-Datei, Git-Hinweise (`gh` nur per REST, vor dem Push `git fetch origin main`) und Reihenfolge-Regeln stehen in `CLAUDE.md`.
- `node scripts/lagen.mjs <datei> block=x,y,z` zeigt Zustand und Herkunftszeile eines Blocks; für Fehlplatzierungen schneller als Fotos.
