# Future Fixes – Verbesserungsvorschläge

Hier sammeln wir Verbesserungen, die bewusst noch nicht umgesetzt sind. Jeder Eintrag beschreibt, was auffällt, woher es kommt und wie man es lösen könnte. Ob und wann etwas umgesetzt wird, entscheidet Adrian. Vorschläge, die die Spezifikation [bau-sprache-2.md](bau-sprache-2.md) ändern, sind als solche markiert.

Neue Einträge unten anhängen, Vorlage am Ende.

---

## 1. Dachtreppen an schrägen Kanten verbinden sich nicht

*Beim Test von 4a gemeldet (25.10.2026). Status: offen.*

**Beobachtung:** Am Helm und am Kranzdach des Wachturms bilden die Treppen an den schrägen Seiten des Achtecks keine Ecken, so wie man sie in Minecraft bauen würde. Stellenweise stehen einzelne gerade Treppen schräg hintereinander. Eigentlich müssten sie nach Südwest oder Nordwest zeigen, aber Treppen kennen nur Nord, Ost, Süd und West.

**Was nicht die Ursache ist:** Die Verbindungsberechnung rechnet die Treppenformen wie das Spiel. So wie die Treppen jetzt stehen, würden sie sich auch im Spiel nicht verbinden. Tessera kann Ecken auch nicht einfach erzwingen: Beim Bauen setzt das Spiel die Form jeder Treppe selbst aus ihren Nachbarn. Die Anordnung muss also so sein, dass von selbst Ecken entstehen.

**Ursache 1 – Blickrichtung an Innenecken.** Eine Treppe an der Innenecke einer Schräge grenzt an zwei Seiten an die nächste Dachlage. Dann gilt laut Spezifikation (5.2) die Reihenfolge n, o, s, w. Die Außenecke daneben grenzt nur schräg an und blickt in z-Richtung. Nur an der Nordwest-Schräge ergibt das ein Paar aus Außen- und Innenecke. An den anderen drei Schrägen blicken beide Treppen in z-Richtung und bleiben gerade. Hinter ihnen setzt die Abdichtung volle Blöcke.

Lage y=24 des Wachturm-Helms, Nordhälfte (Legende unten):

```
heute                      Vorschlag A
.....-*vvvvvv-.....        .....-*vvvvv*-.....
....-*+....#vv-....        ....-*+.....+*-....
...-*+......#vv-...        ...-*+.......+*-...
..-*+........#vv-..        ..-*+.........+*-..
..*+..........#v*..        ..*+...........+*..
..>.............<..        ..>.............<..
```

**Ursache 2 – Raster.** Pro Dachlage rückt eine Schräge des Achtecks im Mittel um etwa 1,3 Zelldiagonalen nach innen.
- Rückt sie um zwei, entsteht ein geschlossener Zickzack aus Außen- und Innenecken (oben).
- Rückt sie nur um eine, berühren sich die Treppen nur über Eck. Dann bleibt jede Treppe gerade und steht allein, mit einem vollen Block dahinter. Das passiert bei einem großen Teil der Treppenlagen, am Wachturm-Helm z. B. bei y=25 und y=30.

Lage y=25, auch mit Vorschlag A noch einzelne Treppen:

```
.......vvvvv.......
......>.....<......
.....>#.....#<.....
....>#.......#<....
...>#.........#<...
...>...........<...
```

Legende: `v` `^` `>` `<` gerade Treppe mit Blick nach Süden, Norden, Osten, Westen · `*` Außenecke · `+` Innenecke · `-` untere Stufe · `#` voller Block.

**Vorschlag A – Innenecken blicken in x-Richtung** (klein, ändert die Spezifikation 5.2):
- Grenzt eine Treppe an zwei Seiten über Eck an die nächste Lage, blickt sie nach Osten oder Westen. Grenzt sie nur schräg an, bleibt es bei der z-Richtung.
- Probe am Wachturm (danach wieder zurückgenommen): Alle Lagen mit Doppelschritt werden auf allen vier Schrägen zu sauberen, symmetrischen Zickzacks, ohne Abdichtungsblöcke. Kehlen bleiben Innenecken, nur ihre Blickrichtung wechselt.
- Dieselbe Regel gehört auch ins Kranzdach und zu den Konsolen.
- In der Spezifikation fällt der Satz zur Reihenfolge n, o, s, w weg. Der Test „verschneidet Dächer“ erwartet an der Kehle `facing=north` und müsste angepasst werden.

**Vorschlag B – Schrägen immer im Zickzack** (größer, zwei Wege; erst mit Bildern vergleichen):
- **B1 Doppelschritte:** Die Schrägen rücken nur in Zweierschritten ein, also 0 oder 2 Diagonalen pro Lage, im Mittel so viel wie heute. Dazwischen steht die Schräge eine Lage lang senkrecht aus vollen Blöcken. Die Form bleibt ein Achteck, die Schrägen werden etwas stufiger.
- **B2 Ecken auffüllen:** Wo sich zwei Treppen nur über Eck berühren, kommt außen die fehlende Eckzelle dazu. Dann ist es immer ein Zickzack. Die Schrägen werden aber flacher als die geraden Seiten, und weiter oben wird das Achteck zur Raute.
- Mit B braucht man die Abdichtung (volle Blöcke hinter offenen Treppenseiten) kaum noch; als Absicherung kann sie bleiben.

**Empfehlung:** Zuerst A, weil es klein ist und klar besser aussieht. Danach B1 und B2 als Probe am Wachturm-Helm und am Kegeldach von `haus-mit-rundturm.tess` bauen und Bildschirmfotos vergleichen.

---

## 2. Achteck-Profile: „zwei breiter“ ist an den geraden Seiten nur einer

*Beim Bau des Wachturms aufgefallen. Status: offen.*

**Beobachtung:** `profil=0:2` beim `vieleck` soll den Turm unten um zwei Blöcke verbreitern. Die Schrägen wachsen um zwei, die geraden Seiten nur um einen: Beim Achteck mit r=5 liegen sie fünf Zellen von der Mitte, mit r=7 sechs. Dasselbe gilt für `ueberstand` bei Dächern auf Vielecken; deshalb hat der Helm des Wachturms `ueberstand=2`.

**Ursache:** Die Spezifikation (4.3, 5.2) verschiebt beim Vieleck den Radius des Umkreises. Die geraden Seiten liegen um den Faktor cos(180°/n) näher an der Mitte, beim Achteck 0,92.

**Vorschlag** (ändert die Spezifikation 4.3 und 5.2): Beim Vieleck beziehen sich Versatz und Überstand auf den Abstand der geraden Seiten. Der Umkreis wächst dann um v / cos(180°/n), und jede Seite rückt um v; `ueberstand=1` bedeutet dann an jeder Seite einen Block Überstand. Bestehende Dateien mit `tess 2` sähen danach etwas anders aus, das betrifft bisher nur den Wachturm.

---

## 3. Steile Helme wirken wie gestapelte Trommeln

*Beim Bau des Wachturms aufgefallen. Status: offen, erst Ideen.*

**Beobachtung:** Bei `profil=1/3` (Standard beim `helm` und Ende der Voreinstellung `glocke`) steht jede Stufe zwei Lagen senkrecht aus vollen Blöcken, darüber kommt eine Treppenreihe. Von weitem sieht der Helm aus wie gestapelte Trommeln.

**Ideen zum Ausprobieren:**
- Die Voreinstellung `glocke` endet mit `1/2` statt `1/3`.
- Eine Angabe, die unter die Außenkante jeder Stufe umgedrehte Treppen setzt, wie eine kleine Traufe pro Stufe. Das betont die Staffelung, statt sie zu verstecken.
- Mit Bildschirmfotos entscheiden. Steilere Helme brauchen in Minecraft immer senkrechte Abschnitte.

---

## 4. Kegeldächer aus Version 1 sehen mit `tess 2` anders aus

*Beim Vergleich von Version 1 und 2 aufgefallen. Status: offen.*

**Beobachtung:** Eine Datei aus Version 1 ergibt mit `tess 2` dieselben Blöcke, nur das Kegeldach nicht: Treppenrichtungen in den Ecken und einzelne Blöcke innen weichen ab. Mit `tess 1` bleibt alles wie in 0.3.0.

**Ursache:** Der Kegel aus Version 1 lässt jede Treppe zur Mitte blicken, die Dachmaschine nimmt die Regeln aus Eintrag 1.

**Vorschlag:** Eintrag 1 (A und B) macht runde Dächer symmetrisch und behebt den Großteil. Volle Gleichheit gäbe es nur mit einem Sonderfall für `dach kegel` auf dem `zylinder`; der lohnt sich vermutlich nicht.

---

## Vorlage für neue Einträge

```
## N. Kurzer Titel

*Wo und wann aufgefallen. Status: offen.*

**Beobachtung:** Was ist zu sehen? Datei, Zeile, Bildschirmfoto.

**Ursache:** Woher kommt es (falls bekannt)?

**Vorschlag:** Was würde helfen? Ändert es die Spezifikation? Welche Tests betrifft es?
```
