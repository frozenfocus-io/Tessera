# Vorarbeit für Etappe 4c

Stand 30.10.2026, Branch `vorarbeit-4c` auf `main` (0.4.1). Zwei Änderungen ohne neue Funktionen: `compile.ts` ist aufgeteilt, und Dachgruppen zeichnen nur noch den geänderten Teil neu. Alle Ergebnisse sind blockgenau wie vorher.

## Dateien des Compilers in `src/tess/`

Der Compiler ist eine Klasse in fünf Schichten, je eine Datei; jede nutzt nur sich und die Schichten darunter. Befehle anderer Module bleiben `xxxCmd(c, st)`, aufgerufen aus dem `switch` in `Compiler.exec`.

- `compile-base.ts`: Zustand eines Laufs und Meldungen (Hinweise je Anweisung, „Überschrieben“, `erlaube`).
- `compile-place.ts`: Setzen: Blockzustände, Herkunft, Rollen, `linie`, `block`, `leer`, Zellen der Bauteile an und vor der Wand.
- `compile-forms.ts`: Formen mit Wandprofil, Fachwerk und Konsolen, Umrisse je Lage, Seiten und Wandzellen für Bauteile.
- `compile-roofs.ts`: `dach`, `kranzdach`, Dächer auf Formen und Anbauten, Dachgruppen ganz oder in Teilen zeichnen.
- `compile.ts`: Ausführung (`run`, `exec`), Werte und Felder, `compileTess`.
- `roofgroup.ts` (neu): Zustand einer Dachgruppe, Verzeichnis aller Dächer nach Fläche, Zeichenreihenfolge der Dachblöcke.

## Dachgruppen

- Vorher zeichnete jedes neue Dach die ganze Gruppe neu, und `renderRoofs` suchte pro Zelle über alle Dächer.
- Kommt ein Dach jetzt zu genau einer Gruppe, zeichnet `drawPart` nur ein Fenster um das neue Dach neu: Rand Schalendicke + 2 Zellen und 3 Lagen, gerechnet mit den nahen Dächern in einem 4 Zellen größeren Kasten. Zellen der Gruppe, die andere Anweisungen inzwischen geändert haben, meldet das Grid (`Grid.watch`); sie werden mitgeprüft. Regeln, Reihenfolge und Hinweise sind die des ganzen Zeichnens.
- `renderRoofs` findet die Dächer einer Zelle über ein Verzeichnis je Lage.
- Ganz gezeichnet wird weiter bei kleinen Gruppen (unter 1500 Blöcken, `CompilerRoofs.partFrom`), beim Zusammenführen mehrerer Gruppen, bei mehreren Spitzen eines Dachs, breiten Bauchzellen, hohen Pflanzen als Zier, geändertem `samen` und nach einem Fehler beim Zeichnen.
- Geprüft gegen `main`, Zelle für Zelle mit Herkunft und Meldungen: alle Beispiele, Reihen mit 10 bis 300 Häusern, der Großbau des Leistungstests, eine Diagonale, ein Kreuz und 1.250 zufällige Pläne mit allen Dachformen, Profilen, Biegung, Gauben, Erkern, Ecktürmchen, Schornsteinen, `leer` und fehlerhaften Rollen.

## Messwerte

Node 22, Häuser in einer Reihe mit berührenden Satteldächern (wie in der Übergabe 4a), bester von drei Läufen.

| Häuser | Blöcke | vorher | nachher |
| --- | --- | --- | --- |
| 50 | 12.680 | 0,7 s | 0,07 s |
| 100 | 25.330 | 3,8 s | 0,13 s |
| 200 | 50.630 | 18 bis 24 s | 0,33 s |
| 300 | 75.930 | 84 s | 0,44 s |
| Großbau (2,85 Mio. Blöcke) | | 2,4 s | 2,4 s |

Neue Tests in `test/tess-leistung.test.ts`: 300 Häuser in unter 3 Sekunden; Dachgruppen in Teilen gezeichnet gleich ganz gezeichnet (Dörfer und Kreuz). Testzahlen vorher 291 grün und 2 übersprungen, nachher 293 grün und 2 übersprungen.

## Für 4c beachten

- Ins Grid nur über `put`, `clear` und `replace` schreiben, sonst erfährt eine Dachgruppe nichts von der Änderung.
- `grid.sets` zählt jetzt weniger, weil Gruppen nicht mehr ganz neu gesetzt werden. Die Grenzen aus Abschnitt 10 (2 Mio. Anweisungen, 8 Mio. Blöcke) fehlen weiter.
- Wer `renderRoofs` ändert: Ein Block darf nur von Zellen bis Schalendicke + 2 seitlich und 3 Lagen darüber oder darunter abhängen. Ausnahmen sind abgefangen (First über die ganze Lage, Spitzen, Traufe bis 33 Zellen, breite Bauchzellen). Der Test „in Teilen wie ganz“ meldet Abweichungen.
- Module und Wiederholung: Ein neues Dach muss später sein als die Dächer seiner Gruppe (`seq`), sonst wird ganz gezeichnet. Die Regel „zwischen den Dächern gesetzt“ nutzt `originSeq`, also die erste Ausführung einer Herkunft. Gruppen rechnen absolut; Drehen gehört vor das Zeichnen.
- `Compiler.groups` ist eine geordnete Menge (`Set`), `groupOf` geht über eine Map.
