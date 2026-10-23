# Bau-Sprache (`.tess`), Version 1

Referenz für das Schreiben von Bauplänen. Eine `.tess`-Datei beschreibt, *wie* ein Gebäude aufgebaut ist; Tessera übersetzt sie in Blöcke. Stand: Testlauf (Etappe 3). Module, Wiederholungen, Spiegeln, ASCII-Ebenen, Farmen und weitere Bauteile kommen in Etappe 4.

Beispiel: [`beispiele/haus-mit-rundturm.tess`](../beispiele/haus-mit-rundturm.tess).

## Grundregeln

- Eine Anweisung pro Zeile, `#` beginnt einen Kommentar.
- Die erste Anweisung ist `tess 1`.
- Koordinaten sind ganze Zahlen `x,y,z` ohne Leerzeichen: **x nach Osten, y nach oben, z nach Süden** (wie in Minecraft). Erlaubt sind −2000 bis 2000. Die Größe des Projekts ergibt sich aus dem Inhalt.
- Angaben `name=wert` dürfen in beliebiger Reihenfolge hinter den festen Teilen stehen. Umlaute und ihre Umschreibung sind gleich: `tür` = `tuer`, `überstand` = `ueberstand`.
- Anweisungen laufen von oben nach unten; spätere überschreiben frühere Blöcke (ein Fenster schneidet in seine Wand).
- Jede Datei ist in sich abgeschlossen: Rollen, Namen und Startwert gelten nur in ihr.
- Seiten: `n` (Norden, −z), `o` (Osten, +x), `s` (Süden, +z), `w` (Westen, −x).

## Kopf

| Anweisung | Bedeutung |
| --- | --- |
| `tess 1` | Version der Sprache, Pflicht in der ersten Zeile |
| `projekt "Name"` | Titel des Bauplans |
| `samen 7` | Startwert für gemischte Rollen; gleicher Startwert, gleiches Ergebnis (Standard 1) |

## Rollen

```
rolle <name> <block>[:gewicht] … [treppe=<id>] [stufe=<id>] [mauer=<id>] [zaun=<id>]
```

- Eine Rolle steht für einen Zweck (Wand, Dach, Rahmen …), nicht für einen Block. Alle Formen und Bauteile nehmen Rollen, nie Block-IDs direkt; nur `block` und `spitze=` nehmen Block-IDs.
- Blöcke ohne Namensraum gelten als `minecraft:`. Mod-Blöcke mit Namensraum, z. B. `create:cut_granite`.
- Mehrere Blöcke mischen nach Gewicht: `rolle mauer stone_bricks:6 mossy_stone_bricks:2 cracked_stone_bricks:2`. Die Wahl hängt nur von Position und `samen` ab.
- Treppen, Stufen, Mauern und Zäune einer Rolle leitet Tessera aus dem Grundblock ab (`stone_bricks` → `stone_brick_stairs`, `spruce_planks` → `spruce_stairs`). Mit eingelesenem Katalog kommen sie aus dessen Blockfamilien und gelten nur, wenn es sie gibt. Hat eine Sorte einer Mischung keine Treppe (`cracked_stone_bricks`), nehmen Treppen nur die übrigen Sorten. Fehlt sie ganz, meldet Tessera einen Fehler; dann `treppe=…` angeben.
- Blöcke in Rollen stehen ohne Zustände; Ausrichtung, Hälfte, Verbindungen und Achse von Stämmen rechnet Tessera.
- Feste Rollennamen, die Bauteile ohne Angabe nehmen: `glas` und `rahmen` (Fenster), `tuer` (Tür, muss eine Tür sein, z. B. `spruce_door`), `dach` (Dächer).

## Formen

Formen mit Namen kann man später für Bauteile verwenden. Der Name steht direkt hinter dem Befehl.

```
box [name] x,y,z x,y,z <rolle> [hohl] [boden=R] [decke=R] [sockel=R] [kranz=R] [ecken=R] [fachwerk=R] [raster=4]
```

- Quader zwischen zwei Ecken (beide eingeschlossen).
- `hohl`: nur die vier Wände, innen wird geräumt (auch was vorher dort stand). Mindestens 3 × 3 Grundfläche.
- `boden` / `decke`: unterste / oberste Lage innen. `sockel`: unterste Lage der Wände. `kranz`: oberste Lage der Wände. `ecken`: die vier Eckpfeiler.
- `fachwerk=R`: Pfosten an den Ecken und alle `raster` Blöcke (gezählt ab der West- bzw. Nordecke), dazu waagrechte Balken unten (über dem Sockel) und oben. Die übrigen Felder füllt die Rolle der box. Fenster gehören in die Felder zwischen den Pfosten.

```
zylinder [name] x,y,z r=<radius> h=<höhe> <rolle> [hohl] [boden=R] [decke=R] [sockel=R] [kranz=R]
```

- `x,y,z` ist die Mitte unten. Durchmesser = 2·r + 1. `hohl` wie bei box.

| Anweisung | Bedeutung |
| --- | --- |
| `linie x,y,z x,y,z <rolle>` | gerade Linie, z. B. Balken; Stämme liegen in Linienrichtung |
| `block x,y,z <rolle oder block[zustände]>` | ein einzelner Block, z. B. `block 6,0,8 spruce_stairs[facing=north]` |
| `leer x,y,z [x,y,z]` | macht Luft (ein Block oder ein Quader) |

## Bauteile

Bauteile hängen an einer benannten box oder einem zylinder und rechnen Lage und Ausrichtung selbst: Fensterbänke zeigen zur Wand, Läden liegen außen flach an, Türen öffnen richtig.

```
fenster <form> <seite> y=<höhe> [x=|z=] [b=1] [h=2] [anzahl=1] [abstand=b+2] [glas=R] [rahmen=R] [bank=R|nein] [sturz=R|nein] [laeden=R]
```

- `y` ist die absolute Höhe der untersten Glasreihe, `h` die Höhe, `b` die Breite.
- Position entlang der Wand: auf Nord- und Südseite mit `x=`, auf Ost- und Westseite mit `z=` (absolute Koordinate des linken bzw. kleinsten Glasblocks). Ohne Angabe sitzt das Fenster (oder die Gruppe) in der Mitte der Wand. Am zylinder immer mittig auf der Seite.
- `anzahl` und `abstand`: mehrere gleiche Fenster, `abstand` von Fensteranfang zu Fensteranfang.
- Bank: umgedrehte Treppe außen unter dem Fenster. Sturz: eine Reihe über dem Fenster, je einen Block breiter. Beide aus `rahmen`, abschaltbar mit `nein`. Läden: offene Falltüren (`laeden=` mit einer Falltür-Rolle) links und rechts außen.
- Fenster im Giebel (über der box) sind erlaubt.

```
tür <form> <seite> [x=|z=] [y=boden+1] [b=1|2] [tuer=R] [rahmen=R|nein]
```

- Zwei Blöcke hoch, `b=2` ergibt eine Doppeltür mit Angeln außen. Rahmen links, rechts und oben aus `rahmen`. Die unterste Reihe darf den Schwellbalken des Fachwerks schneiden.

```
dach sattel <box> [first=x|z] [ueberstand=1] [steil=1] [rolle=dach] [giebel=R] [kante=ja|nein]
dach walm   <box> [ueberstand=1] [steil=1] [rolle=dach]
dach kegel  <zylinder> [ueberstand=1] [steil=2] [rolle=dach] [spitze=<block>]
```

- Das Dach beginnt eine Lage über der Form. `first`: Richtung des Firsts, ohne Angabe entlang der längeren Seite. Bei ungerader Breite trägt der First Stufen.
- `steil`: Lagen pro Stufe (1 = 45°). Bei steil > 1 stehen unter jeder Treppe volle Blöcke.
- Satteldach: Die Giebel füllt `giebel` (sonst die Rolle der box). `kante` setzt umgedrehte Treppen unter den Dachrand an den Giebelseiten (Standard bei Überstand und steil=1).
- Walm- und Kegeldach: Die Ecken formt Tessera als Treppen-Außenecken. `spitze`: Block auf der Kegelspitze, z. B. `spruce_fence` oder `lightning_rod`.

```
zinnen <form> [rolle]
```

- Zinnen eine Lage über der Form, abwechselnd Block und Lücke, Ecken immer mit Block. Ohne Rolle die der Form.

## Verbundene Blöcke

Zäune, Mauern, Glasscheiben, Eisengitter und Treppen-Ecken bekommen nach dem Aufbau ihren Zustand nach den Regeln des Spiels (Verbindungen, Mauerpfosten, niedrige oder hohe Mauerseiten, innere und äußere Treppenecken). Alle Blöcke bekommen ihre vollständigen Zustände (`waterlogged=false`, geschlossene Türen …). Mod-Blöcke mit eigenen Verbindungsregeln sind nur abgedeckt, wenn sie den Vanilla-Namen folgen (`…_fence`, `…_wall`, `…_pane`, `…_stairs`).

## Meldungen

- **Fehler** nennen die Zeile und verhindern das Öffnen. Tessera meldet alle Fehler auf einmal; Folgefehler (eine Form, deren eigene Zeile fehlerhaft ist) erscheinen nicht noch einmal.
- **Hinweise** öffnen trotzdem und stehen in den Projektdaten: Fenster oder Tür nicht in der Wand, in einer Ecke, in einem Pfosten oder Balken, Überschneidung mit einem anderen Fenster, Bank oder Laden stößt an einen Block, Block fehlt im Katalog.
- Ändert sich eine verknüpfte Datei im Projektordner fehlerhaft, zeigt der Tab weiter die letzte fehlerfreie Fassung samt Fehlerliste.
