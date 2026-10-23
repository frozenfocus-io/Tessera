# Tessera

Lokale Bauhilfe für Minecraft Java 1.21.1: Schematics in 3D ansehen und Ebene für Ebene nachbauen, wie in einem Slicer. Tessera läuft komplett im Browser, ohne Server. Keine Datei verlässt deinen PC.

**Stand:** Etappe 2 von 6 – Block-Katalog (Version 0.2.0)

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.19 (die aktuelle LTS-Version passt).

```sh
git clone https://github.com/frozenfocus-io/Tessera.git
cd Tessera
npm install
npm run dev
```

Danach im Browser <http://localhost:5173> öffnen.

Die fertig gebaute Version lädt schneller und entspricht dem späteren Stand:

```sh
npm run build
npm run preview
```

Sie läuft unter <http://localhost:4173>. Gespeicherte Tabs hängen an der Adresse: Unter Port 5173 und Port 4173 hat Tessera jeweils einen eigenen Speicher.

## Was Tessera kann

**Öffnen**

- `.schem` (WorldEdit/Sponge, ab 1.13) in allen drei Format-Versionen, auch Dateien von Bau-Websites. Tessera erkennt das Format am Inhalt, nicht an der Dateiendung.
- Schon jetzt zusätzlich: `.litematic` (Litematica, auch mit mehreren Bereichen) und `.nbt` (Strukturblock, Create-Schematics).
- Öffnen über den Knopf „Öffnen“, mit Strg + O oder indem du Dateien ins Fenster ziehst; mehrere Dateien auf einmal gehen auch.
- Jede Datei bekommt einen eigenen Tab mit eigenem Zustand: Kamera, Ebene, Markierung, Materialliste, abgehakte Ebenen. Ein Import überschreibt nie einen bestehenden Tab. Die Größe ergibt sich aus dem Inhalt, leere Ränder der Datei werden abgeschnitten.
- Dateien aus älteren Minecraft-Versionen werden übersetzt (z. B. `grass` → `short_grass`, `grass_path` → `dirt_path`). Dateien aus Versionen nach 1.21.1 bekommen einen Hinweis.

**3D-Ansicht**

- Grundformen statt nur Würfel: Treppen samt Ecken, Stufen, Zäune, Zauntore, Mauern, Glasscheiben und Gitter, Türen, Falltüren, Knöpfe, Schilder, Teppiche, Laternen, Fackeln, Pflanzen und mehr. Treppen, Stufen, Zäune und Mauern erkennt Tessera auch bei Mod-Blöcken am Namen.
- Meshing in Chunks mit Greedy Meshing in Web Workers: Auch Modelle mit über einer Million Blöcken bleiben bedienbar.
- Übersicht und Draufsicht (T). Die Draufsicht zeigt das Modell ohne Perspektive als Bauplan mit Blockraster.
- Screenshot per Knopfdruck als PNG.

**Ebenen**

- Drei Ansichten: *Gesamt*, *Schnitt* (aktuelle Ebene in Farbe, darunter grau, darüber ausgeblendet) und *Einzeln* (nur die aktuelle Ebene).
- Ebene wechseln mit den Pfeiltasten, mit dem Mausrad über dem Ebenen-Regler oder per Klick in den Regler. Der Regler zeigt als Profil, wie viele Blöcke jede Ebene hat.
- Die Schnittfläche bleibt geschlossen, sodass die aktuelle Ebene von oben wie ein Grundriss aussieht.

**Hover und Markieren**

- Zum Block unter der Maus zeigt Tessera Name, Block-ID, Zustände (z. B. „Richtung: Nord“, „Hälfte: unten“) und die Position im Modell.
- Alle Blöcke derselben Sorte bekommen ein Wireframe-Outline. Ein Klick auf einen Block oder auf eine Zeile der Materialliste hält die Markierung fest; Esc löst sie.

**Materialliste und Baufortschritt**

- Pro Block: Anzahl, Stacks und Shulker-Kisten. Stackgrößen 64, 16 und 1 werden berücksichtigt, Doppelstufen zählen doppelt, Türen und Betten einfach. Wasser und Lava stehen als Quellblöcke in der Liste, aber nicht in der Summe.
- Umfang wählbar: *Gesamt*, aktuelle *Ebene*, *Ab hier* (ab der aktuellen Ebene aufwärts) oder *Offen* (alle noch nicht abgehakten Ebenen).
- Ebenen als fertig abhaken (Leertaste), mit Fortschritt nach Ebenen und Blöcken.
- Die Liste lässt sich als Text kopieren.

**Block-Katalog: Modpack einlesen**

- Oben rechts „Modpack einlesen“: Du wählst den Minecraft-Ordner und den `mods`-Ordner deines Modpacks. Tessera liest daraus Blockzustände, Modelle, Texturen, Sprachdateien, Tags, Rezepte und Loot-Tabellen. Es liest nur Daten, Code aus den Jars wird nie ausgeführt.
- Danach haben alle Blöcke, auch die aus Mods, ihre echten Farben (pro Seite, Gras und Laub eingefärbt wie im Spiel), ihre Form aus dem Blockmodell, ihren deutschen Namen und die Zuordnung zu Mod und Familie (Treppe, Stufe und Mauer gehören zu ihrem Grundblock). Glas und andere durchscheinende Blöcke erkennt Tessera an der Textur.
- Wo die Dateien liegen:

  | Launcher | Minecraft-Ordner | Mods-Ordner |
  | --- | --- | --- |
  | CurseForge | `curseforge\minecraft\Install` | `curseforge\minecraft\Instances\<Modpack>\mods` |
  | Minecraft-Launcher | `%appdata%\.minecraft` | `%appdata%\.minecraft\mods` oder der Ordner des Profils |

  Im Minecraft-Ordner sucht Tessera `versions/1.21.1/1.21.1.jar`, NeoForge (`libraries/net/neoforged/…/neoforge-…-universal.jar`, liefert die gemeinsamen Tags wie `c:ingots/iron`) und die deutschen Namen aus `assets`. Ohne Ordner-Auswahl, etwa am Handy, gehen auch einzelne Dateien.
- Einlesen dauert je nach Modpack Sekunden bis etwa eine Minute und läuft im Hintergrund. Der Katalog bleibt im Browser gespeichert, bis du ihn entfernst oder neu einliest; offene Tabs werden mit ihm neu aufgebaut. Nötig ist das nur, wenn sich das Modpack ändert.

**Rohstoffe**

- Neben der Materialliste gibt es den Reiter „Rohstoffe“: Tessera rechnet über die Rezepte zurück, was abgebaut oder gesammelt werden muss, etwa Steinziegeltreppe → Stein → Bruchstein. Der Umfang (*Gesamt*, *Ebene*, *Ab hier*, *Offen*) gilt wie bei der Materialliste.
- Gleiche Zwischenprodukte werden zusammen hergestellt und angefangene Rezepte aufgerundet, so wie man am Werktisch tatsächlich baut. Unter „Herstellung“ steht jeder Schritt mit Station und Anzahl.
- Für jeden Block nimmt Tessera den günstigsten Weg: wenig Rohstoffe, wenige Schritte, Vanilla-Stationen vor Mod-Maschinen, Erze nur, wenn es nicht anders geht. Pro Block lässt sich ein anderes Rezept wählen oder festlegen, dass du ihn direkt besorgst (z. B. Stein mit Behutsamkeit). Die Wahl wird pro Projekt gespeichert.
- Wolle, Kohle, Diamanten, Redstone und ähnliches gelten als gesammelt, nicht als hergestellt. Blöcke, die es im Survival nicht gibt, wählt Tessera nie als Zutat.

**Unbekannte Blöcke**

- Blöcke, die weder der Katalog noch die eingebaute Tabelle kennt, bekommen eine Ersatzfarbe aus ihrer Block-ID. Im Modell sind sie rot schraffiert, in der Materialliste mit „?“ markiert. Der Knopf „Unbekannte“ blendet die Schraffur ein und aus. Meist fehlt dann ein Mod im eingelesenen Modpack.

**Leistung, Debug-Paket, Speicherung**

- Unten links stehen Bildrate, Blöcke, Dreiecke und Meshing-Zeit. Der Knopf „Leistungstest“ dreht das Modell fünf Sekunden lang einmal ganz herum und misst dabei die Bildrate.
- „Debug-Paket“ oben rechts speichert eine ZIP-Datei, die du Claude direkt geben kannst: Protokoll mit Fehlern und Warnungen samt Zeitstempel, Tessera-Version, Browser, Grafik, Leistungswerte, unbekannte Blöcke und auf Wunsch die Projektdateien. Das Protokoll läuft ab dem Start mit.
- Offene Tabs bleiben nach dem Schließen des Browsers erhalten. Tessera speichert sie im Browser (IndexedDB) und fordert dafür dauerhaften Speicher an. Einen geschlossenen Tab kannst du 10 Sekunden lang wiederherstellen.

**Handy und Tablet**

- Auf schmalen Bildschirmen wird die Seitenleiste zu einem Blatt am unteren Rand. Zugeklappt zeigt es nur, was du beim Bauen brauchst: aktuelle Ebene, Abhaken und Ansicht. Aufgeklappt zeigt es Materialliste, Rohstoffe und Projektdaten. Im Querformat sitzt es rechts.
- Bedienung mit den Fingern: mit einem Finger drehen, mit zwei Fingern verschieben und zoomen, auf einen Block tippen statt mit der Maus darüberfahren, ins Leere tippen hebt die Auswahl auf.

## Bedienung

| Eingabe | Wirkung |
| --- | --- |
| Linke Maustaste ziehen | drehen |
| Rechte Maustaste ziehen | verschieben |
| Mausrad | zoomen, zum Mauszeiger hin |
| Klick auf einen Block | alle Blöcke dieser Sorte markieren |
| Pfeil hoch / runter | Ebene wechseln (startet den Schnitt) |
| Bild hoch / runter | 10 Ebenen weiter |
| Pos1 / Ende | unterste / oberste Ebene |
| Leertaste | aktuelle Ebene abhaken |
| S | zwischen Schnitt und Einzel-Ebene umschalten |
| Esc | Gesamtansicht, Markierung lösen |
| F | ganzes Modell zeigen |
| T | Draufsicht als Bauplan |
| Strg + O | Schematic öffnen |
| ? | Bedienung anzeigen |

## Brave: Ordner-Zugriff prüfen

Ab Etappe 3 speichert Tessera Projekte als `.tess`-Dateien in einem Ordner auf der Festplatte. Dafür braucht es die File System Access API, die in Brave abgeschaltet sein kann. Bis dahin wird sie nicht gebraucht; auch das Einlesen des Modpacks kommt ohne sie aus.

So prüfst du es: In Tessera oben rechts „Debug-Paket“ öffnen und die Zeile „Ordner-Zugriff“ lesen. Steht dort „abgeschaltet“, öffne `brave://flags`, suche nach „File System Access API“, stelle den Eintrag auf „Enabled“ und starte Brave neu.

## Datenschutz

Tessera lädt nichts aus dem Internet nach und sendet nichts. Schriften und Bibliotheken sind eingebaut. Geöffnete Dateien und eingelesene Jars werden nur im Browser verarbeitet; im Browser-Speicher landen die Tabs und der fertige Katalog, nicht die Jars selbst. Wenn du die Website-Daten für `localhost` löschst, sind gespeicherte Tabs und Katalog weg; die Schematic-Dateien und dein Modpack bleiben, wo sie waren.

Spieldateien von Mojang und den Mod-Autoren gehören nicht in dieses Repository. Tessera bringt keine mit, sondern liest sie bei dir ein.

## Entwicklung

| Befehl | Zweck |
| --- | --- |
| `npm test` | Tests (Vitest) |
| `npm run typecheck` | TypeScript prüfen |
| `npm run build` | prüfen und bauen, Ergebnis in `dist/` |
| `npm run build:artifact -- --out <ordner>` | Version zum Veröffentlichen als Claude-Artefakt, z. B. als Testversion fürs Handy |

Die Tests erzeugen ihre Testdateien selbst, auch kleine Jars mit Modellen, Texturen und Rezepten. Eigene Schematics zum Ausprobieren gehören in den Ordner `samples/`; er wird nicht eingecheckt. Zwei Tests laufen nur, wenn du Pfade angibst: der gegen die Beispieldatei aus Etappe 1 und der gegen die echte Minecraft-Jar (liest alle Vanilla-Blöcke und prüft Farben und Namen):

```sh
TESSERA_SAMPLE_SCHEM=samples/a05cccd2-32011.schem TESSERA_MC_ROOT=~/.minecraft npm test
```

In der Windows-PowerShell:

```powershell
$env:TESSERA_SAMPLE_SCHEM = "samples\a05cccd2-32011.schem"; $env:TESSERA_MC_ROOT = "$env:APPDATA\.minecraft"; npm test
```

**Aufbau**

```text
src/
  core/        NBT lesen und schreiben, Formate (.schem, .litematic, .nbt), Versionen, Umbenennungen
  blocks/      Blockwissen: Farben, Formen, Namen, Items (eingebaute Tabelle und Anbindung an den Katalog)
  catalog/     Block-Katalog: Jars lesen, PNG dekodieren, Modelle und Blockzustände auflösen, Tags, Rezepte, Familien
  render/      Chunk-Meshing, Shader, Raycast, Outlines, Kamera
  workers/     Web Worker für Einlesen, Katalog und Meshing
  materials/   Materialliste und Rohstoff-Aufschlüsselung
  app/         Projekte, Tabs, Import, Speicherung
  ui/          Oberfläche (Preact)
  debug/       Protokoll, Umgebung, Debug-Paket
  platform/    Speichern von Dateien und Beispieldateien, je nach Umgebung
scripts/       Build-Hilfen (Artefakt-Version)
test/          Tests
```

Technik: TypeScript, Three.js, Preact, Vite, fflate.

## Etappenplan

1. [x] **Viewer:** `.schem` laden, 3D-Ansicht mit Grundformen, Ebenen, Hover mit Wireframe-Highlight, Materialliste, Baufortschritt, Debug-Export
2. [ ] **Block-Katalog:** Minecraft-Jar und `mods`-Ordner einlesen; echte Namen, Farben, Familien, Rezepte; Rohstoff-Aufschlüsselung
3. [ ] **Bau-Sprache, Testlauf:** kleines Haus mit Fenstern, Dach und einem Rundturm
4. [ ] **Bau-Sprache, Ausbau:** alle Bauteile, Module, Rollen-Paletten, Farmen; Bearbeiten mit Undo/Redo und Versionen
5. [ ] **Gelände-Scan:** Welt-Tab, Objekte platzieren, Erdarbeiten, Ingame-Koordinaten
6. [ ] **Export:** `.schem`, `.nbt`, `.litematic` mit korrekt verbundenen Blöcken

Eine Desktop-App mit Tauri ist vorerst nicht geplant.

## Grenzen

- Ohne eingelesenen Katalog sind die Farben Näherungen aus einer eingebauten Tabelle, die Namen englisch und Mod-Blöcke unbekannt.
- Blöcke ohne festes Modell (Kisten, Schilder, Banner, Köpfe) und Mod-Blöcke mit eigenem Modell-Code erscheinen vereinfacht, in der Farbe ihrer Textur.
- Pro Block zeigt Tessera eine Durchschnittsfarbe pro Seite, keine Texturen.
- Rezepte von Mod-Maschinen kennt Tessera nur, wenn sie in einem der bekannten Formate vorliegen (Vanilla-Stationen, Create). Was sich nicht herstellen lässt, steht als Rohstoff in der Liste.
- Alte `.schematic`-Dateien (vor 1.13) liest Tessera noch nicht.
- Kisteninhalte, Schildertexte und Objekte wie Rüstungsständer oder Rahmen werden nicht angezeigt.
- Verbundene Blöcke (Zäune, Mauern, Scheiben) erscheinen so, wie sie in der Datei gespeichert sind.
