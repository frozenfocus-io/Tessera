# Tessera – Konzept

Stand: 24. Oktober 2026 · Adrian

Diese Datei ist die maßgebliche Fassung des Konzepts. Sie ist aus Adrians Claude-Dokument „Tessera – Konzept“ übernommen und auf den Stand nach Etappe 3 gebracht. Änderungen am Konzept passieren hier.

## Überblick

Tessera ist eine lokale Bauhilfe für Minecraft: Gelände um die Base einlesen, Gebäude in 3D planen und Ebene für Ebene wie in einem Slicer nachbauen. Claude erzeugt Gebäude als kompakte `.tess`-Dateien, Adrian lädt sie in Tessera und bearbeitet sie dort.

**Stand:** Etappen 1 bis 3 sind fertig (Viewer, Block-Katalog mit Rohstoff-Aufschlüsselung, Bau-Sprache im Testlauf mit Projektordner). Etappe 4 ist in drei Teile gegliedert, siehe [etappe-4.md](etappe-4.md).

### Rahmenbedingungen

| Punkt | Festlegung |
| --- | --- |
| Minecraft | Java 1.21.1 |
| Loader | NeoForge 21.1.252 |
| Server | Space-Node, 2 Spieler |
| Spielmodus | Survival |
| Bau-Mods im Pack | u. a. Create, Chipped, Macaw's, Dawn of Time, Handcrafted, Supplementaries |
| Litematica | kann ins Modpack aufgenommen werden (NeoForge-Tauglichkeit offen) |
| Stil der Gebäude | mittelalterlich und Fantasy (primär), andere Stile auch |
| Gebäudearten | Burgen, Türme, Häuser, Brücken, Mauern, Farmen usw. |
| Größen | klein, groß und sehr groß |
| Detailgrad | hoch: verspielte Dächer, Vorkragungen, Zier außen, runde Formen. Vorbilder sind detailreiche Fantasy-Bauten (Zaubertürme, Wachtürme, Fachwerkhäuser). Die Bau-Sprache darf dabei nicht der Engpass sein. |
| Name | Tessera, Bau-Dateien mit Endung `.tess` |

## Grundentscheidungen

Tessera ist eine lokale Web-App mit TypeScript und Three.js, ohne Server; nichts verlässt Adrians PC.

- **Plattform:** Web-App. Eine spätere Verpackung als Desktop-App mit Tauri ist möglich, aber vorerst nicht geplant.
- **Projekte:** `.tess`-Dateien im Unterordner `projekte/` eines Projektordners, den Adrian einmal auswählt (File System Access API). Die App merkt sich den Ordner; nach einem Browser-Neustart erlaubt Adrian den Zugriff mit einem Klick erneut. Offene Tabs bleiben mit ihrer Datei verbunden und bauen sich bei Änderungen neu auf.
- **Katalog und Tab-Zustände:** im Browser-Speicher (IndexedDB), mit dauerhaftem Speicher angefordert. Ein Verlust wäre nur lästig, weil beides neu einlesbar ist.
- **Browser:** Brave. Die File System Access API muss dort unter `brave://flags` eingeschaltet werden. Ohne sie lädt Tessera Baupläne als Datei herunter.

Ordnerstruktur:

```text
Tessera/
  projekte/   nordturm.tess, fachwerkhuette.tess
  scans/      base-gelaende.schem          (ab Etappe 5)
  exporte/    nordturm.litematic           (ab Etappe 6)
```

## Funktionsumfang

Alle Funktionen sind gewünscht; Innenräume kommen erst später.

**3D-Viewer** – Blöcke mit Farben pro Seite, Grundformen (Treppe, Stufe, Zaun, Scheibe, Tür …), Chunk-Meshing mit Greedy Meshing in Web Workers. Echte Texturen als spätere Ausbaustufe (Zeitpunkt offen, siehe Offene Punkte).

**Slicer / Build-Guide** – Ebenen-Regler (aktuelle Ebene voll, darunter grau, darüber ausgeblendet), Wechsel per Pfeiltasten. Bauabschnitte für große Gebäude, z. B. „Nordturm, Ebene 12 von 30“, mit Materialliste pro Abschnitt (Etappe 4c).

**Hover** – Raycast auf den Block unter der Maus: Name, Block-ID, Koordinate; alle Blöcke derselben Sorte mit Wireframe-Outline. Bei Bauplänen zusätzlich die Zeile, die den Block gesetzt hat (Etappe 4a).

**Materialliste** – Anzahl, Stacks und Shulker-Kisten pro Block; Umfang gesamt, Ebene, ab hier, offen; bei mehreren Objekten auf dem Gelände pro Objekt oder summiert.

**Rohstoff-Aufschlüsselung** – Rechnet über die Rezepte aus den Jars zurück bis zu den abzubauenden Rohstoffen. Mehrere Herstellungswege, standardmäßig der günstigste, pro Block umstellbar. Bewusst offen und nur auf Adrians Anweisung: Chipped-Werkbänke, FramedBlocks, Domum Ornamentum.

**Baufortschritt** – Ebenen abhaken; die Materialliste zeigt dann den Rest.

**Tabs** – Jedes Projekt im eigenen Tab; später ein Welt-Tab mit dem Gelände-Scan (read-only) und das Modell als Geist auf dem Gelände.

**Gelände und Platzierung** (Etappe 5) – Objekte mit eigener Position und Drehung platzieren; Erdarbeiten mit eigener Materialliste; Ingame-Koordinaten pro Ebene.

**Bearbeiten** (Etappe 4c) – Drehen, spiegeln, Palette tauschen, einzelne Blöcke editieren; Rückgängig/Wiederholen; Versionen.

**Teilen** – `.tess`-Dateien mit dem zweiten Spieler austauschen; Screenshots per Knopfdruck.

**Debug-Export** – Ein Knopf erzeugt eine ZIP-Datei für Claude: Log mit Zeitstempeln, Version, Browser, Fehlermeldungen der Bau-Sprache mit Zeilennummer, Leistungswerte, unbekannte Blöcke, optional die Projektdateien.

**Später** – Innenräume (z. B. Möbel mit Macaw's und Handcrafted), echte Texturen.

## Architektur-Regeln

Jedes Projekt ist vollständig isoliert; nichts aus einem Projekt darf in ein anderes durchsickern. Hintergrund: In einem früheren Testprogramm blieben beim Import Palette und Grundfläche des vorherigen Gebäudes hängen, weil beides global gespeichert war.

1. Jede `.tess`-Datei ist in sich abgeschlossen: Name, eigene Palette, eigene Module. Sie hängt von keiner vorher geladenen Datei ab.
2. Die Palette gilt nur innerhalb ihrer Datei. Rollen werden beim Übersetzen sofort in volle Block-IDs (`minecraft:stone_bricks`) aufgelöst; intern gibt es keine Rollennamen.
3. Die Größe eines Projekts wird aus seinem Inhalt berechnet. Es gibt keine feste Arbeitsfläche.
4. Jedes Projekt hat einen eigenen Tab mit eigenem Zustand: Kamera, Ebene, Hover-Auswahl, Materialliste.
5. Ein Import öffnet immer einen neuen Tab und überschreibt nie einen bestehenden. (Ein mit seiner Datei verbundener Tab baut sich bei Änderung der Datei neu auf; das ist derselbe Tab, kein Import.)
6. Mehrere Objekte auf dem Gelände bleiben getrennte Objekte mit eigener Position, Drehung und Palette.

### Palette vs. Block-Katalog

Die Bau-Sprache entscheidet, *was* verbaut wird; das Programm weiß, *was das ist*.

| | Palette (in der `.tess`-Datei) | Block-Katalog (im Programm) |
| --- | --- | --- |
| Gilt für | ein Projekt | alle Projekte |
| Inhalt | Zuordnung Rolle → Block | alle Block-IDs inkl. Mod-Blöcke, Farben, Namen, Familien, Rezepte |
| Änderung | Palettentausch in der App, wird in die Datei geschrieben | neu einlesen, wenn sich das Modpack ändert |

- Beim Übersetzen werden die Blöcke gegen den Katalog geprüft. Unbekannte Blöcke werden rot markiert statt still falsch angezeigt.
- Ein Palettentausch betrifft nur das eine Projekt und nimmt die ganze Blockfamilie mit.

## Block-Katalog

Wird einmal automatisch aus den Spieldateien eingelesen („Modpack einlesen“): Minecraft-Jar, NeoForge-Jar, `mods`-Ordner. Es wird kein Code ausgeführt, nur Daten gelesen: Blockzustände, Modelle, Texturen (Durchschnittsfarben), Sprachdateien, Tags, Rezepte, Loot-Tabellen. Familien (Block, Treppe, Stufe, Mauer …) aus Tags, Rezepten und Namensmustern. Unbekannte Blöcke bekommen eine Ersatzfarbe aus einem Hash und werden markiert.

## Bau-Sprache (`.tess`)

Die Bau-Sprache beschreibt, *wie* ein Gebäude aufgebaut ist, statt jeden Block aufzulisten; Tessera übersetzt sie in Blöcke (Prinzip wie OpenSCAD gegenüber STL). Ziel: auch ein detailreicher Fantasy-Bau in wenigen hundert Zeilen.

**Prinzipien**

- Optimiert für Claude: kompakt, eindeutig, wenig Tokens. Adrian liest den Text nicht, kann ihn aber ändern.
- Kein Detail darf an der Sprache scheitern. Häufiges kommt als Bauteil, das Lage und Ausrichtung selbst rechnet (Schutz vor Fehlplatzierungen); alles andere geht über Freistil (ASCII-Ebenen und -Ansichten, Einzelblöcke).
- Präzise Fehlermeldungen mit Zeilennummer; Prüfungen auf Fehlplatzierungen als Hinweise.
- Jede Datei in sich abgeschlossen; gleiche Datei, gleiches Ergebnis.

**Dokumente**

- Version 1 (umgesetzt, Etappe 3): Referenz [bau-sprache.md](bau-sprache.md).
- Version 2 (Etappe 4): Soll-Spezifikation [bau-sprache-2.md](bau-sprache-2.md). Sie legt Profile für Wände und Dächer, beliebige Grundrisse, eine Dachmaschine mit Verschneidung, Anbauten und Zier, Freistil, Module und Prüfungen fest.

## Import und Export

**Gelände-Scan (Etappe 5)** – Bequem: Bereich am Server mit WorldEdit kopieren (`//copy`), mit `//schem save` speichern, per SFTP holen und laden. Direkt: Region-Dateien (`.mca`) des Weltordners lesen und einen Bereich um die Base ausschneiden.

**Import**

| Format | Unterstützung |
| --- | --- |
| `.tess` | eigenes Format, voll |
| `.schem` (Sponge, ab 1.13) | voll, alle drei Format-Versionen |
| `.litematic` | voll |
| `.nbt` (Strukturblock, Create) | voll |
| `.schematic` (vor 1.13) | niedrige Priorität, noch nicht |

**Export (Etappe 6)**

| Format | Wofür |
| --- | --- |
| `.schem` | WorldEdit am eigenen Server (sicher verfügbar) |
| `.nbt` | Vanilla-Strukturformat; die Schematicannon von Create kann es bauen |
| `.litematic` | Hologramm ingame mit Litematica, falls es unter NeoForge läuft |

Verbundene Blöcke müssen im Export bereits den richtigen Zustand haben. Für Baupläne rechnet Tessera das seit Etappe 3 selbst.

## Schwachstellen und Gegenmaßnahmen

| # | Schwachstelle | Gegenmaßnahme |
| --- | --- | --- |
| 1 | Claude als Architekt denkt in Text, nicht in 3D: Fehlplatzierungen und offene Frage, ob die Gebäude schön werden | Bauteile, die Ausrichtungen selbst rechnen; Prüfungen (Wand, Pfosten, Überschneidung, Halt, Schweben); Anzeige der Herkunftszeile pro Block; kurze Feedback-Schleife über den Projektordner; Zielbauten nach echten Vorbildern |
| 2 | Verbundene Blöcke verbinden sich ingame erst beim Platzieren | Verbindungslogik nachgebaut (Zäune, Mauern, Scheiben, Gitter, Treppen-Ecken); Mod-Blöcke nur, wenn sie den Vanilla-Namen folgen |
| 3 | Reine Farbvorschau zu ungenau | Grundformen; Texturen als spätere Ausbaustufe |
| 4 | Rendering- und Übersetzungsleistung bei großen Builds | Chunk-Meshing, Web Workers; Compiler mit Speicher in Chunks statt Hash-Map (Etappe 4a) |
| 5 | Weg ins Spiel: Litematica unter NeoForge unklar | mehrere Exportformate; `.schem` über WorldEdit sicher |
| 6 | Entwicklungsaufwand über mehrere Sitzungen und Personen | dieses Konzept, Spezifikationen und `CLAUDE.md` im Repo |

## Etappenplan

1. [x] **Viewer:** `.schem` laden, 3D-Ansicht mit Grundformen, Ebenen, Hover, Materialliste, Baufortschritt, Debug-Export.
2. [x] **Block-Katalog:** Jars einlesen; echte Namen, Farben, Familien, Rezepte; Rohstoff-Aufschlüsselung.
3. [x] **Bau-Sprache, Testlauf:** Haus mit Fenstern, Dach und Rundturm; `.tess` im Projektordner.
4. [ ] **Bau-Sprache, Ausbau** (Details: [etappe-4.md](etappe-4.md))
   - [ ] **4a Formen und Dächer:** Ausdrücke, Anker, Vielecke und freie Grundrisse, Wandprofile mit Vorkragung und Verjüngung, Dachmaschine (Profile, alle Dachformen, Verschneidung, Biegung), Kranzdächer, Herkunftszeile im Hover, schnellerer Compiler. Zielbau: Wachturm.
   - [ ] **4b Anbauten und Zier:** Fensterformen, Türen, Gesims, Pfeiler, Fachwerkmuster, Balkon, Umgang, Erker, Gaube, Ecktürmchen, Zinnen, Bögen, Treppen und Wendeltreppen, Deko, Farmen, Halt- und Schwebeprüfung. Zielbau: Fachwerkhaus mit Vorkragung.
   - [ ] **4c Werkzeuge:** Module, Wiederholung, Spiegelung, Freistil per ASCII, Bauabschnitte, Bearbeiten in der App mit Undo/Redo und Versionen. Zielbau: Zauberturm.
5. [ ] **Gelände-Scan:** Welt-Tab, Objekte platzieren, Erdarbeiten, Ingame-Koordinaten.
6. [ ] **Export:** `.schem`, `.nbt`, `.litematic` mit korrekt verbundenen Blöcken.

Tauri als Desktop-App: vorerst nicht geplant. Später: Innenräume, echte Texturen.

## Offene Punkte

- [ ] Litematica unter NeoForge 1.21.1: stabiler Port oder Sinytra Connector? Prüfen, bevor wir uns darauf verlassen.
- [x] Brave: File System Access API unter `brave://flags` einschalten (in Etappe 3 eingebaut; Neustart-Fall mit echtem Ordner von Adrian zu prüfen).
- [ ] Mod-Blöcke in Entwürfen: Welche Blöcke aus Create, Chipped, Macaw's, Dawn of Time, Handcrafted, Supplementaries dürfen Entwürfe verwenden?
- [x] Syntax der Bau-Sprache: Version 1 umgesetzt, Version 2 spezifiziert.
- [x] Pfad zur `1.21.1.jar` und zum `mods`-Ordner: im README beschrieben.
- [ ] Echte Texturen: wann? Für das Beurteilen detailreicher Bauten wären sie früher als „irgendwann“ hilfreich. Entscheidung von Adrian.
