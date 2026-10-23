# Tessera

Lokale Bauhilfe für Minecraft Java 1.21.1: Schematics in 3D ansehen und Ebene für Ebene nachbauen, wie in einem Slicer. Tessera läuft komplett im Browser, ohne Server. Keine Datei verlässt deinen PC.

**Stand:** Etappe 1 von 6 – Viewer (Version 0.1.0)

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

## Was Etappe 1 kann

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

**Unbekannte Blöcke**

- Blöcke, die Tessera nicht kennt (z. B. aus Mods), bekommen eine Ersatzfarbe aus ihrer Block-ID. Im Modell sind sie rot schraffiert, in der Materialliste mit „?“ markiert. Der Knopf „Unbekannte“ blendet die Schraffur ein und aus.

**Leistung, Debug-Paket, Speicherung**

- Unten links stehen Bildrate, Blöcke, Dreiecke und Meshing-Zeit. Der Knopf „Leistungstest“ dreht das Modell fünf Sekunden lang einmal ganz herum und misst dabei die Bildrate.
- „Debug-Paket“ oben rechts speichert eine ZIP-Datei, die du Claude direkt geben kannst: Protokoll mit Fehlern und Warnungen samt Zeitstempel, Tessera-Version, Browser, Grafik, Leistungswerte, unbekannte Blöcke und auf Wunsch die Projektdateien. Das Protokoll läuft ab dem Start mit.
- Offene Tabs bleiben nach dem Schließen des Browsers erhalten. Tessera speichert sie im Browser (IndexedDB) und fordert dafür dauerhaften Speicher an. Einen geschlossenen Tab kannst du 10 Sekunden lang wiederherstellen.

**Handy und Tablet**

- Auf schmalen Bildschirmen wird die Seitenleiste zu einem Blatt am unteren Rand. Zugeklappt zeigt es nur, was du beim Bauen brauchst: aktuelle Ebene, Abhaken und Ansicht. Aufgeklappt zeigt es Materialliste und Projektdaten. Im Querformat sitzt es rechts.
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

Ab Etappe 3 speichert Tessera Projekte als `.tess`-Dateien in einem Ordner auf der Festplatte. Dafür braucht es die File System Access API, die in Brave abgeschaltet sein kann. Für Etappe 1 wird sie noch nicht gebraucht.

So prüfst du es: In Tessera oben rechts „Debug-Paket“ öffnen und die Zeile „Ordner-Zugriff“ lesen. Steht dort „abgeschaltet“, öffne `brave://flags`, suche nach „File System Access API“, stelle den Eintrag auf „Enabled“ und starte Brave neu.

## Datenschutz

Tessera lädt nichts aus dem Internet nach und sendet nichts. Schriften und Bibliotheken sind eingebaut. Geöffnete Dateien werden nur im Browser verarbeitet und im Browser-Speicher abgelegt. Wenn du die Website-Daten für `localhost` löschst, sind die gespeicherten Tabs weg; die Schematic-Dateien selbst bleiben, wo sie waren.

## Entwicklung

| Befehl | Zweck |
| --- | --- |
| `npm test` | Tests (Vitest) |
| `npm run typecheck` | TypeScript prüfen |
| `npm run build` | prüfen und bauen, Ergebnis in `dist/` |
| `npm run build:artifact -- --out <ordner>` | Version zum Veröffentlichen als Claude-Artefakt, z. B. als Testversion fürs Handy |

Die Tests erzeugen ihre Testdateien selbst. Eigene Schematics zum Ausprobieren gehören in den Ordner `samples/`; er wird nicht eingecheckt. Der Test gegen die Beispieldatei aus Etappe 1 (`a05cccd2-32011.schem`) läuft nur, wenn du ihren Pfad angibst:

```sh
TESSERA_SAMPLE_SCHEM=samples/a05cccd2-32011.schem npm test
```

In der Windows-PowerShell:

```powershell
$env:TESSERA_SAMPLE_SCHEM = "samples\a05cccd2-32011.schem"; npm test
```

**Aufbau**

```text
src/
  core/        NBT lesen und schreiben, Formate (.schem, .litematic, .nbt), Versionen, Umbenennungen
  blocks/      Blockwissen: Farben, Formen, Namen, Items
  render/      Chunk-Meshing, Shader, Raycast, Outlines, Kamera
  workers/     Web Worker für Einlesen und Meshing
  materials/   Materialliste
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

## Grenzen von Etappe 1

- Die Farben sind Näherungen aus einer eingebauten Tabelle. Echte Texturfarben kommen mit dem Block-Katalog in Etappe 2.
- Die Blocknamen sind vorerst englisch, aus der Block-ID abgeleitet. Deutsche Namen aus den Sprachdateien kommen ebenfalls mit Etappe 2.
- Mod-Blöcke (Create, Chipped, Macaw's …) gelten als unbekannt, bis der Katalog sie kennt.
- Alte `.schematic`-Dateien (vor 1.13) liest Tessera noch nicht.
- Kisteninhalte, Schildertexte und Objekte wie Rüstungsständer oder Rahmen werden nicht angezeigt.
- Verbundene Blöcke (Zäune, Mauern, Scheiben) erscheinen so, wie sie in der Datei gespeichert sind.
