# Übergabe Etappe 4a

Stand 26.10.2026, Branch `etappe-4a`. Ergänzt `docs/bau-sprache.md` (Ist-Stand), `docs/future-fixes.md` und Pull Request #1.

## 1. Stand

- Letzter Commit `a94fa2d` („Future Fixes …“), Branch gepusht, nichts ungepusht; `main` steht auf `461b569`. Pull Request #1 ist offen, nicht gemergt.
- Prüfung am 26.10.:
  - `npm test`: 227 Tests, 224 grün, 0 rot, 3 übersprungen (die optionalen mit Pfadangabe).
  - Mit `TESSERA_MCMETA_BLOCKS`: 225 grün, 0 rot, 2 übersprungen (Minecraft-Jar und Beispiel-Schematic hatte ich nicht).
  - `typecheck` und `build` ohne Fehler und Warnungen.
  - Die mcmeta-Datei enthält Blöcke aus 1.21, aber keine aus 1.21.4.

## 2. Abweichungen, Widersprüche, Lücken

**Abweichungen (brauchen dein OK):**
- **5.2 Inneres bleibt Luft:** Dachboden-Zellen hinter offenen Treppenseiten werden volle Blöcke („Abdichtung“). Ohne sie sah man an Schrägen durchs Dach.
- **5.3 Verschneidung:**
  - Der Krüppelwalm walmt nur an freien Giebelseiten (sonst Kerbe am L-Anbau).
  - Giebel entfallen auch, wenn ein anderes Dach die Zelle davor in derselben Lage deckt.
  - Zellen, die Anweisungen zwischen zwei Dächern *geräumt* haben, bleiben geräumt.

**Erweiterungen** (dokumentiert): `ringbalken=ja`, `x=`/`z=` bei Fenster und Tür an allen Formen, Kranzdach-Hinweis auch vor Fenstern, `r` und `wand` bei der kugel.

**Lücken und Widersprüche, wie entschieden:**
- **4.4:** „Unten außen nach oben innen“ und „wechselt von Feld zu Feld“ geht bei ungerader Feldzahl nicht beides → abwechselnd ab West/Nord.
- **4.3:** Konsolen ab Ring 2 blicken zum Ring davor.
- **5.2:**
  - Gleichstand n, o, s, w → wörtlich umgesetzt (Ursache von Future Fixes 1).
  - Breitere letzte Lagen → wie eine weitere Stufe.
- **5.4:** u = y / oberste Lage.
- **5.5:** Kranzdach mit Profil 1/1 und `kante=nein` als Standard.
- **5.3:** Gruppen entstehen über die Grundflächen, auch ohne gemeinsame Lage.
- **1.1 gegen 5.2:** Ein Kegeldach aus Version 1 sieht mit `tess 2` anders aus (Future Fixes 4).
- **12:** Die Leistung ist in Node gemessen, nicht im Browser-Worker.
- **Zielbau „eine Kehle“:** geht mit 5.3 nicht (siehe 5).

## 3. Unfertiges

- Richtungswörter in Blockzuständen (1.4) werden nur bei `facing` übersetzt.
- `no/so/sw/nw` gibt es nur bei `biegung`; Fenster und Tür kennen nur n/o/s/w (Rest: 4b).
- Die Herkunft hat noch keine Modulkette und keinen Abschnitt (4c).
- Die Grenze von 2 Millionen Anweisungen fehlt. Die 8-Millionen-Grenze zählt jedes Setzen, auch das Neuzeichnen von Dachgruppen.
- `dach … rolle=` hat in Version 2 keinen eigenen Test.

## 4. Fehler und Schwächen

- **Treppenecken an Schrägen** (Future Fixes 1), in `wachturm.tess`:
  - y=24: Nordwest richtig mit Ecken (−4,24,−6) und (−3,24,−6); Nordost dagegen zwei gerade Treppen (3,24,−6) und (4,24,−6).
  - y=25: überall einzelne Treppen.
- **Traufe:** (14,5,2) und (14,5,3) am Anbau sind volle Blöcke statt Treppen.
- **Leistung von Dachgruppen:** Jedes neue Dach zeichnet die ganze Gruppe neu und sucht pro Zelle über alle Dächer. Bei Häusern in einer Reihe mit berührenden Satteldächern dauern 50 Häuser 0,8 s, 100 Häuser 4,3 s und 200 Häuser 28 s, obwohl das nur 57.000 Blöcke sind. Der Leistungstest erfasst das nicht.
- **Achteck-Versatz** (Future Fixes 2): `profil=0:2` verbreitert die geraden Seiten nur um 1.
- **Verbundene Blöcke:** keine konkreten Fehler bekannt. Geprüft sind gültige Zustände (mcmeta) und Treppenecken nach der Vanilla-Regel; Mod-Blöcke gehen nur über Vanilla-Namen.
- **Future Fixes** (es sind vier Punkte):
  1. 1A: klein, große Wirkung, ein Satz in 5.2.
  2. 1B als Bildprobe.
  3. 2, noch vor den Zielbauten von 4b, weil es Maße ändert.
  4. 3 nach Geschmack.
  5. 4 erledigt sich mit 1 größtenteils.

  Die Leistung der Dachgruppen gehört vor 4c.

## 5. Zielbau Wachturm

**Gefällt mir nicht:**
- Der Helm ist stufig wie gestapelte Trommeln, an den Schrägen fehlen die Ecken.
- „Zwei breiter“ zeigt sich nur an den Schrägen.
- Die Konsolen sind hinter dem Kranzdach kaum zu sehen.
- Der Anbau hat zwei Kehlen und volle Blöcke in der Traufe.

**Maße:** Die Zahlen des Auftrags stehen unverändert in der Datei (r=5, `profil=0:2,3:2~,12:0,18:1`, Obergeschoss y=18–23). Anders ist nur die Wirkung:
- Der Versatz vergrößert den Umkreis, gerade Seiten wachsen deshalb nur um 1.
- Die Rundung hält +2 bis Lage 5 und erreicht 0 schon in Lage 10.
- Der Helm hat `ueberstand=2`, weil er mit 1 an den geraden Seiten keinen Überstand hätte.
- Anbaumaße frei gewählt: Haus 7×7, Flügel 5×8.

**Zwei Kehlen:** Die Vereinigung der Lagen (5.3) bildet, wo zwei Dachflächen zusammenlaufen, immer eine Kehle und nie einen Grat. Weil der Flügel an der Ostseite bündig steht, gibt es neben der Kehle an der Innenecke (8,5,4)–(10,7,2) eine zweite, (14,5,4)–(12,7,2). Ein L mit Grat geht nur als Walmdach über einem L-förmigen `umriss`.

## 6. Architektur

**`src/tess/`:**
- **`syntax.ts`:** logische Zeilen (Fortsetzung, Kommentare, ASCII an `grundriss`) und rohe Tokens; Ausdrücke bleiben Text.
- **`expr.ts`:** Ausdrücke `{…}`, ausgewertet bei der Ausführung, innerste zuerst.
- **`grid.ts`:** Chunks 16³ mit `Uint16`-Zustand und `Uint32` (Part | Herkunft<<3), Herkunftstabelle (Zeile, Kette).
- **`palette.ts`:** Rollen, Glieder, Muster, Block-Angaben.
- **`cells.ts`:** `CellSet` (eine Lage als Bitmaske).
- **`forms.ts`:** Querschnitte je Versatz, Ecken, gerade Stücke, Wandprofil.
- **`roof.ts`:** Dachmaschine (`renderRoofs`, `resolveHips`) und Kranzdach.
- **`compile.ts`:** Klasse `Compiler`; `tess 1` geht an das eingefrorene `v1.ts`.
- **`connect.ts`:** läuft einmal am Ende, rechnet nur bei verbindbaren Blöcken.

Die Herkunft geht über `parseTess` (`core/formats/tess.ts`) und den Worker zu `Project.originAt` und von dort in die Hover-Karte.

**Ablauf:**
1. `parseStatements2` zerlegt die Datei.
2. `Compiler.run` setzt pro Anweisung `seq`, vergibt eine Herkunft und ruft `exec` auf (switch nach Befehl).
3. Danach laufen `connectBlocks` und das Sortieren der Meldungen.

Dächer: `roofDef` (Lagen) → `addRoof` (Gruppe) → `renderGroup` (Gruppe neu zeichnen).

**Neue Anweisung:**
- `case` in `exec` anlegen, Befehl aus `LATER` streichen, in `KNOWN` aufnehmen.
- Angaben mit `Args` lesen, Blöcke nur über `place`/`placeSpec`/`put` mit `Part` setzen.
- `warn` für Hinweise, `TessError` für Fehler, `FollowUpError` für Folgefehler.

**Für 4c:**
- `modul`, `wiederhole` und `spiegle` brauchen Verschachtelung bis `ende`; der Parser liefert eine flache Liste.
- `tokens(st)` wertet Ausdrücke bei jeder Ausführung neu aus, das passt für Schleifen.
- `this.values` hat keine Gültigkeitsbereiche.
- `grid.originId` kann eine Kette, `run()` übergibt sie noch nicht.
- Instanz-Formen als `inst.form` registrieren, dann findet `field()` sie.
- Drehen und Spiegeln:
  - Dachlagen, `g.placed` und alle Prüfungen rechnen absolut.
  - Dächer verschiedener Instanzen müssen sich absolut verschneiden.
  - `facing`, `axis` und `hinge` drehen mit; die Treppenformen rechnet `connectBlocks` am Ende neu.
- `ausrichtung`: das ganze Grid vor `connectBlocks` transformieren.

## 7. Wissen aus dem Chat

Nicht im Repo prüfbar.
- **Auftrag:** Katharina hat 4a mit drei Pinterest-Bildern gestartet (Steinwachtürme mit Holz-Obergeschoss, gestaffelte dunkle Helme, Hexenhut-Türme, Haus am Turm). Die Bilder sind nicht im Repo.
- **Ihr Test** (Windows, Node v24.22.1):
  - PowerShell blockierte `npm` → `npm.cmd install`, `npm.cmd run dev`.
  - Rückmeldung: Treppen verbinden sich nicht übers Eck → Future Fixes 1, nur dokumentieren, nichts umbauen.
  - Ob sie Projektordner und Live-Änderung getestet hat: weiß ich nicht.
  - Für 4b habe ich ihr den alten Startprompt mit „4b“ vorgeschlagen, 1A nur mit deinem OK.
- **Offen an dich:** Ist die Abdichtung in Ordnung? Soll 1A kommen?
- **Am Wachturm unterwegs geändert:** Ostfenster in y=8 entfernt (die Bank stieß an den Anbaugiebel). Der Flügel beginnt bei z=3 statt 4 (sonst Lücke in der Kehle).
- **Bildschirmfotos:**
  - Playwright-Chromium headless mit Swiftshader, Datei per `set_input_files`, Kamera mit `window.__tessera.camera`.
  - Skript, mcmeta-Datei und Fotos lagen nur im temporären Arbeitsordner.
  - Der Dev-Server wird zwischen Antworten beendet → `vite preview` (4173) nach `build`.
- **Schiefgegangen:**
  - `gh pr create` scheitert (GraphQL gesperrt) → `gh api …/pulls --method POST`.
  - `git push -u` setzte keinen Upstream (`remote.origin.fetch` holt nur `main`).
  - Git meldet „repository moved“ zu `…/Tessera.git`.
  - `pkill -f "node.*vite"` beendet die eigene Shell.
  - Vitest zeigt `console.log` grüner Tests nicht.

## 8. Vorschläge für CLAUDE.md

- `future-fixes.md` und diese Übergabe unter „Zuerst lesen“.
- Git:
  - Pull Request per `gh api` statt `gh pr create`.
  - Upstream per Refspec setzen.
  - Neue Remote-URL eintragen.
- Ein Bildschirmfoto-Skript in `scripts/` und der Hinweis, dass der Dev-Server zwischen Antworten stoppt.
- Woher die mcmeta-Datei kommt; jede Sitzung muss sie neu laden.
- Klären, ob Claude aus Qualitätsgründen von der Spezifikation abweichen darf (mit Bericht) oder vorher fragen muss.
- „Bildschirmfotos nur am Ende“ präzisieren: wohl gemeint als „im Chat erst am Ende zeigen“, prüfen muss man unterwegs.
- Windows-Tester: `npm.cmd`.
- Den Leistungstest um eine große Dachgruppe ergänzen.
