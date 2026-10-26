# Übergabe Etappe 4b

Stand 26.10.2026, Branch `etappe-4b`. Ergänzt `docs/uebergabe-4a.md` (nur auf `etappe-4a`, `738dc63`) und `docs/future-fixes.md`.

## 1. Stand

- **Commit:** `f02fa3a` („Zwischenstand“), gepusht, nichts offen. Abgezweigt von `a94fa2d`, die Übergabe 4a fehlt hier.
- **Prüfung am 26.10.:**
  - `npm test`: 284 Tests, 281 grün, 0 rot, 3 übersprungen (optional).
  - Mit `TESSERA_MCMETA_BLOCKS`: 282 grün, 0 rot, 2 übersprungen. Dieser Test verlangt für alle `beispiele/` null Meldungen. Wachturm und Fachwerkhaus übersetzen also ohne Fehler und Hinweise.
  - `typecheck` und `build` ohne Fehler.
  - Leistung (Node): 2-Mio.-Plan 2,6 s, alle Beispiele 0,12 s.
- **Pull Requests:** #1 (4a) ist offen, ohne Review. Für 4b gibt es keinen.
- **Freigabe 4a:** Im Repo keine. Den Auftrag für 4b gab Katharina; ob du 4a vorher freigegeben hast, weiß ich nicht.

## 2. Umsetzung

- **6.1–6.4, 6.6, 8:** vollständig, mit Verhaltenstests (`test/tess2b.test.ts`).
- **6.5:** vollständig. Bei Ecktürmen sind nur Standardwerte getestet, keine eigenen für `einzug`, `konsolen`, `stufen`, `dachprofil`, `biegung`, `spitze`.
- **7:** vollständig bis auf den Banner-Satz (3). `muster=` hat keinen Test.
- **11:** Überschrieben, Halt, Schweben, Fließen, `erlaube schweben`. Die Modulkette kommt mit 4c.
- **App:** Ein Klick auf einen Hinweis umrandet die Blöcke der Zeile und dreht die Kamera hin. Esc oder ein zweiter Klick löst es. Nur headless geprüft, kein Test.

## 3. Abweichungen, Widersprüche, Lücken

**Abweichungen (brauchen dein OK):**
- **11 Schweben:** Nachbarn auch über Kanten. Mit sechs Seiten zerfiel der 4a-Wachturm in viele Gruppen (laut Chat 18; ohne Codeänderung nicht nachprüfbar).
- **8:** Wasser nie in der Randreihe. „Alle 9“ legt bei B=14 Reihe 13 an den Rand.
- **Wachturm:** Obergeschoss zwei breiter (r=7, Lage 20–25) statt ab 18 einen vorgekragt mit Konsolen. Nur so passt der Umgang (Lage 17) darunter; die Stützen tragen die Schürze.

**Widersprüche:**
- **6.5 Balkonkonsolen:** „wie 4.3“ gegen „Reihe j in Lage y−1−j“ → wie 4.3, innen am tiefsten.
- **7 Banner:** „steht im Hinweis zur Datei“ → keine Meldung, denn der Wachturm braucht Banner ohne Hinweise.
- **`erlaube`:** Der Auftrag nennt 4c, die Spezifikation (11, 13) 4b → `erlaube schweben` jetzt.
- **6.3 Tür `art=spitzbogen`:** b≤2, ein Spitzbogen braucht ungerades b → nur b=2, gleich `bogen`.

**Lücken:**
- **6.1:** `anzahl` ohne Seite geht rundum, `winkel=` ist der Start.
- **6.4:** `seiten=` bei runden Formen nach Winkel (±45°, Schrägen ±22,5°).
- **6.5 Umgang:** Stützen an Formecken, dazwischen gleichmäßig ≤ `abstand` (runde Formen ab Norden). Sie reichen bis unter den nächsten Block (6 Lagen Suche), mit `dach=` bis ans Dach, sonst 3. Streben statt Konsolen.
- **6.5 Erker:** Dach auf der hinter die Wand gespiegelten Form, gebaut nur davor. Neu ist `dach=nein`.
- **6.6 Bogen:** Steile Spalten reichen bis unter die nächste, damit der Bogen geschlossen bleibt.
- **8:** `zaun=` und `weg=` nehmen auch Blocknamen.
- **11 Halt:** In der untersten Lage gelten „darunter“, Boden und Schwerkraft als erfüllt.
- **Future Fixes 1–4:** nicht angefasst. Nr. 2 ändert die Maße des Wachturms.

## 4. Noch zu tun

1. Deine Entscheidung zu 3 und zu den 4a-Fragen (Abdichtung, Future Fix 1A).
2. Fachwerkhaus: Erkerhelm, helleres Obergeschoss, sichtbare Kopfbänder; „Zwischenstand“ aus dem Kopf; Testblock wie beim Wachturm.
3. `docs/bau-sprache.md` als Ist-Referenz mit allen Entscheidungen aus 3.
4. README, `docs/konzept.md`.
5. Version 0.4.1 (`package.json`, `package-lock.json`), `STAGE` in `src/version.ts`.
6. Prüfungen, 2–3 Bildschirmfotos, Bericht.
7. PR gegen `main` nach dem Merge von #1, sonst gegen `etappe-4a`.

Sonst noch: Tests für Ecktürme und `muster=`, Einträge in `future-fixes.md`.

## 5. Zielbauten

**Wachturm:** fertig und getestet. Angesehen in sechs Gesamtansichten und mehreren Nahaufnahmen. Gefällt mir nicht:
- Der Balkon ist gedrungen.
- Die Schürze ist schwer.
- Das Gesims in Lage 1 wirkt wie eine Fußleiste.
- Der Helm ist stufig (Future Fix 3).
- Im Viewer sind Ranken grüne Platten und Banner nur einen Block hoch.

**Fachwerkhaus:** Entwurf mit allen verlangten Teilen, aus fünf Richtungen angesehen. Gefällt mir nicht:
- Der Erkerhelm ist massig.
- Das Obergeschoss ist sehr dunkel.
- Acht `leer`-Zeilen räumen die Innenwände der gekreuzten Boxen.
- Kopfbänder (`strebe laenge=1`) und Schornstein sind plump.

## 6. Fehler und Schwächen

- **Erker am Giebel:** `box h 0,0,0 12,9,8 putz hohl`, `dach sattel h first=x`, `erker h o y=4 b=5 h=3 art=halbrund holz` → der Helm verschmilzt mit dem Ortgang zu einem Klotz (5.3).
- **Halbrunder Erker:** `fenster … b=3` meldet „Hausecke“, nur b=1 geht.
- **Wendeltreppe `breite=2`:** Der innere Ring springt zwei Lagen, z. B. (1,1,−2) → (2,3,−1).
- **Treppen:** Future Fix 1 ist unverändert. Konsolen und Streben an Ecken sind nicht systematisch geprüft.
- **Reihenfolge:** Anbauten setzen nur in Luft, `hohl` räumt innen. Stützen sehen nur frühere Blöcke, darum stehen Obergeschoss und Schürze vor `umgang`.
- **Gesims am Vieleck:** Ohne `seiten=` stößt es am Wachturm 7-mal an den Anbau.
- **Schmales Feld:** `feld 0,0,0 19,0,1` → Wasser am Rand, Fließen-Hinweis.
- **Lücken der Prüfungen** (geprüft):
  - Wasser neben Fackel oder Blume, `stone_brick_slab[waterlogged=true]` neben Luft: keine Meldung.
  - Eine Plattform an einer Kette gilt nicht als schwebend.
  - Überschrieben meldet weder Rahmen noch Fachwerk noch Dach.
- **Leistung:** Die Dachgruppen-Kosten aus 4a sind unverändert. Im Browser-Worker nicht gemessen.

## 7. Architektur für 4c

**Neue Module:** Jeder Befehl ist `xxxCmd(c, st)`, aufgerufen aus dem `switch` in `Compiler.exec`; `Compiler` nur als Typ importiert.
- `args.ts`: Angaben lesen.
- `wall.ts`: 6.1 (`readSpots`).
- `openings`, `wallparts`, `stairs`, `decor`: 6.2–6.4, 6.6, 7, 8.
- `annex.ts`: 6.5. Erker werden per `makeForm`/`register` zur Form, Dächer laufen über `roofOn`.
- `checks.ts`: `runChecks` am Ende von `compileTess`; Überschrieben läuft über `checkCover`.
- `grid.ts`: `Part.Frame`/`Annex`, Herkunft `<<4`, `taggedOrigin`.
- `connect.ts`: `completeState` für Pflanzen.

**`compile.ts`** hat 85.954 Byte. Vor 4c mechanisch aufteilen, ohne Verhaltensänderung: Ausführung, Formen, Dächer, Setzen/Meldungen. Die Tests für Version 1, tess2 und tess2b sichern das ab.

**Stolperstellen in 4c:**
- **Parser:** Verschachtelung bis `ende`. Anweisungen kennen nur ihre erste Zeile; zum Umschreiben von `rolle`-Zeilen mit Fortsetzung fehlt das Ende.
- **`run`:** Die Kette muss an `originId`. Hinweise werden je Zeile gesammelt (`note`, `reported`), der Schlüssel braucht die Kette.
- **Drehen:** Dächer, `keep` und Prüfungen rechnen absolut. Alle Zustände (auch Ranken, `hinge`) vor `connectBlocks` drehen.
- **App:** `planFiles.ts` erkennt Änderungen an Größe und Zeit und tauscht das `Project` aus. Eigenes Schreiben muss den Stempel nachziehen; Rückgängig und Bearbeiten-Zustand müssen den Tausch überleben.

## 8. Wissen aus dem Chat

Nicht im Repo prüfbar.
- **Auftrag:** von Katharina, mit drei Stilbildern (Wachtürme mit Holzaufbau, Felsturm mit Feuer, Zaubertürme), nicht im Repo. Gewünscht: PR nach `main` und Bericht. Mittags ließ sie den Stand sichern.
- **Lagen ansehen:** Eine Wegwerf-Testdatei druckt Lagen als Text (`vitest --silent=false`); vor dem Commit löschen.
- **Fotos:**
  - Python-Playwright mit `vite preview` nach `build` und Swiftshader.
  - `__tessera.camera` erwartet Welt minus `offset` aus `status()`.
  - Skript, Fotos und mcmeta-Datei lagen im Temp-Ordner. Wie ich die mcmeta-Datei geholt habe, weiß ich nicht mehr.
- **Git:** `gh` nur per REST. `origin/etappe-4b` fehlt lokal → `git ls-remote`. Vor dem Push `git fetch origin main` (sonst HTTP 413).
- **Schiefgegangen:**
  - Befehl `verwitterung` erfunden, wieder gelöscht.
  - Stützenhöhe in der Schleife neu berechnet.
  - Vier alte Tests brauchten `erlaube schweben` oder einen Halteblock.
  - Kein Erkerdach wirklich schön.

## 9. Vorschläge für CLAUDE.md

- Unter „Zuerst lesen“: `future-fixes.md` und die jüngste Übergabe.
- Foto- und Lagenskript nach `scripts/`.
- Reihenfolge-Regeln: Anbauten nur in Luft, `hohl` räumt innen, Dächer verschneiden sich über die Grundfläche.
- Git-Hinweise und was gilt, wenn der PR des vorigen Teils offen ist.
- Ob Abweichungen für die Optik erlaubt sind (mit Bericht) oder vorher gefragt wird.
- Herkunft der mcmeta-Datei.
