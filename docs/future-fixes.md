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

## 5. Erker am Giebel verschmilzt mit dem Ortgang

*Beim Bau des Fachwerkhauses aufgefallen (Etappe 4b). Status: offen.*

**Beobachtung:** Ein Erker auf der Giebelseite eines Satteldachs bekommt kein eigenes Dach, sondern einen Klotz aus vollen Dachblöcken vor dem Giebel.

```
tess 2
rolle putz white_terracotta
rolle holz spruce_planks
rolle rahmen oak_planks
rolle dach deepslate_tiles
box h 0,0,0 12,9,8 putz hohl
dach sattel h first=x
erker h o y=4 b=5 h=3 art=halbrund holz
```

Statt eines eigenen Kegels steht vor dem Ostgiebel ein Klotz aus Dachblöcken: bei x=13 in y=11 und 12 eine senkrechte Wand aus `deepslate_tiles` (z=3 bis 5), darunter Treppen, die in die Giebelfläche laufen. Mit `dach=helm` sieht es ähnlich aus.

**Ursache:** Das Erkerdach wird auf der hinter die Wand gespiegelten Form gerechnet und verschneidet sich nach 5.3 mit dem Satteldach. Die Vereinigung der Lagen füllt die Zellen vor dem Giebel bis zum Ortgang.

**Vorschlag:** Ein Erkerdach an einer Giebelseite nicht mit dem Hauptdach verschneiden, sondern nur dort setzen, wo es über dem Hauptdach liegt oder vor der Giebelwand frei steht. Ändert die Spezifikation 5.3 und 6.5 nicht, nur die Umsetzung. Neuer Test: Erker an der Giebelseite, Helm mit eigener Spitze, keine Dachblöcke in der Giebelebene darunter.

---

## 6. Gesims am Vieleck stößt an Anbauten

*Beim Bau des Wachturms aufgefallen (Etappe 4b). Status: offen.*

**Beobachtung:** Ein Gesims rundum stößt an jeden Anbau und meldet das als Hinweis. Am Wachturm braucht es deshalb `seiten=n,w,s`.

```
tess 2
rolle stein stone_bricks
rolle zier stone_bricks
rolle putz white_terracotta
vieleck t 0,0,0 n=8 r=5 h=6 stein hohl
box 6,0,-2 10,4,2 putz
gesims t y=1 zier
```

Meldung: „Zeile 7: Das Gesims stößt bei 6,1,-2 und 4 weiteren Stellen an Blöcke aus Zeile 6 und fehlt dort.“

**Ursache:** Das Gesims setzt außen nur in Luft und meldet jedes Hindernis wie ein Anbau. `seiten=` wählt bei runden Formen nach Winkel (±45°, Schrägen ±22,5°); an einem Achteck mit Anbau an einer Seite passt das nur grob.

**Vorschlag:** Wo das Band auf eine fremde Wand trifft (die Zelle grenzt an einen Block einer anderen Form), endet es ohne Hinweis; nur Fenster, Türen und Anbauten im Band bleiben ein Hinweis. Alternativ `seiten=` mit Ausschluss (`seiten=alle,-o`). Betrifft 6.4 nur in der Umsetzung, Test in `tess2b.test.ts` ergänzen.

---

## 7. Schmales Feld: Wasser am Rand

*Beim Test von `feld` aufgefallen (Etappe 4b). Status: offen.*

**Beobachtung:** Bei einem Feld mit zwei Zellen Breite liegt die Wasserreihe am Rand und fließt aus.

```
tess 2
feld 0,0,0 19,0,1
```

Meldung: „Zeile 2: Fließen: Das Wasser bei 1,0,0 fließt aus (daneben oder darunter ist Luft); ebenso 17 weitere Zellen aus dieser Zeile.“

**Ursache:** Die erste Reihe liegt auf Abstand min(4, (B−1)/2) vom Rand (8); bei B=2 ist das 0. Die Entscheidung „Wasser nie in der Randreihe“ greift nur, wenn es eine innere Reihe gibt.

**Vorschlag:** Felder unter drei Zellen Breite bekommen kein eigenes Wasser, sondern einen Hinweis („zu schmal für Wasser, Wasser daneben anlegen“), oder die Wasserreihe kommt in einen Rand aus Blöcken, der außen geschlossen ist. Ändert 8 (Lücke der Spezifikation), Test mit B=1 und B=2.

---

## 8. Lücken der Prüfungen

*Beim Test der Prüfungen aufgefallen (Etappe 4b). Status: offen.*

**Beobachtung:** Drei Fälle melden nichts.

1. **Wasser neben empfindlichen Blöcken:** Wasser schwemmt Fackeln und Blumen weg, eine wassergefüllte Stufe neben Luft fließt aus. Keine Meldung dazu (nur das Fließen des Wassers selbst):
   ```
   tess 2
   rolle stein stone_bricks
   box 0,0,0 4,0,4 stein
   block 2,1,2 water
   block 1,1,2 torch
   block 2,1,1 stone_brick_slab[waterlogged=true]
   ```
2. **Plattform an Ketten:** Eine Plattform, die nur über Ketten an einem Balken hängt, gilt als verbunden. Im Spiel hält das; ob es gemeldet werden soll, ist offen:
   ```
   tess 2
   rolle balken dark_oak_log
   rolle holz spruce_planks
   linie 0,0,0 0,6,0 balken
   linie 1,6,0 3,6,0 balken
   block 3,5,0 chain
   block 3,4,0 chain
   box 2,3,-1 4,3,1 holz
   ```
3. **Überschrieben:** Eine spätere Anweisung, die Fensterrahmen (Sturz, Bank), Fachwerk oder Dachblöcke ersetzt, meldet nichts; gemeldet werden nur Glas, Tür und Anbau:
   ```
   tess 2
   rolle putz white_terracotta
   rolle stein stone_bricks
   rolle dach deepslate_tiles
   rolle glas glass_pane
   rolle rahmen oak_planks
   rolle balken dark_oak_log
   box h 0,0,0 8,4,6 putz hohl fachwerk=balken
   fenster h s y=1 x=2
   dach sattel h
   block 2,3,6 stein
   block 0,2,6 stein
   block 4,7,3 stein
   ```
   Die drei `block`-Zeilen ersetzen den Sturz, einen Eckpfosten und einen Dachblock ohne Hinweis.

**Ursache:** Die Prüfungen aus 11 decken genau die dort genannten Fälle ab.

**Vorschlag:** (1) Fließen auch für `waterlogged=true` und ein Hinweis „Wasser schwemmt … weg“ für Fackeln, Pflanzen, Teppiche und Schienen neben Wasser. (2) Mit Adrian klären. (3) Überschrieben auf Rahmen, Fachwerk und Dach ausdehnen, aber nicht auf gewollte Freistil-Änderungen (Etappe 4c, `block`/`leer` am Dateiende). Alles ergänzt 11 der Spezifikation.

---

## 9. Erkerdach: halber Helm vor dem Dach

*Beim Abschluss von 4b aufgefallen (30.10.2026). Status: offen.*

**Beobachtung:** Der Erkerhelm des Fachwerkhauses (`beispiele/fachwerkhaus.tess`, Zeile `erker og s …`) ist ein halber Kegel, der vor dem Hauptdach steht. Von vorn wirkt er als Spitze, von Osten oder Westen als dunkle, senkrechte Scheibe. Den Überstand des Erkerdachs kann man nicht einstellen (immer 1), schlanker geht es nur über `dachprofil=`.

**Ursache:** Das Erkerdach wird auf der hinter die Wand gespiegelten Form gerechnet und nur vor der Wand gebaut (Entscheidung 4b zu 6.5); seine Spitze liegt deshalb in der Wandebene. Es gehört zur Dachgruppe des Hauptdachs.

**Vorschlag:** Für `halbrund` und `dreieck` einen ganzen Helm um die Mitte des Erkers vor der Wand rechnen (Spitze über dem Erker, nicht in der Wand), dazu `dachueberstand=` beim Erker. Ändert die Umsetzung von 6.5, nicht die Syntax; Bildvergleich am Fachwerkhaus.

---

## 10. Hexenhut-Biegung: Spitze endet in einer umgedrehten Treppe

*Beim Test der Ecktürmchen aufgefallen (Etappe 4b). Status: offen.*

**Beobachtung:**

```
tess 2
rolle stein stone_bricks
rolle dach deepslate_tiles
zylinder t 0,0,0 r=4 h=6 stein hohl
dach helm t biegung=o:3 spitze=lightning_rod
```

Der oberste Block (2,22,0) ist `deepslate_tile_stairs[facing=west,half=top]`, darunter stufen sich weitere umgedrehte Treppen schräg nach oben. Die Spitze fehlt mit dem Hinweis „Das Dach endet in einem First, nicht in einer Spitze“. Bei kleinen Ecktürmchen (`r=2 … biegung=w:2`) besteht die ganze Spitze aus drei schräg gestaffelten Treppen.

**Ursache:** In den obersten Lagen verschiebt die Biegung die einzelne Zelle zur Seite. Die Dachmaschine behandelt sie als Bauch (Zelle neu in O(y+1)) und setzt eine umgedrehte Treppe statt des Abschlusses.

**Vorschlag:** Eine einzelne verschobene Zelle in der letzten Lage wird Spitze (voller Block, darauf `spitze=`), verschobene Zellen darunter normale Treppen in Biegerichtung. Betrifft 5.2/5.4 in der Umsetzung; Test „Biegung mit Spitze“.

---

## 11. Wendeltreppe außen mit `breite` > 1: zwei Treppen hintereinander

*Beim Beheben der inneren Wendeltreppe aufgefallen (Etappe 4b). Status: offen.*

**Beobachtung:**

```
tess 2
rolle stein stone_bricks
rolle holz spruce_planks
box t 0,0,0 4,10,4 stein hohl
wendeltreppe t aussen bis=8 holz breite=2
```

In Lage 2 stehen im äußeren Ring (4,2,−2) und (5,2,−2) zwei Treppen gleich hoch hintereinander, beide nach Osten. Beim Gehen gibt es einen Buckel.

**Ursache:** Der äußere Ring hat mehr Zellen als der Weg; überzählige Zellen kommen in dieselbe Stufe, alle als Treppe. Die innere Wendeltreppe macht daraus seit 4b Absätze (untere Stufen).

**Vorschlag:** Dieselbe Regel wie innen: Hat ein Ring zwei Zellen in einer Stufe, wird die erste eine untere Stufe. Test wie für die innere Treppe (kein Ring springt, keine zwei Treppen gleich hoch hintereinander).

---

## 12. Freistehende Wendeltreppe meldet Schweben

*Beim Test der Wendeltreppe aufgefallen (Etappe 4b). Status: offen.*

**Beobachtung:** `wendeltreppe 0,0,0 r=3 bis=8 holz` ohne Turm und ohne Spindel meldet drei Gruppen „Schweben“. In einem Turm mit Wand oder mit `spindel=` kommt keine Meldung.

**Ursache:** An schrägen Stellen des Rings berühren sich zwei Stufen nur an einer Ecke; die Prüfung verbindet über Seiten und Kanten. Im Spiel braucht man dort tatsächlich eine Stütze.

**Vorschlag:** Die Prüfung so lassen, aber der Hinweis nennt bei Wendeltreppen den Grund („Stufen berühren sich nur an Ecken – `spindel=` oder Wand ergänzen“).

---

## 13. Balkon-Pultdach an einer verjüngten Wand endet vor der Wand

*Beim Rückholen der Wachturm-Maße aufgefallen (Etappe 4b). Status: offen.*

**Beobachtung:**

```
tess 2
rolle stein stone_bricks
rolle holz spruce_planks
rolle rahmen oak_planks
rolle tuer spruce_door
vieleck t 0,0,0 n=8 r=5 h=16 stein hohl profil=0:2,3:2~,12:0
balkon t w y=7 b=3 tiefe=2 dach=holz stuetzen=holz
```

Die oberste Dachtreppe liegt bei (−7,12,0), die Wand in dieser Lage bei x=−5; dazwischen bleibt (−6,12,0) offen, und Tessera meldet das ganze Dach als schwebend („15 Blöcke … keine Verbindung zum Boden“). Darum steht der Balkon am Wachturm in Lage 8 und die Verjüngung endet in Lage 8 statt 12.

**Ursache:** Das Pultdach steigt zur Wand der Balkonlage an; springt die Wand darüber zurück, bleibt eine Lücke.

**Vorschlag:** Jede Dachreihe läuft bis zur Wandzelle ihrer eigenen Lage. Danach kann der Wachturm die Verjüngung bis Lage 12 bekommen, wie im Auftrag 4a. Test mit verjüngter Wand.

---

## 14. Kopfbänder: eine `strebe`-Zeile pro Pfosten

*Beim Fachwerkhaus aufgefallen (Etappe 4b). Status: offen, Spracherweiterung.*

**Beobachtung:** Das Fachwerkhaus braucht acht `strebe`-Zeilen mit Hand-Koordinaten für die Kopfbänder. Schräg (zwei Treppen) wirken sie erst ab zwei Blöcken Vorkragung; deshalb kragt das Obergeschoss dort zwei Blöcke vor.

**Ursache:** `strebe` ist eine Einzelanweisung ohne Bezug zu Form und Fachwerk.

**Vorschlag** (ändert die Spezifikation 4.3 oder 6.4): `kopfbaender=R` beim Wandprofil oder an `fachwerk=` setzt unter jede Vorkragung an jedem Pfosten eine Strebe passender Länge; alternativ `strebe <form> <seite> an=pfosten`. Test: Zahl und Lage der Kopfbänder an einer box mit `profil=6:2`.

---

## 15. Fachwerk: Muster gilt für alle Felder

*Beim Aufhellen des Fachwerkhauses aufgefallen (Etappe 4b). Status: offen, Spracherweiterung.*

**Beobachtung:** `muster=strebe` setzt in jedes Feld eine Diagonale; das Obergeschoss wurde damit sehr dunkel. `muster=gerade` ist hell, aber schlicht. Das typische Bild mit Streben nur in den Endfeldern („Mann“) geht nicht.

**Ursache:** 4.4 kennt nur ein Muster für alle Felder einer Form.

**Vorschlag** (ändert 4.4): `muster=mann` (Streben nur in den beiden Endfeldern jedes Wandstücks, zur Mitte steigend) und/oder `muster=strebe:ende`. Test: Felder in der Mitte bleiben Putz.

---

## 16. Kreuzende hohle Formen brauchen `leer`-Zeilen

*Beim Fachwerkhaus aufgefallen (Etappe 4b). Status: offen, Spracherweiterung.*

**Beobachtung:** Lang- und Querhaus des Fachwerkhauses sind zwei hohle boxen; ihre Innenwände im Kreuzungsbereich räumen acht `leer`-Zeilen mit Hand-Koordinaten. Ein `grundriss` in Kreuzform wäre eine Form, aber Satteldächer gibt es nur auf der box.

**Ursache:** `hohl` räumt nur das eigene Innere; Satteldach, Pultdach und Krüppelwalm verlangen eine box.

**Vorschlag** (ändert 4.1 oder 5.1): `verbinde=<form>` bei einer hohlen Form räumt die Wände im gemeinsamen Inneren beider Formen; oder Satteldächer auf rechteckigen Teilen von umriss und grundriss. Test: Kreuzhaus ohne `leer`.

---

## 17. Bündiger Anbau: zweite Kehle und volle Blöcke in der Traufe

*Beim Bau des Wachturms aufgefallen (Etappe 4a, Übergabe 4a). Status: offen.*

**Beobachtung:** Am L-Anbau des Wachturms (`box haus`, `box fluegel`, beide an der Ostseite bei x=13) entstehen zwei Kehlen: (8,5,4)–(10,7,2) und (14,5,4)–(12,7,2). Wo die Traufe des Flügels auf den Ortgang des Hauses trifft, sind (14,5,2) und (14,5,3) volle Blöcke statt Treppen.

**Ursache:** Die Vereinigung der Lagen (5.3) bildet, wo zwei Dachflächen zusammenlaufen, immer eine Kehle, nie einen Grat. In Lage 0 gehören (14,5,2) und (14,5,3) zum Ortgang des Hauses, der dort als Schale volle Blöcke hat.

**Vorschlag:** Kurzfristig im Zielbau den Flügel einen Block einrücken. Langfristig: Wo eine Traufe in einen Ortgang läuft, Treppen statt Schale; ein L mit Grat geht heute nur als `walm` auf einem L-förmigen `umriss`. Bildvergleich am Anbau.

---

## 18. Reihenfolge: Stützen, Hängelaternen und Efeu sehen nur frühere Blöcke

*Beim Wachturm aufgefallen (Etappe 4b). Status: offen.*

**Beobachtung:** Stützen eines Umgangs reichen nur bis unter Blöcke, die vorher gebaut sind; eine `haengelaterne` meldet „Über … ist kein Block“, wenn der Block erst später kommt; Efeu wächst nur vor schon gebauten Wänden. Am Wachturm müssen Obergeschoss und Schürze deshalb vor dem `umgang` stehen.

**Ursache:** Anweisungen laufen streng von oben nach unten.

**Vorschlag:** Stützen, Hängelaternen und Efeu nach allen anderen Anweisungen setzen (zweiter Durchgang) oder einen Hinweis geben, wenn eine spätere Zeile über einer Stütze baut. Spätestens mit den Modulen in 4c wichtig.

---

## 19. Richtungswörter in Blockzuständen nur bei `facing`

*Aus der Übergabe 4a, beim Abschluss von 4b nachgeprüft. Status: offen.*

**Beobachtung:** `block 2,1,0 hopper[facing=unten]` ergibt `facing=down`, aber `block 0,1,0 pointed_dripstone[vertical_direction=unten]` übernimmt `unten` unverändert, ohne Fehler; der Zustand ist im Spiel ungültig. Fehlende Zustände ergänzt Tessera nur für Blöcke, die es kennt (hier fehlen `thickness` und `waterlogged`).

**Ursache:** Die Übersetzung von n/o/s/w/oben/unten (1.4) ist nur für `facing` umgesetzt; Zustandswerte werden ohne Katalog nicht geprüft.

**Vorschlag:** Richtungswörter bei allen Zuständen mit Richtungswerten übersetzen; unbekannte Zustandswerte als Fehler melden, sobald die gültigen Werte bekannt sind (Katalog oder eingebaute Tabelle). Test mit `vertical_direction`.

---

## 20. Leistung und Grenzen

*Aus den Übergaben 4a und 4b. Status: Dachgruppen vor 4c in einem eigenen Chat geplant, Rest offen.*

**Beobachtung:**
- Jedes neue Dach zeichnet seine ganze Gruppe neu: 50 Häuser in einer Reihe mit sich berührenden Satteldächern dauern 0,8 s, 100 Häuser 4,3 s, 200 Häuser 28 s (57.000 Blöcke). Der Leistungstest erfasst das nicht.
- Die Grenze von 2 Millionen ausgeführten Anweisungen (10) fehlt; die 8-Millionen-Grenze zählt jedes Setzen, auch das Neuzeichnen von Dachgruppen.
- Gemessen ist in Node, nicht im Browser-Worker.

**Vorschlag:** Dachgruppen nur im geänderten Bereich neu zeichnen und pro Zelle nur die betroffenen Dächer prüfen; Leistungstest um eine große Dachgruppe ergänzen; beide Grenzen nach 10 zählen. `compile.ts` vorher aufteilen.

---

## 21. Testlücken

*Aus den Übergaben 4a und 4b. Status: offen.*

**Beobachtung:**
- `dach … rolle=` hat in Version 2 keinen eigenen Test.
- Der Klick auf einen Hinweis (Markieren der Zeile, Kamera) ist nur headless geprüft, ohne Test.
- Konsolen, Streben und Treppen an Ecken (Vieleck, Kreis, Kehlen) sind nicht systematisch geprüft.
- Einige Angaben sind nur mit ihrem Standardwert getestet: `boden=`, `gelaender=` und `konsolen=` bei balkon und umgang; `tiefe=`, `konsolen=` und `stufen=` beim erker (`dachprofil=` nur über das Fachwerkhaus); `kopffreiheit=` und bei `wendeltreppe … aussen` auch `konsolen=` und `y=`/`ebene=`.

**Vorschlag:** Je ein Verhaltenstest; für die Ecken ein Test, der für alle Treppen einer Lage prüft, dass sie zu einer Nachbarzelle der nächsten Lage blicken.

---

## 22. Viewer: Banner und Ranken

*Beim Ansehen der Zielbauten aufgefallen (Etappe 4b). Status: offen.*

**Beobachtung:** Wandbanner erscheinen einen Block hoch und ohne Muster, Ranken als flache grüne Platten.

**Ursache:** Banner sind Block-Entities ohne Modell; Ranken werden als Farbfläche gezeichnet.

**Vorschlag:** Wandbanner als zwei Blöcke hohe, flache Tafel an der Wand zeichnen (wie im Spiel nach unten hängend), Ranken als dünne Fläche direkt an der Wandseite. Gehört zu den Grundformen im Viewer, nicht zur Bau-Sprache.

---

## 23. Zielbauten: offene Schönheitsfehler

*Beim Abschluss von 4b aus vier Richtungen angesehen (30.10.2026). Status: offen.*

**Wachturm:**
- Der Glockenhelm ist etwa so hoch wie der übrige Turm und dominiert; stufig wie gestapelte Trommeln (Eintrag 3).
- Das Obergeschoss ist zwischen Schürze und Helm gedrückt, sichtbar sind etwa drei Lagen; die Schürze wirkt schwer.
- Das Gesims in Lage 1 wirkt wie eine Fußleiste.
- Das Balkondach liegt direkt unter dem Boden des Umgangs; der Bereich wirkt gedrängt.
- Die Verjüngung endet in Lage 8 statt 12 (Eintrag 13).

**Fachwerkhaus:**
- Erkerhelm von der Seite eine dunkle Scheibe (Eintrag 9).
- Der Kragen des Schornsteins wirkt wie ein Teller.
- Die Dächer sind groß und dunkel und überwiegen.
- Die Vorkragung ist zwei Blöcke tief statt üblicherweise einem (Eintrag 14).

**Vorschlag:** Nach Etappe 4 eine eigene Schönheitsrunde mit Bildschirmfotos (`scripts/fotos.mjs`) und, wo nötig, den Einträgen oben.

---

## Vorlage für neue Einträge

```
## N. Kurzer Titel

*Wo und wann aufgefallen. Status: offen.*

**Beobachtung:** Was ist zu sehen? Datei, Zeile, Bildschirmfoto.

**Ursache:** Woher kommt es (falls bekannt)?

**Vorschlag:** Was würde helfen? Ändert es die Spezifikation? Welche Tests betrifft es?
```
