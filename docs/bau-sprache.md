# Bau-Sprache (`.tess`)

Referenz für das Schreiben von Bauplänen, Stand Etappe 4c (Tessera 0.4.3). Eine `.tess`-Datei beschreibt, *wie* ein Gebäude aufgebaut ist; Tessera übersetzt sie in Blöcke.

- **`tess 2`** ist die Bau-Sprache 2 aus [bau-sprache-2.md](bau-sprache-2.md), vollständig: Werte und Ausdrücke, Rollen mit allen Gliedern und Mustern, sechs Formen mit Wandprofil, Konsolen und Fachwerk, die Dachmaschine mit Verschneidung und Kranzdach (4a); Bauteile an Wänden, Anbauten, Zinnen, Bögen, Treppen, Zier und Deko, Felder und die Prüfungen (4b); Freistil, Module, Wiederholung, Spiegelung, Bauabschnitte und Ausrichtung (4c).
- **`tess 1`** bleibt gültig und ergibt blockgenau dasselbe wie in 0.3.0, siehe [Version 1](#version-1).

Beispiele: [`beispiele/zauberturm.tess`](../beispiele/zauberturm.tess), [`beispiele/wachturm.tess`](../beispiele/wachturm.tess) und [`beispiele/fachwerkhaus.tess`](../beispiele/fachwerkhaus.tess) (Version 2), [`beispiele/haus-mit-rundturm.tess`](../beispiele/haus-mit-rundturm.tess) (Version 1).

## Grundregeln

- Die erste Anweisung ist `tess 2`. Eine Anweisung pro Zeile; endet eine Zeile (vor einem Kommentar) mit `\`, geht die Anweisung in der nächsten Zeile weiter. Meldungen nennen die erste Zeile.
- `#` beginnt einen Kommentar bis zum Zeilenende, außer in `"…"` und in ASCII-Zeilen.
- ASCII-Zeilen beginnen mit `|` (Leerzeichen davor sind erlaubt) und stehen direkt unter `grundriss`, `ebene`, `ebenen` oder `ansicht`. Alles nach dem `|` gehört zur Zeichnung, auch ein Leerzeichen direkt nach dem `|`; nachgestellte Leerzeichen zählen nicht.
- `modul`, `wiederhole` und `spiegle` umschließen Anweisungen bis zur passenden Zeile `ende`; sie dürfen verschachtelt werden, Einrückung ist bedeutungslos.
- Koordinaten `x,y,z`: **x nach Osten, y nach oben, z nach Süden** (wie in Minecraft), erlaubt −4000 bis 4000. Eine Zelle hat ihren Mittelpunkt bei x+0,5 und z+0,5; ob eine Zelle innen liegt, entscheidet immer ihr Mittelpunkt.
- Angaben `name=wert` stehen in beliebiger Reihenfolge hinter den festen Teilen. Groß/klein ist egal, Umlaute und Umschreibung sind gleich (`tür` = `tuer`).
- Seiten: `n` (Norden, −z), `o` (Osten, +x), `s` (Süden, +z), `w` (Westen, −x), ausgeschrieben `nord`, `ost`, `sued`, `west`.
- Anweisungen laufen von oben nach unten, spätere überschreiben frühere Blöcke. Ausnahmen:
  - Dächer verschneiden sich über ihre Grundflächen (siehe Verschneidung).
  - Anbauten, Gesims, Pfeiler, Zier und Deko setzen außerhalb der Wand nur in Luft; was im Weg ist, bleibt stehen, mit Hinweis und der Zeile des Hindernisses. Das Kranzdach setzt vor Fenstern und Türen nur in Luft.
  - Hohle Formen räumen ihr Inneres, auch was vorher dort stand.
- Bauteile sehen nur frühere Blöcke: Stützen eines Umgangs reichen bis unter den nächsten Block darüber, Efeu wächst nur vor schon gebauten Wänden, eine Hängelaterne braucht den Block über sich. Darum kommen Obergeschoss und Schürze vor dem `umgang`, Wände vor `efeu`. Die Prüfungen (Halt, Schweben, Fließen) laufen dagegen am Ende über den fertigen Bau.
- Jede Datei ist in sich abgeschlossen: Rollen, Werte, Namen und Startwert gelten nur in ihr.

## Kopf

| Anweisung | Bedeutung |
| --- | --- |
| `tess 2` | Version, Pflicht in der ersten Zeile |
| `projekt "Name"` | Titel des Bauplans |
| `samen 7` | Startwert für gemischte Rollen, `zufall` und Zier; gleicher Startwert, gleiches Ergebnis (Standard 1) |
| `erlaube schweben` | schaltet die Schwebe-Prüfung für die Datei ab, z. B. für Teile, die woanders angebaut werden |
| `ausrichtung [drehung=0\|90\|180\|270] [spiegel=x\|z]` | dreht oder spiegelt das ganze Ergebnis um 0,0,0 (siehe [Module](#module-wiederholung-spiegelung-abschnitte)) |

## Werte und Ausdrücke

```
wert r=5
vieleck turm 0,0,0 n=8 r={r} h=24 stein hohl
vieleck og 0,18,0 n=8 r={r+1} h=6 putz hohl
kranzdach og y={og.y0}
```

- `wert name=ausdruck` legt eine ganze Zahl fest, gültig ab dieser Zeile im selben Gültigkeitsbereich (Datei oder Modul); neu festlegen ist erlaubt.
- Ausdrücke stehen in `{…}` überall, wo eine ganze Zahl stehen darf, auch als Teil einer Koordinate oder eines Namens (`turm{i}`). Innen sind Leerzeichen erlaubt; innere Klammern werden zuerst ausgerechnet.
- Rechnen: `+ - * / %`, Klammern, einstelliges Minus. `/` teilt mit Abrunden (`-7/2` = −4), `%` liefert 0 bis Divisor−1. Funktionen: `min(…)`, `max(…)`, `abs(a)`, `clamp(v,a,b)`, `zufall(a,b,k)` (ganze Zahl von a bis b, hängt nur von `samen`, der Zeile und k ab).
- Dezimalzahlen gibt es nur bei `drehung=` (vieleck).
- **Felder** einer Form gibt es ab der Zeile, die sie anlegt; ein Dach mit `name=` hat dieselben Felder außer `r`:

| Feld | Bedeutung |
| --- | --- |
| `x0 y0 z0 x1 y1 z1` | umschließender Quader der Form ohne Dach (mit Wandprofil), einschließlich |
| `bx by bz` | Ausdehnung (`x1-x0+1` …) |
| `mx mz` | Mitte, abgerundet; bei zylinder, vieleck und kugel die Mittelzelle |
| `r` | Radius bei zylinder (bei `d=` ungerade (d−1)/2, gerade d/2, bei Ellipse der größere), vieleck und kugel |
| `dach` | höchste Lage des Dachs der Form (ohne Spitze und Firstzier); ohne Dach `y1` |

Ein unbekanntes Feld oder eine noch nicht angelegte Form ist ein Fehler.

## Rollen

```
rolle stein stone_bricks:5 mossy_stone_bricks:2 cracked_stone_bricks:2 muster=flecken:3
rolle holz spruce_planks treppe=spruce_stairs
rolle laden spruce_trapdoor
```

- Eine Rolle steht für einen Zweck (Wand, Dach, Rahmen …), nicht für einen Block. Formen und Bauteile nehmen Rollen; nur Block-Angaben (unten) nehmen auch Block-IDs. Blöcke ohne Namensraum sind `minecraft:`, Mod-Blöcke stehen mit Namensraum (`create:cut_granite`). Blöcke in Rollen stehen ohne Zustände.
- Mehrere Blöcke mischen nach Gewicht (`:gewicht`, Standard 1).
- Feste Rollennamen, die Bauteile ohne Angabe nehmen: `glas` und `rahmen` (Fenster, Tür), `tuer` (Tür), `dach` (Dächer).

**Glieder.** Jede Rolle hat eine Blockfamilie; ein Glied heißt `rolle:glied`, z. B. `zier:treppe` oder `holz:zaun`.

| Glied | Minecraft | ohne Katalog abgeleitet |
| --- | --- | --- |
| `block` | Grundblock | – |
| `treppe`, `stufe`, `mauer` | stairs, slab, wall | aus dem Grundblock: `stone_bricks` → `stone_brick_stairs`, `spruce_planks` → `spruce_stairs` |
| `zaun`, `zauntor` | fence, fence_gate | `…_planks` → `…_fence`, `…_fence_gate`; `nether_bricks` → `nether_brick_fence` |
| `falltuer`, `tuer` | trapdoor, door | `…_planks` → `…_trapdoor`, `…_door`; `iron_block` → `iron_trapdoor`, `iron_door` |
| `knopf`, `druckplatte` | button, pressure_plate | `…_planks`, `stone`, `polished_blackstone` |
| `scheibe` | pane | `glass`, `<farbe>_stained_glass` → `…_pane` |
| `teppich` | carpet | `<farbe>_wool` → `<farbe>_carpet`, `moss_block` → `moss_carpet` |

- Mit eingelesenem Katalog kommen die Glieder aus dessen Blockfamilien und gelten nur, wenn es sie gibt.
- Fehlt einer Sorte einer Mischung das Glied (`cracked_stone_bricks` hat keine Treppe), nehmen die übrigen Sorten ihren Platz. Fehlt es allen, ist das ein Fehler; dann `<glied>=<id>` in der Rolle angeben.
- Ist ein Block selbst ein Glied (`rolle laden spruce_trapdoor`), ist er dieses Glied und zugleich der Grundblock.

**Verteilung** gemischter Rollen mit `muster=`:

- `einzeln` (Standard): jede Zelle für sich.
- `flecken:n`: zusammenhängende Flecken von etwa n Blöcken (Zufallswerte auf Gitterpunkten im Abstand n, dazwischen dreilinear gemittelt). Die Gewichte bleiben im Mittel erhalten. Gut für Moos und Verwitterung.
- `lagen:n`: eine Sorte je Band aus n Lagen, gezählt ab y=0. Gut für gebänderte Wände.

**Block-Angabe** (bei `block`, `spitze=`, `firstzier=`): eine Rolle (ihr Grundblock), `rolle:glied` oder eine Block-ID mit oder ohne Zustände, z. B. `lantern[hanging=true]` oder `spruce_stairs[facing=o,half=top]`. Richtungen dürfen `n/o/s/w/oben/unten` oder die Minecraft-Namen sein. Ein Rollenname hat Vorrang vor einer gleichnamigen Block-ID. Fehlende Zustände ergänzt Tessera.

## Formen

```
box [name] x,y,z x,y,z <rolle> …
zylinder [name] x,y,z (r=<n> | d=<n> | rx=<n> rz=<n>) h=<n> <rolle> …
vieleck [name] x,y,z n=<ecken> r=<n> h=<n> [drehung=<grad>] <rolle> …
umriss [name] y=<n> h=<n> punkte=x,z;x,z;… <rolle> …
grundriss [name] x,y,z h=<n> <rolle> …        + ASCII-Zeilen
kugel [name] x,y,z r=<n> [teil=ganz|oben|unten] <rolle> …
```

Eine Form mit Namen nimmt Bauteile, Dächer und Felder an. Der Name steht direkt hinter dem Befehl.

- **box:** Quader zwischen zwei Ecken (beide eingeschlossen). Hohl mindestens 3 × 3.
- **zylinder:** `x,y,z` ist die Mitte unten. `r`: Durchmesser 2r+1, hohl ab r=2. `d`: jede Breite; bei geradem d liegt die Mitte auf der Ecke zwischen vier Zellen (Punkt x+1, z+1), innen ist, was höchstens d/2 davon entfernt ist. `rx`/`rz`: Ellipse.
- **vieleck:** regelmäßiges n-Eck (3 bis 16), Umkreis r+0,5 um die Mitte der Zelle x,z. Ecke k liegt beim Kompasswinkel `drehung + 360·k/n` (0 = Norden, im Uhrzeigersinn). Standard-`drehung` ist 180/n; dann zeigt eine gerade Seite nach Norden, beim Achteck liegen die Seiten in den Haupt- und Nebenrichtungen. Die geraden Seiten liegen um r+0,5 mal cos(180°/n) von der Mitte: beim Achteck mit r=5 fünf Zellen weit, mit r=7 sechs. Wandprofil und Dachüberstand rücken jede gerade Seite (siehe unten).
- **umriss:** freies Vieleck durch die Mittelpunkte der Punkte, in Reihenfolge, automatisch geschlossen. Rechtwinklige Umrisse (L, T, U) ergeben exakte Formen.
- **grundriss:** ASCII-Draufsicht. `x,y,z` ist die Zelle des ersten Zeichens der ersten Zeile; Zeilen laufen nach Süden, Zeichen nach Osten. Jedes Zeichen außer Leerzeichen und `.` ist innen.
- **kugel:** Zellen mit Abstand ≤ r+0,5 von der Mitte der Zelle x,y,z. `teil=oben` behält y ≥ Mitte (Kuppel), `teil=unten` y ≤ Mitte. `hohl` lässt eine Schale (Zellen mit einem der sechs Nachbarn außen), mit `wand=n` n dick. An einer kugel hängen keine Bauteile; Dächer nur `helm` und `flach`.

```
umriss l y=0 h=5 punkte=0,0;10,0;10,6;4,6;4,12;0,12 putz hohl ecken=eckstein
grundriss halle 20,0,0 h=6 stein hohl
|##########
|##########
|#####
|#####
```

**Gemeinsame Angaben** (bei der kugel nur `hohl`, `wand`, `boden`, `decke`, `sockel`, `kranz`, `zonen`):

| Angabe | Bedeutung |
| --- | --- |
| `hohl` | nur Wände; das Innere wird pro Lage geräumt, auch was vorher dort stand |
| `wand=n` | Wandstärke (Standard 1): Zellen, deren kürzester Weg über Seitennachbarn nach außen höchstens n Schritte hat |
| `boden=R`, `decke=R` | unterste / oberste Lage innen |
| `sockel=R[:h]`, `kranz=R[:h]` | unterste / oberste h Lagen der Wand (Standard h=1) |
| `ecken=R` | Eckzellen über die ganze Höhe: bei box die vier Ecken, bei vieleck die Zellen, in denen die Ecken liegen, bei umriss und grundriss die konvexen Ecken |
| `zonen=R@a-b,…` | Wandrolle nach Höhe; a und b relativ zur untersten Lage, einschließlich. `putz@4-` gilt bis oben, `putz@4` nur für Lage 4. Spätere Einträge haben Vorrang. Nicht für Sockel, Kranz, Ecken und Fachwerk |
| `profil=…`, `konsolen=R` | Wandprofil, siehe unten |
| `fachwerk=R …` | siehe unten |

Rangfolge in Wandzellen: `ecken`, `sockel`, `kranz`, Fachwerk (Pfosten, dann Balken und Streben), `zonen`, Rolle der Form.

### Wandprofil: Vorkragung, Verjüngung, Bauch

```
# unten zwei breiter, bis Lage 12 verjüngt, ab Lage 18 einen Block vorgekragt
vieleck turm 0,0,0 n=8 r=5 h=24 stein hohl profil=0:2,3:2~,12:0,18:1 konsolen=zier
# Fachwerkhaus, Obergeschoss ab Lage 5 vorgekragt
box haus 0,0,0 10,9,7 putz hohl profil=5:1 konsolen=holz fachwerk=balken
```

- `profil=<lage>:<versatz>[~],…`: Lagen relativ zur untersten Lage der Form, aufsteigend; der Versatz ist positiv nach außen. Eine Lage nimmt den Versatz des letzten Eintrags an oder unter ihr (davor 0). Steht `~` hinter dem Eintrag, geht es linear zum nächsten, gerundet (,5 weg von null).
- Der Versatz verschiebt bei box jede Seite, beim zylinder die Radien, beim vieleck jede gerade Seite (der Umkreis wächst um v / cos(180°/n), beim Achteck v · 1,08); umriss und grundriss wachsen oder schrumpfen mit 8er-Nachbarschaft. Ein leerer Umriss ist ein Fehler. `profil=0:2` macht ein Achteck an allen Seiten zwei breiter: bei r=5 rücken die geraden Seiten von 5 auf 7, die Schrägen von |x|+|z| ≤ 7 auf 10.
- Jede Lage wird mit ihrem eigenen Umriss gebaut, auch `hohl`, `wand`, `ecken` und Fachwerk. Fenster und Türen nehmen den Umriss ihrer Lage, Dächer den der obersten.
- `konsolen=R` (nur mit `profil`): Wächst der Versatz von Lage L−1 auf L um Δ, bekommt Ring j (j=1 innen bis Δ außen) in Lage L−1−(Δ−j) eine umgedrehte Treppe von R, darüber bis Lage L−1 volle Blöcke. Ring 1 blickt zur angrenzenden Wandzelle, weitere Ringe blicken zum Ring davor; an Ecken wie die Dachtreppen (Innenecke in x-, Außenecke in z-Richtung).

### Fachwerk

```
box haus 0,0,0 12,6,8 putz hohl sockel=stein fachwerk=balken raster=4 riegel=3 muster=strebe
vieleck og 0,18,0 n=8 r=6 h=6 putz hohl fachwerk=balken riegel=1 muster=kreuz ringbalken=ja
```

`fachwerk=R [raster=4] [riegel=a,b,…] [muster=gerade|strebe|kreuz|raute] [streben=R2] [schraeg=block|treppe] [ringbalken=ja]`

- Fachwerk gilt für gerade Wandstücke in x- oder z-Richtung: die Seiten der box, die Seiten des Vielecks in den Hauptrichtungen, beim umriss die Stücke auf achsparallelen Seiten, beim grundriss gerade Stücke ab zwei Zellen. zylinder und kugel haben kein Fachwerk.
- **Pfosten** (Stämme, Achse y) an den Enden jedes Wandstücks und alle `raster` Zellen ab dem West- bzw. Nordende.
- **Balken** (Achse entlang der Wand) unten über dem Sockel, oben und in den Lagen von `riegel` (relativ zur untersten Lage, zwischen beiden).
- **Felder** zwischen Pfosten und Balken bekommen `muster`:
  - `gerade`: nichts
  - `strebe`: eine Diagonale pro Feld; das erste Feld vom West- bzw. Nordende steigt nach Osten bzw. Süden, dann wechselt die Richtung von Feld zu Feld
  - `kreuz`: beide Diagonalen
  - `raute`: Linien zwischen den Mitten der Feldseiten (Felder ab 3 × 3)
- Diagonalen haben eine Zelle pro Lage, aus `streben` (Standard: die Fachwerk-Rolle; Stämme mit Achse y). Mit `schraeg=treppe` werden sie Treppen, die in Steigrichtung blicken; die Rolle braucht dann Treppen.
- Fenster und Türen gehören in die Felder; über einer Strebe ersetzen sie sie ohne Hinweis.
- Schräge Wandstücke bekommen kein Fachwerk, dazu gibt es einen Hinweis. Mit `ringbalken=ja` laufen die Balken über sie weiter und an den Ecken der Form stehen Pfosten, ohne Hinweis; Muster gibt es dort nicht.

## Einzelne Blöcke

| Anweisung | Bedeutung |
| --- | --- |
| `linie x,y,z x,y,z <rolle>` | gerade Linie, z. B. ein Balken; Stämme liegen in Linienrichtung |
| `block x,y,z <block-angabe>` | ein Block, z. B. `block 0,0,7 zier:treppe` oder `block 6,0,8 spruce_stairs[facing=n]` |
| `leer x,y,z [x,y,z]` | macht Luft (ein Block oder ein Quader) |

## Bauteile an Wänden

Bauteile hängen an allen Formen außer der kugel. Sie rechnen Lage und Ausrichtung selbst und nehmen den Umriss ihrer Lage (mit Wandprofil).

### Wo Bauteile sitzen

```
fenster turm n y=9 b=2 h=3 art=bogen          # mittig auf der Nordseite
fenster turm winkel=120 ebene=4                 # am runden Turm unter 120°
wandlaterne haus s y=3 versatz=-2 arm=holz      # zwei Zellen links der Mitte (von außen gesehen)
fenster og o y=9 b=3 z=3 anzahl=2 abstand=5     # zwei Fenster ab z=3
```

- **Seite:** `n`, `o`, `s`, `w` an allen Formen; an zylinder, vieleck, umriss und grundriss auch `no`, `so`, `sw`, `nw` oder `winkel=<grad>` (Kompass); beim vieleck `seite=k` (Seite 0 zeigt am ehesten nach Norden, gezählt im Uhrzeigersinn). Bei der box nur `n/o/s/w`.
- **Wandzelle:** Der Strahl von der Formmitte in diese Richtung trifft die äußerste Wandzelle der Lage. **Außen** ist die Strahlrichtung, gerundet auf die nächste Hauptrichtung; danach richten sich Treppen, Falltüren und Türen. Bei den Hauptrichtungen gilt wie in Version 1 pro Spalte die äußerste Zelle.
- **Entlang der Wand:** `x=` (Seiten n, s) oder `z=` (o, w) ist die kleinste Koordinate des Bauteils; `versatz=n` schiebt aus der Mitte nach rechts (von außen gesehen), negativ nach links. Ohne Angabe mittig.
- **Höhe:** `y=` absolut oder `ebene=` relativ zur untersten Lage der Form, genau eins von beiden.
- **Wiederholung:** `anzahl=` und `abstand=` (Anfang zu Anfang, Standard b+2) gelten für alle Bauteile. An runden Formen verteilt `anzahl=` ohne Seite gleichmäßig rundum, beginnend bei `winkel=` (Standard 0).

### Fenster

```
fenster <form> <seite> (y=|ebene=) [x=|z=|versatz=] [b=1] [h=2] [art=…] [glas=R|luft] [rahmen=R]
        [bank=R|nein] [sturz=R|nein] [laibung=R] [laeden=R] [sprossen=R] [tiefe=0]
        [kasten=R blumen=B,B,… kastenfront=R2]
```

- `y` ist die unterste Glasreihe. **Bank** (umgedrehte Treppe außen unter dem Fenster) und **Sturz** (Reihe über dem Fenster, je einen Block breiter) aus `rahmen`, abschaltbar mit `nein`; der Sturz lässt Pfosten, Balken, Streben und Dachblöcke stehen. Fenster im Giebel sind erlaubt.
- **`art`:** `rechteck` (Standard); `bogen` (b ≥ 2, die äußeren Zellen der obersten Reihe werden umgedrehte Treppen, von der Mitte weg); `spitzbogen` (b ungerade ≥ 3, oben schmaler); `rund` (b = 3 oder 5, h = b, Ecken als Treppen); `kreuz` (b, h ungerade ≥ 3, Mittelspalte und -reihe aus `sprossen`); `schlitz` (Schießscharte, b = 1, Luft, ohne Bank und Läden). Bogen, Spitzbogen und Rund brauchen einen Rahmen.
- **`laibung=R`** Ring um die Öffnung in der Wandebene (Pfosten und Balken bleiben); **`laeden=R`** offene Falltüren links und rechts außen; **`sprossen=R`** jede zweite Spalte (rechteck ab b=3); **`tiefe=n`** setzt das Glas n Zellen nach innen (nur bei dickerer Wand, `wand=n+1`).
- **Blumenkasten** `kasten=R blumen=…`: unter dem Fenster außen je Glasspalte ein Block R, davor und an den Enden offene Falltüren (`kastenfront`, Standard `rahmen:falltuer`), oben die Blumen reihum. Ersetzt die Bank.

```
fenster og s y=9 b=3 laeden=laden kasten=erde blumen=poppy,dandelion,cornflower
```

### Türen und Tore

```
tür <form> <seite> [x=|z=|versatz=] [y=|ebene=] [b=1|2] [h=2..4] [art=rechteck|bogen|spitzbogen]
    [tuer=R|luft] [rahmen=R|nein] [oberlicht=R] [stufen=n] [vordach=R]
tor <form> <seite> [x=|z=|versatz=] [y=|ebene=] b=<n> h=<n> [art=rechteck|bogen|spitzbogen] [rahmen=R] [fallgitter=R]
```

- **Tür:** zwei Blöcke hoch, Standardhöhe eine Lage über der untersten Lage der Form; `b=2` ist eine Doppeltür mit Angeln außen. Rahmen links, rechts und oben aus `rahmen`. Bei `h` 3 oder 4 kommt darüber ein Oberlicht (`oberlicht=`, Standard `glas`) oder mit `art=bogen` ein Bogen; `art` braucht b=2 (`spitzbogen` ist dort gleich `bogen`). `tuer=luft` ist ein offener Durchgang. `stufen=n` legt außen n Treppen abwärts an, darunter volle Blöcke aus `rahmen`; `vordach=R` eine Reihe Treppen über dem Rahmen, b+2 breit, zur Wand ansteigend.
- **Tor:** Öffnung aus Luft b × h durch die ganze Mauer, Bogen wie bei Fenstern (ab b=4 zwei Treppen je Seite), Standardhöhe die unterste Lage. `fallgitter=R` setzt Zaunglieder von R in die oberste offene Reihe.

```
tür quereg s stufen=2 vordach=holz
tor mauer s b=4 h=5 art=bogen rahmen=stein fallgitter=holz
```

### Gesims, Pfeiler, Strebe

```
gesims <form> (y=|ebene=) [rolle] [art=treppe|stufe|block|kragen|zahn] [seiten=…]
pfeiler <form> [seiten=…|alle] [an=raster|ecken] [abstand=4] [versatz=0] [breite=1] [tiefe=1]
        [von=…] [bis=…] <rolle> [kopf=<block-angabe>] [fuss=<block-angabe>] [art=gerade|strebe]
strebe x,y,z richtung=<seite> laenge=<n> <rolle>
```

- **gesims:** ein Band außen um die Form (Luftzellen mit einem Nachbarn im Umriss, auch schräg), Rolle der Form, wenn keine angegeben ist. `treppe` (Standard) sind umgedrehte Treppen zur Wand, `stufe` obere Stufen, `block` volle Blöcke, `kragen` volle Blöcke mit umgedrehten Treppen darunter, `zahn` jede zweite Bandzelle. `seiten=n,w,s` beschränkt das Band; an runden Formen gilt eine Seite für ±45° um ihre Richtung (Schrägen ±22,5°).
- **pfeiler:** Lisenen außen vor der Wand, `breite` entlang der Wand, `tiefe` nach außen, von `von` bis `bis` (Standard ganze Höhe). `an=raster` alle `abstand` Zellen ab dem West- bzw. Nordende plus `versatz`, `an=ecken` an den Ecken diagonal nach außen. `kopf` und `fuss` setzen einen Block darauf bzw. darunter. `art=strebe` ist ein Strebepfeiler: die Tiefe nimmt in gleich hohen Abschnitten bis 1 ab, jeder Rücksprung bekommt eine Treppe zur Wand.
- **strebe:** schräge Stütze aus umgedrehten Treppen, ab x,y,z pro Schritt eine Zelle in `richtung` und eine Lage höher, die Treppen blicken zurück. Für Kopfbänder unter Vorkragungen:

```
strebe 4,5,9 richtung=s laenge=2 holz     # zwei Treppen schräg von der Wand bis unter die Schwelle
```

### Anbauten

```
balkon <form> <seite> (y=|ebene=) [x=|z=|versatz=] b=<n> [tiefe=1..4] [boden=R] [gelaender=R] [konsolen=R]
       [stuetzen=R] [dach=R] [tuer=ja]
umgang <form> (y=|ebene=) [tiefe=1..4] [boden=R] [gelaender=R] [konsolen=R] [stuetzen=R abstand=4] [dach=R]
erker <form> <seite> (y=|ebene=) [x=|z=|versatz=] b=<n> h=<n> [tiefe=2] [art=eckig|halbrund|dreieck] <rolle>
      [name=…] [konsolen=R stufen=2] [dach=walm|kegel|helm|sattel|flach|nein] [dachrolle=R] [dachprofil=…]
gaube <form> <seite> [x=|z=|versatz=] [b=1] [h=2] [art=sattel|schlepp|spitz] [rolle=R] [dachrolle=R] [einzug=0]
      [fensterart=…] [laeden=R]
ecktuerme <form> [an=alle|nw,no,so,sw] r=<1..3> h=<n> (y=|ebene=) <rolle> [einzug=1] [konsolen=R stufen=r]
          [dach=helm|kegel|walm] [dachrolle=R] [dachprofil=…] [biegung=…] [spitze=…]
```

Gemeinsam: Anbauten setzen außerhalb der Wand nur in Luft; wo etwas im Weg ist, bleibt es stehen und es gibt einen Hinweis mit der Zeile des Hindernisses. Standardrollen: `boden=rahmen`, `gelaender=rahmen:zaun`, `konsolen=rahmen`, `dachrolle=dach`; `konsolen=nein` und `gelaender=nein` lassen sie weg.

- **balkon:** Boden in Lage y−1 auf b × `tiefe` Zellen vor der Wand, Geländer in Lage y auf den drei äußeren Kanten. Konsolen darunter wie beim Wandprofil: innen an der Wand am tiefsten, außen eine Lage unter dem Boden. `stuetzen=R` setzt stattdessen Stützen an den äußeren Ecken bis zum ersten Block darunter. `dach=R` legt ab Lage y+3 ein Pultdach über den Balkon plus 1 Überstand, ansteigend zur Wand; `tuer=ja` eine Tür in der Wand in der Mitte.
- **umgang:** wie balkon rund um die Form, Ring mit Abstand 1 bis `tiefe` (8er-Nachbarschaft), Geländer außen. `stuetzen=R` setzt Stämme auf dem äußeren Ring: an den Ecken der Form und dazwischen gleichmäßig höchstens `abstand` Zellen auseinander (runde Formen ab Norden); sie reichen bis unter den nächsten Block darüber (höchstens 6 Lagen), mit `dach=` bis ans Dach, sonst 3 Lagen hoch. Unter jeder Stütze läuft eine Strebe zur Wand (statt der Konsolen, `konsolen=` gibt ihr Material). `dach=R` setzt ein Kranzdach in Lage y+3 mit `breite=tiefe+1`.
- **erker:** eine eigene hohle Form vor der Wand: `eckig` b × `tiefe`, `halbrund` ein halber Zylinder mit Radius (b−1)/2 (b ungerade), `dreieck` mit der Spitze außen. Die Hauptwand im Querschnitt wird geräumt, das Innere geht ins Haus über. Darunter `konsolen` in `stufen` Lagen, nach unten verjüngt. Mit `name=` ist der Erker eine Form für Fenster; ohne `dach=` bekommt er ein Dach passend zur Art (walm, kegel, helm). Das Dach wird auf der hinter die Wand gespiegelten Form gerechnet und nur vor der Wand gebaut; es verschneidet sich mit dem Hauptdach. Ein halbrunder Erker hat wie ein zylinder keine Ecken.
- **gaube:** braucht ein vorher gebautes Dach auf der Form. Vorderwand in der Wandebene (um `einzug` nach innen), b+2 breit und h+1 hoch ab der ersten Dachlage, Fenster b × h in der Mitte, Seitenwangen bis zur Dachfläche. Eigenes Dach: `sattel` (First quer zur Traufe, Überstand 1), `schlepp` (Pultdach mit Profil `2/1`), `spitz` (Walm). Das Hauptdach wird im Gaubenkörper entfernt, beide Dächer verschneiden sich.
- **ecktuerme:** an den Ecken von box, umriss und vieleck. Mitte: die Eckzelle um r−`einzug` diagonal nach außen. Zylinder mit Radius r ab Lage y, hohl ab r=2; Dachblöcke der Hauptform weichen. Darunter `konsolen` in `stufen` Lagen als umgekehrter Kegel. Dach nach `dach` (Standard `helm`) mit `dachprofil`, `biegung` und `spitze` wie bei den Dächern.

```
umgang turm y=15 tiefe=2 stuetzen=balken abstand=6
balkon turm w y=8 b=3 tiefe=2 dach=holz tuer=ja stuetzen=balken
erker og s y=9 x=1 b=5 h=5 art=halbrund putz dach=helm dachprofil=1/1,1/3 name=erker
gaube og s x=17 laeden=laden
ecktuerme burg r=2 h=6 y=8 stein dach=helm spitze=lightning_rod
```

### Zinnen, Bögen, Treppen

```
zinnen <form> [rolle] [muster=1:1] [hoehe=1] [kappe=<block-angabe>] [vorkragung=0|1 konsolen=R]
bogen x,y,z x,y,z hoehe=<n> <rolle> [art=rund|spitz|flach] [dicke=1] [tiefe=1]
treppe x,y,z richtung=<seite> laenge=<n> <rolle> [breite=1] [unterbau=voll|keiner|treppe] [gelaender=R]
wendeltreppe x,y,z r=<n> bis=<y> <rolle> [richtung=rechts|links] [start=<seite>] [breite=1]
             [stufen=treppe|stufe] [spindel=R] [kopffreiheit=3]
wendeltreppe <form> aussen bis=<y> <rolle> [y=|ebene=] [breite=1] [richtung=rechts|links] [start=<seite>]
             [stufen=treppe|stufe] [gelaender=R] [konsolen=R] [schritt=1]
```

- **zinnen:** eine Lage über der Form; `muster=a:b` a Blöcke Zinne, b Lücke, Ecken immer Zinne; `hoehe` Zinnenhöhe, `kappe` ein Block auf jeder Zinne. `vorkragung=1` (Maschikuli): Kranz und eine Lage Brüstung sitzen einen Block außen, darunter umgedrehte Treppen auf jeder zweiten Zelle (`konsolen=`, Standard die Zinnenrolle), dazwischen Gussöffnungen.
- **bogen:** beide Punkte in einer Lage auf einer Linie in x- oder z-Richtung, sie sind die äußersten Zellen der Bogenbeine. Unterkante `rund` (Halbellipse mit Scheitel `hoehe`), `spitz` (zwei Kreisbögen), `flach` (Segmentbogen). Pro Spalte `dicke` Zellen ab der Unterkante; liegt sie ab ,5 über der ganzen Zahl, wird die unterste Zelle eine umgedrehte Treppe vom Mittelpunkt weg. Steile Spalten reichen bis unter die nächste, damit der Bogen geschlossen bleibt. `tiefe` geht nach +z bzw. +x.
- **treppe:** Stufe i bei Punkt + i·Richtung, eine Lage höher pro Stufe, blickend in `richtung`; die Breite wächst nach rechts (in Aufstiegsrichtung). `unterbau` füllt bis zur Startlage (`voll`), setzt umgedrehte Treppen darunter (`treppe`) oder nichts; `gelaender` Zaunglieder auf beiden Seiten.
- **wendeltreppe (innen):** Weg ist der Ring des Radius r um x,z (wie die Wand eines zylinders), nach Winkel ab `start` (Standard n), `rechts` im Uhrzeigersinn. Bei `stufen=treppe` steigt jede Zelle des Wegs eine Lage und blickt in Laufrichtung, bei `stufe` eine halbe Lage (untere und obere Stufe im Wechsel). Ende in Lage `bis`. `spindel=R` setzt eine Säule in der Mitte, `kopffreiheit` räumt über jeder Stufe, auch durch Böden. **`breite` > 1** legt weitere Ringe nach innen an; dann gibt der innerste Ring den Takt vor (eine Lage pro Zelle), die äußeren Ringe verteilen sich gleichmäßig auf die Stufen. Hat ein äußerer Ring zwei Zellen in einer Stufe, wird die erste ein Absatz (untere Stufe). So springt kein Ring um zwei Lagen.
- **wendeltreppe aussen:** Weg sind die Zellen außerhalb der Form mit Abstand 1 bis `breite` (Umriss der jeweiligen Lage), nach Winkel um die Formmitte; pro `schritt` Zellen eine Lage höher. Geländer außen eine Lage über den Stufen, Konsolen unter jeder Stufe zur Wand.

## Dächer

```
dach <typ> <form> [name=…] [ueberstand=1] [profil=…|steil=k] [dicke=1] [rolle=dach] [fuellen] …
kranzdach <form> y=<lage> [breite=2] [profil=…|steil=k] [rolle=dach] [kante=ja|nein]
```

| Typ | Form | Lagen schrumpfen | Standardprofil | eigene Angaben |
| --- | --- | --- | --- | --- |
| `sattel` | box | quer zum First | `1/1` | `first=x\|z`, `giebel=R`, `kante=ja\|nein` |
| `pult` | box | von der niedrigen Seite | `1/1` | `hoch=<seite>` (Pflicht), `giebel`, `kante` |
| `krueppelwalm` | box | wie sattel, in den obersten `kruppel=n` Lagen (Standard 2) auch von den Giebelseiten | `1/1` | `first`, `giebel`, `kante`, `kruppel` |
| `walm`, `zelt` | alle außer kugel | von allen Seiten | `1/1` | `biegung` |
| `kegel` | alle außer kugel | von allen Seiten, beim zylinder kreisförmig | `1/2` | `biegung` |
| `helm` | alle | von allen Seiten | `1/3` | `biegung` |
| `flach` | alle | – | – | `art=block\|stufe`, `rand=R` |

Für alle außer `flach`: `spitze=<block-angabe>` auf die Spitze, `firstzier=<block-angabe>` eine Lage über jede Firstzelle (z. B. `zier:mauer`), `traufe=treppe|stufe|keine` (Standard keine), `dicke=n`, `fuellen`. `first` ohne Angabe: entlang der längeren Seite.

- **Profil** `profil=dx/dy,dx/dy,…` von der Traufe aufwärts: Jedes Element rückt den Rand um dx Zellen nach innen, verteilt auf dy Lagen (Einzug `a(y) = a₀ + floor(dx·(y−y₀)/dy)`). dx = 0 ist senkrecht, negativ geht nach außen (Bauch). Das letzte Element wiederholt sich, bis das Dach zu ist. `steil=k` ist `profil=1/k`.
- **Voreinstellungen:** `glocke` = `2/1,1/1,1/2,1/3` (ausgestellte Traufe, dann steil), `mansard` = `1/3,1/3,2/1` (sattel, walm), `zwiebel` = `-1/1,-1/1,0/2,1/1,1/1,1/2,1/2,1/3` (walm, kegel, helm), `kuppel` (walm, kegel): Viertelkreis, Einzug in Lage y ist R − floor(√((R+0,5)² − y²)) mit R = Radius der Grundfläche.
- **biegung=<seite>:<n>** (walm, kegel, helm; Seiten auch `no`, `so`, `sw`, `nw`): Hexenhut. Lage y wird um round(n · max(0, 3u−2)²) Zellen zur Seite verschoben, u = y / oberste Lage. Nur das oberste Drittel wandert, die Spitze um n.

**So rechnet die Dachmaschine.** Lage 0 liegt über der obersten Wandlage der Form. Die Grundfläche F ist der Umriss der obersten Lage plus `ueberstand` (box als Rechteck, zylinder über den Radius, vieleck an jeder geraden Seite um `ueberstand` wie beim Wandprofil, sonst mit 8er-Nachbarschaft). Lage y umfasst F um a(y) geschrumpft (zylinder und vieleck über den Radius des Umkreises), O(y); das Dach ist zu, sobald O(y) leer ist. In jeder Lage:

- **Stufenkante** (O(y) ohne O(y+1)): Treppen, die zur angrenzenden Zelle von O(y+1) blicken. Grenzt eine Zelle an zwei Seiten über Eck an O(y+1) (Innenecke, Kehle), blickt sie in x-Richtung (Osten oder Westen); grenzt sie nur schräg an (Außenecke), in z-Richtung. Rückt eine Schräge in einer Lage um zwei Zellen ein, entsteht so ein Zickzack aus Außen- und Innenecken. Bei flachen Profilen werden Zellen ab Abstand 2 untere Stufen.
- **Schale:** Randzellen von O(y), die keine Stufenkante sind, werden volle Blöcke (senkrechte Abschnitte); `dicke=n` macht sie n dick.
- **Bauch:** Wo eine Lage nach außen wächst, entstehen umgedrehte Treppen.
- **Abschluss:** Die letzte Lage wird First: eine Zelle breit untere Stufen, zwei Zellen breit zwei Treppen gegeneinander, eine einzelne Zelle ein voller Block (Spitze). Eine breitere letzte Lage (Walm, Kegel, Helm) bekommt Treppen um ihre Mitte.
- **Inneres** bleibt Luft (Dachboden), mit `fuellen` volle Blöcke. Damit man an schrägen Kanten nicht ins Dach sieht, wird eine Dachboden-Zelle hinter einer offenen Treppenseite ein voller Block.
- **Giebel** (sattel, pult, krueppelwalm): Die Wandlinien der Giebelseiten füllt `giebel` (Standard: Rolle der Form) bis unter das Dach, beim Pultdach auch die hohe Seite.
- **Ortgang** (`kante`, Standard bei `ueberstand` ≥ 1 und Profil `1/1`): unter jeder Treppe der äußersten Spalte an den Giebelseiten eine umgedrehte Treppe, die zum Gebäude blickt.
- **Traufe** (`traufe=treppe|stufe`): unter dem Überstand von Lage 0, eine Lage tiefer, umgedrehte Treppen zur Wand bzw. obere Stufen.
- **Krüppelwalm:** In den obersten `kruppel` Lagen rücken die Giebelseiten so weit ein, wie die Traufen seit der Lage darunter eingerückt sind (bei `1/1` eine Zelle pro Lage).

**Verschneidung.** Überlappt oder berührt die Grundfläche eines Dachs die eines früheren, werden beide ein Dach: Jede Lage ist die Vereinigung der Lagen beider, in absoluten Höhen. Kehlen und Grate entstehen von selbst, die Treppen-Ecken setzt die Verbindungsberechnung.

- Giebel im Inneren des vereinigten Dachs entfallen: Ein anderes Dach geht über die Zelle oder bedeckt die Zelle vor dem Giebel.
- Ein Krüppelwalm walmt nur an freien Giebelseiten. Liegt eine Giebelseite an einem anderen Dach, läuft der First dort in das andere Dach.
- Was andere Anweisungen zwischen den Dächern gesetzt oder geräumt haben (Schornstein, hohler Turm), bleibt so.
- Zellen, die mehrere Dächer haben, gehören dem früheren (Rolle, Herkunft).

```
box haus 7,0,-3 13,4,3 putz hohl
box fluegel 9,0,3 13,4,10 putz hohl
dach sattel haus first=x
dach krueppelwalm fluegel first=z        # L-Haus mit einer Kehle
```

**Kranzdach** (Dachschürze): ein Ring außen um die Form, der zur Wand hin ansteigt und an ihr endet, typisch für gestaffelte Türme. Grundfläche sind die Zellen außerhalb des Umrisses in Lage `y` mit Abstand (8er-Nachbarschaft) ≤ `breite`; Lage k umfasst die Zellen mit Abstand ≤ breite − a(k), Standardprofil `1/1`. Treppen blicken zur Wand, an Ecken wie in der Dachmaschine. `kante=ja` (Standard nein) setzt unter den äußersten Ring umgedrehte Treppen. Wo die Schürze auf Fenster oder Türen trifft oder direkt davor liegt, setzt sie nur in Luft und meldet einen Hinweis.

```
kranzdach og y={og.y0} breite=2
dach helm og profil=glocke ueberstand=1 spitze=lightning_rod
```

**Flachdach:** eine Lage über dem Umriss samt Überstand aus `rolle` (`art=stufe`: untere Stufen); `rand=R` setzt einen Ring eine Lage höher, z. B. eine Mauer.

## Zier und Deko

```
wandlaterne <form> <seite> (y=|ebene=) [x=|z=|versatz=] [art=laterne|seelenlaterne|fackel|seelenfackel] [arm=R]
haengelaterne x,y,z [kette=1] [art=laterne|seelenlaterne]
banner <form> <seite> (y=|ebene=) [x=|z=|versatz=] farbe=<farbe> [haengend=ja]
efeu <form> [seiten=…|alle] [dichte=0.3] [laenge=3] [von=…] [bis=…] [art=ranke|flechte] [muster=flecken:3]
bewuchs <form> [flaechen=oben|seiten|alle] block=<block-angabe> [dichte=0.3] [muster=flecken:3]
laub x,y,z r=<n> <rolle> [dichte=0.85]
streue <form> block=<block-angabe> [dichte=0.2] [flaechen=oben]
```

- **wandlaterne:** an der Wandzelle außen. Mit `arm=R` ein Zaunglied von R vor der Wand, darunter die hängende Laterne; ohne Arm steht die Laterne auf einem Block aus `rahmen`. `fackel` ist eine Wandfackel, die nach außen blickt.
- **haengelaterne:** Von der Zelle x,y,z an `kette` Ketten nach unten, darunter die hängende Laterne; über x,y,z muss ein Block sein.
- **banner:** Wandbanner der Farbe (deutsch oder Minecraft-Name), blickend nach außen, in der Zelle vor der Wand; `haengend=ja` setzt ein Zaunglied aus `rahmen` darüber. Muster gehen nicht (Block-Entity). Der Viewer zeigt Banner einen Block hoch.
- **efeu:** Kandidaten sind Luftzellen direkt vor einer Wandzelle mit voller Seitenfläche, zwischen `von` und `bis` (Standard ganze Höhe). Wo das Rauschmuster über 1−`dichte` liegt, beginnt Efeu und hängt zufällig 1 bis `laenge` Zellen nach unten, solange Luft und Wand weitergehen. `ranke` ist `vine`, `flechte` `glow_lichen`, jeweils mit der Seite zur Wand.
- **bewuchs:** setzt den Block auf freie Flächen der Form, wo das Rauschmuster es will: `oben` auf Luftzellen über vollen Oberseiten, `seiten` wie Efeu ohne Hängen.
- **muster=** bei efeu und bewuchs: `flecken:n` (Standard `flecken:3`) wächst in zusammenhängenden Flecken der Größe etwa n, `einzeln` verstreut Zelle für Zelle; `lagen` gibt es hier nicht.
- **laub:** Blätterwolke um x,y,z mit Abstand ≤ r+0,5; am Rand fällt ein Teil per Rauschen weg (`dichte`). Blätter immer `persistent=true`; Stamm und Äste darin bleiben stehen.
- **streue:** einzelne Blöcke (Pilze, Blumen, Laternen) auf freie Oberseiten der Form.

```
efeu turm bis=5 dichte=0.2 laenge=3
haengelaterne 0,18,-7
banner turm s y=13 farbe=rot
```

## Farmen

```
feld x,y,z x,y,z [frucht=wheat|carrots|potatoes|beetroots|…] [zaun=R] [tor=<seite>] [weg=R]
```

- Beide Punkte in derselben Lage y. Ackerboden (`farmland[moisture=7]`) auf allen Zellen außer Wasser, die Früchte eine Lage höher im höchsten Alter.
- **Wasser:** Jede Ackerzelle hat Wasser im Chebyshev-Abstand ≤ 4. Reihen parallel zur längeren Seite: die erste auf Abstand min(4, (B−1)/2) vom Rand (B kürzere Seite), dann alle 9, eine weitere am anderen Rand, falls nötig, aber nie in der Randreihe. Sind beide Seiten höchstens 9 lang, gibt es eine Wasserzelle in der Mitte.
- `zaun=R` Zaunring eine Zelle außerhalb, eine Lage höher; `tor=<seite>` ein Zauntor in der Mitte dieser Seite, nach außen; `weg=R` ein Ring außerhalb des Zauns in Lage y. `zaun=` und `weg=` nehmen Rollen oder Block-IDs (`weg=dirt_path`).

```
feld 24,-1,0 32,-1,8 frucht=wheat zaun=holz tor=w weg=dirt_path
```

## Freistil: Zeichnungen

```
zeichen <z> <block-angabe> [tiefe=<n>] [fest=ja] [<zustand>=<wert> …]
ebene x,y,z            + ASCII-Zeilen
ebenen x,y,z           + ASCII-Zeilen, Lagen getrennt durch eine Zeile "|-"
ansicht <form> <seite> [x=|z=|versatz=] (y=|ebene=)   + ASCII-Zeilen
```

- **`zeichen`** legt ein Zeichen für die folgenden Zeichnungen fest, gültig in der Datei oder im Modul, in dem es steht. Erlaubt ist jedes einzelne sichtbare Zeichen außer `|`, auch `#`, `"` und Klammern. Fest vergeben: Leerzeichen lässt die Zelle, wie sie ist, `.` macht Luft.
- Zustände haben Vorrang vor den ergänzten; Blickrichtungen auch als `n/o/s/w/oben/unten`. Die Verbindungsberechnung läuft danach über alles; `fest=ja` lässt den Block aus (feste Verbindungen, Treppenformen). `tiefe=n` gilt in `ansicht`.
- **`ebene`:** x,y,z ist die Zelle des ersten Zeichens der ersten Zeile; Zeilen laufen nach Süden (+z), Zeichen nach Osten (+x). Relative Richtungen sind hier ein Fehler.
- **`ebenen`:** wie `ebene`, jede Gruppe eine Lage höher; Gruppen trennt eine Zeile `|-`.
- **`ansicht`:** eine Wand von außen gesehen. Die unterste Zeile liegt in der Höhe `y=`/`ebene=`, jede Zeile darüber eine Lage höher. Das erste Zeichen jeder Zeile liegt links (von außen gesehen) bei `x=`/`z=` (kleinste Koordinate wie bei Bauteilen), sonst sitzt die Zeichnung mittig. Jede Zeichenposition kommt auf die Wandzelle ihrer Lage (wie Bauteile), auch an runden Formen und mit Wandprofil. `tiefe=n` setzt den Block n Zellen nach außen (negativ nach innen). Relative Richtungen pro Wandzelle: `aussen`, `innen`, `links` (im Uhrzeigersinn neben aussen), `rechts` (gegen den Uhrzeigersinn).

```
zeichen R zier tiefe=1                          # Rahmen, steht einen Block vor
zeichen ( zier:treppe facing=links half=top
zeichen ) zier:treppe facing=rechts half=top
zeichen [ zier:treppe facing=links
zeichen ] zier:treppe facing=rechts
zeichen G glas
zeichen L shroomlight
ansicht turm s y=31
|  RRR
| R(G)R
|R(GGG)R
|RGGLGGR
|R[GGG]R
| R[G]R
|  RRR
```

## Module, Wiederholung, Spiegelung, Abschnitte

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

- **Module** legen eine Vorlage an, die erst bei `baue` baut. Module stehen auf oberster Ebene; `baue` darf auch vor dem `modul` stehen. Angaben sind Zahlen (in Ausdrücken: `{hoehe}`) oder Wörter. Ein Wort steht im Modul für sich: als ganzes Token (`wand`), als Wert einer Angabe (`dachrolle=wand`, `biegung=knick:2`) oder als Rolle vor einem Glied (`wand:treppe`). Standardwerte werden bei `baue` ausgerechnet.
- Im Modul sind Koordinaten relativ zum Punkt von `baue`. Formen heißen von außen `<instanz>.<form>` (Standard-Instanzname: Modulname mit laufender Nummer, `turm1`), z. B. `{turm1.t.x0}`. Felder geben Koordinaten dort an, wo sie stehen: außen absolut, im Modul lokal (auch Felder von Formen der Datei), sodass `block {t.x1+1},0,{t.mz} …` im gedrehten Modul neben der Form landet. Das gilt auch im gespiegelten Durchlauf von `spiegle`.
- Ein Modul sieht Rollen, `samen`, Werte und Zeichen der Datei, nicht die des Moduls, das es baut; Standardwerte der Angaben werden in der Datei ausgerechnet. Eigene Werte und Zeichen bleiben im Modul, Rollen darf ein Modul nicht anlegen. Aufruftiefe höchstens 16.
- **Drehen und Spiegeln:** `drehung` dreht im Uhrzeigersinn von oben um den Punkt von `baue`, 90 bildet (x,z) auf (−z,x) ab. `spiegel=x` bildet x auf −x ab, `spiegel=z` z auf −z; mit beiden Angaben wird zuerst gespiegelt, dann gedreht. Formen, Dächer und Prüfungen rechnen im fertigen Bau (absolut): Dächer verschiedener Instanzen verschneiden sich wie sonst. Im Modul werden umgerechnet: Koordinaten und Höhen (`y=`, `von=`, `bis=`), Seiten und Winkel der Bauteile (auch `seite=` am vieleck, `seiten=`, `an=`, `start=`), `x=`/`z=` und `versatz=` (ein Spiegel macht rechts zu links), `richtung=` von treppe und strebe, `rechts`/`links` der Wendeltreppe, `first=`, `hoch=` und `biegung=` der Dächer, `rx=`/`rz=`, `drehung=` am vieleck, `punkte=` am umriss, grundriss- und andere Zeichnungen, die Tiefe von `bogen` und die Zustände aus der Datei (facing, axis, Ranken und Flechten, rotation, Schienen, Türangeln, Truhenhälften). Eine einzelne Tür hat im gespiegelten Modul ihre Angel rechts. Treppenformen und Verbindungen rechnet die Verbindungsberechnung danach neu.
- **`wiederhole`** führt den Inhalt für a, a+s, … bis einschließlich b aus; `schritt` darf negativ sein, höchstens 10 000 Durchläufe. Die Variable gilt im Inhalt und lässt sich dort nicht neu festlegen.
- **`spiegle`** führt den Inhalt zweimal aus, das zweite Mal gespiegelt: `x=10` (x' = 20 − x) oder `x=10.5` (x' = 21 − x). Namen im zweiten Durchlauf bekommen `_s`.
- **`abschnitt "Name"`:** Alle folgenden Blöcke gehören zu diesem Bauabschnitt, bis zum nächsten `abschnitt` oder Dateiende; in einem Modul bis zu seinem Ende. `baue … abschnitt=` gilt für die Instanz. In der App gibt es pro Abschnitt Ebenen, Materialliste, Rohstoffe und Fortschritt.
- **`ausrichtung`** dreht oder spiegelt das ganze Ergebnis um 0,0,0 (Zellen und Zustände, vor der Verbindungsberechnung). Höchstens einmal pro Datei, an beliebiger Stelle, nicht in Modulen, Schleifen oder `spiegle`. Koordinaten in Meldungen bleiben die der Datei. Die App schreibt diese Zeile beim Drehen und Spiegeln.
- **Grenzen:** höchstens 2 Millionen ausgeführte Anweisungen (Schleifen und Module zählen jeden Durchlauf) und 8 Millionen gesetzte Blöcke pro Datei. Das Neuzeichnen von Dachgruppen zählt nicht; ein Dach zählt die Zellen, die seine Gruppe neu füllt.
- **Meldungen im Modul** nennen die Kette: „Zeile 40 (in modul turm, gebaut in Zeile 88)“, verschachtelt innen zuerst. Gleiche Meldungen aus Schleifen erscheinen einmal.

```
modul tuermchen hoehe=6 wand=putz knick=o
  zylinder t 0,0,0 r=3 h={hoehe} wand hohl profil=0:-1,2:0 konsolen=zier
  fenster t s ebene=2 b=1 h=2 rahmen=holz bank=nein
  dach helm t profil=glocke ueberstand=1 biegung=knick:2
ende
abschnitt "Türmchen"
baue tuermchen 0,13,-8 drehung=180 knick=w
baue tuermchen 8,22,0 drehung=270 hoehe=5
```

## Bearbeiten in der App

Baupläne in `tess 2` lassen sich in Tessera bearbeiten (Bereich „Bearbeiten“ in der Seitenleiste). Jede Änderung landet in der `.tess`-Datei, der Rest der Datei bleibt unverändert:

- **Rollen:** Ein Klick auf eine Sorte tauscht sie über die Blocksuche gegen einen anderen Block; das Gewicht bleibt. Nur dieses Token der `rolle`-Zeile ändert sich, Kommentare und Fortsetzungszeilen bleiben.
- **Drehen 90°, Spiegeln x, Spiegeln z:** legen die Zeile `ausrichtung` unter dem Kopf an, ändern oder entfernen sie (bei 0° ohne Spiegel). Die App schreibt Spiegelungen als `spiegel=x` mit passender Drehung.
- **Einzelblöcke:** Mit „Einzelblöcke bearbeiten“ öffnet ein Klick auf einen Block ein Menü: Entfernen, Ersetzen (Blocksuche; Zustände bleiben, wenn der neue Block von derselben Art ist), Zustand. Die Änderung steht als `block`- oder `leer`-Zeile im Bereich `# ---- Änderungen in Tessera ----` am Dateiende, in Dateikoordinaten (vor `ausrichtung`); eine weitere Änderung derselben Zelle ersetzt die Zeile. Verbindungen, Treppenecken und Zustände, die Tessera ohnehin ergänzt, schreibt Tessera nicht mit. Zeilen in diesem Bereich ersetzen Glas, Türen und Anbauten ohne den Hinweis „Überdeckt“ (sie sind gewollt); eigene Zeilen gehören deshalb davor.
- **Rückgängig/Wiederholen:** Strg+Z, Strg+Y oder Strg+Umschalt+Z, 100 Schritte pro Tab, auf Ebene des Dateitexts. Jeder Schritt schreibt die Datei.
- **Versionen:** Vor jedem Schreiben aus der App und vor dem Übernehmen einer Änderung von außen sichert Tessera den bisherigen Inhalt unter `projekte/.versionen/<name>/<JJJJ-MM-TT_hh-mm-ss>.tess`; die 50 neuesten bleiben. Der Dialog „Versionen“ öffnet eine Fassung als schreibgeschützten Tab oder stellt sie wieder her (die aktuelle Fassung wird vorher gesichert, Strg+Z holt sie zurück).
- Ohne Projektordner arbeitet alles im Browser-Speicher; „Als Datei speichern“ lädt die Datei herunter.

## Verbundene Blöcke

Zäune, Mauern, Glasscheiben, Eisengitter und Treppen-Ecken bekommen nach dem Aufbau ihren Zustand nach den Regeln des Spiels (Verbindungen, Mauerpfosten, niedrige oder hohe Mauerseiten, innere und äußere Treppenecken). Alle Blöcke bekommen ihre vollständigen Zustände (`waterlogged=false`, geschlossene Türen, Blätter mit `persistent=true` …). Mod-Blöcke mit eigenen Verbindungsregeln sind nur abgedeckt, wenn sie den Vanilla-Namen folgen (`…_fence`, `…_wall`, `…_pane`, `…_stairs`).

## Herkunft

Für jeden Block merkt sich Tessera die Anweisung, die ihn gesetzt hat, mit Modulkette und Bauabschnitt. Die Hover-Karte zeigt sie gekürzt, z. B. „Zeile 37: dach helm og profil=glocke …“ oder „Zeile 28 (in modul tuermchen, gebaut in Zeile 85): …“; der ganze Text steht im Tooltip. Das gilt auch für Version 1. Ein Klick auf einen Hinweis in den Projektdaten umrandet die Blöcke seiner Zeile und dreht die Kamera hin; Esc oder ein zweiter Klick löst die Markierung.

## Meldungen

- **Fehler** nennen die Zeile (im Modul mit Kette) und verhindern das Öffnen. Tessera meldet alle Fehler auf einmal; Folgefehler (eine Form, deren eigene Zeile fehlerhaft ist) erscheinen nicht noch einmal.
- **Hinweise** öffnen trotzdem und stehen in den Projektdaten: Fenster oder Tür nicht in der Wand, in einer Ecke, in einem Pfosten oder Balken, Überschneidung mit einem anderen Fenster, Fenster an Boden oder Oberkante, Bank oder Laden stößt an einen Block, Anbau oder Zier stößt an einen Block (mit dessen Zeile), Fachwerk an schrägen Seiten, Kranzdach an Fenstern, `spitze=` auf einem Dach ohne Spitze, Block fehlt im Katalog. Dazu die Prüfungen auf dem fertigen Bau:
  - **Überschrieben:** Eine spätere Anweisung ersetzt Glas, Tür oder Anbau einer früheren Zeile („Zeile 57 überdeckt das Fenster aus Zeile 31“).
  - **Halt:** Blöcke ohne den Halt, den das Spiel verlangt: stehende Fackel, Laterne, Kerze, Druckplatte (Block mit voller Oberseite darunter, auch Zaun, Mauer oder Kette), Teppich, Schild und Banner (irgendein Block darunter), Schiene (volle Oberseite); hängende Laterne und Hängeschild (Block darüber); Wandfackel, Leiter, Knopf (voller Block dahinter), Wandschild und Wandbanner (Block dahinter); Ranke und Flechte (Block auf einer ihrer Seiten); Tür (Block unter der unteren Hälfte); Früchte (Ackerboden), Blumen und Setzlinge (Erde oder Ackerboden), Pilze, Kakteen, Zuckerrohr und weitere Pflanzen (ihr Boden); Sand, Kies, Betonpulver, Amboss (irgendein Block darunter). Falltüren brauchen keinen Halt. In der untersten Lage gelten „darunter“, Boden und Schwerkraft als erfüllt.
  - **Schweben:** Blockgruppen, die über Seiten oder Kanten zusammenhängen und keinen Block in der untersten Lage des Projekts haben. Die Meldung nennt Größe, umschließenden Quader und die Zeilen mit den meisten Blöcken. `erlaube schweben` schaltet das für die Datei ab.
  - **Fließen:** Wasser oder Lava mit einer Luftzelle daneben oder darunter (in der untersten Lage zählt nur „daneben“).
- Ändert sich eine verknüpfte Datei im Projektordner fehlerhaft, zeigt der Tab weiter die letzte fehlerfreie Fassung samt Fehlerliste.

## Version 1

Dateien mit `tess 1` übersetzt Tessera mit dem Compiler aus 0.3.0, blockgenau wie damals. Version 1 kennt:

- `tess`, `projekt`, `samen`, `rolle` (Glieder `treppe`, `stufe`, `mauer`, `zaun`), `linie`, `block`, `leer`, `zinnen`
- `box` mit `hohl`, `boden`, `decke`, `sockel`, `kranz`, `ecken`, `fachwerk`, `raster`; `zylinder` mit `r`, `h` und denselben Angaben außer `ecken` und Fachwerk
- `fenster` und `tür` mit den Angaben oben (am zylinder immer mittig)
- `dach sattel|walm` auf der box und `dach kegel` auf dem zylinder, mit `ueberstand`, `steil`, `rolle`, `first`, `giebel`, `kante`, `spitze`

Koordinaten gehen bis ±2000, Ausdrücke und Fortsetzungszeilen gibt es nicht. Befehle aus Version 2 sind in Version 1 ein Fehler mit dem Hinweis auf `tess 2`.

Mit `tess 2` in der ersten Zeile gilt eine Datei aus Version 1 weiter: Formen, Bauteile, Sattel- und Walmdächer ergeben dieselben Blöcke. Kegeldächer folgen dann der Dachmaschine und sehen im Detail anders aus (Treppenrichtungen in den Ecken, Dachboden innen).

## Entscheidungen und Erweiterungen (Etappe 4a)

Wo die Spezifikation eine Lücke lässt, hat Tessera so entschieden; Erweiterungen verändern keine bestehende Datei. Die Abweichungen „Dichte Dächer“ (5.2) und „Verschneidung“ (5.3) hat Adrian nach 4a bestätigt. Vorschlag 1A und Eintrag 2 aus [future-fixes.md](future-fixes.md) sind seit 0.4.3 umgesetzt (unten), Vorschlag 1B und die Einträge 3 und 4 bleiben offen.

- **Erweiterungen:** `ringbalken=ja` beim Fachwerk; `x=`/`z=` bei Fenster und Tür an allen Formen; der Kranzdach-Hinweis gilt auch direkt vor Fenstern und Türen; Feld `r` auch bei der kugel.
- **Dichte Dächer:** Eine Dachboden-Zelle hinter einer offenen Treppenseite wird ein voller Block. Sonst bleiben an schrägen Kanten (Vieleck, Kreis, Kehlen), wo sich Treppen nur über Eck berühren, Lücken, durch die man ins Dach sieht.
- **Verschneidung:** Dächer bilden eine Gruppe, sobald sich ihre Grundflächen überlappen oder berühren, auch ohne gemeinsame Lage. Giebel entfallen auch, wenn ein anderes Dach die Zelle vor dem Giebel in derselben Lage bedeckt. Geräumte Zellen bleiben geräumt. Der Krüppelwalm walmt nur an freien Giebelseiten (geprüft in der ersten Walmlage).
- **Abschluss:** Eine letzte Lage, die breiter als zwei Zellen ist (Walm, Kegel, Helm), wird wie eine weitere Stufe gerechnet: Treppen um die verbleibende Mitte, eine einzelne Zelle ist die Spitze.
- **Biegung:** u = y / oberste Lage, damit die Spitze genau um n wandert; Nebenrichtungen verschieben je Achse um n/√2, gerundet ,5 weg von null.
- **Konsolen:** Ringe ab j=2 blicken zum Ring davor.
- **Fachwerk:** Streben sind Stämme mit Achse y. Die Spezifikation verlangt Streben „von unten außen nach oben innen“, deren Richtung von Feld zu Feld wechselt; Tessera wechselt ab dem West- bzw. Nordende, bei gerader Feldzahl stimmt das an beiden Enden. `raute` braucht Felder ab 3 × 3.
- **Muster:** `flecken` gleicht die Verteilung aus, damit die Gewichte stimmen (dreilinear gemittelte Zufallswerte häufen sich sonst in der Mitte); `lagen` zählt die Bänder ab y=0.
- **Kranzdach:** Standardprofil `1/1`, `kante` Standard nein.

## Entscheidungen und Erweiterungen (Etappe 4b)

Von Adrian bestätigt:

- **Schweben (11):** Blöcke hängen auch über Kanten zusammen (18er-Nachbarschaft), nicht nur über Seiten. Treppendächer, verjüngte Wände und Geländer berühren sich oft nur an Kanten; das Spiel hält sie trotzdem.
- **Feld (8):** Wasser liegt nie in der Randreihe; „alle 9“ legt bei B=14 die zweite Reihe sonst an den Rand.
- **`erlaube schweben`** gibt es schon mit 4b (Spezifikation 11 und 13; der Auftrag nannte 4c).

Widersprüche der Spezifikation, so gelöst:

- **Balkonkonsolen (6.5):** „wie 4.3“ und „Reihe j in Lage y−1−j“ widersprechen sich; umgesetzt wie 4.3, an der Wand am tiefsten.
- **Banner (7):** Der Satz „steht im Hinweis zur Datei“ ergibt keine Meldung, damit Zielbauten mit Bannern ohne Hinweise bleiben.
- **Tür `art=spitzbogen` (6.3):** Türen sind höchstens zwei breit, ein Spitzbogen braucht eine ungerade Breite; mit b=2 ist er gleich `bogen`.
- **Wendeltreppe `breite` > 1 (6.6):** „Jede Zelle des Wegs steigt eine Lage“ und „breite legt Ringe nach innen an“ gehen nicht zusammen, weil innere Ringe weniger Zellen haben und dann zwei Lagen springen. Darum gibt der innerste Ring den Takt vor; äußere Ringe bekommen Absätze (untere Stufen). Mit `breite=1` bleibt alles wie spezifiziert.

Lücken der Spezifikation, so entschieden:

- **Bauteile (6.1):** `anzahl=` ohne Seite verteilt an runden Formen rundum, `winkel=` ist der Anfang.
- **Gesims (6.4):** `seiten=` gilt an runden Formen nach Winkel, ±45° um die Seite, Schrägen ±22,5°.
- **Umgang (6.5):** Stützen an den Ecken der Form, dazwischen gleichmäßig höchstens `abstand` auseinander (runde Formen ab Norden); sie reichen bis unter den nächsten Block (höchstens 6 Lagen), mit `dach=` bis ans Dach, sonst 3 Lagen. Unter den Stützen Streben statt Konsolen.
- **Erker (6.5):** Das Dach wird auf der hinter die Wand gespiegelten Form gerechnet und nur davor gebaut; neu ist `dach=nein`. Ein halbrunder Erker hat wie ein zylinder keine Ecken, Fenster dürfen also über die Stufen seiner Front reichen.
- **Bogen (6.6):** Steile Spalten reichen bis unter die nächste, damit der Bogen geschlossen bleibt.
- **Feld (8):** `zaun=` und `weg=` nehmen auch Block-IDs.
- **Halt (11):** In der untersten Lage des Projekts gelten „darunter“, Boden und Schwerkraft als erfüllt (das Gelände gehört nicht zum Bauplan).
- **Erweiterung:** `wandlaterne` ohne `arm=` stellt die Laterne auf einen Block aus `rahmen`.

Bekannte Lücken und Schwächen stehen in [future-fixes.md](future-fixes.md) (ab Eintrag 5).

## Entscheidungen und Erweiterungen (Etappe 4c)

Widersprüche und Lücken der Spezifikation, so gelöst:

- **Reihenfolge bei `baue`:** Mit `drehung=` und `spiegel=` wird zuerst gespiegelt, dann gedreht (die Spezifikation legt die Reihenfolge nicht fest).
- **Module** stehen auf oberster Ebene und sind ab Dateianfang bekannt (`baue` darf vor `modul` stehen). Werte der Datei sind im Modul lesbar; `wert` im Modul legt einen eigenen Wert an, außer der Name gibt es im Modul schon.
- **Wort-Angaben** ersetzen ein ganzes Token, den Wert einer Angabe oder die Rolle vor einem Glied, nicht Teile von Wörtern.
- **Gültigkeit:** Ein Modul sieht die Datei, nicht das Modul, das es baut (wie es geschrieben ist, nicht wo es gebaut wird). Standardwerte der Angaben rechnet Tessera in der Datei aus, übergebene Werte dort, wo `baue` steht.
- **Felder im Modul** sind lokal (die Spezifikation sagt nur „relativ zum Punkt von baue“ für Koordinaten); so ergibt ein Feld in eine Koordinate geschrieben wieder die Stelle der Form.
- **Zustände im gedrehten Modul:** Was Tessera ergänzen würde, dreht mit, wenn es sich dadurch ändert (eine Treppe ohne `facing` blickt nach Norden und dreht deshalb); andere Ergänzungen (Alter von Früchten) bleiben dem Befehl überlassen.
- **Aufruftiefe 16:** 16 verschachtelte Instanzen werden gebaut, die 17. ist ein Fehler.
- **Höhen im Modul:** `y=`, `von=` und `bis=` sind absolute Höhen und verschieben sich mit dem Punkt von `baue`; `ebene=` bleibt relativ zur Form.
- **`ausrichtung`** steht nicht in Modulen, Schleifen oder `spiegle` (sie gilt für die ganze Datei). Koordinaten in Meldungen bleiben Dateikoordinaten.
- **ASCII-Zeilen:** Ein Leerzeichen direkt nach `|` gehört zur Zeichnung (wie die Spezifikation es sagt); im Beispiel der Spezifikation beginnt die Fassade deshalb eine Spalte rechts von `x=`.
- **`zeichen`** nimmt auch `#`, `"` und Klammern (die Spezifikation erlaubt jedes sichtbare Zeichen außer `|`).
- **`abschnitt` im Modul** gilt bis zum Ende des Moduls; danach gilt wieder der Abschnitt des Aufrufs.
- **Grenze von 8 Millionen Blöcken:** Ein Dach zählt die Zellen, die seine Gruppe neu füllt, nicht das Neuzeichnen.
- **Versionen:** Entstehen zwei in derselben Sekunde, bekommt die zweite `_2` (die dritte `_3` …), damit keine verloren geht.
- **Bearbeiten** gibt es nur für `tess 2` (Version 1 kennt `ausrichtung` nicht). Der Palettentausch gilt für Sorten, nicht für Glieder (`treppe=…`).
- **„Überdeckt“** gilt nicht für Zeilen im Bereich „Änderungen in Tessera“: Wer dort einen Block entfernt oder ersetzt, will das.
- **Gedrehte Instanzen** entsprechen einem von Hand gedreht geschriebenen Plan (Formen, Dächer und Prüfungen rechnen im fertigen Bau). Wo Tessera bei Gleichstand rundet (Mitte einer geraden Seite bei ungerader Restbreite, Treppenrichtung bei Gleichstand, gerader Durchmesser), kann ein Block eine Zelle neben dem genauen Spiegelbild liegen.
- **Projektordner ohne Zugriff:** Ist ein Tab mit einer Datei verbunden und der Zugriff fehlt, fragt Tessera beim Bearbeiten nach dem Zugriff; ohne ihn schreibt es nichts (Tab und Datei laufen sonst auseinander).
- **Versionen beim Neustart:** Hat sich eine verbundene Datei geändert, während Tessera zu war, sichert Tessera die zuletzt gezeigte Fassung, bevor es die neue übernimmt.

## Änderungen der Spezifikation (0.4.3)

Von Adrian freigegeben, aus [future-fixes.md](future-fixes.md):

- **Treppen an Ecken (Nr. 1A; 4.3, 5.2, 5.5):** Grenzt eine Treppe an zwei Seiten über Eck an ihr Ziel (Innenecke, auch Kehle), blickt sie in x-Richtung, grenzt sie nur schräg an (Außenecke), in z-Richtung. Das gilt für alle Treppen der Dachmaschine (Stufenkante, letzte Lage, Bauch, Traufe), im Kranzdach und für die Konsolen unter Vorkragungen. Konsolen an Außenecken blicken damit in z- statt x-Richtung; an Ecken einer box bleibt die Form gleich, nur die Zustände ändern sich.
- **Vieleck (Nr. 2; 4.3, 5.2):** Versatz im Wandprofil und `ueberstand` rücken jede gerade Seite, `ueberstand=1` ist an jeder Seite ein Block. Die Dachlagen schrumpfen weiter über den Radius des Umkreises.

Lücken, so entschieden:

- **Gegenüberliegende Seiten:** Grenzt eine Treppe nur an zwei gegenüberliegende Seiten (Lücke zwischen zwei Lagenteilen), gilt Osten vor Westen und Norden vor Süden.
- **Andere Treppenringe** (Gesims, Umgang, Zinnen, Wendeltreppe außen, Konsolen der Ecktürmchen) folgen weiter der Regel aus Etappe 4: bei mehreren Seiten die Reihenfolge n, o, s, w, bei nur schräger Nachbarschaft das Gesims in z-, die übrigen in x-Richtung.
- **kuppel auf dem vieleck:** R ist der Radius des Umkreises von F (ohne die halbe Zelle), gerundet.
