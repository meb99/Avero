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
- Liest Test_Link `.brd` (auch verschleierte Dateien), BRD2, Honhan `.bdv`, ASUS `.asc`, BoardViewer `.bvr` / BVR3, GenCAD, Panel-CAD, IBM `.cst` und XinZhiZao `.pcb`.
- XinZhiZao-Dateien sind verschlüsselt: Den XZZ-Schlüssel trägst du einmal in den Einstellungen ein (Avero liefert ihn nicht mit, genau wie OpenBoardView). Ohne Schlüssel sagt Avero das klar und öffnet die Datei nach dem Eintragen automatisch.
- Flüssige Darstellung per GPU (WebGL 2), auch bei zehntausenden Pins.
- Oberseite / Unterseite (gespiegelt wie ein umgedrehtes Board), Drehen in 90°-Schritten.
- Klick auf einen Pin hebt das ganze Netz hervor. Pins desselben Netzes auf der anderen Seite bleiben schwach sichtbar, damit man sieht, wohin das Signal geht.
- Pin 1 ist eckig gezeichnet, Versorgungsnetze rot, Masse dunkel, Testpunkte als Raute.
- Suche nach Bauteil, Netz oder Pin: `U3000`, `PP3V3`, `U3000.21`, `U1000 A12`.
- **Befehlspalette** (`⌘K`): jeder Befehl, jedes Bauteil, Netz und jeder Pin in einer Liste.
- **Verbindungslinien** (Ratsnest) zwischen den Pins des gewählten Netzes, jeweils zum nächsten Nachbarn.
- **Netze verfolgen** über Spulen, Ferrite, Sicherungen, Jumper und 0-Ω-Widerstände: Das Detailpanel zeigt „Weiter über", z. B. `PP1V8_SW` → `PP1V8` über `L3001`.
- Ansicht als PNG exportieren (`⇧⌘E`), mit allen Beschriftungen.
- **Tabs**: Jedes weitere Board öffnet sich in einem eigenen Tab, mit eigenem Schaltplan, eigener Auswahl und Ansicht. Eine schon offene Datei springt zu ihrem Tab.
- Detailpanel mit Wert, Seite, Position und allen verbundenen Bauteilen und Pins, dazu Listen aller Bauteile und Netze.

**Schaltplan**
- PDF-Schaltplan neben dem Board, mit verschiebbarem Trenner; ein PDF im selben Ordner wie die Boardview-Datei öffnet sich automatisch (gleicher Name oder gleiche Boardnummer wie `820-02100`).
- Bauteil, Pin oder Netz im Board wählen → der Schaltplan springt zur Fundstelle und markiert alle Vorkommen; mit `[` / `]` durch die Fundstellen.
- Bauteil- oder Netznamen im Schaltplan anklicken → das Board zeigt sie.
- Scharf bei jeder Zoomstufe, Seitennavigation und Lesezeichen (Abschnitte) des PDFs.
- **Freie Textsuche** im Schaltplan (`⌥⌘F`): findet auch Wortteile, z. B. `VBUS` in `PP_VBUS`; `↩` / `⇧↩` springen durch die Treffer.
- **Eigenes Fenster** für den zweiten Monitor: Der Schaltplan folgt weiter der Auswahl im Board, Klicks im Schaltplan wählen im Board aus.

**Werkstatt**
- **Bibliothek** (`⌘L`): eigene Avero-Bibliothek unter `~/Dokumente/Avero/Bibliothek`. Dateien, Ordner oder ZIP-Archive ins Bibliotheksfenster ziehen oder „Importieren…" – Avero kopiert Boardviews und Schaltpläne hinein, sortiert sie nach Boardnummer oder in einen Geräteordner deiner Wahl (`Apple/iPhone 13 Pro`) und überspringt Duplikate. Zusätzlich lassen sich bestehende Ordner einbinden. Alles ist nach Boardnummer, Gerät und Dateiname durchsuchbar; ein Klick öffnet Board und Schaltplan zusammen. Noch nicht lesbare Formate (`.fz`, `.tvw`) werden ausgegraut angezeigt.
- **Messwerte pro Netz**: Diodenmodus, Spannung, Widerstand. Eingaben wie `0,452`, `452` (mV), `4k7`, `OL` werden verstanden.
- **Referenz und Reparaturfälle**: Werte vom guten Board als Referenz, jedes Gerät auf dem Tisch als eigener Fall. Abweichungen über der Toleranz (Standard ± 10 %) werden rot markiert, auch als Punkt direkt an den Pins auf dem Board.
- **Notizen** pro Board und pro Fall, Export/Import als JSON (z. B. Referenzwerte weitergeben).
- **Foto des echten Boards** unter der Boardview (Darstellung → „Foto dieser Seite hinzufügen…"): zwei markante Punkte im Foto anklicken, dann dieselben Punkte auf dem Board (Pins rasten ein) – das Foto liegt danach deckungsgleich darunter, mit einstellbarer Deckkraft, getrennt für Ober- und Unterseite.
- **Volltextsuche über alle Schaltpläne** der Bibliothek (Bibliothek → „Schaltplan-Text"): Die PDFs werden einmal indiziert, danach findet die Suche Netze, Bauteile oder Chip-Namen in allen Schaltplänen mit Seitenzahlen; ein Klick öffnet Board und Schaltplan mit der Suche.
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

Avero meldet neue Versionen selbst. Eine neue Version entsteht, wenn ein Tag `v*` gepusht wird: GitHub Actions baut die DMG und veröffentlicht sie als Release.

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

Die nächsten Schritte stehen in [docs/ROADMAP.md](docs/ROADMAP.md): Diodenwerte aus XZZ-Dateien, `.fz` und `.tvw`, Fotos über dem Board, Profi-Funktionen.

## Dank

Das Wissen über die Dateiformate stammt zu großen Teilen aus [OpenBoardView](https://github.com/OpenBoardView/OpenBoardView) (MIT). PDFs werden mit [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0) dargestellt. Details in [NOTICE](NOTICE).

## Lizenz

[MIT](LICENSE)
