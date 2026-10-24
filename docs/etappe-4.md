# Auftrag Etappe 4 – Bau-Sprache, Ausbau

Etappe 4 macht aus dem Testlauf eine Bau-Sprache, mit der sich detailreiche, verspielte Fantasy-Bauten beschreiben lassen. Vorbilder sind Pinterest-Bauten, die Adrian gesammelt hat: Zaubertürme mit Wendeltreppen außen und Hexenhut-Dächern, Wachtürme mit Steinsockel, Holzumgang und gestaffeltem Helm, Fachwerkhäuser mit Vorkragungen, Kreuzgiebeln, Gauben, Erkern, Blumenkästen und Efeu. Die Bilder gibt Adrian im Chat weiter; sie gehören nicht ins Repository.

**Grundsatz:** Die Bau-Sprache darf nicht der Engpass sein. Maßgeblich ist die Spezifikation [bau-sprache-2.md](bau-sprache-2.md). Was dort steht, wird umgesetzt, und zwar genau so.

Etappe 4 hat drei Teile. **Nach jedem Teil wird gestoppt**; Adrian testet und gibt den nächsten frei.

---

## 4a – Formen und Dächer

**Umfang** (Abschnitte der Spezifikation):

- `tess 2` neben `tess 1`, mit Regressionstest für Version 1 (1.1)
- Fortsetzungszeilen, Ausdrücke, `wert`, Felder von Formen (1.2, 1.3, 2)
- Rollen: alle Glieder, `muster=flecken|lagen`, Block-Angaben (3)
- Formen: `zylinder` mit d/rx/rz, `vieleck`, `umriss`, `grundriss`, `kugel`; gemeinsame Angaben `wand`, `zonen`, `ecken` für alle Formen, Sockel- und Kranzhöhe (4.1, 4.2)
- Wandprofile mit Konsolen (4.3)
- Fachwerk mit Riegeln und Mustern auf allen geeigneten Formen (4.4)
- Dachmaschine: alle Typen, Profile und Voreinstellungen, Verschneidung, Biegung, Firstzier, Traufe, Kranzdach (5)
- Herkunft pro Block: In den Projektdaten steht für jede Zelle die Zeile (mit Modulkette, sobald es Module gibt). Die Hover-Karte zeigt „Zeile 57: dach helm turm profil=glocke …“ (gekürzt auf eine Zeile). Das ist das wichtigste Werkzeug für die Rückmeldung „das da ist falsch“.
- Compiler in Chunks aus typisierten Arrays, Leistungsziel aus Abschnitt 12

**Zielbau 4a:** `beispiele/wachturm.tess`, nur mit Mitteln aus Version 1 und 4a:

- **Turm:** achteckig (`vieleck`, r=5), Steinmischung mit Flecken-Muster.
  - Unten bis Lage 3 zwei Blöcke breiter, dann verjüngt bis Lage 12, ab Lage 18 einen Block vorgekragt mit Konsolen.
  - Fenster in mehreren Höhen.
- **Obergeschoss:** Fachwerk ab Lage 18 bis 23, mit Riegel und Streben.
- **Gestaffelter Helm:** ein Kranzdach am Fuß des Obergeschosses und ein Helm mit Glockenprofil und Spitze.
- **Anbau:** ein kleines Haus am Fuß des Turms, L-förmig aus zwei boxen mit verschnittenen Satteldächern (eine Kehle), eins davon als Krüppelwalm.

**Abnahme 4a:**

- Alle Tests grün, auch der optionale mcmeta-Abgleich (`TESSERA_MCMETA_BLOCKS`) für **alle** Dateien in `beispiele/`.
- `beispiele/haus-mit-rundturm.tess` ergibt blockgenau dasselbe wie in 0.3.0.
- Jede neue Anweisung und Angabe hat mindestens einen Test, der das in der Spezifikation beschriebene Verhalten prüft, nicht nur „keine Fehler“. Beispiele: Konsolenlage bei Δ=2, Einzug pro Lage bei `profil=2/1`, Kehle als Treppen-Innenecke, Biegung verschiebt nur das oberste Drittel.
- `wachturm.tess` übersetzt ohne Fehler und ohne Hinweise.
- Leistungstest aus Abschnitt 12 grün.
- `docs/bau-sprache.md` beschreibt den neuen Ist-Stand (kompakt, mit kurzen Beispielen); README aktualisiert; Version 0.4.0, Etappentext „Etappe 4a – Formen und Dächer“.

---

## 4b – Anbauten und Zier

**Umfang:**

- Bauteile an Wänden für alle Formen: Seiten, Winkel, `versatz`, `ebene`, Wiederholung rundum (6.1)
- Fenster (alle Arten, Laibung, Tiefe, Sprossen, Blumenkasten), Türen und Tore (6.2, 6.3)
- Gesims, Pfeiler, Strebepfeiler, Strebe (6.4)
- Balkon, Umgang, Erker, Gaube, Ecktürme (6.5)
- Zinnen erweitert, Bögen, Treppen, Wendeltreppen innen und außen (6.6)
- Zier und Deko (7), Farmen (8)
- Prüfungen: Überschrieben, Halt, Schweben, Fließen (11)
- In der App: Ein Klick auf einen Hinweis in den Projektdaten markiert die Blöcke dieser Zeile (über die Herkunft) und dreht die Kamera hin.

**Zielbauten 4b:**

- `beispiele/wachturm.tess` fertig ausgebaut:
  - Umgang mit Geländer und Stützen unter dem Obergeschoss
  - Gesims am Sockel, Rundbogenfenster
  - Wandlaternen mit Arm, Efeu am Sockel
  - Banner, ein Balkon mit Pultdach
- `beispiele/fachwerkhaus.tess`:
  - zweigeschossig mit Vorkragung und Kopfbändern, Kreuzgiebel
  - zwei Gauben, ein Erker mit Helm
  - Schornstein, Fenster mit Läden und Blumenkästen
  - Tür mit Vordach und Stufen
  - ein kleines Feld mit Zaun und Tor daneben

**Abnahme 4b:** wie 4a (Tests mit Verhaltensprüfung je Anweisung, mcmeta-Abgleich aller Beispiele, beide Zielbauten ohne Fehler und ohne Hinweise, Ist-Referenz und README); Version 0.4.1, Etappentext „Etappe 4b – Anbauten und Zier“.

---

## 4c – Werkzeuge

**Umfang:**

- Module, `baue` mit Drehung und Spiegelung, `wiederhole`, `spiegle`, `abschnitt`, `ausrichtung`, `erlaube` (10)
- Freistil: `zeichen`, `ebene`, `ebenen`, `ansicht` (9)
- **Bauabschnitte in der App:** Auswahl in der Seitenleiste („Ganzes Gebäude“ oder ein Abschnitt). Ebenen-Regler, Materialliste, Rohstoffe und Fortschritt gelten dann für den Abschnitt, z. B. „Nordturm, Ebene 12 von 30“. Andere Abschnitte erscheinen grau.
- **Bearbeiten in der App** (nur Baupläne; jede Änderung landet in der `.tess`-Datei):
  - **Palettentausch:** Seitenleisten-Bereich „Rollen“ mit allen Rollen der Datei. Eine Sorte wird über die Katalogsuche gegen einen anderen Block getauscht, Gewichte bleiben. Tessera schreibt die `rolle`-Zeile neu, Kommentare und Rest der Datei bleiben unverändert.
  - **Drehen und Spiegeln** des ganzen Bauplans: Knöpfe, die die Zeile `ausrichtung` anlegen oder ändern.
  - **Einzelblöcke:** Im Bearbeiten-Modus öffnet ein Klick auf einen Block ein Menü mit „Entfernen“, „Ersetzen“ (Katalogsuche) und „Zustand“ (Blickrichtung, Hälfte …). Die Änderungen kommen als `block`- und `leer`-Zeilen in einen Bereich am Dateiende:
    ```
    # ---- Änderungen in Tessera ----
    block 12,5,3 spruce_stairs[facing=east,half=top]
    leer 4,7,2
    ```
    Eine weitere Änderung an derselben Zelle ersetzt die vorherige Zeile.
  - **Rückgängig/Wiederholen** mit Strg+Z und Strg+Y (auch Strg+Umschalt+Z), bis 100 Schritte pro Tab, auf Ebene des Dateitexts. Jeder Schritt schreibt die Datei; die eigene Änderung darf nicht als „Datei von außen geändert“ gelten.
  - **Versionen:** Vor jedem Schreiben aus der App und vor dem Übernehmen einer Änderung von außen wird der bisherige Inhalt gesichert, unter `projekte/.versionen/<name>/<JJJJ-MM-TT_hh-mm-ss>.tess`; die 50 neuesten bleiben. Ein Dialog „Versionen“ pro Tab listet sie, öffnet eine Version als schreibgeschützten Tab und stellt sie wieder her (die aktuelle Fassung wird dabei vorher selbst gesichert).
  - Ohne Projektordner (Browser ohne File System Access API) funktioniert alles im Browser-Speicher; „Speichern“ lädt herunter.

**Zielbau 4c:** `beispiele/zauberturm.tess`:

- **Hauptturm:** schlank und rund (zylinder mit Wandprofil, Bauch in der Mitte), Wendeltreppe außen über zwei Drittel der Höhe.
- **Türmchen:** drei Modul-Instanzen eines Türmchens mit Hexenhut (`helm`, `profil=glocke`, `biegung`) in verschiedenen Höhen und Drehungen, eins über ein Erker-Geschoss angesetzt.
- **Fassade:** eine per `ansicht` gezeichnete Partie (Rosette aus Treppen, vorstehende Rahmen).
- **Abschnitte:** mindestens zwei Bauabschnitte.

**Abnahme 4c:** wie 4a; zusätzlich Tests für Drehung und Spiegelung von Blockzuständen (jede Blickrichtung, Achsen, Türangeln), für die Textänderungen beim Bearbeiten (Datei bleibt bis auf die betroffenen Zeilen gleich), für Rückgängig/Wiederholen und für die Versionsablage. Version 0.4.2, Etappentext „Etappe 4c – Werkzeuge“. `README.md` mit Etappe 4 als erledigt.

---

## Arbeitsweise

- Vorher lesen: `CLAUDE.md`, `README.md`, `docs/konzept.md`, `docs/bau-sprache.md`, `docs/bau-sprache-2.md`, diese Datei. Im Code gezielt lesen, was der Teil berührt (`src/tess/`, `src/core/formats/tess.ts`, `src/app/planFiles.ts` …).
- Schritt für Schritt nach Spezifikation. Bei echten Widersprüchen oder Lücken: so entscheiden, wie in der Spezifikation unter „Verbindlichkeit“ beschrieben, und im Bericht nennen. Bei Fragen, die die Richtung ändern würden: Adrian fragen statt raten.
- Zielbauten nicht „auf Abnahme hin“ vereinfachen. Sie sollen gut aussehen; Bildschirmfotos aus mehreren Richtungen ansehen und selbst kritisch prüfen (Proportionen, Fehlplatzierungen, flache Fassaden), bevor der Teil als fertig gilt.
- **Bericht beim Stopp:**
  - was umgesetzt ist
  - was bewusst anders gelöst wurde und warum
  - was Adrian testen soll
  - 2–3 Bildschirmfotos der Zielbauten
  - bekannte Schwächen

## Nicht Teil von Etappe 4

Ohne Adrians ausdrückliche Anweisung nicht einbauen:

- Rohstoff-Aufschlüsselung für Chipped (Werkbank-Varianten), FramedBlocks und Domum Ornamentum
- echte Texturen im Viewer
- Etappe 5 (Gelände) und Etappe 6 (Export)
- Innenräume und Möbel
- Arbeit an der Handy-Darstellung
