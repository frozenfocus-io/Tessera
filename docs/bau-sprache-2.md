# Bau-Sprache 2 – Spezifikation (Soll, Etappe 4)

Diese Datei legt fest, was die Bau-Sprache nach Etappe 4 können muss und wie sich jede Anweisung genau verhält. Sie ist die Vorgabe für die Umsetzung. Die Ist-Referenz bleibt [bau-sprache.md](bau-sprache.md); sie wird nach jedem Teil von Etappe 4 auf den umgesetzten Stand gebracht.

**Ziel:** Detailreiche, verspielte Fantasy-Bauten (Zaubertürme mit Wendeltreppen außen, Wachtürme mit Umgängen und gestaffelten Helmen, Fachwerkhäuser mit Vorkragungen, Gauben und Erkern) müssen sich in wenigen hundert Zeilen beschreiben lassen. Die Sprache darf nie der Grund sein, warum ein Detail fehlt.

**Wie das erreicht wird:**

1. **Bauteile** für alles Häufige. Sie rechnen Lage, Ausrichtung und Blockzustände selbst; das schützt vor Fehlplatzierungen.
2. **Profile** für Wände und Dächer. Eine Zeile beschreibt Vorkragung, Verjüngung, Glockendach oder Zwiebelhelm.
3. **Freistil** für alles andere: Einzelblöcke, ASCII-Ebenen und ASCII-Ansichten von Wänden mit Tiefe. Damit ist jede Blockposition mit jedem Zustand erreichbar.
4. **Module, Werte, Wiederholung und Spiegelung**, damit Wiederkehrendes nur einmal beschrieben wird.

**Verbindlichkeit:** Syntax und Verhalten dieser Datei sind verbindlich. Erweiterungen (zusätzliche Angaben, Befehle, Voreinstellungen) sind erlaubt, wenn sie bestehende Dateien nicht verändern und in `bau-sprache.md` dokumentiert werden. Abweichungen vom hier Festgelegten nur nach Rücksprache mit Adrian. Wo diese Spezifikation eine Lücke hat, gilt: so entscheiden, wie ein erfahrener Minecraft-Bauer es erwarten würde, die Entscheidung in `bau-sprache.md` festhalten und im Abschlussbericht des Teils nennen.

---

## 1 Grundlagen

### 1.1 Versionen

- Die erste Anweisung ist `tess 1` oder `tess 2`.
- `tess 1`: Dateien aus Etappe 3. Sie müssen **blockgenau dasselbe Ergebnis** liefern wie in Version 0.3.0 (Regressionstest mit `beispiele/haus-mit-rundturm.tess` und den Testfällen aus `test/tess.test.ts`). Neue Befehle sind in `tess 1`-Dateien ein Fehler mit dem Hinweis, `tess 2` zu verwenden.
- `tess 2`: alles aus dieser Datei. Alle Befehle aus Version 1 gelten mit unveränderter Bedeutung weiter; hier genannte Erweiterungen kommen dazu.

### 1.2 Zeilen, Kommentare, Fortsetzung, Blöcke

- Eine Anweisung pro Zeile. `#` beginnt einen Kommentar bis zum Zeilenende (außerhalb von Anführungszeichen und ASCII-Zeilen).
- Eine Zeile, deren letztes Zeichen vor einem Kommentar `\` ist, wird mit der nächsten Zeile verbunden. Fehlermeldungen nennen die erste Zeile der Anweisung.
- **Abschnittsbefehle** (`modul`, `wiederhole`, `spiegle`) umschließen Anweisungen bis zur passenden Zeile `ende`. Sie dürfen verschachtelt werden. Einrückung ist bedeutungslos, aber empfohlen.
- **ASCII-Zeilen** beginnen mit `|` (Leerzeichen davor sind erlaubt). Alles nach dem `|` gehört bis zum Zeilenende zur Zeichnung, auch `#` und Leerzeichen. Sie folgen direkt auf `grundriss`, `ebene`, `ebenen` oder `ansicht`; die Zeichnung endet mit der ersten Zeile, die nicht mit `|` beginnt. Nachgestellte Leerzeichen in ASCII-Zeilen sind bedeutungslos.

### 1.3 Tokens

Wie Version 1 (Wörter, Zahlen, Koordinaten, Texte in `"…"`, Paare `schlüssel=wert`), dazu:

- **Ausdrücke** in geschweiften Klammern `{…}` überall, wo eine ganze Zahl stehen darf, auch als Teil einer Koordinate: `{haus.x1+1},0,{haus.mz}`. Innerhalb von `{…}` sind Leerzeichen erlaubt; das Token endet erst nach der schließenden Klammer.
- **Dezimalzahlen** (`0.3`, `10.5`) nur bei den Angaben, die das ausdrücklich erlauben (`dichte`, `drehung` bei `vieleck`, Spiegelachsen).
- **Listen** als Wert eines Paares, getrennt mit Kommas: `riegel=2,5`. Punkte von `umriss` mit Semikolon: `punkte=0,0;10,0;10,6`.
- **Namen** bestehen aus Buchstaben, Ziffern, `_` und dürfen Ausdrücke enthalten: `turm{i}`. Ein Punkt trennt Teile: `nordturm.turm` (Form `turm` im Modul `nordturm`), `haus.x1` (Feld einer Form).
- Schlüssel, Befehle, Rollen- und Seitennamen: Groß/klein egal, Umlaute gleich ihrer Umschreibung (`tür` = `tuer`).

### 1.4 Koordinaten und Richtungen

- x nach Osten, y nach oben, z nach Süden, wie in Minecraft. Erlaubt −4000 bis 4000 auf jeder Achse.
- Eine Zelle `(x, z)` hat ihren Mittelpunkt bei `(x+0.5, z+0.5)`. Alle geometrischen Tests (innen/außen) prüfen Zellmittelpunkte.
- **Seiten:** `n` (−z), `o` (+x), `s` (+z), `w` (−x), dazu `no`, `so`, `sw`, `nw` für runde und vieleckige Formen. Ausgeschrieben `nord`, `ost`, `sued`, `west`, `nordost` … ebenfalls erlaubt.
- **Winkel** in Grad nach Kompass: 0 = Norden, 90 = Osten, im Uhrzeigersinn von oben gesehen.
- **Blickrichtungen in Blockzuständen:** `n/o/s/w/oben/unten` oder die Minecraft-Namen (`north` …). In `ansicht` zusätzlich relativ: `aussen`, `innen`, `links`, `rechts` (links/rechts von außen gesehen).

### 1.5 Reihenfolge und Überschreiben

Anweisungen laufen von oben nach unten. Ein später gesetzter Block ersetzt einen früheren an derselben Stelle. Ausnahmen sind genannt (Dächer verschneiden sich, Anbauten außen setzen nur in Luft). Hohle Formen räumen ihr Inneres (wie in Version 1).

---

## 2 Werte und Ausdrücke

```
wert <name>=<ausdruck>
```

- Legt einen ganzzahligen Wert fest, sichtbar in allen folgenden Zeilen desselben Gültigkeitsbereichs (Datei oder Modul). Neu festlegen ist erlaubt und gilt ab dieser Zeile.
- **Ausdrücke:** ganze Zahlen, Namen von Werten, Modul-Angaben und Schleifenvariablen, Felder von Formen, Klammern, `+ - * / %`, einstelliges Minus.
  - `/` ist ganzzahlige Division mit Abrunden (`-7/2 = -4`), `%` liefert immer ein Ergebnis von 0 bis Divisor−1.
  - Funktionen: `min(a,b,…)`, `max(a,b,…)`, `abs(a)`, `clamp(v,a,b)`, `zufall(a,b,k)`.
  - `zufall` liefert eine ganze Zahl von a bis b (einschließlich). Sie hängt nur von `samen`, der Zeile und k ab; gleiche Datei, gleiches Ergebnis.
- **Felder von Formen** (nach der Anweisung, die die Form anlegt):

| Feld | Bedeutung |
| --- | --- |
| `x0 y0 z0 x1 y1 z1` | umschließender Quader der Form (ohne Dach), einschließlich |
| `bx by bz` | Ausdehnung (`x1-x0+1` …) |
| `mx mz` | Mitte (`(x0+x1)/2`, abgerundet); bei zylinder und vieleck die Mittelzelle |
| `r` | Radius (zylinder, vieleck) |
| `dach` | höchste Lage des Dachs der Form; ohne Dach `y1` |

Ein unbekanntes Feld oder eine noch nicht angelegte Form ist ein Fehler mit Zeilennummer.

---

## 3 Rollen

```
rolle <name> <block>[:gewicht] … [<glied>=<id> …] [muster=einzeln|flecken:<n>|lagen:<n>]
```

Alles aus Version 1 gilt. Neu:

**Glieder einer Blockfamilie.** In Anweisungen wird ein Glied mit `rolle:glied` angesprochen, z. B. `gelaender=holz:zaun`.

| Glied | Minecraft | ohne Katalog abgeleitet aus dem Grundblock |
| --- | --- | --- |
| `block` | Grundblock | – |
| `treppe` | stairs | wie Version 1 |
| `stufe` | slab | wie Version 1 |
| `mauer` | wall | wie Version 1 |
| `zaun` | fence | `…_planks` → `…_fence`, `nether_bricks` → `nether_brick_fence` |
| `zauntor` | fence_gate | `…_planks` → `…_fence_gate` |
| `falltuer` | trapdoor | `…_planks` → `…_trapdoor`, `iron_block` → `iron_trapdoor` |
| `tuer` | door | `…_planks` → `…_door`, `iron_block` → `iron_door` |
| `knopf` | button | `…_planks` → `…_button`, `stone` → `stone_button`, `polished_blackstone` → `polished_blackstone_button` |
| `druckplatte` | pressure_plate | entsprechend `knopf` |
| `scheibe` | pane | `glass` → `glass_pane`, `<farbe>_stained_glass` → `<farbe>_stained_glass_pane` |
| `teppich` | carpet | `<farbe>_wool` → `<farbe>_carpet`, `moss_block` → `moss_carpet` |

Mit Katalog kommen die Glieder aus dessen Familien (Rollen `stairs`, `slab`, `wall`, `fence`, `fence_gate`, `trapdoor`, `door`, `button`, `pressure_plate`, `pane`, `carpet`). Eine Rolle darf aus einem Glied bestehen, wenn der Grundblock fehlt: `rolle laden spruce_trapdoor` bleibt erlaubt; wird `laden:block` verlangt, ist das die Falltür selbst.

**Verteilung gemischter Rollen** (`muster=`):

- `einzeln` (Standard, wie Version 1): jede Zelle für sich.
- `flecken:n`: zusammenhängende Flecken der Größe etwa n. Dafür gibt es Gitterpunkte im Abstand n mit Zufallswerten aus `samen` und Rollennamen und dazwischen dreilineare Interpolation. Der Wert in [0,1) wählt die Sorte über die kumulierten Gewichte. Gut für Moos und Verwitterung.
- `lagen:n`: gleiche Sorte für jeweils n Lagen übereinander; die Sorte pro Lagenband ist zufällig nach Gewicht. Gut für gebänderte Steinwände.

**Block-Angabe.** Wo eine Anweisung einen Block braucht (`block`, `zeichen`, `spitze=`, `art=` mancher Deko), gilt eine der Formen:

1. `rolle` – der Grundblock der Rolle,
2. `rolle:glied`,
3. eine Block-ID mit oder ohne Zustände: `lantern[hanging=true]`, `create:andesite_casing`.

Der Name einer Rolle hat Vorrang vor einer gleichnamigen Block-ID. Zustände, die nicht angegeben sind, ergänzt Tessera (wie Version 1).

---

## 4 Formen

Alle Formen legen Blöcke an und registrieren, wenn ein Name angegeben ist, eine **Form**, an die sich Bauteile, Dächer und Felder halten.

### 4.1 Gemeinsame Angaben aller Formen

| Angabe | Bedeutung |
| --- | --- |
| `hohl` | nur Wände; das Innere wird pro Lage geräumt |
| `wand=n` | Wandstärke (Standard 1). Wandzellen sind die Zellen des Umrisses, deren kürzester Weg (über Seitennachbarn) nach außen höchstens n Schritte hat |
| `boden=R`, `decke=R` | unterste / oberste Lage innen |
| `sockel=R[:h]`, `kranz=R[:h]` | unterste / oberste h Lagen der Wand (Standard h=1) |
| `ecken=R` | Eckzellen der Wand über die ganze Höhe: bei box die vier Ecken; bei vieleck die Zellen, in denen die Ecken liegen; bei umriss und grundriss die konvexen Ecken |
| `zonen=R@a-b,…` | Wandrolle nach Höhe, a und b relativ zur untersten Lage, einschließlich, `b` darf fehlen (`putz@4-`). Spätere Einträge haben Vorrang. Gilt nicht für Sockel, Kranz, Ecken und Fachwerk. |
| `fachwerk=R …` | siehe 4.4 |
| `profil=…` | siehe 4.3 |

Rangfolge in Wandzellen (höchste zuerst): `ecken`, `sockel`, `kranz`, Fachwerk-Pfosten, Fachwerk-Balken und -Streben, `zonen`, Rolle der Form.

### 4.2 Die Formen

```
box [name] x,y,z x,y,z <rolle> …                    (wie Version 1)
zylinder [name] x,y,z (r=<n> | d=<n> | rx=<n> rz=<n>) h=<n> <rolle> …
vieleck [name] x,y,z n=<ecken> r=<n> h=<n> [drehung=<grad>] <rolle> …
umriss [name] y=<n> h=<n> punkte=x,z;x,z;… <rolle> …
grundriss [name] x,y,z h=<n> <rolle> …    + ASCII-Zeilen
kugel [name] x,y,z r=<n> [teil=ganz|oben|unten] <rolle> [hohl]
```

- **zylinder:**
  - `r` wie Version 1 (Durchmesser 2r+1, Mitte = Mittelpunkt der Zelle x,z).
  - `d` erlaubt jede Breite. Bei ungeradem d ist r=(d−1)/2. Bei geradem d liegt die Mitte auf der Ecke zwischen den Zellen x..x+1 und z..z+1, also am Punkt (x+1, z+1); eine Zelle ist innen, wenn ihr Mittelpunkt höchstens d/2 von diesem Punkt entfernt ist.
  - `rx`/`rz` ergeben eine Ellipse: innen, wenn (dx/(rx+0.5))² + (dz/(rz+0.5))² ≤ 1.
- **vieleck:** regelmäßiges n-Eck (n = 3 bis 16).
  - Der Umkreis hat den Radius r+0.5 um den Mittelpunkt der Zelle x,z. Ecke k liegt beim Winkel `drehung + 360·k/n`.
  - Standard-`drehung` ist 180/n; dann zeigt eine gerade Seite nach Norden (beim Achteck liegen die Seiten in den Haupt- und Nebenrichtungen).
  - Innen ist jede Zelle, deren Mittelpunkt im Vieleck liegt (Rand eingeschlossen, Toleranz 1e-9).
- **umriss:** beliebiges Vieleck. Die Punkte sind Zellen; ihre Mittelpunkte bilden die Ecken, in Reihenfolge, automatisch geschlossen. Innen wie bei vieleck. Rechtwinklige Umrisse (L, T, U) ergeben exakte Formen.
- **grundriss:** ASCII-Draufsicht.
  - x,y,z ist die Zelle des ersten Zeichens der ersten Zeile.
  - Zeilen laufen nach Süden (+z), Zeichen nach Osten (+x).
  - Jedes Zeichen außer Leerzeichen und `.` ist innen.
- **kugel:** Zellen mit Abstand des Mittelpunkts ≤ r+0.5 von der Mitte der Zelle x,y,z. `teil=oben` behält y ≥ Mitte (Kuppel), `teil=unten` y ≤ Mitte. `hohl` lässt eine Schale der Stärke 1 (Zellen mit einem der sechs Nachbarn außerhalb).

Felder (Abschnitt 2) gibt es für alle Formen. Bauteile hängen an allen Formen außer `kugel`.

### 4.3 Wandprofil: Vorkragung, Verjüngung, Bauch

```
profil=<y>:<v>[~],<y>:<v>[~],…
```

- `y` ist eine Lage relativ zur untersten Lage der Form, `v` der Versatz des Umrisses in Blöcken (positiv nach außen, negativ nach innen).
- Der Versatz einer Lage L kommt vom letzten Eintrag mit y ≤ L. Steht hinter diesem Eintrag `~` und folgt ein weiterer, wird linear zum nächsten Eintrag übergegangen und gerundet (bei .5 weg von null). Vor dem ersten Eintrag ist der Versatz 0.
- Versatz des Umrisses je nach Form:
  - box: jede Seite um v
  - zylinder: Radien +v
  - vieleck: r+v
  - umriss und grundriss: Erweitern oder Schrumpfen um |v| mit 8er-Nachbarschaft (Chebyshev-Abstand)
- Ein Umriss, der dabei leer wird, ist ein Fehler.
- Jede Lage wird mit ihrem eigenen Umriss gebaut, einschließlich `hohl`, `wand`, `ecken` und Fachwerk. Bauteile verwenden den Umriss der Lage, in der sie sitzen.

**Konsolen unter Vorkragungen:** `konsolen=R` (Standard: keine).

- Wächst der Versatz von Lage L−1 auf Lage L um Δ ≥ 1, entsteht ein Überhang aus Δ Ringen.
- Der Ring j (j = 1 innen bis Δ außen, gemessen als Abstand zum Umriss von L−1) bekommt in Lage L−1−(Δ−j) eine umgedrehte Treppe (`R:treppe`, `half=top`), die zur Wand blickt. Darüber bis Lage L−1 kommen volle Blöcke `R`.
- „Zur Wand“ heißt: zur seitlich angrenzenden Zelle des Umrisses von L−1. An Ecken gilt dieselbe Regel wie für Dachtreppen (5.2): Grenzt die Zelle an zwei Seiten über Eck an (Innenecke), blickt sie in x-Richtung; hat sie nur einen schrägen Nachbarn (Außenecke), in z-Richtung. Die Treppen-Ecken bildet die Verbindungsberechnung.

Beispiele:

```
# Fachwerkhaus, Obergeschoss ab Lage 5 einen Block vorgekragt, mit Konsolen
box haus 0,0,0 10,9,7 putz hohl profil=5:1 konsolen=eiche fachwerk=balken
# Turm, unten zwei breiter und nach oben verjüngt, ab Lage 14 Wehrgang einen Block vorgekragt
vieleck turm 0,0,0 n=8 r=5 h=18 stein hohl profil=0:2~,10:0,14:1 konsolen=stein
```

### 4.4 Fachwerk

```
fachwerk=R [raster=4] [riegel=a,b,…] [muster=gerade|strebe|kreuz|raute] [streben=R2] [schraeg=block|treppe]
```

- Gilt für gerade Wandstücke in x- oder z-Richtung (box, umriss, grundriss, die geraden Seiten von vieleck in den Hauptrichtungen). Auf schrägen Seiten wird es ausgelassen, mit Hinweis.
- **Pfosten** an den Enden jedes Wandstücks und alle `raster` Zellen ab dem West- bzw. Nordende (wie Version 1).
- **Balken** unten (über dem Sockel) und oben, dazu `riegel` in den angegebenen relativen Lagen.
- **Felder** sind die Rechtecke zwischen Pfosten und Balken (ohne diese). `muster`:
  - `gerade`: keine Schrägen
  - `strebe`: eine Diagonale pro Feld, von unten außen nach oben innen; die Richtung wechselt von Feld zu Feld
  - `kreuz`: beide Diagonalen
  - `raute`: Linien zwischen den Mitten der vier Feldseiten
- Diagonalen werden als Linien in der Wandebene gerastert (eine Zelle pro Lage), Rolle `streben` (Standard: `fachwerk`).
  - `schraeg=treppe`: jede Diagonalzelle ist eine Treppe (`half=bottom`), die in Steigrichtung entlang der Wand blickt. Die Rolle braucht dafür eine Treppe, sonst Fehler.
- Stämme bekommen die Achse ihrer Richtung (Pfosten y, Balken entlang der Wand).

---

## 5 Dächer

### 5.1 Dachtypen

```
dach <typ> <form> [name=…] [ueberstand=1] [profil=…|steil=k] [dicke=1] [rolle=dach] [fuellen] … (typabhängige Angaben)
```

| Typ | Form | Schrumpfen | Standardprofil |
| --- | --- | --- | --- |
| `sattel` | box | nur quer zum First | `1/1` |
| `pult` | box | nur von der niedrigen Seite aus, `hoch=<seite>` Pflicht | `1/1` |
| `krueppelwalm` | box | wie sattel; zusätzlich Walm in den obersten `kruppel=n` Lagen (Standard 2) | `1/1` |
| `walm` / `zelt` | jede außer kugel | von allen Seiten | `1/1` |
| `kegel` | zylinder (auch jede andere Form, dann wie walm) | von allen Seiten, kreisförmig | `1/2` |
| `helm` | jede | von allen Seiten | `1/3` |
| `flach` | jede | – | – |

`steil=k` ist eine Kurzform für `profil=1/k`. Die Angaben von Version 1 (`first`, `giebel`, `kante`, `spitze`) gelten weiter für die Typen, bei denen sie Sinn ergeben.

### 5.2 Dachmaschine (für alle Typen außer flach)

Die Dachmaschine rechnet in **Lagen**. Lage 0 ist die erste Lage über der obersten Wandlage der Form.

1. **Grundfläche F:** der Umriss der Form in ihrer obersten Lage (mit Wandprofil), erweitert um `ueberstand`. Bei box als Rechteck; bei zylinder und kegel über den Radius; bei vieleck über r; sonst mit 8er-Nachbarschaft.
2. **Profil:** `profil=dx/dy,dx/dy,…` von der Traufe aufwärts. Jedes Element verschiebt den Rand um dx Zellen nach innen, verteilt auf dy Lagen. dx ist eine ganze Zahl, auch 0 (senkrecht) oder negativ (nach außen, Bauch). dy ≥ 1. Das letzte Element wiederholt sich, bis das Dach geschlossen ist.
   - Einzug der Lage y innerhalb eines Elements, das in Lage y₀ mit Einzug a₀ beginnt: `a(y) = a₀ + floor(dx·(y−y₀)/dy)`. Nach dem Element gilt a₀+dx.
   - Beispiele: `1/1` (45°), `1/2` (steil, wie `steil=2` in Version 1), `2/1` (flach, Stufe und Treppe im Wechsel), `0/2` (zwei Lagen senkrecht).
3. **Lagenumriss O(y):** F um a(y) geschrumpft (Typ-Metrik aus 5.1; Kreise über den Radius R−a; bei a < 0 erweitert). Optional verschoben durch `biegung` (5.4). Das Dach ist geschlossen, sobald O(y) leer ist.
4. **Blöcke einer Lage y:**
   - **Stufenkante** = O(y) ohne O(y+1).
     - Zellen, die seitlich an O(y+1) grenzen, werden Treppen der Rolle (`half=bottom`), blickend zur angrenzenden Zelle von O(y+1). Grenzt eine Zelle an zwei Seiten über Eck an O(y+1) (Innenecke, auch Kehle), blickt sie in x-Richtung, also nach Osten oder Westen; grenzt sie nur schräg an (Außenecke), in z-Richtung, wie im Walmdach von Version 1. So werden Schrägen, die in einer Lage um zwei Zellen einrücken, ein Zickzack aus Außen- und Innenecken; die Treppen-Ecken bildet die Verbindungsberechnung.
     - Ist die Stufenkante breiter als 1 (flache Profile), werden die Zellen nach ihrem Abstand j zu O(y+1) gesetzt (j=1 grenzt an): j=1 wird Treppe, j ≥ 2 wird untere Stufe (`type=bottom`).
   - **Schale:** Zellen von O(y) mit einem Seitennachbarn außerhalb von O(y), die nicht in der Stufenkante liegen, werden volle Blöcke. Sie ergeben senkrechte Dachabschnitte. Bei `dicke=n` gilt ein Abstand nach außen von höchstens n.
   - **Bauch:** Zellen von O(y+1), die nicht in O(y) liegen, werden in Lage y+1 als umgedrehte Treppen (`half=top`) gesetzt, blickend zur angrenzenden Zelle von O(y). Danach gilt Punkt 4 für Lage y+1 wie für jede Lage; eine dort verbleibende Bauch-Zelle bleibt die umgedrehte Treppe.
   - **Abschluss:** Ist O(y+1) leer, wird die Stufenkante zum First. Linienförmige Teile (eine Zelle breit) werden untere Stufen, einzelne Zellen volle Blöcke (Spitze), wie in Version 1.
   - **Inneres:** Zellen von O(y), die weder Kante noch Schale sind, bleiben Luft (Dachboden), mit `fuellen` volle Blöcke.
5. **Giebel** (sattel, pult, krueppelwalm): Auf den Wandlinien der Giebelseiten werden Zellen, die in O(y+1) liegen und noch leer sind, mit `giebel` gefüllt (Standard: Rolle der Form). Bei `pult` ebenso auf der hohen Seite und den beiden Seiten.
6. **Ortgang** (`kante=ja`, Standard bei ueberstand ≥ 1 und Profil `1/1`): unter jeder Treppe der äußersten Spalte an den Giebelseiten eine umgedrehte Treppe, die zum Gebäude blickt, wie in Version 1.
7. **Traufe** (`traufe=treppe|stufe|keine`, Standard `keine`): unter den Zellen der Lage 0, die außerhalb der Wand liegen, eine Lage tiefer umgedrehte Treppen zur Wand bzw. obere Stufen.

Für `tess 1`-Dateien muss das Ergebnis mit Version 1 übereinstimmen; die Umsetzung darf dafür den alten Code behalten.

### 5.3 Verschneidung mehrerer Dächer

- Ein Dach, dessen Grundfläche die eines vorher gebauten Dachs überlappt oder seitlich berührt, verschneidet sich mit ihm.
- Das Ergebnis entspricht einem Dach, dessen Lagenumrisse die Vereinigung der Lagenumrisse beider Dächer (in absoluten Lagen) sind. Kehlen entstehen so von selbst, die Treppen-Ecken bildet die Verbindungsberechnung.
- Giebel eines Dachs, die im Inneren des vereinigten Dachkörpers liegen, entfallen.
- Blöcke, die andere Anweisungen zwischen den beiden Dächern gesetzt haben (z. B. ein Schornstein), bleiben erhalten.
- So entstehen Kreuzgiebel, L-Häuser, Zwerchhäuser und Türme, deren Helm in ein Dach übergeht.

### 5.4 Weitere Dachangaben

| Angabe | Typen | Bedeutung |
| --- | --- | --- |
| `profil=glocke` | alle | Voreinstellung `2/1,1/1,1/2,1/3`: ausgestellte Traufe, dann steil |
| `profil=mansard` | sattel, walm | `1/3,1/3,2/1` |
| `profil=zwiebel` | walm, kegel, helm | `-1/1,-1/1,0/2,1/1,1/1,1/2,1/2,1/3` |
| `profil=kuppel` | walm, kegel | Viertelkreis: Einzug in Lage y ist `R − floor(sqrt((R+0.5)² − y²))`, R = Radius der Grundfläche |
| `biegung=<seite>:<n>` | walm, kegel, helm | Hexenhut: O(y) wird um `round(n · max(0, 3·u−2)²)` Zellen in Richtung seite verschoben, u = y / (Lagen bis zum Schluss ohne Biegung) |
| `firstzier=<block-angabe>` | alle | auf jeder Firstzelle eine Lage höher, z. B. `zier:mauer` oder `stone_brick_wall` |
| `spitze=<block-angabe>` | alle mit Spitze | auf die Spitze (wie Version 1) |
| `first=x|z` | sattel, krueppelwalm | Richtung des Firsts (wie Version 1) |
| `hoch=<seite>` | pult | Seite, zu der das Dach ansteigt |
| `rand=R` | flach | Ring aus R eine Lage über dem Flachdach (z. B. Mauer) |

**flach:** Lage 0 über dem ganzen Umriss (mit Überstand) aus `rolle` (Standard `dach`; Stufen mit `art=stufe`).

### 5.5 Kranzdach (Dachschürze)

```
kranzdach <form> y=<lage> [breite=2] [profil=…|steil=k] [rolle=dach] [kante=ja|nein]
```

- Ein ringförmiges Dach außen um die Form, das zur Wand hin ansteigt und an der Wand endet. Typisch für gestaffelte Türme und Vordächer rundum.
- Grundfläche: alle Zellen außerhalb des Umrisses der Form in Lage y mit Abstand (8er-Nachbarschaft) ≤ breite.
- Die Dachmaschine läuft mit dem Abstand zur Wand statt zum Rand: Lage k umfasst die Zellen mit Abstand ≤ breite − a(k). Treppen blicken zur Wand, an Ecken wie in 5.2 (Innenecken in x-, Außenecken in z-Richtung).
- Wo die Schürze auf Fenster trifft, setzt sie nur in Luft und meldet einen Hinweis.

---

## 6 Bauteile an Wänden

### 6.1 Wie Bauteile ihre Stelle finden

- **Seite:** Bei box `n/o/s/w`. Bei zylinder, vieleck, umriss, grundriss eine Seite (auch `no` usw.) oder `winkel=<grad>`; bei vieleck zusätzlich `seite=<k>`. Seite 0 ist die Seite, deren Außennormale am nächsten an Norden liegt; gezählt wird im Uhrzeigersinn.
- **Wandzelle** für eine Position: der Strahl vom Formmittelpunkt in Richtung der Seite bzw. des Winkels trifft die äußerste Wandzelle der Lage. Bei box wie in Version 1.
- **Außen** ist die Richtung des Strahls, gerundet auf die nächste Hauptrichtung. Danach richten sich Treppen, Falltüren und Türen.
- **Position entlang der Wand:** bei box `x=` (Seiten n, s) oder `z=` (o, w) für die kleinste Koordinate des Bauteils, wie in Version 1. Bei allen Formen alternativ `versatz=<n>`: Verschiebung aus der Mitte der Seite nach rechts (von außen gesehen), negativ nach links. Ohne Angabe mittig.
- **Höhe:** `y=` absolut oder `ebene=` relativ zur untersten Lage der Form. Genau eins von beiden, wo eine Höhe verlangt ist.
- **Wiederholung:** `anzahl=` und `abstand=` (wie bei fenster in Version 1) gelten für alle Bauteile in 6.2 bis 6.6. Bei runden Formen verteilt `anzahl=` ohne Seite gleichmäßig über den Umfang, beginnend bei `winkel=` (Standard 0).

### 6.2 Fenster

```
fenster <form> <seite> (y=|ebene=) [x=|z=|versatz=] [b=1] [h=2] [art=…] [glas=R|luft] [rahmen=R]
        [bank=R|nein] [sturz=R|nein] [laibung=R] [laeden=R] [sprossen=R] [tiefe=0]
        [kasten=R blumen=B,B,… kastenfront=R2]
```

Alles aus Version 1 gilt. Neu:

**`art`** (Form der Öffnung, b Breite, h Höhe):

- `rechteck` (Standard).
- `bogen` (b ≥ 2): Die beiden äußeren Zellen der obersten Glasreihe werden umgedrehte Treppen aus `rahmen`, die von der Fenstermitte weg entlang der Wand blicken.
- `spitzbogen` (b ungerade ≥ 3): In den obersten n = min((b−1)/2, h−1) Reihen wird das Glas nach oben schmaler. Reihe k von oben (k = 0 … n−1) hat 2k+1 Glaszellen in der Mitte; die Zelle links und rechts daneben wird eine umgedrehte Treppe aus `rahmen`, die von der Mitte weg blickt.
- `rund` (b = 3 oder 5, h wird gleich b gesetzt):
  - Glas in den Zellen mit dx² + dy² ≤ (b=3: 1, b=5: 5) um die Mittelzelle; die verbleibenden Ecken des Quadrats werden Treppen aus `rahmen`.
  - Obere Ecken `half=top`, untere `half=bottom`, jeweils von der Mitte weg entlang der Wand blickend.
- `kreuz` (b und h ungerade ≥ 3): Mittelspalte und Mittelreihe werden `sprossen` (Standard `rahmen`).
- `schlitz`: Schießscharte, b = 1, Standard `glas=luft`, ohne Bank und Läden.

**Weitere Angaben:**

- **`laibung=R`:** Ring um die Öffnung in der Wandebene (eine Zelle breit) wird R; Pfosten und Balken bleiben.
- **`tiefe=n`** (nur bei Wandstärke > n): Das Glas sitzt n Zellen nach innen versetzt, davor bleibt Luft.
- **`sprossen=R`:** bei `art=rechteck` mit b ≥ 3 jede zweite Spalte.
- **`kasten=R blumen=…`:** Blumenkasten.
  - Unter dem Fenster außen in Lage y−1 je Glasspalte ein Block R (z. B. `rooted_dirt`).
  - Davor (eine Zelle weiter außen) und an beiden Enden offene Falltüren der Rolle `R2` aus `kastenfront=R2` (Standard `rahmen:falltuer`), flach anliegend.
  - Oben auf den Kasten-Blöcken die Blumen aus der Liste, reihum.
  - Ersetzt die Bank.

### 6.3 Türen und Tore

```
tür <form> <seite> [x=|z=|versatz=] [y=|ebene=] [b=1|2] [h=2..4] [art=rechteck|bogen|spitzbogen]
    [tuer=R|luft] [rahmen=R|nein] [oberlicht=R] [stufen=n] [vordach=R]
tor <form> <seite> [x=|z=|versatz=] [y=|ebene=] b=<n> h=<n> [art=rechteck|bogen|spitzbogen] [rahmen=R] [fallgitter=R]
```

- **tür:** wie Version 1.
  - `h` > 2: Über der Tür entsteht ein Oberlicht aus `oberlicht` (Standard `glas`) bzw. ein Bogen wie bei Fenstern (`art`), der Rahmen wächst mit.
  - `tuer=luft`: offener Durchgang.
  - `stufen=n`: außen n Treppenstufen abwärts, blickend zur Tür, Breite b; darunter bis zur untersten Stufe volle Blöcke der Rolle `rahmen`.
  - `vordach=R`: eine Reihe Treppen über dem Rahmen außen, Breite b+2, aufsteigend zur Wand.
- **tor:** Öffnung aus Luft b × h, Bogenform wie bei Fenstern (bei `bogen` mit b ≥ 4 zwei Treppen je Seite treppenförmig). `fallgitter=R` setzt eine Lage Zaunglieder (`R:zaun`) als hochgezogenes Fallgitter in die oberste Reihe.

### 6.4 Gliederung der Wand

```
gesims <form> (y=|ebene=) [rolle] [art=treppe|stufe|block|kragen|zahn] [seiten=…]
pfeiler <form> [seiten=…|alle] [an=raster|ecken] [abstand=4] [versatz=0] [breite=1] [tiefe=1]
        [von=…] [bis=…] <rolle> [kopf=<block-angabe>] [fuss=<block-angabe>] [art=gerade|strebe]
strebe x,y,z richtung=<seite> laenge=<n> <rolle>
```

- **gesims:** ein Band rund um die Form (oder nur auf `seiten`) in der angegebenen Lage, außen direkt an der Wand.
  - Bandzellen sind die Luftzellen außerhalb des Umrisses mit einem Nachbarn (8er-Nachbarschaft) im Umriss.
  - `art=treppe`: umgedrehte Treppen zur Wand (Ecken über die Verbindungsberechnung).
  - `stufe`: obere Stufen.
  - `block`: volle Blöcke.
  - `kragen`: volle Blöcke in der Lage und umgedrehte Treppen darunter.
  - `zahn`: Zahnfries, jede zweite Bandzelle ein Block.
- **pfeiler:** senkrechte Lisenen außen vor der Wand.
  - Breite in Wandrichtung, Tiefe nach außen, von `von` bis `bis` (Standard ganze Höhe).
  - `an=raster` (Standard): alle `abstand` Zellen ab dem Seitenende plus `versatz`.
  - `an=ecken`: an den Ecken der Form, diagonal nach außen.
  - `kopf` und `fuss`: Block auf bzw. unter dem Pfeiler.
  - `art=strebe`: Strebepfeiler. Die Tiefe nimmt nach oben in gleich hohen Abschnitten von `tiefe` auf 1 ab; jeder Rücksprung wird mit einer Treppe abgedeckt, die zur Wand ansteigt.
- **strebe:** schräge Stütze. Von x,y,z aus pro Schritt eine Zelle in `richtung` und eine Lage höher, `laenge` Schritte, aus umgedrehten Treppen der Rolle, die entgegen `richtung` blicken. Für Kopfbänder unter Vorkragungen und Balkonen.

### 6.5 Anbauten

```
balkon <form> <seite> (y=|ebene=) [x=|z=|versatz=] b=<n> [tiefe=1..4] [boden=R] [gelaender=R] [konsolen=R]
       [stuetzen=R] [dach=R] [tuer=ja]
umgang <form> (y=|ebene=) [tiefe=1..4] [boden=R] [gelaender=R] [konsolen=R] [stuetzen=R abstand=4] [dach=R]
erker <form> <seite> (y=|ebene=) [x=|z=|versatz=] b=<n> h=<n> [tiefe=2] [art=eckig|halbrund|dreieck] <rolle>
      [name=…] [konsolen=R stufen=2] [dach=walm|kegel|helm|sattel|flach] [dachrolle=R] [dachprofil=…]
gaube <form> <seite> [x=|z=|versatz=] [b=1] [h=2] [art=sattel|schlepp|spitz] [rolle=…] [dachrolle=…] [einzug=0]
      [fensterart=…] [laeden=R]
ecktuerme <form> [an=alle|nw,no,so,sw] r=<1..3> h=<n> (y=|ebene=) <rolle> [einzug=1] [konsolen=R stufen=r]
          [dach=helm|kegel|walm] [dachrolle=R] [dachprofil=…] [biegung=…] [spitze=…]
```

Gemeinsam für alle Anbauten:

- Sie setzen außerhalb der Wand nur in Luft. Wo etwas im Weg ist, bleibt es stehen und es gibt einen Hinweis mit der Zeile des Hindernisses.
- Ihre Rollen haben Standardwerte: `boden=rahmen`, `gelaender=rahmen:zaun`, `konsolen=rahmen`, `dachrolle=dach`.

- **balkon:**
  - Boden in Lage y−1, Zellen der Positionen b × tiefe außen vor der Wand.
  - Geländer in Lage y auf den äußeren drei Kanten (Zaun- oder Mauerglied; verbunden über die Verbindungsberechnung).
  - Konsolen unter der Bodenplatte wie in 4.3: Reihe j in Lage y−1−j, j ab 1 an der Wand.
  - `stuetzen=R`: stattdessen senkrechte Stützen an den äußeren Ecken bis zum ersten Block darunter.
  - `dach=R`: Pultdach ab Lage y+3 über Balkon plus 1 Überstand, ansteigend zur Wand.
  - `tuer=ja`: Tür in der Wand in der Mitte des Balkons.
- **umgang:** wie balkon, aber rund um die ganze Form; der Ring hat Abstand 1 bis `tiefe` (8er-Nachbarschaft).
  - `stuetzen=R` setzt senkrechte Stützen (Stämme mit Achse y) auf dem äußeren Ring alle `abstand` Zellen, je eine Strebe zur Wand darunter.
  - `dach=R` setzt ein Kranzdach in Lage y+3 mit `breite=tiefe+1`.
- **erker:**
  - Eine eigene hohle Form vor der Wand: bei `eckig` b × tiefe, bei `halbrund` ein halber Zylinder mit Radius (b−1)/2 auf der Wandmitte, bei `dreieck` ein Dreieck mit Spitze nach außen.
  - Die Seite zur Hauptform ist offen; das Innere geht ins Gebäude über (die Wand der Hauptform wird im Erker-Querschnitt geräumt).
  - Unterseite: `konsolen` mit `stufen` Lagen, die sich nach unten pro Lage um 1 zur Wand verjüngen.
  - Mit `name=` ist der Erker eine Form für Fenster und Dach. Ohne `dach=` bekommt er ein Dach passend zu `art` (walm, kegel, helm).
- **gaube:**
  - Auf dem Dach der Form, auf der Traufseite `seite`.
  - Vorderwand in der Wandebene der Form, um `einzug` nach innen versetzt; Breite b+2, Höhe h+1 ab der ersten Dachlage.
  - Fenster b × h in der Mitte der Vorderwand.
  - Seitenwangen reichen zurück bis zur Dachfläche.
  - Eigenes Dach: `sattel` mit First quer zur Traufe, Überstand 1, `schlepp` als Pultdach mit Profil `2/1` zum Hauptdach, `spitz` als Walm.
  - Das Hauptdach wird im Gaubenkörper entfernt; beide Dächer verschneiden sich (5.3).
  - Braucht ein vorher gebautes Dach auf der Form, sonst Fehler.
- **ecktuerme:** kleine Türmchen an den Ecken (box, umriss, vieleck).
  - Mittelpunkt: die Eckzelle, um r−einzug diagonal nach außen verschoben.
  - Zylinder mit Radius r und Höhe h ab Lage y, hohl ab r=2.
  - Darunter `konsolen` in `stufen` Lagen, nach unten verjüngend, als umgekehrter Kegel.
  - Dach nach `dach` (Standard `helm`).

### 6.6 Zinnen, Bögen, Treppen

```
zinnen <form> [rolle] [muster=1:1] [hoehe=1] [kappe=<block-angabe>] [vorkragung=0|1 konsolen=R]
bogen x,y,z x,y,z hoehe=<n> <rolle> [art=rund|spitz|flach] [dicke=1] [tiefe=1]
treppe x,y,z richtung=<seite> laenge=<n> <rolle> [breite=1] [unterbau=voll|keiner|treppe] [gelaender=R]
wendeltreppe x,y,z r=<n> bis=<y> <rolle> [richtung=rechts|links] [start=<seite>] [breite=1]
             [stufen=treppe|stufe] [spindel=R] [kopffreiheit=3]
wendeltreppe <form> aussen bis=<y> <rolle> [y=|ebene=] [breite=1] [richtung=rechts|links] [start=<seite>]
             [stufen=treppe|stufe] [gelaender=R] [konsolen=R] [schritt=1]
```

- **zinnen:** wie Version 1.
  - `muster=a:b`: a Blöcke Zinne, b Lücke; Ecken sind immer Zinne.
  - `hoehe`: Zinnenhöhe. `kappe`: Block auf jeder Zinne (z. B. `stein:stufe`).
  - `vorkragung=1`: Maschikuli. Der Zinnenkranz samt einer Lage Brüstung sitzt einen Block nach außen versetzt. Darunter umgedrehte Treppen zur Wand auf jeder zweiten Zelle; dazwischen bleibt eine Gussöffnung.
- **bogen:**
  - Beide Punkte haben dieselbe Höhe und liegen auf einer Linie in x- oder z-Richtung (sonst Fehler). Sie sind die äußersten Zellen der Bogenbeine.
  - Die Spannweite ist der Abstand dazwischen. Unterkante:
    - `rund`: Halbellipse mit Scheitel `hoehe`
    - `spitz`: zwei Kreisbögen, die sich im Scheitel treffen
    - `flach`: Segmentbogen mit Scheitel `hoehe`
  - Pro Spalte füllt der Bogen `dicke` Zellen ab der Unterkante. Liegt die Unterkante in einer Spalte auf ,5 oder höher über der ganzen Zahl, wird die unterste Zelle eine umgedrehte Treppe, die vom Bogenmittelpunkt weg blickt.
  - `tiefe` geht in +z bzw. +x quer zur Spannrichtung.
- **treppe:** gerade Treppe.
  - Stufe i bei Punkt + i·Richtung, eine Lage höher pro Stufe, Treppen blickend in `richtung` (Aufstieg).
  - Die Breite wächst nach rechts (in Aufstiegsrichtung gesehen).
  - `unterbau`: `voll` füllt bis zur Startlage, `treppe` setzt umgedrehte Treppen unter jede Stufe, `keiner` nichts.
  - `gelaender`: Zaunglied auf beiden Seiten eine Lage über den Stufen.
- **wendeltreppe** (innen):
  - Weg ist der Ring des Radius r um x,z (wie die Wand eines zylinders), sortiert nach Winkel ab `start` (Standard n), `rechts` = im Uhrzeigersinn.
  - Bei `stufen=treppe` steigt jede Zelle des Wegs um eine Lage und ist eine Treppe, die in Laufrichtung blickt (auf die Hauptrichtung gerundet).
  - Bei `stufen=stufe` steigt jede Zelle um eine halbe Lage (untere und obere Stufe im Wechsel).
  - Die Treppe endet, wenn Lage `bis` erreicht ist. `breite` legt weitere Ringe nach innen an.
  - `spindel`: Säule in der Mitte. `kopffreiheit`: so viele Luftzellen über jeder Stufe, auch durch Böden.
- **wendeltreppe aussen:** Weg sind die Zellen außerhalb der Form mit Abstand 1 bis `breite` (8er-Nachbarschaft, Umriss der jeweiligen Lage), nach Winkel um den Formmittelpunkt sortiert. Pro `schritt` Wegzellen geht es eine Lage höher, sonst wie innen. Geländer außen, Konsolen unter jeder Stufe zur Wand.

---

## 7 Zier und Deko

```
wandlaterne <form> <seite> (y=|ebene=) [x=|z=|versatz=] [art=laterne|seelenlaterne|fackel|seelenfackel] [arm=R]
haengelaterne x,y,z [kette=<n>] [art=laterne|seelenlaterne]
banner <form> <seite> (y=|ebene=) [x=|z=|versatz=] farbe=<farbe> [haengend=ja]
efeu <form> [seiten=…|alle] [dichte=0.3] [laenge=3] [von=…] [bis=…] [art=ranke|flechte] [muster=flecken:3]
bewuchs <form> [flaechen=oben|seiten|alle] block=<block-angabe> [dichte=0.3] [muster=flecken:3]
laub x,y,z r=<n> <rolle> [dichte=0.85]
streue <form> block=<block-angabe> [dichte=0.2] [flaechen=oben]
```

- **wandlaterne:** an der Wandzelle außen.
  - `fackel`: Wandfackel, blickend nach außen.
  - Laternen mit `arm=R`: Zaunglied von R außen an der Wand in Lage y, darunter die Laterne `hanging=true`. Ohne Arm eine Laterne auf einem Block R außen.
- **haengelaterne:** von der Zelle über x,y,z (muss ein Block sein) `kette` Ketten (`chain[axis=y]`) nach unten, darunter eine hängende Laterne.
- **banner:** `<farbe>_wall_banner`, blickend nach außen, an der Zelle vor der Wand. Muster gehen nicht (Block-Entity); das steht im Hinweis zur Datei.
- **efeu:**
  - Kandidaten sind Luftzellen direkt vor einer Wandzelle mit voller Seitenfläche.
  - Startzellen dort, wo das Rauschmuster über 1−dichte liegt; von jeder Startzelle hängt Efeu zufällig 1 bis `laenge` Zellen nach unten, solange Luft und Wand weitergehen.
  - `art=ranke`: `vine` mit der Seite zur Wand `true`. `flechte`: `glow_lichen` mit dieser Seite `true`.
- **bewuchs:** setzt den Block auf freie Flächen der Form, wo das Rauschmuster es will. `oben`: Luftzelle über einer vollen Oberseite. `seiten`: wie efeu, ohne Hängen.
- **laub:** Blätterwolke. Zellen mit Abstand ≤ r+0.5 vom Mittelpunkt; am Rand fällt ein Teil per Rauschen weg (`dichte`). Blätter immer `persistent=true`.
- **streue:** einzelne Blöcke (Pilze, Blumen, Laternen) auf freie Oberseiten.

---

## 8 Farmen

```
feld x,y,z x,y,z [frucht=wheat|carrots|potatoes|beetroots|…] [zaun=R] [tor=<seite>] [weg=R]
```

- Beide Punkte liegen in derselben Lage y.
- Ackerboden (`farmland[moisture=7]`) auf allen Zellen außer Wasser; Pflanzen eine Lage höher im höchsten Alter (`age=7`, Rote Bete `age=3`).
- **Wasser:** Jede Ackerzelle braucht eine Wasserzelle in derselben Lage im Chebyshev-Abstand ≤ 4. Tessera legt dafür Wasserreihen parallel zur längeren Seite an:
  - erste Reihe auf Abstand min(4, (B−1)/2) vom Rand, B = kürzere Seite;
  - weitere Reihen alle 9;
  - eine zusätzliche Reihe am anderen Rand, falls dort sonst eine Zelle zu weit weg wäre.
  - Liegen beide Seiten bei höchstens 9, gibt es eine Wasserzelle in der Mitte.
- `zaun=R`: Zaunring eine Zelle außerhalb, eine Lage höher. `tor=<seite>`: Zauntor in der Mitte dieser Seite, blickend nach außen.
- `weg=R` (z. B. `dirt_path`): Ring außerhalb des Zauns in Lage y.

---

## 9 Freistil: ASCII-Ebenen und -Ansichten

```
zeichen <z> <block-angabe> [tiefe=<n>] [<zustand>=<wert> …]
ebene x,y,z            + ASCII-Zeilen
ebenen x,y,z           + ASCII-Zeilen, Lagen getrennt durch eine Zeile "|-"
ansicht <form> <seite> [x=|z=|versatz=] (y=|ebene=)   + ASCII-Zeilen
```

**Zeichen festlegen:**

- `zeichen` legt ein Zeichen für die folgenden Zeichnungen im Gültigkeitsbereich fest. Erlaubt ist jedes einzelne sichtbare Zeichen außer `|`.
- Fest vergeben: Leerzeichen = unverändert lassen, `.` = Luft setzen.
- Zustände dürfen angegeben werden; sie haben Vorrang vor den ergänzten Standardzuständen. Die Verbindungsberechnung läuft trotzdem über alles; wer feste Verbindungen braucht, setzt sie und schreibt `fest=ja`. Dann lässt die Verbindungsberechnung den Block aus.

**ebene:**

- x,y,z ist die Zelle des ersten Zeichens der ersten Zeile.
- Zeilen laufen nach Süden (+z), Zeichen nach Osten (+x).
- Relative Richtungen sind hier ein Fehler.

**ebenen:** wie ebene, mehrere Lagen. Die erste Gruppe liegt in Lage y, jede weitere eine Lage höher.

**ansicht:** Aufriss einer Wand, von außen gesehen.

- Die **unterste** Zeile liegt in der Höhe `y`/`ebene`, darüber jede Zeile eine Lage höher.
- Das erste Zeichen jeder Zeile liegt links (von außen gesehen) bei `x=`/`z=` (kleinste bzw. von außen linke Koordinate), sonst so, dass die Zeichnung mittig auf der Seite sitzt.
- Jede Zeichenposition wird auf die Wandzelle der jeweiligen Lage abgebildet (6.1), auch bei runden Formen.
- `tiefe=n` im Zeichen versetzt den Block n Zellen nach außen (negativ nach innen). Damit gehen Relief, vorstehende Rahmen, Balken und Sockel.
- Relative Richtungen in Zuständen werden pro Wandzelle aufgelöst:
  - `aussen` = Außenrichtung
  - `innen` = Gegenrichtung
  - `rechts` = gegen den Uhrzeigersinn neben aussen
  - `links` = im Uhrzeigersinn neben aussen

Beispiel: eine Fassade mit Rundbogenfenster und vorstehendem Rahmen.

```
zeichen B balken
zeichen < rahmen:treppe facing=links half=top
zeichen > rahmen:treppe facing=rechts half=top
zeichen G glas
zeichen F rahmen tiefe=1
ansicht haus s x=2 y=1
| B<G>B
| BGGGB
| BGGGB
| BFFFB
```

---

## 10 Module, Wiederholung, Spiegelung, Abschnitte

```
modul <name> [<angabe>=<standard> …]
  …
ende
baue <modul> x,y,z [name=<instanz>] [drehung=0|90|180|270] [spiegel=x|z] [abschnitt="…"] [<angabe>=<wert> …]
wiederhole <var>=<a>..<b> [schritt=<s>]
  …
ende
spiegle (x=<achse>|z=<achse>)
  …
ende
abschnitt "<name>"
ausrichtung [drehung=0|90|180|270] [spiegel=x|z]
```

**Module:**

- Ein `modul` legt eine Vorlage an; sie baut erst bei `baue`. Angaben sind Zahlen (in Ausdrücken nutzbar) oder Wörter (als Rollennamen, Block-Angaben oder Seiten nutzbar).
- Im Modul sind Koordinaten relativ zum Punkt von `baue`. Namen von Formen gelten im Modul; von außen heißen sie `<instanz>.<form>` (Standard-Instanzname: Modulname mit laufender Nummer, `turm1`).
- Rollen, `samen` und `zeichen` der Datei sind im Modul sichtbar; ein Modul darf eigene `zeichen` und `wert`e haben, aber keine Rollen.

**Drehung und Spiegelung:**

- `drehung` dreht im Uhrzeigersinn von oben um den Punkt von `baue`: 90 bildet (x,z) auf (−z, x) ab. Blickrichtungen drehen mit (n→o→s→w), Achsen x und z tauschen bei 90 und 270, Seitenangaben der Bauteile im Modul drehen mit.
- `spiegel=x` bildet x auf −x ab: o↔w in Blickrichtungen und Seiten, Türangeln links↔rechts. `spiegel=z` entsprechend n↔s.
- Treppenformen und Verbindungen rechnet die Verbindungsberechnung danach neu.

**Wiederholung:** führt den Inhalt für a, a+s, … bis einschließlich b aus. `schritt` darf negativ sein. Höchstens 10 000 Durchläufe pro Schleife.

**Spiegle:** führt den Inhalt zweimal aus, beim zweiten Mal gespiegelt. Die Achse ist eine Zellkoordinate oder liegt auf einer halben Zahl: `x=10` (x' = 20 − x) oder `x=10.5` (x' = 21 − x). Namen im gespiegelten Durchlauf bekommen das Suffix `_s`.

**Abschnitt:** Alle folgenden Blöcke gehören zu diesem Bauabschnitt, bis zum nächsten `abschnitt` oder Dateiende; `baue … abschnitt=` gilt für die Instanz. Abschnitte bekommen in der App eigene Ebenen, Materiallisten und Fortschritt (Etappe 4c).

**Ausrichtung:** dreht oder spiegelt das ganze Ergebnis um 0,0,0. Höchstens einmal pro Datei, beliebige Stelle. Diese Anweisung schreibt die App beim Drehen und Spiegeln in die Datei.

**Grenzen:** Modul-Aufruftiefe 16; höchstens 2 Millionen ausgeführte Anweisungen und 8 Millionen gesetzte Blöcke pro Datei. Fehler im Modul nennen die Kette: `Zeile 40 (in modul turm, gebaut in Zeile 88)`.

---

## 11 Prüfungen und Meldungen

**Fehler** verhindern das Öffnen. Sie werden alle auf einmal gemeldet, jeweils mit Zeile und gegebenenfalls Modulkette; Folgefehler entfallen (wie Version 1).

**Hinweise** öffnen trotzdem und stehen mit Zeile in den Projektdaten. Zu denen aus Version 1 kommen:

- **Überschrieben:** Eine Anweisung ersetzt Glas, Tür oder Anbau einer früheren Zeile (`Zeile 57 überdeckt das Fenster aus Zeile 31`).
- **Halt:**
  - Folgende Blöcke ohne passenden Halt:
    - stehende Fackel, Laterne mit `hanging=false`, Teppich, Druckplatte, Schiene, Kerze, stehendes Schild und Banner: Block darunter mit voller Oberseite (Laternen auch auf Zaun, Mauer, Kette);
    - hängende Laterne: Block darüber;
    - Wandfackel, Wandschild, Wandbanner, Leiter, Knopf: Block in Blickrichtung hinten;
    - Ranke und Flechte: Block auf mindestens einer der wahren Seiten;
    - Tür: Block unter der unteren Hälfte;
    - Pflanzen: passender Boden;
    - Sand, Kies, Betonpulver, Amboss: irgendein Block darunter.
  - Falltüren brauchen keinen Halt.
- **Schweben:**
  - Zusammenhängende Blockgruppen (Nachbarn über die sechs Seiten), die keinen Block in der untersten Lage des Projekts haben.
  - Die Meldung nennt Größe, umschließenden Quader und die drei Zeilen mit den meisten Blöcken der Gruppe.
  - `erlaube schweben` (eigene Anweisung) schaltet das für die Datei ab.
- **Fließen:** Wasser oder Lava mit einer Luftzelle daneben oder darunter.
- **Unbekannt:** Block fehlt im Katalog (wie Version 1).

**Herkunft:** Für jeden Block merkt sich Tessera die Zeile (mit Modulkette) und den Abschnitt. Die Projektdaten tragen diese Zuordnung; der Hover zeigt sie (Etappe 4a).

---

## 12 Leistung

- Ein Bauplan mit 2 Millionen Blöcken muss im Worker in unter 5 Sekunden übersetzt sein (mittlerer PC); die Zielbauten in unter 1 Sekunde.
- Der Compiler speichert Blöcke dafür in Chunks aus typisierten Arrays statt in einer Hash-Map.
- Die Verbindungsberechnung betrachtet nur Zellen mit verbindbaren Blöcken und deren Nachbarn.
- Ein Leistungstest im Test-Ordner prüft das mit einem erzeugten Großbau.

---

## 13 Übersicht aller Befehle

| Befehl | Abschnitt | neu in 2 |
| --- | --- | --- |
| `tess`, `projekt`, `samen` | 1, v1 | – |
| `wert` | 2 | ja |
| `rolle` | 3 | erweitert |
| `box`, `zylinder` | 4 | erweitert |
| `vieleck`, `umriss`, `grundriss`, `kugel` | 4 | ja |
| `linie`, `block`, `leer` | v1 | – |
| `dach` | 5 | erweitert |
| `kranzdach` | 5.5 | ja |
| `fenster`, `tür` | 6.2, 6.3 | erweitert |
| `tor`, `gesims`, `pfeiler`, `strebe` | 6.3, 6.4 | ja |
| `balkon`, `umgang`, `erker`, `gaube`, `ecktuerme` | 6.5 | ja |
| `zinnen` | 6.6 | erweitert |
| `bogen`, `treppe`, `wendeltreppe` | 6.6 | ja |
| `wandlaterne`, `haengelaterne`, `banner`, `efeu`, `bewuchs`, `laub`, `streue` | 7 | ja |
| `feld` | 8 | ja |
| `zeichen`, `ebene`, `ebenen`, `ansicht` | 9 | ja |
| `modul`, `baue`, `wiederhole`, `spiegle`, `abschnitt`, `ausrichtung` | 10 | ja |
| `erlaube` | 11 | ja |
