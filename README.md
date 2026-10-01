<p align="center">
  <img src="public/avero.svg" width="96" height="96" alt="Avero">
</p>

<h1 align="center">Avero</h1>

<p align="center">Boardview für die Elektronik-Reparatur auf dem Mac.</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS-13%2B-111111?logo=apple" alt="macOS 13+">
  <img src="https://img.shields.io/badge/Rust-Tauri%202-F05138?logo=rust&logoColor=white" alt="Rust + Tauri 2">
  <img src="https://img.shields.io/badge/Lizenz-MIT-55D5B4" alt="MIT">
</p>

![Avero mit Board und Schaltplan nebeneinander](docs/screenshot.png)

Avero öffnet Boardview-Dateien, findet Bauteile, Pins und Netze und verfolgt ein Signal über beide Seiten der Platine. Das Ziel ist ein Werkzeug auf dem Niveau von FlexBV und XinZhiZao: Boardview, Schaltplan und Werkstattwissen in einer App. Alles läuft lokal, ohne Konto und ohne Telemetrie.

## Stand (0.5)

**Boardview**
- Liest Test_Link `.brd` (auch verschleierte Dateien), BRD2, Honhan `.bdv`, ASUS `.asc` und `.fz`, BoardViewer `.bvr` / BVR3, GenCAD, Panel-CAD, IBM `.cst`, XinZhiZao `.pcb`, KiCad `.kicad_pcb` und EAGLE / Fusion 360 `.brd` (XML).
- XinZhiZao- und die meisten ASUS-`.fz`-Dateien sind verschlüsselt: Die Schlüssel trägst du einmal in den Einstellungen ein (Avero liefert sie nicht mit, genau wie OpenBoardView). XZZ-Dateien öffnen sich auch ohne Schlüssel mit allem, was nicht verschlüsselt ist (Umriss, Netze, Testpunkte); nur die Bauteile brauchen ihn. Unverschlüsselte `.fz`-Dateien öffnen sich direkt.
- Flüssige Darstellung per GPU (WebGL 2), auch bei zehntausenden Pins.
- Oberseite / Unterseite (gespiegelt wie ein umgedrehtes Board), Drehen in 90°-Schritten.
- Klick auf einen Pin hebt das ganze Netz hervor. Pins desselben Netzes auf der anderen Seite bleiben schwach sichtbar, damit man sieht, wohin das Signal geht.
- Pin 1 ist eckig gezeichnet, Versorgungsnetze rot, Masse dunkel, Testpunkte als Raute.
- Suche nach Bauteil, Netz oder Pin: `U3000`, `PP3V3`, `U3000.21`, `U1000 A12`.
- **Befehlspalette** (`⌘K`): jeder Befehl, jedes Bauteil, Netz und jeder Pin in einer Liste.
- **Verbindungslinien** (Ratsnest) zwischen den Pins des gewählten Netzes, jeweils zum nächsten Nachbarn.
- **Mehrere Netze gleichzeitig** (`P` oder „Anpinnen“ im Netz): jedes angepinnte Netz behält seine eigene Farbe auf Pins, Vias und Leiterbahnen, mit Legende auf dem Board.
- **Markierungen auf dem Board** (`M` oder Fähnchen in der Werkzeugleiste): eine Nadel mit Notiz an jede Stelle setzen, etwa „Kurzschluss gegen Masse hier“; pro Board gespeichert und unter „Messen“ aufgelistet.
- **Schaltplan-Fundstellen**: Zu jedem Bauteil und Netz zeigt das Detailpanel alle Seiten des Schaltplans, auf denen es vorkommt, mit Anzahl; ein Klick springt hin. **Netze umbenennen** (z. B. `Net10` → `GND`), gespeichert pro Board; Messwerte ziehen mit.
- **OpenBoardData:** `.obdata`-Dateien von [openboarddata.org](https://openboarddata.org) (Messwerte bekannt guter Boards, vor allem MacBooks, Lizenz ODbL) lassen sich im Reiter „Wissen“ importieren. Passt die Boardnummer im Dateinamen – oder ordnet man die Daten mit „Diesem Board zuordnen“ zu –, zeigt Avero beim angeklickten Netz Diode, Spannung und Widerstand je Board-Zustand samt Hinweisen und verwandten Netzen, beim Bauteil Wert und Gehäuse. Die Diagnose-Abschnitte der Datei (z. B. Einschaltsequenz) erscheinen als Seite, Netz- und Pinverweise darin sind anklickbar.
- **Chip-Datenbank:** Steht der Bauteiltyp in der Boarddatei (z. B. `ISL88739AHRZ`, `RT6575DGQW`, `NCP303151MNTWG`), zeigt Avero in den Details, was der Chip tut und was sein Datenblatt sagt – Eingangsspannung, Ströme, Gehäuse – mit Link zur Herstellerquelle. Erfasst sind gängige Notebook-Laderegler, Spannungswandler, Leistungsstufen, Lastschalter und Embedded Controller sowie die PD-, Lade- und HDMI-Chips von Switch, PS5 und Xbox; nur Angaben, die beim Hersteller nachgeprüft sind.
- **Fehlersuche „Notebook geht nicht an“** (Reiter „Fehlersuche“): Schritt für Schritt vom Netzteil-Eingang über Laderegler, Systemspannung, 3V/5V-Dauerspannungen und RTC, EC, Einschalttaste und Intel-Einschaltsequenz (RSMRST#, SLP_S5#/S4#/S3#, VR_ON, VR_PWRGD, PWROK …) bis zu Speicher und Wandlern. Avero sucht die Messpunkte im geöffneten Board selbst – aus geprüften Datenblatt-Pinbelegungen (z. B. ACIN 2–3,5 V am ISL88739A), aus Netznamen, die ihre Spannung nennen (`+3VALW` 3,3 V), und aus den Standard-Signalnamen – und sagt bei jedem Punkt, woher der Sollwert stammt. Die Werte landen im aktiven Reparaturfall; der erste Wert, der nicht passt, wird mit einem Hinweis hervorgehoben.
- **Pinbelegung aus dem Datenblatt:** Für ISL88739A, RT8207P, SY8286, TPS2546, TPS22966, NCP81253, BQ24193 und die onsemi-Leistungsstufen NCP302045/NCP303151 kennt Avero die Pinbelegung samt Sollwerten (z. B. „ACIN: 2–3,5 V = Netzteil gültig“, „VTT = ½ VDDQ“). Angezeigt wird sie erst nach einer Prüfung am jeweiligen Board: Alle Masse-Pins des Datenblatts müssen auf Masse liegen und die Netznamen mehrheitlich zu den Pinnamen passen. Nummeriert eine Boarddatei die Pins anders (zusammengelegte Pads, eigenes Gehäuse), zeigt Avero den Grund statt falscher Beschriftungen.
- **Reparaturwissen** (Reiter „Wissen“): Seiten von repair.wiki (oder einem anderen MediaWiki) importieren – über „Spezial:Exportieren“ als XML oder einzeln im Browser als HTML gesichert. Avero ordnet jede Seite ihrem Gerät zu, zeigt sie beim passenden Board (Seiten mit der Boardnummer zuerst), durchsucht alles und macht Netz- und Bauteilnamen im Text anklickbar. Anleitungen („Repair guide“, „Explanatory guide“) landen über ihr Gerätefeld beim richtigen Gerät, andere Modelle derselben Familie stehen getrennt darunter. Messbilder und Platinenfotos erscheinen als Galerie (Bilder laden direkt von repair.wiki, sonst öffnet ein Klick die Bildseite), Links zu anderen importierten Seiten öffnen in Avero, alle anderen im Browser. Avero bringt außerdem eigene Referenzseiten mit, deren Werte aus den Messbildern von repair.wiki abgelesen sind – USB-C-Diodenwerte von Switch, Switch OLED, Switch Lite, Switch 2, DualSense und Xbox-Controllern (für bis zu sieben Tail-Plug-Tester: Mechanic T824/T824SE, JCID CD01, Qianli iBridge, YCS, 2UUL), HDMI-Diodenwerte von PS5, PS4 Pro/Slim, Xbox Series X/S und One X/S samt Vergleichstabelle, dazu Messwerte und Hinweise zu PS5, PS5 Slim, PS4, Game Boy Advance SP und DS Lite. Dazu kommen geprüfte Angaben aus dem Netz – Ladeelektronik der Switch, HDMI-Chips von PS5 und Xbox – mit Quellenliste; aufgenommen wird nur, was Datenblätter oder mindestens zwei unabhängige Quellen bestätigen, Messwerte von defekten Geräten und widersprüchliche Angaben (z. B. PS4-HDMI-Chips) bleiben draußen. Avero rechnet die Tester-Anzeigen selbst in Pinbelegungen um (Mechanic: 01–12 = A1–A12, 13–24 = B12–B1; HDMI-Adapter). Quelle und Lizenz (repair.wiki: CC BY-SA 3.0) stehen bei jeder Seite, „Original öffnen“ führt zur Wiki-Seite.
- **Ansicht als PDF** (`⌥⌘E`): aktuelle Ansicht mit Legende der angepinnten Netze und Liste der Markierungen.
- **Leiterbahnen und Lagen**, wo die Datei sie enthält (GenCAD `$ROUTES`): jede Lage in eigener Farbe (oben rot, unten blau, Innenlagen bunt), die sichtbare Seite kräftig, Innenlagen und Rückseite schwächer, Vias als Punkte. Im Reiter „Lagen“ lässt sich jede Lage einzeln schalten („Nur oben“, „Nur unten“, „Alle an/aus“). Ein gewähltes Netz leuchtet auf allen Lagen, der Rest tritt zurück; ein Klick auf eine Bahn wählt ihr Netz. Abschaltbar in den Einstellungen. Kennt die Datei von Bauteilen nur Name, Position und Drehung (etwa aus XZZ-Konvertern), **rekonstruiert Avero die Bauteile aus dem Kupfer**: Typ aus dem Gehäusenamen (Kondensator/Widerstand, Spule, Quarz, IC, Stecker) in eigener Farbe, Seite und Pad-Abstand je Bauform aus den Leiterbahn-Enden gelernt, BGA-Größe aus dem Ball-Raster im Namen oder dem Via-Feld darunter. Wo eine Leiterbahn oder ein Via genau auf einem Pad endet, bekommt das Bauteil einen Pin mit Netz. Bei namenlosen Netzen (Net1, Net2 …) erkennt Avero die Masse an ihren Vias, die über die ganze Platine verteilt sind, und markiert das Netz als „Masse?“. Alles Geschätzte ist im Detailpanel als „geschätzt“ markiert.
- **Netze verfolgen** über Spulen, Ferrite, Sicherungen, Jumper und 0-Ω-Widerstände: Das Detailpanel zeigt „Weiter über", z. B. `PP1V8_SW` → `PP1V8` über `L3001`.
- Ansicht als PNG exportieren (`⇧⌘E`), mit allen Beschriftungen.
- **Tabs**: Jedes weitere Board öffnet sich in einem eigenen Tab, mit eigenem Schaltplan, eigener Auswahl und Ansicht. Eine schon offene Datei springt zu ihrem Tab.
- **Zwei Boards vergleichen** (Darstellung → „Mit anderem Tab vergleichen"): das Board eines anderen Tabs daneben, Auswahl nach Namen gespiegelt – Bauteil, Pin und Netz werden auf beiden Boards gezeigt, etwa bei zwei Revisionen.
- Detailpanel mit Wert, Seite, Position und allen verbundenen Bauteilen und Pins, dazu Listen aller Bauteile und Netze.

**Schaltplan**
- PDF-Schaltplan neben dem Board, mit verschiebbarem Trenner; ein PDF im selben Ordner wie die Boardview-Datei öffnet sich automatisch (gleicher Name oder gleiche Boardnummer wie `820-02100`).
- Bauteil, Pin oder Netz im Board wählen → der Schaltplan springt zur Fundstelle und markiert alle Vorkommen; mit `[` / `]` durch die Fundstellen.
- Bauteil- oder Netznamen im Schaltplan anklicken → das Board zeigt sie.
- Scharf bei jeder Zoomstufe, Seitennavigation und Lesezeichen (Abschnitte) des PDFs.
- **Freie Textsuche** im Schaltplan (`⌥⌘F`): findet auch Wortteile, z. B. `VBUS` in `PP_VBUS`; `↩` / `⇧↩` springen durch die Treffer.
- **Eigenes Fenster** für den zweiten Monitor: Der Schaltplan folgt weiter der Auswahl im Board, Klicks im Schaltplan wählen im Board aus.

**Werkstatt**
- **XZZ-Konverter direkt in der Bibliothek:** „XZZ-Dateien auswählen…“ öffnet die Dateiauswahl. Avero konvertiert eine oder mehrere `.pcb`-Dateien automatisch in GenCAD, übernimmt Dateinamen und Netzverbindungen und speichert die `.cad`-Dateien im Bibliotheksordner. Optional gilt die beim Import gewählte Kategorie. Bereits vorhandene Ergebnisse werden übersprungen, andere Dateien nie überschrieben. Fortschritt, Fehler pro Datei und „Board öffnen“ erscheinen direkt im Fenster. Keine Terminalbefehle, keine Ausgabe-Dateinamen und kein zusätzliches Programm. Die Konvertierung nutzt einen kompatiblen Standardschlüssel; ein eigener XZZ-Schlüssel aus den Einstellungen hat Vorrang.
- **Bibliothek** (`⌘L`): eigene Avero-Bibliothek unter `~/Dokumente/Avero/Bibliothek`. Dateien, Ordner oder ZIP-, 7z- und RAR-Archive ins Bibliotheksfenster ziehen oder „Importieren…" – Avero kopiert Boardviews und Schaltpläne hinein, sortiert sie nach Boardnummer oder in einen Geräteordner deiner Wahl (`Apple/iPhone 13 Pro`) und überspringt Duplikate. Nach dem Import – und jederzeit über den Stift an jedem Eintrag – lassen sich die Dateien umbenennen, etwa `download (3).pdf` in `J413 820-02100.pdf`. Über den Papierkorb an jedem Eintrag wandert ein Board samt Schaltplänen nach Rückfrage in den macOS-Papierkorb (nur Dateien der eigenen Bibliothek; eingebundene Ordner bleiben unberührt). **Marken und Geräte:** Links steht ein Baum Marke › Gerät › Modell (z. B. Sony › PlayStation › PS4, Nintendo › Switch › Switch Lite) mit Anzahl je Ebene; ein Klick filtert. **Automatisch eingeordnet:** Neue Dateien landen ohne weiteres Zutun im passenden Ordner – Avero erkennt das Gerät an Board- und Modellnummern (PS5 `EDM-020`/`CFI-1216A` → Sony › PlayStation › 5, Switch OLED `HEG-CPU-01` → Nintendo › Switch › OLED, `SM-A515F` → Samsung › Galaxy A › A515F, MacBook über `A2338` oder `820-…`, ThinkPad, Latitude, EliteBook, ASUS-, Acer- und MSI-Modellcodes, Grafikkarten) und liest notfalls den Text des Schaltplans. Abschaltbar unter dem Import-Knopf; „Einordnen…“ sortiert Vorhandenes mit Vorschau. Über das Etikett an jedem Eintrag (oder direkt beim Import) ordnest du Dateien von Hand ein. Noch nicht Eingeordnetes steht unter „Nicht eingeordnet“. Zusätzlich lassen sich bestehende Ordner einbinden. Alles ist nach Boardnummer, Gerät und Dateiname durchsuchbar; ein Klick öffnet Board und Schaltplan zusammen. Noch nicht lesbare Formate (`.tvw`) werden ausgegraut angezeigt. **Duplikate…** findet Dateien mit exakt gleichem Inhalt, auch unter anderem Namen; die älteste Kopie bleibt, überzählige Kopien der eigenen Bibliothek wandern nach Rückfrage in den Papierkorb. 7z und RAR entpackt Avero mit dem in macOS eingebauten `bsdtar`; passwortgeschützte Archive gehen nicht.
- **Messwerte pro Netz**: Diodenmodus, Spannung, Widerstand. Eingaben wie `0,452`, `452` (mV), `4k7`, `OL` werden verstanden.
- **Referenz und Reparaturfälle**: Werte vom guten Board als Referenz, jedes Gerät auf dem Tisch als eigener Fall. Abweichungen über der Toleranz (Standard ± 10 %) werden rot markiert, auch als Punkt direkt an den Pins auf dem Board. Referenzwerte gelten für jedes Board mit derselben Nummer – das nächste gleiche Board wird automatisch verglichen. „Als Referenz übernehmen“ macht die Messwerte eines reparierten, funktionierenden Boards zur Referenz.
- **Reparaturverlauf pro Gerät**: Jeder Fall hat Status (in Arbeit, wartet auf Teile, repariert, nicht reparierbar), Gerät, Seriennummer, Kunde, Befund und Fotos; alle Fälle eines Boards stehen mit Datum und Status in einer Liste. **Bericht als PDF** für den Kunden: Gerätedaten, Befund, Messwerte gegen Referenz mit Bewertung, Fotos.
- **Notizen** pro Board und pro Fall, Export/Import als JSON (z. B. Referenzwerte weitergeben).
- **Foto des echten Boards** unter der Boardview (Darstellung → „Foto dieser Seite hinzufügen…"): zwei markante Punkte im Foto anklicken, dann dieselben Punkte auf dem Board (Pins rasten ein) – das Foto liegt danach deckungsgleich darunter, mit einstellbarer Deckkraft, getrennt für Ober- und Unterseite.
- **Inhaltssuche über die ganze Bibliothek** (Bibliothek → „Inhalt“): Schaltpläne werden nach Text durchsucht, Boardviews nach Bauteilen und Netzen. Alles wird einmal indiziert; ein Klick auf einen Treffer öffnet Board und Schaltplan und springt zur Fundstelle.
- Gespeichert wird lokal unter `~/Library/Application Support/dev.meb99.avero/boards/`, eine Datei pro Board. Alle Dateien desselben Boards (etwa `.brd` und `.bdv`) teilen sich die Messwerte über die Boardnummer.

**Mac**
- Echte Mac-Menüleiste (Ablage, Bearbeiten, Darstellung, Fenster, Hilfe) mit allen Befehlen und „Zuletzt geöffnet".
- Toolbar als Titelleiste mit den Fenster-Ampeln, Hell- und Dunkelmodus nach Systemeinstellung.
- Hinweis auf neue Versionen (einmal täglich, abschaltbar); „Nach Updates suchen…" im Avero-Menü.
- Trackpad: zwei Finger verschieben, Zoomgeste zoomt (in den Einstellungen auf Mausrad-Zoom umstellbar).
- Dateien per Drag & Drop, „Öffnen mit" im Finder oder aufs Dock-Symbol ziehen.
- Deutsch und Englisch, je nach Systemsprache.

Ein Demo-Board mit passendem Demo-Schaltplan ist eingebaut, damit man alles ohne eigene Dateien ausprobieren kann.

## Tastatur und Maus

| Aktion | Eingabe |
| --- | --- |
| Verschieben | Ziehen, zwei Finger, Pfeiltasten |
| Zoomen | Zoomgeste, `+` / `−` |
| Auswählen | Klick |
| Zur Auswahl zoomen | Doppelklick, `↩` |
| Seite wechseln | `Leertaste` |
| Drehen | `R` / `⇧R` |
| Einpassen | `F` |
| Suchen | `⌘F` oder `/` |
| Befehlspalette | `⌘K` |
| Verbindungslinien ein/aus | `⇧⌘R` |
| Ansicht als Bild exportieren | `⇧⌘E` |
| Ansicht als PDF exportieren | `⌥⌘E` |
| Markierung setzen | `M` |
| Netz anpinnen / lösen | `P` |
| Einstellungen | `⌘,` |
| Neuer Tab / Tab schließen | `⌘T` / `⌘W` |
| Tab wechseln | `⌘1` … `⌘9`, `⌃⇥` / `⌃⇧⇥` |
| Öffnen (Boardview oder PDF) | `⌘O` |
| Schaltplan ein/aus | `⌘E` |
| Seitenleiste ein/aus | `⌘I` |
| Bibliothek | `⌘L` |
| Schaltplan: Seite zurück/vor | `Bild ↑` / `Bild ↓` |
| Schaltplan: Fundstelle zurück/vor | `[` / `]` |
| Im Schaltplan suchen | `⌥⌘F` |
| Auswahl aufheben | `Esc` |

## Installation

1. Unter [Releases](https://github.com/meb99/Avero/releases/latest) die Datei `Avero_…_universal.dmg` laden (Apple Silicon und Intel, macOS 13 oder neuer).
2. DMG öffnen und Avero in den Programme-Ordner ziehen.
3. Beim ersten Start meldet macOS, dass die App nicht von Apple geprüft ist (Avero ist nicht notarisiert). Unter macOS 13/14: Rechtsklick auf Avero → **Öffnen**. Unter macOS 15: einmal starten, dann **Systemeinstellungen → Datenschutz & Sicherheit → „Dennoch öffnen"**.
   Alternativ im Terminal: `xattr -dr com.apple.quarantine /Applications/Avero.app`

Avero meldet neue Versionen selbst und installiert sie mit einem Klick auf **„Jetzt aktualisieren“** (lädt das Release von GitHub, ersetzt die App und startet sie neu). Releases laufen automatisch: Wird die Version in `src-tauri/tauri.conf.json` erhöht und ist die CI auf `main` grün, baut GitHub Actions die DMG und veröffentlicht sie. Von Hand geht es über **Actions → Release → Run workflow**.

## Selbst bauen

Voraussetzungen: macOS 13+, Xcode Command Line Tools, [Rust](https://rustup.rs) (stable), Node.js 22.

```sh
git clone https://github.com/meb99/Avero.git
cd Avero
npm install
npm run tauri dev      # Entwicklung mit Hot Reload
npm run tauri build    # Avero.app und DMG unter target/release/bundle
```

Tests und Prüfungen:

```sh
cargo test -p avero-formats      # Format-Parser
cargo clippy --workspace -- -D warnings
npm run typecheck && npm test    # Oberfläche
```

`avero-inspect` zeigt, was Avero aus einer Datei liest, ganz ohne Oberfläche:

```sh
cargo run -p avero-formats --bin avero-inspect -- board.brd
cargo run -p avero-formats --bin avero-inspect -- board.brd --json
cargo run -p avero-formats --bin avero-inspect -- board.pcb --xzz-key 0x…
```

## Aufbau

```text
crates/avero-formats     Rust: Dateiformate → einheitliches Board-Modell (mil, Y nach oben)
  src/formats/           ein Modul pro Format, plus Erkennung
  src/builder.rs         Netze, Pin-Größen, Bauteilumrisse, Board-Umriss
  src/demo.rs            synthetisches Demo-Board
  tests/formats.rs       handgeschriebene Mini-Boards pro Format
src-tauri                Mac-App: Dateien lesen, Finder-Integration
  src/library.rs         Bibliothek: Ordner durchsuchen, nach Boardnummer gruppieren
  src/import.rs          Import in die eigene Bibliothek (Dateien, Ordner, ZIP)
  src/notes.rs           Messwerte und Notizen speichern
src                      Oberfläche (React + TypeScript)
  core/                  Board-Modell, Kamera, Raster-Index, Suche, Tauri-Anbindung
  schematic/             PDF-Viewer (pdf.js), Wortindex, Querverweise
  workbench/             Messwerte, Reparaturfälle, Notizen, Bibliothek
  render/                WebGL-2-Renderer, Beschriftungen, Farben
  components/            Toolbar, Suche, Seitenleiste, Dialoge
  i18n/                  Deutsch und Englisch
scripts/demo_schematic.py  erzeugt den Demo-Schaltplan aus dem Demo-Board
public/demo/             Demo-Schaltplan (synthetisch)
docs/                    Roadmap und Formatnotizen
```

## Boardview-Dateien und Schaltpläne

Boardviews und Schaltpläne sind fast immer Eigentum der Hersteller. **Sie gehören nicht in dieses Repository.** Die `.gitignore` schließt die üblichen Endungen aus. Die Tests nutzen ausschließlich selbst geschriebene Mini-Boards.

## Weiter geht's

Was noch offen ist, steht in [docs/ROADMAP.md](docs/ROADMAP.md) – vor allem Dinge, die echte Beispieldateien brauchen (XZZ-Diodenwerte und Unterseite, `.tvw`).

## Dank

Das Wissen über die Dateiformate stammt zu großen Teilen aus [OpenBoardView](https://github.com/OpenBoardView/OpenBoardView) (MIT). PDFs werden mit [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0) dargestellt. Details in [NOTICE](NOTICE).

## Lizenz

[MIT](LICENSE)
