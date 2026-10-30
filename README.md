# Tessera

Lokale Bauhilfe für Minecraft Java 1.21.1: Gebäude als Bauplan beschreiben oder Schematics öffnen, in 3D ansehen und Ebene für Ebene nachbauen, wie in einem Slicer. Tessera läuft komplett im Browser, ohne Server. Keine Datei verlässt deinen PC.

**Stand:** Etappe 4c – Werkzeuge (Version 0.4.2); Etappe 4 von 6 ist fertig.

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

**Baupläne (`.tess`)**

- Ein Bauplan beschreibt ein Gebäude in der Bau-Sprache statt Block für Block. Tessera übersetzt ihn in Blöcke und zeigt ihn wie eine Schematic. Die Sprache ist für Claude gemacht; du musst sie nicht lesen, kannst sie aber ändern. Referenz: [docs/bau-sprache.md](docs/bau-sprache.md), Beispiele: [beispiele/zauberturm.tess](beispiele/zauberturm.tess), [beispiele/wachturm.tess](beispiele/wachturm.tess), [beispiele/fachwerkhaus.tess](beispiele/fachwerkhaus.tess) und [beispiele/haus-mit-rundturm.tess](beispiele/haus-mit-rundturm.tess).
- **Formen:** Quader, Zylinder (auch elliptisch und in jeder Breite), regelmäßige Vielecke, freie Umrisse, ASCII-Grundrisse und Kugeln. Wände können sich pro Lage verschieben: vorkragen (mit Konsolen darunter), sich verjüngen oder einen Bauch bekommen. Dazu Sockel, Kranz, Eckpfeiler, Wandzonen nach Höhe und Fachwerk mit Riegeln, Streben, Kreuzen oder Rauten.
- **Dächer:** Sattel-, Pult-, Krüppelwalm-, Walm-, Kegel-, Helm- und Flachdach, mit frei wählbarem Profil (steil, flach, Glocke, Mansarde, Zwiebel, Kuppel), Hexenhut-Biegung, Firstzier, Traufe und Spitze. Dächer, die sich berühren, verschneiden sich zu einem Dach mit Kehlen (L-Häuser, Kreuzgiebel, Turmhelme). Kranzdächer legen eine Schürze rund um einen Turm.
- **Bauteile an Wänden:** Fenster als Rechteck, Rund- und Spitzbogen, Rundfenster, Kreuzfenster und Schießscharte, mit Bank, Sturz, Laibung, Sprossen, Läden und Blumenkästen; Türen mit Oberlicht, Bogen, Stufen und Vordach; Tore mit Fallgitter; Gesims, Lisenen, Strebepfeiler und Kopfbänder; Zinnen mit Maschikuli; Bögen, gerade Treppen und Wendeltreppen innen und außen. Sie sitzen an jeder Seite, unter jedem Winkel und in Reihen rundum.
- **Anbauten:** Balkone mit Pultdach, Umgänge mit Geländer und Stützen, Erker (eckig, halbrund, dreieckig) mit eigenem Dach, Gauben und Ecktürmchen. Sie setzen außen nur in Luft und melden, woran sie stoßen.
- **Zier und Farmen:** Wandlaternen, Hängelaternen, Banner, Efeu, Bewuchs, Laubwolken und gestreute Blöcke; Felder mit Wasser in Reichweite, Zaun, Tor und Weg.
- **Freistil und Module:** Zeichen festlegen und Lagen oder ganze Wandansichten als ASCII zeichnen (Rosetten, vorstehende Rahmen, Reliefs), auch an runden Wänden. Module beschreiben Wiederkehrendes einmal und bauen es an mehreren Stellen, gedreht oder gespiegelt; dazu Schleifen und Spiegelungen. Bauabschnitte teilen große Gebäude auf, `ausrichtung` dreht den ganzen Plan.
- **Rollen-Paletten** („stein“ = 50 % Steinziegel, 20 % bemoost, 20 % rissig) nehmen Treppen, Stufen, Zäune, Falltüren und weitere Glieder mit und mischen auf Wunsch fleckig oder in Bändern. Werte und Rechenausdrücke halten Maße an einer Stelle.
- Bauteile rechnen Lage und Ausrichtung selbst. Tessera prüft beim Übersetzen, ob Fenster und Türen in einer Wand sitzen, keinen Pfosten oder Balken schneiden und sich nicht überschneiden, ob eine Zeile Glas, Türen oder Anbauten einer früheren überdeckt, ob Fackeln, Laternen, Türen und Pflanzen Halt haben, ob Teile ohne Verbindung zum Boden schweben und ob Wasser ausfließt. Solche Hinweise stehen mit Zeilennummer in den Projektdaten; ein Klick darauf markiert die Blöcke der Zeile und dreht die Kamera hin.
- Zu jedem Block zeigt die Hover-Karte die Zeile des Bauplans, die ihn gesetzt hat, z. B. „Zeile 37: dach helm og profil=glocke …“, in Modulen mit der Kette („Zeile 28 (in modul tuermchen, gebaut in Zeile 85)“). So lässt sich „das da ist falsch“ direkt einer Zeile zuordnen.
- Auch große Baupläne übersetzt Tessera schnell: zwei Millionen Blöcke in wenigen Sekunden.
- Zäune, Mauern, Glasscheiben, Gitter und Treppen-Ecken bekommen ihre Verbindungen nach den Regeln des Spiels, alle Blöcke ihre vollständigen Zustände.
- Fehler im Bauplan meldet Tessera mit Zeilennummer, alle auf einmal, z. B. „Zeile 12: Rolle „zier“ ist nicht festgelegt“.
- Mit eingelesenem Katalog nimmt Tessera Treppen und Stufen aus dessen Blockfamilien, auch für Mod-Blöcke, und markiert Blöcke, die im Modpack fehlen.

**Bearbeiten**

- Baupläne in Bau-Sprache 2 lassen sich in Tessera ändern (Bereich „Bearbeiten“ rechts). Jede Änderung landet in der `.tess`-Datei, der Rest der Datei bleibt, wie er war.
- **Rollen:** Eine Sorte einer Rolle per Blocksuche gegen einen anderen Block tauschen, z. B. Steinziegel gegen Andesit; die Gewichte bleiben.
- **Drehen und Spiegeln** des ganzen Plans (schreibt die Zeile `ausrichtung`).
- **Einzelblöcke:** Mit „Einzelblöcke bearbeiten“ öffnet ein Klick auf einen Block ein Menü: Entfernen, Ersetzen oder Zustand ändern (Blickrichtung, Hälfte …). Die Änderung steht am Ende der Datei im Bereich „Änderungen in Tessera“.
- **Rückgängig/Wiederholen** mit Strg + Z und Strg + Y (oder Strg + Umschalt + Z), 100 Schritte pro Tab.
- **Versionen:** Vor jedem Schreiben und vor dem Übernehmen einer Änderung von außen sichert Tessera die bisherige Fassung unter `projekte/.versionen/<name>/`; die 50 neuesten bleiben. Der Dialog „Versionen“ öffnet eine Fassung schreibgeschützt oder stellt sie wieder her.
- Ohne Projektordner geht das alles im Browser-Speicher; „Als Datei speichern“ lädt den Bauplan herunter.

**Projektordner**

- Oben rechts „Projekte“: Du wählst einmal einen Ordner, z. B. `Tessera` in deinen Dokumenten. Tessera legt darin `projekte/` an und speichert Baupläne dort als `.tess`-Dateien. Der Dialog listet die Baupläne im Ordner; ein Klick öffnet sie.
- Einen Bauplan, der woanders liegt (z. B. von Claude heruntergeladen), öffnest du mit „Öffnen“ und legst ihn mit „Im Projektordner speichern“ (Projektdaten rechts) im Ordner ab.
- Ein Tab bleibt mit seiner Datei verbunden: Ersetzt oder änderst du die Datei im Ordner, baut Tessera den Tab innerhalb von zwei Sekunden neu auf; Kamera, Ebene und Fortschritt bleiben. Hat die neue Fassung Fehler, bleibt die letzte fehlerfreie stehen und die Fehler stehen darunter.
- Nach einem Neustart des Browsers fragt dieser einmal nach, ob Tessera den Ordner weiter benutzen darf: „Projekte“ ist dann hervorgehoben, dort „Zugriff erlauben“ klicken. Bis dahin zeigen die Tabs die zuletzt gelesene Fassung.

**Öffnen**

- `.tess` (Tessera-Baupläne), dazu `.schem` (WorldEdit/Sponge, ab 1.13) in allen drei Format-Versionen, auch Dateien von Bau-Websites. Tessera erkennt das Format am Inhalt, nicht an der Dateiendung.
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

- **Bauabschnitte:** Hat ein Bauplan Abschnitte, wählst du rechts „Ganzes Gebäude“ oder einen Abschnitt. Ebenen-Regler, Materialliste, Rohstoffe und Fortschritt gelten dann für den Abschnitt („Nordturm, Ebene 12 von 30“), andere Abschnitte erscheinen grau.
- Drei Ansichten: *Gesamt*, *Schnitt* (aktuelle Ebene in Farbe, darunter grau, darüber ausgeblendet) und *Einzeln* (nur die aktuelle Ebene).
- Ebene wechseln mit den Pfeiltasten, mit dem Mausrad über dem Ebenen-Regler oder per Klick in den Regler. Der Regler zeigt als Profil, wie viele Blöcke jede Ebene hat.
- Die Schnittfläche bleibt geschlossen, sodass die aktuelle Ebene von oben wie ein Grundriss aussieht.

**Hover und Markieren**

- Zum Block unter der Maus zeigt Tessera Name, Block-ID, Zustände (z. B. „Richtung: Nord“, „Hälfte: unten“) und die Position im Modell, bei Bauplänen auch die Zeile, die ihn gesetzt hat.
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
- Für jeden Block nimmt Tessera den günstigsten Weg: wenig Rohstoffe, wenige Schritte, Erze nur, wenn es nicht anders geht. Vanilla-Blöcke entstehen auf dem Vanilla-Weg (Kies wird gegraben, nicht im Mühlstein gemahlen); Mod-Maschinen stehen als Alternativen zur Auswahl. Bei Zutaten aus Tags (beliebige Bretter) nimmt Tessera Vanilla-Holz. Pro Block lässt sich ein anderes Rezept wählen oder festlegen, dass du ihn direkt besorgst (z. B. Stein mit Behutsamkeit). Die Wahl wird pro Projekt gespeichert.
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
| Strg + O | Bauplan oder Schematic öffnen |
| ? | Bedienung anzeigen |

## Brave: Ordner-Zugriff einschalten

Für den Projektordner braucht Tessera die File System Access API, die in Brave abgeschaltet sein kann. Das Einlesen des Modpacks und das Öffnen von Dateien kommen ohne sie aus.

So prüfst du es: In Tessera oben rechts „Projekte“ öffnen. Steht dort, dass der Browser keinen Ordner erlaubt, öffne `brave://flags`, suche nach „File System Access API“, stelle den Eintrag auf „Enabled“ und starte Brave neu. Ohne die API lädt „Speichern“ den Bauplan als Datei herunter; Chrome und Edge haben die API immer an.

## Datenschutz

Tessera lädt nichts aus dem Internet nach und sendet nichts. Schriften und Bibliotheken sind eingebaut. Geöffnete Dateien und eingelesene Jars werden nur im Browser verarbeitet; im Browser-Speicher landen die Tabs, der fertige Katalog und der Verweis auf den Projektordner, nicht die Jars selbst. Tessera schreibt nur in den Unterordner `projekte/` des gewählten Ordners (Versionen in `projekte/.versionen/`). Wenn du die Website-Daten für `localhost` löschst, sind gespeicherte Tabs, Katalog und Ordner-Verweis weg; Baupläne im Projektordner, Schematics und dein Modpack bleiben, wo sie waren.

Spieldateien von Mojang und den Mod-Autoren gehören nicht in dieses Repository. Tessera bringt keine mit, sondern liest sie bei dir ein.

## Entwicklung

| Befehl | Zweck |
| --- | --- |
| `npm test` | Tests (Vitest) |
| `npm run typecheck` | TypeScript prüfen |
| `npm run build` | prüfen und bauen, Ergebnis in `dist/` |
| `npm run build:artifact -- --out <ordner>` | Version zum Veröffentlichen als Claude-Artefakt, z. B. als Testversion fürs Handy |
| `node scripts/lagen.mjs <datei.tess>` | Bauplan als Text: Meldungen, Lagen von oben, Schnitte, einzelne Blöcke mit Zeile |
| `node scripts/fotos.mjs <datei.tess> --out <ordner>` | Bildschirmfotos aus mehreren Richtungen (nach `npm run build`, braucht Playwright) |

Konzept, Spezifikation und Auftrag für die nächste Etappe liegen in `docs/`: [Konzept](docs/konzept.md), [Bau-Sprache (Ist)](docs/bau-sprache.md), [Bau-Sprache 2 (Soll)](docs/bau-sprache-2.md), [Auftrag Etappe 4](docs/etappe-4.md), [Future Fixes](docs/future-fixes.md) (Verbesserungsvorschläge, noch nicht umgesetzt). Hinweise für Claude stehen in [CLAUDE.md](CLAUDE.md).

Die Tests erzeugen ihre Testdateien selbst, auch kleine Jars mit Modellen, Texturen und Rezepten. Eigene Schematics zum Ausprobieren gehören in den Ordner `samples/`; er wird nicht eingecheckt. Zwei Tests laufen nur, wenn du Pfade angibst: der gegen die Beispieldatei aus Etappe 1 und der gegen die echte Minecraft-Jar (liest alle Vanilla-Blöcke und prüft Farben und Namen):

```sh
TESSERA_SAMPLE_SCHEM=samples/a05cccd2-32011.schem TESSERA_MC_ROOT=~/.minecraft npm test
```

In der Windows-PowerShell:

```powershell
$env:TESSERA_SAMPLE_SCHEM = "samples\a05cccd2-32011.schem"; $env:TESSERA_MC_ROOT = "$env:APPDATA\.minecraft"; npm test
```

Ein dritter optionaler Test prüft jeden Blockzustand, den die Bau-Sprache in den Bauplänen unter `beispiele/` erzeugt, gegen die Vanilla-Daten von 1.21.1. Die Datei kommt aus [misode/mcmeta](https://github.com/misode/mcmeta) (Zweig `1.21.1-summary`, `blocks/data.min.json`) und gehört nicht ins Repository:

```sh
TESSERA_MCMETA_BLOCKS=pfad/zu/data.min.json npm test
```

Immer dabei sind zwei Tests, die die Bau-Sprache absichern: `test/tess1-regression.test.ts` vergleicht Baupläne mit `tess 1` über Prüfsummen mit dem Stand von 0.3.0, `test/tess-leistung.test.ts` übersetzt einen erzeugten Bauplan mit über zwei Millionen Blöcken (Ziel unter 5 Sekunden, jeder Zielbau unter 1 Sekunde).

**Aufbau**

```text
src/
  tess/        Bau-Sprache: Syntax, Ausdrücke, Rollen, Formen, Dachmaschine, Compiler (Version 1 eingefroren in v1.ts), verbundene Blöcke
  core/        NBT lesen und schreiben, Formate (.tess, .schem, .litematic, .nbt), Versionen, Umbenennungen
  blocks/      Blockwissen: Farben, Formen, Namen, Items (eingebaute Tabelle und Anbindung an den Katalog)
  catalog/     Block-Katalog: Jars lesen, PNG dekodieren, Modelle und Blockzustände auflösen, Tags, Rezepte, Familien
  render/      Chunk-Meshing, Shader, Raycast, Outlines, Kamera
  workers/     Web Worker für Einlesen, Katalog und Meshing
  materials/   Materialliste und Rohstoff-Aufschlüsselung
  app/         Projekte, Tabs, Import, Speicherung
  ui/          Oberfläche (Preact)
  debug/       Protokoll, Umgebung, Debug-Paket
  platform/    Projektordner, Speichern von Dateien und Beispieldateien, je nach Umgebung
beispiele/     Baupläne zum Ausprobieren
docs/          Referenz der Bau-Sprache
scripts/       Build-Hilfen (Artefakt-Version), Lagen und Bildschirmfotos von Bauplänen
test/          Tests
```

Technik: TypeScript, Three.js, Preact, Vite, fflate.

## Etappenplan

1. [x] **Viewer:** `.schem` laden, 3D-Ansicht mit Grundformen, Ebenen, Hover mit Wireframe-Highlight, Materialliste, Baufortschritt, Debug-Export
2. [x] **Block-Katalog:** Minecraft-Jar und `mods`-Ordner einlesen; echte Namen, Farben, Familien, Rezepte; Rohstoff-Aufschlüsselung
3. [x] **Bau-Sprache, Testlauf:** kleines Haus mit Fenstern, Dach und einem Rundturm; `.tess`-Dateien im Projektordner
4. [x] **Bau-Sprache, Ausbau** ([Auftrag](docs/etappe-4.md), [Spezifikation](docs/bau-sprache-2.md))
   - [x] 4a Formen und Dächer: Profile, Vielecke, Dachmaschine mit Verschneidung, Herkunft pro Block
   - [x] 4b Anbauten und Zier: Fensterformen, Balkone, Umgänge, Erker, Gauben, Ecktürme, Treppen, Deko, Farmen, Prüfungen
   - [x] 4c Werkzeuge: Module, ASCII-Freistil, Bauabschnitte, Bearbeiten mit Undo/Redo und Versionen
5. [ ] **Gelände-Scan:** Welt-Tab, Objekte platzieren, Erdarbeiten, Ingame-Koordinaten
6. [ ] **Export:** `.schem`, `.nbt`, `.litematic` mit korrekt verbundenen Blöcken

Eine Desktop-App mit Tauri ist vorerst nicht geplant.

## Grenzen

- Ohne eingelesenen Katalog sind die Farben Näherungen aus einer eingebauten Tabelle, die Namen englisch und Mod-Blöcke unbekannt.
- Blöcke ohne festes Modell (Kisten, Schilder, Banner, Köpfe) und Mod-Blöcke mit eigenem Modell-Code erscheinen vereinfacht, in der Farbe ihrer Textur.
- Pro Block zeigt Tessera eine Durchschnittsfarbe pro Seite, keine Texturen.
- Rezepte von Mod-Maschinen kennt Tessera nur, wenn sie in einem der bekannten Formate vorliegen (Vanilla-Stationen, Create). Was sich nicht herstellen lässt, steht als Rohstoff in der Liste.
- Noch nicht aufgeschlüsselt werden Chipped (Varianten aus den Chipped-Werkbänken), FramedBlocks und Domum Ornamentum (das Material steckt dort im einzelnen Block). Diese Blöcke stehen vorerst selbst als Rohstoff in der Liste.
- Alte `.schematic`-Dateien (vor 1.13) liest Tessera noch nicht.
- Kisteninhalte, Schildertexte und Objekte wie Rüstungsständer oder Rahmen werden nicht angezeigt.
- Verbundene Blöcke (Zäune, Mauern, Scheiben) aus Schematics erscheinen so, wie sie in der Datei gespeichert sind; nur Baupläne rechnet Tessera selbst. Mod-Blöcke mit eigenen Verbindungsregeln sind dabei nur abgedeckt, wenn sie den Vanilla-Namen folgen.
- Bearbeiten in Tessera gibt es nur für Baupläne in Bau-Sprache 2; Schematics und `tess 1` bleiben unverändert. Größere Umbauten gehen weiter über die Datei selbst.
- Andere Bauabschnitte grau zu zeigen geht bis 2048 Blöcke Kantenlänge; größere Pläne zeigen alle Abschnitte in Farbe.
- Banner zeigt der Viewer einen Block hoch und ohne Muster, Ranken als flache grüne Platten.
